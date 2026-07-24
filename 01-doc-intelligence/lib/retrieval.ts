import { db } from "./db"
import { activeModel, cosine, embed } from "./embeddings"

/**
 * Hybrid retrieval = vector search + keyword search, fused with RRF.
 *
 * Why hybrid? The two retrievers fail differently:
 *  - Vector search finds paraphrase ("how long can I take off after having a
 *    baby" → parental leave) but is weak on exact identifiers ("SEV1",
 *    "$5,000", error codes) — especially with small embedding models.
 *  - Keyword search (Postgres full-text, ts_rank) nails exact terms but has
 *    zero notion of synonymy.
 *
 * Reciprocal Rank Fusion combines both lists WITHOUT score calibration:
 *   rrf(chunk) = Σ over lists: 1 / (60 + rank_in_list)
 * Rank-based fusion sidesteps the classic trap that cosine similarities and
 * ts_rank scores live on incomparable scales. k=60 is the standard damping
 * constant from the RRF paper — it keeps a #1 rank from dominating.
 *
 * The fused pool (up to ~18 unique chunks) then goes to the re-ranker, which
 * is the stage that actually reads the text (lib/rerank.ts).
 */

export const VECTOR_K = 12
export const KEYWORD_K = 12
const RRF_K = 60

export type RetrievedChunk = {
  chunkId: number
  documentId: number
  documentTitle: string
  headingPath: string
  content: string
  vectorRank: number | null
  vectorSim: number | null
  keywordRank: number | null
  rrfScore: number
  rerankScore: number | null
}

export type RetrievalResult = {
  embeddingModel: string
  candidates: RetrievedChunk[]
  timings: { embedMs: number; vectorMs: number; keywordMs: number }
}

export async function hybridRetrieve(question: string): Promise<RetrievalResult> {
  const model = activeModel()
  const pool = db()

  // —— guard: never mix embedding spaces ——
  const models = await pool.query(
    `SELECT DISTINCT embedding_model FROM chunks`,
  )
  const available = models.rows.map((r) => r.embedding_model)
  if (available.length > 0 && !available.includes(model)) {
    throw new Error(
      `Corpus is embedded with [${available.join(", ")}] but the active model is "${model}". ` +
        `Cosine similarity across embedding spaces is meaningless — re-ingest the corpus ` +
        `(npm run setup after changing OPENAI_API_KEY) instead of mixing.`,
    )
  }

  const t0 = Date.now()
  const { vectors } = await embed([question])
  const qVec = vectors[0]
  const embedMs = Date.now() - t0

  // —— vector list (in-process cosine; pgvector swap = one ORDER BY) ——
  const t1 = Date.now()
  const all = await pool.query(
    `SELECT c.id, c.document_id, c.heading_path, c.content, c.embedding, d.title
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.embedding_model = $1`,
    [model],
  )
  const scored = all.rows
    .map((r) => ({ row: r, sim: cosine(qVec, r.embedding) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, VECTOR_K)
  const vectorMs = Date.now() - t1

  // —— keyword list (Postgres full-text) ——
  const t2 = Date.now()
  const kw = await pool.query(
    `SELECT c.id, c.document_id, c.heading_path, c.content, d.title,
            ts_rank(c.tsv, plainto_tsquery('english', $1)) AS rank_score
     FROM chunks c JOIN documents d ON d.id = c.document_id
     WHERE c.tsv @@ plainto_tsquery('english', $1) AND c.embedding_model = $2
     ORDER BY rank_score DESC
     LIMIT ${KEYWORD_K}`,
    [question, model],
  )
  const keywordMs = Date.now() - t2

  // —— Reciprocal Rank Fusion ——
  const byId = new Map<number, RetrievedChunk>()
  scored.forEach((s, i) => {
    byId.set(s.row.id, {
      chunkId: s.row.id,
      documentId: s.row.document_id,
      documentTitle: s.row.title,
      headingPath: s.row.heading_path,
      content: s.row.content,
      vectorRank: i + 1,
      vectorSim: Math.round(s.sim * 1000) / 1000,
      keywordRank: null,
      rrfScore: 1 / (RRF_K + i + 1),
      rerankScore: null,
    })
  })
  kw.rows.forEach((r, i) => {
    const existing = byId.get(r.id)
    if (existing) {
      existing.keywordRank = i + 1
      existing.rrfScore += 1 / (RRF_K + i + 1)
    } else {
      byId.set(r.id, {
        chunkId: r.id,
        documentId: r.document_id,
        documentTitle: r.title,
        headingPath: r.heading_path,
        content: r.content,
        vectorRank: null,
        vectorSim: null,
        keywordRank: i + 1,
        rrfScore: 1 / (RRF_K + i + 1),
        rerankScore: null,
      })
    }
  })

  const candidates = [...byId.values()].sort((a, b) => b.rrfScore - a.rrfScore)
  return { embeddingModel: model, candidates, timings: { embedMs, vectorMs, keywordMs } }
}

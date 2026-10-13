import OpenAI from "openai"

/**
 * Embeddings with a deterministic mock:
 *
 * - MOCK ("mock-v1", no API key): 256-dim hashed bag-of-words. Unigrams +
 *   bigrams are djb2-hashed to a dimension with a hash-derived sign, then the
 *   vector is L2-normalized. Deterministic — same text, same vector, every
 *   machine — which is what makes the eval script's numbers reproducible.
 * - REAL ("text-embedding-3-small"): one API call per text (batched on ingest).
 *
 * Every chunk row stores its embedding_model. Retrieval only ever compares
 * vectors from ONE model — cosine similarity across embedding spaces is
 * meaningless, so mixing is refused at query time rather than silently
 * returning garbage.
 *
 * Vectors are stored as JSONB arrays and compared in-process. At demo scale
 * (dozens of docs, hundreds of chunks) this is honest and fast; the pgvector
 * swap is one column type + one ORDER BY (see README “Scaling”) and the
 * interface here doesn't change.
 *
 * scripts/setup.mjs mirrors mockEmbed exactly — seeded chunks must live in
 * the same vector space as query-time embeddings.
 */

export const MOCK_MODEL = "mock-v1"
export const REAL_MODEL = "text-embedding-3-small"
export const DIM = 256

export function activeModel(): string {
  return process.env.OPENAI_API_KEY ? REAL_MODEL : MOCK_MODEL
}

function djb2(str: string): number {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h * 33) ^ str.charCodeAt(i)) >>> 0
  }
  return h
}

export function mockEmbed(text: string): number[] {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
  const grams = [...words]
  for (let i = 0; i < words.length - 1; i++) {
    grams.push(words[i] + "_" + words[i + 1])
  }
  const vec = new Array(DIM).fill(0)
  for (const g of grams) {
    const h = djb2(g)
    const idx = h % DIM
    const sign = (h >>> 8) & 1 ? 1 : -1
    vec[idx] += sign
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map((v) => Math.round((v / norm) * 1e6) / 1e6)
}

export async function embed(texts: string[]): Promise<{ model: string; vectors: number[][] }> {
  if (!process.env.OPENAI_API_KEY) {
    return { model: MOCK_MODEL, vectors: texts.map(mockEmbed) }
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const res = await client.embeddings.create({ model: REAL_MODEL, input: texts })
  return { model: REAL_MODEL, vectors: res.data.map((d) => d.embedding) }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1
  return dot / denom
}

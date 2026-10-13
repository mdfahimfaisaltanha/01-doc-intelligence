# DocMind — AI Document Intelligence Platform

A RAG (retrieval-augmented generation) knowledge base for a fictional company
(Meridian Labs). Ingest Markdown documents, ask questions in natural language,
and get **citation-backed answers** — or an **honest refusal** when the answer
isn't in the corpus. Every answer ships with the full retrieval trace: vector
ranks, keyword ranks, fusion scores, and re-rank scores, so the pipeline shows
its work instead of asking to be trusted.

**Stack:** Next.js 14 (App Router) · TypeScript · PostgreSQL · OpenAI (optional — full mock mode included)

---

## The pipeline

```
            ┌─ INGEST ───────────────────────────────────────┐
  document  │ heading-aware chunking (~1100 chars, paragraph  │
  ───────▶  │ overlap) → embed → store w/ heading path + tsv   │
            └─────────────────────────────────────────────┘

            ┌─ ASK ────────────────────────────────────────┐
  question  │ 1. vector search (cosine, top-12)   ┐            │
  ───────▶  │ 2. keyword search (ts_rank, top-12)  ├─ RECALL    │
            │ 3. Reciprocal Rank Fusion (k=60)    ┘            │
            │ 4. re-rank the fused pool (0-100)   ── PRECISION │
            │ 5. refusal gate (floor 35) → answer + [n] cites  │
            └─────────────────────────────────────────────┘
```

## Design decisions worth defending in an interview

- **Hybrid retrieval because the two retrievers fail differently.** Vector
  search finds paraphrase (“time off after having a baby” → parental leave)
  but is weak on exact identifiers (“SEV1”, “$5,000”); keyword search nails
  exact terms but has zero synonymy. Fusing both lists covers each one's
  blind spot.
- **Reciprocal Rank Fusion, not score mixing.** Cosine similarity and
  `ts_rank` live on incomparable scales; any weighted sum of them is a
  calibration lie. RRF (`Σ 1/(60+rank)`) uses only *ranks* — no calibration
  needed. That's why it's the standard baseline fusion method.
- **Recall, then precision.** First-stage retrieval is cheap and casts a wide
  net (~18 candidates); the re-ranker actually reads them and scores 0-100.
  The expensive careful stage only ever sees a pool, never the corpus.
- **The refusal gate is the product.** If the best re-rank score is below
  `RERANK_FLOOR` (default 35), DocMind says “not in the knowledge base”.
  A RAG system that always answers is a hallucination machine with citations
  for decoration. In real mode there's a second gate: the model itself may
  reply NOT_FOUND even when retrieval scores looked good.
- **Heading-aware chunking.** Chunks never cross headings, every chunk knows
  its heading path (“Expense Policy › Approval thresholds”) — which makes
  citations human-readable for free — and short previous paragraphs are
  carried over as overlap so boundary facts are retrievable from both sides.
- **The mock answerer can't hallucinate by construction.** It's purely
  extractive: every sentence in the answer exists verbatim in a cited chunk.
- **Embedding spaces are never mixed.** Every chunk stores its
  `embedding_model`; if the corpus and the active model disagree, DocMind
  refuses with instructions to re-ingest — rather than silently comparing
  vectors from different spaces (which returns confident garbage).

## Getting started

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL (Neon/Supabase free tier works)
npm run setup                # schema + 6 seeded docs (~30 chunks), 2 users
npm run dev                  # http://localhost:3000
npm run eval                 # (second terminal) golden-set retrieval eval
```

Seeded sign-ins (password = `SEED_PASSWORD`, default `ChangeMe123!`):

| Email | Role |
| --- | --- |
| `editor@meridian.test` | Editor |
| `lead@meridian.test` | Admin |

Asking is public; adding/deleting documents requires a session.

## Mock vs real mode

| Stage | Mock (no key) | Real (`OPENAI_API_KEY` set) |
| --- | --- | --- |
| Embeddings | `mock-v1`: 256-dim hashed bag-of-words (unigrams+bigrams, djb2, L2-normalized) | `text-embedding-3-small` |
| Keyword search | Postgres full-text (`ts_rank`) | Same (always local) |
| Fusion | RRF, k=60 | Same (always local) |
| Re-rank | `heuristic-v1`: coverage + bigram + heading + RRF tie-break | gpt-4o-mini, one JSON call for the whole pool |
| Answer | `extractive-v1`: best sentences, verbatim, with [n] markers | gpt-4o-mini, temp 0, NOT_FOUND allowed |
| Determinism | Fully deterministic — eval numbers reproduce exactly | Model-dependent |
| Failure | n/a | Falls back to mock engines, noted in the response |

Switching modes? Re-run ingestion (`npm run setup` on a fresh DB or re-add
docs) — chunks embedded with `mock-v1` cannot be queried with
`text-embedding-3-small`, and DocMind will tell you so instead of guessing.

## Evaluation (`npm run eval`)

12 golden questions (each mapped to its source document + expected fact) and
2 out-of-corpus refusal probes, run against the live API:

- **citation hit@4** — did the expected document appear in the citations?
- **MRR** — mean reciprocal rank of the first correct citation
- **fact-in-answer** — does the answer contain the expected fact?
- **refusal accuracy** — out-of-corpus probes must be refused

Sample mock-mode results are documented in [EVAL.md](./EVAL.md). Determinism
means a regression in chunking, fusion, or re-ranking shows up as a changed
number — the eval doubles as a retrieval regression test.

## API surface

| Route | Method | Auth | Purpose |
| --- | --- | --- | --- |
| `/api/ask` | POST | public | `{question}` → answer, citations, full trace |
| `/api/ask` | GET | public | Last 20 questions |
| `/api/documents` | GET | public | Library list (or `?id=` for one doc + chunks) |
| `/api/documents` | POST | editor | Ingest `{title, content}` → chunk + embed |
| `/api/documents` | DELETE | editor | `?id=` remove document + chunks |
| `/api/auth` | GET/POST/DELETE | — | Session management |

## Edge cases handled

| Case | Behavior |
| --- | --- |
| Question not answerable from corpus | Refusal gate: below-floor scores → honest “not in the knowledge base” |
| Exact identifiers (“SEV1”, “$5,000”) | Keyword leg catches what small embeddings blur |
| Paraphrased questions | Vector leg catches what keyword search misses |
| Incomparable retriever scores | RRF fuses by rank — no score calibration |
| Facts at chunk boundaries | Paragraph overlap makes them retrievable from both sides |
| Mixed embedding spaces | Refused at query time with a re-ingest hint |
| LLM failure in real mode | Graceful fallback to deterministic engines, noted in response |
| Prompt injection inside documents | Rerank + answer prompts treat passages as data; mock engines immune by construction |
| Empty / oversized inputs | 400 with clear messages (question ≤ 500 chars, doc ≤ 60k) |
| Sign-in probing | No-enumeration: identical 401 for wrong email or password |
| Transactional ingest | Doc + chunks inserted atomically; failure rolls back both |

## Scaling honestly

At demo scale (hundreds of chunks) vectors are JSONB arrays compared
in-process — simple, debuggable, zero extensions. The production path is
**pgvector**: change the column to `vector(1536)`, add an HNSW index, and
replace the in-process cosine loop with `ORDER BY embedding <=> $1 LIMIT 12`.
The retrieval interface (`hybridRetrieve`) doesn't change shape, which is
exactly why it's isolated in one module.

## Known limitations (deliberate)

- Mock embeddings are lexical — true synonymy (“vacation” vs “PTO”) needs the
  real model; the mock exists for determinism and zero-cost demos.
- No conversation memory — each question is independent (multi-turn RAG is a
  different project).
- English-only full-text config; the multilingual pipeline lives in project 18.
- No chunk-level access control — every document is corpus-visible to askers.

## Deploying

- **Vercel** — import the repo, set `DATABASE_URL` (+ `OPENAI_API_KEY` for real mode).
- **Neon / Supabase** — free Postgres; run `npm run setup` once against it.

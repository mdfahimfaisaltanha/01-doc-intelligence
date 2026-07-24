export type User = {
  id: number
  name: string
  email: string
  role: "editor" | "admin"
}

export type DocumentRow = {
  id: number
  title: string
  source_type: string
  content: string
  created_at: string
}

export type ChunkRow = {
  id: number
  document_id: number
  chunk_index: number
  heading_path: string
  content: string
  embedding_model: string
}

/** One candidate's journey through the retrieval pipeline. */
export type CandidateTrace = {
  chunkId: number
  documentId: number
  documentTitle: string
  headingPath: string
  snippet: string
  /** 1-based rank in the vector list, null if not retrieved by vector search */
  vectorRank: number | null
  vectorSim: number | null
  /** 1-based rank in the keyword (full-text) list, null if not retrieved */
  keywordRank: number | null
  /** Reciprocal Rank Fusion score across both lists */
  rrfScore: number
  /** Re-ranker score 0-100 (null until re-ranked) */
  rerankScore: number | null
}

export type Citation = {
  /** citation number as used in the answer text, e.g. [1] */
  n: number
  chunkId: number
  documentId: number
  documentTitle: string
  headingPath: string
  snippet: string
  rerankScore: number
}

export type AskTrace = {
  question: string
  embeddingModel: string
  rerankEngine: "heuristic-v1" | "gpt-4o-mini"
  answerEngine: "extractive-v1" | "gpt-4o-mini"
  candidates: CandidateTrace[]
  rerankFloor: number
  timings: {
    embedMs: number
    vectorMs: number
    keywordMs: number
    rerankMs: number
    answerMs: number
    totalMs: number
  }
}

export type AskResult = {
  id: number
  answer: string
  refused: boolean
  citations: Citation[]
  trace: AskTrace
}

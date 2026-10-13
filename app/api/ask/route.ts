import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { hybridRetrieve } from "@/lib/retrieval"
import { rerank } from "@/lib/rerank"
import { answer } from "@/lib/answer"
import type { AskTrace, CandidateTrace } from "@/lib/types"

export const dynamic = "force-dynamic"

const MAX_QUESTION_CHARS = 500

/**
 * POST /api/ask { question } → answer + citations + FULL retrieval trace
 * GET  /api/ask              → last 20 questions (recent activity)
 *
 * The trace is the showpiece: for every candidate you can see its vector
 * rank, keyword rank, RRF fusion score, and re-rank score — the pipeline
 * shows its work instead of asking to be trusted.
 */

export async function POST(req: Request) {
  let body: { question?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const question = (body.question ?? "").trim()
  if (!question) return NextResponse.json({ error: "question is required" }, { status: 400 })
  if (question.length > MAX_QUESTION_CHARS) {
    return NextResponse.json({ error: `Question too long (max ${MAX_QUESTION_CHARS} chars)` }, { status: 400 })
  }

  const t0 = Date.now()
  let retrieval
  try {
    retrieval = await hybridRetrieve(question)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Retrieval failed" }, { status: 500 })
  }

  const t1 = Date.now()
  const rr = await rerank(question, retrieval.candidates)
  const rerankMs = Date.now() - t1

  const t2 = Date.now()
  const ans = await answer(question, retrieval.candidates)
  const answerMs = Date.now() - t2

  const floorValue = Number(process.env.RERANK_FLOOR)
  const candidates: CandidateTrace[] = retrieval.candidates
    .slice()
    .sort((a, b) => (b.rerankScore ?? 0) - (a.rerankScore ?? 0))
    .map((c) => ({
      chunkId: c.chunkId,
      documentId: c.documentId,
      documentTitle: c.documentTitle,
      headingPath: c.headingPath,
      snippet: c.content.length > 180 ? c.content.slice(0, 180) + "…" : c.content,
      vectorRank: c.vectorRank,
      vectorSim: c.vectorSim,
      keywordRank: c.keywordRank,
      rrfScore: Math.round(c.rrfScore * 10000) / 10000,
      rerankScore: c.rerankScore,
    }))

  const trace: AskTrace = {
    question,
    embeddingModel: retrieval.embeddingModel,
    rerankEngine: rr.engine,
    answerEngine: ans.engine,
    candidates,
    rerankFloor: Number.isFinite(floorValue) ? floorValue : 35,
    timings: {
      embedMs: retrieval.timings.embedMs,
      vectorMs: retrieval.timings.vectorMs,
      keywordMs: retrieval.timings.keywordMs,
      rerankMs,
      answerMs,
      totalMs: Date.now() - t0,
    },
  }

  const saved = await db().query(
    `INSERT INTO queries (question, answer, refused, citations, trace, processing_ms)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6) RETURNING id`,
    [question, ans.answer, ans.refused, JSON.stringify(ans.citations), JSON.stringify(trace), trace.timings.totalMs],
  )

  return NextResponse.json({
    id: saved.rows[0].id,
    answer: ans.answer,
    refused: ans.refused,
    citations: ans.citations,
    note: ans.note ?? rr.note,
    trace,
  })
}

export async function GET() {
  const res = await db().query(
    `SELECT id, question, refused, processing_ms, created_at
     FROM queries ORDER BY id DESC LIMIT 20`,
  )
  return NextResponse.json({ queries: res.rows })
}

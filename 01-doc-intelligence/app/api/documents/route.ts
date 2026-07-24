import { NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getSessionUser } from "@/lib/auth"
import { chunkDocument } from "@/lib/chunk"
import { embed } from "@/lib/embeddings"

export const dynamic = "force-dynamic"

const MAX_DOC_CHARS = 60_000

/**
 * GET /api/documents           → library list with chunk counts (public)
 * GET /api/documents?id=3      → one document with its chunks (public)
 * POST { title, content }     → ingest: chunk + embed + store (editor session)
 * DELETE ?id=3                → remove document + chunks (editor session)
 */

export async function GET(req: Request) {
  const url = new URL(req.url)
  const id = url.searchParams.get("id")

  if (id) {
    const doc = await db().query(`SELECT id, title, source_type, created_at FROM documents WHERE id = $1`, [Number(id)])
    if (!doc.rows[0]) return NextResponse.json({ error: "Document not found" }, { status: 404 })
    const chunks = await db().query(
      `SELECT id, chunk_index, heading_path, content, embedding_model
       FROM chunks WHERE document_id = $1 ORDER BY chunk_index`,
      [Number(id)],
    )
    return NextResponse.json({ document: doc.rows[0], chunks: chunks.rows })
  }

  const res = await db().query(
    `SELECT d.id, d.title, d.source_type, d.created_at,
            count(c.id)::int AS chunk_count
     FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
     GROUP BY d.id ORDER BY d.id`,
  )
  return NextResponse.json({ documents: res.rows })
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Sign in to add documents" }, { status: 401 })

  let body: { title?: string; content?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const title = (body.title ?? "").trim()
  const content = (body.content ?? "").trim()
  if (!title || !content) {
    return NextResponse.json({ error: "Both title and content are required" }, { status: 400 })
  }
  if (content.length > MAX_DOC_CHARS) {
    return NextResponse.json({ error: `Document too large (max ${MAX_DOC_CHARS.toLocaleString()} chars)` }, { status: 400 })
  }

  const chunks = chunkDocument(title, content)
  if (chunks.length === 0) {
    return NextResponse.json({ error: "Document produced no chunks (is it empty?)" }, { status: 400 })
  }

  // Embed all chunks in one batch (one API call in real mode).
  const { model, vectors } = await embed(chunks.map((c) => c.content))

  const client = await db().connect()
  try {
    await client.query("BEGIN")
    const doc = await client.query(
      `INSERT INTO documents (title, source_type, content) VALUES ($1, 'manual', $2) RETURNING id, title, source_type, created_at`,
      [title, content],
    )
    const docId = doc.rows[0].id
    for (let i = 0; i < chunks.length; i++) {
      await client.query(
        `INSERT INTO chunks (document_id, chunk_index, heading_path, content, embedding, embedding_model)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
        [docId, chunks[i].index, chunks[i].headingPath, chunks[i].content, JSON.stringify(vectors[i]), model],
      )
    }
    await client.query("COMMIT")
    return NextResponse.json(
      { document: doc.rows[0], chunkCount: chunks.length, embeddingModel: model },
      { status: 201 },
    )
  } catch (e) {
    await client.query("ROLLBACK")
    throw e
  } finally {
    client.release()
  }
}

export async function DELETE(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: "Sign in to delete documents" }, { status: 401 })
  const url = new URL(req.url)
  const id = Number(url.searchParams.get("id"))
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id query param required" }, { status: 400 })
  const res = await db().query(`DELETE FROM documents WHERE id = $1 RETURNING id`, [id])
  if (!res.rows[0]) return NextResponse.json({ error: "Document not found" }, { status: 404 })
  return NextResponse.json({ ok: true, deletedId: id })
}

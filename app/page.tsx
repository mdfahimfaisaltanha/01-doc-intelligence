"use client"

import { useCallback, useEffect, useState } from "react"
import type { AskResult, Citation, User } from "@/lib/types"

type DocListItem = {
  id: number
  title: string
  source_type: string
  created_at: string
  chunk_count: number
}

type DocDetail = {
  document: { id: number; title: string; source_type: string; created_at: string }
  chunks: Array<{ id: number; chunk_index: number; heading_path: string; content: string; embedding_model: string }>
}

type RecentQuery = { id: number; question: string; refused: boolean; processing_ms: number; created_at: string }

export default function Home() {
  const [tab, setTab] = useState<"ask" | "library">("ask")
  const [user, setUser] = useState<User | null>(null)

  // ask state
  const [question, setQuestion] = useState("")
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<(AskResult & { note?: string }) | null>(null)
  const [askError, setAskError] = useState("")
  const [recent, setRecent] = useState<RecentQuery[]>([])

  // library state
  const [docs, setDocs] = useState<DocListItem[]>([])
  const [detail, setDetail] = useState<DocDetail | null>(null)
  const [newTitle, setNewTitle] = useState("")
  const [newContent, setNewContent] = useState("")
  const [libMsg, setLibMsg] = useState("")
  const [libError, setLibError] = useState("")
  const [saving, setSaving] = useState(false)

  // auth state
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [authError, setAuthError] = useState("")

  const loadDocs = useCallback(async () => {
    const res = await fetch("/api/documents")
    const data = await res.json()
    if (res.ok) setDocs(data.documents)
  }, [])

  const loadRecent = useCallback(async () => {
    const res = await fetch("/api/ask")
    const data = await res.json()
    if (res.ok) setRecent(data.queries)
  }, [])

  useEffect(() => {
    fetch("/api/auth")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => {})
    loadDocs()
    loadRecent()
  }, [loadDocs, loadRecent])

  async function ask(q?: string) {
    const text = (q ?? question).trim()
    if (!text) return
    setAsking(true)
    setAskError("")
    setResult(null)
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        setAskError(data.error ?? "Something went wrong")
      } else {
        setResult(data)
        loadRecent()
      }
    } catch {
      setAskError("Network error — is the dev server running?")
    } finally {
      setAsking(false)
    }
  }

  async function ingest() {
    setSaving(true)
    setLibError("")
    setLibMsg("")
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, content: newContent }),
      })
      const data = await res.json()
      if (!res.ok) {
        setLibError(data.error ?? "Ingest failed")
      } else {
        setLibMsg(`Ingested “${data.document.title}” → ${data.chunkCount} chunks (${data.embeddingModel})`)
        setNewTitle("")
        setNewContent("")
        loadDocs()
      }
    } finally {
      setSaving(false)
    }
  }

  async function removeDoc(id: number) {
    const res = await fetch(`/api/documents?id=${id}`, { method: "DELETE" })
    if (res.ok) {
      setDetail(null)
      loadDocs()
    }
  }

  async function openDoc(id: number) {
    const res = await fetch(`/api/documents?id=${id}`)
    const data = await res.json()
    if (res.ok) setDetail(data)
  }

  async function signIn() {
    setAuthError("")
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) {
      setAuthError(data.error ?? "Sign-in failed")
    } else {
      setUser(data.user)
      setEmail("")
      setPassword("")
    }
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" })
    setUser(null)
  }

  const suggestions = [
    "How many PTO days do employees get per year?",
    "What is the Atlas API rate limit?",
    "How quickly must a SEV1 incident be acknowledged?",
    "Who approves expenses over $5,000?",
    "What is the company's stock ticker?",
  ]

  return (
    <main>
      <div className="topbar">
        <div>
          <h1>🧠 DocMind</h1>
          <div className="brand-sub">AI document intelligence for Meridian Labs · hybrid retrieval · re-ranked · citation-backed</div>
        </div>
        <div>
          {user ? (
            <span className="muted">
              {user.name} ({user.role}) <button className="ghost" onClick={signOut}>Sign out</button>
            </span>
          ) : (
            <span className="muted">Browsing as guest — sign in below to manage the library</span>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={tab === "ask" ? "active" : ""} onClick={() => setTab("ask")}>💬 Ask</button>
        <button className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}>📚 Library</button>
      </div>

      {tab === "ask" && (
        <>
          <div className="card">
            <h2>Ask the knowledge base</h2>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="e.g. How many webhook retry attempts does Atlas make?"
              maxLength={500}
            />
            <div className="muted" style={{ marginTop: 8 }}>
              Try:{" "}
              {suggestions.map((s) => (
                <button key={s} className="ghost" style={{ margin: "4px 6px 0 0" }} onClick={() => { setQuestion(s); ask(s) }}>
                  {s}
                </button>
              ))}
            </div>
            <button className="primary" onClick={() => ask()} disabled={asking || !question.trim()}>
              {asking ? "Retrieving…" : "Ask"}
            </button>
            {askError && <div className="error-box">{askError}</div>}
          </div>

          {result && (
            <div className="card">
              <h2>
                {result.refused ? (
                  <span className="badge warn">honest refusal</span>
                ) : (
                  <span className="badge good">answered</span>
                )}{" "}
                <span className="badge">{result.trace.answerEngine}</span>{" "}
                <span className="badge">{result.trace.timings.totalMs} ms</span>
              </h2>
              <div className={`answer-box${result.refused ? " refused" : ""}`}>{result.answer}</div>
              {result.note && <div className="muted" style={{ marginTop: 8 }}>⚠️ {result.note}</div>}

              {result.citations.length > 0 && (
                <>
                  <h2 style={{ marginTop: 18 }}>Sources</h2>
                  {result.citations.map((c: Citation) => (
                    <div className="citation" key={c.n}>
                      <span className="n">[{c.n}]</span>
                      <strong>{c.documentTitle}</strong>{" "}
                      <span className="badge accent">rerank {c.rerankScore}</span>
                      <div className="path">{c.headingPath}</div>
                      <div className="snippet">{c.snippet}</div>
                    </div>
                  ))}
                </>
              )}

              <details className="trace">
                <summary>🔎 Retrieval trace — how this answer was found ({result.trace.candidates.length} candidates, floor {result.trace.rerankFloor})</summary>
                <div className="timing-chips">
                  <span>embed {result.trace.timings.embedMs} ms</span>
                  <span>vector {result.trace.timings.vectorMs} ms</span>
                  <span>keyword {result.trace.timings.keywordMs} ms</span>
                  <span>rerank {result.trace.timings.rerankMs} ms ({result.trace.rerankEngine})</span>
                  <span>answer {result.trace.timings.answerMs} ms</span>
                  <span>embeddings: {result.trace.embeddingModel}</span>
                </div>
                <table className="trace-table">
                  <thead>
                    <tr>
                      <th>Chunk</th>
                      <th>Vector</th>
                      <th>Keyword</th>
                      <th>RRF</th>
                      <th>Rerank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trace.candidates.map((c) => (
                      <tr key={c.chunkId}>
                        <td>
                          <strong>{c.documentTitle}</strong>
                          <div className="muted">{c.headingPath}</div>
                          <div className="muted">{c.snippet}</div>
                        </td>
                        <td>
                          <span className={`rank-chip${c.vectorRank ? " hit" : ""}`}>{c.vectorRank ? `#${c.vectorRank}` : "—"}</span>
                          {c.vectorSim !== null && <div className="muted">sim {c.vectorSim}</div>}
                        </td>
                        <td>
                          <span className={`rank-chip${c.keywordRank ? " hit" : ""}`}>{c.keywordRank ? `#${c.keywordRank}` : "—"}</span>
                        </td>
                        <td>{c.rrfScore}</td>
                        <td>
                          {c.rerankScore ?? "—"}
                          <div className="scorebar"><div style={{ width: `${c.rerankScore ?? 0}%` }} /></div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </div>
          )}

          {recent.length > 0 && (
            <div className="card">
              <h2>Recent questions</h2>
              <table>
                <thead>
                  <tr><th>Question</th><th>Outcome</th><th>Latency</th></tr>
                </thead>
                <tbody>
                  {recent.map((q) => (
                    <tr key={q.id}>
                      <td>{q.question}</td>
                      <td>{q.refused ? <span className="badge warn">refused</span> : <span className="badge good">answered</span>}</td>
                      <td className="muted">{q.processing_ms} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === "library" && (
        <>
          <div className="card">
            <h2>📚 Document library</h2>
            <table>
              <thead>
                <tr><th>Title</th><th>Chunks</th><th>Added</th><th></th></tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="doc-row" onClick={() => openDoc(d.id)}>
                    <td>{d.title}</td>
                    <td>{d.chunk_count}</td>
                    <td className="muted">{new Date(d.created_at).toLocaleDateString()}</td>
                    <td>
                      {user && (
                        <button className="ghost" onClick={(e) => { e.stopPropagation(); removeDoc(d.id) }}>Delete</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="muted" style={{ marginTop: 8 }}>Click a document to inspect its chunks (heading paths included).</div>
          </div>

          {detail && (
            <div className="card">
              <h2>{detail.document.title} — {detail.chunks.length} chunks</h2>
              {detail.chunks.map((c) => (
                <div className="chunk-view" key={c.id}>
                  <div className="path">#{c.chunk_index} · {c.heading_path} · {c.embedding_model}</div>
                  <pre>{c.content}</pre>
                </div>
              ))}
            </div>
          )}

          {user ? (
            <div className="card">
              <h2>➕ Add a document</h2>
              <label>Title</label>
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="e.g. Travel Policy" />
              <label>Content (Markdown — headings become chunk locations)</label>
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                style={{ minHeight: 200 }}
                placeholder={"# Travel Policy\n\n## Booking\nAll flights must be booked…"}
              />
              <button className="primary" onClick={ingest} disabled={saving || !newTitle.trim() || !newContent.trim()}>
                {saving ? "Chunking + embedding…" : "Ingest document"}
              </button>
              {libError && <div className="error-box">{libError}</div>}
              {libMsg && <div className="ok-box">{libMsg}</div>}
            </div>
          ) : (
            <div className="card login-wrap">
              <h2>Editor sign-in</h2>
              <div className="muted">Seeded editors: editor@meridian.test or lead@meridian.test (password: SEED_PASSWORD, default ChangeMe123!)</div>
              <label>Email</label>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
              <label>Password</label>
              <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" />
              <button className="primary" onClick={signIn} disabled={!email || !password}>Sign in</button>
              {authError && <div className="error-box">{authError}</div>}
            </div>
          )}
        </>
      )}
    </main>
  )
}

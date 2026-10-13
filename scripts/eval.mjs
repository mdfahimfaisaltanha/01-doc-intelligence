// Retrieval eval for DocMind — golden Q&A set against a RUNNING server.
//
//   npm run dev          (in one terminal)
//   npm run eval         (in another; BASE_URL env var to point elsewhere)
//
// Measures what actually matters for RAG:
//   • hit@4  — is the expected source document among the citations?
//   • MRR    — how high does the first correct citation rank?
//   • answer contains the expected fact (substring check)
//   • refusal accuracy — out-of-corpus probes must be REFUSED, not answered
//
// In mock mode every number is deterministic — the same corpus and questions
// produce the same score on every machine. EVAL.md documents a sample run.

const BASE_URL = process.env.BASE_URL || "http://localhost:3000"

const GOLDEN = [
  { q: "How many PTO days do employees get per year?", doc: "Employee Handbook", expect: "20" },
  { q: "How many unused PTO days can be carried over?", doc: "Employee Handbook", expect: "5" },
  { q: "How long is parental leave?", doc: "Employee Handbook", expect: "16 weeks" },
  { q: "What is the home office equipment budget?", doc: "Employee Handbook", expect: "$1,500" },
  { q: "What is the Atlas API rate limit?", doc: "Atlas API Product Spec", expect: "600" },
  { q: "How many times are failed webhook deliveries retried?", doc: "Atlas API Product Spec", expect: "5" },
  { q: "What uptime does the Atlas SLA guarantee?", doc: "Atlas API Product Spec", expect: "99.9%" },
  { q: "How quickly must a SEV1 incident be acknowledged?", doc: "Incident Response Runbook", expect: "15 minutes" },
  { q: "When must a postmortem be published?", doc: "Incident Response Runbook", expect: "5 business days" },
  { q: "Within how many hours must a security incident be reported?", doc: "Security Policy", expect: "24" },
  { q: "Who approves expenses over $5,000?", doc: "Expense Policy", expect: "VP" },
  { q: "What is the daily meal limit while traveling?", doc: "Expense Policy", expect: "$60" },
]

const REFUSAL_PROBES = [
  "What is the company's stock ticker symbol?",
  "What is the wifi password at the Amsterdam office?",
]

async function ask(question) {
  const res = await fetch(`${BASE_URL}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`POST /api/ask ${res.status}: ${body.slice(0, 200)}`)
  }
  return res.json()
}

function pad(s, n) {
  s = String(s)
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length)
}

async function main() {
  console.log(`DocMind retrieval eval — ${BASE_URL}\n`)

  let hits = 0
  let mrrSum = 0
  let factHits = 0
  let wrongRefusals = 0

  console.log(pad("question", 52) + pad("cited?", 8) + pad("rank", 6) + pad("fact?", 7) + "ms")
  console.log("-".repeat(85))

  for (const g of GOLDEN) {
    const r = await ask(g.q)
    if (r.refused) {
      wrongRefusals++
      console.log(pad(g.q, 52) + pad("REFUSED", 8) + pad("—", 6) + pad("—", 7) + r.trace.timings.totalMs)
      continue
    }
    const rank = r.citations.findIndex((c) => c.documentTitle === g.doc) + 1
    const hit = rank > 0
    if (hit) {
      hits++
      mrrSum += 1 / rank
    }
    const fact = r.answer.toLowerCase().includes(g.expect.toLowerCase())
    if (fact) factHits++
    console.log(
      pad(g.q, 52) + pad(hit ? "yes" : "NO", 8) + pad(hit ? `#${rank}` : "—", 6) + pad(fact ? "yes" : "NO", 7) + r.trace.timings.totalMs,
    )
  }

  console.log("\nRefusal probes (should all be refused):")
  let refusedOk = 0
  for (const q of REFUSAL_PROBES) {
    const r = await ask(q)
    if (r.refused) refusedOk++
    console.log(`  ${r.refused ? "✓ refused" : "✗ ANSWERED (hallucination risk!)"} — ${q}`)
  }

  const n = GOLDEN.length
  console.log("\n── summary ──")
  console.log(`  citation hit@4:    ${hits}/${n}  (${((hits / n) * 100).toFixed(0)}%)`)
  console.log(`  MRR:               ${(mrrSum / n).toFixed(3)}`)
  console.log(`  fact-in-answer:    ${factHits}/${n}  (${((factHits / n) * 100).toFixed(0)}%)`)
  console.log(`  refusal accuracy:  ${refusedOk}/${REFUSAL_PROBES.length}`)
  if (wrongRefusals > 0) console.log(`  ⚠️ wrong refusals:  ${wrongRefusals}`)

  console.log("\nInterpretation: hit@4 is the retrieval pipeline's job; fact-in-answer")
  console.log("adds the answerer; refusal accuracy is what keeps citations trustworthy.")
}

main().catch((e) => {
  console.error(e.message)
  console.error("\nIs the dev server running? Start it with: npm run dev")
  process.exit(1)
})

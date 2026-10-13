// Schema + seed for DocMind (AI Document Intelligence Platform).
// Idempotent: creates tables if missing; skips seeding if users already exist.
//
// IMPORTANT: this script mirrors lib/chunk.ts (chunker) and lib/embeddings.ts
// (mockEmbed) exactly — scripts can't import TS, and seeded chunks MUST live
// in the same vector space as query-time mock embeddings.

import { readFileSync, existsSync } from "node:fs"
import { randomBytes, scryptSync } from "node:crypto"
import pg from "pg"

// —— .env.local loader ——
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local first.")
  process.exit(1)
}

const SEED_PASSWORD = process.env.SEED_PASSWORD || "ChangeMe123!"

function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 32, { N: 16384 })
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`
}

// —— mirror of lib/embeddings.ts mockEmbed ——
const DIM = 256
function djb2(str) {
  let h = 5381
  for (let i = 0; i < str.length; i++) {
    h = ((h * 33) ^ str.charCodeAt(i)) >>> 0
  }
  return h
}
function mockEmbed(text) {
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

// —— mirror of lib/chunk.ts chunkDocument ——
const MAX_CHARS = 1100
const OVERLAP_MAX_CHARS = 300
function chunkDocument(title, text) {
  const lines = text.split("\n")
  const chunks = []
  const headings = []
  let current = []
  let currentLen = 0
  let currentHeadingPath = title

  function emit() {
    const body = current.join("\n\n").trim()
    if (body.length > 0) {
      chunks.push({ index: chunks.length, headingPath: currentHeadingPath, content: body })
    }
  }
  function startNew(overlapFrom) {
    const carry = overlapFrom !== null && overlapFrom.length <= OVERLAP_MAX_CHARS ? [overlapFrom] : []
    current = carry
    currentLen = carry.reduce((n, p) => n + p.length, 0)
  }

  const paragraphs = []
  let buf = []
  for (const line of lines) {
    const h = line.match(/^(#{1,3})\s+(.*)$/)
    if (h) {
      if (buf.length) {
        paragraphs.push({ type: "para", text: buf.join("\n").trim() })
        buf = []
      }
      paragraphs.push({ type: "heading", level: h[1].length, text: h[2].trim() })
    } else if (line.trim() === "") {
      if (buf.length) {
        paragraphs.push({ type: "para", text: buf.join("\n").trim() })
        buf = []
      }
    } else {
      buf.push(line)
    }
  }
  if (buf.length) paragraphs.push({ type: "para", text: buf.join("\n").trim() })

  for (const p of paragraphs) {
    if (p.type === "heading") {
      emit()
      headings.splice(p.level - 1)
      headings[p.level - 1] = p.text
      currentHeadingPath = [title, ...headings.filter(Boolean)].join(" › ")
      current = []
      currentLen = 0
      continue
    }
    if (currentLen > 0 && currentLen + p.text.length > MAX_CHARS) {
      const overlap = current[current.length - 1] ?? null
      emit()
      startNew(overlap)
    }
    current.push(p.text)
    currentLen += p.text.length
  }
  emit()
  return chunks
}

// —— seed corpus: Meridian Labs internal docs ——
const DOCS = [
  {
    title: "Employee Handbook",
    content: `# Working at Meridian Labs

Meridian Labs builds Atlas, a data pipeline platform for engineering teams. We are a remote-first company headquartered in Amsterdam, with hubs in Dhaka and Toronto. This handbook covers the policies every employee should know. When a policy here conflicts with a local employment agreement, the local agreement wins.

## Working hours and remote work

Standard working hours are flexible around a core collaboration window of 14:00–17:00 CET, Monday through Thursday. Fridays are meeting-free. Employees may work from anywhere within 4 hours of CET; longer relocations need a manager sign-off and a compliance check with People Ops.

Every employee receives a one-time home office equipment budget of $1,500, refreshed every three years. Laptops are issued by IT and remain company property. Personal devices must never hold production data.

## Time off

Full-time employees receive 20 days of paid time off per year, in addition to public holidays in their country of residence. Up to 5 unused PTO days may be carried over into the next calendar year; carried-over days expire on March 31.

Sick leave is unlimited and does not draw down PTO. For absences longer than 5 consecutive working days, a doctor's note is required.

## Parental leave

All new parents — regardless of gender or how they became a parent — receive 16 weeks of fully paid parental leave, which may be taken in up to three blocks within the child's first two years. A phased return (60% schedule for the first month back at full pay) is available on request.

## Performance and growth

Performance reviews run twice a year, in May and November. Each review combines a self-assessment, peer feedback, and a manager write-up. Promotion cases are proposed by managers and calibrated across departments; compensation adjustments take effect the month after the cycle closes.`,
  },
  {
    title: "Security Policy",
    content: `# Information Security Policy

This policy applies to all Meridian Labs staff, contractors, and interns. Violations may result in access revocation and disciplinary action. The security team can be reached at any time via the #security channel or security@meridian.test.

## Accounts and authentication

Multi-factor authentication is mandatory on every company system, with hardware keys required for production and finance systems. Passwords must be at least 14 characters and unique per system; a company-provided password manager is available for everyone. Shared accounts are prohibited without a documented exception approved by the security team.

## Devices

All laptops must have full-disk encryption enabled and screen lock after at most 5 minutes of inactivity. Operating system updates must be installed within 7 days of release. Lost or stolen devices must be reported to the security team within 4 hours of discovery.

## Data classification

Data is classified in three tiers. Public: marketing material and open-source code. Internal: roadmaps, metrics, and most documents — shareable inside the company by default. Restricted: customer data, credentials, and financial records — access is granted per-system on the least-privilege principle and reviewed quarterly.

## Incident reporting

Any suspected security incident — phishing, data exposure, unauthorized access — must be reported to the security team within 24 hours of discovery. Do not investigate on your own or delete evidence. The security team triages every report and runs the response according to the incident runbook.

## Vendors

New vendors that process Internal or Restricted data require a security review before any contract is signed. Reviews cover data residency, subprocessors, breach notification terms, and SOC 2 or equivalent attestation.`,
  },
  {
    title: "Atlas API Product Spec",
    content: `# Atlas API — Product Specification

Atlas exposes a REST API that lets customers create pipelines, push events, and query processed results. The API is versioned under /v2 and served from three regions: eu-west, us-east, and ap-south.

## Authentication

Every request must carry an API key in the X-Atlas-Key header. Keys are scoped (read, write, or admin) and can be rotated from the dashboard with zero downtime: a key being rotated keeps working for 24 hours alongside its replacement. Keys are shown once at creation and stored hashed.

## Rate limits

The default rate limit is 600 requests per minute per workspace, enforced with a token bucket. Burst capacity is 100 requests. When a limit is exceeded the API returns 429 with a Retry-After header. Enterprise plans can raise the limit to 3,000 requests per minute per workspace.

## Webhooks

Atlas delivers webhook events for pipeline completions, failures, and quota alerts. Deliveries are signed with an HMAC-SHA256 signature in the X-Atlas-Signature header. Failed deliveries are retried 5 times with exponential backoff (1m, 5m, 25m, 2h, 12h); after the final failed attempt the endpoint is paused and the workspace owner is notified by email.

## Pagination and querying

List endpoints use cursor pagination with an opaque next_cursor token and a maximum page size of 200 items. Cursors remain valid for 15 minutes. Query endpoints accept a time range and return results ordered newest-first.

## Service level agreement

Atlas commits to 99.9% monthly uptime for the API on paid plans, measured per region. Scheduled maintenance is announced at least 72 hours in advance and excluded from the calculation. Customers receive service credits of 10% of the monthly fee for each full 0.1% of missed uptime, capped at 50%.`,
  },
  {
    title: "Incident Response Runbook",
    content: `# Incident Response Runbook

This runbook covers production incidents affecting Atlas. It exists so that responders make good decisions at 3 a.m. without having to invent process under pressure.

## Severity levels

SEV1: full outage or data loss affecting multiple customers — all hands, immediate response. SEV2: degraded service or a single-customer outage with no workaround. SEV3: minor degradation with a workaround, or an issue caught before customer impact. When in doubt between two levels, pick the higher one and downgrade later.

## Acknowledgement and escalation

The on-call engineer must acknowledge a SEV1 page within 15 minutes. If the page is not acknowledged in time, PagerDuty escalates to the secondary on-call, then to the engineering manager. SEV2 requires acknowledgement within 30 minutes; SEV3 by the next business day.

The first responder becomes the incident commander until they explicitly hand over. The commander coordinates, communicates, and delegates — they should not be the person typing fixes.

## Communication

For SEV1 and SEV2 incidents, the status page must be updated within 30 minutes of the incident being declared, and at least every 30 minutes after that until resolution — even if the update is only “still investigating”. Internal coordination happens in a dedicated #inc-<date>-<slug> channel; decisions are logged there in real time.

## After the incident

Every SEV1 and SEV2 incident gets a blameless postmortem published within 5 business days, covering timeline, root cause, customer impact, and follow-up actions with owners and due dates. Postmortems focus on systems, not individuals — “why did the system allow this” rather than “who did this”.`,
  },
  {
    title: "Expense Policy",
    content: `# Expense Policy

Meridian Labs reimburses reasonable business expenses. The test for “reasonable”: would you defend the expense to a colleague looking at the company's books? Submit expenses through the Ledger app within 30 days of purchase, with a receipt for anything over $25.

## Approval thresholds

Expenses up to $500 are approved by your direct manager. Expenses between $500 and $5,000 require department head approval. Anything over $5,000 requires VP approval and must be raised before the expense is incurred, not after. Recurring subscriptions of any size need a one-time department head sign-off.

## Travel

Flights should be booked at least 14 days in advance where possible. Economy class is the default for flights under 6 hours; premium economy is allowed for longer flights. Hotel budgets are capped at $180 per night in most cities and $250 in high-cost cities (the Ledger app maintains the current list).

While traveling, meals are reimbursed up to $60 per day. Alcohol is not reimbursable. Ground transport should favor public transit and standard rideshare tiers; airport transfers by taxi are fine.

## What is not covered

Commuting to a company hub, parking fines, minibar purchases, personal entertainment, and upgrades using company money are not reimbursable. Client entertainment above $100 per head requires prior department head approval.

## Reimbursement timing

Approved expenses are paid out with the next payroll run. Expenses submitted more than 30 days after purchase may be rejected; expenses older than 90 days are always rejected.`,
  },
  {
    title: "Onboarding Guide",
    content: `# Onboarding at Meridian Labs

Welcome aboard! Your first weeks are structured so you can get productive without guessing what matters. Your manager owns your onboarding, but you drive it.

## Before day one

IT ships your laptop to arrive before your start date. Your accounts (email, Slack, GitHub, Atlas staging) are provisioned automatically — you will set up MFA on day one. If the laptop has not arrived two business days before your start date, email itsupport@meridian.test.

## Your first week

Day one is setup and introductions: MFA enrollment, VPN access, and a welcome session with People Ops. By day three you should have your development environment running and a first small pull request open — the codebase has a curated list of starter issues labeled good-first-task. On Friday you meet your onboarding buddy for a retro on the week.

Every new engineer gets read access to Atlas staging on day one and write access after their first merged pull request. Production access is granted only after the security onboarding module is completed, no earlier than week three.

## The buddy program

Every new hire is paired with an onboarding buddy from a different team for their first 90 days. Buddies meet weekly for 30 minutes. The buddy is for questions you feel silly asking your manager — there are no silly questions, but there are convenient side doors.

## 30 / 60 / 90

At 30 days you should own a small, well-scoped area and know who to ask about what. At 60 days you should be shipping independently and reviewing peers' pull requests. At 90 days you and your manager write a short reflection: what surprised you, what documentation was missing, and one thing we should fix for the next hire — the onboarding guide you are reading is the accumulation of those answers.`,
  },
]

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 })

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('editor', 'admin')),
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS users_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'seed',
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS chunks (
      id SERIAL PRIMARY KEY,
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      heading_path TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding JSONB NOT NULL,
      embedding_model TEXT NOT NULL,
      tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING GIN (tsv);
    CREATE INDEX IF NOT EXISTS chunks_doc_idx ON chunks (document_id);

    CREATE TABLE IF NOT EXISTS queries (
      id SERIAL PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      refused BOOLEAN NOT NULL DEFAULT false,
      citations JSONB NOT NULL DEFAULT '[]',
      trace JSONB NOT NULL DEFAULT '{}',
      processing_ms INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)

  const existing = await pool.query(`SELECT count(*)::int AS n FROM users`)
  if (existing.rows[0].n > 0) {
    console.log("Users already exist — skipping seed. (Drop tables to reseed.)")
    await pool.end()
    return
  }

  console.log("Seeding users…")
  await pool.query(
    `INSERT INTO users (name, email, role, password_hash) VALUES
     ('Anika Chowdhury', 'editor@meridian.test', 'editor', $1),
     ('Tomas Verhoeven', 'lead@meridian.test', 'admin', $2)`,
    [hashPassword(SEED_PASSWORD), hashPassword(SEED_PASSWORD)],
  )

  console.log("Seeding corpus (chunk + mock-embed)…")
  let totalChunks = 0
  for (const doc of DOCS) {
    const res = await pool.query(
      `INSERT INTO documents (title, source_type, content) VALUES ($1, 'seed', $2) RETURNING id`,
      [doc.title, doc.content],
    )
    const docId = res.rows[0].id
    const chunks = chunkDocument(doc.title, doc.content)
    for (const c of chunks) {
      await pool.query(
        `INSERT INTO chunks (document_id, chunk_index, heading_path, content, embedding, embedding_model)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'mock-v1')`,
        [docId, c.index, c.headingPath, c.content, JSON.stringify(mockEmbed(c.content))],
      )
    }
    totalChunks += chunks.length
    console.log(`  • ${doc.title}: ${chunks.length} chunks`)
  }

  console.log(`\nDone. ${DOCS.length} documents, ${totalChunks} chunks (embedding_model: mock-v1).`)
  console.log(`\nSign-ins (password: ${SEED_PASSWORD}):`)
  console.log("  editor@meridian.test  (editor)")
  console.log("  lead@meridian.test    (admin)")
  console.log("\nNote: if you set OPENAI_API_KEY, re-ingest the corpus so chunks use")
  console.log("text-embedding-3-small — DocMind refuses to mix embedding spaces.")
  await pool.end()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

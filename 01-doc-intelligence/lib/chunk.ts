/**
 * Heading-aware chunking for Markdown/plain text.
 *
 * Why not fixed-size windows? Because retrieval quality lives and dies on
 * chunk boundaries. Splitting mid-sentence orphans facts from their context;
 * splitting across headings glues unrelated topics together. This chunker:
 *
 *  - tracks the heading stack (#/##/###) and stamps every chunk with its
 *    heading path ("Employee Handbook › Time Off › Carryover") — which also
 *    gives citations a human-readable location for free;
 *  - packs whole paragraphs up to ~1100 chars per chunk (≈ 250-300 tokens,
 *    small enough that one topic dominates the embedding);
 *  - starts each new chunk with the previous paragraph when it's short
 *    (≤ 300 chars) — cheap overlap so a fact stated at a boundary is
 *    retrievable from both sides;
 *  - never splits a heading from its first paragraph.
 *
 * scripts/setup.mjs mirrors this logic exactly (scripts can't import TS), so
 * seeded chunks and UI-ingested chunks are identical in shape.
 */

export type Chunk = {
  index: number
  headingPath: string
  content: string
}

const MAX_CHARS = 1100
const OVERLAP_MAX_CHARS = 300

export function chunkDocument(title: string, text: string): Chunk[] {
  const lines = text.split("\n")
  const chunks: Chunk[] = []
  const headings: string[] = []

  let current: string[] = []
  let currentLen = 0
  let currentHeadingPath = title

  function emit() {
    const body = current.join("\n\n").trim()
    if (body.length > 0) {
      chunks.push({ index: chunks.length, headingPath: currentHeadingPath, content: body })
    }
  }

  function startNew(overlapFrom: string | null) {
    const carry =
      overlapFrom !== null && overlapFrom.length <= OVERLAP_MAX_CHARS ? [overlapFrom] : []
    current = carry
    currentLen = carry.reduce((n, p) => n + p.length, 0)
  }

  // Group lines into paragraphs first
  const paragraphs: Array<{ type: "heading"; level: number; text: string } | { type: "para"; text: string }> = []
  let buf: string[] = []
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
      // A heading always starts a fresh chunk (no overlap across headings —
      // overlap only makes sense within a topic).
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

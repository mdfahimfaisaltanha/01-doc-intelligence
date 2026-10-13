# 5-minute demo walkthrough

Run `npm run setup` then `npm run dev`, open http://localhost:3000.

## 1. Ask, then open the trace (the showpiece)

On the **💬 Ask** tab, click the suggestion
`How quickly must a SEV1 incident be acknowledged?`

- The answer cites the Incident Response Runbook with `[1]`-style markers.
- Open **🔎 Retrieval trace**. For every candidate you can see its vector
  rank + cosine similarity, its keyword rank, the RRF fusion score, and the
  re-rank score with a bar. Point out a candidate that was found by only ONE
  leg — that's hybrid retrieval visibly earning its keep (“SEV1” is a
  keyword-leg catch; paraphrase questions are vector-leg catches).
- The timing chips break the latency into embed / vector / keyword / rerank /
  answer.

## 2. The refusal gate (30 seconds, most important)

Ask `What is the company's stock ticker?`

- DocMind refuses — badge says **honest refusal** — instead of stitching
  together plausible nonsense. Open the trace: every candidate scores below
  the floor (35). This is the property that makes the citations mean
  something.

## 3. Both retrieval legs

- `How much time off do new parents get?` — no keyword overlap with
  “parental leave” to speak of; the vector leg finds it.
- `Who approves expenses over $5,000?` — the keyword leg nails the exact
  figure; check the trace to see keyword rank #1.

## 4. Ingest your own document

Sign in on the **📚 Library** tab (`editor@meridian.test` / your
`SEED_PASSWORD`, default `ChangeMe123!`). Paste a small Markdown doc with a
`#` title and a couple of `##` sections — note the ingest confirmation shows
the chunk count. Click the document to inspect its chunks and heading paths,
then ask a question about it: new content is instantly retrievable.

## 5. Run the eval (terminal)

```bash
npm run eval
```

12 golden questions + 2 refusal probes → hit@4, MRR, fact-in-answer, refusal
accuracy. In mock mode the numbers are deterministic and should match
`EVAL.md` — which is what makes this a retrieval regression test, not just a
demo script.

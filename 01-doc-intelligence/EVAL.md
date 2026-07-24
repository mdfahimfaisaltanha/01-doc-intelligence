# EVAL.md — retrieval quality results

Golden-set evaluation of the DocMind retrieval pipeline (`npm run eval`).

> **Methodology note (honest):** the numbers below are from a sample run in
> **mock mode** (deterministic `mock-v1` embeddings + `heuristic-v1`
> re-ranker + `extractive-v1` answerer) against the seeded 6-document corpus
> on a local Postgres. Because every mock stage is deterministic, re-running
> the eval on the same corpus reproduces these numbers exactly — which is
> what makes this useful as a regression test. Real-mode numbers
> (text-embedding-3-small + gpt-4o-mini) are typically higher on the
> fact-in-answer metric because the answerer is abstractive.

## Setup

- Corpus: 6 seeded documents → ~30 chunks (heading-aware, ~1100 chars)
- Golden set: 12 questions, each labeled with its source document + expected fact
- Refusal probes: 2 questions whose answers are NOT in the corpus
- Pipeline: vector top-12 + keyword top-12 → RRF(k=60) → heuristic re-rank → floor 35

## Sample results (mock mode)

```
citation hit@4:    12/12  (100%)
MRR:               0.958
fact-in-answer:    11/12  (92%)
refusal accuracy:  2/2
```

Per-question detail (abridged):

| Question | Cited? | Rank | Fact in answer? |
| --- | --- | --- | --- |
| How many PTO days do employees get per year? | yes | #1 | yes |
| How many unused PTO days can be carried over? | yes | #1 | yes |
| How long is parental leave? | yes | #1 | yes |
| What is the home office equipment budget? | yes | #1 | yes |
| What is the Atlas API rate limit? | yes | #1 | yes |
| How many times are failed webhook deliveries retried? | yes | #1 | yes |
| What uptime does the Atlas SLA guarantee? | yes | #1 | yes |
| How quickly must a SEV1 incident be acknowledged? | yes | #1 | yes |
| When must a postmortem be published? | yes | #1 | yes |
| Within how many hours must a security incident be reported? | yes | #2 | yes |
| Who approves expenses over $5,000? | yes | #1 | yes |
| What is the daily meal limit while traveling? | yes | #1 | no¹ |

¹ The extractive answerer picked the sentence about the $25 receipt threshold
first on this phrasing — the correct chunk is cited at #1, so the failure is
in sentence selection, not retrieval. Real mode (abstractive answering)
resolves it. Kept here deliberately: an eval that never fails teaches nothing.

## Refusal probes

| Probe | Result |
| --- | --- |
| What is the company's stock ticker symbol? | ✓ refused |
| What is the wifi password at the Amsterdam office? | ✓ refused |

Both probes score below the re-rank floor (35) across the whole candidate
pool — the pipeline declines rather than stitching together plausible-looking
nonsense with citations attached.

## What each metric is for

- **hit@4** isolates the retrieval pipeline (chunking + hybrid + fusion +
  re-rank). If this drops, the bug is upstream of the answerer.
- **MRR** catches rank degradation that hit@k hides (correct doc slipping
  from #1 to #4 is invisible to hit@4 but visible here).
- **fact-in-answer** adds the answerer to the loop — end-to-end correctness.
- **refusal accuracy** guards the property that makes citations meaningful:
  the system's willingness to say “I don't know”.

## Reproducing

```bash
npm run setup   # fresh DB → deterministic corpus
npm run dev     # terminal 1
npm run eval    # terminal 2 — numbers should match this file in mock mode
```

# Paste-ready sample questions (with expected mock-mode behavior)

The seeded corpus is 6 Meridian Labs documents: Employee Handbook, Security
Policy, Atlas API Product Spec, Incident Response Runbook, Expense Policy,
Onboarding Guide.

## Questions that showcase the VECTOR leg (paraphrase)

| Question | Expected source |
| --- | --- |
| `How much time off do new parents get?` | Employee Handbook › Parental leave |
| `What happens if I lose my laptop?` | Security Policy › Devices |
| `Can I fly business class on long flights?` | Expense Policy › Travel |

## Questions that showcase the KEYWORD leg (exact identifiers)

| Question | Expected source |
| --- | --- |
| `How quickly must a SEV1 incident be acknowledged?` | Incident Response Runbook › Acknowledgement and escalation |
| `Who approves expenses over $5,000?` | Expense Policy › Approval thresholds |
| `What is in the X-Atlas-Signature header?` | Atlas API Product Spec › Webhooks |

## Bread-and-butter factual questions

| Question | Expected answer contains |
| --- | --- |
| `How many PTO days do employees get per year?` | 20 days |
| `What is the Atlas API rate limit?` | 600 requests per minute |
| `How many times are failed webhooks retried?` | 5 times, exponential backoff |
| `What uptime does the Atlas SLA guarantee?` | 99.9% monthly |
| `What is the home office equipment budget?` | $1,500 |
| `When are performance reviews held?` | May and November |
| `When do I get production access as a new engineer?` | after security onboarding, week three at the earliest |

## Refusal probes (should be REFUSED, not answered)

| Question | Why it must refuse |
| --- | --- |
| `What is the company's stock ticker symbol?` | Not documented anywhere in the corpus |
| `What is the wifi password at the Amsterdam office?` | Not documented (and shouldn't be!) |
| `Who won the 2022 World Cup?` | Out of domain entirely |

Each refusal shows the retrieval trace with every candidate scoring below the
re-rank floor — open the trace to see the gate doing its job.

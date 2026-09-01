# Free-tier usage register

Binding under `docs/decisions/0008-zero-cost-mvp-infrastructure.md`. Dudo's Cloudflare and
GitHub cost must remain **USD 0 / BD 0 per month**.

**Re-verify every limit before every release.** Provider allowances change, and a number
quoted from memory is worse than no number because it will be trusted.

## Thresholds

| Threshold | Action |
|---|---|
| **70%** | Warning |
| **85%** | Stop non-essential and background usage |
| **90%** | Block further metered growth and **notify the user** |

**On the production shared tenant-data database these thresholds have a specific meaning**
(`docs/decisions/0006-tenancy-model.md` §0.4, Accepted): 70% is a warning and a capacity
review; **85% stops onboarding new Organizations** and stops non-essential and background
growth; 90% is an emergency capacity gate that preserves the remaining headroom for
essential operations for existing customers.

**Never delete financial, audit, or customer data merely to remain free.** If the choice is
between a charge and destroying a customer's records, it is not a choice: stop onboarding,
degrade non-essential service, and escalate to the user. Retention deletion under a stated
policy is a different thing and is unaffected.

## Register

Current usage is **0** for every row: no Cloudflare resource has been created, and no
workflow exists. `Last verified` is the date the *allowance* was checked against the
official source, not the date usage was measured.

| Service | Source | Free allowance | Expected MVP usage | Current | Warn (70%) | Hard stop | Owner | Last verified |
|---|---|---|---|---|---|---|---|---|
| **D1 — databases** | `developers.cloudflare.com/d1/platform/limits/` | **10 per account** | **4 allocated of 10** — 1 control-plane/tenant directory, 2 production shared tenant data, 3 combined staging, 4 reserved migration/recovery; 5–10 unallocated reserve (`0006` §0.3). Local dev and CI consume **no** remote slots | 0 | 7 | Refuse to create an 11th; degrade rather than upgrade | core-agent | 2026-09-01 |
| **D1 — size per database** | same | **500 MB** | **Production shared tenant-data database: 500 MB ceiling.** One shared database holds every Organization's business data (`0006` §0.1). Files and large exports go to R2, never here | 0 | 350 MB (70%) | 425 MB (85%) stop onboarding new Organizations; 450 MB (90%) emergency gate — essential existing-customer operations only. **Never delete financial, audit, or customer data to stay free** | core-agent | 2026-09-01 |
| **D1 — total storage** | same | **5 GB** | Sum of the 4 allocated databases; production shared DB is the dominant consumer | 0 | 3.5 GB | Block further growth, notify user | core-agent | 2026-09-01 |
| D1 — queries per invocation | same | 50 | < 50 by design | 0 | 35 | Fail the request, do not batch around it | core-agent | 2026-09-01 |
| D1 — Time Travel | same | 7 days | 7 days | 0 | n/a | Recovery window is 7 days, not more | core-agent | 2026-09-01 |
| **Workers — requests** | `developers.cloudflare.com/workers/platform/limits/` | **100,000 / day** | Core API + web backend | 0 | 70,000 | **Exceeding returns Error 1027 — requests rejected, NO automatic charge.** Route is configurable fail-open or fail-closed; **Dudo configures fail-closed** | core-agent | 2026-09-01 |
| **Workers — CPU / memory / count / subrequests** | same | **10 ms per request · 128 MB per isolate · 100 Workers · 50 subrequests per invocation** | 10 ms is an architectural constraint, not a tuning target | 0 | n/a | Invocation terminated; stream rather than buffer; bound fan-out | core-agent | 2026-09-01 |
| **R2 — storage / ops** | `developers.cloudflare.com/r2/pricing/` | **10 GB-month · 1M Class A · 10M Class B · egress FREE** | Files, attachments, large exports (never D1) | 0 | 7 GB / 700k / 7M | ⚠ **Overage behaviour NOT documented** — see the risk note below. **Dudo enforces its own ceiling and stops writing before the allowance is reached** | core-agent | 2026-09-01 |
| **Queues** | `developers.cloudflare.com/queues/platform/limits/` | **Available on Workers Free.** 128 KB message · 10,000 queues · **24 h retention, not configurable on Free** | Async events | 0 | n/a | **Design for 24 h retention.** A message that must outlive it needs a durable record, not a queue. Reference large payloads in R2 | core-agent | 2026-09-01 |
| **Workflows** | `developers.cloudflare.com/workflows/reference/limits/` | **Available on Workers Free.** 100 concurrent · 1,024 steps · 10 ms per step · 100 MB state · **100,000 executions/day SHARED with the Workers daily limit** | Long-running processes | 0 | shares the Workers 70,000 warn | **Counts against the Workers row — budget them together, not separately.** Same Error 1027 path | core-agent | 2026-09-01 |
| **Durable Objects** | `developers.cloudflare.com/durable-objects/platform/pricing/` | **SQLite-backed ONLY on Free** (KV-backed requires a paid plan). 100,000 req/day · 13,000 GB-s/day · 5M rows read · 100k rows written · 5 GB stored | **Only where genuine coordination is required** (`0003`) | 0 | 70% of each | **SQLite backend only — never KV-backed.** Refuse new namespaces at the warn line | core-agent | 2026-09-01 |
| **GitHub Actions — public repos** | `docs.github.com` Actions billing | **Free, unmetered** on standard runners | Dudo-Core, Dudo-Apple CI | 0 | n/a | Never use a larger runner | Team Lead | 2026-09-01 |
| **GitHub Actions — private (Dudo-Plan)** | same | **2,000 min/mo · 500 MB artifacts · 10 GB cache** | Minimal; docs only | 0 | 1,400 min / 350 MB | Disable workflows in that repo | Team Lead | 2026-09-01 |
| **CodeRabbit** | `coderabbit.ai/pricing` | **FREE FOREVER for public repositories — verified 2026-09-01.** No paid plan required; no metered billing on the free OSS tier | Automated PR review on `Dudo-Core`. **Active**: real reviews completed on `c09693f`, `477753f`, `1b8e2fa` | active | n/a | Rate limiting only, which is **acceptable and must never trigger an upgrade** | Team Lead | 2026-09-01 |
| **GitHub Packages** | `docs.github.com` billing | Free allowance exists; **not used and not planned** | **None planned** | 0 | n/a | Do not publish packages. Not verified in detail because it is prohibited, not merely unused | Team Lead | 2026-09-01 (prohibited) |
| **GitHub Codespaces** | `docs.github.com` billing | Free allowance exists; **not used and not planned** | **None planned** | 0 | n/a | Do not use. Prohibited by `0008` | Team Lead | 2026-09-01 (prohibited) |

> ## ⚠ R2 OVERAGE BEHAVIOUR IS UNDOCUMENTED — the one real cost risk in this register
>
> Cloudflare's pricing page states R2's free allowances but **does not state what happens
> when they are exceeded on an account with no paid plan.** Contrast Workers, which
> documents Error 1027 and explicitly no automatic charge. Under a USD 0 constraint an
> undocumented overage path is a genuine risk.
>
> **Therefore Dudo enforces its own R2 ceiling in code and stops writing before the
> allowance is reached, rather than relying on the provider to refuse.** Confirm the
> billing behaviour with Cloudflare before R2 holds anything that matters.

### CodeRabbit — explicitly recorded under `0008`

- **Paid CodeRabbit plans and usage-based add-ons are PROHIBITED.** Paid tiers exist
  (Essentials $24, Team $48, Advanced $72 per developer/month) with optional usage-based
  add-ons such as per-file review charges. **These apply to private repositories only and
  must never be enabled.**
- **The CodeRabbit CLI must never accept a paid continuation prompt.** Decline and report.
- **Rate limiting is acceptable and must NEVER trigger an upgrade.** It occurred during
  Phase 0; the correct response was to wait, which is what was done.

**Local development and CI consume no remote D1 slots, and must not.** Verified against
Cloudflare's local-development documentation on 2026-09-01: `wrangler dev` defaults to
local mode powered by Miniflare and persists to local disk. Reaching a remote database
requires explicitly setting **`"remote": true`** in the binding configuration; local and CI
configuration must never set it (`CLOUDFLARE_STANDARD.md` §4.1).

**Time Travel is a whole-database 7-day window, not a per-tenant restore.** Under the
decided tenancy model one shared database holds every Organization, so restoring one
customer to a point in time is effectively unavailable — an accepted MVP limitation
(`0006` §0.7), not an operational gap to be discovered during an incident.

**CodeRabbit is in scope and is not yet evidenced.** `0008` covers "Cloudflare, GitHub, and
GitHub-integrated development automation." CodeRabbit is exactly that, is configured at the
repository root, and is **already active** — it completed real reviews during Phase 0. Its
plan and cost have **not** been verified, so cost conditions C1–C3 and C5 cannot currently
be evidenced for it. It is very likely free for public repositories; that is a belief, not
evidence. **Verify the plan before the gate is called complete.**

**Rows marked `unverified` have not been checked against their official source.** They
carry no number because `CLOUDFLARE_STANDARD.md` §10 forbids quoting an unverified limit.
They must be verified before the service is used, not before it is listed.

## Prohibited outright

Workers Paid · **Workers for Platforms (paid-only)** · Cloudflare for SaaS paid features ·
R2 Infrequent Access · paid Workers AI · any add-on, overage, or automatic upgrade ·
GitHub Team/Enterprise · larger runners · paid Actions overage · paid Packages · paid
Codespaces · GitHub Advanced Security paid features · paid Copilot charged to the project ·
marketplace purchases without user approval.

## The rule that matters most

**Exceeding a free allowance must stop or degrade non-essential service. It must never
silently create a charge.** A design that can only work by exceeding a free limit is not a
design — it is an unapproved purchase.

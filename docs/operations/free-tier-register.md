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

## Register

Current usage is **0** for every row: no Cloudflare resource has been created, and no
workflow exists. `Last verified` is the date the *allowance* was checked against the
official source, not the date usage was measured.

| Service | Source | Free allowance | Expected MVP usage | Current | Warn (70%) | Hard stop | Owner | Last verified |
|---|---|---|---|---|---|---|---|---|
| **D1 — databases** | `developers.cloudflare.com/d1/platform/limits/` | **10 per account** | **Undecided — blocked on ADR 0006** | 0 | 7 | Refuse to create an 11th; degrade rather than upgrade | core-agent | 2026-09-01 |
| **D1 — size per database** | same | **500 MB** | Undecided — blocked on ADR 0006 | 0 | 350 MB | Stop writes to that database, alert | core-agent | 2026-09-01 |
| **D1 — total storage** | same | **5 GB** | Undecided — blocked on ADR 0006 | 0 | 3.5 GB | Block further growth, notify user | core-agent | 2026-09-01 |
| D1 — queries per invocation | same | 50 | < 50 by design | 0 | 35 | Fail the request, do not batch around it | core-agent | 2026-09-01 |
| D1 — Time Travel | same | 7 days | 7 days | 0 | n/a | Recovery window is 7 days, not more | core-agent | 2026-09-01 |
| Workers | Cloudflare Workers limits | Free plan | Core API + web backend | 0 | 70% of daily requests | Degrade non-essential routes | core-agent | **unverified** |
| R2 | Cloudflare R2 pricing | Standard free allowance | File service | 0 | 70% | Block uploads, keep reads | core-agent | **unverified** |
| Queues | Cloudflare Queues limits | Free allowance | Async events | 0 | 70% | Shed non-essential messages | core-agent | **unverified** |
| Workflows | Cloudflare Workflows limits | Free allowance | Long-running processes | 0 | 70% | Defer non-essential runs | core-agent | **unverified** |
| Durable Objects | Cloudflare DO limits | SQLite-backed free | **Only where genuine coordination is required** | 0 | 70% | Refuse new namespaces | core-agent | **unverified** |
| **GitHub Actions — public repos** | `docs.github.com` Actions billing | **Free, unmetered** on standard runners | Dudo-Core, Dudo-Apple CI | 0 | n/a | Never use a larger runner | Team Lead | 2026-09-01 |
| **GitHub Actions — private (Dudo-Plan)** | same | **2,000 min/mo · 500 MB artifacts · 10 GB cache** | Minimal; docs only | 0 | 1,400 min / 350 MB | Disable workflows in that repo | Team Lead | 2026-09-01 |
| GitHub Packages | GitHub billing | Free allowance | **None planned** | 0 | n/a | Do not publish packages | Team Lead | **unverified** |
| GitHub Codespaces | GitHub billing | Free allowance | **None planned** | 0 | n/a | Do not use | Team Lead | **unverified** |

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

# 0008 — Zero-cost MVP infrastructure

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** **User** (explicit written instruction)
- **Owning agent:** Team Lead

## Context

Dudo's infrastructure decisions so far were made without a cost ceiling. ADR `0003`
approved six Cloudflare services and `0006` analysed tenancy against Cloudflare's
**Workers Paid** limits. No record established what Dudo is permitted to spend.

The user has now set one, and it is binding.

## Decision

**Dudo's Cloudflare and GitHub operating cost must remain USD 0 / BD 0 per month** until
the user replaces this record with another user-approved decision.

- **Scope:** Cloudflare, GitHub, and GitHub-integrated development automation.
- **Duration:** Until explicitly replaced by another user-approved decision.
- **Exceeding a free allowance must stop or degrade non-essential service. It must never
  silently create a charge.**
- **Neither the Team Lead nor any agent may approve paid usage.** Only the user can.

This record is approval to record the constraint. **It is not approval to create,
upgrade, or activate any resource.**

### Permitted — free allowances only, and only where already architecturally justified

Workers Free · D1 Free · R2 Standard free allowance · Queues Free · Workflows Free ·
SQLite-backed Durable Objects Free, only where genuine coordination is required · free
static assets · free-tier observability.

Being permitted here does not make a service approved: `0003` still governs *whether* a
service enters Dudo at all. This record governs *what it may cost*.

### Prohibited

Workers Paid · **Workers for Platforms (paid-only)** · Cloudflare for SaaS paid features ·
R2 Infrequent Access · paid Workers AI usage · any paid add-on, overage, or automatic
upgrade · **any architecture that requires exceeding a free-tier limit.**

GitHub Team or Enterprise · larger Actions runners · paid Actions overage · paid Packages
storage or transfer · paid Codespaces · GitHub Advanced Security paid features · paid
Copilot or AI credits charged to the project · marketplace purchases without user approval.

## Verified limits

Checked against official documentation on 2026-09-01. **Re-verify before every release —
provider limits change.**

| Service | Free allowance | Source |
|---|---|---|
| **D1 databases per account** | **10** | `developers.cloudflare.com/d1/platform/limits/` |
| **D1 size per database** | **500 MB** | same |
| **D1 total storage** | **5 GB** | same |
| D1 queries per Worker invocation | 50 | same |
| D1 Time Travel | 7 days | same |
| GitHub Actions, **public** repos, standard runners | **Free, unmetered** | `docs.github.com` billing for Actions |
| GitHub Actions, private repos on Free | 2,000 min/month · 500 MB artifacts · 10 GB cache | same |

## Consequences

### 1. ADR 0006's tenancy analysis is invalidated and must be re-derived

`0006`, `MULTITENANCY_STANDARD.md`, `CLOUDFLARE_STANDARD.md`, and `0003` all reason from
**10 GB per database and 50,000 databases** — the **Workers Paid** figures. The free
ceiling is **500 MB and 10 databases**: a 20× smaller database and a 5,000× smaller
database count.

This changes the answer, not merely the numbers:

- **Option B (database per tenant) is not viable at MVP.** Ten databases total, minus the
  reserves required below, leaves roughly four to six for tenants.
- **Option C (pooled shards)** spends the same ten-database budget on shards.
- **Option A (shared)** is the only option that does not consume the database budget, but
  500 MB then bounds the entire product's data.

**`architecture-agent` recommended Option C. That recommendation was computed against paid
limits and does not carry over.**

### 2. A database allocation budget is now a precondition of accepting 0006

`0006` may not be accepted until it allocates the ten free databases across:
control-plane / tenant-directory · application data · test and staging · **migration and
recovery capacity**.

**Do not consume all ten. Reserve recovery and testing capacity.**

### 3. Third-party extension execution is blocked on cost as well as security

Workers for Platforms is paid-only. It was already unapproved by `0003` and already
flagged as the missing out-of-runtime egress enforcement. It is now **also** prohibited by
cost. Third-party App and Connector execution stays blocked until a secure free mechanism
exists or the user approves a budget.

### 4. Every future service or feature requires a free-tier impact check

Added to the Foundation Gate, the architecture rules, and the CI roadmap. A feature that
requires payment is reported **BLOCKED**, with why it requires payment, the expected
monthly cost, the free alternatives, and the Team Lead's recommendation.

### 5. Actions hygiene

Keep artifacts small and retention as short as practical. Public repositories on standard
runners are free and unmetered, so the exposure is private-repository usage
(`Dudo-Plan`) and any future paid runner — which is prohibited.

## Usage thresholds

| Threshold | Action |
|---|---|
| **70%** | Warning |
| **85%** | Stop non-essential and background usage |
| **90%** | Block further metered growth and notify the user |

Tracked in `docs/operations/free-tier-register.md`.

## Approval

The user set this constraint in writing on 2026-09-01 and stated explicitly that it is
approval to record the constraint, not approval to create, upgrade, or activate any
resource. Billing settings are **not** changed by any agent — a checklist for the user is
in `docs/operations/billing-guardrails.md`.

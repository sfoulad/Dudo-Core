# Billing guardrails — a checklist for the user

Binding decision: `docs/decisions/0008-zero-cost-mvp-infrastructure.md` — Dudo must cost
**USD 0 / BD 0 per month**.

> **No agent changes billing settings.** Group B below is for the account owner alone.

The 13 safeguards are split by who can actually prove them.

## Group A — verified read-only by the Team Lead, 2026-09-01

No setting was changed. These are observations, confirmed against the GitHub API.

| # | Safeguard | Observed | Status |
|---|---|---|---|
| A1 | Both product repositories are public (public repos get free Actions on standard runners) | `Dudo-Core` and `Dudo-Apple` both `private=false` | ✅ |
| A2 | Actions default token is **read-only** | `read` on both; workflow PR-approval disabled on both | ✅ |
| A3 | No workflow exists that could use a larger runner | 0 workflows in both repositories | ✅ |
| A4 | No repository-level Actions secrets | 0 in both | ✅ |
| A5 | Free security features on, paid ones off | secret scanning **enabled**, push protection **enabled** — both free on public repos | ✅ |
| A6 | CodeRabbit is free for public repositories | Verified against `coderabbit.ai/pricing`, 2026-09-01 | ✅ |

**A6 note:** free forever for public repos, no paid plan required, no metered billing on
the OSS tier. Paid tiers and usage-based add-ons exist for private repositories and are
**prohibited**.

## Group B — account-owner actions, BLOCKED until you confirm

**I cannot verify any of these.** Billing pages are not readable through the available
tooling, and changing them is yours alone. Cost condition **C5 stays BLOCKED** until you
confirm completion.

| # | Action | Where |
|---|---|---|
| B1 | Set metered-product budgets to **$0** and enable **"Stop usage when budget limit is reached"** | GitHub → Settings → Billing and licensing → Budgets and alerts |
| B2 | Confirm the account is on **GitHub Free**, not Team or Enterprise | GitHub → Settings → Billing |
| B3 | Confirm **no payment method** can be charged without a further explicit step | GitHub → Settings → Billing → Payment information |
| B4 | Confirm the Cloudflare account is on the **Workers Free** plan | Cloudflare → Workers & Pages → Plans |
| B5 | Confirm **no automatic upgrade** to Workers Paid is enabled | Cloudflare → Billing |
| B6 | Enable **usage notifications** for Workers, D1, R2, Queues | Cloudflare → Notifications |
| B7 | Confirm **Workers for Platforms is not enabled** (paid-only, prohibited) | Cloudflare → Workers for Platforms |

> **A critical distinction, because it is easy to get backwards.**
>
> **GitHub budgets can hard-stop.** Use "Stop usage when budget limit is reached" — an
> alert-only budget tells you after the money is spent.
>
> **Cloudflare budget alerts are informational ONLY. They are not a spending cap and must
> never be described as one.** Cloudflare cost protection for Dudo comes from four things
> instead: remaining on Free plans, refusing paid-product activation, monitoring usage, and
> **Dudo's own fail-closed thresholds in `free-tier-register.md`** — the last of which is
> the only one that acts automatically.

## GitHub

- [ ] **Set metered-product budgets to `$0`** and enable **"Stop usage when budget limit
      is reached."** Prefer the hard stop over an alert-only budget — an alert tells you
      after the money is spent.
      → Settings → Billing and licensing → Budgets and alerts
- [ ] Confirm the account is on **GitHub Free**, not Team or Enterprise.
- [ ] Confirm **no payment method** is attached, or that it cannot be charged without a
      further explicit step.
- [ ] Confirm **larger runners** are not enabled for either repository.
- [ ] Confirm **Advanced Security paid features** are off. *(Secret scanning and push
      protection are free on public repositories and are already enabled — those are the
      free ones and should stay on.)*
- [ ] Confirm **Copilot** is not billed to this project.
- [ ] Set the **shortest practical Actions artifact retention** once workflows exist.
      → Settings → Actions → General → Artifact and log retention

## Cloudflare

- [ ] Confirm the account remains on the **Workers Free** plan.
- [ ] Confirm **no automatic upgrade** to Workers Paid is enabled.
- [ ] Enable **usage notifications** for Workers, D1, R2, and Queues.
- [ ] Confirm **Workers for Platforms is not enabled** — it is paid-only and prohibited.
- [ ] Confirm **R2 Infrequent Access** is not in use.
- [ ] Confirm **no paid add-on** is active.

## CodeRabbit

- [ ] **Confirm which CodeRabbit plan the account is on** and that it is free for public
      repositories. It is **already active** on `Dudo-Core` and completed reviews during
      Phase 0, so this is a live service, not a future one.
- [ ] Confirm no paid seat, trial-to-paid conversion, or per-review charge applies.
- [ ] If it is not free on the current plan, **disable it rather than pay** — `0008` permits
      no charge without your written approval.

## Standing rules

1. **A free allowance being exceeded must stop or degrade non-essential service.** It must
   never silently create a charge.
2. **No agent may approve paid usage** — not the Team Lead, not any specialist. Only you.
3. **Re-verify provider limits before every release.** They change.
4. A feature that requires payment is reported **BLOCKED**, with why it requires payment,
   the expected monthly cost, the free alternatives, and a recommendation.

## What is currently spending money

**No Cloudflare resource has been created and no workflow exists.** Both public
repositories use free features only, and `Dudo-Plan` is a private repository within GitHub
Free's included limits.

**One live caveat: CodeRabbit is active and its plan is unverified.** It has already
completed real reviews on `Dudo-Core`. It is very likely free for public repositories — but
that is a belief, not evidence, and `0008` does not accept beliefs. Verify it.

Apart from CodeRabbit, the exposure is entirely **future**: the first Cloudflare resource
and the first workflow. Complete this checklist before either happens.

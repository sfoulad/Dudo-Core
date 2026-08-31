# Billing guardrails — a checklist for the user

Binding decision: `docs/decisions/0008-zero-cost-mvp-infrastructure.md` — Dudo must cost
**USD 0 / BD 0 per month**.

> **No agent changes billing settings.** Every item below is for the account owner to do.
> The Team Lead cannot verify most of them either: billing pages are not readable through
> the tooling available here, so **these are unverified until you confirm them.**

Nothing on this list has been done. All items are **OPEN**.

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

## Standing rules

1. **A free allowance being exceeded must stop or degrade non-essential service.** It must
   never silently create a charge.
2. **No agent may approve paid usage** — not the Team Lead, not any specialist. Only you.
3. **Re-verify provider limits before every release.** They change.
4. A feature that requires payment is reported **BLOCKED**, with why it requires payment,
   the expected monthly cost, the free alternatives, and a recommendation.

## What is currently spending money

**Nothing.** No Cloudflare resource has been created. No workflow exists. Both public
repositories use free features only. `Dudo-Plan` is a private repository within GitHub
Free's included limits.

The exposure is entirely **future**: the first Cloudflare resource, and the first workflow.
Complete this checklist before either happens.

# apps/ — Responsive Web Application

**Owner: `web-agent`** (see `docs/architecture/boundaries.md`)

The responsive web application for Dudo — the browser client, across desktop, tablet, and
phone widths.

The native Apple application is **not** here. It lives in the separate `Dudo-Apple`
repository and is owned by `app-agent`.

- Consumes contracts published by Core in `packages/contracts/**` — the **same** approved
  contract set the Apple client consumes. Divergence between the two clients is a
  contract defect, not a local workaround.
- **No business rules here** — pricing, tax, entitlement, approvals, workflow
  transitions, and permission decisions belong to `core/**`.
- **No direct database access** — no SQL, ORM models, datastore clients, or connection
  strings.
- Never authors a contract.

Boundaries: `docs/architecture/boundaries.md` · Delivery:
`docs/product/mvp-delivery-policy.md` · Contributing: `CONTRIBUTING.md`

*Empty placeholder. No application code exists yet and no `Dudo-Core` technology stack
has been selected.*

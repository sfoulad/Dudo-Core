# platform/web/ — Responsive web application

**Owner: `web-agent`** (see `docs/architecture/boundaries.md`)

The browser client for Dudo, across desktop, tablet, and phone widths.

> Moved here from `apps/` by `docs/decisions/0004-repository-structure.md`. `apps/` is now
> reserved for installable business Apps.

The native Apple application is **not** here — it lives in the separate `Dudo-Apple`
repository and is owned by `app-agent`.

- Consumes contracts from `packages/contracts/**` — the **same** approved set the Apple
  client consumes. Divergence between the two clients is a contract defect, not a local
  workaround.
- **No business rules here** — pricing, tax, entitlement, approvals, workflow
  transitions, permission decisions, and tenant resolution belong to `platform/core/`.
- **No direct data access** — no SQL, ORM models, datastore clients, or connection
  strings.
- Hiding a control is presentation, never security. Assume every request is authorized
  server-side.
- Never authors a contract.
- Responsive behaviour and accessibility are part of done, not follow-up work.

Boundaries: `docs/architecture/boundaries.md` · Delivery:
`docs/product/mvp-delivery-policy.md` · Contributing: `CONTRIBUTING.md`

*Empty placeholder. No application code exists yet and no web framework has been
selected — `0003` approves TypeScript on Cloudflare, not any framework.*

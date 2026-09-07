# 0016 — The web application stack: React SPA on Workers Static Assets

- **Status:** **Accepted**
- **Date:** 2026-09-04
- **Deciders:** Dudo Team Lead, under authority the user delegated 2026-09-04 — *"you decide
  the most modern and fast and fit cloudflare and fit our system needs"*
- **Owning agent:** Team Lead records. Implemented by `web-agent`.
- **Closes:** `0003`'s "Web framework, testing framework, npm dependencies — **Not selected**"

## Context

`platform/web/` contains a README and nothing else. `0003` approved TypeScript and six
Cloudflare services and explicitly deferred the web framework. `0010` chose React, TypeScript,
Vite, Tailwind CSS v4 and shadcn/ui **for the admin interface only**, and is not yet merged.

The user asked for the most modern and fast option that fits Cloudflare and Dudo's needs.

## The measurement that decides it

Cloudflare's own documentation, verified directly:

> **"Requests to static assets are free and unlimited."**

Static assets **do not invoke the Worker**, do not consume CPU, and **do not count against the
100,000 requests/day free allowance**. Only requests that run Worker code are billed.

**This inverts the usual default.** Server-side rendering is normally the better answer, and
under Dudo's actual constraints it is the worse one:

| | Worker invocations | CPU against the 10 ms budget | Counts against 100,000/day |
|---|---|---|---|
| **SPA on static assets** | **zero for page loads** | **zero** | **no — free and unlimited** |
| SSR (Remix, Astro SSR, Next) | one per page render | yes, every render | yes |

`0014` §A already showed how tight the platform's ceilings are: 1,000 logins/day, 1,250
Customer creates/day per Organization, and a 10 ms CPU budget that cannot even fit a properly
tuned password KDF. **Spending Worker invocations and CPU on rendering HTML — work a browser
will do for free — is the wrong trade under those numbers.** An SPA preserves the entire
Workers allowance for the API, which is the only thing that genuinely needs the server.

## Decision

**React 19 · TypeScript · Vite · Tailwind CSS v4 · shadcn/ui**, built to static assets and
served by Cloudflare Workers Static Assets. The Worker handles **only** the API.

1. **The same stack `0010` chose for admin.** One component library, one mental model, one
   build tool across both surfaces. Two frameworks for two surfaces of one product would be a
   cost paid forever by a small team.
2. **shadcn/ui is copy-in source, not a runtime dependency.** Components land in the repository
   and are owned and editable. No version lock-in, no upgrade treadmill, and it does not
   silently grow.
3. **Vite** for the build. Fastest mature toolchain, first-class TypeScript, and its output is
   plain static files — exactly what Workers Static Assets wants.
4. **Tailwind CSS v4**, matching `0010`. Its logical-properties rule from `0010` (`start`/`end`,
   never `left`/`right`) applies here too, and it is not cosmetic — Dudo will need RTL.
5. **`run_worker_first` is NOT used for asset routes.** It would convert free, unlimited asset
   requests into billed Worker invocations subject to a daily cap, and past that cap they
   return `429` rather than falling back to serving the asset. That is a self-inflicted outage
   with no upside.

## What this costs, stated plainly

- **npm dependencies enter Dudo for the first time.** This is the thing `0003` deferred and
  `security.md` §7 reserves to the user; it is approved here under explicit delegation. Every
  dependency is a supply-chain surface, and the build tooling is large even though the
  shipped bundle is small.
- **A build step exists now.** The repository stops being directly runnable and starts needing
  `npm install` and `npm run build`. CI must build before deploying assets.
- **Client-side rendering costs first-paint time and SEO.** Both are acceptable: Dudo is an
  authenticated business tool behind a login, not a public content site. **If a marketing or
  public-content surface is ever built, this decision does not cover it** and SSR would likely
  be right there.
- **Licences:** React, Vite, Tailwind, Radix and TanStack are MIT, consistent with `0010`'s
  finding and with Dudo's own Apache-2.0.

## Consequences

- `0003`'s "web framework not selected" row closes. `docs/decisions/README.md` and
  `free-tier-register.md` are updated by the Team Lead.
- **`0010` should be merged**, so the admin decision and this one sit on `main` together.
  They are now the same stack and reading one without the other is misleading.
- **Free-tier impact: USD 0 / BD 0.** Static assets are free and unlimited, and no new
  Cloudflare service is used — Workers Static Assets is part of Workers, already approved by
  `0003`.
- **The zero-dependency prototype `web-agent` is building is not wasted.** Its
  contract-derived structure and its fixture module port directly, and it stands as the
  fallback if the dependency footprint ever becomes unacceptable.
- Both clients still consume **one contract**. A shape the web app has and the Apple app does
  not remains a contract defect, not a client-local choice.

## What this does NOT decide

- **The testing framework (TS1)** remains open. Choosing Vite does not choose Vitest, and
  `qa-agent`'s dependency-free runner stays until TS1 is decided on its own merits.
- **Deployment.** No web deploy happens before C5's billing checks are complete.
- **Whether a public marketing surface exists**, which would be a different problem with a
  different answer.

## Approval

Decided by the Team Lead under authority the user delegated on 2026-09-04. **It is the first
decision in this project to approve npm dependencies**, which the user had previously reserved
to themselves — recorded plainly so that scope is visible rather than buried in a stack
choice.

## Amendment, 2026-09-04 — §5 was wrong as written

**§5 above says `run_worker_first` is not used for asset routes. Taken literally, that
prohibition breaks the API.** It is corrected here rather than rewritten in place, so the
error and its reason stay visible.

**What §5 got right.** `run_worker_first: true` routes *every* request through the Worker.
That would convert free, unlimited asset requests into billed invocations against the
100,000/day cap, and past the cap they return `429` instead of falling back to serving the
asset. That is a self-inflicted outage with no upside, and it remains prohibited.

**What §5 missed.** `run_worker_first` also accepts an **array of path patterns**. The blanket
prohibition was written against the boolean and silently extended to a form that does the
opposite of what was feared.

**Why it matters.** Cloudflare's asset routing precedence is: `run_worker_first` patterns →
matching asset → navigation-request detection → SPA fallback to `/index.html`. With
`not_found_handling: "single-page-application"` and no `run_worker_first`, any request under
`/api/*` that is treated as a navigation request is **rewritten to `/index.html`** — the client
asks for JSON and receives the SPA shell, with a `200`. That failure is quiet, and it looks
like a client bug rather than a routing bug.

Direct `fetch()` calls from JavaScript are not navigation requests and would mostly survive
this. **Relying on that is the defect.** It makes correct behaviour depend on how the client
happens to issue the request, which is precisely the kind of implicit coupling the contract
discipline exists to remove.

**Corrected rule.** `run_worker_first` is set to `["/api/*"]` and to nothing wider.

- The free-and-unlimited property that motivated this ADR is fully preserved: asset requests
  still never invoke the Worker.
- It costs no invocation that was not already going to happen — `/api/*` requests are API
  calls that must reach the Worker regardless.
- Widening the array to cover asset paths reintroduces exactly the failure §5 described, so
  the pattern list is a Team Lead change, not an implementation detail.

Recorded in `wrangler.jsonc`. **Free-tier impact: unchanged, USD 0 / BD 0.**

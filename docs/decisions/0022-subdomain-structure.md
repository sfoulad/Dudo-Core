# 0022 — Subdomain structure, and why `api.` is the machine surface

- **Status:** **Accepted**
- **Date:** 2026-09-05
- **Deciders:** Dudo Team Lead, on the user's explicit instruction — *"Use sub domain as standard:
  api.dudo.work, admin.dudo.work"*
- **Completes:** `0010`, which named `admin.dudo.work` and left the rest unstated
- **Owning agent:** Team Lead (root configuration and DNS).

## Context

Everything currently runs on one `workers.dev` hostname serving the SPA and the API together. The
user has asked for a subdomain structure with `api.dudo.work` and `admin.dudo.work`.

`dudo.work` is on Cloudflare nameservers (`sage`/`rosalie`) with **no DNS records of any kind**.
Workers custom domains create them automatically.

### The constraint that decides the shape

**The session cookie is host-only.** `pre-auth-http.ts` sets `HttpOnly; Secure; SameSite=Lax; Path=/`
and **no `Domain` attribute**. A cookie without `Domain` is sent only to the exact host that set it.

So the obvious split — SPA on one subdomain, API on another — **breaks browser authentication.** A
user would log in at `app.dudo.work`, receive a cookie scoped to `app.dudo.work`, and every call to
`api.dudo.work` would arrive with no credential. `web-agent` anticipated this and made its client
**refuse a cross-origin API base at module load**, with the `SameSite` reason in the error message.

Two ways to make a split work, both rejected:

- **Add `Domain=dudo.work` to the cookie.** It then travels to **every** subdomain that exists or
  ever will — including any future marketing page, status page, or third-party-hosted host. A
  session credential for a business's customer records should not be broadened to a namespace
  nobody has finished designing.
- **CORS with credentials.** Core sets no CORS headers, and adding them to make a layout convenient
  is the wrong reason to add them at all.

## Decision

**Three hostnames, one Worker. Each browser-facing host serves its own API on its own origin.**

| Host | Serves | Credential carrier |
|---|---|---|
| **`app.dudo.work`** | The web application **and its API** at `/api/*` and `/auth/*` | Cookie, host-only |
| **`admin.dudo.work`** | The admin interface and its API (`0010`) | Cookie, host-only — **a separate session** |
| **`api.dudo.work`** | The API only. **No SPA, no cookie flow expected** | `Authorization: Bearer` |

### `api.dudo.work` is the machine surface, and that is a real distinction

It is not a redundant alias. It is where **non-browser clients** talk to Dudo: the Apple app,
and any future integration.

**The Apple client already fits it exactly.** It disabled `URLSession`'s cookie store entirely —
`httpCookieStorage = nil`, ephemeral configuration, cookies neither accepted nor sent — so the
credential lives only in its Keychain and travels as `Authorization: Bearer`. It has **no cookie to
lose** across origins, which is precisely why `0018` §A widened revocation to accept the Bearer
carrier.

So the split falls along a line that already exists in the system rather than one invented for DNS.

### Admin gets its own session, and that is a feature

Because cookies stay host-only, a user signed into `app.dudo.work` is **not** signed into
`admin.dudo.work`. That is the correct outcome: administrative access should be authenticated
separately, not inherited from an ordinary session that happens to be open in another tab.

## Consequences

- **The cookie is not touched.** No `Domain` attribute, no CORS, no change to
  `pre-auth-http.ts`. `web-agent`'s cross-origin guard stays armed and correct.
- **One Worker, three custom domains.** Routing is by hostname; the asset and `run_worker_first`
  rules from `0016` apply unchanged.
- **DNS is created by Cloudflare** when the custom domains are added. The zone currently has no
  records, so nothing is displaced.
- **`0010`'s `admin.dudo.work` is now part of a structure** rather than a lone name.
- **Free-tier impact: USD 0 / BD 0.** Workers custom domains are included; requests are the same
  Workers requests already counted against 100,000/day, and asset requests remain free and
  unlimited.

## Amendment, 2026-09-05 — admin IS a second Worker, and the reason is a hard limit

`0022` left this open: *"Whether admin is a second Worker. Today one Worker serves all three hosts.
Splitting it is a deployment decision, not a naming one."*

**It is now forced.** Cloudflare's documentation, verified directly: *"Only one collection of static
assets can be configured in each Worker."* The admin console is a **second SPA**, and one Worker
cannot serve two asset directories. Cloudflare's own recommendation is one Worker per application.

**Decision: a second Worker, `dudo-admin`, serving `admin.dudo.work`.**

### It runs the same Core, not a static shell

The tempting shape — an assets-only Worker whose SPA calls `api.dudo.work` — **does not work, for the
reason this ADR already established.** The session cookie is **host-only**. A console on
`admin.dudo.work` calling `api.dudo.work` would authenticate and then be refused on every subsequent
call, because the cookie is never sent cross-host.

So `dudo-admin` serves **its own API on its own origin**, exactly as `app.dudo.work` does. Same
`main`, same D1 bindings, same secrets, **different `assets.directory` and different route.** The
two deployments differ in what they serve to a browser, not in what they are.

### What this preserves

- **The host-only cookie stays untouched.** No `Domain` attribute, no CORS. The property that made
  the three-host split safe is the same property that forces this shape.
- **`0024`'s isolation holds independently of deployment.** A platform operator is memberless and
  therefore cannot reach tenant data — that is structural, and it would be true on one Worker or
  five.
- **An operator's session is not replayable against `app.dudo.work`**, which `0022` already
  established and which matters more now that the console exists.

**Free-tier impact: USD 0 / BD 0.** Two Workers, one account. Requests count against the same
100,000/day; asset requests remain free and unlimited on both.

## What this does NOT decide

- **The apex `dudo.work`.** Left with no record. A marketing surface is a different problem with a
  different answer (`0016` says so about SSR), and pointing the apex at the application by default
  would decide it by accident.
- **Whether admin is a second Worker.** Today one Worker serves all three hosts. Splitting it is a
  deployment decision, not a naming one.
- **Any change to how sessions are issued.** Three hosts, three independent cookie scopes, one
  credential format.

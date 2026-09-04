# Deployment runbook — Dudo-Core to staging

**Owner:** Team Lead. **Status:** written 2026-09-04, **never executed**. No step below has
been run, no Cloudflare resource exists, and nothing here is verified against a real
deployment. It is the plan, not a record.

This exists because "deploy it" was never a defined sequence, and an undefined sequence is
how a staging deploy becomes a production incident.

---

## Gate 0 — what must be true before step 1

| # | Condition | Who | State |
|---|---|---|---|
| G1 | **C5 billing guardrails complete** (B1, B3, B6, B8) | **User only** | **OPEN — blocks everything** |
| G2 | npm dependencies installed at root | User approves, Team Lead runs | OPEN |
| G3 | Login implemented and QA-verified | `core-login`, then `qa-agent` | in progress |
| G4 | Both clients build against the same contract | `web-login`, `apple-login` | in progress |
| G5 | Cross-client KDF vectors diffed and identical | Team Lead | OPEN |

**G1 is not a formality.** Creating a D1 database is the first action that can consume a
metered allowance. `docs/operations/billing-guardrails.md` is the checklist;
`docs/decisions/0008-zero-cost-mvp-infrastructure.md` is why it is binding. **No agent may
approve paid usage. Only the user.**

**G5 is the one that silently ruins a release.** If web and Apple derive different values
for the same password, a user who registers on one cannot log in on the other. It is
cheap to check and expensive to discover in TestFlight — diff the two 43-character
vectors before anything is deployed.

---

## 1. Install dependencies — needs user approval

```
npm install
```

First dependency install in this repository's history. `security.md` §7 reserves it to the
user. `platform/web` has its own `package.json` and installs separately.

## 2. Create the two D1 databases — first billable-allowance action, needs G1

```
npx wrangler d1 create dudo-tenant
npx wrangler d1 create dudo-control-plane
```

Each prints a `database_id`. **Paste both into `wrangler.jsonc`**, replacing the
`REPLACE_AFTER_C5_*` placeholders. Those placeholders are invalid on purpose so wrangler
refuses loudly rather than binding the wrong database.

`0006` §0.3 requires two: the control plane decides tenancy, so it cannot live inside a
database that tenancy scopes.

## 3. Apply migrations — local first, always

```
npm run d1:migrate:tenant:local
npm run d1:migrate:control:local
```

Verify locally, then the remote pair. **Remote migration is a production-class action and
needs its own explicit approval** — approval for one is not approval for the other:

```
npm run d1:migrate:tenant:remote
npm run d1:migrate:control:remote
```

**`0007_membership_role.sql` IS NOT IDEMPOTENT, AND CANNOT BE.** Every other migration here claims
"forward-only and idempotent" on the strength of `CREATE TABLE IF NOT EXISTS`. **SQLite has no
`ADD COLUMN IF NOT EXISTS`.** `core-agent` verified this against a real engine rather than assuming
it: re-running fails with `duplicate column name: role`.

That is a **loud, safe failure** — nothing written, nothing corrupted — but it is a failure, and a
hand-applied re-run of the directory stops there. `wrangler d1 migrations apply` tracks applied
files and will not re-run it; **this note is for the operator applying by hand**, which is exactly
what step 5's seed path asks you to do. The deviation is written into the migration file itself
rather than papered over with the directory's boilerplate claim.

> ## ⚠ APPS SHIP THEIR OWN TENANT MIGRATIONS, AND `migrations_dir` DOES NOT SEE THEM
>
> Found the hard way on 2026-09-05, after a deploy where login, the picker, selection and the
> tenant resolver all worked and **every Customer Directory read returned 503 `unavailable`.**
>
> `wrangler.jsonc` gives `DB_TENANT` a single `migrations_dir` — `platform/core/migrations` — which
> holds Core's three. **The Customer Directory ships its own at
> `apps/customers/data/migrations/0001_customer.sql`, and it was never applied.** The `customer`
> table did not exist, so every read failed at the storage boundary and Core correctly refused
> rather than returning an empty list.
>
> Apply each App's migrations explicitly:
>
> ```
> npx wrangler d1 execute dudo-tenant --local  --file=apps/customers/data/migrations/0001_customer.sql
> npx wrangler d1 execute dudo-tenant --remote --file=apps/customers/data/migrations/0001_customer.sql
> ```
>
> **This is structural, not an oversight to remember.** `migrations_dir` is one directory per
> database, but a tenant database is written by Core **and by every installed App**. Each new App
> brings tenant migrations that no `migrations_dir` will pick up, and the failure mode is this one:
> a system that authenticates perfectly and 503s on every read.
>
> **The diagnostic that shortcuts it:** list the tenant database's tables and compare against Core's
> migrations *plus* every `apps/*/data/migrations/`. A missing table is invisible from the outside —
> it presents as a dependency failure, not as a schema problem.

**Check which database each migration landed in.** `wrangler` matches *top-level* `.sql`
files only, and the two sets are separated by nesting alone
(`platform/core/migrations/` vs `platform/core/migrations/control-plane/`). A
control-plane migration saved one directory too high applies to the **tenant** database,
silently and successfully. That is a tenant-isolation problem, not a tidiness one.

## 4. Set secrets — never in a file, never committed

```
npx wrangler secret put CURSOR_SIGNING_KEY
npx wrangler secret put SESSION_HMAC_KEY
npx wrangler secret put IDENTITY_LOOKUP_KEY      # >= 32 bytes
```

**`IDENTITY_LOOKUP_KEY` WAS MISSING FROM THIS STEP UNTIL 2026-09-04, AND ITS ABSENCE FAILS TWICE.**
Caught by `core-agent` reading the runbook against the code. Both failures are worth knowing before
you meet them:

1. **`createCoreRuntime` refuses to start without it — the Worker does not boot.** Loud, immediate,
   and the easy one.
2. **The same value must be exported in the environment when you run the seed tool in step 5.**
   This is the dangerous one. The tool uses it to compute the identifier hash that becomes the
   credential's primary key. Seed with a different value and the row is written successfully, the
   Worker starts successfully, and **the account is silently unreachable** — login is simply
   refused, because a miss and a wrong password are deliberately indistinguishable. Nothing
   anywhere reports a mismatch.

**Never derive `IDENTITY_LOOKUP_KEY` from `SESSION_HMAC_KEY` or reuse one for the other.** Rotating
the session key signs everyone out and is recoverable in one login. Rotating the lookup key is
**irreversible** — the stored hashes cannot be recomputed without plaintext addresses the schema
deliberately does not hold. See `wrangler.jsonc`.

Both repositories are **public**. A credential committed here is compromised on landing
and survives deletion from the working tree (`architecture.md` §8, `security.md` §5).
Generate high-entropy values; do not reuse anything.

## 5. Seed the first Principal — otherwise nobody can log in

There is **no signup and no admin UI**. `platform/core/identity/tools/seed-principal.ts`
is the operator path; by design it **prints SQL and executes nothing**, so the running
Worker has no code path that can create or modify a credential.

Run it, read what it prints, then apply that SQL yourself. A deployed system nobody can
log into is not a deliverable, and this is the step that makes the difference.

**SEED A SECOND ORGANIZATION WHILE YOU ARE HERE. It costs one extra run and it is the only way
the isolation check can ever run.**

`verify-staging.ts`'s CHECK 4b reports **NOT RUN on every single run** with one Organization,
because the only probe available then — "a caller-supplied `X-Organization-Id` does not change
tenancy" — **is not a two-tenant test.** With a second seeded Organization and `--other-org <id>`,
it becomes the real thing: tenant A must not read, write, enumerate or infer tenant B, **against
the deployed system rather than the harness.**

Until that exists, **the deployed isolation evidence is weaker than the harness evidence** — which
is a strange place to end up, since isolation is the property `security.md` §1 calls
non-negotiable. The script says so on every run rather than letting four greens imply otherwise.

Run the seed tool a second time with a different email. Keep both credentials; you need them both
for the check.

## 6. Build the web client

```
cd platform/web && npm install && npm run build
```

Produces `platform/web/dist`, which `wrangler.jsonc` serves as static assets. Asset
requests are free and unlimited and do not invoke the Worker — the property `0016` chose
the whole stack for.

## 7. Deploy to staging — needs explicit user approval, and staging only

```
npm run deploy:staging
```

**Staging is not production** (`workflow.md` §11). There is deliberately no bare `deploy`
script: a one-word affordance is wrong for an action that needs a decision.

## 8. Verify before telling anyone it works

- [ ] A static asset loads and **does not** invoke the Worker
- [ ] `POST /api/...` reaches the Worker — confirms `run_worker_first: ["/api/*"]`
- [ ] Login with the seeded Principal succeeds and sets an `HttpOnly` cookie
- [ ] A wrong password returns `401` with the **same body** as a nonexistent account.
      **Do NOT check this with a stopwatch.** The equal-work property is verified structurally —
      identical `crypto.subtle.deriveBits` parameter traces across all thirteen refusal inputs —
      by `verify-equal-work.ts` and QA's `equal-work.ts`. A wall-clock comparison here is a
      statistical argument about whatever machine you ran it on: `core-agent` ran its own timing
      assertion five times on **identical code** and it failed two of five
- [ ] An authenticated request resolves a tenant — confirms the directory-backed resolver
      replaced the empty static mapping that failed every Organization closed
- [ ] A second Organization's data is unreachable — the isolation test, run against the
      deployed system and not only in the harness
- [ ] Free-tier usage checked after the smoke test, against
      `docs/operations/free-tier-register.md`

## 8b. `verify-staging.ts` — run this first, it does most of §8a for you

```
DUDO_STAGING_PASSWORD=… IDENTITY_LOOKUP_KEY=… \
  node packages/testing/verify-staging.ts \
    --url https://<host> --email <address> \
    [--seed-sql <path>] [--allow-writes] [--other-org <id>]
```

**PASS `--seed-sql`. It converts the worst failure in this runbook from undiagnosable to flat.**
The script reads the `identifier_hash` out of the file the seed tool printed and compares it to the
one computed from the key in your shell — **before a single request is sent** — and on a mismatch
says so outright, with both values and the note that **the stored row cannot be repaired**, because
the plaintext address is not stored and the hash cannot be recomputed.

**What it still cannot prove, and says so:** that the *Worker's* key matches either. **No process
outside the deployment can read a Worker secret.** It proves the seeded row is or is not reachable
with the key you hold, which is the half that was previously undiagnosable.

**`--allow-writes` is off by default**, because §8a.2 and §8a.3 create and modify a real staging row
and cost 8 row-writes against the daily ceiling. **A first run without it is not a failure — but it
is also not coverage of §8a.3, the PATCH three-way distinction, which is the highest-consequence
check on either list.** Those two report NOT RUN and say why. Do not read a green first run as
having tested them. **The script
does not delete its probe row** — `DeleteCustomer` is granted to no role, and a verification script
should not delete data unasked. It prints the `customer_id` for you to remove.

> ### ⚠ CHECK WHAT IS ALREADY LISTENING ON THE PORT
>
> Running against a local `wrangler dev`, **confirm the port is yours first.** `qa-agent`'s first
> §8a run reported checks 1 and 2 failing. The cause: **a Python process from an unrelated project
> was already bound to `127.0.0.1:8788` and answering `401` to everything.** Its own stub failed to
> bind, the error went to `/dev/null`, and the script talked to the foreign server instead.
>
> *"Had I not checked what was listening, I would have reported 'the §8a checks fail' — and been
> completely wrong."*
>
> **This is the second unrelated process on this machine to interfere with Dudo's verification**,
> after the one polling `pgrep` for our Xcode builds. **A local port is not a safe assumption here,
> and this machine is not a controlled environment.** A red result is not evidence until you know
> what answered.

**Running it requires explicit user approval each time** — `security.md` §7 covers sending anything
to an external service. The file says so at the top.

**Read its output rather than its exit code, and specifically:**

- **A `401` on check 2 does NOT tell you why, by design.** `qa-agent` was asked to make the script
  name a key mismatch and **refused, correctly**: the refusal is `disclosure: 'collapsed'`, so a
  wrong password, an unseeded account and an `IDENTITY_LOOKUP_KEY` mismatch are byte-identical.
  **A script that inferred a cause from a response carrying no information would be inventing one.**
  Instead a **pre-flight computes the identifier hash locally** and prints it, turning a silent,
  undiagnosable failure into a two-value comparison against the seed SQL. The script lists the four
  causes in likelihood order and says plainly: *do not start with the password.*
- **Pre-flight and gating checks are counted separately.** A pre-flight pass proves nothing about
  the deployment. `qa-agent`'s first version printed "3 passed, 1 failed" for a run where **every
  gating check was unrun**, caught it, and fixed it — *"precisely the rounding-up I have been
  objecting to all slice, and I had written it into my own tool."*
- **CHECK 4b always reports NOT RUN.** With one seeded Organization the only available probe is
  "a caller-supplied `X-Organization-Id` does not change tenancy", **which is not a two-tenant
  test.** Until a second Organization is seeded, **deployed isolation evidence is weaker than the
  harness evidence**, and the script says so on every run rather than letting four greens imply
  otherwise.
- **It refuses production-shaped URLs** unless explicitly overridden. Not a security control — a
  guard against pasting a production URL into a terminal at the end of a long day.

Both paths were exercised against a throwaway stub before delivery: green path exits 0; refuse path
fails check 2 and reports checks 3 and 4 as **NOT RUN rather than failed**.

## 8a. The five checks that stub-based testing cannot make

**Why this list exists, in `app-agent`'s words:** *"that stub was written by me, from the same
reading of the same contract that produced the client. A shared misreading passes all 50 tests
silently."*

Every client binding in this release is verified against a stub **written by the same agent that
wrote the client**, from the same reading of the same contract. The suites prove each client is
**self-consistent**. They cannot prove it is **right about Core**. These five are where a shared
misreading is most plausible, in descending order of how likely — and, for the second, how
expensive.

- [ ] **1. `page_size` integer coercion.** Clients send it as a query string. Core coerces only if
      `integerQueryParams` lists it for that route. If it does not, `page_size=25` arrives as the
      **string** `"25"` and fails schema validation as `must_be_integer`. No stub can catch this,
      because a stub does no coercion.
- [ ] **2. The PATCH three-way distinction, server-side. HIGHEST CONSEQUENCE ON THIS LIST.** Both
      clients have proved the bytes they *send* are right: field present = set, explicit `null` =
      clear, absent = unchanged. **Nobody has proved Core interprets explicit `null` as *clear*
      rather than as *unchanged*.** If it does not, the failure is **silent data loss in a
      customer's record** — an address the user cleared that quietly stays. Test it against real
      D1 and read the row back.
- [ ] **3. `201` on create.** A stub returns whatever it was told to. Confirm Core's actual
      `httpStatusOnSuccess`. Decoding survives a mismatch; any future branch on status would not.
- [ ] **4. Cursor round-trip.** Clients treat the cursor as opaque and never parse it, which is
      correct. Confirm a cursor issued by Core survives being sent back through the query-parameter
      path **unmodified** — percent-encoding is the plausible failure, and the cursor's charset was
      chosen to admit no delimiter at all.
- [ ] **5. `Set-Cookie` shape.** Apple's parser is built from `pre-auth-http.ts` **as read**. One
      real response settles it.

**Each of these is cheap once something is deployed, and impossible before.** They are the reason
"no end-to-end call has ever been made" appears in the release notes as the residual risk rather
than as a footnote.

## 9. Rollback

`npx wrangler rollback` reverts the Worker. **It does not revert a migration.** D1
migrations are forward-only here; there are no down-migrations, which is why step 3
insists on local-first. Treat every remote migration as permanent.

---

## What this runbook does not cover

- **Production.** Out of scope entirely; it needs its own decision record and its own
  approval.
- **The Apple client.** TestFlight is blocked on an unconfirmed macOS platform state and
  app icon artwork; see the memory notes and `mvp-delivery-policy.md` §4.
- **A custom domain.** `dudo.work` sits on Cloudflare nameservers with **no A record**;
  Workers custom domains create it automatically, but that is a separate step with its own
  free-tier check.
- **Observability.** `wrangler.jsonc` deliberately leaves Workers Logs off pending a
  free-tier impact check (`architecture.md` §6a). Debugging a deployed Worker without it
  will hurt; enabling it without the check is the sequence that rule forbids.

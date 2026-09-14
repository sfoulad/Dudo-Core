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

## 2a. ⚠ EXECUTE THE WHOLE SET BEFORE THE LIST GOES TO THE USER — IT IS NOT OPTIONAL

**Added 2026-09-13, because it caught a migration that DID NOT APPLY, on the day it was about to be
put in front of the user for approval.**

**Apply every migration, in filename order, to a throwaway in-memory database, before anyone
approves anything.** `node:sqlite` is the same engine family the QA fixtures use and it costs
seconds.

```
23 control-plane + 4 tenant, in order, into a throwaway database
  -> the first seventeen applied
  -> 0018 FAILED:
     error in trigger platform_operator_excludes_membership_on_insert:
       no such table: main.organization_membership
```

### WHAT IT FOUND, AND THE SHAPE IS WHY READING DID NOT

`0018` widens a `CHECK`, and **SQLite cannot `ALTER` a `CHECK`** — so it is the twelve-step table
rebuild: create, copy, **drop**, rename. `0010` installs **FOUR** triggers:

```
TWO  ON organization_membership                      -> dropped by the DROP TABLE.  FOUND.
TWO  ON platform_operator, reading organization_membership in WHEN EXISTS
                                                     -> NOT dropped.  MISSED.
```

**The two survivors are not dropped, so when the rename lands SQLite re-validates the schema, finds
live triggers referencing a table that no longer exists, and refuses.**

> **`architecture.md` §3b, self-inflicted, and `core-agent`'s own diagnosis is the thing to keep:**
> **"A confident paragraph about triggers is what stopped me looking for the other kind of
> trigger."** It wrote a detailed, correct section about the two it had found — *and read past it
> four times.* **The more precisely a dismissal is worded, the less likely anyone is to re-derive
> it, including its author.**

**AND THE TEAM LEAD AMPLIFIED THE HALF-RIGHT VERSION.** That trigger finding had already been
relayed as *"the one I would put in front of the user first"* — **correct about the hazard, wrong
about its extent, and repeating it added confidence without adding a check.** A half-right finding
travelling upward is harder to catch than a wrong one, because the half that is right survives
every review.

**Nothing static would have found it.** Not a read of `0018`, not a read of `0010`, not a diff —
**the failure is a property of the SCHEMA STATE at step 18, which exists only once seventeen files
have run.**

### WHAT EXECUTING THE SET PROVES, AND WHAT IT DOES NOT

**PROVES:** every file parses and applies in order; every named object exists afterwards; and —
because the prober can then run statements — **behavioural properties can be checked rather than
argued.** The 2026-09-13 run added 12, none blind, including **both directions of the single-owner
ordering** (demote-then-promote succeeds; promote-before-demote is refused by the index) and the
confirmation that **the partial unique index is BLIND TO ZERO**, documented rather than hoped.

**DOES NOT PROVE ANYTHING ABOUT D1.** `d1_database_query` is withheld, so D1's PRAGMA handling and
batch atomicity stay unmeasured. **§3's *"the ✅ is the tool's claim — query the database"* applies
in full and is not softened by a green local run.**

### ⚠ THE SET IS NOT IDEMPOTENT. RUNNING IT TWICE FAILS AT `0007`. MEASURED 2026-09-13.

**Found by `core-agent` re-running the set after the recency index landed; verified independently by
the Team Lead before it went in this file.**

```
pass 1   23 control-plane migrations applied clean
pass 2   FAILS AT 0007_membership_role.sql  ->  duplicate column name: role
```

**`0007` uses `ALTER TABLE … ADD COLUMN`, which has no `IF NOT EXISTS` form in SQLite.** Everything
before it is `CREATE TABLE IF NOT EXISTS` and re-runs harmlessly — **so a second pass gets six
migrations in before it stops**, and the operator meets a failure in the middle of a set they were
told was one action.

> **`wrangler d1 migrations apply` TRACKS WHAT IT HAS APPLIED and will not re-run them, so the normal
> path is unaffected.** The hazard is **a hand-run** — pasting the set into a console, re-running
> after a partial failure, or "just making sure" — **which is exactly what someone does when a
> migration step has already gone wrong once.**

**AND NOTE WHERE THAT PUTS YOU: the moment you are most likely to re-run by hand is immediately after
a failure**, and that is the moment the set is guaranteed to fail again for a *different and
misleading* reason. **`duplicate column name: role` tells you nothing about the problem you were
actually chasing.**

**This is pre-existing and is not a defect introduced by Milestone 2** — `0021` is idempotent and says
so on its own face; **the SET is not, and no individual file claims otherwise.** Recorded because
`§2a` requires executing the whole set before the list reaches the user, **and executing it twice is
the obvious next thing to try.**

**If a migration run fails partway: do not re-run the set. Read `d1_migrations` to find what
applied, and resume from there.**

### ⚠ AND A FRESH-DATABASE RUN IS NOT THE PRODUCTION SHAPE — `0019` CAN FAIL ON DATA THAT IS ALREADY THERE

**Added 2026-09-13 by the Team Lead, and it is a DIFFERENT risk from the ordering cases above.**

**Those 12 statements test what the index refuses at WRITE time** — promote-before-demote is refused,
demote-then-promote succeeds. **All correct, all about a running system.** They are executed against
a database the migration set has just built, **which is exactly the shape production is not in.**

**The live control plane holds `0001`–`0017` AND ROWS.** So the honest test applies `0001`–`0017`,
**populates it**, and then applies `0018`–`0023`. Measured that way, on three populations:

```
A  one owner per organization     OK        rows 2 -> 2 | triggers 8 -> 8 | none lost
B  an organization with TWO       REFUSED   UNIQUE constraint failed: organization_membership.organization_id
   owner rows already present               *** THIS IS A MIGRATION FAILURE, NOT A WRITE REFUSAL ***
C  an organization with NO owner  OK        rows 1 -> 1 | triggers 8 -> 8 | none lost
```

**Row A is the good news and it is worth stating: `0018` rebuilds the table WITH DATA IN IT and loses
nothing** — every row copied, **all eight triggers present afterwards.** The dangling-trigger defect
that produced §2a in the first place is fixed **and is now verified by execution against a populated
database rather than by reading the file.**

> **ROW B IS THE ONE THAT MATTERS. `CREATE UNIQUE INDEX … WHERE role = 'owner'` IS EVALUATED AGAINST
> THE ROWS THAT ALREADY EXIST.** If any live Organization holds two `owner` rows, **the index cannot
> be created and `0019` fails.** No amount of testing the *running* behaviour reaches this, because
> the offending rows predate the constraint.

**AND THE FAILURE IS NOT CLEAN, WHICH IS THE OPERATIONAL HALF.** `wrangler d1 migrations apply` walks
the files in order. **`0018` has already committed by the time `0019` runs** — the table is rebuilt,
the old one dropped. **A failure at `0019` leaves the database HALF-MIGRATED**, with no automatic
unwind, in the middle of a set the operator was told was one action.

#### THE PRE-FLIGHT CHECK, AND IT IS ONE QUERY

**Before `0018`–`0023` are applied to any real database, run this and read it:**

```sql
SELECT organization_id, COUNT(*) AS owners
  FROM organization_membership
 WHERE role = 'owner'
 GROUP BY organization_id
HAVING COUNT(*) > 1;
```

**Any row returned means the migration set WILL fail at `0019`, and the data must be corrected first
— which is a production-data change and therefore the user's, every time** (`security.md` §7).
**An empty result is the go condition.**

**Do not reason from onboarding.** *"Onboarding creates exactly one owner, so this cannot happen"* is
the shape `§11a` calls a claim about the tree that nobody ran — and the three live Organizations
predate `0019`, so **nothing has ever enforced the property they are about to be measured against.**

**Row C is already recorded above as the index being blind to zero.** It is unchanged by this and it
is a data question rather than a migration one: **`0019` will apply cleanly to an ownerless
Organization and leave it ownerless.**

### AND THE USER HEARS ONE THING FROM THIS THAT NO FILE SAYS

**For the duration of `0018`, the mutual exclusion has NO database-level enforcement in either
direction** — all four triggers are dropped at step 0 and recreated at the end. **Acceptable on
`0025`'s own terms** — *"the write check is hygiene; THE AUTHORIZATION CHECK IS THE CONTROL"*, and
both authority resolvers are untouched by a migration — **but it is not nothing, and it means: do
not apply it while anything is writing.**

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

### ⚠ THE ✅ IS THE TOOL'S CLAIM, NOT A VERIFICATION. QUERY THE DATABASE.

Added 2026-09-07, from applying `0015` and `0016` to the remote control plane.

`wrangler d1 migrations apply` prints a table of ✅ glyphs. **That table is the tool reporting on
itself.** And the obvious way to check it independently — reading the exit code out of a pipeline —
**does not work in this repository's shell**: `${PIPESTATUS[1]}` came back **empty under zsh**, so
the line printing it reported nothing at all, and the ✅ was the only signal in the room.

**This is `workflow.md` §11a on a production action.** There, a `grep` for a success token treated
absence of a failure as success. Here an empty `PIPESTATUS` did the same thing on a **migration**,
which is the one class of action where "I think it worked" is most expensive.

**So verify against the database, every time, and verify the THING rather than the RECORD.**
`d1_migrations` says a file ran; it does not say the schema changed. Query the objects:

```
# the indexes a migration claims to create
npx wrangler d1 execute dudo-control-plane --remote --json \
  --command "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='<table>' ORDER BY name"

# the columns a migration claims to add
npx wrangler d1 execute dudo-control-plane --remote --json \
  --command "SELECT name FROM pragma_table_info('<table>') ORDER BY cid"

# and that nothing is left pending
npx wrangler d1 migrations list dudo-control-plane --remote
```

**Name the expected objects BEFORE running the query and compare against that list.** A query that
returns rows looks like success; `0015` was expected to add exactly **13** columns, and only a
stated expectation makes 12 or 14 visible. This is the floor rule: *a count with nothing to compare
against is a number, not a check.*

**One question this settled, recorded because it had been an assumption for two days.** Local D1
accepted `ALTER TABLE ADD COLUMN … CHECK` and nobody had confirmed the remote engine would.
**It does** — `0015` applied and all 13 columns are present. Until this run, *"local accepted it"*
had been doing the work of *"it works"*.

**And this check cannot live in the test suite.** `qa-agent` was asked whether its migration census
could distinguish *applied locally* from *applied remotely* and correctly answered no: the
distinction is invisible from inside a `node:sqlite` fixture, and it declined to build something
that would look like a check without being one. **The remote state is observable only from outside
the harness, which is why it is a runbook step and not a test.**

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

## 6. Build the web client — ⚠ THE COMMAND THIS STEP USED TO GIVE SHIPS A FIXTURE BUILD

> **⚠ CORRECTED 2026-09-13. This step read `cd platform/web && npm install && npm run build`
> and that produces a FIXTURE BUILD.** Not a broken one — a convincing one. **Followed
> literally, this runbook put a fake API on `app.dudo.work`.**

```
VITE_DUDO_TRANSPORT=http npm --prefix <absolute repo path>/platform/web run build
npm --prefix <absolute repo path> run check:deployable-build            # was it CONFIGURED?
npm --prefix <absolute repo path>/platform/web run verify:no-fixtures   # did the DATA leave?
```

**Both are required and both must exit 0.** They start from different places and catch
different things — see the correction below.

**`platform/web/src/api/config.ts` resolves an unset `VITE_DUDO_TRANSPORT` to `fixture`, and
that default is correct** — *"a build that was never configured must not"* silently talk to a
real server. **Failing safe at build time means failing wrong at deploy time**, and nothing in
this repository sets the variable: measured with a positive control, it appears only in
`platform/web`'s source, its README, and build output. **No deploy script, no wrangler config,
no CI, no `.env`.**

**What a fixture build does when served, which is why no probe in §8 would catch it:** it
renders the real interface, it performs the **real** password derivation, and it makes **no
network calls at all.** `§8`'s probes ask whether the surface answers — **it answers
beautifully.**

**`platform/admin` IS NOT AFFECTED, and that asymmetry is why this survived Milestone 1.**
That console has no fixture transport: *"it talks to Core or it shows an error."* **A clean
admin deploy said nothing whatever about this hazard**, and the one surface Milestone 2 ships
is the one that carries it.

**Do not try to detect this by looking for fixture strings — measured, it did not work.** Both
builds matched every marker and the real build was 314 bytes **larger**, so the only
discriminator in the artifact is one key in Vite's inlined `import.meta.env` object. That is
what `check:deployable-build` reads, **and it fails as NOT RUN rather than as a pass if it
cannot parse the bundle.**

> **⚠ AND THE REASON THE TWO BUILDS MATCHED WAS ITSELF A DEFECT — found by `web-agent` the same
> afternoon and fixed structurally.** The `http` bundle was shipping **3 fixture Businesses and
> 35 fixture customer records**. Root cause: the `Transport` interface was declared *inside*
> `fixture-transport.ts`, so six modules imported the shape from the fake — **type-only, free at
> runtime, and it made the fixture read as an ordinary dependency** until three value imports had
> accumulated unremarked. The interface now has its own module, and a Vite `resolveId` hook drops
> the fixture modules from the **module graph** when the transport is `http`. Re-measured:
> **585,861 bytes, zero fixture data.**
>
> **RUN BOTH CHECKS BEFORE A DEPLOY. Neither subsumes the other**, and `§11a`'s test names a
> concrete input for each:
>
> ```
> check:deployable-build   starts from THE ENV OBJECT      — was the build CONFIGURED?
> verify:no-fixtures       starts from THE BUNDLE CONTENT  — did the fixture data LEAVE?
>
> red / green   an unconfigured build whose data matches no content predicate
> green / red   a NEW fixture module the resolveId hook does not name, in a configured build
>               — exactly the defect web-agent found, which this step passed straight over
> ```

Produces `platform/web/dist`, which `wrangler.jsonc` serves as static assets. Asset requests
are free and unlimited and do not invoke the Worker — the property `0016` chose the whole
stack for.

## 7. Deploy — needs explicit user approval, every time

> **⚠ CORRECTED 2026-09-13. This step said `npm run deploy:staging`. THAT SCRIPT WAS REMOVED
> ON 2026-09-08** — it pointed `--env staging` at a target neither wrangler config defines, and
> `package.json` records the removal and the reason at length. **The runbook instructing it was
> never swept**, so the deployment procedure named a command that does not exist, at the deploy
> step, for five days.
>
> **`workflow.md` §12 exactly, and in the worst possible file**: the removal was recorded
> where the script had been, and nothing sent anyone to the document that *instructs* it. The
> sweep is citation-driven and **a runbook does not cite `package.json`.**

```
npx wrangler deploy --config wrangler.jsonc          # dudo-core   — app + api
npx wrangler deploy --config wrangler.admin.jsonc    # dudo-admin  — admin console
```

**`--config` is not optional.** Two Workers share one `main`; omitting it deploys the wrong
surface, and rollback is per-Worker — see the section below on why *"the rollback version"* is
ambiguous until you name a Worker.

**There is deliberately no bare `deploy` script**: a one-word affordance is wrong for an action
that needs a decision. **`app.dudo.work`, `api.dudo.work` and `admin.dudo.work` ARE the test
environment** (`0035`), named honestly — there is no separate staging, and `workflow.md` §11's
clause expires on the first real customer Organization rather than on a date.

## 7a. ⚠ OPEN — NEITHER HOST SENDS ANY SECURITY RESPONSE HEADER

**Found 2026-09-13 while establishing the browser-render loop. Live on both deployed hosts.**

```
curl -sS -D - -o /dev/null https://admin.dudo.work/   ->  the COMPLETE header set:
  HTTP/2 200 · date · content-type · cf-cache-status · cache-control
  nel · report-to · server: cloudflare · cf-ray · alt-svc

ABSENT on admin.dudo.work AND app.dudo.work:
  X-Frame-Options · Content-Security-Policy · Strict-Transport-Security
  X-Content-Type-Options · Referrer-Policy · Permissions-Policy · Cross-Origin-Opener-Policy
```

**Verified with a positive control** — the same pattern matched `content-type` and `server`, so the
instrument works and the absence is real. **Corroborated in a browser: a same-origin iframe of
`https://admin.dudo.work/` loaded and rendered the full sign-in page. The console frames.**

**WHY NO CODE PATH SETS THEM, and it is the same shape as the fixture-build defect above:**
`run_worker_first` is `["/api/*", "/auth/*", "/health"]` in both configs and the SPA is served by
Cloudflare **Static Assets**, so **the HTML document response never enters the Worker.** There is no
line of our code in its path — which is why no review of the Worker was ever going to find it.

**THE DELIVERY MECHANISM IS VERIFIED RATHER THAN ASSUMED**, because Static Assets and Pages are
different products and this was the fork worth getting right:

> **Workers Static Assets DOES honour a `_headers` file** — *"The default response headers served on
> static asset responses can be overridden, removed, or added to, by creating a plain text file
> called `_headers`."* It goes in the assets directory (so, in `public/`, which Vite copies into
> `dist/`). **Limits: 100 rules, 2,000 characters per line.**
>
> **And it applies to exactly the responses that are the problem:** *"Custom headers defined in the
> `_headers` file are **not** applied to responses generated by your Worker code."* **Our document
> responses are static assets, which is the case it covers** — so widening `run_worker_first`, which
> `0016` §5 prohibits, is **not** required.

### 7a-i. ⚠ THE RISK COLLAPSES ONTO ONE ORIGIN PAIR — and both of the Team Lead's framings were wrong

**`security-agent` reviewed this and refused both arguments it was handed. Both refusals were right,
and the replacements are better.**

**CSP is NOT "containment at the point where the plaintext credential lives".** That overstates it:
**CSP cannot contain a script that is already executing** — an attacker with execution reads the
password field directly — and **no directive stops exfiltration by navigation**; `navigate-to` was
removed from the spec and no browser ships it. **A precisely-worded claim that stops the next reader
checking** (`architecture.md` §3b).

**What `0015` §D actually changed is IRREVERSIBILITY.** An XSS on the login page used to yield a
revocable session; it now yields the **password** — and `0027`'s own ceiling is *"exactly as strong
as the password and no stronger"*, so a stolen password **defeats the confirmation mechanism
outright on every critical operation, indistinguishably from the operator in the audit trail.**

**The load-bearing argument is `0027`'s own admitted gap, CF-2:** *Core cannot verify the client
displayed what it was given.* An attacker rewriting the statement text node gets an operator to
approve something else **with their own correctly-derived password** — and **unlike the credential
case, that attack requires running IN THE PAGE, which is exactly what `script-src 'self'` prevents.**

**And the confirmation gate is NOT clickjackable.** It requires a typed email, a typed password and
600,000 PBKDF2 iterations; **an overlaid frame yields a click on Approve with two empty required
inputs.** Asked whether `0026`/`0027` rested on an unwritten no-framing premise, the review checked,
found they did not, **and declined to manufacture one.**

**THE REAL SURFACE IS THE SEVEN ONE-PRESS PLATFORM MUTATIONS** — create/update/retire/restore
Template, set-organization-template, merge-identity, onboard-organization — which complete on a
single click with no confirmation.

```
framing page      3P storage     session hint   whoami probe?   Lax cookie   clickjackable?
evil.com          PARTITIONED    unreadable     NO — never asks  moot        NO, twice over
app.dudo.work     first-party    present        YES              SENT        YES, all seven
```

> **CROSS-SITE FRAMING IS DEAD FOR TWO INDEPENDENT REASONS, and the second is verifiable in our own
> source rather than derived from a specification:** `use-session.ts:92` gates the `whoami` probe on
> a per-tab hint, so **a console with no hint never makes one authenticated request.** Third-party
> storage partitioning makes that hint unreadable in a cross-site frame.
>
> **SAME-SITE FRAMING IS UNTOUCHED BY BOTH.** `app.dudo.work` framing `admin.dudo.work` is
> first-party storage, the hint is present, the probe fires, and the cookie is same-site.
>
> **So the entire risk collapses onto ONE ORIGIN PAIR, and `frame-ancestors 'self'` closes exactly
> that — because it is ORIGIN-scoped where both other mechanisms are SITE-scoped.** The header's
> justification is narrower and better evidenced than *"framing is bad"*.

#### ⚠ AND THE OBVIOUS TEST OF THIS IS VACUOUS — DO NOT RUN IT

**The natural next step is: sign in, frame it cross-site, look at it. IT PROVES NOTHING, AND IT FAILS
IN THE REASSURING DIRECTION.**

**Because the console never asks, a framed cross-site console shows a sign-in form WHETHER OR NOT the
cookie would have been sent.** Both hypotheses render identically. *"We framed it and got a sign-in
page, so `SameSite=Lax` protects us"* is a **confident wrong conclusion** — and it is the optimistic
rot direction, the one `workflow.md` §11a says nobody ever catches, because acting on it always looks
safe.

**This was found by asking whether the test was worth PROPOSING, before anyone ran it** — and the
Team Lead had already attempted the adjacent cookie-probe version and failed to complete it, with
"sign in and look" as the obvious next move. **The review's refusal to offer a better version is the
right call: there is none that avoids an operator typing a password, and an unobserved fact that is
labelled unobserved beats an instrument that returns green for the wrong reason.**

**Marked, so this is never quoted as one thing:**

| | |
|---|---|
| **SOURCE-VERIFIED** | no hint → no probe → sign-in screen, zero authenticated requests (`use-session.ts:92`, `:104`) |
| **BROWSER BEHAVIOUR, NOT MEASURED HERE** | third-party `sessionStorage` partitioning; SameSite's site-for-cookies computation |

### 7a-ii. Severity, timing, and where the files go

**Severity, stated honestly rather than dramatically: no real customer Organization exists** — this
is the test environment (`0035`), the newest `organization` row is `2026-09-04`, and no operator
session exists on the deployed console. **The population at risk is us.** That is a reason not to
call it an incident. **It is not a reason to defer it past the milestone.**

> **THE EVENT THAT CHANGES IT IS THE FIRST LIVE OPERATOR SIGN-IN** — the first time a real password
> is derived in that page. **The headers should land in the SAME deploy, not in one after it.** That
> deploy needs the user's explicit approval regardless (`security.md` §7), so this adds a file to an
> approval that must be sought anyway rather than creating a new one.

**The `_headers` files land in `platform/web/public/` and `platform/admin/public/` — `web-agent`'s
trees.** `platform/admin` has no `public/` directory today and needs one.

**The nonce is not an option and that is worth recording as a closed door:** it must be generated per
response and injected into both header and tag, **which requires the document to pass through the
Worker** — and `run_worker_first` does not carry `/`. **The mechanism that would normally be right is
unavailable for the same reason the headers were missing in the first place.**

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

### ⚠ THREE WAYS A POST-DEPLOY PROBE LIES, ALL THREE HIT IN ONE SESSION

Added 2026-09-08, after verifying a deploy and reaching a wrong conclusion three times before
reaching a right one. **None of the three was a product defect. All three were the probe.**

**1. A HASH-ONLY NAVIGATION DOES NOT RELOAD THE DOCUMENT.** Navigating from
`https://host/#/a` to `https://host/#/b` — or to the same URL — changes the SPA route and
**re-fetches nothing.** The old bundle stays in memory and the screen looks unchanged, which reads
exactly like a deploy that did not take.

> **To force a real document load, change the PATH or the QUERY, not the fragment.** `?cb=<date>`
> is enough. Then confirm the served bundle hash matches the local build:
> `curl -s https://host/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'` against `ls dist/assets/`.

**And check the cache headers before blaming the cache.** `index.html` is served
`cache-control: public, max-age=0, must-revalidate`, so a normal reload always revalidates. The
stale page was the probe's fault, not the CDN's, and half an hour went into the wrong suspect.

**2. RESOLVE THE BASE-PATH CONSTANT. DO NOT INFER IT FROM A ROUTE TABLE.** The route reads
``path: `${PLATFORM_BASE_PATH}/organizations/{organization_id}/identity` ``. `PLATFORM_BASE_PATH` is
**`/api/v1/platform`**, not `/platform`.

Probing the inferred path returned **200 with the SPA shell** — because `/platform/*` matches no
asset and falls to `not_found_handling`. That is indistinguishable from the real
`run_worker_first` defect this file documents elsewhere, **and it was very nearly reported as one.**

**3. A `404` CAN BE THE PATH PARAMETER, NOT THE ROUTE.** `PATCH /organizations/org_x/identity`
returned 404 — same as a route that does not exist. `org_x` fails the identifier shape, so the
matcher finds nothing. With a well-formed id the same route returns **401**.

> **Probe every route with a WELL-FORMED but non-existent identifier, and pair it with a negative
> control on a sibling path that genuinely does not exist.** `401` on the real route and `404` on
> the control is the only pair that proves "registered and gated". Two 404s prove nothing, and two
> 405s — which is what a wrong method on both produces — prove less.

**The habit underneath all three: every probe needs a control, and the control has to be run even
when the first result looks conclusive.** All three wrong answers were self-consistent. The
negative control is what separated them from the truth each time.

### And the console will show a sign-in form to someone who IS signed in

**Not a defect. `use-session.ts` keeps a per-tab hint in `sessionStorage` that decides the FIRST
PAINT ONLY.** With no hint the console shows the form rather than spending a `whoami` — and that is
deliberate, because **`whoami` writes a platform-operator audit record on every call**, so probing
speculatively bills an audit row to a browser that has never signed in.

**So a fresh tab, or an automation-driven load, shows the form while the server-side session is
still live.** Confirm before treating it as a regression:

```
npx wrangler d1 execute dudo-control-plane --remote --json \
  --command "SELECT principal_id, created_at, expires_at FROM session WHERE expires_at > '<now>'"
```

**A live row for that principal means the deploy did not sign anyone out.** Session state is in D1
and keyed by `SESSION_HMAC_KEY`; deploying a Worker version does not invalidate it, and only
rotating that secret would.

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

## 8c. Adding a custom domain: two traps, both hit on 2026-09-05

**Trap 1 — enabling custom domains silently disables `workers.dev`.** The moment `routes` with
`custom_domain: true` are added, wrangler turns off the `*.workers.dev` hostname **by default**, and
says so only in a warning. The old URL starts returning **404 for everything, including the SPA
root.** Anyone mid-test against it sees a total outage.

**Sequence the announcement before the deploy, not after.** A verification run was in flight when
this happened here, and it reported "the deployment is unreachable" — accurately, about a hostname
that had ceased to exist thirty seconds earlier.

**Trap 2 — a negatively cached NXDOMAIN outlives the fix, and looks exactly like a failed deploy.**
The records are created at Cloudflare's authoritative nameservers within seconds. But any resolver
that was asked for the hostname **before** it existed caches the "does not exist" answer for the
zone's SOA minimum — **1800 seconds, thirty minutes, for `dudo.work`.**

On this machine the local router (`192.168.100.1`) held that answer, so `curl` failed for half an
hour while the origin served `200` worldwide. **Both the Team Lead and `qa-agent` reported a
provisioning failure that did not exist**, in opposite directions and an hour apart.

**The diagnostic, and it takes ten seconds:**

```
dig +short A app.dudo.work @sage.ns.cloudflare.com   # authoritative — the truth
dig +short A app.dudo.work                            # your resolver — may be stale
curl --resolve app.dudo.work:443:104.21.12.54 https://app.dudo.work/health
```

**If the authoritative server answers and yours does not, the deployment is fine and your resolver
is stale.** `--resolve` reaches it immediately. Do not re-deploy, do not re-create the domain, and
do not conclude anything about the Worker.

**"Unreachable from here" and "down" are different claims**, and only one of them is measurable from
a single machine.

> **The two errors were not the same size, and `qa-agent` insisted on the distinction against its own
> interest.** The Team Lead said *"not resolving"* — accurate about what was observed. `qa-agent`
> wrote *"the custom domains have no DNS records"* — **a claim about Cloudflare's zone, inferred from
> its own resolver's answer.**
>
> In its words: *"That's the stronger error, and it's the same shape as the three wrong diagnoses in
> my script: a specific conclusion drawn from something that only looked like evidence for it."*
>
> **The generalisation worth keeping: the distance between what you measured and what you asserted is
> the size of the error, and it is not visible in the assertion itself.** Both statements read as
> confident reports of a broken deployment. Only one of them was about something the author had
> actually looked at.

> **On working around a stale resolver.** `qa-agent` used a scratchpad preload redirecting
> `dns.lookup` for `*.dudo.work`, deleted immediately after, **and disclosed it** — on the grounds
> that *"a verification run that quietly rewired its own networking is exactly the unstated
> environmental difference this project keeps getting caught by."*
>
> **Prefer that to an `/etc/hosts` entry.** A hosts entry never expires and nothing reminds you it is
> there; a preload cannot outlive the process. **Either way, say so in the report** — a green run on
> rewired networking is not the same evidence as a green run without it.

## 9. Rollback

## D1 BACKUP BEFORE A MIGRATION — the procedure, and the verification step that nearly reported a false failure

Added 2026-09-13, verified against the live control plane before Milestone 2's index migration.

**Taking the backup is one command and it works:**

```
npx wrangler d1 export dudo-control-plane --remote --output=<path>.sql
```

It builds the export server-side, prints a **one-hour signed R2 link**, and downloads the SQL. **No
paid service is involved** — this is D1's own export path.

### ⚠ A DOWNLOADED FILE IS NOT A VERIFIED BACKUP, AND THE OBVIOUS VERIFICATION FAILS MISLEADINGLY

**Restoring the export into a scratch SQLite reported `no such table: main.template` — and the backup
was fine.**

**The export opens with `PRAGMA defer_foreign_keys=TRUE`, and a plain `exec()` of the whole file does
not honour it**: rows for `organization` are inserted before `CREATE TABLE template` appears, and the
foreign key is checked immediately rather than at commit. **The restore tool enforces a constraint
the export expects to be deferred.**

> **The check was wrong and the subject was right** — `workflow.md` §11a's three causes of *"this
> cannot succeed"*, and this was the third: **the input was impossible for a reason nobody had
> stated.** Read WHY before concluding which.

**So the verification is:**

```
PRAGMA foreign_keys=OFF;          <- REQUIRED, or a valid backup reports a missing table
<replay the export>
PRAGMA foreign_key_check;          <- must return zero rows AFTER the restore
count tables, indexes and rows and compare against an expectation stated BEFORE the run
```

**Measured 2026-09-13 on `dudo-control-plane`: 11 tables, 4 indexes, 122 rows, 0 foreign-key
violations.** Row counts by table are the useful artifact — **a restore that produces the schema and
no rows looks identical to a successful one in every check that stops at "it parsed".**

**And name the expected tables before running it.** The floor rule applies: a restore returning
*some* tables looks like success, and only a stated expectation makes ten-instead-of-eleven visible.

## ⚠ THERE ARE TWO WORKERS SHARING ONE `main`, AND "THE ROLLBACK VERSION" IS AMBIGUOUS WITHOUT NAMING ONE

Added 2026-09-11, before a deploy rather than during one. **This runbook was 491 lines and mentioned
`dudo-admin` nowhere.**

```
wrangler.jsonc         name: dudo-core    routes: app.dudo.work, api.dudo.work   main: worker.ts
wrangler.admin.jsonc   name: dudo-admin   routes: admin.dudo.work                main: worker.ts   <- SAME FILE
```

**Both Workers are built from the same `worker.ts`. They are deployed separately and versioned
separately.**

> ### ⭑ AND THE SAME TABLE CARRIES A PROPERTY CODE NOW DEPENDS ON: THE CLIENT AND THE API DEPLOY ATOMICALLY
>
> **Recorded 2026-09-13 because a parser was changed on the strength of it, and it was handed back to
> this file rather than left in a comment** (`architecture.md` §2a — name the artifact, not the path:
> a claim about the platform's deployment topology belongs in the runbook, not in a console's parser).
>
> ```
> dudo-core    main: worker.ts   assets.directory: ./platform/web/dist     app.dudo.work + api.dudo.work
> dudo-admin   main: worker.ts   assets.directory: ./platform/admin/dist   admin.dudo.work
> ```
>
> **Each Worker serves its own SPA bundle AND its own API from ONE deployment.** So for either
> surface, **a Core that emits a value and a client that has never heard of it cannot coexist as
> deployed artifacts.**
>
> **WHAT THAT LICENSES, AND IT IS BEING RELIED ON:** `platform/admin`'s `requireTemplateStatus` now
> **throws** on an unrecognised Template status rather than rendering it in a neutral badge — an
> honest parse of a `closed` enum (`0043` §7c-i), and a downgrade from *degraded but usable* to
> *broken screen* on a value it cannot represent. **That trade is only acceptable because of the row
> above.**
>
> **THE RESIDUAL EXPOSURE IS EXACTLY ONE THING: A BROWSER TAB HOLDING AN OLD BUNDLE ACROSS A DEPLOY.**
> Real, narrow, and self-correcting on reload.
>
> **⚠ AND THE PROPERTY EXPIRES ON AN EVENT NOBODY WILL ANNOUNCE.** The day either SPA is served from
> anywhere other than the Worker that serves its API — a CDN, a separate Worker, a cached shell —
> **the two stop deploying atomically and every hard-parse decision resting on this needs revisiting.**
>
> **It is NOT left as prose.** `platform/admin/scripts/verify-platform.mjs` parses
> `wrangler.admin.jsonc` and asserts the property, with the assertion labelled so the red points at
> `requireTemplateStatus` — the code that depends on it — and with four known-failing inputs shaped
> like real splits: bundle to a CDN, bundle to its own Worker, an assets-only config. **`§12`'s
> uncollected deferral, given a red state instead of a reader.**
>
> **`platform/web` has the identical shape and deliberately carries NO such check**, because nothing
> there parses against a closed enum yet — *"an assertion with no dependent is a check hunting for a
> subject"*, which is the failure that gets a check deleted as noise later. **It becomes owed the
> moment the web client hard-parses a closed enum, and that is a trigger rather than a date.**

**Consequences, none of which are obvious from either config:**

- **`npx wrangler rollback` and the version list are PER-WORKER.** *"Capture the current rollback
  version"* is not a well-formed instruction until it names `dudo-core` or `dudo-admin`. **Pass
  `--config wrangler.admin.jsonc` (or `--name dudo-admin`) or you will capture and roll back the
  wrong surface.**
- **DEPLOYING ONE DOES NOT DEPLOY THE OTHER, AND THEY SHARE SOURCE.** After an admin-only deploy the
  two surfaces run **different builds of the same file** — indefinitely, and silently. That is not a
  defect and it is the normal state during a milestone; **it is only dangerous when someone reasons
  from "the code is deployed" without naming which Worker.**
- **`dudo-admin` binds the Durable Object with `script_name: dudo-core`.** The admin Worker depends on
  a class that lives in the core Worker's script. **Rolling `dudo-core` back past a DO class change
  affects `dudo-admin` too**, and nothing in `wrangler.admin.jsonc` says so on its own face.
- **`assets.directory` is `./platform/admin/dist`** with SPA `not_found_handling` and
  `run_worker_first` for `/api/*`, `/auth/*`, `/health`. **A stale `dist/` deploys silently** — the
  Worker is fine and the bundle is old. **Build immediately before deploying, and verify the deployed
  bundle rather than assuming the build ran.**

### Why an admin-only deploy is SAFE for tenants, verified rather than assumed

**Platform routes are host-bound in Core** — `api.ts:325`,
`isPlatformHost(dependencies.platformRoutes.adminHosts, url.hostname)` — and the wrong host answers
**404, not 403**, so a caller cannot confirm the route exists off-host.

**The comment at `api.ts:314` is the part that matters and it is correct:** the host binding is
**defence in depth, not the enforcement** — the `platform_operator` check is, *"authorization runs on
the `platform_operator` row and not on the hostname"*. **An implementation that bound the host and
skipped the operator check would be the defect**, and this one does not.

**So deploying `dudo-admin` alone puts the platform surface live without touching what tenants
reach**, and `app.dudo.work` never served those routes to begin with.

---

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

# Release 001 — AZ2 Login and the Customer Directory shell

**Status: NOT RELEASED.** Nothing is deployed, nothing is committed, no build exists.

This is the **gate step 6 package written in advance** — release notes and test checklist, ready
so that deployment is the only remaining work rather than deployment plus paperwork. The two
fields step 6 requires and this document cannot yet contain are marked `PENDING`.

| Field | Value |
|---|---|
| **Web URL** | **https://app.dudo.work** — the application **and its API**, same origin |
| Admin | **https://admin.dudo.work** (`0010`) — serves, no admin interface built yet |
| Machine API | **https://api.dudo.work** — non-browser clients, `Authorization: Bearer` (`0022`) |
| Worker version | `baa833a6-70f8-4b4a-a19c-a7d8735d77c3` |

> **`dudo-core.sameh-0d2.workers.dev` is GONE.** Enabling custom domains automatically disabled
> `workers.dev`; that hostname now returns 404. Any earlier reference to it in this document or in
> a terminal history is dead.
>
> **Point browser clients at `app.dudo.work`, never `api.dudo.work`.** The session cookie is
> host-only, so a cookie-based client authenticates against `api.` and is then refused on every
> subsequent call — which looks like a Bearer defect and is not one. See `0022`.
| TestFlight build | **PENDING — and NOT on artwork.** The icon has been in place since 2026-09-01; the user's re-supplied file was measured **bit-identical** to it. **This document claimed artwork was the blocker for two days after it was cleared**, and `app-agent` flagged the stale line rather than leaving it. The real blockers are the **unconfirmed macOS platform** on the App Store Connect record, and an upload nobody has attempted |
| `Dudo-Core` commit | **PENDING** — everything deployed came from an **uncommitted working tree** off `d35c22b` |
| `Dudo-Apple` commit | **PENDING** — uncommitted, off `555a81f` |

## Verified against the live deployment, 2026-09-05

Not against stubs. Each of these executed against real Cloudflare D1:

```
login                          200   real session cookie, 45 chars
customers BEFORE selection     422   failed_precondition
Organization picker            200   two fields, display_name present-and-null
select organization            200   {"status":"ok"}, no Set-Cookie, as contracted
customers AFTER selection      200
create customer                201
PATCH three-way distinction    phone SET · email CLEARED · country UNCHANGED
```

**The login is the check with no substitute:** it is the only possible proof that
`IDENTITY_LOOKUP_KEY` matches between the seed tool and the Worker, a mismatch that is otherwise
**silent and permanent** — the row writes, the Worker boots, and the account is unreachable forever.

**The PATCH result is the highest-consequence one**, and it is visible as stored data rather than as
an assertion: `country` was omitted from the request and survived. A server treating absent as
`null` would have erased it while reporting success, and no fixture could catch it because a fixture
never round-trips through D1.

### Three defects found by deploying that testing could not reach

1. **The App was never mounted** — the Worker authenticated people and had nowhere to send them.
   `EMPTY_ROUTER` and `NO_APP` were placeholders nobody replaced.
2. **`selectOrganization` had no HTTP route**, and the gap had been filed as *latent* the day before.
   It was blocking, for every principal. See `0021`.
3. **The App's own tenant migration was never applied.** `migrations_dir` is one directory per
   database; the Customer Directory ships its own. The `customer` table did not exist, and every
   read returned 503.

**The third one is the argument for fail-closed, demonstrated.** `0020` specifies that a failed
business-set read **refuses the request rather than continuing with an empty set.** Had it fallen
back to `[]`, the result would have been a plausible empty customer list — and a system shipped with
no customer table, discovered much later with data in it.

---

## What this release contains

**Authentication.** A user can sign in with an email and password and receive a 12-hour session.
Sign-out revokes the session server-side.

**The Customer Directory shell.** Both clients render the directory against the approved contract.
See "What you will actually see" — it is less than the name suggests, deliberately.

### Decisions this release implements

`0014` authentication · `0015` credential format, client-side KDF, and the NFC amendment ·
`0016` the web stack · `0017` interim pre-auth rate limiting · `0018` session revocation ·
`0019` where permission grants live · `0020` the authorized business set.

---

## What you will actually see, stated before you look

**Sign-in works, and the customer list is usable.** It takes both halves of AZ5: `0019` puts an
`owner` role on the membership row, and `0020` fills in which Businesses that role covers. Either
one alone leaves a principal that signs in successfully and is refused on every Action.

**If you do see an empty authorized-business state, it is correct behaviour, not a bug** — it means
the Organization has no Businesses, which a seed without `0020` also produced. It is first-class in
the web client. **On Apple it was a dead end with a permanent spinner until 2026-09-04**; if you meet
a spinner that never resolves next to "Business", that is a defect and worth reporting.

**There is no signup, no password reset, and no way to create a second account** except by running
the operator seed tool. This is `0015` §D's recorded cost, not an omission.

**Sign-out may still fail to revoke at the daily write ceiling — but you are signed out anyway.**
Revocation costs 3 row-writes, and at exhaustion the server-side delete fails while the response
stays fixed. **The clearing cookie is emitted regardless**, so the credential leaves the browser
and the person who pressed Sign out is signed out on that device. The stale server-side session
then expires on its own. See `0018`'s ruling for exactly what survives and who could reach it.

**The one honest failure path is a sign-out that never reached the server** — no network, or the
per-minute rate limit. Then nothing was revoked *and* nothing was cleared, and the client says so
in plain words rather than showing a login screen it cannot justify.

**On Apple, sign-out behaves differently and better, for a structural reason.** The Keychain and
in-memory copies of the credential are discarded **before** the revocation request is sent, and the
request is not awaited — so signing out is immediate and cannot be left half-done by a slow or
failed network. The web client cannot do this: its cookie is `HttpOnly`, so only a server-issued
clearing cookie can remove it, which requires the request to succeed.

The trade is recorded rather than hidden: if the app is terminated within about a second of pressing
Sign Out, the revocation may never reach Core and the server-side session survives its remaining
lifetime. **That surviving session is reachable only by someone who captured the credential *before*
sign-out**, because the device no longer holds it. `0018`'s dead-but-live cookie problem does not
apply to Apple at all — that failure needs a cookie store and a session probe, and this client has
neither.

---

## Test checklist

Each item states what correct looks like, because several correct behaviours look like faults.

### Sign-in

- [ ] Sign in with the seeded credentials. **Expect a 1–4 second pause with a moving progress bar**
      — that is 600,000 PBKDF2 iterations running in your browser, by design (`0015` §D). The tab
      must stay responsive throughout. A frozen tab is a defect.
- [ ] Sign in with a **wrong password**. Expect one fixed message naming neither field — not
      "wrong password", not "no such account". **A message that distinguishes them is a defect**,
      because it would tell an attacker which emails are registered.
- [ ] Sign in with an **email that does not exist**. Expect the **identical** message and a
      similar delay. Any difference in wording or speed is a defect.
- [ ] Sign in with a **leading or trailing space** in the email. Expect local refusal with no
      network request — whitespace is rejected, never trimmed (`0015` §D amendment).
- [ ] Reload after signing in. Expect **no flash of the login screen**.

### Sign-out

- [ ] Sign out. Expect to return to sign-in immediately.
- [ ] After signing out, **reload**. Expect to stay signed out.
- [ ] Open a second tab, sign out in the first, then use the second. **Expect the second to be
      signed out on its next request** — the clearing cookie is browser-wide, not per-tab.
- [ ] **Apple only: sign out, then immediately force-quit the app.** Expect to be signed out on
      relaunch — **that is guaranteed locally regardless of what reached the server.**
- [ ] **Sign out with the network disconnected.** Expect the login screen **plus a warning** that
      Dudo could not be reached, the session may still be active, and to close the browser on a
      shared machine. **A silent return to the login screen here would be a defect** — it would
      claim a sign-out that did not happen.

### The directory

- [ ] With `0019` landed: the customer list loads, and creating, editing, searching and moving a
      customer all work.
- [ ] Without `0019`: an empty authorized-business state. **Correct, not a fault.**
- [ ] Create a customer, then create it again identically. Expect the second to be handled
      cleanly — **never a half-created customer** (`0014` §A.9a).

### Limits, which are features

- [ ] Attempt to sign in ~21 times in a minute. Expect a countdown that **re-enables itself**.
- [ ] If you hit a daily write ceiling, expect a **clear message with a reset time and a `429`** —
      never a silent failure and never a charge (`0008`).

### Cross-client, if both are available

- [ ] Sign in on web, then on Apple, **with the same credentials**. Both must work. **If one
      succeeds and the other refuses, that is a cross-client KDF defect and is the single most
      important thing to report** — it is the failure four independent implementations were checked
      against, and it would mean something regressed after that check.

---

## Evidence, as reported

| Suite | Result |
|---|---|
| Core login harness | 188 passed, 0 failed — **scratchpad only, not yet adopted, not re-runnable** |
| Core entry-point harness | 15 passed, 0 failed — **scratchpad only, not yet adopted, not re-runnable** |
| Core equal-work cases | **adopted into `packages/testing/**`** by QA — its 13 cases folded into QA's restoring implementation |
| Core business-set cases | **adopted into `packages/testing/**`** as `suites/az2-login/business-set.ts` |
| Core role-guard harness | 16 passed, 0 failed — scratchpad only |
| Customer Directory regression | 165 passed, 0 failed, 1 skipped, 166 registered |
| QA independent AZ2 + AZ5 suites | **107 passed, 0 failed, 0 skipped, 0 not run — 107 registered / 107 reported** |
| Customer Directory regression, after skip closed | **166 passed, 0 failed, 0 skipped, 0 not run** |
| Web verification scripts | 177 checks, 0 failed |
| Apple `DudoTests` — macOS (arm64) | 50 passed, 3 suites — **re-run by `qa-agent`** |
| Apple `DudoTests` — iPhone 17 simulator | 50 passed, 3 suites — **re-run by `qa-agent`** |
| Apple `DudoTests` — iPad (A16) simulator | 50 passed, 3 suites — **re-run by `qa-agent`** |
| Apple `DudoTests` — iPad Pro 11" (M4) simulator | **FLAKY ON THIS MACHINE — passes when the run completes.** See the note below; two agents hit it independently |
| Apple builds | Debug and Release × macOS, iPhone, iPad — **all six** succeeded, zero warnings |
| `tsc --noEmit` (Worker scope) | 0 errors |

**Independently verified by `qa-agent`, not the implementing agent:** the equal-work property
(structurally, by comparing derivation traces rather than by stopwatch — all six inputs produce one
identical trace); that the stored value is a hash and **the database-dump attack is refused**; that
tenant resolution fails closed on six distinct causes with no wildcard and no fallback; and that
web and the enrolment tool agree on all nine KDF vectors.

**Not verified, stated plainly:**

- **No end-to-end call against a deployed Core has ever been made.** Both halves of every binding
  have been tested only against stubs.
### Gate step 5: **NOT SATISFIED.** `qa-agent`'s judgement, 2026-09-04, in its own terms

Asked whether Apple's now-re-runnable evidence closed step 5, QA answered no — **and gave a reason
that has nothing to do with Apple.** Recorded verbatim in substance because the Team Lead would not
have arrived at this framing:

> **What is now satisfied:** both clients have exact, itemised, independently reproduced evidence,
> re-run by QA rather than accepted on anyone's word.
>
> **What is not:** step 5 binds to the **feature**, not to the harnesses. **Every binding in this
> slice has been tested only against stubs.** The web transport against a fixture transport, Apple
> against `StubCore`, Core against in-memory SQLite. **Each half is verified; the join between them
> is not verified at all.**

Not executed once, by anyone: a real `Set-Cookie` reaching a real browser · Apple's `Bearer`
reaching the real `revokeHandler` · a real D1 point lookup on a real `identifier_hash` · **the
seeded principal's `IDENTITY_LOOKUP_KEY` matching the deployed Worker's.**

**That last one fails silently**, which is why it is the example that matters: both sides pass
independently while agreeing on nothing. Runbook step 4 now carries the warning.

**The honest label is "both clients fully verified in isolation, integration unverified."** Step 5
becomes satisfiable the moment a staging URL exists to run against — which is blocked on G1 and G2,
both of which are the user's, not the team's.

QA's closing note, and it is the right reading: **"The gate is doing its job here — it is holding
for the right reason."**

### A defect class worth naming, because it appeared three times in one slice

Every instance was found by an implementer while building, none by review, and each would have
produced a **passing test that examined nothing**:

1. A unicode test literal **normalised by the tool that wrote it**, so a composed/decomposed pair
   silently became one string and the comparison tested a value against itself.
2. A **negative test nobody had watched fail** — an assumption with a test-shaped name, until an
   agent mutated a throwaway copy and confirmed both directions went red.
3. `URLSession` converting `httpBody` into `httpBodyStream` **before a `URLProtocol` sees it**, so a
   stub reading `httpBody` observed `nil` on every POST and PATCH, and every assertion about what
   the client sent passed by inspecting an empty value.

**The review question this yields: what would make this assertion pass while examining nothing?**
It is now asked of the Apple test files and should be asked of any new suite.

### The eighth instance, caught in the moment — and the rule that caught it

`core-agent` wrote a success-path assertion, *"a successful read emits NOTHING"*, and it went red:
the harness composes no coordinator, so a different marker fires on every request. **It scoped the
assertion to its own marker rather than widening it to "no output."**

Widening would have gone green — and would have been **testing the harness's shape instead of the
change**, passing for exactly as long as the harness happened to emit something.

**Every earlier instance in this project was found afterwards, by someone else, or by deploying.
This one was caught by its author, on the first red.** Its account of why is the useful part, and it
is not diligence:

> *"The thing that made it catchable wasn't diligence, it was that the red test was **surprising**.
> I expected zero lines and got one, and 'why one?' is a cheaper question than 'how do I get to
> zero?'. The second question is the one that produces a widened assertion."*

**The rule, which is mechanical rather than a matter of care: when a new test goes red, find out what
the actual value is before deciding what the assertion should be.** Reaching for the assertion first
is how a test comes to describe the harness rather than the code.

### A tenth, and it is a different failure entirely — describing your own work in the wrong frame

`core-agent` implemented `0020`, which computes the authorized-business set **through the tenant
handle**. Two days later it predicted the live response would show *"the two Businesses you seeded"*.

**The correct answer is one.** There are two Businesses on the deployment, one per Organization, and
the principal belongs to one Organization. The set is scoped by **tenant**, not by seed count — which
is precisely the property that agent built.

Its own account:

> *"Not an inference about state I couldn't see, but a mis-description of a scoping rule I wrote
> myself two days ago. **The set being smaller than the seed is the property working** — and if my
> own expectation had gone unchallenged, 'one instead of two' is exactly the shape of result someone
> investigates as a bug. Authoring a property does not make me immune to describing it in the wrong
> frame."*

**This is not the empty-assertion class and not the over-conclusion class.** Nothing was unmeasured
and nothing was inferred beyond the evidence. The author knew the rule, had written the rule, and
still described its output in the units of the input.

**The danger is specific: a correct result that contradicts a stated expectation gets investigated as
a defect**, and the investigation starts in the code that is working. The cheapest guard is the one
that caught it here — **state what a property predicts in the property's own units**, and let someone
who did not write it check the arithmetic.

### The ninth, and the most literal one

Found by `qa-agent` while adopting a harness into `packages/testing/**`:

```ts
check('the line contains nothing caller-supplied',
  !whole.includes('customers.ListCustomers') === false || true);
```

**The trailing `|| true` makes it pass unconditionally** — an empty assertion wearing the name of the
most security-relevant check in its file, and the first instance of this class found in a *harness*
rather than in a test or a stub.

It rewrote it to assert what the name claims, against the whole log line rather than the parsed
object, so a value smuggled into a prefix or suffix is caught: no principal id, no request id, no
correlation id, no action id, no app path.

**It passes.** Which makes this the frozen-grants pattern for the second time: **the protection was
real; the check was not checking it.** The code was correct and nothing established that it was.

### The two instances found while fixing the others

`qa-agent`'s own wrong diagnosis — reporting an unselected session as "the 0019/0020 empty-set case"
— was instance eight, in the tool built to catch this class. **And the fix it declined is as
instructive as the one it made.** The Team Lead asked it to correct a URL in CHECK 3; it verified all
four `/api/v1` paths were already correct per contract, and refused:

> *"Changing it would have replaced a correct path with a wrong one on the strength of a symptom that
> had another cause. My wrong diagnosis nearly propagated into a wrong fix."*

**A wrong diagnosis does not stop at a wrong report. It proposes a wrong repair, and the repair is
harder to detect** — because the symptom does disappear.

### An open flake, and a rule it forces about how Apple results are read

**`xcodebuild`'s exit status and its printed "Failing tests" list can disagree with the `.xcresult`
bundle.** Two agents hit this independently on the iPad Pro 11" simulator, hours apart:

- `qa-agent`: four attempts, four different outcomes — 11 "failing tests", a bootstrap error, 26 of
  50, another bootstrap error. **Never a single `✘` assertion failure.**
- `app-agent`: two runs printing `** TEST FAILED **` with ~24 tests listed and **no assertion output
  for any of them**, one logging `mkstemp: No such file or directory`, one reporting "26 tests in 3
  suites" where there are 50.

`app-agent` did not accept it either way. It read the authoritative artifact: **the `.xcresult` from
a "failed" run recorded `"result": "Passed"`, 50 passed, 0 failed.** It then re-ran three more times
with explicit result bundles — `TEST SUCCEEDED`, 50/50 each time — and re-confirmed macOS and iPhone
the same way. Disk was at 26 GiB free and `DerivedData` at 171 MB, so it is not space.

**Assessment: an `xcodebuild` result-bundle/reporting failure, not a product defect.** The evidence
is that no test ever produced a failing assertion, the failures were whole-suite and
non-overlapping between runs, and the bundle from a "failed" run recorded a clean pass. `qa-agent`
independently proved the *platform* is fine by running iPad (A16) at 50/50.

**A LIKELIER CAUSE WAS THEN FOUND, AND IT IS NOT OURS.** `app-agent` ran `pgrep` and found a process
belonging to **a different project on the same machine**:

```
/private/tmp/claude-501/-Users-dr-foulad-Foulad-one/.../scratchpad/ship199.sh
cwd: /Users/dr.foulad/Foulad-one/foulad-apple-worktrees/round11-core-only-integration
```

It runs a 3,000-second loop polling `pgrep -f "xcodebuild -project Dudo"` and watching load average
— **it is waiting for Dudo's builds to finish so it can start its own.** The Team Lead verified it
independently: the script was running, and two `swift-frontend` processes from that other worktree
were **actively compiling at the time of the check.**

**Concurrent simulator and toolchain contention from an unrelated session fits the evidence better
than an `xcodebuild` reporting fault** — whole-suite failures with no failing assertion, an
`mkstemp: No such file or directory`, a run reporting 26 tests where there are 50, and then three
consecutive clean runs once things settled.

**Still recorded as OPEN.** The cause is now *probable* rather than unknown, but nobody has
reproduced it deliberately, and **the machine was never a controlled environment** — which is itself
the finding. It also does not change the rule below, because the rule protects against the failure
mode regardless of what triggers it.

**Practical consequence: a red Apple run on this machine is not evidence of a product defect until
someone checks what else was building.** If the signature recurs, the first question is whether
`ship199.sh` — or anything like it — was running.

**The binding rule this forces:** **read the `.xcresult` bundle, never the exit status or the
printed summary.** A CI job that trusts `xcodebuild`'s exit code will report false failures on this
machine's failure mode, and — the direction that actually matters — **nothing here proves the
inverse cannot happen.** Any Apple result quoted as gate evidence must come from a result bundle.

### A variant: a test whose NAME predicts the wrong future

`qa-agent` wrote a `0019` boundary case named *"this must fail when `0020` lands"*. **`0020` landed
and it did not fail — correctly.** The assumption was that `0020` would fill the business set in
`createMembershipPrincipalAuthorizationSource`. It does not: `0020` is a **split**, so that source
still returns `[]` and the fill happens later in `pipeline.ts`, after the tenant store resolves. The
boundary was real; the name pointed one step too late.

**This is the same defect it had flagged in `write-admission.ts` hours earlier** — a test asserting
something about a record that had already moved — and it had written one itself, in the same
session, while pointing at the other.

It **renamed and re-explained without weakening a single assertion**, pointed the reader at where
the fill *is* verified, and rewrote the failure message to say what a future red would actually
mean: that the source had started reading the tenant database from a point in the order where no
tenant store exists — *a design change needing a decision, not a test update.*

**A test's name and message are load-bearing.** They are what a future reader acts on when it goes
red, and a confident wrong name sends that person to the wrong place with the wrong assumption.

### A fourth, and it is about reporting rather than testing

`core-agent` reported a **median miss/hit ratio of 0.969 over 40 runs** as evidence that login costs
the same whether an account exists or not. Prompted by QA's remark that *"a wall-clock ratio is a
statistical argument about a laptop"*, it re-ran **its own assertion five times against identical
code**:

```
0.969 · 1.835 · 0.683 · 0.895 · 1.044     — failed 2 of 5
```

**The headline figure was one sample from a wide distribution.** QA reading its own difference and
`core-agent`'s as mutually cancelling noise was right, and generous; the sharper statement is that
the test was never sound and its output was presented as a finding.

**It demoted the assertion rather than widening the band**, on the grounds that widening a threshold
to get green is weakening a test to produce a pass — *"which this project forbids QA from doing and
which I am not entitled to do either."* The measurement still prints, so a miss an order of magnitude
cheaper would show; it no longer gates.

**The lesson is not "timing tests are bad".** It is that a number produced once, from a distribution
nobody characterised, is not a measurement — and that the cheapest way to find out is to run the
test again on unchanged code. **A test never re-run against itself is an unexamined claim.**
- The web KDF Web Worker path runs only in a browser; the scripts exercise the fallback.
- Root `tsc --noEmit` **not run** — root dependencies are not installed.
- `packages/testing` is excluded from the root tsconfig, so the test suites are themselves
  unchecked. Closing it needs `@types/node`, which is a dependency decision.

---

## Secrets and sensitive-information review — run 2026-09-05, before any push

`architecture.md` §8 requires this before the first public push. Run against the working tree while
**nothing was yet committed**, which is the only moment it is cheap — a credential in public git
history is compromised on landing and survives file deletion.

| Check | Result |
|---|---|
| `.dev.vars`, `.wrangler/`, both `node_modules` | **all git-ignored** ✓ |
| The three real secret **values**, searched across every tracked and untracked file | **0 hits in 303 files** ✓ |
| Private-key / cloud-credential / token patterns | 3 matches, **all synthetic test vectors** ✓ |
| Email addresses in repository files | **all on RFC 2606 reserved domains** (`example.com`, `example.net`) ✓ |

The three pattern matches are `correct horse battery staple`, `correct-horse-battery-staple-0001`
and `baseline-password-0001` — synthetic by construction, and `security.md` §6 satisfied.

**One decision remains and it is the user's, because git history is not reversible.**
`wrangler.jsonc` now carries two real **D1 `database_id` values**. Cloudflare's own documentation
treats these as ordinary committed configuration, and they are not credentials — they cannot be used
without account authentication. But **both repositories are public**, and the standing instruction
for this project is not to expose account identifiers. The options are to commit them as Cloudflare
intends, or to keep placeholders in the committed file and hold the real values in a git-ignored
local override, at the cost of reproducible deploys. **Not decided here.**

## Gate status

| Step | State |
|---|---|
| 1 — contract approved | **Yes** (`login-v1`, `customer-directory-v1`, `business-read-v1`) |
| 2 — Core passes tests | **Yes** |
| 3 — web deployed to test environment | **YES** — https://dudo-core.sameh-0d2.workers.dev, live and exercised end to end |
| 4 — Apple on internal TestFlight | **No** — blocked on app-icon artwork, a user decision. A test target exists; that is no longer a reason |
| 5 — QA evidence for both | **Partial.** Core and web have full evidence and the deployment is now exercised — but `verify-staging.ts` was written before session routes existed and **never performs the Organization selection step**, so its session stays `organization-not-selected` and it misreads every downstream result as "no authorized Business". Its remaining failures are that one stale assumption, not defects. **`qa-agent` must add the selection step and re-run before step 5 can be judged.** |
| 6 — this package | **Partial** — URL and build number pending |
| 7 — **user acceptance** | **Not sought, and cannot be** |

**Blocked on the user, and only the user:** C5's four billing confirmations, and approval to run
`npm install` and to deploy to staging. Everything else is either done or has a named owner.

# `platform/admin` — Dudo platform-administration console

The operator console for **`https://admin.dudo.work`** (ADR 0010, ADR 0022).

**Every section is live.** Sign-in, the session probe, the Organization list and detail, onboarding
a business, the member resolve, the full Template surface, both audit feeds and the operator roster
all call real, accepted, audited platform routes.

**Both confirmation-gated routes are built** — revoking an operator, and resetting a member's
credential.

### Confirmations

Three properties, and losing any one turns the mechanism into theatre.

- **The statement is server-authored and renders verbatim.** `{challenge.statement}` and nothing
  else — never paraphrased, templated, transformed or composed from the parameters. Core *cannot*
  verify the client displayed it (CF-2 is unclosable), so this is a client obligation. Asserted
  structurally, and negative-controlled: adding a `.replace()` to the render fails two checks.
- **The token is echoed, not remembered** — byte-for-byte as issued.
- **Re-authentication is the operator's OWN password**, through the same login KDF, salted with the
  **operator's own** normalised identifier. Never the target's — that confusion is what made
  `credential-reset-v1` unbuildable for half a day, and is why the fields are now
  `reauth_identifier` and `target_identifier`.

**The binding is derived once.** `buildConfirmedRequest` produces the URL, the bound parameters and
the submission body from **one call**, so the challenge and the submission cannot disagree. Path
parameter names come from the same template string used to build the URL — the template *is* the
declaration. The bound value is the **decoded** segment as a **JSON string**; the URL carries the
encoded form. It refuses a reserved name on either side, a name that is both a path parameter and a
body field, a declared parameter with no value, and a value the template does not declare.

**This client does not canonically serialise.** Sorted-keys/NFC is Core's hashing rule, applied on
both sides — which is why the contract states order is irrelevant. The obligation is that the
*object* matches, not the bytes.

> ### English only, and the console cannot be made to render otherwise
>
> **It never sends `locale`.** No setting, no browser sniff, no code path — so Core cannot return a
> language the console cannot vouch for. Verified absent from the shipped bundle.
>
> **And it checks `statement_locale` anyway rather than trusting its own request.** If it comes back
> as anything but `en`, **the approve control is not rendered at all** — the operator is told the
> statement is in an unrequested language and that nothing was changed. Not warn-and-proceed:
> asking someone to approve a destructive action described in an unreviewed sentence is worse than
> not offering the action. **If it ever happens, it is a Core defect to report.**

### The credential reset, and why the password exists before the challenge

`derived_value` is the **new** credential and is **part of the binding**, so the password must be
generated and derived *before* the challenge is requested.

**That is the point of the flow, not an artefact of it.** Binding `derived_value` makes the human's
approval cover **which credential is written**, not merely that a reset happens — without it, the
statement approved and the credential written could come apart. So the obvious tidy (generate after
approval, to avoid holding a secret) would **silently remove `derived_value` from the binding**.

The trade: hold a generated secret in browser memory across the confirmation, in exchange for the
confirmation covering the credential. The handling is what makes it acceptable — never logged,
never in a URL, never stored; the operator's typed password dropped the moment it is derived from,
the generated one when the panel is dismissed.

> #### If the submission fails after approval, the dangerous case is not failure — it is not knowing
>
> | Outcome | What the operator is told |
> |---|---|
> | `conflict`, `quota_exceeded`, `rate_limited`, `forbidden`, `not_found`, `invalid_argument`, `failed_precondition` | **Nothing happened, the old password still works.** The generated string was never written — do not send it to anyone. |
> | `unavailable`, `timeout`, `internal`, `unauthenticated` | **It is not known whether the reset landed.** The request may have been applied and the answer lost. |
>
> **On an unknown outcome the password is still shown**, labelled as possibly-live. If the write
> landed, this browser holds the only copy and discarding it strands the account permanently;
> showing an inert string costs nothing. The screen names the one action that resolves it — check
> the audit trail or ask the person to try it — and warns against re-running the reset first, which
> would replace a credential that may already be live.
>
> `writeIsCertainlyAbsent` lives in `api/errors.ts` because it is a property of the error code, not
> of a screen — and because a `.tsx` file cannot be loaded by Node's type stripping, so on a screen
> it would have been assertable only by grepping source. It is an **exhaustive switch with no
> `default`**: adding a code to `ERROR_CODES` **fails the build** rather than falling silently into
> the dangerous side. Negative-controlled by adding one and watching `tsc` refuse.

> ### Templates are complete and inert, and the screen says so
>
> `template-v1` **TM-4**: *"Nothing consumes a Template. Organizations have no `template_id`, so
> this capability is COMPLETE AND INERT. Creating a business type changes what no user sees
> until onboarding adds the reference. It must not be reported as 'business types now work'."*
>
> So the Templates screen carries a permanent, non-dismissible notice above its controls saying
> that creating a business type changes nothing a customer sees yet, and naming what will change
> it (onboarding). **This is a third state** — not "blocked on acceptance", not "accepted but
> unimplemented", but **built, working, and connected to nothing.**

It is a sibling of `platform/web` and shares no build, no `package.json`, no session and no
`node_modules` with it.

## Who this is for, and what they cannot do

A **platform operator** is an ordinary principal with a row in `platform_operator`
(ADR 0025) and **zero membership rows** (ADR 0024). That absence is the isolation:

> no membership → no Organization selection → no `TenantStoreResolver` handle → no rows.

**An operator is structurally incapable of reading customer data**, and this console is built
on that assumption throughout. It never calls an Organization-selection route, never expects a
tenant, and has no Organization picker. There is nothing to pick.

## Running it

```
npm install
npm run dev          # http://127.0.0.1:5174
npm run typecheck    # tsc --noEmit
npm run build        # typecheck, then a production build into dist/
npm run verify       # typecheck -> KDF -> platform client -> build -> CSS cascade
npm run verify:kdf       # 56 checks, including byte-identity with platform/web
npm run verify:platform  # 571 checks — Core's shapes, accessibility, time windows, identity
npm run verify:css       # 13 checks against the BUILT stylesheet (needs a build first)
```

`verify` runs the build before `verify:css` on purpose, so the artifact being checked can
never be a stale one.

### Why there is a CSS check at all

**Three navigation defects have now shipped where the markup was correct and the artifact was
wrong**, and on two of them every check in this repository passed:

| Defect | Why the source looked right |
|---|---|
| `inset-block-0` | Not a Tailwind utility. Compiled to **nothing**; the drawer lost its vertical bounds. |
| `lg:` vs `ltr:` | Both classes emitted. The `lg:` one **lost the cascade** — a media query adds no specificity, and the later same-weight rule wins. Sidebar invisible on desktop. |
| `inset-y-0` on the drawer | Valid, emitted, applied — and pinned the drawer to `0` **under the `z-30` sticky header**, hiding the first nav row. |

So `verify:css` asserts **outcomes against the built stylesheet**: that no `ltr:`/`rtl:` rule
overrides a breakpoint-scoped one, that the drawer's off-screen transform is confined to small
screens, that every class used in `src/` actually produced a rule, and that the drawer's top
offset tracks `--dudo-header-height` rather than zero.

**It is not a substitute for looking at the page.** There is no browser available here and none
may be installed, so it checks geometry it can compute, not geometry as rendered. **A visual
check at a single width would have passed two of the three defects above** — a sidebar that is
absent and a menu missing only its first row both look unremarkable.

## The two live routes

| Route | What it does |
|---|---|
| `GET /api/v1/platform/whoami` | The session probe. Returns the operator's own principal id, platform role and reachable permissions. |
| `GET /api/v1/platform/organizations` | The Organization list. Name where one is recorded, identifier, status and creation date, keyset-paginated. |
| `GET /api/v1/platform/templates` | The Template list, keyset-paginated. |
| `GET /api/v1/platform/templates/{template_id}` | One Template. **The first route in this class with a path parameter.** |
| `POST /api/v1/platform/templates` | Create a Template. Sends `name` and optionally `level_labels`. |
| `POST /api/v1/platform/organizations` | **Onboard a business.** Creates the Organization, its first admin, that admin's credential and one `owner` membership. |
| `GET /api/v1/platform/organizations/{id}` | **Organization detail.** Everything the page needs in one request — the Template and the identity block are embedded. |
| `PATCH /api/v1/platform/organizations/{id}/identity` | **Name, CR and VAT registration.** Partial; returns the whole block. `sensitive`, **not confirmation-gated**. |
| `POST /api/v1/platform/organizations/{id}/members/resolve` | **Resolve one member** by a `target_identifier` the operator already holds. |
| `GET /api/v1/platform/audit` | **The platform feed.** Every operator action, **without** the principal-level target. |
| `GET /api/v1/platform/organizations/{id}/audit` | **The Organization feed.** One customer's trail, **with** the principal target. |
| `GET /api/v1/platform/operators` | Who holds platform authority. **List only — no revoke.** |

### The two feeds differ by one field, and that is the security property

The platform feed has **no `target_principal_id`**; the Organization feed has one. Every resolve
record is *"principal P was resolved in Organization O"* — a membership fact — so a bulk read
would collect every one of them in a single request the affected tenants cannot see, aggregating
into the CO1 mapping `organization-detail-v1` refuses.

**They are two types, not one with optional fields.** `PlatformFeedRecord` has no such property to
read, so no screen can render it. Asserted from the client side: **a record that arrives carrying
`target_principal_id` is not carried through the platform parser**, and the value appears nowhere
in the serialised page. Negative-controlled — adding the field to the parser makes two checks fail.

**One shared presentation component**, `AuditRecordList`, renders the seven common fields. It is
parameterised by **layout, never by scope**: it receives `AuditRecordCommon` (which has *neither*
target field) plus a `renderTarget` callback, so it cannot reach a field its caller did not hand
it. Asserted: it names neither target field anywhere.

**The filter sets differ too.** Platform: `page_size, cursor, actor_principal_id, action_id, since,
until`. Organization: the same **minus `actor_principal_id`**. And **neither has a
`target_principal_id` filter** — filtering by a principal and counting results would disclose that
principal's Organizations one bit at a time. The types have no member for it, so this client cannot
send one even by mistake.

### The bounded time window, and the obligation only the client can meet

**Filtered feed queries require a date range of at most 31 days.** It is an availability control,
not a UI preference: both feeds scanned the whole action log, and at 50,000 rows **49 feed requests
exhaust D1's account-wide read allowance** — which stops every query in the platform, including the
session lookup every login performs.

| Feed | A window is required when |
|---|---|
| Platform | `actor_principal_id` **or** `action_id` is present |
| Organization | `action_id` is present — **`organization_id` is exempt**, being a path parameter served by an index |

**The unfiltered feeds need none and must not gain one.** They are already bounded to a page by an
index, so requiring one would remove no reads and would remove *"what happened, ever"*.

> #### An empty windowed result says **"No records in this window"** — never "No records"
>
> **This is the half a contract cannot enforce.** Core refuses an omitted window so an operator
> cannot receive a silently narrowed answer. **Nothing stops them misreading a correctly narrow
> one.** An investigator who filters by an operator, sees an empty page and concludes *"this person
> did nothing"* has drawn a conclusion the data does not support — and on an evidence surface that
> is **indistinguishable from evidence of innocence**.
>
> So the window is named in the sentence the operator reads when there is nothing there, together
> with *"records outside this range were not searched"*. Not a footnote, not a tooltip. Asserted in
> the source and negative-controlled: changing the headline to "No records." fails two checks.

**The three refusals stay distinct** — `time_window_required`, `time_window_too_wide`,
`time_window_inverted` — because they need three different actions and one sentence cannot say
which. **This is the opposite case from the member resolve**, where five causes collapse *because*
distinguishing them would disclose membership; here nothing is disclosed by saying which end of a
date range is wrong. **The 31-day limit is named** in the message: a span limit is a constant, not a
fact about data.

**Walking backwards** is `Earlier window` / `Later window`, which shift by the window's **own
length** — so the span is preserved (a shifted legal window stays legal) and consecutive windows
**tile with no gap and no overlap**. They rewrite the dates and **fire no request**; the operator
presses Apply, because every window costs 2 control-plane row-writes against a 600/day ceiling.

> An earlier version shifted by a **calendar month** and produced invalid windows: `1 Sep – 1 Oct`
> is 31 days, and one month earlier is `1 Aug – 1 Sep`, which is **32** — over the limit, refused by
> Core, and reached by pressing a button this console offered. Months are not a fixed length; a span
> limit is. It also overlapped on the shared boundary day, double-counting records.
>
> **Changing the shift turned nothing red, and left two sentences behind that still described the
> old behaviour** — the too-wide refusal said the controls "move the range by a month", and the
> empty state said "Move the range back a month to keep looking." Both were found by reading. There
> is now a check that no sentence in either audit screen or in `audit-window.ts` claims the control
> moves by a month, with the two shipped sentences as its known-failing inputs.

#### `MAX_WINDOW_DAYS` is asserted against the contract file, not just documented

The limit is a **number transcribed out of a document**, and it now lives in at least three places —
the contract, Core's validator, and this console's constant. Until the check existed, nothing
compared them: if the limit narrowed to 14, this console would go on refusing at 31 and an operator
would meet Core's refusal for a request the screen said was fine.

`verify:platform` reads `packages/contracts/core/platform/platform-audit-read-v1.contract.yaml` and
binds `MAX_WINDOW_DAYS` to **four independent sentences** in it — the ruling (which spells the number
in words and carries no digit), the refusal rule, the request specification, and the QA boundary
case, whose *refused* span must be exactly one more than the accepted one. A **floor** requires all
four to have been *found*, so a rewrite that removes them goes red rather than quiet.

Three negative controls ship with it, because a check that has never failed is observed rather than
verified: a console constant of `14` must be caught by all four anchors; an empty contract must
report four `MISSING` and zero passes; and moving the contract's refused boundary from 32 to 33 must
go red — with a further assertion that the mutation actually applied, since a no-op control controls
nothing.

**What it does not close.** It binds the console to the *contract*. It does **not** bind either to
Core's validator. If Core's code and Core's contract disagree, every check here stays green. The
residual gap is real and it is narrower than the one before it.

### Reading an Organization's trail writes to it

Five tenant row-writes per page, against that customer's own daily allowance, plus two
control-plane. So the Organization feed is **the only screen in this console that does not load on
mount** — arriving at the address, or landing there from a mistyped link, costs the customer
nothing. The operator presses *Read the trail*, having been told the cost first. No polling, no
focus refetch, no page-2 prefetch, no automatic retry, anywhere.

That trail contains reads of itself, so an operator finds their own earlier visits in it. That is
stated on screen so nobody reports it as a defect.

### Two refusals that mean opposite things

| | Means | Rendered |
|---|---|---|
| `rate_limited` | **The platform** has spent its share of this customer's day — about **operator activity** | Gold. Offers a retry. |
| `quota_exceeded` | **The customer** is at their own allocation — about **the customer** | Azure. **No retry offered** — it will not clear before 00:00 UTC, and retrying spends what they have left on a refusal. |

Merging them produces a retry, which is the behaviour the ceilings exist to stop. `CeilingNotice`
takes a `scope` that selects **whose ledger the message describes**, never what is disclosed.

### Time filters are built, not passed through

A date input yields `YYYY-MM-DD`: no time, no zone, and a zoneless timestamp is refused
deliberately because engines disagree on whether to read it as local or UTC.

**The contract underspecifies these twice**, and both are reported rather than resolved quietly:
it names `since` and `until` and states **neither their format nor their inclusivity**.

- **Format:** taken as the form the schema gives `occurred_at` — RFC 3339 UTC.
- **Day:** the typed date is a **UTC calendar day**, and the fields are labelled UTC. An audit
  trail is read by more than one person at once, and two operators discussing "the 5th" must mean
  the same window or they are comparing different evidence.
- **The bounds are `[since, until)` — half-open — with exactly three fractional digits.** The
  start is `…T00:00:00.000Z`; the end is **the next day** at `…T00:00:00.000Z`.

  > **The width is a correctness rule, not a style one.** Comparison against stored timestamps is
  > **lexicographic**, which equals temporal comparison only when both operands are the same width.
  > At index 19 a stored value has `.` (0x2E) and a bound without a fractional part has `Z` (0x5A),
  > and `.` sorts first — so a fractionless bound shifts **forward by up to a second**.
  > `until=…T23:59:59Z` over-includes; **`since=…T00:00:00Z` silently drops every record in second
  > 00, which this console was shipping.**

  Built with `toISOString()` rather than string concatenation, because it **cannot** emit another
  width — a literal is one edit away from losing its `.000` and nothing would fail. `Date.UTC`
  handles month, year and leap-day rollover; a well-formed but non-existent date such as
  `2026-02-31` is **refused rather than normalised** into a range nobody asked for.

  > **This value has been wrong three times, and the sequence is the useful part.** First
  > `T23:59:59Z`, justified by a claim about Core nobody had read. Then `T23:59:59.999Z` with the
  > **same false premise cited harder** — "the contract says so three times" — which is worse,
  > because a confident citation is what stops the next reader checking. Then still wrong, because
  > the interval turned out to be half-open. The contract's "second precision" sentences are about
  > timestamps *colliding* in a burst, not about what is stored; `clock.ts:26` says **millisecond**.

- **A UTC day is not the operator's day**, and that is known rather than overlooked. Someone
  investigating "yesterday" from a local picker gets a window offset by their zone. It is accepted
  for now because an audit trail is read by several people at once and "the 5th" must mean one
  window — and because the fields are labelled UTC and records render in UTC, so the offset is
  **visible rather than silent**. Changing it is a product decision.

**Record timestamps are rendered in UTC and labelled**, for the same reason. A screen that filters
in UTC and renders in local time makes the boundary rows appear to contradict the filter: an
operator west of UTC asks for the 5th, sees rows stamped the 4th, and concludes the filter is
broken. Either consistently is defensible; the mixture is worse than both.

### No revoke UI

`platform.operators.revoke` is the first confirmation-gated route in Dudo — server-authored
statement rendered verbatim, echoed token, re-authentication. That is its own design problem.
**There is no revoke button, no menu, and no disabled control hinting at one**, because a greyed-out
button is a promise. Asserted: no screen calls it and the client exposes no method for it.

### The collapsed refusal, and how this console avoids rebuilding the oracle

`platform.organizations.members.resolve` returns **one argument-free 404 for five conditions** —
unknown Organization, identifier belonging to nobody, identifier belonging to a non-member,
suspended membership, and **the principal is a platform operator**. The fifth is the one that
matters: without it the route is an oracle for who holds platform authority.

> #### The request field is `target_identifier`, and it moved because a bare name says nothing about *whose*
>
> `architecture.md` §1a: a field name defined by a cross-cutting mechanism is reserved
> platform-wide with one meaning. `confirmation-v1` injects `reauth_identifier` — **the caller's
> own** — into request shapes it does not own, and a bare `identifier` beside it is one word two
> contracts can each use correctly while meaning **different people**. This one is the target's.
>
> **This client sent `identifier` until 2026-09-07 and that was correct**, which is the
> uncomfortable part: the contract published `target_identifier` while Core's route declared
> `identifier`, and the resolve worked because this file was written against the running code
> rather than the document. **A contract that has stopped describing the code has stopped being the
> source of truth**, and a client noticing it is the last line of defence rather than a control.
>
> **Sending both is refused** with `must_not_send_both_names` — if the two values differ, choosing
> silently is choosing *which principal to resolve*. The body is a single unconditional literal, so
> "never both" is a property of the code rather than a rule someone remembers, and `verify:platform`
> asserts the legacy name is **absent** rather than only that the new one is present. It also
> asserts the value is a string: Core's reading side carried the mirror hazard, where
> `target_identifier ?? identifier` treats an **explicit null** as absent and quietly resolves the
> legacy value.
>
> The order was Core accepts both → this client moves → Core and the contract drop the old name in
> one change (`0034`, `OD-5`). Moving before the first would have been an outage; dropping before
> the second would have been the other one.

**Core enforces that. `OrganizationDetail.tsx` could destroy it, and is written so it cannot:**

- **One refusal string** — a module constant, no parameters, no interpolation, referenced once.
- **One code path, one visual state.** Every `404` produces `{ kind: 'refused' }`, which
  **carries no payload** — no error, no request id, no `details`. Nothing downstream can branch on
  the cause because nothing downstream has it. That is enforced by the type.
- **No logging anywhere on the screen**, on any branch.
- **One request either way**, so a hit and a miss take the same round trip.

`verify:platform` asserts all of this **structurally against the source**, including that a `404`
carrying `details` naming the cause still produces the identical outcome. Negative-controlled: a
`console.log` of `error.details` on the refusal path makes two checks fail.

**`forbidden` is deliberately distinct.** The resolve declares `core.credential.reset`, so a
revoked grant closes the lookup entirely — rendering that as "found nothing" would invite endless
re-probing, each attempt writing into a customer's audit log.

**One local decision, stated because it is the only one:** a malformed identifier is refused before
submitting. That separates well-formed from malformed — a fact the operator already holds — and
cannot separate any two of the five cases, since all five need a well-formed identifier to reach
Core. It also spares a customer's log an audit record for a typo.

> **The ASCII restriction is the contract's, not this console's.** Dudo has never accepted
> non-ASCII identifiers: `0015` §D, `login-v1`, and both platform schemas carry the
> machine-readable pattern `^[\x21-\x7E]*@[\x21-\x7E]*$`. This console is **enforcing** a stated
> restriction, not narrowing one — the gap is in Core, where two call sites do not yet apply it,
> and it is being closed there. **Do not remove this check, and do not widen it if Core is ever
> observed accepting something it refuses.** A client that submits what the contract forbids is
> broken whether or not the server catches it.
>
> **The local refusal is still rendered differently from the server one**, and that requirement
> survives the correction unchanged: a refusal produced *here* means the address was never sent,
> and an operator who read that as "no match" would tell a customer something false.

### There is no member list, and it is not missing

**No route in Dudo returns member identities.** `member_count` is a count and renders as one — no
roster, no "view all members", no pagination toward one, no empty table. A count does not invert; a
list across every Organization an operator can already enumerate would reconstruct every person's
membership, which `core-object-registry.yaml` CO1 forbids by name. **If the page looks like it is
missing a list, that is the correct appearance.**

**Every resolve writes a tenant-side audit record into the customer's own log, including
refusals** — the probe is what is recorded, not the answer.

> **The record is written and the customer cannot yet read it.** `0028`'s amendment of 2026-09-05
> strikes "tenant-visible" from its own residual: `core.audit.read` is catalogued at organization
> scope and **has no route**, so this surface is *auditable rather than audited* — the evidence is
> captured and the party it protects cannot see it. **The screen therefore says "recorded in", not
> "visible to".** It said the latter, which was false, and the amendment warns specifically against
> citing `0028` for a control that has never worked.
>
> The discipline matters more for it, not less: the records are permanent and become readable when
> the tenant-side route lands, so every speculative call made today is a line in a customer's log
> they will eventually read.

So the resolve fires on explicit submit only: no lookup-as-you-type, no debounce, no prefetch, no
retry-on-blur, no automatic retry. **And the detail read is never polled** — at 2 row-writes a
call, a thirty-second refresh loop exhausts an operator's daily ceiling in about two and a half
hours and then answers 503.

### Organization identity — a name, a CR and a VAT registration

`organization-identity-v1`, `PATCH /platform/organizations/{id}/identity`. The block is embedded in
the detail response and returned whole by the update, so **saving does not re-read** — a partial
response would have to be guessed at, a whole block cannot.

> #### There is deliberately no "this cannot be saved yet" banner
>
> **`0015_organization_identity.sql` and `0016` are applied** (approved and verified against the
> database on 2026-09-07), and **`core.platform-organization.update` is granted to `platform-admin`**
> — `reachablePlatformPermissions('platform-admin')` returns nine, including it. An operator with
> that role can save.
>
> > **Both of those sentences read the opposite way in an earlier draft of this file, and the
> > correction is worth keeping.** The permission's *declaring* commit said it was held by no role;
> > a later commit granted it, and the held-by-nobody state lasted one day. **A commit message is a
> > claim about the moment it was written and never updates** — `architecture.md` §3c with a commit
> > message in the citation's place. The stale premise had already reached a release note before it
> > was caught.
>
> The `403` copy is kept, because it is correct for a role that genuinely lacks the permission —
> what was wrong was only the expectation that every save hits it.
>
> **No banner is added, and that is the decision rather than an omission.** A "this cannot be saved
> yet" banner would be a *deployment fact transcribed into a client*, with nothing to turn it off
> when the state changes — the stale-assertion shape `workflow.md` §12 exists for, in a place an
> operator reads rather than an engineer. The above is the worked example: the fact moved within a
> day. The honest failure paths already say what happened and that nothing was changed.

#### The verification record is the point, so it is rendered

The route is **`sensitive`, not `critical`, so there is no confirmation gate on it** — and that was
argued rather than defaulted: making a VAT field critical generalises to every field and the rung
stops sorting anything. **The whole argument for skipping the gate is that verification acts at the
point of harm instead** — a future surface that prints a VAT number onto a document must be able to
refuse to print an unverified one.

> **A screen that shows the number and hides whether anyone checked it destroys that argument.** So
> an unverified number is *visibly* unverified, and a verified one names the operator and the date.
> There is no state in which a number appears without its provenance beside it, and the console
> does not reach for `requestConfirmation`, `ConfirmationGate` or `confirmation_id` anywhere on this
> path — asserted, not intended.

#### Three states, and collapsing the first two is the defect

| | |
|---|---|
| `not_recorded` | **Nobody has asked.** The state every existing Organization is in. |
| `not_registered` | **The customer stated they have none** — legitimate, permanent, positive. Bahrain VAT registration is mandatory above a threshold and voluntary below it. |
| `registered` | A number is recorded, **verified or not**. |

Merged, you cannot tell "they told us" from "we never asked", so you cannot decide whether to prompt
and cannot defend the record afterwards. **`not_registered` is rendered as an answer, not as a
gap** — a console that showed it as missing data would keep prompting a customer who has already
replied. A fourth state this build has never heard of renders as *unrecognised*, verbatim, rather
than being mapped onto `not_recorded`: telling an operator nobody had asked, when the truth is that
the console cannot read the answer, is a false statement about a customer.

#### Editing a number clears its verification, and the form shows that before the press

A verification attests to **one specific value**. Carrying it across an edited number would say an
operator checked a number nobody ever checked, with a real name and a real date attached — **worse
than an unverified number, because it defends itself.** Core discards the verification on any change
to `number`; **this form mirrors that in the UI** by unticking the box the moment the number differs,
and saying why. A box left ticked from the previous value is an operator claiming to have checked a
number they have just replaced.

The tick is worded as a first-person claim — *"I have checked this number against Sijilat"* — and
not as a status, because **Dudo cannot confirm a check happened**: there is no Sijilat API and no NBR
API. What makes it worth having is that the claim is attributed and dated.

#### Nothing is sent that did not change

The update is partial, and **re-sending an unchanged field is not a no-op** — it re-stamps
`declared_at`, or the verifying operator and date, destroying the original provenance. So the body is
a **diff** against what was loaded, the count of fields that will be sent is shown before the press,
and a save with nothing changed is refused locally: an empty body is `invalid_argument`, and *"a
no-op here still writes a platform audit record and five row-writes into the customer's own daily
allocation."*

Re-dating an existing `not_registered` declaration is possible and is an **explicit tick** ("the
customer has told me this again today"), never a side effect of pressing Save.

#### No digit count, deliberately

Bahrain VAT account numbers are widely reported as fifteen digits. **That figure is not in the
pattern**, and its absence is a ruling: **a pattern is a refusal**, and an at-count pattern that is
wrong refuses a *legal* registration — the failure landing on a customer who cannot be onboarded and
an operator whose only remedy is to invent a value. The console enforces the contract's hygiene bound
and nothing more, and `verify:platform` asserts six plausible shapes are accepted so that narrowing
it locally turns red.

#### The name is not unique, so the identifier stays on screen

Nothing in Dudo enforces uniqueness on `display_name` — *"two Organizations legitimately share a name
in one market."* A list showing names alone would render two different businesses identically, on the
screen an operator uses to choose which customer to act on. **The name is the label; the identifier
is the identity, and both are shown.**

`display_name: null` means **no name has ever been recorded** and is rendered as a real state, not a
blank, not a dash, and never *"Unnamed Organization"* — an invented name is indistinguishable from a
typed one forever. `verify:platform` asserts no screen renders a placeholder, over source with
comments stripped, because all three screens *quote* the prohibition and a check over raw source
fails against a file that is correct precisely because it explains the rule.

#### The two bounds are asserted against the schema file

`MAX_DISPLAY_NAME_LENGTH` and `MAX_REGISTRATION_NUMBER_LENGTH`, both patterns, both `oneOf` state
lists, and the absence of every server-stamped field from the input shape are compared against
`organization-identity-v1.schema.json` on every run — the same treatment `MAX_WINDOW_DAYS` gets, for
the same reason. It reads the **`.schema.json`** and not the `.contract.yaml`, which was being edited
by another agent while this was written. **It binds the console to the contract, not to Core's
validator.**

### Onboarding: this browser holds the only copy of the password

`0026` option B — **the console generates the password and derives from it**, and
`onboardOrganizationOutput` carries **no credential field of any kind**. Core stores a verifier it
cannot invert, so if this screen loses the value the account is unreachable and the only remedy is
a credential reset.

- 24 CSPRNG bytes, base64url, 32 characters, ~192 bits — matching `seed-principal.ts` exactly.
  The generator lives in its own module (`api/generate-password.ts`) **so the real function can be
  imported by a shared suite**; `onboarding-credential.ts` imports the Web Worker and cannot be.

  > **`api/generate-password.ts` carries the only explicit `.ts` import extension in `src/`, and
  > it is load-bearing.** Splitting the module out was not sufficient: a **bare Node loader** — one
  > without this project's `scripts/node-resolve-*.mjs` hooks — cannot resolve an extensionless
  > relative import, so `packages/testing` could not import it and was generating passwords in a
  > fixture instead. `0017` records that the pre-auth rate limiter "does not bind across isolates,
  > so the entropy of this string is what is actually protecting the account" — **the generator is
  > the control**, and it was the one leg of the credential path with no shared assertion.
  >
  > **The rest of the tree must stay extensionless.** `api/kdf-client.ts` and `api/kdf-worker.ts`
  > are byte-identical copies of `platform/web`'s and are compared character for character;
  > converting them would break the cross-client drift check to suit a test harness. The mixed
  > style is forced, not careless. `allowImportingTsExtensions` is enabled for this one import —
  > legal because `noEmit` is true, and permissive rather than mandatory.
  >
  > **What a bare loader can and cannot reach:** `kdf.ts` ✓ (imports nothing) ·
  > `generate-password.ts` ✓ (explicit extension) · `kdf-client.ts`, `onboarding-credential.ts`,
  > `platform.ts` ✗ — extensionless, and `kdf-client.ts` can never change.
- The derivation is **`deriveLogin` — the same code path a person signing in uses.** It is called,
  not reimplemented: if onboarding derived differently from login, the account would be created and
  could never be signed into, and the failure would appear only when a real customer first tried.
- **The password is not rendered until Core answers 201.** Showing it beside a request that then
  failed hands an operator a credential for an account that does not exist.
- Never persisted, never logged, never in a URL. Dismissing the panel takes a deliberate
  confirmation, because a mis-click there destroys the only copy.
- The screen states `0026`'s accepted cost plainly: **there is no self-service password change**,
  so whoever onboards a business knows that admin's password until an operator resets it.

#### The name at onboarding, and the two registrations that are not asked for

`display_name` is **optional** on this write path — Team Lead ruling, 2026-09-07, on sequencing
rather than design: *"a server requiring a field the deployed console does not yet send is an
onboarding outage."* So the form accepts a name and never requires one.

> **It was briefly unsendable, and the reason outlives the gate that held it shut.** The contract
> published the field while `platform.organizations.create` declared only four —
> `admin_identifier`, `template_id`, `first_workspace_name`, `derived_value`. The platform class
> refuses any **undeclared** field *before authentication*, so a client that trusted the contract
> would have failed the first request carrying it and **every one after it**, on the route that
> creates customers.
>
> **So reading the contract was not evidence that Core accepted the field.** That is the sentence
> worth keeping. Core landed it the same day — declared, parsed optionally with the same check the
> update route uses, persisted as NULL when absent, nothing synthesised.
>
> This is the **mirror of the ruling that governs the field**. `0031` makes `display_name` optional
> so that a server requiring what the client does not send cannot cause an outage; the opposite
> direction was open, and it was open *because the contract said the field was there*.
>
> **The gate is deleted rather than pinned to `true`, and so are the checks that guarded it.** A
> flag that can no longer move keeps an unreachable branch alive — and the unreachable half here was
> a paragraph telling operators the name is recorded somewhere else, which is now **false**. Dead
> prose in a client is a stale assertion waiting for someone to re-enable it, so the branch went
> with the gate. `verify:platform` asserts the gate is gone and that the paragraph went with it.

**The CR and the VAT registration are not on this form, and that is the contract rather than a
choice.** `onboardOrganizationInput` is `additionalProperties: false` over five fields and has no
field for either; every Organization starts `not_recorded`. They are recorded on the detail page,
which the success panel links to — **a link and not a redirect**, since navigating away from that
screen destroys the only copy of the password.

An empty name is **omitted, never sent as `''`**: "absent" and "present and empty" are different
requests, and `minLength: 1` would turn a blank optional field into a validation error.

**The Workspace name is not asked for.** `first_workspace_name` is required by the contract,
validated by Core, and **discarded** — `business` has exactly two columns and naming belongs to the
organization-structure slice. The client sends a fixed, self-describing placeholder and the screen
explains the absence where an operator would look for the field. **Accepting and discarding is
worse than not accepting:** an operator who types "Main Campus" and watches it vanish has been lied
to by the form, and nothing is preserved for later.

**A `201` with warnings is a success, not a failure.** `workspace_id: null` plus
`first_workspace_not_created` means the Organization, the admin and the credential all exist and a
tenant-side write did not. It is rendered prominently and **not** as an error — treating it as one
would make an operator discard a live credential for a real customer.

**Two things about `create` that are easy to get wrong, and are asserted in `verify:platform`:**

- **A blank label is omitted, never sent as `""`.** Core refuses a zero-length label with
  `out_of_range`, so sending an empty string for "leave it default" turns a blank field into a
  validation error. **Omission is what selects the default**, and the client never applies the
  default itself — Core always returns all three labels, which is what stops the web and Apple
  clients drifting into different ideas of what an unlabelled level is called.
- **Any `2xx` is success.** This client accepts 200 and 201 alike, and that is now belt-and-braces
  rather than a workaround. **It was a real divergence and it has been fixed:** `template-v1`
  declared `successStatus: 201` while `http/api.ts` hardcoded 200 for every platform route.
  `core-agent` added `successStatus` to `PlatformRoute` and `api.ts` now honours it, so Core
  returns **201** for both `templates.create` and `organizations.create`. Accepting either still
  costs nothing and means this client cannot break on a status change alone.

**And one about errors:** `rate_limited` and `quota_exceeded` **share HTTP 429**
(`kernel/errors.ts`), so the status cannot tell them apart. The client reads the **code from the
envelope body** and falls back to the status only when the body is unreadable. Mislabelling a
quota refusal as a rate limit would tell an operator to wait a moment when waiting cannot help.

**The success body is the response — there is no envelope.** `data` and `next_cursor` are
top-level keys. This was read off the implementation (`platform-routes.ts` ends with
`ok(outcome.value.body)`, `http/api.ts:364` hands it to `renderSuccess`, `http/response.ts:102`
is a bare `JSON.stringify`) rather than assumed from the schema, and `verify:platform` asserts
that an **enveloped body is refused** rather than silently misread.

**Every call on this class writes an audit record — including the reads.** So this console
**never polls**: no interval, no refetch on focus, no refetch on reconnect, no speculative
prefetch, and no automatic retry. The probe runs once per page load and on a button. A
`whoami` on a timer would fill the log that exists to record what operators *did*.

**These routes 404 on `app.dudo.work` and `api.dudo.work`** by construction — `http/api.ts`
binds the class to an admin host list and answers the same `404` for "wrong host" and "class
not composed", so a caller cannot tell them apart. Verified in `workerd`, including a caller
holding a **valid operator session still getting `404` on the wrong host**.

> ### Do not test host-dependent behaviour through `wrangler dev`
>
> When a `custom_domain` route is configured, **`wrangler dev` overwrites the caller's `Host`
> header before the Worker runs.** Five `curl`s with five different `Host` values all arrive as
> the same host, so the 404-on-the-wrong-host behaviour above **cannot be observed that way** —
> and the result looks like a defect that is not there. One was reported and disproved with a
> probe Worker that echoes what the Worker actually sees. Use `workerd` directly, or a probe
> Worker, for anything that depends on the host.

### There is no fixture or demo mode, deliberately

`platform/web` has a `fixture` transport that answers its own requests. **This console does
not**, and will not. ADR 0010's adoption audit removed fake APIs and placeholder data with the
reason stated in full:

> Dudo shows Core-backed truth only. **Fabricated data in an admin console is worse than no
> data — an operator cannot tell it from real.**

**The consequence is real and accepted:** `npm run dev` on its own renders the sign-in screen
and then fails honestly, because nothing is serving `/auth/login/complete` on
`127.0.0.1:5174`. To exercise sign-in you need Core running **on the same origin** — not on a
different port. See the next section for why a different port cannot work.

What *is* exercisable without a server is the client's reading of Core: `npm run verify:platform`
drives the real `platform.ts` through an injected `fetch` against the exact shapes Core emits,
including the failure envelopes. That is a shape check, not a substitute for a live run.

**Sign-in has still never run against a live Core.** It is honest to say the KDF is verified and
the sign-in path is not.

### The API must be same-origin. This is not a preference.

The session credential is a cookie Core sets with `HttpOnly; Secure; SameSite=Lax; Path=/` and
**no `Domain` attribute**, and Core sets no CORS credential headers. A cookie with no `Domain`
goes only to the exact host that set it. A build pointed at another origin would appear to sign
in and then be refused on every call afterwards, with nothing in the UI to say why.

`src/api/config.ts` therefore **throws at module load** on a cross-origin
`VITE_DUDO_ADMIN_API_BASE_URL`, and `src/main.tsx` renders that error rather than leaving a
white page. ADR 0022 considered and rejected both ways around it — broadening the cookie with
`Domain=dudo.work`, and CORS with credentials. Neither is a client flag to override.

### Build-time variables

All are optional, all are embedded in the public bundle, and **none may ever hold a secret.**

| Variable | Default | Meaning |
|---|---|---|
| `VITE_DUDO_ADMIN_API_BASE_URL` | `''` (same origin) | An origin. A cross-origin value is refused at load. |
| `VITE_DUDO_ADMIN_API_TIMEOUT_MS` | `20000` | Clamped to 1,000–120,000. Sign-in uses at least 30,000. |
| `VITE_DUDO_ADMIN_BUILD_LABEL` | `unlabelled build` | Shown in the header. **Not a version number.** |

They are prefixed `VITE_DUDO_ADMIN_` rather than `VITE_DUDO_` so a `.env` meant for
`platform/web` cannot silently configure this console.

## The key derivation is a copy, and drift is checked mechanically

`src/api/kdf.ts`, `kdf-client.ts` and `kdf-worker.ts` are **deliberate copies** of
`platform/web`'s. They are copied rather than imported because the two clients are separately
owned (`.claude/rules/architecture.md` §2) and a relative import across that boundary would be
a source dependency between two independently deployed applications.

**A copy kept in step by a comment is a copy that drifts.** So `npm run verify:kdf` reads the
web client's files and compares them character for character — `kdf.ts` from its
`Normative constants` banner onwards, the other two in full — and **fails** if either side was
edited without the other.

The derivation is a **four-implementation contract**: this console, `platform/web`,
`Dudo-Apple` in Swift, and `platform/core/identity/credential-store.ts`. If they do not produce
byte-identical output, a person who enrols on one client cannot sign in on another. Changing it
is a contract change that goes to the Team Lead and lands in all four — never a local edit.

## Session state: four answers, and the one that must not become a loop

The shell could not confirm a session was live and shipped an honest "Session not verified"
banner. `platform.session.whoami` is now accepted and implemented, so **the banner is gone
because it was answered**, not because it got annoying. The probe returns one of four things:

| Probe result | Console state | Why |
|---|---|---|
| `200` | signed in | Verified, and the caller is an operator. |
| `401` | sign-in screen | No usable credential. |
| `403` | **its own screen** | Signed in, and refused by the platform class. |
| anything else | loading + retry | An unreachable server says nothing about a session. |

**A `403` is not a `401`, and rendering it as one builds an infinite loop** — the person would
sign in successfully and be refused again, forever, with the form implying their password was
wrong. `0021` documents the same shape for the Organization picker.

**And the console never says *why* it was refused.** `platform-operator-v1` collapses four
conditions into one argument-free `forbidden` — no `platform_operator` row, an unrecognised
role, a role lacking the permission, or **a principal present in both tables** — because a
caller who could tell them apart could use these routes to probe `organization_membership`. A
friendly "you are not a platform operator" would be unsupported, and on the fourth condition
actively wrong.

None of this is a security boundary. Core authorizes every platform route on every call, and
ADR 0010 §7 is explicit — **hiding a menu or a button is never an authorization control.** The
permission list `whoami` returns is for rendering only and nothing branches on it.

## Layout

> **⚠ THIS BLOCK WAS WRONG IN NINE PLACES AND WAS REBUILT FROM `find` ON 2026-09-09.**
> It named `api/kdf*.ts`, `components/ui/*`, `lib/router.ts` and `lib/cn.ts` — **all four
> deleted** by the router migration and the `@dudo/ui` / `@dudo/client-kdf` moves — and it
> was **missing** `lib/clients.ts`, `lib/queries.ts`, `lib/query-client.ts`, `lib/routes.ts`,
> the whole `routes/` directory, three components and `scripts/smoke.mjs`.
>
> **A FILE LISTING GOES STALE IN A WAY NO SWEEP FOR A DELETED PATH CAN FIND.** Grepping for a
> removed path finds prose that NAMES it — that is how `verify-kdf.mjs` was caught on the line
> below. **It cannot find an entry that should be here and is not**, because a missing line
> matches nothing. A listing is stale on two axes and the search only covers one.
>
> **So this block is derived from `find`, not maintained by hand**, and the count is stated so
> that a listing which has stopped tracking the tree says so instead of reading as complete:
> **43 files.**

```
src/
  api/
    auth.ts                              sign-in and sign-out against login-v1
    platform.ts                          the platform route class; parses, never casts
    platform-session.ts                  the probe, and its four answers
    confirmation.ts                      the binding: body-minus-three UNION path params
    audit-window.ts                      the window rule, shared by both audit screens
    generate-password.ts                 24 CSPRNG bytes; split out so it is testable
    onboarding-credential.ts             generates and derives; the server sees neither
    config.ts                            build config; refuses a cross-origin API
    errors.ts                            the shared error envelope, console wording
  components/
    AdminShell.tsx                       header, sidebar, main; drawer below lg
    AdminField.tsx                       Field with announce="assertive" defaulted once
    StateBlock.tsx                       loading / error / empty, drawn once
    AuditRecordList.tsx                  the seven shared fields; layout only, never scope
    CeilingNotice.tsx                    rate_limited vs quota_exceeded, never merged
    WindowRefusal.tsx                    the three window tokens, kept distinct
    ConfirmationGate.tsx                 verbatim statement, re-auth, echoed token
    OrganizationIdentity.tsx             name and the two registrations; not gated
    NotBuiltYet.tsx                      the honest "not built" state
  lib/
    clients.ts                           ONE of each client, at module scope — whoami audits
    queries.ts                           every read and write; the audited-call accounting
    query-client.ts                      the four request-adding defaults, off, with reasons
    routes.ts                            the section paths; a LEAF module, imports nothing
    operator-context.tsx                 whoami for rendering; useWhoami() throws, never null
    use-session.ts                       the operator session state machine
  routes/
    route-tree.tsx                       TanStack Router, code-based, path routing
    root-layout.tsx                      the shell around every section
  screens/
    SignIn.tsx                           sign-in with measured KDF progress
    Organizations.tsx                    LIVE — the Organization list, with onboarding above it
    OrganizationDetail.tsx               LIVE — one Organization; the collapsed-refusal lookup
    OnboardOrganization.tsx              LIVE — the form and the shown-once credential panel
    Templates.tsx                        LIVE — list and create; carries the TM-4 notice
    OrganizationAudit.tsx                LIVE — one customer's trail; does not load on mount
    PlatformAudit.tsx                    LIVE — the oversight feed; no principal target
    Operators.tsx                        LIVE — the roster, with the gated revoke
    ResetCredential.tsx                  LIVE — gated reset; refused vs unknown outcomes
  main.tsx  styles/index.css  vite-env.d.ts
scripts/verify-platform.mjs              the platform client against Core's real shapes
scripts/verify-css.mjs                   every class candidate produces a rule
scripts/smoke.mjs                        a real Chrome; NOT RUN, loudly, when absent
scripts/node-resolve-*.mjs               dev-only ESM hooks so the scripts import real modules
```

**The KDF is not in this tree.** `api/kdf.ts`, `kdf-client.ts` and `kdf-worker.ts` moved into
**`@dudo/client-kdf`** (ADR 0040), and the button, field and other primitives into
**`@dudo/ui`**. There is no host-local copy of either and
`packages/testing/suites/az2-login/enrolment-round-trip.ts` goes red if one reappears.

## The accessibility pass — what is asserted, and what is not

**This is a pass bounded to what a source-and-artifact check can see. It is not an audit.** There
is no browser here and no assistive technology, so everything below asserts that the *structure*
exists — roles, labels, associations, focus moves, logical properties, contrast ratios. **None of
it asserts that a screen reader announces any of it well.** That distinction is the difference
between an accessibility pass and an accessibility claim.

### What was found and fixed

| | |
|---|---|
| **An untyped `<button>` inside a form submits it.** `ConfirmationGate`'s **Cancel** had no `type`, so clicking it fired `onCancel` *and* `onSubmit` — with both re-auth fields filled it would have **carried out the destructive action the operator had just declined.** Same shape in two filter forms. | `Button` now defaults to `type="button"`; submitting controls must say so. |
| **`ink-faint` was 3.24:1 on white**, below WCAG AA's 4.5:1. It renders the uppercase `<dt>` labels at 12px — normal text, and the only thing naming what each value *is*. | Darkened to `#676c79`, the lightest value clearing 4.5:1 on **both** backgrounds it appears on. |
| **A literal `←` does not flip.** In RTL "back" points right, so the arrow aimed away from where the reader came from. | An inline SVG that mirrors with `rtl:-scale-x-100`, `aria-hidden` because the link already says "Back". |
| **The statement could be skipped.** A paragraph is not in the tab order, so someone tabbing to the password field heard nothing about what they were approving. | The statement is the accessible description of both its region **and the approve control**, and focus moves to it when the challenge arrives. |
| **Field errors were announced only on arrival.** `aria-describedby` is read when a user reaches the input — but these errors are set on *submit*, with focus on the button, so nothing was said. | `role="alert"` on the error, safe because every form sets errors on submit and clears them on change. |
| **The reset outcome panels replaced the form silently.** | Both take focus; success is `role="status"`, the uncertain outcome is `role="alert"`. |
| **Duplicate literal ids** in a component used by two screens — `aria-describedby` resolves to the *first* match, so the wrong statement could be announced. | `useId()`. |

### RTL

**No physical inline-axis property survives into the built stylesheet** — asserted across all 250
rules this console's classes produce, and negative-controlled with a probe using `ml-4`/`text-left`.
`left`, `right`, `margin-left`, `padding-right`, `border-left-*`, `text-align: left` and `float` are
all red; block-axis properties are not, because they do not mirror.

**To exercise it, set `dir="rtl"` on `<html>`** (in `index.html` or devtools). There is deliberately
no in-app language switch: the console is English-only by ruling, and a switch would imply an Arabic
UI that does not exist.

### What I could NOT verify

- **That anything is actually announced well.** No screen reader was run. Roles and associations are
  present; whether NVDA, JAWS or VoiceOver reads them in a sensible order is untested.
- **Rendered RTL layout.** The stylesheet is direction-agnostic and asserted so; nobody has looked
  at the console with `dir="rtl"`.
- **Real keyboard traversal.** Focus order follows DOM order and the moves are asserted in source;
  no one has tabbed through it.
- **A real automated audit.** `axe-core` needs a DOM — `jsdom` or a browser — and both are new
  dependencies. Contrast is the one part that is arithmetic, so it is checked here; the rest is not.
- **Anything on `Organizations`, `OrganizationDetail` or `OnboardOrganization`**, which were out of
  scope for this pass.

## Accessibility and internationalisation

Part of the definition of done, not a follow-up (ADR 0010).

- **Logical properties only** — `ps`/`pe`, `ms`/`me`, `border-e`, `start-0`, `text-start`.
  Never `left`/`right`. Arabic is then a `dir` attribute rather than a rewrite.
- A skip link, a real `<nav aria-label>`, `aria-current="page"` on the open section, a focus
  ring that is never removed and is redrawn in gold on navy so it survives the dark chrome.
- The drawer traps nothing but moves focus in on open and back to its button on close, and
  closes on `Escape`.
- The sign-in progress bar is a real `role="progressbar"` with a polite live region, and its
  remaining-time figure is labelled an estimate because that is what it is.

**Not yet done:** no RTL screenshot pass, no screen-reader pass, no automated axe run. Recorded
as owed rather than claimed.

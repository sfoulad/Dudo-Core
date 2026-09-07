# 0031 — What a Template does, Organization identity, and two console rulings

**Status:** accepted, 2026-09-07
**Decided by:** the user, in conversation, closing the last open questions on the operator console
**Closes:** `TM-4` · the UTC-day question raised by `web-agent` and recorded unanswered in
`platform/admin/src/api/platform.ts` · the accessibility-tooling question · **the Bahrain
commercial-registry question and the VAT field the user asked for**

> **Decision 4 was added to this record on 2026-09-07, after the work it governs had shipped.**
> It is not a new ruling — it was decided by the user in the same conversation as the other three
> and implemented the same day. What was missing was the record. **Fourteen artifacts across Core,
> both registries, four contracts, two test suites and the platform fixture already cited
> `docs/decisions/0031` as the home of the identity design**, and every one of those citations was
> false while this section did not exist. The Team Lead owns `docs/decisions/` and owes the record
> the team is citing; the citations were correct about where it belonged. See the note at the end.

---

## Decision 1 — A Template decides which Apps an Organization gets

**A Template is a business type — Restaurant, Retail, Consultancy — and choosing one installs a
set of Apps with sensible defaults.**

Until now a Template held three labels and did nothing (`TM-4`). `0013` gave `organization` a
`template_id`, so the attachment exists and means nothing yet.

### What this decides, and what it does not

**It decides what a Template IS**, which is the question `TM-4` was actually asking. A Template
is not a tag, not a reporting dimension, and not a bag of field defaults — **it is the thing that
determines an Organization's App set at onboarding.**

**It does not decide the mechanism**, and cannot yet: installing an App requires an App runtime,
and `R1`/`R6` are open. So this is **specified now and built when Apps exist**, deliberately in
that order — the alternative is that the first App runtime invents the Template model as a side
effect of needing one.

### Why this ordering rather than the reverse

`0030` made the full system the target, and the vision names five Apps. **The Template is the
only mechanism anyone has proposed for deciding which of them a given customer gets.** Leaving it
as a label until the runtime exists means the runtime arrives with no answer to *"which Apps does
this Organization have"* — and that question has to be answered on the first day a second App
exists.

### Consequences

- **`template-v1` needs an App-set field**, and it must be specified against the App manifest
  vocabulary rather than free text. `architecture-agent` owns that.
- **`TM-1` and `TM-2` — versioning and retirement — get harder, not easier.** A Template that
  only labels can change freely. **A Template that decides an App set has consequences for every
  Organization already attached to it**, so changing one is a migration of installed software.
  That is now the reason those two matter, and they were deferred when the stakes were lower.
- **The three labels stay.** They are what an operator reads; the App set is what the platform
  acts on.

---

## Decision 2 — Audit date filters mean the UTC day, and say so

**Ratifies what is built.** An operator typing *"5 September"* gets `00:00:00.000Z` to the
following midnight, the fields are labelled UTC, and record timestamps render in UTC.

**The reason is that an audit trail is evidence read by more than one person.** Two operators
discussing *"the 5th"* must mean the same window or they are comparing different records. A local
day is friendlier to one person and makes the same filter mean different things to different
people — a defect in an investigative tool, however intuitive.

**The cost is stated rather than hidden:** Bahrain is UTC+3, so an operator asking for
*"yesterday"* gets a window offset by three hours from their intuition. **That offset is visible
rather than silent** — the fields say UTC and the rows render in UTC — which is what makes it
acceptable. A screen that filtered in UTC and rendered in local time would be worse than either
consistent choice.

**Rejected: fixed Bahrain time for everyone.** Consistent *and* intuitive while every operator is
in Bahrain, and **wrong the day one is not — invisibly, because nothing would announce it.**

---

## Decision 3 — No accessibility tooling dependency for now

**`axe-core` and `jsdom` are declined.** Recorded so it is not re-asked without new information.

**What the decision rests on:** contrast is pure arithmetic and is already checked with no
dependency. Structure, roles, labels and focus order are asserted from source. **And a static
render would miss focus behaviour and live regions — which is most of what the accessibility pass
actually changed**, including the fix that stopped a Cancel button performing the action it
declined.

**What is NOT closed by this, and must not be reported as closed:** nobody has run a screen
reader, nobody has viewed the console at `dir="rtl"`, and nobody has tabbed through it.
**`axe-core` would not have closed any of those three.** The gap is human review, and this
decision does not substitute for it.

**What would change the answer:** a defect found in production that a role-and-label checker
would have caught.

---

## Decision 4 — An Organization has a name and two registrations, entered by an operator and stamped with who checked them

**Added to this record 2026-09-07.** The user asked two things: whether Dudo could integrate with
**Sijilat** (`https://www.sijilat.bh`) to pull Bahraini business information, and then —
*"I think we need to add vat number if there is one for the organization"* — for VAT.

### The integration was not built, and the reason is not reluctance

**There is no Sijilat API and no National Bureau for Revenue API available to us.** Neither
registry publishes a machine interface we can call, so there is nothing to integrate with. The
honest options were to scrape a government portal, to fake it, or to say so.

**So the answer to "can we pull business information from Sijilat" is: not today, and the design
must not pretend otherwise.** What was built is the shape that a real integration would later fill
in, rather than a placeholder that would have to be replaced.

### What was built instead

Three fields on `organization`: **`display_name`**, **`commercial_registration`** (the Bahrain CR,
issued through Sijilat), and **`vat_registration`** (issued by the National Bureau for Revenue).

**The two registrations share one shape on purpose** — `state`, `number`, `verified`. They are two
instances of one category, so a third registration is a *decision*, not a third bespoke field, and
a future generic registrations table is a transposition of a shape that already exists rather than
a reconciliation of two that disagree.

### The load-bearing part: `verified` is an operator's claim, not a server fact

Because Core cannot call either registry, **`verified: true` means one thing only: *an operator
states they have just checked this number against the issuing registry*.** Core cannot confirm it
and does not imply that it has.

**That is why the field is a verification RECORD and not a boolean.** It stores **who** checked and
**when** — provenance, not a flag. A bare `verified: true` would be indistinguishable from a value
the server had validated, and the difference is the whole of what this system knows.

`verified_at >= recorded_at` is enforced as a database invariant: a value cannot be checked before
it was written down.

### Why `sensitive` and not `critical` — no confirmation gate on the identity route

The argument for `critical` is good: a VAT number may later be printed on an invoice, and a wrong
one is a real problem for a real business.

**It loses to a better one. The justification does not stop at VAT.** If VAT is critical *because
the value may appear on a document*, then so is the commercial registration, and so is the display
name in an invoice header — **the reasoning generalises to every field, and the rung stops sorting
anything.** A ladder that classifies everything as its top rung has no rungs.

**What replaces the gate acts at the point of harm rather than the point of entry.** The
verification record says who checked this specific number and when, so a future surface that
renders it onto a document **can refuse to render an unverified one**. That is a control on the
outcome. A confirmation prompt is not: it asks an operator to press a second button while looking
at the same number they just mistyped, and proves intent and presence while saying nothing at all
about correctness.

**This is therefore a debt, not a closed loop.** The refusal-to-render does not exist yet, and
nothing enforces it. The moment a document surface is built, *"unverified values are not printed"*
is an obligation that comes with it — and if that surface ships without it, this decision's
argument for `sensitive` has been spent without being honoured.

### `display_name` is optional at onboarding, and that is sequencing rather than design

**A server requiring a field the deployed console does not yet send is an onboarding outage.** A
client sending a field the server ignores is harmless; the reverse is not. So the console ships
first and Core tightens afterwards.

**The tightening is owed and named** — `organization-onboarding-v1`'s `ON-7`. It matters because
this contract's argument for a nullable name is that **the nameless set is closed at the three
Organizations that predate the field, and shrinks as operators name them.** While the field stays
optional that argument is false and the set is open. Making it `required` is a breaking change
under `API_STANDARD.md` §6 and belongs to the change that follows the console's release.

**Core must not synthesise a name** from the identifier, the Template, or the Workspace name. An
invented name is indistinguishable from one an operator typed, permanently.

---

## A note on how this section came to be missing

**Nothing went red.** Fourteen artifacts cited `docs/decisions/0031` for a design this record did
not contain — `platform-routes.ts`, `platform-permissions.ts`, `core-object-registry.yaml`,
`permission-catalog.yaml`, four contracts and their schemas, two platform test suites, and the
platform fixture. The code was correct, the contracts were correct, and **the citations were the
only thing wrong** — each one asserting that a reader could find the reasoning here.

**A false citation is worse than no citation, for the reason `architecture.md` §3c already
records:** it stops the next reader looking. *"`0031` records the design"* gives a reviewer no
reason to open `0031`, so the absence survives every review that passes over it.

**What this adds to §3c is the direction it can point.** §3c was written about a comment citing a
*contract* and getting the contract's content wrong. Here the cited document was not wrong — **it
did not exist**, and the citing artifacts were written by four different agents who each reasonably
assumed the Team Lead had written, or would write, the record they were told to cite. **Nobody
checked, because each one was only adding a citation like the thirteen others.**

**The mechanical check is cheap and did not exist:** every `docs/decisions/NNNN` reference in the
repository should resolve to a file that discusses what the citation claims it discusses. The first
half of that is a link check. The second half is not automatable, but the first half would have
caught this one, because the fourteen citations pointed at a real file about Templates.

**And the ordering lesson is the Team Lead's.** `0031` was written to close three console
questions; the identity work was decided in the same conversation and was implemented first,
because implementation had a clear owner and the record did not. **The record was the only artifact
with a single owner and no agent waiting on it, which is exactly why it was the one that slipped.**

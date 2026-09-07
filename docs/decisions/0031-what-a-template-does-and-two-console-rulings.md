# 0031 — What a Template does, and two console rulings

**Status:** accepted, 2026-09-07
**Decided by:** the user, in conversation, closing the last open questions on the operator console
**Closes:** `TM-4` · the UTC-day question raised by `web-agent` and recorded unanswered in
`platform/admin/src/api/platform.ts` · the accessibility-tooling question

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

# PR #17 is CONFLICTING, and a naive resolution resurrects deleted security-relevant files

**Measured 2026-09-11 by the Team Lead. NOT ACTED ON — agents were writing in the tree, and a merge
is a repository-wide operation (`workflow.md` §2a).** This file exists so the analysis survives the
session that produced it, which is the mistake `§11a` records about the NUL fixture: *a session
scratchpad is not preservation.*

## The state

```
merge-base                       d35c22b  "ADR 0010: admin interface frontend stack"
feature/az2-login ahead by       158 commits
origin/main       ahead by       1 commit — c29a922, 318 files, 94,334 insertions
PR #17                           OPEN, mergeable = CONFLICTING
```

**`c29a922` is titled *"The platform-operator surface, Organization identity, and the full-system
pivot"* and no commit on the feature branch carries that subject.** It reads as a squashed snapshot
of work the feature branch also contains, developed separately after the same base.

> # ⚠ THE PER-FILE TABLE BELOW IS WRONG. THE SURFACE IS 78 FILES, NOT 12.
>
> **Corrected 2026-09-11 by the Team Lead, after `core-agent` reported that it could not reproduce
> the figures and DECLINED TO GUESS WHY.** It was right and the error is entirely mine.
>
> **What the table says, and what is actually true:**
>
> | | claimed | measured |
> |---|---|---|
> | files carrying a conflict marker | **12** | **78** |
> | `permission-catalog.yaml` | **171 markers** | **3 markers** |
> | markers in the twelve `changed in both` files | *all 270* | **18** |
> | markers in `added in both` files | not counted | **252** |
>
> **The bug: `git merge-tree` emits `changed in both` sections carrying a `base` line, and
> `added in both` sections carrying NO base line — only `our` and `their`.** My awk keyed on
> `^  base `, so **every marker in all 70 `added in both` sections was attributed to whichever
> `changed in both` file happened to precede it in the stream.** `permission-catalog.yaml` sat before
> a long run of them and absorbed 168 markers belonging to other files.
>
> **`added in both` means the file did not exist at the merge base and was created independently on
> both branches** — which is most of the admin console, most of the test suites, and nineteen
> contract files. **That is the real merge, and the table below never mentioned it.**
>
> **The corrected surface, by owning tree:**
>
> ```
> 122 markers  28 files  platform/admin        web-agent
>  49 markers  19 files  packages/contracts    architecture-agent
>  46 markers  10 files  packages/testing      qa-agent
>  24 markers   3 files  root                  Team Lead
>  15 markers   8 files  platform/web          web-agent
>   7 markers   6 files  docs                  Team Lead / architecture-agent
>   7 markers   4 files  platform/core         core-agent
> ```
>
> **WHAT SURVIVES AND WHAT DOES NOT.** Every **content** finding in this document was obtained by
> reading the actual differing lines and stands unchanged — the stale prose counts, the withdrawn MVP
> column, the `status: proposed` reversion, the missing `$ref`, the resurrected NUL. **Every
> HUNK-COUNT claim is void.** The readings were right; the counting was wrong, repeatedly, and this
> is the third self-correction in this file.
>
> **THE PATTERN IS WORTH MORE THAN THE FIX, and `§11a` already named it:** *two derivations that share
> a scope are one derivation.* I had one derivation and treated its output as self-evidently
> attributed. **`core-agent` reported `my numbers do not reproduce yours, either could be right, I am
> not guessing which` — and refusing to invent the reconciling cause is what put the question in a
> state a measurement could settle.** Had it proposed a cause, I would probably have accepted it.

## The conflict surface — 270 hunks across 12 files, four owners
### ⚠ SUPERSEDED BY THE CORRECTION ABOVE — kept unedited because it was acted on and delegated from

| File | Hunks | Owner |
|---|---|---|
| `packages/contracts/registries/permission-catalog.yaml` | **171** | `architecture-agent` |
| `packages/contracts/core/organization/business-read-v1.schema.json` | 30 | `architecture-agent` |
| `docs/operations/free-tier-register.md` | 23 | Team Lead |
| `packages/contracts/README.md` | 16 | `architecture-agent` |
| `platform/web/src/main.tsx` | 8 | `web-agent` |
| `platform/core/identity/pre-auth-admission.ts` | 7 | `core-agent` |
| `platform/web/src/components/AppShell.tsx` · `README.md` | 4 each | `web-agent` |
| `docs/architecture/standards/ARCHITECTURE.md` | 3 | `architecture-agent` |
| `docs/decisions/README.md` | 2 | Team Lead |
| `platform/web/package.json` · `src/App.tsx` | 1 each | `web-agent` |

**The permission catalogue is a security artifact and it carries 171 of the 270.** A wrong resolution
there grants or drops a permission silently.

## ⚠ THE FINDING: 17 FILES EXIST ON `origin/main` AND NOT ON THE BRANCH, AND EVERY ONE WAS DELETED ON PURPOSE

**A merge that takes `origin/main`'s side on these RESURRECTS them.** They are not new work that the
branch is missing — they are the exact artifacts `0040` and `0036` removed:

```
platform/admin/src/api/kdf.ts          the host-local credential-derivation module
platform/web/src/api/kdf-client.ts     its counterpart in the other host
platform/web/src/api/kdf-worker.ts
platform/admin/scripts/verify-kdf.mjs  the script that compared the two, deleted when they became one
platform/admin/src/components/ui/button.tsx · field.tsx     moved into @dudo/ui
platform/web/src/components/ui/button.tsx · badge.tsx       moved into @dudo/ui
platform/admin/src/lib/cn.ts · router.ts                    replaced by TanStack Router (0036)
platform/web/src/lib/cn.ts · router.ts · use-businesses.ts
platform/admin/package-lock.json · platform/web/package-lock.json   deleted under 0040's workspaces
```

> **Restoring `kdf.ts` and `kdf-client.ts` re-creates the two host-local copies of the credential
> derivation that `0040` exists to end** — `workflow.md` §2b's whole subject. The reservation written
> to catch a re-fork *"goes red the day someone re-forks the file"*, and **a merge is a way to
> re-fork a file without anyone deciding to.**

**The per-package lockfiles are the same shape one level down:** under workspaces they govern nothing
and are *"stale files that still instruct."*

## AND IT IS NOT A CLEAN SUBSET — DO NOT RESOLVE WITH A WILDCARD

**The tempting shortcut is `-X ours` on the grounds that the branch is 158 commits ahead. The
measurement does not support it.**

```
feature -> origin/main:  227 files changed, 9,355 insertions(+), 27,411 deletions(-)
```

The deletions confirm the branch is far ahead. **The 9,355 insertions are the problem: `origin/main`
holds content the branch does not**, and not only in the 17 resurrectable files —
`platform/web/src/screens/CustomerList.tsx` alone is `287+ / 219-`, which is **two-way divergence,
not an older copy.** `permission-catalog.yaml` is `19+ / 264-`: the branch is far ahead **and
`origin/main` still carries 19 lines the branch lacks.**

**So a blanket strategy would silently drop whatever those 19 lines are.** Nobody has read them yet.

### ⚠ NOW READ, AND THE ANSWER INVERTS THE CONCLUSION FOR THIS FILE — 2026-09-11, same pass

**One command. The 19 lines contain NO permission entry.** They are prose comments, and every one
carries a hand-maintained count that is now wrong:

```
"All fourteen of its routes DECLARE a permission"        <- the class ships TWENTY
"Grepping this file for 'scopes: [platform]' finds FOURTEEN occurrences"
"59 of the 62 CORE permissions"  /  "Total for this role: 68 of the 71 catalogued permissions"
```

**These are the exact artifact `workflow.md` §11a is about** — *a count that only ever appears in
prose is a count nobody has to move* — sitting on `origin/main` with figures that rotted the moment
the branch registered a route or catalogued a permission. **The branch already superseded them.**

> **So for `permission-catalog.yaml` the branch's side is correct, and 171 of the 270 hunks collapse
> to one decision.** Not because the branch is ahead — that argument was available before anyone
> looked and would have been right by luck — **but because the content was read.**

**Keep the distinction, because it is the whole reason this file exists:** *"the branch is 158
commits ahead, take ours"* and *"the 19 lines are stale prose comments, take ours"* reach the same
resolution and are not the same act. **The first is a strategy flag; the second is a finding.** And
the first would have been applied identically to the eleven other files, where it has not been
checked and where `CustomerList.tsx`'s `287+ / 219-` says two-way divergence outright.

**Revised cost of step 4:** one file adjudicated (171 hunks, resolved), **eleven remaining.**

### The reading is delegated and IN FLIGHT — 2026-09-11, ahead of the merge

**The reading costs nothing now and is expensive at the end of a milestone, so it is happening while
implementation runs.** Each owner is answering exactly one question about its own files —
***what content would be LOST if the branch's version simply won?*** — with **no edits, no
resolution, and no merge.**

| Owner | Files | How the diff reaches them |
|---|---|---|
| `architecture-agent` | `packages/contracts/README.md`, `business-read-v1.{schema.json,contract.yaml}`, `ARCHITECTURE.md` | **extracted to scratchpad files** — it has no Bash and cannot run git (`architecture.md` §2a-i) |
| `core-agent` | `platform/core/identity/pre-auth-admission.ts` | runs the diff itself; **`grep -a`, the file is NUL-bearing** |
| `web-agent` | `platform/web/{package.json,README.md,src/App.tsx,src/components/AppShell.tsx,src/main.tsx}` | not yet dispatched — it is on the milestone's critical path |
| Team Lead | `docs/decisions/README.md`, `docs/operations/free-tier-register.md` | mine |

**`business-read-v1.schema.json` is the one to watch.** A schema conflict where both sides carry real
constraints is the only place in this set where a genuine merge is likelier than a choice — **and
getting it wrong is invisible, because nothing in this repository executes JSON Schema.**

### `architecture-agent`'s four, read — nothing lost on any, and TWO would have destroyed something

**Same verdict four times, and the reasons are not interchangeable.**

**`business-read-v1.contract.yaml` — THE SHARPEST FILE IN THE MERGE.** `origin/main` carries
`status: proposed` and `updated: 2026-09-04`. The branch carries `status: accepted` with its full
`acceptedBy`.

> **Taking `origin/main`'s side would silently UN-ACCEPT AN ACCEPTED CONTRACT.** `security.md` §8a is
> explicit that `status: accepted` *"is not a description of a contract's quality — it is a RECORD
> THAT A SPECIFIC PERSON MADE A SPECIFIC DECISION."* **A merge that reverts it does not regress
> documentation. It ERASES AN ACT.**

**And it reopens a window that acceptance closed:** the `2026-09-04` `GET`→`POST` change was free
*"only because it was made before acceptance"*. From that acceptance onward, **method, path and
identifier carrier are breaking changes.** Of the twelve files, **this is where a wildcard would do
the most damage in the fewest characters.**

**`business-read-v1.schema.json` — a REGRESSION, not staleness.** `origin/main` lacks two
machine-readable things the branch has:

- **`$defs/errorResponse`**, the `$ref` to `urn:dudo:schema:error-envelope:1`. **This is the error
  envelope's ONLY reference in the entire corpus.** Dropping it returns the envelope to
  generated-but-unreached and **takes `0037` requirement 2 back to zero satisfied.**
- **`enumPolicy: "closed"` on `resolutionState`** — dropping it reopens a `0041` phase-1 warning and
  becomes a refusal once phase 2 flips.

**Neither is prose.** Everything else unique to `origin/main` in that file is superseded description,
including two of the absence-claim class: *"no such resolver exists yet"* (false for generation since
`buildSchemaIndex`), and **a conditional whose condition is now true** — *"if the resolver lands, this
definition should become a `$ref`"* — where **acting on it literally would be wrong**, because the
duplication exists for a hand-checking reader and it is a *validator* that would collapse it.

**`ARCHITECTURE.md`** — `origin/main` holds the pre-correction request-class table, whose citation
`platform-routes.ts:332–709` **covers 11 of 15 routes and reads exactly like a correct one.** Taking
it back reinstates the under-covering pointer the branch's note exists to record.

**`packages/contracts/README.md`** — three `Proposed` rows where the branch has accepted ones, four
whole sections absent, and the *"nothing in this directory is executed"* sentence the branch already
corrected.

**⚠ ONE DEFECT ON THE BRANCH SIDE, which the merge would carry forward.** `businessId`'s description
contains one sentence **twice, verbatim and consecutively** — spliced in during the correction.
Cosmetic, `architecture-agent`'s, flagged rather than silently fixed **so it is repaired deliberately
instead of being discovered later and read as merge damage.**

### The Team Lead's two files, read — and the second one would have REINTRODUCED a withdrawn decision

**`docs/decisions/README.md` — `origin/main` holds ZERO unique lines.** Pure deletion relative to the
branch. Nothing to lose; the branch's version wins. **2 hunks, one decision.**

**`docs/operations/free-tier-register.md` — 23 hunks, and `origin/main`'s unique content is ONE LINE:**

```
origin/main:  | Service | Source | Free allowance | Expected MVP usage        | Current | …
the branch:   | Service | Source | Free allowance | Expected usage (full system) | Current | …
```

**A table column header carrying the MVP framing that `0030` withdrew on 2026-09-06.** `CLAUDE.md` is
explicit that *"the word MVP describes nothing that is in force in this repository"*, and the branch
had already renamed the column.

> **Taking `origin/main`'s side on the single line it uniquely holds would have re-introduced a
> withdrawn decision into a LIVE OPERATIONS DOCUMENT** — one that is re-verified before every release
> — **and nothing would have gone red.** That is `§12`'s residue arriving through a merge rather than
> through a missed sweep, which is a delivery mechanism `§12` does not currently name.

### THREE OF TWELVE READ, THREE-FOR-THREE THE SAME WAY — AND THAT IS A HYPOTHESIS, NOT A LICENCE

| File | `origin/main`'s unique content | Verdict |
|---|---|---|
| `permission-catalog.yaml` (171 hunks) | prose comments with stale counts — *"all fourteen of its routes"* against twenty | branch wins |
| `docs/decisions/README.md` (2) | **nothing** | branch wins |
| `free-tier-register.md` (23) | one header carrying **withdrawn MVP framing** | branch wins |

**196 of the 270 hunks resolved, and every one the same way.** The temptation to declare the
remaining nine files settled by induction is exactly what this document exists to refuse.

**The counter-evidence has not moved:** `platform/web/src/screens/CustomerList.tsx` is `287+ / 219-`.
**A file with 287 lines on the other side is not a file whose other side is empty**, and three
document-shaped agreements say nothing about a screen. **Read the remaining nine.**

> **⚠ THE PARAGRAPH ABOVE IS WRONG AND IS LEFT STANDING BECAUSE IT WAS ACTED ON. Corrected
> 2026-09-11 by the Team Lead, against itself, within the hour.**
>
> **`CustomerList.tsx` IS NOT IN THE CONFLICT SET.** Measured: zero occurrences in the `merge-tree`
> output, and it appears in none of the twelve `changed in both` entries.
>
> **Every number in that paragraph is real. The attribution is wrong.** `287+ / 219-` comes from
> `git diff feature origin/main`, which compares the two **tips** — it says nothing about whether
> both sides *changed* the file. `origin/main` never touched `CustomerList.tsx` after the base, so
> the `287+` is **our own rewrite reported in reverse**. It merges cleanly, the branch's version
> wins, and no human decides anything.
>
> **This is `architecture.md` §3c's worst variant, committed by the person quoting the rule.** Not a
> claim nobody checked — a claim built on a real measurement, from the right command, **read against
> the wrong population.** *Changed since the base* and *changed on both sides* are different sets,
> and the diff I quoted only answers the first.
>
> **And the direction of the error is the dangerous one: it argued for MORE caution.** `§11a` records
> that a pessimistic wrong number is *"believed indefinitely, because acting on it always looks like
> the safe choice"* — it narrows scopes and defers work, and every one of those reads as diligence.
> **It survived precisely because it was the conservative claim.**
>
> **The refusal to resolve by induction still stands, and now it stands on nothing but itself:** five
> files remain unread, and *"the first seven went one way"* is not evidence about the eighth. **The
> conclusion was right. The argument for it was not, and it is worth less than I thought.**

## ⭑ WHAT THIS MERGE ACTUALLY IS — the timeline settles it, 2026-09-11

**`c29a922` is not divergent work. It is a MID-DEVELOPMENT SNAPSHOT OF THIS SAME PROGRAMME, pushed
to `main` three days before the branch stopped moving.**

```
merge base  d35c22b
branch      2026-09-05 01:11  →  2026-09-10 23:57      158 commits
origin/main 2026-09-07 23:52  ←  SITS INSIDE THAT WINDOW
```

**Corroborated by size on the files both sides carry:** `platform/admin/src/screens/Templates.tsx`
538 lines on `main` against 564 on the branch; `platform/admin/src/api/platform.ts` 2,130 against
2,358. **The branch is the continuation of what `main` snapshotted, not a fork of it.**

**That explains everything measured above and nothing else needed to be assumed:** why 70 files are
`added in both` (they were created after the base, on the branch, and the snapshot caught them
mid-flight), why `origin/main`'s unique content keeps turning out to be stale prose and superseded
counts, and why `business-read-v1.contract.yaml` still says `status: proposed` — **it was, on
2026-09-07.**

> **So the prior is now strong and EARNED rather than assumed: the branch supersedes `main` file by
> file, because the branch is what `main` became.** *"158 commits ahead"* was always true and was
> never an argument; **the timeline is an argument.**

**It does NOT license a wildcard, and the two live findings are why.** A mid-development snapshot can
hold something later removed by accident, and both real risks found so far are exactly that shape —
**a `status: accepted` that would be reverted to `proposed`, and the error envelope's only `$ref` in
the corpus.** Neither is stale prose; both were found by reading.

### Derived triage — which files still need a human

Computed across all 78: for each, the lines present on `origin/main` and **absent anywhere in the
branch's version** of the same file.

```
10 files  ZERO unique non-blank lines   ->  nothing textual to lose, no reading required
68 files  carry unique lines            ->  mostly older spellings of lines the branch rewrote
```

**The count is a FILTER, not a verdict.** A zero is conclusive in one direction — nothing on that
side is absent — while a non-zero says only *"these files differ"*, which was already known. **What
it buys is an ordering**, and the ordering says the risk is not where the volume is:

| | markers | real risk |
|---|---|---|
| `platform/admin/**` — 28 files, screens and client | **122** | **low** — continuously developed UI, superseded line by line |
| `packages/contracts/**` — 19 files | 49 | **HIGHEST** — this is where both live findings were, and where a loss is invisible because nothing executes JSON Schema |
| `platform/core/**`, `scripts/**`, `packages/testing/**` | 60 | **medium** — a checker or a guard silently reverted |

**Read the contracts and the checkers. Spot-check the screens.** Volume and risk point in opposite
directions here, and adjudicating 28 UI files line by line would spend the whole budget where the
prior is strongest and the consequence smallest.

### The derivation, and the reading it left

**The method is `core-agent`'s, adopted as standing because it was the only measurement in this
analysis that never needed correcting:**

```
comm -23 <(git show origin/main:PATH | sort -u) <(git show feature/az2-login:PATH | sort -u) | grep -ve '^[[:space:]]*$'
```

**Ten files return zero and need no reader** — four contract schemas, `run-platform-operator.ts`,
`docs/decisions/README.md`, `0019`, the deployment runbook, `package-lock.json`,
`platform/admin/src/styles/index.css`.

**What remains, dispatched to owners, read-only, ahead of the merge:**

| Owner | Files | Lines |
|---|---|---|
| `architecture-agent` | 15 contract files | **65 total** — extracted for it; it has no Bash |
| `qa-agent` | 9 test files | 190, dominated by `member-resolve-rename.ts` (107) and `enrolment-round-trip.ts` (43) |
| `core-agent` | 4 Core files | 39 |
| Team Lead | `scripts/check-source-bytes.mjs` | 12 — **read, below** |

**`enrolment-round-trip.ts` is the one to watch, and `§2b` already names why.** `origin/main` predates
`0040`, so its version **imports both host copies of the credential-derivation module and compares
them.** Those assertions were struck deliberately when the copies became one. **A merge restoring
that side does not break loudly — it restores three assertions that compare a function with itself**
and pass forever, and the imports would resolve because the host paths come back with them.

### ⚠ THE DERIVATION OVERSTATES, AND A ZERO IS THE ONLY CONCLUSIVE VALUE — corrected 2026-09-11

**`architecture-agent` found two systematic artifacts in the `comm -23` method above.** Both make a
line read as *"present on `origin/main`, absent from the branch"* **while the branch strictly contains
it**:

```
TRAILING COMMA        origin/main   "enum": ["active", "suspended"]
                      branch        "enum": ["active", "suspended"],
                                    "enumPolicy": "extensible"      <- the branch has MORE

EMBEDDED DESCRIPTION  the branch PREPENDS a correction and keeps the old sentence verbatim inside it
```

**Of the 65 contract lines the method reported, roughly 14 are genuinely absent.** Every other figure
quoted in this document is an **upper bound on what might be missing, not a count of it.**

> **A ZERO IS CONCLUSIVE. A NON-ZERO IS AN UPPER BOUND.** The ten zero-files stand unchanged; every
> non-zero number here overstates, and the direction matters: **an inflated risk figure produces more
> caution and reads as diligence**, which is `§11a`'s rot direction that nobody audits.

**This is the FOURTH counting correction in this document and the readings have needed none.**
`core-agent` found the awk attribution; `architecture-agent` found the comma and the embedding. **The
stable form: populations kept being derived and the derivations kept not being validated against a
specimen.** One hand-checked file would have caught both artifacts immediately.

### ⭑ `status: proposed` IS FOUR FILES, NOT ONE — the largest class in the merge

```
business-read-v1.contract.yaml           proposed / 2026-09-04   ->  accepted
login-v1.contract.yaml                   proposed / 2026-09-04   ->  accepted
organization-selection-v1.contract.yaml  proposed / 2026-09-05   ->  accepted
organization-identity-v1.contract.yaml   proposed / 2026-09-07   ->  accepted
```

**Four separate acts, on four separate days, all revertible by one flag.** `security.md` §8a: each is
a record that a specific person made a specific decision.

**And `organization-identity-v1` is worse than the other three.** `2026-09-07` is the day the user
granted `core.platform-organization.update`. **Un-accepting the contract that permission was granted
FOR leaves a granted permission whose contract is a proposal** — and nobody notices, because the
permission keeps working.

**The four HARMLESS `updated:`-only regressions are the tell**, and the contrast is the diagnostic:
**a snapshot that is merely older regresses dates; one that lost something regresses a `status`.**
Distinguishable only by reading which field moved.

### `template-v1.schema.json` — the cleanest statement of what this merge is

**`origin/main`'s `templateName` pattern is the PRE-SR-8 one, which accepts `U+202E` and zero-width
characters** — the live confusability defect closed today on a deployed route.

**It is on the losing side, so no action is owed.** It is recorded because it is the sharpest possible
illustration:

> **"Older spelling" and "lost security constraint" are THE SAME TEXT.** The only thing that separates
> them is somebody reading the line. **A wildcard in the wrong direction here reintroduces a
> security defect fixed hours earlier, and nothing goes red.**

### READING COMPLETE ON FOUR OF FIVE TREES — 42 of 78 files, verdict unanimous

| Owner | Files | Verdict |
|---|---|---|
| `architecture-agent` | 15 | **nothing lost** — 4 acceptances, 2 artifacts found in the method, `template-v1`'s pre-SR-8 pattern |
| `qa-agent` | 9 | **nothing lost** — four retired worlds, classified by hazard direction |
| `core-agent` | 5 | **nothing lost** — all 39 lines removed deliberately today under three recorded decisions |
| Team Lead | 3 | **nothing lost** — the falsified checker claims, the withdrawn MVP column |
| zero-unique | 10 | **no reading required** |
| **`web-agent`** | **36** | **NOT READ — deliberately.** It is on the milestone's critical path |

**`qa-agent`'s four-class taxonomy is the one to keep, because the hazard direction differs by class
and only one of them is silent:**

| Class | On restore |
|---|---|
| **`0040`** — imports of the two deleted `kdf` modules | **SILENT** — adds two assertions that cannot fail |
| **`0034` phase 3** — the deprecated `identifier` spelling | red **against a correct route** |
| **`0030`** — the withdrawn seven-step gate, MVP framing | **a withdrawn process rule, inside a runnable script** |
| superseded by later work | branch strictly ahead |

**And it checked what the branch KEPT rather than assuming**, which is the step that settles
`enrolment-round-trip.ts`: the independent-reference comparison, the iteration drift, the casing
round-trip, the discrimination controls and both host round-trip cases all survive. **The merge would
not remove coverage there — it would ADD two assertions that cannot fail**, plus prose naming a
deleted script and a count that was already wrong.

**`run-platform-operator.ts` returning zero deserves its own line**: it is the registration point for
every suite added this week, so a zero means **`origin/main` holds no suite the branch is missing** —
the one place where *"the branch is ahead"* could have been false in the expensive direction.

### CORRECTION to this document's own reading of `permission-catalog.yaml`

**I recorded its 19 lines as *"stale prose comments with rotted counts — drop them."* `architecture-agent`
confirms no permission entry, no role membership, no scope, no sensitivity — and corrects the
characterisation:**

> **They are not merely stale counts. They are the counts' OWN RECONCILIATION NOTE** — the argument
> that *"count the string `scopes: [platform]`"* and *"count the entries"* give different answers, and
> that **the entry count is the number that means anything.**

**The branch kept that argument and moved the figures** — `FOURTEEN` → `FIFTEEN`, with the `0033`-form
dated figure and the third recorded move.

**Same resolution, different claim, and the difference is load-bearing:** *"stale prose, drop it"* and
*"the argument survives and its numbers moved"* justify the identical merge decision. **Only the second
stops the next person deleting the reconciliation note and re-deriving the same confusion.**

### The Team Lead's own file — the third instance of the pattern, and the sharpest

**`scripts/check-source-bytes.mjs`: 12 lines unique to `origin/main`, and they are the PRE-CORRECTION
CLAIMS that `workflow.md` §11a records as measured false on 2026-09-09:**

```
"*** THESE FILES CANNOT BE GREPPED AND CANNOT BE REVIEWED. ***"
"Plain `grep` returns NOTHING over the whole file, silently — no error, no"
"`git diff` reports them as binary with NO HUNKS AT ALL, so a change ... lands unreviewable"
```

**Both were falsified with negative controls.** `git diff` renders such a file binary only when the
NUL sits near the top — `platform/core`'s files keep normal textual diffs because theirs are at bytes
34,135 and 40,922. *"Plain grep returns nothing"* is true of this shell's `ugrep` wrapper and false of
`/usr/bin/grep`.

> **Taking `origin/main`'s side would reinstate, INSIDE A CHECKER'S OWN OUTPUT, the argument that made
> the remediation urgent — the argument that was measured and found wrong.** A checker that prints a
> falsified claim every run is the most durable form of `§3c` available: it is not a comment, it is a
> tool telling you something.

**Its success line is pre-quarantine too** — `"no control bytes outside tab and newline"` — which would
delete the quarantine concept from the report of the check that implements it.

**Three for three now: `ARCHITECTURE.md`'s under-covering citation, `free-tier-register`'s withdrawn
MVP column, and this.** Every one is a correction the branch made and the snapshot predates. **The
merge is not a threat to the code. It is a threat to the corrections.**

## ✅ READING COMPLETE ON EVERY TREE — 2026-09-11. ZERO GENUINE LOSSES.

**All five owners have read their files. The verdict is unanimous: nothing on `origin/main` is content
the branch lacks.**

| Owner | Files | Verdict |
|---|---|---|
| `architecture-agent` | 15 contracts | nothing lost — 4 acceptances at risk, 2 artifacts found in the method |
| `qa-agent` | 9 suites | nothing lost — four retired worlds, only the `0040` class silent |
| `core-agent` | 5 Core | nothing lost — all 39 lines removed deliberately that day |
| Team Lead | 3 root/docs | nothing lost — falsified checker claims, withdrawn MVP column |
| `web-agent` | **91 files across both client trees** | **nothing lost** |
| zero-unique | 10 | no reading required |

### ⭑ AND `web-agent` CORRECTED THE METHOD — the per-file sweep was scoped to the wrong population

**The Team Lead dispatched `comm` per file against `origin/main`'s tip.** That is correct for content
and **wider than the question by 158 commits.**

```
merge-base   d35c22b
origin/main  base + ONE commit — c29a922
branch       base + 158 commits
```

> **`origin/main` IS the base plus one commit. So the entire question is: what does `c29a922` hold
> that the branch lacks?** Everything else on that branch is, by definition, already in the branch's
> history.

**A file the branch rewrote produces a large non-zero that means *"the old implementation"*** — real,
expected, and not a loss. **Bounding by the commit answers the question before any of that matters,
and it is one command.**

**Keep both:** the structural question **bounds the set**; the per-file `comm` **answers it** for the
files that remain.

### What every non-zero turned out to be

- **Superseded import paths** — repointed at `@dudo/client-kdf` / `@dudo/ui` by `0040`.
- **Rewritten implementations** — `App.tsx`, the hash router replaced by TanStack Router.
- **CONTENT DELETED BECAUSE IT WAS FALSE** — `NOTICE.md`'s *"deliberately not installed"* table naming
  two packages that were **running the console**, and a `README` layout block naming deleted paths.
  **Those absences are the repair, not a loss.**
- **`platform/admin/src/api/kdf.ts`: 54 unmatched lines, ZERO of them code** — every one header prose
  describing the two-copy arrangement. `§2b`'s *prose that described the old shape*, gone with the
  file it described.

### ⚠ TWO MORE INSTRUMENTS WHOSE POPULATION WAS SMALLER THAN THEIR SUBJECT — in the reading whose purpose is completeness

- **`platform/admin/.gitignore` showed 5 unmatched and is not deleted.** The corpus globbed
  `.ts/.tsx/.mjs/.css/.json/.md/.html` — **a dotfile matches none of them.** `git check-ignore`
  confirms it is live and covering `dist/`, `node_modules/` and `.env`. **A false positive on the one
  file where a real deletion has a PUBLIC-REPOSITORY consequence.**
- **Two `.svg` files vanished from the comparison entirely** — also outside the glob. Replaced by PNGs
  that exist, are byte-identical, and are referenced; nothing references the SVGs.
- **Six PNGs produced `sed: illegal byte sequence`.** They were **byte-compared rather than allowed to
  pass as clean** — six identical. ***`NOT RUN` is not `PASS`.***

**Fifth and sixth instances in one session of a check reporting on less than it claimed.** In the
author's words: **a glob is a decision about what you cannot see.**

## The plan — ordinary integration work, sequenced, NOT started

1. **Wait for every agent to go idle.** A merge reaches every file regardless of ownership; `§2a` is
   explicit and it has caused real harm here before.
2. **Announce it to the team and wait** — same rule.
3. **Commit the working tree first**, so the merge resolution is reviewable against a known state
   rather than tangled with 56 uncommitted paths.
4. **Merge `origin/main` into `feature/az2-login`** and resolve **per file, by owner** — contracts and
   `ARCHITECTURE.md` to `architecture-agent`, `pre-auth-admission.ts` to `core-agent`,
   `platform/web/**` to `web-agent`, `docs/decisions/README.md` and `free-tier-register.md` to the
   Team Lead. **The 19 catalogue lines get read, not discarded.**
5. **Assert the reservation afterwards:** no host-local `kdf` copy in either tree, no per-package
   lockfile, no host-local `ui/` primitive. **`check:source-bytes`, `check:route-fields` and the
   suite reservation are what make step 5 mechanical rather than a promise.**
6. **Full gate green, then push, then merge the PR.**

### ⭑ THE ONE POST-MERGE CHECK THAT NOTHING ELSE COVERS — `architecture-agent`, and it is mandatory

**Everything else that can go wrong in this merge goes red somewhere.** `check:route-fields` fires on a
reverted `organization-detail-v1`; the drift check fires on a reverted schema; `check:source-bytes`
fires on a resurrected NUL; the platform class refuses an undeclared field before authentication, so a
reverted fixture breaks loudly on the first run.

> **AN UN-ACCEPTED CONTRACT GOES RED NOWHERE.** `status: accepted` has no consumer, no checker and no
> diagnostic. It is a record that a person made a decision, and reverting four of them produces a
> perfectly green tree.

**So run this after the merge, before the gate:**

```
grep -h "^status: accepted" packages/contracts -r --include="*.contract.yaml" | wc -l
```

**BASELINE, MEASURED 2026-09-11 BEFORE ANY MERGE: 14.** All four at-risk files confirmed `accepted` at
that moment — `business-read-v1`, `login-v1`, `organization-selection-v1`, `organization-identity-v1`.

**It is one command, it is DERIVED rather than remembered, and it is the only check in this merge that
fires on a class carrying no diagnostic of its own.** If it returns anything below 14, the merge
reverted an acceptance and the number names how many.

**Step 4 is the only expensive one and it is not mechanical.** Anyone reading `158 commits ahead` and
reaching for a strategy flag should read the `19+` above first.

## What this is NOT

**Not a blocker today.** Implementation is still in flight and the merge is the last step, so the
conflict costs nothing until then. **It is recorded now because the analysis is cheap while the
question is open and expensive to redo under time pressure at the end of a milestone.**

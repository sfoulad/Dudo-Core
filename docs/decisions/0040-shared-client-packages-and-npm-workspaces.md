# 0040 — Shared client packages, and why there are TWO of them rather than one

- **Status:** **ACCEPTED, 2026-09-09.** Team Lead decision. Milestone 1's first architectural task,
  taken before any Milestone 1 screen is built.
- **Owning agent:** Team Lead owns the root `workspaces` key and this record. **`web-agent`
  implements** — it owns `platform/web/**`, `platform/admin/**`, and the new packages.
- **Introduces no new dependency and no new technology.** npm workspaces is a feature of the
  package manager already in use; nothing is installed that `0036` did not already approve.
- **Unblocks four queued items** recorded in `0036`'s amendment of the same day.

---

## The defect

`0036` required *"a single primitive layer that every admin surface consumes, on both hosts."*
**That sentence was written without checking whether both hosts are one package. They are not**, and
the measured state is worse than "not yet shared":

| | `platform/web` (`@dudo/web`) | `platform/admin` (`@dudo/admin`) |
|---|---|---|
| npm package | its own | **its own, separate** |
| `node_modules` | its own | **its own** |
| `src/components/ui/` | 9 modules | **2** — button, field |
| The six `0036` libraries | installed, **pinned exact** | **none installed** |
| Version ranges | pinned | **carets throughout** |

**Root `package.json` has no `workspaces` key.** Neither tree can import the other, so the *single*
layer is two copies, and they have already diverged in both directions.

**And the divergence is not theoretical.** `web-agent`'s `check:suite-parity` reports **17 real
gaps** between the two KDF suites — 16 present in web and absent from admin, including the **DEL and
tilde printable-ASCII boundary**, and one the other way. **Neither copy is the fuller one.**

## The decision

**Adopt npm workspaces at the repository root, and create TWO shared packages — not one.**

```
packages/ui/          @dudo/ui       presentation primitives, NO AUTHORITY   (web-agent)
packages/client-kdf/  @dudo/client-kdf  credential derivation + its suite    (web-agent)
```

Root `package.json` gains `"workspaces": ["platform/web", "platform/admin", "packages/ui",
"packages/client-kdf"]`. `packages/contracts`, `packages/sdk` and `packages/testing` are **not**
workspace members — they are not npm packages and adding them would change what `npm install` does
to trees that do not want it.

### Why two packages, and this is the load-bearing part of the decision

**One package would have been simpler and would have quietly destroyed `0036`'s no-authority rule.**

That rule says the shared primitive layer **must carry no authority**: a component that *renders* a
member row is shared; one that *decides whether the viewer may see it* is not. **`check:ui-purity`
enforces it today over `platform/web/src/components/ui/**` — and `web-agent` found that it has
never been tested by anything**, because there has been no shared component to test it on.

**Put `kdf.ts` and `errors.ts` in the same package as `button.tsx` and the boundary stops being
statable.** "The shared package" becomes a place where both presentation and credential derivation
live, and the next author importing a decision-making module from it has broken no visible rule.
**The split is what keeps the sentence enforceable:**

> **`@dudo/ui` may import no contract, no API client, no router, no query cache, and nothing that
> decides. `check:ui-purity` moves onto it and covers it alone.** That is the mechanism `0036`
> named and has never had a subject.

**`@dudo/client-kdf` is the opposite kind of thing and is treated accordingly:** it is
security-relevant, it is already held byte-identical across hosts by a drift check, and its suite is
the artifact with 17 known gaps. It carries no components and no styling.

### What moves, and what deliberately does not

**Into `@dudo/ui`:** `src/components/ui/**` (web's 9 modules), `lib/cn.ts`.

> ## ⚠ CORRECTED 2026-09-09, BEFORE ANYTHING WAS DELETED. THIS PARAGRAPH SAID ADMIN'S PRIMITIVES WERE "DELETED, NOT MERGED" BECAUSE "THERE IS NOTHING IN THEM TO PRESERVE."
>
> **That was false, and it was false about both of the files it cited as evidence.** The Team Lead
> reasoned from `web-agent`'s measurement that admin's `button.tsx` is larger with **fewer exports**
> and its `cn.ts` is byte-identical code under different prose — **true, and it does not follow that
> the excess is only comments.** The claim was then extended to `field.tsx`, which had not been
> measured at all.
>
> **`web-agent` was asked to confirm the subset relationship for the third file before deleting, and
> stopped: it does not hold for `field.tsx`, and it does not hold for `button.tsx` either.** Admin
> carries **three things web lacks**:
>
> 1. **An `onNavy` button variant**, used twice in `AdminShell` — and ~~**web hand-rolls the same
>    classes inline** in `AppShell`. **Admin factored out what web repeats at the call site**, so it
>    is precisely the variant a shared header needs. Deleting it loses the better factoring.~~
>
>    > **⚠ CORRECTED 2026-09-09 — THE THIRD CORRECTION TO THIS ONE PARAGRAPH, AND THE EVIDENCE WAS
>    > WRONG BOTH TIMES IT WAS RESTATED.** `web-agent` measured the two strings after the merge had
>    > already landed on this claim:
>    >
>    > ```
>    > web AppShell:  ghost + text-[#b9c0dd] hover:not-disabled:bg-white/10 hover:not-disabled:text-white
>    > onNavy:        bg-white/10 border-white/25 text-white hover:not-disabled:bg-white/20 …
>    > ```
>    >
>    > **Web's is transparent and muted until hover. The variant is always-on with a border. They
>    > overlap on ONE utility.** Web is not repeating what admin factored out — **both consoles
>    > needed a button that works on navy, each solved it differently, and only admin named it.**
>    >
>    > **THE CONCLUSION SURVIVES AND THE EVIDENCE DID NOT.** Admin held a capability web lacked;
>    > deleting its button would still have lost it. **But the reason given was false**, and a
>    > reader checking the reason rather than the conclusion would have found the paragraph wrong.
>    >
>    > **`web-agent` deliberately did NOT switch web to the variant**, and that was right: it is a
>    > **visual change to a shipped header**, not a relocation. **Whether the two consoles should
>    > look identical there is the user's call, not an implementation detail of a package move.**
> 2. **`type = 'button'` as the default.** Web's `Button` lacks it, so **a web button inside a
>    `<form>` is `type="submit"` by HTML default** — web carries five explicit `type="button"` call
>    sites paying per-site what admin pays once, and the failure mode of forgetting is a stray form
>    submission.
> 3. **`role="alert"` on the field error**, with fifteen lines of rationale: `aria-describedby` is
>    read when a screen-reader user **arrives** at an input, but these errors are set **on submit**,
>    when focus is on the submit button. **So on web those messages are silent at the moment they
>    appear** — a live accessibility gap in the form rewritten the same day.
>
> **Web is fuller elsewhere** — `ButtonLink`, `Textarea`, `Select`, `ReadOnlyValue`, `required`,
> `counter`. **So it is a union in both directions, the same shape as the two KDF suites and for the
> same reason.**
>
> **The lesson is the one this session keeps producing, and this time it is the Team Lead's and it
> is inside a decision record:** a measurement of two files was generalised to three, and the
> generalisation was wrong about the two as well. **A decision record is exactly where such a claim
> does the most damage, because the next agent executes it rather than checking it** — and the only
> reason nothing was deleted is that the instruction to confirm came with it.
>
> ### AND THEN IT HAPPENED TWICE MORE IN THE SAME PARAGRAPH — WHICH IS THE ACTUAL FINDING
>
> **Three corrections, two authors, one claim, and each correction carried a fresh unverified
> assertion into the record:**
>
> | | Claim | Status |
> |---|---|---|
> | 1 | *"Admin's primitives are deleted; nothing in them to preserve."* | **False.** Reasoned from two files, extended to a third |
> | 2 | *"`onNavy` is a variant web hand-rolls the same classes inline."* | **False.** They share one utility and solve it differently |
> | 3 | The two are independent solutions; only admin named it | **Measured** — the strings compared, at last |
>
> **`web-agent` observed it first and stated it against itself:** *"I said it, you recorded it in a
> decision record, and it took measuring the two strings to see."*
>
> **THE MECHANISM IS THE ONE WORTH KEEPING: A DECISION RECORD DOES NOT PRESERVE A CLAIM, IT PROMOTES
> IT.** An observation reported by an agent is provisional and reads as such. **The same sentence in
> an ADR is a decision** — the next reader cites it, the next agent executes it, and **nobody
> re-derives it because the format asserts it has already been decided.** `architecture.md` §3c is
> about a comment citing a contract; this is the same failure where **the citation target is the ADR
> itself.**
>
> **The practical rule, and it is cheap: when an agent's observation becomes the REASON in a decision
> record, the reason is now load-bearing and needs the verification the observation did not.** Record
> the conclusion on evidence you have checked, or record the conclusion and mark the evidence as
> reported-not-verified. **The conclusion survived all three rounds here; only the reasons were
> wrong, and a reader checking reasons would have been misled every time.**

**Admin's primitives are MERGED, not deleted. The union is taken in both directions.**

### The one genuine conflict, and it is a product decision rather than a merge

**Admin's `Field` states its own precondition for an assertive role**: it is safe *because* the
errors are **not live-validated** — set on submit, cleared on change, so `alert` fires once per
attempt *"rather than on every keystroke, which is what makes an assertive role appropriate rather
than hostile."*

**Measured: web's form violates that precondition.** `CustomerForm` uses `mode: 'onBlur'` with
`reValidateMode: 'onChange'`, so errors re-validate on every change after first blur. **Dropping
admin's `Field` into web unchanged would make an assertive live region fire on keystrokes** —
hostile, in admin's own words.

**RULED: the announcement becomes a prop, `announce?: 'polite' | 'assertive'`, defaulting to
`polite`.**

- **`polite` fixes web's actual defect** — today those messages are announced **not at all**;
  `aria-live="polite"` announces them without interrupting, and is safe under live re-validation.
- **`assertive` is admin's, opted into explicitly**, which is where its precondition belongs.
- **The precondition travels with the value rather than living in a comment on one host's copy:**
  the prop's own documentation states that `assertive` requires submit-time-only errors. **A caller
  choosing it is choosing the constraint.**

**The alternative — moving web to submit-time-only validation so the shared `Field` could be
admin's unchanged — was rejected.** It is the larger change, it removes live re-validation that is
good for sighted users, and **it fixes a mismatch by deleting one side of it.** A prop with a stated
precondition keeps both behaviours and makes the difference deliberate.

**And this is the first real test of `0036`'s no-authority rule.** An `announce` prop is
presentation configuration and carries no authority; it decides nothing about who may see what.
**If a future prop cannot be described that way, it does not belong in `@dudo/ui`.**

**Into `@dudo/client-kdf`:** `kdf.ts`, `kdf-client.ts`, `kdf-worker.ts` — already byte-identical —
and **the UNION of the two `verify-kdf.mjs` suites.** Web contributes the assertion set; admin
contributes the drift mechanism; **picking either whole file loses something real.** The 17 parity
findings are closed **by this move**, which is why they were never worth closing separately.

**Staying put, because they should differ:** `main.tsx`, `config.ts`, `vite-env.d.ts`, `auth.ts`,
`use-session.ts`. Different entry points, different routes, different sessions. **A shared package
is not a place to put things that merely look alike** — `§12`'s look-alike trap, and the reason this
list is enumerated rather than described.

### Two constraints on execution, both measured rather than assumed

- **Admin is pinned in the same change, not after it.** Both trees today resolve identical versions
  (react 19.2.8, tailwind 4.3.3), so **hoisting changes nothing that runs** — but admin is on carets,
  and hoisting a caret range makes its resolution a question of when someone last installed.
  **Pinning must land with the workspace adoption or the safe state is temporary.**
- **Admin inherits all six `0036` libraries.** Inside the existing approval, and a real consequence
  rather than a detail: `admin.dudo.work` gains a router, a query cache, a table, RHF and Zod the day
  the primitives move.

## What this does NOT do

- **It does not merge the two consoles.** `0035`'s split is untouched and is the reason the shared
  layer must carry no authority: **they share a look. They do not share a permission model, a data
  layer, or a route tree.**
- **It does not change `0030`'s constraint.** This is configuration — a workspaces key, a package
  boundary, an install topology — and every piece of it is reversible by editing those things.
  **Nothing here reaches the data model.**
- **It costs nothing on the free tier.** Static assets do not invoke the Worker.

## Order of execution, and the gates that must move with it

1. **Admin pinned FIRST, then the root `workspaces` key — two changes, in that order.**

   > **AMENDED 2026-09-09.** This step originally said *"admin pinned in the same change"*, and
   > `web-agent` correctly refused to proceed: **the root `package.json` is the Team Lead's and
   > `platform/admin/package.json` is `web-agent`'s, so a single change would span two owners** —
   > the case `workflow.md` §2 says to serialize rather than run in parallel. **It caught a
   > contradiction between two sentences of this record and asked instead of resolving it in favour
   > of more scope**, which is the second time today it has done that.
   >
   > **Inverting the order removes the need for one atomic change entirely.** The "same change"
   > requirement existed to avoid a window in which hoisting acts on caret ranges. **Pinning first
   > eliminates that window rather than shrinking it**, and pinning is safe standalone — it removes
   > ranges from a package that already resolves the exact versions web pins. **Strictly better than
   > what it replaces.**
   >
   > `web-agent` pins `platform/admin/package.json`; **the Team Lead then adds the root
   > `workspaces` key.** Neither agent holds the other's file at any point.
2. `@dudo/ui` created; web's primitives and `cn.ts` moved; admin's two deleted; both hosts import it.
3. **`check:ui-purity` moves onto `@dudo/ui` and covers it alone** — not pointed at a second
   directory, which would bless two layers as correct.
4. `@dudo/client-kdf` created; the three KDF modules moved; **the two suites unioned.**
5. **`check:suite-parity` should then exit 0** — and it joins both `verify` scripts the day it does,
   on the same terms `check:source-bytes` joined the gate. **If it does not reach 0, the union is
   incomplete and that is the finding.**
6. `packages/testing/fixtures/contract-generator/` created; the generator fixtures relocated;
   `EXPECTED_EXCLUDED` to zero **in the same change**, which converts that assertion from bookkeeping
   into the mechanism enforcing the convention.

   > **AMENDED 2026-09-09 — `qa-agent` CREATES IT, NOT `web-agent`, AND IT IS NO LONGER STEP 6.**
   >
   > **The ownership was wrong.** `packages/testing/**` is `qa-agent`'s tree and is **deliberately
   > not a workspace member**, so bundling its directory creation into the workspace change put one
   > agent in another's tree for no reason. **Nothing about this step depends on the workspace work
   > at all** — it was sequenced last because it looked like packaging, and it is not.
   >
   > **And it has become load-bearing rather than tidy.** `architecture-agent` disclosed that
   > **all three of its latest generator improvements are verified by inputs that do not exist in
   > the tree** — the ordering fix by one scratchpad mutant, the label fix by nothing at all. Its own
   > words: ***"If that mutant is ever deleted, this fix goes untested and looks fine."***
   >
   > **`workflow.md` §11a already rules on this: a preserved artifact goes in the repository or it is
   > not preserved** — a rule written after a previous session's scratchpad evaporated and took a
   > reproduction fixture with it. **Every probe verifying the generator is currently in that state.**
   >
   > **Do it now, not last.**

**Step 5 is the acceptance test for this whole decision.** A parity check that reaches zero is proof
the union happened; one that stays red names exactly what was left behind.

## Consequences

- **`0036`'s "single primitive layer" sentence becomes true for the first time.** It has been false
  since it was written, and nothing went red — the same failure `workflow.md` §12 records, arriving
  in a decision record rather than in a test.
- **A constraint that has never been tested acquires a subject.** The no-authority rule has been
  correct and inert; after step 3 it is enforced on the only layer it can apply to.
- **The next divergence between the two consoles has to be deliberate**, because there will be one
  artifact rather than two files that look alike.

---

## AMENDMENT, 2026-09-09 — `packages/contracts` IS A WORKSPACE MEMBER, and this decision is what ruled it

**`0037` requires that generated types be CONSUMED and never re-declared. Until today no consumer
could import one.** `packages/contracts` was not a workspace member and neither client carried an
alias to it, so **the generator's entire output — 17 modules — was unreachable from the two trees it
was built for.** Nothing was red. The types generated cleanly, committed cleanly, drift-checked
cleanly, and **no client could name one.**

**It was found by `web-agent` while blocked on the Milestone 1 type swap**, and how it was found is
the part worth keeping: **it had already established it could fix this inside its own boundary** —
a `paths` entry in `platform/admin/tsconfig.json` and a Vite alias, both its to edit — **and it
argued against doing so and asked for a ruling instead.**

> **A per-client resolution of a shared thing is the divergence this decision exists to end.** Three
> consumers — two clients and Core — read one contract set. Three private resolutions of it drift
> silently, and `architecture.md` §1 names a shape one client has and the other does not a **contract
> defect, not a client-local workaround.**

**Ruled: a workspace package, on this ADR's own precedent.** `@dudo/contracts`, private, shipping
TypeScript source with no build, exactly like `@dudo/ui` and `@dudo/client-kdf`.

### The `exports` map is an enforcement boundary, and that is the reason to prefer a package over an alias beyond consistency

```
"exports": { "./*": "./generated/*.ts" }
```

**A client cannot import the generator, the schemas, the YAML or the validators — module resolution
refuses.** *Clients consume contracts and never execute them* stops being a sentence in a README and
becomes a build failure. **An alias would have granted the whole directory**, and `architecture.md`
§3a is precisely about preferring the mechanism over the discipline.

**And the import path mirrors the contract path exactly**, which makes a citation checkable by
inspection — `§3c`'s concern, answered structurally:

```
packages/contracts/core/platform/template-v1.contract.yaml
@dudo/contracts/core/platform/template-v1
```

### The superseded reason, and why it is superseded rather than ignored

The root `package.json` recorded that `packages/contracts`, `packages/sdk` and `packages/testing`
were **deliberately** not members: *"they are not npm packages, and adding them changes what
`npm install` does to trees that do not want it."*

**That gave a REASON rather than a rule, and the reason does not hold for this member — measured, not
assumed.** The package declares no dependencies and no `peerDependencies`, because the generated
modules export **types only**. The lockfile diff is a single `"link": true` entry pointing at a local
path: **no external package resolved, no integrity hash, nothing fetched.** `packages/sdk` and
`packages/testing` remain non-members and the original reason still holds for them.

### What is verified and what is owed

**Verified:** the symlink resolves, the export target is a real file, `npm test` **0**, `npm run
typecheck` **0**, and the lockfile gained nothing external.

**NOT verified, and named rather than assumed: no import has been compiled.** That needs a file in
`web-agent`'s tree, and `workflow.md` §11a is explicit that *"I checked it explicitly"* means
**usable end to end by the party that should use it** — not that the mechanism the author just built
behaves as designed. **`web-agent`'s first import is the verification**, and `RevokeOperatorOutput`
is the shape to use for it: the only Group 2 type carrying no enum, so it tests the import mechanism
without waiting on `0041`'s sweep.

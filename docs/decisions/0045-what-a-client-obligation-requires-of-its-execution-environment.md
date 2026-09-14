# 0045 — What a client obligation requires of its execution environment

- **Status:** **ACCEPTED 2026-09-13 by the Dudo Team Lead.**
- **Found by:** `security-agent`, reviewing a missing-header finding and declining to file it as the
  finding it was asked about.
- **Governs:** every rule of the form *"the client must …"* — in a contract, a decision record, or a
  standard — across both clients and every future one.
- **Arises from:** Milestone 2's security-header review.

---

## 1. The gap, and it is a shape rather than an omission

**`0027` enumerates five things Core cannot verify about the client. `CF-2` is the load-bearing
one:**

> **"Core cannot verify the client displayed what it was given."**

The confirmation mechanism's whole argument is that **the party being constrained does not author
the statement of the constraint** — Core mints a verbatim statement, the client displays it, the
operator reads *that* and re-authenticates against *that*. **`ConfirmationGate.tsx` renders
`{challenge.statement}` and the design rests on that being what the operator reads.**

**An attacker executing script in the console rewrites that text node.** The operator reads *"revoke
a dormant test operator"*, approves something else **with their own correctly-derived password**,
and Core cannot tell. **`CF-2` says exactly this, in as many words.**

> **`CF-1` through `CF-5` are all questions about what CORE can verify. Every one is an admission,
> and every one is closed as unclosable.**
>
> **THE GAP IS NOT A MISSING `CF-6`.** The whole family assumes a client whose DOM says what the
> client sent — **and that assumption has never been written down as an assumption.**

## 2. ⚠ WHY THE OBVIOUS WAY TO RECORD THIS WOULD HAVE CHANGED NOTHING

**The natural entry is `CF-6: Core cannot verify the browser is uncompromised`.** It is true, it is
in the right file, and it is worthless:

> **It reads as one more unclosable admission, and nobody acts on an unclosable admission.** The
> `CF-` family is a list of things that have been accepted; adding to it is filing, not deciding.

**`security-agent` named the inversion and it is the entire content of this record:**

> **The actionable form is the INVERSE: what must be TRUE of the client environment for a client
> obligation to mean anything, and WHAT ENFORCES IT.** *"That is a requirement someone can satisfy,
> and the headers are the first instance of it."*

**A statement about what Core cannot do is closed. A statement about what the environment must
provide is a requirement with an owner, a mechanism, and a test.**

## 3. THE RULE

> ### **A rule of the form *"the client must X"* is not a control until something says what the client's EXECUTION ENVIRONMENT must guarantee for X to be meaningful, and what enforces that guarantee.**
>
> **Stating the obligation is half. The other half is the environment in which the obligation can be
> relied upon — and it is the half nobody is prompted to write, because the obligation reads as
> complete on its own.**

**Mechanically, for every client obligation:**

| | |
|---|---|
| **The obligation** | *the client displays the statement verbatim* |
| **The environment requirement** | *no party other than the application may execute script in that document, and no party may frame it* |
| **The enforcement** | `Content-Security-Policy: script-src 'self' …` and `frame-ancestors 'self'` |
| **The verification** | a post-deploy assertion that the deployed response carries them |

**All four, or the obligation is a request rather than a control.**

### 3a. This is `architecture.md` §3c's "already checked" one level up

That section refuses a comment asserting an input was validated without naming what validated it:
**"already checked" names no checker and therefore creates no obligation; it only transfers one.**

**A client obligation with no environment requirement is the same defect at the scale of a
mechanism.** `CF-2` transfers statement integrity to the browser, **and no record says what protects
the browser** — so the obligation is discharged to a party nobody has specified and nothing checks.

### 3b. And it is not a browser rule — it binds every client

**Stated deliberately, because the first instance is a web header and the rule is not about
headers.** `Dudo-Apple` runs the same contracts and inherits the same obligations, in an environment
with entirely different guarantees — code signing and a sandbox rather than a CSP, and no framing
question at all.

**`architecture.md` §3's *"a rule enforced in only one client is not enforced"* applies to the
environment requirement exactly as it applies to the rule.** Whoever builds a confirmation surface
on Apple owes the same four rows, with different mechanisms in the third and fourth.

## 4. THE FIRST INSTANCE, AND WHY IT WAS FOUND SO LATE

**Neither host sent any security response header, and nothing in the repository ever asked for one.**
`security-agent` searched `docs/`, `packages/contracts/`, `platform/core/`, `.claude/` and
`CLAUDE.md` for every relevant term — **with `.claude/` and `CLAUDE.md` named by explicit path,
because the recursive wrapper cannot see them** (`workflow.md` §11a) — and a positive control
confirmed the instrument reached those files. **Zero substantive hits. The absence is measured.**

> **That is not an oversight anyone could have caught by reviewing the headers, because nothing
> pointed at them.** The threat model had a client-side half and only the Core-side half was ever
> written, **so no reader was ever prompted to ask what the browser needed.**

**And the SERVING TOPOLOGY is why no code review would have found it either:** `run_worker_first` is
`["/api/*", "/auth/*", "/health"]`, so **the HTML document never enters the Worker.** There is no
line of Dudo code in its response path.

## 5. What this record does NOT do

- **It does not decide the header values.** Those are specified in the review and land in
  `platform/web/public/_headers` and `platform/admin/public/_headers`; the operational detail lives
  in `docs/operations/deployment-runbook.md` §7a.
- **It does not close `CF-2`.** `CF-2` remains unclosable and correctly recorded as such. **This
  record says that an unclosable admission about Core creates a REQUIREMENT on the environment**,
  which is a different sentence with a different owner.
- **It does not claim the requirement is met.** It is met when the headers are deployed **and
  verified on the deployed response** — and `security-agent` measured that `wrangler` never
  validates `_headers` at deploy time, so **a typo is a green deploy over a dead file.** Until a
  post-deploy assertion exists, this is specified and unenforced.

## 6. The obligation this record creates, assigned rather than left implicit

**`workflow.md` §12: a deferral without an owner is one nobody collects.**

1. **Every existing client obligation is owed the four rows in §3** — starting with `0027`'s
   `CF-` family, and including `0026`'s sensitivity ladder where it relies on a client rendering
   anything. **Team Lead, and not inside this milestone unless a surface forces it.**
2. **A new contract stating a client obligation states its environment requirement in the same
   clause.** `architecture-agent`, at authoring time — **one sentence, at the point where the
   obligation is written, which is the only moment anyone is thinking about it.**
3. **The post-deploy verification is `qa-agent`'s**, in `packages/testing/verify-staging.ts`, where
   **no assertion covering a response header exists today** — measured, and that absence is why §5's
   last clause is not hypothetical.

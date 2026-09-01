# App-manifest validation fixtures

**Owner: `qa-agent`.** Everything here is **data**, not test code.

These fixtures pin the security behaviour of
`packages/contracts/registries/app-manifest.schema.json` and of the registry-aware
validator that will eventually sit alongside it. They exist so that a rule which was
argued for once stays enforced, and so that the *reason* a case passes or fails is
recorded next to the case rather than reconstructed later from a diff.

---

## 1. Why there is no test code here

**No test framework is approved.** `docs/decisions/0003` approves TypeScript on
Cloudflare; it approves no npm package, and `TESTING_STANDARD.md` open question **TS1**
records that the framework choice needs its own decision record *before any test is
written*.

So this directory contains **only `.json` fixtures and this README**:

- no `package.json`, no dependency manifest, no lockfile
- no `import`, no `describe`, no `it`, no assertion library
- nothing that presumes Vitest, Jest, `node:test`, or any runner

The fixtures are plain JSON with their expectations recorded **inside the data**. When
TS1 is decided, a runner is roughly twenty lines (§5) and **no fixture changes**. That is
the point of the format: the framework decision cannot invalidate the fixtures, and the
fixtures cannot pre-empt the framework decision.

---

## 2. Layout

```
packages/testing/fixtures/app-manifest/
├── README.md      this file
├── index.json     the case index and the case-file shape
└── az7/           AZ7 — own-scope Actions must name the Entity they operate on
    ├── az7-n1 … az7-n8    negatives, each must be REJECTED — there is NO az7-n7
    ├── az7-p1 … az7-p4    positives, each must be ACCEPTED
    ├── az7-r1 … az7-r3    invocation-time obligations (runtime, not manifest)
    └── az7-q1, az7-q2     OPEN QUESTIONS — expectedOutcome is UNDECIDED
```

**There is no `az7-n7`, and the gap is deliberate.** That id named the cross-tenant
invocation case, which is `kind: "invocation"` and belonged in the r-series by this set's
own taxonomy; it is now **`az7-r3`**. The id is **not reused**, because it appears in
earlier QA reporting as the cross-tenant case and rebinding it would silently falsify
those references. `index.json` records the retirement under `retiredCaseIds`.

`index.json` lists the cases and documents the case-file shape. It deliberately **does
not repeat any expected outcome**: the case file is the single source of truth, so the
two can never disagree.

One file is one case. Each carries `expectedOutcome`, `enforcedBy`, a `why` in security
terms, and `notes` explaining how to read its result. Reading a fixture should tell you
what it defends without reading anything else.

---

## 3. The schema-versus-validator split — read this before reporting a result

**This is the most important section in this file.** Getting it wrong produces a false
defect report against the schema, or worse, a false green.

`app-manifest.schema.json` is JSON Schema draft 2020-12. Draft 2020-12 **cannot compare
a value at one location in the instance against a value at another location in the
instance.** There is no keyword for it. It is not a gap in the schema's authoring and it
cannot be closed by writing more schema.

That splits AZ7 into two layers:

| `enforcedBy` | Meaning | If the schema disagrees with `expectedOutcome` |
|---|---|---|
| `schema` | Decidable by the schema alone. The dependency lives inside one object, or is a plain grammar check. | **That is a real schema defect.** Report it against `core-agent`. |
| `validator` | **Referential.** Requires joining `action.targetEntity` against sibling `entities[].name` values. **Not expressible in JSON Schema.** | **NOT a schema defect. Do not report it as one.** The schema is *expected* to accept these. The obligation is the registry-aware validator's. |
| `schema+validator` | Both layers must agree on the outcome. | Depends which layer disagreed — read the case's `notes`. |
| `runtime` | An invocation-time obligation. No manifest fixture can decide it. | Not applicable; these are not run against the schema at all. |
| `undecided` | An open question. `expectedOutcome` is `UNDECIDED`. | **Excluded from every pass/fail total until the question is answered.** |

Cases **az7-n2, az7-n4, az7-n5a, az7-n5d, az7-n8, az7-q1 and az7-q2 are `validator`**. A
schema run will **ACCEPT** all seven. **That accept is correct and expected.** Report it as
`NOT-DECIDABLE-BY-SCHEMA`, never as `FAIL`, and never as a defect in
`app-manifest.schema.json`.

`AUTHORIZATION_STANDARD.md` §4.1 says the same thing normatively, and says it about
itself: the table of what the schema enforces is followed by "That is clauses 1 and 2, in
full, and **nothing of clause 3**. […] Reading the table above as 'VAL-OWN is enforced' is
the exact overclaim that produced the earlier defect."

Two traps worth naming explicitly, because both look like fixes and neither is one:

- **`uniqueItems` does not fix `az7-n5a`.** `uniqueItems` compares whole array items.
  The two `Widget` entities in that fixture differ — one declares `ownershipField` and
  one does not — so `uniqueItems` passes them both. The check needed is "the *projection*
  `entities[].name` contains no duplicate", which is outside JSON Schema.
- **A case-insensitive lookup does not fix `az7-n2`.** It makes `az7-n5d` pass by
  introducing a worse bug: an App could then name a target that is not the entity it
  declared. Reference resolution is exact and case-sensitive.

---

## 4. What AZ7 requires

An Action declaring `scope: "own"`:

1. **MUST** declare `targetEntity` — *schema*.
2. `targetEntity` **MUST** reference an Entity declared in the **same manifest**
   — *validator*.
3. That Entity **MUST** itself declare a valid `ownershipField` — *validator*.
4. An `ownershipField` on an **unrelated** Entity **does NOT** satisfy it — *validator*.
   This is the CWE-863 case, isolated in `az7-n4`. The same principle applies one level
   down, from the entity to the field: an `ownershipField` may name only a field the
   **resolved** Entity declares, and `az7-n8` is the case where an unrelated Entity
   declares a field of that name and must not be allowed to substitute.
5. Missing, unknown, malformed or ambiguous `targetEntity` **FAILS CLOSED** — rejected
   outright, never accepted and then evaluated as unrestricted.
6. Clients and Apps **cannot supply an ownership relation at invocation time**
   — *runtime*, `az7-r1`, `az7-r2`, and — one level out, at the tenant boundary rather
   than the ownership boundary — `az7-r3`.

### Case-to-obligation map

`AUTHORIZATION_STANDARD.md` §4.1 states VAL-OWN as three clauses and enumerates six
numbered obligations as **VALIDATOR-AZ7**. Every case here maps to one:

| Obligation | Cases |
|---|---|
| Clause 1 — manifest declares at least one owned entity (*schema*) | `az7-n3`, `az7-n6`, `az7-p4` |
| Clause 2 — `own` implies `targetEntity` (*schema*) | `az7-n1`, `az7-p3` |
| `targetEntity` well-formed, via `$defs/entityName` (*schema*) | `az7-n5b`, `az7-n5c` |
| VALIDATOR-AZ7 **1** — resolution, exactly one match | `az7-n2`, `az7-n5d`, `az7-q1` |
| VALIDATOR-AZ7 **2** — entity names unique, ambiguity rejected | `az7-n5a` |
| VALIDATOR-AZ7 **3** — resolved entity owns, and `ownershipField` names a real field | `az7-q2`, **`az7-n8`**, `az7-p1` |
| VALIDATOR-AZ7 **4** — no substitution from an unrelated entity | **`az7-n4`**, `az7-p2`, and at field level `az7-n8` |
| VALIDATOR-AZ7 **5** — `targetEntity` outside `own` carries no scoping semantics | `az7-q1`, `az7-p3` |
| VALIDATOR-AZ7 **6** — ownership never asserted at invocation | `az7-r1`, `az7-r2`, `az7-r3` |

`az7-n8` is the one case listed on two rows, and the split is deliberate: the **rule that
rejects it** is item 3 — the validator emits `AZ7_TARGET_OWNERSHIP_FIELD_UNDECLARED` with
`rule: "VALIDATOR-AZ7 item 3"` — while the **defect it closes** is item 4's
no-substitution principle applied from the entity down to the field. Listing it only on
item 4 would map it to a rule the validator does not cite; only on item 3 would hide the
gap it exists to close.

Two questions this fixture set raised were open when the cases were written and have
since been decided; `az7-q1` and `az7-q2` keep the `q` prefix and their provenance so the
decision is traceable rather than silently absorbed.

**One question is still open and no fixture asserts an answer:** whether the
`ownershipField` on an `own`-scope target must also be `required: true` and of type
`reference`. A nullable owner column silently un-scopes every row where it is null. QA
recommends both; nothing here depends on it.

---

## 5. How to run these, once a framework exists

The fixtures are already runnable data. A runner needs to:

1. Read `index.json` and enumerate `sets[].cases[]`.
2. Load each case file.
3. **Skip** cases whose `expectedOutcome` is `UNDECIDED`, and report them as such rather
   than silently dropping them.
4. **Skip** cases whose `enforcedBy` is `runtime` when validating manifests; report them
   as **NOT RUN**. They are executable only once an invocation contract exists in
   `packages/contracts/**`.
5. For `kind: "manifest"`, validate `case.manifest` against
   `packages/contracts/registries/app-manifest.schema.json`, then classify:
   - `enforcedBy` is `schema` or `schema+validator` → compare with `expectedOutcome`,
     report **PASS** or **FAIL**.
   - `enforcedBy` is `validator` → report **NOT-DECIDABLE-BY-SCHEMA**, and record the
     schema's actual answer for information only. **Never PASS/FAIL these on the schema.**
6. Once a registry-aware validator exists, run every `manifest` case through it too, and
   report `validator` and `schema+validator` cases as PASS/FAIL against that layer.
7. Report the pairs listed in `index.json` under `pairsThatMustBeReportedTogether`
   **side by side**. `az7-n4` alone can be made green by refusing every `own`-scope
   Action; only `az7-n4` **and** `az7-p2` together show the rule is enforced rather than
   the feature banned. **`az7-n8` has exactly the same property** and the same control:
   it too goes green under a validator that refuses every `own`-scope Action, so it is
   reported next to `az7-p2` as well. `az7-p2` is the over-rejection control for **both**
   negatives, and a report naming only the `az7-n4`/`az7-p2` pair leaves `az7-n8`
   uncontrolled.

Use the real Workers runtime when TS1 is decided, not a Node emulation — per TS1,
testing Workers code in Node proves the wrong thing. For pure JSON-Schema fixtures the
runtime barely matters; for everything that follows in this directory it will.

---

## 6. Rules for anyone adding a case here

- **Synthetic data only.** Never real customer data. No credentials, tokens, or keys —
  not expired ones, and not "obviously fake" ones that pattern-match a real format and
  will be flagged forever by every scanner (`TESTING_STANDARD.md` §7). Every identifier
  in these fixtures is suffixed `-synthetic` or is plainly a fixture name.
- **Never weaken a case to make it pass.** No deleted assertion, no widened expectation,
  no `expectedOutcome` flipped to match an implementation. A fixture that fails and
  describes reality is a deliverable.
- **Never change `expectedOutcome` to match observed behaviour.** Change it only when a
  recorded decision changes what is correct, and say which decision in `notes`.
- **State the `enforcedBy` layer honestly.** Marking a `validator` case as `schema`
  manufactures a schema defect; marking a `schema` case as `validator` hides a real one.
- **Record open questions as `UNDECIDED`** rather than guessing, and exclude them from
  totals. See `az7-q1` and `az7-q2` for the form.
- Cross-tenant references in a fixture are a critical defect exactly as in production
  code (`TESTING_STANDARD.md` §5).

---

## 7. Provenance

- **CWE-863 (Major)** — raised by CodeRabbit on `app-manifest.schema.json`: `$defs/action`
  carried no entity reference, so VAL-OWN was satisfiable by *any* entity declaring an
  `ownershipField`, letting an `own`-scoped Action target an unowned entity.
- **Found independently by `qa-agent`** while verifying CRIT-4 remediation. The prior
  CRIT-4 fixture `D.5b` was recorded at the time as a known, pinned gap rather than a
  pass.
- **`AZ7`** — the open question in `AUTHORIZATION_STANDARD.md` §4 that names the
  underlying cause: an Action could not name the entity it operates on.

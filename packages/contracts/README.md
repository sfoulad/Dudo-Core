# packages/contracts/ — Shared Contracts

**Owner: `architecture-agent`** (see `docs/architecture/boundaries.md`)

The single source of truth for how Dudo's modules talk to each other. Every boundary
crossing in the system is defined here.

- **Only `architecture-agent` authors contracts.** `core-agent`, `web-agent`,
  `plugin-agent`, and `app-agent` consume them and must never edit this directory.
  Authorship moved here from `core-agent` by
  `docs/decisions/0004-repository-structure.md`: the agent that implements a contract
  must not also be the one who approves it.
- A contract defines the request shape, the response shape, the error cases, the
  **authorization expectation**, and the **tenant scope**. A type alone is not a contract.
- Contracts are **versioned**. Additive changes may proceed; a breaking change to a
  published contract requires Team Lead review and a decision record.
- **One contract set, two clients.** The responsive web client and the Apple client
  consume the same contracts. A shape one has and the other does not is a defect, not a
  local workaround.
- `qa-agent` tests the producer and **both** consumers against every published contract.
- A missing contract **blocks** the consumer. It is requested from the Team Lead — never
  stubbed, guessed, or worked around.

Contract-first sequencing: `CONTRIBUTING.md`

## Layout

```
common/         platform-wide shapes every contract reuses — the error envelope, pagination
registries/     the five machine-readable registries (permissions, events, Core objects,
                manifest schemas)
validation/     zero-dependency validators (docs/decisions/0009)
core/<domain>/  Core's own published contracts, one directory per Core domain
apps/<app-id>/  one directory per App, holding that App's contract set
```

Each contract set is three artifacts, all normative together: a `README.md` carrying the
reasoning, the state machines and the open questions; a `*.schema.json` carrying the request
and response shapes; and a `*.contract.yaml` carrying the Action definitions, permissions,
tenancy, audit, HTTP binding and free-tier impact. **A type alone is not a contract**, which
is why the shapes file is never the whole set.

`core/identity` uses **two** files rather than three — the reasoning lives in its
`*.contract.yaml` — and says so in its own header, so a reader does not conclude a `README.md`
was lost. It is also the one set that describes **pre-authentication entry points rather than
Actions**: no permission, no scope, no `ActionContext`, no tenant. That is not a gap in the
set; it is what `docs/decisions/0014` §B's admission rule is.

`core/**` and `apps/**` differ in what they may contain, not in form. A Core contract covers
an object in `registries/core-object-registry.yaml` under a `core.*` permission, and is served
from Core's flat reserved API namespace. An App contract covers the App's own entities and is
served under `/api/v1/apps/<app_id>/...` unless the Team Lead allocates it a flat segment. An
App may never publish a contract over Core's data, and Core contracts carry no business-domain
concept — `Core stays small` is a boundary this directory records rather than one it relaxes.

## Contracts on record

| Contract | Version | Status |
|---|---|---|
| `apps/customers` — Customer Directory | 1 | **Proposed.** Awaiting Team Lead agreement; no consumer implements against it yet. |
| `core/organization` — Business Read | 1 | **Proposed.** Awaiting Team Lead agreement. Resolves `business_id` to a name and lists a principal's authorized Businesses — the gap `app-agent` found while building against the Customer Directory. Closes the *contract* gap only: no Business name is stored anywhere yet and the authorized business set is empty for every principal, both of which belong to the organization-structure slice. See its `README.md` §2 before reporting it as unblocking anything. **Revised 2026-09-04:** the resolve route moved from `GET` with repeated query parameters — a form Core refuses outright, so the Action could not succeed for more than one identifier — to `POST` with a JSON body. Shapes unchanged. |
| `core/identity` — Login | 1 | **Corrected 2026-09-05: it said there was no logout, and there has been one since `0018` landed.** `admin-shell` needed sign-out, found the contract and Core disagreed, built against Core and reported it — the right call, and *a client choosing code over the contract is what contract-first exists to prevent*. The fault was the contract's: **a contract that says a feature does not exist gives a client nothing to build.** Revocation deletes the session row, emits a constant clearing cookie, accepts either carrier, and collapses all six paths to one outcome. One stale QA assertion — *"neither client calls /auth/session/revoke"* — would have failed the moment sign-out was built correctly. **A contract-versus-code check is owed for this whole set**, which is a transcription of an implementation that preceded it and therefore the most exposed to this drift. Original entry: **Proposed.** Awaiting Team Lead agreement. **This one documents an implementation that preceded it** — `platform/core/identity/login.ts` was built with no contract, out of order under `.claude/rules/workflow.md` §3, and two client agents had to guess the field names from source. It is a transcription, not a specification: where it and Core disagree, Core is what runs. Two files, not three, and it describes pre-authentication entry points rather than Actions. Carries the **normative** client-side KDF parameters and `normalizeIdentifier` definition that both clients must implement byte-identically — including the **NFC** password rule (amended into `0015` §D on 2026-09-04), which is the one rule in any Dudo contract that **Core cannot enforce**, because Core never receives a password. Its only enforcement is shared client test vectors. Note the deliberate asymmetry: **NFC** for the password, **NFKC** plus ASCII-only case folding for the email. **A 200 from login is not a usable session** — see the row below. |
| `core/platform` — Platform operator | 1 | **Accepted 2026-09-05** by the Team Lead, once `0025` carried every decision it was waiting on (`PO-1` the operator action log, `PO-2` the D11 bootstrap exception — both now `0025` Decisions 5 and 4). **The first accepted contract in this directory.** Defines the **fourth request class**: principal-level authentication, **no tenant**, **and a permission** — the gap between `0021`'s session routes (no permission) and Actions (tenant required). Carries the `platform_operator` authority model, the **mutual-exclusion invariant** with `organization_membership`, the two-home audit model, and the **bootstrap exception to `0007` D11** that onboarding depends on. The other three platform contracts inherit all of it and restate none of it — **read this one first or they cannot be reviewed.** |
| `core/platform` — Template | 1 | **Accepted 2026-09-05.** The user's first requested capability: a business type, which `0025` settles **is** `ARCHITECTURE.md` §1's fifth extension type arriving five phases early. A name and per-level display labels. **Complete and inert on arrival** — nothing consumes a Template until onboarding references one, and it must be reported that way rather than as "business types now work". |
| `core/platform` — Organization onboarding | 1 | **Accepted 2026-09-05.** Takes **no confirmation** — `0026` reclassified `core.organization.create` to `sensitive` precisely so it would be reachable without one, and re-imposing it by hand would collapse the distinction `0026` was protecting. Six objects across two databases in one operation, and the route by which Dudo acquires a customer at all. Corrects `control-plane-admission.ts`'s **"onboarding is 6" to 10**. Deliberately breaks `credential-store.ts`'s strongest property — that no request can create a credential — and says so. **Unreachable until ON-6 is ruled on**, because `core.organization.create` is `critical` and the confirmation mechanism `0007` D15 requires does not exist. |
| `core/platform` — Confirmation | 1 | **Accepted 2026-09-05** (`0027`), with a `locale` amendment that ruled *against* this contract's own `CF-4` recommendation and improved it: localisation requires the client to **choose** a language, not to **render** the text, so Core composes the statement in the requested locale and `CF-2` is left as it was rather than widened. |
| | | The elevation mechanism `0007` D15 requires, written for **three callers at once** — `core.credential.reset`, `customers.customer.delete`, and whatever is declared critical next. Two rulings the Team Lead asked for: confirmation proves **intent AND presence** (a server-authored statement plus a re-authentication), and it is **neither a route class nor a per-Action concern** but a **pipeline concern derived from the catalog's `sensitivity`** — so declaring a permission `critical` requires confirmation automatically, with no code change and no chance of omission. |
| `core/platform` — Credential reset | 1 | **Accepted 2026-09-05.** Stays `critical` and **does** carry the two-step confirmation. `CR-5` was closed **by this contract's request-shape change, not by `0026`** — the KDF salt is the target's normalised identifier, which neither the console nor the server can supply, so a reset would have bricked the account it was meant to rescue. An operator replaces a credential; generated, shown once, never stored recoverably. **Seeing a password is arithmetically impossible, not withheld** — there is no password column and no reversible form of one. Requires session revocation, without which a reset changes the lock on a door an attacker is already through. **Blocked on CR-1**, the same missing confirmation mechanism, and correctly the last of the four to become buildable. |
| `core/identity` — Account identifier | 1 | **Proposed.** The **canonical definition** of a Dudo login identifier, consolidating a rule that was restated in five places with no two agreeing. **Ruling: Dudo does not accept non-ASCII identifiers** — which confirms `0015` §D rather than deciding anything new. Corrects two contracts whose pattern required *exactly one* `@` while Core requires *at least one* (additive). Records the enforcement gap: two Core paths accept what all three contracts forbid, and the only live check is client-side. **Read `whereTheRefusalBelongs.theTRAPINTHEOBVIOUSFIX` before implementing** — the obvious fix breaks Template naming. |
| `core/identity` — Organization selection | 1 | **Two defects corrected 2026-09-05, both found by `web-agent` while implementing.** `the422Rule` asserted something false — `failed_precondition` is argument-free with a constant message, so the Customer Directory's state-machine refusals and "no Organization selected" are **byte-identical on the wire**, and a client following the rule draws an Organization picker at someone who archived an archived customer. The fix is a distinct `organization_not_selected` code, required of Core; `web-agent`'s probe stays until it lands. The file also still described the **server-side auto-selection `0021` struck** — that block is withdrawn and `clientObligations.theFlow` is rewritten and authoritative. **The contract was wrong and the implementation right, both times.** Roughly twenty stale auto-selection mentions in the lower sections are owed a sweep. Original entry: **Proposed.** Awaiting Team Lead agreement, and it **unblocks the deployed platform**: a seeded principal logs in and every business request returns 422 `failed_precondition`, because `selectOrganization` and the Organization picker exist as `SessionResolver` methods with **no HTTP route**. Selection is mandatory for every principal, not only multi-Organization ones. **Mixed provenance** — the two resolver methods are transcribed, the routes and wire shapes are new, and it requires a **third route class** (authenticated at the session level, no `ActionContext`, no tenant) that does not exist yet. Publishes the one route in Dudo where a caller names a tenant. |

## Form, and what is not yet decided

**AS1 — the executable form and transport of a Dudo contract is still undecided**
(`API_STANDARD.md` §13). Contracts here follow the precedent this directory already set —
**JSON Schema draft 2020-12** for shapes, **YAML** for registries and Action metadata —
rather than selecting a new form. That keeps the contract language-neutral, which matters
because `Dudo-Apple` is Swift. No framework, library, ORM or npm package is selected by any
contract here, and none may be installed to consume one.

**Nothing in this directory is executed.** There is no JSON Schema implementation in this
repository, no `package.json` and no `node_modules`, so every schema here is normative and
hand-checked, never machine-validated. Cross-file `urn:` `$ref`s require a resolver that
does not exist yet. No report may describe these schemas as validated.

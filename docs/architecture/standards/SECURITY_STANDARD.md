# Security Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** everything.
- **Relationship to `.claude/rules/security.md`:** that document is the binding rule set for the team and **is not restated here.** This standard is the engineering elaboration: threat model, data classification, validation, audit, redaction, egress, dependencies, and review. Where the two overlap, the stricter reading applies.
- **Source:** `.claude/rules/security.md`; `CONSTITUTION.md` Rule 10.
- **Reconciled against the built system 2026-09-06.** §13 classifies all five open issues;
  **all five remain open**, and none is closed by anything built since. Two contradictions are
  marked where the rule is stated: §6's **confirmation reference**, which no audit home records
  although the confirmation mechanism now exists (`0027`), and §9's **dependency pinning**,
  which twelve of twelve declared dependencies do not satisfy. **In both cases this standard is
  the correct side and the system is what should change** — neither rule has been weakened to
  match, and both are reported to the Team Lead rather than repaired here. **§1's threat model
  survived contact with the code unchanged**, and threat 7 — *"us: an agent making a
  plausible-looking change that removes a check"* — is the one this pass was looking for and
  did not find: no security control in `platform/core/**` has been quietly removed.

---

## 1. Threat model

Dudo holds other companies' customers, invoices, payroll, contracts, and bank details.
Design against these adversaries, in this order:

| # | Adversary | Primary control |
|---|---|---|
| 1 | **A tenant reaching another tenant's data**, deliberately or by our bug | `MULTITENANCY_STANDARD.md` — isolation by construction, not by predicate |
| 2 | **A marketplace App**, which is untrusted by assumption | Declared permissions, enforced at every call; no storage access; declared egress |
| 3 | **An over-permissioned insider** in a tenant | Scopes, separate `list`/`export` permissions, audit, elevation for sensitive actions |
| 4 | **A compromised Connector or vendor** | Tenant-scoped credentials, egress allowlist, closed error mapping, no storage access |
| 5 | **A prompt-injection attacker** via documents, email, or external tools | AI below the authorization boundary; content is data, never instruction (`AI_STANDARD.md` §5) |
| 6 | **An unauthenticated internet attacker** | Authentication, validation, rate limiting, opaque non-sequential identifiers |
| 7 | **Us** — an agent making a plausible-looking change that removes a check | No self-review; contract-first; the checklists in every standard |

**Assume every marketplace App is untrusted.** Including our own. An official App that
only works because it is official has found a hole a third party will find too.

---

## 2. Deny by default

Everywhere, not only in authorization:

- No permission → denied.
- No declared capability → not resolvable.
- No declared egress host → call refused.
- No declared event subscription → not delivered.
- No declared UI location → not rendered.
- No `exposure` on an Action → not public, not AI-visible.
- No tenant context → the operation does not run.

A default that is permissive is a decision nobody made.

---

## 3. Data classification

Every field an App or Core stores is classified. Classification drives logging,
export, audit, and AI-provider rules.

| Class | Examples | Rules |
|---|---|---|
| **Public** | Marketplace listing, App name | No restriction |
| **Internal** | Record ids, timestamps, counts | Never crosses a tenant |
| **Business confidential** | Customers, invoices, orders, contracts | Never logged; never in an error message; never leaves the tenant; export is audited |
| **Sensitive personal** | National ids, addresses, health data, employee records | The above, plus explicit permission, plus audit on read where the tenant requires it |
| **Financial instrument** | Card numbers, IBANs, bank details | Never stored in full unless a recorded decision says so; never logged; never in an event payload; never sent to an AI provider |
| **Secret** | API keys, tokens, signing keys, passwords | Never printed, logged, echoed, committed, put in a fixture, or shown to an App. §5 |

An entity definition that does not classify its fields is incomplete.

---

## 4. Input is untrusted

Everything from outside a trust boundary is untrusted: client requests, App inputs,
Connector responses, webhooks, event payloads from another App, file contents, OCR output,
model output, external MCP results.

- **Validate against a declared schema at the boundary.** Reject unknown fields
  (`API_STANDARD.md` §7).
- Validate *semantically*, not only structurally — a well-formed date can still be in the
  wrong century, and a well-formed amount can still be negative.
- Never build a query by string concatenation. Parameterised statements only.
- Never deserialize into executable behaviour. Never `eval`, never dynamic import of a
  path derived from input.
- Uploaded files: verify declared type against actual content, cap size, store in R2 under
  the tenant prefix, serve with a content type that cannot execute in a browser origin
  that matters.
- Identifiers are opaque and non-sequential.

---

## 5. Secrets

The binding rules are in `.claude/rules/security.md` §5. Engineering requirements:

- Secrets are referenced **by name**; values live in the approved store and are resolved at
  use, scoped to the tenant of the call.
- Never in source, configuration, manifests, fixtures, seeds, tests, logs, error messages,
  events, audit records, or documentation.
- Never returned by any API, never readable by an App, never visible in a UI after
  creation.
- Rotation and revocation without a deploy (`CONNECTOR_STANDARD.md` §5).
- Issuing, rotating, and revoking are `critical` actions and are audited.
- **If a secret is exposed, stop and report it to the Team Lead immediately.** Do not
  quietly clean it up. A secret in a public repository is compromised the moment it lands,
  and deleting the file does not remove it from history — rotation is the only remedy.

**The tenant-scoped secret store is not selected** (`CONNECTOR_STANDARD.md` CN1). It
blocks Phase 5.

---

## 6. Audit

Every sensitive operation produces an audit event
(`AUTHORIZATION_STANDARD.md` §11, `.claude/rules/security.md` §6). At minimum:

money movement · permission changes · role changes · tenant membership changes · data
export · destructive actions · credential issue/rotate/revoke · App install, permission
grant, and uninstall · platform-operator access to tenant data · AI-initiated actions ·
authorization denials for `sensitive` and `critical` actions.

Each record contains: timestamp, tenant, principal type and id, acting-on-behalf-of, app
id, action id, permission and scope evaluated, target resource identifiers, decision,
correlation id, and a confirmation reference where elevation applied.

> **CONTRADICTED, 2026-09-06 — the confirmation reference does not exist, in either audit
> home, and the mechanism it refers to now does.** Every other field in that list is present.
>
> - `AuditEntry` (`platform/core/audit/audit.ts:213–265`) has no confirmation field.
> - `audit_event` (`platform/core/migrations/0001_audit_event.sql:33`) has no such column.
> - `platform_operator_action` (`.../control-plane/0009_platform_operator_action.sql:107–151`)
>   has none either — grepping that migration for "confirmation" returns nothing.
> - `platform/core/confirmation/**` writes no audit linkage. `statements.ts` declares a
>   `StatementAuditTarget` — *which target the operation acts on* — and that is a different
>   thing from *which confirmation authorised it*.
>
> **This was harmless while nothing was elevated and is not any more.** `docs/decisions/0027`
> (**Accepted**, 2026-09-05) built the mechanism `0007` D15 had required since it was written:
> confirmation proves **intent** (a server-authored statement bound to an echoed token) **and
> presence** (re-authentication). Two `critical` operations are gated on it today —
> `core.credential.reset` and `core.principal.revoke-platform-scope`. So elevation applies,
> and the record of it is not written.
>
> **Why it matters, in this repository's own words.** `AUTHORIZATION_STANDARD.md` §7 rejects
> session-scoped elevation because *"the audit trail then cannot say what the user actually
> confirmed."* Without a confirmation reference the trail cannot say it either — the property
> per-operation elevation was chosen to buy is the one the audit record fails to record.
> `0029` is the worked example of why the binding must be traceable: a confirmation minted to
> revoke operator A *"would have been spendable on operator B"*, and it was caught by a
> load-time guard rather than by review. **An audit trail that named the confirmation would be
> a second place that defect could surface.**
>
> **Which side is wrong: the system.** This clause is correct as written and predates the
> mechanism by five days. Adding the reference is a Core change plus one column in each audit
> home, and it belongs with the audited role-and-permission-change path that
> `docs/decisions/README.md` already records as owed four times over. **Team Lead's to route;
> not repaired here, and `SECURITY_STANDARD.md` is not weakened to match.**
>
> **`AUTHORIZATION_STANDARD.md` §11 lists the same fields and omits the confirmation
> reference**, so the two standards already disagree about the audit record's shape. That is a
> defect in one of them, it is `CONSTITUTION.md` §1's escalation case, and it is reported
> rather than resolved locally.

Rules:

- **Append-only.** Never updated, never deleted by application code.
- Contains identifiers and decisions, **not** the business data itself.
- A tenant can read its own audit log; nobody reads another tenant's.
- **Failures are audited, not only successes.** An attack looks like a long run of
  failures, and a log containing only successes cannot show one.

---

## 7. Logging and error messages

- Every log line carries `request_id`, `tenant_id`, `principal_id`, `app_id`,
  `correlation_id`.
- **No business data in logs.** No customer names, amounts, addresses, or document
  contents. Identifiers only.
- **No secrets, tokens, signatures, or full payment instruments** — absent, not masked.
  Masking is applied inconsistently and one missed site is a leak.
- No other tenant's identifiers, ever.
- Error messages returned to a caller contain a code, a developer-facing message with no
  business data, and a `request_id`. No stack traces, no queries, no internal hostnames, no
  library versions (`API_STANDARD.md` §8).
- Observability that leaks is a data breach with good intentions.

---

## 8. Network and egress

- All external traffic is TLS. No exceptions for "internal" services reached over the
  public internet — reach them by Service Binding instead.
- Outbound calls only to declared hosts (`CONNECTOR_STANDARD.md` §6).
- Explicit timeouts everywhere.
- Webhooks: verify signature first, resolve tenant from the installation, replay-protect,
  validate, then process.
- Public endpoints are rate-limited before any expensive work happens.

---

## 9. Dependencies and supply chain

- **No dependency enters Dudo without a recorded decision** (`CONSTITUTION.md` Rule 12).
  This includes test frameworks, build tools, and transitive additions introduced by a
  version bump.
- Every dependency is pinned. Lockfiles are committed.
- A version bump is a change that gets reviewed, not an automatic merge.
- Prefer the platform to a package. Every dependency is code we did not write running with
  our privileges.

> **CONTRADICTED on pinning, 2026-09-06 — twelve of twelve declared dependencies are caret
> ranges, not pins.** `package.json:26–28` declares `@types/node ^26.4.1`,
> `typescript ^5.6.0`, `wrangler ^4.129.0`. `platform/web/package.json:18–33` declares nine
> more, every one with `^`.
>
> **The lockfile half holds.** `package-lock.json` and `platform/web/package-lock.json` both
> exist and neither is ignored — `.gitignore` excludes `node_modules/` and no lockfile
> pattern. So the *installed* tree is reproducible today.
>
> **But a lockfile is not a pin, and the difference is exactly the clause above about version
> bumps.** A caret range means any `npm install` that refreshes the lockfile can pull a new
> minor or patch — including **transitive additions**, which this section names specifically —
> without a review, without a diff a reviewer would read as a dependency change, and without a
> decision record. **That is the supply-chain surface this section exists to bound.** These
> packages run at build time with the privileges of whoever builds, and the build produces the
> assets served to every authenticated user.
>
> **Which side is wrong: the system.** The rule is correct and the manifests should be pinned
> to exact versions, which costs one edit and no behaviour. Not repaired here — `package.json`
> is the Team Lead's root configuration and `platform/web/package.json` is `web-agent`'s, and
> neither is in this pass's file set.
>
> **Two `0016` gaps found alongside it, reported to the Team Lead:** `wrangler` and
> `@types/node` are named by no decision record — entailed by `0003`'s stack but never recorded
> as dependencies — and `class-variance-authority`, `clsx` and `tailwind-merge` are shadcn/ui's
> **runtime** dependencies, where `0016` approved shadcn/ui expressly as *"copy-in source, not
> a runtime dependency."* See `CONSTITUTION.md` Rule 12.

---

## 10. Production and destructive actions

Requires **explicit user approval in the current conversation**, every time, and approval
never carries forward: deploy or change production configuration · push, commit, or
force-push · run migrations against real data · delete or truncate data · rotate, revoke,
or issue credentials · billing and spend decisions · send anything to an external service ·
install a dependency or add a technology.

**No agent may approve itself, and a Team Lead instruction is not user approval.**

---

## 11. Incident handling

1. **Stop.** Do not continue the task, and do not attempt a quiet fix.
2. **Report to the Team Lead immediately** — ahead of any other work in flight.
3. Do not print, paste, or forward the exposed material.
4. The Team Lead assesses containment, rotation, and disclosure with the user.
5. The remediation is recorded.

Security, authorization, and tenant-isolation findings are reported immediately and take
precedence over everything else an agent is doing.

---

## 12. Security review

A Security Agent — never the implementing agent (`CONSTITUTION.md` §4.1) — reviews:

- [ ] Authentication on every entry point.
- [ ] Authorization on every entry point; deny by default; no trusted caller.
- [ ] Tenant isolation across all eleven carriers (`MULTITENANCY_STANDARD.md` §4).
- [ ] External data exposure: responses, errors, logs, events, exports, discovery lists.
- [ ] Cross-module access: no cross-App storage, no Core internals, no plugin-to-database.
- [ ] Secrets: none in source, fixtures, logs, errors, events, or documentation.
- [ ] API contracts: schemas enforced, breaking changes labelled.
- [ ] Architecture rules: Core small, no vendor in Core or Apps, no Cloudflare type in
      domain logic.
- [ ] Data classification present for new fields.
- [ ] Audit events for every sensitive and critical action, including denials.
- [ ] Input validation at every boundary; no string-built queries.
- [ ] Egress declared; timeouts set; webhooks signature-verified.
- [ ] No new dependency without a record.

---

## 13. Open questions

**Classified 2026-09-06 against the built system**, on the three states defined in
`CONSTITUTION.md` §7. **All five are still open, none is blocked on another, and they split
cleanly by who can close them: SE3 and SE4 need the USER; SE1, SE2 and SE5 need an architecture
decision from the Team Lead.** SE1 and SE2 are additionally blocked on there being third-party
code at all.

| # | Question | State, and the recommendation or citation |
|---|---|---|
| SE1 | **Tenant-scoped secret store** — none approved; Worker secret bindings are per-Worker, not per-tenant. | **STILL OPEN — needs an architecture decision (Team Lead), and blocks Phase 5.** Verified unchanged and now concrete: the three secrets in use are per-Worker bindings set with `wrangler secret put` — `CURSOR_SIGNING_KEY`, `SESSION_HMAC_KEY` and `IDENTITY_LOOKUP_KEY` (`wrangler.jsonc:13–29`) — exactly the shape this row says is insufficient. **`wrangler.jsonc` records an operational property worth carrying into the eventual ADR:** the two HMAC keys have **opposite rotation properties** — rotating `SESSION_HMAC_KEY` signs everyone out and is recoverable in one login, while rotating `IDENTITY_LOOKUP_KEY` is **irreversible**, because the stored hashes cannot be recomputed without plaintext addresses the schema deliberately does not hold. **A tenant-scoped store must not flatten that distinction**, or the cheap emergency control becomes a permanent lockout discovered mid-incident. Not urgent: no Connector exists and no tenant holds a credential. |
| SE2 | **Third-party App and Connector isolation** — no runtime isolation mechanism is recorded (`0001`, `APP_STANDARD.md` AP2). | **STILL OPEN as a gate — and the gate is now precisely scoped rather than total.** `docs/decisions/0030` (**Accepted**, 2026-09-06) settles what the block covers: *"Workers is free. Workers for Platforms is a different product and is paid-only. The similarity of the names is the whole confusion."* It gates **only** an open marketplace where third parties upload and execute code, and **not** tenancy, Apps as a concept, or the capability model — `0006` had already recorded that. **What this changes:** *"first-party Apps as separate Workers, deployed by Dudo, reached through service bindings with least-privilege bindings per App"* is **free and available now**, and `0030` calls it *"a real isolation boundary, not a pretend one."* So SE2 no longer blocks the App model; it blocks **third-party execution**, whose non-technical prerequisites — review process, trust tiers, distribution model — are undecided anyway, so *"deferring it forfeits nothing currently reachable."* **The gate itself is unchanged and is restated because it is the load-bearing half: no third-party code runs until a mechanism exists.** |
| SE3 | **Compliance obligations and data residency** — GDPR, PCI scope, regional requirements. Not in the plan. | **STILL OPEN — needs a USER decision.** No agent may make it and no architecture work unblocks it. Unchanged: no compliance position is recorded anywhere, and the one shared database has one location, so residency cannot be satisfied by placement (`MULTITENANCY_STANDARD.md` MT3 — **same question, and the two should be recorded in one conversation, not three**). Recommendation unchanged and still the cheapest half to bank: **PCI scope is avoided by design** — never store full instrument numbers; let the Connector's vendor hold them. `SECURITY_STANDARD.md` §3 already forbids storing a financial instrument in full absent a recorded decision, so the default is correct and only needs confirming. Raise before `payment@1`. |
| SE4 | **Retention periods** for audit records, event history, and logs. | **STILL OPEN — needs a USER decision; has legal weight.** **No longer hypothetical.** Two append-only tables are accumulating in production with no retention policy and no deletion path: `audit_event` (`platform/core/migrations/0001_audit_event.sql:33`) and `platform_operator_action` (`.../control-plane/0009_platform_operator_action.sql:107`). §6's *"never deleted by application code"* is satisfied; **what has no answer is how a tenant deletion completes across audit**, which `MULTITENANCY_STANDARD.md` §6 defers to *"the stated retention policy"* — a clause with nothing behind it. **There is also no event history and no log retention question to answer yet:** no Queue is bound and `observability` is deliberately off (`wrangler.jsonc:172–179`), so this reduces today to **audit retention alone**, which is the tractable part and the part with the legal weight. Same question as `MULTITENANCY_STANDARD.md` MT4. |
| SE5 | **Break-glass platform-operator access** (`AUTHORIZATION_STANDARD.md` AZ3). | **STILL OPEN — needs an architecture decision (Team Lead), and the Phase 1 deadline in the original recommendation did not bind.** The admin portal shipped and reads no tenant business data, so nothing forced the question. Two **Accepted** records confirm it is untouched and both say the same thing in the same words: `0024` *"Break-glass access to tenant data (AZ3). Nothing here permits it"*, and `0028` *"Nothing here permits it, and `0024`'s invariants remain what any such proposal must argue against."* **`0024` changed the terms any proposal must meet**, and this is the sentence to carry forward: a memberless platform principal is *structurally* incapable of reading tenant rows, **and the trap is that granting one a membership row would restore that capability through entirely legitimate parts** — `scope.ts` ranks `platform` at 0, so the row passes authorization everywhere and the storage boundary then serves the tenant's data. **A break-glass design must not be built by giving an operator a membership.** See `AUTHORIZATION_STANDARD.md` AZ3 — same question, one decision closes both. |

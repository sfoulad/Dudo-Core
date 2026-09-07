# Event Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** every event published or consumed anywhere in Dudo.
- **Depends on:** `CONSTITUTION.md` Rules 5, 10; `MULTITENANCY_STANDARD.md`; `CLOUDFLARE_STANDARD.md` §5.
- **Machine-readable:** `packages/contracts/registries/event-catalog.yaml`.
- **Reconciled against the built system 2026-09-06 — nothing in this document is exercised.**
  No Queue and no Workflow is bound in `wrangler.jsonc`, no module publishes an event, and
  every entry in `event-catalog.yaml` is `status: proposed`. **So this standard is UNVERIFIED
  rather than contradicted**, and the distinction is deliberate: none of its rules has been
  tested against a running consumer. §12 classifies all three open issues — **all still open,
  all blocked on the same root.** §4's `business_id` confirmation is the one item that closed.
  **The first event published is where this document is actually reviewed**; run §11's
  checklist against it rather than assuming it.

Events are how Apps meet without knowing about each other. That decoupling only holds if
the envelope, the naming, the versioning, and the delivery semantics are the same
everywhere — otherwise every consumer ends up special-casing a publisher, and the
coupling comes back with worse ergonomics.

---

## 1. What an event is

A **statement that something already happened**, published by the owner of that fact, to
no one in particular.

An event is **not** a command, a request, or a way to ask another App to do something. If
the publisher cares what the consumer does, needs an answer, or would be broken by having
no consumers, it needs an API call, not an event.

```
OrderCreated
     ├──> Inventory
     ├──> Payment
     ├──> Analytics
     └──> Notification
```

The E-commerce App does not know that list exists, and adding a fifth consumer is not a
change to the publisher. **A publisher that is modified to accommodate a specific consumer
has lost the property that made events worth using.**

---

## 2. Naming

```
<namespace>.<Entity><PastTenseVerb>
```

- `namespace` is `core` or an App id — the publisher's, always.
- The entity and verb are `PascalCase`; the verb is past tense, because the event
  describes something that already happened.
- Examples: `core.AppInstalled`, `crm.ContactCreated`, `ecommerce.OrderCreated`,
  `finance.PaymentReceived`, `commitments.CommitmentDue`.
- Never `OrderCreate`, `CreateOrder`, `OrderCreating`, or `OrderChanged`. "Changed" says
  nothing a consumer can act on; publish what actually happened.
- Names are permanent. Renaming an event is a breaking change to every consumer, and the
  consumers are precisely the parties you cannot enumerate.

---

## 3. The envelope

Every event carries exactly these fields — the set is closed, and it is mirrored in
`event-catalog.yaml`. Missing any one is a defect and the event is rejected at publication.

| Field | Type | Rule |
|---|---|---|
| `event_id` | string | Unique per event instance. The consumer's deduplication key. |
| `event_type` | string | Per §2. |
| `event_version` | integer | Per §7. Starts at 1. |
| `tenant_id` | string | **Always present. Never null, never a wildcard, never "system".** |
| `business_id` | string \| null | The sub-scope within the tenant, where applicable. Not an isolation boundary — see §4. |
| `source_app` | string | The publishing namespace. |
| `actor` | object | `{ type, id }` — the principal that caused it. `type` is a principal type from `AUTHORIZATION_STANDARD.md` §2, plus `system` for platform-initiated facts. |
| `timestamp` | string | RFC 3339, UTC, when the fact occurred — not when it was published. |
| `correlation_id` | string | Propagated from the originating request across every downstream call, event, and workflow step. |
| `payload` | object | The event's own data, per §5. |

A `causation_id` (the id of the event or request that directly caused this one) is
**recommended** and reserved in the catalog. It is what makes an event chain
reconstructable during an incident; without it, a cascade of ten events is ten unrelated
log lines.

---

## 4. Tenancy

- `tenant_id` is set by the publishing runtime from the authenticated context, **never by
  application code from a parameter**.
- A consumer processes an event strictly inside that tenant's scope. It does not read,
  write, or aggregate across tenants because of an event.
- Queue messages, dead-letter records, retry state, and consumer checkpoints all carry
  the tenant.
- **`business_id` is a sub-scope, not an isolation boundary.** Isolation is by
  `tenant_id`. This resolves an ambiguity left open by an envelope that carries both fields
  without defining either (`CONSTITUTION.md` C1, `MULTITENANCY_STANDARD.md` §2).
  **CLOSED 2026-09-06 — confirmed, and it no longer needs Team Lead confirmation.**
  `docs/decisions/0006` (**Accepted**, user, 2026-09-01) §1.1 lists it under *Settled*:
  *"The tenant is the Organization … `business_id` is an authorization scope inside a tenant,
  never an isolation boundary."* Built that way — the tenant predicate has one emission point
  (`platform/core/storage/adapters/sql/sql-compiler.ts:141`) and `business_id` is enforced
  separately as an **authorization** narrowing through the authorized-business set
  (`docs/decisions/0020`, `platform/core/authorization/business-scope.ts`), which is precisely
  the distinction this bullet asserts. **One caveat for whoever writes the first event:**
  `0025`'s 2026-09-05 amendment records that renaming `business_id` to `workspace_id` is
  **four changes, not one** — it is a published wire field two clients shipped against and a
  persisted audit value — and the rename is **deferred**. So two vocabularies for one concept
  coexist deliberately. **Use `business_id` in the envelope**; it is the name every other
  surface carries.

---

## 5. Payload

- **Facts, not instructions.** What happened, with the identifiers a consumer needs to
  fetch more through an authorized API.
- **Minimum necessary data.** An event is delivered to consumers whose permissions were
  never checked against its contents, so treat every field as broadly visible within the
  tenant. Names, amounts, and identifiers are usually fine; national ids, full card
  numbers, health details, and credentials never are.
- **Never a secret, credential, token, or full payment instrument.** Not redacted —
  absent.
- No provider-shaped or vendor-specific fields.
- Payload fields follow `API_STANDARD.md` §7: `snake_case`, RFC 3339 timestamps,
  minor-unit money with a currency code.
- Payloads are self-describing enough to be understood a year later in an audit, without
  the publisher's source code.

---

## 6. Publication

- **Publish after the state change commits.** Publishing before means announcing something
  that may not have happened; the consumer's world and the publisher's diverge, and the
  divergence is silent.
- If the publication itself fails, that is a failure of the operation and is handled and
  logged — never swallowed.
- Publication is not a transaction with the consumer. The publisher is done once the event
  is accepted by the queue.
- Every published event type exists in `event-catalog.yaml` **before** the code that
  publishes it. An unregistered event is rejected at publication, which is what makes the
  catalog trustworthy rather than aspirational.

---

## 7. Versioning

`event_version` is an integer per event type, starting at 1.

**Additive — same version:**
- adding an optional payload field;
- adding a new event type.

**Breaking — new version:**
- removing or renaming a payload field;
- changing a field's type, units, format, or meaning;
- making an optional field required;
- narrowing an enumeration;
- changing when the event fires.

For a breaking change, the publisher emits **both** versions during a stated migration
window, consumers move, and only then is the old version retired. Both versions appear in
the catalog, with the old one marked `deprecated` and carrying its retirement date.

**Consumers ignore unknown payload fields.** This is the normative rule that makes the
additive case safe.

---

## 8. Duplicate concepts

**Apps may not invent an event concept that already exists.** This section is that rule's
statement of record. Before registering a new event type, search `event-catalog.yaml`. If
something close exists, consume it.

If two Apps genuinely need different meanings for the same words, that is an Architecture
Review item for the Team Lead — not a second event with a slightly different name.
Two events meaning nearly the same thing is worse than one imperfect event: every consumer
must then subscribe to both and reconcile them, forever.

---

## 9. Delivery semantics

Stated plainly, because designs that assume otherwise fail in production:

- **At-least-once.** An event will sometimes be delivered twice.
- **No ordering guarantee.** `OrderUpdated` may arrive before `OrderCreated`.
- **No delivery guarantee to a specific consumer within a bounded time.**

Therefore:

1. **Every consumer is idempotent.** Deduplicate by `event_id`, or make the handler
   naturally idempotent. This is a requirement, not a recommendation.
2. **Every consumer tolerates out-of-order arrival** — by carrying a version or timestamp
   on the entity and ignoring stale updates, or by fetching current state through an API
   rather than trusting payload ordering.
3. **Failures retry with bounded backoff, then dead-letter.** A dead-letter queue with no
   owner and no alert is a silent data-loss mechanism; every DLQ has a named owner and is
   monitored.
4. **A poisoned message never blocks a partition indefinitely.** It goes to the DLQ.

---

## 10. Registration

To add an event type:

1. Search `event-catalog.yaml` for an existing concept (§8).
2. Add the entry: type, version, publisher, description, payload schema, tenancy notes,
   status, and known consumers.
3. `architecture-agent` reviews the shape; the Team Lead accepts.
4. Only then is publishing code written.

Consumers register their subscription in their App manifest (`eventsConsumed`), which is
what lets the platform show a publisher who depends on it before a breaking change is
attempted.

---

## 11. Verification checklist

- [ ] Event type registered in `event-catalog.yaml` before the publishing code exists.
- [ ] Name follows `<namespace>.<Entity><PastTenseVerb>`; past tense; publisher's namespace.
- [ ] All envelope fields present; `tenant_id` never null.
- [ ] `tenant_id` set by the runtime, not by application code.
- [ ] `correlation_id` propagated from the originating request.
- [ ] Payload carries facts only — no secrets, no credentials, no full instrument numbers,
      no vendor-shaped fields.
- [ ] Published only after the state change commits.
- [ ] Version assessed against §7; breaking changes dual-published with a window.
- [ ] No duplicate concept; catalog searched.
- [ ] Consumer is idempotent — deduplication demonstrated by test.
- [ ] Consumer tolerates out-of-order delivery — demonstrated by test.
- [ ] Retry policy bounded; DLQ has a named owner and monitoring.
- [ ] Event test covers publish and consume (`TESTING_STANDARD.md` §4).

---

## 12. Open questions

**Classified 2026-09-06 against the built system**, on the three states defined in
`CONSTITUTION.md` §7. **All three are still open, all three need an architecture decision from
the Team Lead, and all three are blocked on the same root: no event exists.**

**State this once rather than three times.** Nothing in this document is exercised, and
nothing in it is contradicted:

- **No Queue is bound.** `wrangler.jsonc` declares `d1_databases` and one `durable_objects`
  binding and **no `queues` key at all**. `CONSTITUTION.md` Rule 5 requires events to travel
  over Cloudflare Queues; there is no producer binding and no consumer binding.
- **No Workflow is bound**, so §5 of `ARCHITECTURE.md`'s long-running path does not exist
  either.
- **Nothing publishes.** No module under `platform/core/**` emits an event or constructs the
  §3 envelope.
- **Every catalog entry is `proposed`.** `packages/contracts/registries/event-catalog.yaml`
  says so in its own header: *"Every entry below is status 'proposed'. No code exists yet, and
  no event has been accepted … The Team Lead accepts them; `architecture-agent` does not."*

**So this standard is unverified rather than wrong, and that distinction is worth keeping.**
Its rules have never been tested against a running consumer, which means §9's three delivery
properties — at-least-once, no ordering, no bounded delivery — are requirements nobody has yet
had to satisfy. **The first event is where this document is actually reviewed**, and the
verification checklist in §11 should be run against it rather than assumed.

**One consequence for `SECURITY_STANDARD.md` SE4 and `MULTITENANCY_STANDARD.md` MT4:** those
rows ask for retention periods covering *"audit records, event history, and logs"*. **There is
no event history and no log retention question today** — see EV2 below and `wrangler.jsonc`'s
deliberately disabled `observability`. Those rows reduce to **audit retention alone**, which is
the tractable part and the part carrying the legal weight.

| # | Question | State, and the recommendation or citation |
|---|---|---|
| EV1 | **Queue topology** — one queue for everything, one per consumer, or one per event family. Not addressed by the plan. | **STILL OPEN — needs an architecture decision (Team Lead); blocked on nothing, unexercised because no Queue is bound.** Recommendation unchanged: one queue per consuming service, with the platform routing by subscription — it isolates a slow consumer from a fast one, which a shared queue cannot. **Two things to weigh that did not exist when this row was written.** First, **`docs/decisions/0008`'s zero-cost ceiling still binds and `0030` did not lift it**, so the ADR owes a free-tier impact check under `.claude/rules/architecture.md` §6a: which allowance a queue consumes, expected usage, and what happens at the limit. Second, **`0030`'s expandability constraint applies directly** — *"the free tier may cost us CONFIGURATION, never SCHEMA"* — and queue **count** is configuration while an envelope shape chosen to fit one queue is schema. A topology adopted to stay inside an allowance is fine; an envelope narrowed to do so is not. |
| EV2 | **Event retention and replay.** Rebuilding a consumer's state after a bug requires stored events; nothing in the plan says whether events are durable beyond delivery. | **STILL OPEN — needs an architecture decision (Team Lead), and it has become materially harder.** Recommendation unchanged in shape: persist published events per tenant with a defined retention window, in Core-owned storage. **What changed is the cost side, and it is now the deciding factor.** `0030` names **storage as the one free-tier allowance that does not ebb** — *"a customer with three years of history consumes it while doing nothing, and low traffic never gives it back"* — against **500 MB per database** under one shared D1 (`MULTITENANCY_STANDARD.md` §7.3). An unbounded event store is a growth curve straight at that ceiling and at the §7.5 thresholds. **It also inherits `0014` §A's write budget:** every persisted event is a D1 row-write against a daily allocation, and `0013` exists because one control that wrote a row per occurrence would have become the outage. **This ADR must therefore carry its own bound, not only a retention window** — and it is the same conversation as `SECURITY_STANDARD.md` SE4 and `MULTITENANCY_STANDARD.md` MT4, which need the user. |
| EV3 | **Cross-tenant platform events** (e.g. a marketplace App version published) have no tenant. | **STILL OPEN — needs Team Lead confirmation, and the surrounding system has since taken a consistent position twice, which strengthens the recommendation rather than deciding it.** Recommendation unchanged: a distinct `platform.*` namespace with `tenant_id: "platform"` reserved and explicitly excluded from tenant-scoped consumers; the catalog's `namePattern` already admits `platform` as a namespace alongside `core`. **The precedent now exists in two places.** `platform/core/identity/pre-auth-registry.ts:91–93` puts the health endpoint in the `platform.` namespace *"deliberately … so it is not swept into a future 'everything under identity may do X'"*, and `0025` gave platform-authority operations **their own log** — `platform_operator_action` — separate from the tenant audit trail *"because an operator action spans tenants by nature."* **That is exactly EV3's problem solved once, for records rather than events, and the answer both times was a separate namespace rather than a null tenant.** ⚠ **The one thing the eventual record must not do** is admit `tenant_id: null` or a wildcard into the §3 envelope. §3 requires `tenant_id` *"Always present. Never null, never a wildcard, never 'system'"*, and `0014` §B and `0021` both refused a null-tenant pseudo-principal for the same reason: an optional tenant on a shared field is how a null Organization ends up sharing a path with a real one. A reserved literal is a value; `null` is a hole. |

# Event Standard

- **Status:** Draft for Team Lead review — Phase 0. Binding on acceptance.
- **Authored by:** `architecture-agent`.
- **Applies to:** every event published or consumed anywhere in Dudo.
- **Depends on:** `CONSTITUTION.md` Rules 5, 10; `MULTITENANCY_STANDARD.md`; `CLOUDFLARE_STANDARD.md` §5.
- **Machine-readable:** `packages/contracts/registries/event-catalog.yaml`.
- **Source:** master build plan §3, §11.

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

Every event carries exactly these fields (master plan §11). Missing any one is a defect
and the event is rejected at publication.

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
  `tenant_id`. This resolves an ambiguity the master plan leaves open by carrying both
  fields without defining either (`CONSTITUTION.md` C1) and needs Team Lead confirmation.

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

**Apps may not invent an event concept that already exists** (master plan §11). Before
registering a new event type, search the catalog. If something close exists, consume it.

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

| # | Question | Recommendation |
|---|---|---|
| EV1 | **Queue topology** — one queue for everything, one per consumer, or one per event family. Not addressed by the plan. | One queue per consuming service, with the platform routing by subscription. It isolates a slow consumer from a fast one, which a shared queue cannot. Needs an ADR before Phase 2. |
| EV2 | **Event retention and replay.** Rebuilding a consumer's state after a bug requires stored events; nothing in the plan says whether events are durable beyond delivery. | Persist published events per tenant with a defined retention window, in Core-owned storage. Needed for audit anyway. Needs an ADR — it has real storage-cost and data-retention consequences. |
| EV3 | **Cross-tenant platform events** (e.g. a marketplace App version published) have no tenant. | Use a distinct `platform.*` namespace with `tenant_id: "platform"` reserved and explicitly excluded from tenant-scoped consumers. Reserved in the catalog; needs confirmation. |

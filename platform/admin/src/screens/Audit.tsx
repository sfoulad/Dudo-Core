import { NotBuiltYet } from '@/components/NotBuiltYet';

/**
 * Audit.
 *
 * ===========================================================================
 * THE OBJECT THIS SECTION WOULD READ DOES NOT EXIST YET
 * ===========================================================================
 *
 * `platform-operator-v1`'s `auditModel` calls this "the hardest unsolved part,
 * and it is unsolved in a specific way": an operator action spans tenants by
 * nature, and `audit_event` is tenant-scoped, so the ordinary audit path is
 * unreachable from a platform route — and for onboarding it is worse than
 * unreachable, because the tenant whose log would receive the record is the one
 * the operation is still creating.
 *
 * The ruling is TWO HOMES, both required: a platform-operator action record in
 * the control plane, and a tenant-side record in the affected Organization's own
 * `audit_event` where one exists and is reachable. The reasoning for the second
 * is the part worth carrying into any screen built here:
 *
 *   "A platform operator resetting a tenant admin's credential IS A TAKEOVER OF
 *    THAT ACCOUNT BY DESIGN. THE CUSTOMER MUST BE ABLE TO SEE THAT IT HAPPENED.
 *    A trail only the platform can read is a trail kept by the party being
 *    audited, which is not an audit."
 *
 * That sentence also constrains this section directly: whatever it eventually
 * shows an operator, it is the platform's half of a record whose other half
 * belongs to the customer, and it must never become the only copy.
 *
 * PO-1 records that this control-plane object has no decision record and that
 * the gap "blocks implementation of every route in this class" — so this is not
 * only the last section to be built, it is the one the other three wait on.
 */
export function Audit() {
  return (
    <NotBuiltYet
      title="Audit"
      purpose={
        <>
          Intended to show the platform-operator action log: which operator did what, to which
          Organization or principal, with what outcome and when. It is one of two required homes for
          every platform action — the affected customer keeps the other, in their own audit log, and
          this must never become the only copy.
        </>
      }
      contract="packages/contracts/core/platform/platform-operator-v1.contract.yaml (auditModel — described, but no read route is specified)"
      contractStatus="Described in a proposed contract. No route exists to read it, and the object it would read has not been recorded as a decision."
      blockedOn={[
        'PO-1 — the platform-operator action log is a new control-plane object with no decision record. The contract states what it must contain and what it must never contain, and explicitly does not accept it.',
        'A Team Lead decision record for that object, which platform-operator-v1 asks for before implementation.',
        'A read route, which no platform contract currently specifies.',
      ]}
    />
  );
}

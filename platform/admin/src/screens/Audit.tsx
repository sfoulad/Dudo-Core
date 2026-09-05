import { NotBuiltYet } from '@/components/NotBuiltYet';

/**
 * Audit.
 *
 * ===========================================================================
 * THE LOG NOW EXISTS AND IS BEING WRITTEN. NOTHING CAN READ IT.
 * ===========================================================================
 *
 * This is the section whose blocker changed most, and the change is worth
 * stating precisely rather than just moving the screen along.
 *
 * The shell said the object had no decision record and that PO-1 "blocks
 * implementation of every route in this class". **PO-1 is now CLOSED** — by
 * `docs/decisions/0025` Decision 5 — and `platform/core/platform/platform-audit.ts`
 * writes a record for every platform call, before the answer is produced, with
 * the answer replaced by `unavailable` if the write fails. Every `whoami` this
 * console performs and every page of the Organization list is already in that
 * log.
 *
 * SO THE LOG IS REAL AND ACCUMULATING, AND THERE IS STILL NO ROUTE TO READ IT.
 * `platform-routes.ts` declares exactly two route ids and neither is a read of
 * the audit log. That is the honest blocker now, and it is a narrower and more
 * urgent one than "the object is not designed": data is being recorded that no
 * operator can see.
 *
 * ===========================================================================
 * THE CONSTRAINT ANY FUTURE SCREEN HERE INHERITS
 * ===========================================================================
 *
 * `0025` Decision 5 sharpened what `auditModel` had stated loosely, and this is
 * the sentence to build against:
 *
 *   "IT RECORDS THE OPERATION AND ITS TARGET IDENTIFIERS, NEVER THE CONTENTS OF
 *    WHAT WAS TOUCHED, because an operator log that accumulates customer data is
 *    a second copy of the tenant database with weaker access rules."
 *
 * A screen here therefore shows identifiers and outcomes, never business
 * content, and a future "show me what changed" column is the request that would
 * breach it.
 *
 * AND THE HALF MOST LIKELY TO BE DROPPED: the ruling is TWO HOMES, both
 * required. A platform operator resetting a tenant admin's credential "IS A
 * TAKEOVER OF THAT ACCOUNT BY DESIGN. THE CUSTOMER MUST BE ABLE TO SEE THAT IT
 * HAPPENED. A trail only the platform can read is a trail kept by the party
 * being audited, which is not an audit." Whatever this section eventually shows
 * is the platform's half of a record whose other half belongs to the customer,
 * and it must never become the only copy.
 */
export function Audit() {
  return (
    <NotBuiltYet
      title="Audit"
      purpose={
        <>
          Intended to show the platform-operator action log: which operator did what, to which
          Organization or principal, with what outcome and when. It records the operation and its
          target identifiers and never the contents of what was touched. It is one of two required
          homes for every platform action — the affected customer keeps the other, in their own
          audit log, and this must never become the only copy.
        </>
      }
      contract="packages/contracts/core/platform/platform-operator-v1.contract.yaml (auditModel) · docs/decisions/0025 Decision 5"
      contractStatus="Accepted, and the log is already being written by Core. No route exposes it for reading."
      blockedOn={[
        'A read route. platform-routes.ts declares two route ids — organizations.list and session.whoami — and neither reads the audit log. Adding one is a seventh platform operation, which platform-operator-v1 requires to carry its own argument.',
        'That argument has a real tension to settle: the log spans every tenant, so a read route needs its own answer on what an operator may see and how the customer-side half stays reachable.',
      ]}
    />
  );
}

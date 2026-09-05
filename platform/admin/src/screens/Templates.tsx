import { NotBuiltYet } from '@/components/NotBuiltYet';

/**
 * Templates.
 *
 * `docs/decisions/0025` Decision 2 settled that a business type IS a `Template`,
 * the fifth extension type `ARCHITECTURE.md` §1 already records — "a
 * pre-configured combination of Apps and settings for a business type: Salon,
 * Dental Clinic, Gym. Carries no code" — rather than a new concept with a new
 * name.
 *
 * THE BOUNDARY IS WORTH REPEATING WHEREVER TEMPLATES ARE TOUCHED, because it is
 * the rule this screen will be under pressure to bend. `CORE_BOUNDARIES.md` 6.1
 * governs types, tables, columns, functions and routes — NOT rows: "A row
 * reading 'Dental Clinic' is data; a `dental_clinic` column is a defect." A
 * Template may NAME Apps and CARRY display labels. It may never CONTAIN logic.
 * The moment it carries a workflow, a validation rule or a pricing rule,
 * business-specific behaviour is inside Core permanently.
 *
 * THE CONTRACT IS ACCEPTED AND THE ROUTES ARE NOT BUILT. That is a narrower
 * statement than the shell's original "proposed, so nothing may be built against
 * it": the shape is now settled and safe to build against — `core-agent` has not
 * implemented it yet. `platform-routes.ts` currently declares exactly two route
 * ids, and none of the three template operations is among them.
 *
 * ===========================================================================
 * TWO VOCABULARIES FOR ONE CONCEPT, AND NEITHER IS TO BE "CORRECTED"
 * ===========================================================================
 *
 * This screen's own blocker list used to say the `Workspace` rename had to land
 * before Templates were built. `0025` was AMENDED on 2026-09-05 and that
 * requirement is struck (`0025:161-163`). It shipped stale to a live console and
 * an operator read it as current — `workflow.md` §12 in its user-visible form:
 * the decision moved, nothing failed, and the claim survived.
 *
 * THE AMENDED RULING, because this is the screen most likely to trip on it —
 * Templates carry the display labels for each level, so whoever builds it will
 * be looking straight at the naming:
 *
 *   - The new PLATFORM surface is written in `Workspace` terms natively.
 *   - The customer WIRE FIELD and the DATABASE COLUMN keep `business_id`.
 *   - NEITHER IS TO BE CORRECTED TOWARD THE OTHER.
 *
 * The reason the rename was deferred is worth carrying: `business_id` is a
 * PUBLISHED WIRE FIELD two clients have already shipped against, and a PERSISTED
 * AUDIT VALUE. Renaming it is a breaking contract change plus a rewrite of audit
 * history — not a cleanup, and not something to do in passing while building a
 * screen. It has its own slice.
 */
export function Templates() {
  return (
    <NotBuiltYet
      title="Templates"
      purpose={
        <>
          Creating and reading Templates — a business type such as School, Clinic or Retail,
          carrying a name and the display labels each level uses, so a school renders “Campus”
          where a shop renders “Branch”. A Template names Apps and carries labels; it never
          contains logic.
        </>
      }
      contract="packages/contracts/core/platform/template-v1.contract.yaml (platform.templates.create, .list, .read)"
      contractStatus="Accepted. The shape is settled; Core has not implemented the routes."
      blockedOn={[
        'Core implementation. platform-routes.ts declares two route ids — platform.organizations.list and platform.session.whoami — and none of the three template operations is registered yet.',
      ]}
    />
  );
}

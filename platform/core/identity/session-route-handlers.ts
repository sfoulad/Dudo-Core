/**
 * ===========================================================================================
 * THE TWO SESSION ROUTE OPERATIONS. `docs/decisions/0021` ·
 * `packages/contracts/core/identity/organization-selection-v1`.
 * ===========================================================================================
 *
 *   GET  /auth/session/organizations   the Organization picker
 *   POST /auth/session/organization    selection
 *
 * BOTH ARE THIN, AND THAT IS THE DESIGN RATHER THAN A COINCIDENCE. `session-resolution.ts`
 * already implements both operations, with the hint ruling, the three-way `not_found` collapse
 * and the validate-then-reserve ordering built into it. These handlers translate the wire shape
 * and nothing else — every security property lives one layer down, where `qa-agent` already tests
 * it, and re-implementing any of it here would be a second place for it to drift.
 *
 * ===========================================================================================
 * WHAT NEITHER HANDLER DOES, AND WHY EACH ABSENCE MATTERS
 * ===========================================================================================
 *
 * NEITHER RESOLVES A PRINCIPAL, A TENANT OR A PERMISSION. They receive a `sessionId` and can
 * reach nothing but the control plane keyed by it. There is no store here to scope wrongly.
 *
 * NEITHER ISSUES, CLEARS OR ROTATES A CREDENTIAL. `SessionRouteHandler` returns a JSON value and
 * has no field for a cookie, so the contract's "there is no `Set-Cookie` on this response and the
 * credential does not change" is structural. Selection moves the row behind the session; the
 * session identifier is untouched, and so is its absolute expiry — selection does not extend it.
 *
 * NEITHER ECHOES THE SELECTION. `selectOrganizationOutput` is `{"status":"ok"}` and deliberately
 * does not return the chosen Organization: the session row is the record, and the selection is
 * re-validated against membership on EVERY subsequent request, so a client that cached this
 * response as truth would show a tenant the user can no longer enter.
 */

import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';
import type { SessionResolver } from './session-resolution.ts';
import type { SessionRouteHandlers } from './session-routes.ts';
import { readIdentifierField } from './session-routes.ts';

/** The one field `selectOrganizationInput` declares. */
export const ORGANIZATION_ID_FIELD = 'organization_id';

/**
 * The picker.
 *
 * ===========================================================================================
 * IT RETURNS IDENTIFIERS AND `display_name: null`, AND THE NULL IS CONTRACTED RATHER THAN A STUB.
 * ===========================================================================================
 *
 * `OrganizationRecord` is an identifier and a status and nothing else — `0002_organization.sql`
 * declined a name column deliberately, because the organization-structure slice owns the
 * Organization data model and adding a display name there would decide Core's shape as a side
 * effect of unblocking a login. It named this exact consequence: *"an Organization picker built
 * on this port can list identifiers and not names."*
 *
 * THE FIELD IS EMITTED ANYWAY, ALWAYS PRESENT AND ALWAYS NULL. `organizationDisplayNameOrNull`
 * requires present-and-null rather than absent, because absent-versus-null is a distinction two
 * clients resolve differently — "the web app shows a blank and the iPhone app shows nothing" is
 * exactly the divergence the one-contract rule exists to prevent. The day names exist, this stops
 * being null and no shape changes.
 *
 * BOTH CLIENTS MUST RENDER THE IDENTIFIER VERBATIM when it is null. Not a blank, not a dash, not
 * "Unnamed Organization". That is the contract's rule and it is not this handler's to soften.
 *
 * IT WRITES NOTHING, TAKES NO RESERVATION, AND CANNOT RETURN `quota_exceeded`. An empty array is
 * a valid, reachable answer — a principal whose memberships were all revoked or suspended — and
 * is NOT an error. The contract requires both clients to render it as a first-class explained
 * state rather than as a loading failure, because getting it wrong strands a real user with no
 * way to understand why.
 *
 * NO ROLE FIELD. `OrganizationMembershipRecord` carries one (`0019`), and publishing the caller's
 * authority level on a pre-tenant path — before any permission has been evaluated — would invite
 * a client to make authorization decisions from it. Authorization is decided in Core on every
 * call; UI-level hiding is presentation, never security.
 */
function listOrganizations(sessions: SessionResolver) {
  return async (context: { readonly sessionId: string }): Promise<Result<unknown>> => {
    const enterable = await sessions.listEnterableOrganizations(context.sessionId);
    if (!enterable.ok) {
      return err(enterable.error);
    }
    return ok({
      data: enterable.value.map((organizationId) => ({
        organization_id: organizationId,
        // PRESENT AND NULL. See the header — never omitted.
        display_name: null,
      })),
    });
  };
}

/**
 * Selection.
 *
 * ===========================================================================================
 * THE HINT IS VALIDATED AGAINST MEMBERSHIP AND NEVER TRUSTED. `0014` §C.6.
 * ===========================================================================================
 *
 * This is the ONLY place in the platform where a caller names a tenant. Everywhere else
 * `MULTITENANCY_STANDARD.md` §3 forbids deriving a tenant from anything the caller controls, and
 * Core enforces it by withholding the value entirely — an Action handler is never given an
 * organization identifier at all. This is the single deliberate exception, and it is a HINT.
 *
 * THREE CAUSES, ONE ANSWER, AND THE COLLAPSE IS NOT THIS HANDLER'S TO WIDEN. A caller naming an
 * Organization it does not belong to, one whose membership is suspended, and one naming an
 * Organization that does not exist all receive the identical `not_found()` — from the same single
 * statement against the same single table reading the same zero rows. Distinguishing them would
 * make membership lookup an ORGANIZATION-EXISTENCE ORACLE ACROSS THE WHOLE PLATFORM, which is the
 * broadest anti-oracle property in Dudo because, unlike every other one, it is not confined to a
 * single tenant.
 *
 * VALIDATE-THEN-RESERVE, AND THE CONTRACT GAVE IT A MECHANICAL TEST. `session-resolution.ts`
 * validates the hint BEFORE reserving daily capacity. Reversed, a caller could exhaust its own
 * per-principal budget — which it fully controls — and thereafter distinguish `quota_exceeded`
 * ("I am a member") from `not_found` ("I am not"): an existence oracle built out of a capacity
 * control and switched on at will. The test is one assertion: **with the budget exhausted, a
 * non-member must still receive 404, never 429.**
 *
 * THERE IS NO SERVER-SIDE AUTO-SELECTION, AND THE CONTRACT IS EXPLICIT THAT THERE MUST NOT BE.
 * A client holding exactly one Organization MAY skip showing a picker — *"that is a presentation
 * choice and it is permitted. IT IS NOT A DEFAULT AND IT IS NOT A SERVER BEHAVIOUR: the request
 * is still made, the hint is still validated, and the server still has no fallback."* So this
 * handler cannot tell an automatic selection from a manual one, and `session-resolution.ts`'s
 * refusal of a "first membership wins" fallback stands untouched. See the report accompanying
 * this work for the one place `0021`'s prose and the contract do not agree.
 */
function selectOrganization(sessions: SessionResolver) {
  return async (
    context: { readonly sessionId: string },
    body: Readonly<Record<string, string | number | boolean>>,
  ): Promise<Result<unknown>> => {
    const requested = readIdentifierField(body, ORGANIZATION_ID_FIELD);
    if (!requested.ok) {
      return err(requested.error);
    }
    const selected = await sessions.selectOrganization({
      sessionId: context.sessionId,
      requestedOrganizationId: requested.value,
    });
    if (!selected.ok) {
      return err(selected.error);
    }
    // The same success body the pre-authentication endpoints render, so the platform has one
    // success shape for an operation with nothing to return rather than two that differ for no
    // reason. It deliberately does NOT echo the selection.
    return ok({ status: 'ok' });
  };
}

export function createSessionRouteHandlers(dependencies: {
  readonly sessions: SessionResolver;
}): SessionRouteHandlers {
  return Object.freeze({
    'identity.session.organizations.list': listOrganizations(dependencies.sessions),
    'identity.session.organization.select': selectOrganization(dependencies.sessions),
  });
}

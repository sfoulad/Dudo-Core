/**
 * ===========================================================================================
 * *** AN ORGANIZATION IDENTIFIER THAT CAME FROM THE AUTHENTICATED CONTEXT, AND CAN HAVE COME
 * FROM NOWHERE ELSE. *** `docs/decisions/0044` §3a-i · `architecture.md` §3a.
 * ===========================================================================================
 *
 * **`0044` §3a says the tenant-admin class is safe *"BY CONSTRUCTION, NOT BY A CHECK."* Measured by
 * `qa-agent`, that is true of one of the two populations and false of the other:**
 *
 * ```
 * a platform operator          holds ZERO membership rows — 0024 makes the row impossible
 *                              -> BY CONSTRUCTION. The claim is exactly right.
 *
 * a tenant principal in A,     findActiveMembership returns nothing
 *   naming B                   -> A CHECK. A correct one, and a check.
 * ```
 *
 * **THE CLASS'S HEADLINE CLAIM IS WRITTEN AS THOUGH IT WERE THE TOP LAYER AND IT IS NOT**, which is
 * `architecture.md` §3b — a precise dismissal nobody re-derives. `0044` §3a-i records the
 * documentation half. **This file is the other half.**
 *
 * ===========================================================================================
 * WHAT `0044` §3b.2's REGISTRATION REFUSAL CANNOT REACH
 * ===========================================================================================
 *
 * That refusal is real and is not in question: no route may declare an organization identifier in
 * any request position, and `assertNoOrganizationIdentifierInAnyRequestPosition` fails the build.
 * **It examines ROUTE DECLARATIONS.** So it cannot see:
 *
 *   - **a handler that obtains the value correctly and passes it on incorrectly** — right at the
 *     boundary, wrong two frames in, and nothing at registration looks two frames in;
 *   - **a call site that is not a registered route at all** — a job, a harness, a second
 *     dispatcher, a future admin path.
 *
 * ===========================================================================================
 * SO THE VALUE IS BRANDED, AND THE MINT TAKES AN `AuthenticatedPrincipal` RATHER THAN A STRING
 * ===========================================================================================
 *
 * **That is the whole design and it is stronger than a mint that takes a string.** A string mint
 * can be handed a request field by anyone who finds it. **This one cannot be called at all without
 * an `AuthenticatedPrincipal`, which is itself branded and which `tenancy/tenant-context.ts` says
 * is produced ONLY by a `PrincipalResolver`.** So the chain is:
 *
 * ```
 * a verified session credential
 *   -> PrincipalResolver            the only producer of AuthenticatedPrincipal
 *   -> sealAuthenticatedOrganizationId   the only producer of this type
 *   -> TenantAdminAuthorityResolver.resolve   the only consumer
 * ```
 *
 * **A REQUEST-SUPPLIED STRING CANNOT ENTER THAT CHAIN**, because there is no step that accepts one.
 * `architecture.md` §3a: *"omission does not compile"* — here it is *fabrication* that does not
 * compile, which is the same mechanism pointed at an input rather than at a guard.
 *
 * ===========================================================================================
 * *** IT NAMES THE PRINCIPAL IT WAS MINTED FOR, AND `resolve` COMPARES. ***
 * ===========================================================================================
 *
 * A receipt minted for one subject and spent on another is the obvious hole in any scheme of this
 * shape — `MembershipAdmission` names its principal for exactly this reason, and closes it the same
 * way. **Here the hole is a value retained past its request:** the brand is a plain object at
 * runtime, so a module-level cache, a closure, or a long-lived service could hold one from
 * principal X's session and present it during principal Y's request. **`resolve` refuses that.**
 *
 * ===========================================================================================
 * *** THE IN-STATEMENT LOOKUP STAYS, AND IT IS NOT A BACKSTOP. ***
 * ===========================================================================================
 *
 * `findActiveMembership` is **the only layer with no window at all** (`architecture.md` §3a). It
 * still holds when this receipt has gone stale between the mint and the read — a membership revoked
 * mid-request — and on a database restored past a migration. **The brand goes ABOVE it, never
 * instead of it**, and neither of them is *the* enforcement:
 *
 *   THE BRAND            catches a fabricated or misrouted identifier — a BUILD failure
 *                        **blind to a deliberate cast, and to a stale fact**
 *   THE MEMBERSHIP READ  catches a stale fact and a bypass, in the statement that reads
 *                        **blind to nothing that matters here**
 *
 * ===========================================================================================
 * *** WHAT THIS CANNOT REACH, NAMED RATHER THAN LEFT AS AN UNEXPLAINED ABSENCE (§3b-i) ***
 * ===========================================================================================
 *
 * **`0044` §3b.1's *"not an error that distinguishes another tenant's identifier from a nonexistent
 * one"* is not a type question and never will be.** It is a property of what a handler ANSWERS,
 * across two code paths that both compile perfectly. No brand covers it, no registration check sees
 * it, and it is `qa-agent`'s to assert behaviourally. **Recorded here so the presence of a strong
 * type on the input is not read as covering the output.**
 *
 * **NOT SINGLE-USE.** It certifies a FACT — *this Organization came from this principal's session*
 * — rather than consumed capacity. It spends no budget, and re-use within one request is already
 * bounded by the membership read. `architecture.md` §3a: *single-use copied without its rationale
 * is the exported-mint mistake again.*
 */

import type { AuthenticatedPrincipal } from '../tenancy/tenant-context.ts';

/**
 * *** A REAL SYMBOL, NOT A `declare const`. THE FIRST VERSION OF THIS LINE WAS THE SECOND KIND AND
 * IT TYPECHECKED. ***
 *
 * `declare const … : unique symbol` is a TYPE-LEVEL declaration and is erased — there is no value
 * at run time. `tenancy/tenant-context.ts` uses that form correctly, because its brand is applied
 * by a **cast** and never touched at run time. **This file's brand is applied by
 * `Object.defineProperty`, which needs the value**, and the mismatch produced a
 * `ReferenceError: AUTHENTICATED_ORGANIZATION_BRAND is not defined` **on the first call.**
 *
 * **`typecheck:core` WAS GREEN**, because `declare` is precisely a promise to the compiler that
 * something exists at run time. It was caught by a runtime probe on the first seal — which is why
 * the compile-time negative control was not sufficient on its own: **it proved fabrication is
 * refused, and could not observe that legitimate construction was broken.** `owner-immunity.ts` and
 * `grant-ceiling.ts` use the correct form; this file did not, and the two forms are one keyword
 * apart.
 */
const AUTHENTICATED_ORGANIZATION_BRAND: unique symbol = Symbol('dudo.tenantAdmin.authenticatedOrganization');

/**
 * An Organization identifier read from an authenticated principal.
 *
 * `value` IS THE IDENTIFIER AND `principalId` IS THE BINDING. Both are readable, because a handler
 * legitimately needs the first and the resolver needs the second; **what is not available is a way
 * to CONSTRUCT one**, which is the whole property.
 */
export type AuthenticatedOrganizationId = {
  readonly [AUTHENTICATED_ORGANIZATION_BRAND]: true;
  /** The Organization identifier. */
  readonly value: string;
  /** The principal whose session it was read from. Compared by `resolve`. */
  readonly principalId: string;
};

/**
 * THE ONLY PRODUCER.
 *
 * IT IS EXPORTED, and the reason is the same one `mintTenantAdminWriteCharge` records: **the caller
 * is the composition root**, which holds the `SessionResolver` and which cannot live in this module
 * without dragging session resolution into the class's type surface.
 *
 * **THE COST OF EXPORTING IT IS LOWER HERE THAN THERE, AND THE DIFFERENCE IS THE PARAMETER.** An
 * exported mint is dangerous when it takes values a caller can supply — `platform-authority.ts`
 * keeps its own mint private for that reason. **This one takes an `AuthenticatedPrincipal`, which
 * is itself unforgeable**, so exporting it widens who may CALL it and not what they may pass.
 */
export function sealAuthenticatedOrganizationId(
  principal: AuthenticatedPrincipal,
): AuthenticatedOrganizationId {
  const sealed = { value: principal.organizationId, principalId: principal.principalId };
  Object.defineProperty(sealed, AUTHENTICATED_ORGANIZATION_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(sealed) as AuthenticatedOrganizationId;
}

export class OrganizationNotFromAuthenticatedContextError extends Error {
  constructor(reason: string) {
    super(
      `A tenant-admin request used an Organization identifier that did not come from the ` +
        `authenticated context: ${reason}. docs/decisions/0044 §3b.2 — the tenant comes from the ` +
        'authenticated context and from nowhere else. Obtain the value from ' +
        'sealAuthenticatedOrganizationId, which is the only producer and which reads it off an ' +
        'AuthenticatedPrincipal.',
    );
    this.name = 'OrganizationNotFromAuthenticatedContextError';
  }
}

/**
 * Verifies the brand and binds it to the principal this request authenticated as.
 *
 * THROWN, NOT RETURNED, for `MembershipNotAdmittedError`'s reason: **no client can cause this.**
 * Clients supply values, never sealed contexts. What it catches is Dudo's own code carrying an
 * identifier across a request boundary — which must stop the request rather than be handled,
 * logged and served.
 */
export function consumeAuthenticatedOrganizationId(
  organization: AuthenticatedOrganizationId,
  principalId: string,
): string {
  const branded = organization as unknown as Record<symbol, unknown> | null | undefined;
  if (
    branded === null ||
    branded === undefined ||
    branded[AUTHENTICATED_ORGANIZATION_BRAND] !== true
  ) {
    return neverFromContext('the value did not come from sealAuthenticatedOrganizationId');
  }
  if (organization.principalId !== principalId) {
    // A context sealed during one principal's request, presented during another's. See the header:
    // the realistic route is a cache or a long-lived service, not a caller.
    return neverFromContext(
      "the Organization was sealed for a different principal than this request's",
    );
  }
  return organization.value;
}

function neverFromContext(reason: string): never {
  throw new OrganizationNotFromAuthenticatedContextError(reason);
}

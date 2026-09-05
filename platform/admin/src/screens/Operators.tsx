import { NotBuiltYet } from '@/components/NotBuiltYet';

/**
 * Operators.
 *
 * ===========================================================================
 * THERE IS NO ROUTE THAT LISTS OPERATORS, AND THAT IS A DESIGN PROPERTY
 * ===========================================================================
 *
 * This section is not waiting for an implementation, as Templates is. NO
 * CONTRACT IN THE PLATFORM CLASS EXPOSES THE SET OF OPERATORS AT ALL, and the
 * nearest route — which this console now calls on every page load — is built so
 * that it cannot.
 *
 * `platform-operator-v1`, on `platform.session.whoami`: "IT RETURNS THE CALLER'S
 * OWN CONTEXT AND HAS NO FIELD NAMING ANOTHER PRINCIPAL. The safety argument is
 * in the signature... there is no parameter through which another operator could
 * be named, so this cannot become a way to enumerate the platform's operators."
 * The schema repeats it as a rule about the shape itself: "IT HAS NO FIELD
 * NAMING ANOTHER PRINCIPAL, and none may be added."
 *
 * The class holds exactly six operations — `organizations.list`,
 * `templates.list`, `templates.read`, `templates.create`,
 * `organizations.create`, `credentials.reset` — and the contract states that "A
 * SEVENTH NEEDS ITS OWN ARGUMENT", because that discipline "is what keeps 'it is
 * a platform route so it needs no tenant' from becoming a way to write an Action
 * without a tenant check."
 *
 * SO THIS SCREEN DOES NOT SAY "COMING SOON". An operator list is a seventh
 * operation and a Team Lead decision, not an obvious gap for a UI agent to
 * assume. `credential-reset-v1` is not it either: that route resets a TENANT
 * ADMIN's credential — which the audit model calls "A TAKEOVER OF THAT ACCOUNT
 * BY DESIGN" — and it names no operator.
 *
 * WHAT THE CONSOLE DOES SHOW is the signed-in operator's own identity, role and
 * reachable permissions, in the header and sidebar, from `whoami`. That is the
 * whole of what any accepted contract will tell this console about who holds
 * platform authority.
 */
export function Operators() {
  return (
    <NotBuiltYet
      title="Operators"
      purpose={
        <>
          Intended to show who holds platform authority — a row in{' '}
          <code className="font-mono text-[0.8125rem]">platform_operator</code>, which under{' '}
          <span className="whitespace-nowrap">ADR 0025</span> is what makes a principal an
          operator, and which must never coexist with a membership row. Your own identity, role
          and permissions are in the sidebar; no contract exposes anyone else’s.
        </>
      }
      contract={null}
      contractStatus="No route exists, and none is drafted. This is deliberate rather than an omission."
      blockedOn={[
        'A Team Lead decision that an operator-listing route should exist at all. The platform class holds exactly six operations, and platform-operator-v1 requires a seventh to carry its own argument.',
        'platform.session.whoami cannot be used: it returns only the caller’s own context and the schema forbids adding any field that names another principal, specifically so it cannot become a way to enumerate operators.',
      ]}
    />
  );
}

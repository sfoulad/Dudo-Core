/**
 * Whether the FIXTURE build has had an Organization selected on it.
 *
 * ===========================================================================
 * WHY THE FIXTURE MODELS THIS AT ALL
 * ===========================================================================
 *
 * Because the last time it did not, the web application shipped with no
 * Organization-selection step and nobody noticed. Every verification of that
 * flow was performed BY HAND against a deployment — the probes called the
 * picker and the selection explicitly, and the deployed client never did. A
 * user's first real browser session found it in one screenshot.
 *
 * Selection is mandatory for every principal on every session, so a fixture
 * that hands out a working session without one is not a simplification: it is a
 * fixture that disagrees with the server about the single most important thing
 * a session has. This module makes the fixture refuse exactly as Core refuses,
 * so the same client code runs in both builds and the picker can be reviewed
 * without deploying anything.
 *
 * ===========================================================================
 * IT IS NOT A SECURITY BOUNDARY AND IT IS NOT A TENANT
 * ===========================================================================
 *
 * There is no server in a fixture build, no principal, no membership and no
 * tenant. This is a boolean that makes a demonstration honest. It decides
 * nothing, and the moment `VITE_DUDO_TRANSPORT=http` is set neither this module
 * nor the fixture transport is constructed at all — Core decides everything,
 * from the session, on every call.
 *
 * It deliberately does NOT record WHICH Organization was chosen. Even in a
 * fixture, a client-side memory of the selected tenant is the ambient tenant
 * the contract forbids, and modelling it here would make the wrong shape look
 * reasonable.
 */

let selected = false;

export function fixtureOrganizationSelected(): boolean {
  return selected;
}

export function setFixtureOrganizationSelected(value: boolean): void {
  selected = value;
}

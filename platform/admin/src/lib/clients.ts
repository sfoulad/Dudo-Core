/**
 * The console's API clients — one of each, for the life of the application.
 *
 * ===========================================================================
 * MODULE SCOPE IS THE POINT, AND `App.tsx` SAID WHY BEFORE IT WAS DELETED
 * ===========================================================================
 *
 * These were `useMemo(..., [])` in `App.tsx`, with a comment that is worth
 * carrying across verbatim because the cost it names is unusual:
 *
 *   "One of each for the life of the application. Recreating them per render
 *    would give the session hook's callbacks a new identity every time and would
 *    re-fire the probe — WHICH, ON THIS CLASS, IS A FRESH AUDIT RECORD EACH
 *    TIME."
 *
 * **`whoami` writes a platform-operator audit record on every call.** A client
 * identity that churned would not merely cost requests; it would write rows to
 * the operator trail describing nothing an operator did. `0014` §A's daily
 * write admission is finite and the security split within it is 10,000/day.
 *
 * Under ADR 0040's router migration the screens are rendered by a route tree
 * rather than by a parent that could pass anything down, so these moved to
 * module scope — which makes the property STRUCTURAL rather than conventional:
 * there is now no render that can produce a second client.
 */

import { createAuthClient, type AuthClient } from '@/api/auth';
import { createPlatformClient, type PlatformClient } from '@/api/platform';

export const authClient: AuthClient = createAuthClient();
export const platformClient: PlatformClient = createPlatformClient();

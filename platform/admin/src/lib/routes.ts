/**
 * The console's four top-level section paths.
 *
 * ===========================================================================
 * A LEAF MODULE, AND IT EXISTS BECAUSE PUTTING THESE IN THE ROUTE TREE BROKE
 * THE CONSOLE COMPLETELY
 * ===========================================================================
 *
 * These constants first went into `routes/route-tree.tsx`, next to the routes
 * that use them, which reads as the obvious home. It created a cycle:
 *
 *     route-tree → root-layout → AdminShell → route-tree
 *
 * `AdminShell` renders the navigation and needs the paths; the route tree needs
 * the shell. **The result was `ReferenceError: Cannot access 'Mn' before
 * initialization` and a blank page** — a temporal dead zone, which is what a
 * circular import looks like after minification.
 *
 * **AND EVERY GATE WAS GREEN WHILE IT WAS BROKEN.** `tsc` exited 0, `vite build`
 * exited 0, and `npm run verify` reported 584 passing assertions. A module cycle
 * is legal TypeScript and legal ES; it fails at RUNTIME, on the first render,
 * and nothing that inspects source or types can see it. It was caught by loading
 * the page in a browser and by nothing else.
 *
 * **So this module imports NOTHING.** It sits at the bottom of the graph, where
 * both the route tree and the shell can reach it and neither reaches the other.
 * That is the property to preserve: **if this file ever grows an import, the
 * cycle can come back.**
 */

export const ROUTES = {
  dashboard: '/',
  organizations: '/organizations',
  templates: '/templates',
  operators: '/operators',
  audit: '/audit',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * Where an unmatched address falls back to.
 *
 * **IT IS THE DASHBOARD NOW, AND IT USED TO BE THE ORGANIZATION LIST.** `/` was
 * a redirect to `/organizations` because there was nothing at the root worth
 * showing; it now renders the platform summary, so the fallback lands somewhere
 * that answers *"what is the state of the platform"* rather than somewhere that
 * spends a paginated read on a question the arriver may not have asked.
 */
export const HOME_ROUTE: RoutePath = ROUTES.dashboard;

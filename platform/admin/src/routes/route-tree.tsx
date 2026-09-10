/**
 * The console's route tree.
 *
 * ===========================================================================
 * IT REPLACED A HAND-ROLLED HASH ROUTER, RATHER THAN RUNNING BESIDE ONE
 * ===========================================================================
 *
 * `lib/router.ts` was 188 lines of `useSyncExternalStore`, hash parsing and two
 * hand-written path matchers, and `App.tsx` chose a section with a `switch` that
 * the parameterised routes had to be matched ahead of. Both are deleted.
 *
 * **ROUTING IS NOT INCREMENTAL** — either this console's route tree is TanStack
 * or it is not — so this landed as one change, before the first Milestone 1
 * screen rather than after seventeen of them.
 *
 * ===========================================================================
 * PATH HISTORY, AND THE INFRASTRUCTURE ALREADY SERVED IT
 * ===========================================================================
 *
 * `wrangler.admin.jsonc` already carries
 * `not_found_handling: "single-page-application"`, so a deep link such as
 * `/organizations/org_x/audit` is rewritten to `/index.html` and arrives here
 * rather than 404ing at the edge. Nothing was added to make this work.
 *
 * ⚠ **THE ROUTE TREE MAY NOT CLAIM `/api/*`, `/auth/*` OR `/health`.** Those are
 * this Worker's `run_worker_first` prefixes, and **this host's list is WIDER than
 * `platform/web`'s** — its config records why: *"without listing them a POST to
 * `/auth/login/complete` is rewritten to the SPA shell and answered 200 with
 * HTML. That cost a day to find once."*
 *
 * A request under those prefixes reaches the Worker and never reaches this
 * router, so a section mounted at one would be **dead on the deployed build and
 * perfectly alive in `vite dev`**. Under hash history the question could not
 * arise, because the Worker never saw the fragment. It can arise now. No current
 * route is affected.
 *
 * ===========================================================================
 * CODE-BASED ROUTES, NOT FILE-BASED
 * ===========================================================================
 *
 * File-based routing needs `@tanstack/router-plugin`, which is **not in the set
 * the user approved** (`0036`; `security.md` §7 — approval is specific and does
 * not carry forward). Code-based routes need nothing beyond the approved library
 * and put the whole tree in one reviewable file.
 */

import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
import { RootLayout } from '@/routes/root-layout';
import { Organizations } from '@/screens/Organizations';
import { OrganizationDetail } from '@/screens/OrganizationDetail';
import { OrganizationAudit } from '@/screens/OrganizationAudit';
import { Templates } from '@/screens/Templates';
import { Operators } from '@/screens/Operators';
import { PlatformAudit } from '@/screens/PlatformAudit';

/*
 * NO CLIENT IS IMPORTED HERE ANY MORE, AND THAT IS THE POINT OF THE CONVERSION.
 *
 * Every route component below renders a screen that takes no `platform` prop:
 * reads and writes go through `lib/queries.ts`, which uses the single
 * module-scoped client in `lib/clients.ts`. **The route tree has stopped being
 * a place the client is threaded from**, so there is no longer a second route
 * to it for a future screen to pick up.
 */

/*
 * THE SECTION PATHS LIVE IN `lib/routes.ts`, NOT HERE, AND THAT IS NOT A STYLE
 * CHOICE.
 *
 * They were declared in this file first, beside the routes that use them, which
 * is where they read as belonging. `AdminShell` renders the navigation and needs
 * them, and this file needs `AdminShell` — so importing them back from here made
 * a cycle:
 *
 *     route-tree → root-layout → AdminShell → route-tree
 *
 * **The console rendered a blank page with `ReferenceError: Cannot access 'Mn'
 * before initialization`, and `tsc`, `vite build` and 584 verify assertions were
 * all green while it did.** See `lib/routes.ts`.
 */
import { ROUTES, HOME_ROUTE } from '@/lib/routes';

const rootRoute = createRootRoute({ component: RootLayout });

/**
 * `/` is not a section. The Organization list is the console's home, which is
 * what `HOME_ROUTE` meant in the router this replaced.
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: HOME_ROUTE });
  },
});

const organizationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.organizations,
  component: OrganizationsRoute,
});

function OrganizationsRoute() {
  return <Organizations />;
}

/**
 * `/organizations/$organizationId` and its audit feed.
 *
 * THE HAND-ROLLED VERSION MATCHED THE AUDIT FEED FIRST AND SAID WHY, and the
 * reasoning is worth keeping even though the router now makes it unnecessary:
 *
 *   "Both matchers are exact on segment count — three and two — so they cannot
 *    both match; but ordering the more specific one first means a future
 *    loosening of either cannot silently route `/organizations/x/audit` to the
 *    detail screen, which would then request an Organization named `x/audit` and
 *    SPEND AN AUDIT RECORD learning it does not exist."
 *
 * TanStack Router ranks by specificity rather than by declaration order, so the
 * hazard is structural now rather than a property of the sequence below. **The
 * cost it names — a wasted operator audit record for a lookup nobody asked for —
 * is why it is recorded rather than dropped as solved.**
 */
const organizationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/organizations/$organizationId',
  component: OrganizationDetailRoute,
});

function OrganizationDetailRoute() {
  const { organizationId } = organizationDetailRoute.useParams();
  return <OrganizationDetail organizationId={organizationId} />;
}

const organizationAuditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/organizations/$organizationId/audit',
  component: OrganizationAuditRoute,
});

function OrganizationAuditRoute() {
  const { organizationId } = organizationAuditRoute.useParams();
  return <OrganizationAudit organizationId={organizationId} />;
}

const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.templates,
  component: TemplatesRoute,
});

/*
 * NO `platform` PROP. Templates and Operators read and write through
 * `lib/queries.ts`, which uses the single module-scoped client in
 * `lib/clients.ts`. Threading the client in as well would leave a second route
 * to it — and the whole point of module scope there is that no render can
 * produce a second client.
 */
function TemplatesRoute() {
  return <Templates />;
}

const operatorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.operators,
  component: OperatorsRoute,
});

/**
 * `Operators` needs `whoami` to mark which row is the signed-in operator.
 *
 * IT COMES FROM `OperatorProvider`, NOT FROM ROUTER CONTEXT, and the distinction
 * is about meaning rather than mechanics: `whoami` reports a PERMISSION LIST, and
 * putting it in router context would make it read as something routing consults.
 * **Nothing branches on it to permit anything** — it marks a row, and Core
 * authorises every call regardless (`0010` §7). See `lib/operator-context.tsx`.
 */
function OperatorsRoute() {
  return <Operators />;
}

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: ROUTES.audit,
  component: PlatformAuditRoute,
});

function PlatformAuditRoute() {
  return <PlatformAudit />;
}

/**
 * A CATCH-ALL, BECAUSE THIS CONSOLE SENDS AN UNMATCHED ADDRESS HOME.
 *
 * The first attempt used `defaultNotFoundComponent` and threw `redirect()` from
 * the component body. **It did nothing** — the address stayed at
 * `/nowhere-at-all` — because a redirect is thrown during route resolution, not
 * during render, and a component that throws one is throwing into React's render
 * path where the router is not listening.
 *
 * `beforeLoad` on a wildcard runs at the right moment. TanStack ranks static
 * segments above dynamic and dynamic above wildcard, so this cannot shadow
 * `/organizations/$organizationId` — it is reached only when nothing else
 * matched.
 */
const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  beforeLoad: () => {
    throw redirect({ to: HOME_ROUTE });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  organizationsRoute,
  organizationDetailRoute,
  organizationAuditRoute,
  templatesRoute,
  operatorsRoute,
  auditRoute,
  catchAllRoute,
]);

/**
 * AN UNMATCHED ADDRESS RENDERS THE HOME SECTION, WHICH IS THE BEHAVIOUR THIS
 * CONSOLE HAD, PRESERVED DELIBERATELY.
 *
 * `App.tsx` did this and flagged itself:
 *
 *   "A 404 inside a console with four sections and no deep links would be a dead
 *    end for a mistyped address. THIS IS WORTH REVISITING WHEN ROUTES TAKE
 *    IDENTIFIERS — `/organizations/:id` for an Organization that does not exist
 *    is a genuine not-found and must say so, rather than quietly showing a list."
 *
 * **DONE 2026-09-09, AND THE CATCH-ALL BELOW WAS NOT THE PLACE FOR IT.**
 *
 * The distinction the old comment was reaching for is between two failures that
 * look alike from here:
 *
 *   - **The ROUTE does not match** — a mistyped section, `/orgnizations`.
 *     Redirecting home is right and the wildcard below still does it.
 *   - **The route matches and the IDENTIFIER does not resolve** — a real
 *     Organization address for a business that is not there. **That is a state
 *     the DETAIL SCREEN owns**, not a router-level 404 page.
 *
 * `OrganizationDetail` now renders it: a plain "this Organization does not
 * exist", quoting the identifier, with a link back to the directory and **no
 * retry**, since asking again spends another audited read to get the same
 * answer. `forbidden` renders as its own distinct thing beside it.
 *
 * **A router-level 404 would have been the wrong shape** — it discards the
 * shell, and the operator has a working session and three other sections. The
 * useful response keeps them oriented.
 *
 * **What made this a ruling rather than a judgement call is that the contract
 * settles it**: `platform.organizations.read`'s own `notFound` block says there
 * is no oracle concern, because any caller who can reach the route can already
 * enumerate every Organization. **That reasoning is scoped to this route class
 * and must not be carried to a tenant-facing screen** — the detail screen
 * carries the full quotation and the warning.
 */
export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
  /*
   * Scroll and focus on a section change are the shell's, which already owns the
   * main region. Two mechanisms deciding where a new screen starts is how a
   * form's first field ends up blurred and reporting an error on an untouched
   * control.
   */
  scrollRestoration: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

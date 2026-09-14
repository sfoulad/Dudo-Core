/**
 * The route tree.
 *
 * ===========================================================================
 * IT REPLACED A HAND-ROLLED ROUTER, RATHER THAN RUNNING BESIDE ONE
 * ===========================================================================
 *
 * `lib/router.ts` was 107 lines of `useSyncExternalStore`, `matchPath` and hash
 * parsing, and its own opening comment said what to do with it: *"If the admin
 * interface standardises on one, this is the file to replace — it is small on
 * purpose."* ADR 0036 standardised on TanStack Router and required a migration
 * rather than two routers side by side, landing before any Milestone 1 screen is
 * built on it. It is deleted, not deprecated.
 *
 * ===========================================================================
 * CODE-BASED ROUTES, NOT FILE-BASED — AND THAT IS A DEPENDENCY DECISION
 * ===========================================================================
 *
 * TanStack Router's file-based routing needs `@tanstack/router-plugin` to
 * generate a route tree at build time. **That is a seventh package and it is not
 * in the approved set** (`0036`; `security.md` §7 — approval is specific and does
 * not carry forward). Code-based routes need nothing beyond the library that was
 * approved, and they put the whole tree in one reviewable file, which is worth
 * more on a console that is about to grow two hosts' worth of screens.
 *
 * ===========================================================================
 * PATH HISTORY. RULED BY THE TEAM LEAD, 2026-09-09 (`0036`'s amendment)
 * ===========================================================================
 *
 * The migration first landed on `createHashHistory()`, deliberately: every
 * address this application had published was `#/customers/…` and the console is
 * deployed. That was flagged rather than left implicit, and the flag is what
 * forced the decision while it was still one line.
 *
 * **`0035` puts Organization administration at `app.dudo.work/settings` — a
 * PATH.** Under hash history that address is `app.dudo.work/#/settings`, which is
 * not what the scope directive says and not what anyone will type. Serving a
 * different address than the directive names is the shape of divergence
 * `workflow.md` §12 exists to catch.
 *
 * **The infrastructure was already there**, which is why this cost nothing:
 * `wrangler.jsonc` and `wrangler.admin.jsonc` both set
 * `not_found_handling: "single-page-application"`, so an unmatched path is
 * rewritten to `/index.html` and reaches this router.
 *
 * ⚠ **THE ROUTE TREE MAY NOT CLAIM `/api/*`, `/auth/*` OR `/health`.** Those are
 * the `run_worker_first` prefixes in both wrangler files: a request under them
 * reaches the Worker and never reaches these routes, so a screen mounted at one
 * would be dead on the deployed build and perfectly alive in `vite dev`. Under
 * hash history the question could not arise, because the Worker never saw the
 * fragment. It can arise now. No current route is affected.
 */

import {
  Outlet,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useRouterState,
} from '@tanstack/react-router';
import { RootLayout } from '@/routes/root-layout';
import { CustomerList } from '@/screens/CustomerList';
import { CustomerDetail } from '@/screens/CustomerDetail';
import { CustomerForm } from '@/screens/CustomerForm';
import { NotFound } from '@/screens/NotFound';
import { customerListSearchSchema } from '@/routes/customer-list-search';
import { SettingsShell } from '@/components/settings/SettingsShell';
import { SettingsNotFound } from '@/components/settings/SettingsState';
import { SettingsOverview } from '@/screens/settings/SettingsOverview';
import { SettingsSection } from '@/screens/settings/SettingsSection';

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});

/**
 * `/` is not a screen. The directory is the application's home, and it was the
 * hand-rolled router's default too — `read()` fell back to `/customers` for an
 * empty hash.
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/customers', search: {} });
  },
});

/**
 * The directory.
 *
 * `validateSearch` is the whole reason `0036` names the URL as "the admin
 * console's most-used piece of state": the search term, the status, the Business
 * filter and the cursor are parsed, defaulted and TYPED here, once, instead of
 * being read as four possibly-absent strings in the screen. A component that
 * asks for `search.status` now gets `StatusFilter`, not `string | undefined`.
 *
 * The schema's `parse` is called through a plain function rather than an adapter
 * package, because `@tanstack/zod-adapter` would be a seventh library for a
 * one-line call.
 */
const customersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers',
  validateSearch: (search: Record<string, unknown>) => customerListSearchSchema.parse(search),
  component: CustomerListRoute,
});

function CustomerListRoute() {
  const search = customersRoute.useSearch();
  return <CustomerList search={search} />;
}

/**
 * `/customers/new` is a screen rather than an identifier.
 *
 * The hand-rolled table had to match it BEFORE `/customers/:customer_id` and
 * said so in a comment, because order was the only thing keeping "new" from
 * being read as a customer id. TanStack Router ranks a static segment above a
 * dynamic one, so the ordering below carries no meaning and cannot be got wrong
 * by rearranging it.
 */
const customerNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/new',
  component: CustomerCreateRoute,
});

function CustomerCreateRoute() {
  return <CustomerForm />;
}

const customerDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/$customerId',
  component: CustomerDetailRoute,
});

function CustomerDetailRoute() {
  const { customerId } = customerDetailRoute.useParams();
  return <CustomerDetail customerId={customerId} />;
}

const customerEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/customers/$customerId/edit',
  component: CustomerEditRoute,
});

function CustomerEditRoute() {
  const { customerId } = customerEditRoute.useParams();
  return <CustomerForm customerId={customerId} />;
}

/* =========================================================================
   /settings — Organization administration (ADR 0035, Milestone 2)
   =========================================================================

   A NESTED LAYOUT ROUTE, WHICH IS THE FIRST ONE IN THIS TREE. Everything above
   is flat: each route draws a whole screen. `/settings` draws a frame — the
   section navigation — and its children draw into it through the `<Outlet/>`
   below. **The alternative was eleven top-level routes each rendering the
   navigation themselves**, which is eleven copies of a layout and eleven
   chances for one to fall behind.

   ⚠ **THE PATHS ARE SPELLED TWICE, AND A CHECK CLOSES IT RATHER THAN A
   CONVENTION.** `lib/settings-sections.ts` holds the FULL path
   (`/settings/profile`) because the navigation's `Link to=` is typed against
   full paths; a child route below declares a RELATIVE segment (`/profile`)
   because that is what `getParentRoute` composes. **They are two spellings of
   one fact, and `§12` is explicit that a duplicated constraint has no citations
   and no sweep can find it.** So `scripts/verify-settings.mjs` derives the
   expected segments from the registry, reads the declared ones out of this
   file, and goes red on any disagreement — including a section present in one
   and absent from the other, which is the silent direction: a route with no
   navigation entry is reachable by address and invisible in the menu.

   ⚠ **`/settings` MUST NOT COLLIDE WITH A WORKER PREFIX.** `wrangler.jsonc`
   sets `run_worker_first` for `/api/*`, `/auth/*` and `/health`: a request
   under one of those reaches the Worker and never reaches this router, so a
   screen mounted there would be dead on the deployed build and perfectly alive
   in `vite dev`. `/settings` is clear of all three. */

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsLayout,
  /*
   * A SETTINGS-SCOPED NOT-FOUND, RATHER THAN FALLING THROUGH TO THE ROOT'S.
   * `/settings/nonsense` is still inside settings: keeping the navigation
   * on screen means the reader can reach a real section from where they
   * landed, instead of being dropped on a whole-application 404 that has
   * forgotten where they were going.
   */
  notFoundComponent: SettingsNotFoundRoute,
});

function SettingsLayout() {
  /*
   * THE PATH COMES FROM THE ROUTER, NOT FROM `window.location`. The shell marks
   * the current section with `aria-current`, and reading the address directly
   * would be a second source that is correct until the first client-side
   * navigation the router performs without a reload.
   */
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <SettingsShell currentPath={pathname}>
      <Outlet />
    </SettingsShell>
  );
}

function SettingsNotFoundRoute() {
  return <SettingsNotFound />;
}

/**
 * The index. `/settings` itself, not a redirect to `/settings/overview`.
 *
 * A redirect would put a second address in every reader's history for one
 * screen, and the navigation would then have to decide which of the two counts
 * as current. The registry names `/settings` and this serves it.
 */
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  component: SettingsOverview,
});

/*
 * The ten sections. Each is `SettingsSection` with its registry id today; when
 * one becomes real, its `component` here changes to that section's own screen
 * and nothing else moves. See `screens/settings/SettingsSection.tsx` for why
 * there is no override table sitting empty in the meantime.
 */
const settingsProfileRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/profile',
  component: () => <SettingsSection id="profile" />,
});

const settingsBusinessesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/businesses',
  component: () => <SettingsSection id="businesses" />,
});

const settingsMembersRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/members',
  component: () => <SettingsSection id="members" />,
});

const settingsInvitationsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/invitations',
  component: () => <SettingsSection id="invitations" />,
});

const settingsRolesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/roles',
  component: () => <SettingsSection id="roles" />,
});

const settingsSessionsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/sessions',
  component: () => <SettingsSection id="sessions" />,
});

const settingsAppsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/apps',
  component: () => <SettingsSection id="apps" />,
});

const settingsAuditRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/audit',
  component: () => <SettingsSection id="audit" />,
});

const settingsDataRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/data',
  component: () => <SettingsSection id="data" />,
});

const settingsPlanRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/plan',
  component: () => <SettingsSection id="plan" />,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  customersRoute,
  customerNewRoute,
  customerDetailRoute,
  customerEditRoute,
  settingsRoute.addChildren([
    settingsIndexRoute,
    settingsProfileRoute,
    settingsBusinessesRoute,
    settingsMembersRoute,
    settingsInvitationsRoute,
    settingsRolesRoute,
    settingsSessionsRoute,
    settingsAppsRoute,
    settingsAuditRoute,
    settingsDataRoute,
    settingsPlanRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  /*
   * See the header. Both wrangler files set
   * `not_found_handling: "single-page-application"`, so a deep link such as
   * `/customers/cus_x` is rewritten to `/index.html` and arrives here rather
   * than 404ing at the edge. Nothing else was needed to make this work.
   */
  history: createBrowserHistory(),
  defaultNotFoundComponent: NotFound,
  /*
   * Scrolling is handled by `RootLayout`'s focus effect, which also moves focus
   * to the main region. Two mechanisms racing to decide where a new screen
   * starts is how a form's first field ends up blurred and reporting an error on
   * an untouched control.
   */
  scrollRestoration: false,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

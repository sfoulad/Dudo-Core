/**
 * Dudo web — application entry point.
 *
 * React 19 · TypeScript · Vite · Tailwind CSS v4, built to static assets and
 * served by Cloudflare Workers Static Assets (ADR 0016). Requests for those
 * assets are free and unlimited: they do not invoke the Worker, consume no CPU,
 * and do not count against the 100,000 requests/day allowance. The Worker
 * handles the API and nothing else.
 *
 * ADR 0036 added TanStack Router, TanStack Query, TanStack Table, React Hook Form
 * and Zod to that list, and none of them changes the sentence above: they are
 * build-time and browser-side, so they cost bandwidth we do not pay for and CPU
 * we do not spend. **What would cost money is a library that adds server
 * requests, and none of these does** — `lib/query-client.ts` records the four
 * TanStack Query defaults that would have, and turns each one off.
 *
 * WHAT THIS BUILD IS depends on one build-time flag, `VITE_DUDO_TRANSPORT`:
 *
 *   fixture (default)  the Customer Directory against in-memory data. No network
 *                      call of any kind. This is how the UI is developed,
 *                      demonstrated and reviewed with no backend.
 *   http               the real client, talking to Core over the contracts' HTTP
 *                      bindings, with a real login.
 *
 * `api/config.ts` resolves that flag and REFUSES TO START on an unrecognised
 * value rather than falling back, so a build is never live-by-accident or
 * fixture-by-accident. Both transports sit behind one `Transport` interface, so
 * no screen knows which it is talking to.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { configureBusinesses, configureFaults } from './api/fixture-transport';
import { CONFIG } from './api/config';
import { createQueryClient } from './lib/query-client';
import { router } from './routes/route-tree';
import './styles/index.css';

/**
 * Fault injection, read once at start-up from the page's own query string:
 *
 *   ?fault=list|detail|write|all  [&faultCode=unavailable|internal|timeout|forbidden|rate_limited]
 *
 * It exists so the error states can be SEEN rather than described. Nothing fails
 * on its own — a directory that failed at random would teach people to click
 * through real problems.
 *
 * `?businesses=none` makes the authorized Business set empty. Not a hypothetical
 * state to play with: the Business Read contract states this is what every
 * principal receives today, because Core ships a deny-all authorization source.
 * Both clients are required to render it as a first-class state, so it has to be
 * reachable to be demonstrated and reviewed.
 *
 * BOTH SWITCHES ARE FIXTURE-ONLY AND ARE NOT READ IN AN HTTP BUILD. They
 * configure the fixture transport, which is not constructed when the flag says
 * `http`; leaving them live there would mean a query parameter appearing to
 * change how the real API behaves, which is a lie in the address bar.
 *
 * ===========================================================================
 * THEY ARE READ ONCE, BEFORE THE ROUTER EXISTS, AND THE ORDER IS NOW LOAD-BEARING
 * ===========================================================================
 *
 * Under hash history these lived in the real query string, before the `#`, and
 * the router never saw them. **Path routing (`0036`'s amendment) puts the router
 * in charge of that same query string**, and `customerListSearchSchema` declares
 * four keys and strips the rest — deliberately, so a demonstration switch can
 * never become part of a screen's own state and get echoed back into every link.
 *
 * So the switches are consumed HERE, at module scope, before `RouterProvider`
 * mounts. `configureFaults` and `configureBusinesses` set module state that the
 * fixture transport reads at invoke time, so the configuration holds for the life
 * of the page.
 *
 * **WHAT ACTUALLY HAPPENS TO THE PARAMETER, MEASURED RATHER THAN REASONED:**
 *
 *   · **A cold load leaves the URL alone.** TanStack Router validates the search
 *     for the route's own use and does NOT rewrite the address bar, so
 *     `?businesses=none` is still there after the page settles — and a RELOAD
 *     therefore still carries the switch. Demonstrating an error state survives
 *     refreshing, which is what a reviewer will actually do.
 *   · **The first in-app navigation drops it**, because every navigation writes
 *     `tidySearch(...)` and the schema never knew the key. From then on the
 *     switch is live in module state but absent from the URL.
 *
 * **This paragraph replaced one that asserted the opposite** — that the router
 * rewrote the URL on load and a reload would lose the switch. That was reasoned
 * from how `validateSearch` sounds rather than measured, and it was wrong in the
 * direction that would have had someone work around a problem they did not have.
 * `architecture.md` §3c: a comment is a claim, and this one is now a measured one.
 */
const startupParams = new URLSearchParams(window.location.search);
if (CONFIG.transport !== 'http') {
  if (startupParams.has('fault')) {
    configureFaults(startupParams.get('fault'), startupParams.get('faultCode'));
  }
  configureBusinesses(startupParams.get('businesses'));
}

const container = document.getElementById('root');
if (!container) throw new Error('Root container is missing from index.html');

/*
 * ONE QUERY CLIENT, CREATED ONCE, OUTSIDE RENDER. A second one would silently
 * halve the cache and re-issue every read — and the whole reason ADR 0036 names
 * TanStack Query is that `core.ListAuthorizedBusinesses` was being spent four
 * times on a cold start.
 */
const queryClient = createQueryClient();

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);

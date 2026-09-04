/**
 * Dudo web — application entry point.
 *
 * React 19 · TypeScript · Vite · Tailwind CSS v4, built to static assets and
 * served by Cloudflare Workers Static Assets (ADR 0016). Requests for those
 * assets are free and unlimited: they do not invoke the Worker, consume no CPU,
 * and do not count against the 100,000 requests/day allowance. The Worker
 * handles the API and nothing else.
 *
 * WHAT THIS BUILD IS depends on one build-time flag, `VITE_DUDO_TRANSPORT`:
 *
 *   fixture (default)  the Customer Directory against in-memory data. No
 *                      network call of any kind. This is how the UI is
 *                      developed, demonstrated and reviewed with no backend.
 *   http               the real client, talking to Core over the contracts'
 *                      HTTP bindings, with a real login.
 *
 * `api/config.ts` resolves that flag and REFUSES TO START on an unrecognised
 * value rather than falling back, so a build is never live-by-accident or
 * fixture-by-accident. Both transports sit behind one `Transport` interface, so
 * no screen knows which it is talking to.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { configureBusinesses, configureFaults } from './api/fixture-transport';
import { CONFIG } from './api/config';
import './styles/index.css';

/**
 * Fault injection, read once at start-up from the page's own query string:
 *
 *   ?fault=list|detail|write|all  [&faultCode=unavailable|internal|timeout|forbidden|rate_limited]
 *
 * It exists so the error states can be SEEN rather than described. Nothing
 * fails on its own — a directory that failed at random would teach people to
 * click through real problems.
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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

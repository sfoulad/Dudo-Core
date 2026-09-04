/**
 * Dudo web — application entry point.
 *
 * React 19 · TypeScript · Vite · Tailwind CSS v4, built to static assets and
 * served by Cloudflare Workers Static Assets (ADR 0016). Requests for those
 * assets are free and unlimited: they do not invoke the Worker, consume no CPU,
 * and do not count against the 100,000 requests/day allowance. The Worker
 * handles the API and nothing else.
 *
 * WHAT THIS BUILD IS. The Customer Directory rendered against fixture data.
 * NOTHING HERE MAKES A NETWORK CALL, because nothing authenticates yet and no
 * environment is deployed. The fixture sits behind the same client interface
 * the real API client will implement — see api/client.ts — so replacing it is
 * one file and no screen changes.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { configureBusinesses, configureFaults } from './api/fixture-transport';
import './styles/index.css';

/**
 * Fault injection, read once at start-up from the page's own query string:
 *
 *   ?fault=list|detail|write|all  [&faultCode=unavailable|internal|timeout|forbidden|rate_limited]
 *
 * It exists so the error states can be SEEN rather than described. Nothing
 * fails on its own — a directory that failed at random would teach people to
 * click through real problems.
 */
const startupParams = new URLSearchParams(window.location.search);
if (startupParams.has('fault')) {
  configureFaults(startupParams.get('fault'), startupParams.get('faultCode'));
}

/**
 * `?businesses=none` makes the authorized Business set empty.
 *
 * Not a hypothetical state to play with: the Business Read contract states this
 * is what every principal receives today, because Core ships a deny-all
 * authorization source. Both clients are required to render it as a
 * first-class state, so it has to be reachable to be demonstrated and reviewed.
 */
configureBusinesses(startupParams.get('businesses'));

const container = document.getElementById('root');
if (!container) throw new Error('Root container is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Dudo web — application entry point.
 *
 * Zero dependencies, zero build step. This is plain ES modules, plain CSS and
 * plain HTML, served as static assets, because no web framework and no npm
 * package is approved for Dudo-Core (ADR 0003 approves a language and six
 * Cloudflare services; nothing more). Adding one is a user decision, not a
 * client decision, so this application is written not to need one.
 *
 * WHAT THIS BUILD IS. The Customer Directory rendered against fixture data.
 * NOTHING HERE MAKES A NETWORK CALL, because nothing authenticates yet and no
 * environment is deployed. The fixture sits behind the same client interface
 * the real API client will implement — see api/client.js — so replacing it is
 * one file and no view changes.
 */

import { createShell } from './ui/shell.js';
import { createRouter } from './router.js';
import { createCustomerDirectoryClient } from './api/client.js';
import { createFixtureTransport, configureFaults } from './api/fixture-transport.js';
import { renderCustomerList } from './views/customer-list.js';
import { renderCustomerDetail, renderCustomerNotFound } from './views/customer-detail.js';
import { renderCustomerForm } from './views/customer-form.js';

const root = document.getElementById('app');
const shell = createShell(root);
const client = createCustomerDirectoryClient(createFixtureTransport());

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
  configureFaults({
    scope: startupParams.get('fault'),
    code: startupParams.get('faultCode') || 'unavailable',
  });
}

/**
 * The routes. `/customers/new` is declared before `/customers/:customer_id` so
 * that "new" is a screen rather than an identifier.
 */
const routes = [
  { pattern: '/customers', view: renderCustomerList },
  { pattern: '/customers/new', view: renderCustomerForm },
  { pattern: '/customers/:customer_id', view: renderCustomerDetail },
  { pattern: '/customers/:customer_id/edit', view: renderCustomerForm },
];

let previousPath = null;

const router = createRouter(
  routes,
  (context) => {
    // Re-rendering the same screen with different filters replaces the whole
    // DOM, which would otherwise throw focus away on every search keystroke.
    // The id of the control in use is carried across so the view can put it
    // back; on a genuine screen change it is not.
    const sameScreen = context.path === previousPath;
    const activeId = sameScreen ? document.activeElement?.id || null : null;
    previousPath = context.path;

    context.view({ ...context, client, shell, restoreFocusId: activeId });
  },
  (context) => {
    previousPath = context.path;
    renderCustomerNotFound({ ...context, client, shell });
  },
);

router.start();

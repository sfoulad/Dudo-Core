/**
 * Hash routing.
 *
 * The hash is used rather than the History API because this application is
 * served as static assets and has to work behind any static host without a
 * rewrite rule, including a plain directory server. Every screen has its own
 * address, so a customer record can be linked to, bookmarked, opened in a new
 * tab and reached with the browser's own Back button.
 *
 * List state — the search term, the status filter, the Business filter and the
 * page cursor — lives in the address too. A person who filters, opens a record
 * and presses Back returns to the list they were looking at rather than to the
 * top of an unfiltered directory.
 */

/**
 * @typedef {{ pattern: string, view: Function }} Route
 */

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '') || '/customers';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = pathPart.replace(/\/+$/, '') || '/customers';
  const query = {};
  for (const [key, value] of new URLSearchParams(queryPart)) query[key] = value;
  return { path, query };
}

function match(pattern, path) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i];
    const actual = pathParts[i];
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export function buildHash(path, query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `#${path}${search ? `?${search}` : ''}`;
}

export function navigate(path, query = {}, { replace = false } = {}) {
  const hash = buildHash(path, query);
  if (replace) {
    window.history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = hash;
  }
}

/**
 * @param {Route[]} routes
 * @param {(context: {path: string, params: Object, query: Object, view: Function}) => void} render
 * @param {() => void} onMiss
 */
export function createRouter(routes, render, onMiss) {
  let current = null;

  function resolve() {
    const { path, query } = parseHash();
    for (const route of routes) {
      const params = match(route.pattern, path);
      if (params) {
        current = { path, params, query, view: route.view };
        render(current);
        return;
      }
    }
    onMiss({ path, query });
  }

  return {
    start() {
      window.addEventListener('hashchange', resolve);
      resolve();
    },
    get current() { return current; },
    refresh: resolve,
  };
}

/**
 * Hash routing.
 *
 * DELIBERATELY NOT A DEPENDENCY. This application has five routes, and a
 * router is roughly the code below. ADR 0016 approved React, Vite and Tailwind;
 * it did not approve a router, and every dependency is a supply-chain surface.
 * If the admin interface standardises on one, this is the file to replace —
 * it is small on purpose.
 *
 * The hash is used rather than the History API because the build is served as
 * static assets and must work behind any static host without a rewrite rule.
 * Every screen has its own address, so a customer record can be linked to,
 * bookmarked, opened in a new tab and reached with the browser's Back button.
 *
 * List state — search term, status filter, Business filter, page cursor —
 * lives in the address too. Someone who filters, opens a record and presses
 * Back returns to the list they were looking at.
 */

import { useSyncExternalStore } from 'react';

export interface RouteMatch {
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
}

function read(): RouteMatch {
  const raw = window.location.hash.replace(/^#/, '') || '/customers';
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const path = pathPart.replace(/\/+$/, '') || '/customers';
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryPart)) query[key] = value;
  return { path, params: {}, query };
}

let snapshot: RouteMatch = read();
const listeners = new Set<() => void>();

function refresh(): void {
  snapshot = read();
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', refresh);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): RouteMatch {
  return snapshot;
}

export function useLocation(): RouteMatch {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function buildHash(path: string, query: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return `#${path}${search ? `?${search}` : ''}`;
}

export function navigate(
  path: string,
  query: Record<string, string | undefined> = {},
  options: { replace?: boolean } = {},
): void {
  const hash = buildHash(path, query);
  if (hash === window.location.hash) return;
  if (options.replace) {
    window.history.replaceState(null, '', hash);
    refresh();
  } else {
    window.location.hash = hash;
  }
}

/**
 * Match a path pattern such as `/customers/:customer_id`.
 * Returns the extracted params, or null when the pattern does not apply.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

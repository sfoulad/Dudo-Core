/**
 * Hash routing.
 *
 * ===========================================================================
 * DELIBERATELY NOT A DEPENDENCY, AND ADR 0010 ASKED FOR THAT JUDGEMENT
 * ===========================================================================
 *
 * 0010 approved "TanStack Router, Query and Table — ONLY WHERE ACTUALLY
 * REQUIRED", and made the constraint explicit: "'Only where actually required'
 * is a constraint, not a preference. A TanStack package that earns its place
 * stays; one adopted because the template had it does not."
 *
 * This console has four sections, none of which takes a parameter, none of which
 * nests, and all of which currently render an empty state. TanStack Router would
 * bring a code-generation step, a route tree, a devtools package and a
 * dependency to keep current, to replace the eighty lines below. IT HAS NOT
 * EARNED ITS PLACE YET.
 *
 * WHERE IT WOULD: nested layouts, route-level data loading with pending and
 * error boundaries, search-parameter validation, or type-safe links across
 * dozens of routes. Those arrive with the real platform screens — the
 * Organization list has a cursor and a page size, and a record view will take an
 * identifier. THIS FILE IS SMALL ON PURPOSE SO THAT REPLACING IT IS A ONE-FILE
 * DECISION rather than an excavation, and that replacement is a Team Lead
 * question when the need is real, not a preference exercised now.
 *
 * THE HASH IS USED RATHER THAN THE HISTORY API because the build is served as
 * static assets and must work behind any static host without a rewrite rule.
 * Every section still has its own address, so it can be linked, bookmarked and
 * reached with the browser's Back button.
 */

import { useSyncExternalStore } from 'react';

export interface RouteMatch {
  readonly path: string;
  readonly query: Record<string, string>;
}

/**
 * The four sections, in navigation order, and the home route.
 *
 * `Organizations` is home because `platform-operator-v1` says so:
 * `platform.organizations.list` is "the console's home screen and the only way
 * an operator discovers what exists."
 */
export const ROUTES = {
  organizations: '/organizations',
  templates: '/templates',
  operators: '/operators',
  audit: '/audit',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

export const HOME_ROUTE: RoutePath = ROUTES.organizations;

const KNOWN_PATHS: readonly string[] = Object.values(ROUTES);

export function isKnownPath(path: string): path is RoutePath {
  return KNOWN_PATHS.includes(path);
}

function read(): RouteMatch {
  const raw = window.location.hash.replace(/^#/, '') || HOME_ROUTE;
  const [pathPart = '', queryPart = ''] = raw.split('?');
  const path = pathPart.replace(/\/+$/, '') || HOME_ROUTE;
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(queryPart)) query[key] = value;
  return { path, query };
}

let snapshot: RouteMatch = typeof window === 'undefined' ? { path: HOME_ROUTE, query: {} } : read();
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

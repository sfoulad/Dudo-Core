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

/**
 * The Organization detail page: `#/organizations/<organization_id>`.
 *
 * THE FIRST ROUTE IN THIS CONSOLE WITH A PATH PARAMETER, and the matcher below
 * is the smallest thing that serves one rather than a general pattern engine —
 * there is exactly one such route. If a second arrives, this is the file to
 * generalise, and it is small on purpose.
 *
 * THE IDENTIFIER IS TREATED AS OPAQUE. It is decoded from the hash and passed
 * through; it is never parsed, split, or interpreted. A value that is not a
 * plausible identifier is not "corrected" here — Core validates the segment
 * against the platform identifier grammar and answers the argument-free 404,
 * and a client that pre-judged it would be inventing a second, divergent rule
 * about what an identifier is.
 */
export function organizationDetailPath(organizationId: string): string {
  return `${ROUTES.organizations}/${encodeURIComponent(organizationId)}`;
}

/** `#/organizations/<id>/audit` — that Organization's own trail. */
export function organizationAuditPath(organizationId: string): string {
  return `${organizationDetailPath(organizationId)}/audit`;
}

/**
 * Returns the Organization id when `path` is that Organization's audit feed.
 *
 * EXACTLY THREE SEGMENTS, ending in `audit`. Matched BEFORE the two-segment
 * detail route by the caller, since a loose match would send `/organizations/x/audit`
 * to the detail screen and request an Organization named `x/audit`.
 */
export function matchOrganizationAudit(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length !== 3) return null;
  if (`/${segments[0] ?? ''}` !== ROUTES.organizations) return null;
  if (segments[2] !== 'audit') return null;
  const raw = segments[1];
  if (raw === undefined || raw === '') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * Returns the Organization id when `path` is a detail page, otherwise null.
 *
 * IT REQUIRES EXACTLY TWO SEGMENTS. `/organizations` is the list and
 * `/organizations/a/b` is nothing — matching loosely would send a malformed
 * address to a detail page that would then request a nonsense identifier and
 * spend an audit record learning it was nonsense.
 */
export function matchOrganizationDetail(path: string): string | null {
  const segments = path.split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  if (`/${segments[0] ?? ''}` !== ROUTES.organizations) return null;
  const raw = segments[1];
  if (raw === undefined || raw === '') return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    // A malformed percent-encoding. Not a detail page rather than a crash.
    return null;
  }
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

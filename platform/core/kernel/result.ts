/**
 * Result — the one way a Core operation reports success or failure.
 *
 * Domain and application code never throws to signal a business outcome. A thrown value
 * carries no declared error set, so an Action's `errors` list in the contract stops being
 * checkable and a caller cannot know what it may receive. Exceptions are reserved for
 * programming defects, which become `internal` at the boundary and are never reported to
 * a caller in detail (API_STANDARD.md §8).
 *
 * Erasable TypeScript only: no enums, no namespaces, no parameter properties. The
 * repository has no compiler and no build step approved (ADR 0003 approves TypeScript and
 * no npm package), so every module here must be runnable by a runtime that strips types.
 */

import type { CoreError } from './errors.ts';

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err = { readonly ok: false; readonly error: CoreError };
export type Result<T> = Ok<T> | Err;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err(error: CoreError): Err {
  return { ok: false, error };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

export function isErr<T>(result: Result<T>): result is Err {
  return !result.ok;
}

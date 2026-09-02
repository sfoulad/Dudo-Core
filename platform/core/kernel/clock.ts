/**
 * Time, as a port.
 *
 * Domain code never calls Date.now() directly. Two reasons, both practical:
 *
 * 1. Every timestamp Dudo writes or returns is RFC 3339, UTC, with an explicit offset
 *    (API_STANDARD.md §7). A single place that formats it is a single place to get it
 *    right, and the Customer Directory schema asserts the format with a pattern as well as
 *    a `format` keyword, so a bare local time fails the contract rather than passing
 *    quietly.
 * 2. The retention obligations the contract states — a 30-day recovery window, a purge
 *    predicate on `deletion_scheduled_at <= now` — are only testable if "now" can be
 *    moved. Those Actions are out of scope for this slice (contract §11.1), but the
 *    obligation is on the record and the port costs nothing now.
 *
 * A request reads the clock ONCE, at the start of the pipeline, and every timestamp
 * written by that request is that value. Two rows written by one operation that disagree
 * by a millisecond are two rows an operator has to reconcile by hand.
 *
 * `nowMs` exists alongside `now` because cursor signing needs an instant it can do
 * arithmetic on, and parsing the formatted string back into a number would be a second
 * place for the two representations to disagree.
 */

export type Clock = {
  /** The current instant, formatted RFC 3339 UTC with a `Z` offset and millisecond precision. */
  now(): string;
  /** The same instant, in epoch milliseconds. */
  nowMs(): number;
};

/** Formats an epoch-millisecond value as RFC 3339 UTC. `toISOString` emits exactly this shape. */
export function toRfc3339Utc(epochMilliseconds: number): string {
  return new Date(epochMilliseconds).toISOString();
}

export function createSystemClock(): Clock {
  return {
    now(): string {
      return toRfc3339Utc(Date.now());
    },
    nowMs(): number {
      return Date.now();
    },
  };
}

/** A clock fixed at one instant, for a caller that must write several rows with one time. */
export function createFixedClock(epochMilliseconds: number): Clock {
  return {
    now(): string {
      return toRfc3339Utc(epochMilliseconds);
    },
    nowMs(): number {
      return epochMilliseconds;
    },
  };
}

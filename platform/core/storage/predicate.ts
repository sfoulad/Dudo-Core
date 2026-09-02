/**
 * The predicate language the storage port accepts.
 *
 * WHY A PREDICATE LANGUAGE RATHER THAN SQL STRINGS.
 *
 * The storage port exposes no method that takes SQL. That is not stylistic. Under
 * docs/decisions/0006 Option A the tenant predicate is the only thing separating one
 * Organization's rows from another's, and a port that accepted `"SELECT ... WHERE ..."`
 * would be a port whose callers write their own WHERE clause — at which point the
 * predicate is applied by convention in N places instead of by construction in one.
 *
 * With a spec, the caller describes a narrowing and the boundary decides what SQL that
 * becomes. The boundary is then free to prepend the tenant predicate to every statement it
 * emits, and there is no syntax available to a caller that could remove it, shadow it, or
 * `OR` around it.
 *
 * It also satisfies CLOUDFLARE_STANDARD.md §2's harder half — "ports do not leak
 * Cloudflare semantics upward". Nothing in this file is true because D1 behaves a
 * particular way; it is a description of a narrowing over rows, and a non-SQL adapter
 * could serve it.
 *
 * ESCAPING. `startsWith`, `endsWith` and `contains` are string-matching operators, NOT
 * pattern operators. The value is matched literally: `%` and `_` in a caller's value mean
 * a per-cent sign and an underscore. The adapter escapes them (adapters/sql/sql-compiler.ts).
 * The Customer Directory contract requires exactly this — searchQuery: "'%' AND '_' ARE
 * LITERAL CHARACTERS, never wildcards ... A client cannot inject a matching pattern" — and
 * putting the guarantee in the operator's definition is what stops it being a call-site
 * habit.
 */

export type SqlValue = string | number | null;

export type Predicate =
  | { readonly kind: 'eq'; readonly column: string; readonly value: SqlValue }
  | { readonly kind: 'ne'; readonly column: string; readonly value: SqlValue }
  | { readonly kind: 'gt'; readonly column: string; readonly value: SqlValue }
  | { readonly kind: 'gte'; readonly column: string; readonly value: SqlValue }
  | { readonly kind: 'lt'; readonly column: string; readonly value: SqlValue }
  | { readonly kind: 'lte'; readonly column: string; readonly value: SqlValue }
  | { readonly kind: 'in'; readonly column: string; readonly values: readonly SqlValue[] }
  | { readonly kind: 'isNull'; readonly column: string }
  | { readonly kind: 'isNotNull'; readonly column: string }
  /** Literal string matching. The value is escaped; it is never a pattern. */
  | { readonly kind: 'startsWith'; readonly column: string; readonly value: string }
  | { readonly kind: 'endsWith'; readonly column: string; readonly value: string }
  | { readonly kind: 'contains'; readonly column: string; readonly value: string }
  | { readonly kind: 'and'; readonly operands: readonly Predicate[] }
  | { readonly kind: 'or'; readonly operands: readonly Predicate[] };

export function eq(column: string, value: SqlValue): Predicate {
  return { kind: 'eq', column, value };
}

export function ne(column: string, value: SqlValue): Predicate {
  return { kind: 'ne', column, value };
}

export function gt(column: string, value: SqlValue): Predicate {
  return { kind: 'gt', column, value };
}

export function gte(column: string, value: SqlValue): Predicate {
  return { kind: 'gte', column, value };
}

export function lt(column: string, value: SqlValue): Predicate {
  return { kind: 'lt', column, value };
}

export function lte(column: string, value: SqlValue): Predicate {
  return { kind: 'lte', column, value };
}

export function inList(column: string, values: readonly SqlValue[]): Predicate {
  return { kind: 'in', column, values };
}

export function isNull(column: string): Predicate {
  return { kind: 'isNull', column };
}

export function isNotNull(column: string): Predicate {
  return { kind: 'isNotNull', column };
}

export function startsWith(column: string, value: string): Predicate {
  return { kind: 'startsWith', column, value };
}

export function endsWith(column: string, value: string): Predicate {
  return { kind: 'endsWith', column, value };
}

export function contains(column: string, value: string): Predicate {
  return { kind: 'contains', column, value };
}

export function and(operands: readonly Predicate[]): Predicate {
  return { kind: 'and', operands };
}

export function or(operands: readonly Predicate[]): Predicate {
  return { kind: 'or', operands };
}

/** Every column a predicate touches, for the tenant-column guard in store.ts. */
export function columnsReferenced(predicate: Predicate): string[] {
  if (predicate.kind === 'and' || predicate.kind === 'or') {
    const collected: string[] = [];
    for (const operand of predicate.operands) {
      collected.push(...columnsReferenced(operand));
    }
    return collected;
  }
  return [predicate.column];
}

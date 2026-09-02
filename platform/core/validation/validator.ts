/**
 * Input validation. Zero dependencies, by necessity and by design.
 *
 * ADR 0003 approves no npm package, and ADR 0009's exception was narrow and specific — a
 * Phase 0 relation validator — so there is no JSON Schema implementation in this
 * repository (the contract schemas say so themselves: "NOT EXECUTED"). Contract shapes are
 * therefore transcribed into rules a small validator can execute, and the transcription is
 * a drift surface that qa-agent owns: a constraint present in
 * customer-directory-v1.schema.json and absent here is a contract defect of the same class
 * as cross-client drift.
 *
 * TWO PROPERTIES THIS FILE EXISTS TO GUARANTEE.
 *
 * 1. UNKNOWN FIELDS ARE REJECTED, NOT IGNORED (API_STANDARD.md §7, and
 *    `additionalProperties: false` on every input shape in the contract). This is not
 *    tidiness. It is the mechanism by which `tenant_id`, `organization_id`, `status`,
 *    `customer_id` on create, `deletion_scheduled_at` and `business_id` on update are
 *    UNSETTABLE rather than merely undocumented: they are not properties, so supplying one
 *    fails the request before any handler runs. A validator that ignored unknown fields
 *    would turn every one of those prohibitions into a comment.
 *
 * 2. A REJECTED VALUE IS NEVER ECHOED. `detail()` names the field and a stable issue token
 *    and has no parameter for the value (kernel/errors.ts). An error that quoted the input
 *    would put customer data into logs and support tickets, and the contract's audit rules
 *    call that out by name as a way personal data escapes the purge.
 *
 * ABSENT VERSUS NULL. `validateObject` returns the input's own known keys, so a caller can
 * distinguish "field absent" from "field present and null" with an ownership check. The
 * Customer Directory's partial update makes that distinction normative — absent means
 * unchanged, null means cleared — and the contract records why: both readings are
 * plausible, two clients will pick differently, and the failure is silent data loss in a
 * customer's records.
 */

import type { ErrorDetail } from '../kernel/errors.ts';
import { detail, invalidArgument } from '../kernel/errors.ts';
import type { Result } from '../kernel/result.ts';
import { err, ok } from '../kernel/result.ts';

export type PatternRule = {
  readonly pattern: RegExp;
  readonly issue: string;
};

export type FieldRule =
  | {
      readonly kind: 'string';
      readonly nullable?: boolean;
      readonly minLength?: number;
      readonly maxLength?: number;
      readonly patterns?: readonly PatternRule[];
    }
  | {
      readonly kind: 'enum';
      readonly nullable?: boolean;
      readonly values: readonly string[];
    }
  | {
      readonly kind: 'integer';
      readonly nullable?: boolean;
      readonly minimum?: number;
      readonly maximum?: number;
    };

export type ObjectRule = {
  readonly properties: Readonly<Record<string, FieldRule>>;
  readonly required: readonly string[];
  /** At least this many properties present. Used by partial update to reject a no-op. */
  readonly minProperties?: number;
};

export const ISSUE_UNKNOWN_FIELD = 'unknown_field';
export const ISSUE_REQUIRED = 'required';
export const ISSUE_MUST_BE_STRING = 'must_be_string';
export const ISSUE_MUST_BE_INTEGER = 'must_be_integer';
export const ISSUE_MUST_NOT_BE_NULL = 'must_not_be_null';
export const ISSUE_TOO_SHORT = 'too_short';
export const ISSUE_TOO_LONG = 'too_long';
export const ISSUE_TOO_SMALL = 'too_small';
export const ISSUE_TOO_LARGE = 'too_large';
export const ISSUE_NOT_A_PERMITTED_VALUE = 'not_a_permitted_value';
export const ISSUE_TOO_FEW_PROPERTIES = 'too_few_properties';
export const ISSUE_MUST_BE_AN_OBJECT = 'must_be_an_object';

function validateField(name: string, value: unknown, rule: FieldRule, details: ErrorDetail[]): void {
  if (value === null) {
    if (rule.nullable !== true) {
      details.push(detail(name, ISSUE_MUST_NOT_BE_NULL));
    }
    return;
  }

  if (rule.kind === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      details.push(detail(name, ISSUE_MUST_BE_INTEGER));
      return;
    }
    if (rule.minimum !== undefined && value < rule.minimum) {
      details.push(detail(name, ISSUE_TOO_SMALL));
    }
    if (rule.maximum !== undefined && value > rule.maximum) {
      details.push(detail(name, ISSUE_TOO_LARGE));
    }
    return;
  }

  if (typeof value !== 'string') {
    details.push(detail(name, ISSUE_MUST_BE_STRING));
    return;
  }

  if (rule.kind === 'enum') {
    if (!rule.values.includes(value)) {
      // The token names the constraint, not the rejected value. A client that sent
      // 'peson' learns that customer_type is not a permitted value, which is what it needs;
      // the log learns nothing about the customer.
      details.push(detail(name, ISSUE_NOT_A_PERMITTED_VALUE));
    }
    return;
  }

  // Length is counted in UTF-16 code units, matching JSON Schema's `minLength`/`maxLength`
  // as implemented by every validator in practice. A name of 200 astral characters would
  // count as 400 here. Stated rather than discovered: the alternative is counting code
  // points, which would disagree with the contract's own schema and put the web client and
  // the Apple client on different limits.
  if (rule.minLength !== undefined && value.length < rule.minLength) {
    details.push(detail(name, ISSUE_TOO_SHORT));
  }
  if (rule.maxLength !== undefined && value.length > rule.maxLength) {
    details.push(detail(name, ISSUE_TOO_LONG));
  }
  for (const patternRule of rule.patterns ?? []) {
    if (!patternRule.pattern.test(value)) {
      details.push(detail(name, patternRule.issue));
    }
  }
}

/**
 * Validates and returns only the declared properties that were actually present.
 *
 * The return value is a plain object created with `Object.create(null)` so that a property
 * named `__proto__` or `constructor` in the request body cannot reach a prototype. A
 * request body is attacker-controlled JSON; treating it as an ordinary object literal is
 * how prototype pollution gets in.
 */
export function validateObject(
  input: unknown,
  rule: ObjectRule,
): Result<Readonly<Record<string, unknown>>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return err(invalidArgument([detail('', ISSUE_MUST_BE_AN_OBJECT)]));
  }

  const details: ErrorDetail[] = [];
  const source = input as Record<string, unknown>;
  const presentKeys = Object.keys(source);

  // additionalProperties: false.
  for (const key of presentKeys) {
    if (!Object.prototype.hasOwnProperty.call(rule.properties, key)) {
      details.push(detail(key, ISSUE_UNKNOWN_FIELD));
    }
  }

  for (const name of rule.required) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) {
      details.push(detail(name, ISSUE_REQUIRED));
    }
  }

  const accepted: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(rule.properties)) {
    if (!Object.prototype.hasOwnProperty.call(source, name)) {
      continue;
    }
    const value = source[name];
    validateField(name, value, rule.properties[name], details);
    accepted[name] = value;
  }

  if (rule.minProperties !== undefined && presentKeys.length < rule.minProperties) {
    details.push(detail('', ISSUE_TOO_FEW_PROPERTIES));
  }

  if (details.length > 0) {
    return err(invalidArgument(details));
  }
  return ok(accepted);
}

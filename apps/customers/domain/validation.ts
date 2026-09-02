/**
 * The contract's input shapes, transcribed into rules the Core validator can execute.
 *
 * `customer-directory-v1.schema.json` is normative and is NOT EXECUTED — the schema file
 * says so itself: no JSON Schema implementation exists in this repository, ADR 0003
 * approves no npm package, and cross-file `urn:` `$ref`s need a resolver that does not
 * exist (AS1, ADR 0009). So the constraints are restated here in a form that runs.
 *
 * THAT TRANSCRIPTION IS A DRIFT SURFACE AND IT IS DECLARED AS ONE. A constraint present in
 * the schema and absent here is a contract defect of the same class as cross-client drift,
 * and it is qa-agent's to catch: the schema is the source, this file is a copy, and the two
 * must be checked against each other rather than trusted to agree. Every rule below cites
 * the `$defs` entry it comes from so the comparison is mechanical.
 *
 * WHAT MATTERS MOST IS WHAT IS ABSENT. Each `properties` map below is exhaustive and the
 * validator rejects anything not in it. That is the mechanism — not a comment, not a
 * review item — by which these are unsettable:
 *
 *   tenant_id, organization_id   nowhere, on any shape, in or out. None may be added.
 *   status                       server-controlled; moved only by the lifecycle Actions.
 *   customer_id (on create)      server-set.
 *   deletion_scheduled_at        server-set.
 *   created_/updated_by          server-set.
 *   business_id (on UPDATE)      changed only by MoveCustomerToBusiness. As a field on a
 *                                partial update it would be an unaudited re-assignment of a
 *                                customer's authorization scope under
 *                                `customers.customer.update`, which a business-scope
 *                                principal may hold — that principal could then push a
 *                                customer into a Business it does not control, or pull one
 *                                out of a Business it does.
 */

import type { FieldRule, ObjectRule } from '../../../platform/core/validation/validator.ts';

/** `$defs/customerId` and `$defs/businessId`. Both `^[A-Za-z0-9_-]{8,64}$`. */
const OPAQUE_ID: FieldRule = {
  kind: 'string',
  patterns: [{ pattern: /^[A-Za-z0-9_-]{8,64}$/, issue: 'invalid_identifier' }],
};

/** `$defs/displayName`. The `\S` pattern is what rejects a value that is empty once trimmed. */
const DISPLAY_NAME: FieldRule = {
  kind: 'string',
  minLength: 1,
  maxLength: 200,
  patterns: [{ pattern: /\S/, issue: 'must_not_be_blank' }],
};

/** `$defs/customerType`. Lowercase string enumeration, never an integer. */
const CUSTOMER_TYPE: FieldRule = { kind: 'enum', values: ['person', 'company'] };

/**
 * `$defs/email`. Deliberately permissive: it rejects the obviously malformed and nothing
 * else. Dudo does not validate RFC 5322, does not resolve the domain, and does not verify
 * deliverability — a contract implying otherwise would be lying to both clients.
 */
const EMAIL: FieldRule = {
  kind: 'string',
  nullable: true,
  minLength: 3,
  maxLength: 254,
  patterns: [{ pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, issue: 'invalid_format' }],
};

/**
 * `$defs/phone`, whose `allOf` is two separate patterns and is transcribed as two, because
 * they fail for different reasons and a client deserves to know which.
 *
 * E.164 is NOT required: requiring it would reject the majority of real imported directory
 * data on the first day. The consequence is stated rather than hidden — this field is not
 * dial-safe and no code may assume it parses into a callable number.
 */
const PHONE: FieldRule = {
  kind: 'string',
  nullable: true,
  minLength: 3,
  maxLength: 32,
  patterns: [
    { pattern: /^[0-9+()\-. ]+$/, issue: 'invalid_characters' },
    // At least three digits somewhere. '()-' satisfies the character set and is not a
    // telephone number.
    { pattern: /([0-9][^0-9]*){3,}/, issue: 'too_few_digits' },
  ],
};

/**
 * `$defs/country`. WELL-FORMEDNESS ONLY: no code list is validated against, because no such
 * list exists in this repository and adding one is a dependency decision nobody has made.
 * A well-formed but unassigned code such as `ZZ` is accepted and stored.
 */
const COUNTRY: FieldRule = {
  kind: 'string',
  nullable: true,
  patterns: [{ pattern: /^[A-Z]{2}$/, issue: 'invalid_format' }],
};

const ADDRESS: FieldRule = {
  kind: 'string',
  nullable: true,
  minLength: 1,
  maxLength: 500,
  patterns: [{ pattern: /\S/, issue: 'must_not_be_blank' }],
};

const NOTES: FieldRule = { kind: 'string', nullable: true, maxLength: 2000 };

/** `$defs/statusFilter`. `all` includes `pending_deletion`. */
const STATUS_FILTER: FieldRule = {
  kind: 'enum',
  values: ['active', 'archived', 'pending_deletion', 'all'],
};

/**
 * `$defs/searchQuery`. Minimum 2 characters after trimming: a one-character query matches a
 * large fraction of any directory and costs a scan to say so on a single-threaded shared
 * database.
 */
const SEARCH_QUERY: FieldRule = {
  kind: 'string',
  minLength: 2,
  maxLength: 128,
  patterns: [{ pattern: /\S/, issue: 'must_not_be_blank' }],
};

/** `urn:dudo:schema:pagination:1#/$defs/pageSize`. Documented default 25, maximum 100. */
const PAGE_SIZE: FieldRule = { kind: 'integer', minimum: 1, maximum: 100 };

/** `urn:dudo:schema:pagination:1#/$defs/cursor`. */
const CURSOR: FieldRule = {
  kind: 'string',
  patterns: [{ pattern: /^[A-Za-z0-9_-]{1,512}$/, issue: 'invalid_cursor' }],
};

export const CREATE_CUSTOMER_RULE: ObjectRule = {
  required: ['business_id', 'display_name', 'customer_type'],
  properties: {
    business_id: OPAQUE_ID,
    display_name: DISPLAY_NAME,
    customer_type: CUSTOMER_TYPE,
    email: EMAIL,
    phone: PHONE,
    country: COUNTRY,
    address: ADDRESS,
    notes: NOTES,
  },
};

export const GET_CUSTOMER_RULE: ObjectRule = {
  required: ['customer_id'],
  properties: { customer_id: OPAQUE_ID },
};

export const LIST_CUSTOMERS_RULE: ObjectRule = {
  required: [],
  properties: {
    business_id: OPAQUE_ID,
    status: STATUS_FILTER,
    page_size: PAGE_SIZE,
    cursor: CURSOR,
  },
};

export const SEARCH_CUSTOMERS_RULE: ObjectRule = {
  required: ['query'],
  properties: {
    query: SEARCH_QUERY,
    business_id: OPAQUE_ID,
    status: STATUS_FILTER,
    page_size: PAGE_SIZE,
    cursor: CURSOR,
  },
};

/**
 * `$defs/updateCustomerInput`. `minProperties: 2` requires at least one field besides
 * `customer_id`: "An update that changes nothing still writes an audit record and moves
 * updated_at, so it is rejected as invalid_argument rather than accepted as a no-op that
 * pollutes the audit trail."
 *
 * `display_name` and `customer_type` are required ON THE RECORD, so on a partial update
 * they may be present-with-a-value or absent, never null — hence no `nullable` on either.
 */
export const UPDATE_CUSTOMER_RULE: ObjectRule = {
  required: ['customer_id'],
  minProperties: 2,
  properties: {
    customer_id: OPAQUE_ID,
    display_name: DISPLAY_NAME,
    customer_type: CUSTOMER_TYPE,
    email: EMAIL,
    phone: PHONE,
    country: COUNTRY,
    address: ADDRESS,
    notes: NOTES,
  },
};

export const ARCHIVE_CUSTOMER_RULE: ObjectRule = {
  required: ['customer_id'],
  properties: { customer_id: OPAQUE_ID },
};

export const RESTORE_CUSTOMER_RULE: ObjectRule = {
  required: ['customer_id'],
  properties: { customer_id: OPAQUE_ID },
};

/**
 * `$defs/moveCustomerToBusinessInput`. THERE IS NO SOURCE BUSINESS PARAMETER, deliberately:
 * the source is whatever the record currently says, read inside the tenant. Accepting one
 * would let a caller assert a state it does not know and would make the audit record a copy
 * of the caller's claim rather than of what happened.
 */
export const MOVE_CUSTOMER_RULE: ObjectRule = {
  required: ['customer_id', 'business_id'],
  properties: {
    customer_id: OPAQUE_ID,
    business_id: OPAQUE_ID,
  },
};

/** The mutable field names, for the update audit record. NAMES, never values. */
export const UPDATABLE_FIELD_NAMES: readonly string[] = [
  'display_name',
  'customer_type',
  'email',
  'phone',
  'country',
  'address',
  'notes',
];

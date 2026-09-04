/**
 * Field rules, transcribed from the contract.
 *
 * SOURCE OF TRUTH:
 *   packages/contracts/apps/customers/customer-directory-v1.schema.json
 *   packages/contracts/apps/customers/customer-directory-v1.contract.yaml
 *   packages/contracts/apps/customers/README.md §4
 *
 * This file is a CLIENT-SIDE COPY of the schema's shape constraints, kept here
 * so a person filling in a form is told about a problem before they submit it.
 * It is presentation, never authority:
 *
 *   - The server validates every request again and its answer wins. A field
 *     this file accepts and the server rejects is rendered from the server's
 *     error envelope, not argued with.
 *   - No business rule lives here. These are lengths, character classes and
 *     required-ness — the things the schema states — and nothing about
 *     pricing, entitlement, permission or lifecycle.
 *   - If this file and the schema ever disagree, the schema is right and this
 *     file is a defect.
 *
 * The Apple client consumes the same schema. Any change here that is not a
 * transcription of a change there is cross-client drift.
 */

/** Wire-shape limits, straight from the schema's $defs. */
export const LIMITS = Object.freeze({
  display_name: { min: 1, max: 200 },
  email: { min: 3, max: 254 },
  phone: { min: 3, max: 32 },
  country: { min: 2, max: 2 },
  address: { min: 1, max: 500 },
  notes: { min: 0, max: 2000 },
  search_query: { min: 2, max: 128 },
});

export const CUSTOMER_TYPES = Object.freeze(['person', 'company']);
export const CUSTOMER_STATUSES = Object.freeze(['active', 'archived', 'pending_deletion']);
export const STATUS_FILTERS = Object.freeze(['active', 'archived', 'pending_deletion', 'all']);

export const PAGE_SIZE_DEFAULT = 25;
export const PAGE_SIZE_MAX = 100;

/** The fifteen fields of the full record, in the order the detail view shows them. */
export const CUSTOMER_FIELDS = Object.freeze([
  'customer_id', 'business_id', 'display_name', 'customer_type', 'email', 'phone',
  'country', 'address', 'notes', 'status', 'deletion_scheduled_at',
  'created_at', 'created_by_principal_id', 'updated_at', 'updated_by_principal_id',
]);

/** The nine fields a client may write, across create and update. */
export const EDITABLE_FIELDS = Object.freeze([
  'display_name', 'customer_type', 'email', 'phone', 'country', 'address', 'notes',
]);

const PATTERNS = Object.freeze({
  opaqueId: /^[A-Za-z0-9_-]{8,64}$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  phoneCharset: /^[0-9+()\-. ]+$/,
  phoneDigits: /([0-9][^0-9]*){3,}/,
  country: /^[A-Z]{2}$/,
  nonBlank: /\S/,
});

/**
 * Issue tokens use the same vocabulary as the error envelope's
 * `details[].issue` (`^[a-z][a-z0-9_]*$`) so a client-side finding and a
 * server-side one render through one code path.
 */
function issue(field, token) {
  return { field, issue: token };
}

/**
 * Validate one editable field.
 *
 * @param {string} field
 * @param {string|null} value - the trimmed wire value, or null for "not recorded"
 * @param {{ required?: boolean }} [opts]
 * @returns {{field: string, issue: string}|null}
 */
export function validateField(field, value, opts = {}) {
  const required = Boolean(opts.required);

  if (value === null || value === undefined || value === '') {
    return required ? issue(field, 'required') : null;
  }
  if (typeof value !== 'string') return issue(field, 'invalid_type');

  switch (field) {
    case 'display_name':
      if (!PATTERNS.nonBlank.test(value)) return issue(field, 'must_not_be_blank');
      if (value.length > LIMITS.display_name.max) return issue(field, 'too_long');
      return null;

    case 'customer_type':
      return CUSTOMER_TYPES.includes(value) ? null : issue(field, 'not_a_permitted_value');

    case 'email':
      if (value.length < LIMITS.email.min) return issue(field, 'too_short');
      if (value.length > LIMITS.email.max) return issue(field, 'too_long');
      return PATTERNS.email.test(value) ? null : issue(field, 'invalid_format');

    case 'phone':
      if (value.length < LIMITS.phone.min) return issue(field, 'too_short');
      if (value.length > LIMITS.phone.max) return issue(field, 'too_long');
      if (!PATTERNS.phoneCharset.test(value)) return issue(field, 'invalid_characters');
      return PATTERNS.phoneDigits.test(value) ? null : issue(field, 'not_enough_digits');

    case 'country':
      return PATTERNS.country.test(value) ? null : issue(field, 'invalid_format');

    case 'address':
      if (!PATTERNS.nonBlank.test(value)) return issue(field, 'must_not_be_blank');
      if (value.length > LIMITS.address.max) return issue(field, 'too_long');
      return null;

    case 'notes':
      return value.length > LIMITS.notes.max ? issue(field, 'too_long') : null;

    case 'business_id':
      return PATTERNS.opaqueId.test(value) ? null : issue(field, 'invalid_format');

    case 'customer_id':
      return PATTERNS.opaqueId.test(value) ? null : issue(field, 'invalid_format');

    default:
      return null;
  }
}

export function validateSearchQuery(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length === 0) return null; // an empty box is "not searching", not an error
  if (trimmed.length < LIMITS.search_query.min) return issue('query', 'too_short');
  if (trimmed.length > LIMITS.search_query.max) return issue('query', 'too_long');
  return null;
}

/**
 * Human wording for an issue token. The server's own `message` is preferred
 * wherever one is present; this is the fallback for client-side findings and
 * for tokens rendered against a specific field.
 */
const ISSUE_TEXT = Object.freeze({
  required: 'This is required.',
  must_not_be_blank: 'Enter something other than spaces.',
  too_short: 'This is too short.',
  too_long: 'This is longer than the maximum.',
  invalid_format: 'This is not in a format Dudo accepts.',
  invalid_characters: 'Use digits and + ( ) - . and spaces only.',
  not_enough_digits: 'A phone number needs at least three digits.',
  not_a_permitted_value: 'Choose one of the listed options.',
  invalid_type: 'This value is not the right kind of data.',
  unknown_field: 'Dudo does not accept this field.',
});

export function issueText(token, field) {
  if (token === 'too_long' && LIMITS[field]) {
    return `Keep this to ${LIMITS[field].max} characters or fewer.`;
  }
  if (token === 'too_short' && field === 'query') {
    return `Type at least ${LIMITS.search_query.min} characters to search.`;
  }
  return ISSUE_TEXT[token] || 'This value was not accepted.';
}

/**
 * Normalisation, per README.md §7.2 — NFC, locale-independent lowercasing,
 * trimmed, internal whitespace runs collapsed. Applied identically to a query
 * and to a stored value before matching, and used for the directory's sort key.
 *
 * NO ACCENT FOLDING AND NO TRANSLITERATION, deliberately: `Muller` does not
 * match `Müller`. That is a stated contract limitation (CD-6), not an omission
 * to be quietly fixed in a client.
 */
export function normalise(value) {
  return String(value ?? '').normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Reduce a phone value to its digit sequence, as the phone search rule requires. */
export function digitsOf(value) {
  return String(value ?? '').replace(/\D+/g, '');
}

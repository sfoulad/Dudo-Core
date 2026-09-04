/**
 * Field rules, transcribed from the contract schema.
 *
 * This is a CLIENT-SIDE COPY of the schema's shape constraints, kept so a
 * person filling in a form is told about a problem before they submit it. It is
 * presentation, never authority:
 *
 *   - The server validates every request again and its answer wins. A field
 *     this file accepts and the server rejects is rendered from the server's
 *     error envelope, not argued with.
 *   - No business rule lives here. These are lengths, character classes and
 *     required-ness — the things the schema states — and nothing about pricing,
 *     entitlement, permission or lifecycle.
 *   - If this file and the schema disagree, the schema is right and this file
 *     is the defect.
 */

import { CUSTOMER_TYPES, type CustomerType } from './customer-directory';

export const LIMITS = {
  display_name: { min: 1, max: 200 },
  email: { min: 3, max: 254 },
  phone: { min: 3, max: 32 },
  country: { min: 2, max: 2 },
  address: { min: 1, max: 500 },
  notes: { min: 0, max: 2000 },
  search_query: { min: 2, max: 128 },
} as const;

const PATTERNS = {
  opaqueId: /^[A-Za-z0-9_-]{8,64}$/,
  email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
  phoneCharset: /^[0-9+()\-. ]+$/,
  phoneDigits: /([0-9][^0-9]*){3,}/,
  country: /^[A-Z]{2}$/,
  nonBlank: /\S/,
} as const;

/**
 * Issue tokens use the same vocabulary as the error envelope's
 * `details[].issue` (`^[a-z][a-z0-9_]*$`), so a client-side finding and a
 * server-side one render through one code path.
 */
export interface FieldIssue {
  field: string;
  issue: string;
}

function issue(field: string, token: string): FieldIssue {
  return { field, issue: token };
}

export function validateField(
  field: string,
  value: string | null | undefined,
  opts: { required?: boolean } = {},
): FieldIssue | null {
  const required = Boolean(opts.required);

  if (value === null || value === undefined || value === '') {
    return required ? issue(field, 'required') : null;
  }

  switch (field) {
    case 'display_name':
      if (!PATTERNS.nonBlank.test(value)) return issue(field, 'must_not_be_blank');
      if (value.length > LIMITS.display_name.max) return issue(field, 'too_long');
      return null;

    case 'customer_type':
      return (CUSTOMER_TYPES as readonly string[]).includes(value)
        ? null
        : issue(field, 'not_a_permitted_value');

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
    case 'customer_id':
      return PATTERNS.opaqueId.test(value) ? null : issue(field, 'invalid_format');

    default:
      return null;
  }
}

export function isCustomerType(value: string): value is CustomerType {
  return (CUSTOMER_TYPES as readonly string[]).includes(value);
}

const ISSUE_TEXT: Record<string, string> = {
  required: 'This is required.',
  must_not_be_blank: 'Enter something other than spaces.',
  too_short: 'This is too short.',
  too_long: 'This is longer than the maximum.',
  invalid_format: 'This is not in a format Dudo accepts.',
  invalid_characters: 'Use digits and + ( ) - . and spaces only.',
  not_enough_digits: 'A phone number needs at least three digits.',
  not_a_permitted_value: 'Choose one of the listed options.',
  invalid_cursor: 'That page is no longer valid. Start from the first page.',
  no_fields_to_update: 'Change at least one field before saving.',
  out_of_range: 'That value is outside the permitted range.',
  unknown_field: 'Dudo does not accept this field.',
};

export function issueText(token: string, field?: string): string {
  if (token === 'too_long' && field && field in LIMITS) {
    const limit = LIMITS[field as keyof typeof LIMITS];
    return `Keep this to ${limit.max} characters or fewer.`;
  }
  if (token === 'too_short' && field === 'query') {
    return `Type at least ${LIMITS.search_query.min} characters to search.`;
  }
  return ISSUE_TEXT[token] ?? 'This value was not accepted.';
}

/**
 * Normalisation, per README §7.2 — NFC, locale-independent lowercasing,
 * trimmed, internal whitespace runs collapsed. Applied identically to a query
 * and to a stored value before matching, and used as the directory sort key.
 *
 * NO ACCENT FOLDING AND NO TRANSLITERATION, deliberately: `Muller` does not
 * match `Müller`. That is a stated contract limitation (CD-6), not an omission
 * for a client to quietly fix.
 */
export function normalise(value: string | null | undefined): string {
  return String(value ?? '').normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Reduce a phone value to its digit sequence, as the phone search rule requires. */
export function digitsOf(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D+/g, '');
}

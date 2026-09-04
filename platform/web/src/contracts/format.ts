/**
 * Presentation formatting. No business rule and no derived business value.
 *
 * In particular this file never computes `deletion_scheduled_at`. The contract
 * returns that date precisely so two clients cannot compute two different
 * answers for one legally meaningful deadline (README §6). Here it is only
 * formatted.
 */

import type { CustomerStatus, CustomerType } from './customer-directory';

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function formatTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormat.format(date);
}

export function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateFormat.format(date);
}

export function humanise(token: string): string {
  if (!token) return '';
  return token.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

const STATUS_LABEL: Record<CustomerStatus, string> = {
  active: 'Active',
  archived: 'Archived',
  pending_deletion: 'Pending deletion',
};

/**
 * A status this client has never seen must render as itself rather than crash.
 * Contract §11.1 requires exactly that tolerance, which is why the lookup falls
 * back to a formatted token instead of throwing or returning undefined.
 */
export function statusLabel(status: string): string {
  return STATUS_LABEL[status as CustomerStatus] ?? humanise(status);
}

const TYPE_LABEL: Record<CustomerType, string> = {
  person: 'Person',
  company: 'Company',
};

export function typeLabel(type: string): string {
  return TYPE_LABEL[type as CustomerType] ?? humanise(type);
}

/**
 * ISO 3166-1 alpha-2 to a country name where the browser can do it.
 *
 * The contract validates well-formedness only and stores unassigned codes such
 * as `ZZ`, so the code is always shown and a name is added only when one
 * resolves.
 */
let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(undefined, { type: 'region' });
} catch {
  regionNames = null;
}

export function countryLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  if (!regionNames) return code;
  try {
    const name = regionNames.of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

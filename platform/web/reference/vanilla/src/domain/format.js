/**
 * Presentation formatting. No business rule and no derived business value.
 *
 * In particular this file never computes `deletion_scheduled_at`. The contract
 * returns that date precisely so that two clients cannot compute two different
 * answers for one legally meaningful deadline (README.md §6). Here it is only
 * formatted.
 */

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit',
});

const dateFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'long', day: 'numeric',
});

/** RFC 3339 timestamp -> a readable local date and time. */
export function formatTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateTimeFormat.format(date);
}

export function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return dateFormat.format(date);
}

const STATUS_LABEL = Object.freeze({
  active: 'Active',
  archived: 'Archived',
  pending_deletion: 'Pending deletion',
});

/**
 * A status the client has never seen must render as itself rather than crash —
 * contract §11.1 requires exactly this tolerance, and it is why the fallback
 * is a formatted token and not a thrown error.
 */
export function statusLabel(status) {
  return STATUS_LABEL[status] || humanise(status);
}

export function statusModifier(status) {
  switch (status) {
    case 'active': return 'badge--active';
    case 'archived': return 'badge--archived';
    case 'pending_deletion': return 'badge--pending';
    default: return 'badge--unknown';
  }
}

const TYPE_LABEL = Object.freeze({ person: 'Person', company: 'Company' });

export function typeLabel(type) {
  return TYPE_LABEL[type] || humanise(type);
}

export function typeModifier(type) {
  return type === 'company' ? 'tag--company' : type === 'person' ? 'tag--person' : '';
}

export function humanise(token) {
  if (!token) return '';
  return String(token).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * ISO 3166-1 alpha-2 to a country name, where the browser can do it.
 *
 * The contract validates well-formedness only and stores unassigned codes such
 * as `ZZ` (schema $defs.country). So the code is always shown, and a name is
 * added only when one resolves.
 */
let regionNames = null;
try {
  regionNames = new Intl.DisplayNames(undefined, { type: 'region' });
} catch {
  regionNames = null;
}

export function countryLabel(code) {
  if (!code) return null;
  if (!regionNames) return code;
  try {
    const name = regionNames.of(code);
    return name && name !== code ? `${name} (${code})` : code;
  } catch {
    return code;
  }
}

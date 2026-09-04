/**
 * Small pieces shared by more than one screen.
 *
 * Loading, empty and error are treated as first-class screens rather than as
 * afterthoughts: each one says what happened, what it means, and what the
 * person can do next.
 */

import { el, iconGlyph } from '../dom.js';
import { statusLabel, statusModifier, typeLabel, typeModifier } from '../domain/format.js';
import { errorTitle, errorBody, isRetryable } from '../api/errors.js';

export function statusBadge(status) {
  return el('span', { class: `badge ${statusModifier(status)}` },
    el('span', { text: statusLabel(status) }));
}

export function typeTag(type) {
  return el('span', { class: `tag ${typeModifier(type)}`, text: typeLabel(type) });
}

/** A skeleton that matches the directory's column rhythm. */
export function loadingRows(count = 6) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push(el('div', { class: 'skeleton-row' },
      el('span', { class: 'skeleton', style: 'width: 70%' }),
      el('span', { class: 'skeleton', style: 'width: 50%' }),
      el('span', { class: 'skeleton', style: 'width: 85%' }),
      el('span', { class: 'skeleton', style: 'width: 60%' }),
      el('span', { class: 'skeleton', style: 'width: 45%' })));
  }
  return el('div', { class: 'panel panel--attached', 'aria-hidden': 'true' }, rows);
}

/**
 * @param {{ glyph?: string, title: string, body?: string|Node, actions?: Node[],
 *           tone?: 'default'|'error', note?: string }} options
 */
export function stateBlock({ glyph = '·', title, body, actions = [], tone = 'default', note }) {
  return el('div', { class: `state${tone === 'error' ? ' state--error' : ''}` },
    iconGlyph(glyph),
    el('p', { class: 'state__title', text: title }),
    body ? (typeof body === 'string' ? el('p', { class: 'state__body', text: body }) : body) : null,
    actions.length ? el('div', { class: 'state__actions' }, actions) : null,
    note ? el('p', { class: 'state__code', text: note }) : null);
}

/**
 * The one place an ApiError becomes something a person reads.
 *
 * The developer-facing `message` from the envelope is shown as a supporting
 * line and the `request_id` is shown verbatim, because that identifier is what
 * makes a support conversation possible without anyone having to share the
 * data involved.
 */
export function errorBlock(error, { onRetry, retryLabel = 'Try again', extraActions = [] } = {}) {
  const actions = [...extraActions];
  if (onRetry && isRetryable(error)) {
    actions.unshift(el('button', {
      class: 'btn btn--primary',
      type: 'button',
      text: retryLabel,
      on: { click: onRetry },
    }));
  }

  const body = el('div', { class: 'state__body' },
    el('p', { text: errorBody(error) }),
    error?.message && error.message !== errorBody(error)
      ? el('p', { class: 'state__code', text: error.message })
      : null);

  return stateBlock({
    glyph: '!',
    tone: 'error',
    title: errorTitle(error),
    body,
    actions,
    note: error?.request_id ? `Reference ${error.request_id}` : null,
  });
}

export function spinnerButton(label) {
  return [el('span', { class: 'btn__spinner', 'aria-hidden': 'true' }), label];
}

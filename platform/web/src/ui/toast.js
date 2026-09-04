/**
 * Transient confirmations and failures.
 *
 * The region is a polite live region, so a screen reader announces "Customer
 * archived" without stealing focus from wherever the person is. A toast is
 * never the only place a result appears: archiving also re-renders the record
 * with its new status, so a missed toast loses nothing.
 */

import { el, clear } from '../dom.js';

let region = null;

export function createToastRegion() {
  region = el('div', {
    class: 'toasts',
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'false',
  });
  return region;
}

/**
 * @param {string} message
 * @param {{ tone?: 'default'|'error', duration?: number }} [options]
 */
export function toast(message, { tone = 'default', duration = 5000 } = {}) {
  if (!region) return;

  const node = el('div', { class: `toast${tone === 'error' ? ' toast--error' : ''}` },
    el('span', { class: 'toast__text', text: message }),
    el('button', {
      class: 'toast__close',
      type: 'button',
      'aria-label': 'Dismiss this message',
      on: { click: () => node.remove() },
    }, '×'));

  region.appendChild(node);

  if (duration > 0) {
    window.setTimeout(() => node.remove(), duration);
  }
}

export function clearToasts() {
  if (region) clear(region);
}

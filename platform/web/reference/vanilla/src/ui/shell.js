/**
 * The application shell: the bar that carries the Dudo identity, the busy
 * indicator, the region views render into, and the footer that says plainly
 * what this build is.
 */

import { el, mount, clear } from '../dom.js';
import { createToastRegion } from './toast.js';

export function createShell(root) {
  const progress = el('div', { class: 'progress', dataset: { busy: 'false' } });

  const main = el('main', {
    class: 'main',
    id: 'main',
    tabindex: '-1',
    'aria-busy': 'false',
  });

  const brandMark = el('img', {
    class: 'brand__mark',
    src: 'assets/dudo-mark.svg',
    alt: '',
    width: '28',
    height: '28',
  });

  const topbar = el('header', { class: 'topbar' },
    el('div', { class: 'topbar__inner' },
      el('a', { class: 'brand', href: '#/customers' },
        brandMark,
        el('span', { class: 'brand__name', text: 'Dudo' }),
        el('span', { class: 'brand__sub', text: 'Customers' })),
      el('div', { class: 'topbar__spacer' }),
      el('span', { class: 'env-chip', text: 'Fixture data' })));

  const footer = el('footer', { class: 'app-foot' },
    el('div', { class: 'app-foot__inner' },
      el('span', { text: 'Dudo — Customer Directory' }),
      el('span', { text: 'Contract customer-directory-v1' }),
      el('span', { text: 'Local fixture build. No server, no network calls, synthetic data only.' })));

  mount(root, topbar, progress, main, footer, createToastRegion());
  root.dataset.state = 'ready';

  return {
    main,

    setBusy(busy) {
      progress.dataset.busy = busy ? 'true' : 'false';
      main.setAttribute('aria-busy', busy ? 'true' : 'false');
    },

    /**
     * Replace the view and set the document title.
     *
     * Focus moves to the main region on a route change so that keyboard and
     * screen-reader users land on the new screen instead of staying wherever
     * the previous screen's DOM used to be. `preserveFocus` is passed when a
     * view re-renders itself in place — a search keystroke must not pull focus
     * out of the search box.
     */
    render(node, { title, preserveFocus = false } = {}) {
      mount(this.main, node);
      if (title) document.title = `${title} · Dudo`;
      if (!preserveFocus) {
        this.main.focus({ preventScroll: false });
        window.scrollTo({ top: 0, behavior: 'auto' });
      }
    },

    clear() { clear(this.main); },
  };
}

/**
 * One customer's full record — all fifteen fields.
 *
 * WHAT IS NOT ON THIS SCREEN, AND WHY. There is no Delete control and no
 * "cancel deletion" control. DeleteCustomer and RestoreDeletedCustomer are
 * contracted and deliberately out of scope for this slice (contract §11.1), so
 * the platform would refuse them. An interface that offers an action the
 * platform refuses is worse than one that omits it, and their absence here is
 * the decision rather than an oversight.
 *
 * The archive and restore controls follow the state machine exactly:
 * archive is offered only from `active`, restore only from `archived`, and
 * `pending_deletion` — a state nothing in this slice can produce — is rendered
 * as a read-only record with its deadline, because a client must tolerate a
 * status it will never see rather than crash on it.
 *
 * Whether a person may actually perform either action is decided by Core on
 * the call. Hiding a button is presentation, never security.
 */

import { el } from '../dom.js';
import { navigate } from '../router.js';
import { statusBadge, typeTag, stateBlock, errorBlock, spinnerButton } from '../ui/components.js';
import { formatTimestamp, formatDate, statusLabel, countryLabel } from '../domain/format.js';
import { isApiError } from '../api/errors.js';
import { toast } from '../ui/toast.js';
import { getLastListHash } from './list-state.js';

export function renderCustomerDetail(ctx) {
  const { client, shell, params } = ctx;
  const customerId = params.customer_id;

  const container = el('div', {});
  shell.render(container, { title: 'Customer' });

  load();

  async function load() {
    container.replaceChildren(el('div', { class: 'state' },
      el('span', { class: 'skeleton', style: 'width: 14rem; height: 1.5rem' })));
    shell.setBusy(true);

    try {
      const customer = await client.getCustomer(customerId);
      draw(customer);
    } catch (thrown) {
      const error = isApiError(thrown) ? thrown : null;
      container.replaceChildren(
        backLink(),
        el('div', { class: 'panel' }, errorBlock(error || { code: 'internal' }, {
          onRetry: load,
          extraActions: [el('a', {
            class: 'btn btn--secondary',
            href: getLastListHash(),
          }, 'Back to customers')],
        })));
      document.title = 'Customer not available · Dudo';
    } finally {
      shell.setBusy(false);
    }
  }

  function draw(customer) {
    document.title = `${customer.display_name} · Dudo`;
    container.replaceChildren(
      backLink(),
      header(customer),
      ...notices(customer),
      sections(customer));
  }

  function backLink() {
    return el('a', { class: 'backlink', href: getLastListHash(), text: 'Customers' });
  }

  function header(customer) {
    const actionBar = el('div', { class: 'record-actions' });
    fillActions(actionBar, customer);

    return el('div', { class: 'record-head' },
      el('div', { class: 'page-head__text' },
        el('h1', { class: 'page-title', text: customer.display_name }),
        el('div', { class: 'record-head__meta' },
          statusBadge(customer.status),
          typeTag(customer.customer_type),
          el('span', { class: 'cell-muted', text: businessName(customer.business_id) }))),
      actionBar);
  }

  /**
   * The action bar is rebuilt rather than toggled, because which controls are
   * legal is a function of the record's state and nothing else.
   */
  function fillActions(bar, customer) {
    bar.replaceChildren();

    if (customer.status === 'active') {
      bar.append(
        el('a', {
          class: 'btn btn--secondary',
          href: `#/customers/${encodeURIComponent(customer.customer_id)}/edit`,
        }, 'Edit'),
        el('button', {
          class: 'btn btn--secondary',
          type: 'button',
          text: 'Archive',
          on: { click: () => confirmArchive(bar, customer) },
        }));
      return;
    }

    if (customer.status === 'archived') {
      bar.append(el('button', {
        class: 'btn btn--primary',
        type: 'button',
        text: 'Restore',
        on: { click: (event) => runTransition(event.currentTarget, bar, customer, 'restore') },
      }));
      return;
    }

    // pending_deletion, or any status this client has not been taught. No
    // action is offered, because none of the ones this slice implements is
    // legal from here.
  }

  /**
   * Archiving withdraws a customer from every default list, so it takes a
   * deliberate second press. The confirmation happens in place rather than in
   * a dialog: nothing is trapped, Escape and the Cancel button both back out,
   * and focus is moved to the confirming control so a keyboard user is not
   * left pressing a button that has moved.
   */
  function confirmArchive(bar, customer) {
    bar.replaceChildren();

    const confirm = el('button', {
      class: 'btn btn--primary',
      type: 'button',
      text: 'Yes, archive',
      on: { click: (event) => runTransition(event.currentTarget, bar, customer, 'archive') },
    });

    const cancel = el('button', {
      class: 'btn btn--secondary',
      type: 'button',
      text: 'Cancel',
      on: { click: () => { fillActions(bar, customer); bar.querySelector('button')?.focus(); } },
    });

    const prompt = el('div', {
      class: 'record-actions',
      role: 'group',
      'aria-label': 'Confirm archiving this customer',
    },
    el('span', { class: 'pager__status', text: 'Archive this customer?' }),
    confirm,
    cancel);

    prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        fillActions(bar, customer);
        bar.querySelector('button')?.focus();
      }
    });

    bar.append(prompt);
    confirm.focus();
  }

  async function runTransition(button, bar, customer, kind) {
    const label = kind === 'archive' ? 'Archiving…' : 'Restoring…';
    button.disabled = true;
    button.replaceChildren(...spinnerButton(label));
    shell.setBusy(true);

    try {
      const updated = kind === 'archive'
        ? await client.archiveCustomer(customer.customer_id)
        : await client.restoreCustomer(customer.customer_id);

      draw(updated);
      toast(kind === 'archive'
        ? `${updated.display_name} is archived.`
        : `${updated.display_name} is active again.`);
      shell.main.querySelector('.record-actions button, .record-actions a')?.focus();
    } catch (thrown) {
      const error = isApiError(thrown) ? thrown : null;

      if (error?.code === 'failed_precondition') {
        // The record moved on since the page was loaded. Reload rather than
        // argue with the server about what state it is in.
        toast(error.message || 'That is no longer possible for this customer.', { tone: 'error' });
        load();
        return;
      }

      toast(error?.message || 'That could not be completed.', { tone: 'error' });
      fillActions(bar, customer);
    } finally {
      shell.setBusy(false);
    }
  }

  function notices(customer) {
    const out = [];

    if (customer.status === 'archived') {
      out.push(el('div', { class: 'notice notice--archived' },
        el('p', {},
          el('strong', { text: 'Archived. ' }),
          'This customer is withdrawn from everyday use and is kept indefinitely. '
          + 'Archiving starts no countdown and deletes nothing. Restore it to edit it again.')));
    }

    if (customer.status === 'pending_deletion') {
      const deadline = formatDate(customer.deletion_scheduled_at);
      out.push(el('div', { class: 'notice notice--pending' },
        el('p', {},
          el('strong', { text: 'Deletion requested. ' }),
          deadline
            ? `This customer's details are scheduled to be permanently destroyed on ${deadline}.`
            : 'This customer is scheduled for permanent deletion.')));
    }

    return out;
  }

  function sections(customer) {
    return el('div', { class: 'sections' },
      section('Contact', [
        fieldRow('Email address', customer.email
          ? el('a', { href: `mailto:${customer.email}`, text: customer.email })
          : null),
        fieldRow('Phone', customer.phone
          ? el('a', { href: `tel:${customer.phone.replace(/[^\d+]/g, '')}`, text: customer.phone })
          : null),
        fieldRow('Country', countryLabel(customer.country)),
        fieldRow('Address', customer.address, { wide: true, multiline: true }),
      ]),

      section('Notes', [
        fieldRow('Notes', customer.notes, { wide: true, multiline: true, hideLabel: true }),
      ]),

      section('Filing', [
        fieldRow('Business', businessName(customer.business_id)),
        fieldRow('Business identifier', customer.business_id, { mono: true }),
      ]),

      section('Record', [
        fieldRow('Customer identifier', customer.customer_id, { mono: true }),
        fieldRow('Status', statusLabel(customer.status)),
        fieldRow('Created', joinMeta(formatTimestamp(customer.created_at), customer.created_by_principal_id)),
        fieldRow('Last updated', joinMeta(formatTimestamp(customer.updated_at), customer.updated_by_principal_id)),
        customer.deletion_scheduled_at
          ? fieldRow('Scheduled for deletion', formatTimestamp(customer.deletion_scheduled_at))
          : null,
      ].filter(Boolean)));
  }

  function joinMeta(when, principalId) {
    if (!when) return null;
    return el('span', {},
      el('span', { text: when }),
      el('span', { class: 'field-row__value--mono', text: ` by ${principalId}` }));
  }

  function section(title, rows) {
    return el('section', { class: 'section', 'aria-label': title },
      el('div', { class: 'section__head' },
        el('h2', { class: 'section__title', text: title })),
      el('div', { class: 'fields' }, rows));
  }

  /**
   * An optional field the tenant has not filled in is present and null on the
   * wire, and it is shown here as an explicit "Not recorded" rather than as a
   * blank. A blank cell is indistinguishable from a rendering bug.
   */
  function fieldRow(label, value, { wide = false, multiline = false, mono = false, hideLabel = false } = {}) {
    const empty = value === null || value === undefined || value === '';
    const classes = ['field-row__value'];
    if (multiline) classes.push('field-row__value--multiline');
    if (mono) classes.push('field-row__value--mono');
    if (empty) classes.push('field-row__value--empty');

    const valueNode = empty
      ? el('p', { class: classes.join(' '), text: 'Not recorded' })
      : el('p', { class: classes.join(' ') }, value);

    return el('div', { class: `field-row${wide ? ' field-row--wide' : ''}` },
      hideLabel
        ? el('span', { class: 'sr-only', text: label })
        : el('p', { class: 'field-row__label', text: label }),
      valueNode);
  }

  function businessName(id) {
    const found = client.listBusinesses().find((business) => business.business_id === id);
    return found ? found.display_name : id;
  }
}

/** Reached when the identifier in the address is not one this client can use. */
export function renderCustomerNotFound(ctx) {
  ctx.shell.render(el('div', {},
    el('a', { class: 'backlink', href: getLastListHash(), text: 'Customers' }),
    el('div', { class: 'panel' }, stateBlock({
      glyph: '?',
      title: 'This page does not exist',
      body: 'The address does not match anything in Dudo.',
      actions: [el('button', {
        class: 'btn btn--primary',
        type: 'button',
        text: 'Go to customers',
        on: { click: () => navigate('/customers') },
      })],
    }))), { title: 'Not found' });
}

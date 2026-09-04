/**
 * Create and edit a customer.
 *
 * One screen serves CreateCustomer and UpdateCustomer, because the fields a
 * client may write are the same seven either way. The differences are exactly
 * the ones the contract states, and they are handled rather than smoothed over:
 *
 *   - `business_id` is REQUIRED on create and is NOT A FIELD on update. Moving
 *     a customer between Businesses is its own Action with its own permission
 *     and its own audit record, so on the edit screen the Business is shown as
 *     a read-only fact with a sentence saying why.
 *   - Update is PARTIAL, and the three-way distinction is normative: a field
 *     absent means unchanged, a value means set, and null means cleared. The
 *     form therefore submits a DIFF against the record it loaded, never the
 *     whole form. Sending everything would look identical on a happy path and
 *     silently overwrite a colleague's concurrent edit on any other.
 *   - Only an ACTIVE customer can be edited. An archived one is refused by
 *     the server; this screen refuses to open on it and says to restore first.
 *
 * Validation here is a courtesy, not a gate. Every rule is a transcription of
 * the schema (see domain/field-rules.js), the server validates again, and the
 * server's answer is what the person is shown when the two disagree.
 */

import { el } from '../dom.js';
import { navigate } from '../router.js';
import { stateBlock, errorBlock, spinnerButton } from '../ui/components.js';
import { toast } from '../ui/toast.js';
import { getLastListHash } from './list-state.js';
import { isApiError } from '../api/errors.js';
import {
  LIMITS, EDITABLE_FIELDS, validateField, issueText,
} from '../domain/field-rules.js';

const LABELS = {
  business_id: 'Business',
  display_name: 'Name',
  customer_type: 'Type',
  email: 'Email address',
  phone: 'Phone',
  country: 'Country',
  address: 'Address',
  notes: 'Notes',
};

export function renderCustomerForm(ctx) {
  const { client, shell, params } = ctx;
  const mode = params.customer_id ? 'edit' : 'create';
  const container = el('div', {});

  shell.render(container, { title: mode === 'edit' ? 'Edit customer' : 'New customer' });

  if (mode === 'create') {
    draw(null);
  } else {
    loadForEdit();
  }

  async function loadForEdit() {
    container.replaceChildren(el('div', { class: 'state' },
      el('span', { class: 'skeleton', style: 'width: 14rem; height: 1.5rem' })));
    shell.setBusy(true);
    try {
      const customer = await client.getCustomer(params.customer_id);
      if (customer.status !== 'active') {
        container.replaceChildren(refusalForState(customer));
        return;
      }
      draw(customer);
    } catch (thrown) {
      const error = isApiError(thrown) ? thrown : null;
      container.replaceChildren(el('div', { class: 'panel' },
        errorBlock(error || { code: 'internal' }, {
          onRetry: loadForEdit,
          extraActions: [el('a', { class: 'btn btn--secondary', href: getLastListHash() }, 'Back to customers')],
        })));
    } finally {
      shell.setBusy(false);
    }
  }

  function refusalForState(customer) {
    const backHref = `#/customers/${encodeURIComponent(customer.customer_id)}`;
    return el('div', {},
      el('a', { class: 'backlink', href: backHref, text: customer.display_name }),
      el('div', { class: 'panel' }, stateBlock({
        glyph: '·',
        title: customer.status === 'archived'
          ? 'An archived customer cannot be edited'
          : 'This customer cannot be edited',
        body: customer.status === 'archived'
          ? 'Restore it first. A record withdrawn from use that could still be quietly changed would be neither withdrawn nor a record.'
          : 'Its current state does not allow changes.',
        actions: [el('a', { class: 'btn btn--primary', href: backHref }, 'Open the record')],
      })));
  }

  /* -------------------------------------------------------------- the form */

  function draw(customer) {
    const businesses = client.listBusinesses();
    const values = initialValues(customer);
    const errors = new Map();

    const summary = el('div', {
      class: 'form-error',
      tabindex: '-1',
      role: 'alert',
      hidden: true,
    });

    const controls = new Map();

    function fieldBlock(name, control, { hint, wide = false, counterMax = null } = {}) {
      const errorId = `${name}-error`;
      const hintId = `${name}-hint`;
      const describedBy = [hint ? hintId : null].filter(Boolean);

      const errorNode = el('p', { class: 'field__error', id: errorId, hidden: true });
      const counter = counterMax
        ? el('p', { class: 'field__count', 'aria-hidden': 'true' })
        : null;

      control.setAttribute('aria-describedby', describedBy.join(' '));

      const block = el('div', { class: `field${wide ? ' field--wide' : ''}` },
        el('label', { class: 'field__label', for: `f-${name}` },
          LABELS[name],
          isRequired(name)
            ? el('span', { class: 'field__required', 'aria-hidden': 'true', text: ' *' })
            : el('span', { class: 'field__optional', text: ' — optional' })),
        control,
        hint ? el('p', { class: 'field__hint', id: hintId, text: hint }) : null,
        counter,
        errorNode);

      controls.set(name, { control, errorNode, counter, counterMax, describedBy, errorId });

      if (counter) {
        const update = () => {
          const used = control.value.length;
          counter.textContent = `${used} / ${counterMax}`;
          counter.dataset.over = String(used > counterMax);
        };
        control.addEventListener('input', update);
        update();
      }

      control.addEventListener('blur', () => {
        validateOne(name);
        paint(name);
      });
      control.addEventListener('input', () => {
        if (errors.has(name)) { validateOne(name); paint(name); }
        markDirty();
      });

      return block;
    }

    function isRequired(name) {
      return name === 'display_name' || name === 'customer_type' || name === 'business_id';
    }

    /* -- the controls ----------------------------------------------------- */

    const businessControl = mode === 'create'
      ? el('select', { class: 'select', id: 'f-business_id', name: 'business_id', required: true },
        el('option', { value: '', text: 'Choose a Business' }),
        businesses.map((business) => el('option', {
          value: business.business_id,
          text: business.display_name,
          selected: business.business_id === values.business_id,
        })))
      : null;

    const nameControl = el('input', {
      class: 'input', id: 'f-display_name', name: 'display_name', type: 'text',
      value: values.display_name, required: true, autocomplete: 'off',
      maxlength: String(LIMITS.display_name.max),
    });

    const typeControl = el('select', { class: 'select', id: 'f-customer_type', name: 'customer_type', required: true },
      el('option', { value: 'person', text: 'Person', selected: values.customer_type === 'person' }),
      el('option', { value: 'company', text: 'Company', selected: values.customer_type === 'company' }));

    const emailControl = el('input', {
      class: 'input', id: 'f-email', name: 'email', type: 'email',
      value: values.email, autocomplete: 'off', inputmode: 'email',
      maxlength: String(LIMITS.email.max),
    });

    const phoneControl = el('input', {
      class: 'input', id: 'f-phone', name: 'phone', type: 'tel',
      value: values.phone, autocomplete: 'off', inputmode: 'tel',
      maxlength: String(LIMITS.phone.max),
    });

    const countryControl = el('input', {
      class: 'input', id: 'f-country', name: 'country', type: 'text',
      value: values.country, autocomplete: 'off', maxlength: '2',
      style: 'text-transform: uppercase; max-width: 8rem',
    });
    countryControl.addEventListener('input', () => {
      const caret = countryControl.selectionStart;
      countryControl.value = countryControl.value.toUpperCase().replace(/[^A-Z]/g, '');
      try { countryControl.setSelectionRange(caret, caret); } catch { /* ignore */ }
    });

    const addressControl = el('textarea', {
      class: 'textarea', id: 'f-address', name: 'address', rows: '3',
      maxlength: String(LIMITS.address.max),
    });
    addressControl.value = values.address;

    const notesControl = el('textarea', {
      class: 'textarea', id: 'f-notes', name: 'notes', rows: '5',
      maxlength: String(LIMITS.notes.max),
    });
    notesControl.value = values.notes;

    /* -- assembly --------------------------------------------------------- */

    const identitySection = el('section', { class: 'section', 'aria-label': 'Identity' },
      el('div', { class: 'section__head' }, el('h2', { class: 'section__title', text: 'Identity' })),
      el('div', { class: 'form__grid' },
        mode === 'create'
          ? fieldBlock('business_id', businessControl, {
            hint: 'Which of your Businesses this customer is filed under. It cannot be changed here afterwards.',
          })
          : businessReadOnly(customer),
        fieldBlock('display_name', nameControl, {
          hint: 'The name this customer is known by.',
          wide: mode !== 'create',
        }),
        fieldBlock('customer_type', typeControl, {
          hint: 'Whether this is a natural person or an organisation.',
        })));

    const contactSection = el('section', { class: 'section', 'aria-label': 'Contact' },
      el('div', { class: 'section__head' }, el('h2', { class: 'section__title', text: 'Contact' })),
      el('div', { class: 'form__grid' },
        fieldBlock('email', emailControl, {
          hint: 'Dudo checks the shape only. It does not verify that the address exists.',
        }),
        fieldBlock('phone', phoneControl, {
          hint: 'Recorded as you write it. Digits and + ( ) - . and spaces.',
        }),
        fieldBlock('country', countryControl, {
          hint: 'Two-letter code, for example BH, GB or AE.',
        }),
        el('div', {}),
        fieldBlock('address', addressControl, {
          wide: true,
          counterMax: LIMITS.address.max,
          hint: 'One free-text address. Not used for tax or shipping.',
        })));

    const notesSection = el('section', { class: 'section', 'aria-label': 'Notes' },
      el('div', { class: 'section__head' }, el('h2', { class: 'section__title', text: 'Notes' })),
      el('div', { class: 'form__grid' },
        fieldBlock('notes', notesControl, {
          wide: true,
          counterMax: LIMITS.notes.max,
          hint: 'Notes are visible to everyone who can open this record, and are deliberately not searchable.',
        })));

    const submitButton = el('button', {
      class: 'btn btn--primary',
      type: 'submit',
      text: mode === 'create' ? 'Create customer' : 'Save changes',
    });

    const dirtyNote = el('p', { class: 'form__foot-note' });

    const form = el('form', { class: 'form', novalidate: true },
      summary,
      identitySection,
      contactSection,
      notesSection,
      el('div', { class: 'form__foot' },
        submitButton,
        el('a', {
          class: 'btn btn--secondary',
          href: mode === 'edit'
            ? `#/customers/${encodeURIComponent(customer.customer_id)}`
            : getLastListHash(),
        }, 'Cancel'),
        dirtyNote));

    container.replaceChildren(
      el('a', {
        class: 'backlink',
        href: mode === 'edit'
          ? `#/customers/${encodeURIComponent(customer.customer_id)}`
          : getLastListHash(),
        text: mode === 'edit' ? customer.display_name : 'Customers',
      }),
      el('div', { class: 'page-head' },
        el('div', { class: 'page-head__text' },
          el('h1', {
            class: 'page-title',
            text: mode === 'create' ? 'New customer' : 'Edit customer',
          }),
          el('p', {
            class: 'page-subtitle',
            text: mode === 'create'
              ? 'A new customer starts active. Only the name, the type and the Business are required.'
              : 'Leave a field as it is to keep it. Clear a field to remove what is recorded.',
          }))),
      form);

    markDirty();
    nameControl.focus();

    /* -- validation ------------------------------------------------------- */

    function validateOne(name) {
      const entry = controls.get(name);
      if (!entry) return;
      const raw = entry.control.value;
      const value = name === 'notes' || name === 'address' ? raw.trim() : raw.trim();
      const issue = validateField(name, value === '' ? null : value, { required: isRequired(name) });
      if (issue) errors.set(name, issue.issue);
      else errors.delete(name);
    }

    function paint(name) {
      const entry = controls.get(name);
      if (!entry) return;
      const token = errors.get(name);
      if (token) {
        entry.control.setAttribute('aria-invalid', 'true');
        entry.control.setAttribute('aria-describedby',
          [...entry.describedBy, entry.errorId].join(' '));
        entry.errorNode.textContent = issueText(token, name);
        entry.errorNode.hidden = false;
      } else {
        entry.control.removeAttribute('aria-invalid');
        entry.control.setAttribute('aria-describedby', entry.describedBy.join(' '));
        entry.errorNode.textContent = '';
        entry.errorNode.hidden = true;
      }
    }

    function paintAll() {
      for (const name of controls.keys()) paint(name);
    }

    function showSummary(title, items) {
      summary.replaceChildren(
        el('p', { class: 'form-error__title', text: title }),
        items.length
          ? el('ul', { class: 'form-error__list' }, items.map((item) => el('li', {},
            item.field && controls.has(item.field)
              ? el('button', {
                type: 'button',
                text: `${LABELS[item.field] || item.field}: ${item.text}`,
                on: { click: () => controls.get(item.field).control.focus() },
              })
              : el('span', { text: item.text }))))
          : null,
        items.some((item) => item.reference)
          ? el('p', { class: 'state__code', text: `Reference ${items.find((i) => i.reference).reference}` })
          : null);
      summary.hidden = false;
      summary.focus();
    }

    function hideSummary() {
      summary.hidden = true;
      summary.replaceChildren();
    }

    /* -- dirty tracking --------------------------------------------------- */

    function currentValues() {
      const out = { display_name: nameControl.value.trim().replace(/\s+/g, ' ') };
      out.customer_type = typeControl.value;
      out.email = emailControl.value.trim();
      out.phone = phoneControl.value.trim();
      out.country = countryControl.value.trim().toUpperCase();
      out.address = addressControl.value.trim();
      out.notes = notesControl.value.trim();
      if (mode === 'create') out.business_id = businessControl.value;
      return out;
    }

    function buildDiff() {
      const now = currentValues();
      const diff = {};
      for (const field of EDITABLE_FIELDS) {
        const next = now[field] === '' ? null : now[field];
        const before = customer[field] ?? null;
        if (next === before) continue;
        // A field present and null means "cleared"; a field simply absent
        // means "unchanged". That is why the untouched fields never appear.
        diff[field] = next;
      }
      return diff;
    }

    function markDirty() {
      if (mode === 'create') {
        dirtyNote.textContent = '';
        return;
      }
      const changes = Object.keys(buildDiff());
      submitButton.disabled = changes.length === 0;
      dirtyNote.textContent = changes.length === 0
        ? 'Nothing has changed yet.'
        : `${changes.length} ${changes.length === 1 ? 'field' : 'fields'} changed.`;
    }

    /* -- submit ----------------------------------------------------------- */

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      hideSummary();

      for (const name of controls.keys()) validateOne(name);
      paintAll();

      if (errors.size > 0) {
        showSummary(
          `Check ${errors.size === 1 ? 'this field' : `these ${errors.size} fields`} before saving.`,
          [...errors.entries()].map(([field, token]) => ({ field, text: issueText(token, field) })));
        return;
      }

      const original = submitButton.textContent;
      submitButton.disabled = true;
      submitButton.replaceChildren(...spinnerButton(mode === 'create' ? 'Creating…' : 'Saving…'));
      shell.setBusy(true);

      try {
        if (mode === 'create') {
          const now = currentValues();
          const created = await client.createCustomer({
            business_id: now.business_id,
            display_name: now.display_name,
            customer_type: now.customer_type,
            email: now.email || null,
            phone: now.phone || null,
            country: now.country || null,
            address: now.address || null,
            notes: now.notes || null,
          });
          toast(`${created.display_name} has been added.`);
          navigate(`/customers/${created.customer_id}`);
          return;
        }

        const diff = buildDiff();
        if (Object.keys(diff).length === 0) {
          markDirty();
          return;
        }
        const updated = await client.updateCustomer(customer.customer_id, diff);
        toast(`${updated.display_name} has been updated.`);
        navigate(`/customers/${updated.customer_id}`);
        return;
      } catch (thrown) {
        const error = isApiError(thrown) ? thrown : null;
        applyServerError(error);
      } finally {
        shell.setBusy(false);
        submitButton.disabled = false;
        submitButton.replaceChildren(document.createTextNode(original));
        if (mode === 'edit') markDirty();
      }
    });

    /**
     * The server's answer wins. Field-level detail is attached to the field it
     * names, and anything without a field — or with a field this form does not
     * render — is stated in the summary rather than swallowed.
     */
    function applyServerError(error) {
      if (!error) {
        showSummary('That could not be saved.', [{ text: 'An unexpected problem occurred.' }]);
        return;
      }

      const items = [];
      let matchedAField = false;

      for (const detail of error.details) {
        const text = issueText(detail.issue, detail.field);
        if (controls.has(detail.field)) {
          errors.set(detail.field, detail.issue);
          matchedAField = true;
          items.push({ field: detail.field, text });
        } else {
          items.push({ text: `${detail.field}: ${text}` });
        }
      }
      paintAll();

      if (items.length === 0) {
        items.push({ text: error.message || 'The request was refused.' });
      }
      if (error.request_id) items[0].reference = error.request_id;

      const title = error.code === 'invalid_argument'
        ? 'Dudo could not accept these details.'
        : error.code === 'failed_precondition'
          ? 'This customer has changed since the form was opened.'
          : error.code === 'forbidden'
            ? 'You do not have permission to save this.'
            : 'That could not be saved.';

      showSummary(title, items);

      if (matchedAField) {
        const first = items.find((item) => item.field);
        if (first) controls.get(first.field).control.focus();
      }
    }

    function businessReadOnly(record) {
      return el('div', { class: 'field' },
        el('span', { class: 'field__label', text: 'Business' }),
        el('p', { class: 'readonly-value', text: businessName(record.business_id) }),
        el('p', {
          class: 'field__hint',
          text: 'Filed under this Business. Moving a customer to a different Business is a separate, separately-permissioned action and is not part of this form.',
        }));
    }

    function businessName(id) {
      const found = businesses.find((business) => business.business_id === id);
      return found ? found.display_name : id;
    }
  }

  function initialValues(customer) {
    if (!customer) {
      return {
        business_id: '', display_name: '', customer_type: 'person',
        email: '', phone: '', country: '', address: '', notes: '',
      };
    }
    return {
      business_id: customer.business_id,
      display_name: customer.display_name,
      customer_type: customer.customer_type,
      email: customer.email ?? '',
      phone: customer.phone ?? '',
      country: customer.country ?? '',
      address: customer.address ?? '',
      notes: customer.notes ?? '',
    };
  }
}

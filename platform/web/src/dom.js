/**
 * Minimal DOM construction helpers.
 *
 * Everything the views render goes through `el()`, and `el()` sets text with
 * `textContent` only. There is no innerHTML path anywhere in this application,
 * so customer-supplied text cannot become markup. That is a property of the
 * helper rather than a rule each view has to remember.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {Object} [props] - `class`, `text`, `html` is deliberately unsupported,
 *   `on` for listeners, `dataset`, and anything else as an attribute.
 * @param {...(Node|string|null|undefined|Array)} children
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  applyProps(node, props);
  append(node, children);
  return node;
}

export function svg(tag, props = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child) node.appendChild(child);
  }
  return node;
}

function applyProps(node, props) {
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') {
      node.className = value;
    } else if (key === 'text') {
      node.textContent = String(value);
    } else if (key === 'on') {
      for (const [event, handler] of Object.entries(value)) {
        node.addEventListener(event, handler);
      }
    } else if (key === 'dataset') {
      for (const [dataKey, dataValue] of Object.entries(value)) {
        if (dataValue === null || dataValue === undefined) continue;
        node.dataset[dataKey] = String(dataValue);
      }
    } else if (key === 'value') {
      node.value = value;
    } else if (key === 'checked' || key === 'disabled' || key === 'required' || key === 'selected') {
      node[key] = Boolean(value);
    } else {
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === 'string' || typeof child === 'number'
      ? document.createTextNode(String(child))
      : child);
  }
}

/**
 * Put focus back on the control a person was using, after a re-render
 * replaced it with an identical one. Silent when the element is gone: that
 * means the screen genuinely changed, and the shell has already moved focus to
 * the new one.
 *
 * The caret is sent to the end of a text field rather than to position zero,
 * which is where a fresh input would otherwise start.
 */
export function restoreFocusById(id) {
  if (!id) return false;
  const node = document.getElementById(id);
  if (!node || typeof node.focus !== 'function') return false;
  node.focus({ preventScroll: true });
  if (typeof node.setSelectionRange === 'function' && typeof node.value === 'string') {
    try {
      node.setSelectionRange(node.value.length, node.value.length);
    } catch {
      /* setSelectionRange is not supported on every input type. */
    }
  }
  return true;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

export function mount(node, ...children) {
  clear(node);
  append(node, children);
  return node;
}

/** A magnifying-glass glyph. Decorative — the input carries the accessible name. */
export function iconSearch(className) {
  return svg('svg', { class: className, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false' },
    svg('circle', { cx: '7', cy: '7', r: '4.5', stroke: 'currentColor', 'stroke-width': '1.6' }),
    svg('path', { d: 'M10.5 10.5 14 14', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round' }));
}

export function iconGlyph(glyph, label) {
  return el('span', { class: 'state__icon', 'aria-hidden': 'true', text: glyph, title: label || null });
}

// SPDX-License-Identifier: Apache-2.0
// Small keyed DOM reconciler. Nodes with a stable key keep focus, scroll and open state.
const keyOf = node => node.nodeType === 1 ? node.getAttribute('data-key') || node.id || null : null;
const same = (a, b) => a.nodeType === b.nodeType && (a.nodeType !== 1 || a.tagName === b.tagName && keyOf(a) === keyOf(b));
export function reconcile(parent, children) {
  const old = [...parent.childNodes], used = new Set(), keyed = new Map(old.filter(n => keyOf(n)).map(n => [keyOf(n), n]));
  let cursor = parent.firstChild;
  for (const fresh of children) {
    const key = keyOf(fresh);
    let node = key ? keyed.get(key) : old.find(n => !used.has(n) && !keyOf(n) && same(n, fresh));
    if (!node || !same(node, fresh)) node = fresh;
    else patch(node, fresh);
    used.add(node);
    if (node !== cursor) parent.insertBefore(node, cursor);
    cursor = node.nextSibling;
  }
  for (const node of old) if (!used.has(node)) node.remove();
}
function patch(node, fresh) {
  if (node.nodeType === 3) { if (node.data !== fresh.data) node.data = fresh.data; return; }
  if (node.nodeType !== 1) return;
  const open = node.tagName === 'DETAILS' ? node.open : null;
  const value = fresh.value;
  for (const attr of [...node.attributes]) if (!fresh.hasAttribute(attr.name)) node.removeAttribute(attr.name);
  for (const attr of fresh.attributes) if (node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name, attr.value);
  for (const event of ['onclick', 'oninput', 'onchange', 'onkeydown', 'onsubmit']) node[event] = fresh[event];
  if (!['TEXTAREA', 'INPUT'].includes(node.tagName)) reconcile(node, [...fresh.childNodes]);
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) {
    if (node !== node.ownerDocument.activeElement && node.value !== value) node.value = value;
    if (node.type === 'checkbox' || node.type === 'radio') node.checked = fresh.checked;
    node.disabled = fresh.disabled;
  }
  if (open !== null && !fresh.hasAttribute('data-controlled-open')) node.open = open;
}

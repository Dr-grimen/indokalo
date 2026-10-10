import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../contact.js', import.meta.url), 'utf8');

// Exercise the full browser script with a small DOM double. No endpoint is called.
function page(search = '', draft = {}, chosenType = 'buyer') {
  function node() {
    return { value: '', checked: false, hidden: false, handlers: {}, dataset: {},
      addEventListener(type, fn) { this.handlers[type] = fn; },
      replaceChildren(...children) { this.children = children; },
      appendChild(child) { (this.children ??= []).push(child); } };
  }
  const nodes = new Map();
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const form = get('contact-form');
  form.elements = Object.fromEntries(['name', 'company', 'email', 'country', 'sector', 'requirements', 'timing', 'consent']
    .map(key => [key, { ...node(), ...(draft[key] || {}) }]));
  let selected = chosenType;
  const radios = ['buyer', 'supplier'].map(value => ({ ...node(), value, defaultChecked: value === 'buyer',
    get checked() { return selected === value; },
    set checked(checked) { if (checked) selected = value; } }));
  form.elements.type = { get value() { return selected; } };
  form.querySelectorAll = selector => { assert.equal(selector, '[name="type"]'); return radios; };
  form.querySelector = selector => radios.find(radio => selector === `input[name="type"][value="${radio.value}"]`) || null;
  const links = ['buyer', 'supplier'].map(intent => ({ ...node(), dataset: { intent } }));
  const document = { getElementById: get, createTextNode: text => ({ textContent: text }), createElement: node,
    querySelectorAll(selector) { assert.equal(selector, '[data-intent]'); return links; } };
  vm.runInNewContext(source, { document, window: { location: { search } }, URLSearchParams });
  return { form, get, select: type => links.find(link => link.dataset.intent === type).handlers.click() };
}

test('landing links choose buyer or supplier and show the corresponding prompt', () => {
  for (const type of ['buyer', 'supplier']) {
    const p = page(`?type=${type}`);
    assert.equal(p.form.elements.type.value, type);
    assert.equal(p.get('requirements-label').textContent,
      type === 'supplier' ? 'What can your company supply?' : 'What do you need?');
    assert.equal(p.get('submit-button').disabled, false);
  }
});

test('unknown query values are ignored and never used as selectors', () => {
  for (const query of ['', '?type=other', '?type=SUPPLIER', '?type=%22%5Dinput', '?requirements=replace-me']) {
    const p = page(query);
    assert.equal(p.form.elements.type.value, 'buyer');
    assert.equal(p.form.elements.requirements.value, '');
  }
});

test('restored form details and consent are preserved instead of selecting another route', () => {
  for (const key of ['name', 'company', 'email', 'country', 'sector', 'requirements', 'timing', 'consent']) {
    const saved = key === 'consent' ? { checked: true } : { value: 'Existing draft detail' };
    const p = page('?type=supplier', { [key]: saved });
    assert.equal(p.form.elements.type.value, 'buyer');
    assert.equal(p.form.elements[key][key === 'consent' ? 'checked' : 'value'],
      key === 'consent' ? true : 'Existing draft detail');
  }
});

test('a restored supplier selection is not replaced by a buyer URL', () => {
  assert.equal(page('?type=buyer', {}, 'supplier').form.elements.type.value, 'supplier');
});

test('an explicit in-page route choice changes the prompt without clearing a draft', () => {
  const p = page('', { requirements: { value: 'Keep my specific project requirements' }, company: { value: 'My company' } });
  p.select('supplier');
  assert.equal(p.form.elements.type.value, 'supplier');
  assert.equal(p.get('requirements-label').textContent, 'What can your company supply?');
  assert.equal(p.form.elements.requirements.value, 'Keep my specific project requirements');
  assert.equal(p.form.elements.company.value, 'My company');
});

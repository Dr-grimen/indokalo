import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../contact.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const intentValues = ['buyer', 'supplier', 'business_seller', 'business_buyer', 'merger'];
const optionalKeys = ['company', 'country', 'sector', 'timing'];
const validDraft = overrides => ({
  name: { value: 'Alex Example' }, email: { value: 'alex@example.com' },
  requirements: { value: 'I need a supplier for a new packaging project.' },
  consent: { checked: true }, ...overrides
});
const received = reference => ({ ok: true, status: 200, json: async () => ({ ok: true, reference }) });

// Run the complete browser script with a small DOM double. Fetch is always mocked;
// these tests cannot create real enquiries or contact the public endpoint.
function page(search = '', draft = {}, chosenType = 'buyer', respond) {
  const nodes = new Map();
  const requests = [];
  const timers = new Map();
  let focused = null;
  let uuidCount = 0;
  function node() {
    return { value: '', checked: false, hidden: false, disabled: false, open: false,
      handlers: {}, dataset: {}, attributes: {}, validationMessage: '',
      addEventListener(type, fn) { this.handlers[type] = fn; },
      replaceChildren(...children) { this.children = children; },
      appendChild(child) { (this.children ??= []).push(child); },
      setAttribute(key, value) { this.attributes[key] = value; },
      removeAttribute(key) { delete this.attributes[key]; if (key === 'data-state') delete this.dataset.state; },
      focus() { focused = this; },
      setCustomValidity(message) { this.validationMessage = message; },
      checkValidity() {
        return !this.validationMessage && (!this.required || (this.type === 'checkbox' ? this.checked : !!this.value))
          && (this.type !== 'email' || !this.value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.value));
      },
      closest(selector) { return selector === 'details' && optionalKeys.includes(this.name) ? get('optional-details') : null; }
    };
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const form = get('contact-form');
  const fieldKeys = ['name', 'company', 'email', 'country', 'sector', 'requirements', 'timing', 'consent', 'website'];
  form.elements = Object.fromEntries(fieldKeys.map(key => {
    const tag = html.match(new RegExp('<(?:input|select|textarea)\\b[^>]*\\bname="' + key + '"[^>]*>'))?.[0];
    assert.ok(tag, `The page must include the ${key} field`);
    const field = Object.assign(get(key), { name: key, required: /\srequired(?:\s|>)/.test(tag),
      type: tag.match(/\btype="([^"]+)"/)?.[1] || 'text' }, draft[key]);
    return [key, field];
  }));
  const type = get('request-type');
  type.value = chosenType;
  type.options = intentValues.map(value => ({ value, defaultSelected: value === 'buyer',
    get selected() { return type.value === value; } }));
  Object.defineProperty(type, 'selectedIndex', { get: () => intentValues.indexOf(type.value) });
  form.elements.type = type;
  const sector = form.elements.sector;
  sector.options = [{ value: '', text: 'Choose a sector' }, { value: 'manufacturing', text: 'Manufacturing & equipment' }];
  Object.defineProperty(sector, 'selectedIndex', { get: () => sector.options.findIndex(option => option.value === sector.value) });
  const controls = [...Object.values(form.elements), get('submit-button')];
  const matching = (items, selector) => selector === ':invalid' ? items.filter(item => !item.checkValidity()) : items;
  form.querySelectorAll = selector => matching(controls, selector);
  form.querySelector = selector => matching(controls, selector)[0] || null;
  get('form-fields').querySelectorAll = selector => matching(controls, selector);
  const optional = get('optional-details');
  optional.querySelectorAll = selector => matching(optionalKeys.map(key => form.elements[key]), selector);
  optional.querySelector = selector => optional.querySelectorAll(selector)[0] || null;
  optional.contains = field => optionalKeys.some(key => form.elements[key] === field);
  form.reportValidity = () => {
    const invalid = controls.find(control => !control.checkValidity());
    if (invalid) invalid.focus();
    return !invalid;
  };
  form.checkValidity = () => controls.every(control => control.checkValidity());
  form.reset = () => {
    fieldKeys.forEach(key => { form.elements[key].value = ''; form.elements[key].checked = false; });
    type.value = 'buyer';
  };
  get('form-fallback').hidden = true;
  get('another-request').hidden = true;
  const links = intentValues.map(intent => ({ ...node(), dataset: { intent } }));
  const document = { getElementById: get, createTextNode: text => ({ textContent: text }), createElement: node,
    querySelectorAll(selector) { assert.equal(selector, '[data-intent]'); return links; } };
  vm.runInNewContext(source, { document, window: { location: { search } }, URLSearchParams,
    AbortController, setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    crypto: { randomUUID() { return `00000000-0000-4000-8000-${String(++uuidCount).padStart(12, '0')}`; } },
    fetch: async (url, options) => {
      const request = { url, ...options, data: JSON.parse(options.body) };
      requests.push(request);
      if (!respond) throw new Error('No mock response configured');
      return respond(request, requests.length);
    }
  });
  return { form, get, requests, timers, controls, get focused() { return focused; },
    select: value => links.find(link => link.dataset.intent === value).handlers.click(),
    change: value => { type.value = value; type.handlers.change(); },
    input: key => form.handlers.input({ target: form.elements[key] }),
    submit: () => form.handlers.submit({ preventDefault() {} }) };
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

test('ownership routes show initial-enquiry prompts and retain saved drafts', () => {
  for (const type of ['business_seller', 'business_buyer', 'merger']) {
    const p = page(`?type=${type}`);
    assert.equal(p.form.elements.type.value, type);
    assert.equal(p.get('ownership-note').hidden, false);
    assert.equal(p.get('company-hint').hidden, false);
    assert.notEqual(p.get('requirements-label').textContent, 'What do you need?');
    const saved = page(`?type=${type}`, { requirements: { value: 'Saved supplier brief' } });
    assert.equal(saved.form.elements.type.value, 'buyer');
    assert.equal(saved.form.elements.requirements.value, 'Saved supplier brief');
    p.select('buyer');
    assert.equal(p.get('ownership-note').hidden, true);
    assert.equal(p.get('company-hint').hidden, true);
  }
});

test('a restored ownership choice is not replaced by a different URL', () => {
  assert.equal(page('?type=supplier', {}, 'merger').form.elements.type.value, 'merger');
});

test('changing the native select updates the prompt and preserves the brief', () => {
  const p = page('', validDraft());
  p.change('supplier');
  assert.equal(p.get('requirements-label').textContent, 'What can your company supply?');
  p.change('merger');
  assert.equal(p.get('ownership-note').hidden, false);
  assert.equal(p.form.elements.requirements.value, validDraft().requirements.value);
});

test('a short enquiry sends with only name, email, brief and consent', async () => {
  const p = page('', validDraft({ name: { value: '  Alex Example  ' }, company: { value: '  ' }, country: { value: '  ' } }), 'buyer',
    () => received('IC-EXAMPLE'));
  await p.submit();
  assert.equal(p.requests.length, 1);
  const request = p.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.data.name, 'Alex Example');
  assert.equal(request.data.email, 'alex@example.com');
  assert.equal(request.data.type, 'buyer');
  assert.equal(request.data.consent, true);
  for (const key of optionalKeys) assert.equal(request.data[key], '', `${key} can be omitted`);
  assert.equal(p.get('form-status').dataset.state, 'success');
  assert.match(p.get('form-status').textContent, /IC-EXAMPLE/);
  assert.equal(p.get('form-fields').hidden, true);
  assert.equal(p.get('form-fallback').hidden, true);
  assert.equal(p.get('another-request').hidden, false);
  assert.equal(p.focused, p.get('form-status'));
  assert.equal(p.timers.size, 0);
});

test('required details are validated before a request is sent', async () => {
  for (const [key, invalid] of [
    ['name', { value: ' A ' }], ['requirements', { value: 'Brief is too short' }],
    ['email', { value: 'invalid-address' }], ['email', { value: '' }], ['consent', { checked: false }]
  ]) {
    const p = page('', validDraft({ [key]: invalid }), 'buyer', () => received('IC-UNEXPECTED'));
    await p.submit();
    assert.equal(p.requests.length, 0, `${key} must be corrected before sending`);
    assert.equal(p.focused, p.form.elements[key]);
    assert.equal(p.get('form-fields').hidden, false);
  }
});

test('an invalid optional detail is revealed and can be corrected or removed', async () => {
  for (const key of ['company', 'country']) {
    for (const correction of ['', 'Norway']) {
      const p = page('', validDraft({ [key]: { value: ' X ' } }), 'buyer', () => received('IC-CORRECTED'));
      assert.equal(p.get('optional-details').open, false);
      await p.submit();
      assert.equal(p.requests.length, 0);
      assert.equal(p.get('optional-details').open, true, `Reveal the invalid ${key} field`);
      assert.match(p.form.elements[key].validationMessage, /at least 2/);
      assert.equal(p.focused, p.form.elements[key]);
      p.form.elements[key].value = correction;
      p.input(key);
      assert.equal(p.form.elements[key].validationMessage, '');
      await p.submit();
      assert.equal(p.requests.length, 1);
      assert.equal(p.requests[0].data[key], correction);
      assert.equal(p.get('form-status').dataset.state, 'success');
    }
  }
});

test('an uncertain submission retains the draft, offers email and retries with the same id', async () => {
  const p = page('', validDraft(), 'supplier', (_request, attempt) => {
    if (attempt === 1) throw new Error('Connection interrupted');
    return received('IC-RETRIED');
  });
  await p.submit();
  assert.equal(p.get('form-status').dataset.state, 'error');
  assert.equal(p.get('form-fields').hidden, false);
  assert.equal(p.get('form-fallback').hidden, false);
  assert.equal(p.form.elements.requirements.value, validDraft().requirements.value);
  assert.equal(p.form.elements.consent.checked, true);
  const email = new URL(p.get('fallback-link').href);
  assert.equal(email.protocol, 'mailto:');
  assert.equal(email.pathname, 'connect@indokalo.com');
  assert.match(email.searchParams.get('subject'), /Commercial supplier introduction/);
  assert.match(email.searchParams.get('body'), /I need a supplier for a new packaging project\./);
  assert.doesNotMatch(email.searchParams.get('body'), /undefined|null/);
  assert.ok(p.controls.every(control => !control.disabled));
  assert.equal(p.form.attributes['aria-busy'], undefined);
  await p.submit();
  assert.equal(p.requests.length, 2);
  assert.equal(p.requests[0].data.submission_id, p.requests[1].data.submission_id);
  assert.equal(p.get('form-status').dataset.state, 'success');
  assert.equal(p.get('form-fallback').hidden, true);
});

test('editing the brief after an error creates a new submission id', async () => {
  const p = page('', validDraft(), 'buyer', () => { throw new Error('Offline'); });
  await p.submit();
  p.form.elements.requirements.value = 'A revised request with a different project scope.';
  p.input('requirements');
  await p.submit();
  assert.equal(p.requests.length, 2);
  assert.notEqual(p.requests[0].data.submission_id, p.requests[1].data.submission_id);
});

test('HTTP failures and unconfirmed responses do not show a success receipt', async () => {
  const cases = [
    { response: { ok: false, status: 429, json: async () => ({ ok: false }) }, message: /busy right now/ },
    { response: { ok: false, status: 400, json: async () => ({ ok: false }) }, message: /check your details/ },
    { response: { ok: false, status: 503, json: async () => ({ ok: false }) }, message: /couldn’t confirm/ },
    { response: { ok: true, status: 200, json: async () => ({ ok: false }) }, message: /couldn’t confirm/ },
    { response: { ok: true, status: 200, json: async () => { throw new Error('Invalid JSON'); } }, message: /couldn’t confirm/ }
  ];
  for (const { response, message } of cases) {
    const p = page('', validDraft(), 'buyer', () => response);
    await p.submit();
    assert.equal(p.requests.length, 1);
    assert.equal(p.get('form-status').dataset.state, 'error');
    assert.match(p.get('form-status').textContent, message);
    assert.equal(p.get('form-fields').hidden, false);
    assert.equal(p.get('form-fallback').hidden, false);
    assert.equal(p.get('another-request').hidden, true);
    assert.ok(p.controls.every(control => !control.disabled));
    assert.equal(p.timers.size, 0);
  }
});

test('a pending request blocks double submission and route changes', async () => {
  let resolve;
  const p = page('', validDraft(), 'buyer', () => new Promise(done => { resolve = done; }));
  const pending = p.submit();
  assert.equal(p.requests.length, 1);
  assert.equal(p.get('form-status').dataset.state, 'pending');
  assert.equal(p.form.attributes['aria-busy'], 'true');
  assert.ok(p.controls.every(control => control.disabled));
  await p.submit();
  p.select('merger');
  assert.equal(p.requests.length, 1);
  assert.equal(p.form.elements.type.value, 'buyer');
  resolve(received('IC-ONCE'));
  await pending;
  assert.equal(p.get('form-status').dataset.state, 'success');
  assert.equal(p.form.attributes['aria-busy'], undefined);
  assert.ok(p.controls.every(control => !control.disabled));
});

test('another enquiry clears the receipt and starts with a fresh submission id', async () => {
  const p = page('', validDraft(), 'merger', () => received('IC-RECEIVED'));
  await p.submit();
  p.get('another-request').handlers.click();
  assert.equal(p.get('form-fields').hidden, false);
  assert.equal(p.get('form-status').textContent, '');
  assert.equal(p.get('form-status').dataset.state, undefined);
  assert.equal(p.get('another-request').hidden, true);
  assert.equal(p.form.elements.type.value, 'buyer');
  assert.equal(p.form.elements.name.value, '');
  assert.equal(p.form.elements.consent.checked, false);
  assert.equal(p.focused, p.form.elements.name);
  for (const [key, field] of Object.entries(validDraft())) Object.assign(p.form.elements[key], field);
  await p.submit();
  assert.equal(p.requests.length, 2);
  assert.notEqual(p.requests[0].data.submission_id, p.requests[1].data.submission_id);
});

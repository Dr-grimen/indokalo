/* One public endpoint; enquiry details are never saved in browser storage. */
const CONTACT_ENDPOINT = 'https://bob-app-3ul.pages.dev/api/indokalo-request';

(() => {
  'use strict';
  const form = document.getElementById('contact-form');
  if (!form) return;
  const submit = document.getElementById('submit-button');
  const fields = document.getElementById('form-fields');
  const status = document.getElementById('form-status');
  const fallback = document.getElementById('form-fallback');
  const fallbackLink = document.getElementById('fallback-link');
  const another = document.getElementById('another-request');
  let pending = false;
  let lastContent = '';
  let submissionId = '';

  function intent() { return form.elements.type.value; }
  function updateIntent() {
    const supplier = intent() === 'supplier';
    document.getElementById('requirements-label').textContent = supplier ? 'What can your company supply?' : 'What do you need?';
    document.getElementById('requirements-hint').textContent = supplier
      ? 'Include your products or services, the countries you serve, and any key capabilities or certifications. At least 20 characters.'
      : 'Include the product, service or partner you need, the project location and any key requirements. Budget or quantity is useful if known. At least 20 characters.';
    const label = document.getElementById('timing-label');
    label.replaceChildren(document.createTextNode(supplier ? 'Availability or lead time ' : 'When is it needed? '));
    const optional = document.createElement('span');
    optional.className = 'optional';
    optional.textContent = '(optional)';
    label.appendChild(optional);
    document.getElementById('timing').placeholder = supplier ? 'For example: available now, or 8-week lead time' : 'For example: January 2027, or still exploring';
  }

  function resetForm() {
    form.reset();
    fields.hidden = false;
    status.textContent = '';
    status.removeAttribute('data-state');
    fallback.hidden = true;
    another.hidden = true;
    lastContent = '';
    submissionId = '';
    updateIntent();
  }

  document.querySelectorAll('[data-intent]').forEach(link => {
    link.addEventListener('click', () => {
      if (pending) return;
      if (fields.hidden) resetForm();
      const choice = form.querySelector('input[name="type"][value="' + link.dataset.intent + '"]');
      if (choice) choice.checked = true;
      updateIntent();
    });
  });
  form.querySelectorAll('[name="type"]').forEach(radio => radio.addEventListener('change', updateIntent));
  another.addEventListener('click', () => { resetForm(); form.elements.name.focus(); });

  function newId() {
    if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    if (!globalThis.crypto || typeof crypto.getRandomValues !== 'function') throw new Error('unsupported');
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function prepareFallback(data) {
    const subject = data.type === 'supplier' ? 'Supplier introduction — Indokalo Connect' : 'Supplier or partner request — Indokalo Connect';
    const body = [
      data.type === 'supplier' ? 'I would like to introduce my business.' : 'I am looking for a supplier or project partner.', '',
      'Name: ' + data.name, 'Company: ' + data.company, 'Business email: ' + data.email,
      'Company country: ' + data.country,
      'Sector: ' + form.elements.sector.options[form.elements.sector.selectedIndex].text,
      '', data.requirements, '', 'Timing / availability: ' + (data.timing || 'Not specified'), '',
      'Please contact me about this request.'
    ].join('\n');
    fallbackLink.href = 'mailto:connect@indokalo.com?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (pending) return;
    ['name', 'company', 'email', 'country', 'requirements', 'timing'].forEach(key => { form.elements[key].value = form.elements[key].value.trim(); });
    // Native validity also gives keyboard and screen-reader users a specific field to correct.
    const minFields = { name: 2, company: 2, country: 2, requirements: 20 };
    for (const [key, min] of Object.entries(minFields)) {
      form.elements[key].setCustomValidity(form.elements[key].value.length < min ? `Please enter at least ${min} characters.` : '');
    }
    if (!form.reportValidity()) return;
    const data = { version: 1, type: intent(), name: form.elements.name.value, email: form.elements.email.value,
      company: form.elements.company.value, country: form.elements.country.value, sector: form.elements.sector.value,
      requirements: form.elements.requirements.value, timing: form.elements.timing.value,
      consent: form.elements.consent.checked, website: form.elements.website.value };
    prepareFallback(data);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    pending = true;
    const controls = fields.querySelectorAll('input, select, textarea, button');
    controls.forEach(control => { control.disabled = true; });
    form.setAttribute('aria-busy', 'true');
    submit.textContent = 'Sending…';
    status.dataset.state = 'pending';
    status.textContent = 'Sending your request securely…';
    fallback.hidden = true;
    try {
      const content = JSON.stringify(data);
      if (content !== lastContent || !submissionId) { submissionId = newId(); lastContent = content; }
      const response = await fetch(CONTACT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'omit', signal: controller.signal, body: JSON.stringify({ ...data, submission_id: submissionId }) });
      let result = null;
      try { result = await response.json(); } catch (_) { /* A successful HTTP response alone is not a receipt. */ }
      if (!response.ok || !result || result.ok !== true) {
        const failure = new Error('unconfirmed');
        failure.httpStatus = response.status;
        throw failure;
      }
      const reference = typeof result.reference === 'string' && /^IC-[a-zA-Z0-9-]{1,40}$/.test(result.reference) ? result.reference : '';
      fields.hidden = true;
      status.dataset.state = 'success';
      status.textContent = 'Request received. Thank you.\nI’ll review your details and reply to the business email you provided.' + (reference ? '\nReference: ' + reference : '') + '\nThis confirms receipt of your enquiry, not an introduction or a supplier agreement.';
      another.hidden = false;
      status.focus();
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.httpStatus === 429
        ? 'The form is busy right now. Your request has not been confirmed. Please try again later or send it by email below.'
        : error.httpStatus === 400
        ? 'We couldn’t accept the form. Please check your details, then try again or send your request by email below.'
        : 'We couldn’t confirm that your request was received. Your details are still here. You can retry safely, or send the request by email below.';
      fallback.hidden = false;
      status.focus();
    } finally {
      clearTimeout(timeout);
      pending = false;
      form.removeAttribute('aria-busy');
      controls.forEach(control => { control.disabled = false; });
      submit.textContent = 'Send my request ↗';
    }
  });
  // Clear a previous minimum-length message as the visitor corrects the field.
  form.addEventListener('input', event => { if (typeof event.target.setCustomValidity === 'function') event.target.setCustomValidity(''); });
  submit.disabled = false;
  updateIntent();
})();

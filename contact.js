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
  const optionalDetails = document.getElementById('optional-details');
  let pending = false;
  let lastContent = '';
  let submissionId = '';
  const INTENTS = {
    buyer: { label: 'What do you need?', hint: 'What are you looking for, and where? A short outline is enough. At least 20 characters.', subject: 'Supplier or partner request', opening: 'I am looking for a supplier or project partner.' },
    supplier: { label: 'What can your company supply?', hint: 'What do you offer, and who would you like to reach? A short outline is enough. At least 20 characters.', subject: 'Commercial supplier introduction', opening: 'I would like to discuss finding customers for my products or services.' },
    business_seller: { label: 'What would you like to explore about selling?', hint: 'Tell me your role and what you’re considering. Keep the business unnamed and leave out confidential details. At least 20 characters.', subject: 'Business sale enquiry', opening: 'I would like an initial conversation about a possible business sale and suitable adviser support.' },
    business_buyer: { label: 'What kind of business are you looking for?', hint: 'What kind of business, and in which countries? Keep it general and leave out confidential details. At least 20 characters.', subject: 'Business acquisition enquiry', opening: 'I would like an initial conversation about acquisition plans and suitable adviser support.' },
    merger: { label: 'What would a merger need to achieve?', hint: 'Tell me your role and what you hope to achieve. Keep potential counterparts unnamed. At least 20 characters.', subject: 'Merger enquiry', opening: 'I would like an initial conversation about a possible merger and suitable adviser support.' }
  };

  function intent() { return form.elements.type.value; }
  function updateIntent() {
    const supplier = intent() === 'supplier';
    const route = INTENTS[intent()] || INTENTS.buyer;
    const ownership = ['business_seller', 'business_buyer', 'merger'].includes(intent());
    document.getElementById('requirements-label').textContent = route.label;
    document.getElementById('requirements-hint').textContent = route.hint;
    document.getElementById('company-label').textContent = ownership ? 'Your organisation or role (optional)' : 'Company (optional)';
    document.getElementById('company-hint').hidden = !ownership;
    document.getElementById('ownership-note').hidden = !ownership;
    const label = document.getElementById('timing-label');
    label.replaceChildren(document.createTextNode(ownership ? 'When would you like to talk? ' : supplier ? 'Availability or lead time ' : 'When is it needed? '));
    const optional = document.createElement('span');
    optional.className = 'optional';
    optional.textContent = '(optional)';
    label.appendChild(optional);
    document.getElementById('timing').placeholder = supplier ? 'Available now, or an estimated lead time' : 'A date, or still exploring';
  }

  function resetForm() {
    form.reset();
    optionalDetails.open = false;
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
      if (Object.hasOwn(INTENTS, link.dataset.intent)) form.elements.type.value = link.dataset.intent;
      updateIntent();
    });
  });
  form.elements.type.addEventListener('change', updateIntent);
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
    const route = INTENTS[data.type] || INTENTS.buyer;
    const subject = route.subject + ' — Indokalo Connect';
    const body = [
      route.opening, '',
      'Name: ' + data.name, 'Email: ' + data.email,
      ...(data.company ? ['Company / role: ' + data.company] : []),
      ...(data.country ? ['Country: ' + data.country] : []),
      ...(data.sector ? ['Sector: ' + form.elements.sector.options[form.elements.sector.selectedIndex].text] : []),
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
    const minFields = { name: 2, requirements: 20 };
    for (const [key, min] of Object.entries(minFields)) {
      form.elements[key].setCustomValidity(form.elements[key].value.length < min ? `Please enter at least ${min} characters.` : '');
    }
    for (const key of ['company', 'country']) {
      const field = form.elements[key];
      field.setCustomValidity(field.value && field.value.length < 2 ? 'Please enter at least 2 characters, or leave this field empty.' : '');
    }
    // Reveal an invalid optional field before the browser tries to focus it.
    if (['company', 'country', 'sector', 'timing'].some(key => !form.elements[key].checkValidity())) {
      optionalDetails.open = true;
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
      status.textContent = 'Request received. Thank you.\nI’ll review your details and reply to the email address you provided.' + (reference ? '\nReference: ' + reference : '') + '\nThis confirms receipt of an initial enquiry. It does not create an introduction, mandate, bid or agreement.';
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
  // Landing-page links can choose a route, but must not replace a restored draft.
  const requestedType = new URLSearchParams(window.location.search).get('type');
  const hasDraft = ['name', 'company', 'email', 'country', 'sector', 'requirements', 'timing']
    .some(key => form.elements[key].value.trim()) || form.elements.consent.checked
    || form.elements.type.value !== (Array.from(form.elements.type.options).find(option => option.defaultSelected)?.value || 'buyer');
  if (!hasDraft && Object.hasOwn(INTENTS, requestedType)) {
    form.elements.type.value = requestedType;
  }
  submit.disabled = false;
  updateIntent();
})();

(() => {
  'use strict';

  /* ---------- helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = (k, d) => { try { const v = localStorage.getItem('rs_' + k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem('rs_' + k, JSON.stringify(v)); } catch { /* storage blocked */ } };

  let cfg = { currency: 'GH₵', maxOrderTotal: 0 };
  let products = [];
  let cart = load('cart', {});          // { productId: qty }
  let months = Number(load('months', 1)) === 2 ? 2 : 1;
  let brand = 'All';
  let query = '';
  let step = 'cart';                    // cart | details | done
  let lastOrder = null;
  let formError = '';
  let submitting = false;

  const money = (n) => `${cfg.currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dueDate = (m) => { const d = new Date(); d.setMonth(d.getMonth() + m); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }); };
  const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  async function api(url, opts) {
    const res = await fetch(url, opts);
    let body = {};
    try { body = await res.json(); } catch { /* not json */ }
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    return body;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  /* ---------- sack artwork (used when a product has no photo) ---------- */
  let sackSeq = 0;
  function sackGroup(accent, brandName, size) {
    const id = 'w' + (++sackSeq);
    const label = esc(String(brandName || '').slice(0, 16));
    return `
      <defs>
        <pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse">
          <path d="M0 .5H6M.5 0V6" stroke="#000" stroke-opacity=".13" stroke-width="1" fill="none"/>
        </pattern>
      </defs>
      <path d="M40 62 Q28 130 36 204 Q38 230 64 232 L136 232 Q162 230 164 204 Q172 130 160 62 Z" fill="${esc(accent)}"/>
      <path d="M40 62 Q28 130 36 204 Q38 230 64 232 L136 232 Q162 230 164 204 Q172 130 160 62 Z" fill="url(#${id})"/>
      <path d="M38 64 L162 64 L168 44 Q156 30 142 40 L126 30 L100 40 L74 30 L58 40 Q44 30 32 44 Z" fill="${esc(accent)}"/>
      <path d="M38 64 L162 64 L168 44 Q156 30 142 40 L126 30 L100 40 L74 30 L58 40 Q44 30 32 44 Z" fill="#fff" fill-opacity=".22"/>
      <path d="M38 64 L162 64" stroke="#000" stroke-opacity=".35" stroke-width="2" stroke-dasharray="5 4"/>
      <rect x="58" y="92" width="84" height="96" rx="3" fill="#f4f1e6" stroke="#16231a" stroke-width="2"/>
      <text x="100" y="112" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-size="14" fill="#16231a">${label}</text>
      <text x="100" y="156" text-anchor="middle" font-family="Barlow Condensed, Arial Narrow, sans-serif" font-weight="800" font-size="${String(size).length > 4 ? 28 : 40}" fill="${esc(accent)}">${esc(size)}</text>
      <text x="100" y="176" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="9" fill="#16231a">RICE</text>`;
  }
  const sackSvg = (accent, b, size) => `<svg viewBox="0 0 200 244" role="img" aria-label="${esc(b)} ${esc(size)} rice sack">${sackGroup(accent, b, size)}</svg>`;

  function drawHero() {
    const a = products[0], b = products.find((p) => p.brand && p.brand !== (a && a.brand)) || a;
    const one = a || { accent: '#7a1f2b', brand: 'Royal Aroma', size: '25kg' };
    const two = b || { accent: '#1f4d7a', brand: 'New York', size: '25kg' };
    $('#heroArt').innerHTML = `
      <svg viewBox="0 0 420 270" aria-hidden="true">
        <g transform="translate(10 18) rotate(-4 100 130) scale(1.02)">${sackGroup(one.accent, one.brand, one.size)}</g>
        <g transform="translate(206 10) rotate(5 100 130) scale(1.08)">${sackGroup(two.accent, two.brand, two.size)}</g>
      </svg>`;
  }

  /* ---------- catalogue ---------- */
  const qtyOf = (id) => cart[id] || 0;
  const cartLines = () => products.filter((p) => qtyOf(p.id) > 0).map((p) => ({ p, qty: qtyOf(p.id) }));
  const cartTotal = () => cartLines().reduce((s, l) => s + l.p.price * l.qty, 0);
  const cartCount = () => cartLines().reduce((s, l) => s + l.qty, 0);

  function renderChips() {
    const brands = ['All', ...new Set(products.map((p) => p.brand).filter(Boolean))];
    $('#chips').innerHTML = brands.map((b) => `<button type="button" class="chip" data-brand="${esc(b)}" aria-pressed="${b === brand}">${esc(b)}</button>`).join('');
  }

  function renderGrid() {
    const q = query.trim().toLowerCase();
    const list = products.filter((p) =>
      (brand === 'All' || p.brand === brand) &&
      (!q || `${p.name} ${p.brand} ${p.size}`.toLowerCase().includes(q)));
    if (!list.length) {
      $('#grid').innerHTML = `<div class="empty">${products.length ? 'No rice matches that search. Clear the filter to see everything.' : 'No products are on sale right now. Please check back soon.'}</div>`;
      return;
    }
    $('#grid').innerHTML = list.map((p) => {
      const n = qtyOf(p.id);
      const art = p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)} ${esc(p.size)}" loading="lazy">` : sackSvg(p.accent, p.brand, p.size);
      const action = n
        ? `<div class="stepper" role="group" aria-label="Quantity of ${esc(p.name)} ${esc(p.size)}"><button type="button" data-dec="${p.id}" aria-label="One less">&minus;</button><span>${n}</span><button type="button" data-inc="${p.id}" aria-label="One more">+</button></div>`
        : `<button type="button" class="btn sm" data-add="${p.id}">Add to cart</button>`;
      return `
        <article class="tag">
          <div class="tag-art">${art}</div>
          <div class="tag-body">
            <div class="tag-brand">${esc(p.brand)}</div>
            <h3>${esc(p.name)}${p.size ? `<span class="size">${esc(p.size)}</span>` : ''}</h3>
            ${p.description ? `<p>${esc(p.description)}</p>` : ''}
            <div class="tag-foot">
              <div class="price">${money(p.price)}<small>or ${money(p.price / 2)} a month for 2 months</small></div>
              ${action}
            </div>
          </div>
        </article>`;
    }).join('');
  }

  function updateBadge() { $('#cartCount').textContent = cartCount(); }

  function setQty(id, qty) {
    qty = Math.max(0, Math.min(50, qty));
    if (qty === 0) delete cart[id]; else cart[id] = qty;
    save('cart', cart);
    updateBadge(); renderGrid();
    if ($('#drawer').classList.contains('on')) renderDrawer();
  }

  /* ---------- drawer ---------- */
  const drawer = $('#drawer'), overlay = $('#overlay');

  function openDrawer(s) {
    step = s || 'cart'; formError = '';
    $('#toast').classList.remove('on');
    renderDrawer();
    drawer.classList.add('on'); overlay.classList.add('on');
    drawer.setAttribute('aria-hidden', 'false');
    const closeBtn = $('#drawerClose'); if (closeBtn) closeBtn.focus();
  }
  function closeDrawer() {
    drawer.classList.remove('on'); overlay.classList.remove('on');
    drawer.setAttribute('aria-hidden', 'true');
  }

  function head(title) {
    return `<div class="drawer-head"><h2 id="drawerTitle">${title}</h2><button class="x" id="drawerClose" type="button" aria-label="Close">&times;</button></div>`;
  }

  function repayText(total, m) {
    const each = total / m;
    return m === 1
      ? `<strong>1 month</strong><span>${money(total)} due by ${dueDate(1)}</span>`
      : `<strong>2 months</strong><span>2 payments of ${money(each)}, last due by ${dueDate(2)}</span>`;
  }

  function renderDrawer() {
    if (step === 'done') return renderDone();
    const lines = cartLines(), total = cartTotal();
    const over = cfg.maxOrderTotal > 0 && total > cfg.maxOrderTotal;

    if (!lines.length) {
      drawer.innerHTML = `${head('Your cart')}
        <div class="drawer-body"><div class="empty">Your cart is empty. Add some rice to get started.</div></div>
        <div class="drawer-foot"><button class="btn block" type="button" data-close>Browse rice</button></div>`;
      return;
    }

    if (step === 'details') {
      const prof = load('profile', {});
      const v = (k) => esc(prof[k] || '');
      drawer.innerHTML = `${head('Your details')}
        <form id="detailsForm" class="form" style="display:contents" novalidate>
          <div class="drawer-body">
            <div class="form">
              <div class="field"><label for="f-name">Full name</label><input id="f-name" name="name" value="${v('name')}" required maxlength="100" autocomplete="name"></div>
              <div class="two">
                <div class="field"><label for="f-id">Employee ID</label><input id="f-id" name="employeeId" value="${v('employeeId')}" required maxlength="50" autocomplete="off"></div>
                <div class="field"><label for="f-phone">Phone <small>(optional)</small></label><input id="f-phone" name="phone" value="${v('phone')}" maxlength="30" autocomplete="tel"></div>
              </div>
              <div class="field"><label for="f-email">Work email</label><input id="f-email" name="email" type="email" value="${v('email')}" required maxlength="255" autocomplete="email"></div>
              <div class="two">
                <div class="field"><label for="f-office">Office name</label><input id="f-office" name="officeName" value="${v('officeName')}" required maxlength="150" autocomplete="organization"></div>
                <div class="field"><label for="f-floor">Floor</label><input id="f-floor" name="floor" value="${v('floor')}" required maxlength="20"></div>
              </div>
              <div class="summary-box">
                <div><span>${cartCount()} item${cartCount() === 1 ? '' : 's'}</span><b>${money(total)}</b></div>
                <div><span>Repayment</span><b>${months === 1 ? '1 month' : '2 months'}</b></div>
                <div><span>${months === 1 ? 'You pay' : 'You pay, each month'}</span><b>${money(total / months)}</b></div>
              </div>
              <p class="err" id="formErr" role="alert">${esc(formError)}</p>
            </div>
          </div>
          <div class="drawer-foot" style="display:grid;grid-template-columns:auto 1fr;gap:10px">
            <button class="btn ghost" type="button" data-back>Back</button>
            <button class="btn" type="submit" ${submitting ? 'disabled' : ''}>${submitting ? 'Sending…' : 'Submit for approval'}</button>
          </div>
        </form>`;
      return;
    }

    // step: cart
    drawer.innerHTML = `${head('Your cart')}
      <div class="drawer-body">
        ${lines.map(({ p, qty }) => `
          <div class="line">
            <div><b>${esc(p.name)}${p.size ? ' ' + esc(p.size) : ''}</b><div class="sub">${money(p.price)} each</div></div>
            <div class="amt">${money(p.price * qty)}</div>
            <div class="stepper" role="group" aria-label="Quantity of ${esc(p.name)} ${esc(p.size)}"><button type="button" data-dec="${p.id}" aria-label="One less">&minus;</button><span>${qty}</span><button type="button" data-inc="${p.id}" aria-label="One more">+</button></div>
            <button class="link-btn" style="color:var(--stamp);justify-self:end;padding:0" type="button" data-remove="${p.id}">Remove</button>
          </div>`).join('')}
        <h3 class="pick-title">How long do you need to pay?</h3>
        <div class="pick" role="radiogroup" aria-label="Repayment period">
          <label><input type="radio" name="months" value="1" ${months === 1 ? 'checked' : ''}>${repayText(total, 1)}</label>
          <label><input type="radio" name="months" value="2" ${months === 2 ? 'checked' : ''}>${repayText(total, 2)}</label>
        </div>
        <p class="note">Dates are estimates. Your repayment is confirmed once the order is approved.</p>
        ${over ? `<div class="warn">Orders on credit are limited to ${money(cfg.maxOrderTotal)}. Remove something to continue.</div>` : ''}
      </div>
      <div class="drawer-foot">
        <div class="sum" style="margin-bottom:12px"><span>Total</span><span class="big">${money(total)}</span></div>
        <button class="btn block" type="button" data-next ${over ? 'disabled' : ''}>Continue</button>
      </div>`;
  }

  function renderDone() {
    const o = lastOrder || {};
    drawer.innerHTML = `${head('Sent')}
      <div class="drawer-body">
        <div class="done">
          <div class="stamp" aria-hidden="true">Sent for<br>approval</div>
          <h3>We have your order</h3>
          <div class="ref">${esc(o.ref)}</div>
          <p>${money(o.total)} over ${o.months} month${o.months === 1 ? '' : 's'}${o.months === 2 ? ` (${money(o.installment)} each)` : ''}.</p>
          <p>Check the answer any time under <b>My orders</b> with your employee ID and email.</p>
        </div>
      </div>
      <div class="drawer-foot" style="display:grid;gap:10px">
        <button class="btn block" type="button" data-track>See my orders</button>
        <button class="btn ghost block" type="button" data-close>Keep shopping</button>
      </div>`;
  }

  async function submitOrder(form) {
    const f = new FormData(form);
    const employee = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()]));
    if (!employee.name || !employee.employeeId || !employee.email || !employee.officeName || !employee.floor) {
      formError = 'Please fill in every field except phone.'; renderDetailsKeepingValues(employee); return;
    }
    submitting = true; formError = ''; renderDetailsKeepingValues(employee);
    try {
      const res = await api('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee, months, items: cartLines().map((l) => ({ productId: l.p.id, qty: l.qty })) }),
      });
      save('profile', employee);
      lastOrder = res; cart = {}; save('cart', cart);
      submitting = false; step = 'done';
      updateBadge(); renderGrid(); renderDrawer();
    } catch (err) {
      submitting = false; formError = err.message; renderDetailsKeepingValues(employee);
    }
  }

  function renderDetailsKeepingValues(values) {
    save('profile', { ...load('profile', {}), ...values });
    renderDrawer();
  }

  /* ---------- order tracking ---------- */
  const modal = $('#modal');
  const STATUS = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Not approved' };

  function orderCard(o) {
    return `
      <article class="order">
        <div class="order-head"><span class="ref">${esc(o.ref)}</span><span class="badge ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span></div>
        <div class="order-body">
          <table>${o.items.map((i) => `<tr><td>${esc(i.name)} &times; ${i.qty}</td><td>${money(i.unitPrice * i.qty)}</td></tr>`).join('')}</table>
          <div class="meta">
            <div><span>Placed</span>${fmtDate(o.createdAt)}</div>
            <div><span>Total</span>${money(o.total)}</div>
            <div><span>Repayment</span>${o.months === 1 ? '1 payment' : `2 payments of ${money(o.installment)}`}</div>
          </div>
          ${o.adminNote ? `<div class="admin-note"><b>Note from the team:</b> ${esc(o.adminNote)}</div>` : ''}
        </div>
      </article>`;
  }

  function openModal() {
    const prof = load('profile', {});
    $('#lkId').value = prof.employeeId || ''; $('#lkEmail').value = prof.email || '';
    $('#lkErr').textContent = ''; $('#lkResults').innerHTML = '';
    modal.classList.add('on'); modal.setAttribute('aria-hidden', 'false');
    closeDrawer();
    (prof.employeeId ? $('#lookupForm button[type=submit]') : $('#lkId')).focus();
  }
  function closeModal() { modal.classList.remove('on'); modal.setAttribute('aria-hidden', 'true'); }

  $('#lookupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const employeeId = $('#lkId').value.trim(), email = $('#lkEmail').value.trim();
    $('#lkErr').textContent = '';
    if (!employeeId || !email) { $('#lkErr').textContent = 'Enter your employee ID and work email.'; return; }
    try {
      const orders = await api('/api/orders/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId, email }) });
      $('#lkResults').innerHTML = orders.length ? orders.map(orderCard).join('') : '<div class="empty" style="margin-top:14px">No orders found for that ID and email. Check both and try again.</div>';
    } catch (err) { $('#lkErr').textContent = err.message; }
  });

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target.closest('button, a, [data-close]');
    if (!t) return;
    const d = t.dataset;
    if (d.add) { setQty(+d.add, 1); toast('Added to your cart'); }
    else if (d.inc) setQty(+d.inc, qtyOf(+d.inc) + 1);
    else if (d.dec) setQty(+d.dec, qtyOf(+d.dec) - 1);
    else if (d.remove) setQty(+d.remove, 0);
    else if (d.brand !== undefined) { brand = d.brand; renderChips(); renderGrid(); }
    else if (d.next !== undefined) { step = 'details'; renderDrawer(); const n = $('#f-name'); if (n) n.focus(); }
    else if (d.back !== undefined) { step = 'cart'; formError = ''; renderDrawer(); }
    else if (d.track !== undefined) openModal();
    else if (d.close !== undefined || t.id === 'drawerClose') closeDrawer();
    else if (t.id === 'cartBtn') openDrawer('cart');
    else if (t.id === 'trackBtn') openModal();
    else if (t.id === 'modalClose') closeModal();
  });
  overlay.addEventListener('click', closeDrawer);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); closeModal(); } });
  $('#search').addEventListener('input', (e) => { query = e.target.value; renderGrid(); });

  drawer.addEventListener('change', (e) => {
    if (e.target.name === 'months') {
      months = Number(e.target.value) === 2 ? 2 : 1; save('months', months);
      renderDrawer();
      const r = drawer.querySelector('input[name=months]:checked'); if (r) r.focus();
    }
  });
  drawer.addEventListener('submit', (e) => {
    if (e.target.id === 'detailsForm') { e.preventDefault(); if (!submitting) submitOrder(e.target); }
  });

  /* ---------- start ---------- */
  (async function init() {
    updateBadge();
    try {
      [cfg, products] = await Promise.all([api('/api/config'), api('/api/products')]);
      // Drop cart lines for products that no longer exist
      const ids = new Set(products.map((p) => String(p.id)));
      Object.keys(cart).forEach((id) => { if (!ids.has(id)) delete cart[id]; });
      save('cart', cart);
      updateBadge(); drawHero(); renderChips(); renderGrid();
    } catch (err) {
      drawHero();
      $('#grid').innerHTML = `<div class="empty">Could not load the products. Check that the server is running and the database connection works.<br><small>${esc(err.message)}</small></div>`;
    }
  })();
})();

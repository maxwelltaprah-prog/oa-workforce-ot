(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let currency = 'GH₵';
  const money = (n) => `${currency} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmt = (iso) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  let key = '';
  try { key = sessionStorage.getItem('rs_admin') || ''; } catch { /* storage blocked */ }
  let orders = [], products = [], tab = 'pending';

  let toastTimer;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  async function api(url, opts = {}) {
    const res = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'x-admin-key': key, ...(opts.headers || {}) } });
    let body = {};
    try { body = await res.json(); } catch { /* not json */ }
    if (res.status === 401) { signOut('Wrong admin password.'); throw new Error(body.error || 'Wrong admin password.'); }
    if (!res.ok) throw new Error(body.error || 'Something went wrong. Please try again.');
    return body;
  }

  function signOut(msg) {
    key = ''; try { sessionStorage.removeItem('rs_admin'); } catch { /* ignore */ }
    $('#app').hidden = true; $('#login').hidden = false; $('#logout').hidden = true;
    $('#loginErr').textContent = msg || '';
  }

  async function start() {
    try {
      const cfg = await fetch('/api/config').then((r) => r.json()); currency = cfg.currency || currency;
      await refresh();
      try { sessionStorage.setItem('rs_admin', key); } catch { /* ignore */ }
      $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false;
      render();
    } catch (err) {
      if (!$('#login').hidden) $('#loginErr').textContent = err.message;
      else $('#appErr').textContent = err.message;
    }
  }

  async function refresh() {
    [orders, products] = await Promise.all([api('/api/admin/orders'), api('/api/admin/products')]);
  }

  /* ---------- tabs ---------- */
  function renderTabs() {
    const n = (s) => orders.filter((o) => o.status === s).length;
    const defs = [['pending', 'Waiting', n('pending')], ['approved', 'Approved', n('approved')], ['rejected', 'Not approved', n('rejected')], ['all', 'All orders', orders.length], ['products', 'Products', products.length]];
    $('#tabs').innerHTML = defs.map(([id, label, count]) => `<button type="button" class="chip" data-tab="${id}" aria-pressed="${tab === id}">${label}<span class="n">${count}</span></button>`).join('');
  }

  function render() { renderTabs(); $('#appErr').textContent = ''; tab === 'products' ? renderProducts() : renderOrders(); }

  /* ---------- orders ---------- */
  const LABEL = { pending: 'Waiting for approval', approved: 'Approved', rejected: 'Not approved' };

  function orderCard(o) {
    return `
      <article class="order" data-order="${o.id}">
        <div class="order-head"><span class="ref">${esc(o.ref)}</span><span class="badge ${o.status}">${LABEL[o.status]}</span></div>
        <div class="order-body">
          <div class="meta">
            <div><span>Employee</span>${esc(o.employeeName)}</div>
            <div><span>Employee ID</span>${esc(o.employeeId)}</div>
            <div><span>Email</span>${esc(o.email)}</div>
            <div><span>Office, floor</span>${esc(o.officeName)}, floor ${esc(o.floor)}</div>
            ${o.phone ? `<div><span>Phone</span>${esc(o.phone)}</div>` : ''}
            <div><span>Placed</span>${fmt(o.createdAt)}</div>
          </div>
          <table>${o.items.map((i) => `<tr><td>${esc(i.name)} &times; ${i.qty}</td><td>${money(i.unitPrice * i.qty)}</td></tr>`).join('')}
            <tr><td><b>Total</b></td><td>${money(o.total)}</td></tr></table>
          <div class="meta"><div><span>Repayment</span>${o.months === 1 ? '1 payment of ' + money(o.total) : '2 payments of ' + money(o.installment)}</div>
            ${o.decidedAt ? `<div><span>Decided</span>${fmt(o.decidedAt)}</div>` : ''}</div>
          ${o.adminNote ? `<div class="admin-note"><b>Note:</b> ${esc(o.adminNote)}</div>` : ''}
          ${o.status === 'pending' ? `
            <div class="field"><label for="note-${o.id}">Note for the employee <small>(optional)</small></label><input id="note-${o.id}" maxlength="500"></div>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button class="btn" type="button" data-decide="approved" data-id="${o.id}">Approve</button>
              <button class="btn danger" type="button" data-decide="rejected" data-id="${o.id}">Do not approve</button>
            </div>` : ''}
        </div>
      </article>`;
  }

  function renderOrders() {
    const list = tab === 'all' ? orders : orders.filter((o) => o.status === tab);
    $('#panel').innerHTML = list.length
      ? list.map(orderCard).join('')
      : `<div class="empty" style="margin-top:14px">${tab === 'pending' ? 'Nothing is waiting for approval.' : 'No orders here yet.'}</div>`;
  }

  /* ---------- products ---------- */
  function productRow(p) {
    const isNew = !p;
    p = p || { name: '', brand: '', size: '', description: '', price: '', imageUrl: '', accent: '#2f6b3a', active: true };
    return `
      <tr class="${isNew ? 'new' : ''}" data-pid="${isNew ? '' : p.id}">
        <td><input type="text" data-f="name" value="${esc(p.name)}" aria-label="Name" placeholder="Product name"></td>
        <td><input type="text" data-f="brand" value="${esc(p.brand)}" aria-label="Brand" placeholder="Brand"></td>
        <td><input type="text" data-f="size" value="${esc(p.size)}" aria-label="Size" placeholder="25kg" style="min-width:60px"></td>
        <td><input type="number" data-f="price" value="${esc(p.price)}" min="0" step="0.01" aria-label="Price" placeholder="0.00" style="min-width:90px"></td>
        <td><input type="text" data-f="description" value="${esc(p.description)}" aria-label="Description" placeholder="Short description"></td>
        <td><input type="url" data-f="imageUrl" value="${esc(p.imageUrl)}" aria-label="Photo link" placeholder="Photo link (optional)"></td>
        <td><input type="color" data-f="accent" value="${esc(p.accent)}" aria-label="Sack colour"></td>
        <td><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''} aria-label="On sale"></td>
        <td><button class="btn sm" type="button" data-save="${isNew ? 'new' : p.id}">${isNew ? 'Add' : 'Save'}</button></td>
      </tr>`;
  }

  function renderProducts() {
    $('#panel').innerHTML = `
      <p class="note">Change a price, then press Save. Untick "On sale" to hide a product from the store. Past orders keep the price they were made at.</p>
      <div class="ptable-wrap"><table class="ptable">
        <thead><tr><th>Name</th><th>Brand</th><th>Size</th><th>Price (${esc(currency)})</th><th>Description</th><th>Photo link</th><th>Colour</th><th>On sale</th><th></th></tr></thead>
        <tbody>${productRow(null)}${products.map(productRow).join('')}</tbody>
      </table></div>`;
  }

  function readRow(tr) {
    const g = (f) => tr.querySelector(`[data-f="${f}"]`);
    return {
      name: g('name').value, brand: g('brand').value, size: g('size').value, description: g('description').value,
      price: g('price').value, imageUrl: g('imageUrl').value, accent: g('accent').value, active: g('active').checked,
    };
  }

  /* ---------- events ---------- */
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    try {
      if (t.dataset.tab) { tab = t.dataset.tab; render(); }
      else if (t.dataset.decide) {
        const id = t.dataset.id, note = ($(`#note-${id}`) || {}).value || '';
        t.disabled = true;
        await api(`/api/admin/orders/${id}/decision`, { method: 'POST', body: JSON.stringify({ status: t.dataset.decide, note }) });
        toast(t.dataset.decide === 'approved' ? 'Order approved' : 'Order not approved');
        await refresh(); render();
      } else if (t.dataset.save) {
        const tr = t.closest('tr'), body = JSON.stringify(readRow(tr));
        if (t.dataset.save === 'new') await api('/api/admin/products', { method: 'POST', body });
        else await api(`/api/admin/products/${t.dataset.save}`, { method: 'PUT', body });
        toast(t.dataset.save === 'new' ? 'Product added' : 'Product saved');
        await refresh(); render();
      } else if (t.id === 'logout') signOut('');
    } catch (err) {
      $('#appErr').textContent = err.message; t.disabled = false;
    }
  });

  $('#loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    key = $('#pw').value; $('#loginErr').textContent = '';
    if (!key) { $('#loginErr').textContent = 'Enter the admin password.'; return; }
    start();
  });

  if (key) start();
})();

require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
// PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD, PGSSLMODE come from .env (local) or Vercel env vars
const pool = new Pool({ max: process.env.VERCEL ? 3 : 10, idleTimeoutMillis: 10000 });

const CURRENCY = process.env.CURRENCY || 'GH₵';
const MAX_ORDER_TOTAL = Number(process.env.MAX_ORDER_TOTAL) || 0; // 0 = no limit
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

/* ------------------------------------------------------------------ */
/* Database setup: creates store_* tables if missing, seeds sample rice */
/* ------------------------------------------------------------------ */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS store_products (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  brand       TEXT NOT NULL DEFAULT '',
  size        TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  price       NUMERIC(12,2) NOT NULL CHECK (price >= 0),
  image_url   TEXT NOT NULL DEFAULT '',
  accent      TEXT NOT NULL DEFAULT '#2f6b3a',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS store_orders (
  id            SERIAL PRIMARY KEY,
  employee_name TEXT NOT NULL,
  employee_id   TEXT NOT NULL,
  email         TEXT NOT NULL,
  office_name   TEXT NOT NULL,
  floor         TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  months        SMALLINT NOT NULL CHECK (months IN (1, 2)),
  total         NUMERIC(12,2) NOT NULL,
  installment   NUMERIC(12,2) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  admin_note    TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at    TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS store_order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES store_orders(id) ON DELETE CASCADE,
  product_id   INTEGER REFERENCES store_products(id),
  product_name TEXT NOT NULL,
  unit_price   NUMERIC(12,2) NOT NULL,
  qty          INTEGER NOT NULL CHECK (qty > 0)
);
CREATE INDEX IF NOT EXISTS store_orders_lookup ON store_orders (lower(email), employee_id);
`;

// Sample products. Prices are placeholders: edit them in Admin > Products.
const SEED = [
  ['Royal Aroma Perfumed Rice', 'Royal Aroma', '5kg',  'Long-grain perfumed rice with a soft, fragrant aroma.', 95,  '#7a1f2b'],
  ['Royal Aroma Perfumed Rice', 'Royal Aroma', '25kg', 'Long-grain perfumed rice with a soft, fragrant aroma.', 430, '#7a1f2b'],
  ['Royal Aroma Perfumed Rice', 'Royal Aroma', '50kg', 'Long-grain perfumed rice with a soft, fragrant aroma.', 820, '#7a1f2b'],
  ['New York Rice',            'New York',    '5kg',  'Everyday long-grain rice, clean and fluffy when cooked.', 80,  '#1f4d7a'],
  ['New York Rice',            'New York',    '25kg', 'Everyday long-grain rice, clean and fluffy when cooked.', 370, '#1f4d7a'],
  ['New York Rice',            'New York',    '50kg', 'Everyday long-grain rice, clean and fluffy when cooked.', 700, '#1f4d7a'],
];

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727270)'); // one starter at a time
    await client.query(SCHEMA_SQL);
    const { rows } = await client.query('SELECT count(*)::int AS n FROM store_products');
    if (rows[0].n === 0) {
      for (const [name, brand, size, description, price, accent] of SEED) {
        await client.query(
          `INSERT INTO store_products (name, brand, size, description, price, accent)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [name, brand, size, description, price, accent]
        );
      }
      console.log('Added sample products. Edit prices in Admin > Products.');
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727270)').catch(() => {});
    client.release();
  }
}

// Runs once per server start; a failed attempt is retried on the next request
let dbReady = null;
const ensureDb = () => dbReady || (dbReady = initDb().catch((err) => { dbReady = null; throw err; }));

/* ------------------------------ helpers ----------------------------- */
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

const money = (n) => Math.round(Number(n) * 100) / 100;
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const mapProduct = (r) => ({
  id: r.id, name: r.name, brand: r.brand, size: r.size, description: r.description,
  price: Number(r.price), imageUrl: r.image_url, accent: r.accent, active: r.active,
});

const mapOrder = (r) => ({
  id: r.id,
  ref: 'ORD-' + String(r.id).padStart(5, '0'),
  employeeName: r.employee_name,
  employeeId: r.employee_id,
  email: r.email,
  officeName: r.office_name,
  floor: r.floor,
  phone: r.phone,
  months: r.months,
  total: Number(r.total),
  installment: Number(r.installment),
  status: r.status,
  adminNote: r.admin_note,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  items: (r.items || []).map((i) => ({ name: i.name, qty: i.qty, unitPrice: Number(i.unitPrice) })),
});

const ORDER_SELECT = `
  SELECT o.*,
    COALESCE((SELECT json_agg(json_build_object('name', i.product_name, 'qty', i.qty, 'unitPrice', i.unit_price) ORDER BY i.id)
              FROM store_order_items i WHERE i.order_id = o.id), '[]'::json) AS items
  FROM store_orders o`;

function adminOnly(req, res, next) {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'Admin is switched off. Add ADMIN_PASSWORD to your .env file and restart.' });
  }
  const given = crypto.createHash('sha256').update(String(req.get('x-admin-key') || '')).digest();
  const wanted = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  if (!crypto.timingSafeEqual(given, wanted)) {
    return res.status(401).json({ error: 'Wrong admin password.' });
  }
  next();
}

/* ------------------------------ static ------------------------------ */
app.use(express.json());
app.use('/api', async (req, res, next) => {
  try { await ensureDb(); next(); }
  catch (err) {
    console.error('Database not ready:', err.message);
    res.status(503).json({ error: 'The store cannot reach its database right now. Please try again shortly.' });
  }
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res, next) => {
  const f = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(f)) return res.sendFile(f);
  res.status(404).send('public/index.html not found. Unzip the project so the "public" folder sits next to server.js.');
});
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

/* ----------------------------- storefront --------------------------- */
app.get('/api/config', (req, res) => res.json({ currency: CURRENCY, maxOrderTotal: MAX_ORDER_TOTAL }));

app.get('/api/products', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM store_products WHERE active ORDER BY brand, price, id');
  res.json(rows.map(mapProduct));
}));

app.post('/api/orders', wrap(async (req, res) => {
  const body = req.body || {};
  const e = body.employee || {};
  const employee = {
    name: str(e.name, 100),
    employeeId: str(e.employeeId, 50),
    email: str(e.email, 255),
    officeName: str(e.officeName, 150),
    floor: str(e.floor, 20),
    phone: str(e.phone, 30),
  };
  if (employee.name.length < 2 || !employee.employeeId || !employee.officeName || !employee.floor) {
    return res.status(400).json({ error: 'Please fill in your name, employee ID, office and floor.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(employee.email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  const months = Number(body.months);
  if (months !== 1 && months !== 2) {
    return res.status(400).json({ error: 'Choose 1 month or 2 months to pay.' });
  }

  // Merge duplicate lines and validate quantities
  const qtyById = new Map();
  for (const it of Array.isArray(body.items) ? body.items.slice(0, 50) : []) {
    const id = Number(it.productId), qty = Number(it.qty);
    if (!Number.isInteger(id) || !Number.isInteger(qty) || qty < 1 || qty > 50) {
      return res.status(400).json({ error: 'One of the quantities is not valid (1 to 50 per item).' });
    }
    qtyById.set(id, (qtyById.get(id) || 0) + qty);
  }
  if (qtyById.size === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Prices always come from the database, never from the browser
    const { rows: prods } = await client.query(
      'SELECT id, name, size, price FROM store_products WHERE active AND id = ANY($1::int[])',
      [[...qtyById.keys()]]
    );
    if (prods.length !== qtyById.size) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'An item in your cart is no longer available. Please refresh the page.' });
    }
    let total = 0;
    const lines = prods.map((p) => {
      const qty = qtyById.get(p.id);
      total += Number(p.price) * qty;
      return { id: p.id, name: p.size ? `${p.name} ${p.size}` : p.name, price: Number(p.price), qty };
    });
    total = money(total);
    if (MAX_ORDER_TOTAL > 0 && total > MAX_ORDER_TOTAL) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: `Orders on credit are limited to ${CURRENCY} ${MAX_ORDER_TOTAL.toFixed(2)}.` });
    }
    const installment = money(total / months);

    const { rows: [order] } = await client.query(
      `INSERT INTO store_orders (employee_name, employee_id, email, office_name, floor, phone, months, total, installment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [employee.name, employee.employeeId, employee.email, employee.officeName, employee.floor, employee.phone, months, total, installment]
    );
    for (const l of lines) {
      await client.query(
        'INSERT INTO store_order_items (order_id, product_id, product_name, unit_price, qty) VALUES ($1,$2,$3,$4,$5)',
        [order.id, l.id, l.name, l.price, l.qty]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ ok: true, id: order.id, ref: 'ORD-' + String(order.id).padStart(5, '0'), total, installment, months });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}));

// Employees look up their own orders with ID + email
app.post('/api/orders/lookup', wrap(async (req, res) => {
  const employeeId = str((req.body || {}).employeeId, 50);
  const email = str((req.body || {}).email, 255);
  if (!employeeId || !email) return res.status(400).json({ error: 'Enter your employee ID and email.' });
  const { rows } = await pool.query(
    `${ORDER_SELECT} WHERE lower(o.email) = lower($1) AND o.employee_id = $2 ORDER BY o.created_at DESC LIMIT 50`,
    [email, employeeId]
  );
  res.json(rows.map(mapOrder));
}));

/* -------------------------------- admin ----------------------------- */
app.get('/api/admin/orders', adminOnly, wrap(async (req, res) => {
  const status = str(req.query.status, 20);
  const where = ['pending', 'approved', 'rejected'].includes(status) ? 'WHERE o.status = $1' : '';
  const { rows } = await pool.query(
    `${ORDER_SELECT} ${where} ORDER BY o.created_at DESC LIMIT 300`,
    where ? [status] : []
  );
  res.json(rows.map(mapOrder));
}));

app.post('/api/admin/orders/:id/decision', adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const status = (req.body || {}).status;
  const note = str((req.body || {}).note, 500);
  if (!Number.isInteger(id) || !['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid decision.' });
  }
  const { rowCount } = await pool.query(
    `UPDATE store_orders SET status = $1, admin_note = $2, decided_at = now()
     WHERE id = $3 AND status = 'pending'`,
    [status, note, id]
  );
  if (!rowCount) return res.status(409).json({ error: 'This order was already decided or does not exist.' });
  res.json({ ok: true });
}));

function readProduct(body) {
  const b = body || {};
  const price = Number(b.price);
  const imageUrl = str(b.imageUrl, 500);
  const p = {
    name: str(b.name, 120),
    brand: str(b.brand, 60),
    size: str(b.size, 30),
    description: str(b.description, 300),
    price: money(price),
    imageUrl,
    accent: /^#[0-9a-fA-F]{6}$/.test(b.accent || '') ? b.accent : '#2f6b3a',
    active: b.active !== false,
  };
  if (!p.name) return { error: 'Product name is required.' };
  if (!Number.isFinite(price) || price < 0) return { error: 'Enter a valid price.' };
  if (imageUrl && !/^(https?:\/\/|\/)/i.test(imageUrl)) return { error: 'Image link must start with http, https or /.' };
  return { p };
}

app.get('/api/admin/products', adminOnly, wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM store_products ORDER BY active DESC, brand, price, id');
  res.json(rows.map(mapProduct));
}));

app.post('/api/admin/products', adminOnly, wrap(async (req, res) => {
  const { p, error } = readProduct(req.body);
  if (error) return res.status(400).json({ error });
  const { rows } = await pool.query(
    `INSERT INTO store_products (name, brand, size, description, price, image_url, accent, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [p.name, p.brand, p.size, p.description, p.price, p.imageUrl, p.accent, p.active]
  );
  res.status(201).json(mapProduct(rows[0]));
}));

app.put('/api/admin/products/:id', adminOnly, wrap(async (req, res) => {
  const id = Number(req.params.id);
  const { p, error } = readProduct(req.body);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product.' });
  if (error) return res.status(400).json({ error });
  const { rows } = await pool.query(
    `UPDATE store_products SET name=$1, brand=$2, size=$3, description=$4, price=$5, image_url=$6, accent=$7, active=$8
     WHERE id=$9 RETURNING *`,
    [p.name, p.brand, p.size, p.description, p.price, p.imageUrl, p.accent, p.active, id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Product not found.' });
  res.json(mapProduct(rows[0]));
}));

module.exports = app;

-- The store creates these tables by itself the first time it starts.
-- You only need this file if your database user is NOT allowed to create tables:
-- ask your DBA to run it, then start the store.
-- All table names start with "store_", so nothing existing is touched.

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

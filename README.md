# Staff Rice Store

Employees pick company rice, choose to pay over 1 or 2 months, and send the order for approval.
Admins approve or decline orders and manage products and prices.

## Run it

1. Copy `.env.example` to `.env` and fill in your Postgres details and an `ADMIN_PASSWORD`.
2. `npm install`
3. `npm start`
4. Store: http://localhost:3000    Admin: http://localhost:3000/admin

The first start creates three tables (`store_products`, `store_orders`, `store_order_items`) and adds
sample rice products. Your existing tables are not touched.

## Before real use

- Sample prices are placeholders. Set the real ones in **Admin > Products**.
- Add a photo to any product by pasting an image link in the "Photo link" column.
  Without one, a rice-sack drawing in the product's colour is shown.
- `MAX_ORDER_TOTAL` in `.env` caps what one employee can take on credit in a single order.

## How it works

- Prices are always read from the database when an order is placed, never from the browser.
- Employees see their order status under **My orders** using employee ID + work email.
  That is a light check, not a login. If you need real sign-in, connect it to your company login.
- Orders can be decided once (approved or not approved). Past orders keep the price they were made at.
- The admin page is protected by `ADMIN_PASSWORD` only. Run it on your internal network.

## Deploy on Vercel

1. Import this GitHub repo in Vercel (framework preset: **Other**, no build command).
2. Add these Environment Variables (Project > Settings > Environment Variables):
   `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE=require`,
   `ADMIN_PASSWORD`, and optionally `CURRENCY`, `MAX_ORDER_TOTAL`.
3. Deploy. The store is at your Vercel URL and the admin page at `/admin`.

**Your database must be reachable from the internet.** Vercel runs in the cloud and cannot reach a
database that only exists on a company network (private IPs such as 10.x.x.x). Vercel's outgoing IP
addresses change, so the database firewall has to accept connections from anywhere (protected by
SSL and a strong password), or you need a Vercel plan with static IPs, or a hosted database
(for example Neon, Supabase or Azure Postgres with public access).

Never commit `.env`. It is already listed in `.gitignore`.

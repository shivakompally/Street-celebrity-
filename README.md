# ThreadCraft Full Stack Store

## Features
- SQL database (SQLite) for users, products, orders, order items
- Admin panel for add/edit/delete stock
- Admin analytics dashboard:
  - paid revenue
  - orders and payment statuses
  - low stock alerts
  - top selling products
- Login/signup with JWT auth
- Cart + checkout flow
- Paytm integration:
  - gateway init endpoint
  - callback/webhook checksum validation
  - server-to-server transaction status verification
  - automatic order status update in SQL
- Order history for logged-in users

## Run locally
1. Install dependencies:
   - `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install`
2. Copy `.env.example` to `.env`
3. Start:
   - `node server.js`
4. Open:
   - `http://localhost:3000`

## Default admin account
- Email: `admin@threadcraft.com`
- Password: `Admin@123`

## Paytm receiver and gateway
- UPI receiver default is `9440991869@paytm` (`PAYTM_UPI_ID`)
- For real gateway verification, set:
  - `PAYTM_MID`
  - `PAYTM_MKEY`
  - `PAYTM_WEBSITE`
  - `PAYTM_HOST`

## Deploy
Use Docker + Caddy instructions in [DEPLOY.md](./DEPLOY.md).

## Hardening + Ops
- Helmet enabled
- Rate limiting enabled (global + auth)
- Audit logs in SQL table: udit_logs`n- Auto payment timeout rollback using PAYMENT_TIMEOUT_MINUTES`n- Admin order cancel/refund workflow in admin panel


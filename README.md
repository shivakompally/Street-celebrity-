# ThreadCraft Full Stack Store

## Features
- SQL database (SQLite) for users, products, orders, order items
- Admin panel for add/edit/delete stock
- Admin analytics dashboard
- Login/signup with JWT auth
- Cart + checkout flow
- Paytm integration (gateway + callback/webhook + server verification)
- Order history for logged-in users

## Run locally
1. Install dependencies:
   - `node "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" install`
2. Copy `.env.example` to `.env` and set secrets.
3. Start:
   - `node server.js`
4. Open:
   - `http://localhost:3000`

## Paytm receiver and gateway
- UPI receiver is set by `PAYTM_UPI_ID`
- For real gateway verification, set:
  - `PAYTM_MID`
  - `PAYTM_MKEY`
  - `PAYTM_WEBSITE`
  - `PAYTM_HOST`

## Deploy
Use Docker + Caddy instructions in `DEPLOY.md`.

## Hardening + Ops
- Helmet enabled
- Rate limiting enabled (global + auth)
- Audit logs in SQL table: `audit_logs`
- Auto payment timeout rollback using `PAYMENT_TIMEOUT_MINUTES`
- Admin order cancel/refund workflow in admin panel

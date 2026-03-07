# Deployment Guide (Production + Domain)

## 1. Server requirements
- Ubuntu 22.04+ VM
- Docker + Docker Compose
- Domain name pointing to your server public IP (`A` record)

## 2. Configure environment
1. Copy `.env.example` to `.env`
2. Set:
   - `DOMAIN` to your real domain (for example `shop.yourdomain.com`)
   - `APP_BASE_URL=https://your-domain`
   - `JWT_SECRET` to a strong secret
   - `PAYTM_MID`, `PAYTM_MKEY`, `PAYTM_WEBSITE`, `PAYTM_HOST`
   - `PAYTM_UPI_ID=9440991869@paytm` (or your preferred receiver UPI)

## 3. Start stack
- `docker compose up -d --build`

Services:
- `app` (Node API + frontend)
- `caddy` (reverse proxy + automatic HTTPS certificate)

## 4. DNS + HTTPS
- Ensure your domain DNS `A` record points to the server IP.
- Caddy will issue TLS certificates automatically once DNS resolves.

## 5. Production DB
- This deployment persists SQLite in docker volume `threadcraft_data`.
- Backup recommendation:
  - `docker exec threadcraft-app sh -c "sqlite3 /app/store.db '.backup /app/data/backup-$(date +%F).db'"`

## 6. Paytm callback/webhook
Set these in Paytm merchant dashboard:
- Callback URL: `https://your-domain/api/payments/paytm/callback`
- Webhook URL: `https://your-domain/api/payments/paytm/webhook`

The server verifies:
1. Checksum signature from Paytm callback/webhook
2. Server-to-server status API (`/v3/order/status`)
3. Updates order status in SQL (`PAID` / `PAYMENT_FAILED`)

## Security Hardening Enabled
- Helmet headers are enabled
- Global API rate limit and strict auth rate limit are enabled
- Audit logs are stored in udit_logs table
- Payment timeout rollback runs every minute (PAYMENT_TIMEOUT_MINUTES)


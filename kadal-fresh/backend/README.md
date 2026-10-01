# Kadal Fresh — Full Fish Shop Website

The complete requirements, API summary, environment setup, migration notes, and production checklist are maintained in the [project README](../README.md).

A complete customer storefront + admin dashboard powered by **Express + SQLite**. SQLite is the source of truth; the browser only keeps a temporary cart in session storage.

## Included

### Customer website
- Responsive storefront and mobile navigation
- Categories, search, sorting and product details
- Weight selection (grams/kg) and quantity controls
- Server-side pricing from the database
- Temporary cart in session storage
- Customer login with phone + OTP flow
- Customer profile and private order history
- Saved delivery addresses and optional browser location permission
- Cash on Delivery only
- Delivery charge controlled by admin settings
- Order code and status tracking: Pending → Confirmed → Preparing → Out for Delivery → Delivered
- Cancelled order state

### Admin dashboard
- Secure admin login with JWT
- Forced first-login password change
- Dashboard statistics
- Add/edit/delete fish
- Upload product images
- Categories
- Price per kg
- Weight options
- Stock in grams
- Availability / stock controls
- Order management and status updates
- COD payment status: Pending / Paid / Failed / Cancelled
- Store settings without editing source code:
  - Shop name
  - Homepage tagline
  - Phone / email / address / hours
  - Delivery charge
  - Free-delivery threshold

## Run on Windows

1. Install Node.js 22 LTS or newer.
2. Extract this ZIP.
3. Double-click `setup.bat` once.
4. Double-click `start.bat`.
5. Open `http://localhost:4000`.

### Manual setup

```powershell
cd backend
copy .env.example .env
npm install
npm start
```

## Initial admin account

- Username: `Selva`
- Initial password: `Selva54321`

The first login is forced to change the password. If you already have an older `kadalfresh.db`, the existing admin account is preserved instead of being overwritten.

## Customer OTP development mode

In development, `.env.example` enables `DEV_OTP_EXPOSE=true`, so the generated OTP is shown on screen instead of requiring a real SMS provider.

For a live deployment, set `NODE_ENV=production`, set `DEV_OTP_EXPOSE=false`, and configure `SMS_OTP_WEBHOOK_URL` (HTTPS) plus `SMS_OTP_WEBHOOK_TOKEN`. The server POSTs `{ phone, otp, message }` to that URL with a bearer token. Production APIs never return OTP values and reject OTP requests if delivery is not configured.

## Production checklist

- Use a strong random `JWT_SECRET` of 32+ characters.
- Set `CORS_ORIGIN` to the exact frontend origin instead of `true`.
- Keep `DEV_OTP_EXPOSE=false` and connect a real SMS provider.
- Use HTTPS.
- Connect a real SMS/OTP provider.
- Prefer secure HttpOnly cookies for a hardened deployment instead of browser token storage.
- Back up SQLite and uploads, or migrate to PostgreSQL/cloud storage when scale requires it.
- Add monitoring, centralized rate limiting and a reverse proxy for public traffic.

## Database

The application creates `kadalfresh.db` automatically on first startup. It contains admins, customers, OTP records, addresses, categories, products, weight options, orders, order items, payments and store settings. Stock migrations run once when the stock column is added; a zero stock level is never reset on later starts.

## Important

No fake online payment gateway is included. Checkout is intentionally COD-only. Prices, stock and order totals are recalculated on the server from SQLite so customers cannot change the price by editing browser data.

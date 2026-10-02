# Kadal Fresh — Full-Stack Fish Shop

Kadal Fresh is a three-tier fish-ordering application:

**Customer/Admin Frontend → Express REST API → SQLite relational database**

The database is the source of truth. Browser session storage is used only for transient UI state such as the current shopping cart and short-lived authentication tokens; products, prices, stock, customers, addresses, orders and payments are stored server-side.

## Features

### Customer
- Customer registration and phone/email + password login with bcrypt-hashed passwords.
- Browse/search/filter fish and categories.
- Select admin-configured weights.
- Add items to a temporary cart.
- Secure checkout with server-side price calculation.
- Cash on Delivery (COD) only.
- Permission-based location sharing with manual address fallback.
- Save/delete delivery addresses.
- View only the authenticated customer's own orders.
- Open an individual public Order Code while still requiring customer ownership authentication.
- Track order status.

### Admin
- JWT-protected admin login.
- Initial admin account is forced to change its password.
- Secure password hashing with bcrypt.
- Product CRUD, categories, prices, weights, stock and images.
- Order management and order-status updates.
- COD payment-status updates.
- Dashboard statistics.
- Protected settings and password change.

### Security
- Role-based authorization (`ADMIN` / `CUSTOMER`).
- Server-side price and stock validation.
- Customer order/address ownership checks.
- Login and registration rate limiting.
- Password length and input validation.
- Security headers.
- Image upload type and size validation.
- Safe API errors without stack traces or credentials.

## Database

The SQLite database is `backend/kadalfresh.db` and is created automatically on first run. WAL mode and foreign-key enforcement are enabled. Additive migrations preserve existing records; legacy stock is backfilled only once when the stock column is first added, so zero stock is not replenished on restart. A starter catalog and first admin are seeded only when their respective tables are empty.

Main tables:

- `admins`
- `customers`
- `categories`
- `products`
- `product_weight_options`
- `addresses`
- `orders`
- `order_items`
- `payments`

Existing databases are migrated additively. Customer IDs and all existing orders, addresses, and relationships are preserved. Existing customer records without a password remain uncredentialed; they are not automatically claimable by phone alone. Contact the shop for a secure migration of those accounts.

## Setup

1. Install Node.js 22 LTS or newer. `better-sqlite3` 13 supports current Node LTS releases and uses prebuilt binaries on supported platforms.
2. Open a terminal in `backend/`.
3. Copy `.env.example` to `.env`.
4. Replace `JWT_SECRET` with a long random secret (at least 32 characters). Never use the example value in production.
5. Install dependencies from the package manifest and lockfile:

```bash
npm install
```

6. Start the server:

```bash
npm start
```

7. Open `http://localhost:4000`.

## Initial Admin

The default development seed is configured in `.env.example`:

- Username: `Selva`
- Initial password: `Selva54321`

The initial password is hashed in the database and the account is flagged to require a password change after first login. Change it immediately. For a real deployment, set a stronger initial password in `.env` before first database initialization.

If an existing database already contains an old admin account, the seed will not overwrite it. Change credentials through the admin settings or update the database deliberately during migration.

## Change Admin Password

Sign in from **Admin login**. On the first login, enter the current password and a new password of at least 12 characters (maximum 72 UTF-8 bytes). Later changes are available under **Settings → Change password**. The old password is required, and changing it invalidates existing admin sessions. Change the development seed password before exposing the server.

The authenticated API is `POST /api/auth/change-password` with `Authorization: Bearer <admin-jwt>` and JSON `{ "currentPassword": "...", "newPassword": "..." }`. It returns `{ "ok": true }` without issuing another token; sign in again with the new password. Password confirmation is checked by the bilingual dashboard form. Passwords are verified and hashed with bcrypt on the server.

## Manage Products and Categories

In the admin dashboard, use **Products → Add fish** to set the name, description, enabled category, price per kg, comma-separated weight options in grams, stock in grams, availability, and optional JPEG/PNG/WebP image (maximum 5 MB). Edit, enable/disable, adjust stock, or delete products from the same table. Use **Categories** to add, rename, enable/disable, or delete categories. Changes are saved to SQLite and appear on the customer storefront without editing source files.

## Temporary Public Hosting

The backend includes a Node 22 Dockerfile for Railway, which provides a generated `*.up.railway.app` URL without buying a domain. A Railway account is required and persistent-volume hosting may require a paid plan. Push this project to a GitHub repository, create a Railway service from it, and set the service root directory to `backend/` (when the repository root is `kadal-fresh/`). Railway will build `backend/Dockerfile`.

Before the first deploy, attach a Railway volume mounted at `/data`, then add these service variables:

```env
NODE_ENV=production
DATABASE_PATH=/data/kadalfresh.db
UPLOAD_DIR=/data/uploads
JWT_SECRET=<random value of at least 32 characters>
SEED_ADMIN_USERNAME=Selva
SEED_ADMIN_PASSWORD=<unique password of at least 12 characters>
```

Railway supplies `PORT`. Generate the domain from the service's Networking settings; the health check is `/api/health`. Set `CORS_ORIGIN` to the generated URL if using another frontend origin. Set real secrets in the hosting service's environment; never commit a populated `.env` file. Never copy the local `.env` or `kadalfresh.db` into a public image. The Docker build excludes both; if you need existing local products/orders, migrate the database and images to `/data` using a secure one-time process.

For immediate sharing before cloud deployment, a temporary HTTPS tunnel can expose a production-configured local server. The computer and server must stay on, the URL may change, and this is not permanent hosting.

## Customer Authentication

Register with `POST /api/auth/customer/register` and sign in with `POST /api/auth/customer/login`. Both return a JWT and a public customer profile; password hashes and plaintext passwords are never returned. Customer endpoints continue to use the existing JWT role and `requireCustomer` middleware.

## COD Payment

Online card/UPI payment is intentionally disabled. Checkout accepts **Cash on Delivery** only.

A COD payment record is created with `pending` status. Admin can mark it `paid` after the cash is collected, or `cancelled` when appropriate.

No fake online-payment success is generated.

## Order Pricing

The browser never determines the final charge.

At order creation, the backend retrieves the current product price and configured weight from SQLite, validates availability/stock, calculates each line total, calculates delivery charge and writes the final order total to the database.

## API Summary

### Public
- `GET /api/categories`
- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/settings`

### Customer Authentication
- `POST /api/auth/customer/register`
- `POST /api/auth/customer/login`
- `GET /api/auth/customer/me`
- `PUT /api/auth/customer/profile`
- `GET /api/auth/customer/addresses`
- `POST /api/auth/customer/addresses`
- `DELETE /api/auth/customer/addresses/:id`

### Customer Orders
- `POST /api/orders`
- `GET /api/orders`
- `GET /api/orders/:orderCode`

### Admin Authentication
- `POST /api/auth/login`
- `GET /api/auth/admin/me`
- `POST /api/auth/change-password`

### Admin
- `GET /api/adminStats` (also `GET /api/admin/stats`)
- Product CRUD at `/api/products`; `includeUnavailable=1` requires an admin token.
- Category CRUD at `/api/categories`; `includeDisabled=1` requires an admin token.
- `GET /api/orders/admin/all`
- `GET /api/orders/admin/:id`
- `PUT /api/orders/:id/status`
- `PUT /api/orders/:id/payment-status`
- `GET/PUT /api/settings`

## Production Checklist

Before deploying publicly, also configure:

- HTTPS/TLS.
- A strong production `JWT_SECRET`.
- Set `NODE_ENV=production` and restrict `CORS_ORIGIN` to the frontend origin(s).
- A secure production admin password.
- Serve behind HTTPS before enabling HSTS; keep the database and uploads protected by host permissions.
- Reverse proxy and process manager.
- Database backups.
- Monitoring/logging.
- Stronger distributed rate limiting if deployed across multiple instances.
- PostgreSQL or another hosted SQL database if scale requires it.
- Cloud/object storage for production product images.
- Domain and secure cookie/token strategy appropriate to the deployment.

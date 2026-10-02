const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');

const backendDir = path.resolve(__dirname, '..');

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function request(baseUrl, endpoint, { token, method = 'GET', body } = {}) {
  const response = await fetch(baseUrl + endpoint, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try { data = await response.json(); } catch (_) { data = null; }
  return { status: response.status, data };
}

test('customer registration, password login, migration, JWT, profile, address and order flows', { timeout: 60000 }, async () => {
  const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadal-customer-auth-'));
  const databasePath = path.join(temporaryDir, 'customer-test.db');
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const password = crypto.randomBytes(24).toString('base64url') + 'Aa1!';
  const wrongPassword = crypto.randomBytes(24).toString('base64url') + 'Bb2!';
  const adminPassword = crypto.randomBytes(24).toString('base64url') + 'Cc3!';
  const shortPassword = crypto.randomBytes(4).toString('hex');
  let serverProcess;
  let capturedError = '';
  let serverDb;

  try {
    process.env.DATABASE_PATH = databasePath;
    process.env.JWT_SECRET = jwtSecret;
    process.env.NODE_ENV = 'test';
    process.env.SEED_ADMIN_USERNAME = 'TestAdmin';
    process.env.SEED_ADMIN_PASSWORD = adminPassword;
    process.env.UPLOAD_DIR = path.join(temporaryDir, 'uploads');

    const initialDb = require('../db');
    const legacyCustomerId = Number(initialDb.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Legacy Customer', '9999999999').lastInsertRowid);
    const legacyAddressId = Number(initialDb.prepare('INSERT INTO addresses (customer_id, address_line) VALUES (?, ?)').run(legacyCustomerId, 'Old delivery address').lastInsertRowid);
    const legacyOrderId = Number(initialDb.prepare(`INSERT INTO orders
      (order_code, customer_id, address_id, subtotal, delivery_charge, total)
      VALUES (?, ?, ?, ?, ?, ?)`).run('KF-LEGACY-ORDER', legacyCustomerId, legacyAddressId, 100, 0, 100).lastInsertRowid);
    initialDb.exec(`
      CREATE TABLE customer_otps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        phone TEXT NOT NULL,
        otp_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
    initialDb.prepare('INSERT INTO customer_otps (customer_id, phone, otp_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(legacyCustomerId, '9999999999', 'old-hash', '2000-01-01T00:00:00.000Z');
    initialDb.close();

    const legacyDb = new Database(databasePath);
    legacyDb.exec('DROP INDEX IF EXISTS idx_customers_email; ALTER TABLE customers DROP COLUMN email; ALTER TABLE customers DROP COLUMN password_hash;');
    legacyDb.close();

    const port = await availablePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    serverProcess = spawn(process.execPath, ['server.js'], {
      cwd: backendDir,
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    serverProcess.stderr.setEncoding('utf8');
    serverProcess.stderr.on('data', chunk => { capturedError += chunk; });

    let healthy = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (serverProcess.exitCode !== null) throw new Error(`Server exited during startup: ${capturedError}`);
      try {
        const response = await fetch(baseUrl + '/api/health');
        if (response.ok) { healthy = true; break; }
      } catch (_) { }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(healthy, true, `Server did not become healthy: ${capturedError}`);

    serverDb = new Database(databasePath, { readonly: true });
    const migratedCustomer = serverDb.prepare('SELECT id, name, phone, email, password_hash FROM customers WHERE id = ?').get(legacyCustomerId);
    assert.equal(migratedCustomer.name, 'Legacy Customer');
    assert.equal(migratedCustomer.phone, '9999999999');
    assert.equal(migratedCustomer.email, null);
    assert.equal(migratedCustomer.password_hash, null);
    assert.equal(serverDb.prepare('SELECT customer_id FROM orders WHERE id = ?').get(legacyOrderId).customer_id, legacyCustomerId);
    assert.equal(serverDb.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'customer_otps'").get(), undefined);
    serverDb.close();
    serverDb = null;

    const legacyLogin = await request(baseUrl, '/api/auth/customer/login', {
      method: 'POST', body: { identifier: '9999999999', password },
    });
    assert.equal(legacyLogin.status, 401);
    const legacyRegistration = await request(baseUrl, '/api/auth/customer/register', {
      method: 'POST', body: { name: 'Someone Else', phone: '9999999999', password, confirmPassword: password },
    });
    assert.equal(legacyRegistration.status, 409);

    const invalidPassword = await request(baseUrl, '/api/auth/customer/register', {
      method: 'POST', body: { name: 'Buyer', phone: '9876543210', password: shortPassword, confirmPassword: shortPassword },
    });
    assert.equal(invalidPassword.status, 400);
    const mismatch = await request(baseUrl, '/api/auth/customer/register', {
      method: 'POST', body: { name: 'Buyer', phone: '9876543210', password, confirmPassword: wrongPassword },
    });
    assert.equal(mismatch.status, 400);

    const registration = await request(baseUrl, '/api/auth/customer/register', {
      method: 'POST',
      body: { name: 'Test Buyer', phone: '9876543210', email: 'Buyer@Example.com', password, confirmPassword: password },
    });
    assert.equal(registration.status, 201);
    assert.equal(registration.data.customer.name, 'Test Buyer');
    assert.equal(registration.data.customer.phone, '9876543210');
    assert.equal(registration.data.customer.email, 'buyer@example.com');
    assert.equal('password' in registration.data, false);
    assert.equal('password_hash' in registration.data, false);
    assert.equal('passwordHash' in registration.data.customer, false);
    const customerId = registration.data.customer.id;
    const customerToken = registration.data.token;
    assert.equal(jwt.verify(customerToken, jwtSecret).role, 'CUSTOMER');

    const credentialDb = new Database(databasePath, { readonly: true });
    const customerRecord = credentialDb.prepare('SELECT id, password_hash FROM customers WHERE id = ?').get(customerId);
    assert.notEqual(customerRecord.password_hash, password);
    assert.equal(bcrypt.compareSync(password, customerRecord.password_hash), true);
    credentialDb.close();

    const phoneLogin = await request(baseUrl, '/api/auth/customer/login', {
      method: 'POST', body: { identifier: '987-654-3210', password },
    });
    assert.equal(phoneLogin.status, 200);
    assert.equal(jwt.verify(phoneLogin.data.token, jwtSecret).id, customerId);
    const emailLogin = await request(baseUrl, '/api/auth/customer/login', {
      method: 'POST', body: { identifier: 'BUYER@example.com', password },
    });
    assert.equal(emailLogin.status, 200);
    const badLogin = await request(baseUrl, '/api/auth/customer/login', {
      method: 'POST', body: { identifier: '9876543210', password: wrongPassword },
    });
    assert.equal(badLogin.status, 401);
    const invalidPhoneLogin = await request(baseUrl, '/api/auth/customer/login', {
      method: 'POST', body: { identifier: 'abc9876543210', password: wrongPassword },
    });
    assert.equal(invalidPhoneLogin.status, 400);

    const noAuthProfile = await request(baseUrl, '/api/auth/customer/me');
    assert.equal(noAuthProfile.status, 401);
    const profile = await request(baseUrl, '/api/auth/customer/me', { token: customerToken });
    assert.equal(profile.status, 200);
    assert.equal(profile.data.id, customerId);
    assert.equal(profile.data.email, 'buyer@example.com');
    assert.equal('password_hash' in profile.data, false);
    const profileUpdate = await request(baseUrl, '/api/auth/customer/profile', {
      method: 'PUT', token: customerToken, body: { name: 'Updated Buyer' },
    });
    assert.equal(profileUpdate.status, 200);
    assert.equal(profileUpdate.data.name, 'Updated Buyer');

    const addressCreation = await request(baseUrl, '/api/auth/customer/addresses', {
      method: 'POST', token: customerToken, body: { line: '12 Test Street' },
    });
    assert.equal(addressCreation.status, 201);
    const addresses = await request(baseUrl, '/api/auth/customer/addresses', { token: customerToken });
    assert.equal(addresses.status, 200);
    assert.equal(addresses.data.length, 1);

    const products = await request(baseUrl, '/api/products');
    assert.equal(products.status, 200);
    const product = products.data.find(item => item.in_stock && item.weights?.length);
    assert.ok(product, 'seed catalog includes an in-stock product with configured weights');
    const checkout = await request(baseUrl, '/api/orders', {
      method: 'POST',
      token: customerToken,
      body: {
        address_id: addressCreation.data.id,
        items: [{ product_id: product.id, weight_grams: product.weights[0], quantity: 1 }],
        payment_method: 'cod',
      },
    });
    assert.equal(checkout.status, 201, JSON.stringify(checkout.data));
    assert.equal(checkout.data.customer.id, customerId);
    assert.equal('password_hash' in checkout.data.customer, false);
    const orderHistory = await request(baseUrl, '/api/orders', { token: customerToken });
    assert.equal(orderHistory.status, 200);
    assert.equal(orderHistory.data.length, 1);
    assert.equal(orderHistory.data[0].id, checkout.data.id);
    const orderDetails = await request(baseUrl, `/api/orders/${checkout.data.order_code}`, { token: customerToken });
    assert.equal(orderDetails.status, 200);
    assert.equal(orderDetails.data.customer.id, customerId);

    const optionalEmailRegistration = await request(baseUrl, '/api/auth/customer/register', {
      method: 'POST',
      body: { name: 'No Email Buyer', phone: '9876543211', password, confirmPassword: password },
    });
    assert.equal(optionalEmailRegistration.status, 201);
    assert.equal(optionalEmailRegistration.data.customer.email, null);

    const limitedRegistration = await request(baseUrl, '/api/auth/customer/register', {
      method: 'POST',
      body: { name: 'Rate Limited', phone: '8765432199', password, confirmPassword: password },
    });
    assert.equal(limitedRegistration.status, 429);

    for (let attempt = 0; attempt < 5; attempt++) {
      const result = await request(baseUrl, '/api/auth/customer/login', {
        method: 'POST', body: { identifier: '9876543210', password: wrongPassword },
      });
      assert.equal(result.status, 401);
    }
    const limitedLogin = await request(baseUrl, '/api/auth/customer/login', {
      method: 'POST', body: { identifier: '9876543210', password: wrongPassword },
    });
    assert.equal(limitedLogin.status, 429);

    const adminLogin = await request(baseUrl, '/api/auth/login', {
      method: 'POST', body: { username: 'TestAdmin', password: adminPassword },
    });
    assert.equal(adminLogin.status, 200);
    assert.equal(jwt.verify(adminLogin.data.token, jwtSecret).role, 'ADMIN');
    assert.equal(adminLogin.data.username, 'TestAdmin');
  } finally {
    if (serverDb?.open) serverDb.close();
    if (serverProcess && serverProcess.exitCode === null) {
      await new Promise(resolve => {
        serverProcess.once('exit', resolve);
        serverProcess.kill();
      });
    }
    fs.rmSync(temporaryDir, { recursive: true, force: true });
  }
});

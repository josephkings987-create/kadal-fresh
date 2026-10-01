const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin, requireCustomer } = require('../middleware/auth');

const router = express.Router();
const configuredOtpTtl = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000);
const OTP_TTL_MS = Number.isFinite(configuredOtpTtl) ? Math.min(Math.max(configuredOtpTtl, 60000), 900000) : 300000;
const OTP_MAX_ATTEMPTS = 5;
const otpHash = (phone, otp) => crypto.createHmac('sha256', process.env.JWT_SECRET).update(`${phone}:${otp}`).digest('hex');
const sign = (payload, expiresIn = '12h') => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });

function normalizePhone(phone) { return String(phone || '').replace(/\D/g, ''); }
function validPhone(phone) { return /^\d{10}$/.test(phone); }

async function deliverOtp(phone, otp) {
  const endpoint = process.env.SMS_OTP_WEBHOOK_URL;
  if (!endpoint) return process.env.NODE_ENV !== 'production';
  let url;
  try { url = new URL(endpoint); } catch (_) { return false; }
  if (url.protocol !== 'https:' && process.env.NODE_ENV === 'production') return false;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.SMS_OTP_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.SMS_OTP_WEBHOOK_TOKEN}` } : {}),
      },
      body: JSON.stringify({ phone, otp, message: `Your Kadal Fresh verification code is ${otp}.` }),
      signal: AbortSignal.timeout(8000),
    });
    return response.ok;
  } catch (_) { return false; }
}

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password || username.length > 100 || password.length > 200) return res.status(400).json({ error: 'Username and password are required.' });
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username.trim());
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) return res.status(401).json({ error: 'Incorrect username or password.' });
  const token = sign({ id: admin.id, username: admin.username, role: 'ADMIN', mustChangePassword: !!admin.must_change_password, authVersion: admin.auth_version });
  res.json({ token, username: admin.username, mustChangePassword: !!admin.must_change_password });
});

router.post('/change-password', requireAdmin, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body || {};
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) return res.status(400).json({ error: 'Current password and new password are required.' });
  if (confirmPassword !== undefined && newPassword !== confirmPassword) return res.status(400).json({ error: 'New passwords do not match.' });
  if (newPassword.length < 12 || Buffer.byteLength(newPassword, 'utf8') > 72) return res.status(400).json({ error: 'New password must be at least 12 characters and no more than 72 UTF-8 bytes.' });
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin || !bcrypt.compareSync(currentPassword, admin.password_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
  if (newPassword === currentPassword) return res.status(400).json({ error: 'New password must be different from the current password.' });
  const hash = bcrypt.hashSync(newPassword, 12);
  db.prepare('UPDATE admins SET password_hash = ?, must_change_password = 0, auth_version = auth_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, admin.id);
  res.json({ ok: true });
});

router.get('/admin/me', requireAdmin, (req, res) => {
  const admin = db.prepare('SELECT id, username, must_change_password FROM admins WHERE id = ?').get(req.admin.id);
  if (!admin) return res.status(404).json({ error: 'Admin not found.' });
  res.json({ id: admin.id, username: admin.username, mustChangePassword: !!admin.must_change_password });
});

router.post('/customer/request-otp', async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!validPhone(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  if (process.env.NODE_ENV === 'production' && (!process.env.SMS_OTP_WEBHOOK_URL || !process.env.SMS_OTP_WEBHOOK_TOKEN)) {
    return res.status(503).json({ error: 'Customer sign-in is temporarily unavailable. Contact the shop administrator.' });
  }
  const recent = db.prepare(`SELECT COUNT(*) AS n FROM customer_otps WHERE phone = ? AND created_at >= datetime('now', '-1 minute')`).get(phone).n;
  if (recent >= 3) return res.status(429).json({ error: 'Too many OTP requests. Please wait a minute.' });
  let customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(phone);
  if (!customer) {
    const info = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run('Customer', phone);
    customer = { id: info.lastInsertRowid, phone, name: 'Customer' };
  }
  const otp = String(crypto.randomInt(100000, 1000000));
  if (process.env.SMS_OTP_WEBHOOK_URL && !await deliverOtp(phone, otp)) return res.status(502).json({ error: 'Could not deliver the verification code. Please try again.' });
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  db.prepare('UPDATE customer_otps SET used_at = CURRENT_TIMESTAMP WHERE phone = ? AND used_at IS NULL').run(phone);
  db.prepare('INSERT INTO customer_otps (customer_id, phone, otp_hash, expires_at) VALUES (?, ?, ?, ?)').run(customer.id, phone, otpHash(phone, otp), expires);
  const response = { ok: true, expiresInSeconds: Math.floor(OTP_TTL_MS / 1000) };
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_OTP_EXPOSE === 'true') response.devOtp = otp;
  res.json(response);
});

router.post('/customer/verify-otp', (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  const otp = String(req.body?.otp || '').trim();
  if (!validPhone(phone) || !/^\d{6}$/.test(otp)) return res.status(400).json({ error: 'Valid phone number and 6-digit OTP are required.' });
  const row = db.prepare(`SELECT * FROM customer_otps WHERE phone = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`).get(phone);
  if (!row) return res.status(401).json({ error: 'OTP not found. Request a new OTP.' });
  if (row.attempts >= OTP_MAX_ATTEMPTS) return res.status(429).json({ error: 'Too many OTP attempts. Request a new OTP.' });
  if (new Date(row.expires_at).getTime() < Date.now()) return res.status(401).json({ error: 'OTP has expired. Request a new OTP.' });
  const expected = Buffer.from(otpHash(phone, otp), 'hex');
  const received = Buffer.from(row.otp_hash, 'hex');
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    db.prepare('UPDATE customer_otps SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return res.status(401).json({ error: 'Invalid OTP.' });
  }
  db.prepare('UPDATE customer_otps SET used_at = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(row.customer_id);
  const token = sign({ id: customer.id, phone: customer.phone, role: 'CUSTOMER' }, '7d');
  res.json({ token, customer: { id: customer.id, name: customer.name, phone: customer.phone } });
});

router.get('/customer/me', requireCustomer, (req, res) => {
  const customer = db.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(req.customer.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const addresses = db.prepare('SELECT id, address_line, latitude, longitude, created_at, updated_at FROM addresses WHERE customer_id = ? ORDER BY updated_at DESC, id DESC').all(customer.id);
  res.json({ ...customer, addresses });
});

router.put('/customer/profile', requireCustomer, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'Enter a valid name.' });
  db.prepare('UPDATE customers SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, req.customer.id);
  res.json(db.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(req.customer.id));
});

router.get('/customer/addresses', requireCustomer, (req, res) => {
  res.json(db.prepare('SELECT * FROM addresses WHERE customer_id = ? ORDER BY updated_at DESC, id DESC').all(req.customer.id));
});

router.post('/customer/addresses', requireCustomer, (req, res) => {
  const line = String(req.body?.line || '').trim();
  if (!line || line.length > 500) return res.status(400).json({ error: 'A valid delivery address is required.' });
  const lat = req.body?.lat == null ? null : Number(req.body.lat);
  const lng = req.body?.lng == null ? null : Number(req.body.lng);
  if ((lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))) return res.status(400).json({ error: 'Invalid location coordinates.' });
  const info = db.prepare('INSERT INTO addresses (customer_id, address_line, latitude, longitude, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)').run(req.customer.id, line, lat, lng);
  res.status(201).json(db.prepare('SELECT * FROM addresses WHERE id = ?').get(info.lastInsertRowid));
});

router.delete('/customer/addresses/:id', requireCustomer, (req, res) => {
  const address = db.prepare('SELECT id FROM addresses WHERE id = ? AND customer_id = ?').get(req.params.id, req.customer.id);
  if (!address) return res.status(404).json({ error: 'Address not found.' });
  if (db.prepare('SELECT 1 FROM orders WHERE address_id = ? LIMIT 1').get(address.id)) return res.status(409).json({ error: 'This address is attached to an order and cannot be deleted.' });
  db.prepare('DELETE FROM addresses WHERE id = ?').run(address.id);
  res.json({ ok: true });
});

module.exports = router;

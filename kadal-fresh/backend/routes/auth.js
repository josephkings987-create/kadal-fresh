const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { requireAdmin, requireCustomer } = require('../middleware/auth');

const router = express.Router();
const sign = (payload, expiresIn = '12h') => jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 12);

function normalizePhone(phone) {
  if (typeof phone !== 'string' || !/^[+\d\s().-]+$/.test(phone.trim())) return '';
  return phone.replace(/\D/g, '');
}
function validPhone(phone) { return /^\d{10}$/.test(phone); }
function normalizeEmail(email) { return String(email || '').trim().toLowerCase(); }
function validEmail(email) { return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function publicCustomer(customer) {
  return { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email || null };
}
function issueCustomerToken(customer) {
  const token = sign({ id: customer.id, phone: customer.phone, role: 'CUSTOMER' }, '7d');
  return { token, customer: publicCustomer(customer) };
}

router.post('/customer/register', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const phone = normalizePhone(req.body?.phone);
  const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim() : req.body?.email;
  const email = rawEmail == null || rawEmail === '' ? null : normalizeEmail(rawEmail);
  const { password, confirmPassword } = req.body || {};
  if (!name || name.length > 100) return res.status(400).json({ error: 'Enter a valid name.' });
  if (!validPhone(phone)) return res.status(400).json({ error: 'Enter a valid 10-digit mobile number.' });
  if (email !== null && !validEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (typeof password !== 'string' || typeof confirmPassword !== 'string' || Array.from(password).length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Password must be at least 12 characters and no more than 72 UTF-8 bytes.' });
  }
  if (password !== confirmPassword) return res.status(400).json({ error: 'New passwords do not match.' });
  if (db.prepare('SELECT 1 FROM customers WHERE phone = ?').get(phone)) {
    return res.status(409).json({ error: 'An account with this phone number already exists. Log in or contact the shop to recover access.' });
  }
  if (email && db.prepare('SELECT 1 FROM customers WHERE email = ? COLLATE NOCASE').get(email)) {
    return res.status(409).json({ error: 'An account with this email address already exists.' });
  }

  const passwordHash = bcrypt.hashSync(password, 12);
  let result;
  try {
    result = db.prepare('INSERT INTO customers (name, phone, email, password_hash) VALUES (?, ?, ?, ?)')
      .run(name, phone, email, passwordHash);
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'An account with this phone number or email already exists.' });
    }
    throw error;
  }
  const customer = db.prepare('SELECT id, name, phone, email FROM customers WHERE id = ?').get(result.lastInsertRowid);
  return res.status(201).json(issueCustomerToken(customer));
});

router.post('/customer/login', (req, res) => {
  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
  const password = req.body?.password;
  if (!identifier || identifier.length > 254 || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Enter your phone or email and password.' });
  }

  const isEmail = identifier.includes('@');
  const email = isEmail ? normalizeEmail(identifier) : null;
  const phone = isEmail ? null : normalizePhone(identifier);
  if ((isEmail && !validEmail(email)) || (!isEmail && !validPhone(phone))) {
    return res.status(400).json({ error: 'Enter a valid 10-digit mobile number or email address.' });
  }

  const customer = isEmail
    ? db.prepare('SELECT id, name, phone, email, password_hash FROM customers WHERE email = ? COLLATE NOCASE').get(email)
    : db.prepare('SELECT id, name, phone, email, password_hash FROM customers WHERE phone = ?').get(phone);
  const passwordMatches = bcrypt.compareSync(password, customer?.password_hash || DUMMY_PASSWORD_HASH);
  if (!customer || !customer.password_hash || !passwordMatches) {
    return res.status(401).json({ error: 'Incorrect phone/email or password.' });
  }
  return res.json(issueCustomerToken(customer));
});

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

router.get('/customer/me', requireCustomer, (req, res) => {
  const customer = db.prepare('SELECT id, name, phone, email FROM customers WHERE id = ?').get(req.customer.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const addresses = db.prepare('SELECT id, address_line, latitude, longitude, created_at, updated_at FROM addresses WHERE customer_id = ? ORDER BY updated_at DESC, id DESC').all(customer.id);
  res.json({ ...customer, addresses });
});

router.put('/customer/profile', requireCustomer, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'Enter a valid name.' });
  db.prepare('UPDATE customers SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(name, req.customer.id);
  res.json(db.prepare('SELECT id, name, phone, email FROM customers WHERE id = ?').get(req.customer.id));
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

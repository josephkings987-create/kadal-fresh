const jwt = require('jsonwebtoken');
const db = require('../db');

function readToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function requireAuth(req, res, next) {
  const token = readToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required.' });
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.auth.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required.' });
    const admin = db.prepare('SELECT id, username, must_change_password, auth_version FROM admins WHERE id = ?').get(req.auth.id);
    if (!admin) return res.status(401).json({ error: 'Admin account is no longer available.' });
    if (Number(req.auth.authVersion || 0) !== Number(admin.auth_version)) return res.status(401).json({ error: 'Admin session has expired. Please log in again.' });
    if (admin.must_change_password && !req.path.endsWith('/change-password')) return res.status(403).json({ error: 'Password change required before using the admin dashboard.' });
    req.admin = { ...req.auth, username: admin.username, mustChangePassword: !!admin.must_change_password };
    next();
  });
}

function requireCustomer(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.auth.role !== 'CUSTOMER') return res.status(403).json({ error: 'Customer access required.' });
    req.customer = req.auth;
    next();
  });
}

module.exports = { requireAdmin, requireCustomer, requireAuth, readToken };

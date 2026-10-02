require('dotenv').config();
const path = require('path');
const db = require('./db');
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');

const authRoutes = require('./routes/auth');
const categoryRoutes = require('./routes/categories');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const adminStatsRoutes = require('./routes/adminStats');
const settingsRoutes = require('./routes/settings');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32
  || (process.env.NODE_ENV === 'production' && /replace-with|example|change-me/i.test(process.env.JWT_SECRET))) {
  console.error('JWT_SECRET is missing or too short. Set a random secret of at least 32 characters in .env.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
const allowedOrigins = (process.env.CORS_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : '*'))
  .split(',').map(origin => origin.trim()).filter(Boolean);
const allowAnyOrigin = process.env.NODE_ENV !== 'production' && (allowedOrigins.includes('*') || allowedOrigins.includes('true'));
app.use(cors({ origin: (origin, callback) => {
  if (!origin || allowAnyOrigin || allowedOrigins.includes(origin)) return callback(null, true);
  callback(null, false);
} }));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

const requestCounts = new Map();
function rateLimit(prefix, windowMs, max) {
  return (req, res, next) => {
    if (!req.path.startsWith(prefix)) return next();
    const key = req.ip + ':' + prefix;
    const now = Date.now();
    const hit = requestCounts.get(key);
    if (!hit || now - hit.start > windowMs) requestCounts.set(key, { start: now, count: 1 });
    else if (++hit.count > max) return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    if (requestCounts.size > 10000) {
      for (const [requestKey, value] of requestCounts) if (now - value.start > windowMs) requestCounts.delete(requestKey);
    }
    next();
  };
}
app.use(rateLimit('/api/auth', 60_000, 30));
app.use(rateLimit('/api/auth/customer/login', 60_000, 10));
app.use(rateLimit('/api/auth/customer/register', 60_000, 5));
app.use(rateLimit('/api/orders', 60_000, 60));

const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, 'uploads'));
app.use('/uploads', express.static(uploadDir, { maxAge: '7d' }));
app.use('/api/auth', authRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminStatsRoutes);
app.use('/api/adminStats', adminStatsRoutes);
app.use('/api/settings', settingsRoutes);
app.get('/api/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch (_) {
    res.status(503).json({ status: 'unavailable' });
  }
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  const status = Number(err.status || err.statusCode) || 500;
  if (status >= 500) console.error(err.message || err);
  res.status(status >= 400 && status < 500 ? status : 500)
    .json({ error: status < 500 ? err.message || 'Invalid request.' : 'Internal server error.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Kadal Fresh server running at http://localhost:${PORT}`));

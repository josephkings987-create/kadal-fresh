// routes/products.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ---- image upload setup ----
const uploadDir = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads'));
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(new Error('Use a JPEG, PNG, or WebP image.'));
    cb(null, true);
  },
});

function parseProductUpload(req, res, next) {
  upload.single('image')(req, res, error => {
    if (!error) return next();
    const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({ error: tooLarge ? 'Image must be 5 MB or smaller.' : error.message || 'Invalid image upload.' });
  });
}

function storeImage(file) {
  if (!file) return null;
  const signatures = [
    { type: 'image/jpeg', ext: '.jpg', bytes: [0xff, 0xd8, 0xff] },
    { type: 'image/png', ext: '.png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
    { type: 'image/webp', ext: '.webp', bytes: [0x52, 0x49, 0x46, 0x46], extra: [0x57, 0x45, 0x42, 0x50] },
  ];
  const signature = signatures.find(s => s.type === file.mimetype && s.bytes.every((byte, i) => file.buffer[i] === byte)
    && (!s.extra || s.extra.every((byte, i) => file.buffer[8 + i] === byte)));
  if (!signature) throw new Error('Uploaded file content is not a valid JPEG, PNG, or WebP image.');
  const filename = `product-${crypto.randomUUID()}${signature.ext}`;
  fs.writeFileSync(path.join(uploadDir, filename), file.buffer, { flag: 'wx' });
  return `/uploads/${filename}`;
}

function removeImage(imageUrl) {
  if (!imageUrl || !/^\/uploads\/product-[\w-]+\.(?:jpg|png|webp)$/.test(imageUrl)) return;
  const filePath = path.join(uploadDir, path.basename(imageUrl));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function attachWeights(product) {
  const weights = db.prepare('SELECT grams FROM product_weight_options WHERE product_id = ? ORDER BY grams')
    .all(product.id).map(r => r.grams);
  return { ...product, weights };
}

function parseWeights(raw) {
  if (!raw) return [];
  const values = String(raw).split(',').map(s => Number(s.trim()));
  if (!values.length || values.some(n => !Number.isSafeInteger(n) || n <= 0 || n > 100000)) throw new Error('Weight options must be whole gram values between 1 and 100000.');
  return [...new Set(values)];
}

function validateCategory(categoryId) {
  if (!categoryId) return null;
  const id = Number(categoryId);
  if (!Number.isSafeInteger(id) || id <= 0 || !db.prepare('SELECT id FROM categories WHERE id = ?').get(id)) throw new Error('Selected category does not exist.');
  return id;
}

function parseStock(raw, fallback = 0) {
  const stock = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 100000000) throw new Error('Stock must be a whole number of grams between 0 and 100000000.');
  return stock;
}

function parseFlag(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true || value === 1 || value === 'true' || value === '1') return 1;
  if (value === false || value === 0 || value === 'false' || value === '0') return 0;
  throw new Error('Availability flags must be true or false.');
}

// ---- Public: list products (search / category / sort) ----
router.get('/', (req, res) => {
  const { category, search, sort, includeUnavailable } = req.query;
  let sql = `SELECT p.*, c.name AS category_name FROM products p
             LEFT JOIN categories c ON c.id = p.category_id WHERE 1=1`;
  const params = [];
  if (includeUnavailable === '1') {
    return requireAdmin(req, res, () => listProducts(req, res, true));
  }
  listProducts(req, res, false);
});

function listProducts(req, res, includeUnavailable) {
  const { category, category_id, search, sort } = req.query;
  let sql = `SELECT p.*, c.name AS category_name FROM products p
             LEFT JOIN categories c ON c.id = p.category_id WHERE 1=1`;
  const params = [];
  if (!includeUnavailable) {
    sql += ' AND p.is_available = 1 AND (p.category_id IS NULL OR c.is_active = 1)';
  }
  if (category) { sql += ' AND c.name = ?'; params.push(category); }
  if (category_id && Number.isSafeInteger(Number(category_id))) { sql += ' AND p.category_id = ?'; params.push(Number(category_id)); }
  if (search) { sql += ' AND p.name LIKE ?'; params.push(`%${String(search).slice(0, 100)}%`); }
  if (sort === 'priceLow') sql += ' ORDER BY p.price_per_kg ASC';
  else if (sort === 'priceHigh') sql += ' ORDER BY p.price_per_kg DESC';
  else sql += ' ORDER BY p.name ASC';
  res.json(db.prepare(sql).all(...params).map(attachWeights));
}

/*
 * Public reads are intentionally limited to active products/categories. Admins
 * may inspect disabled catalog entries with the protected query flag.
 */
router.get('/:id', (req, res, next) => {
  const row = db.prepare(`SELECT p.*, c.name AS category_name, c.is_active AS category_active FROM products p
                           LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Product not found.' });
  if (req.query.includeUnavailable === '1') return requireAdmin(req, res, () => res.json(attachWeights(row)));
  if (!row.is_available || (row.category_id && !row.category_active)) {
    return requireAdmin(req, res, () => res.json(attachWeights(row)));
  }
  res.json(attachWeights(row));
});

/*
 * Admin mutations validate all values before writing so malformed catalog
 * submissions cannot leave a partially-created product behind.
 */
router.post('/', requireAdmin, parseProductUpload, (req, res) => {
  let image_url;
  try {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '');
    const price = Number(req.body?.price_per_kg);
    if (!name || name.length > 120 || description.length > 2000 || !Number.isFinite(price) || price <= 0 || price > 10000000) throw new Error('Enter a valid name (up to 120 characters) and a positive price per kg.');
    const categoryId = validateCategory(req.body.category_id);
    const weights = parseWeights(req.body.weights);
    if (!weights.length) throw new Error('Add at least one valid weight option.');
    const stock = parseStock(req.body.stock_quantity);
    image_url = storeImage(req.file);
    const insert = db.transaction(() => {
      const info = db.prepare(`INSERT INTO products
        (name, category_id, description, price_per_kg, image_url, is_available, in_stock, stock_quantity)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
        name, categoryId, description, price, image_url,
        parseFlag(req.body.is_available, 1), stock > 0 && parseFlag(req.body.in_stock, 1) ? 1 : 0, stock
      );
      const insertWeight = db.prepare('INSERT INTO product_weight_options (product_id, grams) VALUES (?, ?)');
      for (const grams of weights) insertWeight.run(info.lastInsertRowid, grams);
      return info.lastInsertRowid;
    });
    const created = db.prepare('SELECT * FROM products WHERE id = ?').get(insert());
    res.status(201).json(attachWeights(created));
  } catch (error) {
    removeImage(image_url);
    res.status(400).json({ error: error.message || 'Could not save product.' });
  }
});

router.put('/:id', requireAdmin, parseProductUpload, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  let newImage;
  try {
    const name = req.body.name === undefined ? existing.name : String(req.body.name).trim();
    const description = req.body.description === undefined ? existing.description : String(req.body.description);
    const price = req.body.price_per_kg === undefined ? existing.price_per_kg : Number(req.body.price_per_kg);
    const categoryId = req.body.category_id === undefined ? existing.category_id : validateCategory(req.body.category_id);
    const stock = parseStock(req.body.stock_quantity, existing.stock_quantity);
    const weights = req.body.weights === undefined ? null : parseWeights(req.body.weights);
    const stockFlag = parseFlag(req.body.in_stock, existing.stock_quantity === 0 && stock > 0 ? 1 : existing.in_stock);
    if (!name || name.length > 120 || description.length > 2000 || !Number.isFinite(price) || price <= 0 || price > 10000000) throw new Error('Enter a valid name (up to 120 characters) and a positive price per kg.');
    if (weights && !weights.length) throw new Error('Add at least one valid weight option.');
    newImage = storeImage(req.file);
    const imageUrl = newImage || existing.image_url;
    const update = db.transaction(() => {
      db.prepare(`UPDATE products SET name=?, category_id=?, description=?, price_per_kg=?, image_url=?,
        is_available=?, in_stock=?, stock_quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(
        name, categoryId, description, price, imageUrl,
        parseFlag(req.body.is_available, existing.is_available),
        stock > 0 && stockFlag ? 1 : 0,
        stock, existing.id
      );
      if (weights) {
        db.prepare('DELETE FROM product_weight_options WHERE product_id = ?').run(existing.id);
        const insertWeight = db.prepare('INSERT INTO product_weight_options (product_id, grams) VALUES (?, ?)');
        for (const grams of weights) insertWeight.run(existing.id, grams);
      }
    });
    update();
    if (newImage) removeImage(existing.image_url);
    res.json(attachWeights(db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id)));
  } catch (error) {
    removeImage(newImage);
    res.status(400).json({ error: error.message || 'Could not save product.' });
  }
});

// ---- Admin: quick toggle for availability/stock from the dashboard table ----
router.patch('/:id/toggle', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  const newStock = existing.is_available ? 0 : 1;
  db.prepare('UPDATE products SET is_available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStock, req.params.id);
  res.json(attachWeights(db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id)));
});

// ---- Admin: delete product ----
router.delete('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Product not found.' });
  removeImage(existing.image_url);
  db.prepare('DELETE FROM products WHERE id = ?').run(existing.id);
  res.json({ ok: true });
});

module.exports = router;

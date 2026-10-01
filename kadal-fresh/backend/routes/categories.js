// routes/categories.js
const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Public: list categories (customer site uses this to build the shop filters)
router.get('/', (req, res, next) => {
  if (req.query.includeDisabled === '1') return requireAdmin(req, res, next);
  next();
}, (req, res) => {
  const cats = req.query.includeDisabled === '1'
    ? db.prepare('SELECT * FROM categories ORDER BY name').all()
    : db.prepare('SELECT * FROM categories WHERE is_active = 1 ORDER BY name').all();
  res.json(cats);
});

// Admin: create category
router.post('/', requireAdmin, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name || name.length > 80) return res.status(400).json({ error: 'Category name must be between 1 and 80 characters.' });
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
    res.status(201).json({ id: info.lastInsertRowid, name, is_active: 1 });
  } catch (e) {
    res.status(409).json({ error: 'A category with that name already exists.' });
  }
});

// Admin: rename category
router.put('/:id', requireAdmin, (req, res) => {
  const name = req.body?.name === undefined ? undefined : String(req.body.name).trim();
  const isActive = req.body?.is_active;
  if (name !== undefined && (!name || name.length > 80)) return res.status(400).json({ error: 'Category name must be between 1 and 80 characters.' });
  if (name === undefined && isActive === undefined) return res.status(400).json({ error: 'No category changes provided.' });
  const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Category not found.' });
  try {
    db.prepare('UPDATE categories SET name = ?, is_active = ? WHERE id = ?').run(
      name ?? existing.name,
      isActive === undefined ? existing.is_active : (isActive === true || isActive === 1 || isActive === 'true' || isActive === '1' ? 1 : 0),
      existing.id
    );
  } catch (_) { return res.status(409).json({ error: 'A category with that name already exists.' }); }
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(existing.id));
});

// Admin: delete category (products keep existing but lose their category link)
router.delete('/:id', requireAdmin, (req, res) => {
  const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Category not found.' });
  res.json({ ok: true });
});

module.exports = router;

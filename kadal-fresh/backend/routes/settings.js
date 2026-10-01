const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
const KEYS = ['shop_name','tagline','phone','email','address','business_hours','delivery_charge','free_delivery_threshold','currency'];
function readSettings() {
  const rows = db.prepare('SELECT key, value FROM shop_settings').all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}
router.get('/', (req,res) => res.json(readSettings()));
router.put('/', requireAdmin, (req,res) => {
  const body = req.body || {};
  const update = db.prepare('INSERT INTO shop_settings (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP');
  const tx = db.transaction(() => {
    for (const key of KEYS) {
      if (body[key] === undefined) continue;
      const value = String(body[key]).trim();
      if (['shop_name','phone','email','business_hours'].includes(key) && !value) throw new Error(`${key} is required.`);
      if (['delivery_charge','free_delivery_threshold'].includes(key)) {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${key} must be a non-negative number.`);
      }
      update.run(key, value);
    }
  });
  try { tx(); res.json(readSettings()); } catch(e) { res.status(400).json({error:e.message}); }
});
module.exports = router;

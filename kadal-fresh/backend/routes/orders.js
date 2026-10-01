const express = require('express');
const db = require('../db');
const crypto = require('crypto');
const { requireAdmin, requireCustomer } = require('../middleware/auth');

const router = express.Router();
const STATUSES = ['Pending', 'Confirmed', 'Preparing', 'Out for Delivery', 'Delivered', 'Cancelled'];
const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];

function serializeOrder(order) {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const payment = db.prepare('SELECT * FROM payments WHERE order_id = ?').get(order.id);
  const customer = db.prepare('SELECT id, name, phone FROM customers WHERE id = ?').get(order.customer_id);
  const address = db.prepare('SELECT id, address_line, latitude, longitude FROM addresses WHERE id = ?').get(order.address_id);
  return { ...order, items, payment, customer, address };
}

function makeOrderCode() {
  let code;
  do code = 'KF-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  while (db.prepare('SELECT 1 FROM orders WHERE order_code = ?').get(code));
  return code;
}

router.post('/', requireCustomer, (req, res) => {
  const { address_id, address, items, payment_method } = req.body || {};
  if (payment_method !== 'cod') return res.status(400).json({ error: 'Cash on Delivery is the only available payment method.' });
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) return res.status(400).json({ error: 'Cart is empty or invalid.' });

  const tx = db.transaction(() => {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.customer.id);
    if (!customer) throw new Error('Customer account not found.');

    let addr;
    if (address_id) {
      addr = db.prepare('SELECT * FROM addresses WHERE id = ? AND customer_id = ?').get(address_id, customer.id);
      if (!addr) throw new Error('Selected address is not valid.');
    } else {
      const line = String(address?.line || '').trim();
      if (!line || line.length > 500) throw new Error('A delivery address of 1 to 500 characters is required.');
      const lat = address?.lat == null ? null : Number(address.lat);
      const lng = address?.lng == null ? null : Number(address.lng);
      if ((lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) || (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180))) throw new Error('Invalid location coordinates.');
      const info = db.prepare('INSERT INTO addresses (customer_id, address_line, latitude, longitude, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
        .run(customer.id, line, Number.isFinite(lat) ? lat : null, Number.isFinite(lng) ? lng : null);
      addr = db.prepare('SELECT * FROM addresses WHERE id = ?').get(info.lastInsertRowid);
    }

    const quantities = new Map();
    const requestedStock = new Map();
    for (const item of items) {
      const productId = Number(item?.product_id);
      const grams = Number(item?.weight_grams);
      const quantity = Number(item?.quantity);
      if (!Number.isSafeInteger(productId) || !Number.isSafeInteger(grams) || !Number.isSafeInteger(quantity) || productId <= 0 || grams <= 0 || quantity <= 0 || quantity > 50) throw new Error('Invalid cart item.');
      const key = `${productId}:${grams}`;
      quantities.set(key, (quantities.get(key) || 0) + quantity);
      requestedStock.set(productId, (requestedStock.get(productId) || 0) + grams * quantity);
    }
    const products = new Map();
    for (const [productId, grams] of requestedStock) {
      const product = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
      if (!product || !product.is_available || !product.in_stock || product.stock_quantity <= 0) throw new Error(`"${product ? product.name : 'Item'}" is no longer available.`);
      if (grams > product.stock_quantity) throw new Error(`Not enough stock for "${product.name}".`);
      products.set(productId, product);
    }
    const priced = [...quantities].map(([key, quantity]) => {
      const [productId, grams] = key.split(':').map(Number);
      if (quantity > 50) throw new Error('Maximum quantity per item is 50.');
      const product = products.get(productId);
      const validWeight = db.prepare('SELECT 1 FROM product_weight_options WHERE product_id = ? AND grams = ?').get(productId, grams);
      if (!validWeight) throw new Error(`Selected weight is not available for "${product.name}".`);
      const requiredStock = grams * quantity;
      const lineTotal = Math.round((product.price_per_kg * grams / 1000) * quantity);
      return { product, grams, quantity, lineTotal, requiredStock };
    });
    const subtotal = priced.reduce((sum, item) => sum + item.lineTotal, 0);

    const settings = Object.fromEntries(db.prepare('SELECT key, value FROM shop_settings').all().map(r => [r.key, r.value]));
    const deliveryFee = Math.max(0, Number(settings.delivery_charge || 49));
    const freeThreshold = Math.max(0, Number(settings.free_delivery_threshold || 500));
    const delivery_charge = subtotal > 0 && subtotal < freeThreshold ? deliveryFee : 0;
    const total = subtotal + delivery_charge;
    const orderCode = makeOrderCode();
    const orderInfo = db.prepare(`INSERT INTO orders
      (order_code, customer_id, address_id, subtotal, delivery_charge, total, order_status)
      VALUES (?, ?, ?, ?, ?, ?, 'Pending')`).run(orderCode, customer.id, addr.id, subtotal, delivery_charge, total);

    const insertItem = db.prepare(`INSERT INTO order_items
      (order_id, product_id, product_name, weight_grams, quantity, unit_price_per_kg, line_total)
      VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const updateStock = db.prepare(`UPDATE products SET stock_quantity = stock_quantity - ?, in_stock = CASE WHEN stock_quantity - ? <= 0 THEN 0 ELSE 1 END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    for (const p of priced) {
      insertItem.run(orderInfo.lastInsertRowid, p.product.id, p.product.name, p.grams, p.quantity, p.product.price_per_kg, p.lineTotal);
      updateStock.run(p.requiredStock, p.requiredStock, p.product.id);
    }
    db.prepare('INSERT INTO payments (order_id, method, status, amount, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)')
      .run(orderInfo.lastInsertRowid, 'cod', 'pending', total);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(orderInfo.lastInsertRowid);
  });

  try { res.status(201).json(serializeOrder(tx())); }
  catch (e) { res.status(400).json({ error: e.message || 'Could not place order.' }); }
});


router.get('/admin/all', requireAdmin, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders.map(serializeOrder));
});

router.get('/admin/:id', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(serializeOrder(order));
});

router.get('/', requireCustomer, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_at DESC').all(req.customer.id);
  res.json(orders.map(serializeOrder));
});

router.get('/:id', requireCustomer, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE order_code = ? AND customer_id = ?').get(req.params.id, req.customer.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  res.json(serializeOrder(order));
});

router.put('/:id/status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status value.' });
  const tx = db.transaction(() => {
    const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!existing) throw new Error('Order not found.');
    if (existing.order_status === 'Cancelled' && status !== 'Cancelled') throw new Error('Cancelled orders cannot be reopened.');
    if (existing.order_status === 'Delivered' && status === 'Cancelled') throw new Error('Delivered orders cannot be cancelled.');
    if (existing.order_status !== 'Cancelled' && status === 'Cancelled') {
      const payment = db.prepare("SELECT status FROM payments WHERE order_id = ? AND method = 'cod'").get(existing.id);
      if (payment?.status === 'paid') throw new Error('A paid COD order cannot be cancelled.');
      const items = db.prepare('SELECT product_id, weight_grams, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL').all(existing.id);
      const restore = db.prepare('UPDATE products SET stock_quantity = stock_quantity + ?, in_stock = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
      for (const item of items) restore.run(item.weight_grams * item.quantity, item.product_id);
      db.prepare("UPDATE payments SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND method = 'cod' AND status IN ('pending', 'failed')").run(existing.id);
    }
    db.prepare('UPDATE orders SET order_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, req.params.id);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  });
  try { res.json(serializeOrder(tx())); } catch (e) { res.status(400).json({ error: e.message }); }
});

router.put('/:id/payment-status', requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!PAYMENT_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid payment status.' });
  const order = db.prepare('SELECT id, order_status FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.order_status === 'Cancelled' && status !== 'cancelled') return res.status(409).json({ error: 'Cancelled orders cannot have a successful payment status.' });
  db.prepare("UPDATE payments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE order_id = ? AND method = 'cod'").run(status, order.id);
  res.json(serializeOrder(db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id)));
});

module.exports = router;

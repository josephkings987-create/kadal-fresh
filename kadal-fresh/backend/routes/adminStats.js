const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();
function sendStats(req, res) {
  const totalProducts = db.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  const totalCustomers = db.prepare('SELECT COUNT(*) AS n FROM customers').get().n;
  const totalOrders = db.prepare('SELECT COUNT(*) AS n FROM orders').get().n;
  const pendingOrders = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE order_status = 'Pending'`).get().n;
  const deliveredOrders = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE order_status = 'Delivered'`).get().n;
  const revenue = db.prepare(`SELECT COALESCE(SUM(total),0) AS r FROM orders WHERE order_status != 'Cancelled'`).get().r;
  const availableProducts = db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_available = 1 AND in_stock = 1').get().n;
  const unavailableProducts = db.prepare('SELECT COUNT(*) AS n FROM products WHERE is_available = 0 OR in_stock = 0').get().n;
  const codPending = db.prepare("SELECT COUNT(*) AS n FROM payments WHERE method='cod' AND status='pending'").get().n;
  const codPendingAmount = db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM payments WHERE method='cod' AND status='pending'").get().amount;
  res.json({ totalProducts, totalCustomers, totalOrders, pendingOrders, deliveredOrders, revenue, availableProducts, unavailableProducts, codPending, codPendingAmount });
}
router.get('/', requireAdmin, sendStats);
router.get('/stats', requireAdmin, sendStats);
module.exports = router;

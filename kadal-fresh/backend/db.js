const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, 'kadalfresh.db'));
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  auth_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  description TEXT DEFAULT '',
  price_per_kg REAL NOT NULL CHECK (price_per_kg > 0),
  image_url TEXT DEFAULT NULL,
  is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
  in_stock INTEGER NOT NULL DEFAULT 1 CHECK (in_stock IN (0, 1)),
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_weight_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  grams INTEGER NOT NULL CHECK (grams > 0),
  UNIQUE(product_id, grams)
);
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS customer_otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  used_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  address_line TEXT NOT NULL,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_code TEXT UNIQUE NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id),
  address_id INTEGER NOT NULL REFERENCES addresses(id),
  subtotal REAL NOT NULL CHECK (subtotal >= 0),
  delivery_charge REAL NOT NULL DEFAULT 0 CHECK (delivery_charge >= 0),
  total REAL NOT NULL CHECK (total >= 0),
  order_status TEXT NOT NULL DEFAULT 'Pending' CHECK (order_status IN ('Pending', 'Confirmed', 'Preparing', 'Out for Delivery', 'Delivered', 'Cancelled')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  weight_grams INTEGER NOT NULL CHECK (weight_grams > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_per_kg REAL NOT NULL CHECK (unit_price_per_kg >= 0),
  line_total REAL NOT NULL CHECK (line_total >= 0)
);
CREATE TABLE IF NOT EXISTS shop_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  method TEXT NOT NULL CHECK (method = 'cod'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'cancelled')),
  transaction_id TEXT,
  amount REAL NOT NULL CHECK (amount >= 0),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

function hasColumn(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

const hadStockQuantity = hasColumn('products', 'stock_quantity');
ensureColumn('admins', 'must_change_password', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('admins', 'updated_at', 'TEXT');
ensureColumn('admins', 'auth_version', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('categories', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('products', 'stock_quantity', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('addresses', 'updated_at', 'TEXT');
ensureColumn('payments', 'updated_at', 'TEXT');

db.exec(`
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_categories_active ON categories(is_active, name);
CREATE INDEX IF NOT EXISTS idx_products_available ON products(is_available, in_stock);
CREATE INDEX IF NOT EXISTS idx_weights_product ON product_weight_options(product_id);
CREATE INDEX IF NOT EXISTS idx_addresses_customer ON addresses(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_otps_phone ON customer_otps(phone, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(order_status, created_at);
`);

// Backfill legacy databases once, only when the stock column is first added.
if (!hadStockQuantity) db.prepare('UPDATE products SET stock_quantity = CASE WHEN in_stock = 1 THEN 999000 ELSE 0 END').run();

db.prepare('UPDATE admins SET must_change_password = 1 WHERE must_change_password IS NULL').run();

function seedSettings() {
  const defaults = {
    shop_name: 'Kadal Fresh',
    tagline: "Today's catch, at your door by evening.",
    phone: '+91 98765 43210',
    email: 'hello@kadalfresh.in',
    address: 'Your delivery area',
    business_hours: '7 AM – 9 PM, daily',
    delivery_charge: '49',
    free_delivery_threshold: '500',
    currency: 'INR'
  };
  const insert = db.prepare('INSERT OR IGNORE INTO shop_settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) insert.run(key, value);
}

seedSettings();

function seed() {
  const adminCount = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n;
  if (adminCount === 0) {
    const username = process.env.SEED_ADMIN_USERNAME || 'Selva';
    const password = process.env.SEED_ADMIN_PASSWORD || 'Selva54321';
    if (process.env.NODE_ENV === 'production' && (!process.env.SEED_ADMIN_PASSWORD || password.length < 12)) {
      throw new Error('Production requires SEED_ADMIN_PASSWORD to be explicitly set to at least 12 characters before the first database setup.');
    }
    const hash = bcrypt.hashSync(password, 12);
    db.prepare('INSERT INTO admins (username, password_hash, must_change_password) VALUES (?, ?, 1)').run(username, hash);
    console.log(`Seeded admin account "${username}". Password change is required on first login.`);
  }

  const catCount = db.prepare('SELECT COUNT(*) AS n FROM categories').get().n;
  if (catCount === 0) {
    const insertCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
    const insertProduct = db.prepare(`INSERT INTO products
      (name, category_id, description, price_per_kg, image_url, is_available, in_stock, stock_quantity)
      VALUES (?, ?, ?, ?, ?, 1, 1, 999000)`);
    const insertWeight = db.prepare('INSERT INTO product_weight_options (product_id, grams) VALUES (?, ?)');
    const cats = { 'Sea fish': null, 'River fish': null, 'Prawns': null, 'Crab': null };
    for (const name of Object.keys(cats)) cats[name] = insertCat.run(name).lastInsertRowid;
    const starter = [
      ['Seer Fish (Vanjaram)', 'Sea fish', 'Firm, boneless steaks - ideal for frying or curry.', 800, [250, 500, 750, 1000, 1500, 2000]],
      ['Pomfret', 'Sea fish', 'Delicate white flesh, great whole-fried or grilled.', 900, [250, 500, 750, 1000]],
      ['Rohu', 'River fish', 'Classic freshwater fish, perfect for everyday curry.', 320, [500, 1000, 1500, 2000]],
      ['Tiger Prawns', 'Prawns', 'Deveined, cleaned, and ready to cook.', 650, [250, 500, 750, 1000]],
      ['Mackerel', 'Sea fish', 'Rich, oily fish - a South Indian favourite.', 280, [500, 1000, 1500]],
      ['Crab', 'Crab', 'Live-caught, cleaned on request.', 550, [500, 1000]],
    ];
    for (const [name, cat, desc, price, weights] of starter) {
      const productId = insertProduct.run(name, cats[cat], desc, price, null).lastInsertRowid;
      for (const g of weights) insertWeight.run(productId, g);
    }
  }
}
seed();

module.exports = db;

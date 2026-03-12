const path = require("path");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const PaytmChecksum = require("paytmchecksum");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
require("dotenv").config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET || "threadcraft-dev-secret";
const APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
const PAYMENT_TIMEOUT_MINUTES = Number(process.env.PAYMENT_TIMEOUT_MINUTES || 30);

const PAYTM_UPI_ID = process.env.PAYTM_UPI_ID || "9440991869@paytm";
const PAYTM_MERCHANT_NAME = process.env.PAYTM_MERCHANT_NAME || "ThreadCraft";
const PAYTM_MID = process.env.PAYTM_MID || "";
const PAYTM_MKEY = process.env.PAYTM_MKEY || "";
const PAYTM_WEBSITE = process.env.PAYTM_WEBSITE || "WEBSTAGING";
const PAYTM_HOST = process.env.PAYTM_HOST || "https://securegw-stage.paytm.in";

const db = new Database(path.join(__dirname, "store.db"));
db.pragma("journal_mode = WAL");

function hasColumn(table, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  return columns.some((entry) => entry.name === columnName);
}

function ensureColumn(table, columnDef) {
  const [columnName] = columnDef.split(" ");
  if (!hasColumn(table, columnName)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  }
}

function logAudit(action, meta = {}, actorUserId = null, ipAddress = null) {
  db.prepare(
    `INSERT INTO audit_logs (actor_user_id, action, meta_json, ip_address)
     VALUES (?, ?, ?, ?)`
  ).run(actorUserId, action, JSON.stringify(meta), ipAddress || null);
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      image TEXT NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      is_new INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      shipping INTEGER NOT NULL,
      tax INTEGER NOT NULL,
      total_amount INTEGER NOT NULL,
      status TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      payment_ref TEXT,
      shipping_name TEXT NOT NULL,
      shipping_email TEXT NOT NULL,
      shipping_phone TEXT NOT NULL,
      shipping_address TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      unit_price INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      line_total INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id INTEGER,
      action TEXT NOT NULL,
      meta_json TEXT NOT NULL,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(actor_user_id) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
    CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
  `);

  ensureColumn("orders", "paytm_order_id TEXT");
  ensureColumn("orders", "paytm_txn_id TEXT");
  ensureColumn("orders", "paytm_txn_amount TEXT");
  ensureColumn("orders", "paytm_raw_response TEXT");
  ensureColumn("orders", "stock_restored INTEGER NOT NULL DEFAULT 0");

  const count = db.prepare("SELECT COUNT(*) AS count FROM products").get().count;
  if (count === 0) {
    const seedProducts = [
      ["Urban Oversized Tee", "Relaxed cotton tee for daily wear.", "men", 1299, "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=900&q=80", 30, 1],
      ["Classic Linen Shirt", "Lightweight linen shirt for smart looks.", "men", 1699, "https://images.unsplash.com/photo-1598033129183-c4f50c736f10?auto=format&fit=crop&w=900&q=80", 20, 0],
      ["Minimal Co-ord Set", "Soft matching set with modern cut.", "women", 2299, "https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=900&q=80", 18, 1],
      ["Daily Fit Denim", "Flexible fit denim for comfort.", "women", 1999, "https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=900&q=80", 24, 0],
      ["Premium Hoodie", "Heavyweight fleece hoodie.", "men", 2499, "https://images.unsplash.com/photo-1556821840-3a9fa0a1f6b3?auto=format&fit=crop&w=900&q=80", 25, 1],
      ["Soft Rib Top", "Breathable ribbed top.", "women", 1099, "https://images.unsplash.com/photo-1581044777550-4cfa60707c03?auto=format&fit=crop&w=900&q=80", 28, 0],
      ["Cargo Utility Pants", "Tapered cargo with utility pockets.", "men", 2199, "https://images.unsplash.com/photo-1473966968600-fa801b869a1a?auto=format&fit=crop&w=900&q=80", 22, 0],
      ["Satin Night Dress", "Smooth satin evening dress.", "women", 1899, "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80", 16, 1]
    ];

    const insert = db.prepare(
      `INSERT INTO products (name, description, category, price, image, stock, is_new)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    const tx = db.transaction((products) => {
      for (const product of products) {
        insert.run(...product);
      }
    });
    tx(seedProducts);
  }

  const adminEmail = (process.env.ADMIN_EMAIL || "admin@threadcraft.com").toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || "Admin@123";
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync(adminPassword, 10);
    db.prepare(
      "INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 1)"
    ).run("Store Admin", adminEmail, hash);
  }
}

function toPublicProduct(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    category: row.category,
    price: row.price,
    image: row.image,
    stock: row.stock,
    tag: row.is_new ? "new" : ""
  };
}

function authRequired(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ message: "Invalid session" });
  }
}

function adminRequired(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

function signUser(user) {
  const payload = { id: user.id, name: user.name, email: user.email, isAdmin: Boolean(user.is_admin) };
  return {
    token: jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" }),
    user: payload
  };
}

function computeTotals(subtotal) {
  const shipping = subtotal > 4999 || subtotal === 0 ? 0 : 199;
  const tax = Math.round(subtotal * 0.05);
  return { subtotal, shipping, tax, total: subtotal + shipping + tax };
}

function getOrderForUser(orderId, userId) {
  return db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(Number(orderId), Number(userId));
}

function paytmConfigured() {
  if (!PAYTM_MID || !PAYTM_MKEY) return false;
  const length = PAYTM_MKEY.length;
  return length === 16 || length === 24 || length === 32;
}

async function verifyPaytmOrderStatus(paytmOrderId) {
  const body = { mid: PAYTM_MID, orderId: paytmOrderId };
  const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), PAYTM_MKEY);
  const payload = { body, head: { signature } };

  const { data } = await axios.post(`${PAYTM_HOST}/v3/order/status`, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 15000
  });

  return data;
}

function restockOrderItems(orderId) {
  const order = db.prepare("SELECT id, stock_restored FROM orders WHERE id = ?").get(Number(orderId));
  if (!order || order.stock_restored === 1) return false;

  const items = db.prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ?").all(order.id);
  const increment = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
  const mark = db.prepare("UPDATE orders SET stock_restored = 1 WHERE id = ?");

  const tx = db.transaction(() => {
    for (const item of items) {
      increment.run(item.quantity, item.product_id);
    }
    mark.run(order.id);
  });

  tx();
  return true;
}

function updateOrderFromPaytm(paytmOrderId, statusPayload) {
  const resultInfo = statusPayload?.body?.resultInfo || {};
  const txnInfo = statusPayload?.body || {};

  const isSuccess = resultInfo.resultStatus === "TXN_SUCCESS";
  const nextStatus = isSuccess ? "PAID" : "PAYMENT_FAILED";

  db.prepare(
    `UPDATE orders
     SET status = ?,
         payment_ref = ?,
         paytm_txn_id = ?,
         paytm_txn_amount = ?,
         paytm_raw_response = ?
     WHERE paytm_order_id = ?`
  ).run(
    nextStatus,
    txnInfo.txnId || txnInfo.bankTxnId || txnInfo.txnToken || null,
    txnInfo.txnId || null,
    txnInfo.txnAmount || null,
    JSON.stringify(statusPayload),
    paytmOrderId
  );

  const order = db.prepare("SELECT id FROM orders WHERE paytm_order_id = ?").get(paytmOrderId);
  if (order && !isSuccess) {
    restockOrderItems(order.id);
  }

  return { isSuccess, resultInfo, orderId: order ? order.id : null };
}

function sweepPaymentTimeouts() {
  const staleOrders = db
    .prepare(
      `SELECT id
       FROM orders
       WHERE status = 'PAYMENT_INITIATED'
         AND datetime(created_at) <= datetime('now', ?)`
    )
    .all(`-${PAYMENT_TIMEOUT_MINUTES} minutes`);

  if (!staleOrders.length) return;

  const markTimeout = db.prepare("UPDATE orders SET status = 'PAYMENT_TIMEOUT' WHERE id = ?");

  for (const order of staleOrders) {
    markTimeout.run(order.id);
    const restored = restockOrderItems(order.id);
    logAudit("order.payment_timeout", { orderId: order.id, restored }, null, null);
  }
}

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "200kb" }));
app.use(express.urlencoded({ extended: false, limit: "200kb" }));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many requests, please try again later." }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many auth attempts, please try later." }
});

app.use("/api", globalLimiter);
app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, paytmGatewayConfigured: paytmConfigured() });
});

app.post("/api/auth/register", authLimiter, (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || password.length < 6) {
    return res.status(400).json({ message: "Provide valid name, email, and password (min 6)." });
  }

  const normalized = String(email).toLowerCase().trim();
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(normalized);
  if (exists) {
    logAudit("auth.register_exists", { email: normalized }, null, req.ip);
    return res.status(409).json({ message: "Email already exists." });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db
    .prepare("INSERT INTO users (name, email, password_hash, is_admin) VALUES (?, ?, ?, 0)")
    .run(name.trim(), normalized, hash);
  const user = db.prepare("SELECT id, name, email, is_admin FROM users WHERE id = ?").get(result.lastInsertRowid);
  logAudit("auth.register_success", { userId: user.id, email: user.email }, user.id, req.ip);
  res.status(201).json(signUser(user));
});

app.post("/api/auth/login", authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ message: "Email and password are required." });
  }

  const normalized = String(email).toLowerCase().trim();
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(normalized);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    logAudit("auth.login_failed", { email: normalized }, null, req.ip);
    return res.status(401).json({ message: "Invalid email or password." });
  }

  logAudit("auth.login_success", { userId: user.id, email: user.email }, user.id, req.ip);
  res.json(signUser(user));
});

app.get("/api/products", (req, res) => {
  const { category, tag, admin } = req.query;
  const showAll = admin === "1";
  const clauses = [];
  const params = [];

  if (!showAll) clauses.push("stock > 0");
  if (category && category !== "all") {
    clauses.push("category = ?");
    params.push(category);
  }
  if (tag === "new") clauses.push("is_new = 1");

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(`SELECT id, name, description, category, price, image, stock, is_new FROM products ${where} ORDER BY id DESC`)
    .all(...params);

  res.json(rows.map(toPublicProduct));
});

app.get("/api/products/:id", (req, res) => {
  const row = db
    .prepare("SELECT id, name, description, category, price, image, stock, is_new FROM products WHERE id = ?")
    .get(Number(req.params.id));

  if (!row) return res.status(404).json({ message: "Product not found." });
  res.json(toPublicProduct(row));
});

app.get("/api/admin/products", authRequired, adminRequired, (_req, res) => {
  const rows = db
    .prepare("SELECT id, name, description, category, price, image, stock, is_new FROM products ORDER BY id DESC")
    .all();
  res.json(rows.map(toPublicProduct));
});

app.post("/api/admin/products", authRequired, adminRequired, (req, res) => {
  const { name, description, category, price, image, stock, tag } = req.body || {};
  if (!name || !description || !category || !price || !image) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  const result = db
    .prepare(
      `INSERT INTO products (name, description, category, price, image, stock, is_new)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      name.trim(),
      description.trim(),
      category,
      Number(price),
      image.trim(),
      Number(stock || 0),
      tag === "new" ? 1 : 0
    );

  const created = db
    .prepare("SELECT id, name, description, category, price, image, stock, is_new FROM products WHERE id = ?")
    .get(result.lastInsertRowid);

  logAudit("admin.product_create", { productId: created.id, name: created.name }, req.user.id, req.ip);
  res.status(201).json(toPublicProduct(created));
});

app.put("/api/admin/products/:id", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare("SELECT id FROM products WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ message: "Product not found." });

  const { name, description, category, price, image, stock, tag } = req.body || {};
  db.prepare(
    `UPDATE products
     SET name = ?, description = ?, category = ?, price = ?, image = ?, stock = ?, is_new = ?
     WHERE id = ?`
  ).run(
    name.trim(),
    description.trim(),
    category,
    Number(price),
    image.trim(),
    Number(stock || 0),
    tag === "new" ? 1 : 0,
    id
  );

  const updated = db
    .prepare("SELECT id, name, description, category, price, image, stock, is_new FROM products WHERE id = ?")
    .get(id);

  logAudit("admin.product_update", { productId: id }, req.user.id, req.ip);
  res.json(toPublicProduct(updated));
});

app.delete("/api/admin/products/:id", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("DELETE FROM products WHERE id = ?").run(id);
  if (result.changes === 0) return res.status(404).json({ message: "Product not found." });

  logAudit("admin.product_delete", { productId: id }, req.user.id, req.ip);
  res.json({ ok: true });
});

app.get("/api/admin/analytics", authRequired, adminRequired, (_req, res) => {
  const totals = db
    .prepare(
      `SELECT
         COUNT(*) AS totalOrders,
         SUM(CASE WHEN status = 'PAID' THEN total_amount ELSE 0 END) AS paidRevenue,
         SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paidOrders,
         SUM(CASE WHEN status IN ('PENDING_PAYMENT','PAYMENT_INITIATED') THEN 1 ELSE 0 END) AS pendingPayments,
         SUM(CASE WHEN status = 'PAYMENT_FAILED' THEN 1 ELSE 0 END) AS failedPayments,
         SUM(CASE WHEN status = 'PAYMENT_TIMEOUT' THEN 1 ELSE 0 END) AS timeoutPayments,
         SUM(CASE WHEN status = 'REFUNDED' THEN 1 ELSE 0 END) AS refundedOrders,
         SUM(CASE WHEN status = 'CANCELED' THEN 1 ELSE 0 END) AS canceledOrders
       FROM orders`
    )
    .get();

  const customers = db.prepare("SELECT COUNT(*) AS totalCustomers FROM users WHERE is_admin = 0").get();

  const lowStock = db
    .prepare(
      `SELECT id, name, stock
       FROM products
       WHERE stock <= 10
       ORDER BY stock ASC, id DESC
       LIMIT 8`
    )
    .all();

  const topProducts = db
    .prepare(
      `SELECT oi.product_name AS name, SUM(oi.quantity) AS unitsSold
       FROM order_items oi
       INNER JOIN orders o ON o.id = oi.order_id
       WHERE o.status = 'PAID'
       GROUP BY oi.product_name
       ORDER BY unitsSold DESC
       LIMIT 5`
    )
    .all();

  const recentSales = db
    .prepare(
      `SELECT strftime('%Y-%m-%d', created_at) AS day,
              SUM(CASE WHEN status = 'PAID' THEN total_amount ELSE 0 END) AS revenue,
              SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paidOrders
       FROM orders
       WHERE datetime(created_at) >= datetime('now','-7 days')
       GROUP BY strftime('%Y-%m-%d', created_at)
       ORDER BY day ASC`
    )
    .all();

  res.json({
    totalOrders: Number(totals.totalOrders || 0),
    paidRevenue: Number(totals.paidRevenue || 0),
    paidOrders: Number(totals.paidOrders || 0),
    pendingPayments: Number(totals.pendingPayments || 0),
    failedPayments: Number(totals.failedPayments || 0),
    timeoutPayments: Number(totals.timeoutPayments || 0),
    refundedOrders: Number(totals.refundedOrders || 0),
    canceledOrders: Number(totals.canceledOrders || 0),
    totalCustomers: Number(customers.totalCustomers || 0),
    lowStock,
    topProducts,
    recentSales
  });
});

app.get("/api/admin/orders", authRequired, adminRequired, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, user_id, total_amount, status, payment_method, payment_ref, created_at,
              shipping_name, shipping_email, shipping_phone, stock_restored
       FROM orders
       ORDER BY id DESC
       LIMIT 100`
    )
    .all();
  res.json(rows);
});

app.post("/api/admin/orders/:id/cancel", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare("SELECT id, status FROM orders WHERE id = ?").get(id);
  if (!order) return res.status(404).json({ message: "Order not found." });

  if (!["PENDING_PAYMENT", "PAYMENT_INITIATED", "PAYMENT_FAILED", "PAYMENT_TIMEOUT"].includes(order.status)) {
    return res.status(400).json({ message: "Only unpaid/failed orders can be canceled." });
  }

  db.prepare("UPDATE orders SET status = 'CANCELED' WHERE id = ?").run(id);
  const restored = restockOrderItems(id);
  logAudit("admin.order_cancel", { orderId: id, restored }, req.user.id, req.ip);

  res.json({ ok: true, status: "CANCELED", restored });
});

app.post("/api/admin/orders/:id/refund", authRequired, adminRequired, (req, res) => {
  const id = Number(req.params.id);
  const order = db.prepare("SELECT id, status FROM orders WHERE id = ?").get(id);
  if (!order) return res.status(404).json({ message: "Order not found." });

  if (order.status !== "PAID") {
    return res.status(400).json({ message: "Only paid orders can be refunded." });
  }

  db.prepare("UPDATE orders SET status = 'REFUNDED' WHERE id = ?").run(id);
  const restored = restockOrderItems(id);
  logAudit("admin.order_refund", { orderId: id, restored }, req.user.id, req.ip);

  res.json({ ok: true, status: "REFUNDED", restored });
});

app.get("/api/admin/audit-logs", authRequired, adminRequired, (_req, res) => {
  const logs = db
    .prepare(
      `SELECT a.id, a.action, a.meta_json, a.ip_address, a.created_at,
              u.email AS actor_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       ORDER BY a.id DESC
       LIMIT 100`
    )
    .all();
  res.json(logs);
});

app.post("/api/orders", authRequired, (req, res) => {
  const { items, shipping } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Cart is empty." });
  }
  if (!shipping || !shipping.name || !shipping.email || !shipping.phone || !shipping.address) {
    return res.status(400).json({ message: "Complete shipping details." });
  }

  const productById = db.prepare("SELECT id, name, price, stock FROM products WHERE id = ?");

  const normalizedItems = [];
  for (const item of items) {
    const product = productById.get(Number(item.id));
    const quantity = Number(item.quantity || 0);
    if (!product || quantity <= 0) {
      return res.status(400).json({ message: "Invalid cart item." });
    }
    if (product.stock < quantity) {
      return res.status(400).json({ message: `Insufficient stock for ${product.name}.` });
    }
    normalizedItems.push({
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity,
      lineTotal: product.price * quantity
    });
  }

  const subtotal = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const totals = computeTotals(subtotal);

  const createOrder = db.transaction(() => {
    const orderResult = db
      .prepare(
        `INSERT INTO orders (
          user_id, subtotal, shipping, tax, total_amount, status, payment_method,
          shipping_name, shipping_email, shipping_phone, shipping_address
        ) VALUES (?, ?, ?, ?, ?, 'PENDING_PAYMENT', 'paytm', ?, ?, ?, ?)`
      )
      .run(
        req.user.id,
        totals.subtotal,
        totals.shipping,
        totals.tax,
        totals.total,
        shipping.name.trim(),
        shipping.email.trim(),
        shipping.phone.trim(),
        shipping.address.trim()
      );

    const orderId = Number(orderResult.lastInsertRowid);
    const insertItem = db.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const decrement = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");

    for (const item of normalizedItems) {
      insertItem.run(orderId, item.productId, item.productName, item.unitPrice, item.quantity, item.lineTotal);
      decrement.run(item.quantity, item.productId);
    }

    return { orderId, totals };
  });

  const result = createOrder();
  logAudit("order.created", { orderId: result.orderId, total: result.totals.total }, req.user.id, req.ip);
  res.status(201).json({ orderId: result.orderId, ...result.totals, status: "PENDING_PAYMENT" });
});

app.post("/api/payments/paytm/create-transaction", authRequired, async (req, res) => {
  const { orderId, phone, email } = req.body || {};
  const order = getOrderForUser(orderId, req.user.id);
  if (!order) return res.status(404).json({ message: "Order not found." });

  if (!paytmConfigured()) {
    const amount = (order.total_amount / 100).toFixed(2);
    const upiTxn = `TC${order.id}${Date.now()}`;
    const note = encodeURIComponent(`ThreadCraft Order #${order.id}`);
    const payee = encodeURIComponent(PAYTM_UPI_ID);
    const payeeName = encodeURIComponent(PAYTM_MERCHANT_NAME);
    const upiIntent = `upi://pay?pa=${payee}&pn=${payeeName}&am=${amount}&cu=INR&tn=${note}&tr=${upiTxn}`;

    logAudit("payment.paytm_fallback", { orderId: order.id }, req.user.id, req.ip);
    return res.json({
      mode: "upi-fallback",
      payee: PAYTM_UPI_ID,
      amount,
      upiIntent,
      qrImage: `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(upiIntent)}`
    });
  }

  try {
    const paytmOrderId = `TC_${order.id}_${Date.now()}`;
    const amount = (order.total_amount / 100).toFixed(2);

    const body = {
      requestType: "Payment",
      mid: PAYTM_MID,
      websiteName: PAYTM_WEBSITE,
      orderId: paytmOrderId,
      callbackUrl: `${APP_BASE_URL}/api/payments/paytm/callback`,
      txnAmount: { value: amount, currency: "INR" },
      userInfo: { custId: `CUST_${req.user.id}` }
    };

    if (phone) body.mobileNo = String(phone);
    if (email) body.email = String(email);

    const signature = await PaytmChecksum.generateSignature(JSON.stringify(body), PAYTM_MKEY);
    const payload = { body, head: { signature } };

    const { data } = await axios.post(
      `${PAYTM_HOST}/theia/api/v1/initiateTransaction?mid=${PAYTM_MID}&orderId=${paytmOrderId}`,
      payload,
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const txnToken = data?.body?.txnToken;
    const resultInfo = data?.body?.resultInfo;
    if (!txnToken || resultInfo?.resultStatus !== "S") {
      return res.status(400).json({ message: resultInfo?.resultMsg || "Paytm transaction init failed." });
    }

    db.prepare(
      `UPDATE orders
       SET status = 'PAYMENT_INITIATED', paytm_order_id = ?
       WHERE id = ?`
    ).run(paytmOrderId, order.id);

    logAudit("payment.paytm_initiated", { orderId: order.id, paytmOrderId }, req.user.id, req.ip);
    res.json({
      mode: "gateway",
      paytmOrderId,
      mid: PAYTM_MID,
      txnToken,
      amount,
      paymentUrl: `${PAYTM_HOST}/theia/api/v1/showPaymentPage?mid=${PAYTM_MID}&orderId=${paytmOrderId}`
    });
  } catch (error) {
    logAudit("payment.paytm_init_error", { orderId: order.id, error: error.message }, req.user.id, req.ip);
    res.status(500).json({ message: `Paytm init error: ${error.message}` });
  }
});

app.post("/api/payments/paytm/confirm", authRequired, (req, res) => {
  const { orderId, paymentRef } = req.body || {};
  const order = getOrderForUser(orderId, req.user.id);
  if (!order) return res.status(404).json({ message: "Order not found." });

  db.prepare(
    `UPDATE orders
     SET status = 'PAID', payment_ref = ?, paytm_txn_id = ?, paytm_txn_amount = ?
     WHERE id = ?`
  ).run(
    paymentRef ? String(paymentRef) : `UPI-${crypto.randomBytes(6).toString("hex")}`,
    paymentRef ? String(paymentRef) : null,
    (order.total_amount / 100).toFixed(2),
    order.id
  );

  logAudit("payment.fallback_confirmed", { orderId: order.id }, req.user.id, req.ip);
  res.json({ ok: true, status: "PAID" });
});

app.post("/api/payments/paytm/callback", async (req, res) => {
  try {
    if (!paytmConfigured()) return res.status(400).send("Paytm gateway env is not configured.");

    const payload = { ...req.body };
    const signature = payload.CHECKSUMHASH;
    delete payload.CHECKSUMHASH;

    const valid = PaytmChecksum.verifySignature(payload, PAYTM_MKEY, signature);
    if (!valid) {
      logAudit("payment.paytm_callback_invalid_checksum", {}, null, req.ip);
      return res.status(400).send("Invalid checksum.");
    }

    const paytmOrderId = payload.ORDERID;
    const statusPayload = await verifyPaytmOrderStatus(paytmOrderId);
    const updated = updateOrderFromPaytm(paytmOrderId, statusPayload);
    logAudit("payment.paytm_callback_verified", { paytmOrderId, orderId: updated.orderId, success: updated.isSuccess }, null, req.ip);

    const redirect = `${APP_BASE_URL}/orders.html`;
    return res.status(200).send(`<!doctype html><html><body><script>window.location.href='${redirect}'</script>Payment status: ${updated.isSuccess ? "PAID" : "FAILED"}. <a href='${redirect}'>Continue</a></body></html>`);
  } catch (error) {
    logAudit("payment.paytm_callback_error", { error: error.message }, null, req.ip);
    return res.status(500).send(`Paytm callback verification failed: ${error.message}`);
  }
});

app.post("/api/payments/paytm/webhook", async (req, res) => {
  try {
    if (!paytmConfigured()) return res.status(400).json({ message: "Paytm gateway env is not configured." });

    const payload = { ...req.body };
    const signature = payload.CHECKSUMHASH;
    delete payload.CHECKSUMHASH;

    const valid = PaytmChecksum.verifySignature(payload, PAYTM_MKEY, signature);
    if (!valid) {
      logAudit("payment.paytm_webhook_invalid_checksum", {}, null, req.ip);
      return res.status(400).json({ message: "Invalid checksum." });
    }

    const paytmOrderId = payload.ORDERID;
    const statusPayload = await verifyPaytmOrderStatus(paytmOrderId);
    const updated = updateOrderFromPaytm(paytmOrderId, statusPayload);
    logAudit("payment.paytm_webhook_verified", { paytmOrderId, orderId: updated.orderId, success: updated.isSuccess }, null, req.ip);

    res.json({ ok: true, status: updated.isSuccess ? "PAID" : "PAYMENT_FAILED" });
  } catch (error) {
    logAudit("payment.paytm_webhook_error", { error: error.message }, null, req.ip);
    res.status(500).json({ message: error.message });
  }
});

app.get("/api/orders/me", authRequired, (req, res) => {
  const orders = db
    .prepare(
      `SELECT id, subtotal, shipping, tax, total_amount, status, payment_method, payment_ref,
              paytm_order_id, paytm_txn_id, created_at
       FROM orders WHERE user_id = ? ORDER BY id DESC`
    )
    .all(req.user.id);

  const itemStmt = db.prepare(
    `SELECT product_name, unit_price, quantity, line_total
     FROM order_items WHERE order_id = ? ORDER BY id ASC`
  );

  const data = orders.map((order) => ({
    id: order.id,
    subtotal: order.subtotal,
    shipping: order.shipping,
    tax: order.tax,
    total: order.total_amount,
    status: order.status,
    paymentMethod: order.payment_method,
    paymentRef: order.payment_ref,
    paytmOrderId: order.paytm_order_id,
    paytmTxnId: order.paytm_txn_id,
    createdAt: order.created_at,
    items: itemStmt.all(order.id)
  }));

  res.json(data);
});

app.get("/api/admin/db/export", authRequired, adminRequired, (_req, res) => {
  const tables = ["users", "products", "orders", "order_items", "audit_logs"];
  const dump = {};

  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all();
    dump[table] = rows;
  }

  logAudit("admin.db_export", { tables: Object.keys(dump) }, req.user.id, req.ip);
  res.json({ tables: dump });
});

app.post("/api/admin/db/import", authRequired, adminRequired, (req, res) => {
  const { tables, replace } = req.body || {};
  if (!tables || typeof tables !== "object") {
    return res.status(400).json({ message: "Invalid payload. Expected { tables: {..} }." });
  }
  if (replace !== true) {
    return res.status(400).json({ message: "Set replace=true to import and overwrite existing data." });
  }

  const order = ["order_items", "orders", "products", "users", "audit_logs"];

  const tx = db.transaction(() => {
    for (const table of order) {
      db.prepare(`DELETE FROM ${table}`).run();
    }

    for (const [table, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows) || rows.length === 0) continue;
      const columns = Object.keys(rows[0]);
      const placeholders = columns.map(() => "?").join(", ");
      const stmt = db.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`);

      for (const row of rows) {
        stmt.run(columns.map((col) => row[col]));
      }
    }
  });

  tx();
  logAudit("admin.db_import", { tables: Object.keys(tables) }, req.user.id, req.ip);
  res.json({ ok: true });
});

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "index.html"));
});

initDb();
setInterval(sweepPaymentTimeouts, 60 * 1000);
app.listen(PORT, () => {
  console.log(`ThreadCraft server running on http://localhost:${PORT}`);
});




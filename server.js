require("dotenv").config();

const path = require("path");
const fs = require("fs");
const express = require("express");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const session = require("express-session");
const Database = require("better-sqlite3");

const app = express();

// Render(Proxy)配下で secure cookie 判定に必要
app.set("trust proxy", 1);

// ===== Security middlewares =====
app.use(helmet());

// JSONはWebhook以外で使う
app.use((req, res, next) => {
  // Stripe webhookだけは raw が必要なので後で個別に処理する
  if (req.originalUrl === "/stripe/webhook") return next();
  express.json({ limit: "200kb" })(req, res, next);
});

// 静的配信
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// ルートは広告へ
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ad.html"));
});

// ===== Stripe =====
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error("❌ STRIPE_SECRET_KEY が環境変数に設定されていません");
  process.exit(1);
}
const stripe = Stripe(stripeSecret);

const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ===== Session (Admin) =====
if (!process.env.SESSION_SECRET) {
  console.error("❌ SESSION_SECRET が環境変数に設定されていません");
  process.exit(1);
}

app.use(
  session({
    name: "pb.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production", // Renderはproduction扱いにしたいなら envでNODE_ENV=production
      maxAge: 1000 * 60 * 60 * 6, // 6時間
    },
  })
);

function requireAdmin(req, res, next) {
  if (req.session && req.session.admin === true) return next();
  return res.status(401).json({ error: "unauthorized" });
}

// ===== DB (SQLite) =====
fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
const db = new Database(path.join(__dirname, "data", "app.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orderId TEXT UNIQUE,
  name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  paymentMethod TEXT,
  konbiniStore TEXT,
  amount INTEGER,
  currency TEXT,
  status TEXT,
  stripeSessionId TEXT,
  stripePaymentIntentId TEXT,
  createdAt TEXT,
  paidAt TEXT
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  email TEXT,
  subject TEXT,
  message TEXT,
  createdAt TEXT
);
`);

const stmtInsertOrder = db.prepare(`
INSERT INTO orders (orderId, name, phone, email, address, paymentMethod, konbiniStore, amount, currency, status, createdAt)
VALUES (@orderId, @name, @phone, @email, @address, @paymentMethod, @konbiniStore, @amount, @currency, @status, @createdAt)
`);

const stmtUpdateOrderByOrderId = db.prepare(`
UPDATE orders SET
  status=@status,
  stripeSessionId=COALESCE(@stripeSessionId, stripeSessionId),
  stripePaymentIntentId=COALESCE(@stripePaymentIntentId, stripePaymentIntentId),
  paidAt=COALESCE(@paidAt, paidAt)
WHERE orderId=@orderId
`);

const stmtGetOrderByOrderId = db.prepare(`SELECT * FROM orders WHERE orderId=?`);

const stmtOrdersByDate = db.prepare(`
SELECT * FROM orders
WHERE date(createdAt) = date(?)
ORDER BY createdAt DESC
`);

const stmtSalesDay = db.prepare(`
SELECT COALESCE(SUM(amount),0) AS total
FROM orders
WHERE status='paid'
  AND strftime('%Y', createdAt)=?
  AND strftime('%m', createdAt)=?
  AND strftime('%d', createdAt)=?
`);

const stmtSalesMonth = db.prepare(`
SELECT COALESCE(SUM(amount),0) AS total
FROM orders
WHERE status='paid'
  AND strftime('%Y', createdAt)=?
  AND strftime('%m', createdAt)=?
`);

const stmtSalesYear = db.prepare(`
SELECT COALESCE(SUM(amount),0) AS total
FROM orders
WHERE status='paid'
  AND strftime('%Y', createdAt)=?
`);

const stmtInsertContact = db.prepare(`
INSERT INTO contacts (name, email, subject, message, createdAt)
VALUES (@name, @email, @subject, @message, @createdAt)
`);

// ===== Mail (SMTP) =====
function buildTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "465");
  const secure = String(process.env.SMTP_SECURE || "true") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
}

async function sendPurchaseMail({ to, name, orderId, amount, paymentMethod }) {
  const transporter = buildTransporter();
  if (!transporter) {
    console.warn("⚠ SMTP未設定のためメール送信をスキップしました");
    return;
  }

  const from = process.env.MAIL_FROM || process.env.SMTP_USER || "no-reply@example.com";
  const subject = "【ご注文ありがとうございます】";
  const text = `${name} 様

ご注文ありがとうございます。
注文ID: ${orderId}
金額: ¥${amount}
支払方法: ${paymentMethod}

※本メールは学習用デモです。`;

  await transporter.sendMail({ from, to, subject, text });
}

// ===== Product =====
const PRODUCT = {
  name: "Premium Supplement（デモ）",
  unitAmount: 4980,
  currency: "jpy",
};

// ===== Rate limit (admin login) =====
const adminLoginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

// ===== Checkout Session =====
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { name, phone, email, address, paymentMethod, konbiniStore } = req.body || {};
    if (!name || !phone || !email || !address) {
      return res.status(400).json({ error: "必須項目が不足しています" });
    }

    const orderId = "ord_" + Date.now();
    const createdAt = new Date().toISOString();

    // 先にDBへ pending を保存
    stmtInsertOrder.run({
      orderId,
      name,
      phone,
      email,
      address,
      paymentMethod: paymentMethod || "card",
      konbiniStore: paymentMethod === "konbini" ? (konbiniStore || null) : null,
      amount: PRODUCT.unitAmount,
      currency: PRODUCT.currency,
      status: "pending",
      createdAt,
    });

    // 支払方法（Stripe側で有効化が必要な場合あり）
    const payment_method_types = (() => {
      if (paymentMethod === "konbini") return ["konbini"];
      if (paymentMethod === "paypay") return ["paypay"];
      return ["card"];
    })();

    const sessionObj = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types,
      line_items: [
        {
          price_data: {
            currency: PRODUCT.currency,
            product_data: { name: PRODUCT.name },
            unit_amount: PRODUCT.unitAmount,
          },
          quantity: 1,
        },
      ],
      success_url: `${BASE_URL}/success.html?orderId=${orderId}`,
      cancel_url: `${BASE_URL}/cancel.html?orderId=${orderId}`,
      metadata: {
        orderId,
        paymentMethod: paymentMethod || "card",
        konbiniStore: paymentMethod === "konbini" ? (konbiniStore || "") : "",
      },
      // customer_email を入れると Stripe画面でメール扱いやすい
      customer_email: email,
    });

    // session id をDBへ記録（支払照合に使える）
    stmtUpdateOrderByOrderId.run({
      orderId,
      status: "pending",
      stripeSessionId: sessionObj.id,
      stripePaymentIntentId: null,
      paidAt: null,
    });

    return res.json({ url: sessionObj.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== Stripe Webhook (支払い確定はここだけ) =====
app.post(
  "/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const whsec = process.env.STRIPE_WEBHOOK_SECRET;

    if (!whsec) {
      console.error("❌ STRIPE_WEBHOOK_SECRET が未設定です");
      return res.status(500).send("Webhook secret not set");
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, whsec);
    } catch (err) {
      console.error("❌ Webhook signature verify failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      // 代表：Checkout完了
      if (event.type === "checkout.session.completed") {
        const sessionObj = event.data.object;
        const orderId = sessionObj.metadata?.orderId;
        const paymentIntentId = sessionObj.payment_intent || null;

        if (orderId) {
          // paid へ更新
          stmtUpdateOrderByOrderId.run({
            orderId,
            status: "paid",
            stripeSessionId: sessionObj.id,
            stripePaymentIntentId: paymentIntentId,
            paidAt: new Date().toISOString(),
          });

          // 注文情報を取得してメール
          const order = stmtGetOrderByOrderId.get(orderId);
          if (order) {
            await sendPurchaseMail({
              to: order.email,
              name: order.name,
              orderId: order.orderId,
              amount: order.amount,
              paymentMethod: order.paymentMethod,
            });
          }
        }
      }

      // 非同期決済用（PayPay/コンビニ等で必要になる場合あり）
      if (event.type === "checkout.session.async_payment_succeeded") {
        const sessionObj = event.data.object;
        const orderId = sessionObj.metadata?.orderId;
        if (orderId) {
          stmtUpdateOrderByOrderId.run({
            orderId,
            status: "paid",
            stripeSessionId: sessionObj.id,
            stripePaymentIntentId: sessionObj.payment_intent || null,
            paidAt: new Date().toISOString(),
          });

          const order = stmtGetOrderByOrderId.get(orderId);
          if (order) {
            await sendPurchaseMail({
              to: order.email,
              name: order.name,
              orderId: order.orderId,
              amount: order.amount,
              paymentMethod: order.paymentMethod,
            });
          }
        }
      }

      return res.json({ received: true });
    } catch (err) {
      console.error("❌ webhook handler error:", err);
      return res.status(500).send("Webhook handler failed");
    }
  }
);

// ===== Admin: HTMLは直アクセス禁止（URL知ってても404） =====
app.get("/admin.html", (req, res) => {
  return res.status(404).send("Not Found");
});

// ログインページは公開OK（public/admin-login.html を使う）
app.get("/admin-login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin-login.html"));
});

// ログイン成功した人だけ管理画面へ（URL知っててもログイン必須）
app.get("/admin", (req, res) => {
  if (!(req.session && req.session.admin === true)) {
    return res.redirect("/admin-login");
  }
  return res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// admin logout
app.post("/admin-logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// 管理者ログイン（セッション付与）
app.post("/admin-login", adminLoginLimiter, (req, res) => {
  const { email, password } = req.body || {};

  const inputEmail = String(email || "").trim().toLowerCase();
  const inputPass = String(password || "").trim();

  const envEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const envPass = String(process.env.ADMIN_PASSWORD || "").trim();

  const ok =
    inputEmail !== "" &&
    inputPass !== "" &&
    inputEmail === envEmail &&
    inputPass === envPass;

  if (ok) {
    req.session.admin = true;
    return res.json({ success: true });
  }
  return res.json({ success: false });
});

// ===== Admin APIs (ログイン必須) =====
app.get("/api/orders", requireAdmin, (req, res) => {
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const rows = stmtOrdersByDate.all(dateStr);
  return res.json(rows);
});

app.get("/api/sales", requireAdmin, (req, res) => {
  const year = req.query.year;
  const month = req.query.month; // 01-12
  const day = req.query.day; // 01-31

  if (!year) return res.status(400).json({ error: "year required" });

  if (year && month && day) {
    const total = stmtSalesDay.get(year, month, day).total;
    return res.json({ scope: "day", year, month, day, total });
  }
  if (year && month) {
    const total = stmtSalesMonth.get(year, month).total;
    return res.json({ scope: "month", year, month, total });
  }
  const total = stmtSalesYear.get(year).total;
  return res.json({ scope: "year", year, total });
});

// ===== Contact =====
app.post("/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "必須項目が不足しています" });
    }

    stmtInsertContact.run({
      name,
      email,
      subject,
      message,
      createdAt: new Date().toISOString(),
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on ${BASE_URL}`);
  console.log(`広告:   ${BASE_URL}/ad.html`);
  console.log(`購入:   ${BASE_URL}/shop.html`);
  console.log(`管理者ログイン: ${BASE_URL}/admin-login`);
  console.log(`管理者（ログイン後）: ${BASE_URL}/admin`);
});
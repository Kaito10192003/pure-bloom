require("dotenv").config();

const path = require("path");
const fs = require("fs/promises");
const express = require("express");
// Renderの本番URL（なければローカル）

const Stripe = require("stripe");
const nodemailer = require("nodemailer");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ad.html"));
});
// ✅ dashboard直叩きはログイン画面へ（一覧ページ直行を防ぐ）
app.get("/dashboard.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});
// ===== Stripe =====
const stripeSecret = process.env.STRIPE_SECRET_KEY;
if (!stripeSecret) {
  console.error("❌ STRIPE_SECRET_KEY が環境変数に設定されていません");
  process.exit(1);
}
const stripe = Stripe(stripeSecret);

// ===== 公開URL（Render等） =====
// Renderでは BASE_URL を環境変数に入れるのが確実
// 例: https://xxxxx.onrender.com
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ===== 保存先（年/月/日） =====
const DATA_ROOT = path.join(__dirname, "data", "orders");

function pad2(n) {
  return String(n).padStart(2, "0");
}
function ymdParts(date = new Date()) {
  const y = String(date.getFullYear());
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  return { y, m, d };
}
function dayDir(date = new Date()) {
  const { y, m, d } = ymdParts(date);
  return path.join(DATA_ROOT, y, m, d);
}
async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function readOrdersForDay(date = new Date()) {
  const dir = dayDir(date);
  const file = path.join(dir, "orders.json");
  try {
    const txt = await fs.readFile(file, "utf-8");
    return JSON.parse(txt);
  } catch {
    return [];
  }
}
async function writeOrdersForDay(date = new Date(), orders) {
  const dir = dayDir(date);
  await ensureDir(dir);
  const file = path.join(dir, "orders.json");
  await fs.writeFile(file, JSON.stringify(orders, null, 2), "utf-8");
}

// ===== メール送信（SMTP）=====
// RenderのEnvironment Variablesに以下を入れる想定：
// SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, MAIL_FROM(任意)
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

// ===== 商品設定（例）=====
const PRODUCT = {
  name: "Premium Supplement（デモ）",
  unitAmount: 4980, // 円
  currency: "jpy",
};

// ===== Checkoutセッション作成 =====
app.post("/create-checkout-session", async (req, res) => {
  try {
    const { name, phone, email, address, paymentMethod, konbiniStore } = req.body || {};
    if (!name || !phone || !email || !address) {
      return res.status(400).json({ error: "必須項目が不足しています" });
    }

    // 注文を日付ディレクトリへ保存（pending）
    const orderId = "ord_" + Date.now();
    const now = new Date();
    const orders = await readOrdersForDay(now);

    const newOrder = {
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
      createdAt: now.toISOString(),
    };
    orders.push(newOrder);
    await writeOrdersForDay(now, orders);

    // Stripe：支払方法
    // ※ Konbini / PayPay はStripe側で利用可能化が必要な場合があります
    const payment_method_types = (() => {
      if (paymentMethod === "konbini") return ["konbini"];
      if (paymentMethod === "paypay") return ["paypay"];
      return ["card"];
    })();

    const session = await stripe.checkout.sessions.create({
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
      // ✅ localhost固定をやめてBASE_URLにする（公開対応）
      success_url: `${BASE_URL}/success.html?orderId=${orderId}`,
      cancel_url: `${BASE_URL}/cancel.html?orderId=${orderId}`,
      metadata: {
        orderId,
        paymentMethod: paymentMethod || "card",
        konbiniStore: paymentMethod === "konbini" ? (konbiniStore || "") : "",
      },
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== デモ：成功ページから paid に更新＋メール送信 =====
// 本番はWebhookで「支払い確定」を検証してから更新が正解
app.post("/mark-paid", async (req, res) => {
  try {
    const { orderId } = req.body || {};
    if (!orderId) return res.status(400).json({ error: "orderId required" });

    // デモでは「今日分」だけ更新
    const now = new Date();
    const orders = await readOrdersForDay(now);
    const target = orders.find((o) => o.orderId === orderId);
    if (!target) return res.status(404).json({ error: "order not found (today only demo)" });

    target.status = "paid_demo";
    await writeOrdersForDay(now, orders);

    // メール送信（SMTP設定がある場合のみ）
    await sendPurchaseMail({
      to: target.email,
      name: target.name,
      orderId: target.orderId,
      amount: target.amount,
      paymentMethod: target.paymentMethod,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== 管理者ログイン（簡易）=====
app.post("/admin-login", (req, res) => {
  const { email, password } = req.body || {};

  const inputEmail = String(email || "").trim().toLowerCase();
  const inputPass  = String(password || "").trim();

  const envEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const envPass  = String(process.env.ADMIN_PASSWORD || "").trim();

  const ok = inputEmail !== "" && inputPass !== "" && inputEmail === envEmail && inputPass === envPass;
  return res.json({ success: ok });
});

// ===== 注文一覧：指定日（YYYY-MM-DD）を返す =====
app.get("/orders", async (req, res) => {
  const dateStr = req.query.date; // "2026-03-02"
  const date = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const orders = await readOrdersForDay(date);
  return res.json(orders);
});

// ===== 売上集計：year/month/day =====
app.get("/sales", async (req, res) => {
  // /sales?year=2026&month=03&day=02
  const year = req.query.year;
  const month = req.query.month;
  const day = req.query.day;

  try {
    if (!year) return res.status(400).json({ error: "year required" });

    const base = path.join(DATA_ROOT, year);
    let total = 0;

    // 年合計
    if (!month) {
      const months = await fs.readdir(base).catch(() => []);
      for (const m of months) {
        const monthDir = path.join(base, m);
        const days = await fs.readdir(monthDir).catch(() => []);
        for (const d of days) {
          const file = path.join(monthDir, d, "orders.json");
          const arr = JSON.parse(await fs.readFile(file, "utf-8").catch(() => "[]"));
          for (const o of arr) {
            if (String(o.status).startsWith("paid")) total += Number(o.amount || 0);
          }
        }
      }
      return res.json({ scope: "year", year, total });
    }

    // 月合計
    const monthDir = path.join(base, month);
    if (!day) {
      const days = await fs.readdir(monthDir).catch(() => []);
      for (const d of days) {
        const file = path.join(monthDir, d, "orders.json");
        const arr = JSON.parse(await fs.readFile(file, "utf-8").catch(() => "[]"));
        for (const o of arr) {
          if (String(o.status).startsWith("paid")) total += Number(o.amount || 0);
        }
      }
      return res.json({ scope: "month", year, month, total });
    }

    // 日合計
    const file = path.join(monthDir, day, "orders.json");
    const arr = JSON.parse(await fs.readFile(file, "utf-8").catch(() => "[]"));
    for (const o of arr) {
      if (String(o.status).startsWith("paid")) total += Number(o.amount || 0);
    }
    return res.json({ scope: "day", year, month, day, total });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== 問い合わせ保存先 =====
const CONTACT_FILE = path.join(__dirname, "data", "contacts.json");

app.post("/contact", async (req, res) => {
  try {
    const { name, email, subject, message } = req.body || {};
    if (!name || !email || !subject || !message) {
      return res.status(400).json({ error: "必須項目が不足しています" });
    }

    let list = [];
    try {
      const txt = await fs.readFile(CONTACT_FILE, "utf-8");
      list = JSON.parse(txt);
    } catch {}

    list.push({
      id: "c_" + Date.now(),
      name,
      email,
      subject,
      message,
      createdAt: new Date().toISOString(),
    });

    await fs.mkdir(path.join(__dirname, "data"), { recursive: true });
    await fs.writeFile(CONTACT_FILE, JSON.stringify(list, null, 2), "utf-8");

    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


app.listen(PORT, () => {
  console.log(`✅ Server running on ${BASE_URL}`);
  console.log(`広告:   ${BASE_URL}/ad.html`);
  console.log(`購入:   ${BASE_URL}/shop.html`);
  console.log(`管理者: ${BASE_URL}/admin.html`);
});
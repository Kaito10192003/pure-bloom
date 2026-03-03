// public/js/dashboard.js

function yen(n) {
  return "¥" + Number(n || 0).toLocaleString("ja-JP");
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m]));
}
function badge(status) {
  const st = String(status || "");
  if (st.startsWith("paid")) return `<span class="badge badge-paid">paid</span>`;
  return `<span class="badge badge-pending">pending</span>`;
}

function toYMD(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function fetchOrders(dateStr) {
  const url = dateStr ? `/orders?date=${encodeURIComponent(dateStr)}` : "/orders";
  const res = await fetch(url);
  if (!res.ok) throw new Error("orders fetch failed");
  return await res.json();
}

function renderRows(orders) {
  const tbody = document.getElementById("rows");
  if (!tbody) return;

  // 新しい順（createdAtがあるもの）
  orders.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  tbody.innerHTML = orders.map(o => `
    <tr>
      <td>${escapeHtml(o.orderId)}</td>
      <td>${escapeHtml(o.name)}</td>
      <td>${escapeHtml(o.paymentMethod)}</td>
      <td>${escapeHtml(o.konbiniStore || "")}</td>
      <td>${yen(o.amount)}</td>
      <td>${badge(o.status)}</td>
      <td class="small">${escapeHtml(o.createdAt || "")}</td>
    </tr>
  `).join("");
}

async function fetchSales(scope, dateStr) {
  // scope: "day" | "month" | "year"
  // dateStr: YYYY-MM-DD
  const [y, m, d] = dateStr.split("-");
  if (scope === "year") {
    const res = await fetch(`/sales?year=${y}`);
    if (!res.ok) throw new Error("sales year failed");
    return await res.json();
  }
  if (scope === "month") {
    const res = await fetch(`/sales?year=${y}&month=${m}`);
    if (!res.ok) throw new Error("sales month failed");
    return await res.json();
  }
  const res = await fetch(`/sales?year=${y}&month=${m}&day=${d}`);
  if (!res.ok) throw new Error("sales day failed");
  return await res.json();
}

function wireSalesButtons(getDateStr) {
  const out = document.getElementById("sumResult");
  const btnDay = document.getElementById("sumDay");
  const btnMonth = document.getElementById("sumMonth");
  const btnYear = document.getElementById("sumYear");

  async function run(scope) {
    try {
      const dateStr = getDateStr();
      const data = await fetchSales(scope, dateStr);
      out.textContent = `売上（${data.scope}）: ${yen(data.total)}`;
    } catch (e) {
      console.error(e);
      out.textContent = "売上取得に失敗しました";
    }
  }

  btnDay && btnDay.addEventListener("click", () => run("day"));
  btnMonth && btnMonth.addEventListener("click", () => run("month"));
  btnYear && btnYear.addEventListener("click", () => run("year"));
}

async function main() {
  // ログイン済みチェック（admin.js側で localStorage admin_ok=1 を入れてる想定）
  if (localStorage.getItem("admin_ok") !== "1") {
    location.href = "/admin.html";
    return;
  }

  const datePicker = document.getElementById("datePicker");

  // 初期は「今日」をセットして表示
  const today = new Date();
  const todayStr = toYMD(today);
  if (datePicker) datePicker.value = todayStr;

  // 初回ロード
  const orders = await fetchOrders(todayStr);
  renderRows(orders);

  // 日付変更でロード
  if (datePicker) {
    datePicker.addEventListener("change", async () => {
      const d = datePicker.value;
      const list = await fetchOrders(d);
      renderRows(list);
      const out = document.getElementById("sumResult");
      if (out) out.textContent = "";
    });
  }

  // 売上ボタン
  wireSalesButtons(() => (datePicker && datePicker.value) ? datePicker.value : todayStr);
}

document.addEventListener("DOMContentLoaded", () => {
  main().catch(e => {
    console.error(e);
    alert("管理画面の読み込みに失敗しました。");
  });
});
// public/js/admin.js

function $(id) { return document.getElementById(id); }

async function login(email, password) {
  const res = await fetch("/admin-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) throw new Error("login failed");
  return await res.json();
}

document.addEventListener("DOMContentLoaded", () => {
  // すでにログイン済みならダッシュボードへ
  if (localStorage.getItem("admin_ok") === "1") {
    location.href = "/dashboard.html";
    return;
  }

  const form = $("adminForm");
  const emailEl = $("adminEmail");
  const passEl  = $("adminPassword");
  const msgEl   = $("adminMsg");

  if (!form) {
    console.error("adminForm が見つかりません");
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msgEl && (msgEl.textContent = "確認中…");

    const email = (emailEl?.value || "").trim();
    const password = passEl?.value || "";

    try {
      const data = await login(email, password);
      if (data && data.success) {
        // ログイン状態を保存（30日）
        localStorage.setItem("admin_ok", "1");
        localStorage.setItem("admin_email", email);
        localStorage.setItem("admin_ok_until", String(Date.now() + 30 * 24 * 60 * 60 * 1000));

        msgEl && (msgEl.textContent = "ログイン成功。移動します…");
        location.href = "/dashboard.html";
      } else {
        localStorage.removeItem("admin_ok");
        msgEl && (msgEl.textContent = "メールアドレスまたはパスワードが違います");
      }
    } catch (err) {
      console.error(err);
      msgEl && (msgEl.textContent = "通信エラーが発生しました");
    }
  });
});
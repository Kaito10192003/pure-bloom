const $ = (id) => document.getElementById(id);

$("loginBtn").addEventListener("click", async () => {
  $("err").textContent = "";

  const email = $("email").value;
  const password = $("pass").value;

  try {
    const r = await fetch("/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await r.json();
    if (data.success) {
      location.href = "/admin";
    } else {
      $("err").textContent = "メールアドレスまたはパスワードが違います";
    }
  } catch (e) {
    $("err").textContent = "通信に失敗しました";
  }
});
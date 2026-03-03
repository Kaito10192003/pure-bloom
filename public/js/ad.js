document.addEventListener("DOMContentLoaded", () => {
  // 背景画像（あなたのjpegに合わせる）
  const hero = document.getElementById("hero");
  if (hero) hero.style.backgroundImage = "url('img/hero.jpeg')";

  const productImg = document.getElementById("productImg");
  if (productImg) productImg.src = "img/product.jpeg";

  const s1 = document.getElementById("section1");
  if (s1) s1.style.backgroundImage = "url('img/section1.jpeg')";

  const s2 = document.getElementById("section2");
  if (s2) s2.style.backgroundImage = "url('img/section2.jpeg')";

  // 問い合わせフォーム送信
  const form = document.getElementById("contactForm");
  if (!form) return;

  const cErr = document.getElementById("cErr");
  const cOk = document.getElementById("cOk");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    cErr.textContent = "";
    cOk.textContent = "";

    const payload = {
      name: document.getElementById("cName").value.trim(),
      email: document.getElementById("cEmail").value.trim(),
      subject: document.getElementById("cSubject").value.trim(),
      message: document.getElementById("cMessage").value.trim(),
    };

    if (!payload.name || !payload.email || !payload.subject || !payload.message) {
      cErr.textContent = "未入力の項目があります";
      return;
    }

    try {
      const res = await fetch("/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "送信に失敗しました");

      cOk.textContent = "送信しました。ありがとうございました！";
      form.reset();
    } catch (err) {
      cErr.textContent = err.message;
    }
  });
});
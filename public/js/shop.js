const phone1 = document.getElementById("phone1");
const phone2 = document.getElementById("phone2");
const phone3 = document.getElementById("phone3");
const address = document.getElementById("address");
const form = document.getElementById("purchaseForm");
const error = document.getElementById("error");
const buyBtn = document.getElementById("buyBtn");

const paymentMethod = document.getElementById("paymentMethod");
const konbiniArea = document.getElementById("konbiniArea");
const konbiniStore = document.getElementById("konbiniStore");

function onlyDigits(el){ el.value = el.value.replace(/[^\d]/g, ""); }

paymentMethod.addEventListener("change", () => {
  konbiniArea.style.display = (paymentMethod.value === "konbini") ? "block" : "none";
});

phone1.addEventListener("input", () => { onlyDigits(phone1); if (phone1.value.length === 3) phone2.focus(); });
phone2.addEventListener("input", () => { onlyDigits(phone2); if (phone2.value.length === 4) phone3.focus(); });
phone3.addEventListener("input", () => { onlyDigits(phone3); });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  error.textContent = "";

  if (phone1.value.length !== 3 || phone2.value.length !== 4 || phone3.value.length !== 4) {
    error.textContent = "電話番号を正しく入力してください（3-4-4）";
    return;
  }
  if (!address.value.trim()) {
    error.textContent = "住所を入力してください";
    return;
  }

  buyBtn.disabled = true;
  buyBtn.textContent = "決済ページ作成中…";

  const payload = {
    name: form.name.value.trim(),
    email: form.email.value.trim(),
    phone: `${phone1.value}-${phone2.value}-${phone3.value}`,
    address: address.value.trim(),
    paymentMethod: paymentMethod.value,
    konbiniStore: paymentMethod.value === "konbini" ? konbiniStore.value : null
  };

  try{
    const res = await fetch("/create-checkout-session", {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if(!res.ok) throw new Error(data.error || "サーバーエラー");
    window.location.href = data.url;
  }catch(err){
    error.textContent = err.message;
    buyBtn.disabled = false;
    buyBtn.textContent = "購入して決済へ進む";
  }
});
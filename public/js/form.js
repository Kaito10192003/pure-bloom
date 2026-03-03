const phone1 = document.getElementById("phone1");
const phone2 = document.getElementById("phone2");
const phone3 = document.getElementById("phone3");
const form = document.getElementById("purchaseForm");
const error = document.getElementById("error");

phone1.addEventListener("input", () => {
  if (phone1.value.length === 3) phone2.focus();
});

phone2.addEventListener("input", () => {
  if (phone2.value.length === 4) phone3.focus();
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (phone1.value.length !== 3 ||
      phone2.value.length !== 4 ||
      phone3.value.length !== 4) {
    error.textContent = "電話番号を正しく入力してください";
    return;
  }

  const data = {
    name: form.name.value,
    phone: phone1.value + "-" + phone2.value + "-" + phone3.value,
    email: form.email.value,
    address: document.getElementById("address").value,
    payment: form.payment.value
  };

  await fetch("/purchase", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });

  alert("購入完了しました");
});
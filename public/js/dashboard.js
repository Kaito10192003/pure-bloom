const rows = document.getElementById("rows");
const datePicker = document.getElementById("datePicker");
const sumResult = document.getElementById("sumResult");

function fmtYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function loadOrders() {
  const date = datePicker.value || fmtYMD(new Date());
  const r = await fetch(`/api/orders?date=${encodeURIComponent(date)}`);
  if (r.status === 401) {
    location.href = "/admin-login";
    return;
  }
  const data = await r.json();

  rows.innerHTML = data
    .map((o) => {
      const created = new Date(o.createdAt).toLocaleString();
      return `
      <tr>
        <td>${o.orderId}</td>
        <td>${o.name}</td>
        <td>${o.paymentMethod || ""}</td>
        <td>${o.konbiniStore || ""}</td>
        <td>¥${Number(o.amount || 0).toLocaleString()}</td>
        <td>${o.status}</td>
        <td>${created}</td>
      </tr>`;
    })
    .join("");
}

async function sales(scope) {
  const d = new Date(datePicker.value || fmtYMD(new Date()));
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  let url = `/api/sales?year=${y}`;
  if (scope === "month") url += `&month=${m}`;
  if (scope === "day") url += `&month=${m}&day=${day}`;

  const r = await fetch(url);
  if (r.status === 401) {
    location.href = "/admin-login";
    return;
  }
  const data = await r.json();
  sumResult.textContent = `${data.scope}: ¥${Number(data.total || 0).toLocaleString()}`;
}

document.getElementById("sumDay").addEventListener("click", () => sales("day"));
document.getElementById("sumMonth").addEventListener("click", () => sales("month"));
document.getElementById("sumYear").addEventListener("click", () => sales("year"));

datePicker.value = fmtYMD(new Date());
datePicker.addEventListener("change", loadOrders);

loadOrders();
const productTableBody = document.getElementById("productTableBody");
const orderTableBody = document.getElementById("orderTableBody");
const addForm = document.getElementById("addProductForm");
const adminGate = document.getElementById("adminGate");
const adminPanel = document.getElementById("adminPanel");
const analyticsCards = document.getElementById("analyticsCards");
const lowStockList = document.getElementById("lowStockList");
const topProductsList = document.getElementById("topProductsList");

function isAdmin() {
  const session = ThreadCraft.getSession();
  return Boolean(session && session.isAdmin);
}

function metricCard(label, value) {
  return `<article class="metric-card"><p>${label}</p><strong>${value}</strong></article>`;
}

function formatDate(value) {
  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function loadAnalytics() {
  const data = await ThreadCraft.request("/admin/analytics");

  analyticsCards.innerHTML = [
    metricCard("Paid Revenue", ThreadCraft.formatPrice(data.paidRevenue)),
    metricCard("Total Orders", String(data.totalOrders)),
    metricCard("Paid Orders", String(data.paidOrders)),
    metricCard("Pending Payments", String(data.pendingPayments)),
    metricCard("Failed Payments", String(data.failedPayments + data.timeoutPayments)),
    metricCard("Refunded", String(data.refundedOrders)),
    metricCard("Canceled", String(data.canceledOrders)),
    metricCard("Customers", String(data.totalCustomers))
  ].join("");

  lowStockList.innerHTML = data.lowStock.length
    ? data.lowStock.map((item) => `<li>${item.name} <strong>${item.stock}</strong></li>`).join("")
    : "<li>No low stock alerts.</li>";

  topProductsList.innerHTML = data.topProducts.length
    ? data.topProducts.map((item) => `<li>${item.name} <strong>${item.unitsSold} sold</strong></li>`).join("")
    : "<li>No paid orders yet.</li>";
}

async function loadOrders() {
  const orders = await ThreadCraft.request("/admin/orders");
  orderTableBody.innerHTML = orders
    .map((order) => {
      const canCancel = ["PENDING_PAYMENT", "PAYMENT_INITIATED", "PAYMENT_FAILED", "PAYMENT_TIMEOUT"].includes(order.status);
      const canRefund = order.status === "PAID";
      return `
      <tr data-id="${order.id}">
        <td>#${order.id}</td>
        <td>${order.shipping_name}<br><small>${order.shipping_email}</small></td>
        <td>${ThreadCraft.formatPrice(order.total_amount)}</td>
        <td>${order.status}</td>
        <td>${formatDate(order.created_at)}</td>
        <td>
          <button class="btn btn-ghost table-btn" data-action="cancel" ${canCancel ? "" : "disabled"}>Cancel</button>
          <button class="btn btn-primary table-btn" data-action="refund" ${canRefund ? "" : "disabled"}>Refund</button>
        </td>
      </tr>
    `;
    })
    .join("");
}

async function loadProducts() {
  const products = await ThreadCraft.request("/admin/products");
  productTableBody.innerHTML = products
    .map(
      (product) => `
      <tr data-id="${product.id}">
        <td><input value="${product.name}" data-field="name"></td>
        <td><input value="${product.description}" data-field="description"></td>
        <td>
          <select data-field="category">
            <option value="men" ${product.category === "men" ? "selected" : ""}>men</option>
            <option value="women" ${product.category === "women" ? "selected" : ""}>women</option>
            <option value="unisex" ${product.category === "unisex" ? "selected" : ""}>unisex</option>
          </select>
        </td>
        <td><input type="number" value="${product.price}" data-field="price"></td>
        <td><input type="number" value="${product.stock}" data-field="stock"></td>
        <td><input value="${product.image}" data-field="image"></td>
        <td>
          <select data-field="tag">
            <option value="" ${product.tag !== "new" ? "selected" : ""}>normal</option>
            <option value="new" ${product.tag === "new" ? "selected" : ""}>new</option>
          </select>
        </td>
        <td>
          <button class="btn btn-primary table-btn" data-action="save">Save</button>
          <button class="btn btn-ghost table-btn" data-action="delete">Delete</button>
        </td>
      </tr>
    `
    )
    .join("");
}

function rowPayload(row) {
  const data = {};
  row.querySelectorAll("[data-field]").forEach((field) => {
    data[field.dataset.field] = field.value;
  });
  data.price = Number(data.price);
  data.stock = Number(data.stock);
  return data;
}

orderTableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const row = button.closest("tr");
  const id = Number(row.dataset.id);

  try {
    if (button.dataset.action === "cancel") {
      await ThreadCraft.request(`/admin/orders/${id}/cancel`, { method: "POST" });
      ThreadCraft.showToast(`Order #${id} canceled.`);
    }
    if (button.dataset.action === "refund") {
      await ThreadCraft.request(`/admin/orders/${id}/refund`, { method: "POST" });
      ThreadCraft.showToast(`Order #${id} refunded.`);
    }

    await Promise.all([loadOrders(), loadAnalytics(), loadProducts()]);
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
});

productTableBody.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const row = button.closest("tr");
  const id = Number(row.dataset.id);

  try {
    if (button.dataset.action === "save") {
      await ThreadCraft.request(`/admin/products/${id}`, {
        method: "PUT",
        body: JSON.stringify(rowPayload(row))
      });
      ThreadCraft.showToast("Product updated.");
      await loadAnalytics();
    }

    if (button.dataset.action === "delete") {
      await ThreadCraft.request(`/admin/products/${id}`, { method: "DELETE" });
      ThreadCraft.showToast("Product deleted.");
      await Promise.all([loadProducts(), loadAnalytics()]);
    }
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(addForm);
  const payload = {
    name: formData.get("name"),
    description: formData.get("description"),
    category: formData.get("category"),
    price: Number(formData.get("price")),
    stock: Number(formData.get("stock")),
    image: formData.get("image"),
    tag: formData.get("tag")
  };

  try {
    await ThreadCraft.request("/admin/products", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    addForm.reset();
    ThreadCraft.showToast("New stock added.");
    await Promise.all([loadProducts(), loadAnalytics()]);
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
});

async function initAdmin() {
  ThreadCraft.updateAuthLink();
  ThreadCraft.updateCartBadge();

  if (!isAdmin()) {
    adminGate.classList.remove("hidden");
    adminPanel.classList.add("hidden");
    return;
  }

  adminGate.classList.add("hidden");
  adminPanel.classList.remove("hidden");
  await Promise.all([loadProducts(), loadAnalytics(), loadOrders()]);
}

initAdmin();

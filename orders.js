const ordersList = document.getElementById("ordersList");

function formatDate(value) {
  return new Date(value).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function statusClass(status) {
  switch (status) {
    case "PAID":
      return "paid";
    case "REFUNDED":
      return "refunded";
    case "CANCELED":
      return "canceled";
    case "PAYMENT_FAILED":
      return "failed";
    case "PAYMENT_TIMEOUT":
      return "timeout";
    case "PAYMENT_INITIATED":
    case "PENDING_PAYMENT":
      return "pending";
    default:
      return "pending";
  }
}

function statusLabel(status) {
  return String(status || "PENDING").replace(/_/g, " ");
}

async function renderOrders() {
  const session = ThreadCraft.getSession();
  if (!session) {
    ordersList.innerHTML = `
      <article class="empty-card">
        <h3>Please login to see order history</h3>
        <a href="auth.html" class="btn btn-primary">Login</a>
      </article>
    `;
    return;
  }

  try {
    const orders = await ThreadCraft.request("/orders/me");
    if (!orders.length) {
      ordersList.innerHTML = `
        <article class="empty-card">
          <h3>No orders yet</h3>
          <a href="index.html" class="btn btn-primary">Start Shopping</a>
        </article>
      `;
      return;
    }

    ordersList.innerHTML = orders
      .map(
        (order) => `
        <article class="order-card">
          <div class="order-head">
            <div>
              <h3>Order #${order.id}</h3>
              <p>${formatDate(order.createdAt)}</p>
            </div>
            <div class="status ${statusClass(order.status)}">${statusLabel(order.status)}</div>
          </div>
          <div class="order-items">
            ${order.items
              .map(
                (item) => `<p>${item.product_name} x ${item.quantity} <strong>${ThreadCraft.formatPrice(item.line_total)}</strong></p>`
              )
              .join("")}
          </div>
          <div class="summary-row total"><span>Total</span><strong>${ThreadCraft.formatPrice(order.total)}</strong></div>
        </article>
      `
      )
      .join("");
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
}

ThreadCraft.updateAuthLink();
ThreadCraft.updateCartBadge();
renderOrders();

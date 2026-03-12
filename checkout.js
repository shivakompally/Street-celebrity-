const checkoutItems = document.getElementById("checkoutItems");
const subtotalEl = document.getElementById("subtotal");
const shippingEl = document.getElementById("shipping");
const taxEl = document.getElementById("tax");
const totalEl = document.getElementById("total");
const checkoutForm = document.getElementById("checkoutForm");
const paytmBtn = document.getElementById("paytmBtn");
const paymentBox = document.getElementById("paymentBox");
const paymentRefInput = document.getElementById("paymentRef");
const confirmBtn = document.getElementById("confirmBtn");
const paytmGatewayForm = document.getElementById("paytmGatewayForm");

let currentOrderId = null;

function fillUserDetails() {
  const session = ThreadCraft.getSession();
  if (!session) return;
  document.getElementById("shipName").value = session.name || "";
  document.getElementById("shipEmail").value = session.email || "";
}

async function renderSummary() {
  await ThreadCraft.loadConfig();
  const items = await ThreadCraft.getCartDetails();
  const totals = ThreadCraft.computeTotals(items);

  checkoutItems.innerHTML = items.length
    ? items
        .map((item) => `<p>${item.name} x ${item.quantity} <strong>${ThreadCraft.formatPrice(item.lineTotal)}</strong></p>`)
        .join("")
    : "<p class='muted'>Your cart is empty.</p>";

  subtotalEl.textContent = ThreadCraft.formatPrice(totals.subtotal);
  shippingEl.textContent = ThreadCraft.formatShipping(totals.shipping);
  taxEl.textContent = ThreadCraft.formatPrice(totals.tax);
  totalEl.textContent = ThreadCraft.formatPrice(totals.total);
  paytmBtn.disabled = items.length === 0;
}

function requireLogin() {
  const session = ThreadCraft.getSession();
  if (session) return true;
  ThreadCraft.showToast("Please login first.");
  location.href = "auth.html";
  return false;
}

async function createOrderFromCart() {
  const cart = ThreadCraft.getCart();
  if (!cart.length) throw new Error("Cart is empty.");

  const payload = {
    items: cart,
    shipping: {
      name: document.getElementById("shipName").value.trim(),
      email: document.getElementById("shipEmail").value.trim(),
      phone: document.getElementById("shipPhone").value.trim(),
      address: document.getElementById("shipAddress").value.trim()
    }
  };

  return ThreadCraft.request("/orders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

function openGatewayPayment(payment) {
  const form = paytmGatewayForm;
  form.action = payment.paymentUrl;
  document.getElementById("paytmMid").value = payment.mid;
  document.getElementById("paytmOrderId").value = payment.paytmOrderId;
  document.getElementById("paytmTxnToken").value = payment.txnToken;
  form.submit();
}

function openFallback(payment) {
  document.getElementById("paytmTarget").textContent = payment.payee;
  document.getElementById("paytmAmount").textContent = `INR ${payment.amount}`;
  document.getElementById("paytmLink").href = payment.upiIntent;
  document.getElementById("paytmQr").src = payment.qrImage;

  paymentBox.classList.remove("hidden");
  ThreadCraft.showToast("Gateway not configured. Using UPI fallback.");
}

async function startPaytm() {
  if (!requireLogin()) return;
  if (!checkoutForm.reportValidity()) return;

  try {
    const order = await createOrderFromCart();
    currentOrderId = order.orderId;

    const payment = await ThreadCraft.request("/payments/paytm/create-transaction", {
      method: "POST",
      body: JSON.stringify({
        orderId: currentOrderId,
        phone: document.getElementById("shipPhone").value.trim(),
        email: document.getElementById("shipEmail").value.trim()
      })
    });

    if (payment.mode === "gateway") {
      openGatewayPayment(payment);
      return;
    }

    openFallback(payment);
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
}

async function confirmFallbackPayment() {
  if (!currentOrderId) return;

  try {
    await ThreadCraft.request("/payments/paytm/confirm", {
      method: "POST",
      body: JSON.stringify({
        orderId: currentOrderId,
        paymentRef: paymentRefInput.value.trim() || undefined
      })
    });

    ThreadCraft.clearCart();
    ThreadCraft.updateCartBadge();
    ThreadCraft.showToast("Payment confirmed. Order placed.");
    setTimeout(() => {
      location.href = "orders.html";
    }, 600);
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
}

paytmBtn.addEventListener("click", startPaytm);
confirmBtn.addEventListener("click", confirmFallbackPayment);

ThreadCraft.updateAuthLink();
ThreadCraft.updateCartBadge();
fillUserDetails();
renderSummary();



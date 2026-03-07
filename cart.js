const cartItems = document.getElementById("cartItems");
const subtotalEl = document.getElementById("subtotal");
const shippingEl = document.getElementById("shipping");
const taxEl = document.getElementById("tax");
const totalEl = document.getElementById("total");
const checkoutBtn = document.getElementById("checkoutBtn");

async function renderCart() {
  const items = await ThreadCraft.getCartDetails();
  const totals = ThreadCraft.computeTotals(items);

  if (items.length === 0) {
    cartItems.innerHTML = `
      <article class="empty-card">
        <h3>Your cart is empty</h3>
        <p>Add products from the shop.</p>
        <a href="index.html" class="btn btn-primary">Go to Shop</a>
      </article>
    `;
    checkoutBtn.classList.add("disabled");
  } else {
    checkoutBtn.classList.remove("disabled");
    cartItems.innerHTML = items
      .map(
        (item) => `
        <article class="cart-item" data-id="${item.id}">
          <img src="${item.image}" alt="${item.name}">
          <div class="cart-info">
            <h3>${item.name}</h3>
            <p>${ThreadCraft.formatPrice(item.price)} each</p>
            <div class="quantity-row">
              <button class="qty-btn" data-action="minus">-</button>
              <strong>${item.quantity}</strong>
              <button class="qty-btn" data-action="plus">+</button>
            </div>
          </div>
          <div class="cart-actions">
            <strong>${ThreadCraft.formatPrice(item.lineTotal)}</strong>
            <button class="remove-btn" data-action="remove">Remove</button>
          </div>
        </article>
      `
      )
      .join("");
  }

  subtotalEl.textContent = ThreadCraft.formatPrice(totals.subtotal);
  shippingEl.textContent = ThreadCraft.formatPrice(totals.shipping);
  taxEl.textContent = ThreadCraft.formatPrice(totals.tax);
  totalEl.textContent = ThreadCraft.formatPrice(totals.total);
  ThreadCraft.updateCartBadge();
}

cartItems.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  const itemEl = button.closest(".cart-item");
  if (!itemEl) return;

  const id = Number(itemEl.dataset.id);
  const item = ThreadCraft.getCart().find((entry) => entry.id === id);
  if (!item) return;

  if (button.dataset.action === "plus") {
    ThreadCraft.updateQuantity(id, item.quantity + 1);
  }
  if (button.dataset.action === "minus") {
    ThreadCraft.updateQuantity(id, item.quantity - 1);
  }
  if (button.dataset.action === "remove") {
    ThreadCraft.removeItem(id);
  }

  await renderCart();
});

checkoutBtn.addEventListener("click", (event) => {
  if (ThreadCraft.getCartCount() === 0) {
    event.preventDefault();
    ThreadCraft.showToast("Cart is empty.");
  }
});

ThreadCraft.updateAuthLink();
renderCart();

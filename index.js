const productGrid = document.getElementById("productGrid");
const filterButtons = document.querySelectorAll(".filter");
const subscribeForm = document.getElementById("subscribeForm");

async function renderProducts(filter = "all") {
  try {
    const params = {};
    if (filter === "new") params.tag = "new";
    if (filter !== "all" && filter !== "new") params.category = filter;

    const products = await ThreadCraft.getProducts(params);
    productGrid.innerHTML = products
      .map(
        (product) => `
        <article class="card">
          <img class="image" src="${product.image}" alt="${product.name}">
          <div class="card-body">
            <h3>${product.name}</h3>
            <p>${product.description}</p>
            <div class="stock-tag">Stock: ${product.stock}</div>
            <div class="price-row">
              <span class="price">${ThreadCraft.formatPrice(product.price)}</span>
              <button class="btn btn-primary add-btn" data-id="${product.id}">Add</button>
            </div>
          </div>
        </article>
      `
      )
      .join("");

    document.querySelectorAll(".add-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.dataset.id);
        ThreadCraft.addToCart(id);
        ThreadCraft.updateCartBadge();
        ThreadCraft.showToast("Added to cart.");
      });
    });
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
}

filterButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    filterButtons.forEach((item) => item.classList.remove("active"));
    btn.classList.add("active");
    renderProducts(btn.dataset.filter);
  });
});

subscribeForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const emailInput = document.getElementById("email");
  ThreadCraft.showToast(`Subscribed: ${emailInput.value}`);
  emailInput.value = "";
});

ThreadCraft.updateAuthLink();
ThreadCraft.updateCartBadge();
renderProducts();

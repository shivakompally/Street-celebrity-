(() => {
  const API_BASE = "/api";
  const KEYS = {
    cart: "threadcraft_cart",
    token: "threadcraft_token",
    user: "threadcraft_user"
  };

  function formatPrice(value) {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0
    }).format(Number(value || 0));
  }

  function parseJSON(value, fallback) {
    try {
      return value ? JSON.parse(value) : fallback;
    } catch {
      return fallback;
    }
  }

  function getToken() {
    return localStorage.getItem(KEYS.token) || "";
  }

  function setSession(payload) {
    localStorage.setItem(KEYS.token, payload.token);
    localStorage.setItem(KEYS.user, JSON.stringify(payload.user));
  }

  function getSession() {
    return parseJSON(localStorage.getItem(KEYS.user), null);
  }

  function logout() {
    localStorage.removeItem(KEYS.token);
    localStorage.removeItem(KEYS.user);
  }

  async function request(path, options = {}) {
    const token = getToken();
    const headers = {
      "Content-Type": "application/json",
      ...(options.headers || {})
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers
      });
    } catch {
      throw new Error("Cannot reach server. Start backend with: node server.js and open http://localhost:3000");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "Request failed.");
    }
    return data;
  }

  async function login(email, password) {
    const payload = await request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setSession(payload);
    return payload.user;
  }

  async function signup(name, email, password) {
    const payload = await request("/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    });
    setSession(payload);
    return payload.user;
  }

  function getCart() {
    return parseJSON(localStorage.getItem(KEYS.cart), []);
  }

  function saveCart(cart) {
    localStorage.setItem(KEYS.cart, JSON.stringify(cart));
  }

  function addToCart(productId, quantity = 1) {
    const cart = getCart();
    const item = cart.find((entry) => entry.id === productId);
    if (item) {
      item.quantity += quantity;
    } else {
      cart.push({ id: productId, quantity });
    }
    saveCart(cart);
    return cart;
  }

  function updateQuantity(productId, quantity) {
    const cart = getCart();
    const item = cart.find((entry) => entry.id === productId);
    if (!item) return cart;
    if (quantity <= 0) {
      return removeItem(productId);
    }
    item.quantity = quantity;
    saveCart(cart);
    return cart;
  }

  function removeItem(productId) {
    const next = getCart().filter((entry) => entry.id !== productId);
    saveCart(next);
    return next;
  }

  function clearCart() {
    saveCart([]);
  }

  function getCartCount() {
    return getCart().reduce((sum, item) => sum + item.quantity, 0);
  }

  async function getProducts(params = {}) {
    const qs = new URLSearchParams(params);
    const query = qs.toString() ? `?${qs.toString()}` : "";
    return request(`/products${query}`);
  }

  async function getCartDetails() {
    const [products, cart] = await Promise.all([getProducts({ admin: 1 }), Promise.resolve(getCart())]);
    const byId = new Map(products.map((product) => [product.id, product]));
    return cart
      .map((entry) => {
        const product = byId.get(entry.id);
        if (!product) return null;
        return {
          ...product,
          quantity: entry.quantity,
          lineTotal: product.price * entry.quantity
        };
      })
      .filter(Boolean);
  }

  function computeTotals(items) {
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
    const shipping = subtotal > 4999 || subtotal === 0 ? 0 : 199;
    const tax = Math.round(subtotal * 0.05);
    return { subtotal, shipping, tax, total: subtotal + shipping + tax };
  }

  function updateAuthLink(targetId = "authNavLink") {
    const link = document.getElementById(targetId);
    if (!link) return;
    const session = getSession();
    link.textContent = session ? session.name : "Login";
    link.href = "auth.html";
  }

  function updateCartBadge(targetId = "cartCount") {
    const el = document.getElementById(targetId);
    if (!el) return;
    el.textContent = String(getCartCount());
  }

  function showToast(message, id = "toast") {
    const toast = document.getElementById(id);
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2000);
  }

  window.ThreadCraft = {
    request,
    login,
    signup,
    logout,
    getSession,
    formatPrice,
    getProducts,
    getCart,
    getCartDetails,
    addToCart,
    updateQuantity,
    removeItem,
    clearCart,
    getCartCount,
    computeTotals,
    updateAuthLink,
    updateCartBadge,
    showToast
  };
})();


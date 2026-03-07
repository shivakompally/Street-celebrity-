const tabs = document.querySelectorAll(".auth-tab");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const authStatus = document.getElementById("authStatus");
const logoutBtn = document.getElementById("logoutBtn");

function setTab(tab) {
  tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tab));
  loginForm.classList.toggle("hidden", tab !== "login");
  signupForm.classList.toggle("hidden", tab !== "signup");
}

function renderSession() {
  const session = ThreadCraft.getSession();
  if (!session) {
    authStatus.textContent = "You are not logged in.";
    logoutBtn.classList.add("hidden");
    return;
  }

  authStatus.textContent = `Logged in as ${session.name} (${session.email})${session.isAdmin ? " | Admin" : ""}`;
  logoutBtn.classList.remove("hidden");
}

tabs.forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const name = document.getElementById("signupName").value.trim();
    const email = document.getElementById("signupEmail").value.trim();
    const password = document.getElementById("signupPassword").value;
    await ThreadCraft.signup(name, email, password);
    ThreadCraft.showToast("Account created.");
    signupForm.reset();
    renderSession();
    setTab("login");
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const email = document.getElementById("loginEmail").value.trim();
    const password = document.getElementById("loginPassword").value;
    await ThreadCraft.login(email, password);
    ThreadCraft.showToast("Login successful.");
    loginForm.reset();
    renderSession();
  } catch (error) {
    ThreadCraft.showToast(error.message);
  }
});

logoutBtn.addEventListener("click", () => {
  ThreadCraft.logout();
  ThreadCraft.showToast("Logged out.");
  renderSession();
});

renderSession();

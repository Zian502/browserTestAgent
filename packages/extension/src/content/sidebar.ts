// Content Script - Sidebar Panel
// Injects a persistent floating icon + sidebar overlay using Shadow DOM

let sidebarHost: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
let isVisible = false;
let sidebarCreated = false;

// ---------- iconfont SVG Sprite ----------
const ICONFONT_SVG = `
<svg xmlns="http://www.w3.org/2000/svg" style="position:absolute;width:0;height:0;overflow:hidden">
  <symbol id="icon-close" viewBox="0 0 1024 1024">
    <path d="M572.16 512l183.467-183.467a42.667 42.667 0 1 0-60.16-60.16L512 451.84 328.533 268.373a42.667 42.667 0 0 0-60.16 60.16L451.84 512l-183.467 183.467a42.667 42.667 0 0 0 0 60.16 42.667 42.667 0 0 0 60.16 0L512 572.16l183.467 183.467a42.667 42.667 0 0 0 60.16 0 42.667 42.667 0 0 0 0-60.16L572.16 512z"/>
  </symbol>
  <symbol id="icon-collapse" viewBox="0 0 1024 1024">
    <path d="M593.408 512L324.267 242.859a42.667 42.667 0 0 1 60.16-60.16l299.52 299.52a42.667 42.667 0 0 1 0 60.16l-299.52 299.52a42.667 42.667 0 0 1-60.16-60.16L593.408 512z"/>
  </symbol>
</svg>`;

// ---------- Styles (scoped to Shadow DOM) ----------
const SIDEBAR_CSS = `
:host { all: initial; }

/* ---- Floating Action Button (persistent icon) ---- */
.pw-sidebar-fab {
  position: fixed;
  right: 16px;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  z-index: 2147483647;
  transition: opacity 0.25s ease, transform 0.25s ease, box-shadow 0.2s ease;
}
.pw-sidebar-fab:hover {
  transform: translateY(-50%) scale(1.08);
}
.pw-sidebar-fab.is-hidden {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-50%) scale(0.8);
}
.pw-sidebar-fab img {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  pointer-events: none;
}

/* ---- Sidebar Panel ---- */
.pw-sidebar-wrapper {
  position: fixed;
  top: 0;
  right: 0;
  width: 420px;
  height: 100vh;
  z-index: 2147483647;
  display: flex;
  flex-direction: row;
  background: #ffffff;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.12);
  transform: translateX(100%);
  transition: transform 0.28s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  overflow: hidden;
}
.pw-sidebar-wrapper.is-visible {
  transform: translateX(0);
}
.pw-sidebar-wrapper.is-collapsed {
  width: 0;
}

/* ---- Collapse Edge Button (left edge of sidebar) ---- */
.pw-sidebar-collapse {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 16px;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
  z-index: 1;
  transition: background 0.2s ease, width 0.2s ease;
  background: #fafafa;
}
.pw-sidebar-collapse .iconfont {
  width: 12px;
  height: 12px;
  fill: #999;
  transition: fill 0.15s, transform 0.15s;
}
.pw-sidebar-collapse:hover .iconfont {
  fill: #555;
}

/* ---- Main Content Area ---- */
.pw-sidebar-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  margin-left: 16px;
}

/* ---- Header ---- */
.pw-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 44px;
  padding: 0 12px 0 16px;
  background: #fafafa;
  border-bottom: 1px solid #e5e5e5;
  flex-shrink: 0;
  user-select: none;
}
.pw-sidebar-title {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 600;
  color: #1a1a1a;
  letter-spacing: 0.01em;
}
.pw-sidebar-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  padding: 0;
  transition: background 0.15s;
}
.pw-sidebar-close:hover {
  background: #e5e5e5;
}
.pw-sidebar-close .iconfont {
  width: 16px;
  height: 16px;
  fill: #666;
  transition: fill 0.15s;
}
.pw-sidebar-close:hover .iconfont {
  fill: #333;
}

/* ---- iframe ---- */
.pw-sidebar-frame {
  flex: 1;
  width: 100%;
  border: none;
}
`;

// ---------- Initialization ----------

function init(): void {
  if (sidebarHost) return;

  sidebarHost = document.createElement("div");
  sidebarHost.id = "pw-runner-sidebar-root";
  shadow = sidebarHost.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = SIDEBAR_CSS;
  shadow.appendChild(style);

  const spriteContainer = document.createElement("div");
  spriteContainer.innerHTML = ICONFONT_SVG;
  shadow.appendChild(spriteContainer);

  // Floating icon button — always visible by default
  const fab = document.createElement("button");
  fab.className = "pw-sidebar-fab";
  fab.title = "Browser Test Agent";
  const iconUrl = chrome.runtime.getURL("icons/icon.svg");
  fab.innerHTML = `<img src="${iconUrl}" width="32" height="32" alt="Browser Test" draggable="false" />`;
  fab.addEventListener("click", toggleSidebar);
  shadow.appendChild(fab);

  document.documentElement.appendChild(sidebarHost);
}

// Lazy-create sidebar panel on first open
function ensureSidebar(): void {
  if (sidebarCreated || !shadow) return;

  const wrapper = document.createElement("div");
  wrapper.className = "pw-sidebar-wrapper";

  // Collapse button (left edge strip)
  const collapseBtn = document.createElement("div");
  collapseBtn.className = "pw-sidebar-collapse";
  collapseBtn.title = "收起面板";
  collapseBtn.innerHTML = `<svg class="iconfont" aria-hidden="true"><use href="#icon-collapse"></use></svg>`;
  collapseBtn.addEventListener("click", collapseSidebar);

  // Main content container
  const main = document.createElement("div");
  main.className = "pw-sidebar-main";

  // Header
  const header = document.createElement("div");
  header.className = "pw-sidebar-header";

  const title = document.createElement("span");
  title.className = "pw-sidebar-title";
  title.textContent = "Browser Test Agent";

  const closeBtn = document.createElement("button");
  closeBtn.className = "pw-sidebar-close";
  closeBtn.title = "关闭面板";
  closeBtn.innerHTML = `<svg class="iconfont" aria-hidden="true"><use href="#icon-close"></use></svg>`;
  closeBtn.addEventListener("click", hideSidebar);

  header.appendChild(title);
  header.appendChild(closeBtn);

  // iframe
  const iframe = document.createElement("iframe");
  iframe.className = "pw-sidebar-frame";
  iframe.src = chrome.runtime.getURL("src/popup/index.html");
  iframe.setAttribute("allow", "");

  main.appendChild(header);
  main.appendChild(iframe);

  wrapper.appendChild(collapseBtn);
  wrapper.appendChild(main);
  shadow.appendChild(wrapper);

  sidebarCreated = true;
}

// ---------- Show / Hide / Toggle / Collapse ----------

function showSidebar(): void {
  if (!shadow) init();
  ensureSidebar();

  const wrapper = shadow!.querySelector(".pw-sidebar-wrapper");
  const fab = shadow!.querySelector(".pw-sidebar-fab");

  // Remove collapsed state if present
  wrapper?.classList.remove("is-collapsed");

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      wrapper?.classList.add("is-visible");
      fab?.classList.add("is-hidden");
    });
  });
  isVisible = true;
}

function hideSidebar(): void {
  if (!shadow) return;
  const wrapper = shadow.querySelector(".pw-sidebar-wrapper");
  const fab = shadow.querySelector(".pw-sidebar-fab");

  wrapper?.classList.remove("is-visible");
  wrapper?.classList.remove("is-collapsed");
  fab?.classList.remove("is-hidden");
  isVisible = false;
}

function collapseSidebar(): void {
  if (!shadow) return;
  const wrapper = shadow.querySelector(".pw-sidebar-wrapper");
  const fab = shadow.querySelector(".pw-sidebar-fab");

  wrapper?.classList.add("is-collapsed");
  fab?.classList.remove("is-hidden");
  isVisible = false;
}

function toggleSidebar(): void {
  if (isVisible) hideSidebar();
  else showSidebar();
}

// ---------- Message Listener ----------
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "sidebar:toggle") {
    toggleSidebar();
  }
});

// ---------- Auto-init: show floating icon on page load ----------
init();

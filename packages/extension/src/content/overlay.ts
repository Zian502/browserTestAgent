// Content Script - Page Overlay
// Shows visual highlights on elements during Playwright test execution

let overlay: HTMLDivElement | null = null;

function ensureOverlay(): HTMLDivElement {
  if (overlay && document.body.contains(overlay)) return overlay;
  overlay = document.createElement("div");
  overlay.id = "pw-runner-overlay";
  document.body.appendChild(overlay);
  return overlay;
}

function clearOverlay(): void {
  if (overlay) overlay.innerHTML = "";
}

function highlightElement(selector: string, action?: string): void {
  try {
    const el = document.querySelector(selector);
    if (!el) return;

    ensureOverlay();
    clearOverlay();

    const rect = el.getBoundingClientRect();
    const highlight = document.createElement("div");
    highlight.className = `pw-highlight ${action || ""}`;
    highlight.style.top = `${rect.top - 2}px`;
    highlight.style.left = `${rect.left - 2}px`;
    highlight.style.width = `${rect.width + 4}px`;
    highlight.style.height = `${rect.height + 4}px`;

    if (action) {
      const badge = document.createElement("div");
      badge.className = `pw-action-badge ${action}`;
      badge.textContent = action;
      highlight.appendChild(badge);
    }

    overlay!.appendChild(highlight);
    setTimeout(() => highlight.remove(), 2000);
  } catch {
    // Selector might be invalid
  }
}

function showClickRipple(x: number, y: number): void {
  ensureOverlay();
  const ripple = document.createElement("div");
  ripple.className = "pw-ripple";
  ripple.style.left = `${x}px`;
  ripple.style.top = `${y}px`;
  overlay!.appendChild(ripple);
  ripple.addEventListener("animationend", () => ripple.remove());
}

chrome.runtime.onMessage.addListener(
  (message: Record<string, unknown>) => {
    switch (message.type) {
      case "test:action":
        if (message.selector) {
          highlightElement(
            message.selector as string,
            message.action as string
          );
        }
        if (
          message.action === "click" &&
          message.x != null &&
          message.y != null
        ) {
          showClickRipple(message.x as number, message.y as number);
        }
        break;

      case "test:step":
        if (message.selector) {
          highlightElement(
            message.selector as string,
            message.action as string
          );
        }
        break;

      case "test:complete":
      case "test:error":
        setTimeout(clearOverlay, 1500);
        break;
    }
  }
);

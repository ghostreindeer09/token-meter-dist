// Builds and manages the floating badge UI (ring gauge + expandable panel).
// Pure DOM/UI logic — no tokenizing or site-adapter logic lives here.

window.TokenMeter = window.TokenMeter || {};

window.TokenMeter.badge = (function () {
  const RING_RADIUS = 11;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

  function buildBadge() {
    const root = document.createElement("div");
    root.className = "tm-badge-root";
    root.innerHTML = `
      <div class="tm-panel" id="tm-panel">
        <div class="tm-panel-row">
          <span>Draft (this box)</span>
          <strong id="tm-panel-count">0</strong>
        </div>
        <div class="tm-divider"></div>
        <div class="tm-panel-row">
          <span>Used so far (conversation)</span>
          <strong id="tm-panel-used">—</strong>
        </div>
        <div class="tm-panel-row">
          <span>Context limit</span>
          <strong id="tm-panel-limit">—</strong>
        </div>
        <div class="tm-panel-row">
          <span>Tokens left</span>
          <strong id="tm-panel-remaining">—</strong>
        </div>
        <div class="tm-panel-row">
          <span>Messages left (≈)</span>
          <strong id="tm-panel-messages-left">—</strong>
        </div>
        <button class="tm-refresh-btn" id="tm-refresh-btn" title="Re-scan the conversation now instead of waiting for the next auto-refresh">↻ Refresh now</button>
        <div class="tm-divider"></div>
        <button class="tm-optimize-btn" id="tm-optimize-btn">Trim prompt (free)</button>
        <div class="tm-optimize-summary" id="tm-optimize-summary" style="display:none;"></div>
        <button class="tm-llm-btn" id="tm-llm-btn">Rewrite with AI (uses your API key)</button>
      </div>
      <div class="tm-pill" id="tm-pill">
        <svg class="tm-ring-svg" viewBox="0 0 28 28">
          <circle class="tm-ring-track" cx="14" cy="14" r="${RING_RADIUS}"></circle>
          <circle class="tm-ring-fill" id="tm-ring-fill" cx="14" cy="14" r="${RING_RADIUS}"
                  stroke-dasharray="0 ${RING_CIRCUMFERENCE.toFixed(2)}"></circle>
        </svg>
        <span class="tm-pill-text">
          <span class="tm-count" id="tm-count">0</span>
          <span class="tm-messages-left" id="tm-messages-left"></span>
        </span>
      </div>
    `;
    document.body.appendChild(root);

    const pill = root.querySelector("#tm-pill");
    const panel = root.querySelector("#tm-panel");
    pill.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.classList.toggle("tm-open");
    });
    document.addEventListener("click", (e) => {
      if (!root.contains(e.target)) panel.classList.remove("tm-open");
    });

    return root;
  }

  /**
   * Update the badge's displayed count/ring.
   * @param {object} state
   * @param {number} state.count - DRAFT token count (current composer text only)
   * @param {boolean} state.approx - whether the count is an estimate (adds "≈")
   * @param {number|null} state.limit - context limit to gauge against, or null if unknown
   * @param {number|null} [state.messagesLeft] - estimated remaining user/assistant
   *   pairs that could fit before the limit, or null if not enough history yet
   *   to compute a running average.
   * @param {number} [state.usedTokens] - TOTAL tokens used so far (history + draft),
   *   i.e. what scrapeHistory + the draft currently add up to.
   * @param {number} [state.remainingTokens] - limit - usedTokens, floored at 0.
   */
  function update(root, state) {
    const { count, approx, limit, messagesLeft, usedTokens, remainingTokens } = state;
    const countEl = root.querySelector("#tm-count");
    const panelCountEl = root.querySelector("#tm-panel-count");
    const panelUsedEl = root.querySelector("#tm-panel-used");
    const panelLimitEl = root.querySelector("#tm-panel-limit");
    const panelRemainingEl = root.querySelector("#tm-panel-remaining");
    const messagesLeftEl = root.querySelector("#tm-messages-left");
    const panelMessagesLeftEl = root.querySelector("#tm-panel-messages-left");
    const ringFill = root.querySelector("#tm-ring-fill");

    const display = approx ? `≈${formatCount(count)}` : formatCount(count);
    countEl.textContent = display;
    panelCountEl.textContent = approx ? `≈${count.toLocaleString()}` : count.toLocaleString();
    panelLimitEl.textContent = limit ? limit.toLocaleString() : "Unknown";

    if (typeof usedTokens === "number") {
      panelUsedEl.textContent = approx ? `≈${usedTokens.toLocaleString()}` : usedTokens.toLocaleString();
    } else {
      panelUsedEl.textContent = "—";
    }
    if (typeof remainingTokens === "number" && limit) {
      panelRemainingEl.textContent = approx ? `≈${remainingTokens.toLocaleString()}` : remainingTokens.toLocaleString();
    } else {
      panelRemainingEl.textContent = "—";
    }

    if (messagesLeft === null || messagesLeft === undefined) {
      messagesLeftEl.textContent = "";
      panelMessagesLeftEl.textContent = "Not enough history yet";
    } else {
      messagesLeftEl.textContent = `~${messagesLeft} msg left`;
      panelMessagesLeftEl.textContent = String(messagesLeft);
    }

    const fraction = limit ? Math.min(count / limit, 1) : Math.min(count / 8000, 1); // sane default gauge ceiling
    const filled = fraction * RING_CIRCUMFERENCE;
    ringFill.setAttribute("stroke-dasharray", `${filled.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`);
    ringFill.classList.toggle("tm-danger", fraction > 0.85);
    messagesLeftEl.classList.toggle("tm-danger-text", typeof messagesLeft === "number" && messagesLeft <= 2);
  }

  function formatCount(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    return String(n);
  }

  function showOptimizeSummary(root, applied) {
    const summary = root.querySelector("#tm-optimize-summary");
    if (!applied || applied.length === 0) {
      summary.style.display = "block";
      summary.textContent = "Nothing to trim — already tight.";
      return;
    }
    summary.style.display = "block";
    summary.innerHTML = "Applied:<ul>" + applied.map((a) => `<li>${escapeHtml(a)}</li>`).join("") + "</ul>";
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  return { buildBadge, update, showOptimizeSummary };
})();

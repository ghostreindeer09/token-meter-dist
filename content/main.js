// Orchestrates the whole extension on a single page: finds the composer via
// the site-specific adapter, watches it for changes, updates the badge with a
// live (debounced) token count plus an estimated "messages left" countdown,
// and wires up the "trim" and "rewrite" buttons.

(function () {
  const adapter = window.TokenMeter.adapter;
  const estimator = window.TokenMeter.estimator;
  const loader = window.TokenMeter.loader;
  const optimizer = window.TokenMeter.optimizer;
  const badge = window.TokenMeter.badge;
  const messagesLeftCalc = window.TokenMeter.messagesLeft;

  if (!adapter || !estimator || !loader || !optimizer || !badge || !messagesLeftCalc) {
    console.warn("[TokenMeter] missing a required module, aborting init.");
    return;
  }

  const DEBOUNCE_MS = 150;
  // History only changes when a message is sent/received, not on every
  // keystroke of the draft — re-scraping the whole DOM on a short debounce
  // would be wasted work. This longer interval still picks up new replies
  // within a few seconds of them finishing.
  const HISTORY_RESCAN_MS = 4000;

  let debounceTimer = null;
  let historyRescanTimer = null;
  let badgeRoot = null;
  let inputEl = null;
  let exactRequestedOnce = false;
  let cachedHistory = [];

  // Known context windows for common models, shown as a reference point in
  // the ring gauge. These are approximate guides, not authoritative per-model
  // limits — actual limits vary by plan and mode and the platforms don't
  // expose "current context limit" to the page, so we pick one representative
  // default per site rather than trying to detect the exact plan in use.
  // (ChatGPT in particular varies a LOT by plan — 16K Free up to 272K Pro —
  // so this default leans toward the common paid-tier case; see popup for
  // the option to override it.)
  const DEFAULT_LIMIT_BY_SITE = {
    ChatGPT: 32000,
    Claude: 200000,
    Gemini: 1000000,
  };

  function init() {
    inputEl = adapter.findInput();
    if (!inputEl) {
      // Composer not mounted yet (SPA route still loading) — retry shortly.
      setTimeout(init, 500);
      return;
    }

    badgeRoot = badge.buildBadge();
    wireOptimizeButton();
    wireLLMButton();
    wireRefreshButton();
    attachInputWatcher();
    rescanHistory(); // initial scrape
    refreshCount(); // initial paint
    historyRescanTimer = setInterval(rescanHistory, HISTORY_RESCAN_MS);
  }

  /**
   * Manifest V3 content scripts auto-inject only on a full page load/
   * navigation, not on client-side route changes within a single-page app.
   * Sites like ChatGPT/Claude/Gemini change the URL (e.g. clicking "New
   * chat" goes from /chat/abc123 to /chat/new or a fresh chat id) WITHOUT a
   * full page reload, which previously left the badge missing entirely on
   * any conversation started after the initial page load — our script had
   * already run once and finished; nothing told it to run again.
   *
   * Fix: poll the URL on an interval (more reliable across these sites than
   * trying to hook history.pushState, which each site implements slightly
   * differently and inconsistently fires events for) and tear down + rebuild
   * the badge whenever it changes.
   */
  const URL_WATCH_MS = 1000;
  let lastUrl = location.href;

  function watchForUrlChanges() {
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        safeReinit();
      }
    }, URL_WATCH_MS);
  }

  function teardown() {
    clearInterval(historyRescanTimer);
    clearTimeout(debounceTimer);
    if (badgeRoot) {
      badgeRoot.remove();
      badgeRoot = null;
    }
    cachedHistory = [];
    exactRequestedOnce = false;
  }

  let isReinitializing = false;

  /** Guards against init() running twice concurrently if the URL-change
   * watcher and the composer-disappearance observer both fire for the same
   * navigation event, which commonly happens together during SPA routing. */
  function safeReinit() {
    if (isReinitializing) return;
    isReinitializing = true;
    teardown();
    init();
    // Release the guard on a short delay rather than immediately — init()
    // itself may retry asynchronously via setTimeout if the composer isn't
    // mounted yet, and we don't want a second trigger landing mid-retry.
    setTimeout(() => {
      isReinitializing = false;
    }, 600);
  }

  function attachInputWatcher() {
    inputEl.addEventListener("input", scheduleRefresh);
    inputEl.addEventListener("focus", onFirstFocus, { once: true });

    // SPAs replace the composer element on navigation; if it disappears,
    // re-run init() to find the new one rather than silently going stale.
    const observer = new MutationObserver(() => {
      if (!document.contains(inputEl)) {
        observer.disconnect();
        safeReinit();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function onFirstFocus() {
    // Only worth paying the ~1.1MB load cost for sites where we actually have
    // an exact tokenizer to offer (ChatGPT/o200k). Claude and Gemini always
    // use the estimator, so there's nothing to lazy-load for them.
    if (adapter.tokenizerHint === "o200k" && !exactRequestedOnce) {
      exactRequestedOnce = true;
      loader.ensureLoaded().catch((e) => {
        console.warn("[TokenMeter] exact tokenizer failed to load, staying on estimate.", e);
      });
    }
  }

  function rescanHistory() {
    try {
      cachedHistory = adapter.scrapeHistory ? adapter.scrapeHistory() : [];
    } catch (e) {
      console.warn("[TokenMeter] history scrape failed, continuing without it.", e);
      cachedHistory = [];
    }
    scheduleRefresh();
  }

  function scheduleRefresh() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(refreshCount, DEBOUNCE_MS);
  }

  /**
   * Counts a batch of texts using whichever tokenizer is currently available
   * (exact if loaded, estimate otherwise) and reports whether the result is
   * approximate, so the UI's "≈" reflects the WHOLE computation, not just
   * the draft box.
   */
  async function countBatch(texts) {
    if (adapter.tokenizerHint === "o200k" && loader.isReady()) {
      try {
        const counts = await Promise.all(texts.map((t) => loader.countExact(t)));
        return { counts, approx: false };
      } catch (e) {
        // fall through to estimate below on timeout/error
      }
    }
    return { counts: texts.map((t) => estimator.estimateTokens(t)), approx: true };
  }

  async function refreshCount() {
    const draftText = adapter.getText(inputEl);
    const limit = DEFAULT_LIMIT_BY_SITE[adapter.siteName] || null;

    // Tokenize the draft plus every scraped history message in one batch so
    // they consistently use the same tokenizer (exact vs estimate) for a
    // single refresh — mixing tokenizers between draft and history within
    // the same calculation would produce a misleading "messages left".
    const allTexts = [draftText, ...cachedHistory.map((m) => m.text)];
    const { counts, approx } = await countBatch(allTexts);
    const draftCount = counts[0];
    const historyCounts = counts.slice(1); // same order/length as cachedHistory, by construction above

    if (!limit) {
      // Still report a usedTokens figure (history + draft) even without a
      // limit to project against — "tokens used so far" is meaningful on
      // its own; only "tokens left" and "messages left" need a limit.
      const usedTokens = historyCounts.reduce((sum, c) => sum + c, 0) + draftCount;
      badge.update(badgeRoot, { count: draftCount, approx, limit, messagesLeft: null, usedTokens, remainingTokens: null });
      return;
    }

    const result = messagesLeftCalc.compute(cachedHistory, historyCounts, draftCount, limit);
    badge.update(badgeRoot, {
      count: draftCount,
      approx,
      limit,
      messagesLeft: result.messagesLeft,
      usedTokens: result.usedTokens,
      remainingTokens: result.remainingTokens,
    });
  }

  /**
   * Wires the panel's "Refresh now" button — forces an immediate history
   * rescan + recount rather than waiting for the next HISTORY_RESCAN_MS tick.
   * Useful right after the user wants an up-to-the-second "tokens used /
   * tokens left" number (e.g. they just got a long reply and want to check
   * before deciding whether to keep going in this conversation or start a
   * new one).
   */
  function wireRefreshButton() {
    const btn = badgeRoot.querySelector("#tm-refresh-btn");
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Refreshing…";
      rescanHistory();
      // rescanHistory -> scheduleRefresh is debounced by DEBOUNCE_MS; wait
      // slightly past that so the button's disabled state actually covers
      // the full round trip instead of re-enabling before the badge updates.
      await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS + 50));
      btn.disabled = false;
      btn.textContent = "↻ Refresh now";
    });
  }

  function wireOptimizeButton() {
    const btn = badgeRoot.querySelector("#tm-optimize-btn");
    btn.addEventListener("click", () => {
      const text = adapter.getText(inputEl);
      const result = optimizer.optimizeMechanical(text);
      if (result.changed) {
        adapter.setText(inputEl, result.text);
      }
      badge.showOptimizeSummary(badgeRoot, result.applied);
      scheduleRefresh();
    });
  }

  function wireLLMButton() {
    const btn = badgeRoot.querySelector("#tm-llm-btn");
    const summary = badgeRoot.querySelector("#tm-optimize-summary");

    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Rewriting…";
      // The actual API call happens in the background worker (background.js),
      // which holds the user's API key — content scripts never touch it
      // directly, so it's read from storage in exactly one place.
      chrome.runtime.sendMessage({ type: "open-llm-rewrite", text: adapter.getText(inputEl) });
    });

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "llm-rewrite-result") return;
      btn.disabled = false;
      btn.textContent = "Rewrite with AI (uses your API key)";

      const ERROR_MESSAGES = {
        "no-api-key": "Add an Anthropic API key in the extension popup first.",
        "empty-text": "Nothing to rewrite — the prompt box is empty.",
        "input-too-large": "Prompt is too long for the rewrite feature (20,000 character limit).",
        "rate-limited": "Rewrite already in progress, or you just ran one — give it a moment.",
        "timeout": "Rewrite timed out — the API took too long to respond. Try again.",
        "api-error": "Rewrite failed — Anthropic's API returned an error. Check your key in the popup.",
        "network-error": "Rewrite failed — couldn't reach Anthropic's API. Check your connection.",
      };

      if (message.error) {
        summary.style.display = "block";
        summary.textContent = ERROR_MESSAGES[message.error] || "Rewrite failed — see browser console for details.";
        if (!ERROR_MESSAGES[message.error]) {
          console.warn("[TokenMeter] LLM rewrite error:", message.error, message.detail);
        }
        return;
      }

      adapter.setText(inputEl, message.rewritten);
      summary.style.display = "block";
      summary.textContent = "Rewritten with AI. Review before sending.";
      scheduleRefresh();
    });
  }

  init();
  watchForUrlChanges();
})();

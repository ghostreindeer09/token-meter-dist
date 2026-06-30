// Lazy-loads lib/tokenizer.bundle.js (the ~2.3MB exact tokenizer) into the page
// only once, only when actually needed — i.e. the first time the user focuses
// the chat input. Until that happens, TokenMeter.estimator (tiny, instant) is
// used everywhere. This keeps page load on chatgpt.com/claude.ai/gemini.google.com
// unaffected for anyone who installs the extension but doesn't end up using it
// in a given visit.
//
// Architectural note: tokenizer.bundle.js is injected as a <script src> tag, so
// it runs in the PAGE's JS context, not the content script's isolated world.
// The two do not share a `window` object, so we talk to it via postMessage
// rather than calling it directly.

window.TokenMeter = window.TokenMeter || {};

(function () {
  let loadPromise = null;
  let ready = false;
  let nextRequestId = 1;
  const pending = new Map(); // requestId -> {resolve, reject}

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== "tokenmeter-page") return;

    if (msg.type === "exact-ready") {
      ready = true;
      return;
    }
    if (msg.type === "count-exact-result") {
      const handlers = pending.get(msg.requestId);
      if (handlers) {
        pending.delete(msg.requestId);
        handlers.resolve(msg.count);
      }
    }
  });

  function injectBundle() {
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("lib/tokenizer.bundle.js");
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = (e) => {
        script.remove();
        reject(e);
      };
      (document.head || document.documentElement).appendChild(script);
    });

    return loadPromise;
  }

  /** Ask the page-world tokenizer to count `text` exactly. Resolves with a number. */
  function countExact(text, { timeoutMs = 1500 } = {}) {
    return new Promise((resolve, reject) => {
      const requestId = nextRequestId++;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error("tokenmeter: exact tokenizer timed out"));
      }, timeoutMs);

      pending.set(requestId, {
        resolve: (count) => {
          clearTimeout(timer);
          resolve(count);
        },
      });

      window.postMessage({ source: "tokenmeter-content", type: "count-exact", requestId, text }, "*");
    });
  }

  window.TokenMeter.loader = {
    isReady: () => ready,
    /** Kick off the load (idempotent — safe to call repeatedly). Returns a promise. */
    ensureLoaded: injectBundle,
    /** Count text exactly. Caller should ensure isReady() first, or await ensureLoaded(). */
    countExact,
  };
})();

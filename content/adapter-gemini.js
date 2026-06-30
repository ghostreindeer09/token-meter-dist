// Adapter for gemini.google.com.
//
// Gemini wraps its input in a custom <rich-textarea> element, which itself
// contains a contenteditable div. We try the contenteditable first (most
// specific to how Gemini actually edits text), then fall back to the
// rich-textarea wrapper, then a plain textarea as a last resort in case
// Gemini ever serves a simplified DOM (e.g. older browsers, accessibility mode).

window.TokenMeter = window.TokenMeter || {};

window.TokenMeter.adapter = (function () {
  const SELECTORS = [
    "rich-textarea div.ql-editor[contenteditable='true']",
    "rich-textarea div[contenteditable='true']",
    "rich-textarea",
    "textarea",
  ];

  function findInput() {
    for (const sel of SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getText(el) {
    if (el.tagName === "TEXTAREA") return el.value || "";
    return el.innerText || "";
  }

  function setText(el, text) {
    if (el.tagName === "TEXTAREA") {
      el.value = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
  }

  function findSendButton() {
    return (
      document.querySelector('button[aria-label*="Send"]') ||
      document.querySelector('button[aria-label*="send"]')
    );
  }

  /**
   * Scrape every message currently rendered in the conversation, in order.
   * Returns [{ role: "user"|"assistant", text: string }, ...].
   *
   * No public selector for Gemini's message-role DOM was confirmed at the
   * time this was written (Google's published docs cover the API, not the
   * gemini.google.com web page structure). Falls straight to the shared
   * structural heuristic — see lib/history-scraper.js — trying a couple of
   * plausible container landmarks before giving up to document.body.
   * Only ever READS the page; never modifies it.
   */
  function scrapeHistory() {
    return window.TokenMeter.boundedAscentHistory(["main", "[role='main']", "chat-window"]);
  }

  return {
    siteName: "Gemini",
    findInput,
    getText,
    setText,
    findSendButton,
    scrapeHistory,
    // Google does not publish Gemini's tokenizer either — estimate only.
    tokenizerHint: "estimate-only",
  };
})();

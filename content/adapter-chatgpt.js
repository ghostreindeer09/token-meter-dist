// Adapter for chatgpt.com / chat.openai.com.
//
// ChatGPT's composer is a ProseMirror-based contenteditable div, not a plain
// <textarea>. Two consequences:
//   1. READING text: el.innerText works fine.
//   2. WRITING text (for the "optimize" button, which replaces the prompt):
//      naively setting el.innerHTML/textContent does NOT update ProseMirror's
//      internal state, so the Send button stays disabled and nothing is
//      submittable. We must use document.execCommand('insertText', ...) after
//      selecting all existing content, which ProseMirror listens for via the
//      standard beforeinput/input event path.
//
// Selectors are intentionally layered from most to least specific, since
// OpenAI has changed this DOM before (e.g. dropping the old #prompt-textarea
// <textarea> in favor of the current contenteditable div) and likely will again.

window.TokenMeter = window.TokenMeter || {};

window.TokenMeter.adapter = (function () {
  const SELECTORS = [
    'div#prompt-textarea[contenteditable="true"]',
    'div[contenteditable="true"][data-virtualkeyboard]',
    'form div[contenteditable="true"]',
  ];

  function findInput() {
    for (const sel of SELECTORS) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function getText(el) {
    return el.innerText || "";
  }

  /** Replace all content in the composer with `text`, in a way ProseMirror detects. */
  function setText(el, text) {
    el.focus();
    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, text);
  }

  function findSendButton() {
    return (
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label*="Send"]')
    );
  }

  /**
   * Scrape every message currently rendered in the conversation, in order.
   * Returns [{ role: "user"|"assistant", text: string }, ...].
   *
   * Strategy chain, most to least reliable:
   *   1. [data-message-author-role] — the cleanest signal when present; the
   *      attribute states the role directly.
   *   2. [data-testid^="conversation-turn-"] — turn-numbered containers;
   *      even/odd turn index implies user/assistant alternation.
   *   3. Give up and return [] rather than guessing from layout/class names,
   *      which are the least stable part of this DOM.
   * Only ever READS the page; never modifies it.
   */
  function scrapeHistory() {
    const roleNodes = document.querySelectorAll("[data-message-author-role]");
    if (roleNodes.length > 0) {
      return Array.from(roleNodes).map((el) => ({
        role: el.getAttribute("data-message-author-role") === "user" ? "user" : "assistant",
        text: el.innerText || "",
      }));
    }

    const turnNodes = document.querySelectorAll('[data-testid^="conversation-turn-"]');
    if (turnNodes.length > 0) {
      return Array.from(turnNodes).map((el, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        text: el.innerText || "",
      }));
    }

    return [];
  }

  return {
    siteName: "ChatGPT",
    findInput,
    getText,
    setText,
    findSendButton,
    scrapeHistory,
    // ChatGPT's modern default model is GPT-4o-family, which uses o200k_base —
    // matches the tokenizer we bundle, so exact counts are meaningful here.
    tokenizerHint: "o200k",
  };
})();

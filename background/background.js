// Background service worker (Manifest V3). Responsibilities:
//   1. Hold the one privileged operation that needs a network call: the
//      opt-in LLM-powered prompt rewrite, using the user's own API key.
//   2. Relay results back to whichever tab asked, since content scripts
//      can call fetch() directly too, but centralizing it here means the
//      API key never has to be re-read/duplicated across three site adapters.
//   3. Rate-limit and validate that call — see RATE LIMITING and INPUT
//      VALIDATION sections below. There's no server of ours behind this
//      extension, so most classic "API security" concerns (CORS, CSRF,
//      webhook auth, SSRF) don't have a corresponding attack surface here;
//      what DOES apply is protecting the user's own API key/budget from
//      being burned by accidental rapid-fire clicks or oversized input.

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// --- INPUT VALIDATION ---------------------------------------------------
// Hard cap on what we'll send to the API in one rewrite request. This isn't
// a security boundary against a malicious actor (the user controls their
// own browser and their own key) — it's a guard against accidentally
// sending something absurd (e.g. triggering this on a huge pasted document)
// that would burn a large amount of API spend for a single click.
const MAX_REWRITE_INPUT_CHARS = 20000; // ~5-7k tokens, generous for a "prompt"
const REQUEST_TIMEOUT_MS = 30000;

// --- RATE LIMITING --------------------------------------------------------
// Two layers:
//   1. In-flight lock per tab: a second click while one request is still
//      pending is rejected immediately, rather than firing a parallel
//      request (which could otherwise return out of order and stomp the
//      composer with a stale result). Acquired SYNCHRONOUSLY before any
//      `await` in handleLLMRewrite — splitting the check and the set across
//      an await boundary would reopen a check-then-act race where two rapid
//      calls both pass the check before either sets the lock.
//   2. Cooldown after completion: even once a request finishes, further
//      requests from the same tab are throttled briefly. This is a safety
//      net against any UI bug that might fire repeated clicks/messages, not
//      a defense against an external attacker (nothing external can trigger
//      this message in the first place — see manifest.json; only this
//      extension's own content scripts send "open-llm-rewrite").
const inFlightByTab = new Set();
const lastCompletedAtByTab = new Map();
const COOLDOWN_MS = 3000;

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "open-llm-rewrite") {
    handleLLMRewrite(message.text, sender.tab?.id);
    return; // no synchronous response needed; result is pushed via sendMessage below
  }
});

async function handleLLMRewrite(text, tabId) {
  if (tabId == null) return; // no tab to reply to; nothing useful we can do

  // Acquire the lock and check cooldown synchronously, before any await —
  // see comment above inFlightByTab for why this ordering matters.
  if (inFlightByTab.has(tabId)) {
    notifyTab(tabId, { type: "llm-rewrite-result", error: "rate-limited", detail: "already-in-flight" });
    return;
  }
  const lastCompleted = lastCompletedAtByTab.get(tabId);
  if (lastCompleted && Date.now() - lastCompleted < COOLDOWN_MS) {
    notifyTab(tabId, { type: "llm-rewrite-result", error: "rate-limited", detail: "cooldown" });
    return;
  }
  inFlightByTab.add(tabId);

  try {
    const { anthropicApiKey } = await chrome.storage.local.get("anthropicApiKey");

    if (!anthropicApiKey) {
      notifyTab(tabId, { type: "llm-rewrite-result", error: "no-api-key" });
      return;
    }
    if (!text || !text.trim()) {
      notifyTab(tabId, { type: "llm-rewrite-result", error: "empty-text" });
      return;
    }
    if (text.length > MAX_REWRITE_INPUT_CHARS) {
      notifyTab(tabId, {
        type: "llm-rewrite-result",
        error: "input-too-large",
        detail: `${text.length} chars exceeds ${MAX_REWRITE_INPUT_CHARS} limit`,
      });
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": anthropicApiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001", // fast, cheap — appropriate for a rewrite-only task
          max_tokens: 2000,
          messages: [
            {
              role: "user",
              content:
                "Rewrite the following prompt to use fewer tokens while preserving its full meaning, " +
                "instructions, and intent exactly. Do not add commentary. Return ONLY the rewritten prompt, " +
                "nothing else.\n\n---\n\n" +
                text,
            },
          ],
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      // Don't forward the raw response body to the content script/UI — it
      // may echo back request details we'd rather not surface verbatim, and
      // callers only need a status code to decide what to show the user.
      notifyTab(tabId, { type: "llm-rewrite-result", error: "api-error", detail: `HTTP ${response.status}` });
      return;
    }

    const data = await response.json();
    const rewritten = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    notifyTab(tabId, { type: "llm-rewrite-result", rewritten });
  } catch (e) {
    const isTimeout = e?.name === "AbortError";
    notifyTab(tabId, { type: "llm-rewrite-result", error: isTimeout ? "timeout" : "network-error" });
  } finally {
    inFlightByTab.delete(tabId);
    lastCompletedAtByTab.set(tabId, Date.now());
  }
}

function notifyTab(tabId, payload) {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, payload).catch(() => {
    // Tab may have navigated away or closed — nothing to do.
  });
}

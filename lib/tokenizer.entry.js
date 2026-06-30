// This file is bundled by esbuild into lib/tokenizer.bundle.js (~2.3MB raw,
// ~1.1MB gzipped over the wire). It is intentionally NOT listed in manifest.json's
// content_scripts — it is injected on demand by lib/tokenizer-loader.js the first
// time the user focuses a supported chat box, so pages aren't penalized with this
// weight until the feature is actually used.
//
// Only o200k_base (GPT-4o / GPT-4.1's encoding) is bundled. The legacy cl100k_base
// table (GPT-4 / 3.5) was deliberately dropped to roughly halve this bundle's size;
// text on those older models falls back to the estimator instead.
import { Tiktoken } from "js-tiktoken/lite";
import o200k_base from "js-tiktoken/ranks/o200k_base";

let encoder = null;

function getEncoder() {
  if (!encoder) encoder = new Tiktoken(o200k_base);
  return encoder;
}

function countExact(text) {
  if (!text) return 0;
  return getEncoder().encode(text).length;
}

// IMPORTANT: this script is injected via a <script src> tag, so it runs in the
// PAGE's own JS context — a separate world from the content script (badge.js,
// main.js, etc.), which runs "isolated". The two worlds do not share `window`.
// We bridge them with postMessage, listening here for count requests and
// replying with results, rather than exposing a shared object that the content
// script could never actually see.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "tokenmeter-content" || msg.type !== "count-exact") return;

  const count = countExact(msg.text);
  window.postMessage(
    { source: "tokenmeter-page", type: "count-exact-result", requestId: msg.requestId, count, encoding: "o200k_base" },
    "*"
  );
});

// Let the content script know the exact tokenizer has finished loading and is
// ready to receive "count-exact" requests.
window.postMessage({ source: "tokenmeter-page", type: "exact-ready" }, "*");

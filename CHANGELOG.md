# Changelog

All notable changes to Token Meter are documented here. Versions correspond to `manifest.json`'s `version` field.

## 0.5.0

### Changed
- Removed the "messages left" countdown for Claude specifically (ChatGPT and Gemini unaffected). The countdown estimates against the *context window*, which is a different ceiling from Claude's actual *usage quota* (Anthropic's rolling message limit, tied to plan and model). Showing both side-by-side — especially alongside a dedicated tool that reads Anthropic's real session/quota data — produced two numbers that looked like they answered the same question but didn't; ours was consistently a much larger, less useful number, since the 200K-token context window is rarely the actual binding constraint compared to the quota. Controlled per-site via `SHOW_MESSAGES_LEFT_BY_SITE` in `content/main.js`. The "Used so far" and "Tokens left" rows still show for Claude — only the messages-left countdown specifically is hidden.
- `badge.js`'s `update()` now distinguishes three distinct states for the messages-left field instead of two: a real number, `null` (not enough history yet — may resolve as the conversation continues), and the new literal `"disabled"` (intentionally not shown for this site). Previously `null` and `undefined` were treated identically, which would have made a permanently-disabled state read as "may show up later," which isn't true.

## 0.4.0

### Fixed
- **Claude history scraping was non-functional.** The selector looked for `data-testid` values containing `"claude-message"` or `"assistant-message"`, neither of which exist on claude.ai's current DOM. Assistant messages are actually identified by the class `.font-claude-response`, with no matching `data-testid`. User messages use `[data-testid="user-message"]`, which was already correct. An earlier diagnostic attempt also chased a red herring: a class named `font-user-message` looked plausible in a quick DOM inspection, but the literal class string is `!font-user-message` — Tailwind's `!important` modifier prefix is part of the class name itself, and a CSS selector can't match a class starting with `!` without escaping it. Fixed by combining the correct attribute selector (user) and class selector (assistant), merged back into true document order via `compareDocumentPosition` since the two node sets are queried separately.
- **Badge missing on newly started conversations.** Manifest V3 content scripts only auto-inject on a full page load, not on a single-page app's client-side route changes (e.g. clicking "New chat" without a full reload). Added a `location.href` poll (`watchForUrlChanges`, 1s interval) that tears down and rebuilds the badge on navigation, with a re-entrancy guard (`safeReinit`) so it can't double-fire alongside the existing composer-disappearance `MutationObserver`.

### Notes
- The "Not enough history yet" message reported on the free tier was the same root cause as the Claude scraping bug above, not a tier-specific issue — it would have appeared on any Claude conversation, paid or free, given the selector was broken for everyone.
- Investigated reverse-engineering Claude's internal usage API (the technique tools like Tally use) to add a real usage-quota/reset-timer display. Declined to implement: doing so would require either capturing session credentials directly or parsing Anthropic's undocumented internal API traffic, both of which meaningfully expand the extension's attack surface in ways inconsistent with its "read only what's visibly rendered, never touch session internals" design. Documented as an intentional non-goal.

## 0.3.0

### Added
- On-demand token summary in the badge panel: draft tokens, total conversation tokens used, context limit, tokens remaining, and messages left, all shown together and internally consistent (used = history + draft, remaining = limit − used).
- Manual "↻ Refresh now" button for an immediate history rescan instead of waiting for the 4-second auto-refresh.

### Changed
- Clarified panel labeling: the field previously called "Estimated tokens" (which only showed the draft box's count) is now explicitly "Draft (this box)," separate from the new "Used so far (conversation)" total — the old label could be misread as a conversation-wide figure.

## 0.2.0

### Added
- "Messages left" countdown: estimates how many more user-message/assistant-reply **pairs** could fit in the current conversation before hitting the context limit, based on a running average of pair sizes seeded from the entire visible conversation history (not just messages sent after installing the extension).
- Per-site history scraping (`scrapeHistory()` in each adapter):
  - ChatGPT: `data-message-author-role` attribute (reliable, confirmed via research).
  - Claude / Gemini: a shared "bounded ascent" structural heuristic (`lib/history-scraper.js`) for sites without a reliable role attribute at the time — later replaced for Claude in 0.4.0 once exact selectors were confirmed against the live DOM.
- `lib/messages-left.js`: pure, independently unit-tested math module computing the countdown. Refactored mid-development from a text-keyed `tokenize()` callback to parallel pre-computed count arrays, after identifying that two messages with identical text content could otherwise be silently miscounted by a value-based lookup.

### Fixed
- Two bugs found while building the structural history heuristic, both caught by adversarial testing before shipping: an outer wrapper `<div>` swallowing multiple distinct messages into one blob, and an inner leaf node losing nested content (e.g. code blocks) that lived in a sibling element within the same message. Fixed with a "bounded ascent" algorithm that promotes from leaf nodes up to (but not past) the point where a parent would start merging multiple messages.

### Research notes
- Confirmed GPT-4o has been retired from ChatGPT (now GPT-5.x family) but still uses the `o200k_base` tokenizer, so the bundled exact tokenizer remains valid.
- Confirmed ChatGPT's context limit is not a flat figure — it ranges roughly 16K (Free) to 272K (Pro/Enterprise) depending on plan and mode. `DEFAULT_LIMIT_BY_SITE` reflects a reasonable default (32K, the common Plus-tier case), not a detected value.

## 0.1.0

Initial release.

### Added
- Live token counter badge (ring-gauge UI) on chatgpt.com, claude.ai, and gemini.google.com, debounced to the composer's input events.
- Exact token counting for ChatGPT via a lazy-loaded `o200k_base` tiktoken bundle (~2.3MB, ~1.1MB gzipped) — only injected into the page on first focus of the chat box, not on every page load, to avoid penalizing visits where the feature isn't used.
- Estimated token counting (chars/words blend) for Claude and Gemini, since neither platform publishes its tokenizer.
- Mechanical prompt trimming ("Trim prompt (free)"): a fixed, deterministic list of filler-phrase removals and whitespace collapsing — no network call, no cost. Catches phrases like "in order to," "due to the fact that," "I just wanted to ask," etc. Demonstrated ~50% token reduction on a deliberately filler-heavy test prompt.
- Optional AI-powered rewrite ("Rewrite with AI"), using the user's own Anthropic API key, stored in `chrome.storage.local`.
- Background service worker (`background/background.js`) handling the AI rewrite call, with:
  - Per-tab in-flight lock (acquired synchronously before any `await`, after testing caught a real check-then-act race condition in an earlier draft) and a 3-second cooldown, preventing rapid clicks from firing overlapping API calls.
  - 20,000-character input cap and 30-second request timeout.
  - Specific, user-facing error messages per failure mode (no key, empty text, too large, rate-limited, timeout, API error, network error) rather than a single generic failure message.
- Popup UI for entering/clearing the Anthropic API key.

### Security
- Audited every dynamic DOM write; all use `.textContent` except one pre-escaped `.innerHTML` call site that only ever receives hardcoded strings, never page-scraped or API-returned content.
- `manifest.json` requests only the `storage` permission, with `host_permissions` and `web_accessible_resources` scoped to exactly the four domains the extension operates on (no broad `<all_urls>` grant).
- No `externally_connectable` declared — no web page, including the chat sites themselves, can message the extension's background worker directly; only its own content scripts can.
- Found and fixed a real performance bug in the token estimator: `.split(/\s+/).filter(Boolean)` allocated large intermediate arrays on very long input, measured at ~787ms on a 4MB paste (enough to visibly stall the debounced per-keystroke badge update). Replaced with a single-pass character-code word counter plus a sampling fallback past 200,000 characters; measured ~115x speedup (787ms → ~7ms) on the same input with no behavior change on realistic prompt sizes.

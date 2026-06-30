# Token Meter

A Chrome extension that shows a live token count while you type into ChatGPT,
Claude, or Gemini, and offers a free, instant way to trim filler from your
prompt before you send it — plus an optional AI-powered rewrite using your own
Anthropic API key.

## Loading it in Chrome (for development/testing)

1. Open `chrome://extensions`
2. Toggle on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this folder (`token-optimizer/`)
5. Visit chatgpt.com, claude.ai, or gemini.google.com and click into the chat box — a small ring badge should appear in the bottom-right corner

## How counting works

| Site | Method | Why |
|---|---|---|
| ChatGPT | Exact (`o200k_base`, real tiktoken) | OpenAI publishes this tokenizer; still used by GPT-5.x as of this writing |
| Claude | Estimate (chars+words blend) | Anthropic doesn't publish Claude's tokenizer |
| Gemini | Estimate (chars+words blend) | Google doesn't publish Gemini's tokenizer |

The exact tokenizer (~2.3MB) is **not** loaded on page load. It's injected
only the first time you focus the chat box on chatgpt.com, so visiting the
site without using the feature costs nothing extra. See `lib/tokenizer-loader.js`
and `lib/tokenizer.entry.js` for the mechanism — the loader and the tokenizer
run in different JS contexts (content script vs. injected page script) and
talk to each other over `postMessage`.

## "Messages left" countdown

Click the badge to expand the panel. It shows:

- **Draft (this box)** — tokens in your current, unsent composer text
- **Used so far (conversation)** — total tokens across the whole scraped
  conversation history plus your draft, i.e. what's actually committed
  against the context window right now
- **Context limit** — the assumed limit for this site (see caveat below)
- **Tokens left** — Context limit − Used so far
- **Messages left (≈)** — see below (ChatGPT and Gemini only — see note)

The panel auto-refreshes its history scan every 4 seconds. Click **↻ Refresh
now** for an immediate rescan instead of waiting for the next tick — useful
right after a long reply finishes, if you want the freshest possible number
before deciding whether to keep going in this conversation or start a new one.

On **ChatGPT and Gemini**, the badge also estimates how many more
user-message/assistant-reply **pairs** could fit in the current conversation
before hitting the context limit. It does this by:

1. Scraping every message currently rendered on the page (`scrapeHistory()`
   in each adapter) to compute a running average pair size — seeded from the
   *entire visible conversation*, not just messages sent after installing the
   extension.
2. Subtracting (history tokens + current draft tokens) from the context
   limit to get tokens remaining.
3. Dividing remaining tokens by the average pair size.

**Not shown on Claude, intentionally.** This countdown estimates against the
*context window* (how much fits in one conversation), which is a different
thing from Claude's actual *usage quota* (Anthropic's rolling 5-hour message
limit, tied to your plan and which model you're using). The context window
(200K tokens) is rarely the binding constraint compared to the quota, so our
number — while technically correct about what it measures — isn't the
number people actually want to see for Claude, and showing it next to a real
quota figure (e.g. from a dedicated tool that reads Anthropic's session data
directly) just creates two numbers that look like they answer the same
question but don't. Controlled by `SHOW_MESSAGES_LEFT_BY_SITE` in
`content/main.js`. The **Used so far** / **Tokens left** rows above still
show for Claude — only the messages-left countdown specifically is hidden.

Two important caveats:
- **Context limits vary by plan/mode and aren't exposed to the page.** ChatGPT
  alone ranges from 16K (Free) to 272K (Pro/Enterprise) tokens depending on
  plan and selected mode. The defaults in `content/main.js`
  (`DEFAULT_LIMIT_BY_SITE`) are reasonable guesses, not detected values — the
  countdown is only as accurate as that assumption.
- **History scraping**: ChatGPT uses the reliable `data-message-author-role`
  attribute. Claude uses `[data-testid="user-message"]` for user turns and
  `.font-claude-response` for assistant turns — both confirmed directly
  against claude.ai's live DOM. Gemini still uses the structural fallback
  (`lib/history-scraper.js`, "bounded ascent"), since no equivalent reliable
  attribute was found there; it was tested against two specific failure
  modes (an outer wrapper swallowing multiple messages, and an inner leaf
  losing nested content like code blocks) but may need adjustment if
  Google's DOM changes. **Maintainer note**: an earlier attempt at the
  Claude selectors used a class named `font-user-message`, which looked
  right in a quick DOM inspection but was actually the literal string
  `!font-user-message` — Tailwind's `!important` modifier syntax is part of
  the class name itself. A CSS class selector can't match a class starting
  with `!` without escaping it, so that selector silently matched nothing.
  If Claude history-scraping breaks again, check for this kind of thing
  before assuming the DOM changed.

## How "optimize" works

- **Trim prompt (free)** — `lib/optimizer.js`. Deterministic, local rules:
  collapses excess whitespace, strips a conservative list of filler phrases
  ("please note that", "in order to" → "to", etc). No network call.
- **Rewrite with AI** — sends your prompt to the Anthropic API (Claude Haiku)
  with your own API key, asking for a token-saving rewrite. Costs you a small
  amount of API usage. Requires entering a key in the popup first.

## Rebuilding the tokenizer bundle

If you ever need to rebuild `lib/tokenizer.bundle.js` (e.g. after changing
`lib/tokenizer.entry.js`):

```
npm install
npx esbuild lib/tokenizer.entry.js --bundle --minify --format=iife --outfile=lib/tokenizer.bundle.js
```

## Project structure

```
manifest.json              Extension manifest (Manifest V3)
lib/
  estimator.js              Tiny, always-loaded approximate counter
  tokenizer.entry.js         Source for the exact tokenizer (pre-bundle)
  tokenizer.bundle.js         Built exact tokenizer (o200k_base), lazy-loaded
  tokenizer-loader.js         Injects the bundle on demand, bridges postMessage
  optimizer.js               Mechanical (free) prompt-trimming rules
  history-scraper.js          Shared structural fallback for scraping chat history
  messages-left.js            Computes the "messages left" countdown
content/
  adapter-chatgpt.js          Finds/reads/writes ChatGPT's composer + scrapes history
  adapter-claude.js           Finds/reads/writes Claude's composer + scrapes history
  adapter-gemini.js           Finds/reads/writes Gemini's composer + scrapes history
  badge.js / badge.css        The floating ring-gauge badge UI
  main.js                    Orchestrates adapter + tokenizer + optimizer + badge
background/
  background.js              Service worker: handles the opt-in AI rewrite call
popup/
  popup.html/css/js          API key entry + how-it-works summary
icons/                      Extension icons (16/48/128px)
```

## Security notes

This extension has no backend server, no webhooks, no cron jobs, and no
cookie/session-based auth — so several standard web-app security categories
(CORS, CSRF, SSRF, webhook signing) don't have a corresponding attack surface
here. What's actually relevant for a Manifest V3 extension, and what's been
done about it:

- **Rate limiting**: the AI-rewrite call (`background/background.js`) uses a
  per-tab in-flight lock (acquired synchronously, before any `await`, to
  avoid a check-then-act race — verified with a test that initially caught
  this exact race) plus a 3-second cooldown after each completed request, so
  rapid clicking can't fire overlapping calls or silently burn through the
  user's API budget.
- **Input validation**: the rewrite call caps input at 20,000 characters and
  times out after 30 seconds; the live token estimator (`lib/estimator.js`)
  switches to sampling past 200,000 characters so a huge paste can't freeze
  the per-keystroke UI update (measured ~115x speedup on a 4MB stress input
  after fixing an array-allocation bottleneck).
- **Output encoding / XSS**: every dynamic value written into the badge UI
  uses `.textContent`, never `.innerHTML`, with one exception
  (`showOptimizeSummary` in `content/badge.js`) that does use `innerHTML` but
  only ever receives hardcoded rule-label strings from `lib/optimizer.js` —
  verified by tracing every call site — and is still escaped regardless.
  Text written back into the chat composer (`setText` in each adapter) goes
  through `execCommand('insertText', ...)` or `el.value =`, which insert as
  literal text, not parsed HTML.
- **Permission scope**: `manifest.json` requests only the `storage`
  permission and scopes `host_permissions` to the four exact domains this
  extension operates on, rather than a broad `<all_urls>` grant.
  `web_accessible_resources` similarly restricts which sites can load
  `tokenizer.bundle.js`.
- **Message sender trust boundary**: `externally_connectable` is not declared
  in the manifest, so no web page — including chatgpt.com/claude.ai/
  gemini.google.com themselves — can send messages into this extension's
  `chrome.runtime.onMessage` listener. Only this extension's own content
  scripts can trigger the background worker's API call.
- **API key storage**: stored in `chrome.storage.local`, unencrypted —
  consistent with how most browser extensions handle user-supplied API keys.
  Anyone with local filesystem access to the Chrome profile could in
  principle read it, but that threat model already implies broader
  compromise than this one key.
- **Known residual risk**: `sender.tab.id`/`sender.url` in a
  `chrome.runtime.onMessage` listener can be spoofed by a compromised
  renderer process (a documented Chromium caveat, not specific to this
  extension). Worst case here, a compromised host page could bypass the
  per-tab rate limit by claiming different tab IDs — it could not exfiltrate
  the API key, since the key is only ever sent directly to
  `api.anthropic.com`. Defending further against this would require the host
  page itself to already be compromised, which is outside this extension's
  threat model.

## Known limitations

- **SPA client-side navigation handling.** Manifest V3 content scripts only
  auto-inject on a full page load, not on a single-page app's client-side
  route changes (e.g. clicking "New chat" without a full reload). `main.js`
  polls `location.href` every second and rebuilds the badge when it changes,
  to handle this — previously the badge would simply not appear on any
  conversation started after the initial page load. This is a polling-based
  workaround, not a perfect hook into each site's router, so there's a
  brief (~1 second) window after navigating before the badge reappears.

- **No usage-quota "replenish timer".** This extension only tracks the
  *context window* (how much fits in one conversation) — it deliberately
  does NOT show a countdown to when your message quota resets (e.g.
  ChatGPT's rolling rate limit). That number lives on the provider's server,
  tied to your account/billing tier, and isn't exposed anywhere in the page
  for the extension to read. Some other extensions approximate this by
  calling the site's internal, undocumented usage API or by self-counting
  messages you send and guessing from the platform's published window — both
  were considered and intentionally skipped here, since neither produces a
  number reliable enough to act on, and a wrong countdown is worse than none.

- Context limits used for the "messages left" countdown
  (`DEFAULT_LIMIT_BY_SITE` in `content/main.js`) are reasonable defaults, not
  detected values — actual limits vary by plan and mode and aren't exposed to
  the page, so the countdown will be off for anyone whose plan differs from
  the assumed default.
- Selectors for each site's chat box are based on their current DOM as of
  mid-2026 and **will** break when these sites redesign their composer —
  that's normal for any extension targeting a site you don't control. Each
  adapter lists fallback selectors, most-specific first.
- Claude and Gemini counts are always estimates (±5-10% typically for English
  prose; less accurate for code or non-English text), since neither company
  publishes their tokenizer.
- The AI rewrite feature sends your prompt text to Anthropic's API using your
  own key — review `background/background.js` if you want to audit exactly
  what's sent.

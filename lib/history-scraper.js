// Shared structural fallback for scraping conversation history on sites that
// don't expose a reliable role attribute (e.g. claude.ai, gemini.google.com).
// Used by content/adapter-claude.js and content/adapter-gemini.js.
//
// Algorithm ("bounded ascent"), verified against two adversarial cases before
// shipping (see project history): start from the innermost text-bearing divs
// inside a root element, then repeatedly promote each one to its parent as
// long as doing so wouldn't merge two distinct messages into one (i.e. the
// parent currently has exactly one candidate descendant mapped to it). This
// avoids both failure modes tested directly:
//   - Grabbing only a message's inner leaf, losing nested content like code
//     blocks or lists that live in a sibling div within the same message.
//   - Grabbing an outer scroll-container, merging many distinct messages
//     into one blob.
// Includes a hard iteration cap as a guard against unexpected DOM shapes.

window.TokenMeter = window.TokenMeter || {};

window.TokenMeter.boundedAscentHistory = function boundedAscentHistory(rootSelectors, maxIterations) {
  const MAX_ITERATIONS = maxIterations || 50;
  const selectors = Array.isArray(rootSelectors) ? rootSelectors : [rootSelectors];

  let root = null;
  for (const sel of selectors) {
    root = document.querySelector(sel);
    if (root) break;
  }
  if (!root) root = document.body; // last resort: scan the whole page

  const candidates = Array.from(root.querySelectorAll("div")).filter(
    (el) => el.innerText && el.innerText.trim().length > 0
  );
  if (candidates.length === 0) return [];

  const candidateSet = new Set(candidates);
  let current = candidates.filter((el) => !candidates.some((other) => other !== el && el.contains(other)));

  function nearestCandidateAncestor(el) {
    let p = el.parentElement;
    while (p && p !== root && !candidateSet.has(p)) p = p.parentElement;
    return p === root ? null : p;
  }

  let changed = true;
  let iterations = 0;

  while (changed && iterations < MAX_ITERATIONS) {
    changed = false;
    iterations++;

    const childCountByParent = new Map();
    for (const el of current) {
      const parent = nearestCandidateAncestor(el);
      const key = parent || el;
      childCountByParent.set(key, (childCountByParent.get(key) || 0) + 1);
    }

    const next = [];
    for (const el of current) {
      const parent = nearestCandidateAncestor(el);
      if (parent && childCountByParent.get(parent) === 1) {
        next.push(parent);
        changed = true;
      } else {
        next.push(el);
      }
    }
    current = Array.from(new Set(next));
  }

  return current.map((el, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    text: (el.innerText || "").trim(),
  }));
};

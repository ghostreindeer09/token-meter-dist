// Pure, deterministic prompt-shrinking rules. No network calls, no API cost.
// Each rule is a small function: (text) -> { text, changed, label } so the UI
// can show *what* was trimmed, not just present a black-box rewrite.

window.TokenMeter = window.TokenMeter || {};

(function () {
  const RULES = [
    {
      label: "Removed filler phrases",
      // Conservative list: phrases that add length but not meaning in a prompt
      // to an LLM. Deliberately NOT touching phrases that could carry intent
      // (e.g. "please" alone is left untouched — politeness markers are cheap
      // and some users want them kept).
      //
      // Each entry pairs a pattern with its own replacement (empty string to
      // delete the phrase outright, or a shorter synonym). Whitespace around
      // the match is intentionally left alone here — the whitespace-collapse
      // rule runs AFTER this one and mops up any double-spaces or blank runs
      // these replacements leave behind, rather than each pattern trying to
      // manage spacing itself.
      replacements: [
        [/\bI just wanted to (ask|say|mention|note)\b,?/gi, ""],
        [/\bI was wondering if\b/gi, ""],
        [/\bplease note that\b/gi, ""],
        [/\bkindly note that\b/gi, ""],
        [/\bas (I|we) (mentioned|said) (before|earlier)\b,?/gi, ""],
        [/\bin order to\b/gi, "to"],
        [/\bdue to the fact that\b/gi, "because"],
        [/\bat this point in time\b/gi, "now"],
        [/\bfor all intents and purposes\b/gi, ""],
        [/\bit is important to note that\b/gi, ""],
        [/\bneedless to say\b,?/gi, ""],
      ],
      apply(text) {
        let next = text;
        for (const [pattern, replacement] of this.replacements) {
          next = next.replace(pattern, replacement);
        }
        return next;
      },
    },
    {
      label: "Collapsed extra blank lines and spaces",
      apply(text) {
        const next = text
          .replace(/[ \t]+\n/g, "\n") // trailing spaces on a line
          .replace(/\n{3,}/g, "\n\n") // 3+ blank lines -> 1 blank line
          .replace(/[ \t]{2,}/g, " "); // runs of spaces/tabs -> single space
        return next;
      },
    },
    {
      label: "Trimmed leading/trailing whitespace",
      apply(text) {
        return text.trim();
      },
    },
  ];

  /**
   * Run all mechanical rules over `text`. Returns the optimized text plus a
   * list of which rules actually changed something (for showing a diff/summary
   * in the UI) — rules that made no change are omitted from `applied`.
   */
  function optimizeMechanical(text) {
    let current = text;
    const applied = [];

    for (const rule of RULES) {
      const next = rule.apply(current);
      if (next !== current) {
        applied.push(rule.label);
        current = next;
      }
    }

    return { text: current, applied, changed: applied.length > 0 };
  }

  window.TokenMeter.optimizer = { optimizeMechanical };
})();

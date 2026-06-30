// Always loaded immediately on every page — must stay tiny (no rank tables here).
// Provides a fast approximate token count, used until/unless the exact tokenizer
// is lazy-loaded (see lib/tokenizer-loader.js).

window.TokenMeter = window.TokenMeter || {};

// Defensive cap: this runs on every debounced keystroke (see content/main.js),
// so it needs to stay fast even if someone pastes something absurd (e.g. a
// multi-megabyte document) into the chat box. Counting tokens beyond this
// point doesn't add much value to the UI anyway — the badge just needs to
// communicate "very large", not a precise number, past a certain size.
const MAX_CHARS_FOR_FULL_ESTIMATE = 200000; // ~50k tokens; comfortably past any real prompt

/** Counts whitespace-separated words in one pass, without allocating an array. */
function countWords(text) {
  let count = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const isSpace = isWhitespaceChar(text.charCodeAt(i));
    if (!isSpace && !inWord) {
      count++;
      inWord = true;
    } else if (isSpace) {
      inWord = false;
    }
  }
  return count;
}

/** Fast whitespace check by char code, avoiding a regex call per character. */
function isWhitespaceChar(code) {
  // space, tab, newline, carriage return, vertical tab, form feed
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 11 || code === 12;
}

function estimateExact(text) {
  const chars = text.length;
  const words = countWords(text);
  const byChars = chars / 4;
  const byWords = words * 1.3;
  return Math.round((byChars + byWords) / 2);
}

/**
 * Rough token estimate, blending a chars-per-token heuristic with a
 * words-per-token heuristic. Typically within ~5-10% of real BPE counts
 * for English prose; less accurate for code or non-English text.
 *
 * On very large inputs (past MAX_CHARS_FOR_FULL_ESTIMATE), extrapolates from
 * a prefix sample instead of scanning the whole string, so a debounced
 * per-keystroke call stays fast even if someone pastes a huge document. The
 * badge is already just communicating "this is a lot" at that size, so the
 * small accuracy loss from sampling doesn't change what the user sees.
 */
function estimateTokens(text) {
  if (!text) return 0;

  if (text.length > MAX_CHARS_FOR_FULL_ESTIMATE) {
    const sample = text.slice(0, MAX_CHARS_FOR_FULL_ESTIMATE);
    const sampleEstimate = estimateExact(sample);
    return Math.round(sampleEstimate * (text.length / sample.length));
  }

  return estimateExact(text);
}

window.TokenMeter.estimator = { estimateTokens };

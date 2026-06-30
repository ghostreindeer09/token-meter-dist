// Computes "messages left" — an estimate of how many more user-message/
// assistant-reply PAIRS could fit in the current conversation before hitting
// the model's context limit, based on the actual size of pairs seen so far
// in the scraped conversation history (a running average), not a guess.
//
// Deliberately counts pairs, not just user messages: every reply you get back
// also consumes context budget, so a countdown based on user messages alone
// would overstate how many more times you can hit Send.

window.TokenMeter = window.TokenMeter || {};

window.TokenMeter.messagesLeft = (function () {
  /**
   * @param {Array<{role: "user"|"assistant", text: string}>} history - scraped conversation, in order
   * @param {number[]} historyCounts - token count for each entry in `history`, SAME LENGTH, same order.
   *   Passed as pre-computed counts (rather than a callback keyed by text) so that two messages
   *   with identical text are still counted correctly and independently — a callback keyed by
   *   text content alone can't distinguish "user said 'yes' at turn 2" from "user said 'yes' at
   *   turn 8", and would silently misattribute counts between them.
   * @param {number} draftCount - token count of the current (unsent) composer text
   * @param {number} limit - context window size in tokens
   * @returns {{
   *   messagesLeft: number|null,   // null if there isn't enough history yet to estimate
   *   usedTokens: number,          // history + draft, i.e. tokens committed if you hit Send now
   *   remainingTokens: number,     // limit - usedTokens, floored at 0
   *   avgPairTokens: number|null,  // running average size of a user+assistant pair, null if no complete pairs yet
   *   pairsObserved: number,
   * }}
   */
  function compute(history, historyCounts, draftCount, limit) {
    const historyTokens = historyCounts.reduce((sum, c) => sum + c, 0);
    const usedTokens = historyTokens + draftCount;
    const remainingTokens = Math.max(limit - usedTokens, 0);

    const pairs = pairUpTurns(history, historyCounts);
    const pairsObserved = pairs.length;

    if (pairsObserved === 0) {
      return { messagesLeft: null, usedTokens, remainingTokens, avgPairTokens: null, pairsObserved: 0 };
    }

    const totalPairTokens = pairs.reduce((sum, pair) => sum + pair.tokens, 0);
    const avgPairTokens = totalPairTokens / pairsObserved;

    // Guard against division by ~0 (e.g. history scraped but all messages
    // were empty strings) — treat as "can't estimate" rather than Infinity.
    if (avgPairTokens < 1) {
      return { messagesLeft: null, usedTokens, remainingTokens, avgPairTokens: null, pairsObserved };
    }

    const messagesLeft = Math.floor(remainingTokens / avgPairTokens);
    return { messagesLeft, usedTokens, remainingTokens, avgPairTokens, pairsObserved };
  }

  /**
   * Walk the scraped history (with parallel pre-computed counts) and group
   * into {tokens} pairs, where tokens = userCount + assistantCount. Only
   * COMPLETE pairs count toward the average — a trailing user message with
   * no reply yet (e.g. mid-generation, or scraping caught it before the
   * assistant turn rendered) is excluded rather than guessed at.
   * Tolerant of minor role-detection noise (e.g. two "user" in a row from a
   * scraping misfire) by always pairing the next "assistant" found after
   * each "user", rather than assuming strict alternation.
   */
  function pairUpTurns(history, historyCounts) {
    const pairs = [];
    let pendingUserCount = null;

    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      const count = historyCounts[i];
      if (msg.role === "user") {
        pendingUserCount = count;
      } else if (msg.role === "assistant" && pendingUserCount !== null) {
        pairs.push({ tokens: pendingUserCount + count });
        pendingUserCount = null;
      }
    }
    return pairs;
  }

  return { compute };
})();

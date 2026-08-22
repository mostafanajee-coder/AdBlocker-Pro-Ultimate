/* ============================================================================
 * youtube-sanitizer.js — pure YouTube response sanitizer
 *
 * Loaded before youtube-main.js in YouTube's MAIN world.  It deliberately has
 * no DOM or extension-API dependency so the exact pruning logic can be tested
 * under Node as well as used in the browser.
 * ========================================================================== */

(function (root, factory) {
  "use strict";

  var api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ABPYouTubeSanitizer = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Keep native references. youtube-main.js hooks JSON.parse after this file
  // loads, and the sanitizer must never call the hooked function recursively.
  var nativeParse = JSON.parse;
  var nativeStringify = JSON.stringify;

  var AD_KEYS = Object.create(null);
  [
    "adPlacements",
    "playerAds",
    "adSlots",
    "adBreakHeartbeatParams"
  ].forEach(function (key) { AD_KEYS[key] = true; });

  var AD_RENDERER_KEYS = Object.create(null);
  [
    "adSlotRenderer",
    "displayAdRenderer",
    "inFeedAdLayoutRenderer",
    "promotedSparklesWebRenderer",
    "promotedVideoRenderer",
    "compactPromotedVideoRenderer",
    "searchPyvRenderer",
    "videoMastheadAdV3Renderer",
    "playerLegacyDesktopWatchAdsRenderer",
    "mealbarPromoRenderer",
    "enforcementMessageViewModel"
  ].forEach(function (key) { AD_RENDERER_KEYS[key] = true; });

  function isObject(value) {
    return value !== null && typeof value === "object";
  }

  function isShortsAdEntry(value) {
    try {
      return Boolean(
        value && value.command && value.command.reelWatchEndpoint &&
        value.command.reelWatchEndpoint.adClientParams &&
        value.command.reelWatchEndpoint.adClientParams.isAd === true
      );
    } catch (_) {
      return false;
    }
  }

  function isAdRenderer(value) {
    if (!isObject(value)) return false;

    // Feed entries commonly wrap the actual ad renderer inside
    // richItemRenderer.content. Inspect only a few levels with a strict
    // budget so normal feed traversal stays cheap.
    var seen = typeof WeakSet === "function" ? new WeakSet() : null;
    var stack = [{ node: value, depth: 0 }];
    var budget = 48;

    while (stack.length && budget-- > 0) {
      var item = stack.pop();
      var node = item.node;
      if (!isObject(node)) continue;
      if (seen) {
        if (seen.has(node)) continue;
        seen.add(node);
      }
      if (isShortsAdEntry(node)) return true;

      var keys;
      try { keys = Object.keys(node); } catch (_) { continue; }
      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        if (AD_RENDERER_KEYS[key]) return true;
        if (item.depth < 3 && isObject(node[key])) {
          stack.push({ node: node[key], depth: item.depth + 1 });
        }
      }
    }
    return false;
  }

  function hasAdMarkers(text) {
    if (typeof text !== "string" || text.length === 0) return false;
    return text.indexOf("adPlacements") !== -1 ||
           text.indexOf("playerAds") !== -1 ||
           text.indexOf("adSlots") !== -1 ||
           text.indexOf("adBreakHeartbeatParams") !== -1 ||
           text.indexOf("adSlotRenderer") !== -1 ||
           text.indexOf("inFeedAdLayoutRenderer") !== -1 ||
           text.indexOf("promotedSparklesWebRenderer") !== -1 ||
           text.indexOf("reelWatchEndpoint") !== -1 ||
           text.indexOf("enforcementMessageViewModel") !== -1;
  }

  /**
   * Remove player, feed and Shorts ad structures in place.
   *
   * The walk is iterative and budgeted so a malformed/cyclic page object can
   * never recurse forever or stall the YouTube navigation path.
   */
  function sanitize(value) {
    if (!isObject(value)) return value;

    var seen = typeof WeakSet === "function" ? new WeakSet() : null;
    var stack = [value];
    var budget = 50000;

    while (stack.length && budget-- > 0) {
      var node = stack.pop();
      if (!isObject(node)) continue;
      if (seen) {
        if (seen.has(node)) continue;
        seen.add(node);
      }

      if (Array.isArray(node)) {
        for (var ai = node.length - 1; ai >= 0; ai--) {
          var entry = node[ai];
          if (isAdRenderer(entry)) {
            node.splice(ai, 1);
          } else if (isObject(entry)) {
            stack.push(entry);
          }
        }
        continue;
      }

      var keys;
      try { keys = Object.keys(node); } catch (_) { continue; }

      for (var i = 0; i < keys.length; i++) {
        var key = keys[i];

        if (AD_KEYS[key] || AD_RENDERER_KEYS[key]) {
          try { delete node[key]; } catch (_) { node[key] = undefined; }
          continue;
        }

        var child;
        try { child = node[key]; } catch (_) { continue; }

        // Some YouTube responses embed another player response as JSON text.
        if (key === "playerResponse" && typeof child === "string" && hasAdMarkers(child)) {
          try { node[key] = sanitizeText(child); } catch (_) {}
          continue;
        }

        if (isObject(child)) stack.push(child);
      }
    }

    return value;
  }

  /** Sanitize a JSON response while retaining an optional XSSI prefix. */
  function sanitizeText(text) {
    if (!hasAdMarkers(text)) return text;

    var start = -1;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (ch === "{" || ch === "[") {
        start = i;
        break;
      }
    }

    if (start !== -1) {
      var prefix = text.slice(0, start);
      var payload = text.slice(start);
      try {
        var parsed = nativeParse(payload);
        sanitize(parsed);
        return prefix + nativeStringify(parsed);
      } catch (_) {}
    }

    // If YouTube changes the envelope into something that is not directly
    // parseable, rename only the recognized keys. Unknown data is untouched.
    return text.replace(
      /"(?:adPlacements|playerAds|adSlots|adBreakHeartbeatParams)"(?=\s*:)/g,
      '"abp_no_ads"'
    );
  }

  return {
    hasAdMarkers: hasAdMarkers,
    isAdRenderer: isAdRenderer,
    sanitize: sanitize,
    sanitizeText: sanitizeText
  };
});

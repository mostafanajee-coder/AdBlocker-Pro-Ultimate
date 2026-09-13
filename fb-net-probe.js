/* ============================================================================
 *  fb-net-probe.js — network-layer + shadow-DOM sponsored-story detector
 *  (Comet 2026)
 *
 *  Two independent, read-only-by-default mechanisms, both installed in the
 *  MAIN world at document_start (see manifest.json) so they see the SAME
 *  fetch/XMLHttpRequest/attachShadow Facebook's own bundle calls — a content
 *  script's isolated world has its own separate copies that Facebook never
 *  touches.
 *
 *  1. SHADOW-DOM DISCLOSURE DETECTOR (primary detection path)
 *     Some sponsored posts render their "Ad"/"Sponsored" disclosure inside a
 *     real closed ShadowRoot, making the label unreadable by any DOM/text
 *     method — textContent, TreeWalker, aria-label lookups all see nothing.
 *     attachShadow() is intercepted at the very top of this file (before any
 *     page script runs) to capture a private reference to every ShadowRoot
 *     created, regardless of mode. This changes nothing the page itself can
 *     observe (its own el.shadowRoot still correctly returns null for a
 *     closed root) — we simply also keep a side-channel reference to the
 *     same object. When a shadow root's real, isolated text turns out to be
 *     an EXACT match for a known disclosure label ("Ad", "Sponsored",
 *     "إعلان", ...) — never a substring/heuristic match, since e.g. a CTA
 *     button's own shadow root ("Order now") must NOT match — a bubbling
 *     DOM event is dispatched on the host element. facebook.js (isolated
 *     world) listens for that event on `document` and hides the enclosing
 *     feed card.
 *
 *  2. NETWORK EARLY-WARNING (secondary, speed-only signal)
 *     Facebook's /api/graphql/ feed responses are newline-delimited JSON;
 *     each sponsored story carries an explicit "__typename":"SponsoredData"
 *     marker in the raw payload, before any client-side rendering/
 *     obfuscation happens. This is used ONLY as an early-warning signal
 *     (dispatch "__abpSponsoredDetected" the instant it's seen) so
 *     facebook.js's existing, already-safe DOM sweep runs immediately
 *     instead of waiting for its normal throttled cycle — it does not by
 *     itself identify or remove anything.
 *
 *     An earlier attempt at this file went further and tried to actually
 *     delete sponsored lines from the response body via a buffering
 *     Response.clone().text() rewrite. Even with zero content changes, full
 *     buffering alone broke Facebook's own progressive rendering and threw
 *     an uncaught React hydration error (#418) live — the response is
 *     delivered as a real incremental stream and Facebook's client expects
 *     to consume it that way. A true TransformStream re-chunk (re-emitting
 *     each complete line immediately, nothing held back beyond the next
 *     separator) confirmed safe, and line-level filtering on top of it also
 *     confirmed safe for the fetch() transport specifically. XHR was later
 *     confirmed to be the actual transport Facebook uses for feed traffic,
 *     and was deliberately NOT extended to do the same content-rewriting:
 *     evidence gathered live indicated Facebook reads XHR responseText
 *     incrementally via progress events for its own streaming render, so
 *     rewriting it risks desyncing that parser — a worse failure mode than
 *     the hydration error above. XHR is only ever observed here, never
 *     modified.
 * ========================================================================== */
(function () {
  "use strict";

  if (window.__abpNetProbeInstalled) return;
  window.__abpNetProbeInstalled = true;

  // Exact sponsorship-disclosure labels (subset of fb-detect.js's SPONSORED
  // list — kept in sync manually since this file runs in a separate world
  // and can't import that module).
  var SPONSORED_SHADOW_LABELS = [
    "sponsored", "sponsored post", "ad", "promoted",
    "مُموَّل", "ممول", "مموّل", "برعاية", "بِرعاية", "إعلان", "اعلان",
    "paid partnership", "شراكة مدفوعة",
    "sponsorisé", "commandité", "patrocinado", "publicidad",
    "gesponsert", "anzeige", "sponsorizzato", "sponsorlu",
    "bersponsor", "disponsori", "प्रायोजित", "সৌজন্যে",
    "được tài trợ", "赞助内容", "贊助", "スポンサー", "広告",
    "스폰서", "реклама", "спонсируется",
    "سپانسرڈ", "اسپانسر شده", "ממומן"
  ];

  try {
    var __abpOrigAttachShadow = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init) {
      var root = __abpOrigAttachShadow.call(this, init);
      try { __abpWatchShadowForDisclosure(this, root); } catch (_) {}
      return root;
    };

    function __abpWatchShadowForDisclosure(host, root) {
      function checkNow() {
        var text;
        try { text = (root.textContent || "").replace(/\s+/g, " ").trim(); } catch (_) { return false; }
        if (!text) return false;
        if (SPONSORED_SHADOW_LABELS.indexOf(text.toLowerCase()) === -1) return false;
        try { host.dispatchEvent(new CustomEvent("__abpShadowSponsoredDetected", { bubbles: true })); } catch (_) {}
        return true;
      }
      if (checkNow()) return;
      try {
        var mo = new MutationObserver(function () {
          if (checkNow()) { try { mo.disconnect(); } catch (_) {} }
        });
        mo.observe(root, { childList: true, subtree: true, characterData: true });
        // Bounded: most shadow roots here are short-lived UI bits (a CTA
        // button's label, etc.) that will never match — stop watching each
        // one after a few seconds so observers don't accumulate forever.
        setTimeout(function () { try { mo.disconnect(); } catch (_) {} }, 5000);
      } catch (_) {}
    }
  } catch (_) {}

  var ENABLE_LINE_FILTER = true;

  function bump(attr, by) {
    try {
      var prev = parseInt(document.documentElement.getAttribute(attr) || "0", 10);
      document.documentElement.setAttribute(attr, String(prev + by));
    } catch (_) {}
  }

  function countSponsored(text) {
    try {
      var m = text.match(/"__typename":"SponsoredData"/g);
      if (m) {
        bump("data-abp-net-sponsored-count", m.length);
        try { document.dispatchEvent(new CustomEvent("__abpSponsoredDetected")); } catch (_) {}
      }
    } catch (_) {}
  }

  /** Returns the line to emit, or null to drop it entirely. Never guesses. */
  function processLine(line) {
    if (!line || line.indexOf("SponsoredData") === -1) return line;
    countSponsored(line);
    if (!ENABLE_LINE_FILTER) return line;

    var parsed;
    try { parsed = JSON.parse(line); } catch (_) { return line; }

    if (parsed && Array.isArray(parsed.path)) {
      return null;
    }

    var newsFeed = parsed && parsed.data && parsed.data.viewer && parsed.data.viewer.news_feed;
    if (newsFeed && Array.isArray(newsFeed.edges)) {
      var kept = [];
      var trimmed = 0;
      for (var e = 0; e < newsFeed.edges.length; e++) {
        var edgeStr;
        try { edgeStr = JSON.stringify(newsFeed.edges[e]); } catch (_) { edgeStr = ""; }
        if (edgeStr && edgeStr.indexOf("SponsoredData") !== -1) { trimmed++; continue; }
        kept.push(newsFeed.edges[e]);
      }
      if (trimmed) {
        newsFeed.edges = kept;
        try { line = JSON.stringify(parsed); } catch (_) { /* re-serialize failed -> keep the original line untouched */ }
      }
    }
    return line;
  }

  /** Re-chunks the byte stream into complete lines, processes each, and
   *  re-emits immediately — nothing is held back beyond the next separator. */
  function makeLineTransform() {
    var decoder = new TextDecoder();
    var encoder = new TextEncoder();
    var buffer = "";
    return new TransformStream({
      transform: function (chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        var m;
        while ((m = /\r\n|\n/.exec(buffer))) {
          var line = buffer.slice(0, m.index);
          var sep = m[0];
          buffer = buffer.slice(m.index + sep.length);
          var out = processLine(line);
          if (out !== null) controller.enqueue(encoder.encode(out + sep));
        }
      },
      flush: function (controller) {
        buffer += decoder.decode();
        if (buffer) {
          var out = processLine(buffer);
          if (out !== null) controller.enqueue(encoder.encode(out));
        }
      }
    });
  }

  try {
    var origFetch = window.fetch;
    var canStream = typeof TransformStream !== "undefined";
    if (typeof origFetch === "function" && canStream) {
      window.fetch = function (input, init) {
        var url = (typeof input === "string") ? input : (input && input.url) || "";
        var result = origFetch.apply(this, arguments);
        if (url.indexOf("/api/graphql/") === -1) return result;

        return result.then(function (resp) {
          if (!resp.body) return resp; // nothing to stream -> original response untouched
          try {
            var transformed = resp.body.pipeThrough(makeLineTransform());
            return new Response(transformed, {
              status: resp.status,
              statusText: resp.statusText,
              headers: resp.headers
            });
          } catch (_) {
            return resp; // building the replacement failed -> original response untouched
          }
        });
      };
    }
  } catch (_) {}

  // XMLHttpRequest is observed for the early-warning signal only — never
  // modified (see file header for why).
  try {
    var OrigXHR = window.XMLHttpRequest;
    var origOpen = OrigXHR.prototype.open;
    var origSend = OrigXHR.prototype.send;
    OrigXHR.prototype.open = function (method, url) {
      this.__abpUrl = url;
      return origOpen.apply(this, arguments);
    };
    OrigXHR.prototype.send = function () {
      var xhr = this;
      if (xhr.__abpUrl && String(xhr.__abpUrl).indexOf("/api/graphql/") !== -1) {
        xhr.addEventListener("load", function () {
          try {
            if (typeof xhr.responseText === "string" && xhr.responseText.indexOf("SponsoredData") !== -1) {
              countSponsored(xhr.responseText);
            }
          } catch (_) {}
        });
      }
      return origSend.apply(this, arguments);
    };
  } catch (_) {}
})();

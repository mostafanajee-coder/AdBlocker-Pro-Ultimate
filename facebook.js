/* ============================================================================
 *  facebook.js  —  Facebook Sponsored-Content Annihilator (Zero-Overhead Edition)
 *  Part of: Ad Blocker Pro
 *
 *  WHY THIS FILE EXISTS
 *  --------------------
 *  Facebook serves ads from its OWN domain, inside the same DOM structures as
 *  normal posts. Network-level blocking (declarativeNetRequest) cannot touch
 *  them, and CSS selectors are useless because class names are randomized
 *  (x1i10hfl, x1qjc9v5, ...) and rotate constantly.
 *
 *  Facebook also actively obfuscates the word "Sponsored" / "مُموَّل" / "Ad.":
 *    - it splits the label across many <span> elements
 *    - it injects DECOY <span>s that are hidden via CSS (display:none,
 *      visibility:hidden, zero size, off-screen, clip-path)
 *    - it scrambles the DOM order and fixes it visually with flexbox `order`
 *    - it uses "Ad." or "Ad · 🌐" under the page author
 *
 *  ZERO-OVERHEAD ARCHITECTURE (Performance & 60fps Video Fluidity)
 *  -------------------------------------------------------------
 *  Previous versions suffered from layout thrashing (forced reflows) by querying
 *  all DOM elements and measuring bounding rects during video playback.
 *  This optimized version introduces:
 *    1. Fast-Path Pre-Filtering: Strings are checked before layout measurement.
 *    2. Direct Link Sweeper: Kills ad cards containing about/ads or l.php redirect traps.
 *    3. Video Mutation Shield: Playback time/progress mutations are completely ignored.
 *    4. Scoped Reel Detection: Zero global scans inside Reels loops.
 *    5. Throttled Idle Execution: Runs strictly during browser idle cycles (requestIdleCallback).
 * ========================================================================== */

(function () {
  "use strict";

  if (window.__abpFB__) return;
  window.__abpFB__ = true;

  /* ------------------------------------------------------------------ *
   * 1. SETTINGS                                                         *
   * ------------------------------------------------------------------ */

  var S = {
    adBlock: true,
    fbSponsored: true,   // hide sponsored posts
    fbSuggested: false,  // hide "Suggested for you" posts
    fbReels: false,      // hide the Reels shelf entirely
    fbSidebar: true,     // hide right-rail sponsored column
    fbDebug: false       // outline instead of hide (for testing)
  };

  var blocked = 0;
  var seen = new WeakSet();      // elements already judged
  var pending = false;
  var lastSweepTime = 0;
  var MIN_SWEEP_GAP = 280;       // ms throttle between sweeps

  /* ------------------------------------------------------------------ *
   * 2. DETECTION CORE INTEGRATION                                       *
   * ------------------------------------------------------------------ */

  function mark(state, extra) {
    try {
      document.documentElement.setAttribute("data-abp-fb", state);
      if (extra) {
        for (var k in extra) document.documentElement.setAttribute("data-abp-" + k, extra[k]);
      }
    } catch (_) {}
  }

  mark("loading");

  var D = (typeof self !== "undefined" && self.ABPDetect) ||
          (typeof window !== "undefined" && window.ABPDetect);

  if (!D) {
    mark("no-core");
    console.warn("[Ad Blocker Pro] fb-detect.js did not load - Facebook module disabled.");
    return;
  }

  var ENV = {
    doc: document,
    getStyle: function (n) { return getComputedStyle(n); },
    SHOW_TEXT: NodeFilter.SHOW_TEXT
  };

  var norm       = D.norm;
  var SPONSORED  = D.SPONSORED;
  var SUGGESTED  = D.SUGGESTED;
  var matchesAny = D.matchesAny;

  function visibleText(root) { return D.visibleText(root, ENV); }
  function readLabel(root)   { return D.readLabel(root, ENV); }

  /* ------------------------------------------------------------------ *
   * 3. CONTAINER RESOLUTION (Geometry & Card Boundary)                 *
   * ------------------------------------------------------------------ */

  var COLUMN_MIN = 240;    // narrower than this is a tiny widget
  var COLUMN_MAX = 1600;   // supports 1080p, 2K, 4K and full-width responsive feeds
  var POST_MIN_H = 100;

  function postContainerOf(el) {
    if (!el) return null;
    if (el.closest && el.closest('[role="navigation"], nav, header')) return null;

    // 1. Direct semantic container match if available
    var directCard = el.closest('div[role="article"], div[data-pagelet*="FeedUnit"], div[role="feed"] > div');
    if (directCard && directCard.clientHeight >= POST_MIN_H && directCard.clientHeight <= 2600) {
      return directCard;
    }

    var n = el, best = null;
    var isReel = (window.location && window.location.pathname.indexOf("/reel") !== -1) ||
                 (el.closest && el.closest('[scrollable="true"], [aria-label*="Reel" i], [data-pagelet*="Reel" i]'));

    var maxW = isReel ? 1800 : COLUMN_MAX;

    for (var i = 0; i < 25 && n && n.parentElement; i++) {
      n = n.parentElement;
      if (n.getAttribute && (n.getAttribute("role") === "navigation" || n.tagName === "NAV" || n.tagName === "HEADER")) break;
      var r = n.getBoundingClientRect();
      if (r.width > maxW) break;
      if (r.width >= COLUMN_MIN && r.height >= POST_MIN_H) best = n;
    }
    return best;
  }

  /* ------------------------------------------------------------------ *
   * 4. HIDING WITH VIDEO SAFETY                                         *
   * ------------------------------------------------------------------ */

  function hide(el, reason) {
    if (!el || el.__abpHidden) return false;
    el.__abpHidden = true;
    el.setAttribute("data-abp-blocked", reason);

    // Stop and silence only videos genuinely inside the confirmed ad container
    try {
      var vids = el.querySelectorAll("video");
      for (var v = 0; v < vids.length; v++) {
        vids[v].pause();
        vids[v].muted = true;
        vids[v].src = "";
      }
    } catch (_) {}

    try {
      var pre = el.getBoundingClientRect();
      el.setAttribute("data-abp-size", Math.round(pre.width) + "x" + Math.round(pre.height));
    } catch (_) {}

    if (S.fbDebug) {
      el.style.setProperty("outline", "3px solid #e53935", "important");
      el.style.setProperty("outline-offset", "-3px", "important");
      el.style.setProperty("opacity", "0.45", "important");
      blocked++;
      mark("ready", { "fb-blocked": blocked });
      return true;
    }

    el.style.setProperty("display", "none", "important");
    el.style.setProperty("height", "0", "important");
    el.style.setProperty("min-height", "0", "important");
    el.style.setProperty("margin", "0", "important");
    el.style.setProperty("padding", "0", "important");

    blocked++;
    mark("ready", { "fb-blocked": blocked });
    report();
    return true;
  }

  var reportTimer = null;
  function report() {
    if (reportTimer) return;
    reportTimer = setTimeout(function () {
      reportTimer = null;
      try { chrome.runtime.sendMessage({ type: "abpBlocked", count: blocked, host: "facebook" }).catch(function () {}); } catch (_) {}
    }, 600);
  }

  /* ------------------------------------------------------------------ *
   * 5. HIGH-SPEED LABEL DISCOVERY (Fast Pre-filtering)                 *
   * ------------------------------------------------------------------ */

  var LABEL_MIN_W = 8,   LABEL_MAX_W = 380;
  var LABEL_MIN_H = 8,   LABEL_MAX_H = 40;
  var BUDGET = 1200;

  var NEAR = /sponsor|ممول|مموّل|رعاي|patrocin|gesponsert/i;
  var HINT = /sponsor|ممول|مموّل|إعلان|اعلان|رعاي|شراك|مقترح|suggest|patrocin|gesponsert|anzeige|publicidad|disponsori|reklama|\bad[\s\.\·\:\-]|ad\b|\bads\b|\bpaid\b|\bpromoted\b/i;

  var diag = { candidates: 0, measured: 0, near: 0, sample: "" };

  function findLabels() {
    var results = [];
    var els = document.querySelectorAll("span, a, div[aria-label]");
    var vh = window.innerHeight || 900;
    var work = 0;

    diag.candidates = 0;
    diag.measured = 0;

    for (var i = 0; i < els.length && work < BUDGET; i++) {
      var e = els[i];
      if (seen.has(e) || e.__abpHidden) continue;

      // FAST PATH 1: Skip large structural elements immediately without layout reflow
      if (e.childElementCount > 8) continue;

      var raw = e.textContent || "";
      var aria = e.getAttribute ? e.getAttribute("aria-label") : null;
      var hasUse = false;
      if (e.querySelector && e.querySelector("use")) hasUse = true;

      // FAST PATH 2: String length check
      if (!hasUse && !aria) {
        var rawLen = raw.length;
        if (rawLen === 0 || rawLen > 65) {
          seen.add(e);
          continue;
        }

        // FAST PATH 3: Text heuristic check (Skip non-matching text without getBoundingClientRect)
        // If length is greater than 20 and doesn't match hints, skip safely
        if (rawLen > 20 && !HINT.test(raw)) {
          seen.add(e);
          continue;
        }
      }

      // MEASUREMENT GATE (Only reached by candidate elements)
      var r = e.getBoundingClientRect();

      // Only measure what is on screen or nearby
      if (r.bottom < -400 || r.top > vh + 800) continue;
      if (r.height < LABEL_MIN_H || r.height > LABEL_MAX_H) continue;
      if (r.width  < LABEL_MIN_W || r.width  > LABEL_MAX_W) continue;
      if (r.right < 0 || r.left < -1000) continue;

      diag.candidates++;
      seen.add(e);
      work++;
      diag.measured++;

      var lab = readLabel(e);
      if (!lab) continue;

      if (lab.length <= 45) {
        if (S.fbSponsored && matchesAny(lab, SPONSORED)) {
          results.push({ el: e, kind: "sponsored", label: lab });
          continue;
        }
        if (S.fbSuggested && matchesAny(lab, SUGGESTED)) {
          results.push({ el: e, kind: "suggested", label: lab });
          continue;
        }
      }

      if (NEAR.test(lab)) {
        diag.near++;
        if (!diag.sample || lab.length < diag.sample.length) {
          diag.sample = lab.slice(0, 60);
        }
      }
    }

    mark("ready", {
      "fb-scan": diag.candidates + "/" + diag.measured + "/" + diag.near,
      "fb-near": diag.sample || "none"
    });

    return results;
  }

  /* ------------------------------------------------------------------ *
   * 6. SWEEPS                                                           *
   * ------------------------------------------------------------------ */

  /** Direct fast sweeper for outbound ad redirect links and ad preferences */
  function sweepDirectAdLinks() {
    if (!S.adBlock || !S.fbSponsored) return;
    var adLinks = document.querySelectorAll('a[href*="/ads/about"], a[href*="/about/ads"], a[href*="facebook.com/ads/about"], a[href*="l.facebook.com/l.php"], a[href*="/ad_preferences/"]');
    for (var i = 0; i < adLinks.length && i < 30; i++) {
      var card = postContainerOf(adLinks[i]);
      if (card && !card.__abpHidden) {
        hide(card, "direct-ad-link");
      }
    }
  }

  function sweepLabels() {
    if (!S.adBlock) return;
    if (!S.fbSponsored && !S.fbSuggested) return;

    var found = findLabels();

    for (var i = 0; i < found.length; i++) {
      var hit = found[i];
      var container = postContainerOf(hit.el);
      if (!container) continue;

      var cr = container.getBoundingClientRect();

      if (cr.height > 2600) continue;
      if (cr.right < 0 || cr.left < -1000) continue;

      var lr = hit.el.getBoundingClientRect();
      if (lr.left   < cr.left   - 20 || lr.right  > cr.right  + 20 ||
          lr.top    < cr.top    - 20 || lr.bottom > cr.bottom + 20) continue;

      hide(container, hit.kind);
    }
  }

  /** Remove the Reels shelf from the feed if requested */
  function sweepReels() {
    if (!S.adBlock || !S.fbReels) return;

    var links = document.querySelectorAll('a[href*="/reel/"]');
    for (var i = 0; i < links.length && i < 20; i++) {
      var shelf = postContainerOf(links[i]);
      if (shelf && !shelf.__abpHidden) hide(shelf, "reels");
    }
  }

  var REEL_CTA_TERMS = D.normList([
    "Learn more", "Shop now", "Sign up", "Install now", "Download", "Play game",
    "Get offer", "Watch more", "Apply now", "Contact us", "Send message",
    "Book now", "Open link", "Use app", "Play now",
    "تعرف على المزيد", "تسوق الآن", "تسجيل", "تثبيت الآن", "تنزيل", "العب الآن",
    "احصل على العرض", "شاهد المزيد", "قدم الآن", "اتصل بنا", "إرسال رسالة",
    "احجز الآن", "فتح الرابط", "استخدام التطبيق"
  ]);

  /** Dedicated Scoped Sweeper for Facebook Reels ads (Zero global reflow) */
  function sweepReelAds() {
    if (!S.adBlock || (!S.fbSponsored && !S.fbSuggested)) return;
    var isReelsPage = (window.location && window.location.pathname.indexOf("/reel") !== -1) ||
                      document.querySelector('div[scrollable="true"]');
    if (!isReelsPage) return;

    var reelCards = document.querySelectorAll('div[scrollable="true"] > div, div[role="section"], div[aria-label*="Reel" i]');
    for (var i = 0; i < reelCards.length && i < 20; i++) {
      var card = reelCards[i];
      if (!card || card.__abpHidden) continue;

      var cr = card.getBoundingClientRect();
      if (cr.width < 100 || cr.height < 100) continue;

      var isAd = false;

      // 1. Check for ad redirect links
      if (card.querySelector('a[href*="l.facebook.com/l.php"], a[href*="/ads/about"], a[href*="/ads/"]')) {
        isAd = true;
      }

      // 2. Check for explicit ARIA labels on child elements
      if (!isAd) {
        var ariaEls = card.querySelectorAll('[aria-label]');
        for (var a = 0; a < ariaEls.length; a++) {
          var labelText = norm(ariaEls[a].getAttribute("aria-label"));
          if (labelText && matchesAny(labelText, SPONSORED)) {
            isAd = true;
            break;
          }
        }
      }

      // 3. Check for CTA terms (Call-To-Action buttons exist ONLY on sponsored Reels)
      if (!isAd) {
        var fullText = norm(card.innerText || "");
        if (fullText) {
          for (var c = 0; c < REEL_CTA_TERMS.length; c++) {
            if (fullText.indexOf(REEL_CTA_TERMS[c]) !== -1) {
              isAd = true;
              break;
            }
          }
        }
      }

      // 4. Scoped check ONLY inside this specific card (Eliminates O(N*M) loop)
      if (!isAd) {
        var spans = card.querySelectorAll('span, a');
        for (var s = 0; s < spans.length && s < 20; s++) {
          var sp = spans[s];
          if (sp.textContent && sp.textContent.length <= 40) {
            var lab = readLabel(sp);
            if (lab && matchesAny(lab, SPONSORED)) {
              isAd = true;
              break;
            }
          }
        }
      }

      if (isAd) {
        hide(card, "sponsored-reel");
      }
    }
  }

  function sweep() {
    pending = false;
    try { sweepDirectAdLinks(); } catch (_) {}
    try { sweepLabels(); } catch (_) {}
    try { sweepReels(); } catch (_) {}
    try { sweepReelAds(); } catch (_) {}
  }

  function schedule(force) {
    if (pending) return;
    pending = true;

    var now = Date.now();
    var elapsed = now - lastSweepTime;
    var delay = force ? 0 : Math.max(0, MIN_SWEEP_GAP - elapsed);

    setTimeout(function () {
      if (window.requestIdleCallback) {
        requestIdleCallback(function () {
          lastSweepTime = Date.now();
          sweep();
        }, { timeout: 180 });
      } else {
        lastSweepTime = Date.now();
        sweep();
      }
    }, delay);
  }

  /* ------------------------------------------------------------------ *
   * 7. LIFECYCLE & MUTATION SHIELD                                      *
   * ------------------------------------------------------------------ */

  function isVideoMutation(mutation) {
    var t = mutation.target;
    if (!t) return false;
    var tag = t.tagName;
    if (tag === "VIDEO" || tag === "CANVAS" || tag === "SVG" || tag === "PATH") return true;
    if (t.closest && t.closest('video, [role="progressbar"], [aria-label*="Play" i], [aria-label*="Pause" i], [aria-label*="Mute" i]')) {
      return true;
    }
    return false;
  }

  function start() {
    mark("ready", { "fb-labels": SPONSORED.length });
    sweep();

    var observer = new MutationObserver(function (mutations) {
      // Check if all mutations in this tick are video playback related
      var structuralChange = false;
      for (var m = 0; m < mutations.length; m++) {
        var mut = mutations[m];
        if (mut.addedNodes && mut.addedNodes.length > 0) {
          if (!isVideoMutation(mut)) {
            structuralChange = true;
            break;
          }
        }
      }
      if (structuralChange) {
        schedule(false);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    // Throttled passive scroll/gesture listeners
    var scrollScheduled = false;
    function onScrollPassive() {
      if (scrollScheduled) return;
      scrollScheduled = true;
      setTimeout(function () {
        scrollScheduled = false;
        schedule(false);
      }, 350);
    }

    window.addEventListener("scroll", onScrollPassive, { passive: true, capture: true });
    window.addEventListener("wheel", onScrollPassive, { passive: true, capture: true });
  }

  function boot() {
    try {
      chrome.storage.local.get(null, function (cfg) {
        if (cfg) for (var k in S) if (cfg[k] !== undefined) S[k] = cfg[k];

        var wl = (cfg && cfg.whitelist) || [];
        if (wl.indexOf("facebook.com") !== -1) return;

        if (document.body) start();
        else document.addEventListener("DOMContentLoaded", start);
      });
    } catch (_) {
      if (document.body) start();
      else document.addEventListener("DOMContentLoaded", start);
    }
  }

  try {
    chrome.storage.onChanged.addListener(function (changes) {
      for (var k in changes) if (k in S) S[k] = changes[k].newValue;
      seen = new WeakSet();
      schedule(true);
    });
  } catch (_) {}

  boot();
})();

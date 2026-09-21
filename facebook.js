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

  function isWhitelisted(hostname, list) {
    if (!hostname || !Array.isArray(list)) return false;
    var parts = String(hostname).toLowerCase().split(".");
    for (var i = 0; i < parts.length; i++) {
      if (list.indexOf(parts.slice(i).join(".")) !== -1) return true;
    }
    return false;
  }

  var blocked = 0;
  var seen = new WeakSet();      // global fast-path cache; card-local scans bypass it
  var dirtyCards = [];
  var dirtyCardSet = new WeakSet();
  var labelCursor = 0;
  var ariaCursor = 0;
  var svgCursor = 0;
  var pending = false;
  var globalSweepPending = false;
  var sidebarDirty = false;
  var lastSweepTime = 0;
  var MIN_SWEEP_GAP = 80;        // ms throttle between sweeps
  var SPECIAL_BATCH = 64;        // bounded rotating work for global ARIA/SVG discovery
  var retryQueue = [];           // nodes whose card could not be resolved yet (mid mount/fade-in)
  var retryQueuedSet = new WeakSet();
  var RETRY_MAX_ATTEMPTS = 5;    // ~500ms of coverage at RETRY_DELAY below
  var RETRY_DELAY = 100;         // ms between insertion-retry passes
  var retryTimer = null;
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
  var DIRECT_CARD_SELECTOR = 'div[role="article"], div[data-pagelet*="FeedUnit"], div[aria-posinset]';

  function postContainerOf(el) {
    if (!el) return null;
    if (el.closest && (el.closest('[role="navigation"], nav, header') || el.closest('[style*="-10000"]'))) return null;

    function hiddenBox(node) {
      try {
        var cs = getComputedStyle(node);
        return cs && (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) === 0);
      } catch (_) {
        return false;
      }
    }

    // 1. Direct semantic container match if available
    var directCard = el.closest(DIRECT_CARD_SELECTOR);
    if (directCard && !hiddenBox(directCard)) {
      return directCard;
    }

    var n = el, best = null;
    var isReel = (window.location && window.location.pathname.indexOf("/reel") !== -1) ||
                 (el.closest && el.closest('[aria-label*="Reel" i], [aria-label*="ريلز" i], [data-pagelet*="Reel" i]'));

    var maxW = isReel ? 1800 : COLUMN_MAX;

    for (var i = 0; i < 15 && n && n.parentElement; i++) {
      n = n.parentElement;
      if (!n || n.tagName === "BODY" || n.tagName === "HTML") break;
      if (n.getAttribute && (n.getAttribute("role") === "navigation" || n.getAttribute("role") === "main" || n.getAttribute("role") === "feed" || n.tagName === "NAV" || n.tagName === "HEADER")) break;
      if (n.getAttribute && n.getAttribute("style") && n.getAttribute("style").indexOf("-10000") !== -1) break;
      if (hiddenBox(n)) continue; // Do not select Facebook's hidden accessibility/template pool
      var r = n.getBoundingClientRect();
      if (r.bottom < -500 || r.top < -5000) break; // Off-screen definitions pool (-10000px) is NEVER a post card
      if (r.width > maxW || r.height > 2600) break;
      if (r.width >= COLUMN_MIN && (r.height >= POST_MIN_H || (n.tagName === "DIV" && r.height === 0))) {
        best = n; // Outermost valid container bounded by hard ceilings
      }
    }
    return best;
  }

  function elementOf(node) {
    if (!node) return null;
    return node.nodeType === 1 ? node : node.parentElement || null;
  }

  /**
   * Native, zero-polling alternative to the rotating global sweep. Instead of
   * waiting for a bounded cursor to eventually reach a card's position in a
   * long feed (the old primary path — 2.5s interval, 64-item ARIA/SVG
   * batches, 1200-element label budget), ask the browser to tell us the
   * moment a card comes within reach of the viewport. The generous
   * rootMargin below fires well BEFORE the user actually scrolls to it, so
   * detection has a head start instead of racing the user's eyes.
   */
  var cardObserver = (typeof IntersectionObserver !== "undefined") ? new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].isIntersecting) scanCard(entries[i].target);
    }
  }, { rootMargin: "800px 0px 1600px 0px", threshold: 0 }) : null;

  function observeCard(card) {
    if (!cardObserver || !card) return;
    try { cardObserver.observe(card); } catch (_) {}
  }

  /** Queue the nearest feed card for a mutation-local re-evaluation. */
  function queueDirtyCard(node) {
    var el = elementOf(node);
    if (!el) return null;
    if (el.closest && el.closest('div[role="complementary"]')) return null;

    var card = postContainerOf(el);
    if (!card) return null;

    observeCard(card);

    if (!dirtyCardSet.has(card)) {
      dirtyCardSet.add(card);
      dirtyCards.push(card);
    }
    return card;
  }

  /**
   * postContainerOf() rejects any ancestor caught mid fade-in/mount
   * (display:none / visibility:hidden / opacity:0 — see hiddenBox() inside
   * postContainerOf). A freshly inserted ad card is routinely in exactly that
   * state at the instant its childList mutation fires, so queueDirtyCard()
   * returns null and the card would otherwise fall all the way through to the
   * slow rotating global sweep (multi-second delay) before anything looks at
   * it again.
   *
   * This retries resolution a few times, a beat apart, so the fast
   * budget-free dirty-card path (the same one a user click lands on) still
   * catches it once the transition settles — instead of waiting on the
   * rotating ARIA/SVG/label cursors.
   */
  function queueInsertionRetry(el) {
    if (!el || el.nodeType !== 1 || retryQueuedSet.has(el)) return;
    retryQueuedSet.add(el);
    retryQueue.push({ el: el, attempts: 0 });
    if (!retryTimer) retryTimer = setTimeout(processRetryQueue, RETRY_DELAY);
  }

  function processRetryQueue() {
    retryTimer = null;
    if (!retryQueue.length) return;

    var remaining = [];
    var resolvedAny = false;

    for (var i = 0; i < retryQueue.length; i++) {
      var item = retryQueue[i];
      retryQueuedSet.delete(item.el);

      var card = queueDirtyCard(item.el);
      if (card) {
        resolvedAny = true;
        continue;
      }

      item.attempts++;
      if (item.attempts < RETRY_MAX_ATTEMPTS) {
        retryQueuedSet.add(item.el);
        remaining.push(item);
      }
    }

    retryQueue = remaining;

    if (resolvedAny) schedule(true, false);
    if (retryQueue.length) retryTimer = setTimeout(processRetryQueue, RETRY_DELAY);
  }

  /**
   * A label can live outside its card and be referenced by aria-labelledby or
   * SVG <use>. Invalidate the cards that depend on the changed id as well as
   * the card containing the mutation itself.
   */
  function queueReferencedCards(node) {
    var el = elementOf(node);
    var id = "";

    for (var p = el; p && p !== document.documentElement; p = p.parentElement) {
      if (p.getAttribute) {
        id = p.getAttribute("id") || "";
        if (id) break;
      }
    }
    if (!id) return;

    var labelledEls = document.querySelectorAll("[aria-labelledby]");
    for (var i = 0; i < labelledEls.length; i++) {
      var labelledBy = labelledEls[i].getAttribute("aria-labelledby") || "";
      var ids = labelledBy.split(/\s+/);
      for (var a = 0; a < ids.length; a++) {
        if (ids[a] === id) {
          queueDirtyCard(labelledEls[i]);
          break;
        }
      }
    }

    var uses = document.querySelectorAll("use");
    for (var u = 0; u < uses.length; u++) {
      var href = uses[u].getAttribute("xlink:href") || uses[u].getAttribute("href") || "";
      if (href === "#" + id) queueDirtyCard(uses[u]);
    }
  }

  function sidebarOf(node) {
    var el = elementOf(node);
    return el && el.closest ? el.closest('div[role="complementary"]') : null;
  }

  function markSidebarDirty(node) {
    if (!sidebarOf(node)) return false;
    sidebarDirty = true;
    return true;
  }

  /** Resolve a sidebar signal to its item, without hiding the whole rail. */
  function sidebarContainerOf(node) {
    var el = elementOf(node);
    var sidebar = sidebarOf(el);
    if (!sidebar) return null;

    var item = el.closest('div[data-visualcompletion="ignore-dynamic"], [role="article"], [role="listitem"]');
    if (item && item !== sidebar) return item;

    var best = el;
    var cur = el.parentElement;
    for (var i = 0; i < 12 && cur && cur !== sidebar; i++, cur = cur.parentElement) {
      var r = cur.getBoundingClientRect ? cur.getBoundingClientRect() : null;
      if (!r) continue;
      if (r.width >= 160 && r.width <= 700 && r.height >= 40 && r.height <= 1000) best = cur;
    }
    return best === sidebar ? null : best;
  }

  function hideSidebarItem(signal, reason) {
    var item = sidebarContainerOf(signal);
    if (!item) return false;

    try {
      var r = item.getBoundingClientRect();
      if (r.width < 120 || r.height < 20 || r.width > 720 || r.height > 1100) return false;
    } catch (_) {
      return false;
    }

    item.setAttribute("data-abp-ad-marker", "true");
    return hide(item, reason);
  }

  /* ------------------------------------------------------------------ *
   * 4. HIDING WITH VIDEO SAFETY & REELS LIFECYCLE                       *
   * ------------------------------------------------------------------ */

  function getReelId(el) {
    if (!el) return "";
    try {
      var a = el.querySelector('a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch/"]');
      if (a) {
        var href = a.getAttribute("href") || "";
        if (href) return href;
      }
      // Fallback: fingerprint the media itself, so a recycled node whose
      // permalink anchor has not rendered yet is still detectable. Without
      // this, an id of "" leaves __abpReelId unset and disables re-validation
      // for that node permanently.
      var v = el.querySelector("video");
      if (v) {
        var fp = v.getAttribute("poster") || v.getAttribute("src") || v.currentSrc || "";
        if (fp) return fp;
      }
    } catch (_) {}
    return "";
  }

  /**
   * Facebook virtualizes the Reels carousel and RECYCLES slide nodes. A node we
   * hid as an ad can be handed back holding an ORGANIC reel — and since every
   * sweep skips nodes flagged __abpHidden, nothing would ever look at it again.
   * With scroll-snap-align:none applied such a node is not merely invisible but
   * also un-snappable, so the user silently never sees that reel.
   *
   * This MUST run before the __abpHidden guard in the sweep loop. Placing it
   * inside hide() makes it unreachable, because hide() is never called for a
   * node that is already hidden.
   */
  function revalidateReel(el) {
    if (!el || !el.__abpHidden || !el.__abpReelId) return;

    var id = getReelId(el);
    if (!id || id === el.__abpReelId) return;   // same creative — still an ad

    el.__abpHidden = false;
    el.__abpReelId = id;
    el.removeAttribute("data-abp-blocked");
    el.removeAttribute("data-abp-size");
    el.style.removeProperty("display");
    el.style.removeProperty("height");
    el.style.removeProperty("min-height");
    el.style.removeProperty("max-height");
    el.style.removeProperty("margin");
    el.style.removeProperty("padding");
    el.style.removeProperty("border");
    el.style.removeProperty("overflow");
    el.style.removeProperty("visibility");
    el.style.removeProperty("pointer-events");
    el.style.removeProperty("scroll-snap-align");
    el.style.removeProperty("scroll-snap-stop");

    // Restore the audio state we captured when this node was hidden.
    try {
      var vids = el.querySelectorAll("video");
      for (var v = 0; v < vids.length; v++) {
        if (vids[v].__abpPrevMuted !== undefined) {
          vids[v].muted = vids[v].__abpPrevMuted;
          delete vids[v].__abpPrevMuted;
        }
      }
    } catch (_) {}

    if (blocked > 0) {
      blocked--;
      mark("ready", { "fb-blocked": blocked });
      report();
    }
  }

  function findReelScroller(el) {
    var p = el;
    while (p && p !== document.body) {
      if (p.scrollHeight > p.clientHeight && (window.getComputedStyle(p).overflowY === "auto" || window.getComputedStyle(p).overflowY === "scroll")) {
        return p;
      }
      p = p.parentElement;
    }
    return document.querySelector('div[role="main"] [scrollable="true"]') || null;
  }

  function advanceReelIfActive(el) {
    try {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight || 900;
      if (r.top < vh * 0.6 && r.bottom > vh * 0.4) {
        // 1. Try native Next button if present in Facebook Reels viewer
        var nextBtn = document.querySelector(
          '[aria-label*="Next video" i], [aria-label*="Next card" i], [aria-label*="Next" i], [aria-label*="الفيديو التالي" i], [aria-label*="التالي" i]'
        );
        if (nextBtn && nextBtn.click) {
          nextBtn.click();
          return;
        }

        // 2. Synthetic keyboard event
        var evt = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          keyCode: 40,
          which: 40,
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(evt);
        window.dispatchEvent(evt);

        // 3. Container / window scroll fallback
        setTimeout(function () {
          try {
            var cur = el.getBoundingClientRect();
            if (cur.top < vh * 0.6 && cur.bottom > vh * 0.4) {
              var scroller = findReelScroller(el);
              if (scroller && scroller.scrollBy) {
                scroller.scrollBy({ top: scroller.clientHeight || vh, behavior: "instant" });
              } else {
                window.scrollBy({ top: vh, behavior: "instant" });
              }
            }
          } catch (_) {}
        }, 60);
      }
    } catch (_) {}
  }

  // Failsafe for every hide path: an ad card never legitimately contains the
  // page's main landmark or feed. If a container climb ever resolves to a
  // layout wrapper, hiding it would blank the whole page, so refuse instead.
  var structureRefused = new WeakSet();
  function isPageStructure(el) {
    if (structureRefused.has(el)) return true;
    var bad = false;
    try {
      bad = !!(el.matches('[role="main"], [role="feed"], main') ||
               el.querySelector('[role="main"], [role="feed"], main'));
    } catch (_) {}
    if (bad) structureRefused.add(el);
    return bad;
  }

  function hide(el, reason) {
    if (!el) return false;
    if (isPageStructure(el)) return false;

    var alreadyHidden = el.hasAttribute("data-abp-blocked");

    if (!el.__abpHidden) {
      el.__abpHidden = true;
      blocked++;
      mark("ready", { "fb-blocked": blocked });
      report();
    }

    if (alreadyHidden) return false;

    var isReel = (reason === "sponsored-reel") ||
                 (window.location && window.location.pathname.indexOf("/reel") !== -1) ||
                 (el.closest && el.closest('[aria-label*="Reel" i], [aria-label*="ريلز" i], [data-pagelet*="Reel" i]'));

    el.setAttribute("data-abp-blocked", reason);

    // Once hidden there is nothing left for the intersection observer to
    // react to; stop tracking it to keep the observed set bounded over a
    // long scrolling session. Reels are re-validated separately by
    // sweepReelAds()/revalidateReel(), not by this observer, so this is safe
    // for them too.
    if (cardObserver) { try { cardObserver.unobserve(el); } catch (_) {} }

    // Record which creative this node was hidden for, so revalidateReel() can
    // tell a recycled node apart from one still showing the same ad.
    if (isReel) {
      var rid = getReelId(el);
      if (rid) el.__abpReelId = rid;
    }

    // Stop and silence video safely without wiping .src (preserves MSE decode state and carousel listeners)
    try {
      var vids = el.querySelectorAll("video");
      for (var v = 0; v < vids.length; v++) {
        // Remember the user's audio state first: a recycled node must not hand
        // an organic reel back permanently muted.
        if (vids[v].__abpPrevMuted === undefined) vids[v].__abpPrevMuted = vids[v].muted;
        vids[v].pause();
        vids[v].muted = true;
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

    if (isReel) {
      // For Reels: collapse slide dimensions completely and remove scroll-snap
      // Eliminates the 100vh black void caused by bare visibility:hidden on dark backgrounds
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("height", "0px", "important");
      el.style.setProperty("min-height", "0px", "important");
      el.style.setProperty("max-height", "0px", "important");
      el.style.setProperty("margin", "0px", "important");
      el.style.setProperty("padding", "0px", "important");
      el.style.setProperty("border", "0px", "important");
      el.style.setProperty("overflow", "hidden", "important");
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("pointer-events", "none", "important");
      el.style.setProperty("scroll-snap-align", "none", "important");
      el.style.setProperty("scroll-snap-stop", "normal", "important");
      advanceReelIfActive(el);
    } else {
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("height", "0", "important");
      el.style.setProperty("min-height", "0", "important");
      el.style.setProperty("margin", "0", "important");
      el.style.setProperty("padding", "0", "important");
    }

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

  function elementsWithin(root, selector) {
    var out = [];
    var scope = root || document;

    try {
      if (scope.nodeType === 1 && scope.matches && scope.matches(selector)) out.push(scope);
    } catch (_) {}

    var descendants = scope.querySelectorAll ? scope.querySelectorAll(selector) : [];
    for (var i = 0; i < descendants.length; i++) out.push(descendants[i]);
    return out;
  }

  function findLabels(root) {
    var results = [];
    var local = !!root;
    var els = elementsWithin(root, "span, a, div[aria-label], div[aria-labelledby]");
    var vh = window.innerHeight || 900;
    var work = 0;
    var start = local ? 0 : Math.min(labelCursor, els.length);
    var i = start;

    diag.candidates = 0;
    diag.measured = 0;

    for (; i < els.length && work < BUDGET; i++) {
      var e = els[i];
      if ((!local && seen.has(e)) || e.__abpHidden) continue;

      // FAST PATH 1: Skip large structural elements immediately without layout reflow
      if (e.childElementCount > 35) continue;

      var raw = e.textContent || "";
      var aria = e.getAttribute ? e.getAttribute("aria-label") : null;
      var hasUse = false;
      if (e.querySelector && e.querySelector("use")) hasUse = true;
      var hasLabelledBy = false;
      if ((e.getAttribute && e.getAttribute("aria-labelledby")) || (e.querySelector && e.querySelector("[aria-labelledby]"))) {
        hasLabelledBy = true;
      }

      // FAST PATH 2: String length check
      if (!hasUse && !aria && !hasLabelledBy) {
        var rawLen = raw.length;
        if (rawLen === 0 || rawLen > 65) {
          if (!local) seen.add(e);
          continue;
        }

        // FAST PATH 3: Text heuristic check (Skip non-matching text without getBoundingClientRect)
        if (rawLen > 32 && !HINT.test(raw)) {
          if (!local) seen.add(e);
          continue;
        }
      }

      // FAST PATH 4: Skip elements inside comment panels, dialogs, form elements, textboxes, or post message bodies
      if (e.closest && e.closest('[role="dialog"], [role="textbox"], [contenteditable="true"], form, [data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"], [aria-label*="Comment" i], [aria-label*="تعليق" i]')) {
        if (!local) seen.add(e);
        continue;
      }

      // MEASUREMENT GATE (Only reached by candidate elements)
      var r = e.getBoundingClientRect();

      // Only measure what is on screen or nearby
      if (r.bottom < -400 || r.top > vh + 800) continue;
      if (r.height < LABEL_MIN_H || r.height > LABEL_MAX_H) continue;
      if (r.width  < LABEL_MIN_W || r.width  > LABEL_MAX_W) continue;
      if (r.right < 0 || r.left < -1000) continue;

      diag.candidates++;
      if (!local) seen.add(e);
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

    if (!local) labelCursor = i >= els.length ? 0 : i;

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
  function sweepDirectAdLinks(root) {
    if (!S.adBlock || !S.fbSponsored) return;
    var local = !!root;
    var adLinks = elementsWithin(root, 'a[href*="/ads/about"], a[href*="facebook.com/ads/about"], a[href*="/about/ads"], a[href*="facebook.com/about/ads"], a[href*="/about_this_ad"], a[href*="/ad_preferences/"], a[href*="facebook.com/ad_preferences"]');
    for (var i = 0; i < adLinks.length && (local || i < 30); i++) {
      var card = postContainerOf(adLinks[i]);
      if (card) {
        var cr = card.getBoundingClientRect();
        if (cr.height > 2600) continue;
        hide(card, "direct-ad-link");
      }
    }
  }

  /**
   * Reviewed adaptation of the current uBlock Origin Facebook quick fixes.
   * uBO's raw rules use procedural selectors and response scriptlets; this
   * module keeps only high-confidence DOM signals that can be expressed safely
   * in the existing card-hiding pipeline.
   */
  function sweepSidebarAds() {
    if (!S.adBlock || !S.fbSponsored || !S.fbSidebar) return;

    var sidebar = document.querySelector('div[role="complementary"]');
    if (!sidebar) return;

    function hasAll(value, parts) {
      var text = String(value || "").toLowerCase();
      for (var i = 0; i < parts.length; i++) {
        if (text.indexOf(parts[i]) === -1) return false;
      }
      return true;
    }

    // Quick Fixes: attribution/campaign links and the right-rail ad target.
    var links = sidebar.querySelectorAll('a[attributionsrc], a[target="_blank"][role="link"]');
    for (var i = 0; i < links.length; i++) {
      var link = links[i];
      var attribution = link.getAttribute("attributionsrc") || "";
      var href = link.getAttribute("href") || "";
      var rel = link.getAttribute("rel") || "";
      var target = link.getAttribute("target") || "";
      var role = link.getAttribute("role") || "";
      var isAttributionAd = attribution.indexOf("/privacy_sandbox/comet/register/") === 0 &&
                            attribution.indexOf("?eid=") !== -1;
      var isCampaignAd = href.indexOf("fbclid") !== -1 && hasAll(href, [
        "utm_medium", "utm_source", "utm_id", "utm_content", "utm_term", "utm_campaign"
      ]);
      var isRightRailTarget = target === "rhcad2" && hasAll(rel, ["nofollow", "noreferrer", "noopener"]);
      var isImageAttribution = !!(attribution && href.indexOf("http") === 0 &&
        target === "_blank" && role === "link" &&
        rel.toLowerCase().indexOf("noreferrer") !== -1 &&
        link.querySelector && link.querySelector("img[src]"));

      if (isAttributionAd || isCampaignAd || isRightRailTarget || isImageAttribution) {
        hideSidebarItem(link, "sidebar-ad-link");
      }
    }

    // Quick Fixes: the current Comet right-rail ARIA label shape. Resolve the
    // label text as well, so an organic link with a similar attribute is safe.
    var labelled = sidebar.querySelectorAll("[aria-labelledby]");
    for (var a = 0; a < labelled.length; a++) {
      var labelledEl = labelled[a];
      var labelledBy = labelledEl.getAttribute("aria-labelledby") || "";
      var ariaRel = labelledEl.getAttribute("rel") || "";
      var isCometAdLink = /^_r_/i.test(labelledBy.trim()) && hasAll(ariaRel, ["nofollow", "noreferrer", "tag"]);
      var labelledText = readLabel(labelledEl);
      if (isCometAdLink || (labelledText && matchesAny(labelledText, SPONSORED))) {
        hideSidebarItem(labelledEl, "sidebar-aria-ad");
      }
    }

    // Quick Fixes: a compact Sponsored heading in the right rail.
    var sponsoredHeadings = sidebar.querySelectorAll("h3 span");
    for (var h = 0; h < sponsoredHeadings.length; h++) {
      var headingText = readLabel(sponsoredHeadings[h]);
      if (headingText && matchesAny(headingText, SPONSORED)) {
        hideSidebarItem(sponsoredHeadings[h], "sidebar-sponsored-heading");
      }
    }
  }

  /** Dedicated fast sweeper for aria-labelledby remote ad disclosure chips (Live FB Comet 2026) */
  function sweepAriaLabelledAds(root) {
    if (!S.adBlock || !S.fbSponsored) return;
    var local = !!root;
    var main = root || document.querySelector('div[role="main"]') || document.body;
    var labelledEls = elementsWithin(main, '[aria-labelledby]');
    var start = local ? 0 : Math.min(ariaCursor, labelledEls.length);
    var i = start;
    var end = local ? labelledEls.length : Math.min(labelledEls.length, start + SPECIAL_BATCH);

    for (; i < end; i++) {
      var el = labelledEls[i];
      if (el.__abpHidden) continue;
      if (el.closest && (el.closest('[role="navigation"], nav, header') || el.closest('[style*="-10000"]'))) continue;

      var refId = el.getAttribute("aria-labelledby");
      if (!refId) continue;

      var refTxt = "";
      var ids = refId.split(/\s+/);
      for (var a = 0; a < ids.length; a++) {
        if (!ids[a]) continue;
        var refEl = document.getElementById(ids[a]);
        if (refEl) refTxt += " " + (refEl.textContent || refEl.innerText || "");
      }
      refTxt = norm(refTxt);
      if (!refTxt) continue;

      if (matchesAny(refTxt, SPONSORED)) {
        el.setAttribute("data-abp-ad-marker", "true");
        var card = postContainerOf(el);
        if (card) {
          var cr = card.getBoundingClientRect();
          if (cr.height > 2600) continue;
          hide(card, "aria-labelled-ad");
        }
      }
    }

    if (!local) ariaCursor = i >= labelledEls.length ? 0 : i;
  }

  /** Dedicated sweeper for SVG <use> based ad disclosure chips */
  function sweepSvgAds(root) {
    if (!S.adBlock || !S.fbSponsored) return;
    var local = !!root;
    var main = root || document.querySelector('div[role="main"]') || document.body;
    var uses = elementsWithin(main, "use");
    var start = local ? 0 : Math.min(svgCursor, uses.length);
    var i = start;
    var end = local ? uses.length : Math.min(uses.length, start + SPECIAL_BATCH);

    for (; i < end; i++) {
      var u = uses[i];
      var href = u.getAttribute("xlink:href") || u.getAttribute("href") || "";
      if (href.charAt(0) !== "#") continue;
      if (u.closest && u.closest('[style*="-10000"]')) continue;
      var card = postContainerOf(u);
      if (!card) continue;
      var cr = card.getBoundingClientRect();
      if (cr.bottom < -500 || cr.top < -5000) continue;

      var label = D.readLabel(u.parentElement || u, ENV);
      if (label && matchesAny(label, SPONSORED)) {
        var markerEl = u.parentElement || u;
        if (markerEl.setAttribute) markerEl.setAttribute("data-abp-ad-marker", "true");
        hide(card, "sponsored-svg");
      }
    }

    if (!local) svgCursor = i >= uses.length ? 0 : i;
  }

  /**
   * Facebook Comet 2026 Obfuscation Guard:
   * Facebook often renders post timestamps into root SVG <text> elements with textLength="0" and y="-3",
   * and referencing <svg> with height: 1px, causing timestamps to shrink into invisible 0-width dots.
   * This restores normal visual dimensions for all organic timestamps (Arabic & English).
   */
  function restoreSvgTimestamps(root) {
    var texts = elementsWithin(root, 'text[textLength="0"], text[y="-3"]');
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      var raw = (t.textContent || "").trim();
      if (!raw) continue;
      var normTxt = D.norm(raw);
      if (matchesAny(normTxt, SPONSORED)) continue;

      t.removeAttribute("textLength");
      t.setAttribute("y", "12");
    }

    var svgs = elementsWithin(root, 'a svg[style*="height: 1px"]');
    for (var s = 0; s < svgs.length; s++) {
      svgs[s].style.setProperty("height", "14px", "important");
    }
  }

  function sweepLabels(root) {
    if (!S.adBlock) return;
    if (!S.fbSponsored && !S.fbSuggested) return;

    var found = findLabels(root);

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

      // Header Band Constraint for Feed Cards:
      // On Facebook Feed, the genuine disclosure chip ("مُموَّل" / "Sponsored") sits within the author/metadata header band.
      // 240px allows full coverage for 2-line Arabic titles, badges, and margins without hitting the post body.
      var isReel = (window.location && window.location.pathname.indexOf("/reel") !== -1) ||
                   (container.closest && container.closest('[aria-label*="Reel" i], [aria-label*="ريلز" i], [data-pagelet*="Reel" i]'));

      if (!isReel) {
        var offsetFromCardTop = lr.top - cr.top;
        if (offsetFromCardTop > 240) continue;
      }

      hit.el.setAttribute("data-abp-ad-marker", "true");
      hide(container, hit.kind);
    }
  }

  /** Re-evaluate every detector against one card without consulting `seen`. */
  function scanCard(card) {
    if (!card) return;

    try {
      var marker = card.getAttribute && card.getAttribute("data-abp-ad-marker") === "true" ? card :
                   (card.querySelector && card.querySelector('[data-abp-ad-marker="true"]'));
      if (marker && !card.hasAttribute("data-abp-blocked")) hide(card, "known-marker");
    } catch (_) {}

    try { sweepDirectAdLinks(card); } catch (_) {}
    try { sweepAriaLabelledAds(card); } catch (_) {}
    try { sweepSvgAds(card); } catch (_) {}
    try { restoreSvgTimestamps(card); } catch (_) {}
    try { sweepLabels(card); } catch (_) {}
    try { sweepReels(card); } catch (_) {}
    try { sweepReelAds(card); } catch (_) {}
  }

  function scanDirtyCards() {
    if (!dirtyCards.length) return;

    var cards = dirtyCards;
    dirtyCards = [];
    for (var i = 0; i < cards.length; i++) {
      dirtyCardSet.delete(cards[i]);
      scanCard(cards[i]);
    }
  }

  /** Remove the Reels shelf from the feed if requested */
  function sweepReels(root) {
    if (!S.adBlock || !S.fbReels) return;

    var local = !!root;
    var links = elementsWithin(root, 'a[href*="/reel/"]');
    for (var i = 0; i < links.length && (local || i < 20); i++) {
      var shelf = postContainerOf(links[i]);
      if (shelf) hide(shelf, "reels");
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

  function reelCardOf(video) {
    if (!video) return null;
    var cur = video;
    var best = null;
    for (var i = 0; i < 12 && cur && cur.parentElement && cur.parentElement !== document.body; i++) {
      cur = cur.parentElement;
      if (cur.getAttribute && cur.getAttribute("role") === "main") break;
      var r = cur.getBoundingClientRect();
      if (r.height >= 400 && r.width >= 240 && r.height <= 2600) {
        best = cur;
        if (cur.querySelector('a[href*="l.facebook.com"], a[href*="/reel/"], [aria-label*="Like" i], [aria-label*="إعجاب" i]')) {
          break;
        }
      }
    }
    return best;
  }

  /** Dedicated Scoped Sweeper for Facebook Reels ads (Zero global reflow) */
  function sweepReelAds(root) {
    if (!S.adBlock || (!S.fbSponsored && !S.fbSuggested)) return;
    var local = !!root;
    var scope = root || document;
    var reelHints = 'div[aria-label*="Reel" i], div[aria-label*="ريلز" i], div[data-pagelet*="Reel" i], a[href*="/reel/"]';
    var isReelsPage = (window.location && window.location.pathname.indexOf("/reel") !== -1) ||
                      Boolean(elementsWithin(scope, reelHints).length);
    if (!isReelsPage) return;

    var candidates = [];
    var videos = elementsWithin(scope, 'div[role="main"] video, video');
    for (var v = 0; v < videos.length && (local || v < 15); v++) {
      var rc = reelCardOf(videos[v]);
      if (rc && candidates.indexOf(rc) === -1) candidates.push(rc);
    }

    var legacyCards = elementsWithin(scope, 'div[aria-label*="Reel" i], div[aria-label*="ريلز" i], div[data-pagelet*="Reel" i]');
    for (var lc = 0; lc < legacyCards.length && (local || lc < 10); lc++) {
      if (candidates.indexOf(legacyCards[lc]) === -1) candidates.push(legacyCards[lc]);
    }

    for (var i = 0; i < candidates.length; i++) {
      var card = candidates[i];
      if (!card) continue;

      // Facebook recycles virtualized slide nodes. Restore any node we hid
      // whose creative has since changed, BEFORE the __abpHidden guard skips it.
      revalidateReel(card);

      if (card.__abpHidden) continue;

      // POSITIVE TEST: A real Reels slide ALWAYS contains a <video>. Comment drawers, forms, and dialogs do NOT.
      if (!card.querySelector("video")) continue;

      // Skip comment drawers or input textboxes
      if (card.matches && card.matches('[aria-label*="Comment" i], [aria-label*="تعليق" i]')) continue;

      var cr = card.getBoundingClientRect();
      if (cr.width < 100 || cr.height < 100) continue;

      var isAd = false;

      // 1. Check for specific ad preferences / about links or paid outbound links
      if (card.querySelector('a[href*="l.facebook.com/l.php?u="][href*="utm_medium="], a[href*="l.facebook.com/l.php?u="][href*="fbclid"], a[href*="l.facebook.com/l.php?u="][href*="ad_id"], a[href*="/ads/about"], a[href*="facebook.com/ads/about"], a[href*="/ad_preferences/"]')) {
        isAd = true;
      }

      // 2. Check for explicit text badges ("Ad", "Sponsored", "مُموَّل", "ممول", "إعلان")
      if (!isAd) {
        var badgeEls = card.querySelectorAll('span, div, a');
        for (var bi = 0; bi < badgeEls.length && bi < 25; bi++) {
          var bEl = badgeEls[bi];
          if (bEl.childElementCount > 3) continue;
          var bText = (bEl.innerText || bEl.textContent || "").trim();
          if (bText === "Ad" || bText === "Sponsored" || bText === "مُموَّل" || bText === "ممول" || bText === "إعلان") {
            isAd = true;
            break;
          }
        }
      }

      // 3. Check for explicit ARIA labels on child elements
      if (!isAd) {
        var ariaEls = card.querySelectorAll('[aria-label]');
        for (var a = 0; a < ariaEls.length && a < 15; a++) {
          var elAria = ariaEls[a];
          if (elAria.closest('[aria-label*="Comment" i], [aria-label*="تعليق" i]')) continue;
          var labelText = norm(elAria.getAttribute("aria-label"));
          if (labelText && matchesAny(labelText, SPONSORED)) {
            isAd = true;
            break;
          }
        }
      }

      // 4. Check for exact CTA terms on interactive button controls
      if (!isAd) {
        var ctaButtons = card.querySelectorAll('div[role="button"], a[role="link"], a, [data-testid="reel_cta_button"]');
        for (var b = 0; b < ctaButtons.length && b < 10; b++) {
          var btn = ctaButtons[b];
          if (btn.closest('[aria-label*="Comment" i], [aria-label*="تعليق" i]')) continue;
          var btnText = norm(btn.innerText || btn.textContent || "");
          if (btnText) {
            for (var c = 0; c < REEL_CTA_TERMS.length; c++) {
              if (btnText === REEL_CTA_TERMS[c]) {
                isAd = true;
                break;
              }
            }
          }
          if (isAd) break;
        }
      }

      // 5. Scoped header label check inside this specific card
      if (!isAd) {
        var spans = card.querySelectorAll('span, a');
        for (var s = 0; s < spans.length && s < 25; s++) {
          var sp = spans[s];
          if (sp.closest('[aria-label*="Comment" i], [aria-label*="تعليق" i]')) continue;
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

  function sweep(runGlobal) {
    pending = false;

    scanDirtyCards();

    if (sidebarDirty || runGlobal) {
      sidebarDirty = false;
      try { sweepSidebarAds(); } catch (_) {}
    }

    if (runGlobal) {
      // Fast-path: Re-hide any known ad markers instantly (bypasses 'seen' cache)
      try {
        var markers = document.querySelectorAll('[data-abp-ad-marker="true"]');
        for (var i = 0; i < markers.length; i++) {
          var card = postContainerOf(markers[i]);
          if (card && !card.hasAttribute("data-abp-blocked")) {
            hide(card, "known-marker");
          }
        }
      } catch (_) {}

      try { sweepDirectAdLinks(); } catch (_) {}
      try { sweepAriaLabelledAds(); } catch (_) {}
      try { sweepSvgAds(); } catch (_) {}
      try { restoreSvgTimestamps(); } catch (_) {}
      try { sweepLabels(); } catch (_) {}
      try { sweepReels(); } catch (_) {}
      try { sweepReelAds(); } catch (_) {}
    }
  }

  function schedule(force, includeGlobal) {
    if (includeGlobal) globalSweepPending = true;
    if (pending) return;
    pending = true;

    var now = Date.now();
    var elapsed = now - lastSweepTime;
    var delay = force ? 0 : Math.max(0, MIN_SWEEP_GAP - elapsed);

    setTimeout(function () {
      var runGlobal = globalSweepPending;
      globalSweepPending = false;

      function run() {
        lastSweepTime = Date.now();
        sweep(runGlobal);
      }

      // requestAnimationFrame is fully SUSPENDED (not just throttled) while the
      // tab is not the visible one — Chrome never fires it for a backgrounded
      // page. Wrapping every sweep in rAF unconditionally means `pending`
      // (set above) never gets cleared until the tab regains focus, silently
      // freezing the ENTIRE detection pipeline (dirty cards, retries, the
      // periodic global sweep) for as long as the user is looking at another
      // tab/window — confirmed live: an ad stayed unhidden for as long as the
      // Facebook tab stayed backgrounded, then vanished the instant it
      // regained focus.
      //
      // document.hidden alone is NOT enough: it only flips when the TAB is
      // inactive or the WINDOW is minimized. Alt-Tabbing to a different
      // top-level application (Chrome's window stays open, unminimized, and
      // still the active tab within it) leaves document.hidden === false,
      // yet Chrome still suspends rAF for the occluded/unfocused window on
      // Windows — confirmed live: an ad stayed queued the entire time another
      // app had focus, and only vanished the instant a real click landed
      // inside the Facebook page (which forces a direct, non-rAF run via the
      // mutation it causes). document.hasFocus() catches this case: it goes
      // false the moment OS focus leaves the window, independent of hidden.
      if (document.hidden || !document.hasFocus() || !window.requestAnimationFrame) {
        run();
      } else {
        requestAnimationFrame(run);
      }
    }, delay);
  }

  /* ------------------------------------------------------------------ *
   * 7. LIFECYCLE & MUTATION SHIELD                                      *
   * ------------------------------------------------------------------ */

  function isVideoMutation(mutation) {
    var t = elementOf(mutation.target);
    if (!t) return false;
    var tag = t.tagName;
    if (tag === "VIDEO" || tag === "CANVAS") return true;
    if (t.closest && t.closest('video, [role="progressbar"], [aria-label*="Play" i], [aria-label*="Pause" i], [aria-label*="Mute" i]')) {
      return true;
    }
    return false;
  }

  function start() {
    mark("ready", { "fb-labels": SPONSORED.length });
    
    // Inject global stylesheet as a safety net against React stripping inline styles
    var style = document.createElement("style");
    style.textContent = '[data-abp-blocked] { display: none !important; height: 0 !important; min-height: 0 !important; max-height: 0 !important; margin: 0 !important; padding: 0 !important; visibility: hidden !important; border: 0 !important; pointer-events: none !important; overflow: hidden !important; }';
    if (document.head) document.head.appendChild(style);

    // Register every card already in the DOM at boot for intersection-driven
    // re-checking. Cards added later are picked up by the MutationObserver
    // below; these predate it, so they need a one-time initial registration.
    try {
      var bootCards = document.querySelectorAll(DIRECT_CARD_SELECTOR);
      for (var bc = 0; bc < bootCards.length; bc++) observeCard(bootCards[bc]);
    } catch (_) {}

    sweep(true);

    var observer = new MutationObserver(function (mutations) {
      var structuralChange = false;
      for (var m = 0; m < mutations.length; m++) {
        var mut = mutations[m];

        markSidebarDirty(mut.target);

        // Fast ignore for video/audio playback progress to prevent 60fps layout thrashing
        if (isVideoMutation(mut)) continue;

        structuralChange = true;

        var t = mut.target;
        var targetCard = queueDirtyCard(t);
        if (!targetCard) queueReferencedCards(t);

        // Added/removed nodes can be the card itself, a hydrated header, or a
        // referenced ARIA/SVG label that lives outside the card.
        var added = mut.addedNodes || [];
        for (var a = 0; a < added.length; a++) {
          markSidebarDirty(added[a]);
          var addedCard = queueDirtyCard(added[a]);
          if (!addedCard) {
            queueReferencedCards(added[a]);
            queueInsertionRetry(elementOf(added[a]));
          }

          // A single mutation can bulk-insert a wrapper containing several
          // feed cards at once (e.g. a page of virtualized content mounting
          // together). queueDirtyCard above only resolves ONE card from the
          // mutation target; register every card-shaped descendant too so
          // none of them wait on the rotating global sweep to be discovered.
          var addedEl = elementOf(added[a]);
          if (addedEl && addedEl.querySelectorAll) {
            var innerCards = addedEl.querySelectorAll(DIRECT_CARD_SELECTOR);
            for (var ic = 0; ic < innerCards.length; ic++) observeCard(innerCards[ic]);
          }
        }
        var removed = mut.removedNodes || [];
        for (var r = 0; r < removed.length; r++) {
          // Removed nodes no longer have a card ancestor; their id may still
          // be referenced by a live card, so retain the dependency lookup.
          queueReferencedCards(removed[r]);
        }

        // Keep the existing cheap invalidation for the global fast path. The
        // card queue above is what makes externally referenced labels correct.
        var targetEl = elementOf(t);
        if (targetEl) {
          seen.delete(targetEl);
          if (targetEl.parentElement) seen.delete(targetEl.parentElement);
        }
      }

      if (structuralChange) {
        schedule(false, false);
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label', 'aria-labelledby', 'href', 'xlink:href', 'id', 'title', 'style', 'class', 'role', 'data-pagelet', 'data-testid', 'textLength', 'y'],
      characterData: true
    });

    // Throttled passive scroll/gesture listeners
    var scrollScheduled = false;
    function onScrollPassive() {
      if (scrollScheduled) return;
      scrollScheduled = true;
      setTimeout(function () {
        scrollScheduled = false;
        schedule(false, true);
      }, 80);
    }

    window.addEventListener("scroll", onScrollPassive, { passive: true, capture: true });
    window.addEventListener("wheel", onScrollPassive, { passive: true, capture: true });

    // Periodic bounded refresh for lazy content. The rotating cursors advance
    // through the document; this does not reset `seen` or restart at item 0.
    setInterval(function () {
      schedule(false, true);
    }, 2500);

    // Force an immediate, full sweep the instant the tab regains focus. While
    // it was backgrounded, timers ran throttled (or, previously, rAF did not
    // run at all — see schedule()) so anything that mutated off-screen may
    // not have been evaluated yet. Without this the user can catch a brief
    // flash of an ad that was already queued but never got to run.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) schedule(true, true);
    });

    // Covers the Alt-Tab case above: OS focus can return without document.hidden
    // ever having changed (the tab stayed "active" in its own window the whole
    // time), so visibilitychange never fires. window focus is the correct,
    // independent signal for that transition.
    window.addEventListener("focus", function () {
      schedule(true, true);
    });

    // Network-layer early warning from fb-net-probe.js (MAIN world): fires the
    // instant a SponsoredData story is observed in a GraphQL response (fetch
    // or XHR), often before Facebook has finished rendering it. Forces an
    // immediate sweep instead of waiting for the MutationObserver/rotating
    // cycle to notice the card after it appears. Read-only signal — no
    // response data is ever modified for this transport.
    document.addEventListener("__abpSponsoredDetected", function () {
      schedule(true, true);
    });

    // Confirmed-certain signal from fb-net-probe.js (MAIN world): a closed
    // shadow root's real, isolated text is an EXACT match for a known
    // sponsorship-disclosure label ("Ad", "Sponsored", "إعلان", ...) — read
    // directly through an attachShadow side-channel, bypassing every visual
    // obfuscation layer entirely. This is what finally makes the ad type
    // with no readable text and no DOM/network correlation detectable at
    // all. Hide the enclosing card immediately; no heuristic guessing.
    document.addEventListener("__abpShadowSponsoredDetected", function (e) {
      try {
        var prev = parseInt(document.documentElement.getAttribute("data-abp-shadow-signal-received") || "0", 10);
        document.documentElement.setAttribute("data-abp-shadow-signal-received", String(prev + 1));
      } catch (_) {}
      try {
        var card = e.target && e.target.closest ? e.target.closest(DIRECT_CARD_SELECTOR) : null;
        if (card) hide(card, "shadow-dom-ad");
      } catch (_) {}
    });
  }

  function boot() {
    try {
      chrome.storage.local.get(null, function (cfg) {
        if (cfg) for (var k in S) if (cfg[k] !== undefined) S[k] = cfg[k];

        var wl = (cfg && cfg.whitelist) || [];
        if (isWhitelisted(window.location.hostname, wl)) return;

        if (document.body) start();
        else document.addEventListener("DOMContentLoaded", start);
      });
    } catch (_) {
      if (document.body) start();
      else document.addEventListener("DOMContentLoaded", start);
    }
  }

  try {
    // Only settings that affect detection matter here. background.js also
    // writes the blocked-count stats (totalBlocked/todayBlocked/...) on every
    // hide from ANY site, and reacting to those would wipe the memo cache and
    // force a full re-sweep of every Facebook tab each time an ad is hidden
    // anywhere — a self-feeding loop, since our own hides write those keys.
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area && area !== "local") return;
      var relevant = false;
      for (var k in changes) {
        if (k in S) { S[k] = changes[k].newValue; relevant = true; }
        else if (k === "whitelist") relevant = true;
      }
      if (!relevant) return;
      seen = new WeakSet();
      schedule(true, true);
    });
  } catch (_) {}

  boot();
})();

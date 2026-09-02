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
    if (el.closest && (el.closest('[role="navigation"], nav, header') || el.closest('[style*="-10000"]'))) return null;

    // 1. Direct semantic container match if available
    var directCard = el.closest('div[role="article"], div[data-pagelet*="FeedUnit"], div[role="feed"] > div');
    if (directCard && directCard.clientHeight >= POST_MIN_H && directCard.clientHeight <= 2600) {
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
      var r = n.getBoundingClientRect();
      if (r.bottom < -500 || r.top < -5000) break; // Off-screen definitions pool (-10000px) is NEVER a post card
      if (r.width > maxW || r.height > 2600) break;
      if (r.width >= COLUMN_MIN && r.height >= POST_MIN_H) {
        best = n; // Outermost valid container bounded by hard ceilings
      }
    }
    return best;
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
    el.style.removeProperty("visibility");
    el.style.removeProperty("pointer-events");
    el.style.removeProperty("scroll-snap-align");

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

  function advanceReelIfActive(el) {
    try {
      var r = el.getBoundingClientRect();
      var vh = window.innerHeight || 900;
      if (r.top < vh * 0.5 && r.bottom > vh * 0.5) {
        // Dispatch to document only (avoids double-firing on window)
        var evt = new KeyboardEvent("keydown", {
          key: "ArrowDown",
          code: "ArrowDown",
          keyCode: 40,
          which: 40,
          bubbles: true,
          cancelable: true
        });
        document.dispatchEvent(evt);

        // Fallback: if scroll position did not advance, scroll scroller by one viewport
        setTimeout(function () {
          try {
            var cur = el.getBoundingClientRect();
            if (cur.top < vh * 0.5 && cur.bottom > vh * 0.5) {
              var scroller = el.closest('[scrollable="true"]') || document.querySelector('div[role="main"] [scrollable="true"]');
              if (scroller) {
                scroller.scrollBy({ top: scroller.clientHeight || vh, behavior: "smooth" });
              }
            }
          } catch (_) {}
        }, 80);
      }
    } catch (_) {}
  }

  function hide(el, reason) {
    if (!el || el.__abpHidden) return false;

    var isReel = (window.location && window.location.pathname.indexOf("/reel") !== -1) ||
                 (el.closest && el.closest('[aria-label*="Reel" i], [aria-label*="ريلز" i], [data-pagelet*="Reel" i]'));

    el.__abpHidden = true;
    el.setAttribute("data-abp-blocked", reason);

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
      // For Reels: hide visually and eliminate scroll snap target so carousel glides smoothly past it
      el.style.setProperty("visibility", "hidden", "important");
      el.style.setProperty("pointer-events", "none", "important");
      el.style.setProperty("scroll-snap-align", "none", "important");
      advanceReelIfActive(el);
    } else {
      el.style.setProperty("display", "none", "important");
      el.style.setProperty("height", "0", "important");
      el.style.setProperty("min-height", "0", "important");
      el.style.setProperty("margin", "0", "important");
      el.style.setProperty("padding", "0", "important");
    }

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
      if (e.childElementCount > 35) continue;

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
        if (rawLen > 32 && !HINT.test(raw)) {
          seen.add(e);
          continue;
        }
      }

      // FAST PATH 4: Skip elements inside comment panels, dialogs, form elements, textboxes, or post message bodies
      if (e.closest && e.closest('[role="dialog"], [role="textbox"], [contenteditable="true"], form, [data-ad-preview="message"], [data-ad-comet-preview="message"], [data-ad-rendering-role="story_message"], [aria-label*="Comment" i], [aria-label*="تعليق" i]')) {
        seen.add(e);
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
    var adLinks = document.querySelectorAll('a[href*="/ads/about"], a[href*="facebook.com/ads/about"], a[href*="/about/ads"], a[href*="facebook.com/about/ads"], a[href*="/about_this_ad"], a[href*="/ad_preferences/"], a[href*="facebook.com/ad_preferences"]');
    for (var i = 0; i < adLinks.length && i < 30; i++) {
      var card = postContainerOf(adLinks[i]);
      if (card && !card.__abpHidden) {
        var cr = card.getBoundingClientRect();
        if (cr.height > 2600) continue;
        hide(card, "direct-ad-link");
      }
    }
  }

  /** Dedicated sweeper for SVG <use> based ad disclosure chips */
  function sweepSvgAds() {
    if (!S.adBlock || !S.fbSponsored) return;
    var main = document.querySelector('div[role="main"]') || document.body;
    var uses = main.querySelectorAll('svg use[*|href^="#"], svg use[href^="#"]');
    for (var i = 0; i < uses.length && i < 40; i++) {
      var u = uses[i];
      if (u.closest && u.closest('[style*="-10000"]')) continue;
      var card = postContainerOf(u);
      if (!card || card.__abpHidden) continue;
      var cr = card.getBoundingClientRect();
      if (cr.bottom < -500 || cr.top < -5000) continue;

      var label = D.readLabel(u.parentElement || u, ENV);
      if (label && matchesAny(label, SPONSORED)) {
        hide(card, "sponsored-svg");
      }
    }
  }

  /**
   * Facebook Comet 2026 Obfuscation Guard:
   * Facebook often renders post timestamps into root SVG <text> elements with textLength="0" and y="-3",
   * and referencing <svg> with height: 1px, causing timestamps to shrink into invisible 0-width dots.
   * This restores normal visual dimensions for all organic timestamps (Arabic & English).
   */
  function restoreSvgTimestamps() {
    var texts = document.querySelectorAll('text[textLength="0"], text[y="-3"]');
    for (var i = 0; i < texts.length; i++) {
      var t = texts[i];
      var raw = (t.textContent || "").trim();
      if (!raw) continue;
      var normTxt = D.norm(raw);
      if (matchesAny(normTxt, SPONSORED)) continue;

      t.removeAttribute("textLength");
      t.setAttribute("y", "12");
    }

    var svgs = document.querySelectorAll('div[role="main"] a svg[style*="height: 1px"]');
    for (var s = 0; s < svgs.length; s++) {
      svgs[s].style.setProperty("height", "14px", "important");
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

      // Header Band Constraint for Feed Cards:
      // On Facebook Feed, the genuine disclosure chip ("مُموَّل" / "Sponsored") sits within the author/metadata header band.
      // 240px allows full coverage for 2-line Arabic titles, badges, and margins without hitting the post body.
      var isReel = (window.location && window.location.pathname.indexOf("/reel") !== -1) ||
                   (container.closest && container.closest('[aria-label*="Reel" i], [aria-label*="ريلز" i], [data-pagelet*="Reel" i]'));

      if (!isReel) {
        var offsetFromCardTop = lr.top - cr.top;
        if (offsetFromCardTop > 240) continue;
      }

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
                      document.querySelector('div[aria-label*="Reel" i], div[aria-label*="ريلز" i], div[data-pagelet*="Reel" i]');
    if (!isReelsPage) return;

    var reelCards = document.querySelectorAll('div[aria-label*="Reel" i], div[aria-label*="ريلز" i], div[data-pagelet*="Reel" i], div[role="main"] div[scrollable="true"] > div');
    for (var i = 0; i < reelCards.length && i < 20; i++) {
      var card = reelCards[i];
      if (!card) continue;

      // Facebook recycles virtualized slide nodes. Restore any node we hid
      // whose creative has since changed, BEFORE the __abpHidden guard skips it.
      revalidateReel(card);

      if (card.__abpHidden) continue;

      // POSITIVE TEST: A real Reels slide ALWAYS contains a <video>. Comment drawers, forms, and dialogs do NOT.
      if (!card.querySelector("video")) continue;

      // Skip comment drawers, modals, input forms
      if (card.matches && card.matches('[role="dialog"], [role="textbox"], form, [aria-label*="Comment" i], [aria-label*="تعليق" i]')) continue;
      if (card.querySelector && card.querySelector('[role="dialog"], [role="textbox"], form, [aria-label*="Write a comment" i], [aria-label*="اكتب تعليق" i]')) continue;

      var cr = card.getBoundingClientRect();
      if (cr.width < 100 || cr.height < 100) continue;

      var isAd = false;

      // 1. Check for specific ad preferences / about links
      if (card.querySelector('a[href*="/ads/about"], a[href*="facebook.com/ads/about"], a[href*="/ad_preferences/"]')) {
        isAd = true;
      }

      // 2. Check for explicit ARIA labels on child elements
      if (!isAd) {
        var ariaEls = card.querySelectorAll('[aria-label]');
        for (var a = 0; a < ariaEls.length && a < 15; a++) {
          var elAria = ariaEls[a];
          if (elAria.closest('[role="dialog"], form, [aria-label*="Comment" i], [aria-label*="تعليق" i]')) continue;
          var labelText = norm(elAria.getAttribute("aria-label"));
          if (labelText && matchesAny(labelText, SPONSORED)) {
            isAd = true;
            break;
          }
        }
      }

      // 3. Check for exact CTA terms on interactive button controls
      if (!isAd) {
        var ctaButtons = card.querySelectorAll('div[role="button"], a[role="link"], [data-testid="reel_cta_button"]');
        for (var b = 0; b < ctaButtons.length && b < 10; b++) {
          var btn = ctaButtons[b];
          if (btn.closest('[role="dialog"], form, [aria-label*="Comment" i], [aria-label*="تعليق" i]')) continue;
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

      // 4. Scoped header label check inside this specific card
      if (!isAd) {
        var spans = card.querySelectorAll('span, a');
        for (var s = 0; s < spans.length && s < 20; s++) {
          var sp = spans[s];
          if (sp.closest('[role="dialog"], form, [aria-label*="Comment" i], [aria-label*="تعليق" i]')) continue;
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
    try { sweepSvgAds(); } catch (_) {}
    try { restoreSvgTimestamps(); } catch (_) {}
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

    // Periodic lightweight refresh for lazily hydrated GraphQL feed items
    setInterval(function () {
      seen = new WeakSet();
      schedule(false);
    }, 2500);
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

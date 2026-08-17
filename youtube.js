/* ============================================================================
 *  youtube.js — YouTube ad handling for Ad Blocker Pro
 *
 *  Ultra-reliable, non-destructive YouTube ad skipping:
 *    1. Video ads   — Instantly clicks Skip controls & accelerates ad playback.
 *    2. Overlay ads — Closes overlay banners and popups.
 *    3. Static ads  — Cleanly collapses promoted grid & masthead elements via CSS.
 * ========================================================================== */

(function () {
  "use strict";

  if (window.__abpYT__) return;
  window.__abpYT__ = true;

  var S = { adBlock: true, ytSkip: true, ytHide: true };
  var skipped = 0;

  /* ---------------------------------------------------------------- *
   * Static ad slots                                                   *
   * ---------------------------------------------------------------- */

  var HIDE_SELECTORS = [
    "ytd-ad-slot-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-banner-promo-renderer",
    "ytd-video-masthead-ad-v3-renderer",
    "ytd-primetime-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-compact-promoted-video-renderer",
    "ytd-display-ad-renderer",
    "ytm-promoted-video-renderer",
    "#masthead-ad",
    "#player-ads",
    ".ytp-ad-overlay-container",
    ".ytd-merch-shelf-renderer",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']"
  ];

  function injectCss() {
    if (!S.adBlock || !S.ytHide) return;
    if (document.getElementById("abp-yt-css")) return;

    var style = document.createElement("style");
    style.id = "abp-yt-css";
    style.textContent = HIDE_SELECTORS.join(",\n") +
      " { display: none !important; }\n" +
      "ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer) { display: none !important; }\n" +
      ".ytp-ad-avatar-lockup-card, .ytp-ad-action-interstitial, .ytp-ad-image-overlay, .ytp-ad-overlay-slot { display: none !important; }";

    (document.head || document.documentElement).appendChild(style);
  }

  /* ---------------------------------------------------------------- *
   * In-player video ads                                               *
   * ---------------------------------------------------------------- */

  var SKIP_BUTTONS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-survey-answer-button",
    "button.ytp-ad-skip-button-container",
    ".ytp-skip-ad-button__text",
    "[class*='skip-ad-button']",
    "[id*='skip-ad-button']",
    ".html5-video-player button[aria-label*='Skip ad' i]",
    ".html5-video-player button[aria-label*='Skip' i]",
    ".html5-video-player button[aria-label*='تخطي']"
  ].join(",");

  var DISMISS_BUTTONS = [
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-overlay-close-container",
    ".ytp-featured-product-close-button"
  ].join(",");

  var reportTimer = null;
  function report() {
    if (reportTimer) return;
    reportTimer = setTimeout(function () {
      reportTimer = null;
      try { chrome.runtime.sendMessage({ type: "abpBlocked", count: skipped, host: "youtube" }); } catch (_) {}
    }, 800);
  }

  function handleAds() {
    if (!S.adBlock || !S.ytSkip) return;

    // 1. Dismiss overlay banners
    var dismiss = document.querySelector(DISMISS_BUTTONS);
    if (dismiss) {
      try { dismiss.click(); } catch (_) {}
    }

    var player = document.querySelector(".html5-video-player");
    if (!player) return;

    var isAdShowing = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");

    // 2. Click Skip Button whenever present
    var skip = document.querySelector(SKIP_BUTTONS);
    if (skip && skip.offsetParent !== null) {
      try {
        skip.click();
        skipped++;
        report();
      } catch (_) {}
    }

    // 3. Fast-forward ad stream cleanly if player is in active ad-showing state
    if (isAdShowing) {
      var video = player.querySelector("video.html5-main-video, video.video-stream");
      if (video && isFinite(video.duration) && video.duration > 0) {
        try {
          video.muted = true;
          video.playbackRate = 16;
          if (video.currentTime < video.duration - 0.1) {
            video.currentTime = video.duration;
          }
          skipped++;
          report();
        } catch (_) {}
      }
    }
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle                                                         *
   * ---------------------------------------------------------------- */

  function start() {
    injectCss();
    handleAds();

    setInterval(function () {
      if (document.visibilityState === "hidden") return;
      if (!document.querySelector(".html5-video-player")) return;
      handleAds();
    }, 150);

    var obs = new MutationObserver(function () { injectCss(); });
    obs.observe(document.documentElement, { childList: true, subtree: false });

    window.addEventListener("yt-navigate-finish", function () {
      injectCss();
      handleAds();
    });
  }

  try {
    var KEYS = Object.keys(S).concat(["whitelist"]);

    chrome.storage.local.get(KEYS, function (cfg) {
      if (cfg) for (var k in S) if (cfg[k] !== undefined) S[k] = cfg[k];

      var host = window.location.hostname;
      if (cfg && cfg.whitelist && cfg.whitelist.includes(host)) return;

      if (document.documentElement) start();
      else document.addEventListener("DOMContentLoaded", start);
    });

    chrome.storage.onChanged.addListener(function (ch) {
      for (var k in ch) if (k in S) S[k] = ch[k].newValue;
    });
  } catch (_) {
    start();
  }
})();

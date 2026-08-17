/* ============================================================================
 *  youtube.js — YouTube In-Player Ad Acceleration & UI Suppression
 *
 *  Works in tandem with inject.js (Native JSON Stripper) to ensure zero ads,
 *  zero black screens, and seamless continuous playback.
 * ========================================================================== */

(function () {
  "use strict";

  if (window.__abpYT__) return;
  window.__abpYT__ = true;

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
    if (document.getElementById("abp-yt-css")) return;

    var style = document.createElement("style");
    style.id = "abp-yt-css";
    style.textContent = HIDE_SELECTORS.join(",\n") +
      " { display: none !important; }\n" +
      "ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer) { display: none !important; }\n" +
      ".ytp-ad-avatar-lockup-card, .ytp-ad-action-interstitial, .ytp-ad-image-overlay, .ytp-ad-overlay-slot { display: none !important; }";

    (document.head || document.documentElement).appendChild(style);
  }

  var SKIP_BUTTONS = [
    ".ytp-ad-skip-button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button",
    ".ytp-ad-survey-answer-button",
    "button.ytp-ad-skip-button-container",
    ".ytp-skip-ad-button__text",
    "[class*='skip-ad-button']",
    "[id*='skip-button']",
    ".html5-video-player button[aria-label*='Skip ad' i]",
    ".html5-video-player button[aria-label*='Skip' i]",
    ".html5-video-player button[aria-label*='تخطي']"
  ].join(",");

  var DISMISS_BUTTONS = [
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-overlay-close-container",
    ".ytp-featured-product-close-button"
  ].join(",");

  function handleAds() {
    // 1. Dismiss overlay banners
    var dismiss = document.querySelector(DISMISS_BUTTONS);
    if (dismiss) {
      try { dismiss.click(); } catch (_) {}
    }

    var player = document.querySelector(".html5-video-player");
    if (!player) return;

    var isAdShowing = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");

    // 2. Click Skip button whenever painted
    var skip = document.querySelector(SKIP_BUTTONS);
    if (skip && skip.offsetParent !== null) {
      try { skip.click(); } catch (_) {}
    }

    // 3. Fast-forward fallback if player gets stuck in an ad stream
    if (isAdShowing) {
      var video = player.querySelector("video.html5-main-video, video.video-stream");
      if (video && isFinite(video.duration) && video.duration > 0) {
        try {
          video.muted = true;
          video.playbackRate = 16;
          if (video.currentTime < video.duration - 0.1) {
            video.currentTime = video.duration;
          }
        } catch (_) {}
      }
    }
  }

  function start() {
    injectCss();
    handleAds();

    setInterval(function () {
      if (document.visibilityState === "hidden") return;
      handleAds();
    }, 150);

    var obs = new MutationObserver(function () { injectCss(); });
    obs.observe(document.documentElement, { childList: true, subtree: false });

    window.addEventListener("yt-navigate-finish", function () {
      injectCss();
      handleAds();
    });
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
})();

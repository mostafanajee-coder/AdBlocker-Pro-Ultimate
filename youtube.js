/* ============================================================================
 *  youtube.js — YouTube In-Player Ad Acceleration & Anti-Adblock Bypass
 *
 *  Works in tandem with inject.js (Native JSON Stripper & Experiment Flags Override)
 *  to ensure zero ads, zero enforcement dialogs, and uninterrupted playback.
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
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']",
    "ytd-enforcement-message-view-model",
    "tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
    "tp-yt-iron-overlay-backdrop"
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

  // Dissolve "Ad blockers are not allowed on YouTube" dialog and resume playback
  function dismissEnforcementDialog() {
    var dialogs = document.querySelectorAll('ytd-enforcement-message-view-model, tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), tp-yt-iron-overlay-backdrop, ytd-popup-container:has(ytd-enforcement-message-view-model)');
    if (dialogs.length) {
      dialogs.forEach(function (d) {
        try { d.remove(); } catch (_) {}
      });
      var video = document.querySelector('video.html5-main-video, video.video-stream');
      if (video && video.paused) {
        try { video.play(); } catch (_) {}
      }
    }
  }

  function handleAds() {
    // 1. Dismiss Anti-Adblock modal if present
    dismissEnforcementDialog();

    // 2. Dismiss overlay banners
    var dismiss = document.querySelector(DISMISS_BUTTONS);
    if (dismiss) {
      try { dismiss.click(); } catch (_) {}
    }

    var player = document.querySelector(".html5-video-player");
    if (!player) return;

    var isAdShowing = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");

    // 3. Click Skip button whenever painted
    var skip = document.querySelector(SKIP_BUTTONS);
    if (skip && skip.offsetParent !== null) {
      try { skip.click(); } catch (_) {}
    }

    // 4. Fast-forward fallback if player gets stuck in an ad stream
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
    }, 100);

    var obs = new MutationObserver(function () {
      injectCss();
      dismissEnforcementDialog();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("yt-navigate-finish", function () {
      injectCss();
      handleAds();
    });
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
})();

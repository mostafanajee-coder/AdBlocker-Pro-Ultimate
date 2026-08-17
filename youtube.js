/* ============================================================================
 *  youtube.js — Ultra-Fast YouTube In-Player Ad Annihilator & Bypass
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

  function killAd() {
    dismissEnforcementDialog();

    var dismiss = document.querySelector(DISMISS_BUTTONS);
    if (dismiss) {
      try { dismiss.click(); } catch (_) {}
    }

    var player = document.querySelector(".html5-video-player");
    var isAd = (player && (player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting"))) ||
               document.querySelector(".ytp-ad-text, .ytp-ad-badge, .ytp-ad-player-overlay, .ytp-ad-preview-container");

    var skip = document.querySelector(SKIP_BUTTONS);
    if (skip && skip.offsetParent !== null) {
      try { skip.click(); } catch (_) {}
    }

    if (isAd) {
      var video = player ? player.querySelector("video.html5-main-video, video.video-stream") : document.querySelector("video");
      if (video) {
        try {
          video.muted = true;
          video.playbackRate = 16;
          if (isFinite(video.duration) && video.duration > 0) {
            video.currentTime = video.duration;
          }
        } catch (_) {}
      }
    }
  }

  // Hook capture phase on video playback events for instant zero-latency ad destruction
  document.addEventListener('timeupdate', killAd, true);
  document.addEventListener('playing', killAd, true);
  document.addEventListener('play', killAd, true);

  function start() {
    injectCss();
    killAd();

    setInterval(function () {
      if (document.visibilityState === "hidden") return;
      killAd();
    }, 150);

    var obs = new MutationObserver(function () {
      injectCss();
      killAd();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("yt-navigate-finish", function () {
      injectCss();
      killAd();
    });
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
})();

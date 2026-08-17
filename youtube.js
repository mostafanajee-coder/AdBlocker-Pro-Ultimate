/* ============================================================================
 *  youtube.js — YouTube Clean Ad Annihilator & Player Harmony Engine
 *
 *  Safe, Surgical, Non-Intrusive:
 *  - 100% normal mouse interactions (Left-click, Double-click, Right-click).
 *  - Clicks ONLY explicit Ad Skip buttons (Never touches Next Video or Chapter Skip).
 *  - Guaranteed NEVER to skip user video or jump to the end!
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
    "tp-yt-iron-overlay-backdrop",
    "ytd-mealbar-promo-renderer",
    ".ytp-ad-avatar-lockup-card",
    ".ytp-ad-action-interstitial",
    ".ytp-ad-image-overlay"
  ];

  function injectCss() {
    if (document.getElementById("abp-yt-css")) return;

    var style = document.createElement("style");
    style.id = "abp-yt-css";
    style.textContent = HIDE_SELECTORS.join(",\n") +
      " { display: none !important; }\n" +
      "ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer) { display: none !important; }";

    (document.head || document.documentElement).appendChild(style);
  }

  // SURGICAL SELECTORS: Only match actual AD skip buttons.
  // NEVER use broad wildcards that might match "Next video" or "Skip chapter"!
  var AD_SKIP_BUTTONS = [
    "button.ytp-skip-ad-button",
    "button.ytp-ad-skip-button",
    "button.ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button",
    ".ytp-ad-skip-button-container button",
    ".ytp-ad-skip-button-modern",
    ".ytp-skip-ad-button"
  ].join(",");

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

    var player = document.querySelector(".html5-video-player");
    if (!player) return;

    var isAdShowing = player.classList.contains("ad-showing") || player.classList.contains("ad-interrupting");
    var isOverlayCard = Boolean(document.querySelector(".ytp-ad-player-overlay, .ytp-ad-player-overlay-layout"));

    if (isAdShowing || isOverlayCard) {
      // 1. Click explicit ad skip button only if visible
      var skipBtns = document.querySelectorAll(AD_SKIP_BUTTONS);
      for (var i = 0; i < skipBtns.length; i++) {
        var btn = skipBtns[i];
        if (btn && (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
          try {
            btn.click();
          } catch (_) {}
        }
      }

      // 2. Accelerate ad stream to 16x (ONLY when player is actively in ad-showing mode)
      if (isAdShowing) {
        var video = player.querySelector("video.html5-main-video, video.video-stream");
        if (video) {
          try {
            video.muted = true;
            video.playbackRate = 16;
          } catch (_) {}
        }
      }
    } else {
      // 3. Ensure normal playback rate on normal video content
      var normalVideo = player.querySelector("video.html5-main-video, video.video-stream");
      if (normalVideo && normalVideo.playbackRate > 2) {
        normalVideo.playbackRate = 1.0;
        normalVideo.muted = false;
      }
    }
  }

  function start() {
    injectCss();
    killAd();

    setInterval(function () {
      if (document.visibilityState === "hidden") return;
      killAd();
    }, 100);

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

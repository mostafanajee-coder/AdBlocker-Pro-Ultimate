/* ============================================================================
 *  youtube.js — YouTube Clean Ad Annihilator & Player Harmony Engine
 *
 *  Safe, Surgical, Multi-Trap Defense (Version 4.2.0):
 *  - Trap 1: Visual Masking (Zero-Flicker CSS for .ad-showing & Anti-Interruptions).
 *  - Trap 2: Surgical Ad Skip Button auto-click.
 *  - Trap 3: Instant Ad Zero-Seek & Speed-up when in ad-showing mode.
 *  - Trap 4: Zero-Latency Instant Playback & Anti-Throttling Guard.
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
    "ytd-popup-container:has(ytd-mealbar-promo-renderer)",
    ".ytp-ad-avatar-lockup-card",
    ".ytp-ad-action-interstitial",
    ".ytp-ad-image-overlay",
    ".ytp-suggested-action-badge",
    ".ytp-suggested-action-badge-expanded",
    ".ytp-suggested-action-badge-expanded-renderer",
    ".ytp-ad-interrupting-toast",
    ".ytp-info-toast",
    ".ytp-toast",
    "ytd-notification-action-renderer[button-style='STYLE_DEFAULT']",
    "[aria-label*='interruptions' i]",
    "[aria-label*='انقطاعات' i]"
  ];

  function injectCss() {
    if (document.getElementById("abp-yt-css")) return;

    var style = document.createElement("style");
    style.id = "abp-yt-css";
    style.textContent = HIDE_SELECTORS.join(",\n") +
      " { display: none !important; }\n" +
      "ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer) { display: none !important; }\n" +
      // Trap 3: Stealth Visual Masking (Zero-Flicker ad suppressor)
      ".html5-video-player.ad-showing video, .html5-video-player.ad-interrupting video { opacity: 0 !important; pointer-events: none !important; }\n" +
      ".html5-video-player.ad-showing .ytp-ad-module, .html5-video-player.ad-showing .ytp-ad-player-overlay, .html5-video-player.ad-showing .ytp-ad-player-overlay-layout { display: none !important; }";

    (document.head || document.documentElement).appendChild(style);
  }

  // SURGICAL SELECTORS: Only match actual AD skip buttons.
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
    var dialogs = document.querySelectorAll(
      'ytd-enforcement-message-view-model, ' +
      'tp-yt-paper-dialog:has(ytd-enforcement-message-view-model), ' +
      'tp-yt-iron-overlay-backdrop, ' +
      'ytd-popup-container:has(ytd-enforcement-message-view-model), ' +
      'ytd-mealbar-promo-renderer, ' +
      'ytd-popup-container:has(ytd-mealbar-promo-renderer), ' +
      '.ytp-suggested-action-badge[aria-label*="interruptions" i], ' +
      '.ytp-suggested-action-badge[aria-label*="انقطاعات" i]'
    );
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
      // 1. Click explicit ad skip button only if present
      var skipBtns = document.querySelectorAll(AD_SKIP_BUTTONS);
      for (var i = 0; i < skipBtns.length; i++) {
        var btn = skipBtns[i];
        if (btn && (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
          try {
            btn.click();
          } catch (_) {}
        }
      }

      // 2. Poisoned Execution: Instant finish ad stream (ONLY when player is in explicit ad-showing mode)
      if (isAdShowing) {
        var video = player.querySelector("video.html5-main-video, video.video-stream") || document.querySelector("video");
        if (video) {
          try {
            video.muted = true;
            video.playbackRate = 16;
            if (isFinite(video.duration) && video.duration > 0) {
              video.currentTime = video.duration + 0.5;
            }
          } catch (_) {}
        }
      }
    } else {
      // 3. Ensure normal playback rate on normal user video
      var normalVideo = player.querySelector("video.html5-main-video, video.video-stream") || document.querySelector("video");
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
    }, 50);

    var obs = new MutationObserver(function () {
      injectCss();
      killAd();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener("yt-navigate-finish", function () {
      injectCss();
      killAd();
      setTimeout(function () {
        var player = document.getElementById("movie_player") || document.querySelector(".html5-video-player");
        if (player && typeof player.getPlayerState === "function" && player.getPlayerState() === -1) {
          if (typeof player.playVideo === "function") {
            player.playVideo();
          }
        }
      }, 100);
    });
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start);
})();

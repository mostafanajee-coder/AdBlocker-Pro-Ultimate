/* ============================================================================
 * youtube.js — event-driven YouTube visual guard and instant fallback
 *
 * Network/player data is handled by youtube-main.js. This isolated-world
 * companion ensures no ad frame or skip button is painted, and performs one
 * immediate end-seek only if YouTube still marks the player as an active ad.
 * There is no playback acceleration and no permanent polling loop.
 * ========================================================================== */

(function () {
  "use strict";

  if (window.__abpYouTubeVisualV2__) return;
  window.__abpYouTubeVisualV2__ = true;

  var ROOT_DISABLED = "data-abp-yt-disabled";
  var ROOT_AD_ACTIVE = "data-abp-yt-ad-active";
  var CSS_ID = "abp-yt-zero-ad-css";
  var enabled = true;
  var queued = false;
  var player = null;
  var playerObserver = null;
  var burstId = 0;
  var burstFrames = 0;
  var lastVideo = null;
  var previousMuted = false;
  var videoWasPlaying = false;

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
    "ytd-player-legacy-desktop-watch-ads-renderer",
    "ytd-companion-slot-renderer",
    "ytm-promoted-video-renderer",
    "#masthead-ad",
    ".ytp-ad-module",
    ".ytp-ad-overlay-container",
    ".ytp-ad-player-overlay",
    ".ytp-ad-player-overlay-layout",
    ".ytp-ad-text",
    ".ytp-ad-preview-container",
    ".ytp-ad-message-container",
    ".ytp-ad-avatar-lockup-card",
    ".ytp-ad-action-interstitial",
    ".ytp-ad-image-overlay",
    ".ytp-ad-skip-button-container",
    ".ytp-ad-skip-button-slot",
    "button.ytp-skip-ad-button",
    "button.ytp-ad-skip-button",
    "button.ytp-ad-skip-button-modern",
    "ytd-engagement-panel-section-list-renderer[target-id='engagement-panel-ads']",
    "ytd-enforcement-message-view-model",
    "tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)",
    "ytd-mealbar-promo-renderer",
    "ytd-popup-container:has(ytd-mealbar-promo-renderer)"
  ];

  var SKIP_SELECTORS = [
    "button.ytp-skip-ad-button",
    "button.ytp-ad-skip-button",
    "button.ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-slot button",
    ".ytp-ad-skip-button-container button"
  ].join(",");

  function root() {
    return document.documentElement;
  }

  function installCss() {
    if (document.getElementById(CSS_ID)) return;

    var style = document.createElement("style");
    style.id = CSS_ID;

    var prefix = "html:not([" + ROOT_DISABLED + "='1']) ";
    var hidden = HIDE_SELECTORS.map(function (selector) {
      return prefix + selector;
    }).join(",\n");

    style.textContent = hidden + " { display: none !important; visibility: hidden !important; }\n" +
      // Hide the media surface through CSS as soon as YouTube adds its ad
      // class; this happens before MutationObserver callbacks and prevents a
      // single accelerated-ad frame from becoming visible.
      prefix + "#movie_player.ad-showing .html5-video-container,\n" +
      prefix + "#movie_player.ad-interrupting .html5-video-container {\n" +
      "  opacity: 0 !important; visibility: hidden !important;\n" +
      "}\n" +
      prefix + "#movie_player.ad-showing::after,\n" +
      prefix + "#movie_player.ad-interrupting::after,\n" +
      "html[" + ROOT_AD_ACTIVE + "='1']:not([" + ROOT_DISABLED + "='1']) #movie_player::after {\n" +
      "  content: '' !important; position: absolute !important; inset: 0 !important;\n" +
      "  z-index: 2147483646 !important; background: #000 !important;\n" +
      "  pointer-events: none !important; display: block !important;\n" +
      "}\n" +
      prefix + "ytd-rich-item-renderer:has(ytd-ad-slot-renderer),\n" +
      prefix + "ytd-item-section-renderer:has(ytd-in-feed-ad-layout-renderer) {\n" +
      "  display: none !important;\n" +
      "}";

    (document.head || document.documentElement).appendChild(style);
  }

  function isWhitelisted(hostname, list) {
    if (!hostname || !Array.isArray(list)) return false;
    var parts = hostname.toLowerCase().split(".");
    for (var i = 0; i < parts.length - 1; i++) {
      if (list.indexOf(parts.slice(i).join(".")) !== -1) return true;
    }
    return false;
  }

  function applySettings(settings) {
    settings = settings || {};
    enabled = settings.adBlock !== false && settings.ytSkip !== false &&
              !isWhitelisted(window.location.hostname, settings.whitelist || []);

    var docRoot = root();
    if (!docRoot) return;
    if (enabled) {
      docRoot.removeAttribute(ROOT_DISABLED);
      schedule();
    } else {
      docRoot.setAttribute(ROOT_DISABLED, "1");
      finishAd();
    }
  }

  function loadSettings() {
    try {
      chrome.storage.local.get(["adBlock", "ytSkip", "whitelist"], applySettings);
      chrome.storage.onChanged.addListener(function () {
        chrome.storage.local.get(["adBlock", "ytSkip", "whitelist"], applySettings);
      });
    } catch (_) {
      applySettings({});
    }
  }

  function findPlayer() {
    return document.getElementById("movie_player") ||
           document.querySelector(".html5-video-player");
  }

  function playerIsShowingAd(candidate) {
    if (!candidate) return false;
    try {
      if (candidate.classList.contains("ad-showing") ||
          candidate.classList.contains("ad-interrupting")) return true;
      if (typeof candidate.getAdState === "function" && candidate.getAdState() > 0) return true;
    } catch (_) {}
    return false;
  }

  function bindPlayer(candidate) {
    if (candidate === player) return;
    if (playerObserver) playerObserver.disconnect();
    player = candidate;

    if (player && typeof MutationObserver === "function") {
      playerObserver = new MutationObserver(schedule);
      playerObserver.observe(player, {
        attributes: true,
        attributeFilter: ["class"],
        childList: true,
        subtree: true
      });
    }
  }

  function rememberVideo(video) {
    if (!video || video === lastVideo) return;
    lastVideo = video;
    previousMuted = Boolean(video.muted);
    videoWasPlaying = !video.paused;
  }

  function clickHiddenSkipControls(candidate) {
    try {
      if (typeof candidate.skipAd === "function") candidate.skipAd();
    } catch (_) {}

    var buttons = document.querySelectorAll(SKIP_SELECTORS);
    for (var i = 0; i < buttons.length; i++) {
      try { buttons[i].click(); } catch (_) {}
    }
  }

  function instantEndAd(candidate) {
    var video = candidate.querySelector("video.html5-main-video, video.video-stream") ||
                document.querySelector("video.html5-main-video, video.video-stream");
    if (!video) return;

    rememberVideo(video);
    try { video.muted = true; } catch (_) {}

    // This is a zero-seek fallback, not playback acceleration. Normally the
    // response sanitizer prevents this path from being needed at all.
    try {
      if (isFinite(video.duration) && video.duration > 0 &&
          video.currentTime < video.duration - 0.02) {
        video.currentTime = video.duration;
      }
    } catch (_) {}
  }

  function finishAd() {
    var docRoot = root();
    if (docRoot) docRoot.removeAttribute(ROOT_AD_ACTIVE);

    if (lastVideo) {
      try { lastVideo.muted = previousMuted; } catch (_) {}
      if (videoWasPlaying && lastVideo.paused) {
        try {
          var playPromise = lastVideo.play();
          if (playPromise && typeof playPromise.catch === "function") {
            playPromise.catch(function () {});
          }
        } catch (_) {}
      }
    }

    lastVideo = null;
    videoWasPlaying = false;
  }

  function scheduleBurst() {
    if (burstId || typeof requestAnimationFrame !== "function") return;
    burstFrames = 0;

    var tick = function () {
      burstId = 0;
      if (!enabled || !playerIsShowingAd(player) || burstFrames++ >= 30) {
        if (!playerIsShowingAd(player)) finishAd();
        return;
      }

      suppressCurrentAd(false);
      burstId = requestAnimationFrame(tick);
    };

    burstId = requestAnimationFrame(tick);
  }

  function suppressCurrentAd(startBurst) {
    if (!enabled) return;

    var current = findPlayer();
    bindPlayer(current);
    if (!current || !playerIsShowingAd(current)) {
      finishAd();
      return;
    }

    var docRoot = root();
    if (docRoot) docRoot.setAttribute(ROOT_AD_ACTIVE, "1");
    clickHiddenSkipControls(current);
    instantEndAd(current);

    if (startBurst !== false) scheduleBurst();
  }

  function schedule() {
    if (queued) return;
    queued = true;

    var run = function () {
      queued = false;
      suppressCurrentAd(true);
    };

    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  function start() {
    installCss();
    loadSettings();
    bindPlayer(findPlayer());
    schedule();

    if (typeof MutationObserver === "function") {
      var documentObserver = new MutationObserver(schedule);
      documentObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    ["yt-navigate-start", "yt-navigate-finish", "yt-page-data-updated"].forEach(function (name) {
      window.addEventListener(name, schedule, true);
    });

    ["loadedmetadata", "durationchange", "playing"].forEach(function (name) {
      document.addEventListener(name, function (event) {
        if (event.target && event.target.tagName === "VIDEO") schedule();
      }, true);
    });
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();

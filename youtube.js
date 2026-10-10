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
  var videoPageKey = "";
  var manuallyPausedVideo = null;
  var MAX_AD_RETRIES = 12;
  var AD_RETRY_DELAY = 100;

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
      dismissEnforcement();
      schedule();
    } else {
      docRoot.setAttribute(ROOT_DISABLED, "1");
      finishAd();
    }
  }

  function loadSettings() {
    try {
      chrome.storage.local.get(["adBlock", "ytSkip", "whitelist"], applySettings);
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area && area !== "local") return;
        if (changes && !(changes.adBlock || changes.ytSkip || changes.whitelist)) return;
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
    finishAd(false);
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
    videoPageKey = pageKey();
  }

  function clickHiddenSkipControls(candidate) {
    try {
      if (typeof candidate.skipAd === "function") candidate.skipAd();
    } catch (_) {}

    if (!playerIsShowingAd(candidate)) return;
    var buttons = candidate.querySelectorAll(SKIP_SELECTORS);
    for (var i = 0; i < buttons.length; i++) {
      if (!playerIsShowingAd(candidate)) break;
      try { buttons[i].click(); } catch (_) {}
    }
  }

  function instantEndAd(candidate) {
    // A synchronous skip can already have switched to the real video.
    if (!playerIsShowingAd(candidate)) return;
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

  function pageKey() {
    return (window.location.pathname || "") + (window.location.search || "");
  }

  function finishAd(allowResume) {
    if (burstId) { clearTimeout(burstId); burstId = 0; }
    var docRoot = root();
    if (docRoot) docRoot.removeAttribute(ROOT_AD_ACTIVE);

    if (lastVideo) {
      try { lastVideo.muted = previousMuted; } catch (_) {}
      var current = findPlayer();
      var currentVideo = current && current.querySelector("video.html5-main-video, video.video-stream");
      if (allowResume !== false && videoWasPlaying && lastVideo !== manuallyPausedVideo &&
          lastVideo.paused && !lastVideo.ended && currentVideo === lastVideo &&
          videoPageKey === pageKey() && document.contains(lastVideo)) {
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
    videoPageKey = "";
  }

  function scheduleBurst() {
    if (burstId) return;
    burstFrames = 0;

    var tick = function () {
      burstId = 0;
      if (!enabled || !playerIsShowingAd(player) || burstFrames++ >= MAX_AD_RETRIES) {
        if (!playerIsShowingAd(player)) finishAd();
        return;
      }

      suppressCurrentAd(false);
      if (enabled && playerIsShowingAd(player) && burstFrames < MAX_AD_RETRIES) {
        burstId = setTimeout(tick, AD_RETRY_DELAY);
      }
    };

    // rAF is suspended in hidden tabs. A bounded timer burst keeps recovery
    // working in the background without a permanent playback polling loop.
    burstId = setTimeout(tick, AD_RETRY_DELAY);
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
    rememberVideo(current.querySelector("video.html5-main-video, video.video-stream"));
    clickHiddenSkipControls(current);
    if (findPlayer() !== current) { bindPlayer(findPlayer()); schedule(); return; }
    if (!playerIsShowingAd(current)) { finishAd(); return; }
    instantEndAd(current);

    if (startBurst !== false) scheduleBurst();
  }

  function dismissEnforcement() {
    if (!enabled) return;

    var vms = document.querySelectorAll("ytd-enforcement-message-view-model");
    var dialogs = [];

    try {
      var hasMatches = document.querySelectorAll("tp-yt-paper-dialog:has(ytd-enforcement-message-view-model)");
      for (var h = 0; h < hasMatches.length; h++) dialogs.push(hasMatches[h]);
    } catch (_) {}

    for (var i = 0; i < vms.length; i++) {
      var vm = vms[i];
      var d = vm.closest ? vm.closest("tp-yt-paper-dialog") : vm.parentElement;
      if (d && dialogs.indexOf(d) === -1) dialogs.push(d);
      try { vm.remove(); } catch (_) {}
    }

    if (dialogs.length === 0 && vms.length === 0) return;

    for (var j = 0; j < dialogs.length; j++) {
      var dialog = dialogs[j];
      try { if (typeof dialog.close === "function") dialog.close(); } catch (_) {}
      dialog.removeAttribute("opened");
      dialog.removeAttribute("aria-modal");
      dialog.removeAttribute("prevent-autonav");
      try { dialog.remove(); } catch (_) {}
    }

    var backdrops = document.querySelectorAll("tp-yt-iron-overlay-backdrop");
    for (var b = 0; b < backdrops.length; b++) {
      try { backdrops[b].remove(); } catch (_) {}
    }

    var current = findPlayer();
    if (current) {
      try { if (typeof current.focus === "function") current.focus(); } catch (_) {}
      var video = current.querySelector("video.html5-main-video, video.video-stream") ||
                  document.querySelector("video.html5-main-video, video.video-stream");
      if (video && video.paused && video !== manuallyPausedVideo && !video.ended) {
        try { if (typeof current.playVideo === "function") current.playVideo(); } catch (_) {}
        try {
          var p = video.play();
          if (p && typeof p.catch === "function") p.catch(function () {});
        } catch (_) {}
      }
    }
  }

  function schedule() {
    if (queued) return;
    queued = true;

    var run = function () {
      queued = false;
      dismissEnforcement();
      suppressCurrentAd(true);
    };

    if (typeof queueMicrotask === "function") queueMicrotask(run);
    else Promise.resolve().then(run);
  }

  function start() {
    installCss();
    loadSettings();
    dismissEnforcement();
    bindPlayer(findPlayer());
    schedule();

    function notePlaybackIntent(event) {
      if (!event.isTrusted || !enabled) return;
      var target = event.target;
      if (!target || !target.closest) return;
      if (target.closest("input, textarea, [contenteditable='true']")) return;
      if (event.type === "keydown") {
        if (event.ctrlKey || event.altKey || event.metaKey ||
            ["k", "K", " ", "MediaPlayPause"].indexOf(event.key) === -1) return;
      } else if (!target.closest(".ytp-play-button, video.html5-main-video, video.video-stream")) {
        return;
      }
      var current = findPlayer();
      var video = current && current.querySelector("video.html5-main-video, video.video-stream");
      if (video) manuallyPausedVideo = video.paused ? null : video;
    }
    document.addEventListener("click", notePlaybackIntent, true);
    document.addEventListener("keydown", notePlaybackIntent, true);
    document.addEventListener("visibilitychange", schedule);

    document.addEventListener("playing", function (event) {
      if (event.target === manuallyPausedVideo) manuallyPausedVideo = null;
      if (event.target === lastVideo && !event.target.paused) videoWasPlaying = true;
    }, true);

    if (typeof MutationObserver === "function") {
      var documentObserver = new MutationObserver(function () {
        dismissEnforcement();
        schedule();
      });
      documentObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    ["yt-navigate-start", "yt-navigate-finish", "yt-page-data-updated"].forEach(function (name) {
      window.addEventListener(name, function () {
        dismissEnforcement();
        schedule();
      }, true);
    });

    ["loadedmetadata", "durationchange", "playing", "ended"].forEach(function (name) {
      document.addEventListener(name, function (event) {
        if (event.target && event.target.tagName === "VIDEO") schedule();
      }, true);
    });
  }

  if (document.documentElement) start();
  else document.addEventListener("DOMContentLoaded", start, { once: true });
})();

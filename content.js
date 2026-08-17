(function () {
  'use strict';

  function getRoot() {
    return document.documentElement || document.head || document.body;
  }

  function isWhitelisted(hostname, list) {
    if (!hostname || !list) return false;
    var parts = hostname.split(".");
    for (var i = 0; i < parts.length - 1; i++) {
      var domain = parts.slice(i).join(".");
      if (list.indexOf(domain) !== -1) return true;
    }
    return false;
  }

  function isStreamingSite(host) {
    return /faselhd|faselhdx|wecima|mycima|akwam|arabseed|egybest|egydead|cima|shahid|laroza/i.test(host);
  }

  function shouldSkip(target) {
    var tag = target && target.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || (target && target.isContentEditable);
  }

  function applyCosmeticFilters(settings) {
    if (!settings.adBlock && !settings.antiAdblock) return;

    var builtin = [
      ".ad-banner, .ad-container, .ad-wrapper, .ad_box, .ad_unit,",
      "ins.adsbygoogle, .sponsored-post, .sponsored-content, [class*=\"sponsored\"],",
      '[id*="google_ads"], [id*="taboola"], [id*="outbrain"],',
      // Video player ad overlays on streaming sites
      ".jw-ad-container, .jw-ad-break, .jw-ad-overlay, .jw-flag-ads,",
      ".vjs-ad-overlay, .vjs-ima3-ad-container, .vjs-ad-loading,",
      ".fluid_video_wrapper .ad_banner, .player-ads, .video-ad-overlay,",
      'div[id^="ad_overlay"], div[class*="ad_overlay"], div[class*="video_ad"],',
      'div[class*="click-trap"], div[class*="click_trap"], a[class*="click_trap"],',
      'div[id*="ad-holder"], div[class*="ad-holder"], div.adv-overlay, div.adv-holder'
    ].join("\n");

    var css = builtin + " { display: none !important; }";

    // Generic element-hiding selectors
    var extra = settings.cosmeticCss;
    if (settings.adBlock && Array.isArray(extra) && extra.length) {
      for (var i = 0; i < extra.length; i += 200) {
        var chunk = extra.slice(i, i + 200).join(",\n");
        if (chunk) css += "\n" + chunk + " { display: none !important; }";
      }
    }

    var style = document.createElement("style");
    style.textContent = css;
    var root = getRoot();
    if (root) {
      root.appendChild(style);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        (document.head || document.body || document.documentElement).appendChild(style);
      });
    }
  }

  // Neutralize invisible transparent click-traps layered over video players ONLY on streaming sites
  function defuseClickTraps() {
    try {
      var host = window.location.hostname.toLowerCase();
      if (!isStreamingSite(host)) return; // Never tamper with YouTube, Google, etc.

      var links = document.querySelectorAll('a[target="_blank"]');
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 100) {
          var href = (el.href || "").toLowerCase();
          if (/bet|aff|track|click|pop|redir|smartlink|offer|bonus|ad|cpm/i.test(href)) {
            el.style.pointerEvents = "none";
            el.style.display = "none";
          }
        }
      }
    } catch (_) {}
  }

  // Capture-phase click interceptor: Prevents rogue click-jacking on streaming sites
  document.addEventListener('click', function (e) {
    try {
      var host = window.location.hostname.toLowerCase();
      if (!isStreamingSite(host)) return;

      var target = e.target;
      var anchor = target.closest('a');
      var playerArea = target.closest('#player, .player, .watch-holder, .video-player, .player-container, .player-holder, .embed-responsive, .player-iframe, iframe');

      if (playerArea && anchor && anchor.target === '_blank') {
        var curDomain = window.location.hostname.split('.').slice(-2).join('.');
        var targetDomain = "";
        try { targetDomain = new URL(anchor.href).hostname.split('.').slice(-2).join('.'); } catch (_) {}

        // If clicking an external link layered directly over the video player
        if (targetDomain && targetDomain !== curDomain) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          anchor.remove();
          return false;
        }
      }
    } catch (_) {}
  }, true);

  function applyMouseUnlock(settings) {
    if (!settings.mouseUnlock) return;
    var host = window.location.hostname.toLowerCase();
    if (/(?:^|\.)youtube\.com$/i.test(host)) return; // Never interfere with YouTube player controls or context menu

    var events = ["contextmenu", "copy", "cut", "selectstart", "dragstart"];
    for (var i = 0; i < events.length; i++) {
      document.addEventListener(events[i], function (e) {
        if (shouldSkip(e.target)) return;
        e.stopPropagation();
        e.stopImmediatePropagation();
      }, true);
    }
    var css = [
      "html, body, html *, body * {",
      "  user-select: auto !important;",
      "  -webkit-user-select: auto !important;",
      "  -moz-user-select: auto !important;",
      "  -ms-user-select: auto !important;",
      "  pointer-events: auto !important;",
      "}"
    ].join("\n");
    var style = document.createElement("style");
    style.textContent = css;
    var root = getRoot();
    if (root) {
      root.appendChild(style);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        (document.head || document.body || document.documentElement).appendChild(style);
      });
    }
  }

  chrome.storage.local.get(null, function (settings) {
    if (!settings) settings = {};
    var hostname = window.location.hostname;
    var wl = settings.whitelist || [];
    if (isWhitelisted(hostname, wl)) return;
    applyCosmeticFilters(settings);
    applyMouseUnlock(settings);

    if (isStreamingSite(hostname)) {
      defuseClickTraps();
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", defuseClickTraps);
      }
      setInterval(defuseClickTraps, 1500);
    }
  });
})();

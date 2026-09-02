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
    return /faselhd|faselhdx|wecima|mycima|akwam|arabseed|egybest|egydead|cima|shahid|laroza|dood|vidmoly|streamtape/i.test(host);
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
    style.id = "abp-builtin-cosmetic";
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

  // Apply custom rules defined by user via Element Zapper
  function applyCustomUserRules() {
    try {
      chrome.storage.local.get("customUserRules", function (res) {
        var allRules = (res && res.customUserRules) || {};
        var host = window.location.hostname.toLowerCase();
        var selectors = allRules[host] || [];

        // Check parent domains
        var parts = host.split(".");
        for (var p = 0; p < parts.length - 1; p++) {
          var parentHost = parts.slice(p).join(".");
          if (allRules[parentHost] && Array.isArray(allRules[parentHost])) {
            selectors = selectors.concat(allRules[parentHost]);
          }
        }

        if (selectors.length === 0) return;
        var existing = document.getElementById("abp-custom-user-css");
        if (existing) existing.remove();

        var style = document.createElement("style");
        style.id = "abp-custom-user-css";
        style.textContent = selectors.join(",\n") + " { display: none !important; }";
        var root = getRoot();
        if (root) root.appendChild(style);
      });
    } catch (_) {}
  }

  // Neutralize invisible transparent click-traps layered over video players ONLY on streaming sites
  function defuseClickTraps() {
    try {
      var host = window.location.hostname.toLowerCase();
      if (!isStreamingSite(host)) return;

      var links = document.querySelectorAll('a[target="_blank"]');
      for (var i = 0; i < links.length; i++) {
        var el = links[i];
        var rect = el.getBoundingClientRect();
        if (rect.width > 200 && rect.height > 100) {
          var href = (el.href || "").toLowerCase();
          if (/bet|aff|track|click|pop|redir|smartlink|offer|bonus|ad|cpm|banner/i.test(href)) {
            el.style.pointerEvents = "none";
            el.style.display = "none";
          }
        }
      }

      // Neutralize fake overlay divs inside video player containers
      var overlays = document.querySelectorAll('.player-overlay, .click-trap, div[style*="z-index: 9999"], div[style*="z-index: 2147483647"]');
      for (var j = 0; j < overlays.length; j++) {
        var o = overlays[j];
        if (o.id && o.id.startsWith("abp-")) continue;
        if (o.closest('#player, .player, .video-player, iframe')) {
          o.style.pointerEvents = "none";
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
    if (/(?:^|\.)youtube\.com$/i.test(host)) return; // Never interfere with YouTube player controls

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

  /* ---------------------------------------------------------------- *
   * Interactive Element Zapper (حاجب العناصر التفاعلي)                *
   * ---------------------------------------------------------------- */
  var zapperActive = false;
  var zapperOverlay = null;
  var zapperBanner = null;
  var lastTarget = null;

  function buildUniqueSelector(el) {
    if (!el || el === document.body || el === document.documentElement) return null;

    if (el.id && !/\d{4,}/.test(el.id) && !/^[a-z0-9]{16,}$/i.test(el.id)) {
      return "#" + CSS.escape(el.id);
    }

    var parts = [];
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement && parts.length < 4) {
      var tag = cur.tagName.toLowerCase();
      if (cur.id && !/\d{4,}/.test(cur.id)) {
        parts.unshift("#" + CSS.escape(cur.id));
        break;
      }
      var cls = Array.from(cur.classList).filter(function (c) {
        return !c.startsWith("abp-") && !/^[a-z0-9]{12,}$/i.test(c);
      });
      if (cls.length > 0) {
        parts.unshift(tag + "." + cls.slice(0, 2).map(CSS.escape).join("."));
      } else {
        var parent = cur.parentElement;
        if (parent) {
          var index = Array.from(parent.children).indexOf(cur) + 1;
          parts.unshift(tag + ":nth-child(" + index + ")");
        } else {
          parts.unshift(tag);
        }
      }
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function showToast(msg) {
    var toast = document.createElement("div");
    toast.id = "abp-toast";
    toast.textContent = msg;
    toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a73e8;color:#fff;padding:10px 20px;border-radius:24px;font-size:13px;font-weight:600;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.25);pointer-events:none;transition:opacity 0.3s ease;";
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = "0";
      setTimeout(function () { toast.remove(); }, 300);
    }, 2200);
  }

  function startZapper() {
    if (zapperActive) return;
    zapperActive = true;

    // Overlay outline box
    zapperOverlay = document.createElement("div");
    zapperOverlay.id = "abp-zapper-highlight";
    zapperOverlay.style.cssText = "position:fixed;pointer-events:none;border:2px dashed #ff3366;background:rgba(255,51,102,0.18);z-index:2147483646;display:none;transition:all 0.04s ease;box-sizing:border-box;";
    document.documentElement.appendChild(zapperOverlay);

    // Top instruction banner
    zapperBanner = document.createElement("div");
    zapperBanner.id = "abp-zapper-banner";
    zapperBanner.innerHTML = "⚡ <b>أداة حجب العناصر</b>: انقر على أي عنصر لإخفائه نهائياً | <b>ESC</b> للإلغاء";
    zapperBanner.style.cssText = "position:fixed;top:12px;left:50%;transform:translateX(-50%);background:rgba(20,20,30,0.92);color:#fff;padding:8px 18px;border-radius:30px;font-size:13px;font-family:sans-serif;z-index:2147483647;box-shadow:0 6px 20px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.15);backdrop-filter:blur(8px);cursor:default;";
    document.documentElement.appendChild(zapperBanner);

    document.addEventListener("mousemove", onZapperMouseMove, true);
    document.addEventListener("click", onZapperClick, true);
    document.addEventListener("keydown", onZapperKeyDown, true);
  }

  function stopZapper() {
    zapperActive = false;
    if (zapperOverlay) { zapperOverlay.remove(); zapperOverlay = null; }
    if (zapperBanner) { zapperBanner.remove(); zapperBanner = null; }
    document.removeEventListener("mousemove", onZapperMouseMove, true);
    document.removeEventListener("click", onZapperClick, true);
    document.removeEventListener("keydown", onZapperKeyDown, true);
  }

  function onZapperMouseMove(e) {
    if (!zapperActive) return;
    var target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === zapperOverlay || target === zapperBanner || target === document.body || target === document.documentElement) {
      if (zapperOverlay) zapperOverlay.style.display = "none";
      return;
    }
    lastTarget = target;
    var rect = target.getBoundingClientRect();
    if (zapperOverlay) {
      zapperOverlay.style.display = "block";
      zapperOverlay.style.top = rect.top + "px";
      zapperOverlay.style.left = rect.left + "px";
      zapperOverlay.style.width = rect.width + "px";
      zapperOverlay.style.height = rect.height + "px";
    }
  }

  function onZapperClick(e) {
    if (!zapperActive) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    if (lastTarget) {
      var sel = buildUniqueSelector(lastTarget);
      lastTarget.style.setProperty("display", "none", "important");

      if (sel) {
        var host = window.location.hostname.toLowerCase();
        chrome.storage.local.get("customUserRules", function (res) {
          var allRules = (res && res.customUserRules) || {};
          if (!allRules[host]) allRules[host] = [];
          if (allRules[host].indexOf(sel) === -1) {
            allRules[host].push(sel);
            chrome.storage.local.set({ customUserRules: allRules }, function () {
              applyCustomUserRules();
            });
          }
        });
      }
      showToast("✓ تم حجب العنصر وحفظ القاعدة بنجاح");
    }
    stopZapper();
    return false;
  }

  function onZapperKeyDown(e) {
    if (e.key === "Escape" || e.keyCode === 27) {
      stopZapper();
      showToast("تم إلغاء وضع الحجب");
    }
  }

  // Runtime messaging
  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "START_ELEMENT_ZAPPER") {
      startZapper();
      sendResponse({ ok: true });
    } else if (msg && msg.type === "CLEAR_CUSTOM_RULES") {
      var existing = document.getElementById("abp-custom-user-css");
      if (existing) existing.remove();
      sendResponse({ ok: true });
    }
  });

  // Initialization
  chrome.storage.local.get(null, function (settings) {
    if (!settings) settings = {};
    var hostname = window.location.hostname;
    var wl = settings.whitelist || [];
    if (isWhitelisted(hostname, wl)) return;

    applyCosmeticFilters(settings);
    applyCustomUserRules();
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

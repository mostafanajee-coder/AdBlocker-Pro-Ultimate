(function () {
  'use strict';

  function getRoot() {
    return document.documentElement || document.head || document.body;
  }

  function isWhitelisted(hostname, list) {
    if (!hostname || !list) return false;
    var parts = String(hostname).toLowerCase().split(".");
    for (var i = 0; i < parts.length; i++) {
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

  // Storage keys of the site-specific hiding entries for this host and its
  // parent domains ("cf:a.b.example.com", "cf:b.example.com", "cf:example.com").
  function siteCosmeticKeys(hostname) {
    var parts = String(hostname || "").toLowerCase().split(".").filter(Boolean);
    if (parts.length === 1) return ["cf:" + parts[0]];
    var keys = [];
    for (var i = 0; i < parts.length - 1; i++) keys.push("cf:" + parts.slice(i).join("."));
    return keys;
  }

  function collectSiteRules(store, keys) {
    var hide = [];
    var unhide = Object.create(null);
    for (var k = 0; k < keys.length; k++) {
      var entry = store[keys[k]];
      if (!entry) continue;
      var h = entry.h || [], u = entry.u || [];
      for (var i = 0; i < h.length; i++) hide.push(h[i]);
      for (var j = 0; j < u.length; j++) unhide[u[j]] = true;
    }
    return { hide: hide.filter(function (sel) { return !unhide[sel]; }), unhide: unhide };
  }

  function applyCosmeticFilters(settings, site) {
    if (!settings.adBlock && !settings.antiAdblock) return;
    site = site || { hide: [], unhide: Object.create(null) };

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

    // Generic element-hiding selectors, minus any the lists switch off for
    // this site ("example.com#@#.ad-banner").
    var extra = settings.cosmeticCss;
    if (settings.adBlock && Array.isArray(extra) && extra.length) {
      extra = extra.filter(function (sel) { return !site.unhide[sel]; });
      for (var i = 0; i < extra.length; i += 200) {
        var chunk = extra.slice(i, i + 200).join(",\n");
        if (chunk) css += "\n" + chunk + " { display: none !important; }";
      }
    }

    // Site-specific hiding ("example.com##.sidebar-ad"), one rule per selector
    // and only selectors Chrome's own parser accepts: a malformed one (an
    // unclosed "(" for instance) would otherwise swallow every rule after it.
    if (settings.adBlock && site.hide.length) {
      var probe = document.createDocumentFragment();
      for (var s = 0; s < site.hide.length; s++) {
        try { probe.querySelector(site.hide[s]); } catch (_) { continue; }
        css += "\n" + site.hide[s] + " { display: none !important; }";
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
   * Right-click "Block this element" (menu entry: background.js)       *
   * ---------------------------------------------------------------- */

  // Saved per exact hostname as "cu:<host>" -> [selector, ...].
  var USER_RULE_PREFIX = "cu:";

  // Same list as FILTERS.SITE_COSMETIC_EXCLUDED. These sites have dedicated
  // modules, and a saved element rule once blanked the Facebook feed, so
  // nothing is ever blocked, saved or applied here, in any frame.
  var BLOCK_EXCLUDED = [
    "facebook.com", "messenger.com", "instagram.com",
    "youtube.com", "youtube-nocookie.com", "x.com", "twitter.com"
  ];

  function isBlockExcludedHost(host) {
    host = String(host || "").toLowerCase();
    for (var i = 0; i < BLOCK_EXCLUDED.length; i++) {
      var base = BLOCK_EXCLUDED[i];
      if (host === base || host.slice(-base.length - 1) === "." + base) return true;
    }
    return false;
  }

  var pageHost = String(window.location.hostname || "").toLowerCase();
  var userRuleKey = pageHost && !isBlockExcludedHost(pageHost) ? USER_RULE_PREFIX + pageHost : null;
  var siteWhitelisted = false;

  var lastContextTarget = null;
  // Capture on window so it runs before mouseUnlock's document-level
  // listener, which stops contextmenu propagation.
  window.addEventListener("contextmenu", function (e) {
    lastContextTarget = e.target && e.target.nodeType === 1 ? e.target : null;
  }, true);

  function uiIsArabic() {
    var l = "";
    try { l = (chrome.i18n && chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || ""; } catch (_) {}
    if (!l) l = navigator.language || "";
    return l.toLowerCase().indexOf("ar") === 0;
  }

  function showToast(ar, en) {
    if (!document.body) return;
    var old = document.getElementById("abp-toast");
    if (old) old.remove();
    var toast = document.createElement("div");
    toast.id = "abp-toast";
    toast.textContent = uiIsArabic() ? ar : en;
    toast.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1a73e8;color:#fff;padding:10px 20px;border-radius:24px;font:600 13px sans-serif;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.25);pointer-events:none;transition:opacity 0.3s ease;";
    document.body.appendChild(toast);
    setTimeout(function () {
      toast.style.opacity = "0";
      setTimeout(function () { toast.remove(); }, 300);
    }, 2600);
  }

  // Page structure is never blocked: the main content, feed, navigation,
  // banner or side panels, more than one post, or most of the page.
  var STRUCTURE_SELF = '[role="main"], [role="feed"], main, [role="navigation"], [role="banner"], [role="complementary"], nav, header, body, html';
  var STRUCTURE_INSIDE = '[role="main"], [role="feed"], main, [role="navigation"], [role="banner"], [role="complementary"]';

  function isUnsafeBlockTarget(el) {
    if (!el || el.nodeType !== 1) return true;
    try {
      if (el.matches(STRUCTURE_SELF) || el.querySelector(STRUCTURE_INSIDE)) return true;
      if (el.querySelectorAll("[aria-posinset], article").length > 1) return true;
      var total = document.getElementsByTagName("*").length;
      if (total > 150 && el.getElementsByTagName("*").length > total * 0.4) return true;
    } catch (_) {
      return true;
    }
    return false;
  }

  // A fixed or sticky box may be large: full-screen ad overlays are exactly
  // what people want gone. Anything else covering most of the screen is not.
  function isTooLargeToBlock(el) {
    if (isUnsafeBlockTarget(el)) return true;
    try {
      var r = el.getBoundingClientRect();
      var pos = getComputedStyle(el).position;
      var vw = window.innerWidth, vh = window.innerHeight;
      if (vw > 0 && vh > 0 && pos !== "fixed" && pos !== "sticky" &&
          r.width >= vw * 0.7 && r.height >= vh * 0.6) return true;
    } catch (_) {}
    return false;
  }

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
      var cls = Array.prototype.filter.call(cur.classList, function (name) {
        return name.indexOf("abp-") !== 0 && !/^[a-z0-9]{12,}$/i.test(name);
      });
      if (cls.length > 0) {
        parts.unshift(tag + "." + cls.slice(0, 2).map(CSS.escape).join("."));
      } else if (cur.parentElement) {
        parts.unshift(tag + ":nth-child(" + (Array.prototype.indexOf.call(cur.parentElement.children, cur) + 1) + ")");
      } else {
        parts.unshift(tag);
      }
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }

  function applyUserRules(selectors) {
    var old = document.getElementById("abp-user-rules");
    if (old) old.remove();
    if (!selectors || !selectors.length) return;
    var css = "";
    var probe = document.createDocumentFragment();
    for (var i = 0; i < selectors.length; i++) {
      try { probe.querySelector(selectors[i]); } catch (_) { continue; }
      css += selectors[i] + " { display: none !important; }\n";
    }
    if (!css) return;
    var style = document.createElement("style");
    style.id = "abp-user-rules";
    style.textContent = css;
    var root = getRoot();
    if (root) root.appendChild(style);
  }

  // Whether a candidate can be blocked, why not, and exactly which elements
  // the saved rule would hide. Shown in the picker before anything changes.
  function evaluateBlockTarget(el) {
    if (!el || el === document.body || el === document.documentElement || isTooLargeToBlock(el)) {
      return { ok: false, reason: "tooLarge" };
    }
    var sel = buildUniqueSelector(el);
    var matches = [];
    try { matches = sel ? Array.prototype.slice.call(document.querySelectorAll(sel)) : []; } catch (_) { sel = null; }
    if (!sel || matches.indexOf(el) === -1 || matches.length > 10) return { ok: false, reason: "imprecise" };
    for (var i = 0; i < matches.length; i++) {
      if (isUnsafeBlockTarget(matches[i])) return { ok: false, reason: "tooLarge" };
    }
    return { ok: true, sel: sel, matches: matches };
  }

  function commitBlock(verdict) {
    for (var i = 0; i < verdict.matches.length; i++) {
      verdict.matches[i].style.setProperty("display", "none", "important");
    }
    var sel = verdict.sel;
    chrome.storage.local.get(userRuleKey, function (res) {
      var list = (res && Array.isArray(res[userRuleKey])) ? res[userRuleKey] : [];
      if (list.indexOf(sel) === -1) list.push(sel);
      var patch = {};
      patch[userRuleKey] = list;
      chrome.storage.local.set(patch, function () { applyUserRules(list); });
    });
    showToast("تم الحجب ✓ — للتراجع استخدم نافذة الإضافة", "Blocked ✓ — undo from the extension popup");
  }

  /* ---- Picker: preview and adjust before anything is blocked ---------- */

  var PICK_TEXT = {
    ready1: ["سيُخفى العنصر المحدد", "The highlighted element will be hidden"],
    readyN: ["ستُخفى %n عناصر مطابقة", "%n matching elements will be hidden"],
    tooLarge: ["كبير جدًا — صغّر التحديد", "Too large — make the selection smaller"],
    imprecise: ["لا يمكن تحديده بدقة — جرّب تكبير أو تصغير التحديد", "Can't target this precisely — try bigger or smaller"],
    bigger: ["تكبير ↑", "Bigger ↑"],
    smaller: ["تصغير ↓", "Smaller ↓"],
    block: ["حجب", "Block"],
    cancel: ["إلغاء", "Cancel"]
  };

  function pickText(key, n) {
    var s = PICK_TEXT[key][uiIsArabic() ? 0 : 1];
    return n === undefined ? s : s.replace("%n", n);
  }

  var PICKER_CSS = [
    ":host { all: initial; }",
    ".box { position: fixed; pointer-events: none; box-sizing: border-box; z-index: 2147483646; border-radius: 2px; }",
    ".box.ok { border: 2px solid #e53935; background: rgba(229, 57, 53, 0.22); }",
    ".box.also { border: 2px dashed #e53935; background: rgba(229, 57, 53, 0.12); }",
    ".box.bad { border: 2px solid #f9a825; background: rgba(249, 168, 37, 0.18); }",
    ".bar { position: fixed; left: 50%; transform: translateX(-50%); z-index: 2147483647; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; max-width: calc(100vw - 24px); box-sizing: border-box; background: rgba(20, 20, 30, 0.95); color: #fff; font: 600 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif; padding: 8px 10px; border-radius: 12px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); }",
    ".bar.top { top: 12px; } .bar.bottom { bottom: 12px; }",
    ".status { padding: 0 6px; }",
    ".status.bad { color: #ffd54f; }",
    "button { font: inherit; border: 0; border-radius: 8px; padding: 6px 12px; cursor: pointer; background: #3a3f4b; color: #fff; }",
    "button.block { background: #e53935; }",
    "button:disabled { opacity: 0.4; cursor: not-allowed; }"
  ].join("\n");

  var picker = null;

  function startPicker(target) {
    if (!userRuleKey) return; // excluded site (Facebook, YouTube, ...) or no hostname
    if (siteWhitelisted) {
      showToast("هذا الموقع ضمن المواقع المستثناة من الحجب", "This site is on your exception list");
      return;
    }
    if (!target || !document.body) return;
    stopPicker();

    // Closed shadow root: the site's own CSS can neither restyle nor hide
    // the highlight and the bar.
    var host = document.createElement("div");
    host.id = "abp-picker";
    host.style.cssText = "position:fixed!important;top:0!important;left:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;display:block!important;z-index:2147483647!important;";
    var root = host.attachShadow({ mode: "closed" });
    var style = document.createElement("style");
    style.textContent = PICKER_CSS;
    var boxes = document.createElement("div");
    var bar = document.createElement("div");
    bar.className = "bar top";
    bar.dir = uiIsArabic() ? "rtl" : "ltr";
    var status = document.createElement("span");
    status.className = "status";
    function button(key, cls, onClick) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = pickText(key);
      if (cls) b.className = cls;
      b.addEventListener("click", function (e) { e.preventDefault(); onClick(); });
      return b;
    }
    var bigger = button("bigger", "", pickerBigger);
    var smaller = button("smaller", "", pickerSmaller);
    var block = button("block", "block", pickerConfirm);
    var cancel = button("cancel", "", stopPicker);
    bar.append(status, bigger, smaller, block, cancel);
    root.append(style, boxes, bar);
    document.documentElement.appendChild(host);

    picker = {
      host: host, boxes: boxes, bar: bar, status: status,
      bigger: bigger, smaller: smaller, block: block,
      current: target, stack: [], verdict: null, frame: 0
    };
    pickerSelect(target, []);

    window.addEventListener("keydown", onPickerKey, true);
    window.addEventListener("click", onPickerClick, true);
    window.addEventListener("scroll", pickerRepositionSoon, true);
    window.addEventListener("resize", pickerRepositionSoon, true);
  }

  function stopPicker() {
    if (!picker) return;
    window.removeEventListener("keydown", onPickerKey, true);
    window.removeEventListener("click", onPickerClick, true);
    window.removeEventListener("scroll", pickerRepositionSoon, true);
    window.removeEventListener("resize", pickerRepositionSoon, true);
    if (picker.frame) cancelAnimationFrame(picker.frame);
    picker.host.remove();
    picker = null;
  }

  function pickerSelect(el, stack) {
    picker.current = el;
    picker.stack = stack;
    picker.verdict = evaluateBlockTarget(el);
    var v = picker.verdict;
    picker.status.textContent = v.ok
      ? (v.matches.length > 1 ? pickText("readyN", v.matches.length) : pickText("ready1"))
      : pickText(v.reason);
    picker.status.className = v.ok ? "status" : "status bad";
    picker.block.disabled = !v.ok;
    picker.smaller.disabled = stack.length === 0;
    var parent = el.parentElement;
    picker.bigger.disabled = !parent || parent === document.body || parent === document.documentElement;
    pickerReposition();
  }

  function pickerReposition() {
    if (!picker) return;
    picker.frame = 0;
    if (!document.contains(picker.current)) { stopPicker(); return; }
    var v = picker.verdict;
    var targets = v.ok ? v.matches : [picker.current];
    picker.boxes.textContent = "";
    for (var i = 0; i < targets.length; i++) {
      var r = targets[i].getBoundingClientRect();
      var box = document.createElement("div");
      box.className = "box " + (!v.ok ? "bad" : (targets[i] === picker.current ? "ok" : "also"));
      box.style.left = r.left + "px";
      box.style.top = r.top + "px";
      box.style.width = r.width + "px";
      box.style.height = r.height + "px";
      picker.boxes.appendChild(box);
    }
    // Keep the bar off the element being picked.
    var top = picker.current.getBoundingClientRect().top;
    picker.bar.className = "bar " + (top < 70 ? "bottom" : "top");
  }

  function pickerRepositionSoon() {
    if (picker && !picker.frame) picker.frame = requestAnimationFrame(pickerReposition);
  }

  function pickerBigger() {
    if (!picker || picker.bigger.disabled) return;
    pickerSelect(picker.current.parentElement, picker.stack.concat([picker.current]));
  }

  function pickerSmaller() {
    if (!picker || !picker.stack.length) return;
    var stack = picker.stack.slice();
    pickerSelect(stack.pop(), stack);
  }

  function pickerConfirm() {
    if (!picker || !picker.verdict.ok) return;
    var verdict = picker.verdict;
    stopPicker();
    commitBlock(verdict);
  }

  function onPickerKey(e) {
    if (!picker) return;
    var handled = true;
    if (e.key === "Escape") stopPicker();
    else if (e.key === "ArrowUp") pickerBigger();
    else if (e.key === "ArrowDown") pickerSmaller();
    else if (e.key === "Enter") pickerConfirm();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // While the picker is open, clicking the page selects what was clicked
  // instead of following links or pressing the site's buttons.
  function onPickerClick(e) {
    if (!picker) return;
    var path = e.composedPath ? e.composedPath() : [];
    if (path.indexOf(picker.host) !== -1) return; // the picker's own bar
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    var el = e.target && e.target.nodeType === 1 ? e.target : null;
    if (el && el !== document.body && el !== document.documentElement) pickerSelect(el, []);
  }

  // A saved rule is re-applied on every visit, and sites change: drop any
  // rule that has come to match page structure instead of an ad.
  function pruneUnsafeUserRules() {
    if (!userRuleKey) return;
    chrome.storage.local.get(userRuleKey, function (res) {
      var list = (res && Array.isArray(res[userRuleKey])) ? res[userRuleKey] : [];
      if (!list.length) return;
      var kept = list.filter(function (sel) {
        var nodes;
        try { nodes = document.querySelectorAll(sel); } catch (_) { return false; }
        for (var i = 0; i < nodes.length; i++) if (isUnsafeBlockTarget(nodes[i])) return false;
        return true;
      });
      if (kept.length === list.length) return;
      var done = function () {
        applyUserRules(kept);
        showToast("أُزيلت قاعدة حجب كانت تخفي جزءًا من الصفحة", "Removed a blocking rule that was hiding part of the page");
      };
      if (kept.length) {
        var patch = {};
        patch[userRuleKey] = kept;
        chrome.storage.local.set(patch, done);
      } else {
        chrome.storage.local.remove(userRuleKey, done);
      }
    });
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (msg && msg.type === "ABP_BLOCK_ELEMENT") {
      var target = lastContextTarget && document.contains(lastContextTarget) ? lastContextTarget : null;
      lastContextTarget = null;
      startPicker(target);
      sendResponse({ ok: true });
    }
  });

  // Initialization
  // This runs in every frame of every page: read only what is used here
  // (the settings plus this site's own hiding entries) in a single call,
  // instead of the whole store (filter reports, counters, other sites...).
  var siteKeys = siteCosmeticKeys(window.location.hostname);
  var readKeys = ["adBlock", "antiAdblock", "mouseUnlock", "whitelist", "cosmeticCss"].concat(siteKeys);
  if (userRuleKey) readKeys.push(userRuleKey);
  chrome.storage.local.get(readKeys, function (settings) {
    if (!settings) settings = {};
    var hostname = window.location.hostname;
    var wl = settings.whitelist || [];
    if (isWhitelisted(hostname, wl)) {
      siteWhitelisted = true;
      return;
    }

    applyCosmeticFilters(settings, collectSiteRules(settings, siteKeys));
    if (userRuleKey && settings.adBlock !== false && Array.isArray(settings[userRuleKey]) && settings[userRuleKey].length) {
      applyUserRules(settings[userRuleKey]);
      // Check as soon as the page structure exists (a bad rule must not hide
      // content until the first timed check), then again as content loads in.
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", pruneUnsafeUserRules, { once: true });
      } else {
        pruneUnsafeUserRules();
      }
      [2000, 6000, 15000].forEach(function (ms) { setTimeout(pruneUnsafeUserRules, ms); });
    }
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

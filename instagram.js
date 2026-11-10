/* Instagram-only sponsored feed/Reels handling. Never remount page-owned nodes. */
(function (root, factory) {
  "use strict";
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) api.start(root);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var LABELS = ["sponsored", "paid partnership", "advertisement", "ممول", "اعلان", "برعاية", "محتوى ممول",
    "شراكة مدفوعة", "اعلان ممول", "sponsorise", "sponsorisé", "gesponsert", "publicidad", "patrocinado", "sponsorizzato", "реклама"];
  var CARDS = "article, [role='article'], [data-testid='reel'], [data-testid='reel-container'], [aria-roledescription='slide']";
  var BODY_TEXT = "figcaption, h1, [data-testid*='caption'], [data-testid*='comment'], [data-testid*='description'], [data-comment-id], [role='textbox'], [contenteditable='true']";
  var STRUCTURE = "html, body, main, nav, [role='main'], [role='feed'], [role='navigation']";
  var MARK = "data-abp-instagram-ad", MODE = "data-abp-instagram-mode", POSITION = "data-abp-instagram-position";
  function normalize(text) {
    return String(text || "").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\u034F\uFEFF]/g, "")
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "").replace(/ـ/g, "")
      .replace(/[إأآٱ]/g, "ا").replace(/\s+/g, " ").trim().toLowerCase();
  }
  function isSponsoredLabel(text) {
    if (String(text || "").length > 512) return false;
    var value = normalize(text);
    return LABELS.indexOf(value) !== -1 || /^paid partnership with .+/.test(value) ||
      /^شراكة مدفوعة مع .+/.test(value) || /^محتوى برعاية(?: .+)?$/.test(value);
  }
  function isReelsPath(path) { return /^\/reels?(?:\/|$)/i.test(path || ""); }
  function parseUrl(value) { try { return new URL(value, "https://www.instagram.com/"); } catch (_) { return null; } }
  function isOfficialAdLink(value) {
    var url = parseUrl(value);
    return !!(url && /^https?:$/.test(url.protocol) && /(^|\.)(instagram|facebook)\.com$/i.test(url.hostname) &&
      (/^\/ads\/(?:ig_redirect|about)(?:\/|$)/i.test(url.pathname) || /^\/about\/ads(?:\/|$)/i.test(url.pathname) ||
        (/(^|\.)instagram\.com$/i.test(url.hostname) && url.searchParams.get("enable_persistent_cta") === "true")));
  }
  function isProfileLink(value) {
    var url = parseUrl(value);
    return !!(url && /(^|\.)instagram\.com$/i.test(url.hostname) && /^\/[a-z0-9_.]+\/?$/i.test(url.pathname) &&
      !/^\/(?:reels?|stories|explore|direct|accounts|ads)\/?$/i.test(url.pathname));
  }
  function whitelisted(host, list) {
    return (list || []).some(function (domain) { return host === domain || host.endsWith("." + domain); });
  }
  function all(node, selector) { try { return Array.from(node.querySelectorAll(selector)); } catch (_) { return []; } }
  function closest(node, selector) { try { return node.closest(selector); } catch (_) { return null; } }
  function matches(node, selector) { try { return node.matches(selector); } catch (_) { return false; } }
  function attr(node, key) { try { return node.getAttribute(key) || ""; } catch (_) { return ""; } }
  function start(win) {
    if (win.__abpInstagramAds__) return win.__abpInstagramAds__;
    var doc = win.document, enabled = false, destroyed = false, settings = null, settingsGeneration = 0;
    var hidden = new Map(), counted = new WeakMap(), pending = new Set(), timer = null, observer = null, style = null;
    var listeners = [], mediaIds = new WeakMap(), nextMediaId = 0;
    var later = (win.setTimeout || setTimeout).bind(win), cancel = (win.clearTimeout || clearTimeout).bind(win);
    var css = "[" + MARK + "='1'][" + MODE + "='feed']{height:0!important;min-height:0!important;max-height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:hidden!important;visibility:hidden!important;pointer-events:none!important}" +
      "[" + POSITION + "='relative']{position:relative!important}" +
      "[" + MARK + "='1'][" + MODE + "='viewer']{isolation:isolate!important;background:#111!important}" +
      "[" + MARK + "='1'][" + MODE + "='viewer']>*{visibility:hidden!important}" +
      "[" + MARK + "='1'][" + MODE + "='viewer']::after{content:'';position:absolute;inset:0;background:#111;z-index:2147483000;pointer-events:none}";
    function listen(target, name, callback, options) {
      target.addEventListener(name, callback, options); listeners.push([target, name, callback, options]);
    }
    function installStyle() {
      if (!style || style.isConnected === false) {
        style = doc.createElement("style"); style.id = "abp-instagram-ad-css"; style.textContent = css;
        var parent = doc.head || doc.documentElement; if (parent) parent.appendChild(style);
      } else if (style.textContent !== css) style.textContent = css;
    }
    function visible(node, allowOwned) {
      if (!node || node.isConnected === false) return false;
      if (allowOwned) return true;
      try {
        var rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        var s = win.getComputedStyle ? win.getComputedStyle(node) : null;
        return !s || (s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) !== 0);
      } catch (_) { return false; }
    }
    function safeCard(card) {
      return card && card.nodeType === 1 && card.isConnected !== false && !matches(card, STRUCTURE) &&
        !all(card, "main, nav, [role='main'], [role='feed'], [role='navigation']").length &&
        all(card, "article, [role='article']").length <= 1 && all(card, "video").length <= 1;
    }
    function inBody(node, card) {
      var region = closest(node, BODY_TEXT); return !!(region && region !== card);
    }
    function metadataLabel(node, card, shortAd) {
      if (inBody(node, card)) return false;
      var link = closest(node, "a[href]");
      if (link && isProfileLink(attr(link, "href"))) return false;
      var header = closest(node, "header");
      if (header && card.contains(header)) return true;
      if (link && isOfficialAdLink(attr(link, "href"))) return true;
      // Instagram's Reel viewer may place its standalone "Ad" disclosure below the author row.
      if (shortAd) {
        var badgeRect;
        try { badgeRect = node.getBoundingClientRect(); } catch (_) { return false; }
        if (!badgeRect || badgeRect.width <= 0 || badgeRect.height <= 0) return false;
        return all(card, "a[href]").some(function (author) {
          if (inBody(author, card) || !isProfileLink(attr(author, "href")) || !visible(author)) return false;
          try {
            var authorRect = author.getBoundingClientRect();
            var verticalDistance = Math.abs((badgeRect.top + badgeRect.bottom - authorRect.top - authorRect.bottom) / 2);
            var horizontalDistance = Math.abs((badgeRect.left + badgeRect.right - authorRect.left - authorRect.right) / 2);
            return verticalDistance <= 140 && horizontalDistance <= Math.max(180, card.getBoundingClientRect().width * 0.45);
          } catch (_) { return false; }
        });
      }
      // Reel badges may be beside the author instead of inside <header>.
      var row = node.parentElement;
      for (var i = 0; row && row !== card && i < 3; i++, row = row.parentElement) {
        if ((row.textContent || "").length > 180 || inBody(row, card)) break;
        var authors = all(row, "a[href]");
        if (authors.some(function (author) {
          if (author.contains(node) || !isProfileLink(attr(author, "href"))) return false;
          try {
            var badgeRect = node.getBoundingClientRect(), authorRect = author.getBoundingClientRect();
            if (!badgeRect || !authorRect || badgeRect.width <= 0 || badgeRect.height <= 0 || authorRect.width <= 0 || authorRect.height <= 0) return false;
            var badgeCenter = (badgeRect.top + badgeRect.bottom) / 2, authorCenter = (authorRect.top + authorRect.bottom) / 2;
            return Math.abs(badgeCenter - authorCenter) <= Math.max(24, Math.min(40, Math.max(badgeRect.height, authorRect.height) * 1.5));
          } catch (_) { return false; }
        })) return true;
      }
      return false;
    }
    function sponsored(card) {
      var owned = hidden.has(card);
      var links = all(card, "a[href]").slice(0, 120);
      if (links.some(function (link) { return !inBody(link, card) && visible(link, owned) && isOfficialAdLink(attr(link, "href")); })) return true;
      var nodes = all(card, "span, a, div, [role='button'], [aria-label], [title]").slice(0, 600);
      return nodes.some(function (node) {
        var text = node.textContent || "", label = attr(node, "aria-label") || attr(node, "title");
        var shortAd = [label, text].some(function (value) { return value.length <= 10 && normalize(value) === "ad"; });
        var disclosure = isSponsoredLabel(label) || isSponsoredLabel(text) || shortAd;
        if (!disclosure || !metadataLabel(node, card, shortAd) || !visible(node, owned)) return false;
        // Do not interpret a wrapper containing the caption as an ad badge.
        if (all(node, "h1, figcaption, [data-testid*='caption'], [data-testid*='comment']").length) return false;
        return true;
      });
    }
    function findReelCard(video) {
      var best = null, node = video.parentElement;
      for (var i = 0; node && i < 12; i++, node = node.parentElement) {
        if (matches(node, STRUCTURE) || all(node, "video").length !== 1) break;
        if (!safeCard(node)) break;
        if (matches(node, CARDS)) return node;
        if (sponsored(node)) return node;
        best = node;
      }
      return best;
    }
    function episode(card) {
      var videos = all(card, "video"), parts = [];
      videos.forEach(function (video) {
        if (!mediaIds.has(video)) mediaIds.set(video, ++nextMediaId);
        parts.push(mediaIds.get(video) + ":" + (video.currentSrc || attr(video, "src") || video.src || ""));
      });
      var permalink = all(card, "a[href]").map(function (link) { return parseUrl(attr(link, "href")); })
        .find(function (url) { return url && /(^|\.)instagram\.com$/.test(url.hostname) && /^\/reel\/[^/]+/.test(url.pathname); });
      return parts.join("|") + ":" + (permalink ? permalink.pathname : (isReelsPath(win.location.pathname) ? win.location.pathname : ""));
    }
    function restoreAttribute(card, key, old, ownedValue) {
      if (attr(card, key) !== ownedValue) return;
      if (old === null) card.removeAttribute(key); else card.setAttribute(key, old);
    }
    function release(card) {
      var state = hidden.get(card); if (!state) return;
      state.media.forEach(function (saved, video) {
        if (saved.didMute && !saved.userControlled && video.muted === true) video.muted = saved.muted;
      });
      restoreAttribute(card, MARK, state.oldMark, "1");
      restoreAttribute(card, MODE, state.oldMode, state.mode);
      if (state.positioned) restoreAttribute(card, POSITION, state.oldPosition, "relative");
      hidden.delete(card);
    }
    function countAd(card, key) {
      var seen = counted.get(card); if (!seen) { seen = new Set(); counted.set(card, seen); }
      if (seen.has(key)) return; seen.add(key); if (seen.size > 12) seen.delete(seen.values().next().value);
      try {
        var result = win.chrome.runtime.sendMessage({ type: "abpBlocked", count: 1, host: "instagram" });
        if (result && result.catch) result.catch(function () {});
      } catch (_) {}
    }
    function nextReel(card) {
      if (!isReelsPath(win.location.pathname)) return null;
      if (!visible(card) || typeof doc.elementFromPoint !== "function") return null;
      var rect; try { rect = card.getBoundingClientRect(); } catch (_) { return null; }
      var height = win.innerHeight || 900;
      if (rect.bottom <= 0 || rect.top >= height || Math.min(rect.bottom, height) - Math.max(rect.top, 0) < Math.min(rect.height * 0.5, height * 0.5)) return null;
      var hit = doc.elementFromPoint((rect.left || 0) + rect.width / 2,
        Math.max(0, rect.top) + (Math.min(rect.bottom, height) - Math.max(rect.top, 0)) / 2);
      if (!hit || !card.contains(hit)) return null;
      var choices = all(doc, "button, [role='button']").filter(function (control) {
        if (!visible(control) || control.disabled || attr(control, "aria-disabled") === "true" || card.contains(control)) return false;
        if (closest(control, "nav, [role='menu'], [data-testid*='comment']")) return false;
        var label = normalize(attr(control, "aria-label") || attr(control, "title") || control.textContent);
        if (!label) { var icon = all(control, "svg[aria-label]")[0]; label = normalize(icon && attr(icon, "aria-label")); }
        return ["next reel", "navigate to next reel", "الريل التالي", "الريلز التالي", "reel suivant"].indexOf(label) !== -1;
      });
      return choices.length === 1 ? choices[0] : null;
    }
    function hide(card, mode) {
      var key = episode(card), state = hidden.get(card);
      if (state && (state.key !== key || state.mode !== mode)) { release(card); state = null; }
      var next = !state && mode === "viewer" ? nextReel(card) : null;
      if (!state) {
        state = { key: key, mode: mode, media: new Map(), oldMark: card.getAttribute(MARK), oldMode: card.getAttribute(MODE),
          oldPosition: card.getAttribute(POSITION), positioned: false, advanced: false };
        hidden.set(card, state); countAd(card, key);
      }
      all(card, "video").forEach(function (video) {
        if (!state.media.has(video)) state.media.set(video, { muted: video.muted, didMute: false, userControlled: false });
        var saved = state.media.get(video);
        if (!saved.userControlled && video.muted !== true) { saved.didMute = true; video.muted = true; }
      });
      // Keep the active viewer mounted and sized. Never pause/play its video.
      if (mode === "viewer" && win.getComputedStyle && win.getComputedStyle(card).position === "static") {
        card.setAttribute(POSITION, "relative"); state.positioned = true;
      }
      card.setAttribute(MARK, "1"); card.setAttribute(MODE, mode);
      if (next && !state.advanced) { state.advanced = true; try { next.click(); } catch (_) {} }
    }
    function inspect(card) {
      if (!safeCard(card)) { release(card); return; }
      if (!sponsored(card)) { release(card); return; }
      var viewer = isReelsPath(win.location.pathname) && all(card, "video").length === 1;
      hide(card, viewer ? "viewer" : "feed");
    }
    var lastStory = "";
    function checkStories() {
      if (!/^\/stories\//.test(win.location.pathname || "")) { lastStory = ""; return; }
      var headers = all(doc, "header").filter(function (header) {
        return visible(header) && all(header, "span, a").some(function (label) { return isSponsoredLabel(label.textContent || attr(label, "aria-label")); });
      });
      if (!headers.length) { lastStory = ""; return; }
      // Stories retain their native Next control, but never synthetic key events.
      var controls = all(doc, "button, [role='button']").filter(function (button) {
        return visible(button) && /^(?:next|التالي|القصة التالية|next story)$/.test(normalize(attr(button, "aria-label")));
      });
      var key = win.location.pathname + ":" + (headers[0].textContent || "");
      if (controls.length === 1 && key !== lastStory) { lastStory = key; try { controls[0].click(); } catch (_) {} }
    }
    function flush() {
      timer = null; if (!enabled || destroyed) return;
      installStyle();
      var roots = Array.from(pending); pending.clear();
      var cards = new Set(hidden.keys());
      function gather(root) {
        if (root.nodeType === 3) root = root.parentElement;
        if (!root) return;
        if (root.nodeType === 1) {
          if (matches(root, CARDS)) cards.add(root);
          var parent = closest(root, CARDS); if (parent) cards.add(parent);
        }
        all(root, CARDS).slice(0, 80).forEach(function (card) { cards.add(card); });
        if (isReelsPath(win.location.pathname)) {
          var videos = matches(root, "video") ? [root] : all(root, "video").slice(0, 40);
          if (!videos.length && root.nodeType === 1) {
            var owner = root.parentElement;
            for (var i = 0; owner && i < 12 && !matches(owner, STRUCTURE); i++, owner = owner.parentElement) {
              videos = all(owner, "video"); if (videos.length) break;
            }
          }
          videos.slice(0, 40).forEach(function (video) { var card = findReelCard(video); if (card) cards.add(card); });
        }
      }
      roots.forEach(gather);
      // Prefer the innermost single-video card, never a wrapper of other cards.
      var list = Array.from(cards).filter(function (card) {
        return !Array.from(cards).some(function (inner) { return inner !== card && card.contains(inner); });
      });
      list.forEach(inspect);
      Array.from(hidden.keys()).forEach(function (card) { if (list.indexOf(card) === -1 || card.isConnected === false) release(card); });
      checkStories();
    }
    function schedule(root) {
      if (!enabled || destroyed) return;
      if (pending.size < 64) pending.add(root || doc); else { pending.clear(); pending.add(doc); }
      if (timer === null) timer = later(flush, 40);
    }
    function mutations(records) {
      records.forEach(function (record) {
        if (record.target === style && style.textContent === css) return;
        if (record.type === "attributes" && [MARK, MODE, POSITION].indexOf(record.attributeName) !== -1) {
          var state = hidden.get(record.target);
          var expected = record.attributeName === MARK ? "1" : record.attributeName === MODE && state ? state.mode : "relative";
          if (state && attr(record.target, record.attributeName) === expected) return;
        }
        if (record.type === "attributes" && record.target.tagName === "VIDEO" && /^(?:style|class)$/.test(record.attributeName)) return;
        schedule(record.target);
        Array.from(record.addedNodes || []).slice(0, 16).forEach(schedule);
      });
    }
    function applySettings(value) {
      if (destroyed) return; settings = value || {};
      enabled = settings.adBlock !== false && settings.igSponsored !== false && !whitelisted(win.location.hostname, settings.whitelist || []);
      if (observer) observer.disconnect();
      if (!enabled) {
        if (timer !== null) cancel(timer); timer = null; pending.clear(); Array.from(hidden.keys()).forEach(release); return;
      }
      if (observer && doc.documentElement) observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true,
        attributeFilter: ["aria-label", "title", "href", "src", "class", "style", "hidden", "data-ad-preview", MARK, MODE, POSITION] });
      schedule(doc);
    }
    function readSettings() {
      var generation = ++settingsGeneration;
      try { win.chrome.storage.local.get(["adBlock", "igSponsored", "whitelist"], function (value) {
        if (generation === settingsGeneration) applySettings(value);
      }); } catch (_) { applySettings({ adBlock: false }); }
    }
    function changed(changes, area) {
      if (destroyed || (area && area !== "local") || !(changes.adBlock || changes.igSponsored || changes.whitelist)) return;
      if (settings) {
        var next = Object.assign({}, settings);
        ["adBlock", "igSponsored", "whitelist"].forEach(function (key) { if (changes[key]) next[key] = changes[key].newValue; });
        applySettings(next);
      }
      readSettings();
    }
    function manualAudio(event) {
      if (!event.isTrusted || closest(event.target, "input,textarea,[contenteditable='true']")) return;
      var button = closest(event.target, "button, [role='button']");
      var audio = button && /mute|sound|كتم|الصوت/i.test(attr(button, "aria-label") || attr(button, "title"));
      if (!(audio || (event.type === "keydown" && normalize(event.key) === "m"))) return;
      hidden.forEach(function (state, card) {
        if (card.contains(event.target) || (state.mode === "viewer" && visible(card))) state.media.forEach(function (saved) { saved.userControlled = true; });
      });
    }
    function stop() {
      if (destroyed) return; enabled = false; destroyed = true;
      if (timer !== null) cancel(timer); pending.clear();
      if (observer) observer.disconnect(); Array.from(hidden.keys()).forEach(release);
      if (style) style.remove();
      listeners.forEach(function (entry) { if (entry[0].removeEventListener) entry[0].removeEventListener(entry[1], entry[2], entry[3]); });
      try { win.chrome.storage.onChanged.removeListener(changed); } catch (_) {}
    }
    if (win.MutationObserver) observer = new win.MutationObserver(mutations);
    var controller = { scan: function () { schedule(doc); }, stop: stop };
    win.__abpInstagramAds__ = controller;
    try { win.chrome.storage.onChanged.addListener(changed); } catch (_) {}
    listen(win, "load", function () { schedule(doc); });
    listen(win, "scroll", function () { schedule(doc); }, { passive: true });
    listen(win, "popstate", function () { schedule(doc); });
    listen(win, "pageshow", function (event) { if (event.persisted) readSettings(); });
    listen(doc, "click", manualAudio, true); listen(doc, "keydown", manualAudio, true);
    listen(doc, "volumechange", function (event) { if (matches(event.target, "video")) schedule(event.target); }, true);
    listen(win, "pagehide", function (event) { if (!event.persisted) stop(); });
    readSettings();
    return controller;
  }
  return { normalize: normalize, isSponsoredLabel: isSponsoredLabel, isReelsPath: isReelsPath, isOfficialAdLink: isOfficialAdLink, start: start };
});

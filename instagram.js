/* ============================================================================
 * instagram.js — conservative sponsored post/Reel remover for Instagram
 *
 * Scoped to instagram.com by manifest.json. It hides only a post container
 * with an exact sponsored label or Meta's ads/about link, and uses mutation
 * events instead of a permanent polling timer.
 * ========================================================================== */

(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root && root.document) api.start(root);
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LABELS = [
    "sponsored",
    "paid partnership",
    "advertisement",
    "ممول",
    "اعلان",
    "برعاية",
    "محتوى ممول",
    "شراكة مدفوعة",
    "اعلان ممول",
    "sponsorise",
    "sponsorisé",
    "gesponsert",
    "publicidad",
    "patrocinado",
    "sponsorizzato",
    "реклама"
  ];

  function normalize(text) {
    return String(text || "")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\u034F\uFEFF]/g, "")
      .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
      .replace(/ـ/g, "")
      .replace(/[إأآٱ]/g, "ا")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isSponsoredLabel(text) {
    var value = normalize(text);
    if (!value) return false;
    if (LABELS.indexOf(value) !== -1) return true;
    if (value.indexOf("paid partnership") === 0) return true;
    if (value.indexOf("شراكة مدفوعة") === 0) return true;
    if (value.indexOf("محتوى برعاية") === 0) return true;
    return false;
  }

  function isWhitelisted(hostname, list) {
    if (!hostname || !Array.isArray(list)) return false;
    var parts = hostname.toLowerCase().split(".");
    for (var i = 0; i < parts.length - 1; i++) {
      if (list.indexOf(parts.slice(i).join(".")) !== -1) return true;
    }
    return false;
  }

  function start(win) {
    if (win.__abpInstagramAds__) return;
    win.__abpInstagramAds__ = true;

    var doc = win.document;
    var enabled = true;
    var pending = new Set();
    var queued = false;

    function installStyle() {
      if (doc.getElementById("abp-instagram-ad-css")) return;
      var style = doc.createElement("style");
      style.id = "abp-instagram-ad-css";
      style.textContent = "article[data-abp-instagram-ad='1'] { display: none !important; }";
      (doc.head || doc.documentElement).appendChild(style);
    }

    function articleIsSponsored(article) {
      if (!article || article.nodeType !== 1) return false;

      // 1. Official Instagram / Meta Ad Redirects & CTA links
      try {
        if (article.querySelector(
          'a[href*="/ads/ig_redirect"], a[href*="facebook.com/ads/"], a[href*="/ads/about"], a[href*="about/ads"], a[href*="enable_persistent_cta=true"], [data-ad-preview]'
        )) return true;
      } catch (_) {}

      var nodes;
      try { nodes = article.querySelectorAll("span, a, [aria-label]"); } catch (_) { return false; }

      // 2. Official Header Badges ("Ad", "Sponsored", "مُموَّل", "إعلان", "برعاية", etc.)
      var cardRect = null;
      try { cardRect = article.getBoundingClientRect(); } catch (_) {}

      for (var i = 0; i < nodes.length && i < 300; i++) {
        var node = nodes[i];
        var aria = "";
        var text = "";
        try {
          aria = node.getAttribute("aria-label") || node.getAttribute("title") || "";
          text = node.textContent || "";
        } catch (_) {}

        if (isSponsoredLabel(aria)) return true;

        var cleanText = normalize(text);
        if (!cleanText) continue;

        var inHeader = false;
        try {
          if (node.closest("header")) {
            inHeader = true;
          } else if (cardRect && cardRect.height > 0) {
            var labelRect = node.getBoundingClientRect();
            if (labelRect.height > 0 && labelRect.top <= cardRect.top + Math.min(260, cardRect.height * 0.4)) {
              inHeader = true;
            }
          }
        } catch (_) {}

        // In header band: exact official "ad" badge or standard sponsored label
        if (inHeader) {
          if (cleanText === "ad" || isSponsoredLabel(text)) return true;
        } else {
          if (isSponsoredLabel(text)) return true;
        }
      }
      return false;
    }

    function hideArticle(article) {
      if (!article || article.getAttribute("data-abp-instagram-ad") === "1") return;
      article.setAttribute("data-abp-instagram-ad", "1");
      try {
        var videos = article.querySelectorAll("video");
        for (var i = 0; i < videos.length; i++) {
          videos[i].pause();
          videos[i].muted = true;
        }
      } catch (_) {}
      try {
        if (win.chrome && win.chrome.runtime && win.chrome.runtime.sendMessage) {
          win.chrome.runtime.sendMessage({ type: "abpBlocked", count: 1, host: "instagram" }).catch(function () {});
        }
      } catch (_) {}
    }

    function checkStoriesAd() {
      if (!enabled) return;
      if (win.location && win.location.pathname && win.location.pathname.indexOf("/stories/") !== -1) {
        var headers = doc.querySelectorAll("header, div[role='dialog'] header");
        for (var i = 0; i < headers.length; i++) {
          var h = headers[i];
          var spans = h.querySelectorAll("span, a");
          for (var j = 0; j < spans.length; j++) {
            var txt = spans[j].textContent || spans[j].getAttribute("aria-label") || "";
            if (isSponsoredLabel(txt)) {
              try {
                var nextBtn = doc.querySelector('button[aria-label*="Next" i], button[aria-label*="التالي" i], svg[aria-label*="Next" i], svg[aria-label*="التالي" i]');
                if (nextBtn) {
                  (nextBtn.closest("button") || nextBtn).click();
                } else {
                  doc.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", keyCode: 39, bubbles: true }));
                }
                if (win.chrome && win.chrome.runtime && win.chrome.runtime.sendMessage) {
                  win.chrome.runtime.sendMessage({ type: "abpBlocked", count: 1, host: "instagram" }).catch(function () {});
                }
              } catch (_) {}
              return;
            }
          }
        }
      }
    }

    function inspectArticle(article) {
      if (!enabled || !article || article.nodeType !== 1) return;
      if (articleIsSponsored(article)) hideArticle(article);
    }

    function inspect(rootNode) {
      if (!enabled || !rootNode) return;

      if (rootNode.nodeType === 1) {
        if (rootNode.matches && rootNode.matches("article")) inspectArticle(rootNode);
        if (rootNode.closest) inspectArticle(rootNode.closest("article"));
      }

      var articles;
      try { articles = rootNode.querySelectorAll ? rootNode.querySelectorAll("article") : []; }
      catch (_) { articles = []; }
      for (var i = 0; i < articles.length; i++) inspectArticle(articles[i]);
    }

    function flush() {
      queued = false;
      var roots = Array.from(pending);
      pending.clear();
      for (var i = 0; i < roots.length; i++) inspect(roots[i]);
      checkStoriesAd();
    }

    function schedule(node) {
      if (!node) return;
      pending.add(node);
      if (queued) return;
      queued = true;
      if (typeof queueMicrotask === "function") queueMicrotask(flush);
      else Promise.resolve().then(flush);
    }

    function revealAll() {
      var hidden = doc.querySelectorAll("article[data-abp-instagram-ad='1']");
      for (var i = 0; i < hidden.length; i++) {
        hidden[i].removeAttribute("data-abp-instagram-ad");
      }
    }

    function applySettings(settings) {
      settings = settings || {};
      enabled = settings.adBlock !== false &&
                settings.igSponsored !== false &&
                !isWhitelisted(win.location.hostname, settings.whitelist || []);
      if (enabled) schedule(doc);
      else revealAll();
    }

    installStyle();
    try {
      win.chrome.storage.local.get(["adBlock", "igSponsored", "whitelist"], applySettings);
      win.chrome.storage.onChanged.addListener(function () {
        win.chrome.storage.local.get(["adBlock", "igSponsored", "whitelist"], applySettings);
      });
    } catch (_) {
      applySettings({});
    }

    if (typeof win.MutationObserver === "function") {
      var observer = new win.MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes;
          if (!added || added.length === 0) schedule(records[i].target);
          for (var j = 0; added && j < added.length; j++) schedule(added[j]);
        }
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
    }

    win.addEventListener("load", function () { schedule(doc); }, { once: true });
    win.addEventListener("scroll", function () { schedule(doc); }, { passive: true });
    win.addEventListener("wheel", function () { schedule(doc); }, { passive: true });
    schedule(doc);
  }

  return {
    normalize: normalize,
    isSponsoredLabel: isSponsoredLabel,
    start: start
  };
});

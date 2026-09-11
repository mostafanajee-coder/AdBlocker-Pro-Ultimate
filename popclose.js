/* ============================================================================
 * popclose.js — Smart Popunder Neutralizer
 *
 * Runs only when ad blocking is enabled and the current site is not whitelisted.
 * It closes known advertising popup destinations from inside the popup itself,
 * leaving the parent page's window.open API untouched.
 * ========================================================================== */

(function () {
  "use strict";

  if (window !== window.top) return;

  function isWhitelisted(hostname, list) {
    if (!hostname || !Array.isArray(list)) return false;
    var parts = String(hostname).toLowerCase().split(".");
    for (var i = 0; i < parts.length; i++) {
      if (list.indexOf(parts.slice(i).join(".")) !== -1) return true;
    }
    return false;
  }

  var hostname = "";
  try { hostname = window.location.hostname.toLowerCase(); } catch (_) { return; }
  if (!hostname || hostname === "localhost") return;

  var POPUP_AD_PATTERNS = [
    "popads", "popcash", "propellerads", "adsterra", "monetag", "adcash",
    "exoclick", "trafficjunky", "clickadu", "hilltopads", "bet365", "1xbet",
    "melbet", "linebet", "mostbet", "parimatch", "directrev", "ad-maven",
    "adtrue", "revenuehits", "yllix", "bidvertiser", "ero-advertising",
    "trafficstars", "juicyads", "plugrush", "clickaine", "adxad",
    "pushground", "clickadilla", "richpush", "evadav", "onclickalgo",
    "onclickbright", "onclickperformance", "syndication.exoclick",
    "landing", "track", "smartlink", "safelink", "redirect", "click"
  ];

  var POPUP_AD_DOMAINS = [
    "onclicksuper.com", "onclickalgo.com", "onclickbright.com",
    "ad-delivery.net", "highperformanceformat.com", "effectivegate.com",
    "effectivecpmgate.com", "profitablegatecpm.com", "doublepimp.com",
    "bestcpmgate.com", "alwingulla.com", "bidgear.com", "delivertrk.com",
    "realsrv.com", "adnxs.com", "admob.com", "adskeeper.co.uk",
    "mgid.com", "zeroredirect.com", "onclickperformance.com"
  ];

  function isAdPopup(host, href) {
    if (!host) return false;
    for (var i = 0; i < POPUP_AD_DOMAINS.length; i++) {
      if (host === POPUP_AD_DOMAINS[i] || host.endsWith("." + POPUP_AD_DOMAINS[i])) return true;
    }
    for (var j = 0; j < POPUP_AD_PATTERNS.length; j++) {
      if (host.indexOf(POPUP_AD_PATTERNS[j]) !== -1) return true;
    }
    return !!(href && /(\?|&)(click_id|aff_id|pub_id|offer_id|camp_id|zoneid|pop_id)=/i.test(href));
  }

  function checkAndClose(settings) {
    settings = settings || {};
    if (settings.adBlock === false) return;
    if (isWhitelisted(hostname, settings.whitelist || [])) return;
    try {
      var href = window.location.href.toLowerCase();
      if (isAdPopup(hostname, href)) window.close();
    } catch (_) {}
  }

  try {
    chrome.storage.local.get(["adBlock", "whitelist"], checkAndClose);
  } catch (_) {}
})();

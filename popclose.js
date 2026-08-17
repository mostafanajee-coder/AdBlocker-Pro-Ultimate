/* ============================================================================
 *  popclose.js — Smart Popunder Neutralizer (uBlock Origin Lite Technique)
 *
 *  Closes rogue advertising popunder / popup windows from INSIDE the new window,
 *  leaving the parent page's window.open API 100% untouched and undetectable.
 * ========================================================================== */

(function () {
  "use strict";

  // Only candidate is a genuine new top-level browsing context
  if (window !== window.top) return;

  var hostname = "";
  try {
    hostname = window.location.hostname.toLowerCase();
  } catch (_) {
    return;
  }
  if (!hostname || hostname === "localhost") return;

  // Known intrusive ad networks, popunder brokers, and tracker redirectors
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

    // 1. Direct domain match
    for (var i = 0; i < POPUP_AD_DOMAINS.length; i++) {
      if (host === POPUP_AD_DOMAINS[i] || host.endsWith("." + POPUP_AD_DOMAINS[i])) {
        return true;
      }
    }

    // 2. Pattern match in hostname or path
    for (var j = 0; j < POPUP_AD_PATTERNS.length; j++) {
      var pat = POPUP_AD_PATTERNS[j];
      if (host.indexOf(pat) !== -1) {
        return true;
      }
    }

    // 3. Obvious tracking redirect URLs in query params
    if (href && (/(\?|&)(click_id|aff_id|pub_id|offer_id|camp_id|zoneid|pop_id)=/i.test(href))) {
      return true;
    }

    return false;
  }

  function checkAndClose() {
    try {
      var href = window.location.href.toLowerCase();
      if (isAdPopup(hostname, href)) {
        // If window has an opener (spawned popup) or matches ad patterns, terminate
        try {
          window.close();
        } catch (_) {}
      }
    } catch (_) {}
  }

  // Execute immediately at document_start and re-verify after DOMContentLoaded
  checkAndClose();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", checkAndClose, { once: true });
  }
})();

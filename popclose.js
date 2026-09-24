/* ============================================================================
 * popclose.js — Smart Popunder Neutralizer
 *
 * Runs only when ad blocking is enabled and the current site is not whitelisted.
 * It closes a window that a page's script opened onto a known ad-network
 * domain, from inside that popup, leaving the parent page's window.open API
 * untouched. Anything the user opened themselves is never closed.
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

  // Popunder ad-network domains, matched as the host itself or a subdomain of
  // it, never as a substring: generic words ("click", "track", "landing") and
  // affiliate URL parameters used to match ClickUp, ClickHouse, 17track or an
  // AliExpress affiliate link and close them, since window.close() succeeds on
  // a tab whose history holds a single page.
  var POPUP_AD_DOMAINS = [
    "popads.net", "popcash.net", "propellerads.com", "adsterra.com",
    "monetag.com", "adcash.com", "exoclick.com", "trafficjunky.com",
    "trafficjunky.net", "clickadu.com", "hilltopads.net", "hilltopads.com",
    "directrev.com", "ad-maven.com", "adtrue.com", "revenuehits.com",
    "yllix.com", "bidvertiser.com", "ero-advertising.com", "trafficstars.com",
    "juicyads.com", "plugrush.com", "clickaine.com", "adxad.com",
    "pushground.com", "clickadilla.com", "richpush.co", "evadav.com",
    "onclicksuper.com", "onclickalgo.com", "onclickbright.com",
    "onclickperformance.com", "ad-delivery.net", "highperformanceformat.com",
    "effectivegate.com", "effectivecpmgate.com", "profitablegatecpm.com",
    "doublepimp.com", "bestcpmgate.com", "alwingulla.com", "bidgear.com",
    "delivertrk.com", "realsrv.com", "adnxs.com", "adskeeper.co.uk",
    "mgid.com", "zeroredirect.com"
  ];

  function isAdNetworkHost(host) {
    for (var i = 0; i < POPUP_AD_DOMAINS.length; i++) {
      var d = POPUP_AD_DOMAINS[i];
      if (host === d || host.slice(-d.length - 1) === "." + d) return true;
    }
    return false;
  }

  function checkAndClose(settings) {
    settings = settings || {};
    if (settings.adBlock === false) return;
    if (isWhitelisted(hostname, settings.whitelist || [])) return;
    try {
      // Popunders are opened by a page's script, so they have an opener. A
      // page the user opened (typed, bookmarked, a normal link) has none.
      if (!window.opener) return;
      if (isAdNetworkHost(hostname)) window.close();
    } catch (_) {}
  }

  try {
    chrome.storage.local.get(["adBlock", "whitelist"], checkAndClose);
  } catch (_) {}
})();

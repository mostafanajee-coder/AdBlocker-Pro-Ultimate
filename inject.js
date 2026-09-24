(function () {
  'use strict';

  // 1. Mock standard ad blocker detection variables (Safe & Non-Intrusive)
  try {
    var mockAds = [];
    mockAds.push = function () {};
    mockAds.loaded = true;
    mockAds.length = 5;

    Object.defineProperty(window, "adsbygoogle", {
      value: mockAds,
      writable: true,
      configurable: true
    });

    window.canRunAds = true;
    window.show_ads = function () {};
    window.snack = { isAdBlockerPresent: false };
    window.popns = {};
    window.popunder = function () {};
    
    window.fuckAdBlock = {
      onDetected: function () { return this; },
      onNotDetected: function (cb) { if (typeof cb === 'function') setTimeout(cb, 10); return this; },
      on: function (isDetected, cb) { if (!isDetected && typeof cb === 'function') setTimeout(cb, 10); return this; },
      clearEvent: function () { return this; }
    };
    window.BlockAdBlock = window.fuckAdBlock;
    window.google_ad_client = "ca-pub-0000000000000000";
    window.google_ad_status = 1;
  } catch (_) {}

  // 2. Unblock F12 / DevTools key interception
  try {
    window.addEventListener('keydown', function (e) {
      if (e.key === 'F12' || e.keyCode === 123 ||
         (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c')) ||
         (e.ctrlKey && (e.key === 'U' || e.key === 'u'))) {
        e.stopImmediatePropagation();
      }
    }, true);
  } catch (_) {}

  // 3. Bulletproof Popunder Disarmer for Video Players & Streaming Sites
  try {
    var originalWindowOpen = window.open;
    // Popunder ad-network domains, matched on the destination's hostname (the
    // domain or a subdomain of it). Generic words matched anywhere in the URL
    // ("track", "click", "game", "offer", "delivery") used to stop FedEx
    // tracking, Steam and Amazon order popups on every site.
    var AD_NETWORK_DOMAINS = [
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

    function isAdDestination(url) {
      var host;
      try { host = new URL(url, window.location.href).hostname.toLowerCase(); } catch (_) { return false; }
      for (var i = 0; i < AD_NETWORK_DOMAINS.length; i++) {
        var d = AD_NETWORK_DOMAINS[i];
        if (host === d || host.slice(-d.length - 1) === "." + d) return true;
      }
      return false;
    }

    // Known pirate-streaming hosts only. "stream" and "player" matched
    // Streamlabs, player.vimeo.com and any embedded player; "shahid" matched
    // Shahid, MBC's legitimate streaming service.
    function isStreamingSite(host) {
      return /faselhd|faselhdx|wecima|mycima|akwam|arabseed|egybest|egydead|cima|laroza/i.test(host);
    }

    function isBlankUrl(url) {
      return !url || url === "about:blank";
    }

    function isExternalDomain(url) {
      try {
        var targetUrl = new URL(url, window.location.href);
        var curParts = window.location.hostname.split('.').slice(-2).join('.');
        var targetParts = targetUrl.hostname.split('.').slice(-2).join('.');
        return curParts !== targetParts;
      } catch (_) {
        return true;
      }
    }

    window.open = function (url, target, features) {
      var urlStr = (url || "").toString().trim();
      var isInsideIframe = window !== window.top;
      var curHost = window.location.hostname.toLowerCase();

      // Rule A: Do not blanket-block every iframe popup. Only block iframe
      // opens when the destination is clearly ad-related or the frame itself
      // belongs to a known streaming host.
      if (isInsideIframe && (isStreamingSite(curHost) || (urlStr && isAdDestination(urlStr)))) {
        return null;
      }

      // Rule B: On streaming sites, any window.open to an external domain is
      // an ad popunder. about:blank is left to Rule D, which hands back a
      // stand-in window: returning null there can break the site's own script.
      if (isStreamingSite(curHost) && !isBlankUrl(urlStr) && isExternalDomain(urlStr)) {
        return null;
      }

      // Rule C: popups to a known ad network, on any site
      if (urlStr && isAdDestination(urlStr)) {
        return null;
      }

      // Rule D: Dummy window for about:blank redirect traps, but only on
      // streaming hosts. Legitimate sites often open about:blank for OAuth,
      // editors, print previews, and other real workflows.
      if (isStreamingSite(curHost) && isBlankUrl(urlStr)) {
        var dummyWindow = {
          closed: false,
          focus: function () {},
          blur: function () {},
          close: function () { this.closed = true; },
          location: {
            replace: function (dest) {
              if (isAdDestination(dest) || (isStreamingSite(curHost) && isExternalDomain(dest))) return;
              window.location.href = dest;
            },
            assign: function (dest) {
              if (isAdDestination(dest) || (isStreamingSite(curHost) && isExternalDomain(dest))) return;
              window.location.href = dest;
            },
            set href(dest) {
              if (isAdDestination(dest) || (isStreamingSite(curHost) && isExternalDomain(dest))) return;
              window.location.href = dest;
            }
          }
        };
        return dummyWindow;
      }

      return originalWindowOpen.apply(this, arguments);
    };
  } catch (_) {}
})();

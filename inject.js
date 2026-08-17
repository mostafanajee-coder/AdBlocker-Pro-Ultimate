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
    var AD_URL_REGEX = /popads|popcash|propellerads|adsterra|monetag|adcash|exoclick|trafficjunky|clickadu|hilltopads|bet365|1xbet|melbet|directrev|cpmgate|delivery|smartlink|safelink|track|click|bonus|offer|game|doublepimp|onclick|syndication|revenuehits/i;

    function isStreamingSite(host) {
      return /faselhd|faselhdx|wecima|mycima|akwam|arabseed|egybest|egydead|cima|shahid|laroza|stream|player/i.test(host);
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

      // Rule A: Inside video iframes, window.open is 100% used for rogue popup ads
      if (isInsideIframe) {
        return null;
      }

      // Rule B: On streaming sites, any window.open to an external domain is an ad popunder
      if (isStreamingSite(curHost) && urlStr && isExternalDomain(urlStr)) {
        return null;
      }

      // Rule C: Obvious ad networks regex match
      if (urlStr && AD_URL_REGEX.test(urlStr)) {
        return null;
      }

      // Rule D: Dummy window for about:blank redirect traps
      if (!url || url === "about:blank") {
        var dummyWindow = {
          closed: false,
          focus: function () {},
          blur: function () {},
          close: function () { this.closed = true; },
          location: {
            replace: function (dest) {
              if (AD_URL_REGEX.test(dest) || (isStreamingSite(curHost) && isExternalDomain(dest))) return;
              window.location.href = dest;
            },
            assign: function (dest) {
              if (AD_URL_REGEX.test(dest) || (isStreamingSite(curHost) && isExternalDomain(dest))) return;
              window.location.href = dest;
            },
            set href(dest) {
              if (AD_URL_REGEX.test(dest) || (isStreamingSite(curHost) && isExternalDomain(dest))) return;
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

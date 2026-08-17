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

  // 3. YouTube Zero-Ad In-Stream Engine (JSON.parse + Player API + ytcfg override)
  try {
    var isYouTube = /(?:^|\.)youtube(?:-nocookie)?\.com$/i.test(window.location.hostname);
    if (isYouTube) {
      var sanitizeData = function (obj) {
        if (!obj || typeof obj !== 'object') return obj;
        try {
          if (obj.adPlacements) delete obj.adPlacements;
          if (obj.playerAds) delete obj.playerAds;
          if (obj.adSlots) delete obj.adSlots;
          if (obj.auxiliaryUi) delete obj.auxiliaryUi;
          if (Array.isArray(obj.messages)) {
            obj.messages = obj.messages.filter(function (m) {
              return !m.mealbarPromoRenderer && !m.enforcementMessageViewModel;
            });
          }
        } catch (_) {}
        return obj;
      };

      // A. Hook JSON.parse to sanitize any incoming YouTube player responses
      var origJSONParse = JSON.parse;
      JSON.parse = function (text, reviver) {
        var res = origJSONParse.apply(this, arguments);
        if (res && typeof res === 'object') {
          sanitizeData(res);
        }
        return res;
      };

      // B. Override YouTube Experiment Flags used for ad blocker detection
      var sanitizeYtFlags = function (data) {
        if (!data || typeof data !== 'object') return data;
        try {
          var flags = data.EXPERIMENT_FLAGS || (data.data_ && data.data_.EXPERIMENT_FLAGS);
          if (flags && typeof flags === 'object') {
            flags.web_enable_ab_rsp_cl = false;
            flags.ab_pl_man = false;
            flags.web_enable_ab_reg_app = false;
            flags.enable_ad_block_banner = false;
            flags.html5_enable_ssap_ad_playback = false;
            flags.web_player_response_enrichment = false;
          }
        } catch (_) {}
        return data;
      };

      if (window.ytcfg) {
        if (window.ytcfg.data_) sanitizeYtFlags(window.ytcfg.data_);
        if (typeof window.ytcfg.set === 'function') {
          var origSet = window.ytcfg.set;
          window.ytcfg.set = function (d) { return origSet.call(window.ytcfg, sanitizeYtFlags(d)); };
        }
      } else {
        var _ytcfg;
        Object.defineProperty(window, 'ytcfg', {
          get: function () { return _ytcfg; },
          set: function (val) {
            _ytcfg = val;
            if (val && typeof val.set === 'function') {
              var s = val.set;
              val.set = function (d) { return s.call(val, sanitizeYtFlags(d)); };
            }
          },
          configurable: true
        });
      }

      // C. Sanitize window.ytInitialPlayerResponse
      var _ytInitialPlayerResponse = window.ytInitialPlayerResponse;
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        get: function () { return _ytInitialPlayerResponse; },
        set: function (val) {
          _ytInitialPlayerResponse = sanitizeData(val);
        },
        configurable: true
      });

      // D. Intercept window.fetch for /youtubei/v1/player
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = (typeof input === 'string' ? input : (input && input.url ? input.url : '')).toLowerCase();
        if (url.indexOf('/youtubei/v1/player') !== -1) {
          return origFetch.apply(this, arguments).then(function (response) {
            var origJson = response.json;
            response.json = function () {
              return origJson.apply(this, arguments).then(function (data) {
                return sanitizeData(data);
              });
            };
            var origText = response.text;
            response.text = function () {
              return origText.apply(this, arguments).then(function (text) {
                try {
                  var parsed = JSON.parse(text);
                  return JSON.stringify(sanitizeData(parsed));
                } catch (_) {
                  return text;
                }
              });
            };
            return response;
          });
        }
        return origFetch.apply(this, arguments);
      };

      // E. Media Playback & Player API Fast-Forward
      function pulseYouTubePlayer() {
        try {
          var player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
          if (player) {
            var isAd = (player.classList && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) ||
                       (typeof player.getAdState === 'function' && player.getAdState() > 0) ||
                       document.querySelector('.ytp-ad-text, .ytp-ad-badge, .ytp-ad-player-overlay, .ytp-ad-preview-container, .ytp-ad-player-overlay-layout');

            if (isAd) {
              if (typeof player.skipAd === 'function') {
                player.skipAd();
              }
              if (typeof player.cancelPlayback === 'function') {
                player.cancelPlayback();
              }
              var video = player.querySelector('video') || document.querySelector('video');
              if (video) {
                video.muted = true;
                video.playbackRate = 16;
                if (isFinite(video.duration) && video.duration > 0) {
                  video.currentTime = video.duration - 0.001;
                }
              }
            }
          }
        } catch (_) {}
      }

      setInterval(pulseYouTubePlayer, 30);
    }
  } catch (_) {}

  // 4. Bulletproof Popunder Disarmer for Video Players & Streaming Sites
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

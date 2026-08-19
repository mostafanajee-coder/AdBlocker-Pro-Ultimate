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

  // 3. YouTube Multi-Trap In-Stream Annihilator & Zero-Latency Engine (MAIN World)
  try {
    var isYouTube = /(?:^|\.)youtube(?:-nocookie)?\.com$/i.test(window.location.hostname);
    if (isYouTube) {
      var sanitizeData = function (obj) {
        if (!obj || typeof obj !== 'object') return obj;
        try {
          if (obj.adPlacements) delete obj.adPlacements;
          if (obj.playerAds) delete obj.playerAds;
          if (obj.adSlots) delete obj.adSlots;
          if (obj.adBreakHeartbeatParams) delete obj.adBreakHeartbeatParams;
          if (obj.auxiliaryUi) delete obj.auxiliaryUi;
          if (Array.isArray(obj.messages)) {
            obj.messages = obj.messages.filter(function (m) {
              return !m.mealbarPromoRenderer && !m.enforcementMessageViewModel;
            });
          }
        } catch (_) {}
        return obj;
      };

      // Trap 2A: Hook JSON.parse to strip ad configurations at incoming network parsing
      var origJSONParse = JSON.parse;
      JSON.parse = function (text, reviver) {
        var res = origJSONParse.apply(this, arguments);
        if (res && typeof res === 'object') {
          sanitizeData(res);
        }
        return res;
      };

      // Trap 2B: Override YouTube Experiment Flags used for ad injection & detection
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

      // Trap 2C: Sanitize window.ytInitialPlayerResponse & ytInitialData
      var _ytInitialPlayerResponse = window.ytInitialPlayerResponse;
      Object.defineProperty(window, 'ytInitialPlayerResponse', {
        get: function () { return _ytInitialPlayerResponse; },
        set: function (val) {
          _ytInitialPlayerResponse = sanitizeData(val);
        },
        configurable: true
      });

      var _ytInitialData = window.ytInitialData;
      Object.defineProperty(window, 'ytInitialData', {
        get: function () { return _ytInitialData; },
        set: function (val) {
          _ytInitialData = sanitizeData(val);
        },
        configurable: true
      });

      // Helper: Return immediate dummy 200 OK Response for pure ad trackers
      function createMockResponse(bodyText, contentType) {
        var body = bodyText || '{}';
        var type = contentType || 'application/json';
        if (typeof Response === 'function') {
          return new Response(body, {
            status: 200,
            statusText: 'OK',
            headers: {
              'Content-Type': type,
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: function () { return Promise.resolve(JSON.parse(body)); },
          text: function () { return Promise.resolve(body); }
        };
      }

      var PURE_AD_REGEX = /\/api\/stats\/ads|pagead\/|googleads\.g\.doubleclick\.net|static\.doubleclick\.net|ad\.doubleclick\.net/i;

      // Trap 1A: Intercept window.fetch
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = (typeof input === 'string' ? input : (input && input.url ? input.url : '')).toLowerCase();

        // FAST-PASS: Neutralize explicit ad endpoints with 200 OK in 0ms
        if (PURE_AD_REGEX.test(url)) {
          return Promise.resolve(createMockResponse('{}', 'application/json'));
        }

        if (url.indexOf('/youtubei/v1/player') !== -1 || url.indexOf('/youtubei/v1/next') !== -1) {
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

      // Trap 1B: Intercept XMLHttpRequest
      try {
        var origXhrOpen = XMLHttpRequest.prototype.open;
        var origXhrSend = XMLHttpRequest.prototype.send;
        XMLHttpRequest.prototype.open = function (method, url) {
          this._abpUrl = (typeof url === 'string' ? url : '').toLowerCase();
          return origXhrOpen.apply(this, arguments);
        };
        XMLHttpRequest.prototype.send = function () {
          if (this._abpUrl && PURE_AD_REGEX.test(this._abpUrl)) {
            var self = this;
            setTimeout(function () {
              try {
                Object.defineProperty(self, 'readyState', { value: 4, configurable: true });
                Object.defineProperty(self, 'status', { value: 200, configurable: true });
                Object.defineProperty(self, 'statusText', { value: 'OK', configurable: true });
                Object.defineProperty(self, 'responseText', { value: '{}', configurable: true });
                Object.defineProperty(self, 'response', { value: '{}', configurable: true });
                self.dispatchEvent(new Event('readystatechange'));
                self.dispatchEvent(new Event('load'));
                self.dispatchEvent(new Event('loadend'));
              } catch (_) {}
            }, 0);
            return;
          }

          if (this._abpUrl && (this._abpUrl.indexOf('/youtubei/v1/player') !== -1 || this._abpUrl.indexOf('/youtubei/v1/next') !== -1)) {
            var self = this;
            self.addEventListener('readystatechange', function () {
              if (self.readyState === 4 && self.status === 200) {
                try {
                  var text = self.responseText;
                  var parsed = JSON.parse(text);
                  var sanitized = JSON.stringify(sanitizeData(parsed));
                  Object.defineProperty(self, 'responseText', { value: sanitized, configurable: true });
                  Object.defineProperty(self, 'response', { value: sanitized, configurable: true });
                } catch (_) {}
              }
            }, true);
          }
          return origXhrSend.apply(this, arguments);
        };
      } catch (_) {}

      // Trap 4: Poisoned Execution Layer & Auto-Play Engine
      function pulseYouTubePlayer() {
        try {
          var player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
          if (player) {
            var isAd = (player.classList && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'))) ||
                       (typeof player.getAdState === 'function' && player.getAdState() > 0);

            if (isAd) {
              if (typeof player.skipAd === 'function') {
                player.skipAd();
              }
              var video = player.querySelector('video') || document.querySelector('video');
              if (video) {
                video.muted = true;
                video.playbackRate = 16;
                if (isFinite(video.duration) && video.duration > 0) {
                  video.currentTime = video.duration + 0.5;
                }
              }
            } else {
              // Auto-Play Kickstart: If player is stuck in unstarted mode (-1), start playback immediately!
              var state = typeof player.getPlayerState === 'function' ? player.getPlayerState() : null;
              if (state === -1 && typeof player.playVideo === 'function') {
                player.playVideo();
              }
              var normalVid = player.querySelector('video') || document.querySelector('video');
              if (normalVid && normalVid.playbackRate > 2) {
                normalVid.playbackRate = 1.0;
              }
            }
          }
        } catch (_) {}
      }

      setInterval(pulseYouTubePlayer, 25);
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

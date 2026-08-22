/* ============================================================================
 * youtube-main.js — zero-play YouTube ad response interception (MAIN world)
 *
 * Ads are removed from player/next/get_watch responses before YouTube creates
 * the player.  This replaces the old "play at 16x" mechanism completely.
 * ========================================================================== */

(function () {
  "use strict";

  if (window.__abpYouTubeMainV2__) return;
  window.__abpYouTubeMainV2__ = true;

  var S = window.ABPYouTubeSanitizer;
  if (!S) return;

  var PLAYER_RESPONSE_URL = /(?:\/youtubei\/v1\/(?:player|next|get_watch)|\/playlist\?(?:[^#]*&)?list=|\/watch\?)/i;
  var xhrUrls = typeof WeakMap === "function" ? new WeakMap() : null;
  var xhrTextCache = typeof WeakMap === "function" ? new WeakMap() : null;
  var wrappedResponses = typeof WeakSet === "function" ? new WeakSet() : null;

  function isEnabled() {
    var root = document.documentElement;
    return !root || root.getAttribute("data-abp-yt-disabled") !== "1";
  }

  function requestUrl(input) {
    try {
      if (typeof input === "string") return input;
      if (input && typeof input.url === "string") return input.url;
    } catch (_) {}
    return "";
  }

  function shouldSanitize(url) {
    return isEnabled() && PLAYER_RESPONSE_URL.test(String(url || ""));
  }

  function cleanObject(value) {
    return isEnabled() ? S.sanitize(value) : value;
  }

  function cleanText(value) {
    return isEnabled() ? S.sanitizeText(value) : value;
  }

  /* Trap initial page data assigned before the network client starts. */
  function trapWindowProperty(name) {
    try {
      var descriptor = Object.getOwnPropertyDescriptor(window, name);
      if (descriptor && descriptor.configurable === false) return;

      var stored;
      try { stored = cleanObject(window[name]); } catch (_) { stored = undefined; }

      Object.defineProperty(window, name, {
        configurable: true,
        enumerable: descriptor ? descriptor.enumerable : true,
        get: function () { return stored; },
        set: function (value) { stored = cleanObject(value); }
      });
    } catch (_) {}
  }

  trapWindowProperty("ytInitialPlayerResponse");
  trapWindowProperty("ytInitialData");
  trapWindowProperty("playerResponse");

  /* Catch JSON embedded in bootstrap scripts and non-fetch code paths. */
  try {
    var nativeJSONParse = JSON.parse;
    JSON.parse = function (text) {
      var result = nativeJSONParse.apply(this, arguments);
      if (isEnabled() && typeof text === "string" && S.hasAdMarkers(text)) {
        S.sanitize(result);
      }
      return result;
    };
  } catch (_) {}

  /* Wrap every common Response body reader without delaying fetch itself. */
  function wrapResponse(response) {
    if (!response || (wrappedResponses && wrappedResponses.has(response))) return response;
    if (wrappedResponses) wrappedResponses.add(response);

    try {
      if (typeof response.json === "function") {
        var nativeJson = response.json.bind(response);
        Object.defineProperty(response, "json", {
          configurable: true,
          value: function () {
            return nativeJson().then(cleanObject);
          }
        });
      }

      if (typeof response.text === "function") {
        var nativeText = response.text.bind(response);
        Object.defineProperty(response, "text", {
          configurable: true,
          value: function () {
            return nativeText().then(cleanText);
          }
        });
      }

      if (typeof response.arrayBuffer === "function" &&
          typeof TextDecoder === "function" && typeof TextEncoder === "function") {
        var nativeArrayBuffer = response.arrayBuffer.bind(response);
        Object.defineProperty(response, "arrayBuffer", {
          configurable: true,
          value: function () {
            return nativeArrayBuffer().then(function (buffer) {
              var source = new TextDecoder().decode(buffer);
              if (!S.hasAdMarkers(source) || !isEnabled()) return buffer;
              return new TextEncoder().encode(S.sanitizeText(source)).buffer;
            });
          }
        });
      }

      if (typeof response.blob === "function" && typeof Blob === "function") {
        var nativeBlob = response.blob.bind(response);
        Object.defineProperty(response, "blob", {
          configurable: true,
          value: function () {
            return nativeBlob().then(function (blob) {
              if (!isEnabled() || typeof blob.text !== "function") return blob;
              return blob.text().then(function (text) {
                if (!S.hasAdMarkers(text)) return blob;
                return new Blob([S.sanitizeText(text)], { type: blob.type || "application/json" });
              });
            });
          }
        });
      }

      if (typeof response.clone === "function") {
        var nativeClone = response.clone.bind(response);
        Object.defineProperty(response, "clone", {
          configurable: true,
          value: function () { return wrapResponse(nativeClone()); }
        });
      }
    } catch (_) {}

    return response;
  }

  try {
    var nativeFetch = window.fetch;
    if (typeof nativeFetch === "function") {
      window.fetch = function (input) {
        var args = arguments;
        var url = requestUrl(input);
        return nativeFetch.apply(this, args).then(function (response) {
          return shouldSanitize(url || response.url) ? wrapResponse(response) : response;
        });
      };
    }
  } catch (_) {}

  /* Sanitize XHR data at the native response getters, before page listeners
   * can read it. This avoids the race in the previous readystatechange hook. */
  try {
    var xhrProto = XMLHttpRequest.prototype;
    var nativeOpen = xhrProto.open;

    xhrProto.open = function (method, url) {
      if (xhrUrls) xhrUrls.set(this, String(url || ""));
      return nativeOpen.apply(this, arguments);
    };

    function cachedCleanText(xhr, raw) {
      if (!xhrTextCache || typeof raw !== "string") return cleanText(raw);
      var cached = xhrTextCache.get(xhr);
      if (cached && cached.raw === raw) return cached.clean;
      var cleaned = cleanText(raw);
      xhrTextCache.set(xhr, { raw: raw, clean: cleaned });
      return cleaned;
    }

    function patchXhrGetter(property) {
      var descriptor = Object.getOwnPropertyDescriptor(xhrProto, property);
      if (!descriptor || typeof descriptor.get !== "function" || descriptor.configurable === false) {
        return;
      }

      Object.defineProperty(xhrProto, property, {
        configurable: true,
        enumerable: descriptor.enumerable,
        get: function () {
          var value = descriptor.get.call(this);
          var url = xhrUrls ? xhrUrls.get(this) : "";
          if (!shouldSanitize(url)) return value;

          if (property === "responseText" || typeof value === "string") {
            return cachedCleanText(this, value);
          }
          if (value && typeof value === "object") return cleanObject(value);
          return value;
        }
      });
    }

    patchXhrGetter("responseText");
    patchXhrGetter("response");
  } catch (_) {}
})();

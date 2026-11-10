/**
 * Ad Blocker Pro - Twitter / X MAIN-World Interceptor
 * Sanitizes promoted timeline/reply entries from X GraphQL responses
 * and tags React Fiber promoted nodes for zero-flicker removal.
 */

(function () {
  'use strict';

  if (typeof window !== 'undefined') {
    if (window.__abpTwitterMainActive) return;
    window.__abpTwitterMainActive = true;
  }

  let active = true;

  function isTwitterApiUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return /\/i\/api\/(graphql|2|1\.1)\//i.test(url) ||
           /api\.(twitter|x)\.com\/(graphql|2|1\.1)\//i.test(url);
  }

  function isCursorEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const id = String(entry.entryId || '');
    if (/^cursor[-_]/i.test(id)) return true;
    const content = entry.content;
    if (content && (content.entryType === 'TimelineTimelineCursor' || content.cursorType || content.__typename === 'TimelineTimelineCursor')) {
      return true;
    }
    return false;
  }

  function hasPromotedMetadataDeep(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 5) return false;
    if (obj.promotedMetadata || obj.tweetPromotedMetadata || obj.adMetadataContainer) return true;
    if (obj.isPromoted === true) return true;
    if (typeof obj.entryId === 'string' && /^(promoted[-_]|promotedtweet|promotedtrend|promoteduser)/i.test(obj.entryId)) {
      return true;
    }
    const keys = ['item', 'itemContent', 'content', 'tweet_results', 'result', 'tweet', 'legacy', 'clientEventInfo', 'details', 'timelinesDetails'];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (obj[k] && typeof obj[k] === 'object') {
        if (k === 'clientEventInfo' && obj[k].component === 'promoted_trend') return true;
        if (k === 'timelinesDetails' && typeof obj[k].controllerData === 'string' && /promoted/i.test(obj[k].controllerData)) return true;
        if (hasPromotedMetadataDeep(obj[k], depth + 1)) return true;
      }
    }
    return false;
  }

  function isPromotedEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (isCursorEntry(entry)) return false;
    return hasPromotedMetadataDeep(entry, 0);
  }

  function sanitizeTwitterPayload(root) {
    if (!root || typeof root !== 'object') return 0;
    let removed = 0;
    const seen = typeof WeakSet !== 'undefined' ? new WeakSet() : null;

    function walk(node, depth) {
      if (!node || typeof node !== 'object' || depth > 14) return;
      if (seen) {
        if (seen.has(node)) return;
        seen.add(node);
      }

      if (Array.isArray(node.entries)) {
        const nextEntries = [];
        for (let i = 0; i < node.entries.length; i++) {
          const entry = node.entries[i];
          if (isPromotedEntry(entry)) {
            removed++;
            continue;
          }
          if (entry && entry.content && Array.isArray(entry.content.items)) {
            const origLen = entry.content.items.length;
            entry.content.items = entry.content.items.filter(function (sub) {
              if (isPromotedEntry(sub)) {
                removed++;
                return false;
              }
              return true;
            });
            if (origLen > 0 && entry.content.items.length === 0) {
              continue;
            }
          }
          nextEntries.push(entry);
        }
        node.entries = nextEntries;
      }

      if (Array.isArray(node.moduleItems)) {
        node.moduleItems = node.moduleItems.filter(function (sub) {
          if (isPromotedEntry(sub)) {
            removed++;
            return false;
          }
          return true;
        });
      }

      if (Array.isArray(node)) {
        for (let j = 0; j < node.length; j++) {
          walk(node[j], depth + 1);
        }
        return;
      }

      const keys = Object.keys(node);
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        if (key === 'entries' || key === 'moduleItems') continue;
        const val = node[key];
        if (val && typeof val === 'object') {
          walk(val, depth + 1);
        }
      }
    }

    try {
      walk(root, 0);
    } catch (_) {}

    if (removed > 0 && typeof document !== 'undefined' && typeof CustomEvent === 'function') {
      try {
        document.dispatchEvent(new CustomEvent('__abpTwitterBlocked', { detail: { count: removed } }));
      } catch (_) {}
    }

    return removed;
  }

  // ---- React Fiber DOM Inspection ----
  function getFiber(el) {
    if (!el || typeof el !== 'object') return null;
    try {
      const keys = Object.keys(el);
      for (let i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('__reactFiber$') === 0 || keys[i].indexOf('__reactInternalInstance$') === 0) {
          return el[keys[i]];
        }
      }
    } catch (_) {}
    return null;
  }

  function hasPromotedProps(props, depth) {
    if (!props || typeof props !== 'object' || depth > 4) return false;
    if (props.promotedMetadata || props.tweetPromotedMetadata || props.adMetadataContainer) return true;
    if (props.isPromoted === true) return true;
    if (typeof props.entryId === 'string' && /^(promoted[-_]|promotedtweet|promotedtrend|promoteduser)/i.test(props.entryId)) {
      return true;
    }
    const checkKeys = ['tweet', 'item', 'itemContent', 'content', 'data', 'result', 'placementTracking'];
    for (let i = 0; i < checkKeys.length; i++) {
      const val = props[checkKeys[i]];
      if (val && typeof val === 'object' && hasPromotedProps(val, depth + 1)) return true;
    }
    return false;
  }

  function isElementPromotedViaFiber(el) {
    let fiber = getFiber(el);
    let steps = 0;
    while (fiber && steps < 14) {
      const stateNode = fiber.stateNode;
      if (steps > 0 && stateNode && stateNode.nodeType === 1) {
        if (typeof document !== 'undefined' && stateNode === document.body) break;
        if (stateNode.getAttribute && stateNode.getAttribute('role') === 'region') break;
      }
      const p = fiber.memoizedProps || fiber.pendingProps;
      if (p && hasPromotedProps(p, 0)) return true;
      fiber = fiber.return;
      steps++;
    }
    return false;
  }

  if (typeof window !== 'undefined') {
    const XHR = window.XMLHttpRequest;
    const origOpen = XHR && XHR.prototype && XHR.prototype.open;
    const origSend = XHR && XHR.prototype && XHR.prototype.send;

    if (origOpen && origSend) {
      XHR.prototype.open = function (method, url) {
        try {
          this.__abpTwitterApi = active && isTwitterApiUrl(typeof url === 'string' ? url : (url && url.url) || '');
        } catch (_) {
          this.__abpTwitterApi = false;
        }
        return origOpen.apply(this, arguments);
      };

      XHR.prototype.send = function () {
        if (active && this.__abpTwitterApi) {
          this.addEventListener('readystatechange', function () {
            if (!active || this.readyState !== 4 || this.status !== 200) return;
            try {
              const rType = this.responseType;
              if (!rType || rType === 'text') {
                const raw = this.responseText;
                if (!raw || raw.indexOf('promoted') === -1) return;
                const data = JSON.parse(raw);
                const removed = sanitizeTwitterPayload(data);
                if (removed > 0) {
                  const cleanText = JSON.stringify(data);
                  Object.defineProperty(this, 'responseText', { configurable: true, get: () => cleanText });
                  Object.defineProperty(this, 'response', { configurable: true, get: () => cleanText });
                }
              } else if (rType === 'json' && this.response && typeof this.response === 'object') {
                sanitizeTwitterPayload(this.response);
              }
            } catch (_) {}
          });
        }
        return origSend.apply(this, arguments);
      };
    }

    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = async function (input, init) {
        const res = await origFetch.apply(this, arguments);
        if (!active) return res;
        try {
          const url = typeof input === 'string' ? input : (input && input.url) || '';
          if (!isTwitterApiUrl(url) || !res || !res.ok) return res;
          const clone = res.clone();
          const raw = await clone.text();
          if (!raw || raw.indexOf('promoted') === -1) return res;
          const data = JSON.parse(raw);
          const removed = sanitizeTwitterPayload(data);
          if (removed > 0) {
            return new Response(JSON.stringify(data), {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          }
        } catch (_) {}
        return res;
      };
    }

    function scanDomFibers() {
      if (!active || typeof document === 'undefined') return;
      try {
        const nodes = document.querySelectorAll(
          'article[data-testid="tweet"]:not([data-abp-x-promoted]), ' +
          '[data-testid="trend"]:not([data-abp-x-promoted]), ' +
          '[data-testid="UserCell"]:not([data-abp-x-promoted])'
        );
        for (let i = 0; i < nodes.length; i++) {
          const node = nodes[i];
          if (isElementPromotedViaFiber(node)) {
            node.setAttribute('data-abp-x-promoted', 'true');
          }
        }
      } catch (_) {}
    }

    let rafId = 0;
    function scheduleFiberScan() {
      if (!active || rafId) return;
      if (typeof requestAnimationFrame === 'function') {
        rafId = requestAnimationFrame(function () {
          rafId = 0;
          scanDomFibers();
        });
      }
    }

    let observer = null;
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined') {
      const startObserve = function () {
        const root = document.documentElement || document.body;
        if (!root || observer) return;
        observer = new MutationObserver(function (mutations) {
          if (!active) return;
          for (let i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
              scheduleFiberScan();
              break;
            }
          }
        });
        observer.observe(root, { childList: true, subtree: true });
        scheduleFiberScan();
      };
      if (document.documentElement) startObserve();
      else document.addEventListener('DOMContentLoaded', startObserve, { once: true });
    }

    function stopMainInterceptor() {
      active = false;
      window.__abpTwitterMainActive = false;
      if (XHR && XHR.prototype && origOpen && origSend) {
        if (XHR.prototype.open !== origOpen) XHR.prototype.open = origOpen;
        if (XHR.prototype.send !== origSend) XHR.prototype.send = origSend;
      }
      if (origFetch && window.fetch !== origFetch) {
        window.fetch = origFetch;
      }
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (rafId && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (typeof document !== 'undefined' && document.querySelectorAll) {
        const marked = document.querySelectorAll('[data-abp-x-promoted]');
        for (let i = 0; i < marked.length; i++) {
          marked[i].removeAttribute('data-abp-x-promoted');
        }
      }
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('__abpTwitterMainStop', stopMainInterceptor);
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isTwitterApiUrl,
      isPromotedEntry,
      sanitizeTwitterPayload,
      hasPromotedProps,
      isElementPromotedViaFiber
    };
  }
})();

/**
 * Ad Blocker Pro - Twitter / X Module (Surgical Precision)
 * Zero False-Positive Promoted Tweet & Trend Slayer
 */

(function () {
  'use strict';

  // Strict, exact-match promoted tokens (Twitter / X official ad badges only)
  const EXACT_PROMOTED_LABELS = new Set([
    'promoted',
    'promoted tweet',
    'promoted post',
    'promoted by',
    'ad',
    'مُروّج',
    'مروج',
    'الإعلان',
    'الاعلان',
    'إعلان',
    'اعلان',
    'sponsorisé',
    'sponsorise',
    'patrocinado',
    'promocionado',
    'gesponsert',
    'promovido',
    'gesponsord',
    'продвигаемый твит',
    'реклама',
    'プロモーション',
    '프로모션'
  ]);


  let enabled = false;

  function isWhitelisted(hostname, list) {
    if (!hostname || !Array.isArray(list)) return false;
    const parts = String(hostname).toLowerCase().split('.');
    for (let i = 0; i < parts.length; i++) {
      if (list.indexOf(parts.slice(i).join('.')) !== -1) return true;
    }
    return false;
  }

  function normalizeText(str) {
    if (!str || typeof str !== 'string') return '';
    return str
      .toLowerCase()
      .replace(/[\u200B-\u200D\uFEFF\u034F]/g, '') // strip zero-width obfuscation
      .trim();
  }

  function isExactPromotedLabel(text) {
    const clean = normalizeText(text);
    return EXACT_PROMOTED_LABELS.has(clean);
  }

  function isPromotedTweet(article) {
    if (!article) return false;

    // 1. Official Twitter Ads Link & Click-Tracking (twclid)
    const adLinks = article.querySelectorAll(
      'a[href*="twclid="], ' +
      'a[href*="ads.twitter.com"], ' +
      'a[href*="ads.x.com"], ' +
      'a[href*="/about-this-ad"], ' +
      'a[href*="help.twitter.com/using-x/x-ads-faqs"], ' +
      'a[href*="help.twitter.com/using-twitter/how-twitter-ads-work"], ' +
      'a[href*="business.twitter.com/en/help/troubleshooting/how-twitter-ads-work"]'
    );
    for (let i = 0; i < adLinks.length; i++) {
      const href = adLinks[i].getAttribute('href') || '';
      // Ensure it is not an organic tweet mentioning a link in tweetText
      if (!adLinks[i].closest('[data-testid="tweetText"]')) {
        return true;
      }
    }

    // 3. Dedicated Promoted badge / disclaimer inspection
    // CRITICAL: We strictly EXCLUDE the tweet body, user name, and link previews!
    const candidateBadges = article.querySelectorAll(
      'span:not([data-testid="tweetText"] *):not([data-testid="User-Name"] *):not([data-testid="card.wrapper"] *), ' +
      'div[dir="auto"]:not([data-testid="tweetText"] *):not([data-testid="User-Name"] *):not([data-testid="card.wrapper"] *)'
    );

    for (let j = 0; j < candidateBadges.length; j++) {
      const el = candidateBadges[j];

      // Double-check ancestor isolation to prevent ANY false positives in tweet body or handle
      if (
        el.closest('[data-testid="tweetText"]') ||
        el.closest('[data-testid="User-Name"]') ||
        el.closest('[data-testid="card.wrapper"]') ||
        el.closest('[data-testid="tweetPhoto"]')
      ) {
        continue;
      }

      const txt = el.textContent || '';
      // Ad labels on X are short, standalone badges
      if (txt.length >= 2 && txt.length <= 25) {
        if (isExactPromotedLabel(txt)) {
          return true;
        }
      }

      const aria = el.getAttribute('aria-label') || '';
      if (aria.length >= 2 && aria.length <= 25) {
        if (isExactPromotedLabel(aria)) {
          return true;
        }
      }
    }

    // 4. SVG with promoted icon (megaphone / ad badge)
    const svgs = article.querySelectorAll('svg');
    for (let s = 0; s < svgs.length; s++) {
      const svg = svgs[s];
      if (svg.closest('[data-testid="tweetText"]')) continue;

      const title = svg.querySelector('title');
      if (title && isExactPromotedLabel(title.textContent)) {
        return true;
      }
      const svgAria = svg.getAttribute('aria-label');
      if (svgAria && isExactPromotedLabel(svgAria)) {
        return true;
      }
    }

    return false;
  }

  function sweepTwitterAds() {
    if (!enabled) return;
    try {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        if (article.dataset.abpChecked === 'true') continue;

        if (isPromotedTweet(article)) {
          // Collapse the article and its virtual cell seamlessly without breaking scroll geometry
          article.style.setProperty('display', 'none', 'important');
          const cell = article.closest('[data-testid="cellInnerDiv"]');
          if (cell) {
            cell.dataset.abpCollapsed = 'true';
            cell.style.setProperty('height', '0px', 'important');
            cell.style.setProperty('min-height', '0px', 'important');
            cell.style.setProperty('overflow', 'hidden', 'important');
            cell.style.setProperty('padding', '0px', 'important');
            cell.style.setProperty('margin', '0px', 'important');
          }
          article.dataset.abpBlocked = 'true';
          try {
            chrome.runtime.sendMessage({ type: 'adBlocked', count: 1 }).catch(() => {});
          } catch (_) {}
        }
        article.dataset.abpChecked = 'true';
      }

      // Sidebar promoted trends & who to follow
      const trends = document.querySelectorAll('[data-testid="trend"], [data-testid="UserCell"]');
      for (let j = 0; j < trends.length; j++) {
        const item = trends[j];
        if (item.dataset.abpChecked === 'true') continue;
        if (isPromotedTweet(item)) {
          item.style.setProperty('display', 'none', 'important');
          item.dataset.abpBlocked = 'true';
        }
        item.dataset.abpChecked = 'true';
      }
    } catch (_) {}
  }

  function restoreTwitterAds() {
    try {
      const blocked = document.querySelectorAll('[data-abp-blocked="true"]');
      for (let i = 0; i < blocked.length; i++) {
        blocked[i].style.removeProperty('display');
        blocked[i].removeAttribute('data-abp-blocked');
      }
      const collapsed = document.querySelectorAll('[data-abp-collapsed="true"]');
      for (let j = 0; j < collapsed.length; j++) {
        const cell = collapsed[j];
        cell.style.removeProperty('height');
        cell.style.removeProperty('min-height');
        cell.style.removeProperty('overflow');
        cell.style.removeProperty('padding');
        cell.style.removeProperty('margin');
        cell.removeAttribute('data-abp-collapsed');
      }
      const checked = document.querySelectorAll('[data-abp-checked="true"]');
      for (let k = 0; k < checked.length; k++) checked[k].removeAttribute('data-abp-checked');
    } catch (_) {}
  }

  let idleHandle = null;
  function scheduleSweep() {
    if (!enabled || idleHandle) return;
    if (typeof requestIdleCallback === 'function') {
      idleHandle = requestIdleCallback(() => {
        idleHandle = null;
        sweepTwitterAds();
      }, { timeout: 350 });
    } else {
      idleHandle = setTimeout(() => {
        idleHandle = null;
        sweepTwitterAds();
      }, 200);
    }
  }

  function applySettings(settings) {
    settings = settings || {};
    const next = settings.adBlock !== false &&
                 settings.twitterBlock !== false &&
                 !isWhitelisted(window.location.hostname, settings.whitelist || []);
    if (next === enabled) {
      if (enabled) scheduleSweep();
      return;
    }
    enabled = next;
    if (!enabled) restoreTwitterAds();
    else scheduleSweep();
  }

  function loadSettings() {
    try {
      chrome.storage.local.get(['adBlock', 'twitterBlock', 'whitelist'], applySettings);
    } catch (_) {
      applySettings({});
    }
  }

  function init() {
    if (typeof window === 'undefined' || !document || !document.body) {
      if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', init, { once: true });
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (!enabled) return;
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
          scheduleSweep();
          break;
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    try {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== 'local') return;
        if (changes.adBlock || changes.twitterBlock || changes.whitelist) loadSettings();
      });
    } catch (_) {}

    loadSettings();
  }

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isExactPromotedLabel,
      isPromotedTweet,
      EXACT_PROMOTED_LABELS
    };
  } else {
    init();
  }
})();

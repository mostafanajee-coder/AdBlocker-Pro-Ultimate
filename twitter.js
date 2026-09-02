/**
 * Ad Blocker Pro - Twitter / X Module
 * Detects and neutralizes Promoted Tweets, Trends, and Follow recommendations on X.com
 */

(function () {
  'use strict';

  const PROMOTED_TERMS = [
    'promoted',
    'promoted tweet',
    'ad',
    'ads',
    'مُروّج',
    'مروج',
    'إعلان',
    'اعلان',
    'sponsorisé',
    'patrocinado',
    'gesponsert',
    'promovido',
    'gesponsord',
    'promoted post',
    'promoted by'
  ];

  function isPromotedText(text) {
    if (!text || typeof text !== 'string') return false;
    const clean = text.trim().toLowerCase();
    for (let i = 0; i < PROMOTED_TERMS.length; i++) {
      const term = PROMOTED_TERMS[i];
      if (clean === term || clean.startsWith(term + ' ') || clean.endsWith(' ' + term)) {
        return true;
      }
    }
    return false;
  }

  function isPromotedTweet(article) {
    if (!article) return false;

    // 1. Direct placementTracking or analytics attributes
    if (article.querySelector('[data-testid="placementTracking"]')) {
      return true;
    }

    // 2. Links to Ad Info / Help / Quick Promote
    const adLinks = article.querySelectorAll('a[href*="/quick_promote_web/"], a[href*="/ads"], a[href*="help.twitter.com/using-twitter/how-twitter-ads-work"]');
    if (adLinks.length > 0) {
      return true;
    }

    // 3. Span / div text analysis in tweet header/footer
    const spans = article.querySelectorAll('span, div[dir="auto"], time + div');
    for (let i = 0; i < spans.length; i++) {
      const el = spans[i];
      // Only short elements (labels) to prevent false positives in tweet bodies
      const txt = el.textContent || '';
      if (txt.length > 0 && txt.length <= 30) {
        if (isPromotedText(txt)) {
          return true;
        }
      }
      const aria = el.getAttribute('aria-label') || '';
      if (aria && aria.length <= 30 && isPromotedText(aria)) {
        return true;
      }
    }

    // 4. SVG with promoted icon or title
    const svgs = article.querySelectorAll('svg');
    for (let i = 0; i < svgs.length; i++) {
      const title = svgs[i].querySelector('title');
      if (title && isPromotedText(title.textContent)) {
        return true;
      }
    }

    return false;
  }

  function sweepTwitterAds() {
    try {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        if (article.dataset.abpChecked === 'true') continue;

        if (isPromotedTweet(article)) {
          // Find the outer cell container so it doesn't leave an empty slot in virtualized timeline
          const cell = article.closest('[data-testid="cellInnerDiv"]') || article;
          cell.style.setProperty('display', 'none', 'important');
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
        }
        item.dataset.abpChecked = 'true';
      }
    } catch (_) {}
  }

  let idleHandle = null;
  function scheduleSweep() {
    if (idleHandle) return;
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

  function init() {
    if (typeof window === 'undefined' || !document || !document.body) {
      if (typeof document !== 'undefined') {
        document.addEventListener('DOMContentLoaded', init);
      }
      return;
    }

    // Initial sweep
    sweepTwitterAds();

    // Passive MutationObserver on timeline container
    const observer = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes && mutations[i].addedNodes.length > 0) {
          scheduleSweep();
          break;
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isPromotedText,
      isPromotedTweet,
      PROMOTED_TERMS
    };
  } else {
    init();
  }
})();

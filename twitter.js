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
    'ads',
    'sponsored',
    'مُروّج',
    'مروج',
    'الإعلان',
    'الاعلان',
    'إعلان',
    'اعلان',
    'إعلان مروج',
    'اعلان مروج',
    'تغريدة مروجة',
    'منشور مروج',
    'مادة إعلانية',
    'مادة اعلانية',
    'برعاية',
    'ممول',
    'sponsorisé',
    'sponsorise',
    'patrocinado',
    'promocionado',
    'gesponsert',
    'promovido',
    'gesponsord',
    'sponsorizzato',
    'продвигаемый твит',
    'реклама',
    'プロモーション',
    '広告',
    '프로모션',
    '광고',
    '推廣',
    '推广',
    'reklam',
    'bersponsor'
  ]);

  // Multi-word "Promoted by <Advertiser>" prefix disclosures
  const PROMOTED_BY_PREFIXES = [
    'promoted by ',
    'promoted tweet by ',
    'promoted post by ',
    'sponsored by ',
    'مروج بواسطة ',
    'مروج من قبل ',
    'إعلان بواسطة ',
    'اعلان بواسطة ',
    'إعلان من قبل ',
    'اعلان من قبل ',
    'برعاية بواسطة ',
    'sponsorisé par ',
    'sponsorise par ',
    'patrocinado por ',
    'promocionado por ',
    'gesponsert von ',
    'sponsorizzato da '
  ];

  // Official Twitter / X "Promoted" diagonal arrow-in-rounded-square SVG path prefixes
  const PROMOTED_SVG_PATHS = [
    'M19.498 3h-15',
    'M20.75 2H3.25'
  ];

  const STYLE_ID = 'abp-twitter-cosmetic';

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
      .replace(/[\u200B-\u200D\uFEFF\u034F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '') // strip zero-width & bidi marks
      .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // strip Arabic diacritics & tatweel
      .replace(/^[·•∙⋅|\-\s]+|[·•∙⋅|\-\s]+$/g, '') // strip leading/trailing separator dots
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isExactPromotedLabel(text) {
    const clean = normalizeText(text);
    return EXACT_PROMOTED_LABELS.has(clean);
  }

  function isPromotedByLabel(text) {
    const clean = normalizeText(text);
    if (!clean || clean.length < 8 || clean.length > 60) return false;
    for (let i = 0; i < PROMOTED_BY_PREFIXES.length; i++) {
      const prefix = PROMOTED_BY_PREFIXES[i];
      if (clean.indexOf(prefix) === 0 && clean.length > prefix.length) {
        return true;
      }
    }
    return false;
  }

  function isPromotedTweet(article) {
    if (!article) return false;

    // 0. MAIN-world React Fiber / GraphQL marker
    if (typeof article.getAttribute === 'function' && article.getAttribute('data-abp-x-promoted') === 'true') {
      return true;
    }
    if (typeof article.querySelector === 'function' && article.querySelector('[data-abp-x-promoted="true"]')) {
      return true;
    }

    // 1. Official Twitter Ads Link & Click-Tracking (twclid)
    const adLinks = article.querySelectorAll(
      'a[href*="twclid="], ' +
      'a[href*="ads.twitter.com"], ' +
      'a[href*="ads.x.com"], ' +
      'a[href*="business.twitter.com"][href*="ads"], ' +
      'a[href*="business.x.com"][href*="ads"], ' +
      'a[href*="/about-this-ad"], ' +
      'a[href*="help.twitter.com/using-x/x-ads-faqs"], ' +
      'a[href*="help.x.com/using-x/x-ads-faqs"], ' +
      'a[href*="help.twitter.com/using-twitter/how-twitter-ads-work"], ' +
      'a[href*="help.x.com/using-twitter/how-twitter-ads-work"], ' +
      'a[href*="business.twitter.com/en/help/troubleshooting/how-twitter-ads-work"]'
    );
    for (let i = 0; i < adLinks.length; i++) {
      // Ensure it is not an organic tweet mentioning a link in tweetText
      if (!adLinks[i].closest('[data-testid="tweetText"]')) {
        return true;
      }
    }

    // 2. Dedicated Promoted badge / disclaimer inspection
    // CRITICAL: We strictly EXCLUDE the tweet body, user name, and link previews!
    const candidateBadges = article.querySelectorAll(
      'span:not([data-testid="tweetText"] *):not([data-testid="User-Name"] *):not([data-testid="card.wrapper"] *), ' +
      'div[dir="auto"]:not([data-testid="tweetText"] *):not([data-testid="User-Name"] *):not([data-testid="card.wrapper"] *), ' +
      'div[dir="ltr"]:not([data-testid="tweetText"] *):not([data-testid="User-Name"] *):not([data-testid="card.wrapper"] *), ' +
      'div[dir="rtl"]:not([data-testid="tweetText"] *):not([data-testid="User-Name"] *):not([data-testid="card.wrapper"] *)'
    );

    for (let j = 0; j < candidateBadges.length; j++) {
      const el = candidateBadges[j];

      // Double-check ancestor isolation to prevent ANY false positives in tweet body or handle
      if (
        el.closest('[data-testid="tweetText"]') ||
        el.closest('[data-testid="User-Name"]') ||
        el.closest('[data-testid="card.wrapper"]') ||
        el.closest('[data-testid="tweetPhoto"]') ||
        el.closest('[data-testid="videoPlayer"]') ||
        el.closest('[role="group"]')
      ) {
        continue;
      }

      const txt = el.textContent || '';
      // Ad labels on X are short, standalone badges or "Promoted by <Advertiser>" disclosures
      if (txt.length >= 2 && txt.length <= 25) {
        if (isExactPromotedLabel(txt)) {
          return true;
        }
      }
      if (txt.length >= 8 && txt.length <= 60) {
        if (isPromotedByLabel(txt)) {
          return true;
        }
      }

      const aria = el.getAttribute('aria-label') || '';
      if (aria.length >= 2 && aria.length <= 25) {
        if (isExactPromotedLabel(aria)) {
          return true;
        }
      }
      if (aria.length >= 8 && aria.length <= 60) {
        if (isPromotedByLabel(aria)) {
          return true;
        }
      }
    }

    // 3. SVG with promoted icon (megaphone / arrow-in-box ad badge)
    const svgs = article.querySelectorAll('svg');
    for (let s = 0; s < svgs.length; s++) {
      const svg = svgs[s];
      if (svg.closest('[data-testid="tweetText"]')) continue;

      const title = svg.querySelector ? svg.querySelector('title') : null;
      if (title && (isExactPromotedLabel(title.textContent) || isPromotedByLabel(title.textContent))) {
        return true;
      }
      const svgAria = svg.getAttribute ? svg.getAttribute('aria-label') : '';
      if (svgAria && (isExactPromotedLabel(svgAria) || isPromotedByLabel(svgAria))) {
        return true;
      }
      const paths = svg.querySelectorAll ? svg.querySelectorAll('path') : [];
      for (let p = 0; p < paths.length; p++) {
        const d = paths[p].getAttribute ? (paths[p].getAttribute('d') || '') : '';
        for (let k = 0; k < PROMOTED_SVG_PATHS.length; k++) {
          if (d.indexOf(PROMOTED_SVG_PATHS[k]) === 0) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function ensureTwitterStylesheet() {
    if (typeof document === 'undefined' || !document.createElement) return;
    if (document.getElementById && document.getElementById(STYLE_ID)) return;
    const root = document.documentElement || document.head || document.body;
    if (!root) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '[data-abp-blocked="true"] { display: none !important; }\n' +
      '[data-testid="cellInnerDiv"][data-abp-collapsed="true"] {\n' +
      '  height: 0px !important;\n' +
      '  min-height: 0px !important;\n' +
      '  max-height: 0px !important;\n' +
      '  overflow: hidden !important;\n' +
      '  padding: 0px !important;\n' +
      '  margin: 0px !important;\n' +
      '  border: 0px !important;\n' +
      '  opacity: 0 !important;\n' +
      '  pointer-events: none !important;\n' +
      '}';
    root.appendChild(style);
  }

  function collapseCell(cell) {
    if (!cell) return;
    cell.dataset.abpCollapsed = 'true';
    cell.style.setProperty('height', '0px', 'important');
    cell.style.setProperty('min-height', '0px', 'important');
    cell.style.setProperty('max-height', '0px', 'important');
    cell.style.setProperty('overflow', 'hidden', 'important');
    cell.style.setProperty('padding', '0px', 'important');
    cell.style.setProperty('margin', '0px', 'important');
    cell.style.setProperty('border', '0px', 'important');
  }

  function uncollapseCell(cell) {
    if (!cell) return;
    cell.style.removeProperty('height');
    cell.style.removeProperty('min-height');
    cell.style.removeProperty('max-height');
    cell.style.removeProperty('overflow');
    cell.style.removeProperty('padding');
    cell.style.removeProperty('margin');
    cell.style.removeProperty('border');
    cell.removeAttribute('data-abp-collapsed');
  }

  function reportBlocked(count) {
    try {
      const p = chrome.runtime.sendMessage({ type: 'adBlocked', count: count || 1 });
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (_) {}
  }

  function sweepTwitterAds() {
    if (!enabled) return;
    try {
      ensureTwitterStylesheet();

      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      for (let i = 0; i < articles.length; i++) {
        const article = articles[i];
        const cell = article.closest('[data-testid="cellInnerDiv"]');

        if (article.dataset.abpBlocked === 'true') {
          if (cell && cell.dataset.abpCollapsed !== 'true') collapseCell(cell);
          continue;
        }

        if (isPromotedTweet(article)) {
          article.dataset.abpBlocked = 'true';
          article.style.setProperty('display', 'none', 'important');
          if (cell) collapseCell(cell);
          reportBlocked(1);
        } else if (cell && cell.dataset.abpCollapsed === 'true') {
          // Virtual scroller recycled a collapsed cell for an organic tweet
          uncollapseCell(cell);
        }
      }

      // Sidebar promoted trends & who to follow
      const trends = document.querySelectorAll('[data-testid="trend"], [data-testid="UserCell"]');
      for (let j = 0; j < trends.length; j++) {
        const item = trends[j];
        if (item.dataset.abpBlocked === 'true') continue;
        if (isPromotedTweet(item)) {
          item.dataset.abpBlocked = 'true';
          item.style.setProperty('display', 'none', 'important');
          const cell = item.closest('[data-testid="cellInnerDiv"]');
          if (cell && !cell.querySelector('article[data-testid="tweet"]')) {
            collapseCell(cell);
          }
          reportBlocked(1);
        }
      }

      // Non-article promoted timeline cells (promoted carousels, hero takeovers, ad modules)
      const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
      for (let c = 0; c < cells.length; c++) {
        const cell = cells[c];
        if (cell.dataset.abpCollapsed === 'true') continue;
        if (cell.querySelector('article[data-testid="tweet"]')) continue;
        if (isPromotedTweet(cell)) {
          cell.dataset.abpBlocked = 'true';
          collapseCell(cell);
          reportBlocked(1);
        }
      }
    } catch (_) {}
  }

  function restoreTwitterAds() {
    try {
      const styleEl = document.getElementById && document.getElementById(STYLE_ID);
      if (styleEl) styleEl.remove();

      if (typeof document !== 'undefined' && typeof CustomEvent === 'function' && document.dispatchEvent) {
        try { document.dispatchEvent(new CustomEvent('__abpTwitterMainStop')); } catch (_) {}
      }

      const blocked = document.querySelectorAll('[data-abp-blocked="true"]');
      for (let i = 0; i < blocked.length; i++) {
        blocked[i].style.removeProperty('display');
        blocked[i].removeAttribute('data-abp-blocked');
      }
      const collapsed = document.querySelectorAll('[data-abp-collapsed="true"]');
      for (let j = 0; j < collapsed.length; j++) {
        uncollapseCell(collapsed[j]);
      }
      const checked = document.querySelectorAll('[data-abp-checked="true"]');
      for (let k = 0; k < checked.length; k++) checked[k].removeAttribute('data-abp-checked');
    } catch (_) {}
  }

  let sweepScheduled = false;
  function scheduleSweep() {
    if (!enabled || sweepScheduled) return;
    sweepScheduled = true;
    const run = () => {
      sweepScheduled = false;
      sweepTwitterAds();
    };
    if (typeof requestAnimationFrame === 'function' && typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
      requestAnimationFrame(run);
    } else {
      setTimeout(run, 40);
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
    else {
      ensureTwitterStylesheet();
      sweepTwitterAds();
    }
  }

  function loadSettings() {
    try {
      chrome.storage.local.get(['adBlock', 'twitterBlock', 'whitelist'], applySettings);
    } catch (_) {
      applySettings({});
    }
  }

  let observer = null;
  function attachObserver() {
    if (observer || typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
    const root = document.documentElement || document.body;
    if (!root) return;
    observer = new MutationObserver((mutations) => {
      if (!enabled) return;
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if ((m.addedNodes && m.addedNodes.length > 0) || m.type === 'characterData' || m.type === 'attributes') {
          scheduleSweep();
          break;
        }
      }
    });
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-abp-x-promoted']
    });
  }

  function init() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    loadSettings();
    attachObserver();

    if (!document.body) {
      document.addEventListener('DOMContentLoaded', () => {
        attachObserver();
        if (enabled) sweepTwitterAds();
      }, { once: true });
    }

    if (document.addEventListener) {
      document.addEventListener('__abpTwitterBlocked', function (e) {
        if (!enabled) return;
        const count = e && e.detail && typeof e.detail.count === 'number' ? e.detail.count : 1;
        if (count > 0) reportBlocked(count);
      });
    }

    try {
      chrome.storage.onChanged.addListener(function (changes, areaName) {
        if (areaName !== 'local') return;
        if (changes.adBlock || changes.twitterBlock || changes.whitelist) loadSettings();
      });
    } catch (_) {}
  }

  // Export for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      isExactPromotedLabel,
      isPromotedByLabel,
      isPromotedTweet,
      EXACT_PROMOTED_LABELS,
      PROMOTED_BY_PREFIXES
    };
  } else {
    init();
  }
})();

importScripts("filters.js");

const DEFAULTS = {
  adBlock: true,
  strictTracking: true,
  antiAdblock: false,
  mouseUnlock: false,

  // ---- Facebook module ----
  fbSponsored: true,
  fbSuggested: false,
  fbReels: false,
  fbSidebar: true,
  fbDebug: false,

  // ---- YouTube module ----
  ytSkip: true,
  ytHide: true,
  ytCurtain: true,

  // ---- Twitter / X module ----
  twitterBlock: true,

  // ---- Instagram module ----
  igSponsored: true,

  // ---- Filter lists ----
  useFilterLists: true,
  filterLists: ["arabic", "easylist", "adguard-base"],
  filterReport: null,
  cosmeticCss: [],

  totalBlocked: 0,
  todayBlocked: 0,
  lastBlockedDate: "",

  whitelist: [
    "odoo.com",
    "shopify.com",
    "salla.sa",
    "paypal.com",
    "stripe.com"
  ]
};

const AD_RULESET_IDS = ["ublock-filters", "easylist", "pgl", "ads"];
const STRICT_TRACKING_RULESET_IDS = ["easyprivacy", "tracking"];
const WHITELIST_RULE_BASE = 900000;
const WHITELIST_RULE_LIMIT = 2000;

function normalizeDomain(value) {
  if (!value || typeof value !== "string") return "";
  let raw = value.trim().toLowerCase();
  if (!raw) return "";
  raw = raw.replace(/^\*\./, "").replace(/^\.+/, "");
  try {
    const parsed = raw.includes("://") ? new URL(raw) : new URL("http://" + raw);
    const host = (parsed.hostname || "").replace(/^\.+|\.+$/g, "").toLowerCase();
    if (!host || host.includes(" ")) return "";
    return host;
  } catch (_) {
    return "";
  }
}

function normalizeWhitelist(list) {
  const input = Array.isArray(list) ? list : [];
  const out = [];
  const seen = new Set();
  for (const item of input) {
    const domain = normalizeDomain(item);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push(domain);
    if (out.length >= WHITELIST_RULE_LIMIT) break;
  }
  return out;
}

function isWhitelisted(hostname, whitelist) {
  const host = normalizeDomain(hostname);
  if (!host || !Array.isArray(whitelist)) return false;
  const parts = host.split(".");
  for (let i = 0; i < parts.length; i++) {
    const domain = parts.slice(i).join(".");
    if (whitelist.indexOf(domain) !== -1) return true;
  }
  return false;
}

const SETTING_KEYS = Object.keys(DEFAULTS);

// Settings are exactly the DEFAULTS keys. Storage also holds one
// "cf:<domain>" entry per site for site-specific hiding (about 20,000,
// ~2.5 MB), which must never be read, rewritten or sent as "settings".
function readSettings() {
  return chrome.storage.local.get(SETTING_KEYS);
}

function mergedSettings(data) {
  const out = {};
  for (const key of SETTING_KEYS) {
    out[key] = data && data[key] !== undefined ? data[key] : DEFAULTS[key];
  }
  out.whitelist = normalizeWhitelist(out.whitelist);
  return out;
}

function buildExcludeMatches(whitelist) {
  const matches = [];
  for (const domain of normalizeWhitelist(whitelist)) {
    matches.push("*://" + domain + "/*");
    const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(domain);
    const ipv6 = domain.includes(":");
    if (domain !== "localhost" && !ipv4 && !ipv6 && domain.includes(".")) {
      matches.push("*://*." + domain + "/*");
    }
  }
  return matches;
}

async function replaceRegisteredScript(id, enabled, registration) {
  if (!chrome.scripting) return;
  let existing = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  } catch (_) {}

  if (!enabled) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
    return;
  }

  const desired = Object.assign({ id, persistAcrossSessions: true }, registration);
  if (existing.length) {
    await chrome.scripting.updateContentScripts([desired]);
  } else {
    await chrome.scripting.registerContentScripts([desired]);
  }
}

async function syncRegisteredScripts(settings) {
  if (!chrome.scripting) return;
  const wl = normalizeWhitelist(settings.whitelist);
  const excludeMatches = buildExcludeMatches(wl);

  await replaceRegisteredScript(
    "anti-adblock-script",
    settings.antiAdblock === true,
    {
      matches: ["<all_urls>"],
      excludeMatches,
      js: ["inject.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
      matchOriginAsFallback: true
    }
  );

  await replaceRegisteredScript(
    "youtube-main-script",
    settings.adBlock !== false && settings.ytSkip !== false,
    {
      matches: ["*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"],
      excludeMatches,
      js: ["youtube-sanitizer.js", "youtube-main.js"],
      runAt: "document_start",
      world: "MAIN",
      allFrames: true,
      matchOriginAsFallback: true
    }
  );
}

async function syncWhitelistRules(whitelist) {
  const wl = normalizeWhitelist(whitelist);
  const current = await chrome.declarativeNetRequest.getSessionRules();
  const removeRuleIds = current
    .filter((rule) => rule.id >= WHITELIST_RULE_BASE && rule.id < WHITELIST_RULE_BASE + WHITELIST_RULE_LIMIT)
    .map((rule) => rule.id);

  const addRules = wl.map((domain, index) => ({
    id: WHITELIST_RULE_BASE + index,
    priority: 1000000,
    action: { type: "allowAllRequests" },
    condition: {
      requestDomains: [domain],
      resourceTypes: ["main_frame", "sub_frame"]
    }
  }));

  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds, addRules });
}

async function syncStaticRulesets(settings) {
  const enableRulesetIds = [];
  const disableRulesetIds = [];

  if (settings.adBlock !== false) enableRulesetIds.push(...AD_RULESET_IDS);
  else disableRulesetIds.push(...AD_RULESET_IDS);

  if (settings.strictTracking === true) enableRulesetIds.push(...STRICT_TRACKING_RULESET_IDS);
  else disableRulesetIds.push(...STRICT_TRACKING_RULESET_IDS);

  await chrome.declarativeNetRequest.updateEnabledRulesets({
    enableRulesetIds,
    disableRulesetIds
  });
}

async function syncRuntimeState(settings) {
  await Promise.all([
    syncStaticRulesets(settings),
    syncWhitelistRules(settings.whitelist),
    syncRegisteredScripts(settings)
  ]);
}

/* ---------------------------------------------------------------- *
 * Filter lists                                                      *
 * ---------------------------------------------------------------- */

let rebuilding = false;

async function rebuildFilters(notify) {
  if (rebuilding) return { ok: false, error: "already running" };
  rebuilding = true;
  try {
    const current = mergedSettings(await readSettings());
    if (current.adBlock === false || current.useFilterLists === false) {
      return { ok: false, error: "filter lists are disabled" };
    }

    const report = await FILTERS.rebuild(function (msg) {
      if (notify) {
        try {
          chrome.runtime.sendMessage({ type: "filterProgress", msg }).catch(function () {});
        } catch (_) {}
      }
    });
    return { ok: report.installOk !== false, report, error: report.error || undefined };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    rebuilding = false;
  }
}

async function syncDynamicFilters(settings, forceRebuild) {
  if (settings.adBlock === false || settings.useFilterLists === false) {
    await FILTERS.clear();
    return;
  }

  if (forceRebuild) {
    await rebuildFilters(false);
  }
}

// Created only when missing. chrome.alarms.create() replaces an existing alarm
// of the same name, and this runs on every service-worker start (a blocked
// ad, a tab switch...), so recreating it kept pushing the first refresh an
// hour away and the daily refresh never ran for an active user.
try {
  chrome.alarms.get("filterRefresh", function (existing) {
    if (!existing) chrome.alarms.create("filterRefresh", { periodInMinutes: 24 * 60, delayInMinutes: 60 });
  });
} catch (_) {}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== "filterRefresh") return;
  readSettings().then(function (data) {
    const settings = mergedSettings(data);
    if (settings.adBlock !== false && settings.useFilterLists !== false) rebuildFilters(false);
  }).catch(function () {});
});

async function initializeExtension(existing) {
  const settings = mergedSettings(existing);
  await chrome.storage.local.set(settings); // DEFAULTS keys only (see mergedSettings)
  await syncRuntimeState(settings);

  // Also rebuild when the last report predates site-specific hiding, so an
  // update takes effect now instead of at the next daily refresh.
  const report = settings.filterReport;
  if (settings.adBlock !== false && settings.useFilterLists !== false && (!report || !report.siteCosmetics)) {
    await rebuildFilters(false);
  }
  return settings;
}

// Default changes that should reach existing installs once, not only new
// ones. Applied on update and recorded, so a user who later turns a feature
// back off keeps that choice.
const DEFAULTS_REVISION_KEY = "defaultsRevision";
const DEFAULTS_REVISION = 1;

function defaultsMigrationPatch(reason, stored) {
  if ((stored[DEFAULTS_REVISION_KEY] || 0) >= DEFAULTS_REVISION) return null;
  const patch = { [DEFAULTS_REVISION_KEY]: DEFAULTS_REVISION };
  if (reason === "update") {
    // Revision 1: tracking protection on, and AdGuard Base site-specific hiding.
    patch.strictTracking = true;
    const lists = Array.isArray(stored.filterLists) ? stored.filterLists.slice() : DEFAULTS.filterLists.slice();
    if (lists.indexOf("adguard-base") === -1) lists.push("adguard-base");
    patch.filterLists = lists;
  }
  return patch;
}

/* ---------------------------------------------------------------- *
 * Right-click "Block this element"                                  *
 * ---------------------------------------------------------------- */

const BLOCK_MENU_ID = "abp-block-element";

// The picker never runs on the sites with dedicated modules (the same list
// the site-specific hiding skips): a saved element rule applied to
// Facebook's feed wrapper is what once blanked the whole feed.
function isBlockMenuExcluded(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return true;
    return FILTERS.isSiteCosmeticExcluded(u.hostname.toLowerCase());
  } catch (_) {
    return true;
  }
}

// Created on every service-worker start, not only on install: a reload from
// chrome://extensions or a browser restart must never leave the entry
// missing. removeAll() first keeps it to a single entry.
//
// The entry is always visible on web pages. Hiding it per tab (shown on
// ordinary sites, hidden on Facebook) depended on catching every tab switch
// and left it hidden: after a reload the active tab is chrome://extensions,
// so the entry was hidden straight away. Excluded sites are handled on click.
function installBlockMenu() {
  if (!chrome.contextMenus) return;
  let ar = false;
  try { ar = String(chrome.i18n.getUILanguage() || "").toLowerCase().startsWith("ar"); } catch (_) {}
  chrome.contextMenus.removeAll(function () {
    chrome.contextMenus.create({
      id: BLOCK_MENU_ID,
      title: ar ? "حجب هذا العنصر" : "Block this element",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"]
    }, function () { void chrome.runtime.lastError; });
  });
}

installBlockMenu();

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener(function (info, tab) {
    if (info.menuItemId !== BLOCK_MENU_ID || !tab || tab.id === undefined || tab.id < 0) return;
    const pageUrl = info.pageUrl || tab.url || "";
    let pageHost = "";
    try { pageHost = new URL(pageUrl).protocol.indexOf("http") === 0 ? new URL(pageUrl).hostname : ""; } catch (_) {}
    if (!pageHost) return; // not an ordinary web page
    const options = typeof info.frameId === "number" ? { frameId: info.frameId } : {};
    // Both the page and the right-clicked frame: an embedded Facebook widget
    // on another site is still Facebook. There the picker never starts; the
    // page only tells the user it is not available.
    const excluded = isBlockMenuExcluded(pageUrl) || (info.frameUrl && isBlockMenuExcluded(info.frameUrl));
    try {
      chrome.tabs.sendMessage(tab.id, { type: excluded ? "ABP_BLOCK_UNAVAILABLE" : "ABP_BLOCK_ELEMENT" }, options, function () {
        void chrome.runtime.lastError;
      });
    } catch (_) {}
  });
}

chrome.runtime.onInstalled.addListener(function (details) {
  const reason = details && details.reason;
  // Rules saved by earlier versions are no longer applied anywhere; drop them.
  chrome.storage.local.remove("customUserRules").catch(function () {}).then(function () {
    return chrome.storage.local.get(SETTING_KEYS.concat([DEFAULTS_REVISION_KEY]));
  }).then(async function (stored) {
    const patch = defaultsMigrationPatch(reason, stored);
    if (patch) {
      await chrome.storage.local.set(patch);
      Object.assign(stored, patch);
    }
    return initializeExtension(stored);
  }).catch(function (e) {
    console.warn("[AdBlockerPro] initialization failed:", e && e.message ? e.message : e);
  });
});

chrome.runtime.onStartup.addListener(function () {
  readSettings().then(function (data) {
    return syncRuntimeState(mergedSettings(data));
  }).catch(function (e) {
    console.warn("[AdBlockerPro] startup sync failed:", e && e.message ? e.message : e);
  });
});

/* Keep session whitelist rules and registered MAIN-world scripts correct after
 * a service-worker restart as well, not only after a full browser restart. */
readSettings().then(function (data) {
  return syncRuntimeState(mergedSettings(data));
}).catch(function () {});

/* Badge: live count of blocked items reported by page modules. */

// Per-tab running count for the badge. Modules either report their own
// running total for the page (facebook.js: `total`) or one item at a time
// (twitter.js / instagram.js: `count: 1`), so the badge keeps its own sum.
// In memory only: after a service-worker restart it resumes from the next
// report, which is fine for a badge.
const tabBlocked = new Map();

chrome.tabs.onUpdated.addListener(function (tabId, change) {
  if (change.status === "loading" && change.url) tabBlocked.delete(tabId);
});
chrome.tabs.onRemoved.addListener(function (tabId) {
  tabBlocked.delete(tabId);
});

function paintBadge(tabId, count) {
  if (tabId === undefined || tabId === null || tabId < 0) return;
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: count > 0 ? String(count) : "" }).catch(function () {});
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#e53935" }).catch(function () {});
  } catch (_) {}
}

async function applySettingsPatch(patch) {
  patch = patch && typeof patch === "object" ? patch : {};
  await chrome.storage.local.set(patch);
  const settings = mergedSettings(await readSettings());

  const runtimeKeys = ["adBlock", "strictTracking", "antiAdblock", "ytSkip", "whitelist"];
  if (runtimeKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key))) {
    await syncRuntimeState(settings);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "adBlock") ||
      Object.prototype.hasOwnProperty.call(patch, "useFilterLists")) {
    await syncDynamicFilters(settings, settings.adBlock !== false && settings.useFilterLists !== false);
  }

  return settings;
}

async function mutateWhitelist(mode, hostname) {
  const data = mergedSettings(await readSettings());
  const domain = normalizeDomain(hostname);
  let whitelist = normalizeWhitelist(data.whitelist);
  if (!domain) return whitelist;

  const idx = whitelist.indexOf(domain);
  if (mode === "toggle") {
    if (idx >= 0) whitelist.splice(idx, 1);
    else whitelist.push(domain);
  } else if (mode === "add" && idx < 0) {
    whitelist.push(domain);
  } else if (mode === "remove" && idx >= 0) {
    whitelist.splice(idx, 1);
  }

  whitelist = normalizeWhitelist(whitelist);
  await chrome.storage.local.set({ whitelist });
  const settings = mergedSettings(Object.assign({}, data, { whitelist }));
  await Promise.all([
    syncWhitelistRules(whitelist),
    syncRegisteredScripts(settings)
  ]);
  return whitelist;
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    case "abpBlocked":
    case "adBlocked": {
      // `added` is how many were newly blocked since the module's last
      // report; older single-item reports send `count: 1`. Adding a running
      // total here instead (as before) counted 1+2+3 = 6 for three ads.
      const tabId = sender.tab && sender.tab.id;
      const added = typeof msg.added === "number" ? msg.added : (msg.count || 1);
      const tabTotal = typeof msg.total === "number"
        ? msg.total
        : (tabBlocked.get(tabId) || 0) + Math.max(0, added);
      if (tabId !== undefined && tabId !== null) tabBlocked.set(tabId, tabTotal);
      paintBadge(tabId, tabTotal);
      if (added <= 0) return false; // e.g. a hidden reel given back

      const todayStr = new Date().toISOString().slice(0, 10);
      chrome.storage.local.get(["totalBlocked", "todayBlocked", "lastBlockedDate"], function (d) {
        const tot = ((d && d.totalBlocked) || 0) + added;
        const lastDate = (d && d.lastBlockedDate) || "";
        const tod = (lastDate === todayStr) ? (((d && d.todayBlocked) || 0) + added) : added;
        chrome.storage.local.set({ totalBlocked: tot, todayBlocked: tod, lastBlockedDate: todayStr });
      });
      return false;
    }

    case "getSettings":
      readSettings().then(function (data) {
        sendResponse(mergedSettings(data));
      }).catch(function () {
        sendResponse(mergedSettings(null));
      });
      return true;

    case "rebuildFilters":
      rebuildFilters(true).then(sendResponse).catch(function (e) {
        sendResponse({ ok: false, error: e.message });
      });
      return true;

    case "clearFilters":
      FILTERS.clear().then(function () { sendResponse({ ok: true }); })
                     .catch(function (e) { sendResponse({ ok: false, error: e.message }); });
      return true;

    case "filterCount":
      FILTERS.count().then(function (n) { sendResponse({ count: n }); })
                     .catch(function () { sendResponse({ count: 0 }); });
      return true;

    case "updateSettings":
      applySettingsPatch(msg.settings).then(function (settings) {
        sendResponse({ success: true, settings });
      }).catch(function (e) {
        sendResponse({ success: false, error: e.message });
      });
      return true;

    case "toggleWhitelist":
      mutateWhitelist("toggle", msg.hostname).then(function (whitelist) {
        sendResponse({ whitelist });
      }).catch(function (e) { sendResponse({ error: e.message }); });
      return true;

    case "addWhitelist":
      mutateWhitelist("add", msg.hostname).then(function (whitelist) {
        sendResponse({ whitelist });
      }).catch(function (e) { sendResponse({ error: e.message }); });
      return true;

    case "removeWhitelist":
      mutateWhitelist("remove", msg.hostname).then(function (whitelist) {
        sendResponse({ whitelist });
      }).catch(function (e) { sendResponse({ error: e.message }); });
      return true;
  }

  return false;
});

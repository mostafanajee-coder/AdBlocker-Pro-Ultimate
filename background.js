importScripts("filters.js");

const DEFAULTS = {
  adBlock: true,
  strictTracking: false,
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
  filterLists: ["arabic", "easylist"],
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

function mergedSettings(data) {
  const out = Object.assign({}, DEFAULTS, data || {});
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
    const current = mergedSettings(await chrome.storage.local.get(null));
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

try {
  chrome.alarms.create("filterRefresh", { periodInMinutes: 24 * 60, delayInMinutes: 60 });
} catch (_) {}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== "filterRefresh") return;
  chrome.storage.local.get(null).then(function (data) {
    const settings = mergedSettings(data);
    if (settings.adBlock !== false && settings.useFilterLists !== false) rebuildFilters(false);
  }).catch(function () {});
});

async function initializeExtension(existing) {
  const settings = mergedSettings(existing);
  await chrome.storage.local.set(settings);
  await syncRuntimeState(settings);

  if (settings.adBlock !== false && settings.useFilterLists !== false && !settings.filterReport) {
    await rebuildFilters(false);
  }
  return settings;
}

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get(null).then(initializeExtension).catch(function (e) {
    console.warn("[AdBlockerPro] initialization failed:", e && e.message ? e.message : e);
  });
});

chrome.runtime.onStartup.addListener(function () {
  chrome.storage.local.get(null).then(function (data) {
    return syncRuntimeState(mergedSettings(data));
  }).catch(function (e) {
    console.warn("[AdBlockerPro] startup sync failed:", e && e.message ? e.message : e);
  });
});

/* Keep session whitelist rules and registered MAIN-world scripts correct after
 * a service-worker restart as well, not only after a full browser restart. */
chrome.storage.local.get(null).then(function (data) {
  return syncRuntimeState(mergedSettings(data));
}).catch(function () {});

/* Badge: live count of blocked items reported by page modules. */
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
  const settings = mergedSettings(await chrome.storage.local.get(null));

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
  const data = mergedSettings(await chrome.storage.local.get(null));
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
      paintBadge(sender.tab && sender.tab.id, msg.count);
      const todayStr = new Date().toISOString().slice(0, 10);
      chrome.storage.local.get(["totalBlocked", "todayBlocked", "lastBlockedDate"], function (d) {
        const tot = ((d && d.totalBlocked) || 0) + (msg.count || 1);
        const lastDate = (d && d.lastBlockedDate) || "";
        const tod = (lastDate === todayStr) ? (((d && d.todayBlocked) || 0) + (msg.count || 1)) : (msg.count || 1);
        chrome.storage.local.set({ totalBlocked: tot, todayBlocked: tod, lastBlockedDate: todayStr });
      });
      return false;
    }

    case "getSettings":
      chrome.storage.local.get(null).then(function (data) {
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

    case "clearCustomRules":
      chrome.storage.local.remove("customUserRules", function () {
        sendResponse({ ok: true });
      });
      return true;
  }

  return false;
});

importScripts("filters.js");

const DEFAULTS = {
  adBlock: true,
  strictTracking: false,
  antiAdblock: false,
  mouseUnlock: false,

  // ---- Facebook module ----
  fbSponsored: true,    // hide sponsored posts
  fbSuggested: false,   // hide "Suggested for you"
  fbReels: false,       // hide the Reels shelf
  fbSidebar: true,      // hide right-rail sponsored column
  fbDebug: false,       // outline instead of hide (testing)

  // ---- YouTube module ----
  ytSkip: true,         // auto-skip in-player ads
  ytHide: true,         // hide static ad slots
  ytCurtain: true,      // opaque cover over the player while an ad plays

  // ---- Twitter / X module ----
  twitterBlock: true,   // auto-hide promoted tweets and ads

  // ---- Filter lists ----
  useFilterLists: true,
  filterLists: ["easylist", "easyprivacy", "arabic"],
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

function isWhitelisted(hostname, whitelist) {
  if (!hostname || !whitelist) return false;
  const parts = hostname.split(".");
  for (let i = 0; i < parts.length - 1; i++) {
    const domain = parts.slice(i).join(".");
    if (whitelist.indexOf(domain) !== -1) return true;
  }
  return false;
}

function updateDynamicInjection(settings) {
  if (!chrome.scripting) return;
  try {
    chrome.scripting.getRegisteredContentScripts({ ids: ["anti-adblock-script"] }).then(function (scripts) {
      if (scripts && scripts.length > 0) {
        return chrome.scripting.unregisterContentScripts({ ids: ["anti-adblock-script"] });
      }
    }).catch(function () {}).then(function () {
      if (!settings || !settings.antiAdblock) return;

      var excludeMatches = [];
      var wl = settings.whitelist || [];
      for (var i = 0; i < wl.length; i++) {
        var d = wl[i];
        if (d) {
          excludeMatches.push("*://" + d + "/*");
          excludeMatches.push("*://*." + d + "/*");
        }
      }

      chrome.scripting.registerContentScripts([{
        id: "anti-adblock-script",
        matches: ["<all_urls>"],
        excludeMatches: excludeMatches,
        js: ["inject.js"],
        runAt: "document_start",
        world: "MAIN",
        allFrames: true
      }]).catch(function () {});
    }).catch(function () {});
  } catch (_) {}
}

/* ---------------------------------------------------------------- *
 * Filter lists                                                      *
 * ---------------------------------------------------------------- */

let rebuilding = false;

async function rebuildFilters(notify) {
  if (rebuilding) return { ok: false, error: "already running" };
  rebuilding = true;
  try {
    const report = await FILTERS.rebuild(function (msg) {
      if (notify) {
        try {
          chrome.runtime.sendMessage({ type: "filterProgress", msg }).catch(function () {});
        } catch (_) {}
      }
    });
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    rebuilding = false;
  }
}

/* Refresh once a day, the way real filter lists expect. */
try {
  chrome.alarms.create("filterRefresh", { periodInMinutes: 24 * 60, delayInMinutes: 60 });
} catch (_) {}

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name !== "filterRefresh") return;
  chrome.storage.local.get(["useFilterLists"], function (d) {
    if (d && d.useFilterLists !== false) rebuildFilters(false);
  });
});

chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.get(null, function (existing) {
    const settings = {};
    for (const key of Object.keys(DEFAULTS)) {
      settings[key] = (existing && existing[key] !== undefined) ? existing[key] : DEFAULTS[key];
    }
    chrome.storage.local.set(settings, function () {
      updateDynamicInjection(settings);
      if (settings.useFilterLists !== false && (!existing || !existing.filterReport)) {
        rebuildFilters(false);
      }
    });
  });
});

/* Badge: live count of items the Facebook module removed in this tab. */
function paintBadge(tabId, count) {
  if (tabId === undefined || tabId === null || tabId < 0) return;
  try {
    chrome.action.setBadgeText({ tabId: tabId, text: count > 0 ? String(count) : "" }).catch(function () {});
    chrome.action.setBadgeBackgroundColor({ tabId: tabId, color: "#e53935" }).catch(function () {});
  } catch (_) {}
}

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || !msg.type) return false;

  switch (msg.type) {
    case "abpBlocked":
    case "adBlocked":
      paintBadge(sender.tab && sender.tab.id, msg.count);
      var todayStr = new Date().toISOString().slice(0, 10);
      chrome.storage.local.get(["totalBlocked", "todayBlocked", "lastBlockedDate"], function (d) {
        var tot = ((d && d.totalBlocked) || 0) + (msg.count || 1);
        var lastDate = (d && d.lastBlockedDate) || "";
        var tod = (lastDate === todayStr) ? (((d && d.todayBlocked) || 0) + (msg.count || 1)) : (msg.count || 1);
        chrome.storage.local.set({
          totalBlocked: tot,
          todayBlocked: tod,
          lastBlockedDate: todayStr
        });
      });
      return false;

    case "getSettings":
      chrome.storage.local.get(null, function (data) {
        sendResponse(data || DEFAULTS);
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
      chrome.storage.local.set(msg.settings, function () {
        if (msg.settings && msg.settings.strictTracking !== undefined) {
          const enable = msg.settings.strictTracking === true;
          try {
            chrome.declarativeNetRequest.updateEnabledRulesets({
              enableRulesetIds: enable ? ["tracking"] : [],
              disableRulesetIds: enable ? [] : ["tracking"]
            }).catch(function () {});
          } catch (_) {}
        }
        chrome.storage.local.get(["antiAdblock", "whitelist"], function (data) {
          updateDynamicInjection(data);
        });
        sendResponse({ success: true });
      });
      return true;

    case "toggleWhitelist":
      chrome.storage.local.get(["whitelist", "antiAdblock"], function (data) {
        let whitelist = (data && data.whitelist) || DEFAULTS.whitelist;
        const idx = whitelist.indexOf(msg.hostname);
        if (idx !== -1) {
          whitelist.splice(idx, 1);
        } else {
          whitelist.push(msg.hostname);
        }
        chrome.storage.local.set({ whitelist: whitelist }, function () {
          updateDynamicInjection({ antiAdblock: (data && data.antiAdblock), whitelist: whitelist });
          sendResponse({ whitelist: whitelist });
        });
      });
      return true;

    case "addWhitelist":
      chrome.storage.local.get(["whitelist", "antiAdblock"], function (data) {
        let whitelist = (data && data.whitelist) || DEFAULTS.whitelist;
        if (msg.hostname && whitelist.indexOf(msg.hostname) === -1) {
          whitelist.push(msg.hostname);
        }
        chrome.storage.local.set({ whitelist: whitelist }, function () {
          updateDynamicInjection({ antiAdblock: (data && data.antiAdblock), whitelist: whitelist });
          sendResponse({ whitelist: whitelist });
        });
      });
      return true;

    case "removeWhitelist":
      chrome.storage.local.get(["whitelist", "antiAdblock"], function (data) {
        let whitelist = (data && data.whitelist) || DEFAULTS.whitelist;
        const idx = whitelist.indexOf(msg.hostname);
        if (idx !== -1) {
          whitelist.splice(idx, 1);
        }
        chrome.storage.local.set({ whitelist: whitelist }, function () {
          updateDynamicInjection({ antiAdblock: (data && data.antiAdblock), whitelist: whitelist });
          sendResponse({ whitelist: whitelist });
        });
      });
      return true;

    case "clearCustomRules":
      chrome.storage.local.remove("customUserRules", function () {
        sendResponse({ ok: true });
      });
      return true;
  }
});

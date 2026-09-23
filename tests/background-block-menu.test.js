/*
 * background-block-menu.test.js
 *
 * Runs the real background.js (with the real filters.js) against a chrome.*
 * stub to check the right-click "Block this element" entry: it is offered on
 * ordinary sites and never on Facebook, Instagram, YouTube or X — not in the
 * menu, and not through a click that slipped past a stale menu state.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const BACKGROUND = fs.readFileSync(path.join(ROOT, "background.js"), "utf8");

let passed = 0;
let failed = 0;
function check(cond, name) {
  if (cond) { passed++; console.log("  PASS ", name); }
  else { failed++; console.error("  FAIL ", name); }
}

function listeners() {
  const fns = [];
  return { addListener: (f) => fns.push(f), fire: (...args) => fns.forEach((f) => f(...args)) };
}

const created = [];
const updates = [];
const sent = [];
let activeUrl = "https://example.com/";

const chrome = {
  runtime: {
    onInstalled: listeners(),
    onStartup: listeners(),
    onMessage: listeners(),
    sendMessage: () => Promise.resolve(),
    lastError: undefined
  },
  i18n: { getUILanguage: () => "en-US" },
  alarms: { create() {}, onAlarm: listeners() },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {}
    }
  },
  declarativeNetRequest: {
    getSessionRules: async () => [],
    updateSessionRules: async () => {},
    updateEnabledRulesets: async () => {},
    getDynamicRules: async () => [],
    updateDynamicRules: async () => {}
  },
  action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
  contextMenus: {
    removeAll: (cb) => cb && cb(),
    create: (item, cb) => { created.push(item); if (cb) cb(); },
    update: (id, props, cb) => { updates.push({ id, visible: props.visible }); if (cb) cb(); },
    onClicked: listeners()
  },
  tabs: {
    query: (q, cb) => cb([{ id: 5, active: true, url: activeUrl }]),
    onActivated: listeners(),
    onUpdated: listeners(),
    sendMessage: (tabId, msg, opts, cb) => { sent.push({ tabId, msg, opts }); if (cb) cb(); }
  },
  windows: { onFocusChanged: listeners() }
};

const context = vm.createContext({
  chrome, console, setTimeout, URL, Promise, Object, Array, Set, Map, Math, Date, JSON, Error,
  TextEncoder, crypto: require("crypto").webcrypto
});
context.importScripts = (file) => vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), context, { filename: file });
context.self = context;
vm.runInContext(BACKGROUND, context, { filename: "background.js" });

function lastVisibility() { return updates.length ? updates[updates.length - 1].visible : undefined; }
function activate(url) { activeUrl = url; chrome.tabs.onActivated.fire({ tabId: 5 }); }
function click(info) { sent.length = 0; chrome.contextMenus.onClicked.fire(Object.assign({ menuItemId: "abp-block-element" }, info), { id: 5, url: info.pageUrl }); return sent.length; }

console.log("\nRight-click entry\n-----------------");
chrome.runtime.onInstalled.fire({ reason: "update" });
const item = created.find((c) => c.id === "abp-block-element");
check(item && item.title === "Block this element", "the entry is created on install/update");
check(item && JSON.stringify(item.documentUrlPatterns) === JSON.stringify(["http://*/*", "https://*/*"]), "it is limited to ordinary web pages");

activate("https://www.facebook.com/");
check(lastVisibility() === false, "hidden while the active tab is Facebook");
activate("https://news.example.org/story");
check(lastVisibility() === true, "shown again on an ordinary site");
activate("https://www.youtube.com/watch?v=1");
check(lastVisibility() === false, "hidden on YouTube");
activate("https://business.instagram.com/");
check(lastVisibility() === false, "hidden on an Instagram subdomain");
activate("https://notfacebook.com/");
check(lastVisibility() === true, "not fooled by a look-alike domain");

chrome.tabs.onUpdated.fire(5, { url: "https://m.facebook.com/home" }, { id: 5, active: true });
check(lastVisibility() === false, "hidden when the active tab navigates to Facebook");

console.log("\nClicks\n------");
check(click({ pageUrl: "https://example.com/a", frameId: 0 }) === 1, "a click on an ordinary site asks that page to block the element");
check(sent.length === 1 && sent[0].opts.frameId === 0 && sent[0].msg.type === "ABP_BLOCK_ELEMENT", "the request goes to the frame that was right-clicked");
check(click({ pageUrl: "https://www.facebook.com/", frameId: 0 }) === 0, "a click that slipped past a stale menu on Facebook does nothing");
check(click({ pageUrl: "https://example.com/", frameUrl: "https://www.facebook.com/plugins/like.php", frameId: 3 }) === 0, "a Facebook widget embedded in another site is left alone too");
check(click({ pageUrl: "chrome://settings/", frameId: 0 }) === 0, "browser pages are ignored");
check(click({ pageUrl: "https://example.com/", menuItemId: "something-else", frameId: 0 }) === 0, "other menu entries are ignored");

console.log("\n" + "=".repeat(64));
console.log(`  Block menu: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));
if (failed) process.exit(1);

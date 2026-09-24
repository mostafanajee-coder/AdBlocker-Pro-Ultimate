/*
 * background-block-menu.test.js
 *
 * Runs the real background.js (with the real filters.js) against a chrome.*
 * stub to check the right-click "Block this element" entry: it always exists
 * once the service worker has started, and it never starts the element picker
 * on Facebook, Messenger, Instagram, YouTube or X — including a Facebook
 * widget embedded in another site. There it only asks the page to say that
 * blocking elements is not available.
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

// Menu items persist in the browser across service-worker restarts; the
// script's own state does not. \`menu\` models the browser side.
const menu = { items: new Map(), updates: [] };
const sent = [];

function startServiceWorker() {
  const chrome = {
    runtime: {
      onInstalled: listeners(),
      onStartup: listeners(),
      onMessage: listeners(),
      sendMessage: () => Promise.resolve(),
      lastError: undefined
    },
    i18n: { getUILanguage: () => "en-US" },
    alarms: { get: (name, cb) => cb(undefined), create() {}, onAlarm: listeners() },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    declarativeNetRequest: {
      getSessionRules: async () => [],
      updateSessionRules: async () => {},
      updateEnabledRulesets: async () => {},
      getDynamicRules: async () => [],
      updateDynamicRules: async () => {}
    },
    action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() },
    contextMenus: {
      removeAll: (cb) => { menu.items.clear(); if (cb) cb(); },
      create: (item, cb) => {
        if (menu.items.has(item.id)) chrome.runtime.lastError = { message: "duplicate id" };
        else menu.items.set(item.id, Object.assign({ visible: true }, item));
        if (cb) cb();
        chrome.runtime.lastError = undefined;
      },
      update: (id, props, cb) => { menu.updates.push({ id, props }); if (menu.items.has(id)) Object.assign(menu.items.get(id), props); if (cb) cb(); },
      onClicked: listeners()
    },
    tabs: {
      query: (q, cb) => cb([{ id: 5, active: true, url: "chrome://extensions/" }]),
      onActivated: listeners(),
      onUpdated: listeners(),
      onRemoved: listeners(),
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
  return chrome;
}

function click(chrome, info) {
  sent.length = 0;
  chrome.contextMenus.onClicked.fire(Object.assign({ menuItemId: "abp-block-element" }, info), { id: 5, url: info.pageUrl });
  return sent.slice();
}

console.log("\nThe entry exists\n----------------");
let chrome = startServiceWorker();
let item = menu.items.get("abp-block-element");
check(item && item.title === "Block this element", "created as soon as the service worker starts, without waiting for an install event");
check(item && JSON.stringify(item.documentUrlPatterns) === JSON.stringify(["http://*/*", "https://*/*"]), "limited to ordinary web pages");
check(item && item.visible !== false, "visible");

// Reloading from chrome://extensions leaves that page as the active tab: the
// entry must not end up hidden because of it.
chrome.runtime.onInstalled.fire({ reason: "update" });
chrome.tabs.onActivated.fire({ tabId: 5 });
chrome.windows.onFocusChanged.fire(1);
item = menu.items.get("abp-block-element");
check(item && item.visible !== false && !menu.updates.some((u) => u.props.visible === false), "never hidden by whichever tab happens to be active");

chrome = startServiceWorker(); // the browser restarts, or the worker wakes again
check(menu.items.size === 1 && menu.items.get("abp-block-element"), "still exactly one entry after the service worker starts again");

console.log("\nClicks\n------");
let out = click(chrome, { pageUrl: "https://example.com/a", frameId: 0 });
check(out.length === 1 && out[0].msg.type === "ABP_BLOCK_ELEMENT" && out[0].opts.frameId === 0, "on an ordinary site the right-clicked frame opens the picker");

out = click(chrome, { pageUrl: "https://www.facebook.com/", frameId: 0 });
check(out.length === 1 && out[0].msg.type === "ABP_BLOCK_UNAVAILABLE", "on Facebook the picker never opens; the page only says it is not available");
out = click(chrome, { pageUrl: "https://business.instagram.com/", frameId: 0 });
check(out.length === 1 && out[0].msg.type === "ABP_BLOCK_UNAVAILABLE", "the same on an Instagram subdomain");
out = click(chrome, { pageUrl: "https://example.com/", frameUrl: "https://www.facebook.com/plugins/like.php", frameId: 3 });
check(out.length === 1 && out[0].msg.type === "ABP_BLOCK_UNAVAILABLE" && out[0].opts.frameId === 3, "a Facebook widget embedded in another site does not open the picker either");
out = click(chrome, { pageUrl: "https://notfacebook.com/", frameId: 0 });
check(out.length === 1 && out[0].msg.type === "ABP_BLOCK_ELEMENT", "a look-alike domain is an ordinary site");
check(click(chrome, { pageUrl: "chrome://settings/", frameId: 0 }).length === 0, "browser pages are ignored");
check(click(chrome, { pageUrl: "https://example.com/", menuItemId: "something-else", frameId: 0 }).length === 0, "other menu entries are ignored");

console.log("\n" + "=".repeat(64));
console.log(`  Block menu: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));
if (failed) process.exit(1);

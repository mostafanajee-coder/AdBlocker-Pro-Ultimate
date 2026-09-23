/*
 * background-migration.test.js
 *
 * Runs the real background.js against an in-memory chrome.* stub and fires
 * onInstalled, to check how new defaults reach existing installs and that the
 * per-site hiding entries in storage are never rewritten as "settings".
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

let passed = 0;
let failed = 0;
function check(cond, name) {
  if (cond) { passed++; console.log("  PASS ", name); }
  else { failed++; console.error("  FAIL ", name); }
}

function boot(initialStore) {
  const store = JSON.parse(JSON.stringify(initialStore));
  const setKeys = [];
  const handlers = {};
  const rebuilds = [];
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

  const chrome = {
    runtime: {
      onInstalled: { addListener: (f) => { handlers.installed = f; } },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} },
      sendMessage: () => Promise.resolve()
    },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    storage: {
      local: {
        get: (keys) => {
          const out = {};
          const list = keys === null ? Object.keys(store) : [].concat(keys);
          for (const k of list) if (k in store) out[k] = clone(store[k]);
          return Promise.resolve(out);
        },
        set: (obj) => { setKeys.push(...Object.keys(obj)); Object.assign(store, clone(obj)); return Promise.resolve(); },
        remove: (keys) => { for (const k of [].concat(keys)) delete store[k]; return Promise.resolve(); }
      }
    },
    declarativeNetRequest: {
      getSessionRules: async () => [],
      updateSessionRules: async () => {},
      updateEnabledRulesets: async (u) => { store.__rulesets = u; }
    },
    action: { setBadgeText: () => Promise.resolve(), setBadgeBackgroundColor: () => Promise.resolve() }
  };

  const context = vm.createContext({
    chrome, console, setTimeout, URL, Promise, Object, Array, Set, Map, Math, Date, JSON, Error,
    importScripts: () => {
      context.FILTERS = {
        rebuild: async () => { rebuilds.push(true); return { installOk: true, siteCosmetics: { domains: 1 } }; },
        clear: async () => {},
        count: async () => 0
      };
    }
  });
  vm.runInContext(SOURCE, context, { filename: "background.js" });

  return {
    store, setKeys, rebuilds,
    async install(reason) {
      handlers.installed({ reason });
      for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    }
  };
}

async function run() {
  const siteEntries = {};
  for (let i = 0; i < 50; i++) siteEntries["cf:site" + i + ".example"] = { h: [".ad-" + i] };

  console.log("\nUpdating an existing install\n----------------------------");
  const old = boot(Object.assign({
    strictTracking: false,
    filterLists: ["arabic", "easylist"],
    whitelist: ["example.org"],
    filterReport: { rules: 10 }
  }, siteEntries));
  await old.install("update");
  check(old.store.strictTracking === true, "tracking protection is switched on once for an existing install");
  check(old.store.filterLists.includes("adguard-base") && old.store.filterLists.includes("arabic"), "AdGuard Base is added to the existing list selection, keeping the rest");
  check(old.store.defaultsRevision === 1, "the migration is recorded");
  check(old.store.__rulesets && old.store.__rulesets.enableRulesetIds.includes("easyprivacy"), "the EasyPrivacy ruleset is enabled right away");
  check(old.rebuilds.length === 1, "filters are rebuilt immediately so site hiding applies without waiting a day");
  check(!old.setKeys.some((k) => k.startsWith("cf:")), "the per-site hiding entries are never rewritten as settings");
  check(old.store["cf:site7.example"] && old.store["cf:site7.example"].h[0] === ".ad-7", "and they are left intact");
  check(old.store.whitelist.includes("example.org"), "existing settings such as the whitelist are kept");

  console.log("\nA later opt-out sticks\n----------------------");
  old.store.strictTracking = false; // the user turned it back off
  await old.install("update");
  check(old.store.strictTracking === false, "a user who turns tracking protection off keeps that choice on the next update");

  console.log("\nFresh install\n-------------");
  const fresh = boot({});
  await fresh.install("install");
  check(fresh.store.strictTracking === true, "a fresh install starts with tracking protection on");
  check(fresh.store.filterLists.join(",") === "arabic,easylist,adguard-base", "a fresh install starts with the three runtime lists");
  check(fresh.store.defaultsRevision === 1, "a fresh install is marked as already on the current defaults");

  console.log("\n" + "=".repeat(64));
  console.log(`  Background migration: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(64));
  if (failed) process.exit(1);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

/*
 * popclose.test.js
 *
 * Runs the real popclose.js in a small window stub. It must close real ad
 * popups (opened by a script, landing on an ad-network domain) and nothing
 * else: an ordinary site opened in a fresh tab can be closed by
 * window.close(), so a false match closes a site the user wanted.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "popclose.js"), "utf8");

let passed = 0;
let failed = 0;
function check(cond, name) {
  if (cond) { passed++; console.log("  PASS ", name); }
  else { failed++; console.error("  FAIL ", name); }
}

function run(url, opts) {
  opts = opts || {};
  const u = new URL(url);
  let closed = false;
  const win = {
    location: { hostname: u.hostname, href: u.href },
    opener: opts.openedByScript ? {} : null,
    close() { closed = true; }
  };
  win.top = opts.inFrame ? {} : win;
  const settings = Object.assign({ adBlock: true, whitelist: [] }, opts.settings || {});
  const chrome = { storage: { local: { get: (keys, cb) => cb(settings) } } };
  vm.runInNewContext(SOURCE, { window: win, chrome, String, Array });
  return closed;
}

console.log("\nReal ad popups\n--------------");
check(run("https://a.popads.net/landing?x=1", { openedByScript: true }), "a script-opened popup on an ad network is closed");
check(run("https://profitablegatecpm.com/r?z=1", { openedByScript: true }), "a script-opened popup on a known popunder domain is closed");

console.log("\nOrdinary sites are never closed\n-------------------------------");
check(!run("https://app.clickup.com/"), "ClickUp opened in a fresh tab stays open");
check(!run("https://app.clickup.com/", { openedByScript: true }), "ClickUp stays open even when a page opened it");
check(!run("https://clickhouse.com/", { openedByScript: true }), "ClickHouse stays open");
check(!run("https://www.17track.net/en", { openedByScript: true }), "17track stays open");
check(!run("https://landingi.com/", { openedByScript: true }), "Landingi stays open");
check(!run("https://www.bet365.com/", { openedByScript: true }), "a site the user opens is not closed for its name alone");
check(!run("https://www.aliexpress.com/item/1.html?aff_id=123&click_id=9", { openedByScript: true }), "an affiliate link to a shop stays open");
check(!run("https://apps.admob.com/", { openedByScript: true }), "Google AdMob (a developer console) stays open");

console.log("\nGuards\n------");
check(!run("https://popads.net/"), "an ad-network page the user opened directly is left alone");
check(!run("https://notpopads.net/", { openedByScript: true }), "a look-alike domain is not matched");
check(!run("https://popads.net.example.com/", { openedByScript: true }), "a domain that only starts with a network name is not matched");
check(!run("https://a.popads.net/", { openedByScript: true, settings: { adBlock: false } }), "does nothing when the ad blocker is off");
check(!run("https://a.popads.net/", { openedByScript: true, settings: { whitelist: ["popads.net"] } }), "respects the exception list");
check(!run("https://a.popads.net/", { openedByScript: true, inFrame: true }), "never acts inside frames");

console.log("\n" + "=".repeat(64));
console.log(`  Popunder closer: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));
if (failed) process.exit(1);

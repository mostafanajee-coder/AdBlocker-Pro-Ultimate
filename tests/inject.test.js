/*
 * inject.test.js
 *
 * Runs the real inject.js (the optional Anti-Adblock script) in a small window
 * stub and checks its window.open filter: ad-network popups and popunders on
 * known pirate-streaming hosts are stopped, ordinary popups everywhere else
 * (order tracking, store pages, share dialogs, embedded players) are not.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "inject.js"), "utf8");

let passed = 0;
let failed = 0;
function check(cond, name) {
  if (cond) { passed++; console.log("  PASS ", name); }
  else { failed++; console.error("  FAIL ", name); }
}

// Loads inject.js on a page at \`pageUrl\`; returns window.open plus a log of
// the popups that actually reached the browser's real window.open.
function page(pageUrl, opts) {
  opts = opts || {};
  const u = new URL(pageUrl);
  const opened = [];
  const win = {
    location: { hostname: u.hostname, href: u.href },
    open: function (url) { opened.push(url); return { real: true }; },
    addEventListener() {}
  };
  win.window = win;
  win.top = opts.inFrame ? {} : win;
  const context = vm.createContext(Object.assign(win, { URL, Object, Array, String, setTimeout }));
  vm.runInContext(SOURCE, context, { filename: "inject.js" });
  return {
    open(url) { const before = opened.length; const r = context.window.open(url); return { reached: opened.length > before, result: r }; }
  };
}

console.log("\nOrdinary sites\n--------------");
const shop = page("https://www.example-shop.com/account");
check(shop.open("https://www.fedex.com/fedextrack/?trknbr=1").reached, "a FedEx tracking popup opens");
check(shop.open("https://store.steampowered.com/app/1/some_game/").reached, "a Steam game page opens");
check(shop.open("https://www.amazon.com/gp/your-account/order-details?delivery=1").reached, "an Amazon order page opens");
check(shop.open("https://checkout.example.com/pay?offer=summer&bonus=1").reached, "a checkout popup with 'offer' in its address opens");
check(!shop.open("https://a.popads.net/r?z=1").reached, "a popup to an ad network is stopped");
check(!shop.open("https://profitablegatecpm.com/x").reached, "a popup to a known popunder domain is stopped");

console.log("\nHosts that only look like streaming sites\n-----------------------------------------");
const vimeo = page("https://player.vimeo.com/video/1", { inFrame: true });
check(vimeo.open("https://twitter.com/intent/tweet?text=hi").reached, "a share dialog from Vimeo's embedded player opens");
const labs = page("https://streamlabs.com/dashboard");
check(labs.open("https://accounts.google.com/o/oauth2/v2/auth?client_id=x").reached, "a sign-in popup on Streamlabs opens");
const shahid = page("https://shahid.mbc.net/ar");
check(shahid.open("https://www.facebook.com/sharer/sharer.php?u=x").reached, "Shahid (MBC) is not treated as a pirate streaming site");

console.log("\nKnown pirate-streaming hosts\n----------------------------");
const cima = page("https://mycima.example/watch/1");
check(!cima.open("https://random-betting.example/landing").reached, "a popunder to another domain is stopped");
check(cima.open("https://mycima.example/watch/2").reached, "a link within the same site still opens");
const trap = cima.open("about:blank");
check(!trap.reached && trap.result && trap.result.closed === false, "an about:blank redirect trap gets a harmless stand-in window");

console.log("\n" + "=".repeat(64));
console.log(`  Anti-Adblock popups: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));
if (failed) process.exit(1);

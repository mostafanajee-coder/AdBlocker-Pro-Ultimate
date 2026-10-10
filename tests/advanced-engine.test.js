"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const A = require("../advanced-rules.js");
const P = require("../procedural-engine.js");
const S = require("../scriptlet-engine.js");
const { FILTERS } = require("../filters.js");
let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; console.log("  PASS ", label); }

check(A.procedural('.label:has-text(Sponsored):upward(1)'), "parses chained text/container rules");
check(A.procedural('.card:has(span:has-text(Sponsored))'), "parses bounded nested text matching");
check(A.procedural('.card:has(span:has-text("Ad"))').key === A.procedural('.card:has(span:has-text(Ad))').key, "nested exception keys do not depend on equivalent argument quoting");
check(A.procedural('.card:has-text(/Sponsored|إعلان/i):min-text-length(4)'), "accepts safe fixed text regex alternatives");
for (const raw of ['.x:has-text(/(a+)+$/)', '.x:has-text()', '.x:upward(255)', '.x:xpath(//body)',
  '.x:has-text(Ad):style(display:none)', '.x:has-text(Ad) > .other', '.x:has-text("unclosed)',
  '.x:has-text(Ad){display:none}', 'body:has-text(Ad)']) check(!A.procedural(raw), "rejects unsupported/unsafe procedural input: " + raw);
check(!A.scriptlet('+js(set, __proto__.x, false)') && !A.scriptlet('+js(set, document.cookie, false)'), "prototype and sensitive browser API paths are forbidden");
check(!A.scriptlet('+js(set, setTimeout, noopFunc)') && !A.scriptlet('+js(aopr, ADV_RULES)'), "fundamental timing and extension-engine objects cannot be overwritten by rule data");
check(!A.scriptlet('+js(eval, alert(1))') && !A.scriptlet('+js(set, x, alert(1))'), "remote function bodies/unknown commands are rejected");
check(!A.scriptlet('+js(nostif, /(a+)+$/)') && !A.scriptlet('+js(nostif, !ads, 1000)'), "unsupported timer regex and inverted semantics are not approximated");
check(A.scriptlet('+js(set, adblock, false)').key === A.scriptlet('+js(set-constant.js, adblock, "false")').key, "scriptlet aliases and quoted arguments canonicalize");
const store = {
  "cf:news.example": { p: ['.label:has-text(Ad):upward(1)'], s: ['+js(set, adblock, false)'] },
  "cf:sub.news.example": { pu: ['.label:has-text(Ad):upward(1)'], su: ['+js(set-constant, adblock, false)'] }
};
check(A.collect(store, "sub.news.example").procedural.length === 0 && A.collect(store, "sub.news.example").scriptlets.length === 0, "subdomain exceptions cancel inherited procedural/scriptlet rules");
store["cf:sub.news.example"].su = ["+js()"];
check(A.collect(store, "sub.news.example").scriptlets.length === 0, "explicit all-scriptlet exception is honored");
check(A.excluded("www.facebook.com") && A.excluded("m.youtube.com") && !A.excluded("news.example"), "dedicated platform engines retain ownership");
check(FILTERS.parseCosmetic('##.label:has-text(Ad)\n##.keep', 100).join() === ".keep", "procedural syntax cannot poison a generic CSS selector chunk");
const parsed = new Map();
FILTERS.parseSiteCosmetic('news.example##.label:has-text(Ad):upward(1)\nnews.example#@#.label:has-text(Ad):upward(1)\nnews.example##+js(set, adblock, false)\nnews.example#@#+js()\nnews.example#?#.card:has(.badge)\nfacebook.com##.label:has-text(Ad)', parsed);
check(parsed.get("news.example").p.size === 1 && parsed.get("news.example").pu.size === 1, "compiler stores procedural rules and exceptions separately");
check(parsed.get("news.example").s.size === 1 && parsed.get("news.example").su.has("+js()"), "compiler stores only approved scriptlet data and exceptions");
check(parsed.get("news.example").h.has(".card:has(.badge)") && !parsed.has("facebook.com"), "native site CSS remains declarative and platform exclusions hold");

class Node {
  constructor(tag, classes = "", text = "") { this.tagName = tag.toUpperCase(); this.nodeType = tag === "document" ? 9 : 1; this.classes = classes.split(" "); this.text = text; this.children = []; this.attrs = {}; this.isConnected = true; }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.isConnected = false; }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(""); }
  set textContent(text) { this.text = text; }
  getAttribute(name) { return this.attrs[name] === undefined ? null : this.attrs[name]; }
  setAttribute(name, value) { this.attrs[name] = value; }
  removeAttribute(name) { delete this.attrs[name]; }
  matches(selector) {
    return selector.split(",").some(part => {
      part = part.trim();
      if (part.startsWith(".")) return this.classes.includes(part.slice(1));
      const role = /^\[role=['"]([^'"]+)['"]\]$/.exec(part);
      if (role) return this.getAttribute("role") === role[1];
      return this.tagName.toLowerCase() === part;
    });
  }
  querySelectorAll(selector) {
    if (selector === ".invalid[") throw new Error("invalid selector");
    const result = [];
    function visit(node) { for (const child of node.children) { if (child.matches(selector)) result.push(child); visit(child); } }
    visit(this); return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}
const doc = new Node("document"), html = doc.appendChild(new Node("html")), body = html.appendChild(new Node("body"));
doc.documentElement = html;
doc.createElement = tag => new Node(tag);
const ad = body.appendChild(new Node("div", "card")), label = ad.appendChild(new Node("span", "label", "Sponsored"));
const organic = body.appendChild(new Node("article", "organic", "Talking about Sponsored ads is normal content"));
let nextTimer = 1;
const jobs = new Map(), observers = [];
const env = { now: () => 0, setTimeout: cb => { const id = nextTimer++; jobs.set(id, cb); return id; }, clearTimeout: id => jobs.delete(id),
  MutationObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } } };
function flush() { let attempts = 0; while (jobs.size) { assert.ok(attempts++ < 50); const [id, cb] = jobs.entries().next().value; jobs.delete(id); cb(); } }
const engine = P.create(doc, env);
engine.setRules(['.label:has-text(Sponsored):upward(1)']); flush();
check(ad.getAttribute("data-abp-procedural") && !organic.getAttribute("data-abp-procedural"), "confirmed ad container is hidden while organic content stays untouched");
check(body.children.includes(ad) && ad.children.includes(label), "hiding leaves original DOM ownership and child nodes mounted");
html.children.find(node => node.tagName === "STYLE").remove();
observers.at(-1).cb([{ type: "childList" }]); flush();
check(html.children.filter(node => node.tagName === "STYLE").length === 1, "removed hiding stylesheets are restored without accumulating duplicates");
ad.setAttribute("data-abp-procedural", "latest-page-value");
observers.at(-1).cb([{ type: "attributes", attributeName: "data-abp-procedural", target: ad }]); flush();
check(ad.getAttribute("data-abp-procedural") !== "latest-page-value", "page tampering with the marker re-evaluates confirmed ads without polling");
label.textContent = "Normal reel";
observers.at(-1).cb([{ type: "characterData" }]); flush();
check(ad.getAttribute("data-abp-procedural") === "latest-page-value", "recycled content releases hiding and restores the latest page-owned attribute");
label.textContent = "Sponsored";
observers.at(-1).cb([{ type: "characterData" }]); flush();
check(engine.stats.hidden === 1, "delayed ad disclosure triggers bounded re-evaluation");
engine.setRules(['.card:has(span:has-text(Sponsored))']); flush();
check(engine.stats.hidden === 1, "nested procedural matching reaches the intended container");
engine.setRules(['.label:has-text(Sponsored):upward(3)']); flush();
check(!body.getAttribute("data-abp-procedural") && engine.stats.hidden === 0, "ancestor traversal cannot hide the page root");
engine.setRules(Array.from({ length: 20 }, (_, index) => '.label:has-text(Missing' + index + ')')); flush();
check(engine.stats.runs > 2 && jobs.size === 0, "large rule batches yield and finish without perpetual polling");
ad.setAttribute("data-abp-procedural", "page-owned");
engine.setRules(['.label:has-text(Sponsored):upward(1)']); flush(); engine.stop();
check(ad.getAttribute("data-abp-procedural") === "page-owned" && observers.at(-1).disconnected && jobs.size === 0, "stop restores prior attributes and disconnects all owned work");

let timerId = 0;
const calls = [];
const page = { adblock: true, media: { paused: true }, setTimeout(callback, delay, ...args) { calls.push({ callback, delay, args }); return ++timerId; } };
const originalTimer = page.setTimeout;
const scripts = S.create(page);
scripts.apply(['+js(set, adblock, false)']);
check(page.adblock === false && page.media.paused === true, "constant hook is scoped and does not touch media/user playback");
page.adblock = true;
check(page.adblock === false, "constant hook handles later same-type page assignments");
scripts.stop();
check(page.adblock === true, "teardown retains the page's latest own assignment");
scripts.apply(['+js(set, adblock, false)']);
page.adblock = { organic: true };
check(page.adblock.organic === true, "unexpected type changes release the constant override"); scripts.stop();
Object.defineProperty(page, "locked", { value: true, configurable: false });
scripts.apply(['+js(set, locked, false)']);
check(page.locked === true, "non-configurable page properties are never forced"); scripts.stop();
let getterReads = 0;
Object.defineProperty(page, "guarded", { get() { getterReads++; return true; }, configurable: true });
scripts.apply(['+js(set, guarded, false)']);
check(getterReads === 0, "applying hooks never executes page-owned getters"); scripts.stop();
scripts.apply(['+js(aopr, adTrap)']);
assert.throws(() => page.adTrap, ReferenceError);
check(true, "approved ad-property reads abort only the requesting script");
page.adTrap = 5; scripts.stop();
check(page.adTrap === 5, "property-read hook teardown preserves later page assignments");
scripts.apply(['+js(nostif, adsDetector, 1000)']);
const blocked = function adsDetector() {}, normal = function normalVideoControls() {};
page.setTimeout(blocked, 1000); page.setTimeout(normal, 1000, "argument"); page.setTimeout(blocked, 2000);
check(calls[0].callback !== blocked && calls[1].callback === normal && calls[1].args[0] === "argument" && calls[2].callback === blocked, "timer interception respects callback, delay and normal arguments");
const wrapped = page.setTimeout; scripts.apply(['+js(nostif, adsDetector, 1000)']);
check(page.setTimeout === wrapped, "repeated identical configuration does not stack timer wrappers");
scripts.stop(); check(page.setTimeout === originalTimer, "opt-out restores the original timer implementation");
scripts.apply(['+js(nostif, adsDetector)']); const thirdPartyTimer = function () {}; page.setTimeout = thirdPartyTimer; scripts.stop();
check(page.setTimeout === thirdPartyTimer, "teardown never overwrites a later third-party timer hook");

const liveStore = { adBlock: true, useFilterLists: true, antiAdblock: false, whitelist: [], cosmeticCss: [],
  "cf:news.example": { s: ['+js(set, adblock, false)'] } };
const messages = [], windowEvents = new Map();
let storageEvent;
const contentDoc = { documentElement: { appendChild() {} }, getElementById: () => null, addEventListener() {},
  createElement: () => ({ textContent: "", style: {} }) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8"), {
  ADV_RULES: A, PROCEDURAL_ENGINE: { create: () => ({ setRules() {}, stop() {} }) }, document: contentDoc,
  window: { location: { hostname: "news.example" }, addEventListener: (name, listener) => windowEvents.set(name, listener) },
  chrome: { runtime: { onMessage: { addListener() {} }, sendMessage: (message, callback) => { messages.push(message); callback({}); } },
    storage: { local: { get: (_keys, callback) => callback(JSON.parse(JSON.stringify(liveStore))) },
      onChanged: { addListener: listener => { storageEvent = listener; } } } }
});
check(messages.length === 0, "default-disabled scriptlets do not wake the worker on ordinary page loads");
liveStore.antiAdblock = true;
storageEvent({ antiAdblock: { newValue: true } }, "local");
check(messages.length === 1 && messages[0].type === "syncEngineScriptlets" && !messages[0].rules, "an enabled matching site requests authoritative configuration, never supplies commands");
liveStore.whitelist = ["parent.example"];
storageEvent({ whitelist: { newValue: liveStore.whitelist } }, "local");
check(messages.length === 2, "parent-whitelist changes revalidate frame hooks even when the frame's own host is unchanged");
liveStore.adBlock = false;
windowEvents.get("pageshow")({ persisted: true });
check(messages.length === 3, "back-forward cached pages re-read switches and request cleanup on restore");

async function backgroundChecks() {
  const priorChrome = global.chrome, persisted = {};
  global.chrome = { storage: { local: {
    get: async () => ({ ...persisted }), set: async patch => Object.assign(persisted, patch),
    remove: async keys => keys.forEach(key => delete persisted[key])
  } } };
  try {
    parsed.get("news.example").h.add('[aria-label="إعلان"]');
    const report = await FILTERS.installSiteCosmetics(parsed);
    check(report.procedural === 1 && report.scriptlets === 1 && persisted["cf:news.example"].pu.length === 1,
      "persisted site entries retain advanced rules/exceptions and report accepted counts");
    const byteSize = Object.entries(persisted).reduce((sum, [key, value]) => sum + new TextEncoder().encode(key + JSON.stringify(value)).byteLength, 0);
    check(report.bytes === byteSize && byteSize > JSON.stringify(persisted["cf:news.example"]).length + "cf:news.example".length,
      "site-storage budgets count real UTF-8 bytes, including Arabic text");
  } finally { global.chrome = priorChrome; }
  const calls = [], stored = { adBlock: true, useFilterLists: true, antiAdblock: true, whitelist: [],
    "cf:news.example": { s: ['+js(set, adblock, false)'] } };
  let optOutDuringInjection = false;
  const chrome = { storage: { local: { get: async keys => Object.fromEntries(keys.map(key => [key, stored[key]])) } },
    scripting: { executeScript: async details => {
      calls.push(details);
      if (details.files && optOutDuringInjection) stored.adBlock = false;
      return [{ result: { applied: details.args ? details.args[0].length : 0 } }];
    } } };
  const context = vm.createContext({ chrome, ADV_RULES: A, FILTERS: {}, CORE_FILTERS: {}, importScripts() {}, URL, Set, Map, Object, Array, Promise });
  const source = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
  vm.runInContext(source.slice(0, source.indexOf("let rebuilding")), context);
  const sender = { tab: { id: 7, url: "https://news.example/" }, documentId: "exact-document", url: "https://sub.news.example/article" };
  const result = await context.syncEngineScriptlets(sender);
  check(result.applied === 1 && calls[0].files.join() === "advanced-rules.js,scriptlet-engine.js", "background executes only packaged engine files and stored approved rules");
  check(calls.every(call => call.world === "MAIN" && call.target.documentIds[0] === sender.documentId && !call.target.frameIds), "scriptlet injection is pinned to the originating document, not a reused frame");
  calls.length = 0; stored.whitelist = ["news.example"];
  await context.syncEngineScriptlets(sender);
  check(calls.length === 1 && calls[0].args[0].length === 0, "whitelist opt-out sends cleanup without injecting new hook files");
  stored.whitelist = ["parent.example"]; sender.tab.url = "https://parent.example/";
  await context.syncEngineScriptlets(sender);
  check(calls.at(-1).args[0].length === 0, "a whitelisted parent also protects embedded third-party frames");
  stored.whitelist = []; sender.tab.url = "https://www.facebook.com/";
  await context.syncEngineScriptlets(sender);
  check(calls.at(-1).args[0].length === 0, "platform parent pages never receive generic scriptlet hooks");
  sender.tab.url = "https://news.example/"; optOutDuringInjection = true;
  await context.syncEngineScriptlets(sender);
  check(calls.at(-1).args[0].length === 0, "an opt-out during native file injection cancels captured scriptlet configuration");
  calls.length = 0; delete sender.documentId;
  await context.syncEngineScriptlets(sender);
  check(calls.length === 0, "missing document identity cannot fall back to unsafe frame injection");
  console.log(`\nAdvanced engine: ${passed} passed, 0 failed`);
}
backgroundChecks().catch(error => { console.error(error); process.exitCode = 1; });

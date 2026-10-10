"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { FILTERS } = require("../filters.js");
const root = path.resolve(__dirname, "..");
let passed = 0;
function check(condition, label) {
  assert.ok(condition, label);
  passed++;
  console.log("  PASS ", label);
}

async function run() {
  const registrations = new Map();
  const chrome = { scripting: {
    getRegisteredContentScripts: async ({ ids }) => ids.flatMap(id => registrations.has(id) ? [registrations.get(id)] : []),
    registerContentScripts: async entries => entries.forEach(entry => registrations.set(entry.id, entry)),
    updateContentScripts: async entries => entries.forEach(entry => registrations.set(entry.id, entry)),
    unregisterContentScripts: async ({ ids }) => ids.forEach(id => registrations.delete(id))
  } };
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const context = vm.createContext({ chrome, FILTERS: {}, CORE_FILTERS: {}, importScripts() {}, URL, Set, Map, Object, Array });
  // Execute the real registration functions without booting the service worker.
  vm.runInContext(background.slice(0, background.indexOf("let rebuilding")), context);
  const settings = { adBlock: true, fbSponsored: true, ytSkip: false, antiAdblock: false, whitelist: ["facebook.com"] };
  await context.syncRegisteredScripts(settings);
  const probe = registrations.get("facebook-net-probe");
  check(probe && probe.world === "MAIN" && probe.runAt === "document_start" && !probe.allFrames, "probe uses the intended world and frame scope");
  check(probe.excludeMatches.includes("*://*.facebook.com/*") && probe.excludeMatches.includes("*://facebook.com/*"), "probe excludes whitelisted Facebook and subdomains");
  await context.syncRegisteredScripts({ ...settings, whitelist: [] });
  check(registrations.get("facebook-net-probe").excludeMatches.length === 0, "removing whitelist updates the existing registration");
  await context.syncRegisteredScripts({ ...settings, fbSponsored: false });
  check(!registrations.has("facebook-net-probe"), "Facebook toggle unregisters the probe");
  await context.syncRegisteredScripts({ ...settings, whitelist: [] });
  await context.syncRegisteredScripts({ ...settings, adBlock: false });
  check(!registrations.has("facebook-net-probe"), "global disable unregisters the probe");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  check(!manifest.content_scripts.some(entry => entry.js.includes("fb-net-probe.js")), "manifest has no static probe bypass");

  const events = new Map();
  const observers = [];
  const diagnosticWrites = [];
  function Element() {}
  const originalShadow = Element.prototype.attachShadow = function () { return { textContent: "ordinary" }; };
  function XHR() { this.handlers = {}; this.responseText = '"__typename":"SponsoredData"'; }
  const originalOpen = XHR.prototype.open = function () {};
  const originalSend = XHR.prototype.send = function () {};
  XHR.prototype.addEventListener = function (name, cb) { this.handlers[name] = cb; };
  const probeDocument = {
    addEventListener: (name, cb) => events.set(name, cb),
    removeEventListener: name => events.delete(name),
    dispatchEvent: event => { const cb = events.get(event.type); if (cb) cb(event); },
    documentElement: { getAttribute: () => "0", setAttribute: (name, value) => diagnosticWrites.push([name, value]) }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "fb-net-probe.js"), "utf8"), {
    window: { XMLHttpRequest: XHR }, document: probeDocument, Element, Set,
    CustomEvent: class { constructor(type) { this.type = type; } },
    MutationObserver: class {
      constructor() { observers.push(this); }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    setTimeout() {}
  });
  new Element().attachShadow({ mode: "closed" });
  const xhr = new XHR();
  xhr.open("POST", "/api/graphql/");
  xhr.send();
  check(observers.length === 1 && typeof xhr.handlers.load === "function", "active probe observes shadow roots and GraphQL responses");
  probeDocument.dispatchEvent({ type: "__abpFacebookProbeStop" });
  check(Element.prototype.attachShadow === originalShadow && XHR.prototype.open === originalOpen && XHR.prototype.send === originalSend, "live opt-out restores probe-owned page hooks");
  check(observers.every(observer => observer.disconnected), "live opt-out disconnects active shadow observers");
  xhr.handlers.load();
  check(diagnosticWrites.length === 0, "late XHR completion does not inspect or count after opt-out");

  const content = fs.readFileSync(path.join(root, "content.js"), "utf8");
  function runContent(hostname) {
    const styles = [];
    const doc = {
      documentElement: { appendChild: element => styles.push(element.textContent) },
      getElementById: () => null,
      addEventListener() {},
      createElement: () => ({ textContent: "", style: {} })
    };
    vm.runInNewContext(content, {
      document: doc,
      window: { location: { hostname }, addEventListener() {} },
      chrome: {
        storage: { local: { get: (_keys, cb) => cb({ adBlock: true, cosmeticCss: [".generic-ad"] }) }, onChanged: { addListener() {} } },
        runtime: { onMessage: { addListener() {} } }
      }
    });
    return styles;
  }
  check(runContent("www.facebook.com").length === 0, "Facebook receives no generic cosmetic stylesheet");
  check(runContent("www.messenger.com").length === 0, "Messenger receives no generic cosmetic stylesheet");
  check(runContent("www.youtube.com").some(css => css.includes(".generic-ad")), "Facebook exclusion leaves other platform cosmetics unchanged");
  check(runContent("news.example").some(css => css.includes(".generic-ad")), "ordinary sites retain generic cosmetic coverage");

  const liveStyles = new Map();
  let liveWrites = 0, onStorage;
  vm.runInNewContext(content, {
    document: {
      documentElement: { appendChild: element => { liveWrites++; liveStyles.set(element.id, element); } },
      getElementById: id => liveStyles.get(id),
      addEventListener() {},
      createDocumentFragment: () => ({ querySelector() {} }),
      createElement: () => ({ textContent: "", style: {}, remove() { liveStyles.delete(this.id); } })
    },
    window: { location: { hostname: "news.example" }, addEventListener() {} },
    chrome: {
      storage: {
        local: { get: (_keys, cb) => cb({ adBlock: true, cosmeticCss: [".old-ad"] }) },
        onChanged: { addListener: handler => { onStorage = handler; } }
      },
      runtime: { onMessage: { addListener() {} } }
    }
  });
  onStorage({ cosmeticCss: { newValue: [".new-ad"] } }, "local");
  check(liveStyles.size === 1 && liveStyles.get("abp-builtin-cosmetic").textContent.includes(".new-ad") &&
    !liveStyles.get("abp-builtin-cosmetic").textContent.includes(".old-ad"), "open pages replace cosmetic CSS immediately without duplicate styles");
  onStorage({ "cf:news.example": { newValue: { h: [".site-ad"], u: [".new-ad"] } } }, "local");
  check(liveStyles.get("abp-builtin-cosmetic").textContent.includes(".site-ad") &&
    !liveStyles.get("abp-builtin-cosmetic").textContent.includes(".new-ad"), "live site updates honor the site's hiding exceptions");
  const beforeUnrelated = liveWrites;
  onStorage({ totalBlocked: { newValue: 9 }, "cf:other.example": { newValue: { h: [".other"] } } }, "local");
  check(liveWrites === beforeUnrelated, "counter changes and other sites do not rebuild the page stylesheet");
  onStorage({ whitelist: { newValue: ["news.example"] } }, "local");
  check(!liveStyles.has("abp-builtin-cosmetic"), "live whitelist addition releases list hiding");
  onStorage({ whitelist: { newValue: [] } }, "local");
  check(liveStyles.has("abp-builtin-cosmetic"), "removing the whitelist restores current cosmetics");
  onStorage({ adBlock: { newValue: false } }, "local");
  check(!liveStyles.has("abp-builtin-cosmetic"), "global opt-out releases cosmetic hiding immediately");

  const originalFetch = global.fetch;
  const originalCap = FILTERS.MAX_FILTER_DOWNLOAD_BYTES;
  const validList = "! test list\n||ad1.example^\n||ad2.example^\n||ad3.example^\n" + "! metadata\n".repeat(20);
  try {
    FILTERS.MAX_FILTER_DOWNLOAD_BYTES = 512;
    global.fetch = async () => new Response(validList);
    check(await FILTERS.fetchList("https://test.invalid/list") === validList, "bounded stream preserves valid list text");
    global.fetch = async () => new Response("small", { headers: { "content-length": "513" } });
    await assert.rejects(FILTERS.fetchList("https://test.invalid/list"), /size limit/);
    check(true, "oversized declared response is rejected");
    let canceled = false;
    global.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(300));
        controller.enqueue(new Uint8Array(300));
      },
      cancel() { canceled = true; }
    }));
    await assert.rejects(FILTERS.fetchList("https://test.invalid/list"), /size limit/);
    check(canceled, "oversized chunked response is canceled at the cap");
    global.fetch = async () => new Response("x".repeat(600), { headers: { "content-length": "1" } });
    await assert.rejects(FILTERS.fetchList("https://test.invalid/list"), /size limit/);
    check(true, "a misleading small content-length cannot bypass the stream cap");
    const previousChrome = global.chrome;
    const stored = { filterLists: ["arabic"], cosmeticCss: [".known-good"] };
    const knownRules = [{ id: FILTERS.RULE_ID_BASE, action: { type: "block" }, condition: { urlFilter: "||known-good.example^" } }];
    let replacements = 0;
    global.chrome = {
      storage: { local: { get: async () => stored, set: async () => { throw new Error("unexpected storage replacement"); } } },
      declarativeNetRequest: { getDynamicRules: async () => knownRules, updateDynamicRules: async () => { replacements++; } }
    };
    try {
      const report = await FILTERS.rebuild();
      check(!report.installOk && replacements === 0 && stored.cosmeticCss[0] === ".known-good", "a download-limit violation preserves installed rules and cosmetics");
    } finally {
      global.chrome = previousChrome;
    }
  } finally {
    global.fetch = originalFetch;
    FILTERS.MAX_FILTER_DOWNLOAD_BYTES = originalCap;
  }
  console.log(`\nMaintenance: ${passed} passed, 0 failed`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });

"use strict";
// Read-only provider audit: compilation uses an in-memory Chrome API fixture.
// This is not a browser-level DNR or live-page acceptance test.
const fs = require("node:fs");
const path = require("node:path");
const { FILTERS } = require("../filters.js");
const CORE = require("../core-filters.js");
const manifest = require("../manifest.json");
const metadata = require("../rulesets/core-source.json");
const store = {
  adBlock: true, useFilterLists: true, strictTracking: true,
  filterLists: FILTERS.SOURCES.filter(source => source.enabled).map(source => source.id)
};
let dynamic = [];
global.chrome = {
  runtime: { getManifest: () => manifest },
  storage: { local: {
    get: async keys => keys ? Object.fromEntries(keys.map(key => [key, store[key]])) : { ...store },
    set: async patch => Object.assign(store, patch),
    remove: async keys => keys.forEach(key => delete store[key])
  } },
  declarativeNetRequest: {
    getDynamicRules: async () => dynamic,
    // Without the real Chrome API, do not pretend every candidate is valid.
    isRegexSupported: async () => ({ isSupported: false, reason: "native validation unavailable in offline audit" }),
    updateDynamicRules: async update => {
      const remove = new Set(update.removeRuleIds || []);
      dynamic = dynamic.filter(rule => !remove.has(rule.id)).concat(update.addRules || []);
    },
    updateEnabledRulesets: async () => {}
  }
};
FILTERS.core = CORE;
const fetchText = FILTERS.fetchText.bind(FILTERS);
FILTERS.fetchText = async url => {
  if (url === CORE.API_URL) return JSON.stringify({ sha: metadata.revision });
  if (url.startsWith(CORE.RAW_ROOT + metadata.revision + "/chromium/rulesets/")) {
    const id = url.split("/").pop().replace(/\.json$/, "");
    const kind = url.split("/").at(-2);
    if (!CORE.SOURCES.some(source => source.id === id)) throw new Error("unknown core snapshot");
    if (!["main", "regex"].includes(kind)) throw new Error("unknown core partition");
    return fs.readFileSync(path.join(__dirname, "..", "rulesets", kind, id + ".json"), "utf8");
  }
  return fetchText(url);
};
FILTERS.rebuild().then(report => {
  console.log(JSON.stringify({
    testedAt: new Date().toISOString(), browserValidated: false,
    revision: report.core?.revision, core: report.core?.rules, regex: report.core?.regex,
    regexCandidates: report.core?.regexCandidates,
    regexOmittedWithoutNativeValidation: report.core?.regexRejected.length,
    rules: report.rules, selectors: report.selectors,
    siteCosmetics: report.siteCosmetics,
    installOk: report.installOk, cosmeticRefreshOk: report.cosmeticRefreshOk,
    truncated: !!report.truncated, error: report.error,
    sources: report.sources.map(source => ({ id: source.id, ok: source.ok,
      bytes: source.bytes, installed: source.installed, selectors: source.selectors,
      unsupported: source.unsupported, error: source.error }))
  }, null, 2));
  if (!report.installOk || !report.cosmeticRefreshOk || report.siteCosmetics?.error) process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });

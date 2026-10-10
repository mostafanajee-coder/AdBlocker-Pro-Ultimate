"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { FILTERS } = require("../filters.js");
const CORE = require("../core-filters.js");
const manifest = require("../manifest.json");
const metadata = require("../rulesets/core-source.json");
let passed = 0;
function check(condition, label) { assert.ok(condition, label); passed++; console.log("  PASS ", label); }
const resources = manifest.web_accessible_resources.flatMap(entry => entry.resources);
let bundled = [];
for (const source of CORE.SOURCES) {
  for (const kind of ["main"].concat(source.regex ? ["regex"] : [])) {
  const bytes = fs.readFileSync(path.join(__dirname, "..", "rulesets", kind, source.id + ".json"));
  const info = metadata.rulesets.find(entry => entry.id === source.id && entry.kind === kind);
  check(crypto.createHash("sha256").update(bytes).digest("hex") === info.sha256, "bundled " + source.id + "/" + kind + " matches recorded upstream digest");
  const rules = CORE.validate(source.id, JSON.parse(bytes), resources, kind);
  check(rules.length === info.rules, "bundled " + source.id + "/" + kind + " passes the runtime rule validator");
  bundled.push(...rules);
  }
}
check(bundled.length < FILTERS.MAX_DYNAMIC_RULES && new Set(bundled.map(rule => rule.id)).size === bundled.length, "the whole bundled core fits quota with disjoint owned IDs");
check(bundled.filter(rule => !["block", "allow", "allowAllRequests"].includes(rule.action.type)).length < CORE.MAX_UNSAFE_RULES, "redirect/header rules stay within the unsafe-rule quota");
check(Number(manifest.minimum_chrome_version) >= 145, "manifest supports header and top-frame conditions used by native regex rules");
check(bundled.filter(rule => rule.condition.regexFilter).length <= CORE.MAX_REGEX_RULES, "bundled native regex rules fit their separate quota");
check(manifest.declarative_net_request.rule_resources.every(resource =>
  !resource.path.startsWith("rulesets/regex/") && !JSON.parse(fs.readFileSync(path.join(__dirname, "..", resource.path), "utf8"))
    .some(rule => rule.condition.regexFilter !== undefined)), "no raw regex candidate can block boot-time manifest loading");
const rejectedUpstreamRule = require("../rulesets/regex/ublock-filters.json").find(rule => rule.id === 99);
check(rejectedUpstreamRule.condition.regexFilter.includes("{200,1300}"), "regression fixture preserves the actual upstream rule that Chrome rejected");
assert.throws(() => CORE.validate("easylist", [{ id: 1, action: { type: "redirect", redirect: { url: "https://evil.invalid/" } }, condition: { urlFilter: "ads" } }], resources));
check(true, "remote URL redirects cannot enter the core snapshot");
assert.throws(() => CORE.validate("easylist", [{ id: 1, action: { type: "modifyHeaders", responseHeaders: [{ header: "content-security-policy", operation: "remove" }] }, condition: { urlFilter: "ads" } }], resources));
check(true, "updates cannot remove a site's security policy");
assert.throws(() => CORE.validate("easylist", [{ id: 1, action: { type: "redirect", redirect: { extensionPath: "/unshipped.js" } }, condition: { urlFilter: "ads" } }], resources));
check(true, "unshipped redirect resources reject an update");

async function run() {
  const stored = { filterLists: ["arabic", "easylist"], adBlock: true, useFilterLists: true, strictTracking: true, cosmeticCss: [".old"] };
  let dynamic = [{ id: 42, priority: 1, action: { type: "block" }, condition: { urlFilter: "foreign-rule" } }];
  const enabled = new Set(CORE.SOURCES.map(source => source.id));
  const calls = [];
  let mode = "ok";
  let updateCalls = 0;
  const revision = "1".repeat(40);
  const urls = [];
  const regexChecks = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  global.chrome = {
    runtime: { getManifest: () => manifest },
    storage: { local: {
      get: async keys => keys ? Object.fromEntries([].concat(keys).map(key => [key, stored[key]])) : { ...stored },
      set: async patch => {
        if (mode === "storage-failure" && patch.filterReport) throw new Error("storage quota exceeded");
        Object.assign(stored, patch);
      },
      remove: async keys => [].concat(keys).forEach(key => delete stored[key])
    } },
    declarativeNetRequest: {
      isRegexSupported: async options => {
        regexChecks.push(options);
        if (mode === "regex-api-failure") throw new Error("native validation API failed");
        if (mode === "malformed-native-result") return {};
        return { isSupported: mode !== "regex-rejected" && options.regex !== rejectedUpstreamRule.condition.regexFilter,
          reason: "syntaxError" };
      },
      getDynamicRules: async () => clone(dynamic),
      updateDynamicRules: async update => {
        if (mode === "dnr-failure") throw new Error("native validation rejected");
        updateCalls++; calls.push("dynamic");
        const remove = new Set(update.removeRuleIds || []);
        dynamic = dynamic.filter(rule => !remove.has(rule.id)).concat(clone(update.addRules || []));
        if (mode === "inflight-settings-race" && update.addRules) stored.strictTracking = false;
      },
      updateEnabledRulesets: async update => {
        calls.push("static");
        const registered = new Set(manifest.declarative_net_request.rule_resources.map(resource => resource.id));
        assert.ok(update.enableRulesetIds.concat(update.disableRulesetIds).every(id => registered.has(id)), "static synchronization cannot reference removed regex ruleset IDs");
        update.enableRulesetIds.forEach(id => enabled.add(id));
        update.disableRulesetIds.forEach(id => enabled.delete(id));
      }
    }
  };
  const oldText = FILTERS.fetchText, oldList = FILTERS.fetchList;
  FILTERS.core = CORE;
  FILTERS.fetchText = async url => {
    urls.push(url);
    if (mode === "core-failure") throw new Error("upstream unavailable");
    if (url === CORE.API_URL) return JSON.stringify({ sha: revision });
    const id = url.split("/").pop().replace(/\.json$/, "");
    assert.ok(CORE.SOURCES.some(source => source.id === id));
    if (mode === "unsupported") return JSON.stringify([{ id: 1, action: { type: "redirect", redirect: { url: "https://evil.invalid" } }, condition: { urlFilter: "ads" } }]);
    if (mode === "mixed-regex" && id === "ublock-filters" && url.includes("/regex/")) return JSON.stringify([
      { id: 17, action: { type: "block" }, condition: { regexFilter: "^https://good\\.example/" } }, rejectedUpstreamRule
    ]);
    if (mode === "capture" && id === "ublock-filters" && url.includes("/regex/")) return JSON.stringify([{ id: 1,
      action: { type: "redirect", redirect: { regexSubstitution: "\\1\\2" } },
      condition: { regexFilter: "(.*\\/GetPlaybackResources\\?.*)%2CCuepointPlaylist(.*)", resourceTypes: ["xmlhttprequest"] } }]);
    return JSON.stringify([{ id: 1, priority: 10, action: { type: "block" }, condition: url.includes("/regex/") ? { regexFilter: "^https://" + id + "\\.example/" } : { urlFilter: "||" + id + ".example^" } }]);
  };
  FILTERS.fetchList = async () => {
    if (mode === "settings-race") stored.adBlock = false;
    return "||regional.example^\n##.generic-ad\n#@#.generic-ad\n##.keep\n" + "! metadata\n".repeat(30);
  };
  try {
    const report = await FILTERS.rebuild();
    check(report.installOk && report.core.rules === 10 && report.core.regex === 4 && report.rules === 11, "native main/regex core and regional rules install in one combined update");
    check(dynamic.some(rule => rule.id === 42) && dynamic.length === 12, "combined refresh preserves foreign rule ownership");
    check(CORE.SOURCES.every(source => !enabled.has(source.id)), "only verified dynamic replacements disable the bundled core fallback");
    check(stored.coreFilterState.revision === revision && urls.filter(url => url !== CORE.API_URL).every(url => url.includes("/" + revision + "/")), "all native lists come from one pinned upstream revision");
    check(stored.cosmeticCss.includes(".keep") && !stored.cosmeticCss.includes(".generic-ad"), "generic exception rules prevent over-hiding across sources");
    mode = "capture";
    const capture = await FILTERS.rebuild();
    check(capture.installOk && regexChecks.some(options => options.requireCapturing === true), "regex query substitutions request native capture validation");
    mode = "ok"; await FILTERS.rebuild();
    delete stored.coreFilterState.regex;
    await CORE.syncStatic(stored);
    check(CORE.SOURCES.every(source => enabled.has(source.id)), "legacy metadata restores only registered main fallback groups");
    stored.coreFilterState.regex = 4;
    await CORE.syncStatic(stored);
    mode = "mixed-regex";
    const mixed = await FILTERS.rebuild();
    check(mixed.installOk && mixed.cosmeticRefreshOk && mixed.core.regex === 4 && mixed.core.regexCandidates === 5,
      "one unsupported regex does not cancel valid main/regex rules or cosmetic refreshes");
    check(mixed.core.regexRejected.length === 1 && mixed.core.regexRejected[0].id === 99 &&
      mixed.core.regexRejected[0].reason === "syntaxError", "rejected regex records its exact upstream ID and native reason");
    check(!dynamic.some(rule => rule.condition.regexFilter === rejectedUpstreamRule.condition.regexFilter) &&
      dynamic.some(rule => rule.condition.regexFilter === "^https://good\\.example/"), "invalid rule 99 never reaches native installation; supported regex stays active");
    mode = "regex-rejected";
    const withoutRegex = await FILTERS.rebuild();
    check(withoutRegex.installOk && withoutRegex.core.regex === 0 && withoutRegex.core.regexRejected.length === 4 &&
      dynamic.some(rule => rule.id === 42) && withoutRegex.rules === 7, "even total regex rejection preserves complete main/regional filtering and foreign rules");
    mode = "ok"; await FILTERS.rebuild();
    const installed = JSON.stringify(dynamic);
    for (const failure of ["core-failure", "unsupported", "regex-api-failure", "malformed-native-result", "dnr-failure", "settings-race"]) {
      mode = failure;
      // Force a changed build so the DNR rejection test does not take the
      // intentional unchanged-fingerprint shortcut.
      if (failure === "dnr-failure") stored[FILTERS.NETWORK_FP_KEY] = null;
      const failed = await FILTERS.rebuild();
      check(!failed.installOk && JSON.stringify(dynamic) === installed, failure + " leaves the installed snapshot intact");
      stored.adBlock = true;
    }
    mode = "ok";
    const working = clone(dynamic);
    dynamic.push(...Array.from({ length: CORE.MAX_REGEX_RULES }, (_, index) => ({
      id: 400000 + index, action: { type: "block" }, condition: { regexFilter: "foreign-regex" }
    })));
    const regexQuotaSnapshot = JSON.stringify(dynamic);
    const regexQuotaFailure = await FILTERS.rebuild();
    check(!regexQuotaFailure.installOk && JSON.stringify(dynamic) === regexQuotaSnapshot, "foreign regex rules reserve the separate native regex quota");
    dynamic = clone(working);
    dynamic.push(...Array.from({ length: 29000 }, (_, index) => ({
      id: 400000 + index, action: { type: "block" }, condition: { urlFilter: "quota.example" }
    })));
    const overQuota = JSON.stringify(dynamic);
    const quotaFailure = await FILTERS.rebuild();
    check(!quotaFailure.installOk && JSON.stringify(dynamic) === overQuota, "foreign rules reserve quota without being removed to make room");
    dynamic = working;
    mode = "storage-failure";
    const saveFailure = await FILTERS.rebuild();
    check(saveFailure.cosmeticRefreshOk === false && saveFailure.error.includes("could not be saved"), "failed metadata/CSS persistence cannot masquerade as a successful refresh");
    mode = "inflight-settings-race";
    stored[FILTERS.NETWORK_FP_KEY] = null;
    const inflight = await FILTERS.rebuild();
    check(!inflight.installOk && dynamic.length === 1 && dynamic[0].id === 42 &&
      !enabled.has("easyprivacy") && enabled.has("easylist"), "an opt-out during native installation clears stale data and restores settings-aware fallback");
    mode = "ok";
    stored.strictTracking = true;
    await FILTERS.rebuild();
    stored.strictTracking = false;
    await CORE.prune(stored);
    check(!dynamic.some(rule => CORE.sourceForId(rule.id)?.id === "easyprivacy"), "tracking opt-out immediately removes its dynamic core group");
    await CORE.syncStatic(stored);
    check(!enabled.has("easyprivacy"), "tracking opt-out does not re-enable the static tracking fallback");
    await CORE.syncStatic({ ...stored, strictTracking: true });
    check(!enabled.has("easyprivacy"), "stale caller settings cannot override the currently persisted tracking opt-out");
    const withoutTracking = await FILTERS.rebuild();
    check(withoutTracking.core.rules === 8 && !withoutTracking.core.counts.easyprivacy, "later refresh continues honoring the tracking opt-out");
    dynamic = dynamic.filter(rule => CORE.sourceForId(rule.id)?.id !== "easylist");
    await CORE.syncStatic(stored);
    check(enabled.has("easylist") && !enabled.has("ublock-filters"), "missing replacement rules restore only the affected bundled fallback");
    calls.length = 0;
    await FILTERS.clear();
    check(calls[0] === "static" && dynamic.length === 1 && dynamic[0].id === 42, "clear restores fallback before removing owned core/regional rules");
    check(enabled.has("ublock-filters") && enabled.has("ublock-badware") && !enabled.has("easyprivacy"), "fallback restoration preserves user tracking settings and security coverage");
    let active = 0, peak = 0;
    await FILTERS.boundedJobs([1, 2, 3, 4, 5, 6], async () => {
      peak = Math.max(peak, ++active);
      await new Promise(resolve => setImmediate(resolve)); active--;
    });
    check(peak === 3, "downloads have a maximum concurrency of three");
    let stillActive = 0, started = 0;
    await assert.rejects(FILTERS.boundedJobs([1, 2, 3, 4, 5, 6], async item => {
      started++; stillActive++;
      try {
        if (item === 1) throw new Error("download failed");
        await new Promise(resolve => setImmediate(resolve));
      } finally { stillActive--; }
    }), /download failed/);
    check(stillActive === 0 && started < 6, "a failed pool settles active downloads and stops launching remaining sources");
    check(updateCalls > 0, "integration exercised the native update path");
  } finally {
    FILTERS.fetchText = oldText; FILTERS.fetchList = oldList; FILTERS.core = null;
  }
  console.log(`\nCore filters: ${passed} passed, 0 failed`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });

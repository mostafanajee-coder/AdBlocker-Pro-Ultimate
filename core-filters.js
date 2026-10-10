/* Official uBOL declarative rule snapshots; no remote JavaScript is loaded. */
"use strict";

const CORE_FILTERS = {
  API_URL: "https://api.github.com/repos/uBlockOrigin/uBOL-home/commits/main",
  RAW_ROOT: "https://raw.githubusercontent.com/uBlockOrigin/uBOL-home/",
  RULE_BASE: 200000,
  SOURCE_SLOTS: 20000,
  MAX_UNSAFE_RULES: 4900,
  MAX_REGEX_RULES: 950,
  REGEX_OFFSET: 19000,
  STATE_KEY: "coreFilterState",
  SOURCES: [
    { id: "ublock-filters", group: "ads", regex: true },
    { id: "easylist", group: "ads", regex: true },
    { id: "easyprivacy", group: "tracking", regex: true },
    { id: "pgl", group: "ads" },
    { id: "ublock-badware", group: "security", regex: true },
    { id: "urlhaus-full", group: "security" }
  ],

  owns(id) {
    return Number.isInteger(id) && id >= this.RULE_BASE &&
      id < this.RULE_BASE + this.SOURCES.length * this.SOURCE_SLOTS;
  },

  sourceForId(id) {
    return this.owns(id) ? this.SOURCES[Math.floor((id - this.RULE_BASE) / this.SOURCE_SLOTS)] : null;
  },

  enabled(source, settings) {
    if (source.group === "security") return true;
    if (source.group === "tracking") return settings.strictTracking !== false;
    return settings.adBlock !== false;
  },

  validate(id, rules, resources, kind = "main") {
    const sourceIndex = this.SOURCES.findIndex(source => source.id === id);
    if (!["main", "regex"].includes(kind) || sourceIndex < 0 || !Array.isArray(rules) || !rules.length ||
        rules.length > (kind === "regex" ? 1000 : this.REGEX_OFFSET)) {
      throw new Error("invalid core ruleset: " + id);
    }
    const allowedPaths = new Set(resources.map(resource => "/" + resource.replace(/^\//, "")));
    const conditionKeys = new Set([
      "domainType", "urlFilter", "isUrlFilterCaseSensitive", "initiatorDomains", "excludedInitiatorDomains",
      "requestDomains", "excludedRequestDomains", "resourceTypes", "excludedResourceTypes",
      "requestMethods", "excludedRequestMethods", "responseHeaders", "excludedResponseHeaders",
      "topDomains", "excludedTopDomains"
    ]);
    if (kind === "regex") conditionKeys.add("regexFilter");
    const ids = new Set();
    return rules.map((rule, index) => {
      if (!rule || Object.keys(rule).some(key => !["id", "priority", "action", "condition"].includes(key)) ||
          !Number.isInteger(rule.id) || rule.id < 1 || ids.has(rule.id) ||
          (rule.priority !== undefined && (!Number.isInteger(rule.priority) || rule.priority < 1)) ||
          !rule.condition || !Object.keys(rule.condition).length ||
          Object.keys(rule.condition).some(key => !conditionKeys.has(key))) {
        throw new Error("unsupported core rule shape in " + id);
      }
      ids.add(rule.id);
      if (kind === "regex" && (typeof rule.condition.regexFilter !== "string" ||
          !rule.condition.regexFilter || rule.condition.regexFilter.length > 2000 || rule.condition.urlFilter !== undefined)) {
        throw new Error("invalid core regex condition");
      }
      const action = rule.action;
      if (!action || !["block", "allow", "allowAllRequests", "redirect", "modifyHeaders"].includes(action.type)) {
        throw new Error("unsupported core action in " + id);
      }
      if (["block", "allow", "allowAllRequests"].includes(action.type)) {
        if (Object.keys(action).some(key => key !== "type")) throw new Error("unexpected core action fields");
      } else if (action.type === "redirect") {
        if (Object.keys(action).some(key => !["type", "redirect"].includes(key)) || !action.redirect) throw new Error("invalid core redirect");
        const redirect = action.redirect;
        if (redirect.extensionPath) {
          if (Object.keys(redirect).length !== 1 || !allowedPaths.has(redirect.extensionPath)) {
            throw new Error("core update needs an unshipped redirect resource");
          }
        } else if (redirect.regexSubstitution !== undefined) {
          // Accept only the upstream query-token removal shape. The first
          // capture preserves the URL prefix/origin; no new URL is supplied.
          if (kind !== "regex" || Object.keys(redirect).length !== 1 || redirect.regexSubstitution !== "\\1\\2" ||
              !/^\(\.\*\\\/[A-Za-z0-9/_-]+\\\?\.\*\)[A-Za-z0-9%_-]+\(\.\*\)$/.test(rule.condition.regexFilter)) {
            throw new Error("unsupported core regex redirect destination");
          }
        } else {
          const transform = redirect.transform;
          if (Object.keys(redirect).length !== 1 || !transform ||
              Object.keys(transform).some(key => !["query", "queryTransform"].includes(key)) ||
              (transform.query !== undefined && transform.query !== "")) throw new Error("unsupported core redirect destination");
          if (transform.queryTransform) {
            const query = transform.queryTransform;
            if (Object.keys(query).some(key => key !== "removeParams") || !Array.isArray(query.removeParams) ||
                !query.removeParams.length || query.removeParams.some(param => typeof param !== "string" || !param || param.length > 256)) {
              throw new Error("unsupported core query transform");
            }
          } else if (transform.query !== "") throw new Error("empty core redirect transform");
        }
      } else {
        if (Object.keys(action).some(key => !["type", "responseHeaders"].includes(key)) ||
            !Array.isArray(action.responseHeaders) || !action.responseHeaders.length) throw new Error("unsupported core header action");
        for (const header of action.responseHeaders) {
          if (!header || Object.keys(header).some(key => !["header", "operation", "value"].includes(key))) throw new Error("invalid header action");
          const append = ["content-security-policy", "permissions-policy"].includes(header.header) &&
            header.operation === "append" && typeof header.value === "string" && header.value.length <= 8192;
          const remove = ["set-cookie", "location", "refresh"].includes(header.header) &&
            header.operation === "remove" && header.value === undefined;
          if (!append && !remove) throw new Error("unsupported core header modification");
        }
      }
      const cloned = JSON.parse(JSON.stringify(rule));
      cloned.id = this.RULE_BASE + sourceIndex * this.SOURCE_SLOTS + (kind === "regex" ? this.REGEX_OFFSET : 0) + index;
      return cloned;
    });
  },

  async fetch(engine, settings) {
    const descriptor = JSON.parse(await engine.fetchText(this.API_URL));
    if (!descriptor || !/^[a-f0-9]{40}$/.test(descriptor.sha)) throw new Error("invalid upstream core revision");
    const manifest = chrome.runtime.getManifest();
    const resources = manifest.web_accessible_resources.flatMap(entry => entry.resources);
    const sources = this.SOURCES.filter(source => this.enabled(source, settings));
    const jobs = sources.flatMap(source => [{ source, kind: "main" }].concat(source.regex ? [{ source, kind: "regex" }] : []));
    const results = await engine.boundedJobs(jobs, async ({ source, kind }) => {
      const url = this.RAW_ROOT + descriptor.sha + "/chromium/rulesets/" + kind + "/" + source.id + ".json";
      const upstreamRules = JSON.parse(await engine.fetchText(url));
      const candidates = this.validate(source.id, upstreamRules, resources, kind);
      const rules = [], rejected = [];
      if (kind === "regex") {
        if (typeof chrome.declarativeNetRequest.isRegexSupported !== "function") throw new Error("native regex validation unavailable");
        for (const [index, rule] of candidates.entries()) {
          const supported = await chrome.declarativeNetRequest.isRegexSupported({ regex: rule.condition.regexFilter,
            isCaseSensitive: rule.condition.isUrlFilterCaseSensitive === true,
            requireCapturing: rule.action.type === "redirect" && rule.action.redirect.regexSubstitution !== undefined });
          if (!supported || typeof supported.isSupported !== "boolean") throw new Error("invalid native regex validation result");
          if (supported.isSupported) rules.push(rule);
          else rejected.push({ source: source.id, id: upstreamRules[index].id,
            reason: typeof supported.reason === "string" ? supported.reason.slice(0, 256) : "unsupported by Chrome" });
        }
      } else rules.push(...candidates);
      return { id: source.id, kind, rules, rejected, candidates: candidates.length };
    });
    const counts = {};
    for (const result of results) counts[result.id] = (counts[result.id] || 0) + result.rules.length;
    return {
      revision: descriptor.sha,
      counts,
      regex: results.filter(result => result.kind === "regex").reduce((sum, result) => sum + result.rules.length, 0),
      regexCandidates: results.filter(result => result.kind === "regex").reduce((sum, result) => sum + result.candidates, 0),
      regexRejected: results.flatMap(result => result.rejected),
      rules: results.flatMap(result => result.rules)
    };
  },

  async syncStatic(settings) {
    const stored = await chrome.storage.local.get([this.STATE_KEY]);
    const state = stored[this.STATE_KEY];
    const dynamic = state ? await chrome.declarativeNetRequest.getDynamicRules() : [];
    const counts = {};
    for (const rule of dynamic) {
      const source = this.sourceForId(rule.id);
      if (source) counts[source.id] = (counts[source.id] || 0) + 1;
    }
    // Callers may hold settings captured before asynchronous installation.
    // Prefer the latest persisted switches before changing static coverage.
    const latest = await chrome.storage.local.get(["adBlock", "useFilterLists", "strictTracking"]);
    settings = { ...settings };
    for (const key of ["adBlock", "useFilterLists", "strictTracking"]) {
      if (latest[key] !== undefined) settings[key] = latest[key];
    }
    const enableRulesetIds = [], disableRulesetIds = [];
    for (const source of this.SOURCES) {
      const live = settings.adBlock !== false && settings.useFilterLists !== false &&
        state && Number.isFinite(state.regex) && state.counts && state.counts[source.id] > 0 && counts[source.id] === state.counts[source.id];
      // Only the main lists are registered as static fallback. Raw regex
      // candidates can fail parsing before a worker is allowed to validate them.
      (this.enabled(source, settings) && !live ? enableRulesetIds : disableRulesetIds).push(source.id);
    }
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  },

  async prune(settings) {
    if (settings.adBlock === false || settings.useFilterLists === false) await this.syncStatic(settings);
    const current = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = current.filter(rule => {
      const source = this.sourceForId(rule.id);
      return source && (!this.enabled(source, settings) || settings.adBlock === false || settings.useFilterLists === false);
    }).map(rule => rule.id);
    if (removeRuleIds.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = CORE_FILTERS;
if (typeof self !== "undefined") self.CORE_FILTERS = CORE_FILTERS;

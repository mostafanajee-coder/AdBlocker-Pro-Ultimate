/* ============================================================================
 *  filters.js — source-aware filter-list pipeline for Ad Blocker Pro
 *
 *  Design goals
 *  ------------
 *  1. Treat bundled static DNR rules as the primary global network layer.
 *  2. Use dynamic DNR quota only for coverage that is not already bundled.
 *  3. Never broaden an upstream rule by silently ignoring syntax we do not
 *     understand. Unsupported options are rejected (fail closed).
 *  4. Deduplicate twice: raw text first, then the compiled DNR meaning.
 *  5. Compact redundant pure-domain rules (parent domain subsumes children).
 *  6. Keep source provenance and installation statistics for diagnostics.
 *  7. Replace only this engine's owned dynamic-rule ID range, atomically.
 *
 *  This pipeline is intentionally conservative. A smaller set of correctly
 *  translated rules is safer than a larger set whose semantics changed while
 *  being converted from ABP/AdGuard syntax to Manifest V3 DNR.
 * ========================================================================== */

"use strict";

const FILTERS = {
  MAX_DYNAMIC_RULES: 29000,      // Chrome safe-dynamic ceiling is 30,000; keep headroom.
  MAX_CANDIDATE_RULES: 60000,    // Pre-compaction guard against pathological source growth.
  MAX_COSMETIC_SELECTORS: 4000,
  RULE_ID_BASE: 100000,
  STORAGE_KEY: "filterLists",
  CSS_KEY: "cosmeticCss",
  NETWORK_FP_KEY: "filterNetworkFingerprint",
  COSMETIC_FP_KEY: "filterCosmeticFingerprint",
  FETCH_TIMEOUT_MS: 20000,

  // Site-specific element hiding ("example.com##.ad", "example.com#@#.ad").
  // Stored one key per domain so a page reads only its own entries; see
  // installSiteCosmetics() for why writes are incremental.
  SITE_CSS_PREFIX: "cf:",
  MAX_SITE_COSMETIC_BYTES: 6 * 1024 * 1024,  // chrome.storage.local holds 10 MB in total

  // These sites have dedicated modules (facebook.js, youtube.js, ...). List
  // rules there could fight those modules, and one over-broad selector on a
  // feed wrapper is exactly what once blanked the Facebook feed.
  SITE_COSMETIC_EXCLUDED: [
    "facebook.com", "messenger.com", "instagram.com",
    "youtube.com", "youtube-nocookie.com", "x.com", "twitter.com"
  ],

  /*
   * Source capabilities are explicit. EasyList/EasyPrivacy network rules are
   * already bundled as static DNR rulesets, so repeating them dynamically only
   * wastes the limited dynamic quota. EasyList is still useful for generic
   * cosmetic selectors, therefore it remains a cosmetic-only runtime source.
   */
  SOURCES: [
    {
      // Previously pointed at filters.adtidy.org/.../25.txt, which is AdGuard's
      // Mail Tracking Protection filter, not an Arabic list.
      id: "arabic",
      name: "Liste AR",
      url: "https://easylist-downloads.adblockplus.org/Liste_AR.txt",
      enabled: true,
      network: true,
      cosmetic: true,
      priority: 110,
      role: "regional"
    },
    {
      id: "easylist",
      name: "EasyList",
      url: "https://easylist.to/easylist/easylist.txt",
      enabled: true,
      network: false,
      cosmetic: true,
      priority: 100,
      role: "bundled-network/cosmetic-runtime",
      bundledRuleset: "easylist"
    },
    {
      id: "easyprivacy",
      name: "EasyPrivacy",
      url: "https://easylist.to/easylist/easyprivacy.txt",
      enabled: false,
      network: false,
      cosmetic: false,
      priority: 90,
      role: "bundled-network",
      bundledRuleset: "easyprivacy"
    },
    {
      id: "adguard-base",
      name: "AdGuard Base",
      url: "https://filters.adtidy.org/extension/chromium/filters/2.txt",
      enabled: true,
      network: false,
      cosmetic: true,
      priority: 80,
      role: "cosmetic-runtime"
    },
    {
      id: "annoyances",
      name: "Fanboy Annoyances",
      url: "https://secure.fanboy.co.nz/fanboy-annoyance.txt",
      enabled: false,
      network: true,
      cosmetic: true,
      priority: 70,
      role: "optional-annoyances"
    }
  ],

  /* Map common ABP/AdGuard option names onto Chrome resource types. */
  TYPE_MAP: {
    script: "script",
    image: "image",
    stylesheet: "stylesheet",
    css: "stylesheet",
    object: "object",
    xmlhttprequest: "xmlhttprequest",
    xhr: "xmlhttprequest",
    subdocument: "sub_frame",
    frame: "sub_frame",
    document: "main_frame",
    media: "media",
    font: "font",
    websocket: "websocket",
    ping: "ping",
    other: "other"
  },

  isManagedRuleId(id) {
    return Number.isInteger(id) &&
      id >= FILTERS.RULE_ID_BASE &&
      id < FILTERS.RULE_ID_BASE + FILTERS.MAX_DYNAMIC_RULES;
  },

  /* ---------------------------------------------------------------- *
   * Parsing                                                           *
   * ---------------------------------------------------------------- */

  /**
   * Convert one filter line into a DNR rule, or null when unsupported.
   * Unknown options are rejected instead of silently discarded.
   * @returns {null | {rule: object, isException: boolean}}
   */
  parseLine(line, id) {
    if (!line) return null;
    let s = line.trim();

    // comments, metadata, empty
    if (!s || s[0] === "!" || s[0] === "[" || s.startsWith("# ")) return null;

    // cosmetic / scriptlet rules are handled elsewhere (or deliberately skipped)
    if (s.includes("##") || s.includes("#@#") || s.includes("#?#") ||
        s.includes("#$#") || s.includes("#%#")) return null;

    const isException = s.startsWith("@@");
    if (isException) s = s.slice(2);

    // split off $options. Regex filters may contain '$', so do not split them.
    let optionsPart = "";
    if (!(s.startsWith("/") && s.endsWith("/"))) {
      const dollar = s.lastIndexOf("$");
      if (dollar > 0) {
        optionsPart = s.slice(dollar + 1);
        s = s.slice(0, dollar);
      }
    }

    if (!s) return null;

    // Slash-delimited regex filters: preserve only literal path fragments.
    if (s.length > 2 && s.startsWith("/") && s.endsWith("/")) {
      const inner = s.slice(1, -1);
      if (/[\\^$.|?*+()[\]{}]/.test(inner)) return null;
      if (inner.length < 3) return null;
      s = inner;
    }

    // DNR urlFilter must be ASCII and does not allow a pattern beginning ||*.
    if (/[^\x00-\x7F]/.test(s) || s.startsWith("||*")) return null;

    const condition = {};
    const resourceTypes = [];
    const excludedResourceTypes = [];
    let domains = null;
    let excludedDomains = null;

    if (optionsPart) {
      for (const rawOpt of optionsPart.split(",")) {
        const opt = rawOpt.trim();
        if (!opt) continue;

        if (opt === "third-party" || opt === "3p") {
          condition.domainType = "thirdParty";
          continue;
        }
        if (opt === "~third-party" || opt === "1p") {
          condition.domainType = "firstParty";
          continue;
        }
        if (opt === "match-case") {
          condition.isUrlFilterCaseSensitive = true;
          continue;
        }

        if (opt.startsWith("domain=")) {
          const list = opt.slice(7).split("|");
          const inc = [];
          const exc = [];
          for (const rawDomain of list) {
            if (!rawDomain) continue;
            const neg = rawDomain[0] === "~";
            const d = (neg ? rawDomain.slice(1) : rawDomain).trim().toLowerCase();
            // DNR domain fields cannot express ABP wildcard domain entries safely.
            if (!d || d.includes("*") || /[^a-z0-9._-]/.test(d) ||
                d.startsWith(".") || d.endsWith(".")) return null;
            (neg ? exc : inc).push(d);
          }
          if (inc.length) domains = inc;
          if (exc.length) excludedDomains = exc;
          continue;
        }

        const neg = opt[0] === "~";
        const base = neg ? opt.slice(1) : opt;
        const mapped = FILTERS.TYPE_MAP[base];
        if (mapped) {
          if (neg) excludedResourceTypes.push(mapped);
          else resourceTypes.push(mapped);
          continue;
        }

        // Any option not explicitly translated above is unsafe to ignore:
        // ignoring it can broaden the upstream rule and create false positives.
        return null;
      }
    }

    condition.urlFilter = s;

    const positive = Array.from(new Set(resourceTypes));
    const negative = Array.from(new Set(excludedResourceTypes));
    if (positive.some((type) => negative.includes(type))) return null;

    if (positive.length) condition.resourceTypes = positive;
    if (negative.length) condition.excludedResourceTypes = negative;
    if (domains) condition.initiatorDomains = Array.from(new Set(domains));
    if (excludedDomains) condition.excludedInitiatorDomains = Array.from(new Set(excludedDomains));

    // A urlFilter that is only punctuation matches far too much.
    if (!/[a-z0-9]/i.test(condition.urlFilter)) return null;
    if (condition.urlFilter.length < 4) return null;

    return {
      isException,
      rule: {
        id,
        priority: isException ? 2 : 1,
        action: { type: isException ? "allow" : "block" },
        condition
      }
    };
  },

  // Syntax that plain CSS cannot express (uBO/AdGuard/ABP extensions).
  EXTENDED_COSMETIC: /:(has-text|-abp-[a-z-]+|upward|xpath|matches-css(-before|-after)?|matches-attr|matches-path|min-text-length|watch-attr|remove|style|others|contains|if|if-not|nth-ancestor)\(|^\+js\(|^\^|\[-ext-/i,

  safeSelector(sel) {
    if (!sel || sel.length > 1000) return false;
    if (/[{}\n\r]/.test(sel) || sel.includes("/*")) return false;
    return FILTERS.balancedSelector(sel);
  },

  // An unclosed "(", "[" or quote makes the CSS parser swallow every rule
  // after it in the same stylesheet, so one broken selector would silently
  // switch off all the others injected alongside it.
  balancedSelector(sel) {
    let paren = 0;
    let bracket = 0;
    let quote = "";
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (ch === "\\") { i++; continue; }
      if (quote) {
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === "\"" || ch === "'") quote = ch;
      else if (ch === "(") paren++;
      else if (ch === ")" && --paren < 0) return false;
      else if (ch === "[") bracket++;
      else if (ch === "]" && --bracket < 0) return false;
    }
    return !quote && paren === 0 && bracket === 0;
  },

  isSiteCosmeticExcluded(domain) {
    for (const base of FILTERS.SITE_COSMETIC_EXCLUDED) {
      if (domain === base || domain.endsWith("." + base)) return true;
    }
    return false;
  },

  /**
   * Collect site-specific hiding rules into `into` (domain -> {h:Set, u:Set}).
   * "a.com,b.com##sel" hides sel on those sites (and their subdomains, which
   * content.js resolves); "a.com#@#sel" is an exception that also switches a
   * generic selector off there. Negated or wildcard domain lists and
   * extended/procedural selectors are skipped rather than approximated.
   */
  parseSiteCosmetic(text, into) {
    let count = 0;
    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s || s[0] === "!" || s[0] === "[") continue;

      let idx = s.indexOf("#@#");
      let unhide = true;
      if (idx <= 0) {
        idx = s.indexOf("##");
        unhide = false;
      }
      if (idx <= 0) continue;
      if (/#[?$%]#|#@[?$%]#/.test(s)) continue; // extended / scriptlet / CSS-injection forms

      const sel = s.slice(idx + (unhide ? 3 : 2)).trim();
      if (!FILTERS.safeSelector(sel) || FILTERS.EXTENDED_COSMETIC.test(sel)) continue;

      const domains = s.slice(0, idx).split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
      if (!domains.length || domains.some((d) => d[0] === "~" || d.includes("*") || !/^[a-z0-9.-]+$/.test(d))) continue;

      for (const d of domains) {
        if (d.startsWith(".") || d.endsWith(".") || !d.includes(".")) continue;
        if (FILTERS.isSiteCosmeticExcluded(d)) continue;
        let entry = into.get(d);
        if (!entry) { entry = { h: new Set(), u: new Set() }; into.set(d, entry); }
        (unhide ? entry.u : entry.h).add(sel);
        count++;
      }
    }
    return count;
  },

  /**
   * Persist site cosmetics as one "cf:<domain>" key per domain. After the
   * first build only changed domains are written and vanished ones removed:
   * every open tab's content scripts receive storage.onChanged with the full
   * changed values, so rewriting ~3 MB on each daily refresh would push all of
   * it into every tab.
   */
  async installSiteCosmetics(map) {
    const next = {};
    let bytes = 0;
    const domains = Array.from(map.keys()).sort();
    for (const d of domains) {
      const e = map.get(d);
      const value = {};
      if (e.h.size) value.h = Array.from(e.h).sort();
      if (e.u.size) value.u = Array.from(e.u).sort();
      const size = d.length + JSON.stringify(value).length;
      if (bytes + size > FILTERS.MAX_SITE_COSMETIC_BYTES) break;
      bytes += size;
      next[FILTERS.SITE_CSS_PREFIX + d] = value;
    }

    const all = await chrome.storage.local.get(null);
    const toSet = {};
    const toRemove = [];
    for (const key of Object.keys(all)) {
      if (key.indexOf(FILTERS.SITE_CSS_PREFIX) === 0 && !Object.prototype.hasOwnProperty.call(next, key)) toRemove.push(key);
    }
    for (const key of Object.keys(next)) {
      if (JSON.stringify(all[key]) !== JSON.stringify(next[key])) toSet[key] = next[key];
    }
    if (toRemove.length) await chrome.storage.local.remove(toRemove);
    if (Object.keys(toSet).length) await chrome.storage.local.set(toSet);
    return { domains: Object.keys(next).length, written: Object.keys(toSet).length, removed: toRemove.length, bytes };
  },

  /** Pull conservative generic element-hiding selectors out of a list. */
  parseCosmetic(text, maxSelectors) {
    const generic = [];
    let count = 0;

    for (const line of text.split("\n")) {
      const s = line.trim();
      if (!s || s[0] === "!") continue;

      const idx = s.indexOf("##");
      if (idx === -1 || idx > 0) continue; // domain-specific selectors need per-site scoping

      const sel = s.slice(idx + 2).trim();
      if (!FILTERS.safeSelector(sel) || sel.startsWith("+js") || sel.startsWith("^")) continue;
      if (sel.includes(":has(") || sel.includes(":not(:") ||
          sel.includes(":matches-css") || sel.includes(":xpath") ||
          sel.includes(":upward") || sel.includes(":style")) continue;

      generic.push(sel);
      if (++count >= maxSelectors) break;
    }
    return generic;
  },

  /** SHA-256 fingerprint with a deterministic fallback for test environments. */
  async fingerprint(text) {
    const value = String(text || "");
    try {
      if (typeof crypto !== "undefined" && crypto.subtle && typeof TextEncoder !== "undefined") {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
        return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
      }
    } catch (_) {}

    // FNV-1a fallback is only a change-detection optimization, never a trust check.
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return "fnv1a-" + (hash >>> 0).toString(16).padStart(8, "0") + "-" + value.length;
  },

  /** Canonical meaning of a compiled rule, excluding the transient rule ID. */
  canonicalRuleKey(rule) {
    function normalize(value) {
      if (Array.isArray(value)) return value.slice().sort();
      if (value && typeof value === "object") {
        const out = {};
        for (const key of Object.keys(value).sort()) out[key] = normalize(value[key]);
        return out;
      }
      return value;
    }
    return JSON.stringify(normalize({
      priority: rule.priority,
      action: rule.action,
      condition: rule.condition
    }));
  },

  /** Return a pure-domain rule descriptor, or null for more specific rules. */
  pureDomainRule(rule) {
    if (!rule || !rule.condition || !rule.action) return null;
    const keys = Object.keys(rule.condition);
    if (keys.length !== 1 || keys[0] !== "urlFilter") return null;
    if (rule.action.type !== "block" && rule.action.type !== "allow") return null;
    const match = /^\|\|([a-z0-9][a-z0-9._-]*\.[a-z0-9._-]+)\^$/i.exec(rule.condition.urlFilter);
    if (!match) return null;
    const domain = match[1].toLowerCase();
    if (domain.includes("..") || domain.startsWith(".") || domain.endsWith(".")) return null;
    return { domain, group: rule.action.type + ":" + String(rule.priority || 1) };
  },

  /**
   * Remove redundant child-domain rules when an equivalent parent rule exists.
   * Example: ||example.com^ makes ||ads.example.com^ redundant.
   */
  compactDomainRecords(records, perSourceStats) {
    const grouped = new Map();
    const passthrough = [];

    for (const rec of records) {
      const info = FILTERS.pureDomainRule(rec.rule);
      if (!info) {
        passthrough.push(rec);
        continue;
      }
      if (!grouped.has(info.group)) grouped.set(info.group, []);
      grouped.get(info.group).push(Object.assign({ domain: info.domain }, rec));
    }

    const kept = passthrough.slice();
    for (const list of grouped.values()) {
      list.sort((a, b) => {
        const labels = a.domain.split(".").length - b.domain.split(".").length;
        if (labels !== 0) return labels;
        if (a.domain.length !== b.domain.length) return a.domain.length - b.domain.length;
        return a.sequence - b.sequence;
      });

      const keptDomains = new Set();
      for (const rec of list) {
        const parts = rec.domain.split(".");
        let covered = false;
        for (let i = 1; i < parts.length; i++) {
          if (keptDomains.has(parts.slice(i).join("."))) {
            covered = true;
            break;
          }
        }
        if (covered) {
          const stat = perSourceStats.get(rec.sourceId);
          if (stat) stat.compacted++;
          continue;
        }
        keptDomains.add(rec.domain);
        kept.push(rec);
      }
    }

    kept.sort((a, b) => (b.sourcePriority - a.sourcePriority) || (a.sequence - b.sequence));
    return kept;
  },

  /* ---------------------------------------------------------------- *
   * Fetch + build                                                     *
   * ---------------------------------------------------------------- */

  validateListText(text) {
    if (typeof text !== "string" || text.length < 200) throw new Error("filter list is unexpectedly small");
    const sample = text.slice(0, 8192).toLowerCase();
    if (sample.includes("<!doctype html") || sample.includes("<html") ||
        sample.includes("<body") || sample.includes("<title>404")) {
      throw new Error("server returned HTML instead of a filter list");
    }

    let meaningful = 0;
    for (const raw of text.split("\n").slice(0, 1000)) {
      const line = raw.trim();
      if (!line || line[0] === "!" || line[0] === "[") continue;
      meaningful++;
      if (meaningful >= 3) return true;
    }
    throw new Error("filter list has no usable rules");
  },

  async fetchList(url) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), FILTERS.FETCH_TIMEOUT_MS) : null;
    try {
      const res = await fetch(url, {
        cache: "no-cache",
        signal: controller ? controller.signal : undefined
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const text = await res.text();
      FILTERS.validateListText(text);
      return text;
    } catch (err) {
      if (err && err.name === "AbortError") throw new Error("download timeout");
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  },

  /** Download selected runtime sources concurrently. */
  async fetchSelectedSources(selected, onProgress) {
    const jobs = selected.map(async (src) => {
      if (!src.network && !src.cosmetic) {
        return { src, skipped: true, reason: "bundled-static" };
      }
      if (onProgress) onProgress("Fetching " + src.name + "…");
      try {
        const text = await FILTERS.fetchList(src.url);
        return { src, ok: true, text };
      } catch (e) {
        return { src, ok: false, error: e && e.message ? e.message : String(e) };
      }
    });
    return Promise.all(jobs);
  },

  /**
   * Download enabled lists, compile conservatively, deduplicate and install.
   * @returns {Promise<object>} report
   */
  async rebuild(onProgress) {
    const stored = await chrome.storage.local.get([
      FILTERS.STORAGE_KEY,
      FILTERS.CSS_KEY,
      FILTERS.NETWORK_FP_KEY,
      FILTERS.COSMETIC_FP_KEY
    ]);
    const enabledIds = Array.isArray(stored[FILTERS.STORAGE_KEY])
      ? stored[FILTERS.STORAGE_KEY]
      : FILTERS.SOURCES.filter((src) => src.enabled).map((src) => src.id);

    const selected = FILTERS.SOURCES
      .filter((src) => enabledIds.includes(src.id))
      .slice()
      .sort((a, b) => b.priority - a.priority);

    const report = {
      sources: [],
      rules: 0,
      selectors: 0,
      truncated: false,
      candidateTruncated: false,
      at: Date.now(),
      stats: {
        candidates: 0,
        unsupported: 0,
        rawDuplicates: 0,
        semanticDuplicates: 0,
        compacted: 0,
        bundledNetworkSkipped: 0
      }
    };

    const fetchResults = await FILTERS.fetchSelectedSources(selected, onProgress);
    const resultById = new Map(fetchResults.map((result) => [result.src.id, result]));
    const sourceStats = new Map();

    for (const src of selected) {
      const result = resultById.get(src.id);
      const stat = {
        id: src.id,
        name: src.name,
        role: src.role || "community",
        mode: src.network ? (src.cosmetic ? "network+cosmetic" : "network") : (src.cosmetic ? "cosmetic-only" : "bundled-static"),
        ok: result ? result.ok !== false : false,
        rules: 0,
        selectors: 0,
        unsupported: 0,
        rawDuplicates: 0,
        semanticDuplicates: 0,
        compacted: 0,
        bytes: result && result.text ? result.text.length : 0
      };
      if (src.bundledRuleset && !src.network) {
        stat.skippedNetwork = src.bundledRuleset;
        report.stats.bundledNetworkSkipped++;
      }
      if (result && result.skipped) {
        stat.ok = true;
        stat.skipped = result.reason;
      } else if (result && result.ok === false) {
        stat.error = result.error;
      }
      sourceStats.set(src.id, stat);
      report.sources.push(stat);
    }

    const failedNetworkSources = selected.filter((src) => {
      const result = resultById.get(src.id);
      return src.network && (!result || result.ok === false);
    });

    const seenRaw = new Set();
    const seenSemantic = new Set();
    const selectors = new Set();
    const siteCosmetics = new Map();
    const candidates = [];
    let sequence = 0;

    for (const src of selected) {
      const result = resultById.get(src.id);
      const stat = sourceStats.get(src.id);
      if (!result || result.ok !== true || !result.text) continue;

      if (src.network && candidates.length < FILTERS.MAX_CANDIDATE_RULES) {
        for (const rawLine of result.text.split("\n")) {
          if (candidates.length >= FILTERS.MAX_CANDIDATE_RULES) {
            report.candidateTruncated = true;
            break;
          }

          const key = rawLine.trim();
          if (!key) continue;
          if (seenRaw.has(key)) {
            stat.rawDuplicates++;
            report.stats.rawDuplicates++;
            continue;
          }
          seenRaw.add(key);

          const parsed = FILTERS.parseLine(key, FILTERS.RULE_ID_BASE);
          if (!parsed) {
            // Count only non-comment/non-cosmetic lines as unsupported conversion.
            if (key[0] !== "!" && key[0] !== "[" && !key.includes("##") &&
                !key.includes("#@#") && !key.includes("#?#") &&
                !key.includes("#$#") && !key.includes("#%#")) {
              stat.unsupported++;
              report.stats.unsupported++;
            }
            continue;
          }

          const semanticKey = FILTERS.canonicalRuleKey(parsed.rule);
          if (seenSemantic.has(semanticKey)) {
            stat.semanticDuplicates++;
            report.stats.semanticDuplicates++;
            continue;
          }
          seenSemantic.add(semanticKey);

          candidates.push({
            rule: parsed.rule,
            isException: parsed.isException,
            sourceId: src.id,
            sourcePriority: src.priority,
            sequence: sequence++
          });
          stat.rules++;
          report.stats.candidates++;
        }
      }

      if (src.cosmetic && selectors.size < FILTERS.MAX_COSMETIC_SELECTORS) {
        const beforeSelectors = selectors.size;
        const remaining = FILTERS.MAX_COSMETIC_SELECTORS - selectors.size;
        for (const sel of FILTERS.parseCosmetic(result.text, remaining)) selectors.add(sel);
        stat.selectors += selectors.size - beforeSelectors;
      }
      if (src.cosmetic) stat.siteRules = FILTERS.parseSiteCosmetic(result.text, siteCosmetics);
    }

    // If any network-bearing source failed, never replace the previous known-good
    // network ruleset with a partial one.
    if (failedNetworkSources.length) {
      report.installOk = false;
      report.error = "One or more enabled network filter lists could not be downloaded; keeping the previous ruleset.";
      report.rules = await FILTERS.count();
      report.selectors = Array.isArray(stored[FILTERS.CSS_KEY]) ? stored[FILTERS.CSS_KEY].length : 0;
      return report;
    }

    const compacted = FILTERS.compactDomainRecords(candidates, sourceStats);
    report.stats.compacted = report.sources.reduce((sum, src) => sum + src.compacted, 0);

    const exceptions = compacted.filter((rec) => rec.isException);
    const blocks = compacted.filter((rec) => !rec.isException);
    const ordered = exceptions.concat(blocks);
    if (ordered.length > FILTERS.MAX_DYNAMIC_RULES) report.truncated = true;

    const selectedRecords = ordered.slice(0, FILTERS.MAX_DYNAMIC_RULES);
    for (const stat of report.sources) stat.installed = 0;
    for (const rec of selectedRecords) {
      const stat = sourceStats.get(rec.sourceId);
      if (stat) stat.installed++;
    }

    const all = selectedRecords.map((rec, index) => {
      const rule = JSON.parse(JSON.stringify(rec.rule));
      rule.id = FILTERS.RULE_ID_BASE + index;
      return rule;
    });

    report.rules = all.length;
    report.selectors = selectors.size;

    const networkFingerprint = await FILTERS.fingerprint(
      all.map((rule) => FILTERS.canonicalRuleKey(rule)).join("\n")
    );

    try {
      const existing = await chrome.declarativeNetRequest.getDynamicRules();
      const managedExisting = existing.filter((rule) => FILTERS.isManagedRuleId(rule.id));
      const removeIds = managedExisting.map((rule) => rule.id);
      const networkUnchanged = stored[FILTERS.NETWORK_FP_KEY] === networkFingerprint &&
        managedExisting.length === all.length;

      if (networkUnchanged) {
        report.installOk = true;
        report.networkChanged = false;
        report.installSkipped = "compiled rules unchanged";
        if (onProgress) onProgress("Network rules unchanged");
      } else {
        if (onProgress) onProgress("Installing " + all.length.toLocaleString() + " rules…");
        // Chrome performs remove+add as one atomic operation. If any compiled rule
        // is invalid, the previous working dynamic set remains intact.
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: removeIds,
          addRules: all
        });
        report.installOk = true;
        report.networkChanged = true;
        if (onProgress) onProgress("Installed " + all.length.toLocaleString() + " rules");
      }
    } catch (ruleErr) {
      report.installOk = false;
      report.error = ruleErr && ruleErr.message ? ruleErr.message : String(ruleErr);
      report.rules = await FILTERS.count();
      console.warn("[Filters] Dynamic rules update failed; previous rules kept:", report.error);
      return report;
    }

    // Keep old cosmetic CSS if any selected cosmetic source failed. A partial
    // cosmetic refresh can make pages visibly regress even when network rules
    // updated successfully.
    const cosmeticFailed = selected.some((src) => {
      if (!src.cosmetic) return false;
      const result = resultById.get(src.id);
      return !result || result.ok === false;
    });
    const cosmeticCss = cosmeticFailed && Array.isArray(stored[FILTERS.CSS_KEY])
      ? stored[FILTERS.CSS_KEY]
      : Array.from(selectors).slice(0, FILTERS.MAX_COSMETIC_SELECTORS);
    const cosmeticFingerprint = await FILTERS.fingerprint(cosmeticCss.join("\n"));
    report.selectors = cosmeticCss.length;
    report.cosmeticRefreshOk = !cosmeticFailed;
    report.cosmeticChanged = stored[FILTERS.COSMETIC_FP_KEY] !== cosmeticFingerprint;

    // Same rule as the generic CSS: a partial refresh would drop every site
    // whose rules came from the list that failed, so keep the previous set.
    if (!cosmeticFailed) {
      try {
        report.siteCosmetics = await FILTERS.installSiteCosmetics(siteCosmetics);
      } catch (siteErr) {
        report.siteCosmetics = { error: siteErr && siteErr.message ? siteErr.message : String(siteErr) };
      }
    }

    try {
      await chrome.storage.local.set({
        filterReport: report,
        [FILTERS.CSS_KEY]: cosmeticCss,
        [FILTERS.NETWORK_FP_KEY]: networkFingerprint,
        [FILTERS.COSMETIC_FP_KEY]: cosmeticFingerprint
      });
    } catch (_) {}

    return report;
  },

  /** Number of dynamic rules owned by this filter engine. */
  async count() {
    try {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      return rules.filter((rule) => FILTERS.isManagedRuleId(rule.id)).length;
    } catch (_) {
      return 0;
    }
  },

  /** Remove only dynamic rules owned by this filter engine. */
  async clear() {
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing
      .filter((rule) => FILTERS.isManagedRuleId(rule.id))
      .map((rule) => rule.id);
    if (removeRuleIds.length) {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds });
    }
    const all = await chrome.storage.local.get(null);
    const siteKeys = Object.keys(all).filter((key) => key.indexOf(FILTERS.SITE_CSS_PREFIX) === 0);
    if (siteKeys.length) await chrome.storage.local.remove(siteKeys);
    await chrome.storage.local.set({
      filterReport: null,
      [FILTERS.CSS_KEY]: [],
      [FILTERS.NETWORK_FP_KEY]: null,
      [FILTERS.COSMETIC_FP_KEY]: null
    });
  }
};

if (typeof module !== "undefined" && module.exports) module.exports = { FILTERS };
if (typeof self !== "undefined") self.FILTERS = FILTERS;

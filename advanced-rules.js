/* Original, data-only parser. Unsupported syntax is never approximated. */
(function (root) {
  "use strict";
  const EXTENDED = /:(?:has-text|upward|nth-ancestor|min-text-length|matches-[a-z-]+|xpath|others|watch-attr|remove|style|contains|if|if-not)\(/i;
  const API = {
    MAX_PROCEDURAL: 64,
    MAX_SCRIPTLETS: 32,
    EXCLUDED: ["facebook.com", "messenger.com", "youtube.com", "youtube-nocookie.com", "instagram.com", "x.com", "twitter.com"],
    excluded(host) { return this.EXCLUDED.some(base => host === base || host.endsWith("." + base)); },
    keys(host) {
      const parts = String(host || "").toLowerCase().split(".");
      return parts.slice(0, -1).map((_, index) => "cf:" + parts.slice(index).join("."));
    },
    unquote(value) {
      value = value.trim();
      if ((value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) {
        return value.slice(1, -1).replace(/\\([\\'"])/g, "$1");
      }
      return value;
    },
    argument(text, open) {
      let depth = 1, quote = "";
      for (let i = open + 1; i < text.length; i++) {
        const ch = text[i];
        if (ch === "\\") { i++; continue; }
        if (quote) { if (ch === quote) quote = ""; continue; }
        if ((ch === "'" || ch === '"') && (i === open + 1 || /[\s=,(]/.test(text[i - 1]))) quote = ch;
        else if (ch === "(") depth++;
        else if (ch === ")" && --depth === 0) return { value: text.slice(open + 1, i), end: i + 1 };
      }
      return null;
    },
    css(value) {
      if (typeof value !== "string" || !value.trim() || value.length > 1000 || /[{}\r\n]|\/\*/.test(value) || EXTENDED.test(value)) return false;
      let bracket = 0, paren = 0, quote = "";
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (ch === "\\") { i++; continue; }
        if (quote) { if (ch === quote) quote = ""; continue; }
        if (ch === "'" || ch === '"') quote = ch;
        else if (ch === "[") bracket++;
        else if (ch === "]" && --bracket < 0) return false;
        else if (ch === "(") paren++;
        else if (ch === ")" && --paren < 0) return false;
      }
      return !quote && bracket === 0 && paren === 0;
    },
    pattern(value) {
      if (typeof value !== "string") return null;
      value = this.unquote(value);
      if (!value || value.length > 256) return null;
      if (value.startsWith("/")) {
        const match = /^\/(.+)\/(i?)$/.exec(value);
        // Fixed alternatives/anchors/boundaries only: no quantifiers, groups,
        // lookarounds, backreferences, or arbitrary remotely supplied regex.
        if (!match || !/^[\p{L}\p{N}\s._,:;!\-/\\^$|]+$/u.test(match[1]) ||
            /\\(?![b\\/.^$|])/.test(match[1]) || match[1].split("|").some(part => !part || part.length > 128) ||
            match[1].split("|").length > 8 || !/[\p{L}\p{N}]/u.test(match[1])) return null;
        try { new RegExp(match[1], match[2]); } catch (_) { return null; }
        return { regex: match[1], flags: match[2] };
      }
      return { literal: value };
    },
    matcher(pattern) {
      if (!pattern) return () => false;
      if (pattern.literal !== undefined) return text => text.includes(pattern.literal);
      const regex = new RegExp(pattern.regex, pattern.flags);
      return text => regex.test(text);
    },
    procedural(raw, depth = 0, nested = false) {
      if (typeof raw !== "string" || raw.length > 1000 || depth > 2 || /[{}\r\n]|\/\*/.test(raw)) return null;
      raw = raw.trim();
      if (nested && raw.startsWith(":")) raw = ":scope" + raw;
      let first = -1;
      // Skip native CSS function arguments rather than treating a nested
      // procedural operator as if it were part of the outer selector.
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === "\\") { i++; continue; }
        if (raw[i] === "[") {
          let quote = "";
          while (++i < raw.length) {
            if (raw[i] === "\\") { i++; continue; }
            if (quote) { if (raw[i] === quote) quote = ""; }
            else if (raw[i] === "'" || raw[i] === '"') quote = raw[i];
            else if (raw[i] === "]") break;
          }
          continue;
        }
        const token = /^:([a-z-]+)\(/i.exec(raw.slice(i));
        if (!token) continue;
        const arg = this.argument(raw, i + token[0].length - 1);
        if (!arg) return null;
        const op = token[1].toLowerCase();
        if (["has-text", "upward", "min-text-length"].includes(op) ||
            (["has", "not"].includes(op) && EXTENDED.test(arg.value))) { first = i; break; }
        i = arg.end - 1;
      }
      if (first < 0) {
        if (!nested || !this.css(raw)) return null;
        return { selector: /^[>+~]/.test(raw) ? ":scope " + raw : raw, tasks: [] };
      }
      const selector = raw.slice(0, first).trim();
      if (!this.css(selector) || (!nested && !/[.#\[>]/.test(selector))) return null;
      const tasks = [];
      let cursor = first;
      while (cursor < raw.length) {
        const token = /^:(has-text|upward|min-text-length|has|not)\(/.exec(raw.slice(cursor));
        if (!token || tasks.length >= 4) return null;
        const arg = this.argument(raw, cursor + token[0].length - 1);
        if (!arg) return null;
        const op = token[1], value = arg.value.trim();
        let task;
        if (op === "has-text") {
          const pattern = this.pattern(value);
          if (!pattern) return null;
          task = { op, pattern };
        } else if (op === "upward") {
          if (/^[1-8]$/.test(value)) task = { op, distance: Number(value) };
          else if (this.css(value) && !/^\d+$/.test(value) && !/^(?:html|body|main|\*)$/i.test(value)) task = { op, selector: value };
          else return null;
        } else if (op === "min-text-length") {
          if (!/^\d{1,4}$/.test(value) || Number(value) > 8192) return null;
          task = { op, length: Number(value) };
        } else {
          const program = this.procedural(value, depth + 1, true);
          if (!program) return null;
          task = { op, program: { selector: program.selector, tasks: program.tasks } };
        }
        tasks.push(task);
        cursor = arg.end;
      }
      const result = { selector, tasks };
      return { ...result, raw, key: JSON.stringify(result) };
    },
    scriptlet(raw) {
      if (typeof raw !== "string" || raw.length > 1000 || !raw.startsWith("+js(") || !raw.endsWith(")")) return null;
      const arg = this.argument(raw, 3);
      if (!arg || arg.end !== raw.length) return null;
      const pieces = []; let start = 0, quote = "";
      for (let i = 0; i <= arg.value.length; i++) {
        const ch = arg.value[i];
        if (ch === "\\") { i++; continue; }
        if (quote) { if (ch === quote) quote = ""; continue; }
        if (ch === "'" || ch === '"') { quote = ch; continue; }
        if (ch === "," || i === arg.value.length) { pieces.push(this.unquote(arg.value.slice(start, i))); start = i + 1; }
      }
      if (quote || pieces.some(value => value.length > 256)) return null;
      const aliases = { set: "set-constant", "set-constant": "set-constant", aopr: "abort-on-property-read",
        "abort-on-property-read": "abort-on-property-read", nostif: "no-setTimeout-if", "no-setTimeout-if": "no-setTimeout-if" };
      const name = aliases[pieces[0].replace(/\.js$/, "")];
      const args = pieces.slice(1);
      if (!name) return null;
      if (name === "no-setTimeout-if") {
        if (args.length < 1 || args.length > 2 || !this.pattern(args[0]) || args[0].length < 4 ||
            args[0].startsWith("!") ||
            (args.length === 2 && (!/^\d{1,5}$/.test(args[1]) || Number(args[1]) > 60000))) return null;
      } else {
        if (args.length !== (name === "set-constant" ? 2 : 1) ||
            !/^[a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*){0,5}$/.test(args[0]) ||
            args[0].split(".").some(part => ["__proto__", "prototype", "constructor"].includes(part))) return null;
        if (["Object", "Function", "eval", "fetch", "XMLHttpRequest", "document", "navigator", "location", "localStorage",
          "sessionStorage", "chrome", "browser", "Promise", "Reflect", "Array", "JSON", "console", "postMessage", "history",
          "setTimeout", "clearTimeout", "setInterval", "clearInterval", "addEventListener", "removeEventListener",
          "__abpScriptletEngineV1", "ADV_RULES"].includes(args[0].split(".")[0])) return null;
        if (name === "set-constant" && !["true", "false", "null", "undefined", "", "0", "1", "noopFunc", "trueFunc", "falseFunc"].includes(args[1])) return null;
      }
      return { name, args, raw, key: JSON.stringify([name, ...args]) };
    },
    collect(store, host) {
      const p = new Map(), s = new Map(), pu = new Set(), su = new Set();
      let allScriptsExcepted = false;
      for (const key of this.keys(host)) {
        const entry = store[key] || {};
        for (const raw of entry.p || []) { const rule = this.procedural(raw); if (rule) p.set(rule.key, rule); }
        for (const raw of entry.pu || []) { const rule = this.procedural(raw); if (rule) pu.add(rule.key); }
        for (const raw of entry.s || []) { const rule = this.scriptlet(raw); if (rule) s.set(rule.key, rule); }
        for (const raw of entry.su || []) {
          if (raw === "+js()") { allScriptsExcepted = true; continue; }
          const rule = this.scriptlet(raw); if (rule) su.add(rule.key);
        }
      }
      return {
        procedural: [...p.values()].filter(rule => !pu.has(rule.key)).slice(0, this.MAX_PROCEDURAL),
        scriptlets: allScriptsExcepted ? [] : [...s.values()].filter(rule => !su.has(rule.key)).slice(0, this.MAX_SCRIPTLETS)
      };
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.ADV_RULES = API;
})(typeof globalThis !== "undefined" ? globalThis : self);

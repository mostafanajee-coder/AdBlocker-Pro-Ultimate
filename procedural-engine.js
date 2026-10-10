/* Bounded, reversible, site-scoped DOM filtering. No DOM removal/remounting. */
(function (root) {
  "use strict";
  const rules = typeof module !== "undefined" && module.exports ? require("./advanced-rules.js") : root.ADV_RULES;
  function create(document, env = {}) {
    const schedule = env.setTimeout || root.setTimeout.bind(root);
    const cancel = env.clearTimeout || root.clearTimeout.bind(root);
    const Observer = env.MutationObserver || root.MutationObserver;
    const now = env.now || (() => performance.now());
    const token = "abp-" + Math.random().toString(36).slice(2);
    const attribute = "data-abp-procedural";
    const owned = new Map();
    let programs = [], observer = null, timer = null, style = null;
    let cursor = 0, desired = new Set(), dirty = false;
    const stats = { runs: 0, tested: 0, hidden: 0 };
    const stylesheet = `[${attribute}="${token}"] { display: none !important; }`;
    function ensureStyle() {
      if (!document.documentElement) return;
      if (!style || style.isConnected === false) {
        style = document.createElement("style");
        style.textContent = stylesheet;
        document.documentElement.appendChild(style);
      } else if (style.textContent !== stylesheet) style.textContent = stylesheet;
    }

    function safeTarget(node) {
      if (!node || node.nodeType !== 1 || node.isConnected === false) return false;
      try {
        if (env.isUnsafeTarget && env.isUnsafeTarget(node)) return false;
        if (node.matches("html,body,head,main,nav,header,[role='main'],[role='feed'],[role='navigation'],[role='banner']")) return false;
        if (node.querySelector("main,nav,[role='main'],[role='feed'],[role='navigation'],[role='banner']")) return false;
        if (node.querySelectorAll("article").length > 1) return false;
      } catch (_) { return false; }
      return true;
    }
    function select(scope, program, limit) {
      if (program.selector === ":scope" && scope.nodeType === 1) return [scope];
      try { return Array.from(scope.querySelectorAll(program.selector)).slice(0, limit); }
      catch (_) { return []; }
    }
    function evaluate(scope, program, limit = 300, depth = 0) {
      if (depth > 2) return [];
      let nodes = select(scope, program, limit);
      for (const task of program.tasks) {
        if (task.op === "has-text") {
          const match = rules.matcher(task.pattern);
          nodes = nodes.filter(node => match((node.textContent || "").slice(0, 8192)));
        } else if (task.op === "min-text-length") {
          nodes = nodes.filter(node => (node.textContent || "").slice(0, 8192).length >= task.length);
        } else if (task.op === "has" || task.op === "not") {
          nodes = nodes.filter(node => (evaluate(node, task.program, 32, depth + 1).length > 0) === (task.op === "has"));
        } else if (task.op === "upward") {
          nodes = nodes.map(node => {
            let parent = node;
            for (let i = 0; i < (task.distance || 8); i++) {
              parent = parent.parentElement;
              if (!parent) return null;
              if (task.selector && parent.matches(task.selector)) return parent;
            }
            return task.distance ? parent : null;
          }).filter(Boolean);
        }
      }
      return nodes;
    }
    function release(node, old) {
      if (node.getAttribute(attribute) !== token) return;
      if (old === null) node.removeAttribute(attribute);
      else node.setAttribute(attribute, old);
    }
    function reconcile() {
      for (const [node, old] of owned) {
        if (!desired.has(node) || !safeTarget(node)) { release(node, old); owned.delete(node); }
      }
      for (const node of desired) {
        if (!safeTarget(node)) continue;
        const current = node.getAttribute(attribute);
        if (!owned.has(node) || current !== token) owned.set(node, current);
        if (current !== token) node.setAttribute(attribute, token);
      }
      stats.hidden = owned.size;
    }
    function queue(delay = 80) {
      if (!programs.length || timer !== null) return;
      timer = schedule(() => { timer = null; run(); }, delay);
    }
    function run() {
      if (!programs.length) return;
      ensureStyle();
      if (cursor === 0) { desired = new Set(); dirty = false; }
      const start = now();
      let processed = 0;
      stats.runs++;
      do {
        const program = programs[cursor++];
        try {
          for (const node of evaluate(document, program)) if (desired.size < 1000 && safeTarget(node)) desired.add(node);
        } catch (_) { /* One invalid selector cannot disable the other rules. */ }
        stats.tested++; processed++;
      } while (cursor < programs.length && processed < 8 && now() - start < 8);
      if (cursor < programs.length) { queue(); return; }
      reconcile(); cursor = 0;
      if (dirty) queue();
    }
    function stop() {
      if (timer !== null) cancel(timer);
      timer = null;
      if (observer) observer.disconnect();
      observer = null;
      for (const [node, old] of owned) release(node, old);
      owned.clear();
      if (style) style.remove();
      style = null; programs = []; cursor = 0; desired.clear(); dirty = false; stats.hidden = 0;
    }
    function setRules(rawRules) {
      stop();
      programs = rawRules.slice(0, rules.MAX_PROCEDURAL).flatMap(rule => {
        const parsed = rules.procedural(typeof rule === "string" ? rule : rule.raw);
        return parsed ? [parsed] : [];
      });
      if (!programs.length) return;
      const node = document.documentElement;
      if (!node) return; // content.js retries when DOMContentLoaded arrives.
      ensureStyle();
      if (Observer) {
        observer = new Observer(records => {
          if (records.every(record => record.type === "attributes" && record.attributeName === attribute &&
              record.target.getAttribute(attribute) === token)) return;
          dirty = true; queue();
        });
        const attributes = new Set(["id", "class", "hidden", "role", attribute]);
        for (const program of programs) for (const match of program.raw.matchAll(/\[([\w:-]+)/g)) attributes.add(match[1]);
        observer.observe(node, { childList: true, subtree: true, characterData: true,
          attributes: true, attributeFilter: [...attributes] });
      }
      queue(0);
    }
    return { setRules, stop, run, stats };
  }
  const API = { create };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else root.PROCEDURAL_ENGINE = API;
})(typeof globalThis !== "undefined" ? globalThis : self);

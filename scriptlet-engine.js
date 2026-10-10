/* Fixed packaged implementations; remote data cannot supply function bodies. */
(function (root) {
  "use strict";
  const rules = typeof module !== "undefined" && module.exports ? require("./advanced-rules.js") : root.ADV_RULES;
  function create(target) {
    let cleanups = [], fingerprint = "";
    function stop() {
      for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch (_) {} }
      cleanups = []; fingerprint = "";
    }
    function property(rule) {
      const path = rule.args[0].split(".");
      let object = target;
      for (const part of path.slice(0, -1)) {
        const descriptor = Object.getOwnPropertyDescriptor(object, part);
        // Do not invoke page getters or synthesize parent objects.
        if (!descriptor || !("value" in descriptor) || !descriptor.value ||
            !["object", "function"].includes(typeof descriptor.value)) return;
        object = descriptor.value;
      }
      const key = path.at(-1);
      const original = Object.getOwnPropertyDescriptor(object, key);
      if (original && (!original.configurable || !("value" in original))) return;
      const constants = { true: true, false: false, null: null, undefined: undefined, "": "", "0": 0, "1": 1,
        noopFunc: function () {}, trueFunc: function () { return true; }, falseFunc: function () { return false; } };
      const value = constants[rule.args[1]];
      if (rule.name === "set-constant" && original && original.value !== undefined && typeof original.value !== typeof value) return;
      let assigned = false, latest = original && original.value;
      let active = true;
      const getter = rule.name === "abort-on-property-read" ?
        function () { throw new ReferenceError("Blocked ad property read"); } : function () { return active ? value : latest; };
      const setter = function (next) {
        assigned = true; latest = next;
        if (rule.name === "set-constant" && next !== undefined && typeof next !== typeof value) active = false;
      };
      Object.defineProperty(object, key, { configurable: true, enumerable: original ? original.enumerable : true, get: getter, set: setter });
      cleanups.push(() => {
        const current = Object.getOwnPropertyDescriptor(object, key);
        if (!current || current.get !== getter || current.set !== setter) return;
        if (original) Object.defineProperty(object, key, assigned && original.writable ? { ...original, value: latest } : original);
        else {
          delete object[key];
          if (assigned) Object.defineProperty(object, key, { value: latest, writable: true, enumerable: true, configurable: true });
        }
      });
    }
    function timers(list) {
      if (!list.length || typeof target.setTimeout !== "function") return;
      const original = target.setTimeout;
      const configs = list.map(rule => ({ match: rules.matcher(rules.pattern(rule.args[0])),
        delay: rule.args.length === 2 ? Number(rule.args[1]) : null }));
      const toString = Function.prototype.toString;
      function wrapped(callback, delay, ...args) {
        let source = "";
        try { source = typeof callback === "function" ? Reflect.apply(toString, callback, []) : typeof callback === "string" ? callback : ""; } catch (_) {}
        const blocked = configs.some(config => (config.delay === null || Number(delay || 0) === config.delay) && config.match(source.slice(0, 4096)));
        // Return a real cancelable timer ID, without running the blocked code.
        return Reflect.apply(original, this, blocked ? [function () {}, 0] : [callback, delay, ...args]);
      }
      target.setTimeout = wrapped;
      if (target.setTimeout !== wrapped) return;
      cleanups.push(() => { if (target.setTimeout === wrapped) target.setTimeout = original; });
    }
    function apply(rawRules) {
      const parsed = rawRules.slice(0, rules.MAX_SCRIPTLETS).flatMap(raw => {
        const rule = rules.scriptlet(typeof raw === "string" ? raw : raw.raw);
        return rule ? [rule] : [];
      });
      const next = JSON.stringify(parsed.map(rule => rule.key).sort());
      if (next === fingerprint) return { applied: cleanups.length };
      stop();
      for (const rule of parsed.filter(rule => rule.name !== "no-setTimeout-if")) {
        try { property(rule); } catch (_) {}
      }
      try { timers(parsed.filter(rule => rule.name === "no-setTimeout-if")); } catch (_) {}
      fingerprint = next;
      return { applied: cleanups.length };
    }
    return { apply, stop };
  }
  if (typeof module !== "undefined" && module.exports) module.exports = { create };
  else if (!root.__abpScriptletEngineV1) {
    Object.defineProperty(root, "__abpScriptletEngineV1", { value: create(root), configurable: true });
  }
})(typeof globalThis !== "undefined" ? globalThis : self);

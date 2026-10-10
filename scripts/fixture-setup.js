"use strict";
window.__engineFixtureFlag = true;
window.fixtureRule = ".ad-label:has-text(Sponsored):upward(.fixture-card)";
window.fixtureKey = "cf:" + location.hostname;
window.fixtureStore = { adBlock: true, useFilterLists: true, antiAdblock: true, whitelist: [], cosmeticCss: [],
  [window.fixtureKey]: { p: [window.fixtureRule], s: ["+js(set, __engineFixtureFlag, false)"] } };
window.fixtureListeners = [];
window.chrome = {
  storage: {
    local: { get: (keys, callback) => setTimeout(() => callback(Object.fromEntries(keys.map(key => [key, window.fixtureStore[key]]))), 0) },
    onChanged: { addListener: callback => window.fixtureListeners.push(callback) }
  },
  runtime: {
    onMessage: { addListener() {} },
    sendMessage: (message, callback) => {
      if (message.type !== "syncEngineScriptlets") { if (callback) callback({}); return; }
      const store = window.fixtureStore;
      const enabled = store.adBlock !== false && store.useFilterLists !== false && store.antiAdblock === true && !store.whitelist.includes(location.hostname);
      const result = window.__abpScriptletEngineV1.apply(enabled ? ADV_RULES.collect(store, location.hostname).scriptlets : []);
      if (callback) callback(result);
    }
  }
};
window.fixtureUpdate = patch => {
  const changes = {};
  for (const key of Object.keys(patch)) {
    changes[key] = { oldValue: window.fixtureStore[key], newValue: patch[key] };
    window.fixtureStore[key] = patch[key];
  }
  for (const listener of window.fixtureListeners) listener(changes, "local");
};

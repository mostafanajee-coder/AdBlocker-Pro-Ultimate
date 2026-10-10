"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "youtube.js"), "utf8");
let passed = 0;
function check(condition, label) { assert.ok(condition, label); passed++; console.log("  PASS ", label); }

function harness(options = {}) {
  const microtasks = [];
  const timers = new Map();
  const docListeners = new Map();
  const windowListeners = new Map();
  const storageListeners = [];
  const observers = [];
  const styles = new Map();
  let timerId = 0;
  let rafCalls = 0;
  const settings = { adBlock: true, ytSkip: true, ...options.settings };
  const video = {
    tagName: "VIDEO", muted: !!options.muted, paused: !!options.paused, ended: false,
    currentTime: 5, duration: 20, playCalls: 0,
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  };
  const player = {
    ad: !!options.ad, video, skipCalls: 0,
    classList: { contains(name) { return player.ad && name === "ad-showing"; } },
    querySelector() { return this.video; },
    querySelectorAll() { return []; },
    skipAd() { this.skipCalls++; if (options.onSkip) options.onSkip(player, video); }
  };
  const attributes = new Map();
  const doc = {
    hidden: !!options.hidden,
    currentPlayer: player,
    documentElement: {
      setAttribute: (name, value) => attributes.set(name, value),
      getAttribute: name => attributes.get(name) || null,
      removeAttribute: name => attributes.delete(name)
    },
    head: { appendChild: element => styles.set(element.id, element) },
    createElement: () => ({ id: "", textContent: "" }),
    getElementById: id => id === "movie_player" ? doc.currentPlayer : styles.get(id),
    querySelector: selector => selector.includes("video") ? doc.currentPlayer.video : doc.currentPlayer,
    querySelectorAll: () => [],
    contains: element => !!doc.currentPlayer && doc.currentPlayer.video === element,
    addEventListener(name, callback) {
      if (!docListeners.has(name)) docListeners.set(name, []);
      docListeners.get(name).push(callback);
    }
  };
  const window = {
    location: { hostname: "www.youtube.com", pathname: "/watch", search: "?v=ordinary" },
    addEventListener(name, callback) {
      if (!windowListeners.has(name)) windowListeners.set(name, []);
      windowListeners.get(name).push(callback);
    }
  };
  const chrome = { storage: {
    local: { get: (_keys, callback) => callback(settings) },
    onChanged: { addListener: callback => storageListeners.push(callback) }
  } };
  const context = {
    window, document: doc, chrome, console,
    queueMicrotask: callback => microtasks.push(callback),
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    requestAnimationFrame: () => { rafCalls++; return 1; }, // never fires in a hidden tab
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() {}
    }
  };
  vm.runInNewContext(source, context);
  function flush() {
    for (let i = 0; microtasks.length && i < 100; i++) microtasks.shift()();
    assert.equal(microtasks.length, 0, "microtasks must quiesce");
  }
  function dispatch(name, fields = {}) { for (const callback of docListeners.get(name) || []) callback({ type: name, ...fields }); }
  function tick() {
    const pending = [...timers.values()];
    timers.clear();
    pending.forEach(callback => callback());
    flush();
  }
  return {
    doc, window, video, player, timers, attributes, flush, tick, dispatch,
    rafCalls: () => rafCalls,
    mutatePlayer() { observers.filter(observer => observer.target === player).forEach(observer => observer.callback([])); flush(); },
    settings(patch) { Object.assign(settings, patch); storageListeners.forEach(callback => callback(Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { newValue }])), "local")); flush(); }
  };
}

{
  const h = harness(); h.flush();
  h.doc.hidden = true; h.dispatch("visibilitychange"); h.flush();
  check(!h.video.paused && h.video.currentTime === 5 && h.video.playCalls === 0, "switching tabs leaves normal playback uninterrupted");
  check(!h.video.muted && h.timers.size === 0, "normal background playback is neither muted nor polled");
  const paused = harness({ paused: true }); paused.flush();
  paused.doc.hidden = true; paused.dispatch("visibilitychange"); paused.flush();
  check(paused.video.paused && paused.video.playCalls === 0, "switching tabs never starts a manually paused normal video");
}
{
  const h = harness({ ad: true, hidden: true }); h.flush();
  check(h.video.currentTime === 20 && h.video.muted, "an active ad is suppressed in a hidden tab");
  check(h.rafCalls() === 0 && h.timers.size === 1, "hidden-tab ad recovery does not wait for animation frames");
  h.player.ad = false; h.video.currentTime = 0; h.video.duration = 900; h.video.paused = true;
  h.tick();
  check(!h.video.muted && !h.video.paused && h.video.playCalls === 1, "background ad completion restores audio and resumes previously playing content");
  check(h.timers.size === 0 && !h.attributes.has("data-abp-yt-ad-active"), "successful background recovery removes cover and pending retries");
}
{
  const h = harness({ ad: true, onSkip(player, video) { player.ad = false; video.currentTime = 42; video.duration = 900; } }); h.flush();
  check(h.video.currentTime === 42, "a synchronous ad skip does not seek the normal video to its end");
  check(!h.video.muted && h.timers.size === 0, "a successful synchronous skip does not leave a mute or retry behind");
}
{
  const h = harness({ ad: true }); h.flush();
  h.dispatch("click", { isTrusted: true, target: { closest(selector) { return selector.includes("ytp-play-button") ? {} : null; } } });
  h.video.paused = true; h.video.currentTime = 0; h.video.duration = 900; h.player.ad = false;
  h.mutatePlayer();
  check(h.video.paused && h.video.playCalls === 0, "ad cleanup respects a trusted manual pause");
  check(!h.video.muted, "manual pause does not prevent restoring original audio settings");
}
{
  const h = harness({ ad: true, paused: true }); h.flush();
  h.video.paused = false;
  h.dispatch("playing", { target: h.video }); h.flush();
  h.player.ad = false; h.video.paused = true; h.video.ended = false; h.video.currentTime = 0;
  h.mutatePlayer();
  check(h.video.playCalls === 1, "playback that starts after initial ad metadata is remembered for recovery");
  const keyboard = harness({ ad: true }); keyboard.flush();
  keyboard.dispatch("keydown", { isTrusted: true, key: "k", target: { closest: () => null } });
  keyboard.video.paused = true; keyboard.player.ad = false; keyboard.video.currentTime = 0;
  keyboard.mutatePlayer();
  check(keyboard.video.playCalls === 0, "the YouTube keyboard pause shortcut also suppresses automatic resume");
}
{
  const h = harness({ ad: true, hidden: true }); h.flush();
  for (let i = 0; i < 20; i++) h.tick();
  check(h.timers.size === 0 && h.player.skipCalls <= 13, "persistent ads have a finite recovery budget");
  const disabled = harness({ ad: true, settings: { ytSkip: false } }); disabled.flush();
  check(!disabled.video.muted && disabled.video.currentTime === 5 && disabled.player.skipCalls === 0, "YouTube disable prevents ad seeks, muting and clicks");
}
{
  const h = harness({ ad: true }); h.flush();
  const replacement = { video: { ...h.video, paused: true, playCalls: 0 }, classList: { contains: () => false }, querySelector() { return this.video; }, querySelectorAll: () => [] };
  h.doc.currentPlayer = replacement;
  h.dispatch("visibilitychange"); h.flush();
  check(h.video.playCalls === 0 && replacement.video.playCalls === 0, "player replacement never restarts the old video or a paused new video");
  check(!h.video.muted, "player replacement releases the previous media mute");
  const ended = harness({ ad: true }); ended.flush();
  ended.player.ad = false; ended.video.paused = true; ended.video.ended = true;
  ended.dispatch("ended", { target: ended.video }); ended.flush();
  check(ended.video.playCalls === 0, "cleanup never replays ended media");
}

console.log(`\nYouTube playback: ${passed} passed, 0 failed`);

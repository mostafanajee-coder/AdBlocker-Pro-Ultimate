/*
 * facebook-orchestration.test.js
 *
 * Runs the real facebook.js content script against a deliberately small DOM
 * and MutationObserver harness. The detector itself is covered separately by
 * fb-detect.test.js; this file exercises the observer, cache, scheduler, and
 * card-local sweeps that connect DOM changes to hiding a post.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "facebook.js"), "utf8");

function splitGroups(selector) {
  const groups = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "[") {
      depth++;
    } else if (ch === "]") {
      depth--;
    } else if (ch === "," && depth === 0) {
      groups.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  groups.push(selector.slice(start).trim());
  return groups.filter(Boolean);
}

function splitDescendants(selector) {
  const tokens = [];
  let current = "";
  let depth = 0;
  let quote = "";
  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
    } else if (ch === "[") {
      depth++;
      current += ch;
    } else if (ch === "]") {
      depth--;
      current += ch;
    } else if (/\s/.test(ch) && depth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function parseAttribute(raw) {
  const match = /^([^\s~|^$*!=]+)\s*(?:(\*=|\^=|\$=|~=|\|=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?\s*(i)?$/.exec(raw.trim());
  if (!match) return null;
  return {
    name: match[1],
    operator: match[2] || null,
    value: match[3] !== undefined ? match[3] :
           match[4] !== undefined ? match[4] : match[5],
    insensitive: !!match[6]
  };
}

function matchesSimple(element, simple) {
  if (!element || element.nodeType !== 1) return false;

  let rest = simple;
  const tag = /^([a-zA-Z][\w:-]*|\*)/.exec(rest);
  if (tag) {
    if (tag[1] !== "*" && element.tagName !== tag[1].toUpperCase()) return false;
    rest = rest.slice(tag[0].length);
  }

  while (rest) {
    if (rest[0] !== "[") return false;
    let end = 1;
    let quote = "";
    for (; end < rest.length; end++) {
      const ch = rest[end];
      if (quote) {
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "]") {
        break;
      }
    }
    if (end >= rest.length) return false;

    const attr = parseAttribute(rest.slice(1, end));
    if (!attr) return false;
    const actual = element.getAttribute(attr.name);
    if (actual === null) return false;
    if (attr.operator) {
      let left = String(actual);
      let right = String(attr.value || "");
      if (attr.insensitive) {
        left = left.toLowerCase();
        right = right.toLowerCase();
      }
      if (attr.operator === "=" && left !== right) return false;
      if (attr.operator === "*=" && !left.includes(right)) return false;
      if (attr.operator === "^=" && !left.startsWith(right)) return false;
      if (attr.operator === "$=" && !left.endsWith(right)) return false;
      if (attr.operator === "~=" && !left.split(/\s+/).includes(right)) return false;
      if (attr.operator === "|=" && left !== right && !left.startsWith(right + "-")) return false;
    }
    rest = rest.slice(end + 1);
  }
  return true;
}

function matchesSelector(element, selector) {
  for (const group of splitGroups(selector)) {
    const tokens = splitDescendants(group);
    let current = element;
    let matched = true;
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (!current || !matchesSimple(current, tokens[i])) {
        matched = false;
        break;
      }
      if (i > 0) {
        current = current.parentElement;
        while (current && !matchesSimple(current, tokens[i - 1])) current = current.parentElement;
        if (!current) {
          matched = false;
          break;
        }
        i--;
      }
    }
    if (matched) return true;
  }
  return false;
}

class FakeStyle {
  constructor() {
    this.values = Object.create(null);
    this.priorities = Object.create(null);
  }

  setProperty(name, value, priority) {
    this.values[name] = String(value);
    this.priorities[name] = priority || "";
  }

  removeProperty(name) {
    delete this.values[name];
    delete this.priorities[name];
  }

  getPropertyValue(name) {
    return this.values[name] || "";
  }

  getPropertyPriority(name) {
    return this.priorities[name] || "";
  }

  toString() {
    return Object.keys(this.values).map((key) => `${key}: ${this.values[key]}`).join("; ");
  }
}

class FakeNode {
  constructor(type) {
    this.nodeType = type;
    this.parentElement = null;
    this.childNodes = [];
    this.ownerDocument = null;
  }

  appendChild(child) {
    if (child.parentElement) {
      const old = child.parentElement.childNodes.indexOf(child);
      if (old !== -1) child.parentElement.childNodes.splice(old, 1);
    }
    child.parentElement = this.nodeType === 1 || this.nodeType === 9 ? this : null;
    child.ownerDocument = this.ownerDocument || (this.nodeType === 9 ? this : null);
    this.childNodes.push(child);
    if (child.childNodes) {
      const assign = (node) => {
        node.ownerDocument = child.ownerDocument;
        for (const nested of node.childNodes || []) assign(nested);
      };
      assign(child);
    }
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(child);
    return this;
  }

  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }

  get childElementCount() {
    return this.children.length;
  }

  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
}

class FakeText extends FakeNode {
  constructor(text) {
    super(3);
    this.textContent = String(text);
  }
}

class FakeElement extends FakeNode {
  constructor(tag, attrs, rect) {
    super(1);
    this.tagName = tag.toUpperCase();
    this.attributes = Object.create(null);
    this.style = new FakeStyle();
    this.rect = Object.assign({ left: 0, top: 0, width: 100, height: 20 }, rect || {});
    for (const key of Object.keys(attrs || {})) this.setAttribute(key, attrs[key]);
  }

  get textContent() {
    return this.childNodes.map((child) => child.textContent || "").join("");
  }

  set textContent(value) {
    this.childNodes = [];
    if (value !== "" && value !== null && value !== undefined) this.appendChild(new FakeText(value));
  }

  get innerText() {
    return this.textContent;
  }

  set innerText(value) {
    this.textContent = value;
  }

  getAttribute(name) {
    if (name === "style") return this.style.toString() || null;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  getBoundingClientRect() {
    const r = this.rect;
    return {
      left: r.left,
      top: r.top,
      right: r.left + r.width,
      bottom: r.top + r.height,
      width: r.width,
      height: r.height
    };
  }

  matches(selector) {
    return matchesSelector(this, selector);
  }

  closest(selector) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches && current.matches(selector)) return current;
    }
    return null;
  }

  querySelectorAll(selector) {
    if (this.ownerDocument) this.ownerDocument.stats.queryCalls++;
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (child.matches(selector)) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  remove() {
    if (!this.parentElement) return;
    const index = this.parentElement.childNodes.indexOf(this);
    if (index !== -1) this.parentElement.childNodes.splice(index, 1);
    this.parentElement = null;
  }
}

class FakeDocument extends FakeNode {
  constructor() {
    super(9);
    this.stats = { queryCalls: 0 };
    this.documentElement = new FakeElement("html");
    this.head = new FakeElement("head");
    this.body = new FakeElement("body");
    this.appendChild(this.documentElement);
    this.documentElement.append(this.head, this.body);
  }

  createElement(tag) {
    const node = new FakeElement(tag);
    node.ownerDocument = this;
    return node;
  }

  createTextNode(text) {
    const node = new FakeText(text);
    node.ownerDocument = this;
    return node;
  }

  querySelectorAll(selector) {
    this.stats.queryCalls++;
    const out = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 1) {
          if (child.matches(selector)) out.push(child);
          walk(child);
        }
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getElementById(id) {
    let found = null;
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (found || child.nodeType !== 1) continue;
        if (child.getAttribute("id") === id) {
          found = child;
          return;
        }
        walk(child);
      }
    };
    walk(this);
    return found;
  }

  addEventListener(type, listener) {
    if (!this.listeners) this.listeners = Object.create(null);
    (this.listeners[type] = this.listeners[type] || []).push(listener);
  }
  removeEventListener() {}
  dispatch(type, target) {
    for (const listener of (this.listeners && this.listeners[type]) || []) listener({ type, target });
  }
  dispatchEvent(event) { this.dispatch(event.type, this); return true; }
  hasFocus() { return true; }
}

function styleFor(element) {
  const value = (name, fallback) => element.style.getPropertyValue(name) || fallback;
  return {
    display: value("display", "block"),
    visibility: value("visibility", "visible"),
    opacity: value("opacity", "1"),
    position: value("position", "static"),
    left: value("left", "auto"),
    top: value("top", "auto"),
    clip: value("clip", "auto"),
    clipPath: value("clip-path", "none"),
    textIndent: value("text-indent", "0px"),
    fontSize: value("font-size", "14px"),
    overflow: value("overflow", "visible"),
    overflowX: value("overflow-x", value("overflow", "visible")),
    overflowY: value("overflow-y", value("overflow", "visible")),
    color: value("color", "rgb(0, 0, 0)")
  };
}

function norm(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();
}

function makeDetector() {
  const sponsored = ["sponsored", "ad", "promoted"];
  const suggested = ["suggested for you"];
  const matchesAny = (text, list) => list.includes(norm(text));

  function readLabel(element, env) {
    const parts = [];
    const ownText = element.textContent || "";
    if (ownText) parts.push(ownText);

    const aria = element.getAttribute && element.getAttribute("aria-label");
    if (aria) parts.push(aria);

    const labelledBy = element.getAttribute && element.getAttribute("aria-labelledby");
    if (labelledBy) {
      for (const id of labelledBy.split(/\s+/)) {
        const ref = env.doc.getElementById(id);
        if (ref) parts.push(ref.textContent || ref.innerText || "");
      }
    }

    const uses = element.querySelectorAll ? element.querySelectorAll("use") : [];
    const visited = new Set();
    const resolve = (node) => {
      if (!node || visited.has(node)) return "";
      visited.add(node);
      const direct = node.textContent || "";
      if (direct) return direct;
      const nested = node.querySelectorAll ? node.querySelectorAll("use") : [];
      let result = "";
      for (const use of nested) {
        const href = use.getAttribute("xlink:href") || use.getAttribute("href") || "";
        if (href.startsWith("#")) result += " " + resolve(env.doc.getElementById(href.slice(1)));
      }
      return result;
    };
    for (const use of uses) {
      const href = use.getAttribute("xlink:href") || use.getAttribute("href") || "";
      if (href.startsWith("#")) parts.push(resolve(env.doc.getElementById(href.slice(1))));
    }

    return norm(parts.join(" "));
  }

  return {
    norm,
    normList: (items) => items.map(norm),
    SPONSORED: sponsored,
    SUGGESTED: suggested,
    matchesAny,
    visibleText: (element) => norm(element.textContent || ""),
    readLabel
  };
}

class Scheduler {
  constructor() {
    this.queue = [];
    this.intervals = [];
  }

  setTimeout(callback) {
    this.queue.push(callback);
    return this.queue.length;
  }

  setInterval(callback) {
    this.intervals.push(callback);
    return this.intervals.length;
  }

  flush(limit = 1000) {
    let count = 0;
    while (this.queue.length && count++ < limit) this.queue.shift()();
    if (this.queue.length) throw new Error("fake timer queue did not quiesce");
  }

  tickInterval(index = 0) {
    if (!this.intervals[index]) throw new Error("missing interval");
    this.intervals[index]();
  }
}

function createHarness(options = {}) {
  const doc = new FakeDocument();
  const main = doc.createElement("div");
  main.setAttribute("role", "main");
  main.rect = { left: 0, top: 0, width: 700, height: 900 };
  doc.body.appendChild(main);

  const sidebar = doc.createElement("div");
  sidebar.setAttribute("role", "complementary");
  sidebar.rect = { left: 720, top: 0, width: 320, height: 900 };
  doc.body.appendChild(sidebar);

  const scheduler = new Scheduler();
  const detector = makeDetector();
  const state = { observer: null };
  const listeners = [];
  const chrome = {
    storage: {
      local: { get: (_keys, callback) => callback(options.settings || {}) },
      onChanged: { addListener: (callback) => listeners.push(callback) }
    },
    runtime: { sendMessage: (msg) => { if (options.messages) options.messages.push(msg); return { catch: () => {} }; } }
  };

  class TestMutationObserver {
    constructor(callback) {
      state.observer = { callback };
    }

    observe() {}
  }

  const windowObject = {
    document: doc,
    location: { hostname: "www.facebook.com", pathname: "/" },
    innerHeight: 900,
    ABPDetect: detector,
    addEventListener: () => {},
    requestAnimationFrame: (callback) => scheduler.setTimeout(callback)
  };

  const context = {
    window: windowObject,
    self: windowObject,
    document: doc,
    chrome,
    MutationObserver: TestMutationObserver,
    CustomEvent: class { constructor(type) { this.type = type; } },
    NodeFilter: { SHOW_TEXT: 4 },
    getComputedStyle: styleFor,
    setTimeout: (callback) => scheduler.setTimeout(callback),
    setInterval: (callback) => scheduler.setInterval(callback),
    requestAnimationFrame: (callback) => scheduler.setTimeout(callback),
    Date: { now: () => 100000 },
    console,
    WeakSet,
    Set,
    Array,
    Object,
    String,
    Boolean,
    Number,
    Math,
    RegExp,
    Error
  };

  if (options.IntersectionObserver) context.IntersectionObserver = options.IntersectionObserver;

  vm.runInNewContext(SOURCE, context, { filename: "facebook.js" });

  function mutate(mutation) {
    if (!state.observer) throw new Error("facebook observer was not installed");
    state.observer.callback([Object.assign({ addedNodes: [], removedNodes: [] }, mutation)]);
    scheduler.flush();
  }

  return { doc, main, sidebar, scheduler, state, window: windowObject, mutate,
    changeSettings(patch) {
      const changes = {};
      for (const key of Object.keys(patch)) changes[key] = { newValue: patch[key] };
      listeners.forEach((listener) => listener(changes, "local"));
      scheduler.flush();
    }
  };
}

function card(harness, extraAttrs) {
  const result = harness.doc.createElement("div");
  result.setAttribute("role", "article");
  result.rect = { left: 0, top: 0, width: 600, height: 320 };
  for (const key of Object.keys(extraAttrs || {})) result.setAttribute(key, extraAttrs[key]);
  return result;
}

function sidebarItem(harness, extraAttrs) {
  const result = harness.doc.createElement("div");
  result.setAttribute("data-visualcompletion", "ignore-dynamic");
  result.rect = { left: 720, top: 20, width: 300, height: 120 };
  for (const key of Object.keys(extraAttrs || {})) result.setAttribute(key, extraAttrs[key]);
  return result;
}

function text(harness, value) {
  return harness.doc.createTextNode(value);
}

function isBlocked(node) {
  return node.hasAttribute("data-abp-blocked");
}

let passed = 0;
let failed = 0;

function check(name, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  }
}

function section(name, run) {
  console.log(`\n${name}\n${"-".repeat(name.length)}`);
  try {
    run();
  } catch (error) {
    failed++;
    console.log(`  FAIL  threw ${error.stack || error}`);
  }
}

section("1. Late SVG hydration is detected without interaction", () => {
  const h = createHarness();
  const remote = h.doc.createElement("svg");
  remote.setAttribute("id", "late-svg-label");
  h.doc.body.appendChild(remote);

  const use = h.doc.createElement("use");
  use.setAttribute("href", "#late-svg-label");
  const svg = h.doc.createElement("svg").append(use);
  const ad = card(h);
  ad.appendChild(svg);
  h.main.appendChild(ad);
  h.scheduler.tickInterval();
  h.scheduler.flush();
  check("initially not blocked before label hydration", isBlocked(ad), false);

  remote.appendChild(text(h, "Sponsored"));
  h.mutate({ type: "childList", target: remote, addedNodes: [remote.childNodes[0]] });
  check("late SVG label hides its card", isBlocked(ad), true);
});

section("2. Late aria-labelledby change invalidates the referencing card", () => {
  const h = createHarness();
  for (let i = 0; i < 31; i++) {
    const noise = h.doc.createElement("span");
    noise.setAttribute("aria-labelledby", `noise-${i}`);
    noise.rect = { left: 10, top: 10, width: 20, height: 20 };
    h.main.appendChild(noise);
  }

  const remote = h.doc.createElement("span");
  remote.setAttribute("id", "late-aria-label");
  h.doc.body.appendChild(remote);
  const ref = h.doc.createElement("span");
  ref.setAttribute("aria-labelledby", "late-aria-label");
  ref.rect = { left: 10, top: 10, width: 80, height: 20 };
  const ad = card(h);
  ad.appendChild(ref);
  h.main.appendChild(ad);
  h.scheduler.tickInterval();
  h.scheduler.flush();
  check("referencing element starts uncategorized", isBlocked(ad), false);

  remote.appendChild(text(h, "Sponsored"));
  h.mutate({ type: "childList", target: remote, addedNodes: [remote.childNodes[0]] });
  check("referencing card is re-evaluated after remote change", isBlocked(ad), true);
});

section("3. SVG candidate beyond the former first-40 limit is discovered", () => {
  const h = createHarness();
  for (let i = 0; i < 41; i++) {
    const noiseUse = h.doc.createElement("use");
    noiseUse.setAttribute("href", `#noise-svg-${i}`);
    const noiseCard = card(h);
    noiseCard.appendChild(h.doc.createElement("svg").append(noiseUse));
    h.main.appendChild(noiseCard);
  }

  const label = h.doc.createElement("text");
  label.setAttribute("id", "svg-ad-label");
  label.appendChild(text(h, "Sponsored"));
  h.doc.body.appendChild(label);
  const use = h.doc.createElement("use");
  use.setAttribute("href", "#svg-ad-label");
  const ad = card(h);
  ad.appendChild(h.doc.createElement("svg").append(use));
  h.main.appendChild(ad);
  h.scheduler.tickInterval();
  h.scheduler.flush();
  check("later SVG candidate is hidden", isBlocked(ad), true);
});

section("4. aria-labelledby candidate beyond the former first-30 limit is discovered", () => {
  const h = createHarness();
  for (let i = 0; i < 31; i++) {
    const noise = h.doc.createElement("span");
    noise.setAttribute("aria-labelledby", `missing-aria-${i}`);
    const noiseCard = card(h);
    noiseCard.appendChild(noise);
    h.main.appendChild(noiseCard);
  }

  const label = h.doc.createElement("span");
  label.setAttribute("id", "aria-ad-label");
  label.appendChild(text(h, "Sponsored"));
  h.doc.body.appendChild(label);
  const ref = h.doc.createElement("span");
  ref.setAttribute("aria-labelledby", "aria-ad-label");
  const ad = card(h);
  ad.appendChild(ref);
  h.main.appendChild(ad);
  h.scheduler.tickInterval();
  h.scheduler.flush();
  check("later ARIA candidate is hidden", isBlocked(ad), true);
});

section("5. Video playback mutations are ignored, relevant SVG mutations are not", () => {
  const h = createHarness();
  const organic = card(h);
  const video = h.doc.createElement("video");
  organic.appendChild(video);
  h.main.appendChild(organic);
  const before = h.doc.stats.queryCalls;
  h.mutate({ type: "attributes", target: video, attributeName: "class" });
  check("playback mutation does not schedule a scan", h.doc.stats.queryCalls, before);
  check("organic video card remains visible", isBlocked(organic), false);

  const remote = h.doc.createElement("svg");
  remote.setAttribute("id", "relevant-svg-label");
  h.doc.body.appendChild(remote);
  const use = h.doc.createElement("use");
  use.setAttribute("href", "#relevant-svg-label");
  const ad = card(h);
  ad.appendChild(h.doc.createElement("svg").append(use));
  h.main.appendChild(ad);
  h.mutate({ type: "childList", target: h.main, addedNodes: [ad] });
  remote.appendChild(text(h, "Sponsored"));
  h.mutate({ type: "childList", target: remote, addedNodes: [remote.childNodes[0]] });
  check("relevant SVG mutation still hides the card", isBlocked(ad), true);
});

section("6. Organic media, SVG, and ARIA content remains visible", () => {
  const h = createHarness();
  const organic = card(h);
  organic.append(
    h.doc.createElement("span").append(text(h, "A normal post")),
    h.doc.createElement("svg").append(h.doc.createElement("path")),
    h.doc.createElement("video"),
    h.doc.createElement("span").append(text(h, "Like"))
  );
  h.main.appendChild(organic);
  check("ordinary Facebook content is not hidden", isBlocked(organic), false);
});

section("7. Hidden zero-size ARIA templates are not treated as cards", () => {
  const h = createHarness();
  const label = h.doc.createElement("span");
  label.setAttribute("id", "hidden-template-label");
  label.appendChild(text(h, "Sponsored"));
  h.doc.body.appendChild(label);

  const hiddenTemplate = h.doc.createElement("div");
  hiddenTemplate.style.setProperty("display", "none");
  hiddenTemplate.rect = { left: 0, top: 0, width: 600, height: 0 };
  const ref = h.doc.createElement("span");
  ref.setAttribute("aria-labelledby", "hidden-template-label");
  ref.rect = { left: 0, top: 0, width: 80, height: 20 };
  hiddenTemplate.appendChild(ref);
  h.main.appendChild(hiddenTemplate);
  h.scheduler.tickInterval();
  h.scheduler.flush();

  check("hidden template remains untouched", isBlocked(hiddenTemplate), false);
});

section("8. Dynamically appended SPA feed cards are scanned locally", () => {
  const h = createHarness();
  const ad = card(h);
  ad.appendChild(h.doc.createElement("span").append(text(h, "Sponsored")));
  h.main.appendChild(ad);
  h.mutate({ type: "childList", target: h.main, addedNodes: [ad] });
  check("new sponsored card is hidden without a click", isBlocked(ad), true);
});

section("9. Rotating global label work reaches content beyond the old budget", () => {
  const h = createHarness();
  const feed = card(h);
  for (let i = 0; i < 1200; i++) {
    const ordinary = h.doc.createElement("span");
    ordinary.appendChild(text(h, "ordinary"));
    feed.appendChild(ordinary);
  }
  const adLabel = h.doc.createElement("span");
  adLabel.appendChild(text(h, "Sponsored"));
  const ad = card(h);
  ad.appendChild(adLabel);
  h.main.append(feed, ad);
  check("first bounded pass does not need to scan the whole feed", isBlocked(ad), false);
  h.scheduler.tickInterval();
  h.scheduler.flush();
  check("first rotating pass remains bounded", isBlocked(ad), false);
  h.scheduler.tickInterval();
  h.scheduler.flush();
  check("next rotating pass reaches the later card", isBlocked(ad), true);
});

section("10. Current uBlock Quick Fix sidebar signals hide only high-confidence items", () => {
  const h = createHarness();
  const ad = sidebarItem(h);
  const link = h.doc.createElement("a");
  link.setAttribute("attributionsrc", "/privacy_sandbox/comet/register/source/?eid=sidebar-ad");
  link.setAttribute("href", "https://advertiser.example/landing");
  link.setAttribute("rel", "nofollow noreferrer external");
  link.appendChild(h.doc.createElement("img"));
  link.childNodes[0].setAttribute("src", "creative.jpg");
  ad.appendChild(link);
  h.sidebar.appendChild(ad);
  h.mutate({ type: "childList", target: h.sidebar, addedNodes: [ad] });
  check("attribution-marked sidebar item is hidden", isBlocked(ad), true);

  const organicHarness = createHarness();
  const organic = sidebarItem(organicHarness);
  const organicLink = organicHarness.doc.createElement("a");
  organicLink.setAttribute("href", "https://example.com/profile");
  organicLink.setAttribute("target", "_blank");
  organicLink.setAttribute("role", "link");
  organicLink.setAttribute("rel", "noreferrer");
  organicLink.appendChild(organicHarness.doc.createElement("img"));
  organicLink.childNodes[0].setAttribute("src", "profile.jpg");
  organic.appendChild(organicLink);
  organicHarness.sidebar.appendChild(organic);
  organicHarness.mutate({ type: "childList", target: organicHarness.sidebar, addedNodes: [organic] });
  check("ordinary sidebar image link remains visible", isBlocked(organic), false);

  const ariaHarness = createHarness();
  const label = ariaHarness.doc.createElement("span");
  label.setAttribute("id", "_R_sidebar_ad");
  label.appendChild(text(ariaHarness, "Sponsored"));
  ariaHarness.doc.body.appendChild(label);
  const ariaItem = sidebarItem(ariaHarness);
  const ariaLink = ariaHarness.doc.createElement("a");
  ariaLink.setAttribute("rel", "nofollow noreferrer tag");
  ariaLink.setAttribute("aria-labelledby", "_R_sidebar_ad");
  ariaItem.appendChild(ariaLink);
  ariaHarness.sidebar.appendChild(ariaItem);
  ariaHarness.mutate({ type: "childList", target: ariaHarness.sidebar, addedNodes: [ariaItem] });
  check("Comet ARIA sidebar item is hidden", isBlocked(ariaItem), true);

  const headingHarness = createHarness();
  const headingItem = sidebarItem(headingHarness);
  const heading = headingHarness.doc.createElement("h3");
  heading.appendChild(headingHarness.doc.createElement("span").append(text(headingHarness, "Sponsored")));
  headingItem.appendChild(heading);
  headingHarness.sidebar.appendChild(headingItem);
  headingHarness.mutate({ type: "childList", target: headingHarness.sidebar, addedNodes: [headingItem] });
  check("Sponsored sidebar heading hides its item", isBlocked(headingItem), true);
});

section("11. A card that wraps the page's main landmark is never hidden", () => {
  const h = createHarness();
  const wrapper = card(h);
  const innerMain = h.doc.createElement("div");
  innerMain.setAttribute("role", "main");
  wrapper.append(innerMain, h.doc.createElement("span").append(text(h, "Sponsored")));
  h.main.appendChild(wrapper);
  h.mutate({ type: "childList", target: h.main, addedNodes: [wrapper] });
  check("card containing the main landmark is refused", isBlocked(wrapper), false);

  const control = createHarness();
  const ad = card(control);
  ad.appendChild(control.doc.createElement("span").append(text(control, "Sponsored")));
  control.main.appendChild(ad);
  control.mutate({ type: "childList", target: control.main, addedNodes: [ad] });
  check("ordinary sponsored card is still hidden", isBlocked(ad), true);
});

function reelViewerAd(h) {
  const adReel = card(h);
  adReel.rect = { left: 0, top: 0, width: 400, height: 800 };
  adReel.setAttribute("data-pagelet", "ReelViewerRoot");
  const video = h.doc.createElement("video");
  video.pause = function () { video.__paused = true; };
  video.play = function () { video.__played = true; };
  video.muted = false;
  adReel.appendChild(video);
  adReel.appendChild(h.doc.createElement("span").append(text(h, "Sponsored")));
  h.main.appendChild(adReel);
  return { adReel, video };
}

section("12. A confirmed Reels ad is covered before the viewer advances", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const next = nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);
  const clickNext = next.click;
  next.click = function () {
    next.__coverAtClick = adReel.getAttribute("data-abp-reel-cover");
    next.__pausedAtClick = video.__paused === true;
    clickNext();
  };
  adReel.style.setProperty("visibility", "visible");
  adReel.style.setProperty("opacity", "0.8");

  h.scheduler.tickInterval(0);
  h.scheduler.flush();

  check("the ad reel is marked as hidden", adReel.getAttribute("data-abp-reel-hidden"), "sponsored");
  check("the original inline visibility is preserved", adReel.style.getPropertyValue("visibility"), "visible");
  check("the original inline opacity is preserved", adReel.style.getPropertyValue("opacity"), "0.8");
  const reelStyles = h.doc.head.querySelectorAll("style");
  check("the scoped cover stylesheet hides marked Reels", reelStyles.some((s) => s.textContent.includes('[data-abp-reel-cover="1"]') && s.textContent.includes("visibility: hidden")), true);
  check("the slide keeps its layout box", adReel.getBoundingClientRect().height, 800);
  check("the slide is not removed from layout", adReel.style.getPropertyValue("display"), "");
  check("the active ad is muted without pausing its player", video.__paused !== true && video.muted === true, true);
  check("the ad is covered before Facebook is advanced", next.__coverAtClick, "1");
  check("the player is not paused before the transition", next.__pausedAtClick, false);
  check("the covered ad advances exactly once", next.__clicks, 1);
  check("the route remains on the same reel", h.window.location.pathname, "/reel/1");
});

section("13. Leaving the viewer releases the cover and stops the old media", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const next = nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);
  adReel.style.setProperty("visibility", "visible");
  adReel.style.setProperty("opacity", "0.8");

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the ad is covered before the route changes", adReel.getAttribute("data-abp-reel-cover"), "1");

  h.window.location.pathname = "/?ref=feed";
  h.scheduler.tickInterval(1);
  check("the cover is removed on route change", adReel.getAttribute("data-abp-reel-cover"), null);
  check("the ad hidden marker is released", adReel.getAttribute("data-abp-reel-hidden"), null);
  check("the original visibility style stays intact", adReel.style.getPropertyValue("visibility"), "visible");
  check("the original opacity style stays intact", adReel.style.getPropertyValue("opacity"), "0.8");
  check("the original audio state is restored", video.muted, false);
  check("the old video stays paused after leaving", video.__paused, true);
  check("the old ad is not restarted on the feed", video.__played !== true, true);
  check("the route change does not click Next Card a second time", next.__clicks, 1);
});

section("14. A hidden card later reused to wrap the feed is given back", () => {
  const h = createHarness();
  const ad = card(h);
  ad.appendChild(h.doc.createElement("span").append(text(h, "Sponsored")));
  h.main.appendChild(ad);
  h.mutate({ type: "childList", target: h.main, addedNodes: [ad] });
  check("the sponsored card is hidden", isBlocked(ad), true);

  // Facebook recycles the node after a route change: it now wraps the feed.
  const feed = h.doc.createElement("div");
  feed.setAttribute("role", "feed");
  ad.appendChild(feed);

  h.window.location.pathname = "/?ref=reels"; // route change, e.g. closing Reels
  h.scheduler.tickInterval(1);
  check("the route change gives the node back at once", isBlocked(ad), false);
  check("its inline hide styles are cleared", ad.style.getPropertyValue("display"), "");

  h.scheduler.flush();
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the next global sweep does not hide it again", isBlocked(ad), false);
});

section("15. A box holding more than one feed post is never hidden, only the ad inside it", () => {
  const h = createHarness();
  const wrapper = h.doc.createElement("div");
  wrapper.rect = { left: 0, top: 0, width: 600, height: 900 };

  const ad = card(h, { "aria-posinset": "1" });
  const label = h.doc.createElement("span").append(text(h, "Sponsored"));
  label.setAttribute("data-abp-ad-marker", "true"); // left behind by an earlier hide
  ad.appendChild(label);

  const organic = card(h, { "aria-posinset": "2" });
  organic.appendChild(h.doc.createElement("span").append(text(h, "A normal post")));

  wrapper.append(ad, organic);
  h.main.appendChild(wrapper);
  h.mutate({ type: "childList", target: h.main, addedNodes: [wrapper] });
  h.scheduler.tickInterval(0);
  h.scheduler.flush();

  check("the sponsored post is hidden", isBlocked(ad), true);
  check("the box around both posts is not", isBlocked(wrapper), false);
  check("the organic post stays visible", isBlocked(organic), false);
});

function stubVideo(h) {
  const video = h.doc.createElement("video");
  video.pause = function () { video.__paused = true; };
  video.play = function () { video.__played = true; };
  video.muted = false;
  return video;
}

function nextButton(h, label, visible) {
  const btn = h.doc.createElement("div");
  btn.setAttribute("role", "button");
  btn.setAttribute("aria-label", label);
  btn.rect = visible ? { left: 1500, top: 500, width: 48, height: 48 } : { left: 0, top: 0, width: 0, height: 0 };
  btn.__clicks = 0;
  btn.click = function () { btn.__clicks++; };
  h.doc.body.appendChild(btn);
  return btn;
}

section("16. A reel's \"Ad\" label is hidden even when deep inside the slide", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 400, height: 800 };
  const video = stubVideo(h);
  slide.appendChild(video);
  for (let i = 0; i < 60; i++) {
    const filler = h.doc.createElement("span");
    filler.rect = { left: 0, top: 0, width: 0, height: 0 };
    filler.appendChild(text(h, "caption part " + i));
    slide.appendChild(filler);
  }
  const label = h.doc.createElement("span");
  label.rect = { left: 0, top: 0, width: 0, height: 0 };
  label.appendChild(text(h, "Ad"));
  slide.appendChild(label);
  h.main.appendChild(slide);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the ad reel is recognised and hidden", slide.getAttribute("data-abp-reel-hidden"), "sponsored-reel");
  check("the ad carries the scoped invisibility marker", slide.getAttribute("data-abp-reel-cover"), "1");
  check("the reel keeps its layout box", slide.getBoundingClientRect().height, 800);
  check("the hidden marker is installed", slide.getAttribute("data-abp-reel-cover"), "1");
  check("the visible ad is muted but not paused into a black frame", video.muted && video.__paused !== true, true);
});

section("17. Two reels in one container: only the ad reel is covered", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const hiddenNext = nextButton(h, "Next", false);
  const bareNext = nextButton(h, "Next", true);
  const cardNext = nextButton(h, "Next Card", true);

  const list = h.doc.createElement("div");
  list.rect = { left: 0, top: -900, width: 400, height: 2600 };

  const organic = h.doc.createElement("div");
  organic.rect = { left: 0, top: 0, width: 400, height: 800 };
  const organicVideo = stubVideo(h);
  organic.appendChild(organicVideo);
  organic.appendChild(h.doc.createElement("span").append(text(h, "I had an ad idea today")));

  const ad = h.doc.createElement("div");
  ad.rect = { left: 0, top: 900, width: 400, height: 800 };
  const adVideo = stubVideo(h);
  ad.appendChild(adVideo);
  ad.appendChild(h.doc.createElement("span").append(text(h, "Ad")));
  ad.appendChild(h.doc.createElement("a").append(text(h, "Shop now")));

  list.append(organic, ad);
  h.main.appendChild(list);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the organic reel on screen is left alone", organicVideo.muted, false);
  check("the off-screen ad is muted before it can play", adVideo.muted, true);
  check("the off-screen ad is marked hidden", ad.getAttribute("data-abp-reel-hidden"), "sponsored-reel");
  check("nothing is clicked yet", cardNext.__clicks + bareNext.__clicks + hiddenNext.__clicks, 0);

  // The user scrolls: the ad reel is now the one on screen.
  organic.rect = { left: 0, top: -900, width: 400, height: 800 };
  ad.rect = { left: 0, top: 0, width: 400, height: 800 };
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the ad reel is covered when it reaches the viewport", ad.getAttribute("data-abp-reel-cover"), "1");
  check("the organic reel is still never touched", organicVideo.muted, false);
  check("only the specific \"Next Card\" control advances", cardNext.__clicks, 1);
  check("the bare \"Next\" and the hidden control are not", bareNext.__clicks + hiddenNext.__clicks, 0);
  check("the ad remains paused", adVideo.__paused, true);
  check("the organic reel was never muted at any point", organicVideo.muted, false);
});

section("18. A preloaded reel ad stays covered and advances when it becomes active", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const cardNext = nextButton(h, "Next Card", true);

  const list = h.doc.createElement("div");
  list.rect = { left: 0, top: 0, width: 400, height: 1800 };
  const organic = h.doc.createElement("div");
  organic.rect = { left: 0, top: 0, width: 400, height: 800 };
  const organicVideo = stubVideo(h);
  organic.appendChild(organicVideo);

  const ad = h.doc.createElement("div");
  ad.rect = { left: 0, top: 900, width: 400, height: 800 };
  const adVideo = stubVideo(h);
  const permalink = h.doc.createElement("a");
  permalink.setAttribute("href", "/reel/555");
  ad.append(adVideo, permalink, h.doc.createElement("span").append(text(h, "Ad")));

  list.append(organic, ad);
  h.main.appendChild(list);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the ad is identified before it reaches the viewport", ad.getAttribute("data-abp-reel-hidden"), "sponsored-reel");
  check("the off-screen ad remains in layout", ad.style.getPropertyValue("display"), "");
  check("the off-screen ad carries the invisibility marker", ad.getAttribute("data-abp-reel-cover"), "1");

  // The user starts moving to it: its first pixels come into view.
  ad.rect = { left: 0, top: 860, width: 400, height: 800 };
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("covered from its first visible pixel", ad.getAttribute("data-abp-reel-cover"), "1");
  check("its sound is already off", adVideo.muted, true);
  check("not navigated before it arrives", cardNext.__clicks, 0);

  // It arrives.
  organic.rect = { left: 0, top: -900, width: 400, height: 800 };
  ad.rect = { left: 0, top: 0, width: 400, height: 800 };
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("it remains covered when it arrives", ad.getAttribute("data-abp-reel-cover"), "1");
  check("the already-offscreen ad stays paused", adVideo.__paused, true);
  check("the organic reel is never touched", organicVideo.muted, false);
  check("the covered ad advances as it arrives", cardNext.__clicks, 1);
});

section("19. A covered ad advances once and is not repeatedly navigated", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const cardNext = nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the ad remains covered", adReel.getAttribute("data-abp-reel-cover"), "1");
  check("the ad remains muted", video.muted, true);
  check("the active ad is not paused before moving on", video.__paused !== true, true);
  check("the covered ad advances once", cardNext.__clicks, 1);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("a later sweep does not advance it again", cardNext.__clicks, 1);
});

section("20. Advancing to the next Reel keeps the old ad covered without freezing it", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const next = nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the ad is covered before advancing", adReel.getAttribute("data-abp-reel-cover"), "1");
  check("the active player is not paused into a black frame", video.__paused !== true, true);
  check("the explicit next control is clicked once", next.__clicks, 1);

  h.window.location.pathname = "/reel/2";
  h.scheduler.tickInterval(1);
  h.scheduler.flush();
  check("the transition does not reveal the old ad", adReel.getAttribute("data-abp-reel-cover"), "1");
  check("the old player is still muted", video.muted, true);
  check("the old player was not resumed", video.__played !== true, true);
  check("the transition does not click Next Card again", next.__clicks, 1);
});

section("21. Leaving and returning covers and advances the creative once per visit", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const cardNext = nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("first pass covers the ad", adReel.getAttribute("data-abp-reel-cover"), "1");
  h.window.location.pathname = "/?ref=feed";
  h.scheduler.tickInterval(1);
  check("leaving releases the ad", adReel.getAttribute("data-abp-reel-hidden"), null);

  // Returning to the viewer detects the same ad again and covers it again.
  h.window.location.pathname = "/reel/1";
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("covered again on return", adReel.getAttribute("data-abp-reel-cover"), "1");
  check("the returned ad advances once more", cardNext.__clicks, 2);
  check("the ad is muted again", video.muted, true);
});

section("22. A reel whose only ad sign is the hidden (shadow DOM) label is covered", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const cardNext = nextButton(h, "Next Card", true);

  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 400, height: 800 };
  const video = stubVideo(h);
  const host = h.doc.createElement("span"); // its "Ad" text lives in a closed shadow root
  slide.append(video, host);
  h.main.appendChild(slide);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("nothing readable in the DOM marks it as an ad", video.muted, false);

  h.doc.dispatch("__abpShadowSponsoredDetected", host);
  check("the shadow-DOM signal hides it", slide.getAttribute("data-abp-reel-hidden"), "shadow-dom-ad");
  check("it is covered in place", slide.getAttribute("data-abp-reel-cover"), "1");
  check("it is muted without freezing a black frame", video.__paused !== true && video.muted === true, true);
  check("the covered ad advances through Next Card", cardNext.__clicks, 1);
});

section("23. A hidden Shadow DOM template is rejected instead of blanking an organic Reel", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/organic";
  const cardNext = nextButton(h, "Next Card", true);

  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 400, height: 800 };
  const video = stubVideo(h);
  const template = h.doc.createElement("div");
  template.style.setProperty("display", "none");
  const host = h.doc.createElement("span");
  host.rect = { left: 0, top: 0, width: 0, height: 0 };
  template.appendChild(host);
  slide.append(video, template);
  h.main.appendChild(slide);

  h.doc.dispatch("__abpShadowSponsoredDetected", host);
  check("the hidden zero-size template is not treated as an ad", slide.getAttribute("data-abp-reel-hidden"), null);
  check("the organic Reel remains visible", slide.getAttribute("data-abp-reel-cover"), null);
  check("its video is not paused or muted", video.__paused !== true && video.muted === false, true);
  check("the viewer is not advanced", cardNext.__clicks, 0);
  check("the false-positive is recorded for diagnostics", h.doc.documentElement.getAttribute("data-abp-shadow-signal-rejected"), "1");

  // Some hidden templates retain a nonzero box but are suppressed by an
  // ancestor's computed display state; that must be rejected too.
  host.rect = { left: 0, top: 0, width: 12, height: 12 };
  h.doc.dispatch("__abpShadowSponsoredDetected", host);
  check("a host inside a display:none ancestor is also rejected", h.doc.documentElement.getAttribute("data-abp-shadow-signal-rejected"), "2");
  check("the hidden ancestor cannot trigger navigation", cardNext.__clicks, 0);
});

section("24. Hiding the reel keeps its layout dimensions", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const next = nextButton(h, "Next Card", true);

  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 500, height: 800 };
  const videoBox = h.doc.createElement("div");
  videoBox.rect = { left: 0, top: 0, width: 400, height: 800 };
  const video = stubVideo(h);
  const permalink = h.doc.createElement("a");
  permalink.setAttribute("href", "/reel/42");
  videoBox.append(video, permalink, h.doc.createElement("span").append(text(h, "Ad")));
  const buttons = h.doc.createElement("div");
  buttons.setAttribute("aria-label", "Like");
  slide.append(videoBox, buttons);
  h.main.appendChild(slide);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the whole reel carries the invisibility marker", slide.getAttribute("data-abp-reel-cover"), "1");
  check("the reel height stays intact to avoid snapping", slide.getBoundingClientRect().height, 800);
  check("not just the box around the video", videoBox.style.getPropertyValue("opacity"), "");
  check("the covered Reel advances exactly once", next.__clicks, 1);
});

section("25. A hidden ad stops painting when it leaves the viewport", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const next = nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the ad starts covered", adReel.getAttribute("data-abp-reel-cover"), "1");
  check("the ad is covered without being collapsed", adReel.getAttribute("data-abp-reel-cover"), "1");

  // The user scrolls away; the hidden ad stays absent and silent.
  adReel.rect = { left: 0, top: 950, width: 400, height: 800 };
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the ad remains covered off-screen", adReel.getAttribute("data-abp-reel-cover"), "1");
  check("the ad stays silent off-screen", video.muted, true);
  check("the Reel is advanced once, not again during scrolling", next.__clicks, 1);
});

section("26. When Reels opens full width, the whole reel is still covered", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  h.window.innerWidth = 500;
  nextButton(h, "Next Card", true);

  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 500, height: 800 }; // as wide as the window
  const videoBox = h.doc.createElement("div");
  videoBox.rect = { left: 50, top: 0, width: 400, height: 800 };
  const video = stubVideo(h);
  const permalink = h.doc.createElement("a");
  permalink.setAttribute("href", "/reel/7");
  videoBox.append(video, permalink, h.doc.createElement("span").append(text(h, "Ad")));
  const caption = h.doc.createElement("div");
  caption.appendChild(text(h, "Learn more"));
  slide.append(videoBox, caption);
  h.main.appendChild(slide);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the full-width reel is hidden, caption included", slide.getAttribute("data-abp-reel-cover"), "1");
  check("the full-width ad is muted but its player is not frozen", video.__paused !== true && video.muted === true, true);
});

section("27. The cover stops at the reel and never takes in the viewer's Next Card control", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";

  const viewer = h.doc.createElement("div");
  viewer.rect = { left: 0, top: 0, width: 700, height: 900 };
  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 500, height: 800 };
  const video = stubVideo(h);
  slide.append(video, h.doc.createElement("span").append(text(h, "Ad")));
  const next = h.doc.createElement("div");
  next.setAttribute("aria-label", "Next Card");
  next.rect = { left: 620, top: 500, width: 48, height: 48 };
  next.__clicks = 0;
  next.click = function () { next.__clicks++; };
  viewer.append(slide, next); // only one reel on the page, like the log showed at times
  h.main.appendChild(viewer);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the reel is hidden", slide.getAttribute("data-abp-reel-cover"), "1");
  check("the viewer around it (with Next Card) is not", viewer.style.getPropertyValue("opacity"), "");
  check("the Reel advances through Next Card", next.__clicks, 1);
});

section("28. A full-screen Reel wrapper is hidden without collapsing its snap box", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  h.window.innerWidth = 2048;
  const next = nextButton(h, "Next Card", true);

  const portal = h.doc.createElement("div");
  portal.rect = { left: 0, top: 0, width: 2048, height: 900 };
  const reel = h.doc.createElement("div");
  reel.rect = { left: 736, top: 0, width: 575, height: 900 };
  reel.append(
    stubVideo(h),
    h.doc.createElement("span").append(text(h, "Sponsored")),
    h.doc.createElement("div").append(text(h, "Like · Comment · Share"))
  );
  portal.appendChild(reel);
  h.main.appendChild(portal);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the full-screen Reel slide gets the hide marker", portal.getAttribute("data-abp-reel-cover"), "1");
  check("the full-screen Reel stays in the layout", portal.style.getPropertyValue("display"), "");
  check("the Reel keeps its original layout height", portal.getBoundingClientRect().height, 900);
  check("Facebook's next card button is clicked only after the cover", next.__clicks, 1);
});

section("29. On a wide screen, an ad label appearing on the reel is covered in place", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  h.window.innerWidth = 2000; // the user's screen: full-width Reels is wider than the 1800px feed-card limit
  const next = nextButton(h, "Next Card", true);

  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 1990, height: 800 };
  const video = stubVideo(h);
  slide.appendChild(video);
  h.main.appendChild(slide);
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("an ordinary reel on screen is left alone", video.muted, false);

  // Facebook fills in the ad information once the reel is on screen.
  const overlay = h.doc.createElement("div");
  overlay.append(h.doc.createElement("span").append(text(h, "Ad")), h.doc.createElement("a").append(text(h, "Learn more")));
  slide.appendChild(overlay);
  h.state.observer.callback([{ type: "childList", target: slide, addedNodes: [overlay], removedNodes: [] }]);
  h.scheduler.flush(); // runs only the timers this page change queued
  check("it is covered straight away, with no periodic sweep involved", slide.getAttribute("data-abp-reel-cover"), "1");
  check("the covered ad advances without painting", next.__clicks, 1);
  check("the active video is muted without a black pause frame", video.__paused !== true && video.muted === true, true);
});

section("30. Blocked-ad reports carry how many were newly blocked, not a running total to be re-added", () => {
  const messages = [];
  const h = createHarness({ messages });
  const first = card(h);
  first.appendChild(h.doc.createElement("span").append(text(h, "Sponsored")));
  h.main.appendChild(first);
  h.mutate({ type: "childList", target: h.main, addedNodes: [first] });

  const second = card(h);
  second.appendChild(h.doc.createElement("span").append(text(h, "Sponsored")));
  h.main.appendChild(second);
  h.mutate({ type: "childList", target: h.main, addedNodes: [second] });

  const reports = messages.filter((m) => m.type === "abpBlocked");
  const addedSum = reports.reduce((sum, m) => sum + (m.added || 0), 0);
  check("two reports for two separately hidden ads", reports.length, 2);
  check("their newly-blocked counts add up to 2, not 1+2", addedSum, 2);
  check("the last report carries the page's running total for the badge", reports.length ? reports[reports.length - 1].total : null, 2);
  check("no report uses the old ambiguous 'count' field", reports.some((m) => "count" in m), false);
});

section("31. An ordinary reel is not re-read on every unrelated page change", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 400, height: 800 };
  slide.appendChild(stubVideo(h));
  for (let i = 0; i < 5; i++) slide.appendChild(h.doc.createElement("span").append(text(h, "caption " + i)));
  h.main.appendChild(slide);

  let reads = 0;
  const realReadLabel = h.window.ABPDetect.readLabel;
  h.window.ABPDetect.readLabel = function () { reads++; return realReadLabel.apply(this, arguments); };

  function unrelatedChange() {
    const extra = h.doc.createElement("div");
    h.doc.body.appendChild(extra);
    h.state.observer.callback([{ type: "childList", target: h.doc.body, addedNodes: [extra], removedNodes: [] }]);
    h.scheduler.flush();
  }

  unrelatedChange(); // first look at the reel on screen
  check("the reel on screen is read once", reads > 0, true);
  reads = 0;
  unrelatedChange();
  unrelatedChange();
  check("and not re-read while its content is unchanged", reads, 0);

  const late = h.doc.createElement("span").append(text(h, "Ad"));
  slide.appendChild(late);
  h.state.observer.callback([{ type: "childList", target: h.doc.body, addedNodes: [], removedNodes: [] }]);
  h.scheduler.flush();
  check("a label added to the reel later is still noticed", slide.getAttribute("data-abp-reel-hidden") !== null || slide.getAttribute("data-abp-reel-cover") === "1", true);
});

section("32. Same-length disclosure changes are detected and the video layer is restored", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const next = nextButton(h, "Next Card", true);
  const slide = h.doc.createElement("div");
  slide.rect = { left: 0, top: 0, width: 400, height: 800 };
  slide.setAttribute("data-pagelet", "ReelViewerRoot");
  const video = stubVideo(h);
  video.style.setProperty("visibility", "visible", "important");
  video.style.setProperty("opacity", "0.8");
  const badge = h.doc.createElement("span");
  badge.setAttribute("aria-label", "No thanks"); // same length as "Sponsored"
  slide.append(video, badge);
  h.main.appendChild(slide);

  function unrelatedMutation() {
    h.state.observer.callback([{ type: "attributes", target: h.doc.body, attributeName: "class", addedNodes: [], removedNodes: [] }]);
    h.scheduler.flush();
  }

  unrelatedMutation(); // prime the active-reel signature without an ad signal
  check("the ordinary reel starts uncovered", slide.getAttribute("data-abp-reel-cover"), null);

  // Facebook may change only the disclosure attribute while element count and
  // text length stay constant. The active-reel check must see that exact change.
  badge.setAttribute("aria-label", "Sponsored");
  unrelatedMutation();
  check("the same-length sponsored label is detected", slide.getAttribute("data-abp-reel-hidden"), "sponsored-reel");
  check("the video surface is explicitly hidden", video.style.getPropertyValue("visibility"), "hidden");
  check("the video opacity is zero while covered", video.style.getPropertyValue("opacity"), "0");
  check("the explicit next control advances the confirmed ad", next.__clicks, 1);

  h.window.location.pathname = "/?ref=feed";
  h.scheduler.tickInterval(1);
  check("video visibility is restored on exit", video.style.getPropertyValue("visibility"), "visible");
  check("video visibility priority is restored", video.style.getPropertyPriority("visibility"), "important");
  check("video opacity is restored on exit", video.style.getPropertyValue("opacity"), "0.8");
});

section("33. A card that stays hidden during a slow mount is retried until visible", () => {
  const h = createHarness();
  const ad = card(h);
  ad.style.setProperty("opacity", "0");
  ad.appendChild(h.doc.createElement("span").append(text(h, "Sponsored")));
  h.main.appendChild(ad);

  h.state.observer.callback([{ type: "childList", target: h.main, addedNodes: [ad], removedNodes: [] }]);
  // Run the first retry and its scheduled local sweep, leaving the remaining
  // insertion retries queued while the card is still in its fade-in state.
  h.scheduler.queue.shift()();
  h.scheduler.queue.shift()();
  for (let i = 0; i < 6; i++) h.scheduler.queue.shift()();
  check("the ad is not classified while its card is still invisible", isBlocked(ad), false);

  ad.style.setProperty("opacity", "1");
  h.scheduler.queue.shift()();
  h.scheduler.flush();
  check("the ad is hidden on the next retry after the fade-in", isBlocked(ad), true);
});

section("34. Shadow signals respect disabled settings and live opt-out", () => {
  for (const settings of [{ adBlock: false }, { fbSponsored: false }]) {
    const h = createHarness({ settings });
    h.window.location.pathname = "/reel/1";
    const next = nextButton(h, "Next Card", true);
    const { adReel, video } = reelViewerAd(h);
    const host = h.doc.createElement("span");
    adReel.appendChild(host);
    h.doc.dispatch("__abpShadowSponsoredDetected", host);
    h.scheduler.flush();
    check("disabled settings reject direct shadow hides", adReel.hasAttribute("data-abp-reel-hidden"), false);
    check("disabled settings do not navigate or mute", next.__clicks === 0 && !video.muted, true);
  }
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  let stopSignals = 0;
  h.doc.addEventListener("__abpFacebookProbeStop", () => { stopSignals++; });
  h.changeSettings({ fbSponsored: false });
  check("live disable tells the MAIN-world probe to stop", stopSignals, 1);
  check("turning Facebook off releases existing Reel covers", adReel.hasAttribute("data-abp-reel-cover"), false);
  check("turning Facebook off restores audio", video.muted, false);
  h.changeSettings({ fbSponsored: true });
  check("turning Facebook back on re-detects the ad", adReel.hasAttribute("data-abp-reel-hidden"), true);
  h.changeSettings({ whitelist: ["facebook.com"] });
  check("live whitelist change releases existing covers", adReel.hasAttribute("data-abp-reel-hidden"), false);
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("periodic scans honor the live whitelist", adReel.hasAttribute("data-abp-reel-cover"), false);
  const initiallyExcluded = createHarness({ settings: { whitelist: ["facebook.com"] } });
  const post = card(initiallyExcluded);
  post.appendChild(initiallyExcluded.doc.createElement("span").append(text(initiallyExcluded, "Sponsored")));
  initiallyExcluded.main.appendChild(post);
  check("an initially whitelisted page does not start scanning", initiallyExcluded.state.observer, null);
  initiallyExcluded.changeSettings({ whitelist: [] });
  check("removing the initial whitelist starts detection", isBlocked(post), true);
});

section("35. Diagnostic mode outlines without hiding, muting, or counting", () => {
  const messages = [];
  const h = createHarness({ settings: { fbDebug: true }, messages });
  const ad = card(h);
  const video = stubVideo(h);
  ad.style.setProperty("outline", "1px solid blue");
  ad.append(video, h.doc.createElement("span").append(text(h, "Sponsored")));
  h.main.appendChild(ad);
  h.mutate({ type: "childList", target: h.main, addedNodes: [ad] });
  check("debug card has an outline marker", ad.hasAttribute("data-abp-debug"), true);
  check("debug card has no hiding attribute", isBlocked(ad), false);
  check("debug media is left playing with its original audio", !video.muted && !video.__paused, true);
  check("debug detections do not report blocked counts", messages.length, 0);
  h.changeSettings({ adBlock: false });
  check("disabling removes debug markers", ad.hasAttribute("data-abp-debug"), false);
  check("cleanup restores the original outline", ad.style.getPropertyValue("outline"), "1px solid blue");
});

section("36. Reel advancement confirms transitions and bounds no-op retries", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const ignored = nextButton(h, "Next Card", true);
  const { adReel } = reelViewerAd(h);
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("a no-op click is reported as unconfirmed", adReel.getAttribute("data-abp-reel-skip"), "transition-not-confirmed");
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the same ignored control is not clicked again", ignored.__clicks, 1);
  const replacement = nextButton(h, "Next Card", true);
  replacement.click = function () { replacement.__clicks++; h.window.location.pathname = "/reel/2"; };
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("a replacement control gets one recovery attempt", replacement.__clicks, 1);
  check("route movement confirms the transition", adReel.getAttribute("data-abp-reel-skip"), "transition-confirmed");
  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("a confirmed transition never advances twice", replacement.__clicks, 1);
});

console.log(`\n${"=".repeat(64)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(64)}`);
if (failed) process.exit(1);

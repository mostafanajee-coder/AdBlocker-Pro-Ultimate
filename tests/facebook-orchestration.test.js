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
  }

  setProperty(name, value) {
    this.values[name] = String(value);
  }

  removeProperty(name) {
    delete this.values[name];
  }

  getPropertyValue(name) {
    return this.values[name] || "";
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
      local: { get: (_keys, callback) => callback({}) },
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

  return { doc, main, sidebar, scheduler, state, window: windowObject, mutate };
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

// The fake scheduler runs queued callbacks instantly, ignoring their delay,
// so step until the skip attempt has muted the ad (before its 700ms check).
function stepUntil(h, done) {
  let guard = 0;
  while (!done() && h.scheduler.queue.length && guard++ < 20) h.scheduler.queue.shift()();
}

section("12. On the Reels viewer a sponsored reel is skipped, never blacked out", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  stepUntil(h, () => video.muted === true);

  check("the ad reel is never marked hidden on the viewer", isBlocked(adReel), false);
  check("no display:none is applied to the slide", adReel.style.getPropertyValue("display"), "");
  check("its audio is muted while the skip is attempted", video.muted, true);
  check("it is not paused on screen (a paused slide is what showed black)", video.__paused, undefined);

  // The viewer never moved to the next reel: the skip did not take.
  h.scheduler.flush();
  check("sound comes back when the skip did not take", video.muted, false);
  check("the ad is left playing rather than hidden", isBlocked(adReel), false);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("the same creative is not retried (no repeated muting)", video.muted, false);
});

section("13. On the Reels viewer a skip that works pauses the ad off screen", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  stepUntil(h, () => video.muted === true);

  h.window.location.pathname = "/reel/2"; // Facebook moved on to the next reel
  h.scheduler.flush();
  check("the skipped ad is paused so its audio cannot leak", video.__paused, true);
  check("the node gets its original sound state back", video.muted, false);
  check("the slide itself is still never display:none'd", isBlocked(adReel), false);
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

section("16. A reel's \"Ad\" label is found even deep inside the slide", () => {
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
  stepUntil(h, () => video.muted === true);
  check("the ad reel is recognised and a skip is attempted", video.muted, true);
  check("the attempt is recorded for diagnosis", String(slide.getAttribute("data-abp-reel-skip")).indexOf("tried:") === 0, true);
});

section("17. Two reels in one container: only the ad reel is acted on, and only once on screen", () => {
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
  check("the ad reel waits while it is still off screen", adVideo.muted, false);
  check("nothing is clicked yet", cardNext.__clicks + bareNext.__clicks + hiddenNext.__clicks, 0);

  // The user scrolls: the ad reel is now the one on screen.
  organic.rect = { left: 0, top: -900, width: 400, height: 800 };
  ad.rect = { left: 0, top: 0, width: 400, height: 800 };
  h.scheduler.tickInterval(0);
  stepUntil(h, () => adVideo.muted === true);
  check("the ad reel is muted once it is on screen", adVideo.muted, true);
  check("the organic reel is still never touched", organicVideo.muted, false);
  check("the specific \"Next Card\" control is clicked", cardNext.__clicks, 1);
  check("the bare \"Next\" and the hidden control are not", bareNext.__clicks + hiddenNext.__clicks, 0);
  check("what was tried is recorded", ad.getAttribute("data-abp-reel-skip"), "tried:button:Next Card");

  h.window.location.pathname = "/reel/2"; // the viewer moved on
  h.scheduler.flush();
  check("the result is recorded", h.doc.documentElement.getAttribute("data-abp-reel-skip-last"), "skipped:button:Next Card");
  check("the skipped ad is paused", adVideo.__paused, true);
  check("the organic reel was never muted at any point", organicVideo.muted, false);
});

function makeFakeIntersectionObserver() {
  const instances = [];
  class FakeIntersectionObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Set();
      instances.push(this);
    }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
  }
  function fire(target, ratio) {
    for (const io of instances) {
      if (io.targets.has(target)) io.callback([{ target, isIntersecting: ratio > 0, intersectionRatio: ratio }]);
    }
  }
  return { FakeIntersectionObserver, fire, instances };
}

section("18. A reel ad loaded ahead of time is covered as it arrives and skipped at once", () => {
  const io = makeFakeIntersectionObserver();
  const h = createHarness({ IntersectionObserver: io.FakeIntersectionObserver });
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
  check("the ad, still off screen, is not covered yet", ad.getAttribute("data-abp-reel-cover"), null);
  check("but it is already being watched", io.instances.some((i) => i.targets.has(ad)), true);

  // The user starts moving to it: its first pixels come into view.
  ad.rect = { left: 0, top: 860, width: 400, height: 800 };
  io.fire(ad, 0.05);
  check("covered from its first visible pixel", ad.style.getPropertyValue("opacity"), "0");
  check("its sound is already off", adVideo.muted, true);
  check("not skipped before it arrives", cardNext.__clicks, 0);

  // It arrives.
  organic.rect = { left: 0, top: -900, width: 400, height: 800 };
  ad.rect = { left: 0, top: 0, width: 400, height: 800 };
  io.fire(ad, 1);
  check("skipped the moment it arrives, without waiting for a sweep", cardNext.__clicks, 1);
  check("still covered while the skip completes", ad.style.getPropertyValue("opacity"), "0");

  h.window.location.pathname = "/reel/556";
  h.scheduler.flush();
  check("the cover is removed once it is skipped", ad.style.getPropertyValue("opacity"), "");
  check("the skipped ad is paused off screen", adVideo.__paused, true);
  check("the organic reel is never touched", organicVideo.muted, false);
});

section("19. If both skip attempts fail, the ad is uncovered and plays rather than staying dark", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const cardNext = nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  stepUntil(h, () => video.muted === true);
  check("covered while the skip is attempted", adReel.style.getPropertyValue("opacity"), "0");

  h.scheduler.flush(); // the viewer never moves
  check("a second attempt is made before giving up", cardNext.__clicks, 2);
  check("the outcome is recorded", adReel.getAttribute("data-abp-reel-skip"), "not-skipped:button:Next Card");
  check("the cover is removed", adReel.style.getPropertyValue("opacity"), "");
  check("its sound is back", video.muted, false);

  h.scheduler.tickInterval(0);
  h.scheduler.flush();
  check("it is not retried after giving up", cardNext.__clicks, 2);
});

section("20. Scrolling back to an ad that was skipped skips it again", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  const cardNext = nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  stepUntil(h, () => video.muted === true);
  h.window.location.pathname = "/reel/2";
  h.scheduler.flush();
  check("first pass: skipped", adReel.getAttribute("data-abp-reel-skip"), "skipped:button:Next Card");

  // The user goes back up: the viewer returns to the ad.
  h.window.location.pathname = "/reel/1";
  h.scheduler.tickInterval(0);
  stepUntil(h, () => video.muted === true);
  check("covered again on the way back", adReel.style.getPropertyValue("opacity"), "0");
  check("and skipped again", cardNext.__clicks, 2);
});

section("21. A reel whose only ad sign is the hidden (shadow DOM) label is still skipped", () => {
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
  check("the shadow-DOM signal gets it skipped", cardNext.__clicks, 1);
  check("it is covered meanwhile", slide.style.getPropertyValue("opacity"), "0");
  check("and muted", video.muted, true);
});

section("22. The cover spans the whole reel, including its like/comment column", () => {
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
  stepUntil(h, () => video.muted === true);
  check("the whole reel is covered", slide.style.getPropertyValue("opacity"), "0");
  check("not just the box around the video", videoBox.style.getPropertyValue("opacity"), "");

  h.window.location.pathname = "/reel/43"; // the first click worked
  h.scheduler.flush();
  check("one ad gets exactly one skip, so the reel after it is not skipped too", next.__clicks, 1);
});

section("23. A skipped ad stays covered while it slides out, and is uncovered once it is gone", () => {
  const h = createHarness();
  h.window.location.pathname = "/reel/1";
  nextButton(h, "Next Card", true);
  const { adReel, video } = reelViewerAd(h);

  h.scheduler.tickInterval(0);
  stepUntil(h, () => video.muted === true);

  // The viewer starts moving on: the ad is leaving the centre but still on screen.
  adReel.rect = { left: 0, top: 600, width: 400, height: 800 };
  stepUntil(h, () => String(adReel.getAttribute("data-abp-reel-skip")).indexOf("skipped:") === 0);
  check("the skip is confirmed", String(adReel.getAttribute("data-abp-reel-skip")).indexOf("skipped:") === 0, true);
  check("still covered while it slides out", adReel.style.getPropertyValue("opacity"), "0");

  adReel.rect = { left: 0, top: 950, width: 400, height: 800 }; // fully off screen
  stepUntil(h, () => adReel.style.getPropertyValue("opacity") === "");
  check("uncovered once it has left the screen", adReel.style.getPropertyValue("opacity"), "");
  check("its sound state is restored for reuse", video.muted, false);
});

section("24. When Reels opens full width, the whole reel is still covered", () => {
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
  stepUntil(h, () => video.muted === true);
  check("the full-width reel is covered, caption included", slide.style.getPropertyValue("opacity"), "0");
});

section("25. The cover stops at the reel and never takes in the viewer's Next Card control", () => {
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
  stepUntil(h, () => video.muted === true);
  check("the reel is covered", slide.style.getPropertyValue("opacity"), "0");
  check("the viewer around it (with Next Card) is not", viewer.style.getPropertyValue("opacity"), "");
  check("and Next Card is clicked", next.__clicks, 1);
});

section("26. On a wide screen, an ad label appearing on the reel on screen is acted on at once", () => {
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
  stepUntil(h, () => video.muted === true); // runs only the timers this page change queued
  check("it is covered straight away, with no periodic sweep involved", slide.style.getPropertyValue("opacity"), "0");
  check("and skipped", next.__clicks, 1);
});

section("27. Blocked-ad reports carry how many were newly blocked, not a running total to be re-added", () => {
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

section("28. An ordinary reel is not re-read on every unrelated page change", () => {
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
  check("a label added to the reel later is still noticed", slide.getAttribute("data-abp-reel-skip") !== null || slide.style.getPropertyValue("opacity") === "0", true);
});

console.log(`\n${"=".repeat(64)}`);
console.log(`  ${passed} passed, ${failed} failed`);
console.log(`${"=".repeat(64)}`);
if (failed) process.exit(1);

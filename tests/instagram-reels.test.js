"use strict";
const assert = require("node:assert/strict");
const IG = require("../instagram.js");
let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; console.log("  PASS ", label); }

function environment(options = {}) {
  const observers = [], jobs = new Map(), messages = [], storageReads = [], windowEvents = new Map(), docEvents = new Map();
  let storageListener, nextTimer = 1;
  function emit(record) {
    for (const observer of observers) {
      const config = observer.config; if (!config) continue;
      if (record.type === "attributes" && (!config.attributes || !config.attributeFilter.includes(record.attributeName))) continue;
      if (record.type === "characterData" && !config.characterData) continue;
      if (record.type === "childList" && !config.childList) continue;
      observer.callback([record]);
    }
  }
  class Element {
    constructor(tag, text = "", attributes = {}) {
      this.tagName = tag.toUpperCase(); this.nodeType = 1; this.text = text; this.attributes = { ...attributes };
      this.children = []; this.isConnected = true; this.box = { top: 80, bottom: 580, width: 350, height: 500 };
      this.style = {}; this.paused = false; this.muted = false; this.src = ""; this.clicks = 0; this.pauses = 0; this.plays = 0;
    }
    appendChild(node) { this.children.push(node); node.parentElement = this; emit({ type: "childList", target: this, addedNodes: [node] }); return node; }
    get textContent() { return this.text + this.children.map(child => child.textContent).join(" "); }
    set textContent(value) { this.text = value; emit({ type: "characterData", target: { nodeType: 3, parentElement: this } }); }
    getAttribute(key) { return Object.hasOwn(this.attributes, key) ? this.attributes[key] : null; }
    setAttribute(key, value) { if (this.attributes[key] === value) return; this.attributes[key] = value; if (key === "src") this.src = value; emit({ type: "attributes", target: this, attributeName: key }); }
    removeAttribute(key) { delete this.attributes[key]; emit({ type: "attributes", target: this, attributeName: key }); }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    matches(selectors) {
      return selectors.split(",").some(selector => {
        selector = selector.trim(); const tag = /^([a-z][\w-]*)/i.exec(selector);
        if (tag && this.tagName !== tag[1].toUpperCase()) return false;
        const attrs = [...selector.matchAll(/\[([\w-]+)(\*=|=)?(?:['"]([^'"]*)['"])?\]/g)];
        if (!tag && !attrs.length) return false;
        return attrs.every(([, key, operator, value]) => {
          const actual = this.getAttribute(key);
          return actual !== null && (!operator || (operator === "=" ? actual === value : actual.includes(value)));
        });
      });
    }
    closest(selector) { let node = this; while (node) { if (node.matches(selector)) return node; node = node.parentElement; } return null; }
    querySelectorAll(selector) { const found = []; for (const child of this.children) { if (child.matches(selector)) found.push(child); found.push(...child.querySelectorAll(selector)); } return found; }
    getBoundingClientRect() { return this.box; }
    remove() { if (this.parentElement) { const parent = this.parentElement; parent.children = parent.children.filter(child => child !== this); emit({ type: "childList", target: parent, addedNodes: [] }); } this.isConnected = false; }
    pause() { this.pauses++; this.paused = true; }
    play() { this.plays++; this.paused = false; return Promise.resolve(); }
    click() { this.clicks++; if (this.onClick) this.onClick(); }
  }
  const root = new Element("html"), head = root.appendChild(new Element("head")), body = root.appendChild(new Element("body"));
  const doc = { nodeType: 9, head, documentElement: root, createElement: tag => new Element(tag),
    elementFromPoint: () => body.querySelectorAll("video")[0] || body,
    getElementById: id => root.querySelectorAll("[id]").find(node => node.getAttribute("id") === id) || null,
    querySelectorAll: selector => root.querySelectorAll(selector),
    addEventListener: (name, callback) => docEvents.set(name, callback), removeEventListener: name => docEvents.delete(name) };
  const settings = { adBlock: true, igSponsored: true, whitelist: [], ...options.settings };
  const win = { document: doc, innerHeight: 900, location: { hostname: "www.instagram.com", pathname: options.path || "/reels/" },
    setTimeout: callback => { const id = nextTimer++; jobs.set(id, callback); return id; }, clearTimeout: id => jobs.delete(id),
    addEventListener: (name, callback) => windowEvents.set(name, callback), removeEventListener: name => windowEvents.delete(name),
    getComputedStyle: node => ({ position: "static", display: "block", visibility: "visible", opacity: "1", ...node.style }),
    MutationObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe(_node, config) { this.config = config; } disconnect() { this.config = null; } },
    chrome: { runtime: { sendMessage: async message => { messages.push(message); } }, storage: {
      local: { get: (_keys, callback) => options.defer ? storageReads.push(callback) : callback({ ...settings }) },
      onChanged: { addListener: callback => { storageListener = callback; }, removeListener() {} }
    } } };
  function flush() { let loops = 0; while (jobs.size) { assert.ok(loops++ < 40, "no permanent rescan loop"); const [id, callback] = jobs.entries().next().value; jobs.delete(id); callback(); } }
  function card({ tag = "div", label = "Sponsored", badgeTag = "span", badgeTop = 80, caption = false, header = false, role = true, muted = false } = {}) {
    const node = body.appendChild(new Element(tag, "", role && tag !== "article" ? { role: "article" } : {}));
    const video = node.appendChild(new Element("video")); video.setAttribute("src", "blob:ad-video"); video.muted = muted;
    const row = node.appendChild(new Element(caption ? "figcaption" : header ? "header" : "div"));
    const author = row.appendChild(new Element("a", "creator", { href: "https://www.instagram.com/creator/" }));
    author.box = { top: 80, bottom: 100, left: 100, right: 200, width: 100, height: 20 };
    const badge = row.appendChild(new Element(badgeTag, label)); badge.box = { top: badgeTop, bottom: badgeTop + 20, left: 100, right: 200, width: 100, height: 20 };
    return { node, video, badge, row, hidden: () => node.getAttribute("data-abp-instagram-ad") === "1" };
  }
  function update(patch) {
    const changes = {}; for (const [key, value] of Object.entries(patch)) { settings[key] = value; changes[key] = { newValue: value }; }
    storageListener(changes, "local"); flush();
  }
  return { doc, win, body, head, Element, settings, messages, observers, jobs, storageReads, windowEvents, docEvents, card, flush, update };
}

check(IG.isReelsPath("/reels/") && IG.isReelsPath("/reel/abc/"), "real Reel routes select the viewer path");
check(!IG.isReelsPath("/reelshort/") && !IG.isReelsPath("/creator/reels/"), "profile tabs and reel-like usernames are not treated as the viewer");
check(IG.isOfficialAdLink("https://www.instagram.com/ads/ig_redirect?x=1"), "recognizes a first-party Instagram ad redirect");
check(!IG.isOfficialAdLink("https://evil.test/?next=facebook.com/ads/about") && !IG.isOfficialAdLink("https://notfacebook.com/ads/about"), "URLs merely mentioning Meta ads do not prove an ad");
check(!IG.isSponsoredLabel("Paid partnership helped my project"), "ordinary partnership sentences are not disclosure badges");

{
  const e = environment(), ad = e.card(); IG.start(e.win); e.flush();
  check(ad.hidden() && ad.node.getAttribute("data-abp-instagram-mode") === "viewer", "a non-article Reel with an author/badge row is covered");
  check(ad.video.muted && !ad.video.paused && ad.video.pauses === 0 && ad.video.plays === 0, "viewer blocking mutes without pausing or restarting playback");
  check(ad.node.parentElement === e.body && ad.node.children.includes(ad.video), "Reel nodes and layout ownership stay mounted");
  ad.badge.textContent = "Organic content"; ad.video.setAttribute("src", "blob:organic"); e.flush();
  check(!ad.hidden() && !ad.video.muted, "recycled organic media is uncovered and its original mute state restored");
  check(ad.video.plays === 0 && ad.video.pauses === 0, "restoration never forces playback");
  ad.badge.textContent = "إعلان"; e.flush();
  check(ad.hidden() && e.messages.length === 2, "a late Arabic label alone triggers detection and counts a new creative");
  e.windowEvents.get("scroll")(); e.flush();
  check(e.messages.length === 2, "repeated scans do not count the same creative repeatedly");
  e.update({ igSponsored: false });
  check(!ad.hidden() && !ad.video.muted && e.jobs.size === 0, "Instagram opt-out releases effects and pending work");
  e.update({ igSponsored: true }); check(ad.hidden(), "re-enabling the module rescans current cards");
  e.update({ whitelist: ["instagram.com"] }); check(!ad.hidden() && !ad.video.muted, "parent-domain whitelist releases current Reels immediately");
  e.update({ whitelist: [] }); e.update({ adBlock: false }); check(!ad.hidden(), "global blocker opt-out is honored");
}
{
  const e = environment({ path: "/" }), ad = e.card({ tag: "article", header: true }); IG.start(e.win); e.flush();
  check(ad.hidden() && ad.node.getAttribute("data-abp-instagram-mode") === "feed", "feed articles keep their separate collapse mode");
}
{
  const e = environment(), ad = e.card({ role: false }); IG.start(e.win); e.flush();
  check(ad.hidden(), "a qualified single-video div Reel is discovered without article semantics");
}
{
  const e = environment(), ordinary = e.card({ caption: true }); IG.start(e.win); e.flush();
  check(!ordinary.hidden() && !ordinary.video.muted, "Sponsored inside a caption is protected even beside an author link");
  ordinary.badge.setAttribute("aria-label", "Sponsored"); e.flush();
  check(!ordinary.hidden(), "caption ARIA text does not override organic-content protection");
}
{
  const e = environment(), ordinary = e.card({ label: "" }); ordinary.row.children[0].textContent = "Sponsored";
  IG.start(e.win); e.flush(); check(!ordinary.hidden(), "a creator named Sponsored is not an advertisement");
}
{
  const e = environment(), caption = e.card(); caption.badge.box = { top: 150, bottom: 170, left: 100, right: 200, width: 100, height: 20 };
  IG.start(e.win); e.flush(); check(!caption.hidden(), "an ad-like word outside the author disclosure row is not sufficient");
}
{
  const e = environment(), ad = e.card({ label: "Ad", badgeTag: "div", badgeTop: 150 }); IG.start(e.win); e.flush();
  check(ad.hidden(), "Instagram's standalone Ad disclosure below the author row is recognized");
}
{
  const e = environment(), ordinary = e.card({ label: "Ad", caption: true }); IG.start(e.win); e.flush();
  check(!ordinary.hidden(), "a standalone Ad word in a caption remains organic content");
}
{
  const e = environment(), ad = e.card({ label: "Ordinary content" }); IG.start(e.win); e.flush();
  ad.badge.setAttribute("aria-label", "Sponsored"); e.flush();
  check(ad.hidden(), "late ARIA-only ad disclosures are observed");
  check(e.observers[0].config.characterData && e.observers[0].config.attributes, "text-node and disclosure-attribute mutations are watched");
}
{
  const e = environment({ defer: true, settings: { igSponsored: false } }), ad = e.card(); IG.start(e.win); e.flush();
  check(!ad.hidden() && !ad.video.muted && e.jobs.size === 0, "no effects occur while initial settings are unknown");
  e.storageReads.shift()({ ...e.settings }); e.flush(); check(!ad.hidden(), "initial opt-out is never briefly bypassed");
}
{
  const e = environment(), ad = e.card({ muted: true }), api = IG.start(e.win); e.flush(); api.stop();
  check(ad.video.muted && !ad.hidden() && !e.observers[0].config, "teardown preserves pre-existing mute and disconnects observation");
}
{
  const e = environment(), ad = e.card(), control = e.body.appendChild(new e.Element("button", "", { "aria-label": "Navigate to next Reel" }));
  IG.start(e.win); e.flush(); check(ad.hidden() && control.clicks === 1, "a confirmed ad may use Instagram's explicit Navigate to next Reel control");
  e.windowEvents.get("scroll")(); e.flush(); check(control.clicks === 1, "an ignored Next reel control is not repeatedly clicked");
}
{
  const e = environment(), ad = e.card(), generic = e.body.appendChild(new e.Element("button", "", { "aria-label": "Next" }));
  IG.start(e.win); e.flush(); check(ad.hidden() && generic.clicks === 0, "generic Next is never used as a Reel navigation fallback");
}
{
  const e = environment(), ordinary = e.card({ label: "Regular content" }), control = e.body.appendChild(new e.Element("button", "", { "aria-label": "Next reel" }));
  IG.start(e.win); e.flush(); check(!ordinary.hidden() && control.clicks === 0, "organic Reels never trigger navigation");
}
{
  const e = environment(), ad = e.card(), control = e.body.appendChild(new e.Element("button", "", { "aria-label": "Next reel" }));
  e.doc.elementFromPoint = () => e.body; IG.start(e.win); e.flush();
  check(ad.hidden() && control.clicks === 0, "an ad behind another surface cannot advance the visible organic Reel");
}
{
  const e = environment(), ad = e.card(), control = e.body.appendChild(new e.Element("button", "", { "aria-label": "Next reel" }));
  ad.node.box = { top: 1200, bottom: 1700, height: 500, width: 350 }; IG.start(e.win); e.flush();
  check(control.clicks === 0, "preloaded offscreen ads never trigger navigation");
}
{
  const e = environment(), ad = e.card(); IG.start(e.win); e.flush();
  ad.node.removeAttribute("data-abp-instagram-ad"); e.flush(); check(ad.hidden(), "removed ad markers are repaired without a polling loop");
  e.head.children.find(child => child.tagName === "STYLE").remove(); e.flush();
  check(e.head.children.filter(child => child.tagName === "STYLE").length === 1, "removed owned styles are restored without duplicate sheets");
}
{
  const e = environment({ defer: true }), ad = e.card(); IG.start(e.win);
  e.update({ igSponsored: false });
  e.storageReads[1]({ adBlock: true, igSponsored: false, whitelist: [] });
  e.storageReads[0]({ adBlock: true, igSponsored: true, whitelist: [] }); e.flush();
  check(!ad.hidden() && !ad.video.muted, "a late initial settings callback cannot override a newer opt-out");
}
{
  const e = environment(), ad = e.card(); IG.start(e.win); e.flush();
  e.docEvents.get("keydown")({ isTrusted: true, key: "m", type: "keydown", target: ad.video });
  ad.video.muted = false; ad.badge.textContent = "Regular content"; e.flush();
  check(!ad.video.muted && !ad.hidden(), "trusted manual audio choices are not overwritten on restoration");
}
console.log(`\nInstagram Reels: ${passed} passed, 0 failed`);

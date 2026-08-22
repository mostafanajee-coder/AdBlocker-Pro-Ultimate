"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const YT = require("../youtube-sanitizer.js");

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    passed++;
    console.log("  PASS  " + label);
  } else {
    failed++;
    console.error("  FAIL  " + label);
  }
}

function section(name) {
  console.log("\n" + name);
  console.log("-".repeat(name.length));
}

section("YouTube player response pruning");

const root = {
  videoDetails: { videoId: "abc", title: "Real video" },
  adPlacements: [{ id: 1 }],
  playerAds: [{ id: 2 }],
  adSlots: [{ id: 3 }],
  adBreakHeartbeatParams: "ad-heartbeat"
};
const sameRoot = YT.sanitize(root);

check(sameRoot === root, "sanitizes in place without cloning the response");
check(!("adPlacements" in root), "removes adPlacements");
check(!("playerAds" in root), "removes playerAds");
check(!("adSlots" in root), "removes adSlots");
check(!("adBreakHeartbeatParams" in root), "removes ad heartbeat data");
check(root.videoDetails.videoId === "abc", "preserves normal video metadata");

section("Nested, feed and Shorts ads");

const nested = {
  response: {
    playerResponse: {
      streamingData: { formats: [{ itag: 18 }] },
      adPlacements: [{}],
      adSlots: [{}]
    }
  },
  contents: [
    { videoRenderer: { videoId: "keep" } },
    { adSlotRenderer: { slotId: "drop" } },
    { promotedSparklesWebRenderer: { id: "drop" } },
    { richItemRenderer: { content: { adSlotRenderer: { slotId: "nested-drop" } } } }
  ],
  entries: [
    { command: { reelWatchEndpoint: { videoId: "short", adClientParams: { isAd: false } } } },
    { command: { reelWatchEndpoint: { videoId: "ad", adClientParams: { isAd: true } } } }
  ]
};

YT.sanitize(nested);
check(!("adPlacements" in nested.response.playerResponse), "removes nested adPlacements");
check(!("adSlots" in nested.response.playerResponse), "removes nested adSlots");
check(nested.response.playerResponse.streamingData.formats[0].itag === 18, "keeps streaming formats");
check(nested.contents.length === 1 && nested.contents[0].videoRenderer.videoId === "keep", "removes feed ad renderers only");
check(nested.entries.length === 1 && nested.entries[0].command.reelWatchEndpoint.videoId === "short", "removes Shorts ad entries");

section("JSON text interception");

const embedded = {
  playerResponse: JSON.stringify({
    videoDetails: { videoId: "embedded" },
    adPlacements: [{}],
    playerAds: [{}]
  })
};
YT.sanitize(embedded);
const embeddedPlayer = JSON.parse(embedded.playerResponse);
check(embeddedPlayer.videoDetails.videoId === "embedded", "keeps embedded player content");
check(!("adPlacements" in embeddedPlayer) && !("playerAds" in embeddedPlayer), "cleans embedded playerResponse JSON");

const xssi = ")]}'\n" + JSON.stringify({ videoDetails: { videoId: "xssi" }, adSlots: [{}] });
const cleanXssi = YT.sanitizeText(xssi);
check(cleanXssi.startsWith(")]}'\n"), "preserves an XSSI prefix");
check(!("adSlots" in JSON.parse(cleanXssi.slice(5))), "cleans prefixed JSON");
check(YT.sanitizeText('{"videoDetails":{"videoId":"plain"}}') === '{"videoDetails":{"videoId":"plain"}}', "fast-passes responses without ad markers");

const cyclic = { videoDetails: { videoId: "cycle" }, adSlots: [{}] };
cyclic.self = cyclic;
YT.sanitize(cyclic);
check(cyclic.self === cyclic && !("adSlots" in cyclic), "handles cyclic objects safely");

section("Regression guards for the old accelerated-ad bug");

const repo = path.resolve(__dirname, "..");
const visualSource = fs.readFileSync(path.join(repo, "youtube.js"), "utf8");
const mainSource = fs.readFileSync(path.join(repo, "youtube-main.js"), "utf8");
const sharedSource = fs.readFileSync(path.join(repo, "inject.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "manifest.json"), "utf8"));
const youtubeMainEntry = manifest.content_scripts.find((entry) =>
  Array.isArray(entry.js) && entry.js.includes("youtube-main.js")
);

check(!/playbackRate\s*=\s*16/.test(visualSource + mainSource), "new YouTube engine never accelerates ads");
check(!/setInterval\s*\(/.test(visualSource + mainSource), "new YouTube engine has no permanent polling interval");
check(!/playbackRate\s*=\s*16|pulseYouTubePlayer/.test(sharedSource), "legacy accelerated engine is removed");
check(Boolean(youtubeMainEntry && youtubeMainEntry.world === "MAIN"), "response interceptor runs in the MAIN world");
check(Boolean(youtubeMainEntry && youtubeMainEntry.js[0] === "youtube-sanitizer.js"), "sanitizer loads before the MAIN interceptor");
check(Boolean(youtubeMainEntry && youtubeMainEntry.all_frames && youtubeMainEntry.match_about_blank), "same-origin YouTube frames cannot bypass the interceptor");
check(visualSource.includes("button.ytp-ad-skip-button"), "skip-ad controls are hidden by the visual guard");

async function testMainWorldHooks() {
  section("MAIN-world fetch, XHR and bootstrap hooks");

  class FakeResponse {
    constructor(text, url) {
      this._text = text;
      this.url = url;
    }
    json() { return Promise.resolve(JSON.parse(this._text)); }
    text() { return Promise.resolve(this._text); }
    arrayBuffer() { return Promise.resolve(new TextEncoder().encode(this._text).buffer); }
    clone() { return new FakeResponse(this._text, this.url); }
  }

  class FakeXHR {
    constructor() {
      this._text = "";
      this.responseType = "";
    }
    open() {}
  }

  Object.defineProperty(FakeXHR.prototype, "responseText", {
    configurable: true,
    get() { return this._text; }
  });
  Object.defineProperty(FakeXHR.prototype, "response", {
    configurable: true,
    get() { return this.responseType === "json" ? JSON.parse(this._text) : this._text; }
  });

  const sandbox = {
    console,
    TextDecoder,
    TextEncoder,
    Blob,
    XMLHttpRequest: FakeXHR,
    document: {
      documentElement: {
        getAttribute() { return null; }
      }
    },
    location: { hostname: "www.youtube.com" },
    fetch(input) {
      const url = typeof input === "string" ? input : input.url;
      return Promise.resolve(new FakeResponse(JSON.stringify({
        videoDetails: { videoId: "hooked" },
        adPlacements: [{}],
        adSlots: [{}]
      }), url));
    }
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(repo, "youtube-sanitizer.js"), "utf8"), context);
  vm.runInContext(mainSource, context);

  const playerResponse = await context.fetch("/youtubei/v1/player?key=test").then((r) => r.json());
  check(playerResponse.videoDetails.videoId === "hooked", "fetch hook preserves playable video data");
  check(!("adPlacements" in playerResponse) && !("adSlots" in playerResponse), "fetch hook strips player ads before consumption");

  const browseResponse = await context.fetch("/youtubei/v1/browse?key=test").then((r) => r.json());
  check("adPlacements" in browseResponse, "fetch hook leaves unrelated endpoints untouched");

  context.ytInitialPlayerResponse = {
    videoDetails: { videoId: "initial" },
    playerAds: [{}]
  };
  check(context.ytInitialPlayerResponse.videoDetails.videoId === "initial", "initial-response trap preserves video data");
  check(!("playerAds" in context.ytInitialPlayerResponse), "initial-response trap removes playerAds");

  const xhr = new context.XMLHttpRequest();
  xhr.open("GET", "/youtubei/v1/get_watch?videoId=hooked");
  xhr._text = JSON.stringify({ videoDetails: { videoId: "xhr" }, adSlots: [{}] });
  const xhrData = JSON.parse(xhr.responseText);
  check(xhrData.videoDetails.videoId === "xhr", "XHR getter preserves video data");
  check(!("adSlots" in xhrData), "XHR getter strips ad slots before page listeners read them");
}

testMainWorldHooks().then(function () {
  console.log("\n" + "=".repeat(64));
  console.log(`  YouTube: ${passed} passed, ${failed} failed`);
  console.log("=".repeat(64));

  if (failed) process.exit(1);
}).catch(function (error) {
  console.error(error);
  process.exit(1);
});

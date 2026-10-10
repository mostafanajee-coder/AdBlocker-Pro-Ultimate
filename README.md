# 🛡️ Ad Blocker Pro Ultimate (v5.5.1)

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests](https://img.shields.io/badge/Tests-local%20regressions-brightgreen.svg)](tests/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A Manifest V3 ad blocker for Chromium browsers, with declarative network filtering, dedicated sponsored-content detectors, YouTube response sanitizing, optional anti-adblock hooks, and popunder suppression. Local regression checks verify the behaviors described below; they do not guarantee compatibility with every live site update.

---

## 🔧 v5.5.1 Load-Safety Fix

The 5.5.0 build incorrectly registered raw upstream regex candidates as static rules. uBlock rule 99 contains `{200,1300}`, which RE2 cannot compile; Chrome therefore refused to load the extension before the runtime validation code could run. **Regex candidate files are no longer listed in the manifest.** Only the six main core lists and local baseline lists load statically. Regex rules are installed dynamically only after Chrome accepts them; unsupported candidates are omitted unchanged and reported with their original source/ID/reason. One unsupported regex cannot cancel main/regional/cosmetic refreshes. Source download errors, malformed native API results, unsafe rule shapes and rejected atomic installs still keep installed rules.

## Engine Upgrade

The filter engine now supports a deliberately bounded subset of **procedural hiding**: site-qualified `:has-text()`, `:upward()` (at most eight ancestors), `:min-text-length()`, and nested `:has()` / `:not()`. Matching containers are hidden reversibly through an owned marker stylesheet, never removed from the DOM. Mutation-triggered work is batched; recycled organic content, exceptions and opt-outs release the effect. Page roots, feed/navigation structures and oversized content wrappers are protected. Native CSS remains the preferred path when it can express a rule.

Three **packaged site-specific functions** are supported: `set-constant`, `abort-on-property-read`, and `no-setTimeout-if`, including selected aliases. They require the existing **Anti-Adblock Bypass** switch, which remains off by default. Background reads the exact document's authoritative settings and domain data; the page cannot supply executable code or arbitrary commands. Prototype paths, foundational browser APIs, unknown commands and unsafe text regex are rejected. Teardown restores owned hooks without overwriting later page changes. Ordinary pages without an enabled matching function do not wake the worker for this feature. Applying scriptlets after asynchronous configuration may miss code that already ran.

The official data includes **252 regex candidates**, not 252 guaranteed usable rules. Chrome's `isRegexSupported` API selects the usable subset before dynamic installation. Native priorities, header conditions and top-frame constraints are preserved, and supported regex follows the same source switches. Main lists provide static fallback; raw regex is never parsed at extension load time. Chrome/Chromium **145+** is required for `topDomains` conditions. Generic advanced engines exclude dedicated platform domains.

Global network filters refresh from the official uBlock Origin Lite repository every **48 hours**. Six main lists plus four regex partitions are pinned to one upstream commit and installed atomically with regional rules. Each verified dynamic core group replaces its bundled static counterparts; missing groups restore fallback. Downloads, rule shapes, redirect resources and Chrome quotas are validated before replacement. A failed download/native install keeps installed rules; incomplete cosmetic/storage refreshes do not advance the last-success timestamp and retry after an hour. Missed refreshes catch up when Chrome starts; the browser must be running for alarms to execute.

The bundled data contains **18,723 main rules + 252 runtime-only regex candidates** from commit `9379e3387c6f615e695add23c2325c8705faca83`. The corrected offline audit on 2026-10-10 compiles **19,665 main/regional rules**, **7,997 generic selectors**, **719 procedural rules**, and **1,531 approved function rules**, across **22,226 domain entries**, without network/storage truncation. Offline checks omit all regex candidates instead of falsely assuming native compatibility. The browser adds only the candidates its own API accepts. Counts are database entries, not successful-block counts. The popup tooltip shows accepted/omitted regex counts as well as the schedule and advanced counts.

This is stronger, refreshable filtering, **not full uBlock Origin parity**. Only the supported subset is implemented; arbitrary scriptlets, unrestricted procedural operators, dynamic per-site filtering and DNS/CNAME features are not supported. No remote JavaScript is executed. See the [official uBOL FAQ](https://github.com/uBlockOrigin/uBOL-home/wiki/Frequently-asked-questions-(FAQ)) and [data provenance/licenses](rulesets/SOURCES.md).

YouTube's bounded ad-recovery checks now use timers instead of animation frames, which can be suspended in a hidden tab. Switching tabs leaves normal playback and manually paused videos untouched. After an ad interruption, recovery restores audio and resumes only the previously playing media that is still in the same player/page; trusted manual pause controls suppress that automatic resume. A successful synchronous skip cannot seek the following normal video to its end. The text-response fast path now recognizes every ad renderer supported by the sanitizer. Changing the YouTube toggle reloads the active YouTube tab so conditional MAIN-world registration takes effect.

These are local regression-tested behaviors. Live YouTube playback and ad coverage must still be checked after reloading the extension; browser autoplay, tab freezing/discarding, and changes to YouTube's player can affect runtime behavior.

Facebook settings now guard direct Shadow DOM signals and release existing hide/cover effects when protection is disabled or the site is whitelisted. The MAIN-world probe is dynamically registered with the same exclusions; live opt-out restores its owned page hooks and disconnects its observers. Enabling the probe again requires a page reload. The popup reloads the active tab after changing the Facebook/global toggle or its current-site whitelist.

Reel advancement is confirmed from route, creative, or active-slide movement after clicking the explicit Next Card control. An ignored click is recorded as unconfirmed. At most one replacement control can receive a recovery attempt; the same ignored control is never clicked repeatedly. Confirmed ads stay covered and muted during transition, without collapsing the active slide or sending generic navigation keys.

Generic cosmetic styles are excluded from Facebook and Messenger so they do not compete with the dedicated detector. Other platforms keep their existing cosmetic behavior. Facebook diagnostic mode outlines detections without hiding, changing media, or increasing blocked counters.

Remote filter responses are read through an 8 MiB per-source byte cap, including chunked responses or misleading Content-Length headers. Size-limit failures use the existing known-good-rules fallback.

After loading or updating this unpacked build, reload the extension in `chrome://extensions` and refresh open Facebook/Messenger tabs. Live visual checks are still required for delayed disclosure, recycled Reels, ignored navigation controls, and whitelist transitions.

The regional text pipeline keeps conservative ABP/AdGuard-to-DNR conversion, raw and semantic deduplication, subdomain compaction, provenance statistics, owned IDs and output fingerprints. Core network rules use upstream native DNR rather than lossy text reconversion. Strict Tracking controls both native EasyPrivacy and the local tracking ruleset; tracking opt-outs survive upgrades. Only explicitly shipped redirect resources are exposed.

## ⚡ Key Highlights & Architecture

| Feature | Legacy MV2 Blockers | Ad Blocker Pro Ultimate (v5.5.1) |
| :--- | :--- | :--- |
| **Manifest Compatibility** | Deprecated / Disabled in Chrome 120+ | **Native Manifest V3 Compliance** |
| **Network Filtering** | Blocking webRequest engine | **18,723 safe main fallback rules + runtime-validated regex; 48-hour core/regional refresh within a 29,000-rule budget** |
| **Element Hiding** | Depends on the implementation | **Plain CSS plus bounded site-specific procedural hiding, with exceptions and reversible DOM effects** |
| **Manual Blocking** | Element pickers that can hide a whole page | **Right-click "Block this element" opens a preview: the highlight follows the mouse so a small part inside a bigger block can be picked, a click pins it, Bigger/Smaller (↑/↓) adjust the selection, nothing changes until Block is pressed; oversized or imprecise selections cannot be confirmed; per-site undo in the popup; the picker never runs on Facebook, Messenger, Instagram, YouTube or X (the entry only says it is not available there)** |
| **Anti-Adblock Defusal** | Detection based on missing global objects | **36 explicitly exposed redirect resources (`noop.js`, `1x1.gif`)** |
| **YouTube Ads** | Blocked with black screens or video freezes | **In-Stream JSON Stripper + Instant Auto-Play Kickstart** |
| **Facebook & Reels** | Broken by DOM obfuscation & black screens | **Visual Coordinate Reconstruction + Recycled-Node Guard** |
| **Instagram Ads** | Sponsored posts clutter feed | **Surgical Multi-lingual Sponsored Label Detection & Stories Auto-Skip** |
| **Twitter / X Ads** | Promoted tweets clutter timeline | **Native Mutation-Shielded Promoted Tweet Slayer** |
| **User Interface** | Fixed basic layout | **Modern Glassmorphic UI with Dark/Light & Bilingual (AR/EN)** |
| **Video Popunders** | Intrusive new tabs on click | **Capture-Phase Click Interceptor & Auto-Closer** |

---

## 🚀 Core Features

### 1. 🌐 The Golden Core 6 Declarative Rulesets
Ad Blocker Pro Ultimate incorporates the official, clean core filter lists from the uBlock Origin / EasyList ecosystem:
* **`ublock-filters.json`**: Dynamic ad networks, malicious redirects, and intrusive ad scripts.
* **`easylist.json`**: Primary global ad-network blocking; cosmetic rules are downloaded separately as text.
* **`easyprivacy.json`**: Comprehensive privacy protection and third-party tracker blocking; on by default, controlled by the **Strict Tracking** switch.
* **`pgl.json`**: Peter Lowe’s verified ad server hostname database.
* **`ublock-badware.json`**: Protection against forced redirects, phishing, and scam domains.
* **`urlhaus-full.json`**: Malware URL coverage updated with the scheduled core snapshot.

### 2. 🧩 Source-Aware Runtime Filter Pipeline (`filters.js`)
Community sources are not blindly appended to Chrome DNR. The runtime pipeline:
* assigns every source an explicit network/cosmetic role and priority;
* replaces bundled core groups with verified native dynamic snapshots instead of running both copies;
* rejects unsupported filter options instead of silently broadening their meaning;
* deduplicates raw text and compiled DNR semantics;
* collapses redundant child-domain rules when an equivalent parent-domain rule already covers them;
* owns a dedicated dynamic-rule ID range so refreshes cannot delete unrelated future rules;
* keeps the previous known-good ruleset if a network source fails or Chrome rejects an update;
* fingerprints the compiled result and skips needless DNR replacement when nothing meaningful changed;
* records per-source provenance statistics for diagnostics.

Runtime sources (refreshed every 48 hours): the six official uBOL main lists and their four regex partitions, **Liste AR** (regional network + hiding), **EasyList**, **AdGuard Base**, and **uBlock Ads / Unbreak / Quick Fixes** (supported CSS, procedural and approved-function data). Annoyances remain optional to avoid unwanted interface changes. Text lists cannot supply remotely executable function bodies.

**Site-specific hiding/data.** Rules and exceptions are stored per domain as ordinary hiding (`h/u`), procedural (`p/pu`), and approved functions (`s/su`). Pages read only their own domain/parent entries. Global generic exceptions are respected. Unknown operators, scriptlets, negated/wildcard domain lists and malformed selectors are skipped, never approximated into broader rules. Only changed sites are rewritten; open pages react to relevant CSS/settings changes, not counters or other sites. Dedicated platform exclusions remain; Facebook/Messenger also receive no generic stylesheet.

### 3. 🎬 YouTube Response Sanitizer and Playback Recovery (`youtube-sanitizer.js`, `youtube-main.js`, `youtube.js`)
YouTube injects ads directly into player streams via server responses. Ad Blocker Pro Ultimate intercepts `window.ytInitialPlayerResponse` and `/youtubei/v1/player` in the `MAIN` execution world before the YouTube Player Web Component initializes:
* Strips `adPlacements`, `playerAds`, and `adSlots` payloads in place.
* Removes recognized ad structures before the player consumes the response, with an isolated visual/skip fallback for ads that still reach the player.
* Uses a finite recovery budget that works in hidden tabs, without playback acceleration or a permanent polling interval.
* Preserves normal background playback, manual pause, and ended/replaced media; restores original mute state after an ad.

### 4. 🐦 Twitter / X Promoted Tweet Slayer (`twitter.js`)
Surgically eliminates promoted content across `x.com` and `twitter.com` with zero impact on organic timeline tweets:
* **Exact Official Ad Badge Detection**: Matches standalone chips (`الإعلان`, `إعلان`, `مُروّج`, `Promoted`, `Ad`, `Sponsorisé`).
* **Ad Click-ID Interception**: Detects and eliminates sponsored links carrying Twitter click tracking (`twclid=`).
* **Zero False Positives via DOM Isolation**: Strictly protects tweet body content (`[data-testid="tweetText"]`), user names (`[data-testid="User-Name"]`), link previews (`[data-testid="card.wrapper"]`), and video players (`[data-testid="placementTracking"]`). Organic tweets mentioning "إعلان" or "ad" remain 100% visible.
* **Smooth Virtual Scroller Integration**: Cleanly collapses `cellInnerDiv` heights to `0px` without stutter or blank gaps.

### 5. 🧠 Facebook Sponsored-Post & Reels Annihilator (`fb-detect.js`, `facebook.js`)
Facebook delivers ads directly from its own origin (`facebook.com`) and continuously obfuscates DOM text with zero-width characters (`U+034F`), scrambled DOM hierarchies, and invisible clipped elements (`overflow: hidden`).
* **Visual Range Reconstruction**: Measures exact screen coordinates via `Range.getBoundingClientRect()` rather than reading polluted DOM text.
* **Bilingual Support (LTR & RTL)**: Fully handles right-to-left languages (Arabic: "مُموَّل", "إعلان", "برعاية") and left-to-right (English: "Sponsored", "Ad").
* **Feed and Reels Handling**: Collapses confirmed feed ads; covers and mutes sponsored viewer Reels while confirming explicit Next Card navigation. The separate Hide all Reels setting suppresses the feed shelf.
* **User Controls**: Direct shadow signals honor global/Facebook switches and the whitelist; diagnostic mode only outlines cards.

### 6. 📸 Instagram Sponsored Content & Stories Blocker (`instagram.js`)
Detects and neutralizes sponsored posts, stories, and reels across Instagram:
* **Dedicated Platform Shield Switch**: Easily toggled from the popup alongside YouTube, Facebook, and Twitter / X.
* **Multilingual Recognition**: Normalizes Arabic, English, French, German, Spanish, and Russian disclosure strings (`Sponsored`, `مُموَّل`, `إعلان`, `برعاية`, `شراكة مدفوعة مع...`, `Paid partnership with...`).
* **Story & Reel Auto-Advance**: Seamlessly skips sponsored stories without user intervention.
* **Zero Overhead**: Throttled mutation scanning with microtask batching and zero permanent polling loops.

### 7. 🎭 Smart Redirect Resources (Anti-Adblock Defuser)
Instead of failing network requests with errors, matching tracker and ad script requests are redirected to neutral stub assets in `web_accessible_resources/` (e.g. `googlesyndication_adsbygoogle.js`, `google-ima.js`, `amazon_ads.js`, `noop.js`, `1x1.gif`). Sites believe the ad script loaded normally, eliminating *"Please disable your AdBlocker"* warnings.

### 8. 🛑 In-Player Popunder & Click-Trap Neutralizer (`popclose.js`)
Movie and anime streaming platforms deploy transparent overlays (`div[style*="z-index"]`, `<a target="_blank">`) directly over video players to spawn popunder advertising tabs upon clicking "Play".
* **Capture-Phase Click Interruption**: Catches and dissolves transparent clickjacking links before page event listeners can fire.
* **In-Iframe `window.open` Disarmer**: Drops rogue popunder requests initiated within embedded video players (`iframe`).
* **Smart Popclose Neutralizer**: Automatically checks and terminates rogue ad landing tabs from within the newly opened window.

### 9. 🎨 Modern Glassmorphic UI with Auto-Language Matching
* **360px Spacious Layout**: Designed with modern frosted glass (`backdrop-filter: blur(16px)`), luminous accents, and smooth switches.
* **Dark & Light Themes**: Instant toggle with automatic local storage persistence.
* **Automatic Browser Language Matching**: Matches the browser UI language automatically (`chrome.i18n.getUILanguage()`), rendering Arabic (RTL) for Arabic browsers and English (LTR) for English/other browsers, with instant manual toggle.
* **Whitelist Manager**: View, add, and remove whitelisted domains with 1-click.

---

## 📁 Repository Structure

```
├── manifest.json              # Extension Manifest V3 configuration
├── background.js              # Background Service Worker & DNR rule managers
├── content.js                 # Global cosmetic styling & popunder disarmer
├── twitter.js                 # Twitter / X promoted tweet & trend slayer
├── facebook.js                # Facebook feed observer and DOM scraper
├── fb-detect.js               # Facebook visual coordinate detection engine
├── fb-net-probe.js            # Whitelist-aware MAIN-world shadow/XHR signals
├── instagram.js               # Instagram sponsored post detector
├── popclose.js                # Popunder auto-terminator
├── inject.js                  # Optional MAIN-world anti-adblock and popup hooks
├── youtube-main.js            # MAIN-world YouTube response integration
├── youtube-sanitizer.js       # YouTube response sanitizing
├── filters.js                 # Source-aware runtime filter pipeline & DNR compiler
├── core-filters.js            # Official native core updates, validation & static fallback
├── advanced-rules.js          # Shared data-only procedural/approved-function parser
├── procedural-engine.js       # Bounded, reversible DOM filtering
├── scriptlet-engine.js        # Packaged MAIN-world functions and owned-hook teardown
├── scripts/                   # Pinned bundled-data refresh and read-only provider audit
├── popup.html / popup.js      # Modern Glassmorphic UI & settings controller
├── rulesets/
│   ├── main/                  # Core 6 DNR pre-compiled JSON rulesets
│   ├── regex/                 # Candidate data only; never registered as static rules
│   ├── core-source.json       # Pinned URLs, counts, sizes and SHA-256 provenance
│   └── SOURCES.md             # Third-party data attribution and license
├── web_accessible_resources/  # Stub & noop redirect assets (36 exposed)
└── tests/                     # Local unit/integration regression suites
    ├── fb-detect.test.js      # Text/geometry detection
    ├── facebook-orchestration.test.js # Settings, Reels lifecycle and navigation
    ├── maintenance.test.js    # Probe opt-out, cosmetic exclusions, bounded downloads
    ├── youtube-sanitizer.test.js
    ├── youtube-playback.test.js # Hidden-tab recovery and playback intent
    ├── instagram.test.js
    ├── twitter.test.js
    ├── filter-engine.test.js
    ├── settings-wiring.test.js
    ├── background-migration.test.js
    ├── background-block-menu.test.js
    ├── filter-pipeline.test.js
    ├── core-filters.test.js   # Core validation, fallback, ownership, quotas and failure safety
    ├── advanced-engine.test.js # Parser limits, DOM recovery, hooks and document-scoped authority
    ├── popclose.test.js
    └── inject.test.js
```

---

## 🛠️ Installation Guide

1. Clone or download this repository:
   ```bash
   git clone https://github.com/mostafanajee-coder/AdBlocker-Pro-Ultimate.git
   ```
2. Open Google Chrome 145+ (or a Chromium browser based on version 145+).
3. Navigate to `chrome://extensions`.
4. Enable **Developer mode** (toggle switch in the top-right corner).
5. Click **Load unpacked** and select the `AdBlocker-Pro-Ultimate` directory.
6. The extension is now active and protecting your browser!

---

## 🧪 Automated Testing

Run the local regression suites, which simulate DOM geometry, Chrome APIs, and remote responses:

```bash
npm test
```

The command prints current per-suite assertion counts. Coverage includes Facebook detection and Reels lifecycle, other platform detectors, background migration/menu behavior, settings registration, filter compilation and failure recovery, popup suppression, probe teardown, cosmetic exclusions, and streamed download limits. These checks do not replace live Chrome/Facebook visual acceptance.

Run `node scripts/audit-filter-snapshot.cjs` to fetch current enabled text providers and compile them against the pinned bundled core in memory. This read-only audit does not install rules in a browser. See `rulesets/SOURCES.md` for bundled-data regeneration.

Run `node scripts/serve-engine-fixture.cjs`, open its printed loopback URL and click **Run browser tests** to exercise real DOM/CSS/mutation behavior with fixture storage. It has no account access and does not load an extension. Browser fixture acceptance does not replace a live extension DNR/site matrix after reloading this build.

---

## 📄 License

The extension's original implementation is MIT-licensed; see [LICENSE](LICENSE). Official core filter data retains its upstream GPLv3 license in [rulesets/UPSTREAM_LICENSE.txt](rulesets/UPSTREAM_LICENSE.txt). Other list data may carry its own license; see [rulesets/SOURCES.md](rulesets/SOURCES.md).

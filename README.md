# 🛡️ Ad Blocker Pro Ultimate (v5.1.2)

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests](https://img.shields.io/badge/Tests-254%2F254%20Passing-brightgreen.svg)](tests/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Speed](https://img.shields.io/badge/Performance-Zero--Overhead-orange.svg)](#)

A high-performance, lightweight Manifest V3 ad blocker engineered for modern Chromium browsers. Designed with surgical precision, featuring native declarative network filtering, intelligent Facebook & Instagram sponsored-post detection, YouTube Zero-Latency instant playback with kickstart auto-play, Twitter / X promoted tweet annihilation, in-player popunder disarming, and undetectable anti-adblock evasion.

---

## 🔧 v5.1.2 Filter Pipeline Maintenance

This maintenance build focuses on filter-source quality and Manifest V3 quota efficiency. Runtime lists now pass through a source-aware pipeline with conservative ABP/AdGuard-to-DNR conversion, raw and semantic deduplication, redundant subdomain compaction, provenance statistics, owned dynamic-rule IDs, atomic replacement, and compiled-output fingerprints. Bundled EasyList/EasyPrivacy network coverage is no longer downloaded again into the limited dynamic quota. Strict Tracking now owns EasyPrivacy consistently, and only redirect resources actually referenced by shipped rulesets are exposed as web-accessible resources.

## ⚡ Key Highlights & Architecture

| Feature | Legacy MV2 Blockers | Ad Blocker Pro Ultimate (v5.1.2) |
| :--- | :--- | :--- |
| **Manifest Compatibility** | Deprecated / Disabled in Chrome 120+ | **Native Manifest V3 Compliance** |
| **Network Filtering** | Heavy webRequest memory overhead | **~18,500 static DNR rules covering 100,000+ ad, tracker and malware domains, tracking protection on by default, + up to 29,000 managed dynamic rules** |
| **Element Hiding** | Generic rules only, empty ad boxes left behind | **Site-specific hiding for 20,000+ sites (EasyList, AdGuard Base, Liste AR), with each site's exceptions honoured** |
| **Manual Blocking** | Element pickers that can hide a whole page | **Right-click "Block this element" opens a preview: the highlight follows the mouse so a small part inside a bigger block can be picked, a click pins it, Bigger/Smaller (↑/↓) adjust the selection, nothing changes until Block is pressed; oversized or imprecise selections cannot be confirmed; per-site undo in the popup; the picker never runs on Facebook, Messenger, Instagram, YouTube or X (the entry only says it is not available there)** |
| **Anti-Adblock Defusal** | Easily detected via missing global objects | **37 Web Accessible Resource Stubs (`noop.js`, `1x1.gif`)** |
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
* **`easylist.json`**: Primary global cosmetic and banner ad blocking.
* **`easyprivacy.json`**: Comprehensive privacy protection and third-party tracker blocking; on by default, controlled by the **Strict Tracking** switch.
* **`pgl.json`**: Peter Lowe’s verified ad server hostname database.
* **`ublock-badware.json`**: Protection against forced redirects, phishing, and scam domains.
* **`urlhaus-full.json`**: Real-time malware URL blocker.

### 2. 🧩 Source-Aware Runtime Filter Pipeline (`filters.js`)
Community sources are not blindly appended to Chrome DNR. The runtime pipeline:
* assigns every source an explicit network/cosmetic role and priority;
* avoids duplicating bundled EasyList/EasyPrivacy network rules in dynamic quota;
* rejects unsupported filter options instead of silently broadening their meaning;
* deduplicates raw text and compiled DNR semantics;
* collapses redundant child-domain rules when an equivalent parent-domain rule already covers them;
* owns a dedicated dynamic-rule ID range so refreshes cannot delete unrelated future rules;
* keeps the previous known-good ruleset if a network source fails or Chrome rejects an update;
* fingerprints the compiled result and skips needless DNR replacement when nothing meaningful changed;
* records per-source provenance statistics for diagnostics.

Runtime sources (refreshed daily): **Liste AR** (Arabic sites; network + hiding), **EasyList** and **AdGuard Base** (element hiding; their network rules are already covered by the bundled rulesets).

**Site-specific element hiding.** Rules such as `example.com##.sidebar-ad` and their exceptions (`example.com#@#.ad-banner`, which also switch a generic rule off on that site) are stored one entry per domain, so each page reads only its own site's rules in the same storage read as its settings. Only plain CSS is used: extended/procedural syntax, scriptlets, negated or wildcard domain lists, and any selector with braces or unbalanced brackets/quotes are skipped rather than approximated, and each page re-checks every selector with Chrome's own parser before applying it. After the first build only changed sites are rewritten, so a daily refresh does not flood open tabs with storage-change events. Facebook, Messenger, Instagram, YouTube and X are left to their dedicated modules.

### 3. 🎬 YouTube In-Stream Zero-Latency Response Sanitizer (`youtube-sanitizer.js`, `youtube-main.js`)
YouTube injects ads directly into player streams via server responses. Ad Blocker Pro Ultimate intercepts `window.ytInitialPlayerResponse` and `/youtubei/v1/player` in the `MAIN` execution world before the YouTube Player Web Component initializes:
* Strips `adPlacements`, `playerAds`, and `adSlots` payloads in place.
* Bypasses video ad buffering entirely — videos launch instantly without black screens, freezes, or 16x acceleration artifacts.
* Auto-triggers native video playback without artificial timeouts or permanent intervals.

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
* **Reels Shelf Suppression**: Cleanly removes sponsored cards from Reels and feeds without page stutter.

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
├── instagram.js               # Instagram sponsored post detector
├── popclose.js                # Popunder auto-terminator
├── inject.js                  # MAIN-world YouTube JSON stripper & anti-adblock evasion
├── filters.js                 # Source-aware runtime filter pipeline & DNR compiler
├── popup.html / popup.js      # Modern Glassmorphic UI & settings controller
├── rulesets/
│   └── main/                  # Core 6 DNR pre-compiled JSON rulesets
├── web_accessible_resources/  # 37 stub & noop redirect assets
└── tests/                     # 254-test automated unit/integration framework
    ├── fb-detect.test.js      # Facebook coordinate detection suite (104 tests)
    ├── youtube-sanitizer.test.js # YouTube JSON response stripping suite (34 tests)
    ├── instagram.test.js      # Instagram sponsored detection suite (23 tests)
    ├── twitter.test.js        # Twitter / X exact-match ad detection suite (28 tests)
    ├── filter-engine.test.js  # Filter conversion regression suite (27 tests)
    ├── settings-wiring.test.js # Toggle / whitelist wiring suite (16 tests)
    └── filter-pipeline.test.js # Source pipeline integration suite (22 tests)
```

---

## 🛠️ Installation Guide

1. Clone or download this repository:
   ```bash
   git clone https://github.com/mostafanajee-coder/AdBlocker-Pro-Ultimate.git
   ```
2. Open Google Chrome (or any Chromium browser: Edge, Brave, Opera).
3. Navigate to `chrome://extensions`.
4. Enable **Developer mode** (toggle switch in the top-right corner).
5. Click **Load unpacked** and select the `AdBlocker-Pro-Ultimate` directory.
6. The extension is now active and protecting your browser!

---

## 🧪 Automated Testing

Ad Blocker Pro Ultimate includes a 254-test automated unit/integration testing suite simulating complex DOM layouts, clipped decoys, multi-level nested SVG references, and bidirectional font rendering:

```bash
npm test
```

### Test Coverage Summary:
* ✅ **Facebook Detection (104 tests)**: Multi-level nested SVG chains (`Ad`, `Sponsored`, `مُموَّل`), visual coordinate bounding boxes, zero-width joiner obfuscation, decoy clipping.
* ✅ **YouTube Sanitizer (34 tests)**: `adPlacements` and `playerAds` stripping, feed & Shorts ad removal, XSSI prefix preservation, circular reference protection.
* ✅ **Instagram Module (23 tests)**: Multi-lingual sponsored tokens, zero-width joiner extraction, non-ad label rejection.
* ✅ **Twitter / X Module (28 tests)**: Exact official tokens (`الإعلان`, `مُروّج`, `Promoted`, `Ad`), `twclid` attribution links, tweet body isolation, zero false positives.
* ✅ **Filter Engine (27 tests)**: Negated resource types (`~image`), exception priority, and unsupported-option guards.
* ✅ **Settings Wiring (16 tests)**: Dynamic MAIN-world registration, DNR whitelist, toggle wiring, and popunder/whitelist behavior.
* ✅ **Filter Pipeline (22 tests)**: Source roles, dynamic-ID ownership, safe refresh failure behavior, semantic dedupe, hierarchy compaction, provenance, and unchanged-build skipping.

```text
================================================================
  Facebook Detection:  104 passed, 0 failed
  YouTube Sanitizer:     34 passed, 0 failed
  Instagram Module:      23 passed, 0 failed
  Twitter / X Module:    28 passed, 0 failed
  Filter Engine:         27 passed, 0 failed
  Settings Wiring:       16 passed, 0 failed
  Filter Pipeline:       22 passed, 0 failed
================================================================
  Total:                254 passed, 0 failed (100% Success)
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

# 🛡️ Ad Blocker Pro Ultimate (v5.0.0)

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests](https://img.shields.io/badge/Tests-176%2F176%20Passing-brightgreen.svg)](tests/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Speed](https://img.shields.io/badge/Performance-Zero--Overhead-orange.svg)](#)

A high-performance, lightweight Manifest V3 ad blocker engineered for modern Chromium browsers. Designed with surgical precision, featuring native declarative network filtering, intelligent Facebook & Instagram sponsored-post detection, YouTube Zero-Latency instant playback with kickstart auto-play, Twitter / X promoted tweet annihilation, interactive Element Zapper, in-player popunder disarming, and undetectable anti-adblock evasion.

---

## ⚡ Key Highlights & Architecture

| Feature | Legacy MV2 Blockers | Ad Blocker Pro Ultimate (v5.0.0) |
| :--- | :--- | :--- |
| **Manifest Compatibility** | Deprecated / Disabled in Chrome 120+ | **Native Manifest V3 Compliance** |
| **Network Filtering** | Heavy webRequest memory overhead | **Pre-compiled DeclarativeNetRequest (300,000+ Rules)** |
| **Anti-Adblock Defusal** | Easily detected via missing global objects | **37 Web Accessible Resource Stubs (`noop.js`, `1x1.gif`)** |
| **YouTube Ads** | Blocked with black screens or video freezes | **In-Stream JSON Stripper + Instant Auto-Play Kickstart** |
| **Facebook & Reels** | Broken by DOM obfuscation & black screens | **Visual Coordinate Reconstruction + Recycled-Node Guard** |
| **Instagram Ads** | Sponsored posts clutter feed | **Surgical Multi-lingual Sponsored Label Detection** |
| **Twitter / X Ads** | Promoted tweets clutter timeline | **Native Mutation-Shielded Promoted Tweet Slayer** |
| **Element Zapper** | Third-party dependencies or missing | **Interactive 1-Click Element Picker & Custom Rules** |
| **User Interface** | Fixed basic layout | **Modern Glassmorphic UI with Dark/Light & Bilingual (AR/EN)** |
| **Video Popunders** | Intrusive new tabs on click | **Capture-Phase Click Interceptor & Auto-Closer** |

---

## 🚀 Core Features

### 1. 🌐 The Golden Core 6 Declarative Rulesets
Ad Blocker Pro Ultimate incorporates the official, clean core filter lists from the uBlock Origin / EasyList ecosystem:
* **`ublock-filters.json`**: Dynamic ad networks, malicious redirects, and intrusive ad scripts.
* **`easylist.json`**: Primary global cosmetic and banner ad blocking.
* **`easyprivacy.json`**: Comprehensive privacy protection and third-party tracker blocking.
* **`pgl.json`**: Peter Lowe’s verified ad server hostname database.
* **`ublock-badware.json`**: Protection against forced redirects, phishing, and scam domains.
* **`urlhaus-full.json`**: Real-time malware URL blocker.

### 2. 🎬 YouTube In-Stream Zero-Latency Response Sanitizer (`inject.js`)
YouTube injects ads directly into player streams via server responses. Ad Blocker Pro Ultimate intercepts `window.ytInitialPlayerResponse` and `/youtubei/v1/player` in the `MAIN` execution world before the YouTube Player Web Component initializes:
* Strips `adPlacements`, `playerAds`, and `adSlots` payloads in place.
* Bypasses video ad buffering entirely — videos launch instantly without black screens, freezes, or 16x acceleration artifacts.
* Auto-triggers native video playback without artificial timeouts or permanent intervals.

### 3. 🐦 Twitter / X Promoted Tweet Slayer (`twitter.js`)
Surgically eliminates promoted content across `x.com` and `twitter.com` with zero impact on organic timeline tweets:
* **Exact Official Ad Badge Detection**: Matches standalone chips (`الإعلان`, `إعلان`, `مُروّج`, `Promoted`, `Ad`, `Sponsorisé`).
* **Ad Click-ID Interception**: Detects and eliminates sponsored links carrying Twitter click tracking (`twclid=`).
* **Zero False Positives via DOM Isolation**: Strictly protects tweet body content (`[data-testid="tweetText"]`), user names (`[data-testid="User-Name"]`), link previews (`[data-testid="card.wrapper"]`), and video players (`[data-testid="placementTracking"]`). Organic tweets mentioning "إعلان" or "ad" remain 100% visible.
* **Smooth Virtual Scroller Integration**: Cleanly collapses `cellInnerDiv` heights to `0px` without stutter or blank gaps.

### 4. 🧠 Facebook Sponsored-Post & Reels Annihilator (`fb-detect.js`, `facebook.js`)
Facebook delivers ads directly from its own origin (`facebook.com`) and continuously obfuscates DOM text with zero-width characters (`U+034F`), scrambled DOM hierarchies, and invisible clipped elements (`overflow: hidden`).
* **Visual Range Reconstruction**: Measures exact screen coordinates via `Range.getBoundingClientRect()` rather than reading polluted DOM text.
* **Bilingual Support (LTR & RTL)**: Fully handles right-to-left languages (Arabic: "مُموَّل", "إعلان", "برعاية") and left-to-right (English: "Sponsored", "Ad").
* **Reels Shelf Suppression**: Cleanly removes sponsored cards from Reels and feeds without page stutter.

### 5. 📸 Instagram Sponsored Content Blocker (`instagram.js`)
Detects and neutralizes sponsored posts in Instagram feeds and stories:
* Normalizes Arabic and Latin disclosure strings (`Sponsored`, `مُموَّل`, `إعلان`, `برعاية`).
* Strips hidden zero-width and invisible DOM decoys.
* Throttled mutation scanning with zero permanent polling loops.

### 6. ⚡ Interactive Element Zapper & Custom Rules
Built directly into the extension popup and content engine:
* **1-Click Element Picker**: Click any annoying banner or overlay on any web page with real-time highlighted bounding box preview.
* **CSS Selector Generation**: Automatically builds unique, robust CSS selectors for the selected element.
* **Persistent Local Rules**: Rules are stored in `chrome.storage.local` per domain, automatically applying upon future visits.
* **Safe Cancellation**: Press `ESC` at any time to exit Zapper mode without changes.

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
├── content.js                 # Global cosmetic styling, Zapper engine & popunder disarmer
├── twitter.js                 # Twitter / X promoted tweet & trend slayer
├── facebook.js                # Facebook feed observer and DOM scraper
├── fb-detect.js               # Facebook visual coordinate detection engine
├── instagram.js               # Instagram sponsored post detector
├── popclose.js                # Popunder auto-terminator
├── inject.js                  # MAIN-world YouTube JSON stripper & anti-adblock evasion
├── filters.js                 # Helper filters and procedural rules
├── popup.html / popup.js      # Modern Glassmorphic UI & settings controller
├── rulesets/
│   └── main/                  # Core 6 DNR pre-compiled JSON rulesets
├── web_accessible_resources/  # 37 stub & noop redirect assets
└── tests/                     # 172-test automated unit testing framework
    ├── fb-detect.test.js      # Facebook coordinate detection suite (100 tests)
    ├── youtube-sanitizer.test.js # YouTube JSON response stripping suite (31 tests)
    ├── instagram.test.js      # Instagram sponsored detection suite (13 tests)
    └── twitter.test.js        # Twitter / X exact-match ad detection suite (28 tests)
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

Ad Blocker Pro Ultimate includes a 176-test automated unit testing suite simulating complex DOM layouts, clipped decoys, multi-level nested SVG references, and bidirectional font rendering:

```bash
npm test
```

### Test Coverage Summary:
* ✅ **Facebook Detection (104 tests)**: Multi-level nested SVG chains (`Ad`, `Sponsored`, `مُموَّل`), visual coordinate bounding boxes, zero-width joiner obfuscation, decoy clipping.
* ✅ **YouTube Sanitizer (31 tests)**: `adPlacements` and `playerAds` stripping, feed & Shorts ad removal, XSSI prefix preservation, circular reference protection.
* ✅ **Instagram Module (13 tests)**: Multi-lingual sponsored tokens, zero-width joiner extraction, non-ad label rejection.
* ✅ **Twitter / X Module (28 tests)**: Exact official tokens (`الإعلان`, `مُروّج`, `Promoted`, `Ad`), `twclid` attribution links, tweet body isolation, zero false positives.

```text
================================================================
  Facebook Detection: 104 passed, 0 failed
  YouTube Sanitizer:   31 passed, 0 failed
  Instagram Module:    13 passed, 0 failed
  Twitter / X Module:  28 passed, 0 failed
================================================================
  Total: 176 passed, 0 failed (100% Success)
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

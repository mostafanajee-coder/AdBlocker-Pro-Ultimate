# 🛡️ Ad Blocker Pro Ultimate (v3.4.0)

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests](https://img.shields.io/badge/Tests-58%2F58%20Passing-brightgreen.svg)](tests/fb-detect.test.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE.txt)
[![Speed](https://img.shields.io/badge/Performance-Ultra--Fast-orange.svg)](#)

A high-performance, lightweight Manifest V3 ad blocker engineered for modern Chromium browsers. Designed to replace legacy MV2 blockers with surgical precision, featuring native declarative network filtering, intelligent Facebook sponsored-post detection, instant YouTube ad skipping, in-player popunder disarming, and undetectable anti-adblock evasion.

---

## ⚡ Key Highlights & Architecture

| Feature | Legacy MV2 Blockers | Ad Blocker Pro Ultimate (v3.4.0) |
| :--- | :--- | :--- |
| **Manifest Compatibility** | Deprecated / Disabled in Chrome 120+ | **Native Manifest V3 Compliance** |
| **Network Filtering** | Heavy webRequest memory overhead | **Pre-compiled DeclarativeNetRequest (Core 6 Lists)** |
| **Anti-Adblock Defusal** | Easily detected via missing global objects | **37 Web Accessible Resource Stubs (`noop.js`, `1x1.gif`)** |
| **Facebook & Reels** | Broken by class obfuscation | **Sub-pixel Visual Coordinate Reconstruction** |
| **YouTube Ads** | Prone to black screens & audio muting | **Instantaneous Acceleration & Fast-Skip Engine** |
| **Video Player Popunders**| Intrusive new tabs on click | **Capture-Phase Click Interceptor & Auto-Closer** |
| **Anti-DevTools Hijacking**| Redirects on F12 / Inspect | **Hardware Key & Debugger Loop Neutralizer** |

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

### 2. 🎭 Smart Redirect Resources (Anti-Adblock Defuser)
Instead of failing network requests with errors, matching tracker and ad script requests are redirected to neutral stub assets in `web_accessible_resources/` (e.g. `googlesyndication_adsbygoogle.js`, `google-ima.js`, `amazon_ads.js`, `noop.js`, `1x1.gif`). Sites believe the ad script loaded normally, eliminating *"Please disable your AdBlocker"* warnings.

### 3. 🧠 Facebook Sponsored-Post & Reels Annihilator
Facebook delivers ads directly from its own origin (`facebook.com`) and continuously obfuscates DOM text with zero-width characters (`U+034F`), scrambled DOM hierarchies, and invisible clipped elements (`overflow: hidden`).
* **Visual Range Reconstruction (`fb-detect.js`)**: Measures exact screen coordinates via `Range.getBoundingClientRect()` rather than reading polluted DOM text.
* **Bilingual Support (LTR & RTL)**: Fully handles right-to-left languages (Arabic: "مُموَّل", "إعلان", "برعاية") and left-to-right (English: "Sponsored", "Ad").
* **Reels Shelf Suppression**: Cleanly removes sponsored cards from Reels and feeds without page stutter.

### 4. 🎬 YouTube Instantaneous Ad-Skipper
* **Non-Destructive Fast-Forward**: Accelerates ad playback stream to `16x`, mutes audio during ads, and programmatically clicks the Skip button the millisecond it becomes available.
* **Zero Black Screens**: Eliminates obstructive dark curtain overlays and prevents normal user videos from being skipped prematurely.

### 5. 🛑 In-Player Popunder & Click-Trap Neutralizer
Movie and anime streaming platforms (such as WeCima, FaselHD, Akwam, ArabSeed) deploy transparent overlays (`div[style*="z-index"]`, `<a target="_blank">`) directly over video players to spawn popunder advertising tabs upon clicking "Play".
* **Capture-Phase Click Interruption**: Catches and dissolves transparent clickjacking links before page event listeners can fire.
* **In-Iframe `window.open` Disarmer**: Drops rogue popunder requests initiated within embedded video players (`iframe`).
* **Smart Popclose Neutralizer (`popclose.js`)**: Automatically checks and terminates rogue ad landing tabs from within the newly opened window.

### 6. 🔓 Anti-DevTools Protection Bypass
Neutralizes key interception on `F12`, `Ctrl+Shift+I`, and `Ctrl+U`, allowing full inspection without forced page redirects.

---

## 📁 Repository Structure

```
├── manifest.json              # Extension Manifest V3 configuration
├── background.js              # Background Service Worker & rule managers
├── content.js                 # Global cosmetic styling & click-trap disarmer
├── popclose.js                # Popunder auto-terminator
├── inject.js                  # MAIN-world anti-adblock evasion & window.open filter
├── fb-detect.js               # Facebook visual coordinate detection engine
├── facebook.js                # Facebook feed observer and DOM scraper
├── youtube.js                 # YouTube player ad acceleration & skipper
├── popup.html / popup.js      # User interface & settings controller
├── rulesets/
│   └── main/                  # Core 6 DNR pre-compiled JSON rulesets
├── web_accessible_resources/  # 37 stub & noop redirect assets
└── tests/                     # 58-suite automated unit testing framework
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

Ad Blocker Pro Ultimate includes an automated unit testing suite simulating complex DOM layouts, clipped decoys, and bidirectional font rendering:

```bash
npm test
```

### Test Coverage:
* ✅ Plain English & Arabic ad labels
* ✅ Decoy letters hidden with `display:none` and zero-opacity
* ✅ Scrambled DOM ordering corrected with coordinate sorting
* ✅ Live `U+034F` grapheme joiner striping
* ✅ `overflow:hidden` clipping bounding box checks
* ✅ Negative assertions (ensures standard posts and friends' updates are never hidden)

```
================================================================
  All 58 test assertions passed (100% success rate)
================================================================
```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE.txt](LICENSE.txt) file for details.

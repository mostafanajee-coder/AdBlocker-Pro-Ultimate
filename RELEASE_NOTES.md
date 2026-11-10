# Ad Blocker Pro Ultimate v5.5.5

Cross-browser Firefox & Chrome support from the same project folder, a multi-layer Twitter / X promoted content overhaul, and Instagram Reels disclosure improvements.

## Firefox & Chrome Compatibility

- Supports both **Google Chrome** (`background.service_worker`) and **Mozilla Firefox 128+** (`background.scripts` + `browser_specific_settings.gecko`) directly from the same folder and package.
- Adapts dynamic DNR updates to Firefox's 5,000 dynamic rule limit by keeping all 18,763 bundled static rules active in Firefox while installing regional (`Liste AR`) and compatible regex rules dynamically, without affecting Chrome's 30,000 dynamic rule pipeline.

## Twitter / X Promoted Content Slayer

- **MAIN-World GraphQL & React Fiber Interceptor (`twitter-main.js`)**: Strips promoted tweets, promoted conversation replies, and promoted suggestions from X's `/i/api/graphql/` responses while preserving timeline cursors, and tags React Fiber nodes carrying `promotedMetadata` / `adMetadataContainer`.
- **Resilient DOM & Virtual Scroller Engine (`twitter.js`)**: Replaces one-shot `abpChecked` caching on unblocked tweets so delayed badge hydration and recycled virtual-list cells are always caught; injects a persistent `#abp-twitter-cosmetic` stylesheet so React inline style updates during scrolling cannot uncollapse hidden ad cells; automatically restores cells recycled for organic tweets.
- **Expanded Badge & Icon Coverage**: Normalizes Arabic diacritics/tashkeel (`مُروَّج`) and separator dots (`· Ad`, `· إعلان`), matches `Promoted by <Advertiser>` / `مُروّج بواسطة <Advertiser>` disclosures, scans `div[dir="ltr"]` and `div[dir="rtl"]` badge containers, and detects X's official Promoted SVG icon paths.

## Instagram Reels

- Recognizes standalone `Ad` disclosures below the author row and `Navigate to next Reel` controls for foreground confirmed ads while protecting organic captions and manual playback.

---

# v5.5.4 — local work, not published

- Match Instagram's observed standalone `Ad` disclosure below the author row, while keeping caption text protected.
- Recognize the observed native `Navigate to next Reel` label and allow one foreground-confirmed attempt.
- Add focused regressions; reload the unpacked extension and refresh Instagram for live verification. No push or release was authorized.

---

# v5.5.3 — local work, not published

- Improve Instagram Reel/container discovery, delayed-label observation, caption/profile protection, and reversible media/DOM effects.
- Preserve viewer layout and manual playback; do not pause/resume media or use generic/synthetic Reel navigation.
- Exact foreground Next reel controls receive at most one attempt; absent controls leave the confirmed ad covered/muted until normal navigation.
- Initial settings and live opt-outs are honored. Add targeted regression tests and a browser fixture. Real-site verification remains pending; browser control stopped on URL-policy uncertainty.
- No commit, push or release was authorized for this local change.

---

# Ad Blocker Pro Ultimate v5.5.2

Facebook fixes found while testing the extension's code on a real Facebook home feed.

## Facebook

- Ads on Pages, groups or profile tabs whose address contains "reel" (for example a Page named "reelshort…") are hidden again. Only the real Reels viewer is treated as Reels.
- Adding a site to the exception list, or saving a setting without changing it, no longer brings back hidden Facebook ads in open tabs.
- Removed a routine that rewrote Facebook's SVG timestamps. Facebook no longer uses that markup, and the extension should not edit Facebook's own page.
- The popup shows the correct version number.

## Verification

- All local regression suites pass, including three new Facebook sections; 9 of their checks fail on 5.5.1.
- Live check on a real home feed: every ad that appeared was detected (3 of 3), no ordinary post was flagged in about 190 posts, and the feed never went blank. Facebook served no ads during the hide-mode session, so please report any ad that stays visible.

---

# Ad Blocker Pro Ultimate v5.5.1

This release strengthens the general filter engine and fixes the regex rule that prevented Chrome from loading v5.5.0. It also includes the previously unpublished YouTube playback improvements.

## Extension load fix

- Do not register raw upstream regex candidate files in the manifest. uBlock regex rule 99 contains `{200,1300}`, which RE2 cannot compile; static parsing happens before the worker can run its checks.
- Load the main rules as static fallback, then use Chrome's `isRegexSupported` API to activate only supported regex candidates dynamically.
- Record omitted candidates with their source, original rule ID and native reason. A rejected regex does not cancel main, regional or cosmetic updates.
- Keep installed filtering on download failures, unsafe rule shapes, native API failures or rejected atomic installs. Never reference removed static regex rule IDs.

## Stronger general filtering

- Refresh six official uBOL main groups and four regex candidate partitions every 48 hours, pinned to one upstream revision per update. Restore missed schedules and retry failed refreshes after an hour without erasing the last-success timestamp.
- Add bounded site-specific procedural hiding with text matching, ancestor selection and nested conditions. Keep page-owned nodes mounted, protect structural containers, restore recycled organic content and honor exceptions/opt-outs.
- Recover owned hiding markers/stylesheets when removed, without a permanent polling loop.
- Add three packaged site-specific anti-detection functions with reversible owned hooks. These remain behind the existing Anti-Adblock Bypass option, off by default; no remote function bodies are executed.
- Preserve dedicated Facebook, Messenger, YouTube, Instagram and X engines. Preserve tracking opt-outs and unrelated dynamic rules; account for network/regex quotas and actual UTF-8 storage sizes.
- Preserve upstream filter-data licensing and record URLs, sizes and SHA-256 provenance.

## YouTube

- Use bounded timer-based ad recovery that does not depend on animation frames in hidden tabs.
- Recheck ad state after a successful skip; do not seek the following normal video to its end.
- Restore mute/playback only for the previously playing current media, respecting trusted manual pause and ended/replaced players.
- Recognize all supported ad renderers in the response sanitizer's fast path.

## Verification and limits

- 695 local regression assertions passed. Additional Chrome loopback testing passed 16 real DOM/CSS/control cases; its storage/injection was simulated.
- The installable package is built from committed Git blobs and verified file-by-file against that commit. Tests, development scripts, historical backups, Git internals and Chrome-generated metadata are excluded.
- No static manifest rules contain `regexFilter`. The 252 packaged regex entries are candidate data, not a promise that all will be accepted by Chrome.
- Live extension load and real-site ad coverage were not re-verified after the latest fix. Automated checks and the loopback fixture do not guarantee every ad format, full uBlock Origin parity or uninterrupted playback under browser freezing/discarding.

## Install or update

Requires Chrome/Chromium 145 or newer. Download the ZIP, verify it against `SHA256SUMS.txt`, and extract it. Use **Load unpacked** for a new installation, or **Reload** for an extension pointing at the updated files. If Chrome's failed-load dialog is still open, use **Retry** after updating the folder. Refresh open pages afterward.

To use the new site-specific anti-detection functions, enable **Anti-Adblock Bypass**. General network and procedural filtering do not require enabling that option.

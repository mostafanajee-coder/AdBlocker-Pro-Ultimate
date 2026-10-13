# Ad Blocker Pro Ultimate — Maintenance Notes (v5.5.2)

This build maintains the existing regional filter pipeline and platform lifecycles while making core network data refreshable. The original pipeline studied engineering ideas from `217heidai/adblockfilters`; that project's implementation is not vendored. Official uBOL declarative filter data is included separately with its upstream license and pinned provenance.

## 5.5.2 Facebook fixes

- Reels routing uses `^/reels?(/|$)` instead of a `/reel` substring. Feed pages such as `/reelshortapp`, `/groups/reelfans/` or `/<profile>/reels/` are ordinary feeds again, so image ads there are hidden instead of being sent to the viewer path (which requires exactly one video).
- Storage changes count only when a Facebook setting actually changes value or the page's own whitelist state flips. Effects are then released only if the new settings no longer enable their reason; switching diagnostic mode still replaces every effect. Shadow-only ads (one-time signal) therefore survive unrelated changes.
- Removed `restoreSvgTimestamps` and the `textLength`/`y` observer attributes. A live check on 2026-10-13 found no SVG `<text>` or `<use>` elements on the Facebook home feed; the function only rewrote Facebook markup. `sweepSvgAds` stays as a read-only detector.
- Live check on the real home feed (2026-10-13, extension code injected and hash-verified): 3 of 3 ads flagged (all via the `aria-labelledby` "Ad" label), no organic post flagged across about 190 posts, and the feed never went blank in hide mode. No ads were served in the hide-mode session, so a live hide of a real ad was not observed. Facebook's graphql traffic mostly bypassed `XMLHttpRequest.prototype.send` in that session, so the probe's network early-warning likely rarely fires; DOM detection does not depend on it.
- Regression sections 37-39 in `tests/facebook-orchestration.test.js`; 9 of their checks fail on 5.5.1.

## 5.5.1 regex load regression

- Confirmed from the user's Chrome failure: raw uBlock regex rule 99 has `{200,1300}`; RE2 rejects bounded repetition limits above 1,000. Static parsing happens before any worker/native validation, so registering raw regex partitions prevented loading the entire extension.
- Removed all four regex resources from the manifest. Original upstream files and hashes are preserved as runtime-only candidate data; no regex expressions are rewritten or broadened.
- Runtime checks every candidate with Chrome's API. `isSupported: false` skips only that unusable candidate, recording source, original upstream ID and native reason. Valid main/regex/regional/cosmetic data continues refreshing. Native API failure/malformed responses, download failure, unsafe shapes and rejected atomic updates retain installed rules.
- Static sync now addresses only registered main groups; it cannot reference removed `*-regex` IDs. The bundle refresh utility refuses any manifest that statically registers regex data.
- Offline audit no longer returns a fictional `isSupported: true` for every regex. It omits all 252 candidates when native validation is unavailable. Final enabled regex counts must come from real Chrome.
- Regression coverage includes the exact rule 99, a supported/unsupported mix, total regex rejection without lost main coverage, native API failures, original-ID diagnostics, manifest boot safety, and static ID ownership.

## Advanced engine

- `advanced-rules.js` is a shared, original data parser; it never evaluates downloaded JavaScript. Site entries add `p/pu` (procedural/exception) and `s/su` (approved function/exception), including explicit `+js()` all-function exceptions.
- Supported procedural subset: qualified CSS seed followed by `has-text`, `upward` (1..8 or a selector), `min-text-length`, and nested `has/not` (depth <=2). At most four operations per chain, 64 active rules, 300 seed candidates/rule, 32 candidates/nested query, 1,000 hidden targets. Fixed text alternatives/anchors/boundaries are allowed; arbitrary JS regex, XPath, style/remove operations and CSS suffixes after procedural steps are rejected rather than approximated.
- DOM effects use a reversible marker stylesheet. React/page-owned nodes stay mounted; recycled content and exceptions release hiding. Marker/stylesheet removal is recovered without permanent polling. Work yields after eight rules or roughly 8 ms between native queries. Individual native selector/layout operations cannot be hard-time-limited. Root/main/feed/navigation/oversized-wrapper guards are rechecked before applying effects.
- Own observers/timers/markers/styles are released on opt-out. Relevant site/setting changes update open documents; back-forward-cache restoration re-reads switches. Dedicated platform domains are excluded.
- Packaged functions: `set-constant`, `abort-on-property-read`, `no-setTimeout-if`; selected uBO aliases normalize to the same key. Prototype, extension-engine and foundational browser API paths are forbidden. Locked/accessor properties are skipped; unexpected constant type changes release the override. Timer callbacks/delays must match a validated bounded pattern. Teardown only restores still-owned hooks and preserves later page assignments/hooks.
- Functions remain behind `antiAdblock: true`; the user's default/opt-out is not changed. Pages with no enabled matching function do not wake the worker for this feature. Background reads authoritative storage, honors frame and parent whitelists/platform exclusions, serializes per-document work and pins injection to Chrome's `documentId`. Only packaged files are executed. Async configuration can miss page code that already ran; no blanket coverage claim is made.
- Native data adds four regex candidate partitions (252 entries). Chrome selects supported candidates, including capturing requirements, before atomic dynamic installation. Unsupported candidates are explicitly reported, not installed. Regex quota includes foreign rules and has a 950-rule ceiling. Query substitution accepts only the upstream URL-prefix-preserving token-removal shape.
- Chrome/Chromium 145+ is required for top-frame domain conditions. Installed Chrome and Edge binaries were version 154 during this audit; this is not browser-extension load proof.
- Local regression suites include parser/DOM/hook/document-identity/control tests. A separate loopback browser fixture exercises real DOM/CSS/MutationObserver using fixture storage; it does not load an extension or prove native DNR/live-site coverage.

## Core data and 48-hour refresh

- Bundled data: 18,723 main rules + 252 runtime-only regex candidates at upstream commit `9379e3387c6f615e695add23c2325c8705faca83`; `rulesets/core-source.json` records deployment kind, original URLs, sizes and SHA-256 digests. Upstream license and attribution are preserved.
- Every runtime update resolves one official commit, then fetches enabled main/regex partitions from that revision. No remote function bodies are executed. Unknown fields, unshipped resources, arbitrary redirect destinations and unsupported header modifications reject the snapshot rather than silently dropping rows.
- The combined core/regional/foreign count stays at or below 29,000; redirects/header modifications stay below 4,900, and regex rules below 950. Regional rules use remaining quota, with exceptions first.
- Native core owns IDs `200000..319999`; regional text rules own `100000..128999`. Atomic updates remove only owned IDs. The static core group is disabled only after its dynamic replacement count is verified; a missing group restores its bundled fallback. Clear restores fallback before deleting dynamic core data.
- Tracking opt-out removes the dynamic EasyPrivacy group immediately and keeps both its static counterpart and local tracking ruleset disabled. Defaults migration adds uBlock cosmetics once without resetting a previous tracking opt-out or existing list selection.
- The alarm period is 2,880 minutes, anchored to the last fully successful refresh, not every worker wake. Old 24-hour alarms migrate once. Startup catches overdue updates. Failed/incomplete refreshes retain the last-success timestamp, record failure and schedule a one-hour retry; recent failures suppress restart retry storms.
- Three concurrent bounded downloads; 8 MiB/source, 20-second timeout. Native snapshot failure happens before any install; Chrome's rejected remove+add update leaves old rules installed. Cosmetic download failures preserve previous CSS/site data. Storage errors are not reported as completed refreshes.
- Default cosmetic sources now include uBlock Ads, Unbreak and Quick Fixes, with global/site exceptions and up to 8,000 generic selectors. Open documents replace their list stylesheet on relevant storage changes and ignore other sites/counters. Facebook/Messenger exclusions remain.
- Corrected offline audit on 2026-10-10: 19,665 main/regional rules, all 252 regex candidates omitted because native validation is unavailable; 7,997 generic selectors, 719 procedural and 1,531 approved-function rules across 22,226 domains / 2,829,444 UTF-8 storage bytes, no network/storage truncation. Offline processing is not real Chrome DNR validation.
- These are the six uBOL main lists, four core regex partitions and our own bounded procedural/approved-function implementations, not the entire uBO engine. Arbitrary functions/operators, dynamic per-site filtering and DNS/CNAME features are absent. Full Origin parity cannot be claimed.

## YouTube playback changes

- Ad fallback recovery uses at most 12 timer checks, so it does not depend on requestAnimationFrame firing in a hidden tab. Visibility changes and media events trigger re-evaluation; normal media is not paused or continuously polled.
- Recheck ad state after the skip control/API returns, and never end-seek the normal video if the ad already ended or the player changed.
- Restore original mute state, and resume only previously playing current media on the same page. Trusted pause controls, ended media, and replaced players are guarded.
- The sanitizer's text marker detection covers all of its recognized ad renderers.
- YouTube toggle changes reload the active matching tab to apply MAIN-world registration. Runtime validation still needs extension reload plus a live YouTube check; local mocks cannot guarantee every ad format or browser lifecycle condition.

## Facebook lifecycle changes

- Central hiding guards honor the global switch, Facebook options, and live whitelist changes, including direct shadow events and known markers. Effects the changed settings no longer enable are released before re-evaluation; unrelated or unchanged settings keep current hides.
- Diagnostic mode only outlines detections, preserves original outlines, and does not mute, hide, navigate, or count blocked content.
- Reel navigation confirms route, creative, or active-slide movement. A no-op is recorded explicitly; only one replacement control can receive a second attempt. Generic keys and scroll fallbacks remain disabled.
- The MAIN-world probe is dynamically registered with whitelist exclusions and global/Facebook settings. Disabling it tears down owned hooks and observers in the open document. Registration changes take effect on future documents; enabling it again requires refreshing open tabs.
- Generic cosmetic CSS skips Facebook/Messenger only; other platform behavior is preserved.
- Filter bodies have an 8 MiB per-source stream cap. Oversized declared and chunked bodies fail before parsing/installing, preserving prior rules through existing refresh-failure handling.

## What was adopted conceptually

- **Source-aware processing instead of blind mega-list loading.** Every runtime source now declares whether it contributes network rules, cosmetic selectors, or is already represented by a bundled static ruleset.
- **Two-stage deduplication.** Exact duplicate filter lines are removed first, followed by semantic deduplication after conversion to DNR so option-order variants do not consume extra quota.
- **Hierarchical domain compaction.** A pure-domain child rule such as `||ads.example.com^` is dropped when an equivalent `||example.com^` rule already covers it.
- **Conservative conversion.** Unsupported ABP/AdGuard options are rejected rather than silently ignored. This prevents a narrow upstream rule from becoming broader during DNR conversion.
- **Change fingerprints.** The final compiled DNR output is fingerprinted. If the installed managed-rule count and fingerprint are unchanged, Chrome is not asked to replace thousands of identical rules.
- **Per-source provenance.** Reports now retain source role, bytes, parsed rules, unsupported lines, raw duplicates, semantic duplicates, compacted rules, selectors, and installed-rule counts.

## Existing MV3 pipeline controls

- EasyList text contributes cosmetics only; native network snapshots are handled separately, without simultaneous static/dynamic duplication.
- EasyPrivacy native core data is controlled consistently by **Strict Tracking** together with the extension's extra tracking ruleset.
- The default manifest state matches `strictTracking: true`; EasyPrivacy and the extra tracking ruleset are enabled by default and controlled by Strict Tracking.
- Owned core/regional ranges are described above. Foreign dynamic rules are preserved and counted before allocating quota.
- Dynamic replacement remains atomic. A network-source download failure or rejected DNR update keeps the previous known-good ruleset.
- Failed cosmetic refreshes keep the previous cosmetic selector set rather than installing a partial set.
- Text downloads reject obviously invalid/HTML responses; native JSON passes an independent shape/resource/action validator.
- Only the 36 redirect resources actually referenced by shipped DNR rules are exposed through `web_accessible_resources`; the previous wildcard exposure was removed.

## Deliberately NOT copied from the studied project

- **No direct import of its generated mega-list.** That would duplicate sources already present in this extension and waste limited DNR quota.
- **No DNS liveness scanner inside the browser extension.** Multi-resolver DNS validation is useful as a build/server pipeline, but it is inappropriate runtime work for a browser extension and adds networking/privacy/latency complexity.
- **No automatic rewriting/deletion of upstream semantics beyond provably safe transforms.** The converter rejects syntax it cannot represent faithfully.
- **No upstream GPL implementation code is included.** Official GPL-licensed declarative rule data is included with its license; that data is not relicensed as MIT.

## Parser safety policy

The regional ABP/AdGuard converter intentionally supports a conservative subset: basic block/exception rules, first/third-party constraints, `match-case`, `domain=`, supported resource types, literal path-style regex wrappers and pure-domain filters. Unknown options, wildcard domain constraints, non-ASCII `urlFilter`, unsafe regex and contradictory resource types are rejected rather than approximated. Core native regex and advanced site data use their separate validators. Site-entry budgets now count UTF-8 bytes and explicitly report storage truncation.

## Automated verification

Run `npm test` for current per-suite results. The suite includes Facebook detection/orchestration, other platform modules, filter compilation/pipeline, settings, background migration/menu, popup handling, and the maintenance integration checks. No hardcoded total is maintained here.

Dated 5.5.1 verification (2026-10-10): 695 local assertions passed, with zero failures. The separate Chrome loopback fixture passed 16 real DOM/CSS/control cases, including recycled content, delayed labels, marker/stylesheet removal, structural guards, exceptions and opt-outs. Fixture storage/injection is simulated; native extension DNR installation and real-site ad coverage still require reloading the extension and testing actual pages.

The pipeline integration tests use mocked Chrome DNR/storage and mocked filter downloads to verify ownership, failure safety, provenance, deduplication, domain compaction, static/dynamic overlap avoidance, and unchanged-build skipping.

## Still recommended before public release

- Run browser-level integration tests in actual Chromium for DNR precedence, extension update/reload behavior, filter refreshes, Strict Tracking transitions, and whitelist changes.
- Exercise a representative live-site matrix to measure false positives and cosmetic breakage.
- Verify existing domain-scoped cosmetic rules and exceptions against representative pages while keeping injection bounded.
- Consider moving upstream list compilation to a controlled release/build pipeline if the project later needs heavier validation such as DNS liveness checks.

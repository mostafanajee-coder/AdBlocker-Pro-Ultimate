# Ad Blocker Pro Ultimate — v5.4.5 Maintenance

This build maintains the existing source-aware filter pipeline and Facebook detection lifecycle. The original pipeline studied engineering ideas from the public `217heidai/adblockfilters` project and reimplemented the ideas that fit Chromium Manifest V3. No upstream project code is vendored into this extension.

## Facebook lifecycle changes

- Central hiding guards honor the global switch, Facebook options, and live whitelist changes, including direct shadow events and known markers. Existing effects are released before re-evaluating changed settings.
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

- EasyList remains available at runtime for generic cosmetic selectors, but its network rules are no longer duplicated dynamically because they are already bundled as static DNR.
- EasyPrivacy is no longer duplicated into the runtime dynamic quota. It is controlled consistently by **Strict Tracking** together with the extension's extra tracking ruleset.
- The default manifest state matches `strictTracking: true`; EasyPrivacy and the extra tracking ruleset are enabled by default and controlled by Strict Tracking.
- Runtime filter rules own IDs `100000..128999`. Refresh/clear operations touch only this range and therefore preserve unrelated dynamic rules.
- Dynamic replacement remains atomic. A network-source download failure or rejected DNR update keeps the previous known-good ruleset.
- Failed cosmetic refreshes keep the previous cosmetic selector set rather than installing a partial set.
- Runtime source downloads are concurrent and validated against obviously invalid/HTML responses.
- Only the 36 redirect resources actually referenced by shipped DNR rules are exposed through `web_accessible_resources`; the previous wildcard exposure was removed.

## Deliberately NOT copied from the studied project

- **No direct import of its generated mega-list.** That would duplicate sources already present in this extension and waste limited DNR quota.
- **No DNS liveness scanner inside the browser extension.** Multi-resolver DNS validation is useful as a build/server pipeline, but it is inappropriate runtime work for a browser extension and adds networking/privacy/latency complexity.
- **No automatic rewriting/deletion of upstream semantics beyond provably safe transforms.** The converter rejects syntax it cannot represent faithfully.
- **No upstream GPL implementation code is included.** The extension uses its own implementation of the general engineering concepts above.

## Parser safety policy

The runtime ABP/AdGuard converter intentionally supports a conservative subset. It currently understands basic block/exception rules, first/third-party constraints, `match-case`, `domain=`, positive/negative supported resource types, literal path-style regex wrappers, and pure-domain filters. Unknown options, wildcard domain constraints, non-ASCII `urlFilter` values, unsafe regex syntax, and contradictory resource-type constraints are rejected rather than approximated.

## Automated verification

Run `npm test` for current per-suite results. The suite includes Facebook detection/orchestration, other platform modules, filter compilation/pipeline, settings, background migration/menu, popup handling, and the maintenance integration checks. No hardcoded total is maintained here.

The pipeline integration tests use mocked Chrome DNR/storage and mocked filter downloads to verify ownership, failure safety, provenance, deduplication, domain compaction, static/dynamic overlap avoidance, and unchanged-build skipping.

## Still recommended before public release

- Run browser-level integration tests in actual Chromium for DNR precedence, extension update/reload behavior, filter refreshes, Strict Tracking transitions, and whitelist changes.
- Exercise a representative live-site matrix to measure false positives and cosmetic breakage.
- Verify existing domain-scoped cosmetic rules and exceptions against representative pages while keeping injection bounded.
- Consider moving upstream list compilation to a controlled release/build pipeline if the project later needs heavier validation such as DNS liveness checks.

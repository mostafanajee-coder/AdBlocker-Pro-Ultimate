# Ad Blocker Pro Ultimate — v5.1.1 Maintenance Notes

This build is the first maintenance pass over v5.1.0. It intentionally focuses on correctness and settings wiring before adding new blocking features.

## Fixed in this pass

- The whitelist now applies at the network layer through high-priority session-scoped `allowAllRequests` DNR rules. It therefore overrides the extension's own block/redirect rules for whitelisted page hierarchies.
- The global **Ad Blocker** toggle now enables/disables the bundled ad-oriented static rulesets instead of only changing DOM behavior.
- `inject.js` is no longer a permanent `<all_urls>` MAIN-world content script. It is dynamically registered only while **Anti-Adblock** is enabled and excludes whitelisted domains.
- The YouTube sanitizer is no longer statically injected before settings are known. It is dynamically registered in the MAIN world only while global ad blocking and the YouTube blocker are enabled, excluding whitelisted domains.
- Dynamic MAIN-world script registration uses `updateContentScripts()` when already registered, avoiding needless unregister/register gaps on service-worker restarts.
- Twitter/X now honors `adBlock`, `twitterBlock`, and the whitelist and restores content that it hid when the feature is disabled.
- The popup reloads the current tab when changing the global blocker, Anti-Adblock, or current-site whitelist so MAIN-world hooks and DOM state are applied cleanly.
- `popclose.js` now checks global blocker state and whitelist before closing a candidate popup.
- The Anti-Adblock `window.open` hook no longer blocks every iframe popup and no longer replaces legitimate `about:blank` windows on arbitrary sites.
- Filter conversion now maps negated resource types such as `$~image` to DNR `excludedResourceTypes` instead of silently broadening the rule.
- Community-filter replacement is now one atomic DNR update. If list download or installation fails, the previous working dynamic rules remain in place.
- The release requires Chrome 119+ because the dynamically registered MAIN-world scripts use related-frame origin fallback.
- Added regression tests for filter conversion and settings/whitelist wiring. Current automated suite: **207/207 passing**.

## Deliberately left for the next maintenance pass

- Expand the filter-list parser beyond the current conservative ABP subset (domain-specific cosmetic rules, more option combinations, redirects/scriptlets where safe under MV3).
- Narrow `web_accessible_resources` from a wildcard to only the resources actually referenced by redirect rules and consider dynamic URLs where compatible.
- Decide and document the exact product semantics of baseline EasyPrivacy versus the **Strict Tracking** switch; v5.1.1 preserves the existing baseline privacy behavior.
- Add browser-level integration tests in Chromium for real DNR precedence, extension reload/update behavior, and live toggle transitions; the current suite is unit/static regression coverage.
- Review the streaming-site click-trap heuristics for false positives and replace broad hostname/path keywords with more targeted evidence where possible.

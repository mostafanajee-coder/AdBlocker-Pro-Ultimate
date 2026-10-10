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

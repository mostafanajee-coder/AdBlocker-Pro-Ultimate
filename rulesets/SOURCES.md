# Filter data provenance

The six `main/*.json` and four `regex/*.json` core files are declarative filtering data
from the official [uBlock Origin Lite repository](https://github.com/uBlockOrigin/uBOL-home).
The exact revision, original URLs, byte sizes, rule counts, and SHA-256 digests
are recorded in `core-source.json`. Their upstream GPLv3 license is preserved
in `UPSTREAM_LICENSE.txt`; the extension's MIT license does not relicense this
third-party data. Source filter lists may also carry their own licenses; see
the [uBlock filter-list license inventory](https://github.com/gorhill/uBlock/wiki/Filter-list-licenses).

To regenerate the bundled data from a pinned upstream commit:

```text
node scripts/refresh-core-filters.mjs --revision <40-character upstream commit>
```

At runtime, the extension downloads only declarative JSON from that official
repository and plain filter-list text from the declared list providers. It
never downloads or executes remote JavaScript function bodies. Plain list
annotations can configure only this extension's fixed, validated functions;
unknown commands, executable expressions and unsafe parameters are rejected.
Redirect targets
must already be exposed by this extension's manifest; updates needing new
resources or unsupported rule fields fail without replacing installed rules.

These files cover uBOL's six core main rulesets and four native regex
candidate partitions: 18,723 main rules plus 252 candidates at the recorded
revision. **Only main lists are registered as static fallback.** Original
regex data can contain expressions Chrome cannot compile, including upstream
uBlock rule 99 (`{200,1300}`). `runtimeOnlyKinds` records this deployment rule.
Chrome 145+ is required for top-frame domain conditions. Chrome's runtime API
selects supported candidates before atomic installation; omitted candidates
are recorded with source, original ID and reason. No regex is broadened or
rewritten, and no native fields are silently removed. Download/API failures,
unsafe rule shapes or rejected installs retain installed rules.

The extension's procedural parser/runtime and three packaged function
implementations are original code. They implement only a bounded subset of
public filter syntax, not uBO/uBOL's full scriptlet or procedural libraries.
Dynamic per-site filtering and DNS/CNAME filtering are not included. Matching
selected network data is not a claim of full uBlock Origin parity.

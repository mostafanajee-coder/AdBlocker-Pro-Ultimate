import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const core = require("../core-filters.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const resources = manifest.web_accessible_resources.flatMap(entry => entry.resources);
// Raw regex partitions are candidate data, not boot-time Chrome rule files.
// Never reintroduce a load-blocking rule before native validation can run.
for (const resource of manifest.declarative_net_request.rule_resources) {
  if (resource.path.startsWith("rulesets/regex/") || JSON.parse(fs.readFileSync(path.join(root, resource.path), "utf8")).some(rule => rule.condition.regexFilter !== undefined)) {
    throw new Error("regex candidates must be runtime-validated, not registered as static rules: " + resource.id);
  }
}
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
let revision = option("--revision");
if (!revision) {
  const response = await fetch(core.API_URL);
  if (!response.ok) throw new Error("upstream revision HTTP " + response.status);
  revision = (await response.json()).sha;
}
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("invalid upstream revision");
const stage = option("--stage");
const snapshots = [];
for (const { source, kind } of core.SOURCES.flatMap(source => [{ source, kind: "main" }].concat(source.regex ? [{ source, kind: "regex" }] : []))) {
  const url = core.RAW_ROOT + revision + "/chromium/rulesets/" + kind + "/" + source.id + ".json";
  let bytes;
  if (stage) bytes = fs.readFileSync(path.join(stage, kind === "main" ? source.id + ".json" : "regex-" + source.id + ".json"));
  else {
    const response = await fetch(url);
    if (!response.ok) throw new Error("ruleset HTTP " + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (bytes.length > 8 * 1024 * 1024) throw new Error("oversized build ruleset");
  const parsed = JSON.parse(bytes.toString("utf8"));
  core.validate(source.id, parsed, resources, kind);
  snapshots.push({ source, kind, url, bytes, count: parsed.length,
    unsafe: parsed.filter(rule => !["block", "allow", "allowAllRequests", "upgradeScheme"].includes(rule.action.type)).length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
}
if (snapshots.reduce((sum, snapshot) => sum + snapshot.count, 0) > 29000 ||
    snapshots.reduce((sum, snapshot) => sum + snapshot.unsafe, 0) > core.MAX_UNSAFE_RULES ||
    snapshots.filter(snapshot => snapshot.kind === "regex").reduce((sum, snapshot) => sum + snapshot.count, 0) > core.MAX_REGEX_RULES) {
  throw new Error("combined core snapshot exceeds the runtime replacement quota");
}
const licenseURL = core.RAW_ROOT + revision + "/LICENSE";
const licenseResponse = await fetch(licenseURL);
if (!licenseResponse.ok) throw new Error("upstream license HTTP " + licenseResponse.status);
const license = await licenseResponse.text();
if (!license.includes("GNU GENERAL PUBLIC LICENSE")) throw new Error("unexpected upstream license");

// This is a generated data refresh. Validate every input before replacing any
// bundled rule data; runtime downloads use their own bounded reader.
for (const snapshot of snapshots) {
  fs.mkdirSync(path.join(root, "rulesets", snapshot.kind), { recursive: true });
  fs.writeFileSync(path.join(root, "rulesets", snapshot.kind, snapshot.source.id + ".json"), snapshot.bytes);
}
fs.writeFileSync(path.join(root, "rulesets", "UPSTREAM_LICENSE.txt"), license);
const metadata = {
  upstream: "https://github.com/uBlockOrigin/uBOL-home", revision,
  generatedAt: new Date().toISOString(), license: "UPSTREAM_LICENSE.txt", licenseURL,
  runtimeOnlyKinds: ["regex"],
  rulesets: snapshots.map(snapshot => ({ id: snapshot.source.id, kind: snapshot.kind, url: snapshot.url,
    rules: snapshot.count, bytes: snapshot.bytes.length, sha256: snapshot.sha256 }))
};
fs.writeFileSync(path.join(root, "rulesets", "core-source.json"), JSON.stringify(metadata, null, 2) + "\n");
console.log(JSON.stringify({ revision, rules: snapshots.reduce((sum, snapshot) => sum + snapshot.count, 0), files: snapshots.length }));

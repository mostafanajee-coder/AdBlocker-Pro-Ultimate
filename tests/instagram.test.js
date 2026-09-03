"use strict";

const fs = require("fs");
const path = require("path");
const IG = require("../instagram.js");

let passed = 0;
let failed = 0;

function check(condition, label) {
  if (condition) {
    passed++;
    console.log("  PASS  " + label);
  } else {
    failed++;
    console.error("  FAIL  " + label);
  }
}

console.log("\nInstagram sponsored-label detection");
console.log("-------------------------------------");

check(IG.isSponsoredLabel("Sponsored"), "matches English Sponsored");
check(!IG.isSponsoredLabel("Ad"), "rejects the ambiguous one-word English label");
check(IG.isSponsoredLabel("مُموَّل"), "normalizes and matches Arabic مُموَّل");
check(IG.isSponsoredLabel("إعلان"), "normalizes and matches Arabic إعلان");
check(IG.isSponsoredLabel("برعاية"), "matches Arabic برعاية");
check(IG.isSponsoredLabel("محتوى ممول"), "matches Arabic funded-content label");
check(IG.isSponsoredLabel("Spon\u200Bsored"), "removes zero-width obfuscation");
check(!IG.isSponsoredLabel("My sponsored project"), "rejects ordinary sentences containing sponsored");
check(!IG.isSponsoredLabel("Ad Center"), "rejects non-ad UI text");
check(!IG.isSponsoredLabel("منشور عادي"), "rejects a normal Arabic post label");

check(IG.isSponsoredLabel("Paid partnership with Nike"), "matches English Paid partnership with brand");
check(IG.isSponsoredLabel("شراكة مدفوعة مع اديداس"), "matches Arabic شراكة مدفوعة مع brand");
check(IG.isSponsoredLabel("Sponsorisé"), "matches French Sponsorisé");
check(IG.isSponsoredLabel("Gesponsert"), "matches German Gesponsert");
check(IG.isSponsoredLabel("Publicidad"), "matches Spanish Publicidad");
check(IG.isSponsoredLabel("Patrocinado"), "matches Spanish Patrocinado");
check(IG.isSponsoredLabel("Реклама"), "matches Russian Реклама");
check(!IG.isSponsoredLabel("Profile Details"), "rejects ordinary Profile Details");
check(!IG.isSponsoredLabel("Public figures"), "rejects Public figures");

const repo = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repo, "instagram.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(repo, "manifest.json"), "utf8"));
const entry = manifest.content_scripts.find((item) =>
  Array.isArray(item.js) && item.js.includes("instagram.js")
);

check(Boolean(entry && entry.matches.length === 1 && entry.matches[0].includes("instagram.com")), "module is scoped only to Instagram");
check(!/setInterval\s*\(/.test(source), "Instagram detector uses no permanent polling interval");
check(source.includes("article[data-abp-instagram-ad='1']"), "only marked post containers are hidden");
check(source.includes("igSponsored"), "Instagram module binds to igSponsored toggle in storage");

console.log("\n" + "=".repeat(64));
console.log(`  Instagram: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));

if (failed) process.exit(1);

"use strict";

const fs = require("fs");
const path = require("path");
const twitter = require("../twitter.js");

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

console.log("\nTwitter / X sponsored-label detection");
console.log("-------------------------------------");

check(twitter.isPromotedText("Promoted"), "matches English Promoted");
check(twitter.isPromotedText("promoted tweet"), "matches English promoted tweet");
check(twitter.isPromotedText("Ad"), "matches English Ad");
check(twitter.isPromotedText("مُروّج"), "matches Arabic مُروّج");
check(twitter.isPromotedText("مروج"), "matches Arabic مروج");
check(twitter.isPromotedText("إعلان"), "matches Arabic إعلان");
check(twitter.isPromotedText("اعلان"), "matches Arabic اعلان");
check(twitter.isPromotedText("Sponsorisé"), "matches French Sponsorisé");

check(!twitter.isPromotedText("I got promoted at work today!"), "rejects English sentence with promoted");
check(!twitter.isPromotedText("هذا ليس إعلان تجاري بل نصيحة"), "rejects Arabic sentence with ad");
check(!twitter.isPromotedText("Looking for advice on ad tech careers"), "rejects sentence with ad");

// DOM structure mock tests
const mockArticleWithTracking = {
  querySelector: (sel) => (sel === '[data-testid="placementTracking"]' ? {} : null),
  querySelectorAll: () => []
};
check(twitter.isPromotedTweet(mockArticleWithTracking), "detects promoted tweet via placementTracking");

const mockArticleWithAdLink = {
  querySelector: () => null,
  querySelectorAll: (sel) => (sel.includes("/quick_promote_web/") ? [{}] : [])
};
check(twitter.isPromotedTweet(mockArticleWithAdLink), "detects promoted tweet via quick_promote_web link");

const mockArticleWithSpan = {
  querySelector: () => null,
  querySelectorAll: (sel) => (sel.includes("span") ? [{ textContent: "Promoted", getAttribute: () => null }] : [])
};
check(twitter.isPromotedTweet(mockArticleWithSpan), "detects promoted tweet via Promoted span");

const mockOrganicArticle = {
  querySelector: () => null,
  querySelectorAll: (sel) => (sel.includes("span") ? [{ textContent: "Hello world, peaceful day!", getAttribute: () => null }] : [])
};
check(!twitter.isPromotedTweet(mockOrganicArticle), "rejects organic tweet without ad signals");

const repo = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(repo, "twitter.js"), "utf8");
check(!/setInterval\s*\(/.test(source), "Twitter module avoids permanent polling setInterval");

console.log("\n" + "=".repeat(64));
console.log(`  Twitter / X: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));

if (failed) process.exit(1);

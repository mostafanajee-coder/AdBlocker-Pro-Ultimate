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

console.log("\nTwitter / X exact-match ad detection (Zero False Positives)");
console.log("----------------------------------------------------------");

// 1. Exact matches
check(twitter.isExactPromotedLabel("Promoted"), "matches standalone 'Promoted'");
check(twitter.isExactPromotedLabel("promoted tweet"), "matches 'promoted tweet'");
check(twitter.isExactPromotedLabel("Ad"), "matches standalone 'Ad'");
check(twitter.isExactPromotedLabel("مُروّج"), "matches Arabic 'مُروّج'");
check(twitter.isExactPromotedLabel("مروج"), "matches Arabic normalized 'مروج'");
check(twitter.isExactPromotedLabel("الإعلان"), "matches Arabic 'الإعلان'");
check(twitter.isExactPromotedLabel("الاعلان"), "matches Arabic normalized 'الاعلان'");
check(twitter.isExactPromotedLabel("إعلان"), "matches Arabic 'إعلان'");
check(twitter.isExactPromotedLabel("اعلان"), "matches Arabic normalized 'اعلان'");
check(twitter.isExactPromotedLabel("Sponsorisé"), "matches French 'Sponsorisé'");
check(twitter.isExactPromotedLabel("Gesponsert"), "matches German 'Gesponsert'");
check(twitter.isExactPromotedLabel("Реклама"), "matches Russian 'Реклама'");
check(twitter.isExactPromotedLabel("プロモーション"), "matches Japanese 'プロモーション'");

// 2. Strict rejection of organic text and false positives
check(!twitter.isExactPromotedLabel("إعلان هام للجميع"), "rejects 'إعلان هام للجميع'");
check(!twitter.isExactPromotedLabel("إعلان نتائج القبول"), "rejects 'إعلان نتائج القبول'");
check(!twitter.isExactPromotedLabel("اعلان وظائف"), "rejects 'اعلان وظائف'");
check(!twitter.isExactPromotedLabel("I got promoted at work today!"), "rejects 'I got promoted at work today!'");
check(!twitter.isExactPromotedLabel("This was a great ad"), "rejects 'This was a great ad'");
check(!twitter.isExactPromotedLabel("Ad Agency"), "rejects 'Ad Agency'");
check(!twitter.isExactPromotedLabel("Chad"), "rejects 'Chad'");
check(!twitter.isExactPromotedLabel("Adam"), "rejects 'Adam'");

// 3. DOM Isolation: tweet body must NEVER be flagged
const mockTweetWithBodyMention = {
  querySelector: () => null,
  querySelectorAll: (selector) => {
    if (selector.includes('span')) {
      return [{
        textContent: "مُروّج",
        getAttribute: () => null,
        closest: (ancestor) => (ancestor === '[data-testid="tweetText"]' ? {} : null)
      }];
    }
    return [];
  }
};
check(!twitter.isPromotedTweet(mockTweetWithBodyMention), "rejects tweet even if tweet body text contains 'مُروّج'");

// 4. DOM Isolation: user name must NEVER be flagged
const mockTweetWithUserNameMention = {
  querySelector: () => null,
  querySelectorAll: (selector) => {
    if (selector.includes('span')) {
      return [{
        textContent: "Ad",
        getAttribute: () => null,
        closest: (ancestor) => (ancestor === '[data-testid="User-Name"]' ? {} : null)
      }];
    }
    return [];
  }
};
check(!twitter.isPromotedTweet(mockTweetWithUserNameMention), "rejects tweet if User-Name contains 'Ad'");

// 5. Genuine Promoted Tweet with dedicated ad badge outside body
const mockGenuineAdTweet = {
  querySelector: () => null,
  querySelectorAll: (selector) => {
    if (selector.includes('span')) {
      return [{
        textContent: "مُروّج",
        getAttribute: () => null,
        closest: () => null
      }];
    }
    return [];
  }
};
check(twitter.isPromotedTweet(mockGenuineAdTweet), "detects genuine promoted tweet with standalone badge");

// 6. Placement tracking (used by video players) must NOT trigger false positive
const mockVideoTweet = {
  querySelector: () => null,
  querySelectorAll: () => []
};
check(!twitter.isPromotedTweet(mockVideoTweet), "video tweet with placementTracking is not falsely flagged as ad");

// 7. Generic links with '/ads' must NOT trigger false positive
const mockTweetWithArticleLink = {
  querySelector: () => null,
  querySelectorAll: (selector) => {
    if (selector.includes('ads.twitter.com')) return [];
    return [];
  }
};
check(!twitter.isPromotedTweet(mockTweetWithArticleLink), "rejects tweet with generic /ads link");

// 8. Advertiser link with twclid (Twitter Click ID) must be flagged
const mockAdWithTwclid = {
  querySelector: () => null,
  querySelectorAll: (selector) => {
    if (selector.includes('twclid=')) {
      return [{
        getAttribute: () => 'https://example.com/?twclid=12345',
        closest: () => null
      }];
    }
    return [];
  }
};
check(twitter.isPromotedTweet(mockAdWithTwclid), "detects promoted tweet via twclid parameter");

// 9. Tweet body with 'إعلان رسمي' must NEVER be flagged
const mockOrganicNewsTweet = {
  querySelector: () => null,
  querySelectorAll: (selector) => {
    if (selector.includes('span')) {
      return [{
        textContent: "إعلان رسمي: تم افتتاح المعرض",
        getAttribute: () => null,
        closest: (ancestor) => (ancestor === '[data-testid="tweetText"]' ? {} : null)
      }];
    }
    return [];
  }
};
check(!twitter.isPromotedTweet(mockOrganicNewsTweet), "rejects organic news tweet with 'إعلان رسمي' in body");

console.log("\n" + "=".repeat(64));
console.log(`  Twitter / X: ${passed} passed, ${failed} failed`);
console.log("=".repeat(64));

if (failed) process.exit(1);

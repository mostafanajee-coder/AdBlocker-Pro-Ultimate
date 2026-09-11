const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'manifest.json'), 'utf8'));
const background = fs.readFileSync(path.join(repo, 'background.js'), 'utf8');
const twitter = fs.readFileSync(path.join(repo, 'twitter.js'), 'utf8');
const popclose = fs.readFileSync(path.join(repo, 'popclose.js'), 'utf8');
const popup = fs.readFileSync(path.join(repo, 'popup.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(cond, name) {
  if (cond) { passed++; console.log('  PASS ', name); }
  else { failed++; console.error('  FAIL ', name); }
}

console.log('\nSettings / whitelist wiring\n---------------------------');
const scripts = manifest.content_scripts || [];
check(!scripts.some(e => Array.isArray(e.js) && e.js.includes('inject.js')), 'anti-adblock injector is not statically forced on every site');
check(!scripts.some(e => Array.isArray(e.js) && e.js.includes('youtube-main.js')), 'YouTube MAIN-world sanitizer is not statically forced on every load');
check(background.includes('"anti-adblock-script"') && background.includes('settings.antiAdblock === true'), 'anti-adblock MAIN script follows its toggle');
check(background.includes('"youtube-main-script"') && background.includes('settings.ytSkip !== false'), 'YouTube MAIN script follows YouTube/global settings');
check(background.includes('allowAllRequests') && background.includes('updateSessionRules'), 'whitelist has a network-level DNR allowAllRequests layer');
check(background.includes('requestDomains: [domain]'), 'whitelist DNR rules cover domain and subdomains');
check(background.includes('AD_RULESET_IDS') && background.includes('settings.adBlock !== false'), 'Ad Blocker toggle controls static ad rulesets');
check(background.includes('const STRICT_TRACKING_RULESET_IDS = ["easyprivacy", "tracking"]'), 'Strict Tracking controls both EasyPrivacy and the extra tracking ruleset');
const easyPrivacyResource = (manifest.declarative_net_request.rule_resources || []).find(r => r.id === 'easyprivacy');
check(easyPrivacyResource && easyPrivacyResource.enabled === false, 'EasyPrivacy manifest default matches strictTracking=false');
const war = manifest.web_accessible_resources || [];
check(war.length === 1 && Array.isArray(war[0].resources) && !war[0].resources.includes('web_accessible_resources/*'), 'web accessible resources are explicitly scoped instead of wildcarded');
check(war[0].resources.length === 36, 'only the 36 redirect resources referenced by shipped rulesets are exposed');
check(background.includes('filterLists: ["arabic", "easylist"]'), 'default dynamic list selection avoids duplicating bundled EasyPrivacy network rules');
check(!popup.includes('300,000+'), 'popup no longer advertises a fictional 300,000+ active-rule count');
check(twitter.includes('twitterBlock') && twitter.includes('whitelist') && twitter.includes('adBlock'), 'Twitter module follows toggle, whitelist, and global blocker state');
check(popclose.includes('settings.adBlock === false') && popclose.includes('isWhitelisted'), 'popunder closer respects global blocker state and whitelist');
check(manifest.minimum_chrome_version === '119', 'minimum Chrome version covers dynamic MAIN-world related-frame registration');

console.log('\n' + '='.repeat(64));
console.log(`  Settings wiring: ${passed} passed, ${failed} failed`);
console.log('='.repeat(64));
if (failed) process.exit(1);

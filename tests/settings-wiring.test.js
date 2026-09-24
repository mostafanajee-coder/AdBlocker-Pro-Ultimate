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
check(easyPrivacyResource && easyPrivacyResource.enabled === true, 'EasyPrivacy manifest default matches strictTracking=true');
const trackingResource = (manifest.declarative_net_request.rule_resources || []).find(r => r.id === 'tracking');
check(trackingResource && trackingResource.enabled === true, 'extra tracking ruleset is on by default too');
check(background.includes('strictTracking: true,'), 'tracking protection is on by default');
check(background.includes('patch.strictTracking = true') && background.includes('reason === "update"'), 'existing installs get tracking protection once, on update');
const war = manifest.web_accessible_resources || [];
check(war.length === 1 && Array.isArray(war[0].resources) && !war[0].resources.includes('web_accessible_resources/*'), 'web accessible resources are explicitly scoped instead of wildcarded');
check(war[0].resources.length === 36, 'only the 36 redirect resources referenced by shipped rulesets are exposed');
check(background.includes('filterLists: ["arabic", "easylist", "adguard-base"]'), 'default lists add AdGuard Base site hiding and still avoid duplicating bundled EasyPrivacy network rules');
check(background.includes('chrome.storage.local.get(SETTING_KEYS)') && !background.includes('storage.local.get(null)'), 'background reads settings keys only, never the ~20k site-hiding entries');
check(!popup.includes('300,000+'), 'popup no longer advertises a fictional 300,000+ active-rule count');
check(twitter.includes('twitterBlock') && twitter.includes('whitelist') && twitter.includes('adBlock'), 'Twitter module follows toggle, whitelist, and global blocker state');
check(popclose.includes('settings.adBlock === false') && popclose.includes('isWhitelisted'), 'popunder closer respects global blocker state and whitelist');
check((manifest.permissions || []).includes('contextMenus'), 'right-click "Block this element" has its permission');
{
  const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const listMatch = /var BLOCK_EXCLUDED = (\[[\s\S]*?\]);/.exec(contentSrc);
  const { FILTERS } = require('../filters.js');
  const contentList = listMatch ? JSON.parse(listMatch[1].replace(/'/g, '"')) : null;
  check(contentList && JSON.stringify(contentList) === JSON.stringify(FILTERS.SITE_COSMETIC_EXCLUDED), 'content.js never blocks on exactly the sites filters.js and background.js exclude');
}
{
  const contentSrc = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'utf8');
  const m = /function isStreamingSite\(host\) \{\s*return (\/[^\n]*\/i)\.test\(host\);/.exec(contentSrc);
  const re = m ? eval(m[1]) : null;
  check(re && re.test('mycima.example') && re.test('www.faselhd.tv') && !re.test('shahid.mbc.net'), 'click-trap removal targets pirate streaming hosts, not Shahid (MBC)');
}
check(!/innerHTML\s*=\s*["']<span>["']\s*\+\s*domain/.test(popup), 'the popup builds exception-list rows as text, never as HTML from the domain');
check(manifest.minimum_chrome_version === '119', 'minimum Chrome version covers dynamic MAIN-world related-frame registration');

console.log('\n' + '='.repeat(64));
console.log(`  Settings wiring: ${passed} passed, ${failed} failed`);
console.log('='.repeat(64));
if (failed) process.exit(1);

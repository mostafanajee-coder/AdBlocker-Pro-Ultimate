const { FILTERS } = require('../filters.js');

let passed = 0;
let failed = 0;
function check(cond, name) {
  if (cond) { passed++; console.log('  PASS ', name); }
  else { failed++; console.error('  FAIL ', name); }
}

console.log('\nFilter engine conversion guards\n-------------------------------');

let r = FILTERS.parseLine('||example.com^$~image', 100001);
check(Boolean(r), 'parses negated resource type rule');
check(r && Array.isArray(r.rule.condition.excludedResourceTypes) && r.rule.condition.excludedResourceTypes.includes('image'), 'maps ~image to excludedResourceTypes');
check(r && !r.rule.condition.resourceTypes, 'does not turn ~image into an all-type positive rule');

r = FILTERS.parseLine('||example.com^$script,~image', 100002);
check(r && r.rule.condition.resourceTypes.includes('script'), 'keeps positive resource types');
check(r && r.rule.condition.excludedResourceTypes.includes('image'), 'keeps negative resource types beside positive types');

r = FILTERS.parseLine('@@||example.com^$third-party', 100003);
check(r && r.isException && r.rule.action.type === 'allow', 'converts exception rules to allow');
check(r && r.rule.priority > 1, 'exception rules retain higher priority');

r = FILTERS.parseLine('||example.com^$popup', 100004);
check(r === null, 'rejects unsupported behavioral options instead of guessing');

r = FILTERS.parseLine('||example.com^$removeparam=utm_source', 100005);
check(r === null, 'rejects unknown behavioral options instead of broadening the rule');

r = FILTERS.parseLine('||example.com^$match-case', 100006);
check(r && r.rule.condition.isUrlFilterCaseSensitive === true, 'maps match-case to DNR case sensitivity');

r = FILTERS.parseLine('||example.com^$xhr', 100007);
check(r && r.rule.condition.resourceTypes.includes('xmlhttprequest'), 'maps xhr alias to xmlhttprequest');

r = FILTERS.parseLine('||example.com^$script,~script', 100008);
check(r === null, 'rejects contradictory positive and negative resource types');

r = FILTERS.parseLine('||مثال.com^', 100009);
check(r === null, 'rejects non-ASCII urlFilter values that DNR cannot install');

r = FILTERS.parseLine('||*example.com^', 100010);
check(r === null, 'rejects DNR-invalid ||* prefix');

const a = FILTERS.parseLine('||example.com^$script,image', 100011);
const b = FILTERS.parseLine('||example.com^$image,script', 100012);
check(a && b && FILTERS.canonicalRuleKey(a.rule) === FILTERS.canonicalRuleKey(b.rule), 'semantic key deduplicates option-order variants');

console.log('\nDomain hierarchy compaction\n---------------------------');
const sourceStats = new Map([
  ['one', { compacted: 0 }],
  ['two', { compacted: 0 }]
]);
const records = [
  { rule: FILTERS.parseLine('||ads.example.com^', 1).rule, isException: false, sourceId: 'one', sourcePriority: 10, sequence: 0 },
  { rule: FILTERS.parseLine('||example.com^', 2).rule, isException: false, sourceId: 'two', sourcePriority: 5, sequence: 1 },
  { rule: FILTERS.parseLine('||other.test^', 3).rule, isException: false, sourceId: 'one', sourcePriority: 10, sequence: 2 }
];
const compacted = FILTERS.compactDomainRecords(records, sourceStats);
check(compacted.length === 2, 'parent-domain block removes redundant child-domain block');
check(compacted.some(x => x.rule.condition.urlFilter === '||example.com^'), 'keeps the covering parent-domain rule');
check(sourceStats.get('one').compacted === 1, 'attributes compacted rule to its original source');

console.log('\nSource ownership and overlap guards\n-----------------------------------');
check(FILTERS.isManagedRuleId(FILTERS.RULE_ID_BASE), 'recognizes first owned dynamic rule ID');
check(FILTERS.isManagedRuleId(FILTERS.RULE_ID_BASE + FILTERS.MAX_DYNAMIC_RULES - 1), 'recognizes last owned dynamic rule ID');
check(!FILTERS.isManagedRuleId(FILTERS.RULE_ID_BASE - 1), 'does not claim foreign dynamic rule IDs below its range');
check(!FILTERS.isManagedRuleId(FILTERS.RULE_ID_BASE + FILTERS.MAX_DYNAMIC_RULES), 'does not claim foreign dynamic rule IDs above its range');

const easylist = FILTERS.SOURCES.find(s => s.id === 'easylist');
const easyprivacy = FILTERS.SOURCES.find(s => s.id === 'easyprivacy');
const arabic = FILTERS.SOURCES.find(s => s.id === 'arabic');
check(easylist && easylist.network === false && easylist.cosmetic === true && easylist.bundledRuleset === 'easylist', 'EasyList runtime use is cosmetic-only because network rules are bundled');
check(easyprivacy && easyprivacy.network === false && easyprivacy.bundledRuleset === 'easyprivacy', 'EasyPrivacy is not duplicated into dynamic network quota');
check(arabic && arabic.network === true && arabic.enabled === true, 'regional Arabic list remains a dynamic network source');
check(arabic && /Liste_AR\.txt$/.test(arabic.url) && !/filters\/25\.txt/.test(arabic.url), 'the Arabic source is Liste AR, not AdGuard Mail Tracking (filters/25.txt)');
const adguardBase = FILTERS.SOURCES.find(s => s.id === 'adguard-base');
check(adguardBase && adguardBase.enabled === true && adguardBase.network === false && adguardBase.cosmetic === true, 'AdGuard Base is a default cosmetic-only source');

console.log('\nSite-specific cosmetic parsing\n------------------------------');
const siteMap = new Map();
FILTERS.parseSiteCosmetic([
  'example.com##.sidebar-ad',
  'example.com,news.example.org##div[id^="ad-slot"]',
  'example.com#@#.ad-banner',
  'example.com##.bad { background: url(https://evil.test/leak) }',
  'example.com##div:has-text(Sponsored)',
  'example.com#?#.procedural:has(> .x)',
  'example.com#$#.css-injection { display: none }',
  'example.com##+js(set-constant, x, 1)',
  '~example.net##.negated-only',
  'example.*##.entity-wildcard',
  'facebook.com##div[role="feed"]',
  'm.youtube.com##.yt-thing',
  '##.generic-rule-not-site-specific',
  '! comment##.not-a-rule'
].join('\n'), siteMap);
const ex = siteMap.get('example.com');
check(ex && ex.h.has('.sidebar-ad') && ex.h.has('div[id^="ad-slot"]'), 'collects hiding rules per domain');
check(siteMap.get('news.example.org') && siteMap.get('news.example.org').h.has('div[id^="ad-slot"]'), 'a rule listing several domains is stored under each');
check(ex && ex.u.has('.ad-banner'), 'collects "#@#" exceptions separately');
check(ex && ![...ex.h].some(s => s.includes('{')), 'rejects a selector containing braces (CSS injection)');
check(ex && ![...ex.h].some(s => /has-text|procedural|css-injection|\+js/.test(s)), 'skips extended, procedural, CSS-injection and scriptlet syntax');
check(!siteMap.has('example.net') && !siteMap.has('~example.net') && ![...siteMap.keys()].some(k => k.includes('*')), 'skips negated and wildcard domain lists instead of approximating them');
check(!siteMap.has('facebook.com') && !siteMap.has('m.youtube.com'), 'leaves sites with dedicated modules (Facebook, YouTube, ...) to those modules');
check(![...siteMap.keys()].some(k => !k.includes('.')), 'never stores a generic rule as a site rule');
check(FILTERS.safeSelector('.ad') && !FILTERS.safeSelector('.a{}') && !FILTERS.safeSelector('.a/*x*/') && !FILTERS.safeSelector(''), 'safeSelector accepts plain selectors and rejects braces, comments and empty ones');
check(!FILTERS.safeSelector('div:not(.x') && !FILTERS.safeSelector('a[href="x') && !FILTERS.safeSelector('div[id^="ad"') && !FILTERS.safeSelector('.a)'), 'rejects unbalanced brackets and quotes, which would swallow every later CSS rule');
check(FILTERS.safeSelector('div:not(.x)') && FILTERS.safeSelector('a[href*="(ads)"]') && FILTERS.safeSelector('.a\\(b'), 'keeps balanced, quoted and escaped brackets');

console.log('\nSource payload validation\n-------------------------');
let valid = false;
try {
  valid = FILTERS.validateListText('! header\n||one.example^\n||two.example^\n||three.example^\n' + 'x'.repeat(200));
} catch (_) {}
check(valid === true, 'accepts plausible filter-list text');
let rejectedHtml = false;
try { FILTERS.validateListText('<!doctype html><html><body>404</body></html>' + 'x'.repeat(300)); }
catch (_) { rejectedHtml = true; }
check(rejectedHtml, 'rejects HTML error pages masquerading as filter lists');

console.log('\n' + '='.repeat(64));
console.log(`  Filter engine: ${passed} passed, ${failed} failed`);
console.log('='.repeat(64));
if (failed) process.exit(1);

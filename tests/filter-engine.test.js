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

console.log('\n' + '='.repeat(64));
console.log(`  Filter engine: ${passed} passed, ${failed} failed`);
console.log('='.repeat(64));
if (failed) process.exit(1);

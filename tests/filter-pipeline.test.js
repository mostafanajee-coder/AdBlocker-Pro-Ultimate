const { FILTERS } = require('../filters.js');

let passed = 0;
let failed = 0;
function check(cond, name) {
  if (cond) { passed++; console.log('  PASS ', name); }
  else { failed++; console.error('  FAIL ', name); }
}

function longEnough(lines) {
  return lines.join('\n') + '\n' + Array(20).fill('! filler metadata to make this a plausible upstream list').join('\n');
}

async function run() {
  console.log('\nFilter pipeline integration\n---------------------------');

  const storage = {
    filterLists: ['arabic', 'easylist', 'easyprivacy'],
    cosmeticCss: ['.old-cosmetic']
  };
  let dynamicRules = [
    { id: 42, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'foreign-rule' } },
    { id: FILTERS.RULE_ID_BASE, priority: 1, action: { type: 'block' }, condition: { urlFilter: 'old-owned-rule' } }
  ];
  let lastUpdate = null;
  const setCalls = [];
  storage['cf:stale.example'] = { h: ['.left-over'] }; // from an older build

  global.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (!keys) return { ...storage };
          const out = {};
          for (const k of keys) out[k] = storage[k];
          return out;
        },
        async set(obj) { setCalls.push(Object.keys(obj)); Object.assign(storage, obj); },
        async remove(keys) { for (const k of [].concat(keys)) delete storage[k]; }
      }
    },
    declarativeNetRequest: {
      async getDynamicRules() { return dynamicRules.map(r => JSON.parse(JSON.stringify(r))); },
      async updateDynamicRules(update) {
        lastUpdate = update;
        const remove = new Set(update.removeRuleIds || []);
        dynamicRules = dynamicRules.filter(r => !remove.has(r.id));
        if (update.addRules) dynamicRules.push(...update.addRules.map(r => JSON.parse(JSON.stringify(r))));
      }
    }
  };

  const originalFetch = FILTERS.fetchList;
  FILTERS.fetchList = async function (url) {
    if (url.includes('Liste_AR.txt')) {
      return longEnough([
        '! AdGuard Arabic mock',
        '||ads.example.com^',
        '||example.com^',
        '||semantic.test^$script,image',
        '||semantic.test^$image,script',
        '||unsafe.test^$removeparam=utm_source',
        '@@||allowed.test^',
        '##.arabic-ad',
        'ahram.org.eg##.ar-sidebar-ad'
      ]);
    }
    if (url.includes('easylist.txt')) {
      return longEnough([
        '! EasyList mock',
        '||must-not-enter-dynamic.test^',
        '##.easylist-ad',
        '##.shared-ad',
        'example.com##.site-ad',
        'example.com#@#.shared-ad',
        'facebook.com##div[role="feed"]'
      ]);
    }
    throw new Error('unexpected source ' + url);
  };

  const report = await FILTERS.rebuild();
  check(report.installOk === true, 'installs a complete compiled ruleset');
  check(lastUpdate && lastUpdate.removeRuleIds.length === 1 && lastUpdate.removeRuleIds[0] === FILTERS.RULE_ID_BASE, 'replaces only filter-engine-owned dynamic IDs');
  check(dynamicRules.some(r => r.id === 42), 'preserves foreign dynamic rules');
  check(!lastUpdate.addRules.some(r => r.condition.urlFilter === '||must-not-enter-dynamic.test^'), 'does not duplicate bundled EasyList network rules dynamically');
  check(lastUpdate.addRules.some(r => r.condition.urlFilter === '||example.com^'), 'keeps regional network rule');
  check(!lastUpdate.addRules.some(r => r.condition.urlFilter === '||ads.example.com^'), 'compacts redundant child-domain rule');
  check(lastUpdate.addRules[0].action.type === 'allow', 'orders exception rules before block rules');
  check(report.stats.semanticDuplicates >= 1, 'reports semantic duplicates after compilation');
  check(report.stats.compacted >= 1, 'reports hierarchical domain compaction');
  check(report.stats.unsupported >= 1, 'reports unsupported upstream syntax');
  check(report.stats.bundledNetworkSkipped === 2, 'reports bundled EasyList/EasyPrivacy network overlap skipped');
  check(storage.cosmeticCss.includes('.easylist-ad') && storage.cosmeticCss.includes('.arabic-ad'), 'keeps cosmetic coverage while skipping duplicated network coverage');
  check(report.sources.every(src => Object.prototype.hasOwnProperty.call(src, 'installed')), 'records installed-rule provenance per source');
  check(typeof storage.filterNetworkFingerprint === 'string' && storage.filterNetworkFingerprint.length > 8, 'stores a compiled-network fingerprint after a successful install');

  console.log('\nSite-specific cosmetics\n-----------------------');
  check(storage['cf:example.com'] && storage['cf:example.com'].h.includes('.site-ad'), 'stores site hiding rules under their domain key');
  check(storage['cf:example.com'] && storage['cf:example.com'].u.includes('.shared-ad'), 'stores site exceptions alongside them');
  check(storage['cf:ahram.org.eg'] && storage['cf:ahram.org.eg'].h.includes('.ar-sidebar-ad'), 'includes Arabic-site rules from Liste AR');
  check(!storage['cf:facebook.com'], 'stores nothing for sites with dedicated modules');
  check(!('cf:stale.example' in storage), 'removes entries for sites no longer in the lists');
  check(report.siteCosmetics && report.siteCosmetics.domains === 2, 'reports how many sites have hiding rules');
  const siteWritesFirst = setCalls.flat().filter(k => k.startsWith('cf:')).length;
  check(siteWritesFirst === 2, 'first build writes each site entry once');

  console.log('\nUnchanged-build short circuit\n-----------------------------');
  lastUpdate = null;
  const unchangedReport = await FILTERS.rebuild();
  check(unchangedReport.installOk === true && unchangedReport.networkChanged === false, 'detects when compiled network output is unchanged');
  check(lastUpdate === null, 'unchanged compiled output skips the DNR replacement operation');
  setCalls.length = 0;
  await FILTERS.rebuild();
  check(!setCalls.flat().some(k => k.startsWith('cf:')), 'an unchanged refresh rewrites no site entries (no storage.onChanged flood to open tabs)');

  console.log('\nPartial-refresh safety\n----------------------');
  lastUpdate = null;
  const snapshot = JSON.stringify(dynamicRules);
  FILTERS.fetchList = async function (url) {
    if (url.includes('Liste_AR.txt')) throw new Error('simulated outage');
    if (url.includes('easylist.txt')) return longEnough(['! list', '##.new-cosmetic', '||ignored.test^', '||x.test^']);
    throw new Error('unexpected source ' + url);
  };
  const failedReport = await FILTERS.rebuild();
  check(failedReport.installOk === false, 'network-source outage marks refresh as failed');
  check(lastUpdate === null, 'network-source outage does not install a partial replacement');
  check(JSON.stringify(dynamicRules) === snapshot, 'previous known-good dynamic rules remain unchanged on failed refresh');
  check(storage.cosmeticCss.includes('.easylist-ad'), 'failed refresh keeps previous cosmetic CSS');
  check(storage['cf:example.com'] && storage['cf:example.com'].h.includes('.site-ad'), 'failed refresh keeps previous site hiding rules');

  console.log('\nOwned-range clearing\n--------------------');
  lastUpdate = null;
  await FILTERS.clear();
  check(lastUpdate && lastUpdate.removeRuleIds.every(id => FILTERS.isManagedRuleId(id)), 'clear removes only rules owned by the filter engine');
  check(dynamicRules.some(r => r.id === 42), 'clear preserves foreign dynamic rules');
  check(!Object.keys(storage).some(k => k.startsWith('cf:')), 'clear removes site hiding entries too');

  FILTERS.fetchList = originalFetch;

  console.log('\n' + '='.repeat(64));
  console.log(`  Filter pipeline: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(64));
  if (failed) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

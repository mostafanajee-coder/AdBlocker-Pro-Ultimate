"use strict";
document.getElementById("run").addEventListener("click", async () => {
  const results = document.getElementById("results"), button = document.getElementById("run");
  button.disabled = true;
  let passed = 0;
  const wait = () => new Promise(resolve => setTimeout(resolve, 180));
  const check = (value, label) => {
    results.textContent += (value ? "PASS " : "FAIL ") + label + "\n";
    if (!value) throw new Error(label);
    passed++;
  };
  const ad = document.getElementById("ad"), label = ad.querySelector(".ad-label"), organic = document.getElementById("organic");
  const visible = node => getComputedStyle(node).display !== "none";
  try {
    results.textContent = "Running real-browser DOM tests…\n";
    await wait();
    check(!visible(ad) && visible(organic), "specific ad hides; normal content mentioning ads stays visible");
    check(ad.isConnected && ad.querySelector(".ad-label") === label, "original DOM nodes stay mounted");
    check(visible(document.getElementById("protected")), "main-content wrapper is protected");
    check(window.__engineFixtureFlag === false, "packaged constant hook applies to the approved fixture property");
    ad.removeAttribute("data-abp-procedural"); await wait();
    check(!visible(ad), "removing the hiding marker cannot leave a confirmed ad visible");
    [...document.querySelectorAll("style")].find(style => style.textContent.includes("[data-abp-procedural")).remove(); await wait();
    check(!visible(ad), "removing the engine stylesheet restores bounded ad hiding");
    label.textContent = "Normal content"; await wait();
    check(visible(ad), "recycled organic content is restored");
    label.textContent = "Sponsored"; await wait();
    check(!visible(ad), "delayed disclosure is detected through MutationObserver");
    window.fixtureUpdate({ [window.fixtureKey]: { p: [window.fixtureRule], pu: [window.fixtureRule], s: ["+js(set, __engineFixtureFlag, false)"] } }); await wait();
    check(visible(ad), "site exception releases an already hidden container");
    window.fixtureUpdate({ [window.fixtureKey]: { p: [".ad-label:has-text(Sponsored):upward(4)"] } }); await wait();
    check(visible(document.body) && visible(document.documentElement), "ancestor rules cannot blank body/html");
    window.fixtureUpdate({ [window.fixtureKey]: { p: [window.fixtureRule], s: ["+js(set, __engineFixtureFlag, false)"] } }); await wait();
    window.fixtureUpdate({ antiAdblock: false }); await wait();
    check(!visible(ad) && window.__engineFixtureFlag === true, "anti-adblock opt-out restores hooks without disabling cosmetic filtering");
    window.fixtureUpdate({ antiAdblock: true, whitelist: [location.hostname] }); await wait();
    check(visible(ad) && window.__engineFixtureFlag === true, "whitelist releases both cosmetic and scriptlet effects");
    window.fixtureUpdate({ whitelist: [] }); await wait();
    check(!visible(ad) && window.__engineFixtureFlag === false, "whitelist removal restores current filtering");
    window.fixtureUpdate({ useFilterLists: false }); await wait();
    check(visible(ad) && window.__engineFixtureFlag === true, "filter-list opt-out tears down advanced work");
    window.fixtureUpdate({ useFilterLists: true }); await wait();
    window.fixtureUpdate({ adBlock: false }); await wait();
    check(visible(ad) && visible(organic) && window.__engineFixtureFlag === true, "global opt-out restores original page behavior");
    check(!document.querySelector("[data-abp-procedural]"), "no procedural markers remain after teardown");
    results.textContent += `\nCOMPLETE: ${passed} passed, 0 failed\n`;
    document.title = `Engine fixture PASS ${passed}`;
  } catch (error) {
    results.textContent += "ERROR " + error.message + "\n";
    document.title = "Engine fixture FAILED";
  }
});

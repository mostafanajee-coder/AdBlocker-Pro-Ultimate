"use strict";
const igStore = { adBlock: true, igSponsored: true, whitelist: [] }, igReads = [], igListeners = [], igMessages = [];
let igHoldReads = true, igPauses = 0, igPlays = 0;
for (const video of document.querySelectorAll("video")) {
  video.pause = () => { igPauses++; };
  video.play = () => { igPlays++; return Promise.resolve(); };
}
window.chrome = { runtime: { sendMessage: async message => { igMessages.push(message); } }, storage: {
  local: { get: (_keys, callback) => { const snapshot = { ...igStore }; if (igHoldReads) igReads.push(() => callback(snapshot)); else setTimeout(() => callback(snapshot), 0); } },
  onChanged: { addListener: callback => igListeners.push(callback), removeListener: callback => { const at = igListeners.indexOf(callback); if (at >= 0) igListeners.splice(at, 1); } }
} };
function igUpdate(patch) {
  const changes = {}; for (const [key, value] of Object.entries(patch)) { igStore[key] = value; changes[key] = { newValue: value }; }
  for (const listener of [...igListeners]) listener(changes, "local");
}
document.getElementById("run").addEventListener("click", async event => {
  event.target.disabled = true;
  const output = document.getElementById("results"), reel = document.getElementById("reel"), video = document.getElementById("video"), badge = document.getElementById("badge"), permalink = document.getElementById("permalink");
  const covered = () => reel.getAttribute("data-abp-instagram-ad") === "1";
  const wait = () => new Promise(resolve => setTimeout(resolve, 180));
  let passed = 0;
  function check(ok, description) { output.textContent += (ok ? "PASS " : "FAIL ") + description + "\n"; if (!ok) throw new Error(description); passed++; }
  try {
    output.textContent = "Running…\n";
    const height = reel.getBoundingClientRect().height;
    check(!covered() && !video.muted, "nothing is hidden/muted before settings arrive");
    igHoldReads = false; igReads.splice(0).forEach(callback => callback()); await wait();
    check(covered() && reel.getAttribute("data-abp-instagram-mode") === "viewer", "div-based Reel is recognized");
    check(reel.getBoundingClientRect().height === height && video.isConnected, "viewer height and original video stay mounted");
    check(video.muted && igPauses === 0 && igPlays === 0, "ad is muted without pause/play calls");
    check(!document.getElementById("ordinary").hasAttribute("data-abp-instagram-ad"), "caption saying Sponsored remains organic");
    badge.firstChild.nodeValue = "Ad"; await wait(); check(covered(), "Instagram's standalone Ad disclosure is recognized");
    badge.firstChild.nodeValue = "Ordinary content"; permalink.href = "https://www.instagram.com/reel/TEST_B/"; await wait();
    check(!covered() && !video.muted, "text-node recycling restores content and original mute state");
    badge.firstChild.nodeValue = "إعلان"; await wait(); check(covered(), "late Arabic disclosure is detected");
    const before = igMessages.length; window.__abpInstagramAds__.scan(); await wait(); check(igMessages.length === before, "repeat scans do not inflate counts");
    badge.firstChild.nodeValue = "Regular content"; await wait(); badge.setAttribute("aria-label", "Sponsored"); await wait();
    check(covered(), "late ARIA-only disclosure is detected");
    igUpdate({ igSponsored: false }); await wait(); check(!covered() && !video.muted, "module opt-out releases existing effects");
    igUpdate({ igSponsored: true }); await wait(); igUpdate({ whitelist: [location.hostname] }); await wait();
    check(!covered() && !video.muted, "site whitelist releases the current Reel");
    igUpdate({ whitelist: [] }); await wait(); check(covered(), "removing whitelist rescans the current Reel");
    reel.removeAttribute("data-abp-instagram-ad"); await wait(); check(covered(), "removed ad marker is repaired");
    document.getElementById("abp-instagram-ad-css").remove(); await wait();
    check(covered() && document.querySelectorAll("#abp-instagram-ad-css").length === 1, "removed stylesheet is restored once");
    badge.removeAttribute("aria-label"); badge.firstChild.nodeValue = "Regular content"; await wait();
    const generic = document.createElement("button"); generic.setAttribute("aria-label", "Next"); generic.textContent = "Next";
    generic.style.cssText = "position:fixed;right:16px;bottom:16px"; let genericClicks = 0; generic.onclick = () => { genericClicks++; }; document.body.appendChild(generic);
    reel.scrollIntoView({ block: "center" }); badge.firstChild.nodeValue = "Sponsored"; await wait();
    check(genericClicks === 0, "generic Next is never clicked"); generic.remove();
    badge.firstChild.nodeValue = "Regular content"; await wait();
    const next = document.createElement("button"); next.setAttribute("aria-label", "Navigate to next Reel"); next.textContent = "Next reel";
    next.style.cssText = "position:fixed;right:16px;bottom:16px"; let nextClicks = 0;
    next.onclick = () => { nextClicks++; badge.firstChild.nodeValue = "Regular content"; permalink.href = "https://www.instagram.com/reel/TEST_NEXT/"; };
    document.body.appendChild(next); reel.scrollIntoView({ block: "center" }); badge.firstChild.nodeValue = "Sponsored"; await wait();
    check(nextClicks === 1 && !covered() && !video.muted, "explicit Next reel advances only the confirmed foreground ad and restores the next creative");
    window.__abpInstagramAds__.scan(); await wait(); check(nextClicks === 1, "organic content never causes another navigation"); next.remove();
    badge.firstChild.nodeValue = "Sponsored"; await wait(); igUpdate({ adBlock: false }); await wait();
    check(!covered() && !video.muted && igPauses === 0 && igPlays === 0, "global opt-out restores media without forced playback");
    window.__abpInstagramAds__.stop();
    check(!document.getElementById("abp-instagram-ad-css") && !reel.hasAttribute("data-abp-instagram-ad"), "teardown removes only owned effects");
    output.textContent += `\nCOMPLETE: ${passed} passed, 0 failed\n`; document.title = `Instagram fixture PASS ${passed}`;
  } catch (error) { output.textContent += "ERROR " + error.message; document.title = "Instagram fixture FAILED"; }
  output.scrollIntoView({ block: "start" });
});

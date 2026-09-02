(function () {
  'use strict';

  var currentHostname = "";
  var currentTabId = null;

  var TRANSLATIONS = {
    ar: {
      langBtn: "EN",
      protectionActive: "الحماية نشطة",
      protectionPaused: "الحماية معطلة",
      todayBlocked: "إعلانات اليوم",
      totalBlocked: "إجمالي المحجوب",
      elementZapper: "حجب عنصر",
      whitelistSite: "استثناء الموقع",
      removeWhitelist: "إلغاء الاستثناء",
      coreProtection: "الحماية الأساسية",
      adBlock: "حاجب الإعلانات",
      adBlockDesc: "حجب البانرات والنوافذ المنبثقة",
      strictTracking: "منع التتبع الصارم",
      strictTrackingDesc: "حظر نصوص التجسس وجمع البيانات",
      antiAdblock: "مكافحة كاشفات الحظر",
      antiAdblockDesc: "تجاوز رسائل عطل مانع الإعلانات",
      mouseUnlock: "فك قيود الفأرة والنسخ",
      mouseUnlockDesc: "تمكين التحديد والزر الأيمن للمواقع المقفلة",
      platformShields: "دروع المنصات الكبرى",
      ytSkip: "يوتيوب (YouTube)",
      ytSkipDesc: "تخطي الإعلانات الفوري وبدء التشغيل التلقائي",
      fbSponsored: "فيسبوك (Facebook)",
      fbSponsoredDesc: "حجب المنشورات الممولة والريلز بدون تقطيع",
      twitterBlock: "إكس / تويتر (X)",
      twitterBlockDesc: "حجب التغريدات والمنشورات الممولة (مُروّج)",
      whitelistManager: "إدارة المواقع المستثناة",
      manage: "إدارة",
      close: "إغلاق",
      add: "إضافة",
      communityFilters: "قواعد الحجب المدمجة",
      update: "تحديث",
      updating: "جاري التحميل...",
      builtStat: "300,000+ قاعدة شبكية مفعلة"
    },
    en: {
      langBtn: "عربي",
      protectionActive: "Shield Active",
      protectionPaused: "Shield Paused",
      todayBlocked: "Blocked Today",
      totalBlocked: "Total Blocked",
      elementZapper: "Element Zapper",
      whitelistSite: "Whitelist Site",
      removeWhitelist: "Remove Whitelist",
      coreProtection: "Core Protection",
      adBlock: "Ad Blocker",
      adBlockDesc: "Block banners & intrusive popups",
      strictTracking: "Strict Tracking",
      strictTrackingDesc: "Block web trackers & spyware telemetry",
      antiAdblock: "Anti-Adblock Bypass",
      antiAdblockDesc: "Evade adblock detection prompts",
      mouseUnlock: "Mouse & Copy Unlock",
      mouseUnlockDesc: "Re-enable selection & right-click",
      platformShields: "Platform Shields",
      ytSkip: "YouTube",
      ytSkipDesc: "Instant skip & zero-pause kickstart",
      fbSponsored: "Facebook",
      fbSponsoredDesc: "Zero-overhead sponsored & reels filter",
      twitterBlock: "Twitter / X",
      twitterBlockDesc: "Slay promoted tweets & sponsored ads",
      whitelistManager: "Whitelist Manager",
      manage: "Manage",
      close: "Close",
      add: "Add",
      communityFilters: "Built-in DNR Rulesets",
      update: "Update",
      updating: "Updating...",
      builtStat: "300,000+ active network rules"
    }
  };

  var currentLang = "ar";

  function applyLanguage(lang) {
    currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = (lang === "ar") ? "rtl" : "ltr";

    var t = TRANSLATIONS[lang] || TRANSLATIONS.ar;
    document.getElementById("langBtn").textContent = t.langBtn;

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (t[key]) {
        el.textContent = t[key];
      }
    });

    chrome.storage.local.set({ userLang: lang });
  }

  function applyTheme(theme) {
    if (theme === "light") {
      document.documentElement.setAttribute("data-theme", "light");
      document.getElementById("themeBtn").textContent = "☀️";
    } else {
      document.documentElement.removeAttribute("data-theme");
      document.getElementById("themeBtn").textContent = "🌙";
    }
    chrome.storage.local.set({ userTheme: theme });
  }

  function getCurrentTab(cb) {
    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs && tabs[0]) cb(tabs[0]);
    });
  }

  function isDomainWhitelisted(hostname, whitelist) {
    if (!hostname || !whitelist) return false;
    var parts = hostname.split(".");
    for (var i = 0; i < parts.length - 1; i++) {
      var domain = parts.slice(i).join(".");
      if (whitelist.indexOf(domain) !== -1) return true;
    }
    return false;
  }

  function renderWhitelistItems(whitelist) {
    var listEl = document.getElementById("whitelistList");
    if (!listEl) return;
    listEl.innerHTML = "";

    if (!whitelist || whitelist.length === 0) {
      listEl.innerHTML = "<div style='font-size:11px;color:var(--text-muted);text-align:center;padding:6px;'>لا توجد مواقع مستثناة</div>";
      return;
    }

    whitelist.forEach(function (domain) {
      var item = document.createElement("div");
      item.className = "whitelist-item";
      item.innerHTML = "<span>" + domain + "</span><span class='remove-domain-btn' data-domain='" + domain + "'>✕</span>";
      listEl.appendChild(item);
    });

    listEl.querySelectorAll(".remove-domain-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var dom = this.getAttribute("data-domain");
        chrome.runtime.sendMessage({ type: "removeWhitelist", hostname: dom }, function (resp) {
          if (resp && resp.whitelist) {
            renderWhitelistItems(resp.whitelist);
            checkWhitelistStatus(resp.whitelist);
          }
        });
      });
    });
  }

  function checkWhitelistStatus(whitelist) {
    var isWl = isDomainWhitelisted(currentHostname, whitelist);
    var t = TRANSLATIONS[currentLang];
    var btnText = document.getElementById("whitelistBtnText");
    var toggleBtn = document.getElementById("whitelistToggleBtn");
    var statusTitle = document.getElementById("statusTitle");
    var pulseDot = document.getElementById("pulseDot");

    if (isWl) {
      btnText.textContent = t.removeWhitelist;
      toggleBtn.classList.add("active");
      statusTitle.textContent = t.protectionPaused;
      pulseDot.style.background = "var(--accent-red)";
      pulseDot.style.boxShadow = "0 0 10px var(--accent-red)";
    } else {
      btnText.textContent = t.whitelistSite;
      toggleBtn.classList.remove("active");
      statusTitle.textContent = t.protectionActive;
      pulseDot.style.background = "var(--accent-green)";
      pulseDot.style.boxShadow = "0 0 10px var(--accent-green)";
    }
  }

  function bindToggle(id, settingKey) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("change", function () {
      var update = {};
      update[settingKey] = this.checked;
      chrome.runtime.sendMessage({ type: "updateSettings", settings: update });
    });
  }

  function init() {
    // Theme & Language persistence
    chrome.storage.local.get(["userTheme", "userLang"], function (pref) {
      if (pref && pref.userTheme) {
        applyTheme(pref.userTheme);
      }
      if (pref && pref.userLang) {
        applyLanguage(pref.userLang);
      } else {
        applyLanguage("ar");
      }
    });

    // Theme toggle button
    document.getElementById("themeBtn").addEventListener("click", function () {
      var isLight = document.documentElement.getAttribute("data-theme") === "light";
      applyTheme(isLight ? "dark" : "light");
    });

    // Language toggle button
    document.getElementById("langBtn").addEventListener("click", function () {
      applyLanguage(currentLang === "ar" ? "en" : "ar");
    });

    // Element Zapper Button
    document.getElementById("zapperBtn").addEventListener("click", function () {
      if (!currentTabId) return;
      chrome.tabs.sendMessage(currentTabId, { type: "START_ELEMENT_ZAPPER" }, function () {
        window.close(); // Close popup so user can click element directly
      });
    });

    // Whitelist Drawer Toggle
    document.getElementById("manageWhitelistToggle").addEventListener("click", function () {
      var drawer = document.getElementById("whitelistDrawer");
      var isOpen = drawer.classList.contains("open");
      if (isOpen) {
        drawer.classList.remove("open");
        this.textContent = TRANSLATIONS[currentLang].manage;
      } else {
        drawer.classList.add("open");
        this.textContent = TRANSLATIONS[currentLang].close;
      }
    });

    // Add Domain Button
    document.getElementById("addDomainBtn").addEventListener("click", function () {
      var input = document.getElementById("newDomainInput");
      var domain = (input.value || "").trim().toLowerCase();
      if (!domain) return;
      chrome.runtime.sendMessage({ type: "addWhitelist", hostname: domain }, function (resp) {
        input.value = "";
        if (resp && resp.whitelist) {
          renderWhitelistItems(resp.whitelist);
          checkWhitelistStatus(resp.whitelist);
        }
      });
    });

    // Toggle Current Domain Whitelist
    document.getElementById("whitelistToggleBtn").addEventListener("click", function () {
      if (!currentHostname) return;
      chrome.runtime.sendMessage({ type: "toggleWhitelist", hostname: currentHostname }, function (resp) {
        if (resp && resp.whitelist) {
          renderWhitelistItems(resp.whitelist);
          checkWhitelistStatus(resp.whitelist);
        }
      });
    });

    // Rebuild community filters
    var rebuildBtn = document.getElementById("rebuildBtn");
    if (rebuildBtn) {
      rebuildBtn.addEventListener("click", function () {
        rebuildBtn.disabled = true;
        rebuildBtn.textContent = TRANSLATIONS[currentLang].updating;
        chrome.runtime.sendMessage({ type: "rebuildFilters" }, function (res) {
          rebuildBtn.disabled = false;
          rebuildBtn.textContent = TRANSLATIONS[currentLang].update;
          var el = document.getElementById("filterStat");
          if (res && res.ok) {
            el.textContent = (res.report && res.report.rules ? res.report.rules.toLocaleString() : "300,000+") + " قواعد مفعلة";
          }
        });
      });
    }

    // Bind settings toggles
    [
      "adBlock", "strictTracking", "antiAdblock", "mouseUnlock",
      "ytSkip", "fbSponsored", "twitterBlock", "useFilterLists"
    ].forEach(function (k) { bindToggle(k, k); });

    // Load active tab info
    getCurrentTab(function (tab) {
      if (!tab || !tab.url) return;
      currentTabId = tab.id;
      try {
        currentHostname = new URL(tab.url).hostname;
        document.getElementById("domainDisplay").textContent = currentHostname;
      } catch (_) {
        document.getElementById("domainDisplay").textContent = "Local / System";
      }

      chrome.runtime.sendMessage({ type: "getSettings" }, function (settings) {
        if (!settings) return;

        // Set switches
        [
          "adBlock", "strictTracking", "antiAdblock", "mouseUnlock",
          "ytSkip", "fbSponsored", "twitterBlock", "useFilterLists"
        ].forEach(function (k) {
          var box = document.getElementById(k);
          if (box) box.checked = settings[k] === true;
        });

        // Set counters
        document.getElementById("totalCount").textContent = (settings.totalBlocked || 0).toLocaleString();
        document.getElementById("todayCount").textContent = (settings.todayBlocked || 0).toLocaleString();

        // Whitelist rendering
        var wl = settings.whitelist || [];
        renderWhitelistItems(wl);
        checkWhitelistStatus(wl);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();

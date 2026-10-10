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
      whitelistSite: "استثناء الموقع",
      userRulesReset: "إلغاء العناصر المحجوبة في هذا الموقع",
      removeWhitelist: "إلغاء الاستثناء",
      coreProtection: "الحماية الأساسية",
      adBlock: "حاجب الإعلانات",
      adBlockDesc: "حجب البانرات والنوافذ المنبثقة",
      strictTracking: "منع التتبع الصارم",
      strictTrackingDesc: "حظر نصوص التجسس وجمع البيانات",
      antiAdblock: "مكافحة كاشفات الحظر",
      antiAdblockDesc: "وظائف مدمجة بحسب الموقع لتجاوز كشف الحظر",
      mouseUnlock: "فك قيود الفأرة والنسخ",
      mouseUnlockDesc: "تمكين التحديد والزر الأيمن للمواقع المقفلة",
      platformShields: "دروع المنصات الكبرى",
      ytSkip: "يوتيوب (YouTube)",
      ytSkipDesc: "حجب الإعلانات واستعادة التشغيل بعد تخطيها",
      fbSponsored: "فيسبوك (Facebook)",
      fbSponsoredDesc: "حجب المنشورات الممولة والريلز الممولة فقط",
      fbReels: "إخفاء الريلز بالكامل",
      fbReelsDesc: "يخفي كل الريلز — العضوية والممولة معًا، لمن لا يريد رؤية الريلز إطلاقًا",
      twitterBlock: "إكس / تويتر (X)",
      twitterBlockDesc: "حجب التغريدات والمنشورات الممولة (مُروّج)",
      igSponsored: "إنستغرام (Instagram)",
      igSponsoredDesc: "حجب المنشورات الممولة والقصص الإعلانية والريلز",
      whitelistManager: "إدارة المواقع المستثناة",
      manage: "إدارة",
      close: "إغلاق",
      add: "إضافة",
      communityFilters: "تحديثات قوائم المجتمع (DNR)",
      update: "تحديث",
      updating: "جاري التحديث...",
      rulesActive: "قاعدة ديناميكية مفعلة",
      builtStat: "القواعد الثابتة مدمجة؛ حدّث لبناء القواعد الديناميكية",
      autoRefresh: "تحديث تلقائي كل 48 ساعة",
      refreshPaused: "التحديث التلقائي معطل",
      lastUpdate: "آخر تحديث ناجح",
      refreshFailed: "تعذر اكتمال التحديث؛ بقيت الحماية المتاحة، وإعادة المحاولة خلال ساعة",
      proceduralRules: "قواعد إخفاء متقدمة في القاعدة",
      scriptletRules: "قواعد وظائف مكافحة الكشف (تتطلب تفعيل الخيار)",
      regexRules: "قواعد شبكة بتعبيرات منتظمة",
      regexRejected: "قواعد Regex مستبعدة لعدم دعم Chrome لها",
      whitelistTitle: "استثناء الموقع الحالي من الحجب"
    },
    en: {
      langBtn: "عربي",
      protectionActive: "Shield Active",
      protectionPaused: "Shield Paused",
      todayBlocked: "Blocked Today",
      totalBlocked: "Total Blocked",
      whitelistSite: "Whitelist Site",
      userRulesReset: "Undo blocked elements on this site",
      removeWhitelist: "Remove Whitelist",
      coreProtection: "Core Protection",
      adBlock: "Ad Blocker",
      adBlockDesc: "Block banners & intrusive popups",
      strictTracking: "Strict Tracking",
      strictTrackingDesc: "Block web trackers & spyware telemetry",
      antiAdblock: "Anti-Adblock Bypass",
      antiAdblockDesc: "Packaged site-specific anti-detection functions",
      mouseUnlock: "Mouse & Copy Unlock",
      mouseUnlockDesc: "Re-enable selection & right-click",
      platformShields: "Platform Shields",
      ytSkip: "YouTube",
      ytSkipDesc: "Blocks ads and restores playback after skips",
      fbSponsored: "Facebook",
      fbSponsoredDesc: "Blocks sponsored posts & sponsored Reels only",
      fbReels: "Hide all Reels",
      fbReelsDesc: "Hides every Reel — organic and sponsored alike, for anyone who wants Reels gone entirely",
      twitterBlock: "Twitter / X",
      twitterBlockDesc: "Slay promoted tweets & sponsored ads",
      igSponsored: "Instagram",
      igSponsoredDesc: "Filter sponsored posts, stories & reels",
      whitelistManager: "Whitelist Manager",
      manage: "Manage",
      close: "Close",
      add: "Add",
      communityFilters: "Community Filter Updates (DNR)",
      update: "Update",
      updating: "Updating...",
      rulesActive: "active dynamic rules",
      builtStat: "Bundled static rules active; update to build dynamic rules",
      autoRefresh: "Auto-update every 48 hours",
      refreshPaused: "Auto-update disabled",
      lastUpdate: "Last successful update",
      refreshFailed: "Update incomplete; available protection retained, retry within one hour",
      proceduralRules: "advanced hiding rules in database",
      scriptletRules: "anti-detection function rules (requires toggle)",
      regexRules: "regex network rules",
      regexRejected: "regex candidates omitted because Chrome does not support them",
      whitelistTitle: "Whitelist current site from blocking"
    }
  };

  var currentLang = "ar";
  var currentFilterSettings = null;

  function renderFilterStatus(settings) {
    currentFilterSettings = settings || {};
    var el = document.getElementById("filterStat");
    if (!el) return;
    var t = TRANSLATIONS[currentLang];
    var report = currentFilterSettings.filterReport;
    var automatic = currentFilterSettings.adBlock !== false && currentFilterSettings.useFilterLists !== false;
    el.textContent = (report && Number.isFinite(report.rules) ? report.rules.toLocaleString() + " " + t.rulesActive : t.builtStat) +
      " · " + (automatic ? t.autoRefresh : t.refreshPaused);
    var details = [automatic ? t.autoRefresh : t.refreshPaused];
    if (report && report.core && report.core.regex) details.push(report.core.regex.toLocaleString() + " " + t.regexRules);
    if (report && report.core && report.core.regexRejected && report.core.regexRejected.length) {
      details.push(report.core.regexRejected.length.toLocaleString() + " " + t.regexRejected);
    }
    if (report && report.siteCosmetics) {
      if (report.siteCosmetics.procedural) details.push(report.siteCosmetics.procedural.toLocaleString() + " " + t.proceduralRules);
      if (report.siteCosmetics.scriptlets) details.push(report.siteCosmetics.scriptlets.toLocaleString() + " " + t.scriptletRules);
    }
    if (currentFilterSettings.lastFilterRefresh) details.push(t.lastUpdate + ": " +
      new Date(currentFilterSettings.lastFilterRefresh).toLocaleString(currentLang === "ar" ? "ar-SA" : "en-US"));
    if (automatic && currentFilterSettings.lastFilterFailure) details.push(t.refreshFailed);
    el.title = details.join("\n");
  }

  function getBrowserLanguage() {
    var uiLang = "";
    try {
      if (typeof chrome !== "undefined" && chrome.i18n && typeof chrome.i18n.getUILanguage === "function") {
        uiLang = chrome.i18n.getUILanguage();
      }
    } catch (_) {}
    if (!uiLang && typeof navigator !== "undefined") {
      uiLang = navigator.language || (navigator.languages && navigator.languages[0]) || "";
    }
    uiLang = (uiLang || "").toLowerCase();
    return uiLang.startsWith("ar") ? "ar" : "en";
  }

  function applyLanguage(lang, save) {
    currentLang = lang;
    document.documentElement.lang = lang;
    document.documentElement.dir = (lang === "ar") ? "rtl" : "ltr";

    var t = TRANSLATIONS[lang] || TRANSLATIONS.en;
    var btn = document.getElementById("langBtn");
    if (btn) btn.textContent = t.langBtn;

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      if (t[key]) {
        el.textContent = t[key];
      }
    });

    var wlBtn = document.getElementById("whitelistToggleBtn");
    if (wlBtn) wlBtn.title = t.whitelistTitle;

    renderUserRulesButton();

    renderFilterStatus(currentFilterSettings);

    var input = document.getElementById("newDomainInput");
    if (input) {
      input.placeholder = (lang === "ar") ? "أدخل النطاق مثل: example.com" : "Enter domain e.g. example.com";
    }

    if (save) {
      chrome.storage.local.set({ userLang: lang, userLangCustom: true });
    }
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

  // Elements blocked with right-click are saved per exact hostname as
  // "cu:<host>" (see content.js). The button appears only when there are some.
  var userRuleCount = 0;

  function renderUserRulesButton() {
    var btn = document.getElementById("userRulesResetBtn");
    var label = document.getElementById("userRulesResetText");
    if (!btn || !label) return;
    btn.hidden = userRuleCount === 0;
    label.textContent = (TRANSLATIONS[currentLang] || TRANSLATIONS.en).userRulesReset + " (" + userRuleCount + ")";
  }

  function loadUserRuleCount() {
    if (!currentHostname) return;
    var key = "cu:" + currentHostname.toLowerCase();
    chrome.storage.local.get(key, function (res) {
      userRuleCount = (res && Array.isArray(res[key])) ? res[key].length : 0;
      renderUserRulesButton();
    });
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

    // Built with DOM APIs: the domain is text, never parsed as HTML.
    whitelist.forEach(function (domain) {
      var item = document.createElement("div");
      item.className = "whitelist-item";
      var name = document.createElement("span");
      name.textContent = domain;
      var remove = document.createElement("span");
      remove.className = "remove-domain-btn";
      remove.setAttribute("data-domain", domain);
      remove.textContent = "✕";
      item.appendChild(name);
      item.appendChild(remove);
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
      chrome.runtime.sendMessage({ type: "updateSettings", settings: update }, function (resp) {
        if (resp && resp.success && resp.settings) renderFilterStatus(resp.settings);
        if (resp && resp.success && ["adBlock", "useFilterLists", "strictTracking", "antiAdblock"].indexOf(settingKey) !== -1) {
          chrome.runtime.sendMessage({ type: "getSettings" }, function (latest) { if (latest) renderFilterStatus(latest); });
        }
        // MAIN-world script registration and broad blocker state only apply
        // cleanly to the current document after a reload. Other per-site
        // modules react live through chrome.storage.onChanged.
        if (resp && resp.success && currentTabId &&
            (settingKey === "adBlock" || settingKey === "antiAdblock" || settingKey === "fbSponsored" ||
             (settingKey === "ytSkip" && /(^|\.)(youtube\.com|youtube-nocookie\.com)$/i.test(currentHostname)))) {
          chrome.tabs.reload(currentTabId);
        }
      });
    });
  }

  function init() {
    // Theme & Language persistence
    chrome.storage.local.get(["userTheme", "userLang", "userLangCustom"], function (pref) {
      if (pref && pref.userTheme) {
        applyTheme(pref.userTheme);
      }
      if (pref && pref.userLangCustom && pref.userLang) {
        applyLanguage(pref.userLang, false);
      } else {
        applyLanguage(getBrowserLanguage(), false);
      }
    });

    // Theme toggle button
    document.getElementById("themeBtn").addEventListener("click", function () {
      var isLight = document.documentElement.getAttribute("data-theme") === "light";
      applyTheme(isLight ? "dark" : "light");
    });

    // Language toggle button
    document.getElementById("langBtn").addEventListener("click", function () {
      applyLanguage(currentLang === "ar" ? "en" : "ar", true);
    });

    document.getElementById("userRulesResetBtn").addEventListener("click", function () {
      if (!currentHostname) return;
      chrome.storage.local.remove("cu:" + currentHostname.toLowerCase(), function () {
        userRuleCount = 0;
        renderUserRulesButton();
        if (currentTabId) chrome.tabs.reload(currentTabId);
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
          if (currentTabId) chrome.tabs.reload(currentTabId);
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
          chrome.runtime.sendMessage({ type: "getSettings" }, function (settings) {
            if (settings) renderFilterStatus(settings);
            if (!res || !res.ok) {
              var el = document.getElementById("filterStat");
              if (el) el.textContent = TRANSLATIONS[currentLang].refreshFailed;
            }
          });
        });
      });
    }

    // Bind settings toggles
    [
      "adBlock", "strictTracking", "antiAdblock", "mouseUnlock",
      "ytSkip", "fbSponsored", "fbReels", "twitterBlock", "igSponsored", "useFilterLists"
    ].forEach(function (k) { bindToggle(k, k); });

    // Load active tab info
    getCurrentTab(function (tab) {
      if (!tab || !tab.url) return;
      currentTabId = tab.id;
      try {
        currentHostname = new URL(tab.url).hostname;
        loadUserRuleCount();
        document.getElementById("domainDisplay").textContent = currentHostname;
      } catch (_) {
        document.getElementById("domainDisplay").textContent = "Local / System";
      }

      chrome.runtime.sendMessage({ type: "getSettings" }, function (settings) {
        if (!settings) return;

        // Set switches
        [
          "adBlock", "strictTracking", "antiAdblock", "mouseUnlock",
          "ytSkip", "fbSponsored", "fbReels", "twitterBlock", "igSponsored", "useFilterLists"
        ].forEach(function (k) {
          var box = document.getElementById(k);
          if (box) box.checked = settings[k] === true;
        });

        // Set counters
        document.getElementById("totalCount").textContent = (settings.totalBlocked || 0).toLocaleString();
        document.getElementById("todayCount").textContent = (settings.todayBlocked || 0).toLocaleString();

        // Dynamic filter report (do not advertise a fictional hard-coded total).
        renderFilterStatus(settings);

        // Whitelist rendering
        var wl = settings.whitelist || [];
        renderWhitelistItems(wl);
        checkWhitelistStatus(wl);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();

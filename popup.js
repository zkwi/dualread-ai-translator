const statusEl = document.getElementById("status");
const statsEl = document.getElementById("stats");
const toggleBtn = document.getElementById("toggle");
const scanBtn = document.getElementById("scan");
const visibilityBtn = document.getElementById("visibility");
const clearBtn = document.getElementById("clear");
const optionsBtn = document.getElementById("options");
const quickOptionsBtn = document.getElementById("quickOptions");
const autoTranslateToggle = document.getElementById("autoTranslateToggle");
const configStatusEl = document.getElementById("configStatus");
const configNoticeEl = document.getElementById("configNotice");
const stateBadgeEl = document.getElementById("stateBadge");
const actionHintEl = document.getElementById("actionHint");
const languageSummaryEl = document.getElementById("languageSummary");
const scopeSummaryEl = document.getElementById("scopeSummary");
const displayModeButtons = Array.from(document.querySelectorAll("[data-display-mode]"));

let currentTab = null;
let active = false;
let translationVisible = true;
let latestStats = {};
let latestNotice = null;
let settings = null;
let busy = false;

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  if (!tab?.id) {
    setStatus("没有找到当前标签页。");
    toggleBtn.disabled = true;
    scanBtn.disabled = true;
    visibilityBtn.disabled = true;
    clearBtn.disabled = true;
    autoTranslateToggle.disabled = true;
    return;
  }

  await refreshSettings();
  await refreshStats();
  render();
}

toggleBtn.addEventListener("click", async () => {
  await runPopupAction("处理中...", async () => {
    const response = await chrome.runtime.sendMessage({
      action: "toggle_translation",
      tab: currentTab
    });

    if (!response.ok) {
      setStatus(response.error || "操作失败。");
      return;
    }

    active = response.active;
    latestNotice = null;
    render(response.content?.count);
    await refreshStats();
  });
});

scanBtn.addEventListener("click", async () => {
  await runPopupAction("正在扫描当前区域...", async () => {
    const response = await chrome.runtime.sendMessage({
      action: "scan_current_area",
      tab: currentTab
    });

    if (!response.ok) {
      setStatus(response.error || "扫描失败。");
      return;
    }

    active = true;
    translationVisible = true;
    latestNotice = null;
    render(response.content?.count);
    await refreshStats();
  });
});

visibilityBtn.addEventListener("click", async () => {
  const nextVisible = !translationVisible;
  await runPopupAction(nextVisible ? "正在显示译文..." : "正在隐藏译文...", async () => {
    const response = await chrome.runtime.sendMessage({
      action: "set_translation_visibility",
      tab: currentTab,
      visible: nextVisible
    });

    if (!response.ok) {
      setStatus(response.error || "切换显示失败。");
      return;
    }

    translationVisible = response.content?.visible !== false;
    render();
    await refreshStats();
  });
});

clearBtn.addEventListener("click", async () => {
  await runPopupAction("正在清除...", async () => {
    const response = await chrome.runtime.sendMessage({
      action: "clear_translation",
      tab: currentTab
    });

    if (!response.ok) {
      setStatus(response.error || "清除失败。");
      return;
    }

    active = false;
    translationVisible = true;
    latestNotice = null;
    render();
    await refreshStats();
  });
});

autoTranslateToggle.addEventListener("change", async () => {
  const enabled = autoTranslateToggle.checked;

  await runPopupAction(enabled ? "正在开启自动翻译..." : "正在关闭自动翻译...", async () => {
    await chrome.storage.local.set({ autoTranslate: enabled });
    settings = { ...(settings || {}), autoTranslate: enabled };
    renderConfigStatus();

    if (!enabled) {
      setStatus("自动翻译已关闭，当前已显示的译文不会被清除。");
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: "auto_translate_tab",
      tab: currentTab
    });

    if (!response.ok) {
      setStatus(response.error || "自动翻译启动失败。");
      return;
    }

    if (response.skipped || response.content?.skipped) {
      const reason = response.reason || response.content?.reason;
      latestNotice = reason ? { reason } : latestNotice;
    } else {
      active = !!response.active;
      latestNotice = null;
    }

    render(response.content?.count);
    await refreshStats();
  });
});

displayModeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const displayMode = button.dataset.displayMode || "bilingual";
    if (displayMode === getDisplayMode()) return;

    await runPopupAction("正在切换展示方式...", async () => {
      await chrome.storage.local.set({ displayMode });
      settings = { ...(settings || {}), displayMode };
      updateDisplayModeButtons();

      if (currentTab?.id) {
        const response = await chrome.runtime.sendMessage({
          action: "set_display_mode",
          tab: currentTab,
          displayMode
        });

        if (!response.ok) {
          setStatus(response.error || "展示方式已保存，但当前页面暂时无法立即应用。");
          return;
        }
      }

      setStatus(displayMode === "translation-first" ? "已切换为译文优先显示。" : "已切换为对照显示。");
      await refreshStats();
    });
  });
});

optionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

quickOptionsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

function render(count) {
  toggleBtn.textContent = active ? "停止翻译" : "开始翻译";
  visibilityBtn.textContent = translationVisible ? "隐藏译文" : "显示译文";
  renderConfigStatus();
  renderConfigSummary();
  updateDisplayModeButtons();
  updateButtonState();

  if (active) {
    setStatus(typeof count === "number" ? `已开启，发现 ${count} 个候选文本块。` : "已开启。");
    setActionHint("滚动页面时会继续补翻译；只想看原文时可点“隐藏译文”。");
    setStateBadge("翻译中", "active");
  } else if (latestNotice?.reason === "target-language") {
    setStatus("自动翻译已跳过：当前页面已是目标语言。");
    setActionHint("如果仍想强制翻译，可以点击“开始翻译”。");
    setStateBadge("已跳过", "warning");
  } else if (latestNotice?.reason === "unconfigured") {
    setStatus("自动翻译未启动：请先在设置页填写 API Key 和模型名称。");
    setActionHint("点击上方“设置”完成 API 配置后再翻译。");
    setStateBadge("未配置", "warning");
  } else {
    setStatus("默认保留原文，并在原文下方显示中文译文。");
    setActionHint("点“开始翻译”处理当前网页；只想补当前视野内内容可点“只翻译当前屏”。");
    setStateBadge("待机", "");
  }
}

async function refreshSettings() {
  settings = await chrome.runtime.sendMessage({ action: "get_settings" });
  autoTranslateToggle.checked = settings.autoTranslate === true;
  renderConfigStatus();
}

async function refreshStats() {
  const response = await chrome.runtime.sendMessage({
    action: "get_page_stats",
    tab: currentTab
  });

  active = !!response.active;
  translationVisible = response.stats?.translationVisible !== false;
  latestStats = response.stats || {};
  latestNotice = response.notice || null;
  renderStats(response.stats || {});
}

function renderConfigStatus() {
  const hasApiKey = String(settings?.apiKey || "").trim().length > 0;
  const hasModel = String(settings?.model || "").trim().length > 0;
  const autoText = settings?.autoTranslate === true ? "已开启" : "已关闭";
  const configText = hasApiKey && hasModel ? "API 已保存" : "API 未保存";
  configStatusEl.textContent = `${autoText} · ${configText}`;
  configNoticeEl.hidden = hasApiKey && hasModel;
}

function renderConfigSummary() {
  const source = normalizeLanguageLabel(settings?.sourceLanguage || "English");
  const target = normalizeLanguageLabel(settings?.targetLanguage || "简体中文");
  languageSummaryEl.textContent = `${source} -> ${target}`;
  scopeSummaryEl.textContent = settings?.viewportOnly === false ? "整页预算内" : "当前屏附近";
}

function getDisplayMode() {
  return settings?.displayMode === "translation-first" ? "translation-first" : "bilingual";
}

function updateDisplayModeButtons() {
  const displayMode = getDisplayMode();
  displayModeButtons.forEach((button) => {
    const selected = button.dataset.displayMode === displayMode;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function normalizeLanguageLabel(language) {
  const labels = {
    "Auto detect": "自动检测",
    English: "英语",
    "简体中文": "简体中文",
    "繁體中文": "繁体中文",
    Japanese: "日语",
    Korean: "韩语",
    Spanish: "西班牙语",
    French: "法语",
    German: "德语"
  };

  return labels[language] || language || "自动检测";
}

function setStateBadge(text, tone) {
  stateBadgeEl.textContent = text;
  stateBadgeEl.className = "badge";
  if (tone) {
    stateBadgeEl.classList.add(`is-${tone}`);
  }
}

function setActionHint(text) {
  actionHintEl.textContent = text;
}

async function runPopupAction(statusText, action) {
  if (busy) return;

  busy = true;
  setStatus(statusText);
  updateButtonState();

  try {
    await action();
  } finally {
    busy = false;
    updateButtonState();
  }
}

function renderStats(stats) {
  const items = [
    ["译文", stats.translated || 0],
    ["缓存", stats.cacheHits || 0],
    ["请求", stats.apiRequested || 0],
    ["跳过", stats.skippedBudget || 0],
    ["失败", stats.failed || 0]
  ];

  statsEl.innerHTML = items
    .map(([label, value]) => `<div class="stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join("");
}

function updateButtonState() {
  const hasTranslations = Number(latestStats.translated || 0) + Number(latestStats.failed || 0) > 0;
  toggleBtn.disabled = busy || !currentTab?.id;
  scanBtn.disabled = busy || !currentTab?.id;
  clearBtn.disabled = busy || !currentTab?.id || !hasTranslations;
  visibilityBtn.disabled = busy || !currentTab?.id || !hasTranslations;
  autoTranslateToggle.disabled = busy || !currentTab?.id;
  displayModeButtons.forEach((button) => {
    button.disabled = busy || !currentTab?.id;
  });
}

function setStatus(text) {
  statusEl.textContent = text;
}

const { i18n: t, applyI18n, setUiLanguage } = globalThis.LLMTranslatorShared;
applyI18n(document);

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
const thinkingSummaryEl = document.getElementById("thinkingSummary");
const displayModeButtons = Array.from(document.querySelectorAll("[data-display-mode]"));
const autoTranslateRow = autoTranslateToggle.closest(".switch-row");

let currentTab = null;
let active = false;
let translationVisible = true;
let latestStats = {};
let latestNotice = null;
let settings = null;
let busy = false;

init();

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTab = tab;

    if (!tab?.id) {
      setStatus(t("popupStatusNoTab", [], "没有找到当前标签页。"));
      setStateBadge(t("popupBadgeUnavailable", [], "不可用"), "warning");
      setActionHint(t("popupLoadFailedHint", [], "可以打开设置检查配置，或重新加载扩展后再试。"));
      disablePopupControls();
      return;
    }

    await refreshSettings();
    await refreshStats();
    render();
  } catch (error) {
    setStatus(formatPopupError(error));
    setStateBadge(t("popupBadgeUnavailable", [], "不可用"), "warning");
    setActionHint(t("popupLoadFailedHint", [], "可以打开设置检查配置，或重新加载扩展后再试。"));
    disablePopupControls();
  }
}

toggleBtn.addEventListener("click", async () => {
  await runPopupAction(t("popupStatusProcessing", [], "处理中..."), async () => {
    const response = await chrome.runtime.sendMessage({
      action: "toggle_translation",
      tab: currentTab
    });

    if (!response.ok) {
      setStatus(response.error || t("popupStatusActionFailed", [], "操作失败。"));
      return;
    }

    active = response.active;
    if (response.skipped || response.content?.skipped) {
      const reason = response.reason || response.content?.reason;
      latestNotice = reason ? { reason } : latestNotice;
    } else {
      latestNotice = null;
    }
    await refreshStats();
    render(response.content?.count);
  }, {
    button: toggleBtn,
    pendingText: active ? t("popupStopping", [], "停止中...") : t("popupStarting", [], "启动中..."),
    getFinalText: () => active ? t("popupStopTranslation", [], "停止翻译") : t("popupStartTranslation", [], "开始翻译")
  });
});

scanBtn.addEventListener("click", async () => {
  await runPopupAction(t("popupStatusScanningArea", [], "正在扫描当前区域..."), async () => {
    const response = await chrome.runtime.sendMessage({
      action: "scan_current_area",
      tab: currentTab
    });

    if (!response.ok) {
      setStatus(response.error || t("popupStatusScanFailed", [], "扫描失败。"));
      return;
    }

    active = response.active !== false && !response.skipped && !response.content?.skipped;
    translationVisible = true;
    if (response.skipped || response.content?.skipped) {
      const reason = response.reason || response.content?.reason;
      latestNotice = reason ? { reason } : latestNotice;
    } else {
      latestNotice = null;
    }
    await refreshStats();
    render(response.content?.count);
  }, {
    button: scanBtn,
    pendingText: t("popupScanning", [], "扫描中..."),
    getFinalText: () => t("popupTranslateCurrentScreen", [], "只翻译当前屏")
  });
});

visibilityBtn.addEventListener("click", async () => {
  const nextVisible = !translationVisible;
  await runPopupAction(nextVisible ? t("popupShowingTranslations", [], "正在显示译文...") : t("popupHidingTranslations", [], "正在隐藏译文..."), async () => {
    const response = await chrome.runtime.sendMessage({
      action: "set_translation_visibility",
      tab: currentTab,
      visible: nextVisible
    });

    if (!response.ok) {
      setStatus(response.error || t("popupStatusVisibilityFailed", [], "切换显示失败。"));
      return;
    }

    translationVisible = response.content?.visible !== false;
    await refreshStats();
    render();
  }, {
    button: visibilityBtn,
    pendingText: nextVisible ? t("popupShowing", [], "显示中...") : t("popupHiding", [], "隐藏中..."),
    getFinalText: () => translationVisible ? t("popupHideTranslations", [], "隐藏译文") : t("popupShowTranslations", [], "显示译文")
  });
});

clearBtn.addEventListener("click", async () => {
  if (!window.confirm(t("popupConfirmClearTranslations", [], "清除当前页面已显示的译文？本地缓存不会被清空。"))) return;

  await runPopupAction(t("popupClearing", [], "正在清除..."), async () => {
    const response = await chrome.runtime.sendMessage({
      action: "clear_translation",
      tab: currentTab
    });

    if (!response.ok) {
      setStatus(response.error || t("popupStatusClearFailed", [], "清除失败。"));
      return;
    }

    active = false;
    translationVisible = true;
    latestNotice = null;
    await refreshStats();
    render();
  }, {
    button: clearBtn,
    pendingText: t("popupClearingShort", [], "清除中..."),
    getFinalText: () => t("popupClearTranslations", [], "清除译文")
  });
});

autoTranslateToggle.addEventListener("change", async () => {
  const enabled = autoTranslateToggle.checked;

  await runPopupAction(enabled ? t("popupEnablingAuto", [], "正在开启自动翻译...") : t("popupDisablingAuto", [], "正在关闭自动翻译..."), async () => {
    await chrome.storage.local.set({ autoTranslate: enabled });
    settings = { ...(settings || {}), autoTranslate: enabled };
    renderConfigStatus();

    if (!enabled) {
      setStatus(t("popupAutoDisabledStatus", [], "自动翻译已关闭，当前已显示的译文不会被清除。"));
      return;
    }

    if (!isTranslatableTab()) {
      render();
      setStatus(t("popupAutoEnabledUnsupportedStatus", [], "自动翻译已开启；当前页面不支持翻译，打开普通外文网页后会自动生效。"));
      setActionHint(t("popupUnsupportedHint", [], "Chrome 设置页、扩展页和新标签页不能注入翻译脚本。"));
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: "auto_translate_tab",
      tab: currentTab
    });

    if (!response.ok) {
      setStatus(response.error || t("popupAutoStartFailed", [], "自动翻译启动失败。"));
      return;
    }

    if (response.skipped || response.content?.skipped) {
      const reason = response.reason || response.content?.reason;
      active = false;
      latestNotice = reason ? { reason } : latestNotice;
    } else {
      active = !!response.active;
      latestNotice = null;
    }

    await refreshStats();
    render(response.content?.count);
  });
});

displayModeButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const displayMode = button.dataset.displayMode || "bilingual";
    if (displayMode === getDisplayMode()) return;

    await runPopupAction(t("popupSwitchingDisplayMode", [], "正在切换展示方式..."), async () => {
      await chrome.storage.local.set({ displayMode });
      settings = { ...(settings || {}), displayMode };
      updateDisplayModeButtons();

      if (currentTab?.id && isTranslatableTab()) {
        const response = await chrome.runtime.sendMessage({
          action: "set_display_mode",
          tab: currentTab,
          displayMode
        });

        if (!response.ok) {
          setStatus(response.error || t("popupDisplayModeSavedButNotApplied", [], "展示方式已保存，但当前页面暂时无法立即应用。"));
          return;
        }
      }

      if (isTranslatableTab()) {
        setStatus(displayMode === "translation-first"
          ? t("popupDisplayModeTranslationFirstStatus", [], "已切换为译文优先显示。")
          : t("popupDisplayModeBilingualStatus", [], "已切换为对照显示。"));
      } else {
        setStatus(t("popupDisplayModeSavedForNormalPages", [], "展示方式已保存，打开普通网页后生效。"));
      }
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
  toggleBtn.textContent = active ? t("popupStopTranslation", [], "停止翻译") : t("popupStartTranslation", [], "开始翻译");
  visibilityBtn.textContent = translationVisible ? t("popupHideTranslations", [], "隐藏译文") : t("popupShowTranslations", [], "显示译文");
  renderConfigStatus();
  renderConfigSummary();
  updateDisplayModeButtons();
  updateButtonState();

  if (!isTranslatableTab()) {
    setStatus(t("popupUnsupportedPageStatus", [], "当前页面不支持翻译：请打开普通网页（http/https）。"));
    setActionHint(hasRequiredConfig()
      ? t("popupUnsupportedConfiguredHint", [], "自动翻译和展示方式会作为全局设置保存，打开外文网页后生效。")
      : t("popupUnsupportedUnconfiguredHint", [], "先完成 API 配置，再打开普通外文网页使用。"));
    setStateBadge(t("popupBadgeUnavailable", [], "不可用"), "warning");
    return;
  }

  if (active) {
    setStatus(typeof count === "number"
      ? t("popupActiveWithCount", [String(count)], `已开启，发现 ${count} 个候选文本块。`)
      : t("popupActive", [], "已开启。"));
    setActionHint(t("popupActiveHint", [], "滚动页面时会继续补翻译；只想看原文时可点“隐藏译文”。"));
    setStateBadge(t("popupBadgeTranslating", [], "翻译中"), "active");
  } else if (!hasRequiredConfig()) {
    setStatus(t("popupUnconfiguredStatus", [], "还不能翻译：请先填写 API Key 和模型名称。"));
    setActionHint(t("popupUnconfiguredHint", [], "点击“去设置”完成连接配置，测试通过后再回到网页翻译。"));
    setStateBadge(t("popupBadgeUnconfigured", [], "未配置"), "warning");
  } else if (latestNotice?.reason === "target-language") {
    setStatus(t("popupSkippedTargetLanguageStatus", [], "已跳过：当前页面已是目标语言。"));
    setActionHint(t("popupSkippedTargetLanguageHint", [], "无需整页翻译；如需翻译少量外文，可选中文本后使用右键翻译。"));
    setStateBadge(t("popupBadgeSkipped", [], "已跳过"), "warning");
  } else if (latestNotice?.reason === "unconfigured") {
    setStatus(t("popupAutoUnconfiguredStatus", [], "自动翻译未启动：请先在设置页填写 API Key 和模型名称。"));
    setActionHint(t("popupAutoUnconfiguredHint", [], "点击上方“设置”完成 API 配置后再翻译。"));
    setStateBadge(t("popupBadgeUnconfigured", [], "未配置"), "warning");
  } else {
    setStatus(t("popupIdleStatus", [], "默认保留原文，并在原文下方显示译文。"));
    setActionHint(t("popupIdleHint", [], "点“开始翻译”处理当前网页；只想补当前视野内内容可点“只翻译当前屏”。"));
    setStateBadge(t("popupBadgeIdle", [], "待机"), "");
  }
}

async function refreshSettings() {
  settings = await chrome.runtime.sendMessage({ action: "get_settings" });
  await setUiLanguage(settings?.uiLanguage);
  applyI18n(document);
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
  const autoText = settings?.autoTranslate === true ? t("statusEnabled", [], "已开启") : t("statusDisabled", [], "已关闭");
  const configText = hasRequiredConfig() ? getConnectionSummary() : t("popupApiPending", [], "待配置 API");
  const statusText = t("summaryWithDot", [autoText, configText], `${autoText} · ${configText}`);
  configStatusEl.textContent = statusText;
  configStatusEl.title = statusText;
  configNoticeEl.hidden = hasRequiredConfig();
}

function renderConfigSummary() {
  const source = normalizeLanguageLabel(settings?.sourceLanguage || "English");
  const target = normalizeLanguageLabel(settings?.targetLanguage || "简体中文");
  languageSummaryEl.textContent = t("languageDirection", [source, target], `${source} -> ${target}`);
  scopeSummaryEl.textContent = settings?.viewportOnly === false ? t("scopeWholePageBudget", [], "整页预算内") : t("scopeCurrentViewport", [], "当前屏附近");
  thinkingSummaryEl.textContent = getThinkingSummary();
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
    "Auto detect": t("langAutoDetect", [], "自动检测"),
    English: t("langEnglish", [], "英语"),
    "简体中文": t("langSimplifiedChinese", [], "简体中文"),
    "繁體中文": t("langTraditionalChinese", [], "繁体中文"),
    Japanese: t("langJapanese", [], "日语"),
    Korean: t("langKorean", [], "韩语"),
    Spanish: t("langSpanish", [], "西班牙语"),
    French: t("langFrench", [], "法语"),
    German: t("langGerman", [], "德语")
  };

  return labels[language] || language || t("langAutoDetect", [], "自动检测");
}

function normalizeProviderLabel(provider) {
  const labels = {
    openai: "OpenAI",
    deepseek: "DeepSeek",
    dashscope: "DashScope",
    local: t("providerLocalShort", [], "本地服务"),
    custom: t("providerCustom", [], "自定义")
  };

  return labels[provider] || "API";
}

function getConnectionSummary() {
  const provider = normalizeProviderLabel(settings?.provider);
  const model = String(settings?.model || "").trim();
  if (!model) return provider;
  return `${provider} · ${compactText(model, 28)}`;
}

function getThinkingSummary() {
  if (settings?.disableThinking !== true) {
    return t("thinkingSummaryDisabled", [], "未关闭思考，可能变慢");
  }

  const selected = globalThis.LLMTranslatorShared.normalizeThinkingStrategy(settings?.thinkingStrategy);
  if (selected === globalThis.LLMTranslatorShared.THINKING_STRATEGIES.AUTO) {
    const detectionKey = globalThis.LLMTranslatorShared.createThinkingStrategyDetectionKey(settings || {});
    if (!detectionKey || settings?.thinkingStrategyDetectionKey !== detectionKey) {
      return t("thinkingSummaryPending", [], "自动：等待测试 API");
    }
  }
  const effective = globalThis.LLMTranslatorShared.getEffectiveThinkingStrategy(settings || {});
  const label = getThinkingStrategyShortLabel(effective);
  if (selected === globalThis.LLMTranslatorShared.THINKING_STRATEGIES.AUTO) {
    return t("thinkingSummaryAuto", [label], `自动：${label}`);
  }
  return label;
}

function getThinkingStrategyShortLabel(strategy) {
  const strategies = globalThis.LLMTranslatorShared.THINKING_STRATEGIES;
  const labels = {
    [strategies.DASHSCOPE_ENABLE_THINKING]: "enable_thinking=false",
    [strategies.THINKING_DISABLED]: "thinking.type=disabled",
    [strategies.OPENROUTER_REASONING_LOW]: "reasoning_effort=low",
    [strategies.OPENROUTER_REASONING_MINIMAL]: "reasoning=minimal",
    [strategies.QWEN_CHAT_TEMPLATE_KWARGS]: "Qwen template",
    [strategies.OMIT]: t("thinkingSummaryOmit", [], "不发送参数")
  };
  return labels[strategy] || labels[strategies.OMIT];
}

function compactText(value, maxLength) {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
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

function hasRequiredConfig() {
  return String(settings?.apiKey || "").trim().length > 0 && String(settings?.model || "").trim().length > 0;
}

function isTranslatableTab(tab = currentTab) {
  const url = String(tab?.url || tab?.pendingUrl || "");
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

async function runPopupAction(statusText, action, pendingControl = null) {
  if (busy) return;

  busy = true;
  if (pendingControl?.button && pendingControl.pendingText) {
    pendingControl.button.textContent = pendingControl.pendingText;
  }
  setStatus(statusText);
  updateButtonState();

  try {
    await action();
  } catch (error) {
    await recoverPopupState();
    setStatus(formatPopupError(error));
  } finally {
    busy = false;
    if (pendingControl?.button) {
      pendingControl.button.textContent = pendingControl.getFinalText?.() || pendingControl.button.textContent;
    }
    updateButtonState();
  }
}

async function recoverPopupState() {
  await refreshSettings().catch(() => {});
  await refreshStats().catch(() => {});
  render();
}

function formatPopupError(error) {
  const message = error?.message || String(error || "") || t("errorUnknown", [], "未知错误");
  const prefix = t("popupStatusActionFailed", [], "操作失败。");
  return `${prefix} ${message}`;
}

function renderStats(stats) {
  const items = [
    [t("statTranslated", [], "译文"), stats.translated || 0, t("statTranslatedTitle", [], "已插入到页面的译文数量")],
    [t("statCache", [], "缓存"), stats.cacheHits || 0, t("statCacheTitle", [], "直接从本地缓存读取的数量")],
    [t("statRequests", [], "请求"), stats.apiRequested || 0, t("statRequestsTitle", [], "本页实际请求 API 的段落数量")],
    [t("statSkipped", [], "跳过"), stats.skippedBudget || 0, t("statSkippedTitle", [], "因每页预算限制暂未翻译的数量")],
    [t("statFailed", [], "失败"), stats.failed || 0, t("statFailedTitle", [], "翻译失败，可在页面中点击重试")]
  ];

  statsEl.innerHTML = items
    .map(([label, value, title]) => (
      `<div class="stat" title="${escapeHtml(title)}" aria-label="${escapeHtml(t("statAria", [label, String(value), title], `${label}：${value}，${title}`))}">` +
      `<strong>${value}</strong><span>${label}</span></div>`
    ))
    .join("");
}

function updateButtonState() {
  const hasConfig = hasRequiredConfig();
  const hasTranslations = Number(latestStats.translated || 0) + Number(latestStats.failed || 0) > 0;
  const canTranslatePage = isTranslatableTab();
  toggleBtn.disabled = busy || !currentTab?.id || !canTranslatePage || (!active && !hasConfig);
  scanBtn.disabled = busy || !currentTab?.id || !canTranslatePage || !hasConfig;
  clearBtn.disabled = busy || !currentTab?.id || !canTranslatePage || !hasTranslations;
  visibilityBtn.disabled = busy || !currentTab?.id || !canTranslatePage || !hasTranslations;
  autoTranslateToggle.disabled = busy || !currentTab?.id || !hasConfig;
  autoTranslateRow?.classList.toggle("is-disabled", autoTranslateToggle.disabled);
  displayModeButtons.forEach((button) => {
    button.disabled = busy || !currentTab?.id;
  });

  const configTitle = hasConfig ? "" : t("tooltipNeedConfig", [], "请先在设置页填写 API Key 和模型名称。");
  const unsupportedTitle = t("tooltipUnsupportedPage", [], "当前页面不是普通网页，无法注入翻译脚本。");
  const noTranslationsTitle = t("tooltipNoTranslations", [], "当前页面还没有译文。");
  toggleBtn.title = !currentTab?.id
    ? t("tooltipCurrentPageUnavailable", [], "当前页面不可用。")
    : (!canTranslatePage
      ? unsupportedTitle
      : (toggleBtn.disabled && !active ? configTitle : (active ? t("tooltipStopTranslation", [], "停止继续翻译，已显示的译文会保留。") : t("tooltipStartTranslation", [], "翻译当前网页，滚动时会继续处理当前屏附近内容。"))));
  scanBtn.title = !currentTab?.id
    ? t("tooltipCurrentPageUnavailable", [], "当前页面不可用。")
    : (!canTranslatePage
      ? unsupportedTitle
      : (scanBtn.disabled ? configTitle : t("tooltipScanCurrentScreen", [], "只处理当前可视区域附近内容，适合控制 token 消耗。")));
  visibilityBtn.title = !currentTab?.id
    ? t("tooltipCurrentPageUnavailable", [], "当前页面不可用。")
    : (!canTranslatePage
      ? unsupportedTitle
      : (!hasTranslations ? noTranslationsTitle : (translationVisible ? t("tooltipHideTranslations", [], "临时隐藏页面上的译文，不会清除缓存。") : t("tooltipShowTranslations", [], "重新显示已隐藏的译文。"))));
  clearBtn.title = !currentTab?.id
    ? t("tooltipCurrentPageUnavailable", [], "当前页面不可用。")
    : (!canTranslatePage
      ? unsupportedTitle
      : (!hasTranslations ? noTranslationsTitle : t("tooltipClearTranslations", [], "移除当前页面已插入的译文，本地缓存不会被清空。")));
  autoTranslateToggle.title = autoTranslateToggle.disabled && !hasConfig
    ? configTitle
    : (!canTranslatePage ? t("tooltipAutoTranslateGlobalOnly", [], "会保存为全局设置，打开普通外文网页后生效。") : t("tooltipAutoTranslate", [], "保存为全局开关，打开外文网页时自动开始翻译。"));
}

function disablePopupControls() {
  toggleBtn.disabled = true;
  scanBtn.disabled = true;
  visibilityBtn.disabled = true;
  clearBtn.disabled = true;
  autoTranslateToggle.disabled = true;
  autoTranslateRow?.classList.add("is-disabled");
  displayModeButtons.forEach((button) => {
    button.disabled = true;
  });
}

function setStatus(text) {
  statusEl.textContent = text;
  statusEl.title = text && text.length > 80 ? text : "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

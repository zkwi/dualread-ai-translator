const DEFAULT_SETTINGS = globalThis.LLMTranslatorShared.DEFAULT_SETTINGS;
const DEFAULT_TRANSLATION_PROMPT = globalThis.LLMTranslatorShared.DEFAULT_TRANSLATION_PROMPT;
const LEGACY_DEFAULT_API_TIMEOUT_MS = globalThis.LLMTranslatorShared.LEGACY_DEFAULT_API_TIMEOUT_MS;
const THINKING_STRATEGIES = globalThis.LLMTranslatorShared.THINKING_STRATEGIES;
const { i18n: t, applyI18n, setUiLanguage } = globalThis.LLMTranslatorShared;
applyI18n(document);
const AUTO_SAVE_DELAY_MS = 700;
const PROVIDER_PRESETS = {
  openai: {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini"
  },
  deepseek: {
    apiUrl: globalThis.LLMTranslatorShared.DEEPSEEK_DEFAULT_API_URL,
    model: globalThis.LLMTranslatorShared.DEEPSEEK_DEFAULT_MODEL
  },
  dashscope: {
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus"
  },
  local: {
    apiUrl: "http://localhost:8000/v1/chat/completions",
    model: "Qwen/Qwen3-8B"
  }
};
const fields = {
  provider: document.getElementById("provider"),
  uiLanguage: document.getElementById("uiLanguage"),
  apiUrl: document.getElementById("apiUrl"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  sourceLanguage: document.getElementById("sourceLanguage"),
  targetLanguage: document.getElementById("targetLanguage"),
  translationPrompt: document.getElementById("translationPrompt"),
  maxConcurrentBatches: document.getElementById("maxConcurrentBatches"),
  disableThinking: document.getElementById("disableThinking"),
  thinkingStrategy: document.getElementById("thinkingStrategy"),
  autoTranslate: document.getElementById("autoTranslate"),
  displayMode: document.getElementById("displayMode")
};

const messageEl = document.getElementById("message");
const providerHintEl = document.getElementById("providerHint");
const thinkingHintEl = document.getElementById("thinkingHint");
const advancedSettingsEl = document.getElementById("advancedSettings");
const saveStateEl = document.getElementById("saveState");
const setupStatusEl = document.getElementById("setupStatus");
const languageStatusEl = document.getElementById("languageStatus");
const actionButtons = {
  test: document.getElementById("test"),
  clearCache: document.getElementById("clearCache"),
  reset: document.getElementById("reset"),
  resetPrompt: document.getElementById("resetPrompt"),
  toggleApiKey: document.getElementById("toggleApiKey")
};

let autoSaveTimer = null;
let optionActionRunning = false;
let hasLoadedSettings = false;
let apiTestPassed = false;
let apiTestError = "";
let apiTestRunning = false;
let detectedThinkingStrategy = "";
let thinkingStrategyDetectionKey = "";

loadSettings().catch(handleLoadSettingsError);
setupAutoSave();
setupExitSave();
setupConnectionShortcuts();

actionButtons.test.addEventListener("click", testApi);
actionButtons.clearCache.addEventListener("click", clearCache);
actionButtons.reset.addEventListener("click", async () => {
  if (!confirmDestructiveAction(t("confirmResetAll", [], "恢复全部默认设置会覆盖当前所有设置，API Key 也会被清空。确定继续吗？"))) return;

  clearPendingAutoSave();
  await runOptionAction(async () => {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
    await applyUiLanguage(DEFAULT_SETTINGS.uiLanguage);
    fillForm(DEFAULT_SETTINGS);
    showMessage(t("messageResetAllDone", [], "已恢复全部默认设置。"));
  });
});
actionButtons.resetPrompt.addEventListener("click", () => {
  if (fields.translationPrompt.value === DEFAULT_SETTINGS.translationPrompt) {
    showMessage(t("messagePromptAlreadyDefault", [], "提示词已经是默认值。"));
    return;
  }

  if (!confirmDestructiveAction(t("confirmResetPrompt", [], "恢复默认提示词会覆盖当前自定义提示词。确定继续吗？"))) return;

  fields.translationPrompt.value = DEFAULT_SETTINGS.translationPrompt;
  saveSettingsSoon();
  showMessage(t("messagePromptResetSaving", [], "已恢复默认提示词，正在自动保存..."), false, "saving");
});
actionButtons.toggleApiKey.addEventListener("click", () => {
  const shouldShow = fields.apiKey.type === "password";
  fields.apiKey.type = shouldShow ? "text" : "password";
  actionButtons.toggleApiKey.textContent = shouldShow ? t("hide", [], "隐藏") : t("show", [], "显示");
  actionButtons.toggleApiKey.setAttribute("aria-pressed", shouldShow ? "true" : "false");
  actionButtons.toggleApiKey.title = shouldShow ? t("hideApiKey", [], "隐藏 API Key") : t("showApiKey", [], "显示 API Key");
});
fields.provider.addEventListener("change", () => {
  markApiTestDirty();
  applyProviderPreset(fields.provider.value);
  revealCustomEndpoint(fields.provider.value);
  updateHelperText();
  saveSettingsSoon();
});

function setupConnectionShortcuts() {
  [fields.apiUrl, fields.apiKey, fields.model].forEach((field) => {
    field.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      if (optionActionRunning || getMissingConnectionFields().length > 0) return;

      event.preventDefault();
      testApi();
    });
  });
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const updates = {};
  if (isLegacyDefaultTranslationPrompt(settings.translationPrompt)) {
    settings.translationPrompt = DEFAULT_SETTINGS.translationPrompt;
    updates.translationPrompt = settings.translationPrompt;
  }
  if (LEGACY_DEFAULT_API_TIMEOUT_MS.includes(Number(settings.apiTimeoutMs))) {
    settings.apiTimeoutMs = DEFAULT_SETTINGS.apiTimeoutMs;
    updates.apiTimeoutMs = settings.apiTimeoutMs;
  }
  if (globalThis.LLMTranslatorShared.isLegacyDeepSeekPreset(settings)) {
    settings.apiUrl = globalThis.LLMTranslatorShared.DEEPSEEK_DEFAULT_API_URL;
    settings.model = globalThis.LLMTranslatorShared.DEEPSEEK_DEFAULT_MODEL;
    updates.apiUrl = settings.apiUrl;
    updates.model = settings.model;
  }
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  await applyUiLanguage(settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage);
  fillForm(settings);
  hasLoadedSettings = true;
}

function handleLoadSettingsError(error) {
  fillForm(DEFAULT_SETTINGS);
  hasLoadedSettings = true;
  const message = formatOptionError(error);
  showMessage(message, true);
  apiTestPassed = false;
  apiTestRunning = false;
  apiTestError = message;
  updateSetupStatus();
  updateActionAvailability();
}

function isLegacyDefaultTranslationPrompt(prompt) {
  return globalThis.LLMTranslatorShared?.isLegacyDefaultTranslationPrompt?.(prompt) === true;
}

function fillForm(settings) {
  detectedThinkingStrategy = settings.detectedThinkingStrategy || "";
  thinkingStrategyDetectionKey = settings.thinkingStrategyDetectionKey || "";
  fields.provider.value = settings.provider || inferProvider(settings.apiUrl);
  revealCustomEndpoint(fields.provider.value);
  setSelectValue(fields.uiLanguage, settings.uiLanguage || DEFAULT_SETTINGS.uiLanguage);
  fields.apiUrl.value = settings.apiUrl || DEFAULT_SETTINGS.apiUrl;
  fields.apiKey.value = settings.apiKey || "";
  fields.model.value = settings.model || DEFAULT_SETTINGS.model;
  setSelectValue(fields.sourceLanguage, settings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage);
  setSelectValue(fields.targetLanguage, settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage);
  fields.translationPrompt.value = settings.translationPrompt || DEFAULT_SETTINGS.translationPrompt;
  fields.maxConcurrentBatches.value = settings.maxConcurrentBatches || DEFAULT_SETTINGS.maxConcurrentBatches;
  fields.disableThinking.checked = settings.disableThinking === true;
  setSelectValue(fields.thinkingStrategy, settings.thinkingStrategy || DEFAULT_SETTINGS.thinkingStrategy);
  fields.autoTranslate.checked = settings.autoTranslate === true;
  setSelectValue(fields.displayMode, settings.displayMode || DEFAULT_SETTINGS.displayMode);
  updateApiKeyToggleText();
  updateLanguageStatus();
  updateHelperText();
  updateSetupStatus();
  updateActionAvailability();
}

function setupAutoSave() {
  for (const [name, field] of Object.entries(fields)) {
    if (field === fields.provider) continue;
    if (field.type === "checkbox") {
      field.addEventListener("change", async () => {
        if (isConnectionField(name)) markApiTestDirty();
        if (isUiLanguageField(name)) await applyUiLanguage(field.value);
        if (isLanguageField(name)) updateLanguageStatus();
        updateHelperText();
        updateSetupStatus();
        updateActionAvailability();
        saveSettingsSoon();
      });
    } else {
      field.addEventListener("input", () => {
        if (isConnectionField(name)) markApiTestDirty();
        if (isLanguageField(name)) updateLanguageStatus();
        updateHelperText();
        updateSetupStatus();
        updateActionAvailability();
        scheduleAutoSave();
      });
      field.addEventListener("change", async () => {
        if (isConnectionField(name)) markApiTestDirty();
        if (isUiLanguageField(name)) await applyUiLanguage(field.value);
        if (isLanguageField(name)) updateLanguageStatus();
        updateHelperText();
        updateSetupStatus();
        updateActionAvailability();
        saveSettingsSoon();
      });
    }
  }
}

function isConnectionField(name) {
  return name === "apiUrl" || name === "apiKey" || name === "model" || name === "disableThinking" || name === "thinkingStrategy";
}

function isLanguageField(name) {
  return name === "sourceLanguage" || name === "targetLanguage";
}

function isUiLanguageField(name) {
  return name === "uiLanguage";
}

function setupExitSave() {
  window.addEventListener("pagehide", saveSettingsBeforeExit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveSettingsBeforeExit();
    }
  });
}

function saveSettingsSoon() {
  if (!hasLoadedSettings) return;
  clearPendingAutoSave();
  autoSaveSettings();
}

function scheduleAutoSave() {
  if (!hasLoadedSettings) return;
  clearPendingAutoSave();
  showMessage(t("messageAutoSaving", [], "正在自动保存..."), false, "saving");
  autoSaveTimer = setTimeout(autoSaveSettings, AUTO_SAVE_DELAY_MS);
}

async function autoSaveSettings() {
  autoSaveTimer = null;

  if (optionActionRunning) {
    scheduleAutoSave();
    return;
  }

  const settings = readFormSettings();
  if (!settings.apiUrl || !settings.model) {
    showMessage(t("messageAutoSaveMissing", [], "API 地址和模型名称不能为空，暂未自动保存。"), true);
    return;
  }

  try {
    await chrome.storage.local.set(settings);
    showMessage(t("messageAutoSaved", [], "已自动保存。"));
  } catch (error) {
    showMessage(t("messageAutoSaveFailed", [error.message], `自动保存失败：${error.message}`), true);
  }
}

function saveSettingsBeforeExit() {
  if (!hasLoadedSettings || optionActionRunning) return;
  clearPendingAutoSave();

  const settings = readFormSettings();
  if (!settings.apiUrl || !settings.model) return;

  // 离开设置页时补一次写入，避免刚填完就切走导致自动保存来不及落盘。
  chrome.storage.local.set(settings).catch(() => {});
}

function clearPendingAutoSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

async function testApi() {
  const originalText = actionButtons.test.textContent;
  actionButtons.test.textContent = t("optionsTesting", [], "测试中...");

  try {
    await runOptionAction(async () => {
      const settings = readFormSettings();

      if (!settings.apiUrl || !settings.model || !settings.apiKey) {
        apiTestPassed = false;
        apiTestError = t("messageCompleteConnectionFirst", [], "请先填写 API 地址、API Key 和模型名称。");
        apiTestRunning = false;
        updateSetupStatus();
        showMessage(t("messageCompleteConnectionFirst", [], "请先填写 API 地址、API Key 和模型名称。"), true, "testing");
        return;
      }

      apiTestPassed = false;
      apiTestError = "";
      apiTestRunning = true;
      updateSetupStatus();
      showMessage(t("messageTestingApi", [], "正在测试 API..."), false, "testing");
      await chrome.storage.local.set(settings);

      const response = await chrome.runtime.sendMessage({
        action: "test_api",
        settings
      });

      if (!response.ok) {
        apiTestRunning = false;
        apiTestPassed = false;
        apiTestError = response.error || t("messageApiTestFailed", [], "API 测试失败。");
        updateSetupStatus();
        showMessage(apiTestError, true, "testing");
        return;
      }

      if (response.detectedThinkingStrategy && response.thinkingStrategyDetectionKey) {
        detectedThinkingStrategy = response.detectedThinkingStrategy;
        thinkingStrategyDetectionKey = response.thinkingStrategyDetectionKey;
        await chrome.storage.local.set({
          detectedThinkingStrategy,
          thinkingStrategyDetectionKey
        });
        updateHelperText();
      }

      apiTestRunning = false;
      apiTestPassed = true;
      apiTestError = "";
      updateSetupStatus();
      const compactText = compactStatusText(response.text || "");
      showMessage(response.fallback
        ? t("messageApiTestFallback", [compactText], `API 可用，但不支持流式输出，将使用非流式翻译。测试译文：${compactText}`)
        : t("messageApiTestSuccess", [compactText], `API 可用，测试译文：${compactText}`));
    });
  } finally {
    actionButtons.test.textContent = originalText || t("optionsTestApi", [], "测试 API");
  }
}

async function clearCache() {
  if (!confirmDestructiveAction(t("confirmClearCache", [], "确定清空本地翻译缓存吗？已保存的译文缓存会被删除。"))) return;

  await runOptionAction(async () => {
    const response = await chrome.runtime.sendMessage({ action: "clear_cache" });
    if (!response.ok) {
      showMessage(response.error || t("messageClearCacheFailed", [], "清空缓存失败。"), true);
      return;
    }

    showMessage(t("messageClearCacheDone", [String(response.count)], `已清空 ${response.count} 条缓存。`));
  });
}

function confirmDestructiveAction(message) {
  return window.confirm(message);
}

function readFormSettings() {
  const settings = {
    provider: fields.provider.value || DEFAULT_SETTINGS.provider,
    uiLanguage: fields.uiLanguage.value || DEFAULT_SETTINGS.uiLanguage,
    apiUrl: fields.apiUrl.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value.trim(),
    sourceLanguage: fields.sourceLanguage.value.trim() || DEFAULT_SETTINGS.sourceLanguage,
    targetLanguage: fields.targetLanguage.value.trim() || DEFAULT_SETTINGS.targetLanguage,
    translationPrompt: fields.translationPrompt.value.trim() || DEFAULT_SETTINGS.translationPrompt,
    maxConcurrentBatches: Math.max(1, Math.min(3, Number(fields.maxConcurrentBatches.value) || DEFAULT_SETTINGS.maxConcurrentBatches)),
    disableThinking: fields.disableThinking.checked,
    thinkingStrategy: globalThis.LLMTranslatorShared.normalizeThinkingStrategy(fields.thinkingStrategy.value),
    autoTranslate: fields.autoTranslate.checked,
    displayMode: fields.displayMode.value || DEFAULT_SETTINGS.displayMode
  };

  return settings;
}

function showMessage(text, isError = false, state = "") {
  messageEl.textContent = text;
  messageEl.title = text.length > 160 ? text : "";
  messageEl.classList.toggle("is-error", isError);
  updateSaveState(isError ? getErrorStateText(state) : getSaveStateText(text, state), isError ? "error" : state);
  updateActionAvailability();
}

function compactStatusText(value, maxLength = 120) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function updateSaveState(text, state = "") {
  if (!saveStateEl) return;
  saveStateEl.textContent = text;
  saveStateEl.className = "save-state";
  if (state) {
    saveStateEl.classList.add(`is-${state}`);
  }
}

function getSaveStateText(text, state) {
  if (state === "testing") return t("saveStateTesting", [], "测试中");
  if (state === "saving" || /正在|稍后/.test(text)) return t("saveStateSaving", [], "保存中");
  if (/清空/.test(text)) return t("saveStateMaintenance", [], "维护中");
  return t("saveStateSaved", [], "已保存");
}

function getErrorStateText(state) {
  if (state === "testing") return t("saveStateTestFailed", [], "测试失败");
  return t("saveStateSaveFailed", [], "保存失败");
}

function applyProviderPreset(provider) {
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) return;

  fields.apiUrl.value = preset.apiUrl;
  fields.model.value = preset.model;
  fields.disableThinking.checked = DEFAULT_SETTINGS.disableThinking === true;
  setSelectValue(fields.thinkingStrategy, DEFAULT_SETTINGS.thinkingStrategy);
  updateSetupStatus();
  updateActionAvailability();
}

function revealCustomEndpoint(provider) {
  if (provider === "custom" && advancedSettingsEl) {
    advancedSettingsEl.open = true;
  }
}

async function applyUiLanguage(uiLanguage) {
  await setUiLanguage(uiLanguage || DEFAULT_SETTINGS.uiLanguage);
  applyI18n(document);
  updateApiKeyToggleText();
}

function updateApiKeyToggleText() {
  const shouldShow = fields.apiKey.type === "password";
  actionButtons.toggleApiKey.textContent = shouldShow ? t("show", [], "显示") : t("hide", [], "隐藏");
  actionButtons.toggleApiKey.setAttribute("aria-pressed", shouldShow ? "false" : "true");
  actionButtons.toggleApiKey.title = shouldShow ? t("showApiKey", [], "显示 API Key") : t("hideApiKey", [], "隐藏 API Key");
}

function markApiTestDirty() {
  apiTestRunning = false;
  apiTestPassed = false;
  apiTestError = "";
  updateSetupStatus();
}

function updateSetupStatus() {
  if (!setupStatusEl) return;

  const missing = getMissingConnectionFields();
  setupStatusEl.className = "setup-status";

  if (missing.length > 0) {
    setupStatusEl.classList.add("is-incomplete");
    setupStatusEl.querySelector("strong").textContent = t("setupMissingTitle", [joinList(missing)], `还差 ${missing.join("、")}`);
    setupStatusEl.querySelector("span").textContent = t("setupMissingText", [], "补齐后会自动保存，然后点击“测试 API”。");
    return;
  }

  if (apiTestRunning) {
    setupStatusEl.classList.add("is-testing");
    setupStatusEl.querySelector("strong").textContent = t("setupTestingTitle", [], "正在测试 API");
    setupStatusEl.querySelector("span").textContent = t("setupTestingText", [], "正在向当前服务商发送测试请求，请稍候。");
    return;
  }

  if (apiTestPassed) {
    setupStatusEl.classList.add("is-success");
    setupStatusEl.querySelector("strong").textContent = t("setupSuccessTitle", [], "API 测试通过");
    setupStatusEl.querySelector("span").textContent = t("setupSuccessText", [], "可以回到网页，点击插件开始翻译。");
    return;
  }

  if (apiTestError) {
    setupStatusEl.classList.add("is-error");
    setupStatusEl.querySelector("strong").textContent = t("setupErrorTitle", [], "API 测试失败");
    setupStatusEl.querySelector("span").textContent = t("setupErrorText", [apiTestError], `${apiTestError} 修改连接信息后可重新测试。`);
    return;
  }

  setupStatusEl.classList.add("is-ready");
  setupStatusEl.querySelector("strong").textContent = t("setupReadyTitle", [], "配置看起来完整");
  setupStatusEl.querySelector("span").textContent = t("setupReadyText", [], "按 Enter 或点击“测试 API”，确认服务可用。");
}

function getMissingConnectionFields() {
  const missing = [];
  if (!String(fields.apiUrl.value || "").trim()) missing.push(t("fieldApiUrl", [], "API 地址"));
  if (!String(fields.apiKey.value || "").trim()) missing.push("API Key");
  if (!String(fields.model.value || "").trim()) missing.push(t("fieldModelName", [], "模型名称"));
  return missing;
}

function joinList(items) {
  return items.join(t("listSeparator", [], "、"));
}

function updateHelperText() {
  if (providerHintEl) {
    providerHintEl.textContent = getProviderHint(fields.provider.value);
  }
  if (thinkingHintEl) {
    updateThinkingControlAvailability();
    thinkingHintEl.textContent = getThinkingHint();
  }
}

function updateThinkingControlAvailability() {
  const label = fields.disableThinking.closest(".checkbox");
  const panel = fields.disableThinking.closest(".thinking-settings");
  const isActive = fields.disableThinking.checked;

  fields.disableThinking.disabled = false;
  fields.thinkingStrategy.disabled = !isActive;

  if (panel) {
    panel.classList.toggle("is-recommended", isActive);
    panel.classList.toggle("is-warning", !isActive);
  }

  if (label) {
    label.classList.toggle("is-disabled", false);
    label.title = "";
  }
}

function getProviderHint(provider) {
  const hints = {
    openai: t("providerHintOpenai", [], "使用 OpenAI 官方 Chat Completions 接口；Thinking 能力以测试 API 的结果为准。"),
    deepseek: t("providerHintDeepseek", [], "使用 DeepSeek 官方 OpenAI-compatible 接口；Thinking 能力以测试 API 的结果为准。"),
    dashscope: t("providerHintDashscope", [], "使用阿里云 DashScope 兼容模式；Thinking 能力以测试 API 的结果为准。"),
    local: t("providerHintLocal", [], "适合本机代理、vLLM、SGLang 等兼容服务；Thinking 能力以测试 API 的结果为准。"),
    custom: t("providerHintCustom", [], "用于自定义 OpenAI-compatible 服务；测试 API 时会探测可用的 Thinking 控制参数。")
  };
  return hints[provider] || hints.custom;
}

function getThinkingHint() {
  if (!fields.disableThinking.checked) {
    return t("thinkingHintDisabled", [], "不推荐：不会添加关闭思考参数，推理模型可能明显变慢。");
  }

  const selected = globalThis.LLMTranslatorShared.normalizeThinkingStrategy(fields.thinkingStrategy.value);
  const effective = getEffectiveThinkingStrategyFromForm();
  const hint = getThinkingStrategyHint(effective);
  if (selected === THINKING_STRATEGIES.AUTO) {
    const currentDetectionKey = globalThis.LLMTranslatorShared.createThinkingStrategyDetectionKey({
      apiUrl: fields.apiUrl.value,
      model: fields.model.value
    });
    if (!currentDetectionKey || currentDetectionKey !== thinkingStrategyDetectionKey) {
      return t("thinkingHintAutoPending", [], "自动模式会在测试 API 时探测可用参数；测试前不会添加额外思考参数。");
    }
    return t("thinkingHintAutoResolved", [hint], `推荐保持开启：${hint}`);
  }
  return hint;
}

function getThinkingStrategyHint(strategy) {
  const hints = {
    [THINKING_STRATEGIES.DASHSCOPE_ENABLE_THINKING]: t("thinkingHintDashscope", [], "请求体会加入 enable_thinking: false。"),
    [THINKING_STRATEGIES.THINKING_DISABLED]: t("thinkingHintDisabledObject", [], "请求体会加入 thinking: { type: \"disabled\" }。"),
    [THINKING_STRATEGIES.OPENROUTER_REASONING_LOW]: t("thinkingHintOpenRouterLow", [], "请求体会加入 reasoning_effort: \"low\"。"),
    [THINKING_STRATEGIES.OPENROUTER_REASONING_MINIMAL]: t("thinkingHintOpenRouterMinimal", [], "请求体会加入 reasoning: { effort: \"minimal\", exclude: true }。"),
    [THINKING_STRATEGIES.QWEN_CHAT_TEMPLATE_KWARGS]: t("thinkingHintSelfHosted", [], "请求体会加入 chat_template_kwargs.enable_thinking = false。"),
    [THINKING_STRATEGIES.OMIT]: t("thinkingHintNone", [], "不会添加额外思考参数。")
  };
  return hints[strategy] || hints[THINKING_STRATEGIES.OMIT];
}

function getEffectiveThinkingStrategyFromForm() {
  return globalThis.LLMTranslatorShared.getEffectiveThinkingStrategy({
    provider: fields.provider.value,
    apiUrl: fields.apiUrl.value,
    model: fields.model.value,
    thinkingStrategy: fields.thinkingStrategy.value,
    detectedThinkingStrategy,
    thinkingStrategyDetectionKey
  });
}

function setSelectValue(select, value) {
  const stringValue = String(value || "");
  if (!Array.from(select.options).some((option) => option.value === stringValue)) {
    const option = document.createElement("option");
    option.value = stringValue;
    option.textContent = stringValue;
    select.appendChild(option);
  }
  select.value = stringValue;
}

function updateLanguageStatus() {
  if (!languageStatusEl) return;

  const source = fields.sourceLanguage.value;
  const target = fields.targetLanguage.value;
  const sourceLabel = getLanguageLabel(source);
  const targetLabel = getLanguageLabel(target);
  const isSameLanguage = source && target && source === target;
  languageStatusEl.classList.toggle("is-warning", isSameLanguage);
  languageStatusEl.textContent = isSameLanguage
    ? t("languageStatusSame", [targetLabel], `源语言和目标语言都是 ${targetLabel}，通常不会产生有效翻译。`)
    : t("languageStatusDirection", [sourceLabel, targetLabel], `当前方向：${sourceLabel} -> ${targetLabel}。`);
}

function getLanguageLabel(language) {
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

function inferProvider(apiUrl) {
  const value = String(apiUrl || "").toLowerCase();
  if (value.includes("deepseek.com")) return "deepseek";
  if (value.includes("dashscope.aliyuncs.com")) return "dashscope";
  if (value.includes("localhost") || value.includes("127.0.0.1")) return "local";
  if (value.includes("api.openai.com")) return "openai";
  return "custom";
}

async function runOptionAction(action) {
  optionActionRunning = true;
  setActionButtonsDisabled(true);
  try {
    await action();
  } catch (error) {
    const wasApiTesting = apiTestRunning;
    const message = formatOptionError(error);
    apiTestRunning = false;
    apiTestPassed = false;
    if (wasApiTesting) {
      apiTestError = message;
    }
    showMessage(message, true, wasApiTesting ? "testing" : "");
    updateSetupStatus();
  } finally {
    optionActionRunning = false;
    setActionButtonsDisabled(false);
  }
}

function formatOptionError(error) {
  const message = error?.message || String(error || "") || t("errorUnknown", [], "未知错误");
  return t("messageActionFailed", [message], `操作失败：${message}`);
}

function setActionButtonsDisabled(disabled) {
  if (disabled) {
    Object.values(actionButtons).forEach((button) => {
      button.disabled = true;
    });
    return;
  }

  Object.values(actionButtons).forEach((button) => {
    button.disabled = false;
  });
  updateActionAvailability();
}

function updateActionAvailability() {
  if (!actionButtons.test) return;
  const missing = getMissingConnectionFields();
  const canTest = missing.length === 0 && !optionActionRunning;
  actionButtons.test.disabled = !canTest;
  actionButtons.test.title = canTest ? "" : t("testButtonMissingTitle", [joinList(missing) || t("fieldRequiredConfig", [], "必要配置")], `请先填写 ${missing.join("、") || "必要配置"}。`);
}

const DEFAULT_SETTINGS = globalThis.LLMTranslatorShared.DEFAULT_SETTINGS;
const DEFAULT_TRANSLATION_PROMPT = globalThis.LLMTranslatorShared.DEFAULT_TRANSLATION_PROMPT;
const LEGACY_DEFAULT_API_TIMEOUT_MS = globalThis.LLMTranslatorShared.LEGACY_DEFAULT_API_TIMEOUT_MS;
const { i18n: t, applyI18n } = globalThis.LLMTranslatorShared;
applyI18n(document);
const AUTO_SAVE_DELAY_MS = 700;
const MAX_API_TIMEOUT_SECONDS = 300;
const PROVIDER_PRESETS = {
  openai: {
    apiUrl: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
    thinkingControl: "none"
  },
  deepseek: {
    apiUrl: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
    thinkingControl: "none"
  },
  dashscope: {
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
    model: "qwen-plus",
    thinkingControl: "dashscope"
  },
  local: {
    apiUrl: "http://localhost:8000/v1/chat/completions",
    model: "Qwen/Qwen3-8B",
    thinkingControl: "self-hosted"
  }
};
const COST_PROFILES = globalThis.LLMTranslatorShared.COST_PROFILES;
const COST_PROFILE_FIELDS = new Set([
  "batchSize",
  "maxCharsPerBatch",
  "maxElementsPerScan",
  "maxTextLength",
  "maxRequestsPerPage",
  "maxCharsPerPage",
  "maxConcurrentBatches",
  "viewportOnly"
]);

const PROVIDER_HINTS = {
  openai: t("providerHintOpenai", [], "使用 OpenAI 官方 Chat Completions 接口，不添加非标准思考参数。"),
  deepseek: t("providerHintDeepseek", [], "使用 DeepSeek 官方 OpenAI-compatible 接口；DeepSeek 推理通常由模型名区分。"),
  dashscope: t("providerHintDashscope", [], "使用阿里云 DashScope 兼容模式；可通过 enable_thinking 关闭 Qwen 思考。"),
  local: t("providerHintLocal", [], "适合本机代理、vLLM、SGLang 等兼容服务；Qwen 模型可通过 chat_template_kwargs 关闭思考。"),
  custom: t("providerHintCustom", [], "用于自定义 OpenAI-compatible 服务；会根据 API 地址和模型名判断是否支持关闭思考。")
};

const THINKING_HINTS = {
  none: t("thinkingHintNone", [], "当前服务商不会添加额外思考参数。"),
  dashscope: t("thinkingHintDashscope", [], "开启后请求体会加入 enable_thinking: false。"),
  "self-hosted": t("thinkingHintSelfHosted", [], "开启后请求体会加入 chat_template_kwargs.enable_thinking = false。"),
  disabled: t("thinkingHintDisabled", [], "已关闭：请求体不会添加思考控制参数。")
};

const COST_PROFILE_HINTS = {
  economy: t("costHintEconomy", [], "省 Token 模式会少量预取，适合长页面、直播页或只想粗略阅读时使用。"),
  balanced: t("costHintBalanced", [], "平衡模式适合日常阅读：控制请求数量，同时会预取当前屏附近的正文。"),
  eager: t("costHintEager", [], "积极模式会多预取一些内容，阅读更连贯，但 token 消耗也会更高。"),
  custom: t("costHintCustom", [], "自定义模式会使用你在高级设置中填写的批量、长度和每页预算。")
};

const fields = {
  provider: document.getElementById("provider"),
  apiUrl: document.getElementById("apiUrl"),
  apiKey: document.getElementById("apiKey"),
  model: document.getElementById("model"),
  sourceLanguage: document.getElementById("sourceLanguage"),
  targetLanguage: document.getElementById("targetLanguage"),
  translationPrompt: document.getElementById("translationPrompt"),
  costProfile: document.getElementById("costProfile"),
  batchSize: document.getElementById("batchSize"),
  maxElementsPerScan: document.getElementById("maxElementsPerScan"),
  maxTextLength: document.getElementById("maxTextLength"),
  maxRequestsPerPage: document.getElementById("maxRequestsPerPage"),
  maxCharsPerPage: document.getElementById("maxCharsPerPage"),
  maxCharsPerBatch: document.getElementById("maxCharsPerBatch"),
  maxConcurrentBatches: document.getElementById("maxConcurrentBatches"),
  cacheTtlDays: document.getElementById("cacheTtlDays"),
  maxCacheEntries: document.getElementById("maxCacheEntries"),
  apiTimeoutMs: document.getElementById("apiTimeoutMs"),
  disableThinking: document.getElementById("disableThinking"),
  autoTranslate: document.getElementById("autoTranslate"),
  displayMode: document.getElementById("displayMode"),
  viewportOnly: document.getElementById("viewportOnly")
};

const messageEl = document.getElementById("message");
const providerHintEl = document.getElementById("providerHint");
const costProfileHintEl = document.getElementById("costProfileHint");
const thinkingHintEl = document.getElementById("thinkingHint");
const saveStateEl = document.getElementById("saveState");
const setupStatusEl = document.getElementById("setupStatus");
const languageStatusEl = document.getElementById("languageStatus");
const languagePresetButtons = Array.from(document.querySelectorAll("[data-language-preset]"));
const actionButtons = {
  save: document.getElementById("save"),
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

loadSettings();
setupAutoSave();
setupExitSave();
setupLanguagePresets();
setupConnectionShortcuts();

actionButtons.save.addEventListener("click", saveSettings);
actionButtons.test.addEventListener("click", testApi);
actionButtons.clearCache.addEventListener("click", clearCache);
actionButtons.reset.addEventListener("click", async () => {
  if (!confirmDestructiveAction(t("confirmResetAll", [], "恢复全部默认设置会覆盖当前所有设置，API Key 也会被清空。确定继续吗？"))) return;

  clearPendingAutoSave();
  await runOptionAction(async () => {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
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
  updateHelperText();
  saveSettingsSoon();
});
fields.costProfile.addEventListener("change", () => {
  applyCostProfile(fields.costProfile.value);
  updateHelperText();
  saveSettingsSoon();
});

function setupLanguagePresets() {
  languagePresetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setSelectValue(fields.sourceLanguage, button.dataset.source || DEFAULT_SETTINGS.sourceLanguage);
      setSelectValue(fields.targetLanguage, button.dataset.target || DEFAULT_SETTINGS.targetLanguage);
      updateLanguagePresetButtons();
      updateLanguageStatus();
      saveSettingsSoon();
    });
  });
}

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
  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
  fillForm(settings);
  hasLoadedSettings = true;
}

function isLegacyDefaultTranslationPrompt(prompt) {
  return globalThis.LLMTranslatorShared?.isLegacyDefaultTranslationPrompt?.(prompt) === true;
}

function fillForm(settings) {
  fields.provider.value = settings.provider || inferProvider(settings.apiUrl);
  fields.apiUrl.value = settings.apiUrl || DEFAULT_SETTINGS.apiUrl;
  fields.apiKey.value = settings.apiKey || "";
  fields.model.value = settings.model || DEFAULT_SETTINGS.model;
  setSelectValue(fields.sourceLanguage, settings.sourceLanguage || DEFAULT_SETTINGS.sourceLanguage);
  setSelectValue(fields.targetLanguage, settings.targetLanguage || DEFAULT_SETTINGS.targetLanguage);
  fields.translationPrompt.value = settings.translationPrompt || DEFAULT_SETTINGS.translationPrompt;
  fields.costProfile.value = settings.costProfile || inferCostProfile(settings);
  fields.batchSize.value = settings.batchSize || DEFAULT_SETTINGS.batchSize;
  fields.maxElementsPerScan.value = settings.maxElementsPerScan || DEFAULT_SETTINGS.maxElementsPerScan;
  fields.maxTextLength.value = settings.maxTextLength || DEFAULT_SETTINGS.maxTextLength;
  fields.maxRequestsPerPage.value = settings.maxRequestsPerPage || DEFAULT_SETTINGS.maxRequestsPerPage;
  fields.maxCharsPerPage.value = settings.maxCharsPerPage || DEFAULT_SETTINGS.maxCharsPerPage;
  fields.maxCharsPerBatch.value = settings.maxCharsPerBatch || DEFAULT_SETTINGS.maxCharsPerBatch;
  fields.maxConcurrentBatches.value = settings.maxConcurrentBatches || DEFAULT_SETTINGS.maxConcurrentBatches;
  fields.cacheTtlDays.value = settings.cacheTtlDays || DEFAULT_SETTINGS.cacheTtlDays;
  fields.maxCacheEntries.value = settings.maxCacheEntries || DEFAULT_SETTINGS.maxCacheEntries;
  fields.apiTimeoutMs.value = msToSeconds(settings.apiTimeoutMs || DEFAULT_SETTINGS.apiTimeoutMs);
  fields.disableThinking.checked = settings.disableThinking === true;
  fields.autoTranslate.checked = settings.autoTranslate === true;
  setSelectValue(fields.displayMode, settings.displayMode || DEFAULT_SETTINGS.displayMode);
  fields.viewportOnly.checked = settings.viewportOnly !== false;
  updateLanguagePresetButtons();
  updateLanguageStatus();
  updateHelperText();
  updateSetupStatus();
  updateActionAvailability();
}

async function saveSettings() {
  clearPendingAutoSave();
  await runOptionAction(async () => {
    const settings = readFormSettings();

    if (!settings.apiUrl || !settings.model) {
      showMessage(t("messageApiUrlModelRequired", [], "API 地址和模型名称不能为空。"), true);
      return;
    }

    await chrome.storage.local.set(settings);
    showMessage(t("messageSettingsSaved", [], "设置已保存。"));
  });
}

function setupAutoSave() {
  for (const [name, field] of Object.entries(fields)) {
    if (field === fields.provider || field === fields.costProfile) continue;
    const markCustomCostProfile = () => {
      if (COST_PROFILE_FIELDS.has(name)) {
        fields.costProfile.value = "custom";
      }
    };
    if (field.type === "checkbox") {
      field.addEventListener("change", () => {
        if (isConnectionField(name)) markApiTestDirty();
        markCustomCostProfile();
        if (isLanguageField(name)) updateLanguagePresetButtons();
        if (isLanguageField(name)) updateLanguageStatus();
        updateHelperText();
        updateSetupStatus();
        updateActionAvailability();
        saveSettingsSoon();
      });
    } else {
      field.addEventListener("input", () => {
        if (isConnectionField(name)) markApiTestDirty();
        markCustomCostProfile();
        if (isLanguageField(name)) updateLanguagePresetButtons();
        if (isLanguageField(name)) updateLanguageStatus();
        updateHelperText();
        updateSetupStatus();
        updateActionAvailability();
        scheduleAutoSave();
      });
      field.addEventListener("change", () => {
        if (isConnectionField(name)) markApiTestDirty();
        markCustomCostProfile();
        if (isLanguageField(name)) updateLanguagePresetButtons();
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
  return name === "apiUrl" || name === "apiKey" || name === "model";
}

function isLanguageField(name) {
  return name === "sourceLanguage" || name === "targetLanguage";
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

      apiTestRunning = false;
      apiTestPassed = true;
      apiTestError = "";
      updateSetupStatus();
      showMessage(t("messageApiTestSuccess", [response.text || ""], `API 可用，测试译文：${response.text}`));
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
    apiUrl: fields.apiUrl.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    model: fields.model.value.trim(),
    sourceLanguage: fields.sourceLanguage.value.trim() || DEFAULT_SETTINGS.sourceLanguage,
    targetLanguage: fields.targetLanguage.value.trim() || DEFAULT_SETTINGS.targetLanguage,
    translationPrompt: fields.translationPrompt.value.trim() || DEFAULT_SETTINGS.translationPrompt,
    costProfile: fields.costProfile.value || DEFAULT_SETTINGS.costProfile,
    batchSize: Math.max(1, Math.min(20, Number(fields.batchSize.value) || DEFAULT_SETTINGS.batchSize)),
    maxElementsPerScan: Math.max(1, Math.min(60, Number(fields.maxElementsPerScan.value) || DEFAULT_SETTINGS.maxElementsPerScan)),
    maxTextLength: Math.max(200, Math.min(4000, Number(fields.maxTextLength.value) || DEFAULT_SETTINGS.maxTextLength)),
    maxRequestsPerPage: Math.max(1, Math.min(300, Number(fields.maxRequestsPerPage.value) || DEFAULT_SETTINGS.maxRequestsPerPage)),
    maxCharsPerPage: Math.max(1000, Math.min(200000, Number(fields.maxCharsPerPage.value) || DEFAULT_SETTINGS.maxCharsPerPage)),
    maxCharsPerBatch: Math.max(500, Math.min(20000, Number(fields.maxCharsPerBatch.value) || DEFAULT_SETTINGS.maxCharsPerBatch)),
    maxConcurrentBatches: Math.max(1, Math.min(3, Number(fields.maxConcurrentBatches.value) || DEFAULT_SETTINGS.maxConcurrentBatches)),
    cacheTtlDays: Math.max(1, Math.min(365, Number(fields.cacheTtlDays.value) || DEFAULT_SETTINGS.cacheTtlDays)),
    maxCacheEntries: Math.max(100, Math.min(10000, Number(fields.maxCacheEntries.value) || DEFAULT_SETTINGS.maxCacheEntries)),
    apiTimeoutMs: secondsToMs(fields.apiTimeoutMs.value),
    disableThinking: fields.disableThinking.checked,
    autoTranslate: fields.autoTranslate.checked,
    displayMode: fields.displayMode.value || DEFAULT_SETTINGS.displayMode,
    viewportOnly: fields.viewportOnly.checked
  };

  return settings;
}

function showMessage(text, isError = false, state = "") {
  messageEl.textContent = text;
  messageEl.classList.toggle("is-error", isError);
  updateSaveState(isError ? getErrorStateText(state) : getSaveStateText(text, state), isError ? "error" : state);
  updateActionAvailability();
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
  fields.disableThinking.checked = preset.thinkingControl !== "none";
  updateSetupStatus();
  updateActionAvailability();
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

function applyCostProfile(profile) {
  const preset = COST_PROFILES[profile];
  if (!preset) return;

  fields.batchSize.value = preset.batchSize;
  fields.maxCharsPerBatch.value = preset.maxCharsPerBatch;
  fields.maxElementsPerScan.value = preset.maxElementsPerScan;
  fields.maxTextLength.value = preset.maxTextLength;
  fields.maxRequestsPerPage.value = preset.maxRequestsPerPage;
  fields.maxCharsPerPage.value = preset.maxCharsPerPage;
  fields.maxConcurrentBatches.value = preset.maxConcurrentBatches;
  fields.viewportOnly.checked = preset.viewportOnly;
}

function updateHelperText() {
  if (providerHintEl) {
    providerHintEl.textContent = PROVIDER_HINTS[fields.provider.value] || PROVIDER_HINTS.custom;
  }
  if (costProfileHintEl) {
    costProfileHintEl.textContent = COST_PROFILE_HINTS[fields.costProfile.value] || COST_PROFILE_HINTS.custom;
  }
  if (thinkingHintEl) {
    const control = getSelectedThinkingControl();
    thinkingHintEl.textContent = fields.disableThinking.checked
      ? THINKING_HINTS[control] || THINKING_HINTS.none
      : THINKING_HINTS.disabled;
  }
}

function getSelectedThinkingControl() {
  const provider = fields.provider.value;
  const preset = PROVIDER_PRESETS[provider];
  const apiUrl = String(fields.apiUrl.value || "").toLowerCase();
  if (apiUrl.includes("dashscope") || apiUrl.includes("aliyuncs.com")) return "dashscope";
  if (isLocalOrTemplateServer(apiUrl) && isQwenLikeModel(fields.model.value)) return "self-hosted";
  if (preset?.thinkingControl === "dashscope") return "dashscope";
  if (preset?.thinkingControl === "self-hosted" && isQwenLikeModel(fields.model.value)) return "self-hosted";
  if (preset?.thinkingControl === "none") return "none";

  return "none";
}

function isQwenLikeModel(model) {
  return String(model || "").toLowerCase().includes("qwen");
}

function isLocalOrTemplateServer(apiUrl) {
  return (
    apiUrl.includes("localhost") ||
    apiUrl.includes("127.0.0.1") ||
    apiUrl.includes("vllm") ||
    apiUrl.includes("sglang")
  );
}

function msToSeconds(value) {
  const ms = Number(value);
  const fallback = DEFAULT_SETTINGS.apiTimeoutMs / 1000;
  if (!Number.isFinite(ms) || ms <= 0) return fallback;
  return Math.max(1, Math.min(MAX_API_TIMEOUT_SECONDS, Math.round(ms / 1000)));
}

function secondsToMs(value) {
  const seconds = Math.max(1, Math.min(MAX_API_TIMEOUT_SECONDS, Number(value) || DEFAULT_SETTINGS.apiTimeoutMs / 1000));
  return Math.round(seconds) * 1000;
}

function inferCostProfile(settings) {
  for (const [name, preset] of Object.entries(COST_PROFILES)) {
    const matches = Object.entries(preset).every(([key, value]) => settings?.[key] === undefined || settings[key] === value);
    if (matches) return name;
  }
  return "custom";
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

function updateLanguagePresetButtons() {
  const source = fields.sourceLanguage.value;
  const target = fields.targetLanguage.value;
  languagePresetButtons.forEach((button) => {
    const selected = button.dataset.source === source && button.dataset.target === target;
    button.classList.toggle("is-selected", selected);
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
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
  } finally {
    optionActionRunning = false;
    setActionButtonsDisabled(false);
  }
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

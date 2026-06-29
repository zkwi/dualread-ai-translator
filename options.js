const DEFAULT_SETTINGS = globalThis.LLMTranslatorShared.DEFAULT_SETTINGS;
const DEFAULT_TRANSLATION_PROMPT = globalThis.LLMTranslatorShared.DEFAULT_TRANSLATION_PROMPT;
const LEGACY_DEFAULT_API_TIMEOUT_MS = globalThis.LLMTranslatorShared.LEGACY_DEFAULT_API_TIMEOUT_MS;
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
  openai: "使用 OpenAI 官方 Chat Completions 接口，不添加非标准思考参数。",
  deepseek: "使用 DeepSeek 官方 OpenAI-compatible 接口；DeepSeek 推理通常由模型名区分。",
  dashscope: "使用阿里云 DashScope 兼容模式；可通过 enable_thinking 关闭 Qwen 思考。",
  local: "适合本机代理、vLLM、SGLang 等兼容服务；Qwen 模型可通过 chat_template_kwargs 关闭思考。",
  custom: "用于自定义 OpenAI-compatible 服务；会根据 API 地址和模型名判断是否支持关闭思考。"
};

const THINKING_HINTS = {
  none: "当前服务商不会添加额外思考参数。",
  dashscope: "开启后请求体会加入 enable_thinking: false。",
  "self-hosted": "开启后请求体会加入 chat_template_kwargs.enable_thinking = false。",
  disabled: "已关闭：请求体不会添加思考控制参数。"
};

const COST_PROFILE_HINTS = {
  economy: "省 Token 模式会少量预取，适合长页面、直播页或只想粗略阅读时使用。",
  balanced: "平衡模式适合日常阅读：控制请求数量，同时会预取当前屏附近的正文。",
  eager: "积极模式会多预取一些内容，阅读更连贯，但 token 消耗也会更高。",
  custom: "自定义模式会使用你在高级设置中填写的批量、长度和每页预算。"
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

loadSettings();
setupAutoSave();
setupExitSave();
setupLanguagePresets();

actionButtons.save.addEventListener("click", saveSettings);
actionButtons.test.addEventListener("click", testApi);
actionButtons.clearCache.addEventListener("click", clearCache);
actionButtons.reset.addEventListener("click", async () => {
  if (!confirmDestructiveAction("恢复默认会覆盖当前所有设置，API Key 也会被清空。确定继续吗？")) return;

  clearPendingAutoSave();
  await runOptionAction(async () => {
    await chrome.storage.local.set(DEFAULT_SETTINGS);
    fillForm(DEFAULT_SETTINGS);
    showMessage("已恢复默认设置。");
  });
});
actionButtons.resetPrompt.addEventListener("click", () => {
  fields.translationPrompt.value = DEFAULT_SETTINGS.translationPrompt;
  saveSettingsSoon();
});
actionButtons.toggleApiKey.addEventListener("click", () => {
  const shouldShow = fields.apiKey.type === "password";
  fields.apiKey.type = shouldShow ? "text" : "password";
  actionButtons.toggleApiKey.textContent = shouldShow ? "隐藏" : "显示";
});
fields.provider.addEventListener("change", () => {
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
      saveSettingsSoon();
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
  updateHelperText();
}

async function saveSettings() {
  clearPendingAutoSave();
  await runOptionAction(async () => {
    const settings = readFormSettings();

    if (!settings.apiUrl || !settings.model) {
      showMessage("API 地址和模型名称不能为空。", true);
      return;
    }

    await chrome.storage.local.set(settings);
    showMessage("设置已保存。");
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
        markCustomCostProfile();
        updateHelperText();
        saveSettingsSoon();
      });
    } else {
      field.addEventListener("input", () => {
        markCustomCostProfile();
        updateHelperText();
        scheduleAutoSave();
      });
      field.addEventListener("change", () => {
        markCustomCostProfile();
        updateHelperText();
        saveSettingsSoon();
      });
    }
  }
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
  showMessage("正在自动保存...", false, "saving");
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
    showMessage("API 地址和模型名称不能为空，暂未自动保存。", true);
    return;
  }

  try {
    await chrome.storage.local.set(settings);
    showMessage("已自动保存。");
  } catch (error) {
    showMessage(`自动保存失败：${error.message}`, true);
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
  await runOptionAction(async () => {
    const settings = readFormSettings();

    if (!settings.apiUrl || !settings.model || !settings.apiKey) {
      showMessage("请先填写 API 地址、API Key 和模型名称。", true);
      return;
    }

    showMessage("正在测试 API...", false, "testing");
    await chrome.storage.local.set(settings);

    const response = await chrome.runtime.sendMessage({
      action: "test_api",
      settings
    });

    if (!response.ok) {
      showMessage(response.error || "API 测试失败。", true);
      return;
    }

    showMessage(`API 可用，测试译文：${response.text}`);
  });
}

async function clearCache() {
  if (!confirmDestructiveAction("确定清空本地翻译缓存吗？已保存的译文缓存会被删除。")) return;

  await runOptionAction(async () => {
    const response = await chrome.runtime.sendMessage({ action: "clear_cache" });
    if (!response.ok) {
      showMessage(response.error || "清空缓存失败。", true);
      return;
    }

    showMessage(`已清空 ${response.count} 条缓存。`);
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
  updateSaveState(isError ? "保存失败" : getSaveStateText(text, state), isError ? "error" : state);
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
  if (state === "testing") return "测试中";
  if (state === "saving" || /正在|稍后/.test(text)) return "保存中";
  if (/清空/.test(text)) return "维护中";
  return "已保存";
}

function applyProviderPreset(provider) {
  const preset = PROVIDER_PRESETS[provider];
  if (!preset) return;

  fields.apiUrl.value = preset.apiUrl;
  fields.model.value = preset.model;
  fields.disableThinking.checked = DEFAULT_SETTINGS.disableThinking || preset.thinkingControl !== "none";
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
    setActionButtonsDisabled(false);
    optionActionRunning = false;
  }
}

function setActionButtonsDisabled(disabled) {
  Object.values(actionButtons).forEach((button) => {
    button.disabled = disabled;
  });
}

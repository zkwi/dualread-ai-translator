importScripts("shared.js");

const { i18n: t } = LLMTranslatorShared;
const DEFAULT_SETTINGS = LLMTranslatorShared.DEFAULT_SETTINGS;
const LEGACY_DEFAULT_API_TIMEOUT_MS = LLMTranslatorShared.LEGACY_DEFAULT_API_TIMEOUT_MS;
const THINKING_STRATEGIES = LLMTranslatorShared.THINKING_STRATEGIES;
const CONTEXT_MENU_TRANSLATE_PAGE = "llm_translate_page";
const CONTEXT_MENU_TRANSLATE_SELECTION = "llm_translate_selection";
const CACHE_PRUNE_INTERVAL_MS = 30000;
const activeTabs = new Map();
const tabNotices = new Map();
const injectedTabs = new Set();
let lastCachePruneAt = 0;
let cachePrunePromise = null;
let contextMenuSetupPromise = Promise.resolve();
const unsupportedThinkingControlKeys = new Set();

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  const missing = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (existing[key] === undefined) {
      missing[key] = value;
    }
  }

  if (Object.keys(missing).length > 0) {
    await chrome.storage.local.set(missing);
  }

  await queueSetupContextMenus();
  await autoTranslateActiveTabs();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  return handleContextMenuClick(info, tab).catch((error) => {
    console.warn("Context menu translation failed:", error);
  });
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "toggle_translation") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    await toggleTranslation(tab);
  }
});

chrome.runtime.onStartup.addListener(() => {
  return autoTranslateActiveTabs().catch((error) => {
    console.warn("Startup auto translation failed:", error);
  });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get_settings") {
    getSettings().then(sendResponse);
    return true;
  }

  if (request.action === "toggle_translation") {
    toggleTranslation(request.tab)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === "clear_translation") {
    clearTranslation(request.tab)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === "scan_current_area") {
    scanCurrentArea(request.tab)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === "auto_translate_tab") {
    autoTranslateTab(request.tab)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === "set_translation_visibility") {
    setTranslationVisibility(request.tab, request.visible)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === "set_display_mode") {
    setDisplayMode(request.tab, request.displayMode)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === "get_page_stats") {
    getPageStats(request.tab)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message, active: false, stats: getEmptyStats() }));
    return true;
  }

  if (request.action === "mark_tab_active") {
    const tabId = sender?.tab?.id;
    if (typeof tabId === "number") {
      const active = request.active !== false;
      activeTabs.set(tabId, active);
      if (active) {
        tabNotices.delete(tabId);
      } else if (request.reason) {
        tabNotices.set(tabId, {
          type: "info",
          reason: request.reason
        });
      }
    }
    sendResponse({ ok: true, active: typeof tabId === "number" ? !!activeTabs.get(tabId) : false });
    return false;
  }

  if (request.action === "translate_batch") {
    translateBatch(request.items || [])
      .then(sendResponse)
      .catch((error) => {
        const items = request.items || [];
        sendResponse({
          ok: false,
          error: error.message,
          results: items.map((item) => ({ id: item.id, error: error.message }))
        });
      });
    return true;
  }

  if (request.action === "test_api") {
    testApi(request.settings)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === "clear_cache") {
    clearTranslationCache()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (request.action === "get_tab_state") {
    sendResponse({ ok: true, active: !!activeTabs.get(request.tabId) });
    return false;
  }

  return false;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  let contextMenuRefresh = Promise.resolve();
  if (Object.prototype.hasOwnProperty.call(changes, "uiLanguage")) {
    contextMenuRefresh = queueSetupContextMenus().catch((error) => {
      console.warn("Context menu language update failed:", error);
    });
  }
  if (!shouldRecheckAutoTranslate(changes)) return contextMenuRefresh;

  return Promise.all([
    contextMenuRefresh,
    getSettings()
    .then((settings) => {
      if (!settings.autoTranslate || !settings.apiKey || !settings.model) return [];
      return autoTranslateActiveTabs();
    })
    .catch((error) => {
      console.warn("Auto translation after settings change failed:", error);
    })
  ]);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
  tabNotices.delete(tabId);
  injectedTabs.delete(tabId);
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  return chrome.tabs.get(activeInfo.tabId)
    .then((tab) => autoTranslateTab(tab))
    .catch((error) => {
      console.warn("Auto translation on tab activation failed:", error);
    });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "loading") {
    activeTabs.delete(tabId);
    tabNotices.delete(tabId);
    injectedTabs.delete(tabId);
  }
});

async function getSettings() {
  const settings = await chrome.storage.local.get(DEFAULT_SETTINGS);
  const updates = {};
  if (LLMTranslatorShared.isLegacyDefaultTranslationPrompt(settings.translationPrompt)) {
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
  await LLMTranslatorShared.setUiLanguage(settings.uiLanguage);
  return settings;
}

function isInjectableTab(tab) {
  if (!tab?.id || !tab.url) return false;
  return tab.url.startsWith("http://") || tab.url.startsWith("https://");
}

function shouldRecheckAutoTranslate(changes) {
  const keys = [
    "autoTranslate",
    "apiKey",
    "provider",
    "apiUrl",
    "model",
    "disableThinking",
    "thinkingStrategy",
    "sourceLanguage",
    "targetLanguage",
    "translationPrompt",
    "viewportOnly",
    "maxElementsPerScan",
    "maxTextLength",
    "maxRequestsPerPage",
    "maxCharsPerPage",
    "maxCharsPerBatch",
    "maxConcurrentBatches"
  ];
  return keys.some((key) => Object.prototype.hasOwnProperty.call(changes, key));
}

async function ensureContentScript(tabId) {
  if (injectedTabs.has(tabId)) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["shared.js", "content.js"]
  });
  injectedTabs.add(tabId);
}

function queueSetupContextMenus() {
  contextMenuSetupPromise = contextMenuSetupPromise
    .catch(() => {})
    .then(setupContextMenus);
  return contextMenuSetupPromise;
}

async function setupContextMenus() {
  await getSettings();
  await removeAllContextMenus();
  await createContextMenu({
    id: CONTEXT_MENU_TRANSLATE_PAGE,
    title: t("contextTranslatePage", [], "翻译当前页面"),
    contexts: ["page"]
  });
  await createContextMenu({
    id: CONTEXT_MENU_TRANSLATE_SELECTION,
    title: t("contextTranslateSelection", [], "翻译选中文本"),
    contexts: ["selection"]
  });
}

function removeAllContextMenus() {
  return new Promise((resolve, reject) => {
    const done = onceCallback(resolve, reject);
    try {
      const result = chrome.contextMenus.removeAll(done);
      if (result && typeof result.then === "function") {
        result.then(() => done(), reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function createContextMenu(item) {
  return new Promise((resolve, reject) => {
    const done = onceCallback(resolve, reject);
    try {
      const result = chrome.contextMenus.create(item, done);
      if (result && typeof result.then === "function") {
        result.then(() => done(), reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function onceCallback(resolve, reject) {
  let settled = false;
  return () => {
    if (settled) return;
    settled = true;
    const error = chrome.runtime.lastError;
    if (error?.message) {
      reject(new Error(error.message));
      return;
    }
    resolve();
  };
}

async function handleContextMenuClick(info, tab) {
  if (info.menuItemId === CONTEXT_MENU_TRANSLATE_PAGE) {
    const response = await startTranslation(tab);
    if (!response.ok) {
      await showPageNotice(tab, response.error || t("errorTranslationStartFailed", [], "翻译启动失败。"), true);
    } else if (response.content?.skipped && response.content?.reason === "target-language") {
      await showPageNotice(tab, t("popupSkippedTargetLanguageStatus", [], "已跳过：当前页面已是目标语言。"));
    } else if (response.content?.message === "already active") {
      await showPageNotice(tab, t("noticeTranslationAlreadyActive", [], "翻译已开启。可滚动页面或点击插件里的“只翻译当前屏”。"));
    }
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_TRANSLATE_SELECTION) {
    await translateSelection(tab, info.selectionText || "");
  }
}

async function showPageNotice(tab, text, isError = false) {
  if (!isInjectableTab(tab)) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: renderPageNotice,
      args: [String(text || ""), !!isError]
    });
  } catch (error) {
    console.warn("Failed to show page notice:", error);
  }
}

function renderPageNotice(text, isError) {
  const existing = document.querySelector(".llm-bilingual-page-notice");
  if (existing) existing.remove();

  const notice = document.createElement("div");
  notice.className = `llm-bilingual-page-notice${isError ? " is-error" : ""}`;
  notice.textContent = text;
  notice.setAttribute("role", "status");
  notice.style.position = "fixed";
  notice.style.top = "16px";
  notice.style.right = "16px";
  notice.style.zIndex = "2147483647";
  notice.style.maxWidth = "min(420px, calc(100vw - 32px))";
  notice.style.padding = "12px 14px";
  notice.style.borderRadius = "8px";
  notice.style.boxShadow = "0 14px 32px rgba(15, 23, 42, 0.18)";
  notice.style.font = "15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  notice.style.whiteSpace = "normal";
  notice.style.wordBreak = "break-word";
  notice.style.color = isError ? "#991b1b" : "#1e3a8a";
  notice.style.background = isError ? "#fff1f2" : "#eff6ff";
  notice.style.border = `1px solid ${isError ? "#fecdd3" : "#bfdbfe"}`;
  notice.style.borderLeft = `4px solid ${isError ? "#ef4444" : "#2563eb"}`;

  document.documentElement.appendChild(notice);
  window.setTimeout(() => notice.remove(), 5000);
}

async function toggleTranslation(tab) {
  if (!isInjectableTab(tab)) {
    return { ok: false, error: t("errorUnsupportedTabTest", [], "当前页面不支持注入脚本，请换一个普通网页测试。") };
  }

  const pageState = await getPageStats(tab);
  const isActive = !!pageState.active;
  let settings = null;
  if (!isActive) {
    const configured = await ensureTranslationConfigured(tab);
    if (!configured.ok) return configured;
    settings = configured.settings;
  }

  await ensureContentScript(tab.id);

  const nextAction = isActive ? "stop_translation" : "start_translation";
  const message = isActive ? { action: nextAction } : { action: nextAction, settings };
  const response = await chrome.tabs.sendMessage(tab.id, message);
  if (!response?.ok) {
    activeTabs.set(tab.id, isActive);
    return createFailedContentActionResponse(response, isActive);
  }

  const active = isActive ? false : !response.skipped;
  activeTabs.set(tab.id, active);
  if (response?.skipped) {
    tabNotices.set(tab.id, {
      type: "info",
      reason: response.reason || "skipped"
    });
  } else {
    tabNotices.delete(tab.id);
  }
  return { ok: true, active, content: response };
}

async function startTranslation(tab, options = {}) {
  if (!isInjectableTab(tab)) {
    return { ok: false, error: t("errorUnsupportedTab", [], "当前页面不支持注入脚本。") };
  }

  if (!options.auto) {
    const configured = await ensureTranslationConfigured(tab);
    if (!configured.ok) return configured;
    options.settings = configured.settings;
  }

  await ensureContentScript(tab.id);
  const message = {
    action: "start_translation",
    ...(options.auto ? { auto: true } : {}),
    ...(options.settings ? { settings: options.settings } : {})
  };
  const response = await chrome.tabs.sendMessage(tab.id, message);
  if (!response?.ok) {
    activeTabs.set(tab.id, false);
    return createFailedContentActionResponse(response, false);
  }

  const active = !!response?.ok && !response.skipped;
  activeTabs.set(tab.id, active);
  if (response?.skipped) {
    tabNotices.set(tab.id, {
      type: "info",
      reason: response.reason || "skipped"
    });
  } else {
    tabNotices.delete(tab.id);
  }

  return { ok: true, active, content: response };
}

async function autoTranslateTab(tab) {
  if (!isInjectableTab(tab)) {
    return { ok: false, skipped: true, reason: "unsupported-tab" };
  }

  const settings = await getSettings();
  if (!settings.autoTranslate) {
    return { ok: true, skipped: true, reason: "disabled" };
  }

  if (!settings.apiKey || !settings.model) {
    tabNotices.set(tab.id, {
      type: "warning",
      reason: "unconfigured"
    });
    return { ok: true, skipped: true, reason: "unconfigured" };
  }

  return startTranslation(tab, { auto: true, settings });
}

async function ensureTranslationConfigured(tab) {
  const settings = await getSettings();

  try {
    validateSettings(settings);
  } catch (error) {
    if (tab?.id) {
      tabNotices.set(tab.id, {
        type: "warning",
        reason: "unconfigured"
      });
    }
    return { ok: false, error: error.message, active: false };
  }

  if (tab?.id) {
    tabNotices.delete(tab.id);
  }
  return { ok: true, settings };
}

async function autoTranslateActiveTabs() {
  const tabs = await chrome.tabs.query({ active: true });
  const results = [];

  for (const tab of tabs) {
    if (!isInjectableTab(tab)) continue;
    results.push(await autoTranslateTab(tab));
  }

  return results;
}

async function translateSelection(tab, selectionText) {
  if (!isInjectableTab(tab)) {
    return { ok: false, error: t("errorUnsupportedTab", [], "当前页面不支持注入脚本。") };
  }

  await ensureContentScript(tab.id);

  const settings = await getSettings();
  try {
    validateSettings(settings);
  } catch (error) {
    await chrome.tabs.sendMessage(tab.id, {
      action: "show_selection_translation",
      originalText: normalizeSelectionText(selectionText),
      error: error.message
    });
    return { ok: false, error: error.message };
  }

  const costSettings = LLMTranslatorShared.normalizeCostSettings(settings);
  const originalText = normalizeSelectionText(selectionText).slice(0, costSettings.maxTextLength);
  if (!originalText) {
    return { ok: false, error: t("errorNoSelectionText", [], "没有可翻译的选中文本。") };
  }

  if (LLMTranslatorShared.isLikelyTargetLanguageText(originalText, settings.targetLanguage)) {
    await chrome.tabs.sendMessage(tab.id, {
      action: "show_selection_translation",
      originalText,
      notice: t("noticeSelectionAlreadyTarget", [], "选中文本已是目标语言，无需翻译。")
    });
    return { ok: true, skipped: true, reason: "target-language" };
  }

  try {
    const response = await translateBatch([{ id: "selection", text: originalText }]);
    const result = response.results?.[0];
    await chrome.tabs.sendMessage(tab.id, {
      action: "show_selection_translation",
      originalText,
      translatedText: result?.text || "",
      error: result?.error || ""
    });
    return { ok: true };
  } catch (error) {
    await chrome.tabs.sendMessage(tab.id, {
      action: "show_selection_translation",
      originalText,
      error: error.message
    });
    return { ok: false, error: error.message };
  }
}

function normalizeSelectionText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

async function clearTranslation(tab) {
  if (!isInjectableTab(tab)) {
    return { ok: false, error: t("errorUnsupportedTab", [], "当前页面不支持注入脚本。") };
  }

  await ensureContentScript(tab.id);
  const wasActive = !!activeTabs.get(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, { action: "clear_translation" });
  if (!response?.ok) {
    return createFailedContentActionResponse(response, wasActive);
  }

  activeTabs.set(tab.id, false);
  tabNotices.delete(tab.id);
  return { ok: true, active: false, content: response };
}

async function scanCurrentArea(tab) {
  if (!isInjectableTab(tab)) {
    return { ok: false, error: t("errorUnsupportedTab", [], "当前页面不支持注入脚本。") };
  }

  const configured = await ensureTranslationConfigured(tab);
  if (!configured.ok) return configured;

  await ensureContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, {
    action: "scan_current_area",
    settings: configured.settings
  });
  if (!response?.ok) {
    return createFailedContentActionResponse(response, !!activeTabs.get(tab.id));
  }

  const active = !response?.skipped;
  activeTabs.set(tab.id, active);
  if (response?.skipped) {
    tabNotices.set(tab.id, {
      type: "info",
      reason: response.reason || "skipped"
    });
  } else {
    tabNotices.delete(tab.id);
  }

  return { ok: true, active, content: response };
}

function createFailedContentActionResponse(response, active = false) {
  return {
    ok: false,
    active,
    error: response?.error || t("contentNoOperationResult", [], "翻译操作没有返回结果。"),
    content: response || null
  };
}

async function setTranslationVisibility(tab, visible) {
  if (!isInjectableTab(tab)) {
    return { ok: false, error: t("errorUnsupportedTab", [], "当前页面不支持注入脚本。") };
  }

  await ensureContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, {
    action: "set_translation_visibility",
    visible
  });
  if (!response?.ok) {
    return createFailedContentActionResponse(response, !!activeTabs.get(tab.id));
  }

  return { ok: true, active: !!activeTabs.get(tab.id), content: response };
}

async function setDisplayMode(tab, displayMode) {
  if (!isInjectableTab(tab)) {
    return { ok: false, error: t("errorUnsupportedTab", [], "当前页面不支持注入脚本。") };
  }

  await ensureContentScript(tab.id);
  const response = await chrome.tabs.sendMessage(tab.id, {
    action: "set_display_mode",
    displayMode
  });
  if (!response?.ok) {
    return createFailedContentActionResponse(response, !!activeTabs.get(tab.id));
  }

  return { ok: true, active: !!activeTabs.get(tab.id), content: response };
}

async function getPageStats(tab) {
  if (!isInjectableTab(tab)) {
    return { ok: true, active: false, stats: getEmptyStats() };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: "get_page_stats" });
    activeTabs.set(tab.id, !!response?.active);
    return {
      ok: true,
      active: !!response?.active,
      stats: response?.stats || getEmptyStats(),
      notice: tabNotices.get(tab.id) || null
    };
  } catch (error) {
    activeTabs.set(tab.id, false);
    return { ok: true, active: false, stats: getEmptyStats(), notice: tabNotices.get(tab.id) || null };
  }
}

async function translateBatch(items) {
  if (!items.length) {
    return { ok: true, results: [], meta: { cacheHits: 0, requested: 0 } };
  }

  const settings = await getSettings();
  validateSettings(settings);

  // 按文本块内部换行拆分缓存，批量请求仍高效，重复段落也能单独命中缓存。
  const segmentPlan = createSegmentCachePlan(items);
  if (!segmentPlan.segments.length) {
    return {
      ok: true,
      results: items.map((item) => ({ id: item.id, error: t("errorNoTranslationResult", [], "没有获取到译文。") })),
      meta: { cacheHits: 0, requested: 0 }
    };
  }

  const cachedResults = await getCachedResults(settings, segmentPlan.segments);
  const missingSegments = segmentPlan.segments.filter((segment) => !cachedResults.has(segment.id));
  let freshResults = missingSegments.length > 0
    ? await requestTranslations(settings, missingSegments)
    : [];
  if (freshResults.some((result) => result?.error)) {
    freshResults = await retryMissingSegmentsOnce(settings, missingSegments, freshResults);
  }

  if (freshResults.length > 0) {
    try {
      await saveResultsToCache(settings, missingSegments, freshResults);
    } catch (error) {
      console.warn("Failed to save translation cache:", error);
    }
  }

  const segmentResults = new Map(cachedResults);
  for (const result of freshResults) {
    segmentResults.set(result.id, result);
  }

  const results = segmentPlan.parents.map((parent) => composeParentTranslation(parent, segmentResults));

  return {
    ok: true,
    results,
    meta: {
      cacheHits: cachedResults.size,
      requested: missingSegments.length
    }
  };
}

async function retryMissingSegmentsOnce(settings, segments, results) {
  const okIds = new Set(
    results.filter((result) => result?.text && !result.error).map((result) => String(result.id))
  );
  const failedSegments = segments.filter((segment) => !okIds.has(String(segment.id)));
  if (failedSegments.length === 0) return results;

  let retried = [];
  try {
    retried = await requestTranslations(settings, failedSegments);
  } catch (error) {
    return results;
  }

  const retriedById = new Map(
    retried
      .filter((result) => result?.text && !result.error)
      .map((result) => [String(result.id), result])
  );

  return results
    .filter((result) => okIds.has(String(result.id)) || !retriedById.has(String(result.id)))
    .concat(Array.from(retriedById.values()));
}

function createSegmentCachePlan(items) {
  const segments = [];
  const parents = items.map((item) => {
    const parts = splitItemIntoCacheParts(item);
    for (const part of parts) {
      if (part.type === "segment") {
        segments.push({
          id: part.id,
          parentId: item.id,
          text: part.text
        });
      }
    }
    return { id: item.id, parts };
  });

  return { parents, segments };
}

function splitItemIntoCacheParts(item) {
  const text = String(item?.text || "").replace(/\r\n?/g, "\n");
  const tokens = text.split(/(\n+)/);
  const parts = [];

  for (const token of tokens) {
    if (!token) continue;

    if (/^\n+$/.test(token)) {
      if (parts.length > 0) {
        parts.push({ type: "separator", text: token });
      }
      continue;
    }

    const segmentText = token.trim();
    if (!segmentText) continue;

    parts.push({
      type: "segment",
      id: "",
      text: segmentText
    });
  }

  const segmentCount = parts.filter((part) => part.type === "segment").length;
  let segmentIndex = 0;
  for (const part of parts) {
    if (part.type !== "segment") continue;
    part.id = segmentCount === 1 ? item.id : `${item.id}::segment-${segmentIndex}`;
    segmentIndex += 1;
  }

  return parts;
}

function composeParentTranslation(parent, segmentResults) {
  let text = "";

  for (const part of parent.parts) {
    if (part.type === "separator") {
      text += part.text;
      continue;
    }

    const result = segmentResults.get(part.id);
    if (!result || result.error || !result.text) {
      return {
        id: parent.id,
        error: result?.error || t("errorMissingParagraphTranslation", [], "模型未返回该段落的译文。")
      };
    }

    text += String(result.text).trim();
  }

  return {
    id: parent.id,
    text: text.replace(/\n{3,}/g, "\n\n").trim()
  };
}

function getEmptyStats() {
  return {
    scanned: 0,
    queued: 0,
    translated: 0,
    failed: 0,
    skippedBudget: 0,
    cacheHits: 0,
    apiRequested: 0,
    translationVisible: true
  };
}

async function testApi(settings) {
  const mergedSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };
  validateSettings(mergedSettings);

  const results = await requestTranslations(mergedSettings, [
    { id: "test", text: "Hello world." }
  ]);

  const result = results[0];
  if (!result || result.error) {
    throw new Error(result?.error || t("errorTestNoTranslation", [], "测试请求没有返回译文。"));
  }

  return { ok: true, text: result.text };
}

function validateSettings(settings) {
  if (!settings.apiKey) {
    throw new Error(t("errorApiKeyMissing", [], "当前扩展没有读取到 API Key。请打开设置页确认已保存；如果已经填过，可能是加载了另一个扩展实例。"));
  }

  if (!settings.model) {
    throw new Error(t("errorModelMissing", [], "请先在选项页填写模型名称。"));
  }
}

async function getCachedResults(settings, items) {
  const keysById = new Map(items.map((item) => [
    item.id,
    LLMTranslatorShared.createTranslationCacheKey(settings, item.text)
  ]));

  const cached = await chrome.storage.local.get(Array.from(keysById.values()));
  const results = new Map();
  const staleKeys = [];

  for (const item of items) {
    const key = keysById.get(item.id);
    const value = cached[key];
    if (LLMTranslatorShared.isTranslationCacheEntryFresh(value, settings)) {
      results.set(item.id, { id: item.id, text: value.text, cached: true });
    } else if (value?.text) {
      staleKeys.push(key);
    }
  }

  if (staleKeys.length > 0) {
    await chrome.storage.local.remove(staleKeys);
  }

  return results;
}

async function saveResultsToCache(settings, items, results) {
  const textById = new Map(items.map((item) => [item.id, item.text]));
  const updates = {};

  for (const result of results) {
    if (!result?.text || result.error) continue;
    const originalText = textById.get(result.id);
    if (!originalText) continue;

    const key = LLMTranslatorShared.createTranslationCacheKey(settings, originalText);
    updates[key] = {
      text: result.text,
      savedAt: Date.now()
    };
  }

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
    await maybePruneTranslationCache(settings);
  }
}

async function maybePruneTranslationCache(settings) {
  if (cachePrunePromise) return cachePrunePromise;

  const now = Date.now();
  if (lastCachePruneAt > 0 && now - lastCachePruneAt < CACHE_PRUNE_INTERVAL_MS) {
    return;
  }

  lastCachePruneAt = now;
  cachePrunePromise = pruneTranslationCache(settings).finally(() => {
    cachePrunePromise = null;
  });
  return cachePrunePromise;
}

async function pruneTranslationCache(settings) {
  const cacheSettings = LLMTranslatorShared.normalizeCacheSettings(settings);
  const all = await chrome.storage.local.get(null);
  const entries = Object.entries(all)
    .filter(([key, value]) => key.startsWith(LLMTranslatorShared.CACHE_PREFIX) && value?.text)
    .map(([key, value]) => ({
      key,
      savedAt: Number(value.savedAt) || 0
    }));

  if (entries.length <= cacheSettings.maxCacheEntries) return;

  entries.sort((a, b) => a.savedAt - b.savedAt);
  const removeKeys = entries
    .slice(0, entries.length - cacheSettings.maxCacheEntries)
    .map((entry) => entry.key);

  if (removeKeys.length > 0) {
    await chrome.storage.local.remove(removeKeys);
  }
}

async function clearTranslationCache() {
  const all = await chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((key) => key.startsWith(LLMTranslatorShared.CACHE_PREFIX));
  if (cacheKeys.length > 0) {
    await chrome.storage.local.remove(cacheKeys);
  }

  return { ok: true, count: cacheKeys.length };
}

async function requestTranslations(settings, items) {
  const url = LLMTranslatorShared.normalizeChatCompletionsUrl(settings.apiUrl);
  const prompt = buildTranslationPrompt(settings, items);
  const thinkingCacheKey = createThinkingControlCacheKey(settings);
  const skipThinkingControl = thinkingCacheKey && unsupportedThinkingControlKeys.has(thinkingCacheKey);
  const body = buildChatCompletionBody(settings, prompt, { skipThinkingControl });
  let response = await fetchWithOneRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body)
  }, settings);

  if (!response.ok) {
    let errorText = await response.text();
    if (!skipThinkingControl && shouldRetryWithoutThinkingControl(settings, body, errorText)) {
      if (thinkingCacheKey) unsupportedThinkingControlKeys.add(thinkingCacheKey);
      const fallbackBody = buildChatCompletionBody(settings, prompt, { skipThinkingControl: true });
      response = await fetchWithOneRetry(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify(fallbackBody)
      }, settings);
      if (response.ok) {
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error(t("errorApiMissingContent", [], "API 返回中没有 choices[0].message.content。"));
        }

        const parsed = parseTranslationJson(content);
        return normalizeResults(parsed, items);
      }
      errorText = await response.text();
    }
    throw new Error(t("errorApiRequestFailed", [String(response.status), errorText.slice(0, 240)], `API 请求失败：${response.status} ${errorText.slice(0, 240)}`));
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(t("errorApiMissingContent", [], "API 返回中没有 choices[0].message.content。"));
  }

  const parsed = parseTranslationJson(content);
  return normalizeResults(parsed, items);
}

function buildChatCompletionBody(settings, prompt, options = {}) {
  const body = {
    model: settings.model,
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: "You are a precise webpage translation engine. Keep meaning, tone, names, numbers, URLs, and code unchanged. Output only valid JSON."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };

  if (!options.skipThinkingControl) {
    applyThinkingControl(body, settings);
  }
  return body;
}

function applyThinkingControl(body, settings) {
  if (settings.disableThinking !== true) return;

  const strategy = LLMTranslatorShared.getEffectiveThinkingStrategy(settings);
  if (strategy === THINKING_STRATEGIES.DASHSCOPE_ENABLE_THINKING) {
    body.enable_thinking = false;
    return;
  }

  if (strategy === THINKING_STRATEGIES.THINKING_DISABLED) {
    body.thinking = { type: "disabled" };
    return;
  }

  if (strategy === THINKING_STRATEGIES.OPENROUTER_REASONING_LOW) {
    body.reasoning_effort = "low";
    return;
  }

  if (strategy === THINKING_STRATEGIES.OPENROUTER_REASONING_MINIMAL) {
    body.reasoning = {
      effort: "minimal",
      exclude: true
    };
    return;
  }

  if (strategy === THINKING_STRATEGIES.QWEN_CHAT_TEMPLATE_KWARGS) {
    body.chat_template_kwargs = {
      ...(body.chat_template_kwargs || {}),
      enable_thinking: false
    };
  }
}

function shouldRetryWithoutThinkingControl(settings, body, errorText) {
  if (settings.disableThinking !== true || !hasThinkingControl(body)) return false;

  const text = String(errorText || "").toLowerCase();
  const mentionsUnsupported = /(unknown|unrecognized|unsupported|unexpected|invalid|extra|additional|not support)/.test(text);
  const mentionsThinking = /(enable_thinking|thinking|reasoning_effort|reasoning|chat_template_kwargs)/.test(text);
  const mandatoryThinking = /(must be true|required|mandatory|cannot be disabled|restricted to true)/.test(text);
  return mentionsUnsupported && mentionsThinking && !mandatoryThinking;
}

function hasThinkingControl(body) {
  return (
    Object.prototype.hasOwnProperty.call(body, "enable_thinking") ||
    Object.prototype.hasOwnProperty.call(body, "thinking") ||
    Object.prototype.hasOwnProperty.call(body, "reasoning_effort") ||
    Object.prototype.hasOwnProperty.call(body, "reasoning") ||
    Object.prototype.hasOwnProperty.call(body, "chat_template_kwargs")
  );
}

function createThinkingControlCacheKey(settings) {
  if (settings.disableThinking !== true) return "";

  const strategy = LLMTranslatorShared.getEffectiveThinkingStrategy(settings);
  if (strategy === THINKING_STRATEGIES.OMIT) return "";

  const url = LLMTranslatorShared.normalizeChatCompletionsUrl(settings.apiUrl || "");
  const model = String(settings.model || "").trim().toLowerCase();
  return `${url}\n${model}\n${strategy}`;
}

async function fetchWithOneRetry(url, options, settings) {
  let lastError = null;
  const timeoutMs = getApiTimeoutMs(settings);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (response.ok || !isRetriableStatus(response.status) || attempt === 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (isTimeoutError(error)) {
        throw error;
      }
      if (attempt === 1) {
        throw error;
      }
    }
  }

  throw lastError || new Error(t("errorApiRequestGeneric", [], "API 请求失败。"));
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      const seconds = String(Math.round(timeoutMs / 1000));
      const timeoutError = new Error(t("errorApiTimeout", [seconds], `API 请求超时（${seconds} 秒）。`));
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function getApiTimeoutMs(settings) {
  const value = Number(settings?.apiTimeoutMs);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_SETTINGS.apiTimeoutMs;
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError";
}

function isRetriableStatus(status) {
  return status === 429 || status >= 500;
}

function buildTranslationPrompt(settings, items) {
  return [
    LLMTranslatorShared.resolveTranslationPrompt(settings),
    "",
    "Input JSON array:",
    JSON.stringify(items.map((item) => ({ id: item.id, text: item.text })))
  ].join("\n");
}

function parseTranslationJson(content) {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const candidates = [cleaned];
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start >= 0 && end > start) {
    const arrayCandidate = cleaned.slice(start, end + 1);
    if (arrayCandidate !== cleaned) candidates.push(arrayCandidate);
  }
  const errors = [];

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    if (parsed.ok) return parsed.value;
    errors.push(parsed.error);

    const repaired = repairCommonTranslationJson(candidate);
    if (repaired !== candidate) {
      const repairedParsed = tryParseJson(repaired);
      if (repairedParsed.ok) return repairedParsed.value;
      errors.push(repairedParsed.error);
    }
  }

  const salvaged = extractTranslationObjects(cleaned);
  if (salvaged.length > 0) return salvaged;

  const message = errors[0]?.message || t("errorUnknown", [], "未知错误");
  throw new Error(t("errorParseJson", [message], `无法解析模型返回的 JSON：${message}`));
}

function tryParseJson(value) {
  try {
    return { ok: true, value: JSON.parse(value) };
  } catch (error) {
    return { ok: false, error };
  }
}

function repairCommonTranslationJson(value) {
  return String(value)
    .replace(/}\s*(?={\s*"id"\s*:)/g, "},")
    .replace(/,\s*([}\]])/g, "$1");
}

function extractTranslationObjects(content) {
  const text = String(content || "");
  const results = [];
  const seenIds = new Set();
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("{", index);
    if (start < 0) break;

    const end = findBalancedObjectEnd(text, start);
    const parsed = end > start ? tryParseJson(text.slice(start, end + 1)) : { ok: false };
    const value = parsed.ok ? parsed.value : null;

    if (value
      && typeof value === "object"
      && value.id !== undefined
      && typeof value.text === "string"
      && !seenIds.has(String(value.id))) {
      seenIds.add(String(value.id));
      results.push({ id: value.id, text: value.text });
      index = end + 1;
    } else {
      index = start + 1;
    }
  }

  return results;
}

function findBalancedObjectEnd(text, start) {
  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }

    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}

function normalizeResults(parsed, originalItems) {
  const array = Array.isArray(parsed) ? parsed : parsed.results;
  if (!Array.isArray(array)) {
    throw new Error(t("errorModelReturnedNonArray", [], "模型返回不是 JSON 数组。"));
  }

  const byId = new Map(array.map((item) => [String(item.id), item]));
  return originalItems.map((item) => {
    const translated = byId.get(String(item.id));
    if (!translated?.text) {
      return { id: item.id, error: t("errorMissingParagraphTranslation", [], "模型未返回该段落的译文。") };
    }
    return { id: item.id, text: String(translated.text).trim() };
  });
}

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const extensionDir = path.resolve(__dirname, "..");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  await testTranslateBatchRetriesOneServerError();
  await testTranslateBatchUsesJsonArrayAndMapsById();
  await testTranslateBatchCachesMergedTextBySegment();
  await testTranslateBatchReturnsResultsWhenCacheWriteFails();
  await testTranslateBatchPrunesOldCacheEntries();
  await testTranslateBatchThrottlesCachePruning();
  await testTranslateBatchUsesCustomPrompt();
  await testTranslateBatchDisablesDashScopeThinking();
  await testTranslateBatchDisablesDeepSeekThinking();
  await testTranslateBatchDisablesOpenRouterThinking();
  await testTranslateBatchDisablesQwenTemplateThinking();
  await testTranslateBatchSkipsThinkingControlForOpenAI();
  await testTranslateBatchOmitsThinkingWhenStrategyOmit();
  await testTranslateBatchRetriesWithoutUnsupportedThinkingParameter();
  await testTranslateBatchTimesOutSlowApi();
  await testGetSettingsUpgradesLegacyDefaultPrompt();
  await testGetSettingsUpgradesLegacyDefaultTimeout();
  await testTabLoadingClearsTranslationState();
  await testAutoTranslateStartsWhenExistingTabActivated();
  await testAutoTranslateStartsActiveTabsOnStartup();
  await testAutoTranslateStartsActiveTabsOnInstalled();
  await testAutoTranslateStartsActiveTabsWhenSettingEnabled();
  await testAutoTranslateStartsActiveTabsWhenApiKeySaved();
  await testAutoTranslateTabRuntimeMessageStartsCurrentTab();
  await testContentAutoStartMarkActiveMakesFirstToggleStop();
  await testCommandToggleSyncsContentStateAfterWorkerRestart();
  await testContentAutoSkipMarkActiveStoresNotice();
  await testGetPageStatsSyncsActiveTabCache();
  await testAutoTranslateReportsUnconfiguredNotice();
  await testManualTranslationReportsMissingApiKeyBeforeInjecting();
  await testManualTranslationPropagatesContentStartFailure();
  await testManualTranslationSkipKeepsTabInactive();
  await testScanCurrentAreaReportsMissingApiKeyBeforeInjecting();
  await testScanCurrentAreaPropagatesContentFailure();
  await testScanCurrentAreaSkipKeepsTabInactive();
  await testFileUrlIsUnsupportedBeforeInjecting();
  await testSetDisplayModeForwardsToContentScript();
  await testDisplayModePropagatesContentFailure();
  await testVisibilityPropagatesContentFailure();
  await testClearTranslationPropagatesContentFailure();
  await testAutoTranslateSkipsTargetLanguagePage();
  await testAutoTranslateSkipNoticeIsReported();
  await testContextMenusUseConfiguredUiLanguage();
  await testContextMenuSetupSerializesConcurrentLanguageRefreshes();
  await testContextMenuPageTranslationShowsMissingApiKeyNotice();
  await testContextMenuStartsPageTranslation();
  await testContextMenuShowsNoticeWhenPageTranslationFails();
  await testContextMenuTranslatesSelectedText();
  await testContextMenuSelectionReportsMissingApiKey();
  await testContextMenuSelectionSkipsTargetLanguageText();
  console.log("background tests passed");
}

async function testTranslateBatchRetriesOneServerError() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      if (fetchCalls.length === 1) {
        return {
          ok: false,
          status: 500,
          async text() {
            return "temporary server error";
          }
        };
      }

      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify([{ id: "item-1", text: "你好，世界。" }])
                }
              }
            ]
          };
        }
      };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello world." }]
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(fetchCalls.length, 2, "A transient 500 should be retried once.");
  assert.strictEqual(response.results.length, 1);
  assert.strictEqual(response.results[0].id, "item-1");
  assert.strictEqual(response.results[0].text, "你好，世界。");
  assert.strictEqual(response.meta.requested, 1);
}

async function testTranslateBatchUsesJsonArrayAndMapsById() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify([
                    { id: "block-2", text: "第二段译文。" },
                    { id: "block-1", text: "第一段译文。" }
                  ])
                }
              }
            ]
          };
        }
      };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [
      { id: "block-1", text: "First block text." },
      { id: "block-2", text: "Second block text." }
    ]
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(fetchCalls.length, 1);

  const body = JSON.parse(fetchCalls[0].options.body);
  const userMessage = body.messages.find((message) => message.role === "user");
  const inputJson = userMessage.content.slice(userMessage.content.indexOf("["));
  assert.deepStrictEqual(JSON.parse(inputJson), [
    { id: "block-1", text: "First block text." },
    { id: "block-2", text: "Second block text." }
  ]);

  assert.deepStrictEqual(JSON.parse(JSON.stringify(response.results)), [
    { id: "block-1", text: "第一段译文。" },
    { id: "block-2", text: "第二段译文。" }
  ]);
}

async function testTranslateBatchCachesMergedTextBySegment() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      const body = JSON.parse(options.body);
      const userMessage = body.messages.find((message) => message.role === "user");
      const inputJson = userMessage.content.slice(userMessage.content.indexOf("["));

      assert.deepStrictEqual(JSON.parse(inputJson), [
        { id: "block-1::segment-1", text: "Second paragraph." }
      ]);

      return createJsonResponse([
        { id: "block-1::segment-1", text: "第二段译文。" }
      ]);
    }
  });

  loadBackground(context);

  const settings = await sendRuntimeMessage(context, { action: "get_settings" });
  const firstSegmentKey = context.LLMTranslatorShared.createTranslationCacheKey(settings, "First paragraph.");
  await context.chrome.storage.local.set({
    [firstSegmentKey]: {
      text: "第一段缓存译文。",
      savedAt: Date.now()
    }
  });

  const firstResponse = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [
      { id: "block-1", text: "First paragraph.\n\nSecond paragraph." }
    ]
  });

  assert.strictEqual(firstResponse.ok, true);
  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(firstResponse.meta.cacheHits, 1);
  assert.strictEqual(firstResponse.meta.requested, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(firstResponse.results)), [
    { id: "block-1", text: "第一段缓存译文。\n\n第二段译文。" }
  ]);

  const secondResponse = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [
      { id: "block-2", text: "Second paragraph." }
    ]
  });

  assert.strictEqual(secondResponse.ok, true);
  assert.strictEqual(fetchCalls.length, 1, "Saved segment translation should be reused without another API call.");
  assert.strictEqual(secondResponse.meta.cacheHits, 1);
  assert.strictEqual(secondResponse.meta.requested, 0);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(secondResponse.results)), [
    { id: "block-2", text: "第二段译文。" }
  ]);
}

async function testTranslateBatchReturnsResultsWhenCacheWriteFails() {
  const context = createBackgroundContext({
    console: { ...console, warn() {} },
    failStorageSet: true,
    fetch: async () => createJsonResponse([
      { id: "block-1", text: "缓存失败时仍应返回译文。" }
    ])
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [
      { id: "block-1", text: "Successful translations should still render when cache storage is full." }
    ]
  });

  assert.strictEqual(response.ok, true);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(response.results)), [
    { id: "block-1", text: "缓存失败时仍应返回译文。" }
  ]);
}

async function testTranslateBatchPrunesOldCacheEntries() {
  const context = createBackgroundContext({
    storage: {
      maxCacheEntries: 100
    },
    fetch: async () => createJsonResponse([{ id: "fresh", text: "新的译文。" }])
  });

  loadBackground(context);

  const settings = await sendRuntimeMessage(context, { action: "get_settings" });
  const oldEntries = {};
  const oldKeys = [];
  for (let index = 0; index < 101; index += 1) {
    const key = context.LLMTranslatorShared.createTranslationCacheKey(settings, `Old paragraph ${index}.`);
    oldKeys.push(key);
    oldEntries[key] = {
      text: `旧译文 ${index}`,
      savedAt: index + 1
    };
  }
  await context.chrome.storage.local.set(oldEntries);

  const response = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "fresh", text: "Fresh paragraph for cache pruning." }]
  });

  assert.strictEqual(response.ok, true);

  const all = await context.chrome.storage.local.get(null);
  const cacheKeys = Object.keys(all).filter((key) => key.startsWith(context.LLMTranslatorShared.CACHE_PREFIX));
  const freshKey = context.LLMTranslatorShared.createTranslationCacheKey(settings, "Fresh paragraph for cache pruning.");

  assert.strictEqual(cacheKeys.length, 100);
  assert.strictEqual(all[oldKeys[0]], undefined, "The oldest cache entry should be pruned first.");
  assert.strictEqual(all[oldKeys[1]], undefined, "Pruning should remove enough old entries to honor the cap.");
  assert.ok(all[freshKey], "The newly saved translation should stay in cache.");
}

async function testTranslateBatchThrottlesCachePruning() {
  const context = createBackgroundContext({
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      const userMessage = body.messages.find((message) => message.role === "user");
      const inputJson = userMessage.content.slice(userMessage.content.indexOf("["));
      return createJsonResponse(JSON.parse(inputJson).map((item) => ({
        id: item.id,
        text: `译文：${item.text}`
      })));
    }
  });

  loadBackground(context);

  await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "first", text: "First paragraph for cache pruning throttle." }]
  });
  await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "second", text: "Second paragraph for cache pruning throttle." }]
  });

  assert.strictEqual(context.storageGetAllCount, 1, "Cache pruning should not full-scan storage for every saved batch.");
}

async function testGetSettingsUpgradesLegacyDefaultPrompt() {
  const context = createBackgroundContext({
    storage: {
      translationPrompt: [
        "Translate the following webpage text from {{sourceLanguage}} to {{targetLanguage}}.",
        "Keep meaning, tone, names, numbers, URLs, and code unchanged.",
        "Return ONLY a JSON array. Each item must be: {\"id\":\"same id\",\"text\":\"translation\"}.",
        "Do not add explanations, markdown fences, comments, or extra keys."
      ].join("\n")
    }
  });

  loadBackground(context);

  const settings = await sendRuntimeMessage(context, { action: "get_settings" });

  assert.match(settings.translationPrompt, /line breaks/i);
}

async function testGetSettingsUpgradesLegacyDefaultTimeout() {
  const old25sContext = createBackgroundContext({
    storage: {
      apiTimeoutMs: 25000
    }
  });

  loadBackground(old25sContext);

  const old25sSettings = await sendRuntimeMessage(old25sContext, { action: "get_settings" });
  assert.strictEqual(old25sSettings.apiTimeoutMs, 120000);

  const old45sContext = createBackgroundContext({
    storage: {
      apiTimeoutMs: 45000
    }
  });

  loadBackground(old45sContext);

  const old45sSettings = await sendRuntimeMessage(old45sContext, { action: "get_settings" });
  assert.strictEqual(old45sSettings.apiTimeoutMs, 120000);

  const old90sContext = createBackgroundContext({
    storage: {
      apiTimeoutMs: 90000
    }
  });

  loadBackground(old90sContext);

  const old90sSettings = await sendRuntimeMessage(old90sContext, { action: "get_settings" });
  assert.strictEqual(old90sSettings.apiTimeoutMs, 120000);
}

async function testTranslateBatchUsesCustomPrompt() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    storage: {
      translationPrompt: "Use a concise news style when translating from {{sourceLanguage}} to {{targetLanguage}}."
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify([{ id: "item-1", text: "你好，世界。" }])
                }
              }
            ]
          };
        }
      };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello world." }]
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(fetchCalls.length, 1);

  const body = JSON.parse(fetchCalls[0].options.body);
  const userMessage = body.messages.find((message) => message.role === "user");
  assert.match(userMessage.content, /concise news style/);
  assert.match(userMessage.content, /English/);
  assert.match(userMessage.content, /简体中文/);
  assert.doesNotMatch(userMessage.content, /\{\{targetLanguage\}\}/);
}

async function testTranslateBatchDisablesDashScopeThinking() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    storage: {
      apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      model: "qwen-plus",
      disableThinking: true
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return createJsonResponse([{ id: "item-1", text: "译文。" }]);
    }
  });

  loadBackground(context);
  await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello." }]
  });

  const body = JSON.parse(fetchCalls[0].options.body);
  assert.strictEqual(body.enable_thinking, false);
  assert.strictEqual(body.chat_template_kwargs, undefined);
}

async function testTranslateBatchDisablesDeepSeekThinking() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    storage: {
      provider: "custom",
      apiUrl: "https://opencode.example/v1/chat/completions",
      model: "deepseek-v4-flash",
      disableThinking: true
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return createJsonResponse([{ id: "item-1", text: "译文。" }]);
    }
  });

  loadBackground(context);
  await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello." }]
  });

  const body = JSON.parse(fetchCalls[0].options.body);
  assert.deepStrictEqual(body.thinking, { type: "disabled" });
  assert.strictEqual(body.enable_thinking, undefined);
}

async function testTranslateBatchDisablesOpenRouterThinking() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    storage: {
      provider: "custom",
      apiUrl: "https://openrouter.ai/api/v1/chat/completions",
      model: "anthropic/claude-sonnet-4",
      disableThinking: true
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return createJsonResponse([{ id: "item-1", text: "译文。" }]);
    }
  });

  loadBackground(context);
  await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello." }]
  });

  const body = JSON.parse(fetchCalls[0].options.body);
  assert.deepStrictEqual(body.reasoning, { effort: "minimal", exclude: true });
  assert.strictEqual(body.reasoning_effort, undefined);
}

async function testTranslateBatchDisablesQwenTemplateThinking() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    storage: {
      apiUrl: "http://127.0.0.1:8000/v1/chat/completions",
      model: "Qwen/Qwen3-8B",
      disableThinking: true
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return createJsonResponse([{ id: "item-1", text: "译文。" }]);
    }
  });

  loadBackground(context);
  await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello." }]
  });

  const body = JSON.parse(fetchCalls[0].options.body);
  assert.strictEqual(body.chat_template_kwargs.enable_thinking, false);
  assert.strictEqual(body.enable_thinking, undefined);
}

async function testTranslateBatchSkipsThinkingControlForOpenAI() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    storage: {
      apiUrl: "https://api.openai.com/v1/chat/completions",
      model: "gpt-4o-mini",
      disableThinking: true
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return createJsonResponse([{ id: "item-1", text: "译文。" }]);
    }
  });

  loadBackground(context);
  await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello." }]
  });

  const body = JSON.parse(fetchCalls[0].options.body);
  assert.strictEqual(body.enable_thinking, undefined);
  assert.strictEqual(body.chat_template_kwargs, undefined);
  assert.strictEqual(body.thinking, undefined);
  assert.strictEqual(body.reasoning, undefined);
}

async function testTranslateBatchOmitsThinkingWhenStrategyOmit() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    storage: {
      apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      model: "qwen-plus",
      disableThinking: true,
      thinkingStrategy: "omit"
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return createJsonResponse([{ id: "item-1", text: "译文。" }]);
    }
  });

  loadBackground(context);
  await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello." }]
  });

  const body = JSON.parse(fetchCalls[0].options.body);
  assert.strictEqual(body.enable_thinking, undefined);
  assert.strictEqual(body.chat_template_kwargs, undefined);
  assert.strictEqual(body.thinking, undefined);
  assert.strictEqual(body.reasoning_effort, undefined);
  assert.strictEqual(body.reasoning, undefined);
}

async function testTranslateBatchRetriesWithoutUnsupportedThinkingParameter() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    storage: {
      provider: "custom",
      apiUrl: "https://opencode.example/v1/chat/completions",
      model: "deepseek-v4-flash",
      disableThinking: true
    },
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      const body = JSON.parse(options.body);
      if (body.thinking) {
        return {
          ok: false,
          status: 400,
          async text() {
            return "invalid request: unsupported field thinking";
          }
        };
      }
      return createJsonResponse([{ id: "item-1", text: "译文。" }]);
    }
  });

  loadBackground(context);
  const response = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello." }]
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(fetchCalls.length, 2);
  assert.deepStrictEqual(JSON.parse(fetchCalls[0].options.body).thinking, { type: "disabled" });
  assert.strictEqual(JSON.parse(fetchCalls[1].options.body).thinking, undefined);

  const secondResponse = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [{ id: "item-2", text: "Goodbye." }]
  });

  assert.strictEqual(secondResponse.ok, true);
  assert.strictEqual(fetchCalls.length, 3);
  assert.strictEqual(JSON.parse(fetchCalls[2].options.body).thinking, undefined);
}

async function testTranslateBatchTimesOutSlowApi() {
  const context = createBackgroundContext({
    storage: { apiTimeoutMs: 20 },
    fetch: async (url, options) => new Promise((resolve, reject) => {
      if (!options?.signal) {
        reject(new Error("fetch was called without AbortSignal"));
        return;
      }

      options.signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      });
    })
  });

  loadBackground(context);

  const response = await sendRuntimeMessageWithTimeout(context, {
    action: "translate_batch",
    items: [{ id: "item-1", text: "Hello world." }]
  }, 500);

  assert.strictEqual(response.ok, false);
  assert.match(response.error, /超时|timeout/i);
}

async function testTabLoadingClearsTranslationState() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { autoTranslate: true },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, count: 2 };
    }
  });

  loadBackground(context);

  await sendRuntimeMessage(context, {
    action: "auto_translate_tab",
    tab: { id: 12, url: "https://example.com/article" }
  });

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 12);
  assert.strictEqual(tabMessages[0].message.action, "start_translation");
  assert.strictEqual(tabMessages[0].message.auto, true);

  let state = await sendRuntimeMessage(context, { action: "get_tab_state", tabId: 12 });
  assert.strictEqual(state.active, true);

  assert.ok(context.tabsOnUpdatedListener, "background should register tabs.onUpdated for navigation cleanup");
  await context.tabsOnUpdatedListener(12, { status: "loading" }, {
    id: 12,
    url: "https://example.com/article"
  });

  state = await sendRuntimeMessage(context, { action: "get_tab_state", tabId: 12 });
  assert.strictEqual(state.active, false);
}

async function testAutoTranslateStartsWhenExistingTabActivated() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { autoTranslate: true },
    tabsById: {
      31: { id: 31, url: "https://www.bbc.com/" }
    },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, count: 3 };
    }
  });

  loadBackground(context);

  assert.ok(context.tabsOnActivatedListener, "background should register tabs.onActivated for existing loaded pages");
  await context.tabsOnActivatedListener({ tabId: 31 });

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 31);
  assert.strictEqual(tabMessages[0].message.action, "start_translation");
  assert.strictEqual(tabMessages[0].message.auto, true);
}

async function testAutoTranslateStartsActiveTabsOnStartup() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { autoTranslate: true },
    queryTabs: [{ id: 32, url: "https://www.bbc.com/" }],
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, count: 4 };
    }
  });

  loadBackground(context);

  assert.ok(context.onStartupListener, "background should register runtime.onStartup");
  await context.onStartupListener();

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 32);
  assert.strictEqual(tabMessages[0].message.action, "start_translation");
  assert.strictEqual(tabMessages[0].message.auto, true);
}

async function testAutoTranslateStartsActiveTabsOnInstalled() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { autoTranslate: true },
    queryTabs: [{ id: 35, url: "https://www.bbc.com/" }],
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, count: 6 };
    }
  });

  loadBackground(context);

  await context.onInstalledListener();

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 35);
  assert.strictEqual(tabMessages[0].message.action, "start_translation");
  assert.strictEqual(tabMessages[0].message.auto, true);
}

async function testAutoTranslateStartsActiveTabsWhenSettingEnabled() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { autoTranslate: false },
    queryTabs: [{ id: 33, url: "https://www.bbc.com/" }],
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, count: 5 };
    }
  });

  loadBackground(context);

  assert.ok(context.storageOnChangedListener, "background should listen for autoTranslate setting changes");
  await context.chrome.storage.local.set({ autoTranslate: true });
  await context.storageOnChangedListener({
    autoTranslate: { oldValue: false, newValue: true }
  }, "local");

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 33);
  assert.strictEqual(tabMessages[0].message.action, "start_translation");
  assert.strictEqual(tabMessages[0].message.auto, true);
}

async function testAutoTranslateStartsActiveTabsWhenApiKeySaved() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { autoTranslate: true, apiKey: "" },
    queryTabs: [{ id: 39, url: "https://www.bbc.com/" }],
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, count: 7 };
    }
  });

  loadBackground(context);

  assert.ok(context.storageOnChangedListener, "background should listen for API Key changes");
  await context.chrome.storage.local.set({ apiKey: "saved-key" });
  await context.storageOnChangedListener({
    apiKey: { oldValue: "", newValue: "saved-key" }
  }, "local");

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 39);
  assert.strictEqual(tabMessages[0].message.action, "start_translation");
  assert.strictEqual(tabMessages[0].message.auto, true);
}

async function testAutoTranslateTabRuntimeMessageStartsCurrentTab() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { autoTranslate: true },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, count: 8 };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "auto_translate_tab",
    tab: { id: 40, url: "https://www.bbc.com/" }
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.active, true);
  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 40);
  assert.strictEqual(tabMessages[0].message.action, "start_translation");
  assert.strictEqual(tabMessages[0].message.auto, true);
}

async function testContentAutoStartMarkActiveMakesFirstToggleStop() {
  const tabMessages = [];
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      if (message.action === "get_page_stats") {
        return { ok: true, active: true, stats: { translated: 1, translationVisible: true } };
      }
      if (message.action === "start_translation") {
        throw new Error("First toggle after content auto-start should stop, not start again.");
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  const markResponse = await sendRuntimeMessageFromTab(
    context,
    { action: "mark_tab_active", active: true },
    { id: 42, url: "https://www.bbc.com/" }
  );
  assert.strictEqual(markResponse.ok, true);
  assert.strictEqual(markResponse.active, true);

  const response = await sendRuntimeMessage(context, {
    action: "toggle_translation",
    tab: { id: 42, url: "https://www.bbc.com/" }
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.active, false);
  assert.deepStrictEqual(tabMessages.map((entry) => entry.message.action), [
    "get_page_stats",
    "stop_translation"
  ]);
}

async function testCommandToggleSyncsContentStateAfterWorkerRestart() {
  const tabMessages = [];
  const context = createBackgroundContext({
    queryTabs: [{ id: 45, url: "https://www.bbc.com/" }],
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      if (message.action === "get_page_stats") {
        return { ok: true, active: true, stats: { translated: 1, translationVisible: true } };
      }
      if (message.action === "start_translation") {
        throw new Error("Shortcut should stop the active content script after a worker restart.");
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  assert.ok(context.commandListener, "background should register a command listener");
  await context.commandListener("toggle_translation");

  assert.deepStrictEqual(tabMessages.map((entry) => entry.message.action), [
    "get_page_stats",
    "stop_translation"
  ]);
  const state = await sendRuntimeMessage(context, { action: "get_tab_state", tabId: 45 });
  assert.strictEqual(state.active, false);
}

async function testContentAutoSkipMarkActiveStoresNotice() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 46);
      assert.strictEqual(message.action, "get_page_stats");
      return { ok: true, active: false, stats: { translated: 0, translationVisible: true } };
    }
  });

  loadBackground(context);

  const markResponse = await sendRuntimeMessageFromTab(
    context,
    { action: "mark_tab_active", active: false, reason: "target-language" },
    { id: 46, url: "https://example.com/zh" }
  );
  assert.strictEqual(markResponse.ok, true);
  assert.strictEqual(markResponse.active, false);

  const stats = await sendRuntimeMessage(context, {
    action: "get_page_stats",
    tab: { id: 46, url: "https://example.com/zh" }
  });
  assert.strictEqual(stats.notice.reason, "target-language");
}

async function testGetPageStatsSyncsActiveTabCache() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 43);
      assert.strictEqual(message.action, "get_page_stats");
      return { ok: true, active: true, stats: { translated: 2, translationVisible: true } };
    }
  });

  loadBackground(context);

  const stats = await sendRuntimeMessage(context, {
    action: "get_page_stats",
    tab: { id: 43, url: "https://www.bbc.com/" }
  });
  assert.strictEqual(stats.ok, true);
  assert.strictEqual(stats.active, true);

  const state = await sendRuntimeMessage(context, { action: "get_tab_state", tabId: 43 });
  assert.strictEqual(state.active, true);
}

async function testAutoTranslateReportsUnconfiguredNotice() {
  const context = createBackgroundContext({
    storage: { autoTranslate: true, apiKey: "" },
    sendMessage: async (tabId, message) => {
      if (message.action === "get_page_stats") {
        return { ok: true, active: false, stats: { translated: 0, translationVisible: true } };
      }
      throw new Error("Unconfigured auto translation should not inject start_translation.");
    }
  });

  loadBackground(context);

  await sendRuntimeMessage(context, {
    action: "auto_translate_tab",
    tab: { id: 34, url: "https://www.bbc.com/" }
  });

  const response = await sendRuntimeMessage(context, {
    action: "get_page_stats",
    tab: { id: 34, url: "https://www.bbc.com/" }
  });

  assert.strictEqual(response.notice.reason, "unconfigured");
}

async function testManualTranslationReportsMissingApiKeyBeforeInjecting() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { apiKey: "" },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "toggle_translation",
    tab: { id: 36, url: "https://www.bbc.com/" }
  });

  assert.strictEqual(response.ok, false);
  assert.match(response.error, /API Key/);
  assert.deepStrictEqual(tabMessages.map((entry) => entry.message.action), ["get_page_stats"]);
  assert.strictEqual(context.scriptingCalls.length, 0);
}

async function testManualTranslationPropagatesContentStartFailure() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 39);
      if (message.action === "start_translation") {
        return { ok: false, error: "Content failed to read settings." };
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "toggle_translation",
    tab: { id: 39, url: "https://www.bbc.com/" }
  });

  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.active, false);
  assert.match(response.error, /Content failed/);

  const state = await sendRuntimeMessage(context, { action: "get_tab_state", tabId: 39 });
  assert.strictEqual(state.active, false);
}

async function testManualTranslationSkipKeepsTabInactive() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 44);
      if (message.action === "start_translation") {
        return { ok: true, skipped: true, reason: "target-language" };
      }
      if (message.action === "get_page_stats") {
        return { ok: true, active: false, stats: { translated: 0, translationVisible: true } };
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "toggle_translation",
    tab: { id: 44, url: "https://example.com/zh" }
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.active, false);
  assert.strictEqual(response.content.skipped, true);

  const stats = await sendRuntimeMessage(context, {
    action: "get_page_stats",
    tab: { id: 44, url: "https://example.com/zh" }
  });
  assert.strictEqual(stats.notice.reason, "target-language");
}

async function testScanCurrentAreaReportsMissingApiKeyBeforeInjecting() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { apiKey: "" },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "scan_current_area",
    tab: { id: 37, url: "https://www.bbc.com/" }
  });

  assert.strictEqual(response.ok, false);
  assert.match(response.error, /API Key/);
  assert.strictEqual(tabMessages.length, 0);
}

async function testScanCurrentAreaPropagatesContentFailure() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 40);
      if (message.action === "scan_current_area") {
        return { ok: false, error: "Scan failed inside content script." };
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "scan_current_area",
    tab: { id: 40, url: "https://www.bbc.com/" }
  });

  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.active, false);
  assert.match(response.error, /Scan failed/);
}

async function testScanCurrentAreaSkipKeepsTabInactive() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 45);
      if (message.action === "scan_current_area") {
        return { ok: true, skipped: true, reason: "target-language" };
      }
      if (message.action === "get_page_stats") {
        return { ok: true, active: false, stats: { translated: 0, translationVisible: true } };
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "scan_current_area",
    tab: { id: 45, url: "https://example.com/zh" }
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(response.active, false);
  assert.strictEqual(response.content.skipped, true);

  const stats = await sendRuntimeMessage(context, {
    action: "get_page_stats",
    tab: { id: 45, url: "https://example.com/zh" }
  });
  assert.strictEqual(stats.notice.reason, "target-language");
}

async function testFileUrlIsUnsupportedBeforeInjecting() {
  const context = createBackgroundContext({
    sendMessage: async () => {
      throw new Error("file:// pages should be treated as unsupported before content script injection.");
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "toggle_translation",
    tab: { id: 38, url: "file:///example/article.html" }
  });

  assert.strictEqual(response.ok, false);
  assert.match(response.error, /不支持|does not allow|unsupported/i);
  assert.strictEqual(context.scriptingCalls.length, 0);
}

async function testSetDisplayModeForwardsToContentScript() {
  const tabMessages = [];
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, displayMode: message.displayMode };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "set_display_mode",
    tab: { id: 41, url: "https://example.com/article" },
    displayMode: "translation-first"
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(context.scriptingCalls.length, 1);
  assert.deepStrictEqual(Array.from(context.scriptingCalls[0].files), ["shared.js", "content.js"]);
  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 41);
  assert.strictEqual(tabMessages[0].message.action, "set_display_mode");
  assert.strictEqual(tabMessages[0].message.displayMode, "translation-first");
}

async function testDisplayModePropagatesContentFailure() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 42);
      if (message.action === "set_display_mode") {
        return { ok: false, error: "Display mode failed inside content script." };
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "set_display_mode",
    tab: { id: 42, url: "https://example.com/article" },
    displayMode: "translation-first"
  });

  assert.strictEqual(response.ok, false);
  assert.match(response.error, /Display mode failed/);
}

async function testVisibilityPropagatesContentFailure() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 44);
      if (message.action === "set_translation_visibility") {
        return { ok: false, error: "Visibility failed inside content script." };
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "set_translation_visibility",
    tab: { id: 44, url: "https://example.com/article" },
    visible: false
  });

  assert.strictEqual(response.ok, false);
  assert.match(response.error, /Visibility failed/);
}

async function testClearTranslationPropagatesContentFailure() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 45);
      if (message.action === "clear_translation") {
        return { ok: false, error: "Clear failed inside content script." };
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  await sendRuntimeMessageFromTab(context, {
    action: "mark_tab_active",
    active: true
  }, { id: 45 });

  const response = await sendRuntimeMessage(context, {
    action: "clear_translation",
    tab: { id: 45, url: "https://example.com/article" }
  });

  assert.strictEqual(response.ok, false);
  assert.strictEqual(response.active, true);
  assert.match(response.error, /Clear failed/);
}

async function testAutoTranslateSkipsTargetLanguagePage() {
  const context = createBackgroundContext({
    storage: { autoTranslate: true },
    sendMessage: async () => ({ ok: true, skipped: true, reason: "target-language" })
  });

  loadBackground(context);

  await sendRuntimeMessage(context, {
    action: "auto_translate_tab",
    tab: { id: 13, url: "https://example.com/chinese" }
  });

  const state = await sendRuntimeMessage(context, { action: "get_tab_state", tabId: 13 });
  assert.strictEqual(state.active, false);
}

async function testAutoTranslateSkipNoticeIsReported() {
  const context = createBackgroundContext({
    storage: { autoTranslate: true },
    sendMessage: async (tabId, message) => {
      if (message.action === "start_translation") {
        return { ok: true, skipped: true, reason: "target-language" };
      }
      if (message.action === "get_page_stats") {
        return { ok: true, active: false, stats: { translated: 0, translationVisible: true } };
      }
      return { ok: true };
    }
  });

  loadBackground(context);

  await sendRuntimeMessage(context, {
    action: "auto_translate_tab",
    tab: { id: 14, url: "https://example.com/chinese" }
  });

  const response = await sendRuntimeMessage(context, {
    action: "get_page_stats",
    tab: { id: 14, url: "https://example.com/chinese" }
  });

  assert.strictEqual(response.notice.reason, "target-language");
}

async function testContextMenuPageTranslationShowsMissingApiKeyNotice() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { apiKey: "" },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true };
    }
  });

  loadBackground(context);
  await context.onInstalledListener();

  await context.contextMenuClickListener({ menuItemId: "llm_translate_page" }, {
    id: 38,
    url: "https://www.bbc.com/"
  });

  assert.strictEqual(tabMessages.length, 0);
  assert.strictEqual(context.scriptingCalls.length, 1);
  assert.strictEqual(context.scriptingCalls[0].target.tabId, 38);
  assert.strictEqual(typeof context.scriptingCalls[0].func, "function");
  assert.match(context.scriptingCalls[0].args[0], /API Key/);
  assert.strictEqual(context.scriptingCalls[0].args[1], true);
}

async function testContextMenusUseConfiguredUiLanguage() {
  const context = createBackgroundContext({
    storage: { uiLanguage: "en" }
  });

  loadBackground(context);
  await context.onInstalledListener();

  assert.ok(
    context.contextMenuItems.some((item) => item.id === "llm_translate_page" && item.title === "Translate this page"),
    "page context menu should use configured UI language"
  );
  assert.ok(
    context.contextMenuItems.some((item) => item.id === "llm_translate_selection" && item.title === "Translate selected text"),
    "selection context menu should use configured UI language"
  );
}

async function testContextMenuSetupSerializesConcurrentLanguageRefreshes() {
  const context = createBackgroundContext({
    storage: { uiLanguage: "en" },
    contextMenuRemoveAllDelayMs: 1,
    failOnDuplicateContextMenu: true
  });

  loadBackground(context);
  await Promise.all([
    context.onInstalledListener(),
    context.storageOnChangedListener({ uiLanguage: { oldValue: "auto", newValue: "en" } }, "local"),
    context.storageOnChangedListener({ uiLanguage: { oldValue: "en", newValue: "ja" } }, "local")
  ]);

  assert.strictEqual(context.contextMenuItems.filter((item) => item.id === "llm_translate_page").length, 1);
  assert.strictEqual(context.contextMenuItems.filter((item) => item.id === "llm_translate_selection").length, 1);
}

async function testContextMenuStartsPageTranslation() {
  const tabMessages = [];
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true, count: 1 };
    }
  });

  loadBackground(context);

  assert.ok(context.onInstalledListener, "background should register onInstalled");
  await context.onInstalledListener();
  assert.ok(
    context.contextMenuItems.some((item) => item.id === "llm_translate_page"),
    "context menu should include a page translation item"
  );
  assert.ok(context.contextMenuClickListener, "background should listen for context menu clicks");

  await context.contextMenuClickListener({ menuItemId: "llm_translate_page" }, {
    id: 21,
    url: "https://example.com/article"
  });

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 21);
  assert.strictEqual(tabMessages[0].message.action, "start_translation");
  assert.strictEqual(tabMessages[0].message.auto, undefined);
}

async function testContextMenuShowsNoticeWhenPageTranslationFails() {
  const context = createBackgroundContext({
    sendMessage: async (tabId, message) => {
      assert.strictEqual(tabId, 25);
      if (message.action === "start_translation") {
        return { ok: false, error: "Content start failed." };
      }
      return { ok: true };
    }
  });

  loadBackground(context);
  await context.onInstalledListener();

  await context.contextMenuClickListener({ menuItemId: "llm_translate_page" }, {
    id: 25,
    url: "https://example.com/article"
  });

  assert.strictEqual(context.scriptingCalls.length, 2);
  const noticeCall = context.scriptingCalls[1];
  assert.strictEqual(noticeCall.args[0], "Content start failed.");
  assert.strictEqual(noticeCall.args[1], true);

  const state = await sendRuntimeMessage(context, { action: "get_tab_state", tabId: 25 });
  assert.strictEqual(state.active, false);
}

async function testContextMenuTranslatesSelectedText() {
  const tabMessages = [];
  const fetchCalls = [];
  const context = createBackgroundContext({
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify([{ id: "selection", text: "这是一段选中文字。" }])
                }
              }
            ]
          };
        }
      };
    },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true };
    }
  });

  loadBackground(context);

  await context.onInstalledListener();
  assert.ok(
    context.contextMenuItems.some((item) => item.id === "llm_translate_selection" && item.contexts.includes("selection")),
    "context menu should include a selection translation item"
  );

  await context.contextMenuClickListener({
    menuItemId: "llm_translate_selection",
    selectionText: "This is selected text."
  }, {
    id: 22,
    url: "https://example.com/article"
  });

  assert.strictEqual(fetchCalls.length, 1);
  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].tabId, 22);
  assert.strictEqual(tabMessages[0].message.action, "show_selection_translation");
  assert.strictEqual(tabMessages[0].message.originalText, "This is selected text.");
  assert.strictEqual(tabMessages[0].message.translatedText, "这是一段选中文字。");
}

async function testContextMenuSelectionReportsMissingApiKey() {
  const tabMessages = [];
  const context = createBackgroundContext({
    storage: { apiKey: "" },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true };
    }
  });

  loadBackground(context);
  await context.onInstalledListener();

  await context.contextMenuClickListener({
    menuItemId: "llm_translate_selection",
    selectionText: "This is selected text."
  }, {
    id: 23,
    url: "https://example.com/article"
  });

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].message.action, "show_selection_translation");
  assert.match(tabMessages[0].message.error, /API Key/);
}

async function testContextMenuSelectionSkipsTargetLanguageText() {
  const tabMessages = [];
  const context = createBackgroundContext({
    fetch: async () => {
      throw new Error("target language selection should not call API");
    },
    sendMessage: async (tabId, message) => {
      tabMessages.push({ tabId, message });
      return { ok: true };
    }
  });

  loadBackground(context);
  await context.onInstalledListener();

  await context.contextMenuClickListener({
    menuItemId: "llm_translate_selection",
    selectionText: "这段文字已经是中文，不需要再次翻译。"
  }, {
    id: 24,
    url: "https://example.com/article"
  });

  assert.strictEqual(tabMessages.length, 1);
  assert.strictEqual(tabMessages[0].message.action, "show_selection_translation");
  assert.match(tabMessages[0].message.notice, /无需翻译/);
}

function createJsonResponse(results) {
  return {
    ok: true,
    async json() {
      return {
        choices: [
          {
            message: {
              content: JSON.stringify(results)
            }
          }
        ]
      };
    }
  };
}

function createBackgroundContext(options = {}) {
  const storage = {
    provider: "openai",
    apiUrl: "https://api.example.com/v1/chat/completions",
    apiKey: "test-key",
    model: "test-model",
    sourceLanguage: "English",
    targetLanguage: "简体中文",
    batchSize: 8,
    maxElementsPerScan: 24,
    maxTextLength: 1800,
    maxRequestsPerPage: 80,
    maxCharsPerPage: 60000,
    maxCharsPerBatch: 6000,
    maxConcurrentBatches: 2,
    cacheTtlDays: 30,
    maxCacheEntries: 2000,
    apiTimeoutMs: 120000,
    disableThinking: true,
    thinkingStrategy: "auto",
    autoTranslate: false,
    displayMode: "bilingual",
    viewportOnly: true
  };

  Object.assign(storage, options.storage || {});
  const tabsById = options.tabsById || {};

  const context = {
    console: options.console || console,
    setTimeout,
    clearTimeout,
    AbortController,
    fetch: options.fetch || createLocaleFetch(),
    onInstalledListener: null,
    runtimeMessageListener: null,
    onStartupListener: null,
    tabsOnUpdatedListener: null,
    tabsOnActivatedListener: null,
    storageOnChangedListener: null,
    contextMenuItems: [],
    contextMenuClickListener: null,
    scriptingCalls: [],
    storageGetAllCount: 0,
    importScripts(fileName) {
      const source = fs.readFileSync(path.join(extensionDir, fileName), "utf8");
      vm.runInContext(source, context, { filename: fileName });
    },
    chrome: {
      runtime: {
        getURL(filePath) {
          return `locale://${filePath}`;
        },
        onInstalled: {
          addListener(listener) {
            context.onInstalledListener = listener;
          }
        },
        onStartup: {
          addListener(listener) {
            context.onStartupListener = listener;
          }
        },
        onMessage: {
          addListener(listener) {
            context.runtimeMessageListener = listener;
          }
        }
      },
      contextMenus: {
        async removeAll(callback) {
          if (options.contextMenuRemoveAllDelayMs) {
            await new Promise((resolve) => setTimeout(resolve, options.contextMenuRemoveAllDelayMs));
          }
          context.contextMenuItems = [];
          callback?.();
        },
        create(item, callback) {
          if (options.failOnDuplicateContextMenu && context.contextMenuItems.some((existing) => existing.id === item.id)) {
            context.chrome.runtime.lastError = { message: `Cannot create item with duplicate id ${item.id}` };
            callback?.();
            context.chrome.runtime.lastError = null;
            return item.id;
          }
          context.contextMenuItems.push(item);
          callback?.();
          return item.id;
        },
        onClicked: {
          addListener(listener) {
            context.contextMenuClickListener = listener;
          }
        }
      },
      commands: {
        onCommand: {
          addListener(listener) {
            context.commandListener = listener;
          }
        }
      },
      tabs: {
        onRemoved: { addListener() {} },
        onActivated: {
          addListener(listener) {
            context.tabsOnActivatedListener = listener;
          }
        },
        onUpdated: {
          addListener(listener) {
            context.tabsOnUpdatedListener = listener;
          }
        },
        query: async () => options.queryTabs || [],
        get: async (tabId) => {
          if (!tabsById[tabId]) throw new Error(`No mock tab for ${tabId}`);
          return tabsById[tabId];
        },
        sendMessage: options.sendMessage || (async () => ({ ok: true }))
      },
      scripting: {
        executeScript: async (options) => {
          context.scriptingCalls.push(options);
        }
      },
      storage: {
        onChanged: {
          addListener(listener) {
            context.storageOnChangedListener = listener;
          }
        },
        local: {
          async get(keysOrDefaults) {
            if (keysOrDefaults === null) {
              context.storageGetAllCount += 1;
              return { ...storage };
            }
            if (Array.isArray(keysOrDefaults)) {
              return Object.fromEntries(keysOrDefaults.map((key) => [key, storage[key]]));
            }
            if (typeof keysOrDefaults === "object") {
              return { ...keysOrDefaults, ...storage };
            }
            return { [keysOrDefaults]: storage[keysOrDefaults] };
          },
          async set(updates) {
            if (options.failStorageSet) {
              throw new Error("Mock storage quota exceeded.");
            }
            Object.assign(storage, updates);
          },
          async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) {
              delete storage[key];
            }
          }
        }
      }
    }
  };

  return vm.createContext(context);
}

function createLocaleFetch() {
  return async (url) => {
    const match = String(url || "").match(/^locale:\/\/_locales\/([^/]+)\/messages\.json$/);
    if (!match) {
      throw new Error(`Unexpected fetch URL: ${url}`);
    }

    const file = path.join(extensionDir, "_locales", match[1], "messages.json");
    return {
      ok: true,
      async json() {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      }
    };
  };
}

function loadBackground(context) {
  const source = fs.readFileSync(path.join(extensionDir, "background.js"), "utf8");
  vm.runInContext(source, context, { filename: "background.js" });
  assert.ok(context.runtimeMessageListener, "background should register a runtime message listener");
}

async function sendRuntimeMessage(context, message) {
  return new Promise((resolve, reject) => {
    const result = context.runtimeMessageListener(message, {}, resolve);
    if (result !== true) {
      reject(new Error("background listener should return true for async responses"));
    }
  });
}

async function sendRuntimeMessageFromTab(context, message, tab) {
  return new Promise((resolve, reject) => {
    const result = context.runtimeMessageListener(message, { tab }, resolve);
    if (result !== true) {
      reject(new Error("background listener should return true for async responses"));
    }
  });
}

async function sendRuntimeMessageWithTimeout(context, message, timeoutMs) {
  return Promise.race([
    sendRuntimeMessage(context, message),
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error("Timed out waiting for runtime response.")), timeoutMs);
    })
  ]);
}

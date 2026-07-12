const assert = require("assert");
const fs = require("fs");
const path = require("path");
const shared = require("../shared.js");

assert.strictEqual(
  shared.normalizeChatCompletionsUrl("https://api.example.com/v1"),
  "https://api.example.com/v1/chat/completions"
);

assert.strictEqual(
  shared.normalizeChatCompletionsUrl(" https://api.example.com/v1/chat/completions/ "),
  "https://api.example.com/v1/chat/completions"
);

assert.strictEqual(shared.getTranslationPlacement("li"), "inside");
assert.strictEqual(shared.getTranslationPlacement("p"), "after");

assert.ok(shared.getCandidateSelector().includes("p"));
assert.ok(shared.getCandidateSelector().includes("li"));
assert.ok(shared.getCandidateSelector().includes("figcaption"));

assert.deepStrictEqual(shared.getDynamicScanObserverOptions(), {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["class", "style", "hidden", "aria-hidden"]
});

assert.strictEqual(shared.getDynamicScanDebounceMs(), 500);

assert.strictEqual(shared.getViewportContextPadding(800), 960);
assert.strictEqual(shared.getViewportContextPadding(200), 360);
assert.strictEqual(shared.getViewportContextPadding(2000), 1400);

assert.strictEqual(shared.isRectNearViewport({ top: 1200, bottom: 1300 }, 800), true);
assert.strictEqual(shared.isRectNearViewport({ top: 1750, bottom: 1850 }, 800), true);
assert.strictEqual(shared.isRectNearViewport({ top: 1800, bottom: 1900 }, 800), false);
assert.strictEqual(shared.isRectNearViewport({ top: -500, bottom: -420 }, 800), true);
assert.strictEqual(shared.isRectNearViewport({ top: -1100, bottom: -1020 }, 800), false);

assert.strictEqual(shared.getViewportScanDebounceMs(), 300);
assert.strictEqual(shared.getMouseMoveScanThresholdPx(), 120);
assert.strictEqual(shared.getViewportMaxElementsPerScan(), 24);
assert.match(shared.DEFAULT_TRANSLATION_PROMPT, /line breaks/i);
assert.doesNotMatch(shared.DEFAULT_TRANSLATION_PROMPT, /JSON array/i);
assert.strictEqual(
  shared.isLegacyDefaultTranslationPrompt([
    "Translate the following webpage text from {{sourceLanguage}} to {{targetLanguage}}.",
    "Keep meaning, tone, names, numbers, URLs, and code unchanged.",
    "Return ONLY a JSON array. Each item must be: {\"id\":\"same id\",\"text\":\"translation\"}.",
    "Do not add explanations, markdown fences, comments, or extra keys."
  ].join("\n")),
  true
);
assert.strictEqual(shared.isLegacyDefaultTranslationPrompt("Use my own style."), false);

assert.deepStrictEqual(shared.normalizeCostSettings({}), {
  maxElementsPerScan: 24,
  maxTextLength: 1800,
  maxRequestsPerPage: 80,
  maxCharsPerPage: 60000,
  maxCharsPerBatch: 6000,
  maxConcurrentBatches: 2,
  viewportOnly: true
});

assert.deepStrictEqual(shared.normalizeCostSettings({
  maxElementsPerScan: 99,
  maxTextLength: 9999,
  maxRequestsPerPage: 999,
  maxCharsPerPage: 999999,
  maxCharsPerBatch: 999999,
  maxConcurrentBatches: 9,
  viewportOnly: false
}), {
  maxElementsPerScan: 60,
  maxTextLength: 4000,
  maxRequestsPerPage: 300,
  maxCharsPerPage: 200000,
  maxCharsPerBatch: 20000,
  maxConcurrentBatches: 3,
  viewportOnly: false
});

assert.deepStrictEqual(shared.normalizeCostSettings({
  maxElementsPerScan: 0,
  maxTextLength: 50,
  maxRequestsPerPage: 0,
  maxCharsPerPage: 10,
  maxCharsPerBatch: 100,
  maxConcurrentBatches: 0,
  viewportOnly: undefined
}), {
  maxElementsPerScan: 1,
  maxTextLength: 200,
  maxRequestsPerPage: 1,
  maxCharsPerPage: 1000,
  maxCharsPerBatch: 500,
  maxConcurrentBatches: 1,
  viewportOnly: true
});

const blockedSelector = shared.getBlockedContainerSelector();
assert.ok(blockedSelector.includes("[role=\"dialog\"]"));
assert.ok(blockedSelector.includes("[aria-modal=\"true\"]"));
assert.ok(blockedSelector.includes("[class*=\"advert\"]"));
assert.ok(shared.getStrictBlockedContainerSelector().includes("script"));
assert.ok(shared.getStrictBlockedContainerSelector().includes("[translate=\"no\"]"));
assert.ok(shared.getSoftBlockedContainerSelector().includes("nav"));
assert.ok(shared.getSoftBlockedContainerSelector().includes("header"));
assert.ok(shared.getMainContentSelector().includes("article"));
assert.ok(shared.getMainContentSelector().includes("[role=\"main\"]"));

assert.strictEqual(shared.shouldSkipTextByContent("www.quora.com"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Performing security verification"), true);
assert.strictEqual(shared.shouldSkipTextByContent("This website uses a security service to protect against malicious bots."), true);
assert.strictEqual(shared.shouldSkipTextByContent("LIVE UPDATES"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Live Updates"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Polymarket\n@Polymarket"), true);
assert.strictEqual(shared.shouldSkipTextByContent("@kimmonismus"), true);
assert.strictEqual(shared.shouldSkipTextByContent("76.5K\nViews"), true);
assert.strictEqual(shared.shouldSkipTextByContent("9:23 AM · Jun 28, 2026\n76.7K\nViews"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Updated 9:04 PM EDT, Sun June 28, 2026"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Ray ID: a131c86b9f3fcb94"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Performance and Security by Cloudflare Privacy"), true);
assert.strictEqual(shared.shouldSkipTextByContent("104 points by dhouston on April 4, 2007 | hide | past | favorite | 71 comments"), true);
assert.strictEqual(shared.shouldSkipTextByContent("BrandonM on April 5, 2007 | next [–] I have a few qualms with this app:"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Hacker News new | past | comments | ask | show | jobs | submit"), true);
assert.strictEqual(shared.shouldSkipTextByContent("View history"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Appearance move to sidebar hide"), true);
assert.strictEqual(shared.shouldSkipTextByContent("From Wikipedia, the free encyclopedia"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Part of a series on"), true);
assert.strictEqual(shared.shouldSkipTextByContent("show Major goals Artificial general intelligence"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Don't miss what's happening"), true);
assert.strictEqual(shared.shouldSkipTextByContent("People on X are the first to know."), true);
assert.strictEqual(shared.shouldSkipTextByContent("No releases published"), true);
assert.strictEqual(shared.shouldSkipTextByContent("No packages published"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Show more"), true);
assert.strictEqual(shared.shouldSkipTextByContent("Post"), true);
assert.strictEqual(shared.shouldSkipTextByContent("2h"), true);
assert.strictEqual(shared.shouldSkipTextByContent("US and Iran to ‘stand down for now,’ US official says after exchange of fire"), false);
assert.strictEqual(shared.shouldSkipTextByContent("Artificial intelligence is the capability of computational systems to perform tasks typically associated with human intelligence."), false);

assert.strictEqual(
  shared.isLikelyTargetLanguageText("这是一段已经是中文的内容，不需要再翻译。", "简体中文"),
  true
);
assert.strictEqual(
  shared.isLikelyTargetLanguageText("这是 OpenAI 发布的新模型说明，当前内容已经主要是中文。", "Chinese"),
  true
);
assert.strictEqual(
  shared.isLikelyTargetLanguageText("Grok 4.5 is now in private beta at SpaceX and Tesla.", "简体中文"),
  false
);
assert.strictEqual(
  shared.isLikelyTargetLanguageText("This paragraph is already written in English.", "English"),
  true
);
assert.strictEqual(
  shared.isLikelyTargetLanguageText("这段中文需要翻译成英文。", "English"),
  false
);

assert.strictEqual(
  shared.isLikelyTargetLanguagePage({ htmlLang: "zh-CN", text: "页面包含少量 English 引用。" }, "简体中文"),
  true
);
assert.strictEqual(
  shared.isLikelyTargetLanguagePage({
    htmlLang: "zh-CN",
    segments: [
      "这是一段中文页面正文，介绍产品功能和使用方式，用户已经可以直接阅读。",
      "第二段继续说明当前页面的主要内容，整体语言仍然是中文。",
      "第三段补充更多中文说明，只有少量外文引用不应该触发整页自动翻译。",
      "A short English quote appears here for context."
    ]
  }, "简体中文"),
  true
);
assert.strictEqual(
  shared.isLikelyTargetLanguagePage({
    htmlLang: "zh-CN",
    segments: [
      "这是一段已经是中文的内容，不需要再翻译。",
      "这是 OpenAI 发布的新模型说明，当前内容已经主要是中文。",
      "Grok 4.5 is now in private beta at SpaceX and Tesla."
    ]
  }, "简体中文"),
  true
);
assert.strictEqual(
  shared.isLikelyTargetLanguagePage({
    htmlLang: "en-US",
    segments: [
      "这是一小段中文导航。",
      "This article is written primarily in English and contains enough detail to be translated for Chinese readers.",
      "Another English paragraph explains the main story with more context and background."
    ]
  }, "简体中文"),
  false
);
assert.strictEqual(
  shared.isLikelyTargetLanguagePage({
    htmlLang: "zh-CN",
    text: "Mythos 6 Leaks: Already Exists? A new Mythos model has finished training internally and could launch soon."
  }, "简体中文"),
  false
);
assert.strictEqual(
  shared.isLikelyTargetLanguagePage({ htmlLang: "en-US", text: "This page is written in English." }, "简体中文"),
  false
);
assert.strictEqual(
  shared.isLikelyTargetLanguagePage({ htmlLang: "", text: "这是一段中文页面正文，当前页面已经是中文内容。" }, "Chinese"),
  true
);

assert.deepStrictEqual(shared.normalizeCacheSettings({}), {
  cacheTtlDays: 30,
  maxCacheEntries: 2000
});
assert.deepStrictEqual(shared.normalizeCacheSettings({ cacheTtlDays: 999, maxCacheEntries: 999999 }), {
  cacheTtlDays: 365,
  maxCacheEntries: 10000
});
assert.deepStrictEqual(shared.normalizeCacheSettings({ cacheTtlDays: 0, maxCacheEntries: 1 }), {
  cacheTtlDays: 1,
  maxCacheEntries: 100
});

const now = Date.UTC(2026, 5, 29);
assert.strictEqual(
  shared.isTranslationCacheEntryFresh({ text: "译文", savedAt: now - 10 * 24 * 60 * 60 * 1000 }, { cacheTtlDays: 30 }, now),
  true
);
assert.strictEqual(
  shared.isTranslationCacheEntryFresh({ text: "译文", savedAt: now - 31 * 24 * 60 * 60 * 1000 }, { cacheTtlDays: 30 }, now),
  false
);
assert.strictEqual(
  shared.isTranslationCacheEntryFresh({ text: "译文" }, { cacheTtlDays: 30 }, now),
  false
);

assert.match(
  shared.resolveTranslationPrompt({
    sourceLanguage: "English",
    targetLanguage: "简体中文",
    translationPrompt: "Translate from {{sourceLanguage}} to {{targetLanguage}} in a concise style."
  }),
  /English to 简体中文/
);

assert.strictEqual(
  shared.getEffectiveThinkingStrategy({
    provider: "custom",
    apiUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "doubao-seed-2.0-mini",
    thinkingStrategy: "auto"
  }),
  shared.THINKING_STRATEGIES.OMIT
);

const thinkingDetectionKey = shared.createThinkingStrategyDetectionKey({
  apiUrl: "https://ark.cn-beijing.volces.com/api/plan/v3/",
  model: " Doubao-Seed-2.0-Mini "
});
assert.strictEqual(
  thinkingDetectionKey,
  shared.createThinkingStrategyDetectionKey({
    apiUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "doubao-seed-2.0-mini"
  })
);
assert.strictEqual(
  shared.getEffectiveThinkingStrategy({
    provider: "custom",
    apiUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
    model: "doubao-seed-2.0-mini",
    thinkingStrategy: "auto",
    detectedThinkingStrategy: "thinking_disabled",
    thinkingStrategyDetectionKey: thinkingDetectionKey
  }),
  shared.THINKING_STRATEGIES.THINKING_DISABLED
);
assert.strictEqual(
  shared.getEffectiveThinkingStrategy({
    apiUrl: "https://example.com/v1",
    model: "doubao-seed-2.0-mini",
    thinkingStrategy: "auto",
    detectedThinkingStrategy: "thinking_disabled",
    thinkingStrategyDetectionKey: thinkingDetectionKey
  }),
  shared.THINKING_STRATEGIES.OMIT
);
assert.strictEqual(
  shared.getEffectiveThinkingStrategy({
    apiUrl: "https://example.com/v1",
    model: "any-model",
    thinkingStrategy: "dashscope_enable_thinking",
    detectedThinkingStrategy: "thinking_disabled",
    thinkingStrategyDetectionKey: "stale"
  }),
  shared.THINKING_STRATEGIES.DASHSCOPE_ENABLE_THINKING
);

const cacheKeyA = shared.createTranslationCacheKey({
  model: "gpt-4o-mini",
  sourceLanguage: "English",
  targetLanguage: "简体中文"
}, "Hello world.");

const cacheKeyB = shared.createTranslationCacheKey({
  model: "gpt-4o-mini",
  sourceLanguage: "English",
  targetLanguage: "简体中文"
}, "Hello world.");

const cacheKeyC = shared.createTranslationCacheKey({
  model: "gpt-4o-mini",
  sourceLanguage: "English",
  targetLanguage: "繁體中文"
}, "Hello world.");

const cacheKeyD = shared.createTranslationCacheKey({
  model: "gpt-4o-mini",
  sourceLanguage: "English",
  targetLanguage: "简体中文",
  translationPrompt: "Use a formal style."
}, "Hello world.");

assert.strictEqual(cacheKeyA, cacheKeyB);
assert.notStrictEqual(cacheKeyA, cacheKeyC);
assert.notStrictEqual(cacheKeyA, cacheKeyD);
assert.ok(cacheKeyA.startsWith("llm_translator_cache:"));

assertI18nLocaleCoverage();

function assertI18nLocaleCoverage() {
  const rootDir = path.resolve(__dirname, "..");
  const sourceFiles = [
    "manifest.json",
    "popup.html",
    "options.html",
    "popup.js",
    "options.js",
    "background.js",
    "content.js"
  ];
  const keys = new Set(["htmlLang"]);

  for (const file of sourceFiles) {
    const source = fs.readFileSync(path.join(rootDir, file), "utf8");
    for (const match of source.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) keys.add(match[1]);
    for (const match of source.matchAll(/\bt\("([^"]+)"/g)) keys.add(match[1]);
    for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) keys.add(match[1]);
  }

  for (const locale of ["zh_CN", "zh_TW", "en", "ja"]) {
    const messagesPath = path.join(rootDir, "_locales", locale, "messages.json");
    const messages = JSON.parse(fs.readFileSync(messagesPath, "utf8"));
    const missing = Array.from(keys).filter((key) => !messages[key]?.message);
    assert.deepStrictEqual(missing, [], `${locale} is missing i18n messages`);
  }
}

console.log("shared helper tests passed");

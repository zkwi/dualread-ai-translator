(function (root) {
  const DEFAULT_API_URL = "https://api.openai.com/v1/chat/completions";
  const CACHE_PREFIX = "llm_translator_cache:";
  const VIEWPORT_CONTEXT_RATIO = 1.2;
  const VIEWPORT_MIN_PADDING_PX = 360;
  const VIEWPORT_MAX_PADDING_PX = 1400;
  const VIEWPORT_SCAN_DEBOUNCE_MS = 300;
  const MOUSE_MOVE_SCAN_THRESHOLD_PX = 120;
  const VIEWPORT_MAX_ELEMENTS_PER_SCAN = 24;
  const DEFAULT_MAX_TEXT_LENGTH = 1800;
  const DEFAULT_MAX_REQUESTS_PER_PAGE = 80;
  const DEFAULT_MAX_CHARS_PER_PAGE = 60000;
  const DEFAULT_MAX_CHARS_PER_BATCH = 6000;
  const DEFAULT_MAX_CONCURRENT_BATCHES = 2;
  const DEFAULT_CACHE_TTL_DAYS = 30;
  const DEFAULT_MAX_CACHE_ENTRIES = 2000;
  const DEFAULT_VIEWPORT_ONLY = true;
  const DEFAULT_UI_LANGUAGE = "auto";
  const DEEPSEEK_DEFAULT_API_URL = "https://api.deepseek.com/chat/completions";
  const DEEPSEEK_DEFAULT_MODEL = "deepseek-v4-flash";
  const LEGACY_DEEPSEEK_API_URLS = new Set([
    "https://api.deepseek.com/v1",
    "https://api.deepseek.com/v1/chat/completions"
  ]);
  const LEGACY_DEEPSEEK_MODELS = new Set(["deepseek-chat"]);
  const SUPPORTED_UI_LANGUAGES = new Set(["auto", "zh_CN", "zh_TW", "en", "ja"]);
  const THINKING_STRATEGIES = Object.freeze({
    AUTO: "auto",
    DASHSCOPE_ENABLE_THINKING: "dashscope_enable_thinking",
    THINKING_DISABLED: "thinking_disabled",
    OPENROUTER_REASONING_LOW: "openrouter_reasoning_low",
    OPENROUTER_REASONING_MINIMAL: "openrouter_reasoning_minimal",
    QWEN_CHAT_TEMPLATE_KWARGS: "qwen_chat_template_kwargs",
    OMIT: "omit"
  });
  const THINKING_STRATEGY_VALUES = new Set(Object.values(THINKING_STRATEGIES));
  const DEFAULT_TRANSLATION_PROMPT = [
    "Translate the following webpage text from {{sourceLanguage}} to {{targetLanguage}}.",
    "Keep meaning, tone, names, numbers, URLs, and code unchanged.",
    "Preserve paragraph breaks, line breaks, and bullet/list structure."
  ].join("\n");
  const COST_PROFILES = {
    economy: {
      batchSize: 6,
      maxCharsPerBatch: 4000,
      maxElementsPerScan: 12,
      maxTextLength: 1200,
      maxRequestsPerPage: 40,
      maxCharsPerPage: 30000,
      maxConcurrentBatches: 1,
      viewportOnly: true
    },
    balanced: {
      batchSize: 8,
      maxCharsPerBatch: DEFAULT_MAX_CHARS_PER_BATCH,
      maxElementsPerScan: VIEWPORT_MAX_ELEMENTS_PER_SCAN,
      maxTextLength: DEFAULT_MAX_TEXT_LENGTH,
      maxRequestsPerPage: DEFAULT_MAX_REQUESTS_PER_PAGE,
      maxCharsPerPage: DEFAULT_MAX_CHARS_PER_PAGE,
      maxConcurrentBatches: DEFAULT_MAX_CONCURRENT_BATCHES,
      viewportOnly: DEFAULT_VIEWPORT_ONLY
    },
    eager: {
      batchSize: 10,
      maxCharsPerBatch: 8000,
      maxElementsPerScan: 36,
      maxTextLength: 2400,
      maxRequestsPerPage: 140,
      maxCharsPerPage: 100000,
      maxConcurrentBatches: 3,
      viewportOnly: true
    }
  };
  const DEFAULT_SETTINGS = {
    provider: "openai",
    uiLanguage: DEFAULT_UI_LANGUAGE,
    apiUrl: DEFAULT_API_URL,
    apiKey: "",
    model: "gpt-4o-mini",
    sourceLanguage: "English",
    targetLanguage: "简体中文",
    costProfile: "balanced",
    batchSize: COST_PROFILES.balanced.batchSize,
    maxElementsPerScan: COST_PROFILES.balanced.maxElementsPerScan,
    maxTextLength: COST_PROFILES.balanced.maxTextLength,
    maxRequestsPerPage: COST_PROFILES.balanced.maxRequestsPerPage,
    maxCharsPerPage: COST_PROFILES.balanced.maxCharsPerPage,
    maxCharsPerBatch: COST_PROFILES.balanced.maxCharsPerBatch,
    maxConcurrentBatches: COST_PROFILES.balanced.maxConcurrentBatches,
    cacheTtlDays: DEFAULT_CACHE_TTL_DAYS,
    maxCacheEntries: DEFAULT_MAX_CACHE_ENTRIES,
    apiTimeoutMs: 120000,
    disableThinking: true,
    thinkingStrategy: THINKING_STRATEGIES.AUTO,
    detectedThinkingStrategy: "",
    thinkingStrategyDetectionKey: "",
    autoTranslate: false,
    displayMode: "bilingual",
    viewportOnly: COST_PROFILES.balanced.viewportOnly,
    translationPrompt: DEFAULT_TRANSLATION_PROMPT
  };
  const LEGACY_DEFAULT_API_TIMEOUT_MS = [25000, 45000, 90000];
  const LEGACY_DEFAULT_TRANSLATION_PROMPTS = [
    [
      "Translate the following webpage text from {{sourceLanguage}} to {{targetLanguage}}.",
      "Keep meaning, tone, names, numbers, URLs, and code unchanged.",
      "Preserve paragraph breaks, line breaks, and bullet/list structure.",
      "Return ONLY a JSON array. Each item must be: {\"id\":\"same id\",\"text\":\"translation\"}.",
      "Do not add explanations, markdown fences, comments, or extra keys."
    ].join("\n"),
    [
      "Translate the following webpage text from {{sourceLanguage}} to {{targetLanguage}}.",
      "Keep meaning, tone, names, numbers, URLs, and code unchanged.",
      "Return ONLY a JSON array. Each item must be: {\"id\":\"same id\",\"text\":\"translation\"}.",
      "Do not add explanations, markdown fences, comments, or extra keys."
    ].join("\n")
  ];
  const STRICT_BLOCKED_CONTAINER_SELECTOR = [
    "script",
    "style",
    "noscript",
    "template",
    "iframe",
    "object",
    "embed",
    "canvas",
    "svg",
    "math",
    "pre",
    "code",
    "textarea",
    "input",
    "select",
    "button",
    "form",
    "dialog",
    "[role=\"dialog\"]",
    "[aria-modal=\"true\"]",
    "[aria-hidden=\"true\"]",
    "[contenteditable=\"true\"]",
    "[translate=\"no\"]",
    ".notranslate",
    "[class*=\"advert\"]",
    "[class*=\"sponsor\"]",
    "[class*=\"promoted\"]",
    "[class*=\"paywall\"]",
    "[class*=\"modal\"]",
    "[class*=\"popup\"]",
    "[id*=\"advert\"]",
    "[id*=\"sponsor\"]",
    "[id*=\"paywall\"]",
    "[id*=\"modal\"]"
  ].join(",");

  let i18nMessages = null;
  let i18nLocale = DEFAULT_UI_LANGUAGE;

  const SOFT_BLOCKED_CONTAINER_SELECTOR = [
    "nav",
    "header",
    "footer",
    "aside",
    "[role=\"banner\"]",
    "[role=\"navigation\"]",
    "[role=\"complementary\"]"
  ].join(",");

  const MAIN_CONTENT_SELECTOR = [
    "main",
    "article",
    "[role=\"main\"]",
    "[role=\"article\"]"
  ].join(",");

  const READABLE_BLOCK_SELECTOR = [
    "p",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "td",
    "th",
    "figcaption"
  ].join(",");
  const LOW_VALUE_TEXT_PHRASES = [
    // Security / bot-check pages
    "performing security verification",
    "security service to protect against malicious bots",
    "you've been blocked by network security",
    "your request has been blocked",
    "blocked due to a network policy",
    "file a ticket",
    "enable javascript",
    "drm system not supported",
    "digital rights management (drm) system required to play this content",
    // Login / signup prompts
    "log in to continue",
    "sign up to continue",
    // X / social chrome
    "don't miss what's happening",
    "people on x are the first to know",
    // News update labels
    "live updates",
    "latest updates",
    // Repository metadata / empty states
    "no releases published",
    "no packages published"
  ];
  const DYNAMIC_SCAN_DEBOUNCE_MS = 500;

  function normalizeChatCompletionsUrl(apiUrl) {
    const trimmed = String(apiUrl || "").trim().replace(/\/+$/, "");
    if (!trimmed) return DEFAULT_API_URL;
    if (trimmed.endsWith("/chat/completions")) return trimmed;
    if (trimmed.endsWith("/v1")) return `${trimmed}/chat/completions`;
    return `${trimmed}/chat/completions`;
  }

  function normalizeThinkingStrategy(strategy) {
    const value = String(strategy || "").trim();
    return THINKING_STRATEGY_VALUES.has(value) ? value : THINKING_STRATEGIES.AUTO;
  }

  function getEffectiveThinkingStrategy(settings = {}) {
    const configured = normalizeThinkingStrategy(settings.thinkingStrategy);
    if (configured !== THINKING_STRATEGIES.AUTO) return configured;
    const detectionKey = createThinkingStrategyDetectionKey(settings);
    if (!detectionKey || settings.thinkingStrategyDetectionKey !== detectionKey) {
      return THINKING_STRATEGIES.OMIT;
    }

    const detected = normalizeThinkingStrategy(settings.detectedThinkingStrategy);
    return detected === THINKING_STRATEGIES.AUTO ? THINKING_STRATEGIES.OMIT : detected;
  }

  function createThinkingStrategyDetectionKey(settings = {}) {
    const rawApiUrl = String(settings.apiUrl || "").trim();
    const model = String(settings.model || "").trim().toLowerCase();
    if (!rawApiUrl || !model) return "";
    const apiUrl = normalizeChatCompletionsUrl(rawApiUrl).toLowerCase();
    return `${apiUrl}\n${model}`;
  }

  function isLegacyDeepSeekPreset(settings = {}) {
    const provider = String(settings.provider || "").trim().toLowerCase();
    const apiUrl = String(settings.apiUrl || "").trim().replace(/\/+$/, "").toLowerCase();
    const model = String(settings.model || "").trim().toLowerCase();
    return provider === "deepseek"
      && LEGACY_DEEPSEEK_API_URLS.has(apiUrl)
      && LEGACY_DEEPSEEK_MODELS.has(model);
  }

  function getTranslationPlacement(tagName) {
    return String(tagName || "").toLowerCase() === "li" ? "inside" : "after";
  }

  function getCandidateSelector() {
    return READABLE_BLOCK_SELECTOR;
  }

  function getDynamicScanObserverOptions() {
    return {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden"]
    };
  }

  function getDynamicScanDebounceMs() {
    return DYNAMIC_SCAN_DEBOUNCE_MS;
  }

  function getViewportContextPadding(viewportHeight) {
    const height = Number(viewportHeight) || 0;
    // 只预取当前视口附近内容，兼顾阅读连续性和 token 成本。
    const padding = Math.round(height * VIEWPORT_CONTEXT_RATIO);
    return Math.max(VIEWPORT_MIN_PADDING_PX, Math.min(VIEWPORT_MAX_PADDING_PX, padding));
  }

  function isRectNearViewport(rect, viewportHeight) {
    if (!rect) return false;
    const padding = getViewportContextPadding(viewportHeight);
    return rect.bottom >= -padding && rect.top <= viewportHeight + padding;
  }

  function getViewportScanDebounceMs() {
    return VIEWPORT_SCAN_DEBOUNCE_MS;
  }

  function getMouseMoveScanThresholdPx() {
    return MOUSE_MOVE_SCAN_THRESHOLD_PX;
  }

  function getViewportMaxElementsPerScan() {
    return VIEWPORT_MAX_ELEMENTS_PER_SCAN;
  }

  function normalizeCostSettings(settings) {
    const input = settings || {};
    return {
      maxElementsPerScan: clampNumber(input.maxElementsPerScan, 1, 60, VIEWPORT_MAX_ELEMENTS_PER_SCAN),
      maxTextLength: clampNumber(input.maxTextLength, 200, 4000, DEFAULT_MAX_TEXT_LENGTH),
      maxRequestsPerPage: clampNumber(input.maxRequestsPerPage, 1, 300, DEFAULT_MAX_REQUESTS_PER_PAGE),
      maxCharsPerPage: clampNumber(input.maxCharsPerPage, 1000, 200000, DEFAULT_MAX_CHARS_PER_PAGE),
      maxCharsPerBatch: clampNumber(input.maxCharsPerBatch, 500, 20000, DEFAULT_MAX_CHARS_PER_BATCH),
      maxConcurrentBatches: clampNumber(input.maxConcurrentBatches, 1, 3, DEFAULT_MAX_CONCURRENT_BATCHES),
      viewportOnly: input.viewportOnly === undefined ? DEFAULT_VIEWPORT_ONLY : input.viewportOnly !== false
    };
  }

  function normalizeCacheSettings(settings) {
    const input = settings || {};
    return {
      cacheTtlDays: clampNumber(input.cacheTtlDays, 1, 365, DEFAULT_CACHE_TTL_DAYS),
      maxCacheEntries: clampNumber(input.maxCacheEntries, 100, 10000, DEFAULT_MAX_CACHE_ENTRIES)
    };
  }

  function isTranslationCacheEntryFresh(entry, settings, now = Date.now()) {
    if (!entry?.text || !Number.isFinite(Number(entry.savedAt))) return false;
    const cacheSettings = normalizeCacheSettings(settings);
    const ttlMs = cacheSettings.cacheTtlDays * 24 * 60 * 60 * 1000;
    return Number(entry.savedAt) + ttlMs >= now;
  }

  function resolveTranslationPrompt(settings) {
    const input = settings || {};
    const template = String(input.translationPrompt || "").trim() || DEFAULT_TRANSLATION_PROMPT;
    const sourceLanguage = String(input.sourceLanguage || "English").trim() || "English";
    const targetLanguage = String(input.targetLanguage || "简体中文").trim() || "简体中文";

    return template
      .replace(/\{\{sourceLanguage\}\}/g, sourceLanguage)
      .replace(/\{\{targetLanguage\}\}/g, targetLanguage);
  }

  function isLegacyDefaultTranslationPrompt(prompt) {
    const value = String(prompt || "").trim();
    return LEGACY_DEFAULT_TRANSLATION_PROMPTS.includes(value);
  }

  function getBlockedContainerSelector() {
    return [
      STRICT_BLOCKED_CONTAINER_SELECTOR,
      SOFT_BLOCKED_CONTAINER_SELECTOR
    ].filter(Boolean).join(",");
  }

  function getStrictBlockedContainerSelector() {
    return STRICT_BLOCKED_CONTAINER_SELECTOR;
  }

  function getSoftBlockedContainerSelector() {
    return SOFT_BLOCKED_CONTAINER_SELECTOR;
  }

  function getMainContentSelector() {
    return MAIN_CONTENT_SELECTOR;
  }

  function shouldSkipTextByContent(text) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return true;

    const lower = clean.toLowerCase();
    if (/^(https?:\/\/)?(www\.)?[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(clean)) {
      return true;
    }

    if (LOW_VALUE_TEXT_PHRASES.some((phrase) => lower.includes(phrase))) {
      return true;
    }

    if (/^[\p{L}\p{N}_ .'-]{1,40}\s*@[\w.-]{2,30}$/u.test(clean)) {
      return true;
    }

    if (/^@[\w.-]{2,30}$/i.test(clean)) {
      return true;
    }

    if (/@[\w.-]{2,30}/.test(clean) && clean.length <= 64 && !/[.!?。！？]/.test(clean)) {
      const words = clean.match(/[\p{L}\p{N}]+/gu) || [];
      if (words.length <= 4) return true;
    }

    if (/^\d+(?:[.,]\d+)?[KMB]?\s+(views?|likes?|reposts?|replies?)$/i.test(clean)) {
      return true;
    }

    if (/\bviews?\b/i.test(clean) && /\b(am|pm|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(clean) && clean.length <= 100) {
      return true;
    }

    if (/^(updated|published)\s+\d{1,2}:\d{2}/i.test(clean)) {
      return true;
    }

    if (/^ray id:/i.test(clean) || /performance and security by cloudflare/i.test(clean)) {
      return true;
    }

    if (/^\d+\s+points?\s+by\b/i.test(clean)) {
      return true;
    }

    if (/^[A-Za-z0-9_-]{2,}\s+on\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)\s+\d{1,2},\s+\d{4}\s+\|/i.test(clean)) {
      return true;
    }

    if ((clean.match(/\|/g) || []).length >= 2 && clean.length <= 120 && !/[.!?。！？]/.test(clean)) {
      return true;
    }

    if (/^view history$/i.test(clean)) {
      return true;
    }

    if (/^from .+, the free encyclopedia$/i.test(clean)) {
      return true;
    }

    if (/^part of a series on$/i.test(clean)) {
      return true;
    }

    if (/^show\s+/i.test(clean) && clean.length <= 180 && !/[.!?。！？]/.test(clean)) {
      return true;
    }

    if (/^(appearance|text|width|color)\b/i.test(clean) && /\b(sidebar|hide|small|standard|large|wide|automatic|light|dark)\b/i.test(clean)) {
      return true;
    }

    if (/^(read more|show more|see more|view more|reply|repost|quote|like|share|follow|subscribe|sign in|log in)$/i.test(clean)) {
      return true;
    }

    if (/^post$/i.test(clean)) {
      return true;
    }

    if (/^\d+[smhdwy]$/i.test(clean)) {
      return true;
    }

    if (clean.length <= 32 && /^[A-Z0-9\s&|:./_-]+$/.test(clean) && /[A-Z]{3,}/.test(clean)) {
      return true;
    }

    return false;
  }

  function isLikelyTargetLanguageText(text, targetLanguage) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    const target = normalizeTargetLanguageKind(targetLanguage);
    if (!clean || !target) return false;

    const han = countMatches(clean, /[\u3400-\u9fff\uf900-\ufaff]/g);
    const kana = countMatches(clean, /[\u3040-\u30ff]/g);
    const hangul = countMatches(clean, /[\uac00-\ud7af]/g);
    const latin = countMatches(clean, /[A-Za-z]/g);

    if (target === "zh") {
      return isDominantScript(han, latin + kana + hangul, 4, 0.35);
    }

    if (target === "ja") {
      return isDominantScript(kana + han, latin + hangul, 4, 0.35);
    }

    if (target === "ko") {
      return isDominantScript(hangul, latin + han + kana, 4, 0.35);
    }

    if (target === "en") {
      const words = clean.match(/[A-Za-z][A-Za-z'-]*/g) || [];
      return words.length >= 4 && latin >= 20 && latin / Math.max(1, latin + han + kana + hangul) >= 0.8;
    }

    return false;
  }

  function isLikelyTargetLanguagePage(pageInfo, targetLanguage) {
    const target = normalizeTargetLanguageKind(targetLanguage);
    if (!target) return false;

    const segments = normalizePageLanguageSegments(pageInfo?.segments);
    if (segments.length > 0) {
      const segmentDecision = isTargetLanguageDominantPageSegments(segments, targetLanguage);
      if (segmentDecision !== null) return segmentDecision;
    }

    const text = String(pageInfo?.text || "").trim();
    if (text) {
      return isLikelyTargetLanguageText(text, targetLanguage);
    }

    return false;
  }

  function normalizePageLanguageSegments(segments) {
    if (!Array.isArray(segments)) return [];

    return segments
      .map((segment) => String(segment || "").replace(/\s+/g, " ").trim())
      .filter((segment) => segment.length >= 8 && !shouldSkipTextByContent(segment))
      .slice(0, 48);
  }

  function isTargetLanguageDominantPageSegments(segments, targetLanguage) {
    const target = normalizeTargetLanguageKind(targetLanguage);
    const minTargetUnits = target === "en" ? 80 : 24;
    const minTargetRatio = target === "en" ? 0.55 : 0.3;
    let targetSegments = 0;
    let otherSegments = 0;
    let targetUnits = 0;
    let otherUnits = 0;

    for (const segment of segments) {
      const counts = getScriptCounts(segment);
      const targetCount = getTargetScriptCount(counts, target);
      const otherCount = getOtherScriptCount(counts, target);
      const minSegmentUnits = target === "en" ? 20 : 4;

      if (targetCount < minSegmentUnits && otherCount < minSegmentUnits) continue;

      targetUnits += targetCount;
      otherUnits += otherCount;

      if (isDominantScript(targetCount, otherCount, minSegmentUnits, target === "en" ? 0.65 : 0.35)) {
        targetSegments += 1;
      } else if (otherCount > targetCount && otherCount >= minSegmentUnits) {
        otherSegments += 1;
      }
    }

    const meaningfulSegments = targetSegments + otherSegments;
    if (meaningfulSegments === 0) return null;

    const segmentRatio = targetSegments / meaningfulSegments;
    const unitRatio = targetUnits / Math.max(1, targetUnits + otherUnits);

    return targetSegments >= 2
      && targetUnits >= minTargetUnits
      && segmentRatio >= 0.6
      && unitRatio >= minTargetRatio;
  }

  function getScriptCounts(text) {
    return {
      han: countMatches(text, /[\u3400-\u9fff\uf900-\ufaff]/g),
      kana: countMatches(text, /[\u3040-\u30ff]/g),
      hangul: countMatches(text, /[\uac00-\ud7af]/g),
      latin: countMatches(text, /[A-Za-z]/g)
    };
  }

  function getTargetScriptCount(counts, target) {
    if (target === "zh") return counts.han;
    if (target === "ja") return counts.kana + counts.han;
    if (target === "ko") return counts.hangul;
    if (target === "en") return counts.latin;
    return 0;
  }

  function getOtherScriptCount(counts, target) {
    if (target === "zh") return counts.latin + counts.kana + counts.hangul;
    if (target === "ja") return counts.latin + counts.hangul;
    if (target === "ko") return counts.latin + counts.han + counts.kana;
    if (target === "en") return counts.han + counts.kana + counts.hangul;
    return 0;
  }

  function normalizeTargetLanguageKind(language) {
    const value = String(language || "").trim().toLowerCase();
    if (!value) return "";

    if (/^(zh|zh-cn|zh-hans|zh-hant|chinese|mandarin)$/.test(value) || /中文|汉语|漢語|简体|簡體|繁体|繁體/.test(value)) {
      return "zh";
    }

    if (/^(en|en-us|en-gb|english)$/.test(value) || /英语|英文/.test(value)) {
      return "en";
    }

    if (/^(ja|ja-jp|japanese)$/.test(value) || /日语|日文|日本語/.test(value)) {
      return "ja";
    }

    if (/^(ko|ko-kr|korean)$/.test(value) || /韩语|韓語|朝鲜语|朝鮮語|한국어/.test(value)) {
      return "ko";
    }

    return "";
  }

  function isDominantScript(targetCount, otherCount, minCount, minRatio) {
    if (targetCount < minCount) return false;
    return targetCount / Math.max(1, targetCount + otherCount) >= minRatio;
  }

  function countMatches(text, pattern) {
    const matches = String(text || "").match(pattern);
    return matches ? matches.length : 0;
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(min, Math.min(max, Math.round(number)));
  }

  function createTranslationCacheKey(settings, text) {
    const payload = [
      normalizeChatCompletionsUrl(settings.apiUrl || ""),
      settings.model || "",
      settings.sourceLanguage || "",
      settings.targetLanguage || "",
      resolveTranslationPrompt(settings),
      String(text || "").trim()
    ].join("\n");

    return `${CACHE_PREFIX}${simpleHash(payload)}`;
  }

  function normalizeUiLanguage(value) {
    const language = String(value || DEFAULT_UI_LANGUAGE).trim();
    return SUPPORTED_UI_LANGUAGES.has(language) ? language : DEFAULT_UI_LANGUAGE;
  }

  async function setUiLanguage(uiLanguage) {
    const language = normalizeUiLanguage(uiLanguage);
    if (language === i18nLocale && (language === DEFAULT_UI_LANGUAGE || i18nMessages)) return language;

    i18nLocale = language;
    i18nMessages = null;
    if (language === DEFAULT_UI_LANGUAGE) return language;

    try {
      const url = root.chrome?.runtime?.getURL?.(`_locales/${language}/messages.json`);
      if (!url || typeof root.fetch !== "function") return language;
      const response = await root.fetch(url);
      if (response.ok) {
        i18nMessages = await response.json();
      }
    } catch (error) {
      i18nMessages = null;
    }

    return language;
  }

  function setI18nMessages(messages, locale = DEFAULT_UI_LANGUAGE) {
    i18nLocale = normalizeUiLanguage(locale);
    i18nMessages = messages || null;
  }

  function applySubstitutions(template, substitutions = []) {
    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    return String(template || "").replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1] ?? "");
  }

  function i18n(messageName, substitutions = [], fallback = "") {
    const override = i18nMessages?.[messageName]?.message;
    if (override) return applySubstitutions(override, substitutions);

    const values = Array.isArray(substitutions) ? substitutions : [substitutions];
    try {
      const message = root.chrome?.i18n?.getMessage?.(messageName, values);
      if (message) return message;
    } catch (error) {
      // 测试环境没有 chrome.i18n 时使用调用方提供的中文兜底。
    }

    return fallback || messageName;
  }

  function applyI18n(targetRoot = root.document) {
    const doc = targetRoot?.nodeType === 9 ? targetRoot : targetRoot?.ownerDocument;
    if (!targetRoot || !doc) return;

    const htmlLang = i18n("htmlLang", [], "");
    if (htmlLang && doc.documentElement) {
      doc.documentElement.lang = htmlLang;
    }

    const textNodes = targetRoot.querySelectorAll?.("[data-i18n]") || [];
    textNodes.forEach((node) => {
      node.textContent = i18n(node.dataset.i18n, [], node.textContent);
    });

    const attrMap = [
      ["data-i18n-title", "title"],
      ["data-i18n-placeholder", "placeholder"],
      ["data-i18n-aria-label", "aria-label"]
    ];

    for (const [dataAttr, attr] of attrMap) {
      const nodes = targetRoot.querySelectorAll?.(`[${dataAttr}]`) || [];
      nodes.forEach((node) => {
        const key = node.getAttribute(dataAttr);
        node.setAttribute(attr, i18n(key, [], node.getAttribute(attr) || ""));
      });
    }
  }

  function simpleHash(text) {
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  const api = {
    CACHE_PREFIX,
    DEFAULT_TRANSLATION_PROMPT,
    DEFAULT_SETTINGS,
    DEEPSEEK_DEFAULT_API_URL,
    DEEPSEEK_DEFAULT_MODEL,
    COST_PROFILES,
    THINKING_STRATEGIES,
    LEGACY_DEFAULT_API_TIMEOUT_MS,
    isLegacyDefaultTranslationPrompt,
    isLegacyDeepSeekPreset,
    normalizeChatCompletionsUrl,
    normalizeThinkingStrategy,
    createThinkingStrategyDetectionKey,
    getEffectiveThinkingStrategy,
    getTranslationPlacement,
    getCandidateSelector,
    getDynamicScanObserverOptions,
    getDynamicScanDebounceMs,
    getViewportContextPadding,
    isRectNearViewport,
    getViewportScanDebounceMs,
    getMouseMoveScanThresholdPx,
    getViewportMaxElementsPerScan,
    normalizeCostSettings,
    normalizeCacheSettings,
    normalizeTargetLanguageKind,
    i18n,
    setUiLanguage,
    setI18nMessages,
    normalizeUiLanguage,
    applyI18n,
    getBlockedContainerSelector,
    getStrictBlockedContainerSelector,
    getSoftBlockedContainerSelector,
    getMainContentSelector,
    shouldSkipTextByContent,
    isLikelyTargetLanguageText,
    isLikelyTargetLanguagePage,
    isTranslationCacheEntryFresh,
    resolveTranslationPrompt,
    createTranslationCacheKey
  };

  root.LLMTranslatorShared = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

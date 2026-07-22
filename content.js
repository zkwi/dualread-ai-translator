(() => {
  const CONTENT_SCRIPT_VERSION = "0.10.2";
  const existingTranslatorState = window.__llmBilingualTranslator;
  if (existingTranslatorState) {
    if (existingTranslatorState.version === CONTENT_SCRIPT_VERSION) {
      return;
    }

    if (existingTranslatorState.runtimeMessageListener) {
      cleanupExistingTranslatorState(existingTranslatorState);
    } else {
      document.documentElement.setAttribute("data-llm-translator-version", CONTENT_SCRIPT_VERSION);
      document.documentElement.setAttribute("data-llm-translator-auto", "reload-required");
      showReloadRequiredNotice();
      return;
    }
  }

  const { i18n: t, setUiLanguage } = LLMTranslatorShared;
  const state = {
    active: false,
    version: CONTENT_SCRIPT_VERSION,
    autoStartStatus: null,
    observer: null,
    queue: [],
    queuedIds: new Set(),
    translationPort: null,
    streamRequests: new Map(),
    activeStreams: 0,
    streamCounter: 0,
    counter: 0,
    settings: null,
    runId: 0,
    pageLanguageContext: null,
    mutationObserver: null,
    mutationScanTimer: null,
    pendingScanRoots: new Set(),
    viewportScanTimer: null,
    viewportSampleCache: null,
    lastMouseY: null,
    lastViewportSnapshot: null,
    handleScrollOrResize: null,
    handleMouseMove: null,
    budget: createEmptyBudget(),
    translationVisible: true,
    displayMode: "bilingual",
    stats: createEmptyStats()
  };

  window.__llmBilingualTranslator = state;
  setAutoStartStatus("loaded");

  // getCleanText 很贵（递归子树 + 逐元素读样式），同一元素在一次扫描里会被多处调用；
  // 缓存到下一次页面内容变更为止，MutationObserver 里统一失效。
  const cleanTextCache = new WeakMap();
  const translationTextCache = new WeakMap();
  // 译文节点按元素记忆：插入锚点依赖 isVisuallyClipped 等易变布局状态，
  // 状态更新时重算锚点会导致同一元素插入第二个节点，这里首次插入后固定复用。
  const translationNodesByElement = new WeakMap();
  const translationRecordByElement = new WeakMap();
  const translationRecordsByKey = new Map();
  const contentUnitIds = new WeakMap();
  let contentUnitCounter = 0;

  state.translationRecordsByKey = translationRecordsByKey;

  function getMemoizedTranslationNode(element) {
    const recordNode = translationRecordByElement.get(element)?.translationNode;
    if (recordNode?.isConnected) return recordNode;
    const node = translationNodesByElement.get(element);
    return node?.isConnected ? node : null;
  }

  function getTranslationRecord(element) {
    return translationRecordByElement.get(element) || null;
  }

  function getTranslationProfileKey(settings = state.settings) {
    return LLMTranslatorShared.simpleHash(JSON.stringify({
      apiUrl: String(settings?.apiUrl || "").trim(),
      model: String(settings?.model || "").trim(),
      sourceLanguage: String(settings?.sourceLanguage || "").trim(),
      targetLanguage: String(settings?.targetLanguage || "").trim(),
      translationPrompt: String(settings?.translationPrompt || "").trim()
    }));
  }

  function resolveContentUnit(element) {
    const explicitUnit = element.closest?.([
      "article",
      "[role=\"article\"]",
      "li",
      "blockquote",
      "shreddit-post",
      "shreddit-comment"
    ].join(","));
    if (explicitUnit) return explicitUnit;

    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      if (getStableContentPermalink(current)
        || getStableElementIdentity(current)) {
        return current;
      }
      const parent = current.parentElement;
      if (!parent) break;
      if (parent.matches?.("main,[role=\"main\"],section,body")) return current;
      current = parent;
    }

    return element.parentElement || element;
  }

  function getContentUnitIdentity(element) {
    const contentUnit = resolveContentUnit(element);
    const permalink = getStableContentPermalink(contentUnit);
    if (permalink) {
      return `permalink-${LLMTranslatorShared.simpleHash(permalink)}`;
    }
    const stableIdentity = getStableElementIdentity(contentUnit);
    if (stableIdentity) {
      return `element-${LLMTranslatorShared.simpleHash(stableIdentity)}`;
    }
    let id = contentUnitIds.get(contentUnit);
    if (!id) {
      contentUnitCounter += 1;
      id = `unit-${contentUnitCounter}`;
      contentUnitIds.set(contentUnit, id);
    }
    return id;
  }

  function getStableElementIdentity(element) {
    const id = String(element?.id || "").trim();
    if (id && !id.startsWith("llm-")) return `id:${id}`;

    const testId = String(element?.getAttribute?.("data-testid") || "").trim();
    if (testId && !["tweetText", "postText"].includes(testId)) return `testid:${testId}`;

    return "";
  }

  function getStableContentPermalink(contentUnit) {
    const selector = [
      "a[href*='/status/']",
      "a[href*='/comments/']",
      "a[href*='/comment/']",
      "a[href*='/posts/']"
    ].join(",");
    const link = contentUnit.matches?.(selector) ? contentUnit : contentUnit.querySelector?.(selector);
    const href = String(link?.getAttribute?.("href") || "").trim();
    if (!href) return "";
    try {
      const url = new URL(href, window.location.href);
      return `${url.pathname}${url.search}`;
    } catch (error) {
      return href;
    }
  }

  function getSourceFingerprint(text) {
    const normalized = normalizeText(text);
    return {
      hash: LLMTranslatorShared.simpleHash(normalized),
      length: normalized.length,
      summary: normalized.length <= 128
        ? normalized
        : `${normalized.slice(0, 64)}\u0000${normalized.slice(-64)}`
    };
  }

  function getTranslationRecordKey(element, text) {
    const profileKey = getTranslationProfileKey();
    const contentUnitKey = getContentUnitIdentity(element);
    const sourceFingerprint = getSourceFingerprint(text);
    return {
      key: `${profileKey}:${contentUnitKey}:${sourceFingerprint.hash}`,
      profileKey,
      contentUnitKey,
      sourceFingerprint
    };
  }

  function isMatchingTranslationRecord(record, identity) {
    return !!record
      && record.profileKey === identity.profileKey
      && record.contentUnitKey === identity.contentUnitKey
      && record.sourceFingerprint.hash === identity.sourceFingerprint.hash
      && record.sourceFingerprint.length === identity.sourceFingerprint.length
      && record.sourceFingerprint.summary === identity.sourceFingerprint.summary
      && record.state !== "cancelled";
  }

  function findTranslationRecord(element, text) {
    const direct = getTranslationRecord(element);
    if (direct) {
      const fingerprint = getSourceFingerprint(text);
      if (direct.sourceFingerprint.hash === fingerprint.hash
        && direct.sourceFingerprint.length === fingerprint.length
        && direct.sourceFingerprint.summary === fingerprint.summary
        && direct.profileKey === getTranslationProfileKey()
        && direct.state !== "cancelled") {
        direct.lastSeenAt = Date.now();
        return direct;
      }
    }

    const identity = getTranslationRecordKey(element, text);
    const record = translationRecordsByKey.get(identity.key);
    if (!isMatchingTranslationRecord(record, identity)) return null;
    record.lastSeenAt = Date.now();
    return record;
  }

  function createTranslationRecord(element, text) {
    pruneTranslationRecords();
    const identity = getTranslationRecordKey(element, text);
    const record = {
      ...identity,
      sourceElement: element,
      anchorElement: null,
      translationNode: null,
      state: "queued",
      requestId: null,
      elementId: ensureElementId(element),
      budgetReserved: false,
      sourceTextLength: identity.sourceFingerprint.length,
      lastSeenAt: Date.now()
    };
    translationRecordsByKey.set(record.key, record);
    translationRecordByElement.set(element, record);
    return record;
  }

  function bindTranslationRecord(record, element) {
    if (!record || !element) return record;
    const previousSource = record.sourceElement;
    record.sourceElement = element;
    record.lastSeenAt = Date.now();
    translationRecordByElement.set(element, record);
    element.dataset.llmTranslatorId = record.elementId;
    if (["queued", "loading", "streaming"].includes(record.state)) {
      element.dataset.llmTranslatorStatus = "loading";
    } else if (["done", "error", "skipped-budget"].includes(record.state)) {
      element.dataset.llmTranslatorStatus = record.state;
    }
    if (record.translationNode?.isConnected) {
      translationNodesByElement.set(element, record.translationNode);
    }
    if (previousSource && previousSource !== element && record.translationNode) {
      rebindTranslationRecordPlacement(record, element);
    }
    return record;
  }

  function rebindTranslationRecordPlacement(record, element) {
    const node = record.translationNode;
    if (!node) return;

    const oldContainer = node.parentElement;
    if (node.isConnected
      && node.parentElement === element.parentElement
      && (element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING)) {
      node.before(element);
    }

    const placement = LLMTranslatorShared.getTranslationPlacement(element.tagName);
    const context = getTranslationContext(element, placement);
    const insertionTarget = context.anchor || element;
    if (placement === "inside") {
      if (insertionTarget !== element) {
        if (insertionTarget.nextElementSibling !== node) insertionTarget.insertAdjacentElement("afterend", node);
      } else if (node.parentElement !== element) {
        element.appendChild(node);
      }
    } else if (insertionTarget.nextElementSibling !== node) {
      insertionTarget.insertAdjacentElement("afterend", node);
    }

    clearUnusedTranslationLayoutMarker(oldContainer);
    element.dataset.llmTranslatorPlacement = placement;
    syncTranslationSlot(node, insertionTarget);
    applyTranslationLayout(node, context);
    node.dataset.llmTranslatorLocalTheme = detectElementTheme(element);
    record.anchorElement = insertionTarget;
    record.lastSeenAt = Date.now();
  }

  function getOrCreateTranslationRecord(element, text = getTranslationText(element)) {
    const existing = findTranslationRecord(element, text);
    return existing ? bindTranslationRecord(existing, element) : createTranslationRecord(element, text);
  }

  function pruneTranslationRecords(now = Date.now()) {
    const maxIdleMs = 5 * 60 * 1000;
    for (const [key, record] of translationRecordsByKey) {
      const sourceConnected = !!record.sourceElement?.isConnected;
      const nodeConnected = !!record.translationNode?.isConnected;
      const active = ["queued", "loading", "streaming"].includes(record.state);
      if (!active && ((!sourceConnected && !nodeConnected) || now - record.lastSeenAt > maxIdleMs)) {
        translationRecordsByKey.delete(key);
      }
    }
  }

  let cleanTextEpoch = 0;

  function invalidateCleanTextCache() {
    cleanTextEpoch += 1;
  }

  const SITE_HEURISTICS = {
    // X / social sidebars and recommendation rails.
    lowPriorityContainers: [
      "aside",
      "[role=\"complementary\"]",
      "[aria-label*=\"Trending\"]",
      "[aria-label*=\"Relevant\"]",
      "[data-testid=\"trend\"]",
      "[data-testid=\"UserCell\"]"
    ],
    blockedContentContainers: [
      // MediaWiki/Wikipedia side templates are visually near the article but are navigation metadata.
      ".mw-parser-output table.sidebar",
      ".mw-parser-output .sidebar-list",
      ".mw-parser-output .navbox",
      ".mw-parser-output .vertical-navbox",
      ".mw-parser-output .metadata",
      ".mw-parser-output .ambox",
      ".mw-parser-output .side-box",
      "nav.vector-appearance-landmark",
      "#vector-appearance",
      "#vector-appearance-pinned-container",
      // Embedded player overlays often contain DRM/browser errors instead of article text.
      ".fave-player-container",
      ".fave-bolt-player",
      "#overlay-root",
      ".video-resource__wrapper",
      // GitHub repository file browsers are dense tables; translating commit/date cells breaks the row layout.
      "table[aria-labelledby=\"folders-and-files\"]",
      ".react-directory-row",
      "[data-testid=\"latest-commit\"]",
      "[data-testid=\"latest-commit-details\"]"
    ],
    utilityTextPatterns: [
      // X / social chrome
      /^(trending|what'?s happening|relevant people|streaming now)$/i,
      // News labels that are useful context but poor translation targets alone
      /^(analysis|analysis for subscribers|live updates)$/i
    ],
    skippedExtractedLinePatterns: [
      // List markers and source labels
      /^[•·]+$/,
      /^(source:?|cnn headlines|clipped from video|streaming now|live updates|latest updates|breaking news)$/i,
      // News agency bylines and malformed joined labels seen on CNN cards
      /^(cnn|reuters|associated press|ap|afp)$/i,
      /^(analysis\s*)?by\s+[A-Z][\p{L}.'-]+(?:\s+[A-Z][\p{L}.'-]+){0,5}$/u,
      /^analysisby\s+/i
    ],
    mediaCreditProviders: [
      "getty images",
      "reuters",
      "afp",
      "associated press",
      "ap photo",
      "imagn",
      "picture alliance",
      "shutterstock",
      "bloomberg",
      "handout",
      "/cnn",
      "cnn/"
    ]
  };

  const REDDIT_TITLE_SELECTORS = [
    "a[slot=\"title\"][href]",
    "[slot=\"title\"][id^=\"post-title-\"]",
    "[id^=\"post-title-\"][href]"
  ];
  const REDDIT_TEXT_BODY_SELECTORS = [
    "shreddit-post-text-body",
    "[property=\"schema:articleBody\"][id$=\"-post-rtjson-content\"]",
    ".feed-card-text-preview"
  ];
  const ARTICLE_HEADLINE_LINK_SELECTORS = [
    "a[class*=\"headline\" i][href]",
    "a[class*=\"title\" i][href]",
    "a[data-testid*=\"headline\" i][href]",
    "a[data-testid*=\"title\" i][href]"
  ];

  const runtimeMessageListener = (request, sender, sendResponse) => {
    if (request.action === "start_translation") {
      return respondAsync(startTranslation(request), sendResponse);
    }

    if (request.action === "stop_translation") {
      stopTranslation();
      sendResponse({ ok: true });
      return false;
    }

    if (request.action === "clear_translation") {
      clearTranslations();
      sendResponse({ ok: true });
      return false;
    }

    if (request.action === "scan_current_area") {
      return respondAsync(scanCurrentArea(request), sendResponse);
    }

    if (request.action === "get_page_stats") {
      sendResponse({ ok: true, active: state.active, stats: getStatsSnapshot() });
      return false;
    }

    if (request.action === "set_translation_visibility") {
      sendResponse(setTranslationVisibility(request.visible));
      return false;
    }

    if (request.action === "set_display_mode") {
      sendResponse(setDisplayMode(request.displayMode));
      return false;
    }

    if (request.action === "show_selection_translation") {
      return respondAsync(showSelectionTranslationWithUiLanguage(request), sendResponse);
    }

    if (request.action === "show_page_notice") {
      return respondAsync(showPageNoticeWithUiLanguage(request), sendResponse);
    }

    return false;
  };

  state.runtimeMessageListener = runtimeMessageListener;
  chrome.runtime.onMessage.addListener(runtimeMessageListener);

  maybeAutoStartTranslation();

  // 生命周期：开始、停止、清理和自动启动。
  function respondAsync(promise, sendResponse) {
    Promise.resolve(promise)
      .then(sendResponse)
      .catch((error) => {
        sendResponse({
          ok: false,
          error: formatContentError(error)
        });
      });
    return true;
  }

  function formatContentError(error) {
    return error?.message || String(error || "") || t("errorUnknown", [], "未知错误");
  }

  async function startTranslation(options = {}) {
    if (state.active) {
      setTranslationVisibility(true);
      if (options.auto) {
        setAutoStartStatus("started");
      }
      return { ok: true, message: "already active", stats: getStatsSnapshot() };
    }

    state.runId += 1;
    state.settings = options.settings || await chrome.runtime.sendMessage({ action: "get_settings" });
    await applyUiLanguageFromSettings(state.settings);
    const pageLanguageContext = refreshPageLanguageContext(state.settings);
    if (pageLanguageContext.isTargetLanguagePage) {
      if (options.auto) {
        setAutoStartStatus("skipped:target-language");
      }
      return {
        ok: true,
        skipped: true,
        reason: "target-language",
        stats: getStatsSnapshot()
      };
    }

    state.stats = createEmptyStats();
    state.budget = createEmptyBudget();
    state.active = true;
    setDisplayMode(state.settings?.displayMode);
    setTranslationVisibility(true);
    injectStyles();
    startViewportTracking();

    const elements = scanViewport(document, { immediate: true, deferFullScan: true });
    startDynamicObserver();
    if (options.auto) {
      setAutoStartStatus("started");
    }

    return { ok: true, count: elements.length, stats: state.stats };
  }

  async function maybeAutoStartTranslation() {
    try {
      // 后台事件可能早于 SPA 正文或骨架屏完成，这里让页面脚本自查一次自动翻译状态。
      const quickSettings = await chrome.storage.local.get(["autoTranslate", "apiKey", "model", "uiLanguage"]);
      await applyUiLanguageFromSettings(quickSettings);
      const hasApiKey = String(quickSettings?.apiKey || "").trim().length > 0;
      const hasModel = String(quickSettings?.model || "").trim().length > 0;

      if (quickSettings?.autoTranslate !== true) {
        setAutoStartStatus("disabled", { hasApiKey, hasModel });
        return;
      }

      if (!hasApiKey || !hasModel) {
        setAutoStartStatus("unconfigured", { hasApiKey, hasModel });
        return;
      }

      const settings = await chrome.runtime.sendMessage({ action: "get_settings" });
      setAutoStartStatus("starting", { hasApiKey, hasModel });
      const response = await startTranslation({ auto: true, settings });
      await markBackgroundTabActive(!response?.skipped, response?.skipped ? response.reason : "");
      setAutoStartStatus(response?.skipped ? `skipped:${response.reason || "unknown"}` : "started", {
        hasApiKey,
        hasModel
      });
    } catch (error) {
      setAutoStartStatus("error", { message: error?.message || String(error) });
    }
  }

  function setAutoStartStatus(reason, details = {}) {
    state.autoStartStatus = {
      reason,
      checkedAt: Date.now(),
      ...details
    };

    document.documentElement.setAttribute("data-llm-translator-version", CONTENT_SCRIPT_VERSION);
    document.documentElement.setAttribute("data-llm-translator-auto", reason);
  }

  async function markBackgroundTabActive(active, reason = "") {
    try {
      await chrome.runtime.sendMessage({ action: "mark_tab_active", active, reason });
    } catch (error) {
      // 后台状态只是缓存，通知失败时页面内状态仍然可用。
    }
  }

  async function applyUiLanguageFromSettings(settings) {
    await setUiLanguage(settings?.uiLanguage);
  }

  async function ensureUiLanguageLoaded() {
    if (state.settings?.uiLanguage) {
      await applyUiLanguageFromSettings(state.settings);
      return;
    }

    try {
      state.settings = await chrome.runtime.sendMessage({ action: "get_settings" });
      await applyUiLanguageFromSettings(state.settings);
    } catch (error) {
      await applyUiLanguageFromSettings(null);
    }
  }

  function stopTranslation() {
    state.active = false;
    state.runId += 1;

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    if (state.mutationObserver) {
      state.mutationObserver.disconnect();
      state.mutationObserver = null;
    }

    clearTimeout(state.mutationScanTimer);
    clearTimeout(state.viewportScanTimer);
    closeTranslationPort();
    state.mutationScanTimer = null;
    state.queue = [];
    state.queuedIds.clear();
    state.pendingScanRoots.clear();
    state.lastViewportSnapshot = null;
    state.viewportSampleCache = null;
    clearPendingLoadingPlaceholders();
    stopViewportTracking();
  }

  function clearTranslations() {
    stopTranslation();
    state.stats = createEmptyStats();
    setTranslationVisibility(true);

    document.querySelectorAll(".llm-bilingual-translation").forEach((node) => node.remove());
    document.querySelectorAll("[data-llm-translator-layout]").forEach((node) => {
      delete node.dataset.llmTranslatorLayout;
    });
    document.querySelectorAll("[data-llm-translator-id]").forEach((node) => {
      delete node.dataset.llmTranslatorId;
      delete node.dataset.llmTranslatorStatus;
      delete node.dataset.llmTranslatorPlacement;
    });
    translationRecordsByKey.clear();
  }

  // 候选发现：视口采样、有界补扫和通用可读块判断。
  function collectCandidateElements(root = document, options = {}) {
    const costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings);
    const scanRoot = getScanRoot(root);
    if (!scanRoot) return [];

    const maxResults = Math.max(1, Math.min(
      Number(options.maxResults) || costSettings.maxElementsPerScan,
      costSettings.maxElementsPerScan
    ));
    if (costSettings.viewportOnly && !options.immediateViewportOnly) {
      // 视口模式两条候选路径都为空时说明视口内没有新内容，
      // 不再回退全页 TreeWalker，避免已翻译长页面滚动时反复长任务。
      return collectViewportCandidateElements(
        scanRoot,
        costSettings,
        maxResults,
        { allowSelectorFallbackWhenSampled: options.allowSelectorFallbackWhenSampled === true }
      );
    }

    const candidates = new Map();
    const seenTexts = new Set();
    const walker = document.createTreeWalker(
      scanRoot,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => isTranslatableTextNode(node)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT
      }
    );

    const maxWalkedTextNodes = 1500;
    let walkedTextNodes = 0;
    let textNode = walker.nextNode();
    while (textNode) {
      walkedTextNodes += 1;
      if (walkedTextNodes > maxWalkedTextNodes) break;

      const block = findReadableBlock(textNode.parentElement, costSettings);
      if (block && !candidates.has(block)) {
        if (options.immediateViewportOnly && !isElementInActiveViewport(block)) {
          textNode = walker.nextNode();
          continue;
        }

        const text = getTranslationText(block, costSettings);
        const textKey = text.toLowerCase();
        if (!seenTexts.has(textKey) && isCandidateElement(block, costSettings, text)) {
          seenTexts.add(textKey);
          candidates.set(block, text);
          if (options.stopWhenEnough && candidates.size >= maxResults) break;
        }
      }

      textNode = walker.nextNode();
    }

    if (options.skipPrioritySort) {
      return Array.from(candidates.keys()).slice(0, maxResults);
    }

    return Array.from(candidates.entries())
      .map(([element, text]) => ({
        element,
        text,
        score: getCandidatePriorityScore(element, text)
      }))
      .filter((candidate) => !costSettings.viewportOnly || isElementNearActiveViewport(candidate.element))
      .sort(compareCandidatePriority)
      .map((candidate) => candidate.element)
      .slice(0, maxResults);
  }

  function collectViewportCandidateElements(scanRoot, costSettings, maxResults, options = {}) {
    const sampled = collectSampledViewportCandidateElements(scanRoot, costSettings, maxResults);
    if (sampled.candidates.length > 0) {
      if (!options.allowSelectorFallbackWhenSampled) return sampled.candidates;

      const supplemented = collectSelectorViewportCandidateElements(scanRoot, costSettings, maxResults);
      return mergeUniqueElements(sampled.candidates, supplemented, maxResults);
    }

    // 采样已经命中可读块但全被翻译/过滤时，视口内没有新内容；
    // 跳过全页选择器兜底，避免长页面逐块测量布局。
    if (sampled.sawReadableBlock && !options.allowSelectorFallbackWhenSampled) return [];

    return collectSelectorViewportCandidateElements(scanRoot, costSettings, maxResults);
  }

  function mergeUniqueElements(primary, secondary, maxResults) {
    return Array.from(new Set([...(primary || []), ...(secondary || [])])).slice(0, maxResults);
  }

  function collectSampledViewportCandidateElements(scanRoot, costSettings, maxResults) {
    const candidates = new Map();
    const seenTexts = new Set();
    let sawReadableBlock = false;

    if (typeof document.elementsFromPoint !== "function") {
      return { candidates: [], sawReadableBlock };
    }

    for (const element of getViewportSampleElements(scanRoot)) {
      if (addImmediateViewportCandidate(element, candidates, seenTexts, costSettings)) {
        sawReadableBlock = true;
      }
      if (addLocalViewportCandidateElements(element, scanRoot, candidates, seenTexts, costSettings, maxResults)) {
        sawReadableBlock = true;
      }
    }

    return { candidates: formatCandidateEntries(candidates, maxResults), sawReadableBlock };
  }

  function addLocalViewportCandidateElements(element, scanRoot, candidates, seenTexts, costSettings, maxResults) {
    if (candidates.size >= maxResults) return false;

    const localScope = getLocalReadableScope(element, scanRoot);
    if (!localScope) return false;

    let sawReadableBlock = false;
    const elements = localScope.querySelectorAll?.(getViewportReadableBlockSelector()) || [];
    for (const candidate of elements) {
      if (candidates.size >= maxResults) break;
      if (addImmediateViewportCandidate(candidate, candidates, seenTexts, costSettings)) {
        sawReadableBlock = true;
      }
    }

    return sawReadableBlock;
  }

  function getLocalReadableScope(element, scanRoot) {
    if (!element?.closest) return null;

    const scope = element.closest([
      "shreddit-comment",
      "shreddit-post",
      "article",
      "[role=\"article\"]",
      "li",
      "blockquote"
    ].join(","));

    if (!scope || scope === scanRoot) return null;
    return scanRoot.contains(scope) ? scope : null;
  }

  function collectSelectorViewportCandidateElements(scanRoot, costSettings, maxResults) {
    const candidates = new Map();
    const seenTexts = new Set();
    const elements = scanRoot.querySelectorAll?.(getViewportReadableBlockSelector()) || [];
    let inspected = 0;
    const maxInspected = Math.max(200, maxResults * 30);

    for (const element of elements) {
      if (inspected >= maxInspected) break;
      if (element.dataset.llmTranslatorStatus) continue;
      inspected += 1;
      if (!isElementNearActiveViewport(element)) continue;

      const block = findImmediateReadableBlock(element, costSettings);
      if (!block || candidates.has(block) || !isElementNearActiveViewport(block)) continue;

      const text = getTranslationText(block, costSettings);
      const textKey = text.toLowerCase();
      if (seenTexts.has(textKey) || !isCandidateElement(block, costSettings, text)) continue;

      seenTexts.add(textKey);
      candidates.set(block, text);
    }

    return formatCandidateEntries(candidates, maxResults);
  }

  function formatCandidateEntries(candidates, maxResults) {
    return Array.from(candidates.entries())
      .map(([element, text]) => ({
        element,
        text,
        score: getCandidatePriorityScore(element, text)
      }))
      .sort(compareCandidatePriority)
      .map((candidate) => candidate.element)
      .slice(0, maxResults);
  }

  function collectImmediateViewportCandidateElements(root = document) {
    const costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings);
    const scanRoot = getScanRoot(root);
    if (!scanRoot) return [];

    const maxResults = Math.max(1, Math.min(4, costSettings.maxElementsPerScan));
    const candidates = new Map();
    const seenTexts = new Set();

    if (typeof document.elementsFromPoint === "function") {
      for (const element of getViewportSampleElements(scanRoot)) {
        addImmediateViewportCandidate(element, candidates, seenTexts, costSettings);
      }
    }

    addImmediateReadableBlockCandidates(scanRoot, candidates, seenTexts, costSettings, maxResults);

    if (candidates.size > 0) {
      return Array.from(candidates.entries())
        .map(([element, text]) => ({
          element,
          text,
          score: getCandidatePriorityScore(element, text)
        }))
        .sort(compareCandidatePriority)
        .map((candidate) => candidate.element)
        .slice(0, maxResults);
    }

    return collectCandidateElements(root, {
      immediateViewportOnly: true,
      maxResults,
      skipPrioritySort: true,
      stopWhenEnough: true
    });
  }

  function addImmediateReadableBlockCandidates(scanRoot, candidates, seenTexts, costSettings, maxResults) {
    const elements = scanRoot.querySelectorAll?.(getImmediateReadableBlockSelector()) || [];
    let inspected = 0;
    const maxInspected = Math.max(40, maxResults * 30);

    for (const element of elements) {
      if (inspected >= maxInspected && candidates.size >= maxResults) break;
      inspected += 1;
      if (!isElementInActiveViewport(element)) continue;
      addImmediateViewportCandidate(element, candidates, seenTexts, costSettings);
    }
  }

  function getImmediateReadableBlockSelector() {
    return getViewportReadableBlockSelector();
  }

  function getViewportReadableBlockSelector() {
    return [
      LLMTranslatorShared.getCandidateSelector(),
      "[data-testid=\"tweetText\"]",
      ...ARTICLE_HEADLINE_LINK_SELECTORS.flatMap((selector) => [
        `article ${selector}`,
        `[role="article"] ${selector}`
      ]),
      ...REDDIT_TITLE_SELECTORS.map((selector) => `shreddit-post ${selector}`),
      ...REDDIT_TEXT_BODY_SELECTORS,
      "tr.athing td.title .titleline a[href]"
    ].join(",");
  }

  function hasMultipleImmediateReadableDescendants(element) {
    return (element.querySelectorAll?.(getImmediateReadableBlockSelector()).length || 0) > 1;
  }

  function getViewportSamplePoints() {
    const width = window.innerWidth || document.documentElement.clientWidth || 1000;
    const height = window.innerHeight || document.documentElement.clientHeight || 800;
    return [
      [0.5, 0.08],
      [0.5, 0.16],
      [0.5, 0.28],
      [0.24, 0.28],
      [0.76, 0.28],
      [0.5, 0.42],
      [0.5, 0.58],
      [0.24, 0.58],
      [0.76, 0.58],
      [0.5, 0.74],
      [0.5, 0.9],
      [0.24, 0.9],
      [0.76, 0.9]
    ].map(([xRatio, yRatio]) => ({
      x: Math.max(1, Math.min(width - 1, Math.round(width * xRatio))),
      y: Math.max(1, Math.min(height - 1, Math.round(height * yRatio)))
    }));
  }

  function getViewportSampleElements(scanRoot) {
    if (typeof document.elementsFromPoint !== "function") return [];

    const snapshot = getViewportSnapshot();
    const width = window.innerWidth || document.documentElement.clientWidth || 1000;
    const cacheKey = [
      Math.round(snapshot.top),
      Math.round(snapshot.height),
      width
    ].join(":");

    if (!state.viewportSampleCache || state.viewportSampleCache.key !== cacheKey) {
      const seen = new Set();
      const elements = [];

      for (const point of getViewportSamplePoints()) {
        for (const element of document.elementsFromPoint(point.x, point.y)) {
          if (!element || seen.has(element)) continue;
          seen.add(element);
          elements.push(element);
        }
      }

      state.viewportSampleCache = { key: cacheKey, elements };
    }

    return state.viewportSampleCache.elements.filter((element) => (
      scanRoot === element || scanRoot.contains(element)
    ));
  }

  function addImmediateViewportCandidate(element, candidates, seenTexts, costSettings) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const block = findImmediateReadableBlock(element, costSettings);
    if (!block) return false;
    if (candidates.has(block)) return true;
    if (block.dataset.llmTranslatorStatus) return false;
    if (!isElementInActiveViewport(block)) return false;

    const text = getTranslationText(block, costSettings);
    const textKey = text.toLowerCase();
    if (seenTexts.has(textKey) || !isCandidateElement(block, costSettings, text)) return true;

    seenTexts.add(textKey);
    candidates.set(block, text);
    return true;
  }

  function findImmediateReadableBlock(element, costSettings) {
    if (!element) return null;

    let current = element;
    let inlineFallback = null;
    let genericFallback = null;

    while (current && current !== document.body && current !== document.documentElement) {
      if (current.closest?.(".llm-bilingual-translation")) return null;
      if (hasBlockedAncestor(current)) return null;

      const siteSpecificBlock = findSiteSpecificReadableBlock(current, costSettings);
      if (siteSpecificBlock) {
        return siteSpecificBlock;
      }

      const tagName = current.tagName;
      if (isSemanticBlockTag(tagName)) {
        if ((tagName === "TD" || tagName === "TH") && inlineFallback) {
          return inlineFallback;
        }
        return current;
      }

      if (!inlineFallback && isInlineFallbackTag(tagName)) {
        const text = getCleanText(current);
        if (isUsefulInlineBlock(current, text, costSettings)) {
          inlineFallback = current;
        }
      }

      // 即时反馈只检查小容器，避免首帧前读取 ARTICLE/MAIN/SECTION 的整篇文本。
      if (!genericFallback && tagName === "DIV") {
        const text = getCleanText(current);
        if (isUsefulGenericBlock(current, text, costSettings) && !hasMultipleImmediateReadableDescendants(current)) {
          genericFallback = current;
        }
      }

      current = current.parentElement;
    }

    return inlineFallback || genericFallback;
  }

  function cleanupExistingTranslatorState(existingState) {
    existingState.active = false;
    existingState.runId = Number(existingState.runId || 0) + 1;

    if (existingState.runtimeMessageListener) {
      chrome.runtime.onMessage.removeListener(existingState.runtimeMessageListener);
    }
    if (existingState.observer) existingState.observer.disconnect();
    if (existingState.mutationObserver) existingState.mutationObserver.disconnect();
    if (existingState.translationPort) existingState.translationPort.disconnect();
    if (existingState.flushTimer) clearTimeout(existingState.flushTimer);
    if (existingState.mutationScanTimer) clearTimeout(existingState.mutationScanTimer);
    if (existingState.viewportScanTimer) clearTimeout(existingState.viewportScanTimer);
    if (existingState.handleScrollOrResize) {
      window.removeEventListener("scroll", existingState.handleScrollOrResize);
      window.removeEventListener("resize", existingState.handleScrollOrResize);
    }
    if (existingState.handleMouseMove) {
      window.removeEventListener("mousemove", existingState.handleMouseMove);
    }
  }

  function showReloadRequiredNotice() {
    const oldNotice = document.getElementById("llm-bilingual-reload-notice");
    if (oldNotice) oldNotice.remove();

    const notice = document.createElement("div");
    notice.id = "llm-bilingual-reload-notice";
    notice.textContent = t("contentReloadRequired", [], "翻译插件已更新，请刷新页面后继续使用。");
    notice.style.cssText = [
      "position:fixed",
      "top:16px",
      "right:16px",
      "z-index:2147483647",
      "max-width:320px",
      "padding:12px 14px",
      "border-left:4px solid #2563eb",
      "background:#eff6ff",
      "color:#1e3a8a",
      "font:14px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "box-shadow:0 10px 24px rgba(15,23,42,0.18)",
      "direction:ltr",
      "unicode-bidi:plaintext",
      "text-align:left"
    ].join(";");

    (document.body || document.documentElement).appendChild(notice);
    setTimeout(() => notice.remove(), 8000);
  }

  function getScanRoot(root) {
    let scanRoot = null;
    if (!root) {
      scanRoot = document.body || document.documentElement;
    } else if (root.nodeType === Node.DOCUMENT_NODE) {
      scanRoot = root.body || root.documentElement;
    } else if (root.nodeType === Node.ELEMENT_NODE) {
      scanRoot = root;
    }

    if (!scanRoot) return null;

    const primaryColumn = getPrimaryContentColumn();
    if (primaryColumn && scanRoot.contains(primaryColumn)) {
      return primaryColumn;
    }

    return scanRoot;
  }

  function isTranslatableTextNode(node) {
    if (!node || !node.parentElement) return false;

    const text = normalizeText(node.textContent);
    if (text.length < getMinimumTextNodeLength()) return false;
    if (shouldSkipCandidateByContent(text, node.parentElement)) return false;
    if (shouldSkipCandidateByLanguage(text)) return false;
    if (!hasCandidateLanguageSignal(text)) return false;
    if (node.parentElement.closest("a[href]")
      && isShortLowInformationLinkText(text)
      && !isHackerNewsStoryTitleCandidate(node.parentElement)) return false;
    if (isDenseTableOrGridCandidate(node.parentElement, text)) return false;
    if (hasBlockedAncestor(node.parentElement)) return false;
    if (!isElementInActiveContentScope(node.parentElement)) return false;
    if (isBlockedInteractiveComposer(node.parentElement)) return false;
    if (node.parentElement.closest(".llm-bilingual-translation")) return false;
    if (node.parentElement.closest("[data-llm-translator-status]")) return false;
    if (!isElementVisible(node.parentElement)) return false;

    return true;
  }

  function findReadableBlock(element, costSettings) {
    if (!element) return null;

    let current = element;
    let inlineFallback = null;
    let genericFallback = null;

    while (current && current !== document.body && current !== document.documentElement) {
      if (current.closest?.(".llm-bilingual-translation")) return null;
      if (hasBlockedAncestor(current)) return null;

      const tagName = current.tagName;
      const siteSpecificBlock = findSiteSpecificReadableBlock(current, costSettings);

      if (siteSpecificBlock) {
        return siteSpecificBlock;
      }

      if (isSemanticBlockTag(tagName)) {
        if ((tagName === "TD" || tagName === "TH") && inlineFallback) {
          return inlineFallback;
        }
        return current;
      }

      if (!inlineFallback && isInlineFallbackTag(tagName)
        && isUsefulInlineBlock(current, getCleanText(current), costSettings)) {
        inlineFallback = current;
      }

      if (!genericFallback && isGenericBlockTag(tagName)
        && isUsefulGenericBlock(current, getCleanText(current), costSettings)) {
        genericFallback = current;
      }

      current = current.parentElement;
    }

    return inlineFallback || genericFallback;
  }

  function findSiteSpecificReadableBlock(element, costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings)) {
    const redditTitle = findRedditPostTitleElement(element);
    if (redditTitle) return redditTitle;

    const redditTextBody = findRedditTextBodyElement(element);
    if (redditTextBody && (
      findClippedReadableContainer(redditTextBody)
      || !isOversizedRedditTextBody(redditTextBody, costSettings)
    )) return redditTextBody;

    const clippedPreview = findClippedReadableAncestor(element);
    if (clippedPreview) return clippedPreview;

    const articleHeadlineLink = findArticleHeadlineLinkElement(element);
    if (articleHeadlineLink) return articleHeadlineLink;

    const hackerNewsTitleCell = findHackerNewsStoryTitleCell(element);
    if (hackerNewsTitleCell) return hackerNewsTitleCell;

    return null;
  }

  function findRedditPostTitleElement(element) {
    if (!element?.closest) return null;
    const post = element.closest("shreddit-post");
    if (!post) return null;

    return element.closest(REDDIT_TITLE_SELECTORS.join(","));
  }

  function findArticleHeadlineLinkElement(element) {
    if (!element?.closest) return null;
    const article = element.closest("article,[role=\"article\"]");
    if (!article) return null;

    const link = element.closest(ARTICLE_HEADLINE_LINK_SELECTORS.join(","));
    if (!link || !article.contains(link)) return null;

    return link;
  }

  function findRedditTextBodyElement(element) {
    if (!element?.closest) return null;
    const post = element.closest("shreddit-post");
    if (!post) return null;

    return element.closest(REDDIT_TEXT_BODY_SELECTORS[0])
      || element.closest(REDDIT_TEXT_BODY_SELECTORS.slice(1).join(","));
  }

  function isOversizedRedditTextBody(textBody, costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings)) {
    return isRedditTextBodyElement(textBody)
      && getCleanText(textBody).length > costSettings.maxTextLength;
  }

  function isHackerNewsStoryTitleCandidate(element) {
    return !!findHackerNewsStoryTitleCell(element);
  }

  function findHackerNewsStoryTitleCell(element) {
    if (!element?.closest) return null;

    const row = element.closest("tr.athing");
    const cell = element.closest("td.title");
    if (!row || !cell || cell.closest("tr") !== row) return null;

    return cell.querySelector(".titleline a[href]") ? cell : null;
  }

  function findScopedDuplicateTranslationNode(element, text) {
    // React 重渲染会替换正文元素并丢失 data-llm-translator-* 标记，但译文节点常存活在原容器里。
    // 在最近的内容单元（推文/列表项/评论）范围内按源文本哈希查找已完成的译文，命中则不再重复翻译。
    const scope = element.closest?.("article,[role=\"article\"],li,blockquote,shreddit-post,shreddit-comment")
      || element.parentElement;
    if (!scope?.querySelector) return null;

    const hash = LLMTranslatorShared.simpleHash(text);
    return scope.querySelector(`.llm-bilingual-translation.is-done[data-llm-source-hash="${hash}"]`);
  }

  function isCandidateElement(element, costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings), knownText = null) {
    if (element.dataset.llmTranslatorStatus) return false;
    if (hasBlockedAncestor(element)) return false;
    if (!isElementInActiveContentScope(element)) return false;
    if (isBlockedInteractiveComposer(element)) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest(".llm-bilingual-translation")) return false;
    if (element.querySelector(".llm-bilingual-translation")) return false;

    const text = knownText === null ? getTranslationText(element, costSettings) : knownText;
    if (text.length < getMinimumCandidateTextLength(element) || text.length > costSettings.maxTextLength) return false;
    const existingRecord = findTranslationRecord(element, text);
    if (existingRecord) {
      bindTranslationRecord(existingRecord, element);
      return false;
    }
    if (findScopedDuplicateTranslationNode(element, text)) return false;
    if (isSiteMetadataCandidate(element, text)) return false;
    if (isShortLowInformationLinkCandidate(element, text)) return false;
    if (shouldSkipCandidateByContent(text, element)) return false;
    if (shouldSkipShortBrandLabel(text, element)) return false;
    if (shouldSkipCandidateByLanguage(text)) return false;
    if (!hasCandidateLanguageSignal(text)) return false;

    if (!isElementVisible(element)) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    if (isDenseTableOrGridCandidate(element, text, rect)) return false;

    return true;
  }

  function getPrimaryContentColumn() {
    return document.querySelector("[data-testid=\"primaryColumn\"]");
  }

  function isElementInActiveContentScope(element) {
    const primaryColumn = getPrimaryContentColumn();
    return !primaryColumn || primaryColumn.contains(element);
  }

  function isBlockedInteractiveComposer(element) {
    return !!element.closest?.([
      "[data-testid^=\"tweetTextarea\"]",
      "[data-testid=\"tweetButtonInline\"]",
      "[role=\"textbox\"]"
    ].join(","));
  }

  function isSemanticBlockTag(tagName) {
    return [
      "P",
      "LI",
      "BLOCKQUOTE",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "TD",
      "TH",
      "FIGCAPTION"
    ].includes(tagName);
  }

  function isGenericBlockTag(tagName) {
    return ["DIV", "ARTICLE", "SECTION", "MAIN"].includes(tagName);
  }

  function isInlineFallbackTag(tagName) {
    return ["SPAN", "A", "STRONG", "EM", "B", "I"].includes(tagName);
  }

  function isShortLowInformationLinkText(text) {
    const clean = normalizeText(text);
    if (clean.length >= 40) return false;

    return getLatinWords(clean).length < 5
      && countCjkChars(clean) < 8
      && countKanaChars(clean) < 6
      && countHangulChars(clean) < 8;
  }

  function isShortLowInformationLinkCandidate(element, text) {
    if (!isShortLowInformationLinkText(text)) return false;
    if (isRedditPostTitleElement(element)) return false;
    if (isArticleHeadlineLinkElement(element)) return false;
    if (isHackerNewsStoryTitleCandidate(element)) return false;
    return !!element.closest?.("a[href]") || !!element.querySelector?.("a[href]");
  }

  function getMinimumTextNodeLength() {
    return shouldUsePageLanguageCandidateMode() ? 4 : 12;
  }

  function getMinimumCandidateTextLength(element) {
    if (!shouldUsePageLanguageCandidateMode()) return 12;
    return isShortReadableTextElement(element) ? 4 : 8;
  }

  function getMinimumInlineTextLength() {
    return shouldUsePageLanguageCandidateMode() ? 4 : 24;
  }

  function getMinimumGenericTextLength() {
    return shouldUsePageLanguageCandidateMode() ? 8 : 12;
  }

  function shouldSkipCandidateByLanguage(text) {
    const targetKind = LLMTranslatorShared.normalizeTargetLanguageKind(state.settings?.targetLanguage);
    // 页面语言模式只对 en/未知目标放行：拉丁文本无法凭文字系统区分英/法/德，跳过检查才能翻译整页；
    // zh/ja/ko 目标可以按文字系统可靠识别“已是目标语言”的段落，必须继续逐元素跳过（X 混排时间线场景）。
    if (shouldUsePageLanguageCandidateMode() && (targetKind === "en" || !targetKind)) return false;
    return LLMTranslatorShared.isLikelyTargetLanguageText(text, state.settings?.targetLanguage);
  }

  function hasCandidateLanguageSignal(text) {
    return hasSourceLanguageSignal(text);
  }

  function shouldUsePageLanguageCandidateMode() {
    return state.pageLanguageContext?.isTargetLanguagePage === false;
  }

  function shouldSkipCandidateByContent(text, element) {
    if (!LLMTranslatorShared.shouldSkipTextByContent(text)) return false;
    return !isAllowedPageLanguageShortLabel(text, element);
  }

  function isAllowedPageLanguageShortLabel(text, element) {
    if (!shouldUsePageLanguageCandidateMode()) return false;
    if (!isUppercaseShortLabel(text)) return false;
    if (!isShortReadableTextElement(element)) return false;
    if (!hasCandidateLanguageSignal(text)) return false;
    if (SITE_HEURISTICS.utilityTextPatterns.some((pattern) => pattern.test(normalizeText(text)))) return false;
    return true;
  }

  function shouldSkipShortBrandLabel(text, element) {
    const clean = normalizeText(text);
    if (!shouldUsePageLanguageCandidateMode()) return false;
    if (!isShortReadableTextElement(element)) return false;
    if (clean.length > 32 || isUppercaseShortLabel(clean)) return false;

    const words = getLatinWords(clean);
    if (words.length < 2 || words.length > 4) return false;

    return words.some((word) => /[A-Z][a-z]+[A-Z]/.test(word) || /^[A-Z]{2,}$/.test(word));
  }

  function isUppercaseShortLabel(text) {
    const clean = normalizeText(text);
    return clean.length >= 4
      && clean.length <= 32
      && /^[A-Z0-9\s&|:./_-]+$/.test(clean)
      && /[A-Z]{3,}/.test(clean);
  }

  function isShortReadableTextElement(element) {
    if (!element?.closest) return false;
    const readable = element.closest("h1,h2,h3,h4,h5,h6,p,li,figcaption");
    if (!readable) return false;
    if (!readable.closest(LLMTranslatorShared.getMainContentSelector())) return false;
    return true;
  }

  function isUsefulInlineBlock(element, text, costSettings) {
    if (text.length < getMinimumInlineTextLength() || text.length > costSettings.maxTextLength) return false;
    if (isSiteMetadataCandidate(element, text)) return false;
    if (element.closest("a[href],button,[role=\"button\"]")) return false;
    if (shouldSkipCandidateByContent(text, element)) return false;
    if (shouldSkipShortBrandLabel(text, element)) return false;
    if (shouldSkipCandidateByLanguage(text)) return false;
    if (isDenseTableOrGridCandidate(element, text)) return false;

    const hasSentenceSignal = hasSentenceLikeSignal(text);
    const isLongStandaloneText = text.length >= 80 && hasCandidateLanguageSignal(text);
    if (!element.closest(LLMTranslatorShared.getMainContentSelector()) && !isLongStandaloneText) return false;

    return hasSentenceSignal && hasCandidateLanguageSignal(text);
  }

  function isUsefulGenericBlock(element, text, costSettings) {
    if (text.length < getMinimumGenericTextLength() || text.length > costSettings.maxTextLength) return false;
    if (isSiteMetadataCandidate(element, text)) return false;
    if (shouldSkipCandidateByContent(text, element)) return false;
    if (shouldSkipShortBrandLabel(text, element)) return false;
    if (shouldSkipCandidateByLanguage(text)) return false;

    const nestedReadableBlocks = element.querySelectorAll(LLMTranslatorShared.getCandidateSelector()).length;
    if (nestedReadableBlocks > 1) return false;

    const interactiveCount = element.querySelectorAll("button,input,textarea,select,nav,a[href],[role=\"button\"]").length;
    if (interactiveCount > 0) return false;

    return hasCandidateLanguageSignal(text);
  }

  function hasBlockedAncestor(element) {
    if (!element) return true;
    if (element.closest(LLMTranslatorShared.getStrictBlockedContainerSelector())) return true;
    if (element.closest(SITE_HEURISTICS.blockedContentContainers.join(","))) return true;

    const softBlocked = element.closest(LLMTranslatorShared.getSoftBlockedContainerSelector());
    if (!softBlocked) return false;

    const mainContent = element.closest(LLMTranslatorShared.getMainContentSelector());
    return !mainContent || !mainContent.contains(softBlocked);
  }

  function isDenseTableOrGridCandidate(element, text, rect = element.getBoundingClientRect()) {
    const clean = normalizeText(text);
    if (!clean || clean.length >= 180) return false;
    if (isHackerNewsStoryTitleCandidate(element)) return false;

    const tableCell = element.closest?.("td,th");
    if (tableCell?.closest("table,[role=\"table\"],[role=\"grid\"]")) {
      return true;
    }

    if (element.closest?.("[role=\"gridcell\"]")?.closest("[role=\"row\"]")) {
      return true;
    }

    const row = element.closest?.("tr,[role=\"row\"],[class*=\"row\" i]");
    if (!row) return false;

    const interactiveCells = row.querySelectorAll?.("a[href],button,[role=\"button\"],time,relative-time").length || 0;
    return interactiveCells >= 1 && rect.width > 0 && rect.width < 360;
  }

  function isElementVisible(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (isAssistiveOnlyElement(element)) return false;

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }

    return true;
  }

  function isElementNearActiveViewport(element) {
    return LLMTranslatorShared.isRectNearViewport(
      element.getBoundingClientRect(),
      window.innerHeight || document.documentElement.clientHeight || 800
    );
  }

  function isElementInActiveViewport(element) {
    const rect = element.getBoundingClientRect();
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    return rect.bottom >= 0 && rect.top <= viewportHeight;
  }

  function compareByViewportDistance(a, b) {
    return getViewportDistance(a) - getViewportDistance(b);
  }

  function compareCandidatePriority(a, b) {
    const scoreDelta = b.score - a.score;
    if (scoreDelta !== 0) return scoreDelta;
    return compareByViewportDistance(a.element, b.element);
  }

  function getCandidatePriorityScore(element, text) {
    let score = 0;
    const tagName = element.tagName;
    const clean = normalizeText(text);

    if (isRedditPostTitleElement(element)) score += 95;
    if (element.closest("[data-testid=\"tweetText\"]")) score += 90;
    if (isRedditTextBodyElement(element)) score += 85;
    if (isArticleHeadlineLinkElement(element)) score += 75;
    if (element.closest("[data-testid=\"primaryColumn\"]")) score += 70;
    if (element.closest("article,[role=\"article\"]")) score += 60;
    if (element.closest("main,[role=\"main\"]")) score += 25;
    if (["H1", "H2", "H3"].includes(tagName)) score += 25;
    if (["P", "BLOCKQUOTE", "FIGCAPTION"].includes(tagName)) score += 15;
    if (element.closest("a[href]")) score += 8;
    if (clean.length >= 40 && clean.length <= 800) score += 10;

    if (isLowPriorityContainer(element)) score -= 80;
    if (isUtilityTextCandidate(element, clean)) score -= 60;

    return score;
  }

  function isLowPriorityContainer(element) {
    return !!element.closest?.(SITE_HEURISTICS.lowPriorityContainers.join(","));
  }

  function isUtilityTextCandidate(element, text) {
    if (!text) return true;
    if (element.closest?.("nav,header,footer")) return true;
    return SITE_HEURISTICS.utilityTextPatterns.some((pattern) => pattern.test(text));
  }

  function getViewportDistance(element) {
    const rect = element.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return 0;
    if (rect.bottom < 0) return Math.abs(rect.bottom);
    return Math.max(0, rect.top - window.innerHeight);
  }

  // 视口与动态页面调度。
  function prepareViewportScan() {
    const nextSnapshot = getViewportSnapshot();
    const previousSnapshot = state.lastViewportSnapshot;
    state.lastViewportSnapshot = nextSnapshot;

    if (!previousSnapshot || !isDifferentViewport(previousSnapshot, nextSnapshot)) {
      return false;
    }

    cancelPendingViewportWork();
    return true;
  }

  function getViewportSnapshot() {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
    const scrollTop = window.scrollY
      || document.documentElement.scrollTop
      || document.body?.scrollTop
      || 0;

    return {
      top: scrollTop,
      bottom: scrollTop + viewportHeight,
      height: viewportHeight
    };
  }

  function isDifferentViewport(previous, next) {
    const overlap = Math.min(previous.bottom, next.bottom) - Math.max(previous.top, next.top);
    return overlap <= 0;
  }

  function cancelPendingViewportWork() {
    // 用户已经进入完全不同的阅读区域时，让旧请求失效，优先服务当前视口。
    state.runId += 1;
    closeTranslationPort();
    state.queue.forEach((element) => resetPendingElement(element, { releaseBudget: true }));
    state.queue = [];
    state.queuedIds.clear();
    state.pendingScanRoots.clear();
    state.viewportSampleCache = null;

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

    document
      .querySelectorAll('[data-llm-translator-status="queued"], [data-llm-translator-status="loading"]')
      .forEach(resetPendingElement);
  }

  function clearPendingLoadingPlaceholders() {
    document
      .querySelectorAll('[data-llm-translator-status="queued"], [data-llm-translator-status="loading"]')
      .forEach(resetPendingElement);
  }

  function resetPendingElement(element, options = {}) {
    const status = element.dataset.llmTranslatorStatus;
    if (status !== "queued" && status !== "loading") return;

    if (options.releaseBudget) {
      releaseReservedBudget(element);
    }

    const placement = element.dataset.llmTranslatorPlacement
      || LLMTranslatorShared.getTranslationPlacement(element.tagName);
    const node = getMemoizedTranslationNode(element)
      || findExistingTranslationNode(element, placement);
    if (node) {
      const layoutContainer = node.parentElement;
      node.remove();
      clearUnusedTranslationLayoutMarker(layoutContainer);
    }

    delete element.dataset.llmTranslatorStatus;
    delete element.dataset.llmTranslatorPlacement;
    const record = getTranslationRecord(element);
    if (record && ["queued", "loading", "streaming"].includes(record.state)) {
      record.state = "cancelled";
      record.requestId = null;
      translationRecordsByKey.delete(record.key);
    }
  }

  function releaseReservedBudget(element) {
    const record = getTranslationRecord(element);
    if (record && !record.budgetReserved) return;
    const textLength = record?.sourceTextLength
      || normalizeText(getTranslationText(element)).length;
    state.budget.requests = Math.max(0, state.budget.requests - 1);
    state.budget.chars = Math.max(0, state.budget.chars - textLength);
    if (record) record.budgetReserved = false;
  }

  function observeElements(elements) {
    if (!state.observer) {
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 800;
      const prefetchMargin = LLMTranslatorShared.getViewportContextPadding(viewportHeight);

      state.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!state.active || !entry.isIntersecting) continue;

          const element = entry.target;
          state.observer.unobserve(element);
          enqueueElement(element);
        }
      }, {
        root: null,
        // 复用有界上下文范围，提前完成下一屏内容，同时继续受扫描和页面预算约束。
        rootMargin: `${prefetchMargin}px 0px`,
        threshold: 0.01
      });
    }

    elements.forEach((element) => state.observer.observe(element));
  }

  function processCandidateElements(elements) {
    const deferred = [];

    for (const element of elements) {
      if (isElementInActiveViewport(element)) {
        enqueueElement(element);
      } else {
        deferred.push(element);
      }
    }

    observeElements(deferred);
  }

  function scanViewport(root = document, options = {}) {
    const superseded = prepareViewportScan();
    const elements = options.immediate
      ? collectImmediateViewportCandidateElements(root)
      : collectCandidateElements(root, {
        maxResults: options.maxResults,
        allowSelectorFallbackWhenSampled: options.allowSelectorFallbackWhenSampled === true
      });
    state.stats.scanned += elements.length;
    processCandidateElements(elements);
    if (options.deferFullScan) {
      const costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings);
      const remainingResults = costSettings.maxElementsPerScan - elements.length;
      if (remainingResults > 0) {
        scheduleDeferredViewportScan(root, remainingResults);
      }
    }
    if (superseded && state.queue.length > 0) {
      flushQueue();
    }
    return elements;
  }

  async function scanCurrentArea(options = {}) {
    if (!state.active) {
      return startTranslation(options);
    }

    state.settings = options.settings || await chrome.runtime.sendMessage({ action: "get_settings" });
    refreshPageLanguageContext(state.settings);
    setTranslationVisibility(true);
    const elements = scanViewport(document, { immediate: true, deferFullScan: true });
    return { ok: true, count: elements.length, stats: state.stats };
  }

  function startViewportTracking() {
    if (state.handleScrollOrResize) return;

    state.handleScrollOrResize = () => scheduleViewportScan();
    state.handleMouseMove = (event) => {
      // 鼠标位置变化常意味着用户正在读新区域，用阈值触发可减少滚动依赖和无效扫描。
      const threshold = LLMTranslatorShared.getMouseMoveScanThresholdPx();
      if (state.lastMouseY === null || Math.abs(event.clientY - state.lastMouseY) >= threshold) {
        state.lastMouseY = event.clientY;
        scheduleViewportScan();
      }
    };

    window.addEventListener("scroll", state.handleScrollOrResize, { passive: true });
    window.addEventListener("resize", state.handleScrollOrResize);
    window.addEventListener("mousemove", state.handleMouseMove, { passive: true });
  }

  function stopViewportTracking() {
    if (state.handleScrollOrResize) {
      window.removeEventListener("scroll", state.handleScrollOrResize);
      window.removeEventListener("resize", state.handleScrollOrResize);
      state.handleScrollOrResize = null;
    }

    if (state.handleMouseMove) {
      window.removeEventListener("mousemove", state.handleMouseMove);
      state.handleMouseMove = null;
    }

    state.lastMouseY = null;
  }

  function scheduleViewportScan(root = document) {
    clearTimeout(state.viewportScanTimer);
    state.viewportScanTimer = setTimeout(() => {
      if (!state.active) return;
      scanViewport(root, { deferFullScan: true });
    }, LLMTranslatorShared.getViewportScanDebounceMs());
  }

  function scheduleDeferredViewportScan(root = document, maxResults = null) {
    const runAfterPaint = () => {
      clearTimeout(state.viewportScanTimer);
      state.viewportScanTimer = setTimeout(() => {
        if (!state.active) return;
        scanViewport(root, { maxResults, allowSelectorFallbackWhenSampled: true });
      }, 0);
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => window.requestAnimationFrame(runAfterPaint));
      return;
    }

    runAfterPaint();
  }

  function startDynamicObserver() {
    if (state.mutationObserver || !document.body) return;

    state.mutationObserver = new MutationObserver((mutations) => {
      if (!state.active) return;

      let shouldInvalidateTextCache = false;
      const changedSources = new Set();

      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          const changedSource = findRecordedSourceForMutation(mutation.target);
          if (changedSource) changedSources.add(changedSource);
          mutation.addedNodes.forEach((node) => {
            const scanNode = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
            if (queueDynamicScanRoot(scanNode)) shouldInvalidateTextCache = true;
          });
        } else if (mutation.type === "characterData") {
          const changedSource = findRecordedSourceForMutation(mutation.target);
          if (changedSource) changedSources.add(changedSource);
          if (queueDynamicScanRoot(mutation.target.parentElement)) shouldInvalidateTextCache = true;
        } else if (mutation.type === "attributes") {
          if (queueDynamicScanRoot(mutation.target, { attributeOnly: true })) shouldInvalidateTextCache = true;
        }
      }

      if (shouldInvalidateTextCache || changedSources.size > 0) invalidateCleanTextCache();
      changedSources.forEach(reconcileChangedSource);
      scheduleDynamicScan();
    });

    state.mutationObserver.observe(
      document.body,
      LLMTranslatorShared.getDynamicScanObserverOptions()
    );
  }

  function findRecordedSourceForMutation(node) {
    const element = node?.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    if (!element || element.closest?.(".llm-bilingual-translation")) return null;
    if (getTranslationRecord(element)) return element;

    const source = element.closest?.("[data-llm-translator-id]");
    return source && getTranslationRecord(source) ? source : null;
  }

  function reconcileChangedSource(sourceElement) {
    const record = getTranslationRecord(sourceElement);
    if (!record || record.state === "cancelled") return;

    const nextText = getTranslationText(sourceElement);
    const nextFingerprint = getSourceFingerprint(nextText);
    if (record.sourceFingerprint.hash === nextFingerprint.hash
      && record.sourceFingerprint.length === nextFingerprint.length
      && record.sourceFingerprint.summary === nextFingerprint.summary) {
      return;
    }

    invalidateTranslationRecord(record, { releaseBudget: true, removeNode: true });
    queueDynamicScanRoot(sourceElement);
  }

  function invalidateTranslationRecord(record, options = {}) {
    if (!record || record.state === "cancelled") return;

    const sourceElement = record.sourceElement;
    const requestId = record.requestId;
    if (requestId) {
      try {
        state.translationPort?.postMessage({ type: "cancel", requestId });
      } catch (error) {
        // 后台连接可能已断开，本地 requestId 校验仍会阻止旧响应写入。
      }
      settleStreamRequest(requestId);
    }

    if (options.releaseBudget && record.budgetReserved) {
      releaseReservedBudget(sourceElement);
    }

    const node = record.translationNode;
    if (options.removeNode && node) {
      const oldContainer = node.parentElement;
      node.remove();
      clearUnusedTranslationLayoutMarker(oldContainer);
    }

    clearRecordedElementStatus(sourceElement);
    state.queuedIds.delete(record.elementId);
    translationRecordsByKey.delete(record.key);
    record.state = "cancelled";
    record.requestId = null;
    record.translationNode = null;
    record.lastSeenAt = Date.now();
  }

  function clearRecordedElementStatus(element) {
    if (!element?.dataset) return;
    const status = element.dataset.llmTranslatorStatus;
    if (status === "done") {
      state.stats.translated = Math.max(0, state.stats.translated - 1);
    } else if (status === "error") {
      state.stats.failed = Math.max(0, state.stats.failed - 1);
    }
    delete element.dataset.llmTranslatorStatus;
    delete element.dataset.llmTranslatorPlacement;
  }

  function queueDynamicScanRoot(node, options = {}) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
    if (node.closest?.(".llm-bilingual-translation")) return false;
    if (node.matches?.(".llm-bilingual-translation")) return false;
    if (options.attributeOnly && !isDynamicAttributeScanTarget(node)) return false;

    const root = getNormalizedDynamicScanRoot(node);
    if (!root) return false;

    state.viewportSampleCache = null;
    return addPendingScanRoot(root);
  }

  function isDynamicAttributeScanTarget(element) {
    if (element === document.body || element === document.documentElement) return false;
    if (!element.closest) return false;

    const readableSelector = getViewportReadableBlockSelector();
    if (element.matches?.(readableSelector) || element.closest(readableSelector)) return true;

    return element.matches?.([
      "shreddit-comment",
      "shreddit-post",
      "article",
      "[role=\"article\"]",
      "li",
      "blockquote",
      "section"
    ].join(","))
      && !!element.querySelector?.(readableSelector);
  }

  function getNormalizedDynamicScanRoot(element) {
    const scanRoot = getScanRoot(document);
    if (!scanRoot || !scanRoot.contains(element)) return null;

    const localScope = getLocalReadableScope(element, scanRoot);
    if (localScope) return localScope;

    return element;
  }

  function addPendingScanRoot(root) {
    for (const existingRoot of Array.from(state.pendingScanRoots)) {
      if (existingRoot === root || existingRoot.contains(root)) return false;
      if (root.contains(existingRoot)) state.pendingScanRoots.delete(existingRoot);
    }

    state.pendingScanRoots.add(root);
    return true;
  }

  function scheduleDynamicScan() {
    if (state.mutationScanTimer) return;

    state.mutationScanTimer = setTimeout(() => {
      state.mutationScanTimer = null;
      if (!state.active || state.pendingScanRoots.size === 0) return;

      const elements = [];
      for (const root of state.pendingScanRoots) {
        elements.push(...collectCandidateElements(root));
      }

      state.pendingScanRoots.clear();
      processCandidateElements(Array.from(new Set(elements)));
    }, LLMTranslatorShared.getDynamicScanDebounceMs());
  }

  // 翻译队列：持续补位的逐段流式并发，不使用批次屏障。
  function enqueueElement(element) {
    const id = ensureElementId(element);
    if (state.queuedIds.has(id)) return;

    const text = getTranslationText(element);
    const existingRecord = findTranslationRecord(element, text);
    if (existingRecord) {
      bindTranslationRecord(existingRecord, element);
      return;
    }
    if (!reserveTranslationBudget(text)) {
      setElementStatus(element, "skipped-budget");
      state.stats.skippedBudget += 1;
      return;
    }

    const record = createTranslationRecord(element, text);
    record.budgetReserved = true;
    state.queuedIds.add(id);
    state.queue.push(element);
    setLoading(element, record);
    state.stats.queued += 1;
    flushQueue();
  }

  function flushQueue() {
    pumpTranslationQueue();
  }

  function pumpTranslationQueue() {
    if (!state.active) return;
    const maxConcurrent = LLMTranslatorShared.normalizeCostSettings(state.settings).maxConcurrentBatches;

    while (state.activeStreams < maxConcurrent && state.queue.length > 0) {
      const element = state.queue.shift();
      const streamRunId = state.runId;
      state.activeStreams += 1;
      translateStreamElement(element, streamRunId)
        .finally(() => {
          state.activeStreams = Math.max(0, state.activeStreams - 1);
          pumpTranslationQueue();
        });
    }
  }

  function ensureTranslationPort() {
    if (state.translationPort) return state.translationPort;

    const port = chrome.runtime.connect({ name: "llm-translation-stream" });
    state.translationPort = port;
    port.onMessage.addListener(handleTranslationStreamMessage);
    port.onDisconnect.addListener(() => {
      if (state.translationPort !== port) return;
      state.translationPort = null;
      for (const [requestId, request] of Array.from(state.streamRequests.entries())) {
        if (state.active && request.runId === state.runId) {
          setError(
            request.record.sourceElement,
            t("errorTranslationFailed", [], "翻译连接已断开，请点击重试。"),
            request.record
          );
        }
        settleStreamRequest(requestId);
      }
    });
    return port;
  }

  function translateStreamElement(element, streamRunId) {
    const id = ensureElementId(element);
    const requestId = `${id}:${streamRunId}:${++state.streamCounter}`;
    const record = getTranslationRecord(element) || getOrCreateTranslationRecord(element);
    record.requestId = requestId;
    record.state = "loading";

    return new Promise((resolve) => {
      const request = {
        record,
        runId: streamRunId,
        text: "",
        counted: false,
        resolve
      };
      state.streamRequests.set(requestId, request);

      try {
        ensureTranslationPort().postMessage({
          type: "translate",
          requestId,
          runId: streamRunId,
          item: { id, text: getTranslationText(element) }
        });
      } catch (error) {
        if (state.active && streamRunId === state.runId) {
          setError(element, error?.message || t("errorTranslationFailed", [], "翻译失败。"));
        }
        settleStreamRequest(requestId);
      }
    });
  }

  function handleTranslationStreamMessage(message) {
    const requestId = String(message?.requestId || "");
    const request = state.streamRequests.get(requestId);
    if (!request) return;

    if (!state.active || request.runId !== state.runId || Number(message.runId) !== request.runId) {
      settleStreamRequest(requestId);
      return;
    }
    if (request.record.requestId !== requestId || request.record.state === "cancelled") {
      settleStreamRequest(requestId);
      return;
    }

    if (message.type === "delta") {
      request.text = typeof message.text === "string"
        ? message.text
        : request.text + String(message.delta || "");
      if (!request.counted) {
        request.counted = true;
        state.stats.apiRequested += 1;
      }
      setStreamingTranslation(request.record.sourceElement, request.text, request.record);
      return;
    }

    if (message.type === "cached") {
      state.stats.cacheHits += 1;
      setTranslation(request.record.sourceElement, message.text || "", request.record);
      settleStreamRequest(requestId);
      return;
    }

    if (message.type === "done") {
      if (!request.counted) state.stats.apiRequested += 1;
      setTranslation(request.record.sourceElement, message.text || request.text, request.record);
      settleStreamRequest(requestId);
      return;
    }

    if (message.type === "error") {
      if (!request.counted) state.stats.apiRequested += 1;
      setError(request.record.sourceElement, message.error || t("errorTranslationFailed", [], "翻译失败。"), request.record);
      settleStreamRequest(requestId);
    }
  }

  function settleStreamRequest(requestId) {
    const request = state.streamRequests.get(requestId);
    if (!request) return;
    state.streamRequests.delete(requestId);
    if (request.record.requestId === requestId) request.record.requestId = null;
    request.resolve();
  }

  function closeTranslationPort() {
    const port = state.translationPort;
    state.translationPort = null;

    for (const [requestId, request] of Array.from(state.streamRequests.entries())) {
      try {
        port?.postMessage({ type: "cancel", requestId });
      } catch (error) {
        // Port 可能已由后台断开，本地仍需释放队列槽位。
      }
      state.streamRequests.delete(requestId);
      if (request.record.requestId === requestId) {
        request.record.requestId = null;
        if (["queued", "loading", "streaming"].includes(request.record.state)) {
          request.record.state = "cancelled";
        }
      }
      request.resolve();
    }

    try {
      port?.disconnect();
    } catch (error) {
      // 已断开的 Port 无需重复处理。
    }
  }

  function ensureElementId(element) {
    if (!element.dataset.llmTranslatorId) {
      state.counter += 1;
      element.dataset.llmTranslatorId = `llm-${Date.now()}-${state.counter}`;
    }
    return element.dataset.llmTranslatorId;
  }

  // 原文抽取与轻量语言判断。
  function getCleanText(element) {
    const cached = cleanTextCache.get(element);
    if (cached && cached.epoch === cleanTextEpoch) return cached.text;

    const text = computeCleanText(element);
    cleanTextCache.set(element, { epoch: cleanTextEpoch, text });
    return text;
  }

  function getTranslationText(element, costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings)) {
    const maxTextLength = costSettings.maxTextLength;
    const cached = translationTextCache.get(element);
    if (cached && cached.epoch === cleanTextEpoch && cached.maxTextLength === maxTextLength) {
      return cached.text;
    }

    const cleanText = getCleanText(element);
    const text = isClippedTranslationSource(element)
      ? truncateTextAtBoundary(cleanText, maxTextLength)
      : cleanText;
    translationTextCache.set(element, {
      epoch: cleanTextEpoch,
      maxTextLength,
      text
    });
    return text;
  }

  function isClippedTranslationSource(element) {
    return !!element && (
      isVisuallyClipped(element)
      || !!findClippedReadableContainer(element)
    );
  }

  function findClippedReadableContainer(root) {
    if (!root?.querySelectorAll) return null;
    if (isVisuallyClipped(root)) return root;

    const candidates = root.querySelectorAll("div,section,article,p,blockquote");
    const maxCandidates = Math.min(candidates.length, 48);
    for (let index = 0; index < maxCandidates; index += 1) {
      if (isVisuallyClipped(candidates[index])) return candidates[index];
    }
    return null;
  }

  function findClippedReadableAncestor(element) {
    if (!element?.closest) return null;

    let current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      if (isVisuallyClipped(current)) {
        const text = getCleanText(current);
        return text.length >= getMinimumGenericTextLength() && hasCandidateLanguageSignal(text)
          ? current
          : null;
      }
      current = current.parentElement;
    }
    return null;
  }

  function isVisuallyClipped(element) {
    if (!element || element.clientHeight <= 0) return false;

    const style = window.getComputedStyle(element);
    const lineClamp = String(style.webkitLineClamp || "").trim();
    if (lineClamp && lineClamp !== "none" && lineClamp !== "0") return true;

    const clipsOverflow = [style.overflow, style.overflowY]
      .some((value) => value === "hidden" || value === "clip");
    return clipsOverflow && element.scrollHeight > element.clientHeight + 1;
  }

  function truncateTextAtBoundary(text, maxLength) {
    const clean = String(text || "").trim();
    if (clean.length <= maxLength) return clean;

    const prefix = clean.slice(0, maxLength);
    const sentenceBoundary = Math.max(
      prefix.lastIndexOf(". "),
      prefix.lastIndexOf("! "),
      prefix.lastIndexOf("? "),
      prefix.lastIndexOf("。"),
      prefix.lastIndexOf("！"),
      prefix.lastIndexOf("？")
    );
    if (sentenceBoundary >= Math.floor(maxLength * 0.5)) {
      return prefix.slice(0, sentenceBoundary + 1).trim();
    }

    const whitespaceBoundary = Math.max(prefix.lastIndexOf(" "), prefix.lastIndexOf("\n"));
    return prefix.slice(0, whitespaceBoundary > 0 ? whitespaceBoundary : maxLength).trim();
  }

  function computeCleanText(element) {
    const lines = normalizeTextWithLineBreaks(extractReadableText(element))
      .split("\n")
      .map(cleanTextLine)
      .reduce((kept, line) => {
        if (!line) {
          if (kept.length > 0 && kept[kept.length - 1] !== "") kept.push("");
          return kept;
        }

        if (!shouldSkipExtractedTextLine(line)) {
          kept.push(line);
        }

        return kept;
      }, []);

    return lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function extractReadableText(root) {
    const parts = [];
    appendReadableText(root, parts, true);
    return parts.join("");
  }

  function appendReadableText(node, parts, isRoot = false) {
    if (!node) return;

    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || "");
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node;
    if (!isRoot && element.closest?.(".llm-bilingual-translation")) return;
    if (element.matches?.("script,style,noscript,template")) return;
    if (!isRoot && !isElementVisibleForTextExtraction(element)) return;

    const tagName = element.tagName;
    if (tagName === "BR") {
      parts.push("\n");
      return;
    }

    const preserveLine = !isRoot && shouldPreserveLineBreakAroundElement(tagName);
    if (preserveLine) parts.push("\n");

    element.childNodes.forEach((child) => appendReadableText(child, parts));

    if (preserveLine) parts.push("\n");
  }

  function shouldPreserveLineBreakAroundElement(tagName) {
    return [
      "P",
      "DIV",
      "LI",
      "BLOCKQUOTE",
      "H1",
      "H2",
      "H3",
      "H4",
      "H5",
      "H6",
      "TR",
      "FIGCAPTION"
    ].includes(tagName);
  }

  function normalizeTextWithLineBreaks(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/ *\n */g, "\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function cleanTextLine(line) {
    return line
      .replace(/[ \t]+([,.;:!?])/g, "$1")
      .replace(/([([{])[ \t]+/g, "$1")
      .replace(/[ \t]+([)\]}])/g, "$1");
  }

  function shouldSkipExtractedTextLine(line) {
    const clean = normalizeText(line);
    if (!clean) return false;

    if (SITE_HEURISTICS.skippedExtractedLinePatterns.some((pattern) => pattern.test(clean))) return true;

    return isMediaCreditLine(clean);
  }

  function isMediaCreditLine(text) {
    const clean = normalizeText(text);
    if (clean.length > 140) return false;

    const lower = clean.toLowerCase();
    const hasProvider = SITE_HEURISTICS.mediaCreditProviders.some((provider) => lower.includes(provider));

    if (!hasProvider) return false;

    return /\/|©|\bphoto\b|\bimages?\b|\bfile\b|\bhandout\b/i.test(clean)
      || clean.split(/\s+/).length <= 10;
  }

  function isElementVisibleForTextExtraction(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (isAssistiveOnlyElement(element)) return false;

    const style = window.getComputedStyle(element);
    return style.display !== "none"
      && style.visibility !== "hidden"
      && style.visibility !== "collapse"
      && style.opacity !== "0";
  }

  function isAssistiveOnlyElement(element) {
    if (!element) return false;
    const className = String(element.className || "").toLowerCase();
    if (/\b(sr-only|screen-reader-only|visually-hidden|visuallyhidden|a11y-only)\b/.test(className)) return true;

    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.position === "absolute"
      && (style.clip !== "auto" || style.clipPath !== "none")
      && rect.width <= 2
      && rect.height <= 2;
  }

  function normalizeText(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hasSourceLanguageSignal(text) {
    const clean = normalizeText(text);
    if (!clean) return false;

    const languageKind = getSourceLanguageKind();
    if (languageKind === "auto") return hasAnyLanguageSignal(clean);
    if (languageKind === "chinese") return countCjkChars(clean) >= 4;
    if (languageKind === "japanese") return countKanaChars(clean) >= 2 || countCjkChars(clean) >= 6;
    if (languageKind === "korean") return countHangulChars(clean) >= 4;

    return /[A-Za-z]{3,}/.test(clean);
  }

  function getSourceLanguageKind() {
    const sourceLanguage = String(state.settings?.sourceLanguage || "English").trim().toLowerCase();
    if (!sourceLanguage || sourceLanguage.includes("auto") || sourceLanguage.includes("自动") || sourceLanguage.includes("自動")) {
      return "auto";
    }
    if (sourceLanguage.includes("chinese") || sourceLanguage.includes("中文") || sourceLanguage.includes("简体") || sourceLanguage.includes("簡體") || sourceLanguage.includes("繁體")) {
      return "chinese";
    }
    if (sourceLanguage.includes("japanese") || sourceLanguage.includes("日语") || sourceLanguage.includes("日語") || sourceLanguage.includes("日本語")) {
      return "japanese";
    }
    if (sourceLanguage.includes("korean") || sourceLanguage.includes("韩语") || sourceLanguage.includes("韓語") || sourceLanguage.includes("한국")) {
      return "korean";
    }
    return "latin";
  }

  function hasAnyLanguageSignal(text) {
    return /[A-Za-z]{3,}/.test(text)
      || countCjkChars(text) >= 4
      || countKanaChars(text) >= 2
      || countHangulChars(text) >= 4;
  }

  function hasSentenceLikeSignal(text) {
    return /[.!?。！？:;，,]/.test(text)
      || getLatinWords(text).length >= 5
      || countCjkChars(text) >= 12
      || countKanaChars(text) >= 8
      || countHangulChars(text) >= 10;
  }

  function getLatinWords(text) {
    return normalizeText(text).match(/[A-Za-z][A-Za-z'-]*/g) || [];
  }

  function countCjkChars(text) {
    return (String(text || "").match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  }

  function countKanaChars(text) {
    return (String(text || "").match(/[\u3040-\u30ff]/g) || []).length;
  }

  function countHangulChars(text) {
    return (String(text || "").match(/[\uac00-\ud7af]/g) || []).length;
  }

  // 译文插入和结构感知布局。
  function ensureTranslationNode(element, providedRecord = null) {
    const record = providedRecord || getTranslationRecord(element) || getOrCreateTranslationRecord(element);
    if (record.translationNode?.isConnected) {
      translationNodesByElement.set(element, record.translationNode);
      return record.translationNode;
    }
    const memoized = getMemoizedTranslationNode(element);
    if (memoized) {
      record.translationNode = memoized;
      return memoized;
    }

    const placement = LLMTranslatorShared.getTranslationPlacement(element.tagName);
    const context = getTranslationContext(element, placement);
    const insertionTarget = context.anchor;
    let node = findExistingTranslationNode(element, placement, insertionTarget);

    if (!node) {
      node = document.createElement("div");
      node.className = "llm-bilingual-translation";
      node.dir = "auto";

      if (placement === "inside") {
        if (insertionTarget && insertionTarget !== element) {
          insertionTarget.insertAdjacentElement("afterend", node);
        } else {
          element.appendChild(node);
        }
      } else {
        (insertionTarget || element).insertAdjacentElement("afterend", node);
      }
    }
    element.dataset.llmTranslatorPlacement = placement;
    node.dir = "auto";
    syncTranslationSlot(node, insertionTarget);
    applyTranslationLayout(node, context);
    node.dataset.llmTranslatorLocalTheme = detectElementTheme(element);
    if (!node.dataset.llmSourceHash) {
      node.dataset.llmSourceHash = record.sourceFingerprint.hash;
    }
    record.anchorElement = insertionTarget;
    record.translationNode = node;
    record.lastSeenAt = Date.now();
    translationRecordByElement.set(element, record);
    translationNodesByElement.set(element, node);
    return node;
  }

  function getTranslationContext(element, placement) {
    return {
      anchor: getTranslationInsertionTarget(element, placement),
      placement
    };
  }

  function applyTranslationLayout(node, context) {
    const container = node?.parentElement;
    if (!container) return;

    const containerStyle = window.getComputedStyle(container);
    const display = containerStyle.display;
    let layoutMode = "block";
    if ((display === "flex" || display === "inline-flex")
      && (containerStyle.flexDirection === "row" || containerStyle.flexDirection === "row-reverse")) {
      layoutMode = "stacked-flex";
    } else if (display === "grid" || display === "inline-grid") {
      layoutMode = "stacked-grid";
    }

    if (layoutMode === "block") return;

    container.dataset.llmTranslatorLayout = layoutMode;
    context.layoutMode = layoutMode;
  }

  function clearUnusedTranslationLayoutMarker(container) {
    if (!container?.dataset?.llmTranslatorLayout) return;
    if (container.querySelector?.(":scope > .llm-bilingual-translation")) return;
    delete container.dataset.llmTranslatorLayout;
  }

  function findExistingTranslationNode(element, placement, insertionTarget = null) {
    if (placement === "inside") {
      const target = insertionTarget || getTranslationInsertionTarget(element, placement);
      if (target && target !== element) {
        const next = target.nextElementSibling;
        if (next?.classList.contains("llm-bilingual-translation")) return next;
      }

      return Array.from(element.children).find((child) => child.classList.contains("llm-bilingual-translation"));
    }

    const target = insertionTarget || getTranslationInsertionTarget(element, placement);
    const next = target?.nextElementSibling;
    return next?.classList.contains("llm-bilingual-translation") ? next : null;
  }

  function getTranslationInsertionTarget(element, placement) {
    const redditTitleTarget = findRedditPostTitleElement(element);
    if (redditTitleTarget) return redditTitleTarget;

    const redditTarget = findRedditTextBodyInsertionTarget(element);
    if (redditTarget) return redditTarget;

    const clippedTarget = findClippedTranslationInsertionTarget(element);
    if (clippedTarget) return clippedTarget;

    const hackerNewsTarget = findHackerNewsTitleInsertionTarget(element);
    if (hackerNewsTarget) return hackerNewsTarget;

    if (placement !== "inside" || element.tagName !== "LI") return element;

    return findPrimaryListItemLink(element) || element;
  }

  function findClippedTranslationInsertionTarget(element) {
    const clipped = isVisuallyClipped(element)
      ? element
      : findClippedReadableAncestor(element);
    if (!clipped) return null;

    return clipped.closest?.("a[href]") || clipped;
  }

  function findHackerNewsTitleInsertionTarget(element) {
    const cell = findHackerNewsStoryTitleCell(element);
    return cell?.querySelector(":scope > .titleline") || cell?.querySelector(".titleline") || null;
  }

  function findRedditTextBodyInsertionTarget(element) {
    const textBody = isRedditTextBodyElement(element)
      ? element
      : findRedditTextBodyElement(element);
    if (!textBody) return null;
    if (textBody !== element && isOversizedRedditTextBody(textBody)) return null;

    return textBody.querySelector?.(":scope > a[slot=\"text-body\"]") || textBody;
  }

  function isRedditTextBodyElement(element) {
    if (!element?.matches) return false;
    return !!element.closest("shreddit-post")
      && element.matches(REDDIT_TEXT_BODY_SELECTORS.join(","));
  }

  function isRedditPostTitleElement(element) {
    if (!element?.matches) return false;
    return !!element.closest("shreddit-post")
      && element.matches(REDDIT_TITLE_SELECTORS.join(","));
  }

  function isArticleHeadlineLinkElement(element) {
    if (!element?.matches) return false;
    return !!element.closest("article,[role=\"article\"]")
      && element.matches(ARTICLE_HEADLINE_LINK_SELECTORS.join(","));
  }

  function isSiteMetadataCandidate(element, text) {
    return isRedditMetadataCandidate(element, text);
  }

  function isRedditMetadataCandidate(element, text) {
    if (!element?.closest) return false;
    const post = element.closest("shreddit-post");
    if (!post) return false;
    if (isRedditPostTitleElement(element) || isRedditTextBodyElement(element)) return false;

    const clean = normalizeText(text);
    if (!clean || clean.length > 120) return false;

    const metadataContainer = element.closest?.([
      "[slot*=\"credit\" i]",
      "[slot*=\"flair\" i]",
      "[class*=\"meta\" i]",
      "[class*=\"flair\" i]",
      "[data-testid*=\"post_author\" i]",
      "[data-testid*=\"timestamp\" i]",
      "time",
      "faceplate-timeago"
    ].join(","));
    const hasCommunity = /\br\/[A-Za-z0-9_][\w-]*\b/.test(clean);
    const hasRelativeTime = /\b\d+\s*(?:s|sec|m|min|h|hr|d|day|mo|mon|y|yr)\.?\s*ago\b/i.test(clean);

    if (hasCommunity || hasRelativeTime) return true;
    return !!metadataContainer && clean.length <= 80;
  }

  function syncTranslationSlot(node, insertionTarget) {
    const slot = insertionTarget?.getAttribute?.("slot");
    if (slot) {
      node.setAttribute("slot", slot);
    } else {
      node.removeAttribute("slot");
    }
  }

  function findPrimaryListItemLink(element) {
    const itemText = normalizeText(getCleanText(element));
    if (!itemText) return null;

    return Array.from(element.querySelectorAll("a[href]"))
      .filter((link) => link.closest("li") === element && isElementVisible(link))
      .map((link) => ({
        link,
        text: normalizeText(getCleanText(link)),
        score: getListItemLinkScore(itemText, link)
      }))
      .filter((candidate) => candidate.text.length >= 12
        && candidate.score > 0
        && !shouldSkipCandidateByContent(candidate.text, candidate.link)
        && !shouldSkipCandidateByLanguage(candidate.text)
        && hasCandidateLanguageSignal(candidate.text))
      .sort((a, b) => b.score - a.score || b.text.length - a.text.length)[0]?.link || null;
  }

  function getListItemLinkScore(itemText, link) {
    const linkText = normalizeText(getCleanText(link));
    if (!linkText) return 0;

    let score = 0;
    if (itemText === linkText) score += 80;
    if (itemText.startsWith(linkText) || itemText.includes(linkText)) score += 40;
    if (link.querySelector?.("[class*=\"headline\"], [data-testid*=\"headline\"]")) score += 20;
    if (/\bheadline\b/i.test(String(link.className || ""))) score += 15;
    if (linkText.length >= 40) score += 10;

    return score;
  }

  function setLoading(element, providedRecord = null) {
    const record = providedRecord || getTranslationRecord(element) || getOrCreateTranslationRecord(element);
    const node = ensureTranslationNode(element, record);
    node.className = "llm-bilingual-translation is-loading";
    node.textContent = t("contentLoading", [], "翻译中...");
    clearRetryInteraction(node);
    record.state = "loading";
    setElementStatus(element, "loading");
  }

  function setStreamingTranslation(element, text, providedRecord = null) {
    const record = providedRecord || getTranslationRecord(element) || getOrCreateTranslationRecord(element);
    const node = ensureTranslationNode(element, record);
    node.className = "llm-bilingual-translation is-streaming";
    node.textContent = text;
    clearRetryInteraction(node);
    record.state = "streaming";
    setElementStatus(element, "loading");
  }

  function setTranslation(element, text, providedRecord = null) {
    const record = providedRecord || getTranslationRecord(element) || getOrCreateTranslationRecord(element);
    const node = ensureTranslationNode(element, record);
    node.className = "llm-bilingual-translation is-done";
    node.textContent = text;
    clearRetryInteraction(node);
    record.state = "done";
    record.lastSeenAt = Date.now();
    setElementStatus(element, "done");
  }

  function setError(element, message, providedRecord = null) {
    const record = providedRecord || getTranslationRecord(element) || getOrCreateTranslationRecord(element);
    const node = ensureTranslationNode(element, record);
    node.className = "llm-bilingual-translation is-error";
    node.textContent = t("contentErrorRetry", [message], `翻译失败：${message}（点击重试）`);
    node.onclick = () => retryElement(element);
    node.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
        event.preventDefault();
        retryElement(element);
      }
    };
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    record.state = "error";
    record.lastSeenAt = Date.now();
    setElementStatus(element, "error");
  }

  function clearRetryInteraction(node) {
    node.onclick = null;
    node.onkeydown = null;
    node.removeAttribute("role");
    node.removeAttribute("tabindex");
  }

  function setElementStatus(element, status) {
    const previousStatus = element.dataset.llmTranslatorStatus;
    if (previousStatus === status) return;

    if (previousStatus === "done") {
      state.stats.translated = Math.max(0, state.stats.translated - 1);
    } else if (previousStatus === "error") {
      state.stats.failed = Math.max(0, state.stats.failed - 1);
    }

    element.dataset.llmTranslatorStatus = status;

    if (status === "done") {
      state.stats.translated += 1;
    } else if (status === "error") {
      state.stats.failed += 1;
    }
  }

  async function retryElement(element) {
    try {
      if (!state.active) {
        const node = ensureTranslationNode(element);
        node.textContent = t("contentStoppedRetryUnavailable", [], "页面翻译已停止，请重新点击插件的开始翻译。");
        clearRetryInteraction(node);
        return;
      }

      state.settings = await chrome.runtime.sendMessage({ action: "get_settings" });

      const id = ensureElementId(element);
      state.queuedIds.delete(id);
      enqueueElement(element);
      flushQueue();
    } catch (error) {
      setError(element, error?.message || t("errorTranslationFailed", [], "翻译失败。"));
    }
  }

  // 扩展 UI：译文样式、页面提示和选中文本浮层。
  function injectStyles() {
    applyTranslationTheme();

    if (document.getElementById("llm-bilingual-translator-style")) return;

    const style = document.createElement("style");
    style.id = "llm-bilingual-translator-style";
    style.textContent = `
      :root {
        --llm-translator-text: #183153;
        --llm-translator-bg: rgba(23, 105, 224, 0.065);
        --llm-translator-border: #1769e0;
        --llm-translator-outline: rgba(23, 105, 224, 0.11);
        --llm-translator-loading-text: #53647a;
        --llm-translator-loading-bg: rgba(148, 163, 184, 0.13);
        --llm-translator-error-text: #b42318;
        --llm-translator-error-bg: rgba(180, 35, 24, 0.08);
      }
      :root[data-llm-translator-theme="dark"] {
        --llm-translator-text: #f8fafc;
        --llm-translator-bg: rgba(93, 163, 255, 0.13);
        --llm-translator-border: #5da3ff;
        --llm-translator-outline: rgba(93, 163, 255, 0.18);
        --llm-translator-loading-text: #cbd5e1;
        --llm-translator-loading-bg: rgba(148, 163, 184, 0.15);
        --llm-translator-error-text: #fca5a5;
        --llm-translator-error-bg: rgba(248, 113, 113, 0.13);
      }
      .llm-bilingual-translation[data-llm-translator-local-theme="dark"] {
        --llm-translator-text: #f8fafc;
        --llm-translator-bg: rgba(93, 163, 255, 0.14);
        --llm-translator-border: #5da3ff;
        --llm-translator-outline: rgba(93, 163, 255, 0.19);
        --llm-translator-loading-text: #cbd5e1;
        --llm-translator-loading-bg: rgba(148, 163, 184, 0.16);
        --llm-translator-error-text: #fca5a5;
        --llm-translator-error-bg: rgba(248, 113, 113, 0.14);
      }
      .llm-bilingual-translation {
        display: block !important;
        box-sizing: border-box !important;
        width: 100% !important;
        inline-size: 100% !important;
        max-width: 100% !important;
        max-inline-size: 100% !important;
        min-width: 0 !important;
        clear: both !important;
        align-self: stretch !important;
        margin: 0.45em 0 0.8em 0 !important;
        padding: 0.62em 0.78em !important;
        overflow-x: hidden !important;
        border: 1px solid var(--llm-translator-outline) !important;
        border-left: 2px solid var(--llm-translator-border) !important;
        border-radius: 0 9px 9px 0 !important;
        background: var(--llm-translator-bg) !important;
        color: var(--llm-translator-text) !important;
        box-shadow: 0 4px 14px rgba(15, 35, 63, 0.035) !important;
        font-family: inherit !important;
        font-size: 0.94em !important;
        font-style: normal !important;
        font-weight: 450 !important;
        line-height: 1.68 !important;
        white-space: pre-wrap !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
        direction: ltr !important;
        unicode-bidi: plaintext !important;
        text-align: start !important;
        writing-mode: horizontal-tb !important;
      }
      [data-llm-translator-layout="stacked-flex"] {
        flex-wrap: wrap !important;
      }
      [data-llm-translator-layout="stacked-flex"] > .llm-bilingual-translation {
        flex: 0 0 100% !important;
      }
      [data-llm-translator-layout="stacked-grid"] > .llm-bilingual-translation {
        grid-column: 1 / -1 !important;
      }
      :root[data-llm-translator-visibility="hidden"] .llm-bilingual-translation {
        display: none !important;
      }
      /* inside/list placement shares the original container, so dimming it would also dim the translation. */
      :root[data-llm-translator-mode="translation-first"] [data-llm-translator-status="done"][data-llm-translator-placement="after"] {
        opacity: 0.52 !important;
        transition: opacity 160ms ease !important;
      }
      :root[data-llm-translator-mode="translation-first"] .llm-bilingual-translation.is-done {
        font-size: 1em !important;
        background: rgba(23, 105, 224, 0.1) !important;
      }
      :root[data-llm-translator-theme="dark"][data-llm-translator-mode="translation-first"] .llm-bilingual-translation.is-done {
        background: rgba(93, 163, 255, 0.19) !important;
      }
      :root[data-llm-translator-mode="translation-first"] .llm-bilingual-translation[data-llm-translator-local-theme="dark"].is-done {
        background: rgba(93, 163, 255, 0.19) !important;
      }
      .llm-bilingual-translation.is-loading {
        color: var(--llm-translator-loading-text) !important;
        border-left-color: #94a3b8 !important;
        background: var(--llm-translator-loading-bg) !important;
        animation: llmTranslatorLoadingPulse 1.25s ease-in-out infinite !important;
      }
      @keyframes llmTranslatorLoadingPulse {
        0%, 100% {
          opacity: 0.68;
        }
        50% {
          opacity: 1;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        .llm-bilingual-translation.is-loading {
          animation: none !important;
        }
      }
      .llm-bilingual-translation.is-error {
        color: var(--llm-translator-error-text) !important;
        border-left-color: var(--llm-translator-error-text) !important;
        background: var(--llm-translator-error-bg) !important;
        cursor: pointer !important;
      }
      .llm-bilingual-selection-card {
        position: fixed !important;
        z-index: 2147483647 !important;
        right: 18px !important;
        bottom: 18px !important;
        width: min(440px, calc(100vw - 36px)) !important;
        max-height: min(560px, calc(100vh - 36px)) !important;
        overflow: auto !important;
        box-sizing: border-box !important;
        padding: 16px !important;
        border: 1px solid rgba(148, 163, 184, 0.38) !important;
        border-radius: 15px !important;
        background: #ffffff !important;
        color: #10233f !important;
        box-shadow: 0 22px 60px rgba(15, 35, 63, 0.22) !important;
        font: 14px/1.58 "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif !important;
        direction: ltr !important;
        unicode-bidi: plaintext !important;
        text-align: start !important;
        writing-mode: horizontal-tb !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-selection-card {
        border-color: rgba(148, 163, 184, 0.3) !important;
        background: #111b2a !important;
        color: #f8fafc !important;
        box-shadow: 0 22px 60px rgba(0, 0, 0, 0.44) !important;
      }
      .llm-bilingual-selection-card__header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 10px !important;
        margin-bottom: 12px !important;
        font-size: 15px !important;
        font-weight: 750 !important;
      }
      .llm-bilingual-selection-card__actions {
        display: flex !important;
        gap: 7px !important;
      }
      .llm-bilingual-selection-card button {
        width: auto !important;
        height: 30px !important;
        min-width: 30px !important;
        margin: 0 !important;
        padding: 0 10px !important;
        border: 1px solid rgba(148, 163, 184, 0.42) !important;
        border-radius: 8px !important;
        background: rgba(148, 163, 184, 0.08) !important;
        color: inherit !important;
        font: inherit !important;
        cursor: pointer !important;
      }
      .llm-bilingual-selection-card button:disabled {
        cursor: not-allowed !important;
        opacity: 0.5 !important;
      }
      .llm-bilingual-selection-card__label {
        margin: 0 0 5px 0 !important;
        color: #53647a !important;
        font-size: 11px !important;
        font-weight: 700 !important;
        letter-spacing: 0.05em !important;
        text-transform: uppercase !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-selection-card__label {
        color: #cbd5e1 !important;
      }
      .llm-bilingual-selection-card__source {
        margin: 0 0 12px 0 !important;
        padding: 10px 11px !important;
        border: 1px solid rgba(148, 163, 184, 0.25) !important;
        border-radius: 9px !important;
        background: rgba(148, 163, 184, 0.08) !important;
        color: #64748b !important;
        white-space: pre-wrap !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-selection-card__source {
        color: #cbd5e1 !important;
      }
      .llm-bilingual-selection-card__result {
        margin: 0 !important;
        color: inherit !important;
        line-height: 1.68 !important;
        white-space: pre-wrap !important;
      }
      .llm-bilingual-selection-card.is-error .llm-bilingual-selection-card__result {
        color: var(--llm-translator-error-text) !important;
      }
      .llm-bilingual-selection-card__status {
        min-height: 18px !important;
        margin: 10px 0 0 0 !important;
        color: #1769e0 !important;
        font-size: 11.5px !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-selection-card__status {
        color: #8dc0ff !important;
      }
      .llm-bilingual-page-notice {
        position: fixed !important;
        z-index: 2147483647 !important;
        right: 18px !important;
        top: 18px !important;
        width: min(390px, calc(100vw - 36px)) !important;
        box-sizing: border-box !important;
        padding: 13px 15px !important;
        border: 1px solid rgba(148, 163, 184, 0.34) !important;
        border-left: 3px solid var(--llm-translator-border) !important;
        border-radius: 12px !important;
        background: #ffffff !important;
        color: #10233f !important;
        box-shadow: 0 18px 48px rgba(15, 35, 63, 0.2) !important;
        font: 13.5px/1.55 "Aptos", "Segoe UI Variable Text", "Segoe UI", sans-serif !important;
        white-space: pre-wrap !important;
        direction: ltr !important;
        unicode-bidi: plaintext !important;
        text-align: start !important;
        writing-mode: horizontal-tb !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-page-notice {
        border-color: rgba(148, 163, 184, 0.28) !important;
        background: #111b2a !important;
        color: #f8fafc !important;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42) !important;
      }
      .llm-bilingual-page-notice.is-error {
        border-left-color: var(--llm-translator-error-text) !important;
        background: var(--llm-translator-error-bg) !important;
        color: var(--llm-translator-error-text) !important;
      }
      @media (max-width: 520px) {
        .llm-bilingual-selection-card {
          right: 12px !important;
          bottom: 12px !important;
          width: calc(100vw - 24px) !important;
          max-height: calc(100vh - 24px) !important;
          padding: 14px !important;
          border-radius: 13px !important;
        }
        .llm-bilingual-page-notice {
          top: 12px !important;
          right: 12px !important;
          width: calc(100vw - 24px) !important;
        }
      }
    `;
    document.documentElement.appendChild(style);
  }

  async function showPageNoticeWithUiLanguage(request) {
    await ensureUiLanguageLoaded();
    return showPageNotice(request);
  }

  function showPageNotice(request) {
    injectStyles();
    document.querySelectorAll(".llm-bilingual-page-notice").forEach((node) => node.remove());

    const notice = document.createElement("div");
    notice.className = `llm-bilingual-page-notice${request.isError ? " is-error" : ""}`;
    notice.setAttribute("role", "status");
    notice.textContent = request.text || t("contentNoOperationResult", [], "翻译操作没有返回结果。");
    document.documentElement.appendChild(notice);

    setTimeout(() => {
      if (notice.isConnected) notice.remove();
    }, 5000);

    return { ok: true };
  }

  async function showSelectionTranslationWithUiLanguage(request) {
    await ensureUiLanguageLoaded();
    return showSelectionTranslation(request);
  }

  function showSelectionTranslation(request) {
    injectStyles();
    document.querySelectorAll(".llm-bilingual-selection-card").forEach((node) => closeSelectionCard(node));

    const card = document.createElement("section");
    card.className = `llm-bilingual-selection-card${request.error ? " is-error" : ""}`;
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", t("selectionCardAria", [], "选中文本翻译"));

    const header = document.createElement("div");
    header.className = "llm-bilingual-selection-card__header";

    const title = document.createElement("span");
    title.textContent = t("selectionCardTitle", [], "选中文本翻译");

    const actions = document.createElement("div");
    actions.className = "llm-bilingual-selection-card__actions";

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.dataset.action = "copy";
    copyButton.textContent = t("selectionCopyTranslation", [], "复制译文");
    copyButton.title = request.translatedText ? t("selectionCopyTranslation", [], "复制译文") : t("selectionNoCopyText", [], "没有可复制的译文");
    copyButton.disabled = !request.translatedText || !!request.error;
    copyButton.setAttribute("aria-label", copyButton.title);
    copyButton.addEventListener("click", () => copySelectionTranslation(card, request.translatedText || ""));

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.dataset.action = "close";
    closeButton.textContent = t("close", [], "关闭");
    closeButton.title = t("close", [], "关闭");
    closeButton.setAttribute("aria-label", t("selectionCloseAria", [], "关闭选中文本翻译"));
    closeButton.addEventListener("click", () => closeSelectionCard(card));

    actions.append(copyButton, closeButton);
    header.append(title, actions);

    const sourceLabel = document.createElement("div");
    sourceLabel.className = "llm-bilingual-selection-card__label";
    sourceLabel.textContent = t("selectionSourceLabel", [], "原文");

    const source = document.createElement("p");
    source.className = "llm-bilingual-selection-card__source";
    source.textContent = request.originalText || "";

    const resultLabel = document.createElement("div");
    resultLabel.className = "llm-bilingual-selection-card__label";
    resultLabel.textContent = request.error ? t("selectionErrorLabel", [], "错误") : (request.notice ? t("selectionNoticeLabel", [], "提示") : t("selectionTranslationLabel", [], "译文"));

    const result = document.createElement("p");
    result.className = "llm-bilingual-selection-card__result";
    result.textContent = request.error
      ? t("selectionErrorText", [request.error], `翻译失败：${request.error}`)
      : (request.notice || request.translatedText || t("errorNoTranslationResult", [], "没有获取到译文。"));

    const status = document.createElement("p");
    status.className = "llm-bilingual-selection-card__status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");

    card.append(header, sourceLabel, source, resultLabel, result, status);
    document.documentElement.appendChild(card);
    positionSelectionCard(card);
    installSelectionCardDismissHandlers(card);

    return { ok: true };
  }

  function closeSelectionCard(card) {
    if (!card) return;
    if (typeof card.__llmTranslatorCleanup === "function") {
      card.__llmTranslatorCleanup();
      card.__llmTranslatorCleanup = null;
    }
    if (card.isConnected) card.remove();
  }

  function installSelectionCardDismissHandlers(card) {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        closeSelectionCard(card);
      }
    };
    const onPointerDown = (event) => {
      if (!card.contains(event.target)) {
        closeSelectionCard(card);
      }
    };
    const pointerTimer = setTimeout(() => {
      if (card.isConnected) {
        document.addEventListener("pointerdown", onPointerDown, true);
      }
    }, 0);

    document.addEventListener("keydown", onKeyDown, true);
    card.__llmTranslatorCleanup = () => {
      clearTimeout(pointerTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }

  function positionSelectionCard(card) {
    const rect = getSelectionRect();
    if (!rect) return;

    const margin = 12;
    const gap = 8;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    let left = rect.left;
    let top = rect.bottom + gap;

    if (top + height > viewportHeight - margin) {
      top = rect.top - height - gap;
    }

    if (top < margin || width <= 0 || height <= 0) return;

    if (left + width > viewportWidth - margin) {
      left = viewportWidth - width - margin;
    }

    card.style.setProperty("left", `${Math.max(margin, Math.round(left))}px`, "important");
    card.style.setProperty("top", `${Math.max(margin, Math.round(top))}px`, "important");
    card.style.setProperty("right", "auto", "important");
    card.style.setProperty("bottom", "auto", "important");
  }

  function getSelectionRect() {
    const selection = window.getSelection?.();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

    const range = selection.getRangeAt(0);
    const rect = Array.from(range.getClientRects()).find((item) => item.width > 0 && item.height > 0)
      || range.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;

    return rect;
  }

  async function copySelectionTranslation(card, text) {
    if (!text) return;
    const status = card.querySelector(".llm-bilingual-selection-card__status");

    try {
      await navigator.clipboard?.writeText(text);
      const copyButton = card.querySelector("[data-action='copy']");
      if (copyButton) {
        copyButton.textContent = t("selectionCopied", [], "已复制");
        if (status) status.textContent = t("selectionCopiedStatus", [], "译文已复制到剪贴板。");
        setTimeout(() => {
          if (copyButton.isConnected) copyButton.textContent = t("selectionCopyTranslation", [], "复制译文");
          if (status?.isConnected) status.textContent = "";
        }, 1200);
      }
    } catch (error) {
      const copyButton = card.querySelector("[data-action='copy']");
      if (copyButton) copyButton.textContent = t("selectionCopyFailed", [], "复制失败");
      if (status) status.textContent = t("selectionCopyFailedStatus", [], "复制失败，请手动选择译文复制。");
    }
  }

  function setTranslationVisibility(visible) {
    state.translationVisible = visible !== false;
    state.stats.translationVisible = state.translationVisible;
    document.documentElement.dataset.llmTranslatorVisibility = state.translationVisible ? "visible" : "hidden";
    return { ok: true, visible: state.translationVisible, stats: getStatsSnapshot() };
  }

  function setDisplayMode(displayMode) {
    state.displayMode = displayMode === "translation-first" ? "translation-first" : "bilingual";
    document.documentElement.dataset.llmTranslatorMode = state.displayMode;
    return { ok: true, displayMode: state.displayMode, stats: getStatsSnapshot() };
  }

  function getStatsSnapshot() {
    return {
      ...state.stats,
      translationVisible: state.translationVisible,
      displayMode: state.displayMode
    };
  }

  function refreshPageLanguageContext(settings) {
    const htmlKind = LLMTranslatorShared.normalizeTargetLanguageKind(document.documentElement.lang || "");
    const targetKind = LLMTranslatorShared.normalizeTargetLanguageKind(settings?.targetLanguage);
    if (htmlKind && targetKind && htmlKind !== targetKind) {
      state.pageLanguageContext = {
        isTargetLanguagePage: false,
        checkedAt: Date.now(),
        segmentCount: 0
      };
      return state.pageLanguageContext;
    }

    const segments = collectVisibleTextSegments();
    const pageInfo = {
      htmlLang: document.documentElement.lang || "",
      text: normalizeText(segments.join(" ")),
      segments
    };

    state.pageLanguageContext = {
      isTargetLanguagePage: LLMTranslatorShared.isLikelyTargetLanguagePage(pageInfo, settings?.targetLanguage),
      checkedAt: Date.now(),
      segmentCount: segments.length
    };
    return state.pageLanguageContext;
  }

  function collectVisibleTextSample(maxLength = 4000) {
    return normalizeText(collectVisibleTextSegments(64, maxLength).join(" ")).slice(0, maxLength);
  }

  function collectVisibleTextSegments(maxSegments = 48, maxTotalLength = 6000) {
    const root = document.body || document.documentElement;
    if (!root) return [];

    const elementSegments = collectVisibleElementTextSegments(root, maxSegments, maxTotalLength);
    if (elementSegments.length > 0) return elementSegments;

    const parts = [];
    let totalLength = 0;
    const walker = document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node.parentElement) return NodeFilter.FILTER_REJECT;
          if (node.parentElement.closest(".llm-bilingual-translation")) return NodeFilter.FILTER_REJECT;
          if (hasBlockedAncestor(node.parentElement)) return NodeFilter.FILTER_REJECT;
          if (!isElementVisible(node.parentElement)) return NodeFilter.FILTER_REJECT;
          if (!isElementNearActiveViewport(node.parentElement)) return NodeFilter.FILTER_REJECT;

          const text = normalizeText(node.textContent);
          return text.length >= 8 && !LLMTranslatorShared.shouldSkipTextByContent(text)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        }
      }
    );

    let node = walker.nextNode();
    while (node && parts.length < maxSegments && totalLength < maxTotalLength) {
      const text = normalizeText(node.textContent);
      parts.push(text);
      totalLength += text.length;
      node = walker.nextNode();
    }

    return parts;
  }

  function collectVisibleElementTextSegments(root, maxSegments, maxTotalLength) {
    const sampledSegments = collectSampledVisibleElementTextSegments(root, maxSegments, maxTotalLength);
    if (sampledSegments.length > 0) return sampledSegments;

    return collectSelectorVisibleElementTextSegments(root, maxSegments, maxTotalLength);
  }

  function collectSampledVisibleElementTextSegments(root, maxSegments, maxTotalLength) {
    const parts = [];
    const seenTexts = new Set();
    let totalLength = 0;

    if (typeof document.elementsFromPoint !== "function") return [];

    const costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings);
    for (const element of getViewportSampleElements(root)) {
      const block = findImmediateReadableBlock(element, costSettings);
      totalLength = addVisibleTextSegment(block, root, parts, seenTexts, totalLength, maxSegments, maxTotalLength);
      if (parts.length >= maxSegments || totalLength >= maxTotalLength) return parts;

      const localScope = getLocalReadableScope(element, root);
      const elements = localScope?.querySelectorAll?.(getViewportReadableBlockSelector()) || [];
      for (const candidate of elements) {
        totalLength = addVisibleTextSegment(candidate, root, parts, seenTexts, totalLength, maxSegments, maxTotalLength);
        if (parts.length >= maxSegments || totalLength >= maxTotalLength) return parts;
      }
    }

    return parts;
  }

  function collectSelectorVisibleElementTextSegments(root, maxSegments, maxTotalLength, elements = null) {
    const parts = [];
    const seenTexts = new Set();
    let totalLength = 0;
    const readableElements = elements || root.querySelectorAll?.(getViewportReadableBlockSelector()) || [];

    for (const element of readableElements) {
      if (parts.length >= maxSegments || totalLength >= maxTotalLength) break;
      totalLength = addVisibleTextSegment(element, root, parts, seenTexts, totalLength, maxSegments, maxTotalLength);
    }

    return parts;
  }

  function addVisibleTextSegment(element, root, parts, seenTexts, totalLength, maxSegments, maxTotalLength) {
    if (!element || parts.length >= maxSegments || totalLength >= maxTotalLength) return totalLength;
    if (root !== element && !root.contains(element)) return totalLength;
    if (!isElementNearActiveViewport(element)) return totalLength;
    if (hasBlockedAncestor(element)) return totalLength;
    if (!isElementVisible(element)) return totalLength;

    const text = normalizeText(getCleanText(element));
    if (text.length < 8 || LLMTranslatorShared.shouldSkipTextByContent(text)) return totalLength;
    const textKey = text.toLowerCase();
    if (seenTexts.has(textKey)) return totalLength;

    seenTexts.add(textKey);
    parts.push(text);
    return totalLength + text.length;
  }

  function applyTranslationTheme() {
    document.documentElement.dataset.llmTranslatorTheme = detectPageTheme();
  }

  function detectPageTheme() {
    const background = getEffectiveBackgroundColor(document.body) || getEffectiveBackgroundColor(document.documentElement);
    if (!background) {
      return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
    }

    return getRgbLuminance(background) < 128 ? "dark" : "light";
  }

  function detectElementTheme(element) {
    const background = getEffectiveBackgroundColor(element);
    if (background) {
      return getRgbLuminance(background) < 128 ? "dark" : "light";
    }

    const textColor = parseCssRgbColor(window.getComputedStyle(element).color);
    if (textColor && getRgbLuminance(textColor) > 180) {
      return "dark";
    }

    return document.documentElement.dataset.llmTranslatorTheme || detectPageTheme();
  }

  function getEffectiveBackgroundColor(element) {
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      const parsed = parseCssRgbColor(window.getComputedStyle(current).backgroundColor);
      if (parsed && parsed.a > 0.2) return parsed;
      current = current.parentElement;
    }
    return null;
  }

  function getRgbLuminance(color) {
    return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
  }

  function parseCssRgbColor(value) {
    const match = String(value || "").match(/rgba?\(([^)]+)\)/i);
    if (!match) return null;

    const parts = match[1]
      .replace(/\//g, " ")
      .split(/[,\s]+/)
      .filter(Boolean)
      .map(Number);

    if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;

    return {
      r: parts[0],
      g: parts[1],
      b: parts[2],
      a: parts.length >= 4 ? parts[3] : 1
    };
  }

  function createEmptyStats() {
    return {
      scanned: 0,
      queued: 0,
      translated: 0,
      failed: 0,
      skippedBudget: 0,
      cacheHits: 0,
      apiRequested: 0,
      translationVisible: true,
      displayMode: "bilingual"
    };
  }

  function createEmptyBudget() {
    return {
      requests: 0,
      chars: 0
    };
  }

  function reserveTranslationBudget(text) {
    const costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings);
    const textLength = normalizeText(text).length;
    const nextRequests = state.budget.requests + 1;
    const nextChars = state.budget.chars + textLength;

    if (nextRequests > costSettings.maxRequestsPerPage || nextChars > costSettings.maxCharsPerPage) {
      return false;
    }

    state.budget.requests = nextRequests;
    state.budget.chars = nextChars;
    return true;
  }
})();

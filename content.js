(() => {
  const CONTENT_SCRIPT_VERSION = "0.4.22";
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
    flushTimer: null,
    flushRunId: null,
    counter: 0,
    settings: null,
    runId: 0,
    pageLanguageContext: null,
    mutationObserver: null,
    mutationScanTimer: null,
    pendingScanRoots: new Set(),
    viewportScanTimer: null,
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
      return respondAsync(scanCurrentArea(), sendResponse);
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

    const elements = scanViewport(document);
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

    clearTimeout(state.flushTimer);
    clearTimeout(state.mutationScanTimer);
    clearTimeout(state.viewportScanTimer);
    state.flushRunId = null;
    state.queue = [];
    state.queuedIds.clear();
    state.pendingScanRoots.clear();
    state.lastViewportSnapshot = null;
    stopViewportTracking();
  }

  function clearTranslations() {
    stopTranslation();
    state.stats = createEmptyStats();
    setTranslationVisibility(true);

    document.querySelectorAll(".llm-bilingual-translation").forEach((node) => node.remove());
    document.querySelectorAll("[data-llm-translator-id]").forEach((node) => {
      delete node.dataset.llmTranslatorId;
      delete node.dataset.llmTranslatorStatus;
      delete node.dataset.llmTranslatorPlacement;
    });
  }

  function collectCandidateElements(root = document) {
    const costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings);
    const scanRoot = getScanRoot(root);
    if (!scanRoot) return [];

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

    let textNode = walker.nextNode();
    while (textNode) {
      const block = findReadableBlock(textNode.parentElement, costSettings);
      if (block && !candidates.has(block)) {
        const text = getCleanText(block);
        const textKey = text.toLowerCase();
        if (!seenTexts.has(textKey) && isCandidateElement(block, costSettings, text)) {
          seenTexts.add(textKey);
          candidates.set(block, text);
        }
      }

      textNode = walker.nextNode();
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
      .slice(0, costSettings.maxElementsPerScan);
  }

  function cleanupExistingTranslatorState(existingState) {
    existingState.active = false;
    existingState.runId = Number(existingState.runId || 0) + 1;

    if (existingState.runtimeMessageListener) {
      chrome.runtime.onMessage.removeListener(existingState.runtimeMessageListener);
    }
    if (existingState.observer) existingState.observer.disconnect();
    if (existingState.mutationObserver) existingState.mutationObserver.disconnect();
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
    if (node.parentElement.closest("a[href]") && isShortLowInformationLinkText(text)) return false;
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
      const text = getCleanText(current);
      const siteSpecificBlock = findSiteSpecificReadableBlock(current);

      if (siteSpecificBlock) {
        return siteSpecificBlock;
      }

      if (isSemanticBlockTag(tagName)) {
        if ((tagName === "TD" || tagName === "TH") && inlineFallback) {
          return inlineFallback;
        }
        return current;
      }

      if (!inlineFallback && isInlineFallbackTag(tagName) && isUsefulInlineBlock(current, text, costSettings)) {
        inlineFallback = current;
      }

      if (!genericFallback && isGenericBlockTag(tagName) && isUsefulGenericBlock(current, text, costSettings)) {
        genericFallback = current;
      }

      current = current.parentElement;
    }

    return inlineFallback || genericFallback;
  }

  function findSiteSpecificReadableBlock(element) {
    const redditTextBody = findRedditTextBodyElement(element);
    if (redditTextBody) return redditTextBody;

    return null;
  }

  function findRedditTextBodyElement(element) {
    if (!element?.closest) return null;
    const post = element.closest("shreddit-post");
    if (!post) return null;

    return element.closest("shreddit-post-text-body")
      || element.closest([
        "[property=\"schema:articleBody\"][id$=\"-post-rtjson-content\"]",
        ".feed-card-text-preview"
      ].join(","));
  }

  function isCandidateElement(element, costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings), knownText = null) {
    if (element.dataset.llmTranslatorStatus) return false;
    if (hasBlockedAncestor(element)) return false;
    if (!isElementInActiveContentScope(element)) return false;
    if (isBlockedInteractiveComposer(element)) return false;
    if (element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest(".llm-bilingual-translation")) return false;
    if (element.querySelector(".llm-bilingual-translation")) return false;

    const text = knownText === null ? getCleanText(element) : knownText;
    if (text.length < getMinimumCandidateTextLength(element) || text.length > costSettings.maxTextLength) return false;
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
    if (shouldUsePageLanguageCandidateMode()) return false;
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

    const tableCell = element.closest?.("td,th");
    if (tableCell?.closest("table,[role=\"table\"],[role=\"grid\"]")) {
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

    if (element.closest("[data-testid=\"tweetText\"]")) score += 90;
    if (isRedditTextBodyElement(element)) score += 85;
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
    // 用户已经进入完全不同的阅读区域时，让旧批次失效，优先服务当前视口。
    state.runId += 1;
    clearTimeout(state.flushTimer);
    state.flushRunId = null;
    state.queue.forEach((element) => resetPendingElement(element, { releaseBudget: true }));
    state.queue = [];
    state.queuedIds.clear();
    state.pendingScanRoots.clear();

    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }

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
    const node = findExistingTranslationNode(element, placement);
    if (node) node.remove();

    delete element.dataset.llmTranslatorStatus;
    delete element.dataset.llmTranslatorPlacement;
  }

  function releaseReservedBudget(element) {
    const textLength = normalizeText(getCleanText(element)).length;
    state.budget.requests = Math.max(0, state.budget.requests - 1);
    state.budget.chars = Math.max(0, state.budget.chars - textLength);
  }

  function observeElements(elements) {
    if (!state.observer) {
      state.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!state.active || !entry.isIntersecting) continue;

          const element = entry.target;
          state.observer.unobserve(element);
          enqueueElement(element);
        }
      }, {
        root: null,
        rootMargin: "400px 0px",
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

  function scanViewport(root = document) {
    const superseded = prepareViewportScan();
    const elements = collectCandidateElements(root);
    state.stats.scanned += elements.length;
    processCandidateElements(elements);
    if (superseded && state.queue.length > 0) {
      flushQueue();
    }
    return elements;
  }

  async function scanCurrentArea() {
    if (!state.active) {
      return startTranslation();
    }

    state.settings = await chrome.runtime.sendMessage({ action: "get_settings" });
    refreshPageLanguageContext(state.settings);
    setTranslationVisibility(true);
    const elements = scanViewport(document);
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
      scanViewport(root);
    }, LLMTranslatorShared.getViewportScanDebounceMs());
  }

  function startDynamicObserver() {
    if (state.mutationObserver || !document.body) return;

    state.mutationObserver = new MutationObserver((mutations) => {
      if (!state.active) return;

      for (const mutation of mutations) {
        if (mutation.type === "childList") {
          mutation.addedNodes.forEach(queueDynamicScanRoot);
        } else if (mutation.type === "attributes") {
          queueDynamicScanRoot(mutation.target);
        }
      }

      scheduleDynamicScan();
    });

    state.mutationObserver.observe(
      document.body,
      LLMTranslatorShared.getDynamicScanObserverOptions()
    );
  }

  function queueDynamicScanRoot(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.closest?.(".llm-bilingual-translation")) return;
    if (node.matches?.(".llm-bilingual-translation")) return;
    state.pendingScanRoots.add(node);
  }

  function scheduleDynamicScan() {
    clearTimeout(state.mutationScanTimer);
    state.mutationScanTimer = setTimeout(() => {
      if (!state.active || state.pendingScanRoots.size === 0) return;

      const elements = [];
      for (const root of state.pendingScanRoots) {
        elements.push(...collectCandidateElements(root));
      }

      state.pendingScanRoots.clear();
      processCandidateElements(Array.from(new Set(elements)));
    }, LLMTranslatorShared.getDynamicScanDebounceMs());
  }

  function enqueueElement(element) {
    const id = ensureElementId(element);
    if (state.queuedIds.has(id)) return;

    const text = getCleanText(element);
    if (!reserveTranslationBudget(text)) {
      setElementStatus(element, "skipped-budget");
      state.stats.skippedBudget += 1;
      return;
    }

    state.queuedIds.add(id);
    state.queue.push(element);
    setElementStatus(element, "queued");
    state.stats.queued += 1;

    if (shouldFlushQueueNow()) {
      flushQueue();
      return;
    }

    clearTimeout(state.flushTimer);
    state.flushTimer = setTimeout(flushQueue, 700);
  }

  function shouldFlushQueueNow() {
    const { batchSize, maxCharsPerBatch } = getBatchLimits();
    return state.queue.length >= batchSize || getQueuedTextLength(state.queue) >= maxCharsPerBatch;
  }

  function getBatchLimits() {
    const costSettings = LLMTranslatorShared.normalizeCostSettings(state.settings);
    return {
      batchSize: Math.max(1, Math.min(20, Number(state.settings?.batchSize) || 8)),
      maxCharsPerBatch: costSettings.maxCharsPerBatch,
      maxConcurrentBatches: costSettings.maxConcurrentBatches
    };
  }

  function getQueuedTextLength(elements) {
    return elements.reduce((sum, element) => sum + getCleanText(element).length, 0);
  }

  function takeNextBatchElements() {
    const { batchSize, maxCharsPerBatch } = getBatchLimits();
    const elements = [];
    let charCount = 0;

    while (state.queue.length > 0 && elements.length < batchSize) {
      const element = state.queue[0];
      const textLength = getCleanText(element).length;
      if (elements.length > 0 && charCount + textLength > maxCharsPerBatch) break;

      elements.push(state.queue.shift());
      charCount += textLength;
      if (charCount >= maxCharsPerBatch) break;
    }

    return elements;
  }

  async function flushQueue() {
    clearTimeout(state.flushTimer);
    if (!state.active || state.queue.length === 0) return;
    if (state.flushRunId === state.runId) return;

    // 小并发能减少首屏等待，但限制在 1-3，避免同一页面把模型接口打满。
    const flushRunId = state.runId;
    state.flushRunId = flushRunId;

    try {
      while (state.active && flushRunId === state.runId && state.queue.length > 0) {
        const { maxConcurrentBatches } = getBatchLimits();
        const batches = [];

        while (batches.length < maxConcurrentBatches && state.queue.length > 0) {
          const elements = takeNextBatchElements();
          if (elements.length === 0) break;
          batches.push(elements);
        }

        if (batches.length === 0) return;
        await Promise.all(batches.map((elements) => translateBatchElements(elements, flushRunId)));
      }
    } finally {
      if (state.flushRunId === flushRunId) {
        state.flushRunId = null;
      }
    }
  }

  async function translateBatchElements(elements, flushRunId) {
    const items = elements.map((element) => ({
      id: ensureElementId(element),
      text: getCleanText(element)
    }));

    elements.forEach((element) => setLoading(element));

    try {
      const response = await chrome.runtime.sendMessage({
        action: "translate_batch",
        items
      });

      if (!state.active || flushRunId !== state.runId) return;

      state.stats.apiRequested += Number(response?.meta?.requested) || 0;
      state.stats.cacheHits += Number(response?.meta?.cacheHits) || 0;

      const results = response?.results || [];
      const byId = new Map(results.map((result) => [String(result.id), result]));

      for (const element of elements) {
        const result = byId.get(element.dataset.llmTranslatorId);
        if (!result || result.error) {
          setError(element, result?.error || response?.error || t("errorTranslationFailed", [], "翻译失败。"));
        } else {
          setTranslation(element, result.text);
        }
      }
    } catch (error) {
      if (!state.active || flushRunId !== state.runId) return;
      elements.forEach((element) => setError(element, error.message));
    }
  }

  function ensureElementId(element) {
    if (!element.dataset.llmTranslatorId) {
      state.counter += 1;
      element.dataset.llmTranslatorId = `llm-${Date.now()}-${state.counter}`;
    }
    return element.dataset.llmTranslatorId;
  }

  function getCleanText(element) {
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

  function ensureTranslationNode(element) {
    const placement = LLMTranslatorShared.getTranslationPlacement(element.tagName);
    const insertionTarget = getTranslationInsertionTarget(element, placement);
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
    node.dataset.llmTranslatorLocalTheme = detectElementTheme(element);
    return node;
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
    const redditTarget = findRedditTextBodyInsertionTarget(element);
    if (redditTarget) return redditTarget;

    if (placement !== "inside" || element.tagName !== "LI") return element;

    return findPrimaryListItemLink(element) || element;
  }

  function findRedditTextBodyInsertionTarget(element) {
    const textBody = isRedditTextBodyElement(element)
      ? element
      : findRedditTextBodyElement(element);
    if (!textBody) return null;

    return textBody.querySelector?.(":scope > a[slot=\"text-body\"]") || textBody;
  }

  function isRedditTextBodyElement(element) {
    if (!element?.matches) return false;
    return !!element.closest("shreddit-post")
      && element.matches([
        "shreddit-post-text-body",
        "[property=\"schema:articleBody\"][id$=\"-post-rtjson-content\"]",
        ".feed-card-text-preview"
      ].join(","));
  }

  function syncTranslationSlot(node, insertionTarget) {
    if (insertionTarget?.closest?.("shreddit-post-text-body")) {
      node.setAttribute("slot", "text-body");
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

  function setLoading(element) {
    const node = ensureTranslationNode(element);
    node.className = "llm-bilingual-translation is-loading";
    node.textContent = t("contentLoading", [], "翻译中...");
    clearRetryInteraction(node);
    setElementStatus(element, "loading");
  }

  function setTranslation(element, text) {
    const node = ensureTranslationNode(element);
    node.className = "llm-bilingual-translation is-done";
    node.textContent = text;
    clearRetryInteraction(node);
    setElementStatus(element, "done");
  }

  function setError(element, message) {
    const node = ensureTranslationNode(element);
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

  function injectStyles() {
    applyTranslationTheme();

    if (document.getElementById("llm-bilingual-translator-style")) return;

    const style = document.createElement("style");
    style.id = "llm-bilingual-translator-style";
    style.textContent = `
      :root {
        --llm-translator-text: #1f2937;
        --llm-translator-bg: rgba(37, 99, 235, 0.08);
        --llm-translator-border: #2563eb;
        --llm-translator-loading-text: #475569;
        --llm-translator-loading-bg: rgba(148, 163, 184, 0.16);
        --llm-translator-error-text: #b91c1c;
        --llm-translator-error-bg: rgba(220, 38, 38, 0.1);
      }
      :root[data-llm-translator-theme="dark"] {
        --llm-translator-text: #f8fafc;
        --llm-translator-bg: rgba(96, 165, 250, 0.16);
        --llm-translator-border: #60a5fa;
        --llm-translator-loading-text: #cbd5e1;
        --llm-translator-loading-bg: rgba(148, 163, 184, 0.18);
        --llm-translator-error-text: #fca5a5;
        --llm-translator-error-bg: rgba(248, 113, 113, 0.16);
      }
      .llm-bilingual-translation[data-llm-translator-local-theme="dark"] {
        --llm-translator-text: #f8fafc;
        --llm-translator-bg: rgba(96, 165, 250, 0.18);
        --llm-translator-border: #60a5fa;
        --llm-translator-loading-text: #cbd5e1;
        --llm-translator-loading-bg: rgba(148, 163, 184, 0.2);
        --llm-translator-error-text: #fca5a5;
        --llm-translator-error-bg: rgba(248, 113, 113, 0.18);
      }
      .llm-bilingual-translation {
        display: block !important;
        box-sizing: border-box !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        clear: both !important;
        margin: 6px 0 12px 0 !important;
        padding: 8px 10px !important;
        border-left: 3px solid var(--llm-translator-border) !important;
        background: var(--llm-translator-bg) !important;
        color: var(--llm-translator-text) !important;
        font-size: 0.95em !important;
        line-height: 1.65 !important;
        white-space: pre-wrap !important;
        overflow-wrap: anywhere !important;
        word-break: normal !important;
        direction: ltr !important;
        unicode-bidi: plaintext !important;
        text-align: start !important;
        writing-mode: horizontal-tb !important;
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
        background: rgba(37, 99, 235, 0.12) !important;
      }
      :root[data-llm-translator-theme="dark"][data-llm-translator-mode="translation-first"] .llm-bilingual-translation.is-done {
        background: rgba(96, 165, 250, 0.22) !important;
      }
      :root[data-llm-translator-mode="translation-first"] .llm-bilingual-translation[data-llm-translator-local-theme="dark"].is-done {
        background: rgba(96, 165, 250, 0.22) !important;
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
        width: min(420px, calc(100vw - 36px)) !important;
        max-height: min(520px, calc(100vh - 36px)) !important;
        overflow: auto !important;
        box-sizing: border-box !important;
        padding: 12px !important;
        border: 1px solid rgba(148, 163, 184, 0.45) !important;
        border-radius: 8px !important;
        background: #ffffff !important;
        color: #0f172a !important;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.24) !important;
        font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        direction: ltr !important;
        unicode-bidi: plaintext !important;
        text-align: start !important;
        writing-mode: horizontal-tb !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-selection-card {
        border-color: rgba(148, 163, 184, 0.38) !important;
        background: #111827 !important;
        color: #f8fafc !important;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42) !important;
      }
      .llm-bilingual-selection-card__header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        gap: 10px !important;
        margin-bottom: 8px !important;
        font-weight: 700 !important;
      }
      .llm-bilingual-selection-card__actions {
        display: flex !important;
        gap: 6px !important;
      }
      .llm-bilingual-selection-card button {
        width: auto !important;
        height: 28px !important;
        min-width: 28px !important;
        margin: 0 !important;
        padding: 0 8px !important;
        border: 1px solid rgba(148, 163, 184, 0.55) !important;
        border-radius: 6px !important;
        background: transparent !important;
        color: inherit !important;
        font: inherit !important;
        cursor: pointer !important;
      }
      .llm-bilingual-selection-card button:disabled {
        cursor: not-allowed !important;
        opacity: 0.5 !important;
      }
      .llm-bilingual-selection-card__label {
        margin: 0 0 4px 0 !important;
        color: #475569 !important;
        font-size: 12px !important;
        font-weight: 700 !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-selection-card__label {
        color: #cbd5e1 !important;
      }
      .llm-bilingual-selection-card__source {
        margin: 0 0 8px 0 !important;
        padding-bottom: 8px !important;
        border-bottom: 1px solid rgba(148, 163, 184, 0.35) !important;
        color: #64748b !important;
        white-space: pre-wrap !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-selection-card__source {
        color: #cbd5e1 !important;
      }
      .llm-bilingual-selection-card__result {
        margin: 0 !important;
        white-space: pre-wrap !important;
      }
      .llm-bilingual-selection-card.is-error .llm-bilingual-selection-card__result {
        color: var(--llm-translator-error-text) !important;
      }
      .llm-bilingual-selection-card__status {
        min-height: 18px !important;
        margin: 8px 0 0 0 !important;
        color: #2563eb !important;
        font-size: 12px !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-selection-card__status {
        color: #93c5fd !important;
      }
      .llm-bilingual-page-notice {
        position: fixed !important;
        z-index: 2147483647 !important;
        right: 18px !important;
        top: 18px !important;
        width: min(420px, calc(100vw - 36px)) !important;
        box-sizing: border-box !important;
        padding: 12px 14px !important;
        border-left: 4px solid var(--llm-translator-border) !important;
        border-radius: 8px !important;
        background: #ffffff !important;
        color: #0f172a !important;
        box-shadow: 0 18px 50px rgba(15, 23, 42, 0.24) !important;
        font: 14px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        white-space: pre-wrap !important;
        direction: ltr !important;
        unicode-bidi: plaintext !important;
        text-align: start !important;
        writing-mode: horizontal-tb !important;
      }
      :root[data-llm-translator-theme="dark"] .llm-bilingual-page-notice {
        background: #111827 !important;
        color: #f8fafc !important;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42) !important;
      }
      .llm-bilingual-page-notice.is-error {
        border-left-color: var(--llm-translator-error-text) !important;
        background: var(--llm-translator-error-bg) !important;
        color: var(--llm-translator-error-text) !important;
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

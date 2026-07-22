const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const extensionDir = path.resolve(__dirname, "..");
const resultDir = path.join(extensionDir, "test-results");
const logPath = path.join(resultDir, "content-e2e-log.txt");
const sharedPath = path.join(extensionDir, "shared.js");
const contentPath = path.join(extensionDir, "content.js");
const screenshotDir = path.join(resultDir, "content-samples");

const VIEWPORTS = [
  { name: "desktop", width: 1366, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

const allSamples = [
  {
    key: "x",
    url: "https://x.com/pankajkumar_dev/status/2071237614414512179",
    auto: true
  },
  {
    key: "reddit-feed",
    url: "https://www.reddit.com/r/worldnews/hot/"
  },
  {
    key: "reddit-thread",
    url: "https://www.reddit.com/r/worldnews/comments/"
  },
  {
    key: "quora",
    url: "https://www.quora.com/What-is-artificial-intelligence"
  },
  {
    key: "linkedin",
    url: "https://www.linkedin.com/company/openai/posts/?feedView=all"
  },
  {
    key: "youtube",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  },
  {
    key: "wikipedia",
    url: "https://en.wikipedia.org/wiki/Artificial_intelligence"
  },
  {
    key: "github",
    url: "https://github.com/openai/openai-node"
  },
  {
    key: "stackoverflow",
    url: "https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array"
  },
  {
    key: "hacker-news",
    url: "https://news.ycombinator.com/news"
  },
  {
    key: "mdn",
    url: "https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver"
  },
  {
    key: "bbc",
    url: "https://www.bbc.com/"
  },
  {
    key: "cnn-live",
    url: "https://www.cnn.com/2026/06/28/world/live-news/iran-war-strikes-trump"
  },
  {
    key: "reuters",
    url: "https://www.reuters.com/world/",
    blockedOnNoOutput: true
  },
  {
    key: "medium",
    url: "https://medium.com/tag/artificial-intelligence"
  },
  {
    key: "amazon",
    url: "https://www.amazon.com/s?k=noise+cancelling+headphones"
  }
];

const blockedTranslationSelector = [
  "nav .llm-bilingual-translation",
  "header:not(.mw-body-header):not(.vector-page-titlebar) .llm-bilingual-translation",
  "footer .llm-bilingual-translation",
  "body > aside .llm-bilingual-translation",
  "[role='complementary'] .llm-bilingual-translation",
  "[role='dialog'] .llm-bilingual-translation",
  "[aria-modal='true'] .llm-bilingual-translation",
  "[class*='advert'] .llm-bilingual-translation",
  "[class*='sponsor'] .llm-bilingual-translation",
  "[class*='promoted'] .llm-bilingual-translation"
].join(",");

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function main() {
  fs.mkdirSync(resultDir, { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  fs.writeFileSync(logPath, "", "utf8");

  const selectedSamples = getSelectedSamples();
  const selectedViewports = getSelectedViewports();
  const browser = await launchBrowser();
  const results = [];

  try {
    for (const sample of selectedSamples) {
      for (const viewport of selectedViewports) {
        log(`Running ${sample.key}/${viewport.name} ${sample.url}`);
        const result = await runSample(browser, sample, viewport);
        results.push(result);
        log(formatResult(result));
        writeResults(results);
      }
    }
  } finally {
    writeResults(results);
    await browser.close();
  }

  assert.strictEqual(
    results.length,
    selectedSamples.length * selectedViewports.length,
    "Every selected site must produce both desktop and mobile results."
  );
  const failed = results.filter((result) => result.status === "FAIL");
  assert.deepStrictEqual(
    failed.map((result) => `${result.siteKey}/${result.viewport}: ${result.issues.join("；")}`),
    [],
    "Loaded, unblocked sample variants must satisfy real-page layout checks."
  );
}

async function runSample(browser, sample, viewport) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const startedAt = Date.now();
  const result = {
    key: `${sample.key}-${viewport.name}`,
    siteKey: sample.key,
    url: sample.url,
    viewport: viewport.name,
    viewportSize: `${viewport.width}x${viewport.height}`,
    status: "SKIP",
    issues: [],
    loaded: false,
    siteBlocked: false,
    blockedOnNoOutput: sample.blockedOnNoOutput === true,
    blockReason: "",
    loadError: null,
    pageTitleHash: "",
    pageTitleLength: 0,
    initialScanCount: 0,
    doneCount: 0,
    errorCount: 0,
    blockedTranslationCount: 0,
    blockedTranslationDetails: [],
    afterScrollDoneCount: 0,
    mockRequests: 0,
    duplicateCount: 0,
    invalidTableParentCount: 0,
    overlapCount: 0,
    overlapDetails: [],
    horizontalShiftCount: 0,
    horizontalOverflowPx: 0,
    stats: null,
    translationSamples: [],
    interactions: {
      streamingObserved: false,
      scrollPerformed: false,
      quoteCount: 0,
      expandAttempted: false,
      rerenderRequestDelta: 0,
      rerenderTranslationCount: 0
    },
    screenshots: {
      before: `${sample.key}-${viewport.name}-before.png`,
      after: `${sample.key}-${viewport.name}-after.png`
    },
    durationMs: 0
  };

  try {
    await page.goto(sample.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    result.loaded = true;
    await page.waitForTimeout(1200);
    await collectPageIdentity(page, result);
    await page.screenshot({ path: path.join(screenshotDir, result.screenshots.before) });

    if (result.siteBlocked) {
      return result;
    }

    const beforeLayout = await recordPageLayout(page);
    await injectContentHarness(page);

    const initial = await sendContentMessage(page, sample.auto
      ? { action: "start_translation", auto: true }
      : { action: "scan_current_area" });
    result.initialScanCount = initial?.count || 0;
    result.interactions.streamingObserved = await page.waitForFunction(() => (
      document.querySelectorAll(".llm-bilingual-translation.is-streaming").length > 0
    ), null, { timeout: 1000 }).then(() => true).catch(() => false);
    await waitForTranslationAttempt(page, 12000);
    await collectPageMetrics(page, result, beforeLayout);
    await runSiteInteractions(page, sample, result);

    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)));
    result.interactions.scrollPerformed = true;
    await page.waitForTimeout(1200);
    await waitForTranslationAttempt(page, 8000);
    result.afterScrollDoneCount = await page.locator(".llm-bilingual-translation.is-done").count();
    await collectPageMetrics(page, result, beforeLayout);
  } catch (error) {
    result.loadError = error.message;
  } finally {
    await page.screenshot({ path: path.join(screenshotDir, result.screenshots.after) }).catch(() => {});
    const classification = classifySampleResult(result);
    result.status = classification.status;
    result.issues = classification.issues;
    result.blockReason = classification.blockReason || result.blockReason;
    result.durationMs = Date.now() - startedAt;
    await page.close().catch(() => {});
  }

  return result;
}

async function injectContentHarness(page) {
  await page.evaluate((settings) => {
    const listeners = [];

    window.__mockTranslateRequests = 0;
    window.chrome = {
      storage: {
        local: {
          async get(keys) {
            const normalizedKeys = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(normalizedKeys.map((key) => [key, settings[key]]));
          }
        }
      },
      runtime: {
        connect({ name } = {}) {
          const messageListeners = [];
          const disconnectListeners = [];
          let disconnected = false;
          return {
            name,
            onMessage: {
              addListener(listener) {
                messageListeners.push(listener);
              }
            },
            onDisconnect: {
              addListener(listener) {
                disconnectListeners.push(listener);
              }
            },
            postMessage(message) {
              if (disconnected || message.type !== "translate") return;
              const item = message.item || {};
              const text = `测试译文：${String(item.text || "").slice(0, 80)}`;
              window.__mockTranslateRequests += 1;
              queueMicrotask(() => {
                if (disconnected) return;
                const envelope = {
                  requestId: message.requestId,
                  runId: message.runId,
                  id: item.id
                };
                messageListeners.forEach((listener) => listener({
                  ...envelope,
                  type: "delta",
                  delta: text,
                  text
                }));
                setTimeout(() => {
                  if (disconnected) return;
                  messageListeners.forEach((listener) => listener({
                    ...envelope,
                    type: "done",
                    text,
                    streamed: true,
                    fallback: false
                  }));
                }, 60);
              });
            },
            disconnect() {
              if (disconnected) return;
              disconnected = true;
              disconnectListeners.forEach((listener) => listener());
            }
          };
        },
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          }
        },
        async sendMessage(request) {
          if (request.action === "get_settings") {
            return settings;
          }

          if (request.action === "translate_batch") {
            const items = request.items || [];
            window.__mockTranslateRequests += items.length;
            return {
              ok: true,
              meta: { requested: items.length, cacheHits: 0 },
              results: items.map((item) => ({
                id: item.id,
                text: `测试译文：${String(item.text || "").slice(0, 80)}`
              }))
            };
          }

          throw new Error(`Unhandled runtime message: ${request.action}`);
        }
      }
    };

    window.__sendContentMessage = (request) => new Promise((resolve, reject) => {
      if (listeners.length === 0) {
        reject(new Error("No content listener registered."));
        return;
      }

      const sendResponse = (response) => resolve(response);
      const result = listeners[0](request, {}, sendResponse);
      if (result !== true) {
        resolve(result);
      }
    });
  }, {
    apiUrl: "http://127.0.0.1/mock/v1/chat/completions",
    apiKey: "mock-key",
    model: "mock-model",
    sourceLanguage: "English",
    targetLanguage: "简体中文",
    batchSize: 4,
    maxElementsPerScan: 12,
    maxTextLength: 1600,
    maxConcurrentBatches: 2,
    autoTranslate: false,
    displayMode: "bilingual",
    viewportOnly: true
  });

  await page.evaluate(fs.readFileSync(sharedPath, "utf8"));
  await page.evaluate(fs.readFileSync(contentPath, "utf8"));
}

async function runSiteInteractions(page, sample, result) {
  if (sample.key !== "x") return;

  result.interactions.quoteCount = await page.locator(
    "article article,[data-testid=\"tweet\"] [data-testid=\"tweet\"]"
  ).count();

  const rerender = await page.evaluate(() => {
    const tweetText = document.querySelector("[data-testid=\"tweetText\"]");
    const tweetArticle = tweetText?.closest("article");
    const records = window.__llmBilingualTranslator?.translationRecordsByKey;
    const activeRecords = records ? Array.from(records.values()) : [];
    const currentRecord = activeRecords.find((item) => item.translationNode?.isConnected
        && (tweetArticle?.contains(item.sourceElement)
          || item.sourceElement === tweetText
          || tweetText?.contains(item.sourceElement)
          || item.sourceElement?.contains?.(tweetText)))
      || activeRecords.find((item) => item.translationNode?.isConnected && item.sourceElement?.isConnected)
      || null;
    const source = currentRecord?.sourceElement || tweetText;
    if (!source) return { available: false, beforeRequests: window.__mockTranslateRequests || 0, recordKey: "" };
    const fresh = source.cloneNode(true);
    delete fresh.dataset.llmTranslatorId;
    delete fresh.dataset.llmTranslatorStatus;
    delete fresh.dataset.llmTranslatorPlacement;
    fresh.dataset.llmSampleRerender = "x";
    fresh.querySelectorAll?.(".llm-bilingual-translation").forEach((node) => node.remove());
    const beforeRequests = window.__mockTranslateRequests || 0;
    source.replaceWith(fresh);
    return {
      available: true,
      beforeRequests,
      recordKey: currentRecord?.key || ""
    };
  });
  if (!rerender.available) return;

  await page.waitForTimeout(700);
  const after = await page.evaluate((recordKey) => {
    const records = window.__llmBilingualTranslator?.translationRecordsByKey;
    const record = records?.get(recordKey);
    return {
      requests: window.__mockTranslateRequests || 0,
      translations: record?.translationNode?.isConnected ? 1 : 0
    };
  }, rerender.recordKey);
  result.interactions.rerenderRequestDelta = after.requests - rerender.beforeRequests;
  result.interactions.rerenderTranslationCount = after.translations;

  const expandable = page.locator("article [aria-expanded=\"false\"]").first();
  if (await expandable.count()) {
    result.interactions.expandAttempted = true;
    await expandable.click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(700);
    await sendContentMessage(page, { action: "scan_current_area" });
    await page.waitForTimeout(700);
  }
}

async function sendContentMessage(page, request) {
  return page.evaluate((message) => window.__sendContentMessage(message), request);
}

async function recordPageLayout(page) {
  return page.evaluate(() => {
    const controls = {};
    const candidates = Array.from(document.querySelectorAll("button,[role=\"button\"],input,select,textarea"));
    let index = 0;
    for (const element of candidates) {
      if (index >= 80) break;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0 || rect.bottom < 0 || rect.top > window.innerHeight) continue;
      const key = `control-${index}`;
      index += 1;
      element.setAttribute("data-llm-sample-probe", key);
      controls[key] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }
    return {
      controls,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    };
  });
}

async function collectPageMetrics(page, result, beforeLayout) {
  result.doneCount = await page.locator(".llm-bilingual-translation.is-done").count();
  result.errorCount = await page.locator(".llm-bilingual-translation.is-error").count();
  result.blockedTranslationCount = await page.locator(blockedTranslationSelector).count();
  result.blockedTranslationDetails = await page.evaluate((selector) => (
    Array.from(document.querySelectorAll(selector)).slice(0, 12).map((node) => {
      const areas = [
        ["nav", "nav"],
        ["header", "header"],
        ["footer", "footer"],
        ["body > aside", "body-aside"],
        ["[role=\"complementary\"]", "complementary"],
        ["[role=\"dialog\"]", "dialog"],
        ["[aria-modal=\"true\"]", "modal"],
        ["[class*=\"advert\" i]", "advert"],
        ["[class*=\"sponsor\" i]", "sponsor"],
        ["[class*=\"promoted\" i]", "promoted"]
      ];
      const area = areas.find(([areaSelector]) => node.closest(areaSelector));
      return {
        hash: node.dataset.llmSourceHash || "",
        area: area?.[1] || "unknown",
        parentTag: node.parentElement?.tagName || "",
        parentClassHash: window.LLMTranslatorShared.simpleHash(String(node.parentElement?.className || ""))
      };
    })
  ), blockedTranslationSelector);
  result.mockRequests = await page.evaluate(() => window.__mockTranslateRequests || 0);
  const statsResponse = await sendContentMessage(page, { action: "get_page_stats" });
  result.stats = statsResponse?.stats || null;
  const layoutMetrics = await page.evaluate((before) => {
    const translations = Array.from(document.querySelectorAll(".llm-bilingual-translation"));
    const unitSelector = "article,[role=\"article\"],li,blockquote,shreddit-post,shreddit-comment";
    const duplicateGroups = new Map();
    translations.forEach((node, index) => {
      const unit = node.closest(unitSelector) || node.parentElement;
      if (!unit.dataset.llmSampleUnit) unit.dataset.llmSampleUnit = `unit-${index}`;
      const key = `${unit.dataset.llmSampleUnit}:${node.dataset.llmSourceHash || "missing"}`;
      duplicateGroups.set(key, (duplicateGroups.get(key) || 0) + 1);
    });

    const translationRects = translations.map((node) => ({
      node,
      rect: node.getBoundingClientRect(),
      unit: node.closest(unitSelector) || node.parentElement
    }));
    let overlapCount = 0;
    const overlapDetails = [];
    let horizontalShiftCount = 0;
    document.querySelectorAll("[data-llm-sample-probe]").forEach((element) => {
      const previous = before.controls[element.getAttribute("data-llm-sample-probe")];
      if (!previous) return;
      const rect = element.getBoundingClientRect();
      if (Math.abs(rect.x - previous.x) > 8) horizontalShiftCount += 1;
      if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) return;
      const controlUnit = element.closest(unitSelector) || element.parentElement;
      translationRects.forEach(({ node: translationNode, rect: translation, unit: translationUnit }, translationIndex) => {
        if (controlUnit !== translationUnit) return;
        if (translation.bottom <= 0 || translation.top >= window.innerHeight
          || translation.right <= 0 || translation.left >= window.innerWidth) return;
        if (Math.max(rect.x, translation.x) < Math.min(rect.right, translation.right)
          && Math.max(rect.y, translation.y) < Math.min(rect.bottom, translation.bottom)) {
          overlapCount += 1;
          if (overlapDetails.length < 12) {
            overlapDetails.push({
              control: element.getAttribute("data-llm-sample-probe"),
              tag: element.tagName,
              role: element.getAttribute("role") || "",
              position: getComputedStyle(element).position,
              classHash: window.LLMTranslatorShared.simpleHash(String(element.className || "")),
              parentTag: element.parentElement?.tagName || "",
              parentClassHash: window.LLMTranslatorShared.simpleHash(String(element.parentElement?.className || "")),
              translationParentTag: translationNode.parentElement?.tagName || "",
              translationParentClassHash: window.LLMTranslatorShared.simpleHash(
                String(translationNode.parentElement?.className || "")
              ),
              translationHash: translations[translationIndex]?.dataset.llmSourceHash || "",
              controlRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              translationRect: {
                x: translation.x,
                y: translation.y,
                width: translation.width,
                height: translation.height
              }
            });
          }
        }
      });
    });

    return {
      duplicateCount: Array.from(duplicateGroups.values()).reduce((sum, count) => sum + Math.max(0, count - 1), 0),
      invalidTableParentCount: translations.filter((node) => (
        ["TR", "TBODY", "THEAD", "TFOOT", "TABLE"].includes(node.parentElement?.tagName)
      )).length,
      overlapCount,
      overlapDetails,
      horizontalShiftCount,
      horizontalOverflowPx: Math.max(
        0,
        document.documentElement.scrollWidth - Math.max(before.scrollWidth, document.documentElement.clientWidth)
      ),
      translationSamples: translations.slice(0, 6).map((node) => ({
        hash: node.dataset.llmSourceHash || "",
        length: String(node.textContent || "").length,
        state: Array.from(node.classList).find((name) => name.startsWith("is-")) || "",
        density: node.dataset.llmTranslatorDensity || "normal"
      }))
    };
  }, beforeLayout);
  Object.assign(result, layoutMetrics);
}

async function collectPageIdentity(page, result) {
  const info = await page.evaluate(() => ({
    title: document.title || "",
    text: document.body?.innerText?.slice(0, 800) || ""
  }));

  result.pageTitleHash = simpleHash(info.title);
  result.pageTitleLength = info.title.length;
  result.siteBlocked = isLikelySiteBlocked(`${info.title}\n${info.text}`);
  if (result.siteBlocked) result.blockReason = "site verification, login wall, or bot protection";
}

async function waitForTranslationAttempt(page, timeout) {
  await page.waitForFunction(() => {
    return document.querySelectorAll(".llm-bilingual-translation.is-done,.llm-bilingual-translation.is-error").length > 0;
  }, null, { timeout }).catch(() => {});
}

function isLikelySiteBlocked(text) {
  const normalized = String(text || "").toLowerCase();
  if (normalized.trim() === "sorry.") return true;
  if (normalized.includes("sign in") && normalized.includes("new to linkedin")) return true;
  return [
    "you've been blocked by network security",
    "performing security verification",
    "verify you are not a bot",
    "security service to protect against malicious bots",
    "just a moment...",
    "sign in to continue",
    "log in to continue",
    "join linkedin",
    "robot check",
    "access is temporarily restricted",
    "we detected unusual activity from your device or network",
    "sorry, we couldn't find that page",
    "sorry we couldn't find that page"
  ].some((phrase) => normalized.includes(phrase));
}

function classifySampleResult(result) {
  if (result.loadError) {
    return { status: "SKIP", issues: [], blockReason: `network/load error: ${result.loadError.slice(0, 160)}` };
  }
  if (result.siteBlocked) {
    return { status: "BLOCKED", issues: [], blockReason: result.blockReason || "site blocked" };
  }
  if (result.blockedOnNoOutput && result.loaded && result.doneCount === 0 && result.errorCount === 0) {
    return {
      status: "BLOCKED",
      issues: [],
      blockReason: "site returned no readable content in this test network (known bot protection)"
    };
  }

  const issues = [];
  if (!result.loaded) issues.push("页面未加载");
  if (result.doneCount === 0 && result.errorCount === 0) issues.push("未产生翻译输出");
  if (result.errorCount > 0) issues.push(`翻译错误：${result.errorCount}`);
  if (result.blockedTranslationCount > 0) issues.push(`禁止区域译文：${result.blockedTranslationCount}`);
  if (result.duplicateCount > 0) issues.push(`重复译文：${result.duplicateCount}`);
  if (result.invalidTableParentCount > 0) issues.push(`非法表格父节点：${result.invalidTableParentCount}`);
  if (result.overlapCount > 0) issues.push(`控件重叠：${result.overlapCount}`);
  if (result.horizontalOverflowPx > 0) issues.push(`新增横向溢出：${result.horizontalOverflowPx}px`);
  if (result.siteKey === "x" && result.interactions.rerenderRequestDelta > 0) {
    issues.push(`X 重渲染新增请求：${result.interactions.rerenderRequestDelta}`);
  }
  if (result.siteKey === "x" && result.interactions.rerenderTranslationCount !== 1) {
    issues.push(`X 重渲染译文节点：${result.interactions.rerenderTranslationCount}`);
  }
  return { status: issues.length > 0 ? "FAIL" : "PASS", issues, blockReason: "" };
}

function simpleHash(input) {
  let hash = 2166136261;
  const text = String(input || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      channel: "chrome",
      headless: true,
      timeout: 30000
    });
  } catch (error) {
    return chromium.launch({ headless: true, timeout: 30000 });
  }
}

function getSelectedSamples() {
  const selected = (process.env.SAMPLE_KEYS || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

  if (selected.length === 0) {
    return allSamples;
  }

  return allSamples.filter((sample) => selected.includes(sample.key));
}

function getSelectedViewports() {
  const selected = (process.env.SAMPLE_VIEWPORTS || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return selected.length === 0
    ? VIEWPORTS
    : VIEWPORTS.filter((viewport) => selected.includes(viewport.name));
}

function writeResults(results) {
  const outputPath = path.join(resultDir, "latest-content-sample-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
}

function formatResult(result) {
  return [
    `[${result.siteKey}/${result.viewport}]`,
    `status=${result.status}`,
    `loaded=${result.loaded}`,
    `siteBlocked=${result.siteBlocked}`,
    `initial=${result.initialScanCount}`,
    `done=${result.doneCount}`,
    `errors=${result.errorCount}`,
    `blocked=${result.blockedTranslationCount}`,
    `duplicates=${result.duplicateCount}`,
    `invalidTable=${result.invalidTableParentCount}`,
    `overlaps=${result.overlapCount}`,
    `horizontalShift=${result.horizontalShiftCount}`,
    `overflow=${result.horizontalOverflowPx}`,
    `afterScroll=${result.afterScrollDoneCount}`,
    `requests=${result.mockRequests}`,
    result.blockReason ? `reason=${result.blockReason}` : ""
  ].filter(Boolean).join(" ");
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

module.exports = {
  VIEWPORTS,
  allSamples,
  classifySampleResult,
  isLikelySiteBlocked
};

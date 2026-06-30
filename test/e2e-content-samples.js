const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const extensionDir = path.resolve(__dirname, "..");
const resultDir = path.join(extensionDir, "test-results");
const logPath = path.join(resultDir, "content-e2e-log.txt");
const sharedPath = path.join(extensionDir, "shared.js");
const contentPath = path.join(extensionDir, "content.js");

const allSamples = [
  {
    key: "bbc-home",
    url: "https://www.bbc.com/",
    auto: true
  },
  {
    key: "cnn-home",
    url: "https://www.cnn.com/"
  },
  {
    key: "cnn-live",
    url: "https://www.cnn.com/2026/06/28/world/live-news/iran-war-strikes-trump"
  },
  {
    key: "reddit-worldnews",
    url: "https://www.reddit.com/r/worldnews/hot/"
  },
  {
    key: "quora-ai",
    url: "https://www.quora.com/What-is-artificial-intelligence"
  },
  {
    key: "wikipedia-ai",
    url: "https://en.wikipedia.org/wiki/Artificial_intelligence"
  },
  {
    key: "hacker-news",
    url: "https://news.ycombinator.com/news"
  },
  {
    key: "x-status",
    url: "https://x.com/pankajkumar_dev/status/2071237614414512179",
    auto: true
  }
];

const blockedTranslationSelector = [
  "nav .llm-bilingual-translation",
  "header:not(.mw-body-header):not(.vector-page-titlebar) .llm-bilingual-translation",
  "footer .llm-bilingual-translation",
  "aside .llm-bilingual-translation",
  "[role='dialog'] .llm-bilingual-translation",
  "[aria-modal='true'] .llm-bilingual-translation",
  "[class*='advert'] .llm-bilingual-translation",
  "[class*='sponsor'] .llm-bilingual-translation",
  "[class*='promoted'] .llm-bilingual-translation"
].join(",");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(logPath, "", "utf8");

  const selectedSamples = getSelectedSamples();
  const browser = await launchBrowser();
  const results = [];

  try {
    for (const sample of selectedSamples) {
      log(`Running ${sample.key} ${sample.url}`);
      const result = await runSample(browser, sample);
      results.push(result);
      log(formatResult(result));
      writeResults(results);
    }
  } finally {
    writeResults(results);
    await browser.close();
  }

  const loaded = results.filter((result) => result.loaded);
  const actionable = loaded.filter((result) => !result.siteBlocked);
  const noOutput = actionable.filter((result) => result.doneCount === 0 && result.errorCount === 0);

  assert.ok(loaded.length >= 1, "Expected at least one sample page to load.");
  assert.deepStrictEqual(
    noOutput.map((result) => result.key),
    [],
    "Loaded, unblocked sample pages should produce translation output."
  );
}

async function runSample(browser, sample) {
  const page = await browser.newPage();
  const startedAt = Date.now();
  const result = {
    key: sample.key,
    url: sample.url,
    loaded: false,
    siteBlocked: false,
    loadError: null,
    pageTitle: "",
    pageTextSnippet: "",
    initialScanCount: 0,
    doneCount: 0,
    errorCount: 0,
    blockedTranslationCount: 0,
    afterScrollDoneCount: 0,
    mockRequests: 0,
    stats: null,
    snippets: [],
    durationMs: 0
  };

  try {
    await page.goto(sample.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    result.loaded = true;
    await page.waitForTimeout(1200);
    await collectPageIdentity(page, result);

    if (result.siteBlocked) {
      return result;
    }

    await injectContentHarness(page);

    const initial = await sendContentMessage(page, sample.auto
      ? { action: "start_translation", auto: true }
      : { action: "scan_current_area" });
    result.initialScanCount = initial?.count || 0;
    await waitForTranslationAttempt(page, 12000);
    await collectPageMetrics(page, result);

    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.9)));
    await page.waitForTimeout(1200);
    await waitForTranslationAttempt(page, 8000);
    result.afterScrollDoneCount = await page.locator(".llm-bilingual-translation.is-done").count();
    await collectPageMetrics(page, result);
  } catch (error) {
    result.loadError = error.message;
  } finally {
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
    autoTranslate: false,
    displayMode: "bilingual",
    viewportOnly: true
  });

  await page.evaluate(fs.readFileSync(sharedPath, "utf8"));
  await page.evaluate(fs.readFileSync(contentPath, "utf8"));
}

async function sendContentMessage(page, request) {
  return page.evaluate((message) => window.__sendContentMessage(message), request);
}

async function collectPageMetrics(page, result) {
  result.doneCount = await page.locator(".llm-bilingual-translation.is-done").count();
  result.errorCount = await page.locator(".llm-bilingual-translation.is-error").count();
  result.blockedTranslationCount = await page.locator(blockedTranslationSelector).count();
  result.mockRequests = await page.evaluate(() => window.__mockTranslateRequests || 0);
  const statsResponse = await sendContentMessage(page, { action: "get_page_stats" });
  result.stats = statsResponse?.stats || null;
  result.snippets = await page.evaluate(() => {
    return Array.from(document.querySelectorAll(".llm-bilingual-translation.is-done"))
      .slice(0, 6)
      .map((node) => ({
        translated: node.textContent.slice(0, 120),
        previous: (node.previousElementSibling?.innerText || node.parentElement?.innerText || "").slice(0, 160)
      }));
  });
}

async function collectPageIdentity(page, result) {
  const info = await page.evaluate(() => ({
    title: document.title || "",
    text: document.body?.innerText?.slice(0, 800) || ""
  }));

  result.pageTitle = info.title;
  result.pageTextSnippet = info.text;
  result.siteBlocked = isLikelySiteBlocked(`${info.title}\n${info.text}`);
}

async function waitForTranslationAttempt(page, timeout) {
  await page.waitForFunction(() => {
    return document.querySelectorAll(".llm-bilingual-translation.is-done,.llm-bilingual-translation.is-error").length > 0;
  }, null, { timeout }).catch(() => {});
}

function isLikelySiteBlocked(text) {
  const normalized = String(text || "").toLowerCase();
  return [
    "you've been blocked by network security",
    "performing security verification",
    "verify you are not a bot",
    "security service to protect against malicious bots",
    "just a moment..."
  ].some((phrase) => normalized.includes(phrase));
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

function writeResults(results) {
  const outputPath = path.join(resultDir, "latest-content-sample-results.json");
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8");
}

function formatResult(result) {
  return [
    `[${result.key}]`,
    `loaded=${result.loaded}`,
    `siteBlocked=${result.siteBlocked}`,
    `initial=${result.initialScanCount}`,
    `done=${result.doneCount}`,
    `errors=${result.errorCount}`,
    `blocked=${result.blockedTranslationCount}`,
    `afterScroll=${result.afterScrollDoneCount}`,
    `requests=${result.mockRequests}`,
    result.loadError ? `error=${result.loadError.slice(0, 160)}` : ""
  ].filter(Boolean).join(" ");
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`, "utf8");
}

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const extensionDir = path.resolve(__dirname, "..");
const sharedSource = fs.readFileSync(path.join(extensionDir, "shared.js"), "utf8");
const contentSource = fs.readFileSync(path.join(extensionDir, "content.js"), "utf8");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    await testPreservesLineBreaksInTweetText(browser);
    await testMultipleTextBlocksShareOneBatchRequest(browser);
    await testBatchSplitsByCharacterLimit(browser);
    await testMainContentPriorityBeatsEarlierSideCards(browser);
    await testContentScriptReinjectsWhenVersionChanges(browser);
    await testXPrimaryColumnIgnoresSidebarAndComposer(browser);
    await testNewsCardSkipsCreditsAndHiddenMetadata(browser);
    await testSkipsTargetLanguageText(browser);
    await testTranslationUiResetsBidiStyles(browser);
    await testDarkThemeReadable(browser);
    await testLocalDarkSectionReadableOnLightPage(browser);
    await testTranslationFirstModeDimsOriginalText(browser);
    await testPageBudgetLimitsRequests(browser);
    await testRetrySuccessDoesNotDoubleCountStats(browser);
    await testTranslationBatchesUseLimitedConcurrency(browser);
    await testFarViewportCancelsStalePendingTranslations(browser);
    await testAutoTranslationStartsEnglishContentWithTargetLocale(browser);
    await testDisabledAutoTranslationDoesNotWakeBackgroundForSettings(browser);
    await testVisibleElementsDoNotWaitForIntersectionObserver(browser);
    await testDeclarativeAutoTranslationStartsOnLoad(browser);
    await testAutoTranslationWaitsForDynamicEnglishContentWithTargetLocale(browser);
    await testAutoTranslationSkipsTargetLanguagePage(browser);
    await testAutoTranslationSkipsTargetLanguageDominantPage(browser);
    await testCanHideAndShowTranslations(browser);
    await testShowsSelectionTranslationCard(browser);
    await testShowsPageNotice(browser);
  } finally {
    await browser.close();
  }

  console.log("local fixture e2e tests passed");
}

async function testPreservesLineBreaksInTweetText(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <article>
          <div id="tweet">
            Mythos 6 Leaks: Already Exists?<br><br>
            - A new Mythos model has finished training internally.<br>
            - Despite Fable 5 and Mythos 5 restrictions, Anthropic has not stopped training.<br>
            - I just hope it launches globally without being stripped down.
          </div>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);

  assert.strictEqual(result.requestCount, 1);
  assert.match(result.requestedTexts[0], /Already Exists\?\n\n- A new Mythos model/);
  assert.match(result.requestedTexts[0], /\n- Despite Fable 5/);
  assert.ok(result.translatedTexts[0].includes("\n- A new Mythos model"));

  const whiteSpace = await page.evaluate(() => {
    const node = document.querySelector(".llm-bilingual-translation.is-done");
    return getComputedStyle(node).whiteSpace;
  });
  assert.strictEqual(whiteSpace, "pre-wrap");

  await page.close();
}

async function testMultipleTextBlocksShareOneBatchRequest(browser) {
  const page = await createHarnessPage(browser, {
    batchSize: 6,
    html: `
      <main>
        <p>First article paragraph about market expectations today.</p>
        <p>Second article paragraph about policy changes this week.</p>
        <p>Third article paragraph about technology company earnings.</p>
      </main>
    `
  });

  const result = await runTranslation(page);
  const batchSizes = await page.evaluate(() => window.__mockTranslateBatchSizes);

  assert.deepStrictEqual(batchSizes, [3], "Multiple text blocks should be merged into one batch request.");
  assert.strictEqual(result.translationCount, 3);
  await page.close();
}

async function testBatchSplitsByCharacterLimit(browser) {
  const page = await createHarnessPage(browser, {
    batchSize: 10,
    maxCharsPerBatch: 500,
    html: `
      <main>
        <p>First article paragraph about policy conditions across regions, market reaction, trade negotiations, energy prices, central bank expectations, investor positioning, and the difficult balance between economic growth and inflation control today.</p>
        <p>Second article paragraph about policy conditions across regions, market reaction, trade negotiations, energy prices, central bank expectations, investor positioning, and the difficult balance between economic growth and inflation control today.</p>
        <p>Third article paragraph about policy conditions across regions, market reaction, trade negotiations, energy prices, central bank expectations, investor positioning, and the difficult balance between economic growth and inflation control today.</p>
      </main>
    `
  });

  await runTranslation(page);
  const batchSizes = await page.evaluate(() => window.__mockTranslateBatchSizes);

  assert.deepStrictEqual(batchSizes, [2, 1], "Batching should honor both paragraph count and character limits.");
  await page.close();
}

async function testMainContentPriorityBeatsEarlierSideCards(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 1,
    html: `
      <section class="side-card">
        <p>Earlier secondary card text about celebrity events that appears before the main story.</p>
      </section>
      <main>
        <article>
          <p id="main-story">Primary article paragraph about diplomatic talks and regional security updates.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);

  assert.strictEqual(result.requestCount, 1);
  assert.match(result.requestedTexts[0], /Primary article paragraph/);
  assert.doesNotMatch(result.requestedTexts[0], /Earlier secondary card/);
  await page.close();
}

async function testContentScriptReinjectsWhenVersionChanges(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <p>This article paragraph should still translate after the content script is reinjected.</p>
      </main>
    `
  });

  assert.strictEqual(await page.evaluate(() => window.__listenerCount()), 1);
  await page.evaluate(() => {
    window.__llmBilingualTranslator.version = "0.3.19";
  });
  await page.evaluate(contentSource);

  assert.strictEqual(await page.evaluate(() => window.__listenerCount()), 1);
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.llmTranslatorVersion), "0.4.5");

  const result = await runTranslation(page);
  assert.strictEqual(result.requestCount, 1);
  await page.close();
}

async function testXPrimaryColumnIgnoresSidebarAndComposer(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main role="main">
        <div data-testid="primaryColumn">
          <section role="region" aria-label="Timeline: Conversation">
            <article data-testid="tweet" role="article">
              <div data-testid="tweetText">
                GPT 5.6 is marginally better than 5.5 and the benchmark comparison is still narrow.
              </div>
            </article>
            <div data-testid="tweetTextarea_0RichTextInputContainer">
              <div>Post your reply with an English placeholder that should not be translated.</div>
            </div>
            <article data-testid="tweet" role="article">
              <div data-testid="tweetText">
                Woah I would not say that because we have not been able to do our own evaluations yet.
              </div>
            </article>
          </section>
        </div>
        <aside role="complementary" aria-label="Relevant people">
          <h2>Relevant people</h2>
          <p>AI Researcher and creator currently building a profile sidebar that should not be translated.</p>
        </aside>
        <section role="region" aria-label="Timeline: Trending now">
          <h2>What is happening</h2>
          <p>Trending in United States with enough English text that should still be ignored.</p>
        </section>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.strictEqual(result.requestCount, 2);
  assert.match(requested, /GPT 5\.6 is marginally better/);
  assert.match(requested, /own evaluations yet/);
  assert.doesNotMatch(requested, /Post your reply/);
  assert.doesNotMatch(requested, /Relevant people/);
  assert.doesNotMatch(requested, /Trending in United States/);
  assert.strictEqual(await page.locator("aside .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("[aria-label='Timeline: Trending now'] .llm-bilingual-translation").count(), 0);

  await page.close();
}

async function testNewsCardSkipsCreditsAndHiddenMetadata(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <ul>
          <li class="card">
            <div style="display:none">Invisible social share text should not be translated.</div>
            <div class="image-credit">US Central Command/Handout/Reuters</div>
            <div>•</div>
            <div>Analysisby Stephen Collinson</div>
            <a href="/story">
              <span>Analysis: New US-Iran clashes revealed fragility of truce and why it may work</span>
            </a>
          </li>
        </ul>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.strictEqual(result.requestCount, 1);
  assert.match(requested, /New US-Iran clashes/);
  assert.doesNotMatch(requested, /US Central Command/);
  assert.doesNotMatch(requested, /Stephen Collinson/);
  assert.doesNotMatch(requested, /Invisible social share/);
  assert.doesNotMatch(requested, /^•$/m);

  await page.close();
}

async function testAutoTranslationWaitsForDynamicEnglishContentWithTargetLocale(browser) {
  const page = await createHarnessPage(browser, {
    htmlLang: "zh-CN",
    targetLanguage: "简体中文",
    html: `
      <main>
        <article id="dynamic-post"></article>
      </main>
    `
  });

  const response = await page.evaluate(() => window.__sendContentMessage({ action: "start_translation", auto: true }));
  await page.evaluate(() => {
    document.getElementById("dynamic-post").innerHTML = `
      <div>
        Mythos 6 Leaks: Already Exists?<br><br>
        - A new Mythos model has finished training internally.<br>
        - Anthropic is reportedly continuing to push it further.
      </div>
    `;
  });
  await page.waitForTimeout(2200);
  const stats = await page.evaluate(() => window.__sendContentMessage({ action: "get_page_stats" }));

  assert.notStrictEqual(response.skipped, true);
  assert.strictEqual(stats.active, true);
  assert.strictEqual(await page.evaluate(() => window.__mockItems.length), 1);
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.llmTranslatorAuto), "started");

  await page.close();
}

async function testAutoTranslationStartsEnglishContentWithTargetLocale(browser) {
  const page = await createHarnessPage(browser, {
    htmlLang: "zh-CN",
    targetLanguage: "简体中文",
    html: `
      <main>
        <article>
          <div>
            Mythos 6 Leaks: Already Exists?<br><br>
            - A new Mythos model has finished training internally, and could launch soon.<br>
            - Despite Fable 5 and Mythos 5 restrictions, Anthropic has not stopped training.
          </div>
        </article>
      </main>
    `
  });

  const response = await page.evaluate(() => window.__sendContentMessage({ action: "start_translation", auto: true }));
  await page.waitForTimeout(1800);
  const stats = await page.evaluate(() => window.__sendContentMessage({ action: "get_page_stats" }));

  assert.notStrictEqual(response.skipped, true);
  assert.strictEqual(stats.active, true);
  assert.strictEqual(await page.evaluate(() => window.__mockItems.length), 1);

  await page.close();
}

async function testDisabledAutoTranslationDoesNotWakeBackgroundForSettings(browser) {
  const page = await createHarnessPage(browser, {
    autoTranslate: false,
    html: `
      <main>
        <article>
          <p>BBC reporters are following the latest developments from London and Washington.</p>
        </article>
      </main>
    `
  });

  await page.waitForFunction(() => document.documentElement.dataset.llmTranslatorAuto === "disabled");
  const messages = await page.evaluate(() => window.__runtimeMessages.map((message) => message.action));
  const storageGets = await page.evaluate(() => window.__storageGetCalls);

  assert.deepStrictEqual(messages, []);
  assert.deepStrictEqual(storageGets, [["autoTranslate", "apiKey", "model"]]);
  await page.close();
}

async function testVisibleElementsDoNotWaitForIntersectionObserver(browser) {
  const page = await createHarnessPage(browser, {
    deferIntersectionObserver: true,
    html: `
      <main>
        <article>
          <p>This visible article paragraph should translate immediately without waiting for a scroll event.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);

  assert.strictEqual(result.requestCount, 1);
  assert.match(result.requestedTexts[0], /visible article paragraph/);
  assert.strictEqual(result.translationCount, 1);

  await page.close();
}

async function testTranslationBatchesUseLimitedConcurrency(browser) {
  const page = await createHarnessPage(browser, {
    batchSize: 2,
    maxConcurrentBatches: 2,
    translateDelayMs: 250,
    html: `
      <main>
        <p>Market conditions changed after the morning briefing.</p>
        <p>Officials said the new policy would be reviewed next month.</p>
        <p>Technology shares moved higher as investors watched earnings.</p>
        <p>Analysts expect more details after the conference call.</p>
        <p>The company said demand remained steady across regions.</p>
        <p>Several teams are preparing updated forecasts for July.</p>
      </main>
    `
  });

  await runTranslation(page);

  const maxConcurrent = await page.evaluate(() => window.__maxConcurrentTranslateBatches);
  assert.strictEqual(maxConcurrent, 2, "Translation batches should use the configured small concurrency.");
  await page.close();
}

async function testFarViewportCancelsStalePendingTranslations(browser) {
  const page = await createHarnessPage(browser, {
    batchSize: 1,
    maxConcurrentBatches: 1,
    translateDelayMs: 1200,
    html: `
      <main>
        <p id="top-story">First viewport paragraph is slow to translate and should be abandoned after a far scroll.</p>
        <div style="height:2600px"></div>
        <p id="bottom-story">Second viewport paragraph should be translated after the user scrolls to the new reading area.</p>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForFunction(() => window.__mockItems.length === 1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.__mockItems.length >= 2);
  await page.waitForFunction(() => document.querySelector("#bottom-story + .llm-bilingual-translation.is-done"));
  await page.waitForTimeout(200);

  const result = await page.evaluate(() => ({
    requests: window.__mockItems,
    topDone: !!document.querySelector("#top-story + .llm-bilingual-translation.is-done"),
    topLoading: !!document.querySelector("#top-story + .llm-bilingual-translation.is-loading"),
    bottomDone: !!document.querySelector("#bottom-story + .llm-bilingual-translation.is-done")
  }));

  assert.match(result.requests[0], /First viewport paragraph/);
  assert.match(result.requests[1], /Second viewport paragraph/);
  assert.strictEqual(result.topDone, false, "Stale first-viewport response should not be applied after a far scroll.");
  assert.strictEqual(result.topLoading, false, "Old first-viewport loading block should be removed after a far scroll.");
  assert.strictEqual(result.bottomDone, true, "The new viewport should translate without waiting for the old request.");

  await page.close();
}

async function testRetrySuccessDoesNotDoubleCountStats(browser) {
  const page = await createHarnessPage(browser, {
    failFirstTranslate: true,
    html: `
      <main>
        <p>This paragraph fails once and then succeeds when the user retries it.</p>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForFunction(() => document.querySelectorAll(".llm-bilingual-translation.is-error").length === 1);

  const failedStats = await page.evaluate(async () => {
    const response = await window.__sendContentMessage({ action: "get_page_stats" });
    return response.stats;
  });
  assert.strictEqual(failedStats.failed, 1);
  assert.strictEqual(failedStats.translated, 0);
  assert.strictEqual(await page.locator(".llm-bilingual-translation.is-error").getAttribute("role"), "button");
  assert.strictEqual(await page.locator(".llm-bilingual-translation.is-error").getAttribute("tabindex"), "0");

  await page.focus(".llm-bilingual-translation.is-error");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelectorAll(".llm-bilingual-translation.is-done").length === 1);
  assert.strictEqual(await page.locator(".llm-bilingual-translation.is-done").getAttribute("role"), null);
  assert.strictEqual(await page.locator(".llm-bilingual-translation.is-done").getAttribute("tabindex"), null);

  const retriedStats = await page.evaluate(async () => {
    const response = await window.__sendContentMessage({ action: "get_page_stats" });
    return {
      stats: response.stats,
      requestCount: window.__mockItems.length
    };
  });

  assert.strictEqual(retriedStats.requestCount, 2);
  assert.strictEqual(retriedStats.stats.failed, 0);
  assert.strictEqual(retriedStats.stats.translated, 1);
  await page.close();
}

async function testDeclarativeAutoTranslationStartsOnLoad(browser) {
  const page = await createHarnessPage(browser, {
    autoTranslate: true,
    targetLanguage: "简体中文",
    html: `
      <main>
        <article>
          <p>BBC reporters are following the latest developments from London and Washington.</p>
        </article>
      </main>
    `
  });

  await page.waitForFunction(() => document.documentElement.dataset.llmTranslatorAuto === "started");
  await page.waitForFunction(() => document.querySelectorAll(".llm-bilingual-translation.is-done").length === 1);

  assert.strictEqual(await page.evaluate(() => window.__mockItems.length), 1);
  await page.close();
}

async function testSkipsTargetLanguageText(browser) {
  const page = await createHarnessPage(browser, {
    targetLanguage: "简体中文",
    html: `
      <main>
        <p id="zh">这是一段已经是中文的内容，不需要再翻译。</p>
        <p id="mixed">这是 OpenAI 发布的新模型说明，当前内容已经主要是中文。</p>
        <p id="en">Grok 4.5 is now in private beta at SpaceX and Tesla, with early evaluations showing strong performance.</p>
      </main>
    `
  });

  const result = await runTranslation(page);

  assert.strictEqual(result.requestCount, 1, "Only the English paragraph should be requested.");
  assert.strictEqual(result.translatedTexts.length, 1);
  assert.ok(result.requestedTexts[0].includes("Grok 4.5"));
  assert.strictEqual(await hasTranslationNear(page, "#zh"), false);
  assert.strictEqual(await hasTranslationNear(page, "#mixed"), false);
  assert.strictEqual(await hasTranslationNear(page, "#en"), true);

  await page.close();
}

async function testTranslationUiResetsBidiStyles(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main style="direction: rtl; unicode-bidi: bidi-override">
        <p id="google-like">This result should display a plugin error without reversed text.</p>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({
    action: "show_page_notice",
    text: "ignore"
  }));
  await page.evaluate(() => {
    const node = document.createElement("div");
    node.className = "llm-bilingual-translation is-error";
    node.dir = "auto";
    node.textContent = "翻译失败：API 请求超时（45 秒）。（点击重试）";
    document.getElementById("google-like").insertAdjacentElement("afterend", node);
  });

  const style = await page.evaluate(() => {
    const node = document.querySelector(".llm-bilingual-translation.is-error");
    const computed = getComputedStyle(node);
    return {
      direction: computed.direction,
      unicodeBidi: computed.unicodeBidi,
      writingMode: computed.writingMode,
      textAlign: computed.textAlign,
      dir: node.getAttribute("dir")
    };
  });

  assert.strictEqual(style.direction, "ltr");
  assert.strictEqual(style.unicodeBidi, "plaintext");
  assert.strictEqual(style.writingMode, "horizontal-tb");
  assert.strictEqual(style.dir, "auto");

  await page.close();
}

async function testDarkThemeReadable(browser) {
  const page = await createHarnessPage(browser, {
    bodyStyle: "background:#000;color:#fff;font:24px Arial;padding:40px",
    html: `
      <main>
        <article>
          <p>Grok 4.5 is now in private beta at SpaceX and Tesla.</p>
        </article>
      </main>
    `
  });

  await runTranslation(page);

  const style = await page.evaluate(() => {
    const node = document.querySelector(".llm-bilingual-translation.is-done");
    const computed = getComputedStyle(node);
    return {
      theme: document.documentElement.dataset.llmTranslatorTheme,
      color: computed.color
    };
  });

  assert.strictEqual(style.theme, "dark");
  assert.strictEqual(style.color, "rgb(248, 250, 252)");

  await page.close();
}

async function testLocalDarkSectionReadableOnLightPage(browser) {
  const page = await createHarnessPage(browser, {
    bodyStyle: "background:#fff;color:#111;font:24px Arial;padding:40px",
    html: `
      <main>
        <section style="background:#080808;color:#fff;padding:24px">
          <p>CNN streaming cards often sit inside a dark section on an otherwise light home page.</p>
        </section>
      </main>
    `
  });

  await runTranslation(page);

  const style = await page.evaluate(() => {
    const node = document.querySelector(".llm-bilingual-translation.is-done");
    const computed = getComputedStyle(node);
    return {
      pageTheme: document.documentElement.dataset.llmTranslatorTheme,
      localTheme: node.dataset.llmTranslatorLocalTheme,
      color: computed.color
    };
  });

  assert.strictEqual(style.pageTheme, "light");
  assert.strictEqual(style.localTheme, "dark");
  assert.strictEqual(style.color, "rgb(248, 250, 252)");

  await page.close();
}

async function testTranslationFirstModeDimsOriginalText(browser) {
  const page = await createHarnessPage(browser, {
    displayMode: "translation-first",
    html: `
      <main>
        <p id="story">This article paragraph should be visually secondary after translation.</p>
      </main>
    `
  });

  await runTranslation(page);

  const styles = await page.evaluate(() => {
    const story = document.getElementById("story");
    const translation = document.querySelector(".llm-bilingual-translation.is-done");
    return {
      mode: document.documentElement.dataset.llmTranslatorMode,
      originalOpacity: getComputedStyle(story).opacity,
      translationFontSize: getComputedStyle(translation).fontSize
    };
  });

  assert.strictEqual(styles.mode, "translation-first");
  assert.strictEqual(styles.originalOpacity, "0.52");
  assert.ok(Number.parseFloat(styles.translationFontSize) > 0);
  await page.close();
}

async function testPageBudgetLimitsRequests(browser) {
  const page = await createHarnessPage(browser, {
    maxRequestsPerPage: 1,
    maxCharsPerPage: 1000,
    html: `
      <main>
        <p id="one">First paragraph has enough English text to be translated by the extension.</p>
        <p id="two">Second paragraph also has enough English text to be translated by the extension.</p>
        <p id="three">Third paragraph also has enough English text to be translated by the extension.</p>
      </main>
    `
  });

  const result = await runTranslation(page);

  assert.strictEqual(result.requestCount, 1, "maxRequestsPerPage=1 should limit API requests.");
  assert.strictEqual(result.translationCount, 1);
  assert.strictEqual(result.stats.apiRequested, 1);
  assert.ok(result.stats.skippedBudget >= 1, "Budget skipped count should be tracked.");

  await page.close();
}

async function testAutoTranslationSkipsTargetLanguagePage(browser) {
  const page = await createHarnessPage(browser, {
    htmlLang: "zh-CN",
    targetLanguage: "简体中文",
    html: `
      <main>
        <p>这是一段已经是中文的页面正文，不应该触发自动翻译。</p>
        <p>这段内容也主要是中文，只包含 OpenAI 这样的英文名称。</p>
      </main>
    `
  });

  const response = await page.evaluate(() => window.__sendContentMessage({ action: "start_translation", auto: true }));
  await page.waitForTimeout(600);
  const stats = await page.evaluate(() => window.__sendContentMessage({ action: "get_page_stats" }));

  assert.strictEqual(response.skipped, true);
  assert.strictEqual(stats.active, false);
  assert.strictEqual(await page.evaluate(() => window.__mockItems.length), 0);

  await page.close();
}

async function testAutoTranslationSkipsTargetLanguageDominantPage(browser) {
  const page = await createHarnessPage(browser, {
    htmlLang: "zh-CN",
    targetLanguage: "简体中文",
    html: `
      <main>
        <article>
          <p>这是一段中文页面正文，介绍产品功能和使用方式，用户已经可以直接阅读。</p>
          <p>第二段继续说明当前页面的主要内容，整体语言仍然是中文。</p>
          <p>第三段补充更多中文说明，只有少量外文引用不应该触发整页自动翻译。</p>
          <p>A short English quote appears here for context and should not start page translation by itself.</p>
        </article>
      </main>
    `
  });

  const response = await page.evaluate(() => window.__sendContentMessage({ action: "start_translation", auto: true }));
  await page.waitForTimeout(600);
  const stats = await page.evaluate(() => window.__sendContentMessage({ action: "get_page_stats" }));

  assert.strictEqual(response.skipped, true);
  assert.strictEqual(stats.active, false);
  assert.strictEqual(await page.evaluate(() => window.__mockItems.length), 0);

  await page.close();
}

async function testCanHideAndShowTranslations(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <p>The extension should allow users to hide translated text and show it again later.</p>
      </main>
    `
  });

  await runTranslation(page);
  assert.strictEqual(await page.locator(".llm-bilingual-translation.is-done").count(), 1);

  await page.evaluate(() => window.__sendContentMessage({ action: "set_translation_visibility", visible: false }));
  const hidden = await page.evaluate(() => {
    const node = document.querySelector(".llm-bilingual-translation.is-done");
    return getComputedStyle(node).display === "none";
  });
  assert.strictEqual(hidden, true);

  await page.evaluate(() => window.__sendContentMessage({ action: "set_translation_visibility", visible: true }));
  const visible = await page.evaluate(() => {
    const node = document.querySelector(".llm-bilingual-translation.is-done");
    return getComputedStyle(node).display !== "none";
  });
  const stats = await page.evaluate(() => window.__sendContentMessage({ action: "get_page_stats" }));

  assert.strictEqual(visible, true);
  assert.strictEqual(stats.stats.translationVisible, true);

  await page.close();
}

async function testShowsPageNotice(browser) {
  const page = await createHarnessPage(browser, {
    bodyStyle: "background:#000;color:#fff;font:20px Arial;padding:32px",
    html: "<main><p>English text exists on this page.</p></main>"
  });

  const response = await page.evaluate(() => window.__sendContentMessage({
    action: "show_page_notice",
    text: "请先在选项页填写 API Key。",
    isError: true
  }));

  assert.strictEqual(response.ok, true);
  await page.waitForSelector(".llm-bilingual-page-notice.is-error");
  const noticeText = await page.locator(".llm-bilingual-page-notice").textContent();
  assert.match(noticeText, /API Key/);

  await page.close();
}

async function testShowsSelectionTranslationCard(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <p id="selectable">This page contains text that can be selected and translated into a floating card.</p>
      </main>
    `
  });

  await selectTextInElement(page, "#selectable");
  const response = await page.evaluate(() => window.__sendContentMessage({
    action: "show_selection_translation",
    originalText: "This page contains text.",
    translatedText: "这个页面包含文本。"
  }));

  assert.strictEqual(response.ok, true);
  await page.waitForSelector(".llm-bilingual-selection-card");
  const cardText = await page.locator(".llm-bilingual-selection-card").innerText();
  assert.ok(cardText.includes("原文"));
  assert.ok(cardText.includes("译文"));
  assert.ok(cardText.includes("This page contains text."));
  assert.ok(cardText.includes("这个页面包含文本。"));
  assert.strictEqual(await page.locator(".llm-bilingual-selection-card [data-action='copy']").textContent(), "复制译文");
  assert.strictEqual(await page.locator(".llm-bilingual-selection-card [data-action='close']").getAttribute("aria-label"), "关闭选中文本翻译");
  const cardPosition = await page.locator(".llm-bilingual-selection-card").evaluate((node) => ({
    left: node.style.left,
    top: node.style.top,
    right: node.style.right,
    bottom: node.style.bottom,
    height: node.getBoundingClientRect().height
  }));
  assert.match(cardPosition.left, /px$/);
  assert.match(cardPosition.top, /px$/);
  assert.strictEqual(cardPosition.right, "auto");
  assert.strictEqual(cardPosition.bottom, "auto");
  assert.ok(cardPosition.height < 260, `selection card should fit content, got ${cardPosition.height}px`);

  await page.evaluate(() => {
    window.__copiedSelectionText = "";
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(text) {
          window.__copiedSelectionText = text;
        }
      }
    });
  });
  await page.click(".llm-bilingual-selection-card [data-action='copy']");
  await page.waitForFunction(() => window.__copiedSelectionText === "这个页面包含文本。");
  await page.waitForFunction(() => document.querySelector(".llm-bilingual-selection-card__status")?.textContent.includes("已复制"));

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.querySelectorAll(".llm-bilingual-selection-card").length === 0);

  await selectTextInElement(page, "#selectable");
  await page.evaluate(() => window.__sendContentMessage({
    action: "show_selection_translation",
    originalText: "This page contains text.",
    translatedText: "这个页面包含文本。"
  }));
  await page.waitForSelector(".llm-bilingual-selection-card");
  await page.waitForTimeout(50);
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => document.querySelectorAll(".llm-bilingual-selection-card").length === 0);

  await page.evaluate(() => window.__sendContentMessage({
    action: "show_selection_translation",
    originalText: "This page contains text.",
    translatedText: "这个页面包含文本。"
  }));
  await page.waitForSelector(".llm-bilingual-selection-card");
  await page.click(".llm-bilingual-selection-card [data-action='close']");
  assert.strictEqual(await page.locator(".llm-bilingual-selection-card").count(), 0);

  await page.evaluate(() => window.__sendContentMessage({
    action: "show_selection_translation",
    originalText: "这段文字已经是中文。",
    notice: "选中文本已是目标语言，无需翻译。"
  }));
  await page.waitForSelector(".llm-bilingual-selection-card");
  assert.strictEqual(await page.locator(".llm-bilingual-selection-card [data-action='copy']").isDisabled(), true);
  const noticeCardText = await page.locator(".llm-bilingual-selection-card").innerText();
  assert.ok(noticeCardText.includes("提示"));
  assert.ok(noticeCardText.includes("无需翻译"));

  await page.close();
}

async function selectTextInElement(page, selector) {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    const range = document.createRange();
    range.selectNodeContents(target);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
}

async function createHarnessPage(browser, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
  const bodyStyle = options.bodyStyle || "font:20px Arial;padding:32px";

  await page.setContent(`<!doctype html>
    <html>
      <head><meta charset="utf-8"></head>
      <body style="${bodyStyle}">${options.html || ""}</body>
    </html>`);

  if (options.htmlLang) {
    await page.evaluate((htmlLang) => {
      document.documentElement.lang = htmlLang;
    }, options.htmlLang);
  }

  if (options.deferIntersectionObserver) {
    await page.evaluate(() => {
      window.__observedElements = [];
      window.IntersectionObserver = class {
        constructor(callback, options) {
          this.callback = callback;
          this.options = options;
        }

        observe(element) {
          window.__observedElements.push(element);
        }

        unobserve() {}
        disconnect() {}
      };
    });
  }

  await page.evaluate(({ settings, translateDelayMs, failFirstTranslate }) => {
    const listeners = [];

    window.__mockItems = [];
    window.__runtimeMessages = [];
    window.__storageGetCalls = [];
    window.__inflightTranslateBatches = 0;
    window.__maxConcurrentTranslateBatches = 0;
    window.__mockTranslateBatchSizes = [];
    window.__mockTranslateFailuresRemaining = failFirstTranslate ? 1 : 0;
    window.chrome = {
      storage: {
        local: {
          async get(keys) {
            const normalizedKeys = Array.isArray(keys) ? keys : [keys];
            window.__storageGetCalls.push(normalizedKeys);
            return Object.fromEntries(normalizedKeys.map((key) => [key, settings[key]]));
          }
        }
      },
      runtime: {
        onMessage: {
          addListener(listener) {
            listeners.push(listener);
          },
          removeListener(listener) {
            const index = listeners.indexOf(listener);
            if (index >= 0) listeners.splice(index, 1);
          }
        },
        async sendMessage(request) {
          window.__runtimeMessages.push(request);
          if (request.action === "get_settings") {
            return settings;
          }

          if (request.action === "translate_batch") {
            const items = request.items || [];
            window.__mockTranslateBatchSizes.push(items.length);
            window.__inflightTranslateBatches += 1;
            window.__maxConcurrentTranslateBatches = Math.max(
              window.__maxConcurrentTranslateBatches,
              window.__inflightTranslateBatches
            );
            window.__mockItems.push(...items.map((item) => item.text));
            try {
              if (translateDelayMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, translateDelayMs));
              }
              if (window.__mockTranslateFailuresRemaining > 0) {
                window.__mockTranslateFailuresRemaining -= 1;
                return {
                  ok: false,
                  error: "Mock translation failure.",
                  meta: { requested: items.length, cacheHits: 0 },
                  results: items.map((item) => ({
                    id: item.id,
                    error: "Mock translation failure."
                  }))
                };
              }
              return {
                ok: true,
                meta: { requested: items.length, cacheHits: 0 },
                results: items.map((item) => ({
                  id: item.id,
                  text: `测试译文：${String(item.text || "").slice(0, 80)}`
                }))
              };
            } finally {
              window.__inflightTranslateBatches -= 1;
            }
          }

          throw new Error(`Unhandled runtime message: ${request.action}`);
        }
      }
    };

    window.__listenerCount = () => listeners.length;
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
    settings: {
      apiUrl: "http://127.0.0.1/mock/v1/chat/completions",
      apiKey: "mock-key",
      model: "mock-model",
      sourceLanguage: "English",
      targetLanguage: options.targetLanguage || "简体中文",
      batchSize: options.batchSize ?? 4,
      maxElementsPerScan: options.maxElementsPerScan ?? 12,
      maxTextLength: 1600,
      maxRequestsPerPage: options.maxRequestsPerPage ?? 80,
      maxCharsPerPage: options.maxCharsPerPage ?? 60000,
      maxCharsPerBatch: options.maxCharsPerBatch ?? 6000,
      maxConcurrentBatches: options.maxConcurrentBatches ?? 2,
      maxCacheEntries: options.maxCacheEntries ?? 2000,
      autoTranslate: options.autoTranslate === true,
      displayMode: options.displayMode || "bilingual",
      viewportOnly: true
    },
    translateDelayMs: options.translateDelayMs || 0,
    failFirstTranslate: options.failFirstTranslate === true
  });

  await page.evaluate(sharedSource);
  await page.evaluate(contentSource);
  return page;
}

async function runTranslation(page) {
  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(1800);

  return page.evaluate(async () => {
    const statsResponse = await window.__sendContentMessage({ action: "get_page_stats" });
    return {
      requestCount: window.__mockItems.length,
      requestedTexts: window.__mockItems,
      translationCount: document.querySelectorAll(".llm-bilingual-translation.is-done").length,
      translatedTexts: Array.from(document.querySelectorAll(".llm-bilingual-translation.is-done")).map((node) => node.textContent),
      stats: statsResponse.stats
    };
  });
}

async function hasTranslationNear(page, selector) {
  return page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    if (!target) return false;
    return target.nextElementSibling?.classList.contains("llm-bilingual-translation")
      || !!target.querySelector(".llm-bilingual-translation");
  }, selector);
}

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const extensionDir = path.resolve(__dirname, "..");
const sharedSource = fs.readFileSync(path.join(extensionDir, "shared.js"), "utf8");
const contentSource = fs.readFileSync(path.join(extensionDir, "content.js"), "utf8");
const currentContentScriptVersion = getContentScriptVersion(contentSource);

function getContentScriptVersion(source) {
  const match = source.match(/CONTENT_SCRIPT_VERSION\s*=\s*"([^"]+)"/);
  assert.ok(match, "content script version should be declared");
  return match[1];
}

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
    await testXScreenReaderTitleIsNotTranslated(browser);
    await testNewsCardSkipsCreditsAndHiddenMetadata(browser);
    await testNewsCardKeepsHeadlineWhenUtilityLabelIsPresent(browser);
    await testCnnHomepageLeadCardSurvivesUtilityFiltering(browser);
    await testRedditTextBodyUsesSafeTranslationAnchor(browser);
    await testGitHubRepositoryFileListDoesNotStealTranslationBudget(browser);
    await testGitHubFlexRepositoryRowsDoNotReceiveTranslations(browser);
    await testDenseTableRowsDoNotReceiveBlockTranslations(browser);
    await testShortUtilityLinkWithPunctuationDoesNotStealBudget(browser);
    await testMediaWikiSidebarDoesNotStealArticleBudget(browser);
    await testSkipsTargetLanguagePage(browser);
    await testPageLanguageModeTranslatesShortReadableLabels(browser);
    await testNonLatinSourceLanguagesTranslate(browser);
    await testTranslationUiResetsBidiStyles(browser);
    await testDarkThemeReadable(browser);
    await testLocalDarkSectionReadableOnLightPage(browser);
    await testTranslationFirstModeDimsOriginalText(browser);
    await testPageBudgetLimitsRequests(browser);
    await testRetrySuccessDoesNotDoubleCountStats(browser);
    await testRetryFailureStaysKeyboardAccessible(browser);
    await testContentMessageFailureReturnsReadableResponse(browser);
    await testTranslationBatchesUseLimitedConcurrency(browser);
    await testFarViewportCancelsStalePendingTranslations(browser);
    await testAutoTranslationStartsEnglishContentWithTargetLocale(browser);
    await testDisabledAutoTranslationDoesNotWakeBackgroundForSettings(browser);
    await testVisibleElementsDoNotWaitForIntersectionObserver(browser);
    await testDeclarativeAutoTranslationStartsOnLoad(browser);
    await testDeclarativeAutoTranslationSkipMarksBackgroundInactive(browser);
    await testAutoTranslationWaitsForDynamicEnglishContentWithTargetLocale(browser);
    await testAutoTranslationSkipsTargetLanguagePage(browser);
    await testAutoTranslationSkipsTargetLanguageDominantPage(browser);
    await testAutoTranslationUsesCurrentViewportLanguageSample(browser);
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
  assert.strictEqual(await page.evaluate(() => document.documentElement.dataset.llmTranslatorVersion), currentContentScriptVersion);

  const result = await runTranslation(page);
  assert.strictEqual(result.requestCount, 1);
  await page.close();
}

async function testXPrimaryColumnIgnoresSidebarAndComposer(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main role="main">
        <div data-testid="primaryColumn">
          <h1>Post</h1>
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
  assert.doesNotMatch(requested, /^Post$/m);
  assert.doesNotMatch(requested, /Post your reply/);
  assert.doesNotMatch(requested, /Relevant people/);
  assert.doesNotMatch(requested, /Trending in United States/);
  assert.strictEqual(await page.locator("aside .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("[aria-label='Timeline: Trending now'] .llm-bilingual-translation").count(), 0);

  await page.close();
}

async function testXScreenReaderTitleIsNotTranslated(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main role="main">
        <div data-testid="primaryColumn">
          <article data-testid="tweet" role="article">
            <div data-testid="tweetText">
              Mythos 6 Leaks: Already Exists?

              - A new Mythos model has finished training internally, and could launch as Mythos 5.1 or Mythos 6.
            </div>
          </article>
        </div>
        <div class="sr-only" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)">
          Pankaj Kumar on X: "Mythos 6 Leaks: Already Exists? - A new Mythos model has finished training internally, and could launch as Mythos 5.1 or Mythos 6." / X
        </div>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.strictEqual(result.requestCount, 1);
  assert.match(requested, /Mythos 6 Leaks/);
  assert.doesNotMatch(requested, /Pankaj Kumar on X/);
  assert.strictEqual(await page.locator(".sr-only .llm-bilingual-translation").count(), 0);
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

async function testNewsCardKeepsHeadlineWhenUtilityLabelIsPresent(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <ul>
          <li class="card card--label-above-headline">
            <div>•</div>
            <div>LIVE UPDATES</div>
            <a href="/live-story">
              <div class="container__headline">
                <span class="container__headline-text">Trump and Iran issue conflicting statements about new talks</span>
              </div>
            </a>
          </li>
        </ul>
      </main>
    `
  });

  const result = await runTranslation(page);

  assert.strictEqual(result.requestCount, 1);
  assert.strictEqual(result.requestedTexts[0], "Trump and Iran issue conflicting statements about new talks");
  assert.doesNotMatch(result.requestedTexts[0], /LIVE UPDATES/i);
  await page.close();
}

async function testCnnHomepageLeadCardSurvivesUtilityFiltering(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 4,
    bodyStyle: "font:18px Arial;margin:0",
    html: `
      <main class="layout-homepage__main">
        <section class="container_ribbon">
          <a href="/topic">Live Updates: Iran latest</a>
          <a href="/topic">Trending: World Cup</a>
          <a href="/topic">E. Jean Carroll</a>
          <a href="/topic">CNN Underscored: Amazon deals</a>
        </section>
        <section class="layout__main" style="display:grid;grid-template-columns:320px 1fr 320px;gap:32px;margin-top:32px">
          <ul style="list-style:none;padding:0;margin:0">
            <li class="lead-card card--label-above-headline">
              <div>•</div>
              <div>LIVE UPDATES</div>
              <a id="cnn-lead-link" href="/2026/06/29/world/live-news/iran-war-strikes-trump">
                <div class="container__headline">
                  <span class="container__headline-text">Trump and Iran issue conflicting statements about new talks</span>
                </div>
              </a>
            </li>
            <li>
              <a href="/story">Speaker Johnson sends bipartisan housing bill to White House — but Trump says it’s a ‘yawn’</a>
            </li>
          </ul>
          <article>
            <h2>Takeaways as Supreme Court hands Trump wins and losses</h2>
            <p>The court expanded Trump’s power but snubbed other key efforts ahead of midterms.</p>
          </article>
          <aside>
            <h2>Catch up on today’s headlines</h2>
            <a href="/world-cup">Paraguay shocks Germany on penalty kicks to bounce the 4-time champions out of the tournament</a>
          </aside>
        </section>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /Trump and Iran issue conflicting statements about new talks/);
  assert.doesNotMatch(requested, /LIVE UPDATES/);
  assert.doesNotMatch(requested, /E\. Jean Carroll/);
  assert.strictEqual(await hasTranslationNear(page, ".lead-card"), true);
  assert.strictEqual(await hasTranslationNear(page, "#cnn-lead-link"), true);
  await page.close();
}

async function testRedditTextBodyUsesSafeTranslationAnchor(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 1,
    html: `
      <style>
        article, shreddit-post, shreddit-post-text-body { display: block; }
        .feed-card-text-preview { max-height: 92px; overflow: hidden; }
      </style>
      <article data-post-id="t3_redditlayout">
        <shreddit-post post-type="text" post-title="Praise for Codex goal" post-language="en">
          <a id="post-title-t3_redditlayout" slot="title" href="/r/codex/comments/example">
            Praise for Codex /goal: a 17.5-day run and a workflow that changed my work
          </a>
          <shreddit-post-text-body slot="text-body" post-id="t3_redditlayout">
            <a href="/r/codex/comments/example" class="pointer-events-none" slot="text-body">
              <div data-post-click-location="text-body">
                <div id="t3_redditlayout-post-rtjson-content" class="md feed-card-text-preview" property="schema:articleBody">
                  <p>I wanted to share a Codex appreciation post, because this run made me realize how different work has become.</p>
                  <p>Ten years ago, this project would not just have been hard for me. It basically would not have been realistic.</p>
                  <p>I had a messy historical workflow that was difficult to keep organized without modern coding agents.</p>
                </div>
              </div>
            </a>
          </shreddit-post-text-body>
        </shreddit-post>
      </article>
    `
  });

  const result = await runTranslation(page);

  assert.strictEqual(result.requestCount, 1);
  assert.match(result.requestedTexts[0], /Codex appreciation post/);
  assert.strictEqual(await page.locator("#t3_redditlayout-post-rtjson-content .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("a[slot='text-body'] .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("shreddit-post-text-body > .llm-bilingual-translation").count(), 1);
  assert.strictEqual(await page.locator("shreddit-post-text-body > .llm-bilingual-translation").getAttribute("slot"), "text-body");
  const layout = await page.locator("shreddit-post-text-body > .llm-bilingual-translation").evaluate((node) => {
    const style = window.getComputedStyle(node);
    return {
      display: style.display,
      width: node.getBoundingClientRect().width,
      parentWidth: node.parentElement.getBoundingClientRect().width,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth
    };
  });
  assert.strictEqual(layout.display, "block");
  assert.ok(layout.width <= layout.parentWidth + 1);
  assert.ok(layout.scrollWidth <= layout.clientWidth + 1);
  await page.close();
}

async function testGitHubRepositoryFileListDoesNotStealTranslationBudget(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 4,
    html: `
      <main>
        <section>
          <table aria-labelledby="folders-and-files">
            <thead>
              <tr>
                <th>Name</th>
                <th>Last commit message</th>
                <th>Last commit date</th>
              </tr>
            </thead>
            <tbody>
              <tr data-testid="latest-commit">
                <td>zkwi</td>
                <td><span data-testid="latest-commit-html">Fix popup thinking summary placeholder</span></td>
                <td><relative-time datetime="2026-06-30T00:00:00Z">3 minutes ago</relative-time></td>
              </tr>
              <tr class="react-directory-row" id="folder-row-0">
                <td>_locales</td>
                <td>Fix popup thinking summary placeholder</td>
                <td>3 minutes ago</td>
              </tr>
              <tr class="react-directory-row" id="folder-row-1">
                <td>docs</td>
                <td>Improve translation UX and release readiness</td>
                <td>50 minutes ago</td>
              </tr>
            </tbody>
          </table>
        </section>
        <article id="readme">
          <h2>DualRead AI</h2>
          <p>DualRead AI is an open-source Chrome extension for bilingual webpage translation with viewport-first scanning, right-click translation, and OpenAI-compatible providers.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /open-source Chrome extension/);
  assert.doesNotMatch(requested, /Fix popup thinking summary placeholder/);
  assert.doesNotMatch(requested, /Improve translation UX/);
  assert.strictEqual(await page.locator("table[aria-labelledby='folders-and-files'] .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("#readme .llm-bilingual-translation").count(), 1);
  await page.close();
}

async function testGitHubFlexRepositoryRowsDoNotReceiveTranslations(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 5,
    html: `
      <main>
        <section aria-label="Repository files">
          <div class="Box-row d-flex flex-items-center" role="row">
            <div role="gridcell"><a href="/tree/main/docs">docs</a></div>
            <div role="gridcell"><a href="/commit/1"><span>Improve translation UX and release readiness</span></a></div>
            <div role="gridcell"><relative-time datetime="2026-06-30T01:00:00Z">50 minutes ago</relative-time></div>
          </div>
          <div class="Box-row d-flex flex-items-center" role="row">
            <div role="gridcell"><a href="/tree/main/scripts">scripts</a></div>
            <div role="gridcell"><a href="/commit/2"><span>Fix popup thinking summary placeholder</span></a></div>
            <div role="gridcell"><relative-time datetime="2026-06-30T01:10:00Z">3 minutes ago</relative-time></div>
          </div>
        </section>
        <article id="readme">
          <p>DualRead AI is an open-source Chrome extension for bilingual webpage translation with viewport-first scanning, right-click translation, and OpenAI-compatible providers.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /open-source Chrome extension/);
  assert.doesNotMatch(requested, /Improve translation UX/);
  assert.doesNotMatch(requested, /Fix popup thinking summary placeholder/);
  assert.strictEqual(await page.locator("[aria-label='Repository files'] .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("#readme .llm-bilingual-translation").count(), 1);
  await page.close();
}

async function testDenseTableRowsDoNotReceiveBlockTranslations(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 4,
    html: `
      <main>
        <table id="dense-file-table">
          <tbody>
            <tr>
              <td><a href="/commit/1">Fix popup thinking summary placeholder</a></td>
              <td><relative-time datetime="2026-06-30T00:00:00Z">3 minutes ago</relative-time></td>
            </tr>
            <tr>
              <td><a href="/commit/2">Improve translation UX and release readiness</a></td>
              <td><relative-time datetime="2026-06-30T01:00:00Z">50 minutes ago</relative-time></td>
            </tr>
          </tbody>
        </table>
        <article id="readme">
          <p>DualRead AI is an open-source Chrome extension for bilingual webpage translation with viewport-first scanning, right-click translation, and OpenAI-compatible providers.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /open-source Chrome extension/);
  assert.doesNotMatch(requested, /Fix popup thinking summary placeholder/);
  assert.doesNotMatch(requested, /Improve translation UX/);
  assert.strictEqual(await page.locator("#dense-file-table .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("#readme .llm-bilingual-translation").count(), 1);
  await page.close();
}

async function testShortUtilityLinkWithPunctuationDoesNotStealBudget(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <section class="container_ribbon">
        <ul>
          <li class="card">
            <a href="/topic"><span class="container__headline-text">E. Jean Carroll</span></a>
          </li>
        </ul>
      </section>
      <main>
        <article>
          <p>Primary article paragraph about diplomatic talks and regional security updates.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /Primary article paragraph/);
  assert.doesNotMatch(requested, /E\. Jean Carroll/);
  await page.close();
}

async function testMediaWikiSidebarDoesNotStealArticleBudget(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 4,
    html: `
      <main>
        <article>
          <div class="mw-parser-output">
            <table class="sidebar sidebar-collapse nomobile nowraplinks hlist">
              <tbody>
                <tr>
                  <td class="sidebar-content">
                    <div class="sidebar-list mw-collapsible mw-collapsed">
                      <div class="sidebar-list-content">
                        <ul>
                          <li><a href="/wiki/Taylor_Swift_deepfake_pornography_controversy">Taylor Swift deepfake pornography controversy</a></li>
                          <li><a href="/wiki/Google_Gemini_image_generation_controversy">Google Gemini image generation controversy</a></li>
                        </ul>
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <h1>Artificial intelligence</h1>
            <p>Artificial intelligence is the capability of computational systems to perform tasks typically associated with human intelligence, such as learning, reasoning, problem-solving, perception, and decision-making.</p>
            <p>High-profile applications of AI include advanced web search engines, chatbots, virtual assistants, autonomous vehicles, and analysis in strategy games.</p>
          </div>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /Artificial intelligence is the capability/);
  assert.match(requested, /High-profile applications of AI/);
  assert.doesNotMatch(requested, /Taylor Swift deepfake/);
  assert.doesNotMatch(requested, /Google Gemini image generation/);
  assert.strictEqual(await page.locator("table.sidebar .llm-bilingual-translation").count(), 0);
  await page.close();
}

async function testNonLatinSourceLanguagesTranslate(browser) {
  const japanesePage = await createHarnessPage(browser, {
    sourceLanguage: "Japanese",
    targetLanguage: "简体中文",
    html: `
      <main>
        <p>これは新しいモデルの評価についての詳しい説明です。多くの読者が背景を理解できるように整理しています。</p>
      </main>
    `
  });
  const japaneseResult = await runTranslation(japanesePage);
  assert.strictEqual(japaneseResult.requestCount, 1);
  assert.match(japaneseResult.requestedTexts[0], /新しいモデル/);
  await japanesePage.close();

  const chinesePage = await createHarnessPage(browser, {
    sourceLanguage: "简体中文",
    targetLanguage: "English",
    html: `
      <main>
        <p>这是关于网页翻译体验的一段中文说明，用户切换为中译英时应该能够正常触发翻译。</p>
      </main>
    `
  });
  const chineseResult = await runTranslation(chinesePage);
  assert.strictEqual(chineseResult.requestCount, 1);
  assert.match(chineseResult.requestedTexts[0], /中译英/);
  await chinesePage.close();

  const englishDefaultPage = await createHarnessPage(browser, {
    html: `
      <main>
        <p>これは日本語の文章です。既定の英語ソース設定では翻訳候補に入れないでください。</p>
      </main>
    `
  });
  const englishDefaultResult = await runTranslation(englishDefaultPage);
  assert.strictEqual(englishDefaultResult.requestCount, 0);
  await englishDefaultPage.close();
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
  assert.deepStrictEqual(storageGets, [["autoTranslate", "apiKey", "model", "uiLanguage"]]);
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

async function testRetryFailureStaysKeyboardAccessible(browser) {
  const page = await createHarnessPage(browser, {
    failFirstTranslate: true,
    html: `
      <main>
        <p>This paragraph keeps a usable retry block if settings cannot be read during retry.</p>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForFunction(() => document.querySelectorAll(".llm-bilingual-translation.is-error").length === 1);

  await page.evaluate(() => {
    window.__failGetSettings = true;
  });
  await page.focus(".llm-bilingual-translation.is-error");
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector(".llm-bilingual-translation.is-error")?.textContent.includes("Mock settings failure"));

  assert.strictEqual(await page.locator(".llm-bilingual-translation.is-error").getAttribute("role"), "button");
  assert.strictEqual(await page.locator(".llm-bilingual-translation.is-error").getAttribute("tabindex"), "0");
  const stats = await page.evaluate(async () => (await window.__sendContentMessage({ action: "get_page_stats" })).stats);
  assert.strictEqual(stats.failed, 1);
  assert.strictEqual(stats.translated, 0);
  await page.close();
}

async function testContentMessageFailureReturnsReadableResponse(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <p>This paragraph should not leave the popup waiting if settings fail to load.</p>
      </main>
    `
  });

  await page.evaluate(() => {
    window.__failGetSettings = true;
  });

  const response = await page.evaluate(() => Promise.race([
    window.__sendContentMessage({ action: "start_translation" }),
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), 600))
  ]));

  assert.strictEqual(response.timedOut, undefined);
  assert.strictEqual(response.ok, false);
  assert.match(response.error, /Mock settings failure/);

  const stats = await page.evaluate(async () => (await window.__sendContentMessage({ action: "get_page_stats" })).stats);
  assert.strictEqual(stats.translated, 0);
  assert.strictEqual(stats.failed, 0);
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

async function testDeclarativeAutoTranslationSkipMarksBackgroundInactive(browser) {
  const page = await createHarnessPage(browser, {
    autoTranslate: true,
    htmlLang: "zh-CN",
    targetLanguage: "简体中文",
    html: `
      <main>
        <article>
          <p>这是一段中文页面正文，用户已经可以直接阅读，不需要自动翻译。</p>
          <p>这里还有一段中文内容，只包含 DualRead AI 这样的英文产品名称。</p>
        </article>
      </main>
    `
  });

  await page.waitForFunction(() => document.documentElement.dataset.llmTranslatorAuto === "skipped:target-language");
  const markMessages = await page.evaluate(() => window.__runtimeMessages.filter((message) => message.action === "mark_tab_active"));

  assert.strictEqual(markMessages.length, 1);
  assert.strictEqual(markMessages[0].active, false);
  assert.strictEqual(markMessages[0].reason, "target-language");
  assert.strictEqual(await page.evaluate(() => window.__mockItems.length), 0);
  await page.close();
}

async function testSkipsTargetLanguagePage(browser) {
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

  assert.strictEqual(result.requestCount, 0, "Target-language dominant pages should be skipped before block-level filtering.");
  assert.strictEqual(result.translatedTexts.length, 0);
  assert.strictEqual(await hasTranslationNear(page, "#zh"), false);
  assert.strictEqual(await hasTranslationNear(page, "#mixed"), false);
  assert.strictEqual(await hasTranslationNear(page, "#en"), false);

  await page.close();
}

async function testPageLanguageModeTranslatesShortReadableLabels(browser) {
  const page = await createHarnessPage(browser, {
    htmlLang: "en",
    targetLanguage: "简体中文",
    html: `
      <main>
        <article>
          <h2 id="world-cup">WORLD CUP</h2>
          <h3 id="weather">Weather</h3>
          <p id="story">A strong summer storm system is expected to affect travel across several states this week.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /WORLD CUP/);
  assert.match(requested, /Weather/);
  assert.match(requested, /strong summer storm/);
  assert.strictEqual(await hasTranslationNear(page, "#world-cup"), true);
  assert.strictEqual(await hasTranslationNear(page, "#weather"), true);

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

async function testAutoTranslationUsesCurrentViewportLanguageSample(browser) {
  const englishParagraphs = Array.from({ length: 12 }, (_, index) => (
    `<p>Offscreen English article paragraph ${index + 1} describes a different section and should not decide whether the current Chinese viewport needs automatic translation.</p>`
  )).join("");
  const page = await createHarnessPage(browser, {
    targetLanguage: "简体中文",
    html: `
      <main>
        <section id="visible-chinese">
          <p>这是当前屏幕中用户正在阅读的中文正文，页面不应该因为远处的英文模块而自动翻译。</p>
          <p>这一段继续提供中文上下文，只有当前可视区域附近的语言才应该决定自动翻译是否启动。</p>
          <p>少量 OpenAI 英文名称不应该改变当前页面以中文为主的判断。</p>
        </section>
        <section id="offscreen-english" style="margin-top: 2600px">
          ${englishParagraphs}
        </section>
      </main>
    `
  });

  const response = await page.evaluate(() => window.__sendContentMessage({ action: "start_translation", auto: true }));
  await page.waitForTimeout(600);
  const stats = await page.evaluate(() => window.__sendContentMessage({ action: "get_page_stats" }));

  assert.strictEqual(response.skipped, true);
  assert.strictEqual(response.reason, "target-language");
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
          if (request.action === "mark_tab_active") {
            return { ok: true, active: request.active !== false };
          }
          if (request.action === "get_settings") {
            if (window.__failGetSettings) throw new Error("Mock settings failure");
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
      sourceLanguage: options.sourceLanguage || "English",
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

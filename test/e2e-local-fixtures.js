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
    await testStreamingTranslationUpdatesBeforeResponseCompletes(browser);
    if (process.env.TEST_FILTER === "streaming") return;
    if (process.env.TEST_FILTER === "streaming-core") {
      await testStreamingTranslationsUseLimitedConcurrency(browser);
      await testFarViewportCancelsStalePendingTranslations(browser);
      return;
    }
    if (process.env.TEST_FILTER === "streaming-manual") {
      await testManualTranslationShowsLoadingPlaceholderImmediately(browser);
      await testManualCurrentAreaUsesProvidedSettingsForImmediatePlaceholder(browser);
      await testStoppingTranslationClearsImmediateLoadingPlaceholder(browser);
      return;
    }
    if (process.env.TEST_FILTER === "layout-adapter") {
      await testViewportSupplementFindsVisibleListSiblings(browser);
      await testFlexAndGridCardsGiveTranslationsTheirOwnRow(browser);
      await testColumnFlexTweetKeepsTranslationInsidePost(browser);
      await testClippedRedditPreviewUsesSingleSafeTranslationUnit(browser);
      return;
    }
    if (process.env.TEST_FILTER === "layout-coverage") {
      await testViewportSupplementFindsVisibleListSiblings(browser);
      return;
    }
    if (process.env.TEST_FILTER === "layout-flex-grid") {
      await testFlexAndGridCardsGiveTranslationsTheirOwnRow(browser);
      await testColumnFlexTweetKeepsTranslationInsidePost(browser);
      return;
    }
    if (process.env.TEST_FILTER === "layout-reddit") {
      await testClippedRedditPreviewUsesSingleSafeTranslationUnit(browser);
      return;
    }
    if (process.env.TEST_FILTER === "viewport-prefetch") {
      await testViewportBufferPrefetchesNextScreenBeforeScroll(browser);
      return;
    }
    await testPreservesLineBreaksInTweetText(browser);
    await testMultipleTextBlocksUseIndependentStreamRequests(browser);
    await testBatchCharacterLimitDoesNotCombineStreamRequests(browser);
    await testMainContentPriorityBeatsEarlierSideCards(browser);
    await testContentScriptReinjectsWhenVersionChanges(browser);
    await testXPrimaryColumnIgnoresSidebarAndComposer(browser);
    await testXScreenReaderTitleIsNotTranslated(browser);
    await testNewsCardSkipsCreditsAndHiddenMetadata(browser);
    await testNewsCardKeepsHeadlineWhenUtilityLabelIsPresent(browser);
    await testCnnHomepageLeadCardSurvivesUtilityFiltering(browser);
    await testViewportSupplementFindsVisibleListSiblings(browser);
    await testFlexAndGridCardsGiveTranslationsTheirOwnRow(browser);
    await testColumnFlexTweetKeepsTranslationInsidePost(browser);
    await testArticleHeadlineLinkWithoutHeadingIsTranslated(browser);
    await testEmbeddedPlayerErrorsDoNotStealNewsBudget(browser);
    await testRedditPostTitleIsTranslatedWithoutMetadata(browser);
    await testRedditDetailTitleTranslationKeepsTitleSlotOrder(browser);
    await testTranslationInheritsInsertionTargetSlot(browser);
    await testRedditTextBodyUsesSafeTranslationAnchor(browser);
    await testClippedRedditPreviewUsesSingleSafeTranslationUnit(browser);
    await testLongRedditTextBodyFallsBackToParagraphs(browser);
    await testLongRedditThreadDoesNotFullWalkComments(browser);
    await testTranslatedViewportScrollScanDoesNotFullWalk(browser);
    await testProcessedSampledBlockDoesNotBlockViewportFallback(browser);
    await testScanExtractsEachCandidateTextOnce(browser);
    await testGitHubRepositoryFileListDoesNotStealTranslationBudget(browser);
    await testGitHubFlexRepositoryRowsDoNotReceiveTranslations(browser);
    await testDenseTableRowsDoNotReceiveBlockTranslations(browser);
    await testHackerNewsStoryTitlesReceiveTranslations(browser);
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
    await testStreamingTranslationsUseLimitedConcurrency(browser);
    await testFarViewportCancelsStalePendingTranslations(browser);
    await testAutoTranslationStartsEnglishContentWithTargetLocale(browser);
    await testDisabledAutoTranslationDoesNotWakeBackgroundForSettings(browser);
    await testVisibleElementsDoNotWaitForIntersectionObserver(browser);
    await testViewportBufferPrefetchesNextScreenBeforeScroll(browser);
    await testManualTranslationShowsLoadingPlaceholderImmediately(browser);
    await testManualCurrentAreaUsesProvidedSettingsForImmediatePlaceholder(browser);
    await testManualTriggerFlushesFirstBatchQuickly(browser);
    await testHtmlLangFastPathTrustsDeclaredForeignLanguage(browser);
    await testStoppingTranslationClearsImmediateLoadingPlaceholder(browser);
    await testDeclarativeAutoTranslationStartsOnLoad(browser);
    await testDeclarativeAutoTranslationSkipMarksBackgroundInactive(browser);
    await testAutoTranslationWaitsForDynamicEnglishContentWithTargetLocale(browser);
    await testDynamicContentTranslatesDuringContinuousMutations(browser);
    await testAutoTranslationSkipsTargetLanguagePage(browser);
    await testAutoTranslationSkipsTargetLanguageDominantPage(browser);
    await testAutoTranslationUsesCurrentViewportLanguageSample(browser);
    await testCanHideAndShowTranslations(browser);
    await testShowsSelectionTranslationCard(browser);
    await testPageLanguageModeSkipsTargetLanguageTweets(browser);
    await testTranslationNodeStaysStableWhenClipStateChangesMidStream(browser);
    await testReRenderedTweetDoesNotDuplicateTranslation(browser);
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

async function testMultipleTextBlocksUseIndependentStreamRequests(browser) {
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

  assert.deepStrictEqual(batchSizes, [1, 1, 1], "Each text block should use its own plain-text stream request.");
  assert.strictEqual(result.translationCount, 3);
  await page.close();
}

async function testBatchCharacterLimitDoesNotCombineStreamRequests(browser) {
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

  assert.deepStrictEqual(batchSizes, [1, 1, 1], "Legacy batch character limits should not combine stream requests.");
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

async function testViewportSupplementFindsVisibleListSiblings(browser) {
  const columns = Array.from({ length: 3 }, (_, columnIndex) => `
    <ul class="news-column">
      ${Array.from({ length: 5 }, (_, rowIndex) => {
        const number = columnIndex * 5 + rowIndex + 1;
        return `
          <li data-headline="headline-${number}">
            <a href="/story-${number}">
              Visible headline ${number} explains a distinct international news development today
            </a>
          </li>
        `;
      }).join("")}
    </ul>
  `).join("");

  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 24,
    bodyStyle: "font:18px Arial;margin:0",
    html: `
      <style>
        main { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
        .news-column { list-style: none; margin: 0; padding: 0; }
        .news-column li { box-sizing: border-box; height: 150px; padding: 12px; border-bottom: 1px solid #ddd; }
        .news-column a { color: #111; text-decoration: none; }
      </style>
      <main>${columns}</main>
    `
  });

  const expectedHeadlines = await page.locator("[data-headline]").evaluateAll((items) => (
    items.map((item) => item.textContent.replace(/\s+/g, " ").trim())
  ));
  const result = await runTranslation(page);

  for (const headline of expectedHeadlines) {
    assert.ok(
      result.requestedTexts.includes(headline),
      `Viewport supplement should include visible list sibling: ${headline}`
    );
  }

  await page.close();
}

async function testFlexAndGridCardsGiveTranslationsTheirOwnRow(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 4,
    bodyStyle: "font:18px Arial;padding:24px",
    html: `
      <main>
        <ul style="list-style:none;margin:0;padding:0">
          <li id="flex-card" style="display:flex;flex-wrap:nowrap;align-items:flex-start;gap:12px;width:420px">
            <div id="flex-image" style="flex:0 0 140px;height:100px;background:#ddd">Product image</div>
            <a id="flex-title" href="/toothbrush" style="flex:1 1 auto;min-width:0;color:#111;text-decoration:none">
              Using an electric toothbrush is a great way to improve your oral hygiene
            </a>
          </li>
        </ul>
        <section id="grid-card" style="display:grid;grid-template-columns:120px 300px;gap:12px;width:432px;margin-top:32px">
          <div style="height:80px;background:#ddd">Travel image</div>
          <p id="grid-title" style="margin:0">A practical travel guide explains how passengers can prepare for changing conditions.</p>
        </section>
      </main>
    `
  });

  const before = await page.evaluate(() => ({
    flexTitleWidth: document.getElementById("flex-title").getBoundingClientRect().width
  }));

  await runTranslation(page);

  const layout = await page.evaluate(() => {
    const flexCard = document.getElementById("flex-card");
    const flexTitle = document.getElementById("flex-title");
    const flexTranslation = flexCard.querySelector(":scope > .llm-bilingual-translation");
    const firstRowBottom = Math.max(
      document.getElementById("flex-image").getBoundingClientRect().bottom,
      flexTitle.getBoundingClientRect().bottom
    );
    const gridCard = document.getElementById("grid-card");
    const gridTranslation = gridCard.querySelector(":scope > .llm-bilingual-translation");
    return {
      flexTitleWidth: flexTitle.getBoundingClientRect().width,
      flexTranslationTop: flexTranslation?.getBoundingClientRect().top || 0,
      firstRowBottom,
      flexLayoutMarker: flexCard.dataset.llmTranslatorLayout || "",
      gridTranslationWidth: gridTranslation?.getBoundingClientRect().width || 0,
      gridCardWidth: gridCard.getBoundingClientRect().width,
      gridColumnStart: gridTranslation ? getComputedStyle(gridTranslation).gridColumnStart : ""
    };
  });

  assert.ok(layout.flexTitleWidth >= before.flexTitleWidth - 1, "Translation must not squeeze the original Flex title.");
  assert.ok(layout.flexTranslationTop >= layout.firstRowBottom - 1, "Flex translation should occupy the next row.");
  assert.strictEqual(layout.flexLayoutMarker, "stacked-flex");
  assert.ok(layout.gridTranslationWidth >= layout.gridCardWidth - 1, "Grid translation should span the full card width.");
  assert.strictEqual(layout.gridColumnStart, "1");

  await page.evaluate(() => window.__sendContentMessage({ action: "clear_translation" }));
  const cleared = await page.evaluate(() => ({
    translationCount: document.querySelectorAll(".llm-bilingual-translation").length,
    flexLayoutMarker: document.getElementById("flex-card").dataset.llmTranslatorLayout || "",
    gridLayoutMarker: document.getElementById("grid-card").dataset.llmTranslatorLayout || ""
  }));
  assert.strictEqual(cleared.translationCount, 0);
  assert.strictEqual(cleared.flexLayoutMarker, "");
  assert.strictEqual(cleared.gridLayoutMarker, "");

  await page.close();
}

async function testColumnFlexTweetKeepsTranslationInsidePost(browser) {
  const page = await createHarnessPage(browser, {
    bodyStyle: "margin:0;font:18px Arial",
    html: `
      <main role="main" style="width:598px">
        <div data-testid="primaryColumn">
          <article data-testid="tweet" role="article" style="width:598px;overflow:hidden;padding:0 18px">
            <div style="margin-left:53px;min-width:0">
              <div id="tweet-content" style="display:flex;flex-direction:column;align-items:stretch;width:509px;min-width:0">
                <div data-testid="tweetText">Can my two RTX 3090 graphics cards run this model?</div>
              </div>
            </div>
          </article>
        </div>
      </main>
    `
  });

  await runTranslation(page);

  const layout = await page.evaluate(() => {
    const container = document.getElementById("tweet-content");
    const article = container.closest("article");
    const translation = container.querySelector(":scope > .llm-bilingual-translation");
    const containerRect = container.getBoundingClientRect();
    const articleRect = article.getBoundingClientRect();
    const translationRect = translation.getBoundingClientRect();
    return {
      containerLeft: containerRect.left,
      translationLeft: translationRect.left,
      translationRight: translationRect.right,
      articleRight: articleRect.right,
      containerScrollWidth: container.scrollWidth,
      containerClientWidth: container.clientWidth,
      layoutMarker: container.dataset.llmTranslatorLayout || "",
      flexWrap: getComputedStyle(container).flexWrap
    };
  });

  assert.ok(
    Math.abs(layout.translationLeft - layout.containerLeft) <= 1,
    `Column Flex translation should align with the post content: ${JSON.stringify(layout)}`
  );
  assert.ok(
    layout.translationRight <= layout.articleRight + 1,
    `Column Flex translation should stay inside the post: ${JSON.stringify(layout)}`
  );
  assert.ok(
    layout.containerScrollWidth <= layout.containerClientWidth + 1,
    `Column Flex translation should not create horizontal overflow: ${JSON.stringify(layout)}`
  );
  assert.strictEqual(layout.layoutMarker, "");
  assert.strictEqual(layout.flexWrap, "nowrap");

  await page.close();
}

async function testArticleHeadlineLinkWithoutHeadingIsTranslated(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 2,
    html: `
      <main>
        <article class="story-card">
          <a id="standalone-headline" class="headline-link" href="/story">
            Researchers reveal a practical way to audit complex agent coding sessions
          </a>
          <p>The report explains how teams can compare plans, implementation slices, and review notes.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /practical way to audit complex agent coding sessions/);
  assert.match(requested, /compare plans, implementation slices/);
  assert.strictEqual(await hasTranslationNear(page, "#standalone-headline"), true);

  await page.close();
}

async function testEmbeddedPlayerErrorsDoNotStealNewsBudget(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 3,
    html: `
      <main>
        <section class="video-resource">
          <div class="video-resource__wrapper">
            <div class="fave-player-container fave-bolt-player">
              <div id="overlay-root" role="group">
                <h2>DRM System Not Supported</h2>
                <p>It looks like your browser doesn't support the Digital Rights Management (DRM) system required to play this content. To stream on CNN, try restarting your browser or try a different browser. contact our Help Center.</p>
              </div>
            </div>
          </div>
        </section>
        <article>
          <h2>Takeaways as Supreme Court hands Trump wins and losses</h2>
          <p>The court expanded Trump’s power but snubbed other key efforts ahead of midterms.</p>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /Takeaways as Supreme Court/);
  assert.match(requested, /The court expanded Trump/);
  assert.doesNotMatch(requested, /Digital Rights Management/);
  assert.doesNotMatch(requested, /DRM System Not Supported/);
  assert.strictEqual(await page.locator(".fave-player-container .llm-bilingual-translation").count(), 0);
  await page.close();
}

async function testRedditPostTitleIsTranslatedWithoutMetadata(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 4,
    html: `
      <style>
        article, shreddit-post, shreddit-post-text-body { display: block; }
        .post-meta { display: block; margin-bottom: 12px; }
        #post-title-t3_reset { display: block; font-size: 32px; font-weight: 700; margin: 16px 0; }
      </style>
      <main>
        <article>
          <shreddit-post post-type="text" post-language="en">
            <div class="post-meta">
              <span>r/codex</span>
              <span>Performance Tracker</span>
              <time>8 hr. ago</time>
            </div>
            <a id="post-title-t3_reset" slot="title" href="/r/codex/comments/example">
              How can I tell when my codex resets expire?
            </a>
            <shreddit-post-text-body slot="text-body">
              <div property="schema:articleBody">
                <p>This might be a dumb question but is there a way to check when your available resets expire?</p>
              </div>
            </shreddit-post-text-body>
          </shreddit-post>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /How can I tell when my codex resets expire/);
  assert.match(requested, /available resets expire/);
  assert.doesNotMatch(requested, /^r\/codex\s+Performance Tracker\s+8 hr\. ago$/m);
  assert.strictEqual(await hasTranslationNear(page, "#post-title-t3_reset"), true);
  assert.strictEqual(await page.locator("#post-title-t3_reset + .llm-bilingual-translation").getAttribute("slot"), "title");

  await page.close();
}

async function testRedditDetailTitleTranslationKeepsTitleSlotOrder(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 3,
    html: `
      <script>
        customElements.define("shreddit-post", class extends HTMLElement {
          connectedCallback() {
            if (this.shadowRoot) return;
            this.attachShadow({ mode: "open" }).innerHTML = \`
              <slot name="title"></slot>
              <slot name="post-flair"></slot>
              <slot name="text-body"></slot>
              <slot></slot>
            \`;
          }
        });
      </script>
      <style>
        shreddit-post, shreddit-post-text-body { display: block; }
        #post-title-t3_detail { display: block; font-size: 32px; font-weight: 700; margin: 0 0 12px; }
        shreddit-post-text-body { display: block; margin-top: 12px; }
      </style>
      <main>
        <shreddit-post post-type="text" post-language="en">
          <h1 id="post-title-t3_detail" slot="title">
            Suckerberg panic bought the entire AI chip supply and now he has no idea what to do with it
          </h1>
          <div slot="post-flair">Discussion</div>
          <shreddit-post-text-body slot="text-body">
            <div property="schema:articleBody">
              <p>So let me get this straight. Suckerberg spends tens of billions panic buying AI chips.</p>
              <p>But then again, the market normally inverses logic. So, Meta calls?</p>
            </div>
          </shreddit-post-text-body>
        </shreddit-post>
      </main>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /entire AI chip supply/);
  assert.match(requested, /market normally inverses logic/);
  const layout = await page.evaluate(() => {
    const title = document.querySelector("#post-title-t3_detail");
    const titleTranslation = title?.nextElementSibling;
    const bodyTranslation = document.querySelector("shreddit-post-text-body + .llm-bilingual-translation");
    return {
      titleSlot: titleTranslation?.getAttribute("slot"),
      titleTranslationTop: Math.round(titleTranslation?.getBoundingClientRect().top || 0),
      bodyTranslationTop: Math.round(bodyTranslation?.getBoundingClientRect().top || 0)
    };
  });

  assert.strictEqual(layout.titleSlot, "title");
  assert.ok(
    layout.titleTranslationTop < layout.bodyTranslationTop,
    `title translation should render before body translation, got ${JSON.stringify(layout)}`
  );

  await page.close();
}

async function testTranslationInheritsInsertionTargetSlot(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <style>custom-card { display: block; }</style>
      <main>
        <custom-card>
          <p slot="body">This slotted paragraph has enough English words to be picked as a candidate.</p>
        </custom-card>
      </main>
    `
  });

  await runTranslation(page);

  const slot = await page.evaluate(() => {
    const target = document.querySelector("custom-card p[slot='body']");
    return target?.nextElementSibling?.classList.contains("llm-bilingual-translation")
      ? target.nextElementSibling.getAttribute("slot")
      : null;
  });
  assert.strictEqual(slot, "body", "译文节点应继承插入目标的 slot 属性");

  await page.close();
}

async function testRedditTextBodyUsesSafeTranslationAnchor(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 2,
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
  const requested = result.requestedTexts.join("\n");

  assert.strictEqual(result.requestCount, 2);
  assert.match(requested, /17\.5-day run/);
  assert.match(requested, /Codex appreciation post/);
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

async function testClippedRedditPreviewUsesSingleSafeTranslationUnit(browser) {
  const paragraphs = Array.from({ length: 6 }, (_, index) => `
    <p>
      Preview paragraph ${index + 1} explains a long model comparison with enough English words to exceed the configured
      per-element limit while Reddit keeps most of the post hidden inside its compact feed card.
    </p>
  `).join("");

  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 8,
    maxTextLength: 320,
    bodyStyle: "font:18px Arial;padding:24px",
    html: `
      <style>
        shreddit-post, shreddit-post-text-body { display: block; width: 620px; }
        .feed-card-text-preview { display: flow-root; max-height: 96px; overflow: hidden; }
        .feed-card-text-preview p { display: inline; margin: 0; }
      </style>
      <main>
        <shreddit-post post-type="text" post-language="en">
          <shreddit-post-text-body slot="text-body">
            <a href="/r/codex/comments/clipped" class="pointer-events-none" slot="text-body">
              <div data-post-click-location="text-body">
                <div id="clipped-preview" class="md feed-card-text-preview" property="schema:articleBody">
                  ${paragraphs}
                </div>
              </div>
            </a>
          </shreddit-post-text-body>
        </shreddit-post>
      </main>
    `
  });

  const result = await runTranslation(page);
  const layout = await page.evaluate(() => ({
    insidePreview: document.querySelectorAll("#clipped-preview .llm-bilingual-translation").length,
    insideLink: document.querySelectorAll("a[slot='text-body'] .llm-bilingual-translation").length,
    safeBodyTranslations: document.querySelectorAll("shreddit-post-text-body > .llm-bilingual-translation").length
  }));

  assert.strictEqual(result.requestCount, 1, "A clipped Reddit preview should be one bounded translation unit.");
  assert.ok(result.requestedTexts[0].length <= 320, "The clipped preview request must honor maxTextLength.");
  assert.strictEqual(layout.insidePreview, 0);
  assert.strictEqual(layout.insideLink, 0);
  assert.strictEqual(layout.safeBodyTranslations, 1);

  await page.close();
}

async function testLongRedditTextBodyFallsBackToParagraphs(browser) {
  const paragraphs = Array.from({ length: 12 }, (_, index) => `
    <p id="long-post-paragraph-${index + 1}">
      Paragraph ${index + 1} describes an expensive local language model workstation with many GPUs,
      unusual cooling decisions, power supply changes, and enough English prose to be a useful
      translation candidate on its own without translating the entire Reddit post body at once.
    </p>
  `).join("");

  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 8,
    bodyStyle: "font:18px Arial;padding:24px",
    html: `
      <style>
        shreddit-post, shreddit-post-text-body { display: block; }
        shreddit-post-text-body p { margin: 0 0 12px; }
      </style>
      <main>
        <shreddit-post post-type="text" post-language="en">
          <a slot="title" href="/r/LocalLLaMA/comments/example">GLM5.2 on 5x Pro 6000s and a 5090, an expensive journey</a>
          <shreddit-post-text-body slot="text-body">
            <div property="schema:articleBody">${paragraphs}</div>
          </shreddit-post-text-body>
        </shreddit-post>
      </main>
    `
  });

  const result = await runTranslation(page);
  const layout = await page.evaluate(() => {
    const textBody = document.querySelector("shreddit-post-text-body");
    return {
      textBodyStatus: textBody?.dataset.llmTranslatorStatus || "",
      paragraphStatuses: Array.from(textBody.querySelectorAll("p"))
        .map((paragraph) => paragraph.dataset.llmTranslatorStatus || ""),
      translationCountInsideTextBody: textBody.querySelectorAll(".llm-bilingual-translation.is-done").length
    };
  });

  assert.strictEqual(layout.textBodyStatus, "", "Oversized Reddit post body should not be translated as one block.");
  assert.ok(layout.paragraphStatuses.filter((status) => status === "done").length >= 2);
  assert.ok(layout.translationCountInsideTextBody >= 2);
  assert.ok(result.requestedTexts.every((text) => text.length < 1600));
  assert.ok(result.requestedTexts.some((text) => /Paragraph 1 describes/.test(text)));

  await page.close();
}

async function testLongRedditThreadDoesNotFullWalkComments(browser) {
  const comments = Array.from({ length: 1200 }, (_, index) => `
    <shreddit-comment depth="0" thingid="t1_${index + 1}">
      <div slot="comment" class="md">
        <p>Comment ${index + 1} explains how the Codex plan behaved during a long coding session with many files and repeated updates.</p>
        <p>The author describes waiting for results, reviewing code changes, and comparing performance across several days of usage.</p>
      </div>
    </shreddit-comment>
  `).join("");

  const page = await createHarnessPage(browser, {
    batchSize: 100,
    countLayoutReads: true,
    countTreeWalker: true,
    html: `
      <style>
        shreddit-post, shreddit-post-text-body, shreddit-comment { display: block; }
        shreddit-comment { padding: 12px 0; border-bottom: 1px solid #ddd; }
      </style>
      <main>
        <shreddit-post post-type="text" post-language="en">
          <a slot="title" href="/r/codex/comments/example">This is what a long Codex plan looked like after many days of usage</a>
          <shreddit-post-text-body slot="text-body">
            <div property="schema:articleBody">
              <p>The original post includes a detailed report about long-running Codex usage, costs, and observed delays while translating dense pages.</p>
            </div>
          </shreddit-post-text-body>
        </shreddit-post>
        <section id="comments">${comments}</section>
      </main>
    `
  });

  const result = await page.evaluate(async () => {
    const response = await window.__sendContentMessage({ action: "scan_current_area" });
    await new Promise((resolve) => setTimeout(resolve, 250));
    return {
      count: response.count,
      feedbackCount: document.querySelectorAll(".llm-bilingual-translation.is-loading, .llm-bilingual-translation.is-streaming, .llm-bilingual-translation.is-done").length,
      rectCalls: window.__rectCalls,
      treeWalkerNextCalls: window.__treeWalkerNextCalls
    };
  });

  assert.ok(result.count > 0);
  assert.ok(result.feedbackCount > 0);
  assert.ok(result.rectCalls < 900, "Viewport scans should not measure every Reddit comment paragraph.");
  assert.ok(result.treeWalkerNextCalls < 120, "Viewport scans should not walk every Reddit comment text node.");

  await page.close();
}

async function testTranslatedViewportScrollScanDoesNotFullWalk(browser) {
  const comments = Array.from({ length: 800 }, (_, index) => `
    <shreddit-comment depth="0" thingid="t1_${index + 1}">
      <div slot="comment" class="md">
        <p>Comment ${index + 1} explains how the Codex plan behaved during a long coding session with many files.</p>
      </div>
    </shreddit-comment>
  `).join("");

  const page = await createHarnessPage(browser, {
    batchSize: 100,
    countLayoutReads: true,
    countTreeWalker: true,
    html: `
      <style>
        shreddit-post, shreddit-post-text-body, shreddit-comment { display: block; }
        shreddit-comment { padding: 12px 0; border-bottom: 1px solid #ddd; }
      </style>
      <main>
        <shreddit-post post-type="text" post-language="en">
          <a slot="title" href="/r/codex/comments/example">This is what a long Codex plan looked like after many days of usage</a>
          <shreddit-post-text-body slot="text-body">
            <div property="schema:articleBody">
              <p>The original post includes a detailed report about long-running Codex usage and observed delays.</p>
            </div>
          </shreddit-post-text-body>
        </shreddit-post>
        <section id="comments">${comments}</section>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    window.__treeWalkerNextCalls = 0;
    window.__rectCalls = 0;
    window.scrollBy(0, 40);
    await new Promise((resolve) => setTimeout(resolve, 700));
    return {
      treeWalkerNextCalls: window.__treeWalkerNextCalls,
      rectCalls: window.__rectCalls
    };
  });

  assert.strictEqual(
    result.treeWalkerNextCalls,
    0,
    `已翻译视口的滚动扫描不允许回退到全页 TreeWalker，实际 ${result.treeWalkerNextCalls} 次`
  );
  assert.ok(result.rectCalls < 400, `滚动扫描布局读取应有界，实际 ${result.rectCalls} 次`);

  await page.close();
}

async function testProcessedSampledBlockDoesNotBlockViewportFallback(browser) {
  const page = await createHarnessPage(browser, {
    deferIntersectionObserver: true,
    maxElementsPerScan: 1,
    bodyStyle: "font:20px Arial;margin:0",
    html: `
      <main style="position:relative;width:1000px;height:1500px">
        <p id="sampled-done" style="box-sizing:border-box;width:640px;min-height:1300px;margin:0 auto;padding-top:24px">
          This wide paragraph is translated first and still covers the viewport sample points after a small scroll.
        </p>
        <p id="missed-current" style="position:absolute;left:12px;top:850px;width:150px;margin:0">
          This narrow visible paragraph sits away from the sample columns and still needs translation after scrolling.
        </p>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForFunction(() => document.querySelector("#sampled-done[data-llm-translator-status='done']"));

  await page.evaluate(() => window.scrollTo(0, 220));
  await page.waitForTimeout(700);

  const result = await page.evaluate(() => ({
    sampledStatus: document.getElementById("sampled-done")?.dataset.llmTranslatorStatus || "",
    missedStatus: document.getElementById("missed-current")?.dataset.llmTranslatorStatus || "",
    requestedTexts: window.__mockItems
  }));

  assert.strictEqual(result.sampledStatus, "done");
  assert.strictEqual(
    result.missedStatus,
    "done",
    "A processed sampled block should not prevent selector fallback from finding an unsampled visible paragraph."
  );
  assert.ok(result.requestedTexts.some((text) => /narrow visible paragraph/.test(text)));

  await page.close();
}

async function testScanExtractsEachCandidateTextOnce(browser) {
  const paragraphs = Array.from({ length: 24 }, (_, index) => `
    <p>
      <span>Paragraph ${index + 1}</span>
      <span>contains enough English words</span>
      <span>to qualify as a translation candidate</span>
      <span>for the scan and batching pipeline.</span>
    </p>
  `).join("");

  const page = await createHarnessPage(browser, {
    countStyleReads: true,
    maxElementsPerScan: 24,
    html: `<main><article>${paragraphs}</article></main>`
  });

  const styleCalls = await page.evaluate(async () => {
    await window.__sendContentMessage({ action: "scan_current_area" });
    return window.__styleCalls;
  });
  assert.ok(styleCalls < 2200, `一次扫描的样式读取应有界（文本提取去重后），实际 ${styleCalls} 次`);

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

async function testHackerNewsStoryTitlesReceiveTranslations(browser) {
  const page = await createHarnessPage(browser, {
    maxElementsPerScan: 4,
    html: `
      <center>
        <table id="hnmain">
          <tbody>
            <tr class="athing" id="story-1">
              <td class="title" align="right"><span class="rank">1.</span></td>
              <td class="votelinks"></td>
              <td class="title">
                <span class="titleline">
                  <a href="https://example.com/open-source-low-tech">Open Source Low Tech</a>
                  <span class="sitebit comhead"> (example.com)</span>
                </span>
              </td>
            </tr>
            <tr>
              <td colspan="2"></td>
              <td class="subtext">143 points by grep_it 4 hours ago | hide | 29 comments</td>
            </tr>
            <tr class="athing" id="story-2">
              <td class="title" align="right"><span class="rank">2.</span></td>
              <td class="votelinks"></td>
              <td class="title">
                <span class="titleline">
                  <a href="https://example.com/qwen">Qwen 3.6 27B is the sweet spot for local development</a>
                  <span class="sitebit comhead"> (example.com)</span>
                </span>
              </td>
            </tr>
            <tr>
              <td colspan="2"></td>
              <td class="subtext">85 points by localdev 2 hours ago | hide | 14 comments</td>
            </tr>
          </tbody>
        </table>
      </center>
    `
  });

  const result = await runTranslation(page);
  const requested = result.requestedTexts.join("\n");

  assert.match(requested, /Open Source Low Tech/);
  assert.match(requested, /Qwen 3\.6 27B is the sweet spot/);
  assert.doesNotMatch(requested, /143 points by/);
  assert.strictEqual(await page.locator("#hnmain .subtext .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("#hnmain td.title > .titleline + .llm-bilingual-translation").count(), 2);
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
        <nav class="vector-appearance-landmark">
          <div id="vector-appearance-pinned-container" class="vector-pinned-container">
            <div id="vector-appearance" class="vector-appearance vector-pinnable-element">
              <div class="vector-pinnable-header vector-appearance-pinnable-header vector-pinnable-header-pinned">
                <h2>Appearance</h2>
              </div>
              <fieldset>
                <legend>Text</legend>
                <label>Small</label>
                <label>Standard</label>
                <label>Large</label>
              </fieldset>
            </div>
          </div>
        </nav>
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
  assert.doesNotMatch(requested, /Appearance/);
  assert.strictEqual(await page.locator("table.sidebar .llm-bilingual-translation").count(), 0);
  assert.strictEqual(await page.locator("#vector-appearance .llm-bilingual-translation").count(), 0);
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

async function testPageLanguageModeSkipsTargetLanguageTweets(browser) {
  // 复现 X 混排时间线：目标语言 zh，页面 lang=en，中文推文里夹杂 GPT/work 等拉丁词。
  const page = await createHarnessPage(browser, {
    htmlLang: "en",
    html: `
      <main>
        <article>
          <div data-testid="tweetText">how much reverse engineering are we talking about in this long system design thread</div>
        </article>
        <article>
          <div data-testid="tweetText">卡神，这个网页版的 GPT 来的是 work 模式还是 chat 模式？如果是 work 模式的话是不是跟 codex 共用一个额度池了啊？</div>
        </article>
      </main>
    `
  });

  const result = await runTranslation(page);

  assert.strictEqual(
    result.requestCount,
    1,
    `only the English tweet should be translated, requested: ${JSON.stringify(result.requestedTexts)}`
  );
  assert.match(result.requestedTexts[0], /reverse engineering/);

  const chineseTweetHasTranslation = await page.evaluate(() => {
    const articles = document.querySelectorAll("article");
    return !!articles[1].querySelector(".llm-bilingual-translation")
      || !!articles[1].nextElementSibling?.classList?.contains("llm-bilingual-translation");
  });
  assert.strictEqual(chineseTweetHasTranslation, false, "Chinese tweet must not receive a translation node");
  await page.close();
}

async function testTranslationNodeStaysStableWhenClipStateChangesMidStream(browser) {
  // 复现 X 流式翻译期间布局变化：loading 时未裁剪，done 前祖先变为 overflow 裁剪，
  // 插入锚点从元素自身漂移到裁剪祖先，旧实现会插入第二个译文节点。
  const page = await createHarnessPage(browser, {
    translateDelayMs: 400,
    html: `
      <main>
        <article>
          <div id="clip-wrap">
            <div data-testid="tweetText">The quoted status keeps its translation attached to the same anchor even when layout clipping changes during streaming.</div>
          </div>
        </article>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const wrap = document.getElementById("clip-wrap");
    wrap.style.maxHeight = "24px";
    wrap.style.overflow = "hidden";
  });
  await page.waitForTimeout(900);

  const summary = await page.evaluate(() => ({
    total: document.querySelectorAll(".llm-bilingual-translation").length,
    done: document.querySelectorAll(".llm-bilingual-translation.is-done").length
  }));
  assert.strictEqual(summary.total, 1, `expected a single translation node, got ${summary.total}`);
  assert.strictEqual(summary.done, 1, "the single node should reach done state");
  await page.close();
}

async function testReRenderedTweetDoesNotDuplicateTranslation(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <article id="tweet-article">
          <div data-testid="tweetText">how much reverse engineering are we talking about in this system design thread</div>
        </article>
      </main>
    `
  });

  const first = await runTranslation(page);
  assert.strictEqual(first.requestCount, 1);

  // 模拟 X/React 重渲染：正文元素被替换（丢失 data-llm-translator-* 标记）且位置变化，
  // 译文节点存活在原位但不再紧邻新元素。
  await page.evaluate(() => {
    const article = document.getElementById("tweet-article");
    const old = article.querySelector("[data-testid=\"tweetText\"]");
    const fresh = document.createElement("div");
    fresh.setAttribute("data-testid", "tweetText");
    fresh.textContent = old.textContent;
    article.appendChild(fresh);
    old.remove();
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(1200);

  const summary = await page.evaluate(() => ({
    requestCount: window.__mockItems.length,
    nodes: document.getElementById("tweet-article").querySelectorAll(".llm-bilingual-translation").length
  }));
  assert.strictEqual(summary.nodes, 1, `expected 1 translation node after re-render, got ${summary.nodes}`);
  assert.strictEqual(summary.requestCount, 1, "re-rendered identical tweet must not trigger a second request");
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

async function testDynamicContentTranslatesDuringContinuousMutations(browser) {
  const page = await createHarnessPage(browser, {
    translateDelayMs: 1200,
    html: `
      <main>
        <article id="feed"></article>
        <div id="noisy-state"></div>
      </main>
    `
  });

  await page.evaluate(async () => {
    await window.__sendContentMessage({
      action: "start_translation",
      settings: window.__mockSettings
    });
  });

  await page.waitForTimeout(120);

  await page.evaluate(() => {
    const paragraph = document.createElement("p");
    paragraph.textContent = "A dynamically loaded Reddit comment should start translating while the page keeps updating nearby UI state.";
    document.querySelector("#feed").appendChild(paragraph);

    const noisy = document.querySelector("#noisy-state");
    window.__dynamicMutationInterval = window.setInterval(() => {
      noisy.className = `state-${Date.now()}`;
    }, 80);
  });

  await page.waitForTimeout(720);
  const result = await page.evaluate(() => ({
    feedbackCount: document.querySelectorAll(".llm-bilingual-translation.is-loading, .llm-bilingual-translation.is-streaming, .llm-bilingual-translation.is-done").length,
    requestCount: window.__mockItems.length
  }));

  await page.evaluate(() => window.clearInterval(window.__dynamicMutationInterval));

  assert.ok(
    result.feedbackCount >= 1,
    `连续 DOM 变化时动态内容仍应及时出现翻译反馈，实际 feedback=${result.feedbackCount}, requests=${result.requestCount}`
  );

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

async function testViewportBufferPrefetchesNextScreenBeforeScroll(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main style="position: relative; height: 1900px;">
        <p id="visible-story" style="position: absolute; top: 40px; margin: 0;">
          This visible paragraph should keep the highest translation priority.
        </p>
        <p id="prefetched-story" style="position: absolute; top: 1450px; margin: 0;">
          This next-screen paragraph should be translated before the reader scrolls down.
        </p>
      </main>
    `
  });

  const result = await runTranslation(page);
  const prefetchState = await page.evaluate(() => ({
    scrollY: window.scrollY,
    translated: document.querySelector("#prefetched-story + .llm-bilingual-translation")
      ?.classList.contains("is-done") === true
  }));

  assert.strictEqual(prefetchState.scrollY, 0);
  assert.strictEqual(prefetchState.translated, true, "next-screen content should be prefetched before scrolling");
  assert.ok(result.requestedTexts.some((text) => text.includes("next-screen paragraph")));

  await page.close();
}

async function testManualTranslationShowsLoadingPlaceholderImmediately(browser) {
  const page = await createHarnessPage(browser, {
    batchSize: 4,
    translateDelayMs: 1200,
    html: `
      <main>
        <article>
          <p>Users should see a loading placeholder immediately after manually starting translation.</p>
        </article>
      </main>
    `
  });

  const stateAfterStart = await page.evaluate(async () => {
    const response = await window.__sendContentMessage({ action: "scan_current_area" });
    return {
      count: response.count,
      loadingCount: document.querySelectorAll(".llm-bilingual-translation.is-loading, .llm-bilingual-translation.is-streaming").length,
      requestCount: window.__mockItems.length
    };
  });

  assert.strictEqual(stateAfterStart.count, 1);
  assert.strictEqual(stateAfterStart.loadingCount, 1, "Manual start should render loading feedback before the batch request flushes.");
  assert.strictEqual(stateAfterStart.requestCount, 1, "The first stream request should start immediately after the placeholder appears.");

  await page.close();
}

async function testManualCurrentAreaUsesProvidedSettingsForImmediatePlaceholder(browser) {
  const page = await createHarnessPage(browser, {
    batchSize: 4,
    settingsDelayMs: 900,
    translateDelayMs: 1200,
    html: `
      <main>
        <article>
          <p>Users should not wait for a repeated settings lookup before seeing loading feedback.</p>
        </article>
      </main>
    `
  });

  const stateAfterStart = await page.evaluate(async () => {
    const responsePromise = window.__sendContentMessage({
      action: "scan_current_area",
      settings: window.__mockSettings
    });
    await new Promise((resolve) => setTimeout(resolve, 120));
    const interim = {
      loadingCount: document.querySelectorAll(".llm-bilingual-translation.is-loading, .llm-bilingual-translation.is-streaming").length,
      getSettingsMessages: window.__runtimeMessages.filter((message) => message.action === "get_settings").length,
      requestCount: window.__mockItems.length
    };
    const response = await responsePromise;
    return { ...interim, count: response.count };
  });

  assert.strictEqual(stateAfterStart.count, 1);
  assert.strictEqual(stateAfterStart.loadingCount, 1, "Provided settings should allow current-area loading feedback without another settings round trip.");
  assert.strictEqual(stateAfterStart.getSettingsMessages, 0, "Current-area scan should reuse settings passed by the background script.");
  assert.strictEqual(stateAfterStart.requestCount, 1, "Provided settings should allow the stream request to start without another settings lookup.");

  await page.close();
}

async function testStreamingTranslationUpdatesBeforeResponseCompletes(browser) {
  const page = await createHarnessPage(browser, {
    translateDelayMs: 800,
    html: `
      <main>
        <p>The first visible paragraph should appear while the SSE response is still open.</p>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(180);

  const partialState = await page.evaluate(() => {
    const node = document.querySelector(".llm-bilingual-translation");
    return {
      className: node?.className || "",
      text: node?.textContent || "",
      done: !!node?.classList.contains("is-done"),
      batchMessages: window.__runtimeMessages.filter((message) => message.action === "translate_batch").length
    };
  });

  assert.match(partialState.className, /is-streaming/);
  assert.match(partialState.text, /测试译文/);
  assert.strictEqual(partialState.done, false);
  assert.strictEqual(partialState.batchMessages, 0);

  await page.waitForFunction(() => document.querySelector(".llm-bilingual-translation")?.classList.contains("is-done"));
  await page.close();
}

async function testManualTriggerFlushesFirstBatchQuickly(browser) {
  const page = await createHarnessPage(browser, {
    html: `
      <main>
        <p>The first paragraph has enough English words to be translated by the extension.</p>
        <p>The second paragraph also has enough English words to become a candidate.</p>
      </main>
    `
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(450);

  const doneCount = await page.evaluate(
    () => document.querySelectorAll(".llm-bilingual-translation.is-done").length
  );
  assert.ok(doneCount >= 1, `手动触发 450ms 内应已出现译文，实际 done=${doneCount}`);

  await page.close();
}

async function testHtmlLangFastPathTrustsDeclaredForeignLanguage(browser) {
  const page = await createHarnessPage(browser, {
    htmlLang: "en-US",
    html: `
      <main>
        <p>这是一段足够长的中文正文，用来验证语言检测的快速路径会优先信任页面声明的语言属性。</p>
        <p>第二段中文正文继续增加目标语言字符数量，让旧版采样逻辑稳定地判定这是目标语言页面。</p>
        <p>第三段中文正文保证目标语言片段数达到旧版判定阈值，从而让本测试在修复前必然失败。</p>
      </main>
    `
  });

  const response = await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  assert.strictEqual(response.ok, true);
  assert.notStrictEqual(response.skipped, true, "lang=en 页面不应被判为目标语言页而跳过");

  await page.close();
}

async function testStoppingTranslationClearsImmediateLoadingPlaceholder(browser) {
  const page = await createHarnessPage(browser, {
    batchSize: 4,
    translateDelayMs: 1200,
    html: `
      <main>
        <article>
          <p id="pending">Stopping quickly should remove the immediate loading placeholder.</p>
        </article>
      </main>
    `
  });

  await page.evaluate(async () => {
    await window.__sendContentMessage({ action: "scan_current_area" });
    await window.__sendContentMessage({ action: "stop_translation" });
  });

  const stoppedState = await page.evaluate(() => ({
    loadingCount: document.querySelectorAll(".llm-bilingual-translation.is-loading").length,
    status: document.getElementById("pending").dataset.llmTranslatorStatus || ""
  }));

  assert.strictEqual(stoppedState.loadingCount, 0);
  assert.strictEqual(stoppedState.status, "");

  await page.close();
}

async function testStreamingTranslationsUseLimitedConcurrency(browser) {
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

  const maxConcurrent = await page.evaluate(() => window.__maxConcurrentStreamRequests);
  assert.strictEqual(maxConcurrent, 2, "Plain-text stream requests should use the configured small concurrency.");
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

  if (options.countTreeWalker) {
    await page.evaluate(() => {
      window.__treeWalkerCalls = 0;
      window.__treeWalkerNextCalls = 0;
      const originalCreateTreeWalker = document.createTreeWalker.bind(document);
      document.createTreeWalker = (...args) => {
        window.__treeWalkerCalls += 1;
        const walker = originalCreateTreeWalker(...args);
        const originalNextNode = walker.nextNode.bind(walker);
        walker.nextNode = () => {
          window.__treeWalkerNextCalls += 1;
          return originalNextNode();
        };
        return walker;
      };
    });
  }

  if (options.countLayoutReads) {
    await page.evaluate(() => {
      window.__rectCalls = 0;
      const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function (...args) {
        window.__rectCalls += 1;
        return originalGetBoundingClientRect.apply(this, args);
      };
    });
  }

  if (options.countStyleReads) {
    await page.evaluate(() => {
      window.__styleCalls = 0;
      const originalGetComputedStyle = window.getComputedStyle.bind(window);
      window.getComputedStyle = (...args) => {
        window.__styleCalls += 1;
        return originalGetComputedStyle(...args);
      };
    });
  }

  await page.evaluate(({ settings, settingsDelayMs, translateDelayMs, failFirstTranslate }) => {
    const listeners = [];

    window.__mockSettings = settings;
    window.__mockItems = [];
    window.__runtimeMessages = [];
    window.__storageGetCalls = [];
    window.__inflightTranslateBatches = 0;
    window.__maxConcurrentTranslateBatches = 0;
    window.__mockTranslateBatchSizes = [];
    window.__mockTranslateFailuresRemaining = failFirstTranslate ? 1 : 0;
    window.__streamRequests = [];
    window.__inflightStreamRequests = 0;
    window.__maxConcurrentStreamRequests = 0;
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
        connect({ name } = {}) {
          const messageListeners = [];
          const disconnectListeners = [];
          const pending = new Map();
          let disconnected = false;

          const emit = (message) => {
            if (disconnected) return;
            messageListeners.forEach((listener) => listener(message));
          };

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
              if (disconnected) throw new Error("Port is disconnected.");
              if (message.type === "cancel") {
                const timers = pending.get(message.requestId) || [];
                timers.forEach((timer) => clearTimeout(timer));
                if (pending.delete(message.requestId)) {
                  window.__inflightStreamRequests = Math.max(0, window.__inflightStreamRequests - 1);
                }
                return;
              }
              if (message.type !== "translate") return;

              const item = message.item || {};
              window.__streamRequests.push(message);
              window.__mockItems.push(String(item.text || ""));
              window.__mockTranslateBatchSizes.push(1);
              window.__inflightStreamRequests += 1;
              window.__maxConcurrentStreamRequests = Math.max(
                window.__maxConcurrentStreamRequests,
                window.__inflightStreamRequests
              );

              const translation = `测试译文：${String(item.text || "").slice(0, 80)}`;
              const firstDelta = translation.slice(0, Math.max(1, Math.min(5, translation.length)));
              const secondDelta = translation.slice(firstDelta.length);
              const firstDelay = translateDelayMs > 0 ? Math.min(60, Math.max(10, Math.floor(translateDelayMs / 4))) : 0;
              const completeDelay = translateDelayMs > 0 ? translateDelayMs : 0;
              const timers = [];
              timers.push(setTimeout(() => {
                emit({
                  type: "delta",
                  requestId: message.requestId,
                  runId: message.runId,
                  id: item.id,
                  delta: firstDelta,
                  text: firstDelta
                });
              }, firstDelay));
              timers.push(setTimeout(() => {
                if (window.__mockTranslateFailuresRemaining > 0) {
                  window.__mockTranslateFailuresRemaining -= 1;
                  emit({
                    type: "error",
                    requestId: message.requestId,
                    runId: message.runId,
                    id: item.id,
                    error: "Mock translation failure."
                  });
                } else {
                  if (secondDelta) {
                    emit({
                      type: "delta",
                      requestId: message.requestId,
                      runId: message.runId,
                      id: item.id,
                      delta: secondDelta,
                      text: translation
                    });
                  }
                  emit({
                    type: "done",
                    requestId: message.requestId,
                    runId: message.runId,
                    id: item.id,
                    text: translation,
                    streamed: true,
                    fallback: false
                  });
                }
                pending.delete(message.requestId);
                window.__inflightStreamRequests = Math.max(0, window.__inflightStreamRequests - 1);
              }, completeDelay));
              pending.set(message.requestId, timers);
            },
            disconnect() {
              if (disconnected) return;
              disconnected = true;
              pending.forEach((timers) => timers.forEach((timer) => clearTimeout(timer)));
              pending.clear();
              window.__inflightStreamRequests = 0;
              disconnectListeners.forEach((listener) => listener());
            }
          };
        },
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
            if (settingsDelayMs > 0) {
              await new Promise((resolve) => setTimeout(resolve, settingsDelayMs));
            }
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
      maxTextLength: options.maxTextLength ?? 1600,
      maxRequestsPerPage: options.maxRequestsPerPage ?? 80,
      maxCharsPerPage: options.maxCharsPerPage ?? 60000,
      maxCharsPerBatch: options.maxCharsPerBatch ?? 6000,
      maxConcurrentBatches: options.maxConcurrentBatches ?? 2,
      maxCacheEntries: options.maxCacheEntries ?? 2000,
      autoTranslate: options.autoTranslate === true,
      displayMode: options.displayMode || "bilingual",
      viewportOnly: true
    },
    settingsDelayMs: options.settingsDelayMs || 0,
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

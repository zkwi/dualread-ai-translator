const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const extensionDir = path.resolve(__dirname, "..");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    await testPopupDisablesVisibilityWithoutTranslations(browser);
    await testPopupShowsBrandAndConfigNotice(browser);
    await testPopupShowsProviderAndModelSummary(browser);
    await testPopupShowsThinkingStrategySummary(browser);
    await testPopupActionTitlesExplainEnabledActions(browser);
    await testPopupClearRequiresConfirm(browser);
    await testPopupShowsAutoSkipNotice(browser);
    await testPopupShowsAutoUnconfiguredNotice(browser);
    await testPopupAutoToggleSavesAndTriggersCurrentTab(browser);
    await testPopupActionFailureRestoresStoredState(browser);
    await testPopupInitFailureShowsRecoverableState(browser);
    await testPopupUnknownInitFailureShowsReadableMessage(browser);
    await testPopupEnglishLayoutDoesNotOverflow(browser);
    await testPopupLocalizedLayoutsDoNotOverflow(browser);
    await testPopupKeepsStableChromePopupWidth(browser);
    await testPopupPrimaryButtonsShowPendingText(browser);
    await testPopupDisplayModeToggleSavesAndApplies(browser);
    await testPopupExplainsUnsupportedPages(browser);
    await testOptionsDisablesTestButtonWhilePending(browser);
    await testOptionsActionsKeepTestApiPrimary(browser);
    await testUiDefinesKeyboardFocusStyles(browser);
    await testOptionsSetupStatusGuidesConnection(browser);
    await testOptionsLoadFailureShowsDefaultsAndError(browser);
    await testOptionsSetupStatusShowsApiFailure(browser);
    await testOptionsEnterRunsApiTestWhenReady(browser);
    await testOptionsTestApiSavesSettingsBeforeRequest(browser);
    await testOptionsApiExceptionShowsFailureState(browser);
    await testOptionsUnknownApiExceptionShowsReadableMessage(browser);
    await testOptionsApiSuccessMessageIsCompact(browser);
    await testOptionsChangeEventSavesApiKey(browser);
    await testOptionsProviderPresetUpdatesConnection(browser);
    await testOptionsHelpTextUpdates(browser);
    await testOptionsProviderThinkingHints(browser);
    await testOptionsTimeoutUsesSeconds(browser);
    await testOptionsCanRevealAndHideApiKey(browser);
    await testOptionsDestructiveActionsRequireConfirm(browser);
    await testOptionsLanguagePresetSaves(browser);
    await testOptionsLanguagePresetButtons(browser);
    await testOptionsLanguageStatusWarnsOnSameLanguage(browser);
    await testOptionsUiLanguageIsIndependent(browser);
    await testOptionsEnglishMicrocopyIsUserFacing(browser);
    await testOptionsLayoutDoesNotOverflow(browser);
    await testOptionsCostProfileUpdatesAdvancedDefaults(browser);
    await testOptionsDisplayModeAutoSaves(browser);
    await testOptionsAdvancedSettingsCanExpand(browser);
    await testOptionsPagehideFlushesPendingApiKey(browser);
    await testOptionsSavesCustomTranslationPrompt(browser);
    await testOptionsResetPromptRequiresConfirm(browser);
    await testOptionsAutoSavesChangedSettings(browser);
  } finally {
    await browser.close();
  }

  console.log("ui fixture tests passed");
}

async function testPopupDisablesVisibilityWithoutTranslations(browser) {
  const page = await createPopupPage(browser, {
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("visibility").disabled === true);
  assert.strictEqual(await page.locator("#visibility").getAttribute("title"), "当前页面还没有译文。");
  assert.strictEqual(await page.locator("#clear").getAttribute("title"), "当前页面还没有译文。");
  await page.close();
}

async function testPopupShowsBrandAndConfigNotice(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      apiKey: "",
      model: "test-model"
    },
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.querySelector("h1").textContent.includes("DualRead AI"));
  await page.waitForFunction(() => document.getElementById("configNotice").hidden === false);
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("还不能翻译"));
  assert.strictEqual(await page.locator("#toggle").isDisabled(), true);
  assert.strictEqual(await page.locator("#scan").isDisabled(), true);
  assert.strictEqual(await page.locator("#autoTranslateToggle").isDisabled(), true);
  assert.strictEqual(await page.locator(".switch-row").evaluate((node) => node.classList.contains("is-disabled")), true);
  await page.close();
}

async function testPopupShowsProviderAndModelSummary(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      provider: "deepseek",
      apiKey: "saved-key",
      model: "deepseek-chat"
    },
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("configStatus").textContent.includes("DeepSeek"));
  await page.waitForFunction(() => document.getElementById("configStatus").textContent.includes("deepseek-chat"));
  assert.match(await page.locator("#configStatus").getAttribute("title"), /DeepSeek.*deepseek-chat/);
  await page.close();
}

async function testPopupShowsThinkingStrategySummary(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      provider: "custom",
      apiKey: "saved-key",
      apiUrl: "https://opencode.example/v1/chat/completions",
      model: "deepseek-v4-flash",
      disableThinking: true,
      thinkingStrategy: "auto"
    },
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("thinkingSummary").textContent.includes("thinking.type=disabled"));
  assert.strictEqual(await page.locator(".summary-wide").isVisible(), true);
  await page.close();

  const disabledPage = await createPopupPage(browser, {
    settings: {
      apiKey: "saved-key",
      model: "test-model",
      disableThinking: false
    },
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await disabledPage.waitForFunction(() => document.getElementById("thinkingSummary").textContent.includes("不控制思考"));
  await disabledPage.close();
}

async function testPopupActionTitlesExplainEnabledActions(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      apiKey: "saved-key",
      model: "test-model"
    },
    pageStats: {
      ok: true,
      active: true,
      stats: { translated: 2, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("toggle").textContent === "停止翻译");
  assert.match(await page.locator("#toggle").getAttribute("title"), /停止继续翻译/);
  assert.match(await page.locator("#scan").getAttribute("title"), /当前可视区域/);
  assert.match(await page.locator("#visibility").getAttribute("title"), /临时隐藏/);
  assert.match(await page.locator("#clear").getAttribute("title"), /本地缓存不会被清空/);
  assert.match(await page.locator("#autoTranslateToggle").getAttribute("title"), /全局开关/);
  await page.close();
}

async function testPopupClearRequiresConfirm(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      apiKey: "saved-key",
      model: "test-model"
    },
    pageStats: {
      ok: true,
      active: true,
      stats: { translated: 2, failed: 0, translationVisible: true }
    }
  });

  await page.evaluate(() => {
    window.__confirmResult = false;
  });
  await page.click("#clear");
  assert.strictEqual(await page.evaluate(() => window.__confirmCalls.length), 1);
  assert.strictEqual(await page.evaluate(() => window.__runtimeMessages.some((message) => message.action === "clear_translation")), false);

  await page.evaluate(() => {
    window.__confirmResult = true;
  });
  await page.click("#clear");
  await page.waitForFunction(() => window.__runtimeMessages.some((message) => message.action === "clear_translation"));
  await page.close();
}

async function testPopupShowsAutoUnconfiguredNotice(browser) {
  const page = await createPopupPage(browser, {
    pageStats: {
      ok: true,
      active: false,
      notice: { reason: "unconfigured" },
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("status").textContent.includes("API Key"));
  await page.close();
}

async function testPopupShowsAutoSkipNotice(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      apiKey: "saved-key",
      model: "test-model"
    },
    pageStats: {
      ok: true,
      active: false,
      notice: { reason: "target-language" },
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("status").textContent.includes("目标语言"));
  await page.close();
}

async function testPopupAutoToggleSavesAndTriggersCurrentTab(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      autoTranslate: false,
      apiKey: "saved-key",
      model: "test-model"
    },
    autoTranslateResponse: {
      ok: true,
      active: true,
      content: { ok: true, count: 2 }
    },
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("configStatus").textContent.includes("已关闭"));
  await page.click("#autoTranslateToggle");

  await page.waitForFunction(() => window.__storageUpdates?.some((updates) => updates.autoTranslate === true));
  await page.waitForFunction(() => window.__runtimeMessages?.some((message) => message.action === "auto_translate_tab"));

  const status = await page.locator("#status").textContent();
  assert.match(status, /已开启|发现 2 个候选/);
  await page.close();
}

async function testPopupActionFailureRestoresStoredState(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      autoTranslate: false,
      apiKey: "saved-key",
      model: "test-model"
    },
    storageSetError: "Mock storage failure",
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("autoTranslateToggle").checked === false);
  await page.click("#autoTranslateToggle");
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("Mock storage failure"));

  assert.match(await page.locator("#status").textContent(), /操作失败/);
  assert.strictEqual(await page.locator("#autoTranslateToggle").isChecked(), false);
  assert.strictEqual(await page.locator("#autoTranslateToggle").isDisabled(), false);
  await page.close();
}

async function testPopupInitFailureShowsRecoverableState(browser) {
  const page = await createPopupPage(browser, {
    runtimeErrorAction: "get_settings",
    runtimeErrorMessage: "Mock settings load failure"
  });

  await page.waitForFunction(() => document.getElementById("status").textContent.includes("Mock settings load failure"));

  assert.match(await page.locator("#status").textContent(), /操作失败/);
  assert.match(await page.locator("#actionHint").textContent(), /打开设置/);
  assert.doesNotMatch(await page.locator("#thinkingSummary").textContent(), /\$1/);
  assert.strictEqual(await page.locator("#toggle").isDisabled(), true);
  assert.strictEqual(await page.locator("#scan").isDisabled(), true);
  assert.strictEqual(await page.locator("#autoTranslateToggle").isDisabled(), true);
  assert.strictEqual(await page.locator("[data-display-mode='bilingual']").isDisabled(), true);
  await page.close();
}

async function testPopupUnknownInitFailureShowsReadableMessage(browser) {
  const page = await createPopupPage(browser, {
    runtimeErrorAction: "get_settings",
    runtimeThrowEmpty: true
  });

  await page.waitForFunction(() => document.getElementById("status").textContent.includes("未知错误"));

  assert.match(await page.locator("#status").textContent(), /操作失败/);
  assert.doesNotMatch(await page.locator("#thinkingSummary").textContent(), /\$1/);
  assert.strictEqual(await page.locator("#toggle").isDisabled(), true);
  await page.close();
}

async function testPopupEnglishLayoutDoesNotOverflow(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      uiLanguage: "en",
      apiKey: "saved-key",
      model: "deepseek-chat",
      provider: "deepseek",
      sourceLanguage: "English",
      targetLanguage: "Simplified Chinese",
      autoTranslate: true
    },
    pageStats: {
      ok: true,
      active: true,
      content: { count: 30 },
      stats: {
        translated: 0,
        cacheHits: 0,
        apiRequested: 0,
        skippedBudget: 0,
        failed: 0,
        translationVisible: true
      }
    }
  });

  await page.setViewportSize({ width: 344, height: 760 });
  await page.waitForFunction(() => document.getElementById("stateBadge").textContent === "Translating");
  await page.waitForFunction(() => document.getElementById("configStatus").textContent.includes("DeepSeek"));
  assert.strictEqual(await page.locator("#configStatus").textContent(), "On · DeepSeek · deepseek-chat");
  assert.strictEqual(await page.locator("#actionHint").textContent(), "Scroll to translate newly visible text. Hide translations to view the original page.");

  const overflow = await page.evaluate(() => {
    const body = document.body;
    const bodyRect = body.getBoundingClientRect();
    const selectors = [
      ".brand-bar",
      ".summary-panel",
      ".switch-row",
      ".mode-panel",
      ".stats",
      ".button-row",
      "#options"
    ];

    return {
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      offenders: selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .map((node) => ({ selector: node.id ? `#${node.id}` : node.className, right: node.getBoundingClientRect().right }))
        .filter((item) => item.right > bodyRect.right + 1)
    };
  });

  assert.ok(
    overflow.bodyScrollWidth <= overflow.bodyClientWidth + 1,
    `popup has horizontal overflow: ${JSON.stringify(overflow)}`
  );
  assert.deepStrictEqual(overflow.offenders, []);
  await page.close();
}

async function testPopupLocalizedLayoutsDoNotOverflow(browser) {
  for (const uiLanguage of ["zh_TW", "ja"]) {
    const page = await createPopupPage(browser, {
      settings: {
        uiLanguage,
        apiKey: "saved-key",
        model: "deepseek-chat",
        provider: "deepseek",
        sourceLanguage: "English",
        targetLanguage: "简体中文",
        autoTranslate: true
      },
      pageStats: {
        ok: true,
        active: true,
        content: { count: 30 },
        stats: {
          translated: 8,
          cacheHits: 1,
          apiRequested: 7,
          skippedBudget: 2,
          failed: 0,
          translationVisible: true
        }
      }
    });

    await page.setViewportSize({ width: 344, height: 760 });
    await page.waitForSelector(".brand-bar");

    const result = await page.evaluate(() => ({
      text: document.body.innerText,
      clientWidth: document.body.clientWidth,
      scrollWidth: document.body.scrollWidth
    }));

    assert.ok(
      result.scrollWidth <= result.clientWidth + 1,
      `${uiLanguage} popup has horizontal overflow: ${JSON.stringify(result)}`
    );
    assert.doesNotMatch(result.text, /Status No Tab|Auto Save|Viewport Only|Unsupported Hint/);
    await page.close();
  }
}

async function testPopupKeepsStableChromePopupWidth(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      apiKey: "saved-key",
      model: "test-model"
    },
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.setViewportSize({ width: 80, height: 760 });
  await page.waitForSelector(".brand-bar");

  const size = await page.evaluate(() => ({
    bodyWidth: document.body.getBoundingClientRect().width,
    bodyScrollWidth: document.body.scrollWidth
  }));

  assert.strictEqual(size.bodyWidth, 344);
  assert.strictEqual(size.bodyScrollWidth, 344);
  await page.close();
}

async function testPopupPrimaryButtonsShowPendingText(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      apiKey: "saved-key",
      model: "test-model"
    },
    deferredAction: "toggle_translation",
    pageStats: [
      {
        ok: true,
        active: false,
        stats: { translated: 0, failed: 0, translationVisible: true }
      },
      {
        ok: true,
        active: true,
        stats: { translated: 1, failed: 0, translationVisible: true }
      }
    ]
  });

  await page.click("#toggle");
  await page.waitForFunction(() => document.getElementById("toggle").textContent === "启动中...");
  assert.strictEqual(await page.locator("#toggle").isDisabled(), true);

  await page.evaluate(() => window.__resolvePopupAction({ ok: true, active: true, content: { count: 1 } }));
  await page.waitForFunction(() => document.getElementById("toggle").textContent === "停止翻译");
  await page.close();
}

async function testPopupDisplayModeToggleSavesAndApplies(browser) {
  const page = await createPopupPage(browser, {
    settings: {
      displayMode: "bilingual",
      apiKey: "saved-key",
      model: "test-model"
    },
    pageStats: {
      ok: true,
      active: true,
      stats: { translated: 1, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.querySelector("[data-display-mode='bilingual']").classList.contains("is-selected"));
  await page.click("[data-display-mode='translation-first']");

  await page.waitForFunction(() => window.__storageUpdates?.some((updates) => updates.displayMode === "translation-first"));
  await page.waitForFunction(() => window.__runtimeMessages?.some((message) => (
    message.action === "set_display_mode" && message.displayMode === "translation-first"
  )));
  assert.strictEqual(await page.locator("[data-display-mode='translation-first']").getAttribute("aria-pressed"), "true");
  await page.close();
}

async function testPopupExplainsUnsupportedPages(browser) {
  const page = await createPopupPage(browser, {
    tabUrl: "chrome://extensions/",
    settings: {
      apiKey: "saved-key",
      model: "test-model"
    },
    pageStats: {
      ok: true,
      active: false,
      stats: { translated: 0, failed: 0, translationVisible: true }
    }
  });

  await page.waitForFunction(() => document.getElementById("status").textContent.includes("不支持翻译"));
  assert.strictEqual(await page.locator("#toggle").isDisabled(), true);
  assert.strictEqual(await page.locator("#scan").isDisabled(), true);
  assert.strictEqual(await page.locator("#autoTranslateToggle").isDisabled(), false);
  assert.match(await page.locator("#autoTranslateToggle").getAttribute("title"), /全局设置/);

  await page.click("#autoTranslateToggle");
  await page.waitForFunction(() => window.__storageUpdates?.some((updates) => updates.autoTranslate === true));
  assert.strictEqual(await page.evaluate(() => window.__runtimeMessages.some((message) => message.action === "auto_translate_tab")), false);
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("打开普通外文网页"));

  await page.click("[data-display-mode='translation-first']");
  await page.waitForFunction(() => window.__storageUpdates?.some((updates) => updates.displayMode === "translation-first"));
  assert.strictEqual(await page.evaluate(() => window.__runtimeMessages.some((message) => message.action === "set_display_mode")), false);
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("打开普通网页后生效"));
  await page.close();
}

async function testOptionsTestApiSavesSettingsBeforeRequest(browser) {
  const page = await createOptionsPage(browser);

  await page.fill("#apiKey", "test-key-from-form");
  await page.click("#test");

  await page.waitForFunction(() => window.__setCalls?.some((call) => call.apiKey === "test-key-from-form"));
  const savedBeforeTest = await page.evaluate(() => {
    const testIndex = window.__events.findIndex((event) => event === "test_api");
    const saveIndex = window.__events.findIndex((event) => event === "set:test-key-from-form");
    return saveIndex >= 0 && testIndex >= 0 && saveIndex < testIndex;
  });

  assert.strictEqual(savedBeforeTest, true);
  await page.evaluate(() => window.__resolveTestApi({ ok: true, text: "你好" }));
  await page.close();
}

async function testOptionsApiExceptionShowsFailureState(browser) {
  const page = await createOptionsPage(browser, {
    runtimeErrorAction: "test_api",
    runtimeErrorMessage: "Mock test failure"
  });

  await page.fill("#apiKey", "test-key");
  await page.click("#test");
  await page.waitForFunction(() => document.getElementById("message").textContent.includes("Mock test failure"));

  assert.strictEqual(await page.locator("#test").isDisabled(), false);
  assert.match(await page.locator("#message").textContent(), /操作失败/);
  assert.strictEqual(await page.locator("#setupStatus").evaluate((node) => node.classList.contains("is-testing")), false);
  assert.strictEqual(await page.locator("#setupStatus").evaluate((node) => node.classList.contains("is-error")), true);
  assert.match(await page.locator("#setupStatus").textContent(), /API 测试失败/);
  assert.match(await page.locator("#setupStatus").textContent(), /Mock test failure/);
  await page.close();
}

async function testOptionsUnknownApiExceptionShowsReadableMessage(browser) {
  const page = await createOptionsPage(browser, {
    runtimeErrorAction: "test_api",
    runtimeThrowEmpty: true
  });

  await page.fill("#apiKey", "test-key");
  await page.click("#test");
  await page.waitForFunction(() => document.getElementById("message").textContent.includes("未知错误"));

  assert.match(await page.locator("#message").textContent(), /操作失败/);
  assert.strictEqual(await page.locator("#setupStatus").evaluate((node) => node.classList.contains("is-error")), true);
  await page.close();
}

async function testOptionsApiSuccessMessageIsCompact(browser) {
  const page = await createOptionsPage(browser);

  await page.fill("#apiKey", "long-success-key");
  await page.click("#test");
  await page.evaluate(() => window.__resolveTestApi({
    ok: true,
    text: "This is a deliberately long translation result. ".repeat(12)
  }));
  await page.waitForFunction(() => document.getElementById("message").textContent.includes("API 可用"));

  const message = await page.locator("#message").textContent();
  const lineClamp = await page.locator("#message").evaluate((node) => getComputedStyle(node).webkitLineClamp);
  assert.ok(message.length < 180, `API success message should stay compact: ${message.length}`);
  assert.match(message, /…$/);
  assert.strictEqual(lineClamp, "2");
  await page.close();
}

async function testOptionsChangeEventSavesApiKey(browser) {
  const page = await createOptionsPage(browser);

  await page.evaluate(() => {
    const apiKey = document.getElementById("apiKey");
    apiKey.value = "key-from-change-event";
    apiKey.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await page.waitForFunction(() => window.__lastSavedSettings?.apiKey === "key-from-change-event");
  await page.close();
}

async function testOptionsProviderPresetUpdatesConnection(browser) {
  const page = await createOptionsPage(browser);

  await page.selectOption("#provider", "deepseek");
  await page.waitForFunction(() => document.getElementById("apiUrl").value.includes("deepseek.com"));
  await page.waitForFunction(() => window.__lastSavedSettings?.provider === "deepseek");
  assert.strictEqual(await page.locator("#model").inputValue(), "deepseek-chat");
  await page.close();
}

async function testOptionsHelpTextUpdates(browser) {
  const page = await createOptionsPage(browser);

  await page.selectOption("#provider", "dashscope");
  await page.waitForFunction(() => document.getElementById("providerHint").textContent.includes("DashScope"));

  await page.selectOption("#costProfile", "eager");
  await page.waitForFunction(() => document.getElementById("costProfileHint").textContent.includes("积极模式"));
  await page.close();
}

async function testOptionsProviderThinkingHints(browser) {
  const page = await createOptionsPage(browser);

  await page.waitForFunction(() => document.getElementById("thinkingHint").textContent.includes("不会添加"));
  assert.strictEqual(await page.locator("#disableThinking").isChecked(), true);
  assert.strictEqual(await page.locator("#disableThinking").isDisabled(), false);
  assert.strictEqual(await page.locator("#thinkingStrategy").isDisabled(), false);

  await page.selectOption("#provider", "dashscope");
  await page.waitForFunction(() => document.getElementById("thinkingHint").textContent.includes("enable_thinking"));
  assert.strictEqual(await page.locator("#disableThinking").isChecked(), true);
  assert.strictEqual(await page.locator("#disableThinking").isDisabled(), false);

  await page.selectOption("#provider", "openai");
  await page.waitForFunction(() => document.getElementById("thinkingHint").textContent.includes("不会添加"));
  assert.strictEqual(await page.locator("#disableThinking").isChecked(), true);
  assert.strictEqual(await page.locator("#disableThinking").isDisabled(), false);
  assert.strictEqual(await page.locator(".compact-checkbox").evaluate((node) => node.classList.contains("is-disabled")), false);

  await page.locator("#disableThinking").uncheck();
  await page.waitForFunction(() => document.getElementById("thinkingHint").textContent.includes("不会添加思考控制"));
  assert.strictEqual(await page.locator("#thinkingStrategy").isDisabled(), true);
  await page.close();

  const savedDeepSeekPage = await createOptionsPage(browser, {
    settings: {
      provider: "custom",
      apiUrl: "https://opencode.example/v1/chat/completions",
      model: "deepseek-v4-flash",
      disableThinking: true
    }
  });

  await savedDeepSeekPage.waitForFunction(() => document.getElementById("provider").value === "custom");
  await savedDeepSeekPage.waitForFunction(() => document.getElementById("thinkingHint").textContent.includes("thinking"));
  assert.strictEqual(await savedDeepSeekPage.locator("#disableThinking").isChecked(), true);
  assert.strictEqual(await savedDeepSeekPage.locator("#disableThinking").isDisabled(), false);
  await savedDeepSeekPage.close();
}

async function testOptionsTimeoutUsesSeconds(browser) {
  const page = await createOptionsPage(browser);

  assert.strictEqual(await page.locator("#apiTimeoutMs").inputValue(), "120");
  assert.strictEqual(await page.locator("#apiTimeoutMs").getAttribute("max"), "300");
  assert.strictEqual(await page.locator(".connection-settings summary").count(), 0);
  assert.strictEqual(await page.locator("#apiTimeoutMs").isVisible(), true);
  await page.fill("#apiTimeoutMs", "299");
  await page.waitForFunction(() => window.__lastSavedSettings?.apiTimeoutMs === 299000);
  await page.fill("#apiTimeoutMs", "999");
  await page.waitForFunction(() => window.__lastSavedSettings?.apiTimeoutMs === 300000);
  await page.close();
}

async function testOptionsCanRevealAndHideApiKey(browser) {
  const page = await createOptionsPage(browser);

  assert.strictEqual(await page.locator("#apiKey").getAttribute("type"), "password");
  assert.strictEqual(await page.locator("#toggleApiKey").getAttribute("aria-pressed"), "false");
  assert.strictEqual(await page.locator("#toggleApiKey").getAttribute("title"), "显示 API Key");
  await page.click("#toggleApiKey");
  assert.strictEqual(await page.locator("#apiKey").getAttribute("type"), "text");
  assert.strictEqual(await page.locator("#toggleApiKey").getAttribute("aria-pressed"), "true");
  assert.strictEqual(await page.locator("#toggleApiKey").getAttribute("title"), "隐藏 API Key");
  await page.click("#toggleApiKey");
  assert.strictEqual(await page.locator("#apiKey").getAttribute("type"), "password");
  assert.strictEqual(await page.locator("#toggleApiKey").getAttribute("aria-pressed"), "false");
  await page.close();
}

async function testOptionsDestructiveActionsRequireConfirm(browser) {
  const page = await createOptionsPage(browser);

  assert.strictEqual(await page.locator(".actions #clearCache").count(), 0);
  assert.strictEqual(await page.locator(".actions #reset").count(), 0);
  await page.click("#advancedSettings summary");
  assert.strictEqual(await page.locator(".maintenance-actions #clearCache").count(), 1);
  assert.strictEqual(await page.locator(".maintenance-actions #reset").count(), 1);
  assert.strictEqual(await page.locator("#reset").textContent(), "恢复全部默认设置");
  assert.ok(await page.locator("#clearCache").evaluate((node) => node.classList.contains("danger")));
  assert.ok(await page.locator("#reset").evaluate((node) => node.classList.contains("danger")));

  await page.evaluate(() => {
    window.__confirmResult = false;
  });
  await page.click("#clearCache");
  await page.click("#reset");
  assert.strictEqual(await page.evaluate(() => window.__confirmCalls.length), 2);
  assert.match(await page.evaluate(() => window.__confirmCalls[1]), /恢复全部默认设置/);
  assert.strictEqual(await page.evaluate(() => window.__runtimeMessages.filter((message) => message.action === "clear_cache").length), 0);
  assert.strictEqual(await page.evaluate(() => window.__setCalls.length), 0);

  await page.evaluate(() => {
    window.__confirmResult = true;
  });
  await page.click("#clearCache");
  await page.waitForFunction(() => window.__runtimeMessages.some((message) => message.action === "clear_cache"));
  await page.close();
}

async function testOptionsLanguagePresetSaves(browser) {
  const page = await createOptionsPage(browser);

  await page.selectOption("#targetLanguage", "English");
  await page.waitForFunction(() => window.__lastSavedSettings?.targetLanguage === "English");
  assert.strictEqual(await page.locator("#targetLanguage").inputValue(), "English");
  await page.close();
}

async function testOptionsLanguagePresetButtons(browser) {
  const page = await createOptionsPage(browser);

  assert.strictEqual(await page.locator("[data-language-preset][data-target='简体中文']").first().getAttribute("aria-pressed"), "true");
  await page.click("[data-language-preset][data-target='English']");
  await page.waitForFunction(() => window.__lastSavedSettings?.sourceLanguage === "简体中文");
  assert.strictEqual(await page.locator("#targetLanguage").inputValue(), "English");
  assert.strictEqual(await page.locator("[data-language-preset][data-target='English']").getAttribute("aria-pressed"), "true");

  await page.selectOption("#targetLanguage", "Japanese");
  await page.waitForFunction(() => window.__lastSavedSettings?.targetLanguage === "Japanese");
  assert.strictEqual(await page.locator("[data-language-preset].is-selected").count(), 0);
  await page.close();
}

async function testOptionsLanguageStatusWarnsOnSameLanguage(browser) {
  const page = await createOptionsPage(browser);

  await page.waitForFunction(() => document.getElementById("languageStatus").textContent.includes("英语 -> 简体中文"));
  await page.selectOption("#targetLanguage", "English");
  await page.waitForFunction(() => document.getElementById("languageStatus").textContent.includes("通常不会产生有效翻译"));
  assert.strictEqual(await page.locator("#languageStatus").evaluate((node) => node.classList.contains("is-warning")), true);

  await page.selectOption("#sourceLanguage", "Auto detect");
  await page.waitForFunction(() => document.getElementById("languageStatus").textContent.includes("自动检测 -> 英语"));
  assert.strictEqual(await page.locator("#languageStatus").evaluate((node) => node.classList.contains("is-warning")), false);
  await page.close();
}

async function testOptionsUiLanguageIsIndependent(browser) {
  const page = await createOptionsPage(browser);

  await page.waitForFunction(() => document.getElementById("uiLanguage").value === "auto");
  await page.selectOption("#uiLanguage", "en");
  await page.waitForFunction(() => document.querySelector("[data-i18n='optionsTitle']").textContent === "DualRead AI Settings");
  await page.waitForFunction(() => window.__lastSavedSettings?.uiLanguage === "en");

  assert.strictEqual(await page.locator("[data-i18n='optionsUiLanguage']").textContent(), "Interface language");
  assert.strictEqual(await page.locator("#sourceLanguage").inputValue(), "English");
  assert.strictEqual(await page.locator("#targetLanguage").inputValue(), "简体中文");
  assert.strictEqual(await page.locator("#uiLanguage").inputValue(), "en");
  await page.close();
}

async function testOptionsEnglishMicrocopyIsUserFacing(browser) {
  const page = await createOptionsPage(browser);

  await page.selectOption("#uiLanguage", "en");
  await page.waitForFunction(() => document.querySelector("[data-i18n='optionsQuickStartDesc']").textContent.includes("three steps"));
  await page.fill("#apiKey", "english-copy-key");
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("Connection looks ready"));

  const visibleText = await page.locator("body").innerText();
  assert.match(visibleText, /Changes are saved automatically/);
  assert.match(visibleText, /Only translate the current screen and nearby content/);
  assert.match(visibleText, /Increase this for slow networks/);
  assert.doesNotMatch(visibleText, /Auto Save Message|Ready Ready|Viewport Only/);
  await page.close();
}

async function testOptionsLayoutDoesNotOverflow(browser) {
  const cases = [
    { width: 980, height: 900, uiLanguage: "zh_CN" },
    { width: 390, height: 900, uiLanguage: "en" }
  ];

  for (const testCase of cases) {
    const page = await createOptionsPage(browser, {
      settings: {
        uiLanguage: testCase.uiLanguage,
        provider: "custom",
        apiUrl: "https://example.com/v1/chat/completions",
        apiKey: "saved-key",
        model: "deepseek-v4-flash",
        disableThinking: true
      }
    });

    try {
      await page.setViewportSize({ width: testCase.width, height: testCase.height });
      await page.waitForFunction(() => document.getElementById("setupStatus").textContent.trim().length > 0);

      const result = await page.evaluate(() => {
        const doc = document.documentElement;
        const selectors = [
          "main",
          ".page-header",
          ".setup-steps",
          ".setup-status",
          ".secret-row",
          ".connection-grid",
          ".connection-grid > label",
          ".thinking-settings",
          ".actions"
        ];
        const offenders = selectors
          .flatMap((selector) => Array.from(document.querySelectorAll(selector)).map((node) => ({ selector, node })))
          .filter(({ node }) => node.getClientRects().length > 0)
          .map(({ selector, node }) => {
            const rect = node.getBoundingClientRect();
            return { selector, left: rect.left, right: rect.right };
          })
          .filter((item) => item.left < -1 || item.right > doc.clientWidth + 1);

        return {
          clientWidth: doc.clientWidth,
          scrollWidth: doc.scrollWidth,
          offenders
        };
      });

      assert.ok(
        result.scrollWidth <= result.clientWidth + 1,
        `options page has horizontal overflow: ${JSON.stringify(result)}`
      );
      assert.deepStrictEqual(result.offenders, []);
    } finally {
      await page.close();
    }
  }
}

async function testOptionsCostProfileUpdatesAdvancedDefaults(browser) {
  const page = await createOptionsPage(browser);

  await page.selectOption("#costProfile", "economy");
  await page.waitForFunction(() => window.__lastSavedSettings?.costProfile === "economy");
  assert.strictEqual(await page.locator("#maxElementsPerScan").inputValue(), "12");
  assert.strictEqual(await page.locator("#maxCharsPerPage").inputValue(), "30000");
  assert.strictEqual(await page.locator("#maxConcurrentBatches").inputValue(), "1");
  await page.click("#advancedSettings summary");
  await page.fill("#maxConcurrentBatches", "3");
  await page.waitForFunction(() => window.__lastSavedSettings?.costProfile === "custom");
  await page.waitForFunction(() => window.__lastSavedSettings?.maxConcurrentBatches === 3);
  await page.close();
}

async function testOptionsDisplayModeAutoSaves(browser) {
  const page = await createOptionsPage(browser);

  await page.selectOption("#displayMode", "translation-first");
  await page.waitForFunction(() => window.__lastSavedSettings?.displayMode === "translation-first");
  assert.strictEqual(await page.locator("#displayMode").inputValue(), "translation-first");
  await page.close();
}

async function testOptionsAdvancedSettingsCanExpand(browser) {
  const page = await createOptionsPage(browser);

  assert.strictEqual(await page.locator("#advancedSettings").getAttribute("open"), null);
  await page.click("#advancedSettings summary");
  assert.strictEqual(await page.locator("#advancedSettings").getAttribute("open"), "");
  await page.close();
}

async function testOptionsPagehideFlushesPendingApiKey(browser) {
  const page = await createOptionsPage(browser);

  await page.fill("#apiKey", "key-before-pagehide");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

  await page.waitForFunction(() => window.__lastSavedSettings?.apiKey === "key-before-pagehide");
  await page.close();
}

async function testOptionsDisablesTestButtonWhilePending(browser) {
  const page = await createOptionsPage(browser);

  await page.fill("#apiKey", "test-key");
  await page.click("#test");
  const disabled = await page.locator("#test").isDisabled();

  assert.strictEqual(disabled, true);
  assert.strictEqual(await page.locator("#test").textContent(), "测试中...");
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("正在测试 API"));
  assert.strictEqual(await page.locator("#setupStatus").evaluate((node) => node.classList.contains("is-testing")), true);
  await page.evaluate(() => window.__resolveTestApi({ ok: true, text: "你好" }));
  await page.waitForFunction(() => document.getElementById("test").disabled === false);
  assert.strictEqual(await page.locator("#test").textContent(), "测试 API");
  await page.close();
}

async function testOptionsActionsKeepTestApiPrimary(browser) {
  const page = await createOptionsPage(browser);

  assert.strictEqual(await page.locator(".actions button").count(), 2);
  assert.strictEqual(await page.locator(".setup-section > .actions").count(), 1);
  assert.strictEqual(await page.locator(".actions").evaluate((node) => getComputedStyle(node).position), "static");
  assert.ok(await page.locator("#save").evaluate((node) => node.classList.contains("secondary")));
  assert.strictEqual(await page.locator("#test").evaluate((node) => node.classList.contains("secondary")), false);
  await page.close();
}

async function testUiDefinesKeyboardFocusStyles(browser) {
  assert.match(readText("popup.css"), /button:focus-visible[\s\S]*outline/);
  assert.match(readText("popup.css"), /input:focus-visible[\s\S]*outline/);
  assert.match(readText("options.css"), /button:focus-visible[\s\S]*summary:focus-visible[\s\S]*outline/);
  assert.match(readText("options.css"), /input\[type="checkbox"\]:focus-visible[\s\S]*outline/);
}

async function testOptionsSetupStatusGuidesConnection(browser) {
  const page = await createOptionsPage(browser);

  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("API Key"));
  assert.strictEqual(await page.locator("#test").isDisabled(), true);

  await page.fill("#apiKey", "status-test-key");
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("配置看起来完整"));
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("Enter"));
  assert.strictEqual(await page.locator("#test").isDisabled(), false);

  await page.click("#test");
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("正在测试 API"));
  await page.evaluate(() => window.__resolveTestApi({ ok: true, text: "你好" }));
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("API 测试通过"));
  await page.close();
}

async function testOptionsLoadFailureShowsDefaultsAndError(browser) {
  const page = await createOptionsPage(browser, {
    storageGetError: "Mock options load failure"
  });

  await page.waitForFunction(() => document.getElementById("message").textContent.includes("Mock options load failure"));

  assert.match(await page.locator("#message").textContent(), /操作失败/);
  assert.strictEqual(await page.locator("#provider").inputValue(), "openai");
  assert.strictEqual(await page.locator("#model").inputValue(), "gpt-4o-mini");
  assert.strictEqual(await page.locator("#test").isDisabled(), true);
  assert.strictEqual(await page.locator("#saveState").evaluate((node) => node.classList.contains("is-error")), true);
  assert.strictEqual(await page.locator("#setupStatus").evaluate((node) => node.classList.contains("is-incomplete")), true);
  await page.close();
}

async function testOptionsSetupStatusShowsApiFailure(browser) {
  const page = await createOptionsPage(browser);

  await page.fill("#apiKey", "bad-key");
  await page.click("#test");
  await page.evaluate(() => window.__resolveTestApi({ ok: false, error: "401 Unauthorized" }));

  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("API 测试失败"));
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("401 Unauthorized"));
  assert.strictEqual(await page.locator("#setupStatus").evaluate((node) => node.classList.contains("is-error")), true);
  assert.strictEqual(await page.locator("#saveState").textContent(), "测试失败");

  await page.fill("#apiKey", "fixed-key");
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("配置看起来完整"));
  assert.strictEqual(await page.locator("#setupStatus").evaluate((node) => node.classList.contains("is-error")), false);
  await page.close();
}

async function testOptionsEnterRunsApiTestWhenReady(browser) {
  const page = await createOptionsPage(browser);

  await page.fill("#apiKey", "enter-test-key");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.__runtimeMessages.some((message) => message.action === "test_api"));

  const savedBeforeTest = await page.evaluate(() => {
    const testIndex = window.__events.findIndex((event) => event === "test_api");
    const saveIndex = window.__events.findIndex((event) => event === "set:enter-test-key");
    return saveIndex >= 0 && testIndex >= 0 && saveIndex < testIndex;
  });

  assert.strictEqual(savedBeforeTest, true);
  await page.evaluate(() => window.__resolveTestApi({ ok: true, text: "你好" }));
  await page.waitForFunction(() => document.getElementById("setupStatus").textContent.includes("API 测试通过"));
  await page.close();
}

async function testOptionsAutoSavesChangedSettings(browser) {
  const page = await createOptionsPage(browser);

  await page.selectOption("#targetLanguage", "繁體中文");
  await page.waitForFunction(() => window.__lastSavedSettings?.targetLanguage === "繁體中文");

  const message = await page.locator("#message").textContent();
  assert.match(message, /自动保存/);
  await page.close();
}

async function testOptionsSavesCustomTranslationPrompt(browser) {
  const page = await createOptionsPage(browser);

  await page.click("#advancedSettings summary");
  await page.waitForSelector("#translationPrompt");
  const defaultPrompt = await page.locator("#translationPrompt").inputValue();
  assert.match(defaultPrompt, /Return ONLY a JSON array/);

  await page.fill("#translationPrompt", "Translate from {{sourceLanguage}} to {{targetLanguage}} in a concise style.");
  await page.click("#save");

  const savedPrompt = await page.evaluate(() => window.__lastSavedSettings.translationPrompt);
  assert.strictEqual(savedPrompt, "Translate from {{sourceLanguage}} to {{targetLanguage}} in a concise style.");
  await page.close();
}

async function testOptionsResetPromptRequiresConfirm(browser) {
  const page = await createOptionsPage(browser);

  await page.click("#advancedSettings summary");
  assert.strictEqual(await page.locator("#resetPrompt").textContent(), "恢复默认提示词");

  await page.fill("#translationPrompt", "Custom prompt");
  await page.evaluate(() => {
    window.__confirmResult = false;
  });
  await page.click("#resetPrompt");
  assert.strictEqual(await page.evaluate(() => window.__confirmCalls.length), 1);
  assert.strictEqual(await page.locator("#translationPrompt").inputValue(), "Custom prompt");

  await page.evaluate(() => {
    window.__confirmResult = true;
  });
  await page.click("#resetPrompt");
  await page.waitForFunction(() => document.getElementById("translationPrompt").value.includes("Return ONLY a JSON array"));
  await page.waitForFunction(() => window.__lastSavedSettings?.translationPrompt?.includes("Return ONLY a JSON array"));
  await page.close();
}

async function createPopupPage(browser, options = {}) {
  const page = await browser.newPage();
  await page.setContent(readHtml("popup.html"));
  const allLocaleMessages = readAllLocaleMessages();
  await page.evaluate(({ pageStats, settings, autoTranslateResponse, tabUrl, deferredAction, storageSetError, runtimeErrorAction, runtimeErrorMessage, runtimeThrowEmpty, localeMessages, allLocaleMessages }) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (url, fetchOptions) => {
      const match = String(url || "").match(/^locale:\/\/_locales\/([^/]+)\/messages\.json$/);
      if (match) {
        return new Response(JSON.stringify(allLocaleMessages[match[1]] || {}), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return nativeFetch(url, fetchOptions);
    };
    window.__popupSettings = {
      autoTranslate: false,
      apiKey: "",
      model: "test-model",
      ...(settings || {})
    };
    window.__pageStatsQueue = Array.isArray(pageStats) ? pageStats.slice() : null;
    window.__storageUpdates = [];
    window.__runtimeMessages = [];
    window.__confirmCalls = [];
    window.__confirmResult = true;
    const getLocaleMessage = (name, substitutions = []) => {
      const template = localeMessages?.[name]?.message || "";
      const values = Array.isArray(substitutions) ? substitutions : [substitutions];
      return template.replace(/\$(\d+)/g, (_, index) => values[Number(index) - 1] ?? "");
    };
    window.confirm = (message) => {
      window.__confirmCalls.push(message);
      return window.__confirmResult;
    };
    window.chrome = {
      storage: {
        local: {
          async set(updates) {
            if (storageSetError) throw new Error(storageSetError);
            window.__storageUpdates.push(updates);
            Object.assign(window.__popupSettings, updates);
          }
        }
      },
      tabs: {
        async query() {
          return [{ id: 1, url: tabUrl || "https://example.com" }];
        }
      },
      i18n: {
        getMessage: getLocaleMessage
      },
      runtime: {
        getURL(filePath) {
          return `locale://${filePath}`;
        },
        async sendMessage(request) {
          window.__runtimeMessages.push(request);
          if (runtimeErrorAction && request.action === runtimeErrorAction) {
            if (runtimeThrowEmpty) throw undefined;
            throw new Error(runtimeErrorMessage || "Mock runtime failure");
          }
          if (request.action === "get_settings") return window.__popupSettings;
          if (request.action === "get_page_stats") {
            if (window.__pageStatsQueue?.length > 1) return window.__pageStatsQueue.shift();
            if (window.__pageStatsQueue?.length === 1) return window.__pageStatsQueue[0];
            return pageStats;
          }
          if (deferredAction && request.action === deferredAction) {
            return new Promise((resolve) => {
              window.__resolvePopupAction = resolve;
            });
          }
          if (request.action === "auto_translate_tab") return autoTranslateResponse || { ok: true, active: true, content: { count: 0 } };
          return { ok: true, active: false, content: { count: 0 } };
        },
        openOptionsPage() {}
      }
    };
  }, {
    pageStats: options.pageStats,
    settings: options.settings,
    autoTranslateResponse: options.autoTranslateResponse,
    tabUrl: options.tabUrl,
    deferredAction: options.deferredAction,
    storageSetError: options.storageSetError,
    runtimeErrorAction: options.runtimeErrorAction,
    runtimeErrorMessage: options.runtimeErrorMessage,
    runtimeThrowEmpty: options.runtimeThrowEmpty,
    localeMessages: options.localeMessages,
    allLocaleMessages
  });
  await page.evaluate(readText("shared.js"));
  await page.evaluate(readText("popup.js"));
  return page;
}

async function createOptionsPage(browser, options = {}) {
  const page = await browser.newPage();
  await page.setContent(readHtml("options.html"));
  const allLocaleMessages = readAllLocaleMessages();
  await page.evaluate(({ allLocaleMessages, runtimeErrorAction, runtimeErrorMessage, runtimeThrowEmpty, storageGetError, settings }) => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (url, fetchOptions) => {
      const match = String(url || "").match(/^locale:\/\/_locales\/([^/]+)\/messages\.json$/);
      if (match) {
        return new Response(JSON.stringify(allLocaleMessages[match[1]] || {}), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return nativeFetch(url, fetchOptions);
    };
    let resolveTestApi;
    window.__events = [];
    window.__setCalls = [];
    window.__runtimeMessages = [];
    window.__confirmCalls = [];
    window.__confirmResult = true;
    window.__resolveTestApi = (response) => resolveTestApi(response);
    window.confirm = (message) => {
      window.__confirmCalls.push(message);
      return window.__confirmResult;
    };
    window.chrome = {
      storage: {
        local: {
          async get(defaults) {
            if (storageGetError) throw new Error(storageGetError);
            return { ...defaults, ...(settings || {}) };
          },
          async set(updates) {
            window.__events.push(`set:${updates.apiKey || ""}`);
            window.__setCalls.push(updates);
            window.__lastSavedSettings = updates;
          }
        }
      },
      runtime: {
        getURL(filePath) {
          return `locale://${filePath}`;
        },
        async sendMessage(request) {
          window.__runtimeMessages.push(request);
          if (runtimeErrorAction && request.action === runtimeErrorAction) {
            if (runtimeThrowEmpty) throw undefined;
            throw new Error(runtimeErrorMessage || "Mock runtime failure");
          }
          if (request.action === "test_api") {
            window.__events.push("test_api");
            return new Promise((resolve) => {
              resolveTestApi = resolve;
            });
          }
          return { ok: true, count: 0 };
        }
      }
    };
  }, {
    allLocaleMessages,
    runtimeErrorAction: options.runtimeErrorAction,
    runtimeErrorMessage: options.runtimeErrorMessage,
    runtimeThrowEmpty: options.runtimeThrowEmpty,
    storageGetError: options.storageGetError,
    settings: options.settings
  });
  await page.evaluate(readText("shared.js"));
  await page.evaluate(readText("options.js"));
  return page;
}

function readAllLocaleMessages() {
  return Object.fromEntries(["zh_CN", "zh_TW", "en", "ja"].map((locale) => [
    locale,
    JSON.parse(readText(path.join("_locales", locale, "messages.json")))
  ]));
}

function readHtml(fileName) {
  return fs.readFileSync(path.join(extensionDir, fileName), "utf8")
    .replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, stylesheet) => `<style>\n${readText(stylesheet)}\n</style>`)
    .replace(/<script src="[^"]+"><\/script>/g, "");
}

function readText(fileName) {
  return fs.readFileSync(path.join(extensionDir, fileName), "utf8");
}

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
    await testPopupShowsAutoSkipNotice(browser);
    await testPopupShowsAutoUnconfiguredNotice(browser);
    await testPopupAutoToggleSavesAndTriggersCurrentTab(browser);
    await testPopupDisplayModeToggleSavesAndApplies(browser);
    await testOptionsDisablesTestButtonWhilePending(browser);
    await testOptionsTestApiSavesSettingsBeforeRequest(browser);
    await testOptionsChangeEventSavesApiKey(browser);
    await testOptionsProviderPresetUpdatesConnection(browser);
    await testOptionsHelpTextUpdates(browser);
    await testOptionsProviderThinkingHints(browser);
    await testOptionsTimeoutUsesSeconds(browser);
    await testOptionsCanRevealAndHideApiKey(browser);
    await testOptionsDestructiveActionsRequireConfirm(browser);
    await testOptionsLanguagePresetSaves(browser);
    await testOptionsLanguagePresetButtons(browser);
    await testOptionsCostProfileUpdatesAdvancedDefaults(browser);
    await testOptionsDisplayModeAutoSaves(browser);
    await testOptionsAdvancedSettingsCanExpand(browser);
    await testOptionsPagehideFlushesPendingApiKey(browser);
    await testOptionsSavesCustomTranslationPrompt(browser);
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

  await page.selectOption("#provider", "dashscope");
  await page.waitForFunction(() => document.getElementById("thinkingHint").textContent.includes("enable_thinking"));
  assert.strictEqual(await page.locator("#disableThinking").isChecked(), true);

  await page.selectOption("#provider", "openai");
  await page.waitForFunction(() => document.getElementById("thinkingHint").textContent.includes("不会添加"));
  assert.strictEqual(await page.locator("#disableThinking").isChecked(), true);
  await page.close();
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
  await page.click("#toggleApiKey");
  assert.strictEqual(await page.locator("#apiKey").getAttribute("type"), "text");
  await page.click("#toggleApiKey");
  assert.strictEqual(await page.locator("#apiKey").getAttribute("type"), "password");
  await page.close();
}

async function testOptionsDestructiveActionsRequireConfirm(browser) {
  const page = await createOptionsPage(browser);

  assert.ok(await page.locator("#clearCache").evaluate((node) => node.classList.contains("danger")));
  assert.ok(await page.locator("#reset").evaluate((node) => node.classList.contains("danger")));

  await page.evaluate(() => {
    window.__confirmResult = false;
  });
  await page.click("#clearCache");
  await page.click("#reset");
  assert.strictEqual(await page.evaluate(() => window.__confirmCalls.length), 2);
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

  await page.click("[data-language-preset][data-target='English']");
  await page.waitForFunction(() => window.__lastSavedSettings?.sourceLanguage === "简体中文");
  assert.strictEqual(await page.locator("#targetLanguage").inputValue(), "English");
  await page.close();
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
  await page.evaluate(() => window.__resolveTestApi({ ok: true, text: "你好" }));
  await page.waitForFunction(() => document.getElementById("test").disabled === false);
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

async function createPopupPage(browser, options = {}) {
  const page = await browser.newPage();
  await page.setContent(readHtml("popup.html"));
  await page.evaluate(({ pageStats, settings, autoTranslateResponse }) => {
    window.__popupSettings = {
      autoTranslate: false,
      apiKey: "",
      model: "test-model",
      ...(settings || {})
    };
    window.__storageUpdates = [];
    window.__runtimeMessages = [];
    window.chrome = {
      storage: {
        local: {
          async set(updates) {
            window.__storageUpdates.push(updates);
            Object.assign(window.__popupSettings, updates);
          }
        }
      },
      tabs: {
        async query() {
          return [{ id: 1, url: "https://example.com" }];
        }
      },
      runtime: {
        async sendMessage(request) {
          window.__runtimeMessages.push(request);
          if (request.action === "get_settings") return window.__popupSettings;
          if (request.action === "get_page_stats") return pageStats;
          if (request.action === "auto_translate_tab") return autoTranslateResponse || { ok: true, active: true, content: { count: 0 } };
          return { ok: true, active: false, content: { count: 0 } };
        },
        openOptionsPage() {}
      }
    };
  }, {
    pageStats: options.pageStats,
    settings: options.settings,
    autoTranslateResponse: options.autoTranslateResponse
  });
  await page.evaluate(readText("popup.js"));
  return page;
}

async function createOptionsPage(browser) {
  const page = await browser.newPage();
  await page.setContent(readHtml("options.html"));
  await page.evaluate(() => {
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
            return defaults;
          },
          async set(updates) {
            window.__events.push(`set:${updates.apiKey || ""}`);
            window.__setCalls.push(updates);
            window.__lastSavedSettings = updates;
          }
        }
      },
      runtime: {
        async sendMessage(request) {
          window.__runtimeMessages.push(request);
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
  });
  await page.evaluate(readText("shared.js"));
  await page.evaluate(readText("options.js"));
  return page;
}

function readHtml(fileName) {
  return fs.readFileSync(path.join(extensionDir, fileName), "utf8")
    .replace(/<script src="[^"]+"><\/script>/g, "");
}

function readText(fileName) {
  return fs.readFileSync(path.join(extensionDir, fileName), "utf8");
}

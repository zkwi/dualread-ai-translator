const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const extensionDir = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assert.strictEqual(manifest.default_locale, "en");

  const server = await createFixtureServer();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "dualread-extension-"));
  let context;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`
      ]
    });

    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker", { timeout: 10000 });
    const extensionId = getExtensionId(worker.url());

    const page = await context.newPage();
    const fixtureUrl = `http://127.0.0.1:${server.port}/`;
    await page.goto(fixtureUrl);
    await page.waitForFunction(
      (version) => document.documentElement.dataset.llmTranslatorVersion === version,
      manifest.version,
      { timeout: 10000 }
    );

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForSelector("#provider", { timeout: 10000 });
    assert.match(await optionsPage.locator("h1").textContent(), /DualRead AI/);
    await optionsPage.waitForFunction(() => document.querySelector("[data-i18n='optionsQuickStart']").textContent === "Quick start");
    assert.match(await optionsPage.locator("[data-i18n='optionsSubtitle']").textContent(), /Bilingual webpage translation settings/);
    await configureAndTestApi(optionsPage, server.apiUrl);
    await translateFixturePage(optionsPage, page, fixtureUrl);

    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForSelector(".brand-bar", { timeout: 10000 });
    await popupPage.waitForFunction(() => document.getElementById("options").textContent === "Open settings");
    assert.match(await popupPage.locator("#toggle").textContent(), /Start translation|Stop translation/);
  } finally {
    if (context) {
      await context.close();
    }
    await server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log("extension smoke test passed");
}

async function configureAndTestApi(optionsPage, apiUrl) {
  await optionsPage.selectOption("#provider", "custom");
  await optionsPage.fill("#apiUrl", apiUrl);
  await optionsPage.fill("#apiKey", "smoke-test-key");
  await optionsPage.fill("#model", "smoke-model");
  await optionsPage.click("#save");
  await optionsPage.waitForFunction(() => document.getElementById("message").textContent.includes("Settings saved"));

  await optionsPage.click("#test");
  await optionsPage.waitForFunction(() => document.getElementById("message").textContent.includes("API works"), null, { timeout: 10000 });
}

async function translateFixturePage(optionsPage, page, fixtureUrl) {
  const response = await optionsPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return chrome.runtime.sendMessage({
      action: "toggle_translation",
      tab
    });
  }, fixtureUrl);

  assert.strictEqual(response.ok, true, response.error || "toggle_translation failed");
  await page.waitForSelector(".llm-bilingual-translation.is-done", { timeout: 10000 });
  assert.match(await page.locator(".llm-bilingual-translation.is-done").first().textContent(), /测试译文/);
}

function getExtensionId(workerUrl) {
  const match = String(workerUrl || "").match(/^chrome-extension:\/\/([^/]+)\//);
  assert.ok(match, `Unexpected extension worker URL: ${workerUrl}`);
  return match[1];
}

function createFixtureServer() {
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      return readRequestBody(request).then((body) => {
        const items = extractTranslationItems(body);
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(items.map((item) => ({
                  id: item.id,
                  text: `测试译文：${String(item.text || "").slice(0, 80)}`
                })))
              }
            }
          ]
        }));
      });
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`
      <!doctype html>
      <html lang="en">
        <head><title>DualRead smoke fixture</title></head>
        <body>
          <main>
            <p data-smoke-text>This smoke page verifies that the packaged extension injects its content script.</p>
          </main>
        </body>
      </html>
    `);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        apiUrl: `http://127.0.0.1:${server.address().port}/v1/chat/completions`,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function extractTranslationItems(body) {
  const fallback = [{ id: "test", text: "Hello world." }];

  try {
    const request = JSON.parse(body || "{}");
    const prompt = request?.messages?.find((message) => message.role === "user")?.content || "";
    const match = String(prompt).match(/\[\s*\{[\s\S]*\}\s*\]\s*$/);
    if (!match) return fallback;
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

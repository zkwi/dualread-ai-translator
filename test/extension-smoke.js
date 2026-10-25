const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");
const { STUDY_LESSON } = require("./fixtures/study-lesson.js");

const extensionDir = path.resolve(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
const contentSource = fs.readFileSync(path.join(extensionDir, "content.js"), "utf8");
const contentVersion = contentSource.match(/CONTENT_SCRIPT_VERSION\s*=\s*"([^"]+)"/)?.[1];

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  assert.strictEqual(manifest.default_locale, "en");
  assert.ok(contentVersion, "content script version should be declared");

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
      contentVersion,
      { timeout: 10000 }
    );

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForSelector("#provider", { timeout: 10000 });
    assert.match(await optionsPage.locator("h1").textContent(), /DualRead AI/);
    await optionsPage.waitForFunction(() => document.querySelector("[data-i18n='optionsConnection']").textContent === "API connection");
    assert.match(await optionsPage.locator("[data-i18n='optionsSubtitle']").textContent(), /Bilingual webpage translation settings/);
    await configureAndTestApi(optionsPage, server.apiUrl);
    await translateFixturePage(optionsPage, page, fixtureUrl);
    await openStudyModeForFixturePage(context, optionsPage, `http://127.0.0.1:${server.port}/study`, server);

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
  await optionsPage.waitForFunction(() => document.getElementById("message").textContent.includes("automatically"));

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

// 走一遍真实链路：注入脚本抓取页面文字、会话存储、打开阅读页、Port 流式生成和渲染。
async function openStudyModeForFixturePage(context, optionsPage, studyUrl, server) {
  const articlePage = await context.newPage();
  await articlePage.goto(studyUrl);
  await articlePage.waitForSelector("article p");

  const readerPromise = context.waitForEvent("page", {
    predicate: (candidate) => candidate.url().includes("/reader.html"),
    timeout: 10000
  });
  const response = await optionsPage.evaluate(async (url) => {
    const [tab] = await chrome.tabs.query({ url });
    return chrome.runtime.sendMessage({ action: "open_study_mode", tab });
  }, studyUrl);
  assert.strictEqual(response.ok, true, response.error || "open_study_mode failed");

  const reader = await readerPromise;
  await reader.waitForFunction(() => document.querySelectorAll(".vocab-card").length === 4, null, { timeout: 15000 });
  assert.strictEqual(await reader.locator("#article mark.term").count(), 4);
  assert.strictEqual(await reader.locator("#article strong.key").count(), 2);
  assert.strictEqual(await reader.locator("#progress").isVisible(), false);

  assert.strictEqual(server.studyRequests.length, 1);
  const body = server.studyRequests[0];
  assert.strictEqual(body.stream, true);
  assert.strictEqual(body.max_tokens, 12000);
  const prompt = body.messages[1].content;
  assert.match(prompt, /Learner level: CET-6/);
  assert.match(prompt, /The river cleanup began/);
  assert.doesNotMatch(prompt, /Site menu/, "有足够长的 article 时只取 article，导航不应发给模型");

  // 重新打开阅读页应命中本地课程缓存，不再请求 API。
  await reader.reload();
  await reader.waitForFunction(() => document.querySelectorAll(".vocab-card").length === 4, null, { timeout: 10000 });
  assert.strictEqual(server.studyRequests.length, 1);
  await reader.close();
  await articlePage.close();
}

function getExtensionId(workerUrl) {
  const match = String(workerUrl || "").match(/^chrome-extension:\/\/([^/]+)\//);
  assert.ok(match, `Unexpected extension worker URL: ${workerUrl}`);
  return match[1];
}

function createFixtureServer() {
  const studyRequests = [];
  const server = http.createServer((request, response) => {
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      return readRequestBody(request).then((body) => {
        const requestBody = JSON.parse(body || "{}");
        if (String(requestBody?.messages?.[0]?.content || "").includes("reading lesson")) {
          studyRequests.push(requestBody);
          response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: STUDY_LESSON.slice(0, 300) } }] })}\n\n`);
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: STUDY_LESSON.slice(300) } }] })}\n\n`);
          response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
          response.end("data: [DONE]\n\n");
          return;
        }
        if (requestBody.stream === true) {
          const sourceText = extractPlainTranslationText(requestBody);
          const translation = `测试译文：${sourceText.slice(0, 80)}`;
          const midpoint = Math.max(1, Math.floor(translation.length / 2));
          response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: translation.slice(0, midpoint) } }] })}\n\n`);
          response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: translation.slice(midpoint) } }] })}\n\n`);
          response.end("data: [DONE]\n\n");
          return;
        }

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

    if (request.url === "/study") {
      const paragraph = "The river cleanup began on a cold morning, when volunteers gathered along the banks with gloves, bags and a list of the worst-hit spots.";
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(`
        <!doctype html>
        <html lang="en">
          <head><title>River cleanup</title></head>
          <body>
            <nav>Site menu · Home · News · Sport</nav>
            <article>${Array.from({ length: 10 }, () => `<p>${paragraph}</p>`).join("")}</article>
          </body>
        </html>
      `);
      return;
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
        studyRequests,
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

function extractPlainTranslationText(requestBody) {
  const prompt = requestBody?.messages?.find((message) => message.role === "user")?.content || "";
  const marker = "\nText:\n";
  const markerIndex = String(prompt).lastIndexOf(marker);
  if (markerIndex < 0) return "Hello world.";
  return String(prompt).slice(markerIndex + marker.length).trim() || "Hello world.";
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

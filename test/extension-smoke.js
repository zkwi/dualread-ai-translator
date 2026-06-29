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
    await page.goto(`http://127.0.0.1:${server.port}/`);
    await page.waitForFunction(
      (version) => document.documentElement.dataset.llmTranslatorVersion === version,
      manifest.version,
      { timeout: 10000 }
    );

    const optionsPage = await context.newPage();
    await optionsPage.goto(`chrome-extension://${extensionId}/options.html`);
    await optionsPage.waitForSelector("#provider", { timeout: 10000 });
    assert.match(await optionsPage.locator("h1").textContent(), /DualRead AI/);
  } finally {
    if (context) {
      await context.close();
    }
    await server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log("extension smoke test passed");
}

function getExtensionId(workerUrl) {
  const match = String(workerUrl || "").match(/^chrome-extension:\/\/([^/]+)\//);
  assert.ok(match, `Unexpected extension worker URL: ${workerUrl}`);
  return match[1];
}

function createFixtureServer() {
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`
      <!doctype html>
      <html lang="en">
        <head><title>DualRead smoke fixture</title></head>
        <body>
          <main>
            <p>This smoke page verifies that the packaged extension injects its content script.</p>
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
        close: () => new Promise((done) => server.close(done))
      });
    });
  });
}

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { createHarnessPage, runTranslation } = require("./e2e-local-fixtures");
const { BASE_CSS, VIEWPORTS, fixtures } = require("./fixtures/layout-sites");
const {
  classifyLayoutMetrics,
  collectLayoutMetrics,
  recordLayoutSnapshot
} = require("./helpers/layout-assertions");

const outputDir = path.resolve(__dirname, "..", "test-results", "layout");

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];

  try {
    for (const fixture of fixtures) {
      for (const viewport of VIEWPORTS) {
        const page = await createHarnessPage(browser, {
          html: fixture.html,
          viewport: { width: viewport.width, height: viewport.height },
          bodyStyle: "margin:0;padding:0",
          extraCss: `${BASE_CSS}\n${fixture.extraCss || ""}`,
          maxElementsPerScan: 60,
          maxRequestsPerPage: 100,
          targetLanguage: fixture.targetLanguage || "简体中文",
          translationText: fixture.translationText || "",
          translateDelayMs: fixture.scenario === "x-rerender" ? 500 : 0
        });

        try {
          await page.waitForTimeout(60);
          const before = await recordLayoutSnapshot(page);
          if (fixture.scenario === "x-rerender") {
            await runXRerenderScenario(page);
          } else {
            await runTranslation(page, 700);
          }

          const metrics = await collectLayoutMetrics(page, before);
          const classification = classifyLayoutMetrics(metrics);
          if (fixture.scenario === "x-rerender" && metrics.logicalRequestCount !== 2) {
            classification.status = "FAIL";
            classification.issues.push(`逻辑内容请求数应为 2，实际为 ${metrics.logicalRequestCount}`);
          }

          const screenshot = `${fixture.key}-${viewport.name}.png`;
          await page.screenshot({ path: path.join(outputDir, screenshot), fullPage: true });
          results.push({
            key: fixture.key,
            site: fixture.site,
            archetype: fixture.archetype,
            viewport: viewport.name,
            viewportSize: `${viewport.width}x${viewport.height}`,
            status: classification.status,
            issues: classification.issues,
            metrics,
            screenshot
          });
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  fs.writeFileSync(path.join(outputDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  const summary = {
    total: results.length,
    pass: results.filter((result) => result.status === "PASS").length,
    fail: results.filter((result) => result.status === "FAIL").length,
    failures: results
      .filter((result) => result.status === "FAIL")
      .map((result) => `${result.site}/${result.viewport}: ${result.issues.join("；")}`)
  };
  console.log(JSON.stringify(summary, null, 2));
  if (summary.fail > 0) process.exitCode = 1;
}

async function runXRerenderScenario(page) {
  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const oldSource = document.getElementById("x-inflight-source");
    const freshSource = document.createElement("div");
    freshSource.id = "x-inflight-source-fresh";
    freshSource.dataset.testSource = "";
    freshSource.dataset.testid = "tweetText";
    freshSource.textContent = oldSource.textContent;
    oldSource.insertAdjacentElement("afterend", freshSource);
    oldSource.remove();
  });
  await page.waitForTimeout(850);
  await page.evaluate(() => {
    const oldSource = document.getElementById("x-done-source");
    const freshSource = document.createElement("div");
    freshSource.id = "x-done-source-fresh";
    freshSource.dataset.testSource = "";
    freshSource.dataset.testid = "tweetText";
    freshSource.textContent = oldSource.textContent;
    oldSource.parentElement.appendChild(freshSource);
    oldSource.remove();
  });
  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(850);
}

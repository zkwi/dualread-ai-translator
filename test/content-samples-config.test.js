const assert = require("assert");
const {
  VIEWPORTS,
  allSamples,
  classifySampleResult,
  isLikelySiteBlocked
} = require("./e2e-content-samples");

assert.strictEqual(allSamples.length, 16);
assert.strictEqual(new Set(allSamples.map((sample) => sample.key)).size, 16);
assert.deepStrictEqual(VIEWPORTS.map((viewport) => viewport.name), ["desktop", "mobile"]);
assert.ok(allSamples.every((sample) => /^https:\/\//.test(sample.url)));

assert.deepStrictEqual(
  classifySampleResult({ loadError: "timeout", siteBlocked: false }),
  { status: "SKIP", issues: [], blockReason: "network/load error: timeout" }
);
assert.deepStrictEqual(
  classifySampleResult({ loadError: null, siteBlocked: true, blockReason: "bot protection" }),
  { status: "BLOCKED", issues: [], blockReason: "bot protection" }
);
assert.strictEqual(classifySampleResult({
  loadError: null,
  siteBlocked: false,
  blockedOnNoOutput: true,
  loaded: true,
  doneCount: 0,
  errorCount: 0
}).status, "BLOCKED");
assert.strictEqual(classifySampleResult({
  loadError: null,
  siteBlocked: false,
  loaded: true,
  doneCount: 1,
  errorCount: 0,
  blockedTranslationCount: 0,
  duplicateCount: 0,
  invalidTableParentCount: 0,
  overlapCount: 0,
  horizontalOverflowPx: 0
}).status, "PASS");
assert.strictEqual(classifySampleResult({
  loadError: null,
  siteBlocked: false,
  loaded: true,
  doneCount: 0,
  errorCount: 0,
  blockedTranslationCount: 0,
  duplicateCount: 0,
  invalidTableParentCount: 0,
  overlapCount: 0,
  horizontalOverflowPx: 0
}).status, "FAIL");

assert.strictEqual(isLikelySiteBlocked("Performing security verification"), true);
assert.strictEqual(isLikelySiteBlocked("Readable article body"), false);

console.log("content sample configuration tests passed");

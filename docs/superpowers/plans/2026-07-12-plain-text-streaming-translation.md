# Plain-Text Streaming Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the webpage translation batch/JSON path with per-paragraph plain-text SSE translation that updates the page before the response ends.

**Architecture:** The content script owns a continuously filled, concurrency-limited paragraph queue and communicates with the background service worker through one named `chrome.runtime.Port`. The background performs cache lookup, streams Chat Completions deltas, falls back to one plain-text non-streaming request when streaming is unavailable before output, and aborts work when the Port disconnects or a request is cancelled.

**Tech Stack:** Chrome Extension Manifest V3, JavaScript, Fetch streams, SSE, Chrome runtime messaging, Node.js tests, Playwright fixtures.

## Global Constraints

- Do not add third-party dependencies.
- Keep API keys in the background service worker.
- Preserve existing batch JSON functions for compatibility, but do not use them for webpage body translation.
- Keep `maxConcurrentBatches` as the stored key, with new UI meaning “simultaneous paragraph translations”.
- Do not commit or push Git changes without explicit user authorization.
- Use Chinese comments only where the reason is not self-evident.

---

### Task 1: Resolve Doubao thinking control automatically

**Files:**
- Modify: `shared.js:221-254`
- Test: `test/shared.test.js`

**Interfaces:**
- Consumes: `getEffectiveThinkingStrategy(settings)`.
- Produces: automatic `THINKING_STRATEGIES.THINKING_DISABLED` for `volces.com` endpoints and `doubao` model names.

- [ ] **Step 1: Write the failing tests**

```js
assert.strictEqual(shared.getEffectiveThinkingStrategy({
  provider: "custom",
  apiUrl: "https://ark.cn-beijing.volces.com/api/plan/v3",
  model: "doubao-seed-2.0-mini",
  thinkingStrategy: "auto"
}), shared.THINKING_STRATEGIES.THINKING_DISABLED);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node test/shared.test.js`

Expected: assertion fails because the effective strategy is currently `omit`.

- [ ] **Step 3: Add minimal endpoint/model detection**

```js
if (apiUrl.includes("volces.com") || model.includes("doubao")) {
  return THINKING_STRATEGIES.THINKING_DISABLED;
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node test/shared.test.js`

Expected: exit code 0.

---

### Task 2: Add a tested SSE parser and plain-text request builder

**Files:**
- Modify: `background.js:1039-1120`
- Test: `test/background.test.js`

**Interfaces:**
- Produces: `buildPlainTranslationPrompt(settings, text)`.
- Produces: `consumeChatCompletionStream(response, onDelta)` returning the complete translated string.
- Produces: `requestPlainTranslation(settings, text, options)` supporting `{ stream, onDelta, signal }`.

- [ ] **Step 1: Add background tests for split SSE frames**

Create a mocked streaming response whose chunks split both the `data:` prefix and JSON payload, and assert that deltas `"你"` and `"好"` are observed before completion and the returned result is `"你好"`.

- [ ] **Step 2: Run the targeted background test and verify RED**

Run: `node test/background.test.js`

Expected: failure because the stream request/action is not implemented.

- [ ] **Step 3: Implement the minimal parser and request path**

The parser must buffer incomplete lines, ignore blank/comment lines, stop at `[DONE]`, read `choices[0].delta.content`, and reject a successful stream that contains no content.

The prompt must end with:

```text
Translate this single text segment. Return only the translated plain text.
Do not return JSON, Markdown fences, explanations, labels, or comments.
```

The stream timeout must remain active until the reader finishes, not only until response headers arrive.

- [ ] **Step 4: Add non-stream fallback tests**

Assert that an explicit stream-unsupported response falls back to `stream: false`, reads `choices[0].message.content`, and does not parse JSON from the model text.

- [ ] **Step 5: Run background tests and verify GREEN**

Run: `node test/background.test.js`

Expected: exit code 0.

---

### Task 3: Expose streaming translation through a runtime Port

**Files:**
- Modify: `background.js:45-155`
- Test: `test/background.test.js`

**Interfaces:**
- Port name: `llm-translation-stream`.
- Request message: `{ type: "translate", requestId, runId, item: { id, text } }`.
- Cancel message: `{ type: "cancel", requestId }`.
- Response messages: `{ type: "delta" | "done" | "cached" | "error", requestId, runId, ... }`.

- [ ] **Step 1: Write failing Port lifecycle tests**

Assert cache hits emit `cached` without fetch; streamed requests emit `delta` before `done`; cancel and disconnect abort the associated controller.

- [ ] **Step 2: Run tests and verify RED**

Run: `node test/background.test.js`

Expected: failure because no `onConnect` stream handler exists.

- [ ] **Step 3: Implement the Port handler**

Use one `Map` of request ID to `AbortController` per Port. Validate settings, reuse existing cache keys, post deltas only while the Port remains connected, save the final text with existing cache functions, and clean the map in `finally`.

- [ ] **Step 4: Verify Port tests GREEN**

Run: `node test/background.test.js`

Expected: exit code 0.

---

### Task 4: Replace the webpage batch scheduler with streaming workers

**Files:**
- Modify: `content.js:20-55`
- Modify: `content.js:1260-1365`
- Modify: `content.js:1531-1655`
- Modify: `content.js:2040-2075`
- Test: `test/e2e-local-fixtures.js`

**Interfaces:**
- Produces: one shared stream Port per active translation run.
- Produces: worker count limited by `normalizeCostSettings(settings).maxConcurrentBatches`.
- Produces: partial DOM state `.llm-bilingual-translation.is-streaming`.

- [ ] **Step 1: Write failing fixture tests**

Add a harness Port that emits two delayed deltas followed by `done`. Assert the first delta changes the node before `done`, no `translate_batch` message is sent for page text, and maximum active requests equals 2.

- [ ] **Step 2: Run the local fixture test and verify RED**

Run: `node test/e2e-local-fixtures.js`

Expected: failure because the content script still sends `translate_batch` and waits for one response.

- [ ] **Step 3: Implement continuously filled workers**

Replace batch extraction and `Promise.all` with a pump:

```js
while (state.activeStreams < maxConcurrent && state.queue.length > 0) {
  const element = state.queue.shift();
  state.activeStreams += 1;
  translateStreamElement(element, state.runId).finally(() => {
    state.activeStreams -= 1;
    pumpTranslationQueue();
  });
}
```

Map each request ID to its element and accumulated text. Apply every `delta` using `textContent`; finish with the existing `setTranslation`; use existing `setError` on failures.

- [ ] **Step 4: Implement cancellation**

On stop or far-viewport cancellation, send cancel messages for pending stream requests, reject/settle their local promises, clear the queue, and disconnect the Port when the whole translation run ends.

- [ ] **Step 5: Run local fixture tests and verify GREEN**

Run: `node test/e2e-local-fixtures.js`

Expected: exit code 0.

---

### Task 5: Simplify settings and make API testing stream-aware

**Files:**
- Modify: `options.html:250-280`
- Modify: `options.js:20-65`
- Modify: `options.js:373-420`
- Modify: `_locales/zh_CN/messages.json`
- Modify: `_locales/zh_TW/messages.json`
- Modify: `_locales/en/messages.json`
- Modify: `_locales/ja/messages.json`
- Test: `test/e2e-ui-fixtures.js`
- Test: `test/background.test.js`

**Interfaces:**
- Keeps persisted key `maxConcurrentBatches`.
- API test response includes `{ ok, text, streamed, fallback }`.

- [ ] **Step 1: Write failing settings tests**

Assert the batch size/character inputs are no longer visible, the concurrency label describes simultaneous paragraph translations, and the API test saves form settings before sending `test_api`.

- [ ] **Step 2: Verify RED**

Run: `node test/e2e-ui-fixtures.js`

Expected: failure because batch controls remain visible and copy is outdated.

- [ ] **Step 3: Update the settings UI and test API**

Remove the obsolete visible batch controls while retaining their stored defaults in JavaScript compatibility paths. Make `testApi(settings)` call the same plain-text streaming request; if it uses non-stream fallback, return `fallback: true` so the options page can show an accurate message.

- [ ] **Step 4: Regenerate or update locale files and run UI tests**

Run: `node test/e2e-ui-fixtures.js`

Expected: exit code 0.

---

### Task 6: Full verification and focused cleanup

**Files:**
- Modify only files already touched when verification reveals task-related defects.

- [ ] **Step 1: Run syntax and publication checks**

Run: `npm run check`

Expected: exit code 0.

- [ ] **Step 2: Run unit tests**

Run: `npm run test:shared && npm run test:background`

Expected: both commands exit 0.

- [ ] **Step 3: Run browser fixture suites**

Run: `npm run test:ui && npm run test:local && npm run test:smoke`

Expected: all suites exit 0.

- [ ] **Step 4: Inspect final diff and workspace state**

Run: `git diff --check; git status --short; git diff --stat`

Expected: no whitespace errors; only task-related source, test, locale, and design/plan files changed.

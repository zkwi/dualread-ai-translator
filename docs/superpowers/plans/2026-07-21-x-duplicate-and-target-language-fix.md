# X 页面重复翻译与目标语言误触发修复计划（0.10.2）

> **For agentic workers (Codex):** 按任务顺序逐个执行。每个任务都是"先写失败测试 → 跑测试确认失败 → 最小实现 → 跑测试确认通过 → 提交"。步骤用 checkbox（`- [ ]`）跟踪。不要合并任务、不要顺手做计划外的重构。

**Goal:** 修复 X（Twitter）时间线上两个用户实测问题：(1) 同一条推文出现两个完全相同的译文块；(2) 目标语言（简体中文）的推文也被送去翻译，返回一个与原文一模一样的中文块。

**Architecture:** 不引入新依赖、不新建文件。改动集中在 content.js（候选语言过滤 + 译文节点复用 + 同源文本去重）和 shared.js（导出一个已有的哈希函数）。每个修复配 Playwright harness 回归测试。

**Tech Stack:** Chrome MV3 扩展原生 JS，测试用现有 Node + Playwright 自建 harness（`test/e2e-local-fixtures.js`）。

---

## 背景与根因分析

用户在 `https://x.com/Prathkum/status/2079147944612368642` 实测（截图）：

- 症状 A：英文推文 "how much reverse engineering are we talking about" 下面出现**两个完全相同**的中文译文块，上下紧挨。
- 症状 B：中文推文（如 "卡神，这个网页版的 GPT 来的是 work 模式还是 chat 模式？…"）下面出现一个**与原文完全相同**的中文"译文"块。

配置说明：用户口头说"中译英"，但截图显示英文推文被翻成中文、且期望"中文不应触发翻译"，实际配置应为**目标语言=简体中文**（即英译中）。本计划按"目标语言为 zh/ja/ko、页面主体是其他语言"的通用场景修复。行号以 0.10.1（commit 38f1115）为准。

### 根因 1（症状 B）：页面语言模式下，元素级目标语言过滤被整体绕过

`content.js:1050-1053`：

```js
function shouldSkipCandidateByLanguage(text) {
  if (shouldUsePageLanguageCandidateMode()) return false;   // ← 页面语言模式下直接放行一切
  return LLMTranslatorShared.isLikelyTargetLanguageText(text, state.settings?.targetLanguage);
}
```

**触发链**：x.com 的 `<html lang="en">` 与目标语言 zh 不一致 → `refreshPageLanguageContext`（`content.js:2814-2824`）直接判定 `isTargetLanguagePage: false` → `shouldUsePageLanguageCandidateMode()` 恒为 true → **`isLikelyTargetLanguageText` 检查在整个页面上被禁用**。

随后中文推文还要过 `hasCandidateLanguageSignal`（`content.js:1055-1057` → `hasSourceLanguageSignal`，`content.js:1970-1981`）：

- 源语言为 English（默认）→ "latin" 分支只要求 `/[A-Za-z]{3,}/`。截图中的中文推文包含 "GPT"、"work"、"chat"、"codex" 等拉丁词 → 通过。
- 源语言为"自动" → CJK ≥ 4 直接通过。

于是中文推文被发给模型，prompt 是 "Translate from English to 简体中文"，模型原样返回中文 → 页面上出现与原文相同的中文块。

这个绕过当初存在的合理性只针对 **en 目标**：`isLikelyTargetLanguageText` 对 en 只能按拉丁字母判断，无法区分英语和法语/德语，在"页面已知不是目标语言"时跳过该检查可以避免法语页面被误判为英语而漏翻。但 zh/ja/ko 目标是按文字系统判断的，可靠，不应一起绕过。

### 根因 2（症状 A）：译文插入锚点每次状态更新都重新计算，且依赖易变的布局状态

`setLoading` / `setStreamingTranslation` / `setTranslation` / `setError`（`content.js:2242-2280`）每次都调用 `ensureTranslationNode`（`content.js:2032-2059`），后者每次重新计算插入锚点 `getTranslationInsertionTarget`（`content.js:2110-2126`）。锚点计算里的 `findClippedTranslationInsertionTarget` 依赖 `isVisuallyClipped`（`content.js:1790-1800`，读 `line-clamp` / `scrollHeight > clientHeight`）——这是**随布局变化而翻转的易变状态**。X 的推文在流式翻译期间常发生布局变化（字体/图片加载、行数变化、React 更新）。

**触发链**：`setLoading` 时元素未被判定为 clipped → 节点插到元素后面；流式期间祖先变为 clipped → `setTranslation` 时锚点变成 clipped 祖先 → `findExistingTranslationNode`（`content.js:2094-2108`）只检查**新锚点**的 `nextElementSibling`，找不到旧节点 → 创建第二个节点。旧节点无人清理 → 两个译文块。

### 根因 3（症状 A 的另一条路径）：React 重渲染丢标记后，无任何"同文已译"防线

X 用 React 渲染，推文元素会被整体替换：替换后新元素**没有** `data-llm-translator-status` / `data-llm-translator-id` 标记，而作为兄弟节点插入的 `.llm-bilingual-translation` 译文节点可能存活在原位。重新扫描时：

- `isCandidateElement`（`content.js:946-971`）只检查元素**内部**（`querySelector`）和**祖先**（`closest`）的译文节点，不检查兄弟位置；
- 文本级去重 `seenTexts` 只在单次扫描调用内有效，跨扫描不去重；
- 若新元素恰好不紧邻旧译文节点，`findExistingTranslationNode` 也找不到 → 再翻一次（还多花一次 API/缓存请求）→ 同一条推文两个译文块。

### 症状 → 根因 → 任务对照

| 用户症状 | 根因 | 任务 |
|---|---|---|
| 中文推文出现相同中文"译文" | 根因 1 | Task 1 |
| 同一推文两个相同译文块 | 根因 2 + 3 | Task 2、Task 3 |

---

## 文件结构（本计划涉及的全部文件）

| 文件 | 变更 |
|---|---|
| `content.js` | Task 1（语言过滤）、Task 2（节点复用）、Task 3（同源去重）、Task 4（版本号） |
| `shared.js` | Task 3（导出 `simpleHash`） |
| `test/e2e-local-fixtures.js` | Task 1/2/3 的回归测试 |
| `manifest.json` / `package.json` / `package-lock.json` / `CHANGELOG.md` | Task 4 发布 0.10.2 |

**通用约定**：

- 每个任务的验证命令：`npm run check && npm run test:local`（约 3–5 分钟，全量跑）。
- 新测试注册方式：`test/e2e-local-fixtures.js` 的 `main()` 里有一个顺序 `await testXxx(browser);` 的列表，把新函数追加到 `testShowsPageNotice(browser)` 之前，函数体添加到文件中部与其他测试并列的位置。
- 所有新增代码注释用中文，说明"为什么"。

---

## Task 1: 页面语言模式下恢复 zh/ja/ko 目标语言的元素级跳过

**Files:**
- Modify: `content.js:1050-1053`（`shouldSkipCandidateByLanguage`）
- Test: `test/e2e-local-fixtures.js`

- [ ] **Step 1: 写失败测试——混排时间线上中文推文不进入翻译请求**

在 `test/e2e-local-fixtures.js` 新增（放在 `testNonLatinSourceLanguagesTranslate` 函数之后）：

```js
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
```

并在 `main()` 列表中 `await testShowsPageNotice(browser);` 之前追加：

```js
    await testPageLanguageModeSkipsTargetLanguageTweets(browser);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx --yes --package playwright node test/e2e-local-fixtures.js`
Expected: `testPageLanguageModeSkipsTargetLanguageTweets` 处 AssertionError（requestCount 为 2，中文推文也发了请求）。

- [ ] **Step 3: 最小实现**

把 `content.js` 中 `shouldSkipCandidateByLanguage`（当前在 1050-1053 行）替换为：

```js
  function shouldSkipCandidateByLanguage(text) {
    const targetKind = LLMTranslatorShared.normalizeTargetLanguageKind(state.settings?.targetLanguage);
    // 页面语言模式只对 en/未知目标放行：拉丁文本无法凭文字系统区分英/法/德，跳过检查才能翻译整页；
    // zh/ja/ko 目标可以按文字系统可靠识别"已是目标语言"的段落，必须继续逐元素跳过（X 混排时间线场景）。
    if (shouldUsePageLanguageCandidateMode() && (targetKind === "en" || !targetKind)) return false;
    return LLMTranslatorShared.isLikelyTargetLanguageText(text, state.settings?.targetLanguage);
  }
```

说明：`shouldSkipCandidateByLanguage` 是 `isTranslatableTextNode`、`isCandidateElement`、`isUsefulInlineBlock`、`isUsefulGenericBlock`、`findPrimaryListItemLink` 的共同入口，改这一处即覆盖全部候选路径。`normalizeTargetLanguageKind` 已在 shared.js 导出，无需改 shared.js。

- [ ] **Step 4: 运行测试确认通过（含既有语言相关测试不回归）**

Run: `npm run check && npm run test:local`
Expected: 全部通过。重点确认这些既有测试仍通过：`testNonLatinSourceLanguagesTranslate`（日文源→中文目标的日文段落 kana 占比高，`isLikelyTargetLanguageText` 对 zh 返回 false，仍会翻译）、`testPageLanguageModeTranslatesShortReadableLabels`、`testSkipsTargetLanguagePage`。

- [ ] **Step 5: 提交**

```bash
git add content.js test/e2e-local-fixtures.js
git commit -m "修复页面语言模式下中文段落被误送翻译"
```

---

## Task 2: 译文节点按元素记忆复用，消除锚点漂移产生的重复块

**Files:**
- Modify: `content.js`（`ensureTranslationNode`（2032-2059 行附近）、`resetPendingElement`（1304-1323 行附近）、新增 WeakMap 与辅助函数）
- Test: `test/e2e-local-fixtures.js`

- [ ] **Step 1: 写失败测试——流式期间裁剪状态翻转不产生第二个译文块**

在 `test/e2e-local-fixtures.js` 新增：

```js
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
```

并在 `main()` 列表中 Task 1 新增行之后追加：

```js
    await testTranslationNodeStaysStableWhenClipStateChangesMidStream(browser);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `TEST_FILTER= npx --yes --package playwright node test/e2e-local-fixtures.js`（PowerShell 下直接 `npx --yes --package playwright node test/e2e-local-fixtures.js`）
Expected: 新测试处 AssertionError，total 为 2（一个残留 is-loading 节点 + 一个 is-done 节点）。

- [ ] **Step 3: 最小实现——WeakMap 记忆首次插入的译文节点**

在 `content.js` 顶部 `translationTextCache` 声明（56 行附近）旁新增：

```js
  // 译文节点按元素记忆：插入锚点依赖 isVisuallyClipped 等易变布局状态，
  // 状态更新时重算锚点会导致同一元素插入第二个节点，这里首次插入后固定复用。
  const translationNodesByElement = new WeakMap();

  function getMemoizedTranslationNode(element) {
    const node = translationNodesByElement.get(element);
    return node?.isConnected ? node : null;
  }
```

修改 `ensureTranslationNode`：函数开头先查记忆，末尾写入记忆：

```js
  function ensureTranslationNode(element) {
    const memoized = getMemoizedTranslationNode(element);
    if (memoized) return memoized;

    const placement = LLMTranslatorShared.getTranslationPlacement(element.tagName);
    const context = getTranslationContext(element, placement);
    const insertionTarget = context.anchor;
    let node = findExistingTranslationNode(element, placement, insertionTarget);

    if (!node) {
      node = document.createElement("div");
      node.className = "llm-bilingual-translation";
      node.dir = "auto";

      if (placement === "inside") {
        if (insertionTarget && insertionTarget !== element) {
          insertionTarget.insertAdjacentElement("afterend", node);
        } else {
          element.appendChild(node);
        }
      } else {
        (insertionTarget || element).insertAdjacentElement("afterend", node);
      }
    }
    element.dataset.llmTranslatorPlacement = placement;
    node.dir = "auto";
    syncTranslationSlot(node, insertionTarget);
    applyTranslationLayout(node, context);
    node.dataset.llmTranslatorLocalTheme = detectElementTheme(element);
    translationNodesByElement.set(element, node);
    return node;
  }
```

修改 `resetPendingElement`（1304-1323 行附近），查找待清理节点时优先用记忆，避免锚点漂移后清不掉：

```js
    const placement = element.dataset.llmTranslatorPlacement
      || LLMTranslatorShared.getTranslationPlacement(element.tagName);
    const node = getMemoizedTranslationNode(element)
      || findExistingTranslationNode(element, placement);
```

（`clearTranslations` 无需修改：节点被 remove 后 `isConnected` 为 false，记忆自动失效。）

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run check && npm run test:local`
Expected: 全部通过，重点确认既有的 `testColumnFlexTweetKeepsTranslationInsidePost`、`testClippedRedditPreviewUsesSingleSafeTranslationUnit`、`testRedditDetailTitleTranslationKeepsTitleSlotOrder`、`testStoppingTranslationClearsImmediateLoadingPlaceholder` 不回归。

- [ ] **Step 5: 提交**

```bash
git add content.js test/e2e-local-fixtures.js
git commit -m "修复流式期间锚点漂移导致的重复译文节点"
```

---

## Task 3: 同源文本局部去重，防止 React 重渲染后重复翻译

**Files:**
- Modify: `shared.js`（导出 `simpleHash`）
- Modify: `content.js`（`ensureTranslationNode` 写入源文本哈希；`isCandidateElement` 增加局部同源检查）
- Test: `test/e2e-local-fixtures.js`

- [ ] **Step 1: 写失败测试——重渲染丢标记后不重复翻译**

在 `test/e2e-local-fixtures.js` 新增：

```js
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
```

并在 `main()` 列表中 Task 2 新增行之后追加：

```js
    await testReRenderedTweetDoesNotDuplicateTranslation(browser);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx --yes --package playwright node test/e2e-local-fixtures.js`
Expected: 新测试处 AssertionError（nodes 为 2，requestCount 为 2）。

- [ ] **Step 3: 最小实现**

3a. `shared.js`：把内部已有的 `simpleHash`（713-720 行）加入导出对象 `api`（`isTranslationCacheEntryFresh,` 一行附近追加）：

```js
    simpleHash,
```

3b. `content.js` `ensureTranslationNode`（Task 2 修改后的版本）：在 `translationNodesByElement.set(element, node);` 之前加一行，给节点打上源文本哈希（已有哈希的收养节点不覆盖）：

```js
    if (!node.dataset.llmSourceHash) {
      node.dataset.llmSourceHash = LLMTranslatorShared.simpleHash(getTranslationText(element));
    }
```

3c. `content.js` 新增辅助函数（放在 `isCandidateElement` 之前）：

```js
  function findScopedDuplicateTranslationNode(element, text) {
    // React 重渲染会替换正文元素并丢失 data-llm-translator-* 标记，但译文节点常存活在原容器里。
    // 在最近的内容单元（推文/列表项/评论）范围内按源文本哈希查找已完成的译文，命中则不再重复翻译。
    const scope = element.closest?.("article,[role=\"article\"],li,blockquote,section,shreddit-post,shreddit-comment")
      || element.parentElement;
    if (!scope?.querySelector) return null;

    const hash = LLMTranslatorShared.simpleHash(text);
    return scope.querySelector(`.llm-bilingual-translation.is-done[data-llm-source-hash="${hash}"]`);
  }
```

3d. `content.js` `isCandidateElement`（946-971 行附近）：在文本长度检查之后插入同源检查：

```js
    const text = knownText === null ? getTranslationText(element, costSettings) : knownText;
    if (text.length < getMinimumCandidateTextLength(element) || text.length > costSettings.maxTextLength) return false;
    if (findScopedDuplicateTranslationNode(element, text)) return false;
```

说明：只匹配 `.is-done` 节点——loading/error 节点收养会带来旧元素的重试闭包问题，保持简单；范围限定在最近的内容单元，避免不同推文的相同短文本被互相去重。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm run check && npm run test:local && npm run test:shared`
Expected: 全部通过，重点确认 `testScanExtractsEachCandidateTextOnce`、`testDynamicContentTranslatesDuringContinuousMutations` 不回归。

- [ ] **Step 5: 提交**

```bash
git add shared.js content.js test/e2e-local-fixtures.js
git commit -m "同源文本局部去重，防止重渲染后的重复翻译"
```

---

## Task 4: 发布 0.10.2

**Files:**
- Modify: `content.js:2`（`CONTENT_SCRIPT_VERSION`）
- Modify: `manifest.json:5`、`package.json:3`、`package-lock.json`（version 字段）
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 更新版本号**

- `content.js:2`：`const CONTENT_SCRIPT_VERSION = "0.10.2";`（旧版本已注入的页面会收到刷新提示）
- `manifest.json`：`"version": "0.10.2"`
- `package.json`：`"version": "0.10.2"`
- 同步 lockfile：`npm install --package-lock-only`

- [ ] **Step 2: 更新 CHANGELOG（英文，风格对齐既有条目）**

在 `CHANGELOG.md` 顶部 `# Changelog` 之后插入：

```markdown
## 0.10.2

- Fixed duplicated translation blocks on X posts caused by insertion anchors drifting when layout clipping changed during streaming, and by React re-renders dropping translation markers.
- Restored per-element target-language skipping for Chinese/Japanese/Korean targets on mixed-language pages, so tweets already written in the target language no longer produce identical "translations".
- Added regression fixtures for mixed-language timelines, mid-stream clipping changes, and re-rendered posts.
```

- [ ] **Step 3: 全量验证**

Run: `npm test`
Expected: check、shared、background、ui、local、smoke 全部通过。

- [ ] **Step 4: 提交**

```bash
git add content.js manifest.json package.json package-lock.json CHANGELOG.md
git commit -m "发布 0.10.2 修复 X 重复翻译与目标语言误触发"
```

- [ ] **Step 5: 用户手动真实页面验证清单（Codex 无法执行，留给用户）**

在 Chrome 加载 unpacked 扩展后打开 `https://x.com/Prathkum/status/2079147944612368642`：

1. 英文推文/回复：每条只出现一个译文块，滚动、展开回复、来回滚动后仍不重复。
2. 中文推文/回复：不出现任何译文块。
3. 中英混排推文（英文为主、少量中文引用）：仍正常翻译。
4. 长推文（带 Show more）：译文块位置正常、不重复。

---

## 不做的事（防止过度设计）

- **不做**"译文与原文相同则隐藏"的兜底：Task 1 已在候选阶段消灭中文误触发，结果级兜底会掩盖真实的翻译失败。
- **不做** `setTranslation` 时的全局重复节点清理：Task 2/3 已阻止重复产生；对既有页面上的历史重复块，刷新页面即可。
- **不做**源语言信号（`hasSourceLanguageSignal`）的收紧：目标语言跳过恢复后已足够，收紧 latin 判定会影响混排内容的召回。
- **不改**翻译缓存：修复后中文段落根本不会进入请求管道，旧缓存条目自然失效（30 天 TTL）。

## 已知边界（可接受，不在本计划处理）

- 目标 zh 时，**纯汉字的日文标题**（无假名）会被当作"已是中文"跳过。这与非页面语言模式下的既有行为一致，不是本次修复引入的。
- 推文被**编辑后**重渲染（文本变化），旧译文块会残留成孤儿节点，新文本正常翻译。X 上极少见，出现时刷新即可。

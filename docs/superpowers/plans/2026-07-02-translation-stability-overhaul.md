# 翻译扩展稳定性结构修复计划（0.6.0）

> **For agentic workers (Codex):** 按任务顺序逐个执行。每个任务都是"先写失败测试 → 跑测试确认失败 → 最小实现 → 跑测试确认通过 → 提交"。步骤用 checkbox（`- [ ]`）跟踪。不要合并任务、不要顺手做计划外的重构。

**Goal:** 一次性消除 0.5.1–0.5.6 六个版本反复出现的四类问题的结构性根因：长页面卡顿、触发翻译反馈慢、Reddit 标题/顺序类布局 bug、部分批次翻译失败。

**Execution status (2026-07-02):** Task 1–7 的代码改动、版本更新、CHANGELOG 与自动化验证已完成；Task 7 Step 5 是需要在用户 Chrome 里手动确认的真实页面清单。根据后续 Reddit 实测反馈，0.6.0 额外加入了连续 DOM mutation 下动态扫描不再无限延后的修复。

**Architecture:** 不引入新依赖、不拆分文件、不做插件化。改动集中在 content.js（扫描管道有界化 + 文本提取缓存 + slot 通用继承）、background.js（JSON 对象级容错解析 + 缺失子集重试 + 注入去重）、shared.js（导出一个已有函数）。每个修复都配可复现的回归测试。

**Tech Stack:** Chrome MV3 扩展原生 JS，测试用现有的 Node + Playwright 自建 harness（`test/e2e-local-fixtures.js`、`test/background.test.js`）。

---

## 背景：为什么修了六个版本还没修好（根因分析）

之前每一轮修复都在"降常数"或"加特例"，没有动到下面五个结构性根因。文件行号以 0.5.6（commit b8f2f74）为准。

### 根因 1：视口扫描空结果时静默回退到"全页 TreeWalker"（卡顿的主根源）

`content.js:342-345`（`collectCandidateElements`）：

```js
if (costSettings.viewportOnly && !options.immediateViewportOnly) {
  const viewportCandidates = collectViewportCandidateElements(scanRoot, costSettings, maxResults);
  if (viewportCandidates.length > 0) return viewportCandidates;   // ← 只有非空才提前返回
}
// 空结果时继续往下走：全页 TreeWalker
```

**触发链**：视口内容全部翻译完（或全部被过滤）后，采样和选择器两条路都返回 0 个候选 → 落进全页 TreeWalker。而滚动 / 鼠标移动每 300ms debounce 就触发一次 `scanViewport`（`content.js:1350-1356`），所以**页面翻译完之后，每次滚动都在全页遍历**。这正是"翻译之后滚动还卡"的原因。

雪上加霜的是 `findReadableBlock`（`content.js:772`）对**每个祖先无条件**调用 `getCleanText(current)`——递归遍历整棵子树、每个后代元素一次 `getComputedStyle`（`isElementVisibleForTextExtraction`）+ `getBoundingClientRect`（`isAssistiveOnlyElement`）。在 Reddit 长评论页上是 O(全页文本 × 祖先深度) 的同步主线程工作。

同一层还有第二条 O(全页) 路径：采样落空后的选择器兜底 `collectSelectorViewportCandidateElements`（`content.js:446-466`）对 `scanRoot` 里**所有**可读块逐个 `getBoundingClientRect` 判断是否在视口附近——8000 条评论就是 1.6 万个段落的布局读取，同样发生在每次滚动扫描里。

0.5.1 只是让"第一次扫描"优先走视口路径，0.5.2 只是缓存了 `elementsFromPoint`——都没有删掉这两条兜底路径。

### 根因 2：`getCleanText` 无缓存且被同一元素反复调用（卡顿的次根源 + O(n²)）

同一个元素在一次扫描管道里会被 `getCleanText` 4–6 次：候选判定（`isCandidateElement`）、入队（`enqueueElement`）、**每次入队都对整个队列 reduce 一遍**（`shouldFlushQueueNow` → `getQueuedTextLength`，`content.js:1460-1462`，入队 N 个元素 = O(N²) 次全量文本提取）、取批（`takeNextBatchElements`）、发请求（`translateBatchElements`）、退预算（`releaseReservedBudget`）。每次调用都是递归 DOM 遍历 + 逐元素样式读取。

### 根因 3：手动触发后首个批次要等 700ms 定时器 + 触发前同步做语言采样

- `enqueueElement`（`content.js:1443`）：队列不满 `batchSize`（默认 8）时固定等 700ms 才发第一批。右键翻译通常只立即入队 ≤4 个元素，永远吃满这 700ms。
- `startTranslation`（`content.js:195`）在显示任何 loading 之前同步执行 `refreshPageLanguageContext` ——和扫描一样昂贵的视口采样 + 文本提取。Reddit 的 `<html lang="en-US">` 本可以直接判定"不是目标语言页面"，完全跳过采样（`shared.js` 的 `normalizeTargetLanguageKind` 能做这个判断但没导出）。
- `ensureContentScript`（`background.js:253-258`）在**每次**动作（含每次切换标签页的自动翻译检查）都 `executeScript` 重新注入 shared.js + content.js（约 120KB 解析），尽管 manifest 已经声明了 content_scripts 自动注入。

0.5.6 修掉了 settings 二次读取，但以上三项都还在。MV3 Service Worker 冷启动是额外的固定开销，无法消除，只能减少其余环节。

### 根因 4：Reddit 类布局 bug 源自"通用过滤器 vs 站点特例"的对抗结构

标题被 `isShortLowInformationLinkText` 这类通用过滤器误杀 → 加 Reddit 特例（0.5.4）→ 漏了详情页 `<h1 slot="title">` 变体 → 再补（0.5.5）。同一份 Reddit 选择器字符串在 `findRedditPostTitleElement`、`isRedditPostTitleElement`、`getViewportReadableBlockSelector` 三处重复手写，改一处漏一处。更根本的：`syncTranslationSlot`（`content.js:1895-1906`）**逐个枚举**已知 slot（title / text-body），下一个带 slot 的 Reddit 组件出现时必然再犯。正确做法是译文节点无条件继承插入目标自身的 `slot` 属性——这能消灭整类 shadow DOM 投影顺序 bug。

### 根因 5：翻译协议"整批 JSON 数组"是脆弱的，坏一个对象整批失败

`parseTranslationJson`（`background.js:1152`）把模型返回当作一个整体 parse；0.5.3 的 `repairCommonTranslationJson` 只能修"漏逗号/尾逗号"，修不了 LLM 更常见的**字符串内未转义引号/换行**。parse 失败 → 整批 throw → 该批所有段落显示"翻译失败"。这就是"部分成功部分失败"的来源。缺两级降级：(a) 对象级容错提取——只丢弃坏对象；(b) 对缺失的段落子集重试一次。

### 症状 → 根因 → 任务对照

| 用户症状 | 根因 | 任务 |
|---|---|---|
| 翻译后滚动仍卡顿、长任务 | 根因 1 + 2 | Task 1、Task 2 |
| 触发后很久才出现"翻译中" | 根因 3 | Task 3、Task 4 |
| 标题不翻译 / 标题正文顺序颠倒 | 根因 4 | Task 5 |
| 部分段落报 JSON 解析错误 | 根因 5 | Task 6 |

---

## 文件结构（本计划涉及的全部文件）

| 文件 | 变更 |
|---|---|
| `content.js` | Task 1（扫描有界化）、Task 2（文本缓存）、Task 3（快速首批 + lang 快速路径）、Task 5（slot 继承 + 选择器常量） |
| `background.js` | Task 4（注入去重）、Task 6（容错解析 + 子集重试） |
| `shared.js` | Task 3（导出 `normalizeTargetLanguageKind`） |
| `test/e2e-local-fixtures.js` | Task 1/2/3/5 的回归测试 + harness 新增 `countStyleReads` 选项 |
| `test/background.test.js` | Task 4/6 的回归测试 |
| `manifest.json` / `package.json` / `package-lock.json` / `CHANGELOG.md` | Task 7 发布 0.6.0 |

不拆分 content.js、不新建文件、不引入依赖。

**通用约定**：
- content.js 相关任务的验证命令：`npm run check && npm run test:local`
- background.js 相关任务的验证命令：`npm run check && npm run test:background`
- 新测试注册方式：两个测试文件顶部都有一个顺序调用所有测试函数的 runner（`e2e-local-fixtures.js` 是对每个 test 函数 `await testXxx(browser);`，`background.test.js` 的 `main()` 是 `await testXxx();`），把新函数按同样格式追加到列表末尾。
- 性能阈值测试：计划中给出的阈值是按代码路径估算的。如果实测数值与阈值有出入，以"修复前必然失败、修复后留 2 倍余量稳定通过"为准微调阈值，并在断言消息里保留实测参考值。

---

## Task 1: 删除视口模式的全页 TreeWalker 兜底，并给保留的 TreeWalker 路径加硬上限

**Files:**
- Modify: `content.js`（`collectCandidateElements`、`findReadableBlock`、`addImmediateViewportCandidate`）
- Test: `test/e2e-local-fixtures.js`

- [ ] **Step 1: 写失败测试——已翻译视口的滚动扫描不允许全页遍历**

在 `test/e2e-local-fixtures.js` 中新增（复用现有 `testLongRedditThreadDoesNotFullWalkComments` 的 fixture 结构）：

```js
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

  // 第一轮扫描并等待视口内翻译完成
  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(1500);

  const result = await page.evaluate(async () => {
    // 视口已全部翻译，重置计数器后模拟小幅滚动（视口重叠，不触发 cancelPendingViewportWork）
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
```

并在测试 runner 列表中按现有格式注册 `await testTranslatedViewportScrollScanDoesNotFullWalk(browser);`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:local`
Expected: 新测试 FAIL（`treeWalkerNextCalls` 大于 0——现在的代码会回退全页 TreeWalker）。

- [ ] **Step 3: 实现——视口模式不再兜底 + TreeWalker 硬上限 + 惰性取文本**

3a. `collectCandidateElements` 中（现 `content.js:342-345`）：

```js
    if (costSettings.viewportOnly && !options.immediateViewportOnly) {
      // 视口模式两条候选路径（采样/选择器）都为空时说明视口内没有新内容，
      // 不再回退全页 TreeWalker——已翻译页面上的滚动扫描曾因此反复产生长任务卡顿。
      return collectViewportCandidateElements(scanRoot, costSettings, maxResults);
    }
```

3b. 同函数的 TreeWalker 循环（现 `content.js:359-378`）加硬上限，保证 `viewportOnly=false` 或手动触发兜底路径的最坏情况有界：

```js
    // 保留的 TreeWalker 路径（关闭视口模式 / 手动触发兜底）也必须有界，防止超长页面单次遍历卡死主线程。
    const maxWalkedTextNodes = 1500;
    let walkedTextNodes = 0;
    let textNode = walker.nextNode();
    while (textNode) {
      walkedTextNodes += 1;
      if (walkedTextNodes > maxWalkedTextNodes) break;
      const block = findReadableBlock(textNode.parentElement, costSettings);
      // ……循环体其余部分不变……
```

3c. `findReadableBlock`（现 `content.js:760-798`）删掉每层祖先无条件的 `const text = getCleanText(current);`，只在评估 fallback 时取文本：

```js
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.closest?.(".llm-bilingual-translation")) return null;
      if (hasBlockedAncestor(current)) return null;

      const tagName = current.tagName;
      const siteSpecificBlock = findSiteSpecificReadableBlock(current);

      if (siteSpecificBlock) {
        return siteSpecificBlock;
      }

      if (isSemanticBlockTag(tagName)) {
        if ((tagName === "TD" || tagName === "TH") && inlineFallback) {
          return inlineFallback;
        }
        return current;
      }

      // getCleanText 会递归整棵子树，只有真的要评估 fallback 时才取文本。
      if (!inlineFallback && isInlineFallbackTag(tagName)
        && isUsefulInlineBlock(current, getCleanText(current), costSettings)) {
        inlineFallback = current;
      }

      if (!genericFallback && isGenericBlockTag(tagName)
        && isUsefulGenericBlock(current, getCleanText(current), costSettings)) {
        genericFallback = current;
      }

      current = current.parentElement;
    }
```

3d. `addImmediateViewportCandidate`（现 `content.js:610-622`）做两件事：把"已有状态"的廉价检查提到取文本之前（已翻译的块不再付出整段文本提取），并**返回"是否命中了可读块"**供 3e 的门控使用：

```js
  function addImmediateViewportCandidate(element, candidates, seenTexts, costSettings) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return false;

    const block = findImmediateReadableBlock(element, costSettings);
    if (!block) return false;
    if (candidates.has(block) || block.dataset.llmTranslatorStatus) return true;
    if (!isElementInActiveViewport(block)) return true;

    const text = getCleanText(block);
    const textKey = text.toLowerCase();
    if (seenTexts.has(textKey) || !isCandidateElement(block, costSettings, text)) return true;

    seenTexts.add(textKey);
    candidates.set(block, text);
    return true;
  }
```

（其余调用点 `collectImmediateViewportCandidateElements`、`addImmediateReadableBlockCandidates` 忽略返回值即可，无需改动。）

3e. 采样"命中过可读块但全被翻译/过滤"时跳过选择器兜底——这是滚动扫描第二条 O(全页) 布局读取路径。改 `collectViewportCandidateElements` / `collectSampledViewportCandidateElements` / `addLocalViewportCandidateElements`：

```js
  function collectViewportCandidateElements(scanRoot, costSettings, maxResults) {
    const sampled = collectSampledViewportCandidateElements(scanRoot, costSettings, maxResults);
    if (sampled.candidates.length > 0) return sampled.candidates;

    // 采样已经命中可读块（只是全被翻译/过滤）说明视口没有新内容，
    // 跳过选择器兜底，避免对长页面全部可读块逐个测量布局。
    if (sampled.sawReadableBlock) return [];

    return collectSelectorViewportCandidateElements(scanRoot, costSettings, maxResults);
  }

  function collectSampledViewportCandidateElements(scanRoot, costSettings, maxResults) {
    const candidates = new Map();
    const seenTexts = new Set();
    let sawReadableBlock = false;

    if (typeof document.elementsFromPoint !== "function") {
      return { candidates: [], sawReadableBlock };
    }

    for (const element of getViewportSampleElements(scanRoot)) {
      if (addImmediateViewportCandidate(element, candidates, seenTexts, costSettings)) {
        sawReadableBlock = true;
      }
      if (addLocalViewportCandidateElements(element, scanRoot, candidates, seenTexts, costSettings, maxResults)) {
        sawReadableBlock = true;
      }
    }

    return { candidates: formatCandidateEntries(candidates, maxResults), sawReadableBlock };
  }

  function addLocalViewportCandidateElements(element, scanRoot, candidates, seenTexts, costSettings, maxResults) {
    if (candidates.size >= maxResults) return false;

    const localScope = getLocalReadableScope(element, scanRoot);
    if (!localScope) return false;

    let sawReadableBlock = false;
    const elements = localScope.querySelectorAll?.(getViewportReadableBlockSelector()) || [];
    for (const candidate of elements) {
      if (candidates.size >= maxResults) break;
      if (addImmediateViewportCandidate(candidate, candidates, seenTexts, costSettings)) {
        sawReadableBlock = true;
      }
    }

    return sawReadableBlock;
  }
```

3f. `collectSelectorViewportCandidateElements`（采样完全落空时才会运行）加"已处理跳过 + 检查数硬上限"，沿用 `addImmediateReadableBlockCandidates` 已有的 `maxInspected` 模式：

```js
  function collectSelectorViewportCandidateElements(scanRoot, costSettings, maxResults) {
    const candidates = new Map();
    const seenTexts = new Set();
    const elements = scanRoot.querySelectorAll?.(getViewportReadableBlockSelector()) || [];
    // 只在采样完全落空时运行，布局测量数量必须有硬上限，避免长页面逐块测量。
    let inspected = 0;
    const maxInspected = Math.max(200, maxResults * 30);

    for (const element of elements) {
      if (inspected >= maxInspected) break;
      if (element.dataset.llmTranslatorStatus) continue;
      inspected += 1;
      if (!isElementNearActiveViewport(element)) continue;

      const block = findImmediateReadableBlock(element, costSettings);
      if (!block || candidates.has(block) || !isElementNearActiveViewport(block)) continue;

      const text = getCleanText(block);
      const textKey = text.toLowerCase();
      if (seenTexts.has(textKey) || !isCandidateElement(block, costSettings, text)) continue;

      seenTexts.add(textKey);
      candidates.set(block, text);
    }

    return formatCandidateEntries(candidates, maxResults);
  }
```

- [ ] **Step 4: 跑测试确认通过（含全部既有回归）**

Run: `npm run check && npm run test:local`
Expected: 新测试 PASS，`testLongRedditThreadDoesNotFullWalkComments` 等既有测试全部 PASS。

- [ ] **Step 5: 跑真实站点采样回归（覆盖率保险）**

Run: `npm run test:samples`
Expected: PASS。此命令用真实站点快照验证候选覆盖率——它是"去掉 TreeWalker 兜底后个别站点漏翻"这一风险的守门员。如有站点覆盖率下降，不要恢复全页兜底，改为向 `getViewportReadableBlockSelector` 增补该站点的块选择器。

- [ ] **Step 6: 提交**

```bash
git add content.js test/e2e-local-fixtures.js
git commit -m "perf: remove full-page TreeWalker fallback from viewport scans"
```

---

## Task 2: getCleanText 结果缓存（WeakMap + 变更纪元）

**Files:**
- Modify: `content.js`（`state` 附近新增缓存、`getCleanText` 改名包装、`startDynamicObserver`）
- Test: `test/e2e-local-fixtures.js`（harness 新增 `countStyleReads`）

- [ ] **Step 1: harness 增加样式读取计数选项**

在 `createHarnessPage` 中、`options.countLayoutReads` 分支之后新增：

```js
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
```

- [ ] **Step 2: 写失败测试——一次扫描内同一元素的文本只提取一次**

```js
async function testScanExtractsEachCandidateTextOnce(browser) {
  // getCleanText 递归子树并逐元素读样式；修复前同一候选在一次扫描里被提取 4-6 次，
  // 且每次入队还会对整个队列全量重算（O(n²)）。
  const paragraphs = Array.from({ length: 24 }, (_, index) => `
    <p>Paragraph ${index + 1} contains enough English words to qualify as a translation candidate for the scan.</p>
  `).join("");

  const page = await createHarnessPage(browser, {
    countStyleReads: true,
    maxElementsPerScan: 24,
    html: `<main><article>${paragraphs}</article></main>`
  });

  await page.evaluate(() => window.__sendContentMessage({ action: "scan_current_area" }));
  await page.waitForTimeout(1200);

  const styleCalls = await page.evaluate(() => window.__styleCalls);
  // 修复前：每个候选被重复提取 4-6 次 + 入队 O(n²) 全队列重算，24 个候选下样式读取远超此阈值。
  assert.ok(styleCalls < 400, `一次扫描的样式读取应有界（文本提取去重后），实际 ${styleCalls} 次`);

  await page.close();
}
```

注册到 runner。阈值按"修复后 ≈ 每个候选提取一次 × 每次约 6 次样式读取 + 采样开销"估算，遵循开头的阈值校准约定。

- [ ] **Step 3: 跑测试确认失败**

Run: `npm run test:local`
Expected: 新测试 FAIL（修复前重复提取导致样式读取远超阈值）。

- [ ] **Step 4: 实现缓存**

4a. 在 `content.js` 的 `window.__llmBilingualTranslator = state;` 之后新增：

```js
  // getCleanText 很贵（递归子树 + 逐元素读样式），同一元素在一次扫描里会被多处调用；
  // 缓存到下一次 DOM 变更为止，MutationObserver 里统一失效。
  const cleanTextCache = new WeakMap();
  let cleanTextEpoch = 0;

  function invalidateCleanTextCache() {
    cleanTextEpoch += 1;
  }
```

4b. 把现有 `getCleanText` 函数体整体改名为 `computeCleanText`，新的 `getCleanText` 为：

```js
  function getCleanText(element) {
    const cached = cleanTextCache.get(element);
    if (cached && cached.epoch === cleanTextEpoch) return cached.text;

    const text = computeCleanText(element);
    cleanTextCache.set(element, { epoch: cleanTextEpoch, text });
    return text;
  }
```

4c. `startDynamicObserver` 的 MutationObserver 回调开头加一行（自己插入译文节点也会触发失效，代价只是偶尔一次重算，换来永远正确）：

```js
    state.mutationObserver = new MutationObserver((mutations) => {
      if (!state.active) return;

      invalidateCleanTextCache();

      for (const mutation of mutations) {
        // ……原逻辑不变……
```

已知取舍（可接受，不需要处理）：翻译未激活时的 DOM 变更、以及不触发 attribute 变更的纯 CSS 可见性变化，可能让缓存短暂过期——影响只是个别候选文本略旧，下一次变更纪元即自愈。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run check && npm run test:local`
Expected: 全部 PASS（含 Task 1 的滚动扫描测试——缓存让它的 rectCalls 进一步下降）。

- [ ] **Step 6: 提交**

```bash
git add content.js test/e2e-local-fixtures.js
git commit -m "perf: cache getCleanText per element until DOM mutation"
```

---

## Task 3: 手动触发快速首批 + html[lang] 语言检测快速路径

**Files:**
- Modify: `content.js`（`state`、`startTranslation`、`scanCurrentArea`、`enqueueElement`、`refreshPageLanguageContext`）
- Modify: `shared.js`（导出 `normalizeTargetLanguageKind`）
- Test: `test/e2e-local-fixtures.js`

- [ ] **Step 1: 写失败测试 A——触发后首批不等 700ms**

```js
async function testManualTriggerFlushesFirstBatchQuickly(browser) {
  // 首批不足 batchSize 时，修复前固定等 700ms 才发请求；手动触发应在 ~120ms 内发出。
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
```

- [ ] **Step 2: 写失败测试 B——html[lang] 与目标语言不同的页面跳过采样直接翻译**

```js
async function testHtmlLangFastPathTrustsDeclaredForeignLanguage(browser) {
  // 页面声明 lang=en 而目标是中文：应信任声明直接进入翻译，不再做昂贵的视口文本采样。
  // 正文全用中文——修复前采样会把它误判成"已是目标语言页"而 skipped，修复后信任 lang 声明不跳过。
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
```

两个测试都注册到 runner。

- [ ] **Step 3: 跑测试确认失败**

Run: `npm run test:local`
Expected: 测试 A FAIL（450ms 时还没有 done）；测试 B FAIL（采样把中文正文判成目标语言页，`skipped === true`）。

- [ ] **Step 4: 实现**

4a. `shared.js`：把已有的内部函数 `normalizeTargetLanguageKind` 加入导出 `api` 对象（一行）：

```js
    normalizeTargetLanguageKind,
```

4b. `content.js` 的 `state` 初始化中加一项：

```js
    fastFlushUntil: 0,
```

4c. `startTranslation` 中，`state.active = true;` 之后加：

```js
    // 触发后的头几秒用短 debounce 发首批，让用户尽快看到第一段译文。
    state.fastFlushUntil = Date.now() + 3000;
```

`scanCurrentArea` 中，`setTranslationVisibility(true);` 之前加同一行：

```js
    state.fastFlushUntil = Date.now() + 3000;
```

4d. `enqueueElement` 末尾的定时器改为：

```js
    clearTimeout(state.flushTimer);
    state.flushTimer = setTimeout(flushQueue, Date.now() < state.fastFlushUntil ? 120 : 700);
```

4e. `refreshPageLanguageContext` 开头加快速路径：

```js
  function refreshPageLanguageContext(settings) {
    // html[lang] 与目标语言明显不同（如 Reddit lang="en-US" → 目标中文）时直接判定需要翻译，
    // 跳过昂贵的视口文本采样；lang 缺失或与目标同族时仍走采样。
    const htmlKind = LLMTranslatorShared.normalizeTargetLanguageKind(document.documentElement.lang || "");
    const targetKind = LLMTranslatorShared.normalizeTargetLanguageKind(settings?.targetLanguage);
    if (htmlKind && targetKind && htmlKind !== targetKind) {
      state.pageLanguageContext = {
        isTargetLanguagePage: false,
        checkedAt: Date.now(),
        segmentCount: 0
      };
      return state.pageLanguageContext;
    }

    // ……原采样逻辑不变……
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run check && npm run test:local && npm run test:shared`
Expected: 全部 PASS。注意检查既有的"目标语言页跳过"类测试仍通过（它们要么不设置 htmlLang，要么 lang 与目标同族，不会进快速路径）。

- [ ] **Step 6: 提交**

```bash
git add content.js shared.js test/e2e-local-fixtures.js
git commit -m "perf: fast first batch flush and html lang fast path for manual triggers"
```

---

## Task 4: content script 注入去重（每个标签页每个 SW 生命周期只注入一次）

**Files:**
- Modify: `background.js`（`ensureContentScript`、`chrome.tabs.onUpdated`、`chrome.tabs.onRemoved`）
- Test: `test/background.test.js`

- [ ] **Step 1: 写失败测试**

```js
async function testEnsureContentScriptInjectsOncePerTabLifetime() {
  const context = createBackgroundContext({
    sendMessage: async () => ({ ok: true, count: 0, stats: {} })
  });
  loadBackground(context);

  const tab = { id: 71, url: "https://example.com/page" };
  await sendRuntimeMessage(context, { action: "scan_current_area", tab });
  await sendRuntimeMessage(context, { action: "scan_current_area", tab });
  assert.strictEqual(context.scriptingCalls.length, 1, "同一标签页重复动作不应重复注入 content script");

  // 页面重新加载后需要重新注入
  context.tabsOnUpdatedListener(71, { status: "loading" }, tab);
  await sendRuntimeMessage(context, { action: "scan_current_area", tab });
  assert.strictEqual(context.scriptingCalls.length, 2, "页面重新加载后应重新注入");
}
```

注册到 `main()`。如果 `createBackgroundContext` 的 mock 里 `chrome.tabs.onRemoved.addListener` 是空实现（`addListener() {}`），保持不动即可——本测试不依赖它。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:background`
Expected: FAIL（现在每次动作都注入，`scriptingCalls.length` 为 2/3）。

- [ ] **Step 3: 实现**

3a. `background.js` 顶部常量区加：

```js
const injectedTabs = new Set();
```

3b. `ensureContentScript` 改为：

```js
async function ensureContentScript(tabId) {
  // manifest 已在 document_idle 自动注入；这里只兜底"安装/更新前就已打开的标签页"，
  // 且每个标签页每个 Service Worker 生命周期只注入一次（content.js 自带版本守卫，重复注入也安全）。
  if (injectedTabs.has(tabId)) return;

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["shared.js", "content.js"]
  });
  injectedTabs.add(tabId);
}
```

3c. 现有 `chrome.tabs.onUpdated` 监听器（`background.js:200-205`）的 loading 分支中加：

```js
    injectedTabs.delete(tabId);
```

现有 `chrome.tabs.onRemoved` 监听器（`background.js:187-190`）中加：

```js
  injectedTabs.delete(tabId);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npm run check && npm run test:background`
Expected: 全部 PASS（既有测试每个都新建 context，不受影响）。

- [ ] **Step 5: 提交**

```bash
git add background.js test/background.test.js
git commit -m "perf: inject content script once per tab per worker lifetime"
```

---

## Task 5: 译文 slot 通用继承 + 站点选择器常量去重

**Files:**
- Modify: `content.js`（`syncTranslationSlot`、站点选择器常量、`findRedditPostTitleElement`、`isRedditPostTitleElement`、`findRedditTextBodyElement`、`isRedditTextBodyElement`、`findArticleHeadlineLinkElement`、`isArticleHeadlineLinkElement`、`getViewportReadableBlockSelector`）
- Test: `test/e2e-local-fixtures.js`

- [ ] **Step 1: 写失败测试——译文继承插入目标的任意 slot**

```js
async function testTranslationInheritsInsertionTargetSlot(browser) {
  // 0.5.5 只修了 title/text-body 两个已知 slot；任何带 slot 的宿主子元素都必须让译文继承同名 slot，
  // 否则译文会被投影到 shadow DOM 默认插槽，视觉顺序错乱（0.5.4/0.5.5 的整类 bug）。
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
```

注册到 runner。

- [ ] **Step 2: 跑测试确认失败**

Run: `npm run test:local`
Expected: 新测试 FAIL（现在 `syncTranslationSlot` 只认识 title/text-body，未知 slot 被 `removeAttribute`，返回 `null`）。

- [ ] **Step 3: 实现 slot 继承**

`syncTranslationSlot`（现 `content.js:1895-1906`）整体替换为：

```js
  function syncTranslationSlot(node, insertionTarget) {
    // 宿主是自定义元素（shadow DOM）时，译文必须继承插入目标自身的 slot，
    // 否则会被投影到默认插槽造成顺序错乱；对普通元素 slot 属性是惰性的，无副作用。
    const slot = insertionTarget?.getAttribute?.("slot");
    if (slot) {
      node.setAttribute("slot", slot);
    } else {
      node.removeAttribute("slot");
    }
  }
```

行为核对（都有既有测试护航）：feed 标题 `a[slot="title"]` → 继承 title ✓；详情页 `h1[slot="title"][id^=post-title-]` → 继承 title ✓；正文插入目标 `a[slot="text-body"]` → 继承 text-body ✓；HN `.titleline`（无 slot）→ 移除 ✓。唯一行为变化：无 slot 属性的插入目标不再被强行标成 title/text-body——它们本来就投影在默认插槽，译文跟着原文走才是对的。

- [ ] **Step 4: 站点选择器常量去重**

在 `SITE_HEURISTICS` 定义之后新增常量（消除同一选择器串在 3 处手写导致的"改一漏一"）：

```js
  // Reddit / 通用文章标题的站点选择器只在这里定义一份；
  // 候选识别、插入定位、视口选择器都从这里派生，新增站点变体只改这一处。
  const REDDIT_TITLE_SELECTORS = [
    "a[slot=\"title\"][href]",
    "[slot=\"title\"][id^=\"post-title-\"]",
    "[id^=\"post-title-\"][href]"
  ];
  const REDDIT_TEXT_BODY_SELECTORS = [
    "shreddit-post-text-body",
    "[property=\"schema:articleBody\"][id$=\"-post-rtjson-content\"]",
    ".feed-card-text-preview"
  ];
  const ARTICLE_HEADLINE_LINK_SELECTORS = [
    "a[class*=\"headline\" i][href]",
    "a[class*=\"title\" i][href]",
    "a[data-testid*=\"headline\" i][href]",
    "a[data-testid*=\"title\" i][href]"
  ];
```

替换以下函数中的内联选择器串（逻辑不变，只是引用常量）：

```js
  function findRedditPostTitleElement(element) {
    if (!element?.closest) return null;
    const post = element.closest("shreddit-post");
    if (!post) return null;

    return element.closest(REDDIT_TITLE_SELECTORS.join(","));
  }

  function isRedditPostTitleElement(element) {
    if (!element?.matches) return false;
    return !!element.closest("shreddit-post")
      && element.matches(REDDIT_TITLE_SELECTORS.join(","));
  }

  function findRedditTextBodyElement(element) {
    if (!element?.closest) return null;
    const post = element.closest("shreddit-post");
    if (!post) return null;

    return element.closest(REDDIT_TEXT_BODY_SELECTORS.join(","));
  }

  function isRedditTextBodyElement(element) {
    if (!element?.matches) return false;
    return !!element.closest("shreddit-post")
      && element.matches(REDDIT_TEXT_BODY_SELECTORS.join(","));
  }

  function findArticleHeadlineLinkElement(element) {
    if (!element?.closest) return null;
    const article = element.closest("article,[role=\"article\"]");
    if (!article) return null;

    const link = element.closest(ARTICLE_HEADLINE_LINK_SELECTORS.join(","));
    if (!link || !article.contains(link)) return null;

    return link;
  }

  function isArticleHeadlineLinkElement(element) {
    if (!element?.matches) return false;
    return !!element.closest("article,[role=\"article\"]")
      && element.matches(ARTICLE_HEADLINE_LINK_SELECTORS.join(","));
  }
```

`getViewportReadableBlockSelector` 改为从常量派生（Reddit 标题三个变体自动带上；文章标题多出的 data-testid 两个变体是良性的覆盖增强）：

```js
  function getViewportReadableBlockSelector() {
    return [
      LLMTranslatorShared.getCandidateSelector(),
      "[data-testid=\"tweetText\"]",
      ...ARTICLE_HEADLINE_LINK_SELECTORS.flatMap((selector) => [
        `article ${selector}`,
        `[role="article"] ${selector}`
      ]),
      ...REDDIT_TITLE_SELECTORS.map((selector) => `shreddit-post ${selector}`),
      ...REDDIT_TEXT_BODY_SELECTORS,
      "tr.athing td.title .titleline a[href]"
    ].join(",");
  }
```

注意 `findRedditTextBodyElement` 原实现是 `closest("shreddit-post-text-body") || closest(其余两个)`——合并成一个 `closest` 后匹配优先级由 DOM 层级决定（`closest` 取最近祖先）。原顺序的意图是"外层容器优先"，合并后对既有 fixture 行为一致（有既有测试 `shreddit-post-text-body > .llm-bilingual-translation` 断言护航）；如 `npm run test:local` 出现差异，恢复为两段 `closest` 但选择器仍引用常量。

- [ ] **Step 5: 跑测试确认通过**

Run: `npm run check && npm run test:local && npm run test:samples`
Expected: 全部 PASS——0.5.4/0.5.5 的 Reddit 标题、slot 顺序、元数据过滤既有测试是这次重构的安全网。

- [ ] **Step 6: 提交**

```bash
git add content.js test/e2e-local-fixtures.js
git commit -m "fix: inherit insertion target slot and deduplicate site selectors"
```

---

## Task 6: 翻译返回容错——对象级降级解析 + 缺失子集重试一次

**Files:**
- Modify: `background.js`（`parseTranslationJson`、新增 `extractTranslationObjects` / `findBalancedObjectEnd` / `retryMissingSegmentsOnce`、`translateBatch`）
- Test: `test/background.test.js`

- [ ] **Step 1: 写失败测试 A——坏对象只影响自己，缺失段落自动补一枪**

```js
async function testTranslateBatchSalvagesMalformedObjectAndRetriesMissing() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      if (fetchCalls.length === 1) {
        // b 的字符串里有未转义引号：整体 parse 和逗号修复都救不回来
        return {
          ok: true,
          async json() {
            return {
              choices: [{ message: { content:
                '[{"id":"seg-a","text":"甲译文"},{"id":"seg-b","text":"乙"坏"},{"id":"seg-c","text":"丙译文"}]'
              } }]
            };
          }
        };
      }
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify([{ id: "seg-b", text: "乙译文" }]) } }]
          };
        }
      };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [
      { id: "seg-a", text: "First paragraph." },
      { id: "seg-b", text: "Second paragraph." },
      { id: "seg-c", text: "Third paragraph." }
    ]
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(fetchCalls.length, 2, "缺失段落应恰好补发一次请求");
  const retryPrompt = JSON.parse(fetchCalls[1].options.body).messages[1].content;
  assert.match(retryPrompt, /Second paragraph/);
  assert.doesNotMatch(retryPrompt, /First paragraph/, "重试请求只应包含缺失的段落");

  const byId = Object.fromEntries(response.results.map((result) => [result.id, result]));
  assert.strictEqual(byId["seg-a"].text, "甲译文");
  assert.strictEqual(byId["seg-b"].text, "乙译文");
  assert.strictEqual(byId["seg-c"].text, "丙译文");
}
```

- [ ] **Step 2: 写失败测试 B——只重试一次，不无限补枪**

```js
async function testTranslateBatchRetriesMissingSegmentsOnlyOnce() {
  const fetchCalls = [];
  const context = createBackgroundContext({
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      // 模型始终只返回 seg-a 的译文，seg-b 永远缺失
      return {
        ok: true,
        async json() {
          return {
            choices: [{ message: { content: JSON.stringify([{ id: "seg-a", text: "甲译文" }]) } }]
          };
        }
      };
    }
  });

  loadBackground(context);

  const response = await sendRuntimeMessage(context, {
    action: "translate_batch",
    items: [
      { id: "seg-a", text: "First paragraph." },
      { id: "seg-b", text: "Second paragraph." }
    ]
  });

  assert.strictEqual(response.ok, true);
  assert.strictEqual(fetchCalls.length, 2, "缺失子集只允许重试一次");
  const byId = Object.fromEntries(response.results.map((result) => [result.id, result]));
  assert.strictEqual(byId["seg-a"].text, "甲译文");
  assert.ok(byId["seg-b"].error, "重试后仍缺失的段落保持错误状态");
}
```

两个测试注册到 `main()`。

- [ ] **Step 3: 跑测试确认失败**

Run: `npm run test:background`
Expected: 测试 A FAIL（整批 parse 失败，所有段落报错、只有 1 次 fetch）；测试 B FAIL（缺失段落不重试，只有 1 次 fetch）。

- [ ] **Step 4: 实现对象级降级解析**

4a. `parseTranslationJson` 在 throw 之前加最后一级降级：

```js
  const salvaged = extractTranslationObjects(cleaned);
  if (salvaged.length > 0) return salvaged;

  const message = errors[0]?.message || t("errorUnknown", [], "未知错误");
  throw new Error(t("errorParseJson", [message], `无法解析模型返回的 JSON：${message}`));
```

4b. 新增两个函数（放在 `repairCommonTranslationJson` 之后）：

```js
function extractTranslationObjects(content) {
  // 整体 JSON 解析失败后的兜底：逐个提取平铺的 {"id":...,"text":...} 对象，
  // 坏对象只丢弃自己；未转义引号等破坏结构时从下一个 "{" 重新同步。
  const text = String(content || "");
  const results = [];
  const seenIds = new Set();
  let index = 0;

  while (index < text.length) {
    const start = text.indexOf("{", index);
    if (start < 0) break;

    const end = findBalancedObjectEnd(text, start);
    const parsed = end > start ? tryParseJson(text.slice(start, end + 1)) : { ok: false };
    const value = parsed.ok ? parsed.value : null;

    if (value
      && typeof value === "object"
      && value.id !== undefined
      && typeof value.text === "string"
      && !seenIds.has(String(value.id))) {
      seenIds.add(String(value.id));
      results.push({ id: value.id, text: value.text });
      index = end + 1;
    } else {
      index = start + 1;
    }
  }

  return results;
}

function findBalancedObjectEnd(text, start) {
  let inString = false;
  let escaped = false;
  let depth = 0;

  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return -1;
}
```

- [ ] **Step 5: 实现缺失子集重试**

5a. `translateBatch` 中把 `const freshResults` 改为可重赋值并在**写缓存之前**做一次子集重试：

```js
  const cachedResults = await getCachedResults(settings, segmentPlan.segments);
  const missingSegments = segmentPlan.segments.filter((segment) => !cachedResults.has(segment.id));
  let freshResults = missingSegments.length > 0
    ? await requestTranslations(settings, missingSegments)
    : [];
  if (freshResults.some((result) => result?.error)) {
    freshResults = await retryMissingSegmentsOnce(settings, missingSegments, freshResults);
  }
```

5b. 新增函数（放在 `translateBatch` 之后）：

```js
async function retryMissingSegmentsOnce(settings, segments, results) {
  // 模型偶发漏译/坏对象时，对缺失的段落子集补一次请求；只补一次，失败就保留原错误。
  const okIds = new Set(
    results.filter((result) => result?.text && !result.error).map((result) => String(result.id))
  );
  const failedSegments = segments.filter((segment) => !okIds.has(String(segment.id)));
  if (failedSegments.length === 0) return results;

  let retried = [];
  try {
    retried = await requestTranslations(settings, failedSegments);
  } catch (error) {
    return results;
  }

  const retriedById = new Map(
    retried.filter((result) => result?.text && !result.error).map((result) => [String(result.id), result])
  );
  return results
    .filter((result) => okIds.has(String(result.id)) || !retriedById.has(String(result.id)))
    .concat(Array.from(retriedById.values()));
}
```

- [ ] **Step 6: 跑测试确认通过**

Run: `npm run check && npm run test:background`
Expected: 新旧测试全部 PASS（既有的 `testTranslateBatchRepairsMissingCommaBetweenJsonObjects`、`testTranslateBatchWrapsUnrecoverableJsonParseError` 必须保持通过；后者的"完全不可解析"样本若恰好被对象级提取救活，改用不含任何 `{` 的样本，如 `not json at all`）。

- [ ] **Step 7: 提交**

```bash
git add background.js test/background.test.js
git commit -m "fix: salvage per-object translations and retry missing segments once"
```

---

## Task 7: 版本、CHANGELOG 与全量验证

**Files:**
- Modify: `manifest.json`、`package.json`、`package-lock.json`、`content.js`（`CONTENT_SCRIPT_VERSION`）、`CHANGELOG.md`

- [ ] **Step 1: 升版本到 0.6.0**

- `manifest.json` 的 `"version": "0.6.0"`
- `package.json` 的 `"version": "0.6.0"`，然后 `npm install --package-lock-only` 同步 lock
- `content.js` 首行附近 `const CONTENT_SCRIPT_VERSION = "0.6.0";`

- [ ] **Step 2: 写 CHANGELOG（沿用现有条目格式）**

要点：视口扫描不再回退全页遍历（修复翻译后滚动卡顿）；元素文本提取缓存；手动触发首批 120ms 快速发送 + html[lang] 语言检测快速路径；content script 每标签页只注入一次；译文节点通用继承插入目标 slot（根治 shadow DOM 顺序类 bug）；模型返回坏 JSON 时对象级挽救 + 缺失段落自动补译一次。

- [ ] **Step 3: 全量测试**

Run: `npm test && npm run test:samples`
Expected: 全部 PASS。

- [ ] **Step 4: 提交**

```bash
git add manifest.json package.json package-lock.json content.js CHANGELOG.md
git commit -m "Release 0.6.0 translation stability overhaul"
```

- [ ] **Step 5: 真实页面手动验证清单（需要人工在 Chrome 完成）**

重新加载 unpacked 扩展并刷新页面后，逐项确认：

1. https://www.reddit.com/r/codex/comments/1ujxxhn/ （长评论页）：右键"翻译当前页面"，**约 0.5 秒内**出现"翻译中"占位。
2. 同页视口翻译完成后**持续滚动 10 秒**：无可感知卡顿；DevTools Performance 录制中 content script 无 >50ms 长任务（这是 0.5.1/0.5.2 反复复发的场景）。
3. https://www.reddit.com/r/wallstreetbets/comments/1ukxcrp/ （详情页）：标题译文在正文译文**上方**。
4. https://www.reddit.com/ 首页：帖子标题有译文；`r/xxx`、`8 hr. ago`、flair 等元信息无译文。
5. 任意长页面连续翻译数屏：偶发的"翻译失败：无法解析模型返回的 JSON"应基本消失；个别段落失败点击可重试。

说明：译文本体出现的耗时由模型接口决定，本计划优化的是"触发到出现占位/发出首个请求"的本地链路。

---

## 明确不做的事（避免过度设计）

- 不把 content.js 拆成多文件、不引入构建工具——2600 行对个人项目尚可接受，拆分收益低于折腾成本。
- 不做站点适配器插件系统——选择器常量去重 + slot 继承已消除主要的复发模式。
- 不加 `response_format: json_object`——需要按 provider 做兼容探测与回退，对象级挽救 + 子集重试已覆盖绝大多数失败；若 0.6.0 后仍高频出现解析失败再考虑。
- 不做 requestIdleCallback 分片调度——Task 1/2 把扫描工作量本身砍到有界后，分片失去必要性。

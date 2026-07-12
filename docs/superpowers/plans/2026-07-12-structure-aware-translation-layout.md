# Structure-Aware Translation Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 发布 `0.7.0`，用结构感知的候选补扫与布局策略解决 Reddit 穿插、CNN 漏译和窄栏挤压，同时保持纯文本 SSE 与 Doubao Thinking 参数。

**Architecture:** 保留现有内容脚本主流程，在候选发现中加入有界视口补扫，在译文创建前生成安全插入上下文。布局适配只使用内部数据属性和少量计算样式，不引入依赖或站点 class 配置框架。

**Tech Stack:** Chrome MV3、原生 JavaScript、CSS、Node.js assert、Playwright。

## Global Constraints

- 版本统一更新为 `0.7.0`。
- 首批最多 4 个候选继续立即使用独立纯文本 SSE 请求。
- 不新增运行时依赖、框架或外部服务。
- 不做无界全文 TreeWalker 或长页面逐元素布局测量。
- 保留火山方舟/Doubao `thinking: { type: "disabled" }`。
- 当前会话禁止使用子代理，采用 Inline Execution。

---

### Task 1: 建立 Reddit、CNN 与通用布局失败夹具

**Files:**
- Modify: `test/e2e-local-fixtures.js`

**Interfaces:**
- Consumes: `createHarnessPage(browser, options)`、`runTranslation(page)`。
- Produces: 三个独立回归测试，分别证明裁剪预览、视口补扫和 Flex 整行布局。

- [ ] **Step 1: 写 Reddit 裁剪预览失败测试**

构造超过 `maxTextLength` 的 `shreddit-post-text-body`，令 `.feed-card-text-preview` 为 `overflow:hidden` 且内部 `p` 为 `display:inline`。断言译文不在预览或链接内部、请求数量为一个正文单元、译文宽度不超过正文容器。

- [ ] **Step 2: 写 CNN 采样间隙失败测试**

构造三栏 CNN 风格页面，把标题行放在现有采样 Y 坐标之间。运行滚动区域扫描后断言所有可见新闻标题均出现在 `window.__mockItems`，而不是只有采样点命中的标题。

- [ ] **Step 3: 写 Flex/Grid 布局失败测试**

构造图片、标题链接和译文共享父级的窄 `display:flex;flex-wrap:nowrap` 卡片，以及一个多列 Grid 卡片。断言 Flex 中原标题宽度插入前后保持不变、译文位于下一行；Grid 译文的 `grid-column-start/end` 跨越全列。

- [ ] **Step 4: 运行本地测试验证 RED**

Run: `npm run test:local`

Expected: 新增的 Reddit、CNN 和 Flex/Grid 断言失败，现有测试仍执行到对应失败点。

### Task 2: 实现两阶段视口候选补扫

**Files:**
- Modify: `content.js`
- Test: `test/e2e-local-fixtures.js`

**Interfaces:**
- Produces: `mergeViewportCandidateElements(sampled, supplemented, maxResults)` 和局部列表/内容区补扫行为。
- Consumes: 现有 `formatCandidateEntries`、`getLocalReadableScope`、候选优先级与预算设置。

- [ ] **Step 1: 扩展局部范围发现**

当采样命中 `li` 时，在子项数量有界的 `ul/ol` 内补查相邻可见语义块；文章和角色文章仍以自身为局部范围。禁止把 `main` 或整个长评论区作为局部补扫范围。

- [ ] **Step 2: 合并采样与补扫结果**

首批采样结果优先保留，补扫结果按现有分数和视口距离加入，按元素去重并截断到 `maxElementsPerScan`。滚动扫描也安排一次绘制后的补扫，而不是只在首次启动时补扫。

- [ ] **Step 3: 运行 CNN 与性能相关测试验证 GREEN**

Run: `npm run test:local`

Expected: CNN 采样间隙测试通过，长 Reddit 线程的 TreeWalker 和 `getBoundingClientRect` 上限测试继续通过。

### Task 3: 实现翻译单元与结构感知布局策略

**Files:**
- Modify: `content.js`
- Test: `test/e2e-local-fixtures.js`

**Interfaces:**
- Produces: `getTranslationContext(element, placement)`，返回 `{ anchor, container, layoutMode }`；`applyTranslationLayout(node, context)`；`clearTranslationLayoutMarkers()`。
- Consumes: 现有 Reddit Slot 锚点、Hacker News 锚点、`ensureTranslationNode` 与译文状态更新函数。

- [ ] **Step 1: 实现安全上下文分析**

识别译文直接父容器的 `display`，输出 `block`、`flex-row` 或 `grid-row`。向上查找 `overflow:hidden/clip`、line-clamp 或固定/最大高度的裁剪上下文；裁剪上下文存在时把锚点提升到裁剪链接或容器外。

- [ ] **Step 2: 将 Reddit 长预览归一化为一个单元**

信息流裁剪预览即使隐藏全文超过 `maxTextLength`，也作为一个候选。发送文本按完整句子或最后空白截断到上限；详情页无裁剪时继续按段落处理长文。

- [ ] **Step 3: 应用 Flex/Grid/Slot 布局**

Flex 父容器添加 `data-llm-translator-layout="stacked-flex"`，译文使用 `flex:0 0 100%`；Grid 译文跨 `1 / -1`；Slot 继续继承锚点 slot。状态更新只复用节点，不重新计算或移动锚点。

- [ ] **Step 4: 清理布局标记**

`clearTranslations`、重载清理和节点移除路径删除内部布局属性，不能影响原页面后续渲染。

- [ ] **Step 5: 运行本地测试验证 GREEN**

Run: `npm run test:local`

Expected: Reddit、Flex、Grid、列表、Slot、动态页面和流式状态测试全部通过。

### Task 4: 发布版本、完整验证与推送

**Files:**
- Modify: `manifest.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `content.js`
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Test: `test/shared.test.js`
- Test: `test/background.test.js`
- Test: `test/e2e-content-samples.js`
- Test: `test/extension-smoke.js`

**Interfaces:**
- Produces: 可提交和推送的 `0.7.0` 工作树。
- Consumes: 前三项任务的代码与测试。

- [ ] **Step 1: 统一版本与发布说明**

把 Manifest、npm 包、lockfile 和内容脚本版本改为 `0.7.0`，在 CHANGELOG 顶部记录纯文本 SSE、结构感知布局、CNN 补扫、Reddit 裁剪预览和 Doubao Thinking 兼容性。

- [ ] **Step 2: 验证 Doubao 请求体**

Run: `npm run test:shared && npm run test:background`

Expected: 方舟端点和 `doubao-seed-2.0-mini` 选择 `THINKING_DISABLED`，请求体断言等于 `{ type: "disabled" }`。

- [ ] **Step 3: 运行完整自动化验证**

Run: `npm test`

Expected: 语法、发布审计、共享逻辑、后台逻辑、UI、本地夹具和扩展 Smoke 全部退出 0。

- [ ] **Step 4: 运行真实内容样本验证**

Run: `npm run test:samples`

Expected: 样本脚本退出 0；若 Reddit 被网络安全页拦截，报告必须将其标记为站点阻断而不是扩展失败。

- [ ] **Step 5: 浏览器视觉核对**

在用户 Chrome 中重新加载扩展后检查 CNN 首页和 Reddit 信息流：可见标题无采样遗漏，窄卡片译文独占下一整行，Reddit 预览无中英文穿插。

- [ ] **Step 6: 检查并提交范围**

Run: `git status --short && git diff --check && git diff --stat`

Expected: 只有流式翻译、结构适配、版本、文档和测试相关文件；不包含 `.playwright-cli`、测试结果或无关文件。

- [ ] **Step 7: 提交并推送**

Run: `git add <明确文件列表>`

Run: `git commit -m "发布 0.7.0 结构感知流式翻译"`

Run: `git push origin main`

Expected: 提交创建成功，远端 `main` 更新到该提交。

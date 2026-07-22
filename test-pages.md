# Test Pages

这份清单用于手工验证真实网页上的翻译体验。目标不是做站点特例，而是用不同页面形态检查通用规则是否足够稳定。

## 验收标准

每个页面都按下面 15 项检查：

```text
1. 初始只翻译当前视口附近内容
2. 滚动后才继续翻译新区域
3. 点击展开/加载更多后，新内容能翻译
4. 不翻译导航、按钮、广告、代码块、输入框
5. 不明显破坏页面布局
6. 停止翻译后，旧请求不会继续写入
7. 缓存命中后不会重复消耗 API
8. popup 统计能反映译文、缓存、请求、失败数量
9. 右键“翻译当前页面”能启动翻译
10. “隐藏译文 / 显示译文”能临时回看原文
11. 自动翻译开启后，目标语言页面不会自动翻译
12. 没有译文时，隐藏/显示和清除按钮不可点击
13. API 测试、翻译、清缓存等操作期间按钮会暂时禁用
14. 选中文本右键翻译会显示浮层，复制和关闭按钮可用
15. 选中文本已是目标语言时，不触发 API 请求并提示无需翻译
```

## 样本页面

自动化矩阵固定覆盖 16 个样本，每个样本同时运行 `1366×900` 桌面视口和 `390×844` 移动视口。

| 样本 | URL | 重点 |
| --- | --- | --- |
| X status | https://x.com/pankajkumar_dev/status/2071237614414512179 | 流式译文、展开、滚动、同文重渲染、引用推文 |
| Reddit feed | https://www.reddit.com/r/worldnews/hot/ | 无限滚动、帖子卡片、推荐区 |
| Reddit thread | https://www.reddit.com/r/worldnews/comments/ | 评论折叠、嵌套回复、加载更多 |
| Quora question | https://www.quora.com/What-is-artificial-intelligence | 答案折叠、登录墙、推荐流 |
| LinkedIn posts | https://www.linkedin.com/company/openai/posts/?feedView=all | 登录墙、卡片流、动态重渲染 |
| YouTube video | https://www.youtube.com/watch?v=dQw4w9WgXcQ | 视频页、标题和说明、复杂控件区 |
| Wikipedia article | https://en.wikipedia.org/wiki/Artificial_intelligence | 长正文、目录、引用、RTL 兼容 |
| GitHub README | https://github.com/openai/openai-node | 文档、代码块、列表、表格 |
| Stack Overflow question | https://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-processing-an-unsorted-array | 问答、代码块、评论和侧栏 |
| Hacker News list | https://news.ycombinator.com/news | 紧凑列表、短标题、站点导航 |
| MDN article | https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver | 文档、代码、目录、嵌套导航 |
| BBC home | https://www.bbc.com/ | 新闻卡片、网格、广告和导航 |
| CNN live page | https://www.cnn.com/2026/06/28/world/live-news/iran-war-strikes-trump | 直播页、动态内容、广告、更新流 |
| Reuters world | https://www.reuters.com/world/ | 新闻列表、风控页识别 |
| Medium topic | https://medium.com/tag/artificial-intelligence | 文章卡片、登录墙、推荐流 |
| Amazon search | https://www.amazon.com/s?k=noise+cancelling+headphones | 商品网格、价格和交互控件 |

## 当前自动化测试备注

`test/e2e-content-samples.js` 使用 Playwright 注入当前 `shared.js` 和 `content.js`，并 mock 翻译接口。它检查流式状态、滚动、展开、同文重渲染、重复请求、表格父子关系、控件重叠、水平位移和新增横向溢出；同时保存前后截图。日志只保存哈希、长度、状态和布局指标，不写入网页正文或完整译文。

结果分为四类：

- `PASS`：页面可用且所有排版断言通过。
- `BLOCKED`：站点登录墙、机器人验证或网络风控阻止有效页面加载，不视为产品通过。
- `SKIP`：网络或页面加载失败，本轮没有形成有效结论。
- `FAIL`：页面可用，但翻译或排版断言失败。

2026-07-22 当前测试网络中，X、YouTube、Wikipedia、GitHub、Stack Overflow、Hacker News、MDN、BBC、CNN 和 Amazon 的桌面/移动端均可通过；Reddit feed、Reddit thread、Quora、LinkedIn、Reuters 和 Medium 被站点风控或登录墙阻断，明确记录为 `BLOCKED`。真实站点会随网络和页面结构变化，发布前仍需重新运行完整矩阵。

自动翻译、右键菜单、选中文本浮层、隐藏/显示译文和按钮禁用态主要通过本地 fixture 与 background 单测覆盖，真实页面建议再手工抽查。

## 0.11.0 发布验收

2026-07-22 的 100 卡片压力夹具执行 10 轮快速重渲染（共 1000 次节点替换）后，请求数、译文节点数、逻辑记录数和可访问关联数均保持为 100。完整本地套件实测候选扫描 p95 为 19.7ms，流式 DOM 更新 p95 为 0.1ms，分别低于 50ms 和 8ms 的门槛。

调试快照不记录原文或译文，只包含 `recordKey`、`hash`、`length`、`state`、`strategy` 和 `rebindReason`，以及聚合后的性能计数。

## 记录模板

```text
页面：
日期：
模型：
每轮最多段落数：
单段最大字符数：
仅翻译当前视口：是/否

结果：
- 初始视口：
- 滚动：
- 点击展开：
- 跳过广告/导航：
- 布局：
- 缓存：
- popup 统计：
- 右键翻译：
- 隐藏/显示译文：
- 自动翻译跳过目标语言页：
- 按钮禁用态：
- 选中文本右键翻译：
- 选中文本目标语言跳过：

问题：
- 
```

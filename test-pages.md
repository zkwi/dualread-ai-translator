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

| 类型 | URL | 重点 |
| --- | --- | --- |
| CNN live page | https://www.cnn.com/2026/06/28/world/live-news/iran-war-strikes-trump | 直播页、动态内容、广告、更新流 |
| Reddit feed | https://www.reddit.com/r/worldnews/hot/ | 无限滚动、帖子卡片、推荐区 |
| Reddit thread | https://www.reddit.com/r/worldnews/comments/ | 评论折叠、嵌套回复、加载更多 |
| Quora question | https://www.quora.com/What-is-artificial-intelligence | 答案折叠、登录墙、推荐流 |
| X status | https://x.com/kimmonismus/status/2071162604601463049 | `main/article` 内联正文、引用推文、登录提示、作者/浏览量标签 |
| Wikipedia article | https://en.wikipedia.org/wiki/Artificial_intelligence | 长正文、目录、引用 |
| Hacker News list | https://news.ycombinator.com/news | 简洁列表页、短标题、站点导航 |
| GitHub README | https://github.com/openai/openai-node | 文档、代码块、列表 |

## 当前自动化测试备注

`test/e2e-content-samples.js` 使用 Playwright 注入当前 `shared.js` 和 `content.js`，并 mock 翻译接口。它主要验证页面 DOM 行为，不验证 Chrome popup/options 的真实扩展加载流程。

截至当前测试环境：

- CNN live page：可访问，能翻译正文，已跳过 `Live Updates` 这类短标签。
- Reddit feed：当前网络环境返回 security block 页面，不能作为有效内容样本。
- Quora question：当前网络环境返回 security verification 页面，已跳过，不产生翻译请求。
- X status：可访问，能翻译主推文和引用推文正文，已跳过作者句柄和浏览量。
- Wikipedia article：可访问，长正文翻译正常。
- Hacker News list：可访问，列表页标题翻译正常。
- 自动翻译、右键菜单、选中文本浮层、隐藏/显示译文和按钮禁用态主要通过本地 fixture 与 background 单测覆盖，真实页面建议再手工抽查。

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

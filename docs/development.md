# 开发说明

本文档放置偏开发向的信息，README 只保留安装、配置和普通使用路径。

## 目录结构

```text
dualread-ai-translator/
  manifest.json      # Chrome Manifest V3 配置
  background.js      # 注入 content script、右键菜单、调用 LLM API
  content.js         # 扫描网页文本，插入译文
  shared.js          # 共享默认值、缓存 key、语言和文本判断
  popup.html/css/js  # 插件弹窗：开始、停止、隐藏、清除、统计
  options.html/css/js# 设置页：API、语言、提示词、成本参数
  docs/images/       # README 截图
  test/              # 单元测试、UI fixture、页面 fixture、扩展 smoke test
  test-pages.md      # BBC、X、Reddit、CNN、Quora 等真实页面验收清单
```

## 正文抽取策略

插件不按固定 selector 翻译整页，而是采用 DOM walker + 可读块归并：

1. 使用 `TreeWalker` 遍历真实可见的文本节点。
2. 跳过脚本、表单、弹窗、广告、不可见内容、`.notranslate` 和已有译文区域。
3. 将文本节点归并到最近的可读块，例如 `p/li/blockquote/h1-h6/td/figcaption`。
4. 对 X/Twitter 这类正文在 `article/main` 内联节点里的页面，允许较长且有句子特征的 `span` 作为候选。
5. `header/footer/nav/aside` 属于软阻断：全局导航会跳过，文章内部标题区不直接误杀。
6. 候选块按当前视口距离和正文优先级排序，优先处理 `main/article/X primaryColumn/tweetText`。
7. 通用跳过导航、页脚、侧栏、弹窗、广告、赞助、登录、安全验证、纯 URL 和直播页短标签等低价值文本。

这个策略的目标是减少逐站点试配。遇到新站点时，优先调整通用过滤器和候选打分，不优先写死站点 selector。

## 翻译流程

默认流程：

1. popup、右键菜单或自动翻译触发页面翻译。
2. content script 读取当前可视区域及上下文窗口内的候选文本。
3. 已是目标语言、低价值文本、超出每页预算的文本会跳过。
4. background 按段落缓存命中情况拆分待翻译文本。
5. 未命中的文本按批次请求 OpenAI-compatible Chat Completions API。
6. 返回结果按原文本块顺序写回页面，并保留换行和列表结构。

自动翻译关闭时，content script 只读取本地 `autoTranslate/apiKey/model` 三个轻量字段，关闭则尽早退出，避免每个页面都唤醒后台读取完整设置。

## 批量请求和缓存

批量翻译会把多个文本块合并成一次 JSON 数组请求，但缓存仍按段落保存：

- 批量请求减少 API 往返次数。
- 段落级缓存提高命中率，避免整块内容只要多一行就完全失效。
- 缓存 key 包含 API 地址、模型、源语言、目标语言、提示词和原文，避免跨模型或跨提示词误用。
- 缓存清理做了节流，长页面连续翻译多个批次时不会每个批次都全量读取本地存储。

## 交互细节

- 错误译文块支持点击重试，也支持键盘聚焦后按 `Enter` 重试。
- 选中文本翻译浮层会尽量靠近选区，可按 `Esc` 或点击浮层外关闭。
- popup 和 options 支持系统暗色模式。
- `Alt + T` 可以快速开启或停止当前页面翻译。
- “译文优先”只降低原文透明度，不用 `display: none` 隐藏原文，避免复杂网页布局塌陷。

## 当前限制

- 默认只翻译包含英文字符的文本。
- 不处理 PDF、图片 OCR、视频字幕。
- 对复杂网页布局可能会出现插入位置不理想。
- 模型必须返回 JSON；如果模型不按要求返回，会显示解析失败。
- 点击“停止翻译”或“清除译文”后，旧请求返回时不会继续写入页面。
- 自动语言判断只做轻量启发式检测，不调用模型识别语言。

## 测试样本

手工测试样本见 [../test-pages.md](../test-pages.md)。

建议优先测试 BBC、X、Reddit、CNN、Quora、Wikipedia、Hacker News、GitHub README。每个页面重点看：

- 当前视口翻译是否及时触发。
- 点击展开或滚动加载的内容是否加入队列。
- 广告、导航、侧栏、登录框是否被跳过。
- popup 统计是否准确显示译文、缓存、请求、跳过、失败。
- 暗色页面中译文是否可读。

真实页面自动样本：

```bash
npm run test:samples
```

指定样本：

```bash
SAMPLE_KEYS=cnn-live,wikipedia-ai npx --yes --package playwright node test/e2e-content-samples.js
```

PowerShell：

```powershell
$env:SAMPLE_KEYS="x-status"; npx --yes --package playwright node test/e2e-content-samples.js
```

如果 Reddit、Quora 等页面在当前网络环境返回安全拦截或验证页，测试结果会标记 `siteBlocked=true`，不把它误判为正文抽取失败。

## 后续方向

个人项目继续按“低复杂度、高收益”推进：

1. 持续收敛真实站点中的误翻译和漏翻译。
2. 优化正文候选打分，但避免做复杂规则引擎。
3. 增加更多语言预设和常用服务商默认值。
4. 优化长页面和无限滚动页的预算提示。
5. 为 README 增加真实录屏 GIF，展示滚动后动态翻译。

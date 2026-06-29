# DualRead AI Translator

DualRead AI 是一个个人向的 Chrome MV3 网页对照翻译插件。它默认保留原文，并在原文下方插入对应译文，适合阅读新闻、社交媒体、问答和技术文档。

## 效果预览

![双语对照效果](docs/images/bilingual-demo.png)

![插件弹窗控制面板](docs/images/popup-demo.png)

## 快速安装

1. 打开 Chrome 地址栏：`chrome://extensions/`
2. 打开右上角 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择项目目录：`dualread-ai-translator`
5. 修改代码或文档后，在扩展管理页点击该扩展卡片的刷新按钮，再刷新目标网页。

加载成功后，工具栏会出现 `DualRead AI` 图标。

## 首次配置

1. 点击插件图标。
2. 点击 **打开设置**。
3. 选择服务商：`OpenAI`、`DeepSeek`、`DashScope / Qwen`、`本地兼容服务` 或 `自定义`。
4. 填写 `API Key`、模型名称和 Chat Completions API 地址。
5. 点击 **测试 API**，确认配置可用。

设置页会自动保存输入框、下拉项、数字项、开关和提示词。点击 **测试 API** 前也会先保存当前配置，避免 popup 或右键菜单读取到旧设置。

常见配置示例：

```text
OpenAI:
https://api.openai.com/v1/chat/completions
gpt-4o-mini

DeepSeek:
https://api.deepseek.com/v1/chat/completions
deepseek-chat

本地或代理服务:
http://localhost:8000/v1/chat/completions
```

API 最长等待时间在设置页按“秒”填写，默认 `120` 秒，最高 `300` 秒。对本地模型或较慢的推理模型，可以适当调大。

## 使用方法

打开英文网页后，可以通过三种方式使用：

- 点击插件弹窗里的 **开始翻译**：翻译当前可视区域及其附近正文。
- 点击 **只翻译当前屏**：只扫描当前屏附近内容，适合控制 token 成本。
- 右键页面选择 **翻译当前页面**，或选中文本后选择 **翻译选中文本**。

译文会插入在原文下方。继续滚动、点击展开正文或页面动态加载新内容后，新的可见文本会继续加入翻译队列。

如果想临时看回原文，点击 **隐藏译文**；再次点击 **显示译文** 可恢复，不会清空缓存或已有译文。点击 **清除译文** 会移除当前页面已插入的译文。

## 自动翻译

设置页和 popup 都可以打开 **自动翻译非目标语言页面**。开启后：

- 打开外文页面时会自动尝试翻译。
- 如果当前页面已经是目标语言，例如目标是简体中文而页面本身是中文，会跳过。
- 如果页面加载时正文还没出现，会等待后续动态内容进入视口后再翻译。
- 自动翻译仍遵守视口范围、每页请求段落数和每页请求字符数限制。

手动点击 **开始翻译** 或右键 **翻译当前页面** 会强制启动，不受自动语言跳过影响。

## 展示和统计

展示方式支持：

- **对照**：原文正常显示，译文在下方。
- **译文优先**：弱化已翻译原文，让译文更醒目，但不隐藏原文，避免破坏网页布局。

popup 会显示当前页统计：

```text
译文：已成功插入的译文数量
缓存：缓存命中数量
请求：本页实际请求 API 的段落数量
跳过：受每页预算限制未翻译的数量
失败：翻译失败数量
```

## 成本控制

插件不会默认翻译整页，而是采用“当前可视区域 + 上下文”的窗口扫描策略：

- 默认 `平衡` 预设：每轮最多纳入 `24` 个候选文本块，单段最大 `1800` 字符，每批最大 `6000` 字符。
- 默认最多并发 `2` 个请求批次，设置页可调到 `1-3`。
- 每页最多请求段落数默认 `80`，每页最多请求字符数默认 `60000`。
- 相同段落会按 API 地址、模型、语言、提示词和原文生成缓存 key，减少重复 token 消耗。

缓存默认保留 `30` 天，最多 `2000` 条。可以在设置页点击 **清空缓存** 手动清理。

## 提示词

设置页支持自定义翻译提示词。默认提示词会要求模型保留段落换行、空行和列表结构，并只返回 JSON 数组。

可用占位符：

```text
{{sourceLanguage}}
{{targetLanguage}}
```

如果自定义提示词，建议保留类似约束：

```text
Preserve paragraph breaks, line breaks, and bullet/list structure.
Return only a JSON array of translated strings.
```

## 隐私和权限

API Key 只保存在本机 Chrome 扩展存储中，不会上传到本项目服务器。网页文本只会发送到你在设置页配置的 API 服务。

权限用途：

```text
activeTab     # 在当前页面执行翻译脚本
contextMenus  # 提供右键翻译入口
scripting     # 注入 content.js
storage       # 保存配置、API Key 和缓存
<all_urls>    # 请求用户配置的任意 OpenAI-compatible API 地址
```

更多隐私说明见 [PRIVACY.md](PRIVACY.md)。

## 开发与测试

```bash
npm install
npm run check
npm test
npm run test:samples
```

`npm test` 会执行语法检查、单元测试、UI fixture、本地内容脚本 fixture，以及一次真实扩展加载 smoke test。`npm run test:samples` 使用 mock 翻译测试真实网页样本，不会调用真实 LLM，也不会消耗 API token。

开发说明、正文抽取策略、测试样本和后续方向见 [docs/development.md](docs/development.md)。

版本变化见 [CHANGELOG.md](CHANGELOG.md)，贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，许可证见 [LICENSE](LICENSE)。

# DualRead AI Translator

[English](README.md)

DualRead AI Translator 是一个个人向 Chrome MV3 网页对照翻译插件。它保留原文，并在附近插入 AI 译文，适合阅读新闻、社交媒体、问答页面、技术文档和长文章。

默认翻译方向：英语 -> 简体中文。扩展 UI 支持简体中文、繁體中文、英语和日语。

## 效果预览

![双语对照效果](docs/images/bilingual-demo.png)

![插件弹窗控制面板](docs/images/popup-demo.png)

## 功能特性

- 默认对照显示：先显示原文，下方显示译文。
- 译文优先模式：弱化已翻译原文，但不隐藏原文。
- 可视区域优先：翻译当前屏及附近内容，而不是默认整页翻译。
- 支持滚动页、展开正文和延迟加载内容。
- 自动翻译会检测目标语言，页面已以目标语言为主时自动跳过。
- 右键翻译当前页面或选中文本。
- 批量请求、小并发、本地缓存和每页预算，控制 token 成本。
- 支持自定义提示词和 OpenAI-compatible API 服务。

## 安装

1. 打开 `chrome://extensions/`。
2. 开启 **开发者模式**。
3. 点击 **加载已解压的扩展程序**。
4. 选择 `dualread-ai-translator` 目录。
5. 修改代码后，在扩展卡片点击刷新，并重新加载目标网页。

## 配置

打开插件弹窗，点击 **打开设置**，然后配置：

```text
服务商：OpenAI / DeepSeek / DashScope / 本地兼容服务 / 自定义
API Key：你自己的服务商密钥
模型：例如 gpt-4o-mini 或 deepseek-chat
API 地址：OpenAI-compatible Chat Completions 接口
```

常见 API 地址：

```text
OpenAI    https://api.openai.com/v1/chat/completions
DeepSeek  https://api.deepseek.com/v1/chat/completions
本地服务  http://localhost:8000/v1/chat/completions
```

设置会自动保存。本项目不内置、也不需要任何开发者自己的 API Key。

## 使用

- **开始翻译**：翻译当前可见区域及附近正文。
- **只翻译当前屏**：限制扫描当前视口附近内容。
- **隐藏 / 显示译文**：临时切换译文和原文视图。
- **清除译文**：移除当前页面已插入的译文。
- **右键页面**：翻译当前页面。
- **右键选中文本**：只翻译选中的文本。

手动翻译会绕过自动语言跳过判断。自动翻译仍遵守可视区域、每页请求上限和语言检测。

## 隐私

- API Key、设置和翻译缓存只保存在本机 Chrome 扩展存储中。
- 网页文本只会发送到用户自己配置的 API 地址。
- 扩展没有项目自有服务器，也没有内置统计分析。
- 不要把真实 API Key 粘贴到 issue、截图或公开 bug 报告中。

更多说明见 [PRIVACY.md](PRIVACY.md)。

## 开发

```bash
npm install
npm run check
npm test
npm run test:samples
```

常用脚本：

```bash
npm run audit:public        # 扫描可发布文件中的密钥、本地路径和不安全产物
node scripts/generate-locales.js
```

开发说明见 [docs/development.md](docs/development.md)。手工测试页面见 [test-pages.md](test-pages.md)。

## 开源发布检查

分享或发布前：

1. 运行 `npm run check`。
2. 确认截图不包含 API Key、账号或私人页面。
3. 确认没有提交 `.env`、`.npmrc`、压缩包、CRX 文件和私钥。
4. 如果要发布 Git 历史，先检查提交作者姓名和邮箱。

## 链接

- [English README](README.md)
- [隐私说明](PRIVACY.md)
- [贡献说明](CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)
- [许可证](LICENSE)

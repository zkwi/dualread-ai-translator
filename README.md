# DualRead AI Translator - AI Bilingual Webpage Translation Chrome Extension

[简体中文](README.zh-CN.md)

DualRead AI Translator is an open-source Chrome extension for AI bilingual webpage translation. It keeps the original webpage text visible and inserts AI translations nearby, making it easier to read foreign-language news, social posts, Q&A pages, documentation, and long articles without losing source context.

It is designed as a lightweight OpenAI-compatible web translator: bring your own API key, choose a model, translate only the current reading area, and keep token cost under control.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4.svg)
![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-111827.svg)

## Preview

![Bilingual translation preview](docs/images/bilingual-demo.png)

![Popup control panel](docs/images/popup-demo.png)

## Why DualRead AI Translator

- **Bilingual webpage translation**: original text stays in place, translation appears underneath.
- **Chrome AI translator workflow**: translate with OpenAI, DeepSeek, DashScope/Qwen, local models, or any OpenAI-compatible API.
- **Viewport-first translation**: translate the current screen and nearby content instead of sending the whole page.
- **Dynamic page support**: handle scrolling feeds, expanded posts, late-loaded content, and long articles.
- **Auto translate with language skip**: translate foreign-language pages automatically and skip pages already dominated by the target language.
- **Right-click translation**: translate the current webpage or selected text from the context menu.
- **Cost-aware design**: batch requests, small concurrency, per-page budgets, and local paragraph cache.
- **Privacy-conscious**: no project server, no analytics, no bundled developer API key.

## Use Cases

DualRead works best for:

- Reading English news websites with Simplified Chinese translations.
- Translating X/Twitter posts, Reddit threads, Quora answers, and forum pages.
- Reading documentation, GitHub README files, Wikipedia articles, and technical blogs.
- Comparing the original paragraph with the translated paragraph while learning a language.

Default direction: English -> Simplified Chinese. The extension UI supports Simplified Chinese, Traditional Chinese, English, and Japanese.

## Install

1. Open `chrome://extensions/`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the `dualread-ai-translator` folder.
5. After changing code, refresh the extension card and reload the target webpage.

## Setup

Open the extension popup, click **Open settings**, then configure:

```text
Provider: OpenAI / DeepSeek / DashScope / Local compatible service / Custom
API Key: your own provider key
Model: for example gpt-4o-mini or deepseek-chat
API URL: an OpenAI-compatible Chat Completions endpoint
```

Common API URLs:

```text
OpenAI    https://api.openai.com/v1/chat/completions
DeepSeek  https://api.deepseek.com/v1/chat/completions
DashScope https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
Local     http://localhost:8000/v1/chat/completions
```

Settings are saved automatically. The project does not include or require any developer-owned API key.

UI language is configured separately from translation languages. You can keep the interface in English while translating English to Simplified Chinese, Japanese to Traditional Chinese, or any other provider-supported direction.

Strongly recommended: keep **disable controllable thinking** enabled from **Advanced connection settings**. Thinking/reasoning mode can make every translation batch much slower. The default **Auto select** mode chooses common provider parameters from the API URL and model name, including `enable_thinking: false`, `thinking: { type: "disabled" }`, OpenRouter reasoning controls, and local Qwen `chat_template_kwargs`.

## Usage

- **Start translation**: translate visible and nearby readable content.
- **Translate current screen**: limit scanning to the current viewport area.
- **Hide / Show translations**: temporarily switch between translated view and original view.
- **Clear translations**: remove inserted translations from the current page.
- **Right-click page**: translate the current page.
- **Right-click selected text**: translate only the selected text.

Manual translation bypasses the auto-skip decision. Auto translation still respects viewport scope, per-page request limits, and language detection.

## FAQ

### Does DualRead translate the whole page?

Not by default. DualRead focuses on the current viewport and nearby content to reduce API requests and token cost.

### Which AI providers are supported?

Any OpenAI-compatible Chat Completions API can work. Built-in presets cover OpenAI, DeepSeek, DashScope/Qwen, local compatible services, and custom endpoints.

### Can DualRead disable model thinking mode?

Yes, and it is strongly recommended for translation speed. Keep **Strongly recommended: disable controllable thinking** enabled and use **Auto select** unless your provider requires a specific parameter. Auto mode covers DashScope/Qwen, DeepSeek-like models, OpenRouter, and local Qwen-compatible services. If a provider rejects an unsupported thinking parameter, DualRead retries once without that parameter.

### Where is my API key stored?

The API key is stored locally in Chrome extension storage. It is not sent to any project-owned server.

### Can I use a different UI language from the translation target?

Yes. Interface language is independent from source and target languages. The extension UI includes Simplified Chinese, Traditional Chinese, English, and Japanese localization.

## Privacy

- API Key, settings, and translation cache are stored locally in Chrome extension storage.
- Webpage text is sent only to the API endpoint configured by the user.
- The extension does not run a project-owned server and does not include analytics.
- Do not paste real API keys into issues, screenshots, or public bug reports.

See [PRIVACY.md](PRIVACY.md) for details.

## Development

```bash
npm install
npm run check
npm test
npm run test:samples
```

Useful scripts:

```bash
npm run audit:public        # scan publishable files for keys, local paths, and unsafe artifacts
node scripts/generate-locales.js
```

More development notes are in [docs/development.md](docs/development.md). Manual sample pages are listed in [test-pages.md](test-pages.md).

## Open Source Hygiene

Before sharing or publishing:

1. Run `npm run check`.
2. Confirm screenshots do not show API keys, accounts, or private pages.
3. Confirm `.env`, `.npmrc`, archives, CRX files, and private keys are not committed.
4. If publishing the Git history, check commit author name/email first.

## Keywords

Chrome extension, AI translator, bilingual webpage translation, webpage translator, OpenAI-compatible translator, DeepSeek translator, Qwen translator, browser extension translation, English to Chinese translator.

## Links

- [Simplified Chinese README](README.zh-CN.md)
- [Privacy](PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)

# DualRead AI Translator

[简体中文](README.zh-CN.md)

DualRead AI Translator is a personal Chrome MV3 extension for bilingual webpage translation. It keeps the original text visible and inserts AI translations nearby, so you can read news, social posts, Q&A pages, documentation, and long articles without losing the source context.

Default direction: English -> Simplified Chinese. The extension UI supports Simplified Chinese, Traditional Chinese, English, and Japanese.

## Preview

![Bilingual translation preview](docs/images/bilingual-demo.png)

![Popup control panel](docs/images/popup-demo.png)

## Features

- Bilingual display by default: original text first, translation underneath.
- Translation-first mode: dim translated original text without hiding it.
- Viewport-first translation: translate the current screen and nearby content instead of the whole page.
- Dynamic content support for scrolling pages, expanded posts, and delayed loading.
- Auto translation with target-language skip, so pages already dominated by the target language are ignored.
- Right-click translation for the current page or selected text.
- Batch requests, small concurrency, local cache, and per-page budgets to control token cost.
- Custom prompt and OpenAI-compatible API providers.

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
Local     http://localhost:8000/v1/chat/completions
```

Settings are saved automatically. The project does not include or require any developer-owned API key.

## Usage

- **Start translation**: translate visible and nearby readable content.
- **Translate current screen**: limit scanning to the current viewport area.
- **Hide / Show translations**: temporarily switch between translated view and original view.
- **Clear translations**: remove inserted translations from the current page.
- **Right-click page**: translate the current page.
- **Right-click selected text**: translate only the selected text.

Manual translation bypasses the auto-skip decision. Auto translation still respects viewport scope, per-page request limits, and language detection.

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

## Links

- [Simplified Chinese README](README.zh-CN.md)
- [Privacy](PRIVACY.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)

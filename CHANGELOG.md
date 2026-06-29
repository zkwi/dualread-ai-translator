# Changelog

## 0.4.4

- Added limited parallel translation batches to improve response speed.
- Added `maxConcurrentBatches` advanced setting, clamped to 1-3.
- Cost presets now map to concurrency levels: economy 1, balanced 2, eager 3.
- Made advanced connection settings always visible, raised default API timeout to 120 seconds, and enabled thinking-mode suppression by default.
- Added bilingual/translation-first display modes, improved selection translation card dismissal/positioning, added popup/options dark mode, and animated loading translations.
- Improved retry accessibility, added confirmation for destructive settings actions, and raised the configurable API timeout ceiling to 300 seconds.
- Reduced repeated cache-prune full scans, avoided background settings round-trips when auto translation is disabled, centralized defaults/cost presets, and grouped site heuristics.

## 0.4.3

- Changed API timeout setting in the options page from milliseconds to seconds.
- Made thinking-mode control provider-aware: DashScope uses `enable_thinking: false`, while local Qwen-compatible services use `chat_template_kwargs.enable_thinking = false`.
- Stopped enabling thinking-control by default for providers that do not support it, such as OpenAI and DeepSeek official Chat Completions endpoints.

## 0.4.2

- Optimized popup and options page for ordinary users.
- Added language/range summary in the popup.
- Added quick language presets, provider help text, cost-profile help text, and clearer auto-save state in options.

## 0.4.1

- Made options page more user-first: common language selectors, cost presets, and advanced settings folded by default.
- Added clearer next-step hints in the popup.

## 0.4.0

- Renamed the product to `DualRead AI`.
- Added Chrome icons, provider presets, API Key reveal/hide, default prompt reset, and reorganized popup/options sections.

## 0.3.x

- Added X/Twitter, CNN, BBC, Reddit, Quora, Wikipedia, and Hacker News sample coverage.
- Improved viewport-first translation, dynamic content scanning, and immediate first-screen queueing.
- Added serial LLM requests, batched translation, per-segment caching, cache limits, and longer default API timeout.
- Added right-click page/selection translation, auto translation, target-language skip, hide/show translation, and in-page notices.
- Improved dark-page readability, line-break preservation, Google search direction handling, and Qwen/DashScope thinking-mode controls.

## 0.2.x

- Added auto translation, page-language skip, context menu entry points, and translation visibility controls.
- Improved popup/options states and user-facing skip reasons.

## 0.1.x

- Built the MVP bilingual reading flow: preserve original text and insert translations below.
- Added DOM walker based extraction, viewport cost control, retry, caching, timeout settings, and target-language text skipping.

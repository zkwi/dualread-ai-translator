# Changelog

## 0.4.11

- Replaced the disabled thinking-mode checkbox with an explicit strategy selector so users can force common provider parameters when needed.
- Added auto thinking-control detection for DeepSeek-like models, DashScope/Qwen, OpenRouter, and local Qwen-compatible services.
- Added a fallback retry that removes thinking-control parameters when an OpenAI-compatible provider rejects an unsupported field.
- Remembered rejected thinking-control parameters per endpoint/model so later batches skip the unsupported field without paying another failed request.
- Added the effective thinking-control strategy to the popup summary so users can confirm speed-related settings without opening the settings page.
- Fixed the popup speed summary initial state so settings-load failures never expose placeholder text.
- Made content-script async message handlers return readable failures instead of leaving popup/background requests waiting when page-side logic throws.
- Added a publication-audit guard that blocks placeholder-based locale messages from being wired directly to static HTML UI.
- Bumped the content script version so already-injected 0.4.10 scripts can clearly request a page refresh.

## 0.4.10

- Made the thinking-mode setting capability-aware: providers without supported thinking parameters now show a disabled unchecked control instead of a misleading checked state.
- Bumped the content script version so already-injected 0.4.9 scripts can clearly request a page refresh.

## 0.4.9

- Skipped MediaWiki/Wikipedia sidebar and navigation templates so article text is prioritized over visible metadata lists.
- Excluded MediaWiki article title headers from the sample-test blocked-area warning, avoiding false positives for real page titles.
- Bumped the content script version so already-injected 0.4.8 scripts can clearly request a page refresh.

## 0.4.8

- Anchored translations for CNN-style list cards next to the primary headline link, reducing missed-looking or displaced output on lazy-loaded news layouts.
- Bumped the content script version so already-injected 0.4.7 scripts can clearly request a page refresh.

## 0.4.7

- Fixed Chrome popup width collapse caused by viewport-based popup sizing.
- Improved CNN-style card extraction so utility labels like "LIVE UPDATES" and "BREAKING NEWS" are removed without dropping the actual headline.
- Skipped short low-information trend links with punctuation, such as "E. Jean Carroll", so navigation/ribbon items no longer steal translation budget.
- Made candidate extraction respect non-Latin source languages, so Japanese -> Chinese and Chinese -> English settings can actually translate matching page text.
- Replaced remaining machine-style English/Japanese locale fallbacks and cleaned up Traditional Chinese copy.
- Added publication-audit checks for untranslated locale fallbacks and Simplified Chinese residue in Traditional Chinese strings.
- Switched the Chrome manifest fallback locale to English to match the open-source README and SEO-facing default language.
- Expanded the extension smoke test to cover settings API testing and real page translation insertion through the loaded MV3 extension.
- Aligned background injection checks with the popup: only regular http/https pages are treated as translatable.
- Kept long API test success messages compact so the sticky settings status bar does not stretch the layout.
- Made popup actions recover from storage/runtime failures by refreshing the real saved state and showing a readable error.
- Made options-page actions surface unexpected save/API/cache failures instead of leaving users stuck in a pending state.
- Improved in-page retry blocks so Space also triggers retry and retry-time failures remain visible and keyboard accessible.
- Added recoverable startup states for popup/settings load failures instead of leaving users on stale loading UI.
- Normalized empty runtime failures to a readable "unknown error" message in popup and settings UI.
- Skipped assistive-only text such as X/Twitter sr-only page titles so hidden metadata no longer consumes translation budget.
- Bumped the content script version so already-injected 0.4.6 scripts can clearly request a page refresh.

## 0.4.6

- Added an independent UI language setting so interface language no longer has to follow the translation source or target language.
- Made popup, options, context menus, and in-page notices load the configured UI language consistently.
- Exposed packaged locale JSON files to content scripts so page-level notices can use the selected UI language.
- Fixed duplicate context menu creation when UI language refresh overlaps extension install or settings changes.
- Bumped the content script version so already-injected 0.4.5 scripts can clearly request a page refresh.

## 0.4.5

- Fixed auto-started translations not syncing active tab state back to the background worker, which caused the first Stop action to be treated as Start.
- Synced popup page-stat reads back into the background active-tab cache as an extra safety net.
- Made provider preset changes reflect whether thinking-mode suppression is actually used by that provider.
- Cleaned up retry interaction attributes when retry is unavailable after translation has stopped.
- Improved popup guidance for unconfigured users: start/current-screen/auto-translate controls are disabled until API Key and model are present.
- Added an options-page setup status panel that shows missing connection fields, prompts API testing, and confirms when the test succeeds.
- Made the options-page action bar sticky and promoted Test API as the primary action, while making manual save secondary.
- Moved Clear Cache and Reset Defaults out of the sticky action bar into the advanced maintenance section to reduce accidental destructive clicks.
- Let users press Enter in API address, API Key, or model fields to run Test API once the connection config is complete.
- Added confirmation before clearing current-page translations from the popup, and added stat tooltips for clearer metric meanings.
- Improved the selected-text translation card with explicit original/translation labels, clearer Copy Translation action, disabled copy when no translation exists, and copy status feedback.
- Added visible keyboard focus styles for popup and options buttons, switches, summaries, and checkbox controls.
- Added selected states to common language preset buttons so users can see which source/target pair is active.
- Popup now explains unsupported pages such as Chrome settings/extension pages, disables page-only actions there, and still lets global auto-translate/display preferences be saved for normal webpages.
- Options quick-start status now shows API test failures inline and clears the failure once connection fields are edited.
- Options quick-start status now shows an in-progress state while API testing is waiting for a response.
- Options save-state badge now distinguishes API test failures from actual save failures.
- Test API button now changes to "测试中..." while the request is pending and restores when finished.
- Popup auto-translate status now shows the configured provider and model so users can confirm the active connection at a glance.
- Popup disabled Hide/Clear translation actions now explain when the current page has no translations yet.
- Prompt reset now uses a clearer label and asks for confirmation before replacing a custom prompt.
- Options language section now shows the current translation direction and warns when source and target languages are the same.
- Options language direction now uses localized language names for easier scanning.
- Popup primary action buttons now show pending text while translation requests are in progress.
- Full settings reset now uses clearer wording to distinguish it from prompt-only reset.
- Popup action buttons now include explanatory titles for what each enabled action does.
- API Key reveal button now exposes its pressed state and clear show/hide titles for accessibility.
- Far scrolling to a completely different viewport now cancels stale pending translation UI and ignores old batch responses, so the new reading area is translated first.
- Translation blocks now detect local dark sections on otherwise light pages, keeping text readable on mixed-background sites like CNN.
- Auto translation now skips pages whose visible content is already dominated by the target language, even when a few source-language snippets are present.
- Added Chrome extension localization for Simplified Chinese, Traditional Chinese, English, and Japanese across manifest, popup, options, context menus, and in-page prompts.
- Made the default README English and kept a Simplified Chinese README for local users.
- Simplified README content, clarified privacy boundaries, and added a public-release audit script for keys, local paths, private files, and unsafe artifacts.
- Improved GitHub SEO with keyword-focused README headings, use cases, FAQ, package keywords, and repository topics.
- Fixed English popup layout overflow by allowing compact cards and buttons to wrap safely, and replaced leftover locale placeholder text with real English/Japanese copy.
- Bumped the content script version so already-injected older scripts can clearly request a page refresh.

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

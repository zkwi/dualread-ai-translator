# Changelog

## 0.6.3

- Translated oversized Reddit text posts by falling back from the full `shreddit-post-text-body` container to its internal paragraphs when the body exceeds the per-segment length limit.
- Kept viewport selector fallback available when sampled blocks have already been translated, so scrolling past retained translations can still discover newly visible text.
- Bumped the content script version so already-injected 0.6.2 scripts can clearly request a page refresh.

## 0.6.2

- Capped the options-page API connection test at 20 seconds so a slow or unreachable provider no longer leaves the UI appearing stuck for the full translation timeout.
- Updated the DeepSeek preset to the current `deepseek-v4-flash` model and official Chat Completions endpoint, with migration for the old `deepseek-chat` preset.
- Bumped the content script version so already-injected 0.6.1 scripts can clearly request a page refresh.

## 0.6.1

- Split batched translation requests after retriable network fetch failures, so one Reddit `Failed to fetch` no longer marks every paragraph in the batch as failed.
- Bumped the content script version so already-injected 0.6.0 scripts can clearly request a page refresh.

## 0.6.0

- Removed full-page TreeWalker fallback from viewport scans and bounded retained scan paths, fixing repeated long-page scroll stalls after visible content has already been translated.
- Cached expensive per-element text extraction until real page content changes, reducing repeated style/layout reads during scanning, batching, and request creation.
- Reduced manual-start latency with a fast first-batch flush window and an `html[lang]` fast path that skips expensive language sampling when the declared page language is clearly different from the target language.
- Avoided repeated content script reinjection for the same tab within a service-worker lifetime, while resetting injection state on navigation/removal.
- Generalized slotted translation placement so injected translations inherit the insertion target's `slot`, and deduplicated Reddit/article selector definitions.
- Salvaged valid translation objects from malformed model JSON and retried missing segments once, so one bad object no longer fails an entire batch.
- Kept dynamic scans firing during continuously mutating Reddit-style pages and filtered noisy attribute mutations, reducing delayed translation starts and bursty scan stalls after content loads.

## 0.5.6

- Reduced manual-start latency by passing the already validated settings from the background script into `start_translation` and `scan_current_area`, avoiding a second content-to-background `get_settings` round trip before loading placeholders can render.
- Added regressions for slow settings lookup so manual current-area translation must show loading feedback immediately when settings are already supplied.

## 0.5.5

- Fixed Reddit detail-page post title translations rendering after the body by recognizing `h1[slot="title"]` title nodes and assigning their translation back to the title slot.
- Added a regression fixture that simulates Reddit's shadow DOM slot order so unslotted title translations cannot slip below text-body content again.

## 0.5.4

- Translated Reddit post titles on feed/detail pages by recognizing `shreddit-post` title links and placing their translations back into the title slot.
- Skipped Reddit community, flair, and timestamp metadata so those labels no longer consume viewport translation budget ahead of real content.
- Added conservative support for standalone article headline/title links inside `article`/`role=article` cards, covering common feed-card headline structures beyond Reddit.
- Added local regression coverage for Reddit titles, Reddit metadata filtering, and standalone article headline links.
- Bumped the content script version so already-injected 0.5.3 scripts can clearly request a page refresh.

## 0.5.3

- Repaired common malformed model JSON where adjacent result objects are returned without commas, preventing isolated Reddit comment batches from failing.
- Wrapped unrecoverable model JSON parse failures with the extension's localized parse error instead of leaking raw `JSON.parse` exceptions into the page.
- Added background regression coverage for malformed-but-recoverable translation JSON.
- Bumped the content script version so already-injected 0.5.2 scripts can clearly request a page refresh.

## 0.5.2

- Cached viewport hit-test samples so language checks, immediate scans, deferred scans, and scroll scans do not repeatedly call `elementsFromPoint` on long Reddit-style threads.
- Reduced viewport sampling layout reads so scan cost stays bounded by the viewport instead of growing with the total number of loaded comments.
- Extended the long Reddit regression fixture to guard both full TreeWalker scans and full-page layout measurement from returning.
- Bumped the content script version so already-injected 0.5.1 scripts can clearly request a page refresh.

## 0.5.1

- Optimized viewport-only scans on long Reddit-style threads so translation startup does not walk every comment text node.
- Reused viewport readable-block sampling for page-language checks, reducing main-thread work before the first loading placeholder.
- Added a long Reddit thread regression fixture to guard against full-page TreeWalker scans returning.
- Bumped the content script version so already-injected 0.5.0 scripts can clearly request a page refresh.

## 0.5.0

- Synced Alt+T toggles with the content script's real active state before choosing start or stop, fixing stale service-worker state after restarts.
- Made translation cache write failures non-fatal so successful API translations still render when local storage quota is exceeded.
- Rendered manual translation loading placeholders immediately with a lightweight viewport-first scan while preserving dense-row and short-link filters.
- Bumped the content script version so already-injected 0.4.26 scripts can clearly request a page refresh.

## 0.4.26

- Skipped embedded video-player DRM/browser error overlays so they do not consume page translation budget.
- Added regression coverage for CNN-style player errors while preserving nearby news headline translation.
- Made real-page sample tests fail on blocked-region injections and mock translation errors instead of only logging them.
- Bumped the content script version so already-injected 0.4.25 scripts can clearly request a page refresh.

## 0.4.25

- Restored Hacker News story title translation without reopening dense table and repository row layout regressions.
- Blocked MediaWiki Vector appearance controls so Wikipedia side UI no longer receives injected translations.
- Added local regression coverage for Hacker News title rows and Wikipedia Vector appearance panels.
- Bumped the content script version so already-injected 0.4.24 scripts can clearly request a page refresh.

## 0.4.24

- Skipped the low-value X/Twitter page chrome label "Post" so status pages only translate the actual post body.
- Reset provider presets to the recommended automatic thinking-control strategy, avoiding stale provider-specific parameters after switching services.
- Added shared, content, and options regression coverage for the X label filter and provider preset reset behavior.
- Bumped the content script version so already-injected 0.4.23 scripts can clearly request a page refresh.

## 0.4.23

- Limited page-language sampling to the current viewport and nearby content so offscreen modules do not trigger unwanted auto translation.
- Added a regression fixture for target-language pages with distant offscreen foreign-language sections.
- Verified selected real samples for BBC, CNN, Reddit, and X with mocked translations.
- Bumped the content script version so already-injected 0.4.22 scripts can clearly request a page refresh.

## 0.4.22

- Re-rendered popup actions after refreshed page stats so buttons, badges, and notices no longer show stale active states.
- Extended dense row filtering to text-node and inline candidates, reducing broken translation blocks in GitHub-style repository file lists.
- Added popup and local content regression coverage for refreshed action state and modern flex repository rows.
- Bumped the content script version so already-injected 0.4.21 scripts can clearly request a page refresh.

## 0.4.21

- Preserved the target-language skip reason when content-script auto-start reports an inactive tab back to the background cache.
- Ensured the popup can explain declarative auto-translate skips after reopening, instead of falling back to a generic idle state.
- Added background and content fixture coverage for skipped auto-start notices.
- Bumped the content script version so already-injected 0.4.20 scripts can clearly request a page refresh.

## 0.4.20

- Fixed auto-translate skipped states in the popup so target-language pages return to an inactive "skipped" state instead of keeping stale active controls.
- Synced content-script declarative auto-start skips back to the background tab cache, preventing stale active state after target-language auto skips.
- Added regression coverage for popup auto-toggle skips and content-script auto-start inactive synchronization.
- Bumped the content script version so already-injected 0.4.19 scripts can clearly request a page refresh.

## 0.4.19

- Opened advanced settings by default so prompt, concurrency, cache, and cost controls are easier to discover.
- Replaced hardcoded Chinese expand/collapse pseudo-text with a language-neutral chevron control.
- Added UI regression coverage for the default-open advanced settings section and language-neutral summary control.
- Bumped the content script version so already-injected 0.4.18 scripts can clearly request a page refresh.

## 0.4.18

- Fixed current-screen translation skipped states so target-language pages stay inactive in the popup and background tab cache.
- Preserved skipped notices after current-screen translation so users can see why no translation started.
- Added dense table/grid filtering to avoid inserting block translations into repository file lists, commit rows, and narrow metadata cells.
- Hardened injected translation block layout with explicit block display, width limits, and safer wrapping for Reddit/GitHub-style narrow containers.
- Bumped the content script version so already-injected 0.4.17 scripts can clearly request a page refresh.

## 0.4.17

- Switched page translation to page-language gating so target-language pages are skipped before block-level scanning.
- Kept source-language filtering while allowing short readable headings and labels on pages that need translation.
- Fixed manual page translation skipped states so the popup and background tab cache stay inactive.
- Bumped the content script version so already-injected 0.4.16 scripts can clearly request a page refresh.

## 0.4.16

- Strengthened settings and popup guidance to strongly recommend disabling controllable thinking mode for faster translation.
- Added recommended/warning styling to the settings page when thinking control is enabled or turned off.
- Bumped the content script version so already-injected 0.4.15 scripts can clearly request a page refresh.

## 0.4.15

- Skipped GitHub repository file-list tables and latest-commit metadata so commit/date cells no longer receive block translations.
- Skipped low-value repository empty-state text such as "No releases published" and "No packages published".
- Added a GitHub repository fixture to keep README/About-style content translatable while preserving code-page table layout.
- Bumped the content script version so already-injected 0.4.14 scripts can clearly request a page refresh.

## 0.4.14

- Improved Reddit text-post layout handling by treating `shreddit-post-text-body` as a single readable block.
- Inserted Reddit body translations into the safe text-body slot instead of inside clamped paragraph/link content.
- Added a Reddit feed-card regression test so translations do not split original post previews.
- Bumped the content script version so already-injected 0.4.13 scripts can clearly request a page refresh.

## 0.4.13

- Improved the settings page layout with a wider form grid, clearer spacing, and aligned connection controls.
- Grouped API timeout and thinking-control settings into matching panels so provider speed options are easier to scan.
- Moved Save/Test API actions into the connection setup area and removed the sticky bottom bar so controls no longer cover form fields.
- Added settings-page overflow regression coverage for desktop and narrow layouts.
- Bumped the content script version so already-injected 0.4.12 scripts can clearly request a page refresh.

## 0.4.12

- Synced package, lockfile, manifest, and content-script versions so user-visible fixes can move forward with clear release numbers.
- Bumped the content script version so already-injected 0.4.11 scripts can clearly request a page refresh.

## 0.4.11

- Replaced the disabled thinking-mode checkbox with an explicit strategy selector so users can force common provider parameters when needed.
- Added auto thinking-control detection for DeepSeek-like models, DashScope/Qwen, OpenRouter, and local Qwen-compatible services.
- Added a fallback retry that removes thinking-control parameters when an OpenAI-compatible provider rejects an unsupported field.
- Remembered rejected thinking-control parameters per endpoint/model so later batches skip the unsupported field without paying another failed request.
- Added the effective thinking-control strategy to the popup summary so users can confirm speed-related settings without opening the settings page.
- Fixed the popup speed summary initial state so settings-load failures never expose placeholder text.
- Made content-script async message handlers return readable failures instead of leaving popup/background requests waiting when page-side logic throws.
- Propagated page-side translation failures through popup, current-screen translation, and right-click page translation instead of treating them as successful starts.
- Propagated page-side failures for clear, visibility, and display-mode popup actions instead of reporting success.
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

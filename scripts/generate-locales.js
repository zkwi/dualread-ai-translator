const fs = require("fs");
const path = require("path");

const SOURCE_FILES = [
  "manifest.json",
  "popup.html",
  "options.html",
  "popup.js",
  "options.js",
  "background.js",
  "content.js"
];

const keys = new Set();
const zh = {};

function addKey(key) {
  if (key) keys.add(key);
}

function collectHtmlFallbacks(file) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) {
    addKey(match[1]);
  }
  for (const match of source.matchAll(/<([a-z0-9-]+)[^>]*data-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = match[3].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (text) zh[match[2]] = text;
  }
}

function collectJsKeys(file) {
  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\bt\("([^"]+)"/g)) addKey(match[1]);
  for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) addKey(match[1]);
  for (const match of source.matchAll(/\bt\("([^"]+)"[\s\S]{0,180}?,\s*"([^"]*)"\)/g)) {
    if (!zh[match[1]]) zh[match[1]] = match[2];
  }
}

for (const file of ["popup.html", "options.html"]) collectHtmlFallbacks(file);
for (const file of SOURCE_FILES) collectJsKeys(file);
addKey("htmlLang");

Object.assign(zh, {
  htmlLang: "zh-CN",
  extensionName: "DualRead AI Translator",
  extensionShortName: "DualRead AI",
  extensionDescription: "AI 网页对照翻译，保留原文并在附近显示译文。",
  commandToggleTranslation: "切换当前页面的对照翻译",
  contentErrorRetry: "翻译失败：$1（点击重试）",
  errorApiRequestFailed: "API 请求失败：$1 $2",
  errorApiTimeout: "API 请求超时（$1 秒）。",
  errorParseJson: "无法解析模型返回的 JSON：$1",
  fieldRequiredConfig: "必要配置",
  languageDirection: "$1 -> $2",
  languageDirectionDefault: "英语 -> 简体中文",
  languageStatusDirection: "当前方向：$1 -> $2。",
  languageStatusSame: "源语言和目标语言都是 $1，通常不会产生有效翻译。",
  messageApiTestSuccess: "API 可用，测试译文：$1",
  messageAutoSaveFailed: "自动保存失败：$1",
  messageClearCacheDone: "已清空 $1 条缓存。",
  optionsLanguagePresetsAria: "常用语言组合",
  optionsMaintenanceActions: "维护操作",
  popupActive: "已开启。",
  popupSummaryAria: "当前翻译配置",
  setupErrorText: "$1 修改连接信息后可重新测试。",
  setupMissingText: "补齐后会自动保存，然后点击“测试 API”。",
  setupMissingTitle: "还差 $1",
  statAria: "$1：$2，$3",
  summaryWithDot: "$1 · $2"
});

const en = {
  htmlLang: "en",
  extensionDescription: "AI bilingual webpage translation with original text preserved and translations shown nearby.",
  commandToggleTranslation: "Toggle bilingual translation on the current page",
  close: "Close",
  show: "Show",
  hide: "Hide",
  showApiKey: "Show API Key",
  hideApiKey: "Hide API Key",
  statusEnabled: "On",
  statusDisabled: "Off",
  listSeparator: ", ",
  langAutoDetect: "Auto detect",
  langEnglish: "English",
  langSimplifiedChinese: "Simplified Chinese",
  langTraditionalChinese: "Traditional Chinese",
  langJapanese: "Japanese",
  langKorean: "Korean",
  langSpanish: "Spanish",
  langFrench: "French",
  langGerman: "German",
  displayModeLabel: "Display mode",
  displayModeBilingualShort: "Bilingual",
  displayModeTranslationFirstShort: "Translation first",
  displayModeBilingual: "Bilingual: show translation below original",
  displayModeTranslationFirst: "Translation first: dim original text",
  providerCustom: "Custom",
  providerLocal: "Local compatible service",
  providerLocalShort: "Local service",
  scopeCurrentViewport: "Current screen area",
  scopeWholePageBudget: "Within page budget",
  languageDirection: "$1 -> $2",
  languageDirectionDefault: "English -> Simplified Chinese",
  popupStatusLoading: "Reading current page status...",
  popupBadgeIdle: "Idle",
  popupConfigNoticeTitle: "Not ready",
  popupConfigNoticeText: "Please enter an API Key and model first.",
  popupGoSettings: "Settings",
  popupSummaryAria: "Current translation settings",
  popupLanguage: "Language",
  popupScope: "Scope",
  popupAutoTranslateLabel: "Auto translate foreign pages",
  popupConfigLoading: "Loading settings...",
  popupActionHintInitial: "Click Start translation. Translations will appear below the original text.",
  popupStartTranslation: "Start translation",
  popupStopTranslation: "Stop translation",
  popupTranslateCurrentScreen: "Translate current screen",
  popupHideTranslations: "Hide translations",
  popupShowTranslations: "Show translations",
  popupClearTranslations: "Clear translations",
  popupOpenSettings: "Open settings",
  popupActiveWithCount: "Enabled. Found $1 candidate text blocks.",
  popupActive: "Enabled.",
  popupBadgeTranslating: "Translating",
  popupBadgeUnavailable: "Unavailable",
  popupBadgeUnconfigured: "Not configured",
  popupBadgeSkipped: "Skipped",
  popupApiPending: "API not configured",
  statTranslated: "Translated",
  statCache: "Cache",
  statRequests: "Requests",
  statSkipped: "Skipped",
  statFailed: "Failed",
  optionsTitle: "DualRead AI Settings",
  optionsSubtitle: "Bilingual webpage translation settings. Changes are saved automatically.",
  optionsAutoSave: "Auto save",
  optionsQuickStart: "Quick start",
  optionsStepProvider: "Choose provider",
  optionsStepApiKey: "Enter API Key",
  optionsStepTestApi: "Test API",
  optionsProvider: "Provider",
  optionsModelName: "Model name",
  optionsAdvancedConnection: "Advanced connection settings",
  optionsApiUrl: "Chat Completions API URL",
  optionsApiTimeout: "API maximum wait time (seconds)",
  optionsDisableThinking: "Automatically disable controllable thinking mode",
  optionsLanguage: "Language",
  optionsSourceLanguage: "Source language",
  optionsTargetLanguage: "Target language",
  optionsReadingExperience: "Reading experience",
  optionsAutoTranslateLabel: "Auto start translation on foreign-language pages",
  optionsCostControl: "Cost control",
  optionsTranslationScope: "Translation scope",
  optionsAdvancedSettings: "Advanced settings",
  optionsPrompt: "Prompt",
  optionsResetPrompt: "Restore default prompt",
  optionsTranslationPrompt: "Translation prompt",
  optionsBatchSize: "Paragraphs per batch",
  optionsMaxCharsPerBatch: "Max characters per batch",
  optionsMaxConcurrentBatches: "Concurrent request batches",
  optionsMaxElementsPerScan: "Max paragraphs per scan",
  optionsMaxTextLength: "Max characters per block",
  optionsMaxRequestsPerPage: "Max requested paragraphs per page",
  optionsMaxCharsPerPage: "Max requested characters per page",
  optionsCacheMaintenance: "Cache and maintenance",
  optionsCacheTtlDays: "Cache retention days",
  optionsMaxCacheEntries: "Max cache entries",
  optionsClearCache: "Clear cache",
  optionsResetAll: "Restore all defaults",
  optionsSaveNow: "Save now",
  optionsTestApi: "Test API",
  optionsTesting: "Testing...",
  costProfileEconomy: "Save tokens: translate less content",
  costProfileBalanced: "Balanced: recommended for daily use",
  costProfileEager: "Eager: prefetch more article text",
  costProfileCustom: "Custom parameters",
  contextTranslatePage: "Translate this page",
  contextTranslateSelection: "Translate selected text",
  contentLoading: "Translating...",
  contentErrorRetry: "Translation failed: $1 (click to retry)",
  selectionCardTitle: "Selected text translation",
  selectionCopyTranslation: "Copy translation",
  selectionSourceLabel: "Original",
  selectionTranslationLabel: "Translation",
  selectionNoticeLabel: "Notice",
  selectionErrorLabel: "Error"
};

const ja = {
  htmlLang: "ja",
  extensionName: "DualRead AI 翻訳",
  extensionDescription: "原文を残したまま近くに訳文を表示する AI 対照翻訳拡張機能です。",
  commandToggleTranslation: "現在のページの対照翻訳を切り替える",
  close: "閉じる",
  show: "表示",
  hide: "非表示",
  showApiKey: "API Key を表示",
  hideApiKey: "API Key を隠す",
  statusEnabled: "オン",
  statusDisabled: "オフ",
  listSeparator: "、",
  langAutoDetect: "自動検出",
  langEnglish: "英語",
  langSimplifiedChinese: "簡体字中国語",
  langTraditionalChinese: "繁体字中国語",
  langJapanese: "日本語",
  langKorean: "韓国語",
  langSpanish: "スペイン語",
  langFrench: "フランス語",
  langGerman: "ドイツ語",
  displayModeLabel: "表示モード",
  displayModeBilingualShort: "対照",
  displayModeTranslationFirstShort: "訳文優先",
  displayModeBilingual: "対照：原文の下に訳文を表示",
  displayModeTranslationFirst: "訳文優先：原文を薄く表示",
  providerCustom: "カスタム",
  providerLocal: "ローカル互換サービス",
  providerLocalShort: "ローカルサービス",
  scopeCurrentViewport: "現在の画面付近",
  scopeWholePageBudget: "ページ予算内",
  languageDirectionDefault: "英語 -> 簡体字中国語",
  popupBadgeIdle: "待機中",
  popupStartTranslation: "翻訳開始",
  popupStopTranslation: "翻訳停止",
  popupTranslateCurrentScreen: "現在の画面だけ翻訳",
  popupHideTranslations: "訳文を隠す",
  popupShowTranslations: "訳文を表示",
  popupClearTranslations: "訳文を削除",
  popupOpenSettings: "設定を開く",
  popupBadgeTranslating: "翻訳中",
  popupBadgeUnavailable: "利用不可",
  popupBadgeUnconfigured: "未設定",
  popupBadgeSkipped: "スキップ",
  statTranslated: "訳文",
  statCache: "キャッシュ",
  statRequests: "リクエスト",
  statSkipped: "スキップ",
  statFailed: "失敗",
  optionsTitle: "DualRead AI 設定",
  optionsAutoSave: "自動保存",
  optionsQuickStart: "クイックスタート",
  optionsStepProvider: "サービスを選択",
  optionsStepApiKey: "API Key を入力",
  optionsStepTestApi: "API をテスト",
  optionsProvider: "サービス",
  optionsModelName: "モデル名",
  optionsLanguage: "言語",
  optionsSourceLanguage: "元言語",
  optionsTargetLanguage: "目標言語",
  optionsReadingExperience: "読書体験",
  optionsCostControl: "コスト制御",
  optionsAdvancedSettings: "詳細設定",
  optionsPrompt: "プロンプト",
  optionsSaveNow: "今すぐ保存",
  optionsTestApi: "API をテスト",
  contextTranslatePage: "このページを翻訳",
  contextTranslateSelection: "選択テキストを翻訳",
  contentLoading: "翻訳中...",
  contentErrorRetry: "翻訳失敗：$1（クリックで再試行）",
  selectionCardTitle: "選択テキスト翻訳",
  selectionCopyTranslation: "訳文をコピー",
  selectionSourceLabel: "原文",
  selectionTranslationLabel: "訳文",
  selectionNoticeLabel: "通知",
  selectionErrorLabel: "エラー"
};

function humanize(key) {
  return key
    .replace(/^(popup|options|content|selection|tooltip|message|error|notice|setup|stat|saveState)/, "")
    .replace(/(Title|Text|Label|Desc|Help|Aria|Initial)$/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bApi\b/g, "API")
    .replace(/\bUrl\b/g, "URL")
    .trim() || key;
}

function toTraditional(value) {
  const pairs = [
    ["网页", "網頁"], ["对照", "對照"], ["翻译", "翻譯"], ["设置", "設定"],
    ["并", "並"], ["与", "與"], ["这", "這"], ["为", "為"], ["会", "會"], ["请", "請"],
    ["自动", "自動"], ["保存", "儲存"], ["选择", "選擇"], ["服务商", "服務商"],
    ["填写", "填寫"], ["点击", "點擊"], ["读取", "讀取"], ["本地", "本機"],
    ["兼容", "相容"], ["自定义", "自訂"], ["名称", "名稱"], ["显示", "顯示"],
    ["隐藏", "隱藏"], ["扩展", "擴充功能"], ["存储", "儲存"], ["上传", "上傳"],
    ["项目", "專案"], ["服务器", "伺服器"], ["高级", "進階"], ["地址", "位址"],
    ["网络", "網路"], ["响应", "回應"], ["默认", "預設"], ["关闭", "關閉"],
    ["参数", "參數"], ["语言", "語言"], ["页面", "頁面"], ["跳过", "略過"],
    ["组合", "組合"], ["自动检测", "自動偵測"], ["简体中文", "簡體中文"],
    ["日语", "日語"], ["韩语", "韓語"], ["西班牙语", "西班牙語"], ["法语", "法語"],
    ["德语", "德語"], ["源语言", "來源語言"], ["目标语言", "目標語言"],
    ["结果", "結果"], ["使用体验", "使用體驗"], ["行为", "行為"], ["访问", "存取"],
    ["检查", "檢查"], ["重复", "重複"], ["展示", "顯示"], ["译文", "譯文"],
    ["优先", "優先"], ["破坏", "破壞"], ["布局", "版面"], ["可视区域", "可視區域"],
    ["减少", "減少"], ["范围", "範圍"], ["积极", "積極"], ["预取", "預取"],
    ["仅", "僅"], ["开启", "開啟"], ["请求", "請求"], ["提示词", "提示詞"],
    ["批量", "批次"], ["并发", "並行"], ["缓存", "快取"], ["细粒度", "細粒度"],
    ["恢复", "還原"], ["支持", "支援"], ["占位符", "佔位符"], ["追加", "附加"],
    ["字符", "字元"], ["每轮", "每輪"], ["条数", "筆數"], ["维护", "維護"],
    ["清空", "清除"], ["发送", "傳送"], ["接口", "介面"], ["测试", "測試"],
    ["失败", "失敗"], ["当前", "目前"], ["打开", "開啟"], ["启动", "啟動"],
    ["扫描", "掃描"], ["选中", "選取"], ["复制", "複製"], ["剪贴板", "剪貼簿"],
    ["错误", "錯誤"], ["重试", "重試"], ["超时", "逾時"], ["无法", "無法"], ["返回", "傳回"]
  ];
  let output = value;
  for (const [from, to] of pairs) output = output.split(from).join(to);
  return output;
}

function toMessages(localeMap, fallbackMap = {}) {
  return Object.fromEntries([...keys].sort().map((key) => {
    const message = localeMap[key] || fallbackMap[key] || humanize(key);
    return [key, { message }];
  }));
}

const zhCnMessages = Object.fromEntries([...keys].sort().map((key) => [key, { message: zh[key] || key }]));
const zhTwMessages = Object.fromEntries([...keys].sort().map((key) => [
  key,
  { message: key === "htmlLang" ? "zh-TW" : toTraditional(zh[key] || key) }
]));
const enMessages = toMessages(en);
const jaMessages = toMessages(ja, en);

for (const [locale, data] of Object.entries({ zh_CN: zhCnMessages, zh_TW: zhTwMessages, en: enMessages, ja: jaMessages })) {
  const dir = path.join("_locales", locale);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "messages.json"), `${JSON.stringify(data, null, 2)}\n`);
}

console.log(`generated ${keys.size} locale keys`);

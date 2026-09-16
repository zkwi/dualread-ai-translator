const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const SKIP_DIRS = new Set([".git", "node_modules", "test-results", "playwright-report"]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".lock",
  ".md",
  ".txt",
  ".yaml",
  ".yml"
]);
const TEXT_FILES = new Set([".gitattributes", ".gitignore", "LICENSE"]);
const BLOCKED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".npmrc",
  "id_rsa",
  "id_ed25519"
]);

const localPathPattern = new RegExp([
  "C:" + "\\\\" + "\\\\" + "Users" + "\\\\" + "\\\\",
  "\\/Users\\/",
  "\\/home\\/",
  "App" + "Data",
  "Pycharm" + "Projects",
  "Documents" + "\\\\" + "\\\\" + "Co" + "dex"
].join("|"), "i");

const checks = [
  {
    name: "API key",
    pattern: /(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_=-]{20,}/i
  },
  {
    name: "cloud access key",
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/
  },
  {
    name: "private key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    name: "absolute local path",
    pattern: localPathPattern
  },
  {
    name: "personal email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i
  },
  {
    name: "nonstandard package registry",
    pattern: /registry\.npmmirror\.com/i
  }
];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function isTextFile(file) {
  const base = path.basename(file);
  return TEXT_FILES.has(base) || TEXT_EXTENSIONS.has(path.extname(file));
}

function relative(file) {
  return path.relative(ROOT, file).replace(/\\/g, "/");
}

const failures = [];
const allowedHumanizedLocaleKeys = new Set([
  "extensionShortName",
  "fieldApiUrl",
  "languageDirection",
  "optionsLanguage",
  "optionsPrompt",
  "optionsProvider",
  "optionsTestApi",
  "popupLanguage",
  "popupScope",
  "saveStateMaintenance",
  "saveStateSaved",
  "saveStateSaving",
  "saveStateTesting",
  "selectionCopied",
  "selectionErrorLabel",
  "selectionNoticeLabel",
  "selectionTranslationLabel",
  "statCache",
  "statFailed",
  "statRequests",
  "statSkipped",
  "summaryWithDot"
]);
const simplifiedTraditionalResidues = [
  "设置", "这", "为", "会", "请", "自动", "选择", "填写", "点击", "读取",
  "本地", "兼容", "自定义", "名称", "显示", "隐藏", "扩展", "存储",
  "上传", "项目", "服务器", "高级", "地址", "网络", "响应", "默认",
  "关闭", "参数", "语言", "页面", "跳过", "检查", "重复", "译文",
  "优先", "可视区域", "减少", "范围", "请求", "提示词", "缓存",
  "恢复", "支持", "字符", "维护", "清空", "发送", "测试", "失败",
  "当前", "打开", "启动", "扫描", "选中", "复制", "错误", "重试",
  "超时", "无法", "返回", "覆盖", "确定", "继续", "加载", "已经",
  "没有", "另一个", "实例", "吗", "切换", "删除", "刷新", "开始",
  "插件", "文本", "适合", "阅读", "数量", "同时", "内容", "连贯",
  "预算", "确认", "该", "数组", "获取", "脚本", "检测", "英语",
  "目标", "产生", "暂", "滚动", "连接", "最长", "时间", "调大",
  "这里", "本机"
];
// 逐字兜底：词表只覆盖已知短语，单字残留（例如“英译中”“已断开”“右键”）此前逃过检查。
// 字符集只收录两岸字形不同的简体字，不含同形字，避免误报正常繁体文案。
const simplifiedOnlyCharacters = Array.from(
  "个为义于产优会传储写击删务参发吗围坏块复对并开当扩扫护择换时暂条检没测滚"
  + "盖确称简级组经结继续维缓网脚范获认访词该语误请读败贴载过连适选链错闭问隐"
  + "韩页项预额验断译设议稳动变态华临从体关内处应无显机来标样浏点状现签荐补"
  + "视览试输还际随齐启将数响键区准实强云节权类线笔订阶进单"
);

function humanizeLocaleKey(key) {
  return key
    .replace(/^(popup|options|content|selection|tooltip|message|error|notice|setup|stat|saveState)/, "")
    .replace(/(Title|Text|Label|Desc|Help|Aria|Initial)$/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bApi\b/g, "API")
    .replace(/\bUrl\b/g, "URL")
    .trim() || key;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

for (const file of walk(ROOT)) {
  const rel = relative(file);
  const base = path.basename(file);

  if (BLOCKED_FILE_NAMES.has(base) || /\.(?:pem|key|p12|pfx)$/i.test(base)) {
    failures.push(`${rel}: sensitive file should not be published`);
    continue;
  }

  if (!isTextFile(file)) continue;

  const content = fs.readFileSync(file, "utf8");
  for (const check of checks) {
    if (check.pattern.test(content)) {
      failures.push(`${rel}: matched ${check.name}`);
    }
  }
}

for (const locale of ["en", "ja"]) {
  const file = path.join(ROOT, "_locales", locale, "messages.json");
  if (!fs.existsSync(file)) continue;

  const messages = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const [key, value] of Object.entries(messages)) {
    const message = value?.message || "";
    if (message === humanizeLocaleKey(key) && !allowedHumanizedLocaleKeys.has(key)) {
      failures.push(`${relative(file)}:${key}: locale message looks like an untranslated key fallback`);
    }
  }
}

const zhTwFile = path.join(ROOT, "_locales", "zh_TW", "messages.json");
if (fs.existsSync(zhTwFile)) {
  const messages = JSON.parse(fs.readFileSync(zhTwFile, "utf8"));
  for (const [key, value] of Object.entries(messages)) {
    const message = value?.message || "";
    const residue = simplifiedTraditionalResidues.find((word) => message.includes(word))
      || simplifiedOnlyCharacters.find((character) => message.includes(character));
    if (residue) {
      failures.push(`${relative(zhTwFile)}:${key}: Traditional Chinese message still contains simplified text "${residue}"`);
    }
  }
}

assertSubstitutionsMatchAcrossLocales();

// 文案里的 $1 数量必须四种语言一致，否则某些语言会静默丢掉错误详情或计数。
function assertSubstitutionsMatchAcrossLocales() {
  const baseline = readJson(path.join("_locales", "zh_CN", "messages.json"));
  const readSubstitutions = (message) => Array.from(
    new Set(String(message || "").match(/\$\d/g) || [])
  ).sort().join(",");

  for (const locale of ["zh_TW", "en", "ja"]) {
    const messages = readJson(path.join("_locales", locale, "messages.json"));
    for (const [key, value] of Object.entries(baseline)) {
      const expected = readSubstitutions(value?.message);
      const actual = readSubstitutions(messages[key]?.message);
      if (expected !== actual) {
        failures.push(
          `_locales/${locale}/messages.json:${key}: substitutions "${actual || "none"}" do not match zh_CN "${expected || "none"}"`
        );
      }
    }
  }
}

const zhCnMessages = readJson(path.join("_locales", "zh_CN", "messages.json"));
for (const htmlFile of ["popup.html", "options.html"]) {
  const fullPath = path.join(ROOT, htmlFile);
  if (!fs.existsSync(fullPath)) continue;

  const source = fs.readFileSync(fullPath, "utf8");
  for (const match of source.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) {
    const key = match[1];
    const message = zhCnMessages[key]?.message || "";
    if (/\$\d/.test(message)) {
      failures.push(`${htmlFile}:${key}: HTML data-i18n must not reference placeholder message "${message}"`);
    }
  }
}

assertVersionsAreInSync();
assertLocaleKeysAreUsed();

// 发布检查要求手工同步 4 处版本号，这里改成自动核对，避免漏改造成 content script 版本判断失效。
function assertVersionsAreInSync() {
  const sources = [
    ["manifest.json", readJson("manifest.json").version],
    ["package.json", readJson("package.json").version],
    ["package-lock.json", readJson("package-lock.json").version],
    ["package-lock.json (packages root)", readJson("package-lock.json").packages?.[""]?.version],
    ["content.js", readContentScriptVersion()]
  ];

  const expected = sources[0][1];
  for (const [name, version] of sources.slice(1)) {
    if (version !== expected) {
      failures.push(`${name}: version "${version}" does not match manifest.json "${expected}"`);
    }
  }
}

function readContentScriptVersion() {
  const source = fs.readFileSync(path.join(ROOT, "content.js"), "utf8");
  return source.match(/CONTENT_SCRIPT_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";
}

// 未被代码引用的文案会在四种语言里同时腐烂，发布前直接拦下。
function assertLocaleKeysAreUsed() {
  const sourceFiles = [
    "manifest.json",
    "popup.html",
    "options.html",
    "popup.js",
    "options.js",
    "background.js",
    "content.js",
    "shared.js"
  ];
  const used = new Set(["htmlLang"]);

  for (const file of sourceFiles) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const match of source.matchAll(/data-i18n(?:-[\w-]+)?="([^"]+)"/g)) used.add(match[1]);
    for (const match of source.matchAll(/\bt\("([^"]+)"/g)) used.add(match[1]);
    for (const match of source.matchAll(/\bi18n\("([^"]+)"/g)) used.add(match[1]);
    for (const match of source.matchAll(/__MSG_([A-Za-z0-9_]+)__/g)) used.add(match[1]);
  }

  for (const locale of ["zh_CN", "zh_TW", "en", "ja"]) {
    const messages = readJson(path.join("_locales", locale, "messages.json"));
    for (const key of Object.keys(messages)) {
      if (!used.has(key)) {
        failures.push(`_locales/${locale}/messages.json:${key}: locale message is not referenced by any source file`);
      }
    }
  }
}

const manifest = readJson("manifest.json");
if (manifest.default_locale !== "en") {
  failures.push("manifest.json: default_locale should be en so unsupported browser locales fall back to the English open-source UI");
}

const defaultLocaleFile = path.join(ROOT, "_locales", manifest.default_locale || "", "messages.json");
if (!fs.existsSync(defaultLocaleFile)) {
  failures.push(`manifest.json: default_locale "${manifest.default_locale}" has no matching _locales folder`);
}

if (failures.length) {
  console.error("Publication audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("publication audit passed");

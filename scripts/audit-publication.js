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
    const residue = simplifiedTraditionalResidues.find((word) => message.includes(word));
    if (residue) {
      failures.push(`${relative(zhTwFile)}:${key}: Traditional Chinese message still contains simplified text "${residue}"`);
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

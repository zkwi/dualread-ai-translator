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

if (failures.length) {
  console.error("Publication audit failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("publication audit passed");

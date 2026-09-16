// 语法检查覆盖仓库里所有 JavaScript 文件，避免新增文件被漏掉。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = process.cwd();
const SKIP_DIRS = new Set([".git", "node_modules", "test-results", "playwright-report"]);

function collectScripts(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectScripts(fullPath, files);
    } else if (path.extname(entry.name) === ".js") {
      files.push(fullPath);
    }
  }
  return files;
}

const failures = [];
const scripts = collectScripts(ROOT).sort();

for (const file of scripts) {
  const relativePath = path.relative(ROOT, file).replace(/\\/g, "/");
  try {
    // vm.Script 只编译不执行，等价于 node --check，但不用为每个文件开进程。
    new vm.Script(fs.readFileSync(file, "utf8"), { filename: relativePath });
  } catch (error) {
    failures.push(`${relativePath}: ${error.message}`);
  }
}

if (failures.length) {
  console.error("Syntax check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`syntax check passed (${scripts.length} files)`);

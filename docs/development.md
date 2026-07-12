# 开发与验证

README 只保留安装和使用路径；运行时设计见 [架构说明](architecture.md)，全部文档入口见 [文档索引](README.md)。

## 环境

- Node.js 18 或更高版本。
- Chrome/Chromium。
- 无构建步骤；修改扩展文件后在 `chrome://extensions/` 刷新扩展，并重新加载目标页。

安装测试依赖：

```powershell
npm install
```

## 常用验证

```powershell
npm run check            # 发布审计 + 所有 JavaScript 语法检查
npm run test:shared      # 共享纯函数
npm run test:background  # API、SSE、缓存和 Chrome 生命周期
npm run test:ui          # popup/options 浏览器 fixture
npm run test:local       # 页面扫描与布局 fixture
npm run test:smoke       # 加载真实 MV3 扩展
npm test                 # 除真实网站外的完整回归
npm run test:samples     # 真实页面样本，使用 mock 翻译
```

PowerShell 中只运行指定真实样本：

```powershell
$env:SAMPLE_KEYS="cnn-live,wikipedia-ai"
npm run test:samples
Remove-Item Env:SAMPLE_KEYS
```

Reddit、Quora 等站点可能在测试网络返回验证页。样本会标记 `siteBlocked=true`，这表示站点未提供正文，不等同于抽取逻辑通过或失败。

## 修改原则

### 页面漏译或误译

先增加最小本地 fixture，再调整通用候选过滤或优先级。只有站点 DOM 语义无法由通用结构表达时才增加站点规则。

### 排版问题

先确认插入目标和布局模式（Block/Flex/Grid/Clipped/Slot），在结构感知层修复并增加 fixture，不直接按站点 class 打 CSS 补丁。

### API 与 Thinking

请求体由 `background.js` 的统一构造函数生成。自动 Thinking 行为必须由连接测试探测，不能新增按域名、服务商或模型名称的运行时映射。新增候选参数时必须同时覆盖：成功、明确不支持后继续、鉴权/限流/网络错误停止。

### 正文协议

网页正文使用单段纯文本 SSE。不要把新功能接回 `translate_batch`；该入口只是旧消息兼容层。

## 文案与本地化

UI 文案位于 `_locales/{zh_CN,zh_TW,en,ja}/messages.json`。新增 `data-i18n` 或 `t("key")` 后，四种语言必须都有对应 key；`npm run test:shared` 会检查覆盖。

## 发布检查

1. 更新 `manifest.json`、`package.json`、`package-lock.json` 和 `content.js` 的版本号。
2. 在 `CHANGELOG.md` 顶部记录用户可感知变化。
3. 运行 `npm test` 和 `npm run test:samples`。
4. 运行 `npm run audit:public`，确认没有 API Key、本地绝对路径、压缩包或构建产物。
5. 检查 `git status` 和完整 diff，只提交本版本相关内容。

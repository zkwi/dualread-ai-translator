const Shared = globalThis.LLMTranslatorShared;
const Study = globalThis.LLMStudyMode;
const { i18n: t, applyI18n, setUiLanguage } = Shared;

const STUDY_PORT_NAME = "llm-study-stream";
const RENDER_INTERVAL_MS = 120;
// 生成要几十秒，定时给后台发消息，避免 service worker 因空闲被回收而中断流式请求。
const PING_INTERVAL_MS = 20000;
// 译文排在词汇之后输出，段末的“译”按钮能尽早可用；语法等补充内容最后生成。
const PROGRESS_SECTIONS = ["ARTICLE", "KEY", "VOCAB", "TRANSLATION", "GRAMMAR", "SENTENCES", "PARAGRAPHS"];
const NOTE_SECTIONS = ["VOCAB", "GRAMMAR", "SENTENCES", "PARAGRAPHS", "TRANSLATION"];

const elements = {
  levelButtons: Array.from(document.querySelectorAll("[data-level]")),
  glossToggle: document.getElementById("glossToggle"),
  actionButton: document.getElementById("actionButton"),
  progress: document.getElementById("progress"),
  progressText: document.getElementById("progressText"),
  progressBar: document.getElementById("progressBar"),
  statePanel: document.getElementById("statePanel"),
  stateTitle: document.getElementById("stateTitle"),
  stateMessage: document.getElementById("stateMessage"),
  stateRetry: document.getElementById("stateRetry"),
  stateSettings: document.getElementById("stateSettings"),
  paper: document.getElementById("paper"),
  source: document.getElementById("source"),
  title: document.getElementById("title"),
  meta: document.getElementById("meta"),
  notices: document.getElementById("notices"),
  article: document.getElementById("article"),
  studyNav: document.getElementById("studyNav"),
  translationToggle: document.getElementById("translationToggle"),
  translationBody: document.getElementById("translationBody"),
  footStatus: document.getElementById("footStatus"),
  popover: document.getElementById("popover")
};

const state = {
  sourceId: new URLSearchParams(location.search).get("source") || "",
  sessionId: createId("session"),
  settings: null,
  source: null,
  level: Study.DEFAULT_STUDY_LEVEL,
  showGloss: true,
  revealed: new Set(),
  translationOpen: false,
  port: null,
  requestId: "",
  phase: "idle",
  text: "",
  cached: false,
  finishReason: "",
  repetition: false,
  error: null,
  startedAt: 0,
  finishedAt: 0,
  lastParsed: null,
  vocab: [],
  renderTimer: null,
  pingTimer: null,
  tickTimer: null
};

// 流式期间每 120ms 重绘一次：内容没变就不动 DOM，避免冲掉读者正在选中的文字和键盘焦点。
const renderedHtml = new WeakMap();
const TYPING_MARK = "<!--typing-->";

applyI18n(document);
init();

async function init() {
  try {
    state.settings = await chrome.runtime.sendMessage({ action: "get_settings" });
    await setUiLanguage(state.settings?.uiLanguage);
    applyI18n(document);
  } catch (error) {
    // 读不到设置时页面照常打开，生成请求会由后台给出明确错误。
  }

  try {
    const stored = await chrome.storage.local.get({
      studyLevel: Study.DEFAULT_STUDY_LEVEL,
      studyShowGloss: true
    });
    state.level = Study.normalizeStudyLevel(stored.studyLevel);
    state.showGloss = stored.studyShowGloss !== false;
  } catch (error) {
    state.level = Study.DEFAULT_STUDY_LEVEL;
  }
  elements.glossToggle.checked = state.showGloss;
  bindEvents();

  if (!state.sourceId) {
    state.phase = "error";
    state.error = {
      code: "source-missing",
      message: t("errorStudySourceExpired", [], "原网页内容已失效，请回到原网页重新打开学习模式。")
    };
    render();
    return;
  }
  start();
}

function bindEvents() {
  elements.levelButtons.forEach((button) => {
    button.addEventListener("click", () => setLevel(button.dataset.level));
  });

  elements.glossToggle.addEventListener("change", () => {
    state.showGloss = elements.glossToggle.checked;
    chrome.storage.local.set({ studyShowGloss: state.showGloss }).catch(() => {});
    render();
  });

  elements.translationToggle.addEventListener("click", () => {
    state.translationOpen = !state.translationOpen;
    render();
  });

  elements.actionButton.addEventListener("click", () => {
    if (isBusy()) stop();
    else start({ refresh: true });
  });
  elements.stateRetry.addEventListener("click", () => start());
  elements.stateSettings.addEventListener("click", openSettings);

  // 手机工具栏会随语言和宽度换行，按实际高度为章节跳转留出空间。
  const toolbar = document.querySelector(".toolbar");
  const syncToolbarHeight = () => document.documentElement.style.setProperty("--toolbar-height", `${Math.ceil(toolbar.getBoundingClientRect().height)}px`);
  new ResizeObserver(syncToolbarHeight).observe(toolbar);
  syncToolbarHeight();
  window.addEventListener("resize", () => hidePopover());

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-popover]")) {
      hidePopover({ restoreFocus: true });
      return;
    }
    const settingsButton = event.target.closest("[data-open-settings]");
    if (settingsButton) {
      openSettings();
      return;
    }
    const goto = event.target.closest("[data-goto-vocab]");
    if (goto) {
      showVocabCard(Number(goto.dataset.gotoVocab));
      return;
    }
    const mark = event.target.closest("#article mark.term[data-vocab]");
    if (mark) {
      if (mark.classList.contains("active")) hidePopover();
      else showPopover(mark);
      return;
    }
    if (!event.target.closest("#popover")) hidePopover();
    if (event.target.closest("#studyNav a[href='#study-TRANSLATION']") && !state.translationOpen) {
      state.translationOpen = true;
      render();
      return;
    }
    const toggle = event.target.closest("#article button[data-tr]");
    if (toggle) {
      toggleParagraphTranslation(Number(toggle.dataset.tr));
      return;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      hidePopover({ restoreFocus: true });
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && event.target.matches?.("mark.term[data-vocab]")) {
      event.preventDefault();
      showPopover(event.target, { focus: true });
    }
  });
}

function setLevel(level) {
  const next = Study.normalizeStudyLevel(level);
  if (next === state.level && state.phase !== "error" && state.phase !== "stopped") return;
  state.level = next;
  chrome.storage.local.set({ studyLevel: next }).catch(() => {});
  start();
}

function start(options = {}) {
  hidePopover();
  state.revealed.clear();
  let port = null;
  try {
    port = ensurePort();
  } catch (error) {
    // 扩展重新加载后旧页面无法再连接后台，只能提示刷新。
    state.phase = "error";
    state.error = { message: t("studyErrorDisconnected", [], "与扩展后台的连接中断，请刷新本页或点「重新生成」重试。") };
    render();
    return;
  }

  if (isBusy() && state.requestId) port.postMessage({ type: "cancel", requestId: state.requestId });
  state.requestId = createId("study");
  Object.assign(state, {
    phase: "loading",
    translationOpen: false,
    text: "",
    cached: false,
    finishReason: "",
    repetition: false,
    error: null,
    startedAt: Date.now(),
    finishedAt: 0
  });
  port.postMessage({
    type: "start",
    requestId: state.requestId,
    sourceId: state.sourceId,
    level: state.level,
    refresh: options.refresh === true,
    sessionId: state.sessionId
  });
  startTimers();
  render();
}

function stop() {
  if (!isBusy()) return;
  try {
    state.port?.postMessage({ type: "cancel", requestId: state.requestId });
  } catch (error) {
    // 连接已断开时后台会自行取消请求。
  }
  state.requestId = "";
  finish("stopped");
}

function ensurePort() {
  if (state.port) return state.port;
  const port = chrome.runtime.connect({ name: STUDY_PORT_NAME });
  port.onMessage.addListener(handlePortMessage);
  port.onDisconnect.addListener(() => {
    if (state.port === port) state.port = null;
    if (!isBusy()) return;
    state.error = { message: t("studyErrorDisconnected", [], "与扩展后台的连接中断，请刷新本页或点「重新生成」重试。") };
    finish("error");
  });
  state.port = port;
  return port;
}

function handlePortMessage(message) {
  if (!message || message.requestId !== state.requestId) return;

  if (message.type === "source") {
    state.source = {
      title: String(message.title || ""),
      url: String(message.url || ""),
      source: message.source === "selection" ? "selection" : "page",
      cut: message.cut === true
    };
    scheduleRender();
    return;
  }

  if (message.type === "cached") {
    state.text = String(message.text || "");
    state.cached = true;
    finish("done");
    return;
  }

  if (message.type === "started") {
    state.phase = "streaming";
    scheduleRender();
    return;
  }

  if (message.type === "delta") {
    state.phase = "streaming";
    state.text += String(message.delta || "");
    scheduleRender();
    return;
  }

  if (message.type === "done") {
    state.text = String(message.text || state.text);
    state.finishReason = String(message.finishReason || "");
    state.repetition = message.repetition === true;
    finish("done");
    return;
  }

  if (message.type === "error") {
    state.error = { code: String(message.code || ""), message: String(message.error || "") };
    finish("error");
  }
}

function finish(phase) {
  state.phase = phase;
  state.finishedAt = Date.now();
  stopTimers();
  render();
}

function startTimers() {
  stopTimers();
  state.pingTimer = setInterval(() => {
    try {
      state.port?.postMessage({ type: "ping" });
    } catch (error) {
      // 断开由 onDisconnect 统一处理。
    }
  }, PING_INTERVAL_MS);
  state.tickTimer = setInterval(renderProgress, 1000);
}

function stopTimers() {
  clearInterval(state.pingTimer);
  clearInterval(state.tickTimer);
  state.pingTimer = null;
  state.tickTimer = null;
}

function isBusy() {
  return state.phase === "loading" || state.phase === "streaming";
}

function scheduleRender() {
  if (state.renderTimer) return;
  state.renderTimer = setTimeout(render, RENDER_INTERVAL_MS);
}

function render() {
  clearTimeout(state.renderTimer);
  state.renderTimer = null;
  const parsed = Study.parseStudyOutput(state.text, !isBusy());
  state.lastParsed = parsed;

  renderToolbar();
  const blocking = getBlockingState(parsed);
  elements.statePanel.hidden = !blocking;
  elements.paper.hidden = Boolean(blocking);
  if (blocking) {
    hidePopover();
    renderStatePanel(blocking);
    renderStudySections(null);
  } else {
    renderArticle(parsed);
    renderStudySections(parsed);
  }
  renderProgress();
  renderFooter();
}

function setHtml(element, html) {
  if (renderedHtml.get(element) === html) return;
  element.innerHTML = html;
  renderedHtml.set(element, html);
}

function setText(element, text) {
  if (element.textContent !== text) element.textContent = text;
}

function renderToolbar() {
  elements.levelButtons.forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.level === state.level));
  });
  const busy = isBusy();
  setText(elements.actionButton, busy ? t("studyStop", [], "停止") : t("studyRegenerate", [], "重新生成"));
  elements.actionButton.classList.toggle("is-stop", busy);
  elements.actionButton.disabled = !busy && state.error?.code === "source-missing";
}

function getBlockingState(parsed) {
  if (parsed.flags.has("NOT_ENGLISH")) {
    return {
      title: t("studyNotEnglishTitle", [], "这部分内容不是英文"),
      message: t("errorStudyNotEnglish", [], "学习模式目前只支持英文内容。")
    };
  }
  if (parsed.flags.has("NO_CONTENT")) {
    return {
      title: t("studyNoContentTitle", [], "没有找到可以精读的正文"),
      message: t("studyNoContentHint", [], "可以先在原网页选中想精读的段落，再右键选择「用 AI 学习模式阅读」。")
    };
  }
  const hasArticle = Study.parseArticleBlocks(parsed.sections.ARTICLE).length > 0;
  // 输出格式异常时可能“完成”了却没有正文，给出明确提示，不留一页空白。
  if (state.phase === "done" && !hasArticle) {
    return {
      title: t("studyErrorTitle", [], "生成失败"),
      message: t("studyNoArticleReturned", [], "AI 没有返回正文，可以点「重新生成」再试一次。"),
      retry: true
    };
  }
  if (state.phase === "error" && !hasArticle) {
    const missing = state.error?.code === "source-missing";
    return {
      title: missing ? t("studySourceMissingTitle", [], "原网页内容已失效") : t("studyErrorTitle", [], "生成失败"),
      message: state.error?.message || t("errorUnknown", [], "未知错误"),
      retry: !missing,
      settings: !missing
    };
  }
  return null;
}

function renderStatePanel(blocking) {
  setText(elements.stateTitle, blocking.title);
  setText(elements.stateMessage, blocking.message);
  elements.stateRetry.hidden = !blocking.retry;
  elements.stateSettings.hidden = !blocking.settings;
}

function renderArticle(parsed) {
  const { sections } = parsed;
  const source = state.source;
  setHtml(elements.source, source ? renderSourceLine(source) : "");
  const title = Study.parseTitle(sections.TITLE) || source?.title || "";
  setText(elements.title, title);
  const pageTitle = t("studyPageTitle", [], "DualRead 学习模式");
  const documentTitle = title ? `${title} - ${pageTitle}` : pageTitle;
  if (document.title !== documentTitle) document.title = documentTitle;

  const blocks = Study.parseArticleBlocks(sections.ARTICLE);
  const paragraphs = blocks.filter((block) => block.type === "paragraph");
  state.vocab = Study.parseVocabItems(sections.VOCAB);
  const ranges = Study.buildParagraphHighlights(
    paragraphs.map((block) => block.text),
    Study.parseKeySentences(sections.KEY),
    state.vocab
  );
  const translation = buildTranslationMap(sections.TRANSLATION);
  elements.paper.classList.toggle("hide-gloss", !state.showGloss);

  renderNotices(parsed);

  if (!blocks.length) {
    setText(elements.meta, "");
    setHtml(elements.article, isBusy()
      ? `<p class="pending typing">${escapeHtml(t("studyProgressExtracting", [], "正在从页面文字中提取正文"))}</p>`
      : "");
    return;
  }

  const streamingArticle = isBusy() && parsed.current === "ARTICLE";
  const toggleLabel = escapeHtml(t("studyParagraphTranslationAria", [], "本段译文"));
  const toggleText = escapeHtml(t("studyTranslateButton", [], "译"));
  let paragraphIndex = 0;
  setHtml(elements.article, blocks.map((block, index) => {
    const typing = streamingArticle && index === blocks.length - 1 ? " typing" : "";
    if (block.type === "heading") return `<h2 class="${typing.trim()}">${escapeHtml(block.text)}</h2>`;
    const highlighted = renderHighlightedText(block.text, ranges[paragraphIndex]);
    paragraphIndex += 1;
    // 译文默认收起，只由段末的“译”按钮切换；revealed 记录展开状态，重绘时保持一致。
    const translated = translation.paragraphs.get(block.n) || "";
    const open = Boolean(translated) && state.revealed.has(block.n);
    const toggle = translated
      ? `<button type="button" class="tr-toggle" data-tr="${block.n}" aria-expanded="${open}" aria-controls="zh-${block.n}" aria-label="${toggleLabel}">${toggleText}</button>`
      : "";
    return `<p id="p-${block.n}" data-n="${block.n}" class="${typing.trim()}">${highlighted}${toggle}</p>`
      + (translated ? `<p class="zh" id="zh-${block.n}"${open ? "" : " hidden"}>${escapeHtml(translated)}</p>` : "");
  }).join(""));

  // 正文还在生成时统计会不停跳动（“1 词 · 0 处重点词汇”），写完再显示。
  if (streamingArticle) {
    setText(elements.meta, "");
    return;
  }
  const allRanges = ranges.flat();
  const words = Study.countEnglishWords(paragraphs.map((block) => block.text).join(" "));
  const terms = allRanges.filter((range) => range.kind === "term").length;
  const keys = allRanges.filter((range) => range.kind === "key").length;
  const minutes = String(Math.max(1, Math.round(words / 200)));
  setText(elements.meta, t("studyMeta", [String(words), minutes, String(terms), String(keys)],
    `${words} 词 · 约 ${minutes} 分钟读完 · ${terms} 处重点词汇 · ${keys} 句关键句`));
}

function renderSourceLine(source) {
  const url = safeHttpUrl(source.url);
  let host = "";
  try {
    host = url ? new URL(url).hostname.replace(/^www\./, "") : "";
  } catch (error) {
    host = "";
  }
  const kind = source.source === "selection"
    ? t("studySourceSelection", [], "选中的文字")
    : t("studySourcePage", [], "整页文字，由 AI 提取正文");
  const link = host ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(host)}</a> · ` : "";
  return `${escapeHtml(t("studySourceLabel", [], "来源"))} ${link}${escapeHtml(kind)}`;
}

function renderNotices(parsed) {
  const notices = [];
  if (parsed.flags.has("TRUNCATED") || state.source?.cut) {
    notices.push({ text: t("studyNoticeTruncated", [], "原文较长，这次只精读了前一部分。") });
  }
  if (isThinkingControlPending(state.settings)) {
    notices.push({
      text: t("studyNoticeThinking", [], "当前连接可能没有关闭思考模式，生成会明显变慢。到设置页点「测试 API」即可自动关闭。"),
      settings: true
    });
  }
  if (state.phase === "stopped") {
    notices.push({ text: t("studyNoticeStopped", [], "已停止生成，点「重新生成」可以从头再来。") });
  }
  if (state.repetition) {
    notices.push({ text: t("studyNoticeRepetition", [], "AI 输出出现重复，已自动停止。可以点「重新生成」再试一次。") });
  } else if (state.phase === "done" && (state.finishReason === "length" || !Study.isCompleteStudyOutput(state.text))) {
    notices.push({ text: t("studyNoticeIncomplete", [], "AI 输出不完整，后面的内容可能缺失。可以点「重新生成」重试。") });
  }
  if (state.phase === "error") {
    notices.push({ text: `${t("studyErrorTitle", [], "生成失败")}：${state.error?.message || ""}`, error: true });
  }
  setHtml(elements.notices, notices.map((notice) => (
    `<p class="notice${notice.error ? " is-error" : ""}">${escapeHtml(notice.text)}`
    + (notice.settings ? `<button type="button" data-open-settings>${escapeHtml(t("studyOpenSettings", [], "打开设置"))}</button>` : "")
    + "</p>"
  )).join(""));
}

// 段落里可能同时有关键句（外层下划线）和重点词汇（内层高亮），按区间端点切段后再拼标签，保证嵌套合法。
// 词汇后紧跟语境短义作旁注，读正文时不必逐个点开。
function renderHighlightedText(text, ranges) {
  if (!ranges?.length) return escapeHtml(text);
  const points = new Set([0, text.length]);
  ranges.forEach((range) => {
    points.add(range.start);
    points.add(range.end);
  });
  const sorted = Array.from(points).sort((a, b) => a - b);
  let html = "";
  let inKey = false;
  for (let i = 0; i < sorted.length - 1; i += 1) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;
    const key = ranges.some((range) => range.kind === "key" && range.start <= start && range.end >= end);
    const term = ranges.find((range) => range.kind === "term" && range.start <= start && range.end >= end);
    if (key && !inKey) html += "<strong class=\"key\">";
    if (!key && inKey) html += "</strong>";
    inKey = key;
    const segment = escapeHtml(text.slice(start, end));
    const gloss = term && end === term.end ? state.vocab[term.index]?.gloss : "";
    html += term
      ? `<mark class="term" tabindex="0" role="button" aria-controls="popover" aria-expanded="false" data-vocab="${term.index}">${segment}</mark>`
        + (gloss ? `<span class="gloss${/^[.,;:!?)'"’”]/.test(text.slice(end)) ? " tight" : ""}">${escapeHtml(gloss)}</span>` : "")
      : segment;
  }
  if (inKey) html += "</strong>";
  return html;
}

function buildTranslationMap(md) {
  const blocks = Study.parseArticleBlocks(md);
  return {
    blocks,
    count: blocks.length,
    paragraphs: new Map(blocks.filter((block) => block.type === "paragraph").map((block) => [block.n, block.text])),
    headings: blocks.filter((block) => block.type === "heading").map((block) => block.text)
  };
}

function renderStudySections(parsed) {
  const visible = Boolean(parsed?.sections?.ARTICLE);
  const busy = isBusy();
  const counts = {};

  for (const name of NOTE_SECTIONS) {
    const section = document.getElementById(`study-${name}`);
    section.hidden = !visible;
    if (!visible) continue;

    const container = section.querySelector("[data-container]");
    const value = parsed.sections[name];
    let count = 0;
    let html = "";
    if (value === undefined) {
      html = `<p class="pending">${escapeHtml(busy
        ? t("studyPendingSection", [], "等待生成…")
        : t("studyMissingSection", [], "AI 没有返回这一部分。"))}</p>`;
    } else if (name === "VOCAB") {
      count = state.vocab.length;
      html = state.vocab.map((item, index) => (
        `<div class="card vocab-card" id="v-${index}">${renderVocabCard(item, index, false)}</div>`
      )).join("");
    } else if (name === "TRANSLATION") {
      const translation = buildTranslationMap(value);
      count = translation.paragraphs.size;
      html = translation.blocks.map((block) => (block.type === "heading"
        ? `<h3>${escapeHtml(block.text)}</h3>`
        : `<p data-n="${block.n}">${escapeHtml(block.text)}</p>`
      )).join("");
    } else if (name === "PARAGRAPHS") {
      const items = Study.parseOutlineItems(value);
      count = items.length;
      html = items.length ? `<ul class="outline">${items.map(renderOutlineItem).join("")}</ul>` : "";
    } else {
      const items = Study.parseNoteItems(value);
      count = items.length;
      html = renderNoteCards(items);
    }
    counts[name] = count;

    // 光标标记也计入比较：这一节写完后 HTML 会变化，从而重绘并去掉光标。
    const writing = busy && state.lastParsed?.current === name;
    setHtml(container, writing ? `${html}${TYPING_MARK}` : html);
    if (writing) container.lastElementChild?.classList.add("typing");
    if (name !== "PARAGRAPHS") {
      setText(section.querySelector("h2 small"), value === undefined
        ? ""
        : (name === "TRANSLATION"
          ? t("studyCountParagraphs", [String(count)], `${count} 段`)
          : t("studyCountItems", [String(count)], `${count} 条`)));
    }
  }

  // 全文翻译默认折叠：段落旁可逐段查看，整篇译文需要时再展开。
  elements.translationBody.classList.toggle("is-collapsed", !state.translationOpen);
  elements.translationToggle.setAttribute("aria-expanded", String(state.translationOpen));
  setText(elements.translationToggle, state.translationOpen ? t("studyCollapse", [], "收起") : t("studyExpand", [], "展开"));

  setHtml(elements.studyNav, visible
    ? NOTE_SECTIONS.map((name) => (
      `<a href="#study-${name}">${escapeHtml(getSectionName(name))}`
      + (parsed.sections[name] !== undefined ? `<span>${counts[name]}</span>` : "")
      + "</a>"
    )).join("")
    : "");
}

function renderNoteCards(items) {
  return items.map((item) => (
    `<div class="card note-card">${item.title ? `<h3>${escapeHtml(item.title)}</h3>` : ""}${renderNoteBody(item.lines)}</div>`
  )).join("");
}

function renderOutlineItem(item) {
  if (!item.from) return `<li>${renderInline(item.text)}</li>`;
  const range = item.to > item.from ? `¶${item.from}–${item.to}` : `¶${item.from}`;
  return `<li><a href="#p-${item.from}">${range}</a><span>${renderInline(item.text)}</span></li>`;
}

// 直接改 DOM 而不整段重绘，保留焦点和读者的选区；状态同步记在 revealed 里，之后的重绘结果与此一致。
function toggleParagraphTranslation(n) {
  const zh = document.getElementById(`zh-${n}`);
  if (!zh) return;
  const open = !state.revealed.has(n);
  if (open) state.revealed.add(n);
  else state.revealed.delete(n);
  zh.hidden = !open;
  document.querySelector(`#article [data-tr="${n}"]`)?.setAttribute("aria-expanded", String(open));
}

function renderNoteBody(lines) {
  let html = "";
  let list = [];
  let quote = [];
  let paragraph = [];
  const flushList = () => {
    if (list.length) html += `<ul>${list.map((text) => `<li>${renderLabeled(text)}</li>`).join("")}</ul>`;
    list = [];
  };
  const flushQuote = () => {
    if (quote.length) html += `<blockquote>${renderInline(quote.join(" "))}</blockquote>`;
    quote = [];
  };
  const flushParagraph = () => {
    if (paragraph.length) html += `<p>${renderLabeled(paragraph.join(" "))}</p>`;
    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      flushQuote();
      flushParagraph();
      continue;
    }
    if (line.startsWith(">")) {
      flushList();
      flushParagraph();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (/^([-*]|\d+[.)])\s+/.test(line)) {
      flushQuote();
      flushParagraph();
      list.push(line.replace(/^([-*]|\d+[.)])\s+/, ""));
      continue;
    }
    flushList();
    flushQuote();
    paragraph.push(line);
  }
  flushList();
  flushQuote();
  flushParagraph();
  return html;
}

function renderLabeled(text) {
  const { label, text: rest } = Study.parseLabeledLine(text);
  if (!label) return renderInline(text);
  return `<span class="label">${escapeHtml(getLabelText(label))}</span>${renderInline(rest)}`;
}

// 笔记里的 ==...== 表示例句中的重点部分；AI 输出不可信，先整体转义，再只生成这两种标签。
function renderInline(text) {
  return escapeHtml(dropDanglingMarkers(text))
    .replace(/==([^=\n]+?)==/g, "<mark>$1</mark>")
    .replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>");
}

// 流式输出可能停在半个标记中间，去掉未闭合的标记，避免页面闪出原始符号。
function dropDanglingMarkers(text) {
  let value = String(text || "");
  for (const marker of ["**", "=="]) {
    if ((value.split(marker).length - 1) % 2 === 1) {
      const index = value.lastIndexOf(marker);
      value = value.slice(0, index) + value.slice(index + marker.length);
    }
  }
  return value;
}

function renderVocabCard(item, index, withLink) {
  return `<div class="vocab-head"><span class="term-label">${escapeHtml(item.term)}</span>`
    + (item.base ? `<span class="base">${escapeHtml(item.base)}</span>` : "")
    + (item.ipa ? `<span class="ipa">/${escapeHtml(item.ipa)}/</span>` : "")
    + `</div><p class="vocab-main">${renderInline(item.meaning)}</p>`
    + (item.note ? `<p class="vocab-note">${renderInline(item.note)}</p>` : "")
    + (withLink ? `<button type="button" data-goto-vocab="${index}">${escapeHtml(t("studyGotoVocab", [], "查看词汇表"))}</button>` : "");
}

function renderProgress() {
  const busy = isBusy();
  elements.progress.hidden = !busy;
  if (!busy) return;
  const current = state.lastParsed?.current || "";
  const seconds = String(Math.max(0, Math.round((Date.now() - state.startedAt) / 1000)));
  // 进度行是 aria-live 区域，文字没变就不重写，避免读屏软件重复播报。
  setText(elements.progressText, current
    ? t("studyProgressSection", [getSectionName(current), seconds], `正在生成：${getSectionName(current)} · 已用 ${seconds} 秒`)
    : t("studyProgressWaiting", [seconds], `正在连接 AI · 已用 ${seconds} 秒`));
  const index = Math.max(0, PROGRESS_SECTIONS.indexOf(current === "TITLE" ? "ARTICLE" : current));
  elements.progressBar.style.width = `${Math.round((index / PROGRESS_SECTIONS.length) * 100)}%`;
}

function renderFooter() {
  const model = String(state.settings?.model || "").trim();
  const parts = [];
  if (state.phase === "done" && !state.repetition && state.finishReason !== "length" && Study.isCompleteStudyOutput(state.text)) {
    const seconds = String(Math.max(1, Math.round((state.finishedAt - state.startedAt) / 1000)));
    parts.push(state.cached
      ? t("studyCachedStatus", [], "来自本地缓存，点「重新生成」可重新请求 AI。")
      : t("studyDoneStatus", [seconds], `已完成 · 用时 ${seconds} 秒`));
  }
  if (model) parts.push(t("studyFooterModel", [model], `模型：${model}`));
  setText(elements.footStatus, parts.join(" · "));
}

function getSectionName(name) {
  const names = {
    TITLE: t("studySectionArticle", [], "正文"),
    ARTICLE: t("studySectionArticle", [], "正文"),
    KEY: t("studySectionKey", [], "关键句"),
    VOCAB: t("studySectionVocab", [], "重点词汇与词组"),
    GRAMMAR: t("studySectionGrammar", [], "重点语法"),
    SENTENCES: t("studySectionSentences", [], "长难句结构"),
    PARAGRAPHS: t("studySectionParagraphs", [], "文章脉络"),
    TRANSLATION: t("studySectionTranslation", [], "全文翻译")
  };
  return names[name] || name;
}

function getLabelText(label) {
  const labels = {
    explain: t("studyLabelExplain", [], "讲解"),
    core: t("studyLabelCore", [], "主干"),
    structure: t("studyLabelStructure", [], "结构"),
    translation: t("studyLabelTranslation", [], "译文"),
    en: t("studyLabelEn", [], "EN"),
    gist: t("studyLabelGist", [], "大意"),
    notes: t("studyLabelNotes", [], "要点")
  };
  return labels[label] || label;
}

// 与弹窗的速度提示同一口径：自动模式只有测试过当前地址和模型才会发送关闭思考的参数。
function isThinkingControlPending(settings) {
  if (!settings) return false;
  if (settings.disableThinking !== true) return true;
  const selected = Shared.normalizeThinkingStrategy(settings.thinkingStrategy);
  if (selected !== Shared.THINKING_STRATEGIES.AUTO) return false;
  const detectionKey = Shared.createThinkingStrategyDetectionKey(settings);
  return !detectionKey || settings.thinkingStrategyDetectionKey !== detectionKey;
}

function showPopover(mark, options = {}) {
  const index = Number(mark.dataset.vocab);
  const item = state.vocab[index];
  if (!item) return;
  hidePopover();
  const popover = elements.popover;
  popover.innerHTML = `<button type="button" class="popover-close" data-close-popover aria-label="${escapeHtml(t("close", [], "关闭"))}">×</button>`
    + renderVocabCard(item, index, true);
  popover.hidden = false;
  mark.classList.add("active");
  mark.setAttribute("aria-expanded", "true");
  if (options.focus) popover.querySelector("[data-close-popover]").focus({ preventScroll: true });
  if (window.matchMedia("(max-width: 720px)").matches) return;
  const rect = mark.getBoundingClientRect();
  const width = popover.offsetWidth;
  const maxLeft = window.scrollX + document.documentElement.clientWidth - width - 16;
  popover.style.left = `${Math.max(16, Math.min(rect.left + window.scrollX, maxLeft))}px`;
  const height = popover.offsetHeight;
  const below = rect.bottom + 8;
  const preferredTop = below + height <= window.innerHeight - 16 ? below : rect.top - height - 8;
  popover.style.top = `${window.scrollY + Math.max(16, Math.min(preferredTop, window.innerHeight - height - 16))}px`;
}

function hidePopover(options = {}) {
  elements.popover.hidden = true;
  const active = document.querySelector("mark.term.active");
  document.querySelectorAll("mark.term.active").forEach((mark) => {
    mark.classList.remove("active");
    mark.setAttribute("aria-expanded", "false");
  });
  if (options.restoreFocus) active?.focus({ preventScroll: true });
}

function showVocabCard(index) {
  hidePopover();
  const card = document.getElementById(`v-${index}`);
  if (!card) return;
  card.scrollIntoView({ block: "center" });
  card.classList.remove("flash");
  void card.offsetWidth;
  card.classList.add("flash");
}

function openSettings() {
  chrome.runtime.openOptionsPage();
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (error) {
    return "";
  }
}

function createId(prefix) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

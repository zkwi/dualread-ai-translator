(function (root) {
  const shared = root.LLMTranslatorShared || (typeof require === "function" ? require("./shared.js") : null);

  // 提示词或输出格式变化时递增，避免读到旧格式的缓存课程。
  const STUDY_PROMPT_VERSION = "1";
  const STUDY_CACHE_PREFIX = `${shared.CACHE_PREFIX}study:`;
  // 页面最多抓 60000 字符，发给模型的再截到 12000：长文实测会让模型后半篇漏标，输出也更慢。
  const STUDY_CAPTURE_MAX_CHARS = 60000;
  const STUDY_SOURCE_MAX_CHARS = 12000;
  const STUDY_MIN_SOURCE_CHARS = 40;
  // 弹窗按钮可能遇到之前随手选中的一个词，选区要够长才当作要精读的段落；右键菜单是对选区点的，一两句话就够。
  const STUDY_MIN_SELECTION_CHARS = 80;
  const STUDY_MIN_CONTEXT_SELECTION_CHARS = 40;
  // DeepSeek 不传 max_tokens 时会在 8192 处截断；12000 足够 12000 字符原文的完整课程。
  const STUDY_MAX_TOKENS = 12000;
  const DEFAULT_STUDY_LEVEL = "cet6";
  const STUDY_LEVEL_IDS = ["cet4", "cet6", "b2", "c1"];
  const FLAG_MARKERS = new Set(["TRUNCATED", "END", "NO_CONTENT", "NOT_ENGLISH"]);
  const NOTE_LABELS = new Map([
    ["explain", "explain"],
    ["core", "core"],
    ["structure", "structure"],
    ["translation", "translation"],
    ["en", "en"],
    ["gist", "gist"],
    ["notes", "notes"]
  ]);

  const LEVEL_PROMPTS = {
    cet4: {
      label: "CET-4 (China's College English Test Band 4, about CEFR B1)",
      guide: [
        "The learner knows about 4,500 common words (the CET-4 syllabus).",
        "Pick words and phrases beyond CET-4 that matter for understanding, plus common but important phrasal verbs and collocations.",
        "Explain mainly in the learner's language, in simple terms. Give IPA for single words.",
        "Pick 15-25 items."
      ]
    },
    cet6: {
      label: "CET-6 (China's College English Test Band 6, about CEFR B2)",
      guide: [
        "The learner knows about 6,000 words (the CET-6 syllabus).",
        "Pick words beyond CET-6 and expressions useful for writing and translation.",
        "Explain in the learner's language, each followed by a short English definition. Give IPA for single words.",
        "Pick 15-25 items."
      ]
    },
    b2: {
      label: "CEFR B2 (about IELTS 6-6.5)",
      guide: [
        "Pick C1/C2 vocabulary, collocations, phrasal verbs and idioms. Skip everyday B1/B2 words.",
        "Give a short English definition first, then a brief gloss in the learner's language.",
        "Pick 12-20 items."
      ]
    },
    c1: {
      label: "CEFR C1 (about IELTS 7-8)",
      guide: [
        "Skip common words. Pick only advanced or low-frequency vocabulary, idioms, nuanced word choices, figurative and journalistic expressions.",
        "Explain mainly in English, with a brief gloss in the learner's language.",
        "Pay attention to style, tone and how sentences are built.",
        "Pick 10-18 items."
      ]
    }
  };

  const STUDY_SYSTEM_PROMPT = "You are an experienced English teacher and a careful text editor. You turn raw webpage text into a clean reading lesson and follow the output format exactly.";

  function normalizeStudyLevel(level) {
    const value = String(level || "").trim().toLowerCase();
    return STUDY_LEVEL_IDS.includes(value) ? value : DEFAULT_STUDY_LEVEL;
  }

  function normalizeSourceText(text) {
    return String(text || "")
      .replace(/\r\n?/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // 在行边界截断，避免把最后一段从句子中间切开。
  function prepareStudySource(text) {
    const clean = normalizeSourceText(text);
    if (clean.length <= STUDY_SOURCE_MAX_CHARS) return { text: clean, cut: false };
    const head = clean.slice(0, STUDY_SOURCE_MAX_CHARS);
    const lineEnd = head.lastIndexOf("\n");
    return {
      text: lineEnd > STUDY_SOURCE_MAX_CHARS * 0.6 ? head.slice(0, lineEnd).trimEnd() : head,
      cut: true
    };
  }

  // 本地先挡掉明显不是英文的页面（中日韩、俄文、阿拉伯文），不必等模型回 NOT_ENGLISH。
  function isMostlyEnglishText(text) {
    const value = String(text || "");
    const latin = (value.match(/[A-Za-z]/g) || []).length;
    const other = (value.match(/[\u0400-\u04ff\u0600-\u06ff\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g) || []).length;
    return latin >= 20 && latin / Math.max(1, latin + other) >= 0.5;
  }

  function buildStudyMessages({ title, url, text, source, cut, level, targetLanguage }) {
    const config = LEVEL_PROMPTS[normalizeStudyLevel(level)];
    const learnerLanguage = String(targetLanguage || "").trim() || "简体中文";
    const isSelection = source === "selection";
    const user = [
      `Learner level: ${config.label}`,
      ...config.guide,
      `The learner's language: ${learnerLanguage}. Write explanations, gists and translations in it, except where the level guide asks for English.`,
      "",
      "Tasks:",
      isSelection
        ? "1. The text below is a passage the learner selected. Treat all of it as the article; only drop obvious UI words such as \"Share\" or \"Read more\"."
        : "1. Find the main article (title and body) in the raw page text below. Drop everything else: navigation, menus, bylines, timestamps, share buttons, image or video captions, related links, ads, comments, footers and code blocks.",
      "2. Copy the article body VERBATIM. Do not rewrite, simplify, summarize or skip sentences. Only join broken line wraps and drop citation marks such as [1]. Add no markup, IPA or notes inside the article.",
      "   Start every body paragraph with its number: ¶1, ¶2, ... Use \"## \" only for real subheadings (short standalone lines, usually under 12 words, no final period); subheadings get no number.",
      "3. Write the study notes in the sections below. Scale every section to the length of the text: a short passage needs only a few items, so never pad with weak ones. Accuracy matters more than quantity: choose only grammar points and structures that really occur in the article and label them correctly. Only call something inversion when an auxiliary or verb really comes before the subject, and only call it subjunctive or unreal when the verb form really shows it. If you are not sure a label is right, pick a different point.",
      "",
      "If the main content is not in English, output only the line: @@NOT_ENGLISH",
      "If there is no readable main content (for example only a list of links), output only the line: @@NO_CONTENT",
      ...(cut ? [`The text below was cut at ${STUDY_SOURCE_MAX_CHARS} characters. End the article at the last complete paragraph and put the line @@TRUNCATED right after it.`] : []),
      "",
      "Output format. Each section marker stands alone on its own line, in this order:",
      "@@TITLE",
      "the article title in English",
      "@@ARTICLE",
      "the article, one blank line between blocks",
      "@@KEY",
      "3-6 key sentences spread over the article (the main claim, turning points and the conclusion, at most one per paragraph), each copied exactly from the article:",
      "- the exact sentence",
      "@@VOCAB",
      "the key words and phrases the learner should learn, in order of appearance. Go through the article from the first paragraph to the last and take about one item from every paragraph or two, so the items cover the whole article. Start each item with the words exactly as they appear in the article. Give at most two short meanings per item:",
      "- ==the words as they appear in the article== (base form, only if different) /IPA/ part of speech meaning in the learner's language; short English definition — collocation or usage note",
      "@@GRAMMAR",
      "2-4 grammar points. For each:",
      "### the point's name in the learner's language and in English",
      "> the sentence from the article, with the relevant part in ==...==",
      "- Explain: how the structure works here and how to use it",
      "@@SENTENCES",
      "2-4 long or difficult sentences from the article. For each:",
      "### a short label",
      "> the sentence",
      "- Core: the main clause",
      "- Structure: the clauses and modifiers and what they attach to",
      "- Translation: the sentence in the learner's language",
      "@@PARAGRAPHS",
      "For each paragraph or group of related paragraphs, using the ¶ numbers from the article:",
      "### ¶1-2",
      "- EN: the gist in one simple English sentence",
      "- Gist: the gist in the learner's language",
      "- Notes: the logic, writing technique or background worth noticing",
      "@@TRANSLATION",
      "a faithful translation of the whole article into the learner's language, block by block in the same order: keep each paragraph's ¶ number and write subheadings as \"## \"; one blank line between blocks",
      "@@END",
      "",
      `Page title: ${String(title || "").trim()}`,
      // 只发域名：完整 URL 的路径和查询参数可能带会话令牌，对提取正文也没有帮助。
      `Page site: ${getHostname(url)}`,
      isSelection ? "Selected text:" : "Raw page text:",
      "<<<",
      String(text || ""),
      ">>>"
    ].join("\n");

    return [
      { role: "system", content: STUDY_SYSTEM_PROMPT },
      { role: "user", content: user }
    ];
  }

  function getHostname(url) {
    try {
      return new URL(String(url || "")).hostname;
    } catch (error) {
      return "";
    }
  }

  function createStudyCacheKey(settings, level, sourceText, sourceKind) {
    const input = settings || {};
    const payload = [
      shared.normalizeChatCompletionsUrl(input.apiUrl || ""),
      input.model || "",
      input.targetLanguage || "",
      normalizeStudyLevel(level),
      STUDY_PROMPT_VERSION,
      sourceKind === "selection" ? "selection" : "page",
      String(sourceText || "").trim()
    ].join("\n");
    return `${STUDY_CACHE_PREFIX}${shared.simpleHash(payload)}`;
  }

  function parseStudyOutput(text, complete = true) {
    const lines = String(text || "").split(/\r?\n/);
    // 流式时最后一行可能是写到一半的分段标记，先不展示，避免闪出 “@@VOC”。
    if (!complete && lines.length && lines[lines.length - 1].trim().startsWith("@")) lines.pop();
    const buckets = {};
    const flags = new Set();
    let current = "";
    for (const line of lines) {
      const marker = line.trim().match(/^@@([A-Z_]+)$/);
      if (marker) {
        if (FLAG_MARKERS.has(marker[1])) {
          flags.add(marker[1]);
        } else {
          current = marker[1];
          buckets[current] = buckets[current] || [];
        }
        continue;
      }
      if (current) buckets[current].push(line);
    }
    const sections = {};
    for (const [name, value] of Object.entries(buckets)) sections[name] = value.join("\n").trim();
    return { sections, flags, current: complete ? "" : current };
  }

  function isCompleteStudyOutput(text) {
    const { sections, flags } = parseStudyOutput(text, true);
    if (!flags.has("END") || flags.has("NO_CONTENT") || flags.has("NOT_ENGLISH")) return false;
    const paragraphs = parseArticleBlocks(sections.ARTICLE).filter((block) => block.type === "paragraph");
    const translations = parseArticleBlocks(sections.TRANSLATION).filter((block) => block.type === "paragraph");
    // 网关可能在半句处结束且不带 finish_reason；结束标记和逐段对齐都满足才缓存，避免反复复用半成品。
    return paragraphs.length > 0
      && paragraphs.length === translations.length
      && new Set(paragraphs.map((block) => block.n)).size === paragraphs.length
      && paragraphs.every((block, index) => block.n === translations[index].n);
  }

  // 正文和译文共用：空行分块，"## " 是小标题，"¶n" 是段号。段号缺失时按顺序补，保证两边能对齐。
  function parseArticleBlocks(md) {
    const blocks = [];
    let lastNumber = 0;
    for (const chunk of String(md || "").split(/\n\s*\n/)) {
      const body = [];
      for (const rawLine of chunk.split("\n")) {
        const line = rawLine.trim();
        if (!line) continue;
        const heading = line.match(/^#{1,6}\s+(.+)$/);
        if (heading && body.length === 0) {
          blocks.push({ type: "heading", text: stripInlineMarkers(heading[1]) });
          continue;
        }
        body.push(line);
      }
      if (!body.length) continue;
      let text = body.join(" ");
      const numbered = text.match(/^¶\s*(\d+)[.:：]?\s*/);
      let number = lastNumber + 1;
      if (numbered) {
        number = Number(numbered[1]);
        text = text.slice(numbered[0].length);
      }
      lastNumber = number;
      text = stripInlineMarkers(text);
      if (text) blocks.push({ type: "paragraph", n: number, text });
    }
    return blocks;
  }

  // 正文要求不带标记；模型偶尔仍会加 ==/**，展示前去掉，高亮统一由词汇表和关键句定位。
  function stripInlineMarkers(text) {
    return String(text || "").replace(/==|\*\*/g, "").trim();
  }

  function parseListLines(md) {
    return String(md || "")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^([-*]|\d+[.)])\s+/.test(line))
      .map((line) => line.replace(/^([-*]|\d+[.)])\s+/, "").trim())
      .filter(Boolean);
  }

  // 模型偶尔会把段号也抄进关键句（“¶3 But officials…”），去掉后才能在正文里逐字找到。
  function parseKeySentences(md) {
    return parseListLines(md)
      .map((line) => stripInlineMarkers(line.replace(/^¶\s*\d+[.:：]?\s*/, "")))
      .filter(Boolean);
  }

  function parseTitle(md) {
    return stripInlineMarkers(String(md || "").split("\n")[0].replace(/^#+\s*/, ""));
  }

  function parseVocabItems(md) {
    return parseListLines(md).map((line) => {
      let rest = line;
      let term = "";
      let base = "";
      let ipa = "";
      const termMatch = rest.match(/^==([^=]+)==\s*/) || rest.match(/^\*\*([^*]+)\*\*\s*/);
      if (termMatch) {
        term = termMatch[1].trim();
        rest = rest.slice(termMatch[0].length);
      }
      const baseMatch = rest.match(/^[(（]([^)）]{1,60})[)）]\s*/);
      if (baseMatch) {
        base = baseMatch[1].trim();
        rest = rest.slice(baseMatch[0].length);
      }
      const ipaMatch = rest.match(/^\/([^/]{1,80})\/\s*/);
      if (ipaMatch) {
        ipa = ipaMatch[1].trim();
        rest = rest.slice(ipaMatch[0].length);
      }
      const [meaning, ...note] = rest.split(/\s+—\s+/);
      if (!term) term = meaning.split(/\s+/)[0] || "";
      return {
        term,
        base: base.toLowerCase() === term.toLowerCase() ? "" : base,
        ipa,
        meaning: meaning.trim(),
        note: note.join(" — ").trim()
      };
    }).filter((item) => item.term);
  }

  function parseNoteItems(md) {
    const items = [];
    let current = null;
    for (const rawLine of String(md || "").split("\n")) {
      const heading = rawLine.trim().match(/^#{2,4}\s+(.+)$/);
      if (heading) {
        current = { title: heading[1].trim(), lines: [] };
        items.push(current);
        continue;
      }
      if (!current) {
        if (!rawLine.trim()) continue;
        current = { title: "", lines: [] };
        items.push(current);
      }
      current.lines.push(rawLine);
    }
    return items;
  }

  // 输出里的固定英文标签（Explain / Core ...）由页面按界面语言显示，兼容模型偶尔写成小写。
  function parseLabeledLine(line) {
    const match = String(line || "").match(/^([A-Za-z]{2,12})\s*[:：]\s*(.*)$/);
    const label = match && NOTE_LABELS.get(match[1].toLowerCase());
    return label ? { label, text: match[2] } : { label: "", text: String(line || "") };
  }

  // 只做同长度替换，替换后的下标仍能对应原文。
  function foldQuotes(text) {
    return String(text || "")
      .replace(/[\u2018\u2019\u201b\u2032]/g, "'")
      .replace(/[\u201c\u201d\u2033]/g, "\"")
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u00a0/g, " ");
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function wrapWordBoundary(phrase, pattern) {
    const start = /^\w/.test(phrase) ? "\\b" : "";
    const end = /\w$/.test(phrase) ? "\\b" : "";
    return `${start}${pattern}${end}`;
  }

  function createExactPattern(phrase) {
    const folded = foldQuotes(phrase).trim();
    if (!folded) return null;
    const body = folded.split(/\s+/).map(escapeRegExp).join("\\s+");
    return new RegExp(wrapWordBoundary(folded, body), "gi");
  }

  // 词汇表常写原形（barricade / fall apart / mar），正文是屈折形式（barricades / falling apart / marred）：
  // 词干去掉结尾的 e、y 后允许最多 4 个字母的词尾，三字母词允许双写辅音，两字母词要求一致。
  function createFuzzyPattern(phrase) {
    const words = foldQuotes(phrase).trim().split(/[\s-]+/).filter(Boolean);
    if (!words.length || words.some((word) => !/^[A-Za-z']+$/.test(word))) return null;
    const body = words.map((word) => {
      if (word.length <= 2) return escapeRegExp(word);
      if (word.length === 3) {
        const last = escapeRegExp(word[2]);
        return `${escapeRegExp(word)}(?:s|es|ed|ing|${last}ed|${last}ing)?`;
      }
      if (/y$/i.test(word)) return `${escapeRegExp(word.slice(0, -1))}(?:y|i)[\\w']{0,4}`;
      const stem = /e$/i.test(word) ? word.slice(0, -1) : word;
      return `${escapeRegExp(stem)}[\\w']{0,4}`;
    }).join("[\\s-]+");
    return new RegExp(`\\b${body}\\b`, "gi");
  }

  function findPattern(text, pattern, fromIndex, isFree) {
    if (!pattern) return null;
    pattern.lastIndex = Math.max(0, fromIndex || 0);
    for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
      if (!match[0]) {
        pattern.lastIndex += 1;
        continue;
      }
      const range = { start: match.index, end: match.index + match[0].length };
      if (!isFree || isFree(range)) return range;
    }
    return null;
  }

  // 搭配常写成不连续的形式（prevent ... from / level the blame at sb），整体找不到时退回到省略号或占位词之前的部分。
  function getSearchTerms(item) {
    const terms = [item.term, item.base].filter(Boolean);
    for (const term of terms.slice()) {
      const head = term.split(/\s*(?:\.{3}|\u2026)\s*|\s+(?:sb|sth|someone|something|one's)\b/i)[0].trim();
      if (head && head !== term && !terms.includes(head)) terms.push(head);
    }
    return terms;
  }

  // 按“词汇表顺序 = 出现顺序”从上一个词的位置往后找，找不到再从头找；关键句只要求逐字出现。
  function buildParagraphHighlights(paragraphs, keySentences, vocabItems) {
    const texts = (paragraphs || []).map((text) => foldQuotes(text));
    const ranges = texts.map(() => []);
    const overlaps = (list, range) => list.some((item) => item.kind === range.kind && range.start < item.end && item.start < range.end);

    for (const sentence of keySentences || []) {
      const candidates = [sentence];
      const unquoted = sentence.replace(/^["'\u201c\u2018](.*)["'\u201d\u2019]$/s, "$1");
      if (unquoted !== sentence) candidates.push(unquoted);
      let placed = false;
      for (const candidate of candidates) {
        const pattern = createExactPattern(candidate);
        for (let p = 0; p < texts.length && !placed; p += 1) {
          const range = findPattern(texts[p], pattern, 0, (r) => !overlaps(ranges[p], { ...r, kind: "key" }));
          if (range) {
            ranges[p].push({ ...range, kind: "key" });
            placed = true;
          }
        }
        if (placed) break;
      }
    }

    let cursor = { paragraph: 0, offset: 0 };
    (vocabItems || []).forEach((item, index) => {
      const terms = getSearchTerms(item);
      const patterns = terms.map(createExactPattern).concat(terms.map(createFuzzyPattern));
      // 先找当前段剩余部分和后面各段，最后才绕回开头，含当前段已经走过的部分。
      const order = [[cursor.paragraph, cursor.offset]];
      for (let p = cursor.paragraph + 1; p < texts.length; p += 1) order.push([p, 0]);
      for (let p = 0; p < cursor.paragraph; p += 1) order.push([p, 0]);
      if (cursor.offset > 0) order.push([cursor.paragraph, 0]);
      for (const pattern of patterns) {
        for (const [p, from] of order) {
          if (p >= texts.length) continue;
          const range = findPattern(texts[p], pattern, from, (r) => !overlaps(ranges[p], { ...r, kind: "term" }));
          if (range) {
            ranges[p].push({ ...range, kind: "term", index });
            cursor = { paragraph: p, offset: range.end };
            return;
          }
        }
      }
    });

    ranges.forEach((list) => list.sort((a, b) => a.start - b.start || b.end - a.end));
    return ranges;
  }

  // 低温度生成偶尔陷入“冲突；冲突；冲突；…”式复读，会一直写到 max_tokens；检测到就中止。
  const REPETITION_PATTERN = /([\s\S]{1,40}?)\1{9,}$/;

  function findRepetitionLoop(text) {
    const value = String(text || "");
    const tail = value.slice(-400);
    const match = tail.match(REPETITION_PATTERN);
    if (!match || match[0].length < 120) return null;
    return { start: value.length - match[0].length, unit: match[1] };
  }

  function hasRepetitionLoop(text) {
    return Boolean(findRepetitionLoop(text));
  }

  // 去掉复读部分，只保留一次，已生成的正常内容照常展示。
  function trimRepetitionLoop(text) {
    const loop = findRepetitionLoop(text);
    if (!loop) return String(text || "");
    return `${String(text).slice(0, loop.start)}${loop.unit}`.trimEnd();
  }

  function countEnglishWords(text) {
    return (String(text || "").match(/[A-Za-z][A-Za-z'\u2019-]*/g) || []).length;
  }

  const api = {
    STUDY_PROMPT_VERSION,
    STUDY_CACHE_PREFIX,
    STUDY_CAPTURE_MAX_CHARS,
    STUDY_SOURCE_MAX_CHARS,
    STUDY_MIN_SOURCE_CHARS,
    STUDY_MIN_SELECTION_CHARS,
    STUDY_MIN_CONTEXT_SELECTION_CHARS,
    STUDY_MAX_TOKENS,
    DEFAULT_STUDY_LEVEL,
    STUDY_LEVEL_IDS,
    normalizeStudyLevel,
    prepareStudySource,
    isMostlyEnglishText,
    buildStudyMessages,
    createStudyCacheKey,
    parseStudyOutput,
    isCompleteStudyOutput,
    parseArticleBlocks,
    parseKeySentences,
    parseTitle,
    parseVocabItems,
    parseNoteItems,
    parseLabeledLine,
    buildParagraphHighlights,
    hasRepetitionLoop,
    trimRepetitionLoop,
    countEnglishWords
  };

  root.LLMStudyMode = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

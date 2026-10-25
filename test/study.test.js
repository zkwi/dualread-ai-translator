const assert = require("assert");
require("../shared.js");
const study = require("../study.js");
const { STUDY_LESSON: LESSON } = require("./fixtures/study-lesson.js");

testLevelsAndSourcePreparation();
testEnglishDetection();
testPromptMessages();
testCacheKey();
testParseOutputSectionsAndFlags();
testParseArticleBlocks();
testParseListsAndNotes();
testHighlightRanges();
testRepetitionLoop();
console.log("study helper tests passed");

function testLevelsAndSourcePreparation() {
  assert.deepStrictEqual(study.STUDY_LEVEL_IDS, ["cet4", "cet6", "b2", "c1"]);
  assert.strictEqual(study.normalizeStudyLevel("C1"), "c1");
  assert.strictEqual(study.normalizeStudyLevel("unknown"), study.DEFAULT_STUDY_LEVEL);

  const short = study.prepareStudySource("  Line one.\r\n\r\n\r\n\r\nLine two.\u00a0 \n");
  assert.deepStrictEqual(short, { text: "Line one.\n\nLine two.", cut: false });

  const line = "A sentence that keeps the reading going for a while.\n";
  const long = study.prepareStudySource(line.repeat(400));
  assert.strictEqual(long.cut, true);
  assert.ok(long.text.length <= study.STUDY_SOURCE_MAX_CHARS);
  assert.ok(long.text.endsWith("for a while."), "长文应在行边界截断，不能切在句子中间");
}

function testEnglishDetection() {
  assert.strictEqual(study.isMostlyEnglishText("The city council opened a new public library on Monday, ending years of delays."), true);
  assert.strictEqual(study.isMostlyEnglishText("咖啡是一种用烘焙过的咖啡豆制作的饮料，是世界上最流行的饮品之一。It is popular."), false);
  assert.strictEqual(study.isMostlyEnglishText("Short."), false, "太短的文字不足以判断，也不值得生成课程");
  assert.strictEqual(study.isMostlyEnglishText("Officials said the library would host classes."), true, "右键精读一句话时不能被误判成非英文");
}

function testPromptMessages() {
  const messages = study.buildStudyMessages({
    title: "City opens new library",
    url: "https://example.com/news",
    text: "Raw page text",
    source: "page",
    cut: true,
    level: "cet4",
    targetLanguage: "繁體中文"
  });
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].role, "system");
  const prompt = messages[1].content;
  assert.match(prompt, /CET-4/);
  assert.match(prompt, /The learner's language: 繁體中文/);
  assert.match(prompt, /Find the main article/);
  assert.match(prompt, /@@TRUNCATED/);
  assert.match(prompt, /¶1, ¶2/);
  assert.match(prompt, /@@NOT_ENGLISH/);
  assert.match(prompt, /<<<\nRaw page text\n>>>$/);
  assert.match(prompt, /Page site: example\.com\n/);
  assert.doesNotMatch(prompt, /example\.com\/news/, "不发送完整 URL，路径和查询参数可能含隐私信息");
  assert.doesNotMatch(prompt, /Typical grammar/, "级别说明不能点名语法结构，实测会诱导模型硬套倒装、虚拟语气");
  assert.match(prompt, /short passage needs only a few items/, "短段落不能按固定条数硬凑");

  const selection = study.buildStudyMessages({ text: "Picked text", source: "selection", level: "c1" })[1].content;
  assert.match(selection, /passage the learner selected/);
  assert.match(selection, /Selected text:/);
  assert.doesNotMatch(selection, /@@TRUNCATED right after/);
  assert.match(selection, /The learner's language: 简体中文/);
}

function testCacheKey() {
  const settings = { apiUrl: "https://api.example.com/v1", model: "m", targetLanguage: "简体中文" };
  const key = study.createStudyCacheKey(settings, "cet6", "Text", "page");
  assert.ok(key.startsWith("llm_translator_cache:study:"), "课程缓存要落在翻译缓存前缀下，设置页清缓存才会一并清掉");
  assert.strictEqual(key, study.createStudyCacheKey({ ...settings, apiUrl: "https://api.example.com/v1/chat/completions" }, "cet6", "Text", "page"));
  assert.notStrictEqual(key, study.createStudyCacheKey(settings, "c1", "Text", "page"));
  assert.notStrictEqual(key, study.createStudyCacheKey({ ...settings, model: "other" }, "cet6", "Text", "page"));
  assert.notStrictEqual(key, study.createStudyCacheKey(settings, "cet6", "Text", "selection"));
  assert.notStrictEqual(key, study.createStudyCacheKey(settings, "cet6", "Other text", "page"));
}

function testParseOutputSectionsAndFlags() {
  const parsed = study.parseStudyOutput(LESSON);
  assert.deepStrictEqual(Object.keys(parsed.sections), ["TITLE", "ARTICLE", "KEY", "VOCAB", "GRAMMAR", "SENTENCES", "PARAGRAPHS", "TRANSLATION"]);
  assert.ok(parsed.flags.has("END"));
  assert.strictEqual(parsed.sections.TITLE, "City opens new library");
  assert.strictEqual(study.isCompleteStudyOutput(LESSON), true);
  assert.strictEqual(study.isCompleteStudyOutput(LESSON.replace("@@END", "")), false, "没有结束标记的半成品不能当作完整课程");
  assert.strictEqual(study.isCompleteStudyOutput(LESSON.replace("¶3 官员表示，图书馆将开设课程并提供免费上网服务。", "")), false, "漏译一段时不能缓存");
  assert.strictEqual(study.isCompleteStudyOutput(LESSON.replace("¶3 官员表示", "¶4 官员表示")), false, "正文和译文段号必须逐段对应");
  assert.strictEqual(study.isCompleteStudyOutput(LESSON.replace("@@END", "@@TRUNCATED\n@@END")), true, "原文截断后生成的课程仍可完整结束");

  const streaming = study.parseStudyOutput("@@TITLE\nCity\n@@ARTICLE\n¶1 First paragraph.\n@@VOC", false);
  assert.strictEqual(streaming.current, "ARTICLE");
  assert.strictEqual(streaming.sections.ARTICLE, "¶1 First paragraph.", "写到一半的分段标记不能混进正文");
  assert.strictEqual(study.isCompleteStudyOutput("@@TITLE\nCity\n@@ARTICLE\n¶1 First paragraph."), false);

  const flagged = study.parseStudyOutput("@@NOT_ENGLISH");
  assert.ok(flagged.flags.has("NOT_ENGLISH"));
  assert.deepStrictEqual(flagged.sections, {});
  assert.ok(study.parseStudyOutput("@@ARTICLE\n¶1 Text.\n@@TRUNCATED\n@@KEY\n- Text.").flags.has("TRUNCATED"));
}

function testParseArticleBlocks() {
  const { sections } = study.parseStudyOutput(LESSON);
  const blocks = study.parseArticleBlocks(sections.ARTICLE);
  assert.deepStrictEqual(blocks.map((block) => [block.type, block.n]), [
    ["paragraph", 1],
    ["heading", undefined],
    ["paragraph", 2],
    ["paragraph", 3]
  ]);
  assert.strictEqual(blocks[1].text, "A long wait");
  assert.ok(blocks[0].text.startsWith("The city council"), "段号前缀要去掉");

  const translation = study.parseArticleBlocks(sections.TRANSLATION);
  assert.deepStrictEqual(translation.filter((block) => block.type === "paragraph").map((block) => block.n), [1, 2, 3]);

  const unnumbered = study.parseArticleBlocks("First ==marked== text\ncontinues here.\n\n**Second** paragraph.\n\n¶7 Seventh.\n\nNext one.");
  assert.deepStrictEqual(unnumbered.map((block) => [block.n, block.text]), [
    [1, "First marked text continues here."],
    [2, "Second paragraph."],
    [7, "Seventh."],
    [8, "Next one."]
  ]);
}

function testParseListsAndNotes() {
  const { sections } = study.parseStudyOutput(LESSON);
  const keys = study.parseKeySentences(sections.KEY);
  assert.strictEqual(keys.length, 2);
  assert.deepStrictEqual(study.parseKeySentences("- ¶3 But officials said so.\n- **Bold claim.**"), ["But officials said so.", "Bold claim."]);
  assert.strictEqual(study.parseTitle("## **City opens new library**\nextra line"), "City opens new library");

  const vocab = study.parseVocabItems(sections.VOCAB);
  assert.deepStrictEqual(vocab[0], {
    term: "council",
    base: "",
    ipa: "ˈkaʊnsl",
    meaning: "n. 委员会；市政会",
    note: "city council 市议会"
  });
  assert.strictEqual(vocab[3].base, "", "与词条相同的原形不重复显示");
  assert.strictEqual(vocab[3].note, "");

  const grammar = study.parseNoteItems(sections.GRAMMAR);
  assert.strictEqual(grammar.length, 1);
  assert.match(grammar[0].title, /Participle clause/);
  assert.deepStrictEqual(study.parseLabeledLine("structure: arguing that"), { label: "structure", text: "arguing that" });
  assert.deepStrictEqual(study.parseLabeledLine("Gist：大意"), { label: "gist", text: "大意" });
  assert.deepStrictEqual(study.parseLabeledLine("https://example.com"), { label: "", text: "https://example.com" });
}

function testHighlightRanges() {
  const { sections } = study.parseStudyOutput(LESSON);
  const paragraphs = study.parseArticleBlocks(sections.ARTICLE)
    .filter((block) => block.type === "paragraph")
    .map((block) => block.text);
  const ranges = study.buildParagraphHighlights(
    paragraphs,
    study.parseKeySentences(sections.KEY),
    study.parseVocabItems(sections.VOCAB)
  );
  const slice = (p, range) => paragraphs[p].slice(range.start, range.end);

  assert.deepStrictEqual(ranges[0].filter((r) => r.kind === "key").map((r) => slice(0, r)), [paragraphs[0]]);
  assert.deepStrictEqual(ranges[2].filter((r) => r.kind === "key").map((r) => slice(2, r)), [paragraphs[2]], "带弯引号的关键句也要能对上原文");

  const terms = ranges.flatMap((list, p) => list.filter((r) => r.kind === "term").map((r) => [r.index, p, slice(p, r)]));
  assert.deepStrictEqual(terms, [
    [0, 0, "council"],
    [1, 1, "campaigned"],
    [2, 1, "falling apart"],
    [3, 2, "host"]
  ], "原形词条要匹配到正文里的变形，并按出现顺序定位");

  const discontinuous = study.buildParagraphHighlights(
    ["Police tried to prevent the protests from spreading, and critics levelled the blame at Macron."],
    [],
    [{ term: "prevent ... from" }, { term: "level the blame at sb" }]
  );
  assert.deepStrictEqual(
    discontinuous[0].map((r) => "Police tried to prevent the protests from spreading, and critics levelled the blame at Macron.".slice(r.start, r.end)),
    ["prevent", "levelled the blame at"],
    "不连续搭配退回到省略号或占位词之前的部分来定位"
  );

  const ordered = study.buildParagraphHighlights(
    ["A record low.", "They will record it again later."],
    [],
    [{ term: "low" }, { term: "record" }]
  );
  assert.deepStrictEqual(ordered[1].map((r) => r.index), [1], "后一个词条应在前一个词条之后的位置找，而不是回到开头");
}

function testRepetitionLoop() {
  const looped = `- ==clashes== n. 冲突；冲突事件；${"冲突；".repeat(60)}`;
  assert.strictEqual(study.hasRepetitionLoop(looped), true);
  assert.strictEqual(study.trimRepetitionLoop(looped), "- ==clashes== n. 冲突；冲突事件；冲突；");
  assert.strictEqual(study.hasRepetitionLoop(LESSON), false);
  assert.strictEqual(study.hasRepetitionLoop("…".repeat(30)), false, "短的重复符号不算复读");
  assert.strictEqual(study.trimRepetitionLoop(LESSON), LESSON);
}

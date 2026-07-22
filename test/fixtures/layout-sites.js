const BASE_CSS = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #f5f7fa; color: #1f2937; font-family: Arial, Helvetica, sans-serif; }
  body { min-height: 100vh; }
  main, .page-shell { width: min(960px, calc(100vw - 32px)); margin: 20px auto; }
  .card { background: white; border: 1px solid #d7dde6; border-radius: 12px; padding: 16px; margin: 0 0 16px; }
  .muted { color: #667085; font-size: 13px; }
  .actions { display: flex; gap: 12px; align-items: center; margin-top: 10px; font-size: 13px; color: #667085; }
  button { border: 1px solid #cbd5e1; background: white; border-radius: 999px; padding: 6px 12px; }
  a { color: #1456a0; text-decoration: none; }
  .fake-image { display: block; width: 100%; min-height: 100px; background: linear-gradient(135deg, #cbd5e1, #e2e8f0); }
  @media (max-width: 520px) {
    main, .page-shell { width: calc(100vw - 16px); margin: 8px auto; }
    .card { border-radius: 8px; padding: 12px; }
  }
`;

const VIEWPORTS = [
  { name: "desktop", width: 1366, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

const fixtures = [
  {
    key: "x",
    site: "X / Twitter",
    archetype: "React 动态时间线、流式翻译、正文节点替换",
    scenario: "x-rerender",
    html: `
      <main>
        <article id="x-inflight" data-unit class="card">
          <div class="muted">Alice · 2m</div>
          <div class="x-body">
            <div id="x-inflight-source" data-test-source data-testid="tweetText">Autonomous coding agents can keep working while the interface re-renders during a streaming response.</div>
            <div class="actions" data-control><span>Reply</span><span>Repost</span><span>Like</span></div>
          </div>
        </article>
        <article id="x-done" data-unit class="card">
          <div class="muted">Noor · 5m</div>
          <div class="x-body">
            <div id="x-done-source" data-test-source data-testid="tweetText">This completed post is replaced by React after its translation node has already been inserted.</div>
            <div class="actions" data-control><span>Reply</span><span>Repost</span><span>Like</span></div>
          </div>
        </article>
      </main>
    `
  },
  {
    key: "reddit-feed",
    site: "Reddit Feed",
    archetype: "Web Component、slot 标题、卡片操作区",
    html: `
      <main><shreddit-post data-unit class="card" style="display:block">
        <div class="muted">r/worldnews · 3 hr ago</div>
        <a href="#" slot="title" data-test-source id="post-title-1" style="display:block;font-size:21px;font-weight:700;margin-top:8px">A long discussion headline that should retain its slot and stay above the metadata row</a>
        <div class="muted" style="margin-top:8px">example.com</div>
        <div class="actions" data-control><span>124 comments</span><span>Share</span></div>
      </shreddit-post></main>
    `
  },
  {
    key: "reddit-thread",
    site: "Reddit Thread",
    archetype: "嵌套评论、动态折叠、深层内容单元",
    html: `
      <main><shreddit-comment data-unit class="card" style="margin-left:24px;border-left:3px solid #d0d5dd">
        <div class="muted">u/example · 20 min ago</div>
        <div data-test-source style="margin-top:8px">The nested reply contains enough prose to be translated without absorbing the vote controls or author metadata.</div>
        <div class="actions" data-control><span>Vote</span><span>Reply</span></div>
      </shreddit-comment></main>
    `
  },
  {
    key: "quora",
    site: "Quora",
    archetype: "截断答案、展开按钮、裁剪祖先锚点",
    html: `
      <main><article data-unit class="card">
        <h2>What is artificial intelligence?</h2>
        <div id="quora-clip" style="max-height:46px;overflow:hidden;position:relative">
          <p data-test-source style="margin:0;line-height:24px">Artificial intelligence is a broad field that combines machine learning, reasoning, perception, planning, and language understanding across many practical applications.</p>
        </div>
        <button data-control style="margin-top:8px">Continue reading</button>
      </article></main>
    `
  },
  {
    key: "linkedin",
    site: "LinkedIn",
    archetype: "横向 Flex 卡片、正文与操作按钮同级",
    html: `
      <main><article data-unit class="card">
        <div class="linkedin-line" style="display:flex;align-items:flex-start;gap:12px;white-space:normal">
          <p data-test-source style="flex:1;min-width:0;margin:0">We are hiring engineers to build reliable agent workflows, evaluation systems, and developer tooling for production teams.</p>
          <button data-control style="flex:0 0 auto">Follow</button>
        </div>
      </article></main>
    `
  },
  {
    key: "youtube",
    site: "YouTube",
    archetype: "Grid 视频卡片、标题与菜单同级、窄屏重排",
    html: `
      <main><div data-unit class="card yt-grid" style="display:grid;grid-template-columns:150px minmax(0,1fr) 42px;gap:12px;align-items:start">
        <div class="fake-image" data-stable style="height:86px;border-radius:8px"></div>
        <div data-test-source style="font-weight:700;line-height:1.35">A practical guide to building autonomous coding agents that can plan, test, and review their own changes</div>
        <button data-control aria-label="More">⋮</button>
      </div></main>
    `
  },
  {
    key: "wikipedia",
    site: "Wikipedia",
    archetype: "长文、信息表、表格单元格",
    html: `
      <main><article class="card">
        <section data-unit><h1>Artificial intelligence</h1><p data-test-source>Artificial intelligence enables machines to perform tasks associated with human intelligence, including reasoning, learning, perception, and language.</p></section>
        <table style="width:100%;border-collapse:collapse;margin-top:14px"><tbody><tr data-unit>
          <th style="border:1px solid #cbd5e1;padding:8px;width:24%">Definition</th>
          <td data-test-source style="border:1px solid #cbd5e1;padding:8px">A deliberately long table-cell description that exceeds the dense-cell threshold and therefore remains eligible for translation in the current candidate logic, including enough explanatory prose about history, terminology, examples, and practical use to pass the long-form table content threshold safely.</td>
        </tr></tbody></table>
      </article></main>
    `
  },
  {
    key: "github",
    site: "GitHub",
    archetype: "README Markdown、任务列表、代码邻接",
    html: `
      <main><article class="card markdown-body">
        <h1>Project README</h1>
        <ul><li data-unit data-test-source style="padding-left:4px">Review the pull request carefully and verify that every user-visible behavior has an automated regression test.</li></ul>
        <pre style="background:#0d1117;color:white;padding:12px;border-radius:8px"><code>npm test</code></pre>
      </article></main>
    `
  },
  {
    key: "stackoverflow",
    site: "Stack Overflow",
    archetype: "投票列 + 正文 Grid、代码块",
    html: `
      <main><article data-unit class="card" style="display:grid;grid-template-columns:58px minmax(0,1fr);gap:16px">
        <aside data-stable style="text-align:center"><b>42</b><div class="muted">votes</div></aside>
        <div class="postcell"><p data-test-source>How can a browser extension insert bilingual text without changing the alignment of voting controls, code blocks, and answer metadata?</p><pre style="background:#eef2f6;padding:10px"><code>const stable = true;</code></pre><div class="actions" data-control>Share · Edit</div></div>
      </article></main>
    `
  },
  {
    key: "hacker-news",
    site: "Hacker News",
    archetype: "紧凑 Table 列表、标题链接",
    html: `
      <main><table data-unit style="width:100%;background:#f6f6ef;border-collapse:collapse"><tbody><tr class="athing">
        <td style="width:28px;text-align:right">1.</td><td class="title" data-test-source><span class="titleline"><a href="#">A new architecture for reliable browser-based translation agents</a></span><span class="muted"> (example.org)</span></td>
      </tr><tr><td></td><td class="muted" data-control>98 points by user 2 hours ago | 31 comments</td></tr></tbody></table></main>
    `
  },
  {
    key: "mdn",
    site: "MDN Web Docs",
    archetype: "文档双栏 Grid、侧边导航、代码",
    extraCss: "@media(max-width:520px){.page-shell{grid-template-columns:1fr!important}.page-shell nav{display:none}}",
    html: `
      <div class="page-shell" style="display:grid;grid-template-columns:210px minmax(0,1fr);gap:22px">
        <nav class="card" data-stable><b>Contents</b><div class="muted">Syntax<br>Examples<br>Specifications</div></nav>
        <article data-unit class="card"><h1>MutationObserver</h1><p data-test-source>The MutationObserver interface provides the ability to watch for changes being made to the DOM tree while keeping the observer workload bounded.</p><pre style="background:#eef2f6;padding:10px"><code>observer.observe(target, options)</code></pre></article>
      </div>
    `
  },
  {
    key: "bbc",
    site: "BBC",
    archetype: "新闻卡片 Grid、标题链接、摘要",
    extraCss: "@media(max-width:520px){main section{grid-template-columns:1fr!important}}",
    html: `
      <main><section style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px">
        <article data-unit class="card"><div class="fake-image" style="height:110px"></div><h2 style="margin-bottom:6px"><a href="#" data-test-source>Technology companies race to make AI systems more useful and reliable</a></h2><div class="muted">2 hours ago</div></article>
        <article data-unit class="card"><div class="fake-image" style="height:110px"></div><h2 style="margin-bottom:6px"><a href="#" data-test-source>Researchers publish a new benchmark for multilingual assistants</a></h2><div class="muted">4 hours ago</div></article>
      </section></main>
    `
  },
  {
    key: "cnn-live",
    site: "CNN Live",
    archetype: "实时更新流、时间标签、动态追加",
    html: `
      <main><section>
        <article data-unit class="card"><div class="muted">10:42 a.m. ET</div><h2>Latest update</h2><p data-test-source>Officials released a detailed statement explaining the latest developments and what readers should expect over the next several hours.</p><div class="actions" data-control>Share · Save</div></article>
        <article data-unit class="card"><div class="muted">10:18 a.m. ET</div><p data-test-source>Correspondents on the ground reported new information while the live page continued to append additional entries.</p></article>
      </section></main>
    `
  },
  {
    key: "reuters",
    site: "Reuters",
    archetype: "文章、Figure Grid、图片说明",
    html: `
      <main><article class="card"><h1>Global markets respond to new technology investment</h1>
        <section data-unit><p data-test-source>Investors evaluated a new wave of spending on data centers, chips, and software as companies expanded their artificial intelligence strategies.</p></section>
        <figure data-unit style="display:grid;grid-template-columns:1fr;gap:8px;margin:18px 0"><div class="fake-image" style="height:180px"></div><figcaption data-test-source class="muted">A technician inspects computing equipment inside a modern data center during routine maintenance.</figcaption></figure>
      </article></main>
    `
  },
  {
    key: "medium",
    site: "Medium",
    archetype: "文章推荐区、同一 Section 内重复合法文本、RTL 补充",
    targetLanguage: "Arabic",
    translationText: "هذا نص عربي لاختبار اتجاه الكتابة من اليمين إلى اليسار.",
    html: `
      <main><article data-unit class="card"><h1>Designing resilient translation interfaces</h1><p data-test-source>Good bilingual interfaces preserve reading flow, hierarchy, and the visual relationship between source text and translation.</p></article>
      <section id="medium-recommendations" class="card">
        <div data-unit class="recommendation"><p data-test-source>Read more stories from this publication and follow the authors you enjoy.</p></div>
        <hr>
        <div data-unit class="recommendation"><p data-test-source>Read more stories from this publication and follow the authors you enjoy.</p></div>
      </section>
      <blockquote data-unit class="card"><p data-test-source>This source is translated into Arabic to verify right-to-left layout behavior.</p></blockquote>
      </main>
    `
  },
  {
    key: "amazon",
    site: "Amazon",
    archetype: "商品要点列表、评价卡片、紧凑移动布局",
    extraCss: "@media(max-width:520px){main article>div[style*='grid-template-columns']{grid-template-columns:1fr!important}}",
    html: `
      <main><article class="card"><div style="display:grid;grid-template-columns:180px minmax(0,1fr);gap:18px"><div class="fake-image" style="height:180px"></div><div><h1>Noise-cancelling headphones</h1><ul><li data-unit data-test-source>Adaptive noise cancellation automatically adjusts to your surroundings while preserving clear voice calls.</li><li data-unit data-test-source>Lightweight construction and a long battery life make the headset suitable for travel and daily work.</li></ul></div></div></article>
      <section><article data-unit class="card"><b>Customer review</b><p data-test-source>The controls are easy to learn, the sound is balanced, and the battery lasted through several long trips.</p><div class="actions" data-control>Helpful · Report</div></article></section>
      </main>
    `
  }
];

module.exports = {
  BASE_CSS,
  VIEWPORTS,
  fixtures
};

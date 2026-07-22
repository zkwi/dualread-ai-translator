async function recordLayoutSnapshot(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };
    const controls = {};
    document.querySelectorAll("[data-control],[data-stable]").forEach((element, index) => {
      const key = element.id || `${element.hasAttribute("data-control") ? "control" : "stable"}-${index}`;
      element.dataset.layoutProbe = key;
      const parentStyle = element.parentElement ? getComputedStyle(element.parentElement) : null;
      controls[key] = {
        ...rectOf(element),
        strict: !!parentStyle && ["flex", "inline-flex", "grid", "inline-grid"].includes(parentStyle.display)
      };
    });

    const hosts = {};
    let hostIndex = 0;
    document.querySelectorAll("body *").forEach((element) => {
      const style = getComputedStyle(element);
      if (!["flex", "inline-flex", "grid", "inline-grid"].includes(style.display)) return;
      const key = `host-${hostIndex}`;
      hostIndex += 1;
      element.dataset.layoutHostProbe = key;
      hosts[key] = {
        display: style.display,
        flexWrap: style.flexWrap,
        flexDirection: style.flexDirection,
        gridTemplateColumns: style.gridTemplateColumns
      };
    });

    return { controls, hosts };
  });
}

async function collectLayoutMetrics(page, before) {
  return page.evaluate((snapshot) => {
    const rectOf = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        right: rect.right,
        bottom: rect.bottom
      };
    };
    const intersects = (left, right) => Math.max(left.x, right.x) < Math.min(left.right, right.right)
      && Math.max(left.y, right.y) < Math.min(left.bottom, right.bottom);
    const normalizedText = (element) => String(element?.innerText || element?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    const sourceHash = (source) => {
      const clone = source.cloneNode(true);
      clone.querySelectorAll?.(".llm-bilingual-translation").forEach((node) => node.remove());
      return window.LLMTranslatorShared.simpleHash(normalizedText(clone));
    };
    const translations = Array.from(document.querySelectorAll(".llm-bilingual-translation"));
    const sources = Array.from(document.querySelectorAll("[data-test-source]"));
    const units = Array.from(document.querySelectorAll("[data-unit]"));

    const unitDetails = units.map((unit, index) => {
      const unitSources = Array.from(unit.querySelectorAll("[data-test-source]"));
      if (unit.matches("[data-test-source]")) unitSources.unshift(unit);
      const nearbyTranslations = Array.from(unit.querySelectorAll(".llm-bilingual-translation"));
      if (unit.nextElementSibling?.classList.contains("llm-bilingual-translation")) {
        nearbyTranslations.push(unit.nextElementSibling);
      }
      const sourceDetails = unitSources.map((source) => {
        const hash = sourceHash(source);
        const matches = nearbyTranslations.filter((node) => node.dataset.llmSourceHash === hash);
        const orderViolation = matches.some((node) => source.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING);
        return { hash, translationCount: matches.length, orderViolation };
      });
      return {
        index,
        sourceCount: unitSources.length,
        missingCount: sourceDetails.filter((detail) => detail.translationCount === 0).length,
        duplicateCount: sourceDetails.filter((detail) => detail.translationCount > 1).length,
        orderViolationCount: sourceDetails.filter((detail) => detail.orderViolation).length
      };
    });

    const overlaps = [];
    translations.forEach((translation, translationIndex) => {
      const translationRect = rectOf(translation);
      document.querySelectorAll("[data-control]").forEach((control, controlIndex) => {
        if (intersects(translationRect, rectOf(control))) {
          overlaps.push({ translation: translationIndex, control: controlIndex });
        }
      });
    });

    const shiftedElements = [];
    document.querySelectorAll("[data-layout-probe]").forEach((element) => {
      const key = element.dataset.layoutProbe;
      const previous = snapshot.controls[key];
      if (!previous) return;
      const current = rectOf(element);
      const dx = Math.abs(current.x - previous.x);
      const dy = Math.abs(current.y - previous.y);
      if (dx > 2 || (previous.strict && dy > 2) || (key.startsWith("stable-") && dy > 2)) {
        shiftedElements.push({ key, dx: Math.round(dx), dy: Math.round(dy) });
      }
    });

    const mutatedHosts = [];
    document.querySelectorAll("[data-layout-host-probe]").forEach((element) => {
      const key = element.dataset.layoutHostProbe;
      const previous = snapshot.hosts[key];
      if (!previous) return;
      const style = getComputedStyle(element);
      const current = {
        display: style.display,
        flexWrap: style.flexWrap,
        flexDirection: style.flexDirection,
        gridTemplateColumns: style.gridTemplateColumns
      };
      if (Object.keys(previous).some((name) => previous[name] !== current[name])) {
        mutatedHosts.push({ key, before: previous, after: current });
      }
    });

    const rtlDirectionFailures = translations.filter((node) => (
      /[\u0590-\u08ff]/.test(node.textContent || "")
      && getComputedStyle(node).direction !== "rtl"
    )).length;
    const invalidTableParents = translations.filter((node) => (
      ["TR", "TBODY", "THEAD", "TFOOT", "TABLE"].includes(node.parentElement?.tagName)
    )).length;
    const tooWideCount = translations.filter((node) => {
      const unit = node.closest("[data-unit]") || node.parentElement;
      return unit && node.getBoundingClientRect().width > unit.getBoundingClientRect().width + 2;
    }).length;

    return {
      sourceCount: sources.length,
      translationCount: translations.length,
      requestCount: window.__mockItems.length,
      activeRequestCount: window.__inflightStreamRequests,
      missingUnits: unitDetails.reduce((sum, unit) => sum + unit.missingCount, 0),
      duplicateUnits: unitDetails.reduce((sum, unit) => sum + unit.duplicateCount, 0),
      orderViolationCount: unitDetails.reduce((sum, unit) => sum + unit.orderViolationCount, 0),
      invalidTableParents,
      overlapCount: overlaps.length,
      shiftedElementCount: shiftedElements.length,
      shiftedElements,
      mutatedHostCount: mutatedHosts.length,
      mutatedHosts,
      layoutMarkerCount: document.querySelectorAll("[data-llm-translator-layout]").length,
      rtlDirectionFailures,
      docOverflowPx: Math.max(0, Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth)),
      tooWideCount,
      unitDetails
    };
  }, before);
}

function classifyLayoutMetrics(metrics) {
  const issues = [];
  if (metrics.missingUnits) issues.push(`缺少译文内容单元：${metrics.missingUnits}`);
  if (metrics.duplicateUnits) issues.push(`重复译文内容单元：${metrics.duplicateUnits}`);
  if (metrics.orderViolationCount) issues.push(`原文/译文顺序错误：${metrics.orderViolationCount}`);
  if (metrics.invalidTableParents) issues.push(`非法表格父节点：${metrics.invalidTableParents}`);
  if (metrics.overlapCount) issues.push(`译文与控件重叠：${metrics.overlapCount}`);
  if (metrics.shiftedElementCount) issues.push(`控件或稳定元素位移：${metrics.shiftedElementCount}`);
  if (metrics.mutatedHostCount) issues.push(`宿主布局计算值被修改：${metrics.mutatedHostCount}`);
  if (metrics.rtlDirectionFailures) issues.push(`RTL 方向错误：${metrics.rtlDirectionFailures}`);
  if (metrics.docOverflowPx) issues.push(`横向溢出：${metrics.docOverflowPx}px`);
  if (metrics.tooWideCount) issues.push(`译文超出内容单元：${metrics.tooWideCount}`);
  return { status: issues.length > 0 ? "FAIL" : "PASS", issues };
}

module.exports = {
  classifyLayoutMetrics,
  collectLayoutMetrics,
  recordLayoutSnapshot
};

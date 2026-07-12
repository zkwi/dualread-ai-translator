# Minimal Options Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the options page to essential connection, translation language, and reading controls, while keeping reversible low-frequency settings in one advanced section.

**Architecture:** Keep the existing storage schema and runtime defaults unchanged. Remove low-value controls from the options DOM and form serialization so old stored values remain compatible, while simplifying the current page and its event wiring.

**Tech Stack:** Chrome Manifest V3, native HTML/CSS/JavaScript, Node.js assertions, Playwright browser fixtures.

## Global Constraints

- Do not add dependencies or a build step.
- Keep existing Chrome storage keys and runtime defaults backward compatible.
- Advanced settings are closed by default, include interface language, and open automatically for the custom provider.
- Use the existing auto-save, localization, and confirmation flows.

---

### Task 1: Lock the minimal UI contract

**Files:**
- Modify: `test/e2e-ui-fixtures.js`
- Modify: `test/extension-smoke.js`

**Interfaces:**
- Consumes: existing `createOptionsPage()` browser fixture.
- Produces: assertions for essential controls, removed controls, collapsed advanced state, and custom-provider expansion.

- [ ] Add assertions that removed control IDs do not exist and the manual save button is absent.
- [ ] Assert `#advancedSettings` is closed on load and opens after selecting `custom`.
- [ ] Run `npm run test:ui` and confirm failure against the current page.

### Task 2: Simplify the options DOM and controller

**Files:**
- Modify: `options.html`
- Modify: `options.js`
- Modify: `options.css`
- Modify: `scripts/generate-locales.js`
- Modify: `_locales/*/messages.json`

**Interfaces:**
- Consumes: `DEFAULT_SETTINGS` and the existing Chrome storage merge behavior.
- Produces: essential form settings plus the approved reversible advanced controls.

- [ ] Remove redundant and low-level controls from `options.html`; move the approved controls into a closed `details` block.
- [ ] Remove dead field bindings, listeners, form serialization, cost-profile and language-preset helpers from `options.js`.
- [ ] Open advanced settings when `provider === "custom"` and retain automatic save/test behavior.
- [ ] Regenerate locales and run `npm run test:ui` until the UI contract passes.

### Task 3: Verify layout and update current documentation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/architecture.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: simplified settings page behavior.
- Produces: current user/developer documentation matching the visible controls.

- [ ] Update settings instructions and architecture notes without documenting hidden internal tuning keys as user controls.
- [ ] Run Playwright UI fixtures and inspect a rendered options-page screenshot.
- [ ] Run `npm test`, `npm run test:samples`, `npm run audit:public`, and `git diff --check`.

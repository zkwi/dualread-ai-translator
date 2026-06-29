# Contributing

DualRead AI is a personal, practical Chrome extension project. Keep changes small, easy to review, and directly tied to reading and translation quality.

## Local Setup

1. Install Node.js.
2. Load this folder in `chrome://extensions/` with Developer mode enabled.
3. Configure an OpenAI-compatible API in the options page when doing manual translation tests.

## Useful Commands

```bash
npm run audit:public
npm run check
npm test
npm run test:samples
```

`npm run audit:public` scans publishable files for common API keys, absolute local paths, personal emails, private keys, and unsafe artifacts. `npm test` covers syntax checks, unit tests, UI fixtures, local content-script fixtures, and an extension load smoke test. `npm run test:samples` opens real sample sites with mock translations, so it can be slower or affected by site blocking.

## Code Style

- Prefer plain JavaScript, HTML, and CSS. Do not add a build step unless there is a clear need.
- Keep functions direct and readable. Avoid abstractions that only prepare for possible future use.
- Add comments only when they explain why a behavior exists, especially for browser quirks or cost-control decisions.
- Do not commit API keys, `.env`, `.npmrc`, private keys, archives, CRX files, or generated `test-results/` output.

## Before Sharing Publicly

- Run `npm run check`.
- Confirm screenshots do not show API keys, account names, private pages, or browser profiles.
- Check `git log --format='%an <%ae>' -1` before pushing if commit author privacy matters.
- Reload the extension in `chrome://extensions/`.
- Test one article page, one dynamic page, and one dark page.
- Check popup status, options auto-save, right-click translation, and hide/show translation.

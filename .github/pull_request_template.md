# Summary

<!-- What user-visible behavior changes, and why. -->

## Verification

<!-- Tick what you actually ran. CI runs everything except the real-site samples. -->

- [ ] `npm run check`
- [ ] `npm test`
- [ ] `npm run test:samples` (real sites, optional — note any `siteBlocked=true` results)
- [ ] Reloaded the extension in `chrome://extensions/` and checked one real page

## Checklist

- [ ] No API Key, `.env`, `.npmrc`, archive, CRX, or private key is committed.
- [ ] Screenshots contain no keys, accounts, or private pages.
- [ ] New `data-i18n` / `t("key")` strings exist in all four locales.
- [ ] Version numbers stay in sync across `manifest.json`, `package.json`, `package-lock.json`, and `content.js` (enforced by `npm run audit:public`).
- [ ] `CHANGELOG.md` records user-visible changes when this is a release.

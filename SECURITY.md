# Security Policy

DualRead AI Translator is a client-only Chrome MV3 extension. It has no project-owned server, no analytics, and no bundled developer API key. The main assets to protect are the user's own API Key and the webpage text that is sent to the user's configured endpoint.

## Supported Versions

Only the latest released version is supported. Fixes land on `main` and ship in the next version.

## Reporting a Vulnerability

Use GitHub's private vulnerability reporting for this repository (**Security → Report a vulnerability**). If that is unavailable, open a normal issue that describes only the affected area and impact, and ask for a private channel before sharing details.

Please include:

- The affected surface (content script, service worker, popup, options page).
- Reproduction steps and the extension version.
- Impact: key exposure, page data exposure, script injection, or privilege escalation.

**Do not include a real API Key, cookies, tokens, or private page content in any report.** Redact them first.

Expect an acknowledgement within about a week. This is a personal project maintained on a best-effort basis; there is no bug bounty.

## If Your API Key Leaks

1. Revoke the key in your provider dashboard immediately, then issue a new one.
2. Replace it in the options page.
3. If the key appeared in a screenshot, issue, or commit, treat it as public even after deletion — revocation is the only reliable fix.

## Scope Notes

In scope:

- Leaking the stored API Key beyond `chrome.storage.local`.
- Sending webpage text anywhere other than the endpoint the user configured.
- Injected translation nodes executing page-supplied scripts, or the extension executing untrusted page content.
- Elevation of the extension's host permissions beyond translation requests.

Out of scope:

- Behavior of the third-party API endpoint the user configures, including what the provider logs or retains.
- Risks the user takes on knowingly, such as pointing the extension at an untrusted custom endpoint.
- Webpage text being sent to a provider — this is the extension's documented purpose. See [PRIVACY.md](PRIVACY.md).

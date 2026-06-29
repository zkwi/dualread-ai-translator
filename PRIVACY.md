# Privacy

DualRead AI does not run a project-owned server and does not include analytics.

## What Stays Local

- API Key and settings are stored in `chrome.storage.local`.
- Translation cache is stored in `chrome.storage.local`.
- Popup/options state stays in the browser extension.

## What May Be Sent Out

When translation is triggered, selected webpage text is sent to the API endpoint configured by the user in the options page. The endpoint can be OpenAI, DeepSeek, DashScope, a local service, or another OpenAI-compatible service.

The extension sends only the text blocks it decides to translate, plus the model, language settings, and translation prompt needed for the request. It does not intentionally send cookies, browsing history, or page screenshots.

## User Controls

- Disable auto translation in the popup or options page.
- Hide or clear inserted translations from the popup.
- Clear local translation cache from the options page.
- Use a local OpenAI-compatible endpoint if webpage text should not be sent to a cloud provider.

## Security Notes

Do not paste real API keys into issues, screenshots, or public bug reports. If a key is exposed, revoke it from the provider dashboard.

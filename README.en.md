# 拾语 · WordKeeper

> Keep what you read.

[简体中文](README.md) | **English**

A local-first Chrome / Edge extension for Chinese learners of English. Select English text on any web page to save it, translate it, add IPA and CEFR metadata, review it with spaced repetition, generate short AI-assisted reading passages, and export printable study material.

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

## Screenshots

| Library | Review |
| --- | --- |
| ![Library](docs/screenshots/01-library.png) | ![Review](docs/screenshots/02-review.png) |

| Reading practice | Export |
| --- | --- |
| ![Reading practice](docs/screenshots/03-reading.png) | ![Export](docs/screenshots/04-export.png) |

## Why

Reading English often means understanding a good expression once and then forgetting it. Screenshots and highlights collect information, but they do not create review or reuse.

WordKeeper connects the full loop:

```text
Select text on the web
  → save locally
  → AI translation / English definition / IPA
  → CEFR level and topic classification
  → spaced review
  → generate new reading passages from your own words
  → export PDF / HTML
```

Learning data stays in the browser by default. Text is sent to an AI provider only when the user explicitly triggers translation, classification, or reading generation, and only to the API endpoint the user configured.

## Features

### Save from any web page

- Select English text and click “Save and translate”.
- Stores the text, nearby context, page title, and source URL.
- Saves locally first, then translates asynchronously; a failed translation never loses the original text.
- Context menu and manual entry as fallbacks.
- Shadow DOM keeps the floating button isolated from page styles.
- Sanitizes zero-width characters and malformed Unicode from rich editors.

### Definitions, phonetics, and pronunciation

- Chinese translation
- English definition
- IPA phonetic transcription, e.g. `/ˈæpəl/`
- Usage notes and personal notes
- Browser-native English speech synthesis; no separate audio API required

### Classification

Switch between:

- Type: word, fixed collocation, sentence
- CEFR level: A1–C2
- Topic: daily life, work, technology, travel, and more

A level is always shown on each card. Until AI classification runs, a local estimate is shown with `≈` and consumes no tokens. “Complete classification and phonetics with AI” only processes items missing that information.

### Spaced review

- English → Chinese
- Chinese → English
- Context cloze

Recall first, reveal the answer, then choose “Forgot / Vague / Remembered”. Newly saved items enter today's review immediately.

### AI reading practice

Select target words or phrases and generate:

- Story
- Everyday dialogue
- Popular science
- News-style practice
- Argumentative essay

Choose A2–C1 and roughly 150 / 300 / 500 words. The generated material includes English paragraphs, Chinese translation, highlighted target items, comprehension questions, and answer suggestions.

### Export and backup

- Bilingual word and phrase book
- Worksheet with answers on a separate page
- Reading practice booklet
- Print to PDF through the browser print dialog
- Export HTML for further editing
- JSON backup and merge import, without API keys

## Quick start

### Requirements

- Node.js 20+
- npm 10+
- Chrome or Edge

### Build

```bash
git clone <your-repository-url>
cd wordkeeper-extension
npm install
npm run build
```

### Load the extension

1. Open `chrome://extensions` or `edge://extensions`
2. Enable Developer mode
3. Click “Load unpacked”
4. Select the `dist` folder
5. Open an English web page, select text, and click “Save and translate”

Browser-internal pages, some PDF viewers, and protected pages cannot host the floating button. Use the context menu or add entries manually instead.

### Configure AI

1. Open the extension popup → Settings
2. Enter an OpenAI-compatible Chat Completions service:
   - Base URL, e.g. `https://api.openai.com/v1`
   - Model name
   - API key
3. Save and grant access to that API origin
4. Optionally test the connection

Without an API key, saving, editing, and review still work; automatic translation is unavailable.

API keys are kept in session storage by default. Choosing “Remember on this device” stores the key in extension local storage, which is not an encrypted vault. Keys are never included in exported backups or injected into web pages.

## Tech stack

| Area | Technology |
| --- | --- |
| Extension platform | Chrome Manifest V3 |
| Frontend | React 19 + TypeScript |
| Build | Vite 6 |
| Tests | Vitest + jsdom + fake-indexeddb |
| Local storage | IndexedDB (native) |
| AI API | OpenAI Chat Completions compatible |
| Export | A4 print styles + HTML |
| Pronunciation | Web Speech API |

## Development

```bash
npm run dev      # preview the library UI
npm run build    # type-check and build dist
npm test         # run all tests
```

Tests cover IndexedDB persistence, deduplication, review scheduling, backup import/export, AI error handling, background save/translate behavior, HTML escaping, and the main UI flows. AI calls are mocked in tests; no real network requests are made.

## Privacy

- Learning data is stored locally in IndexedDB.
- Text is sent only when the user explicitly triggers an AI action.
- The extension does not upload entire pages or browsing history.
- Page selections and AI output are treated as untrusted text.
- API keys are excluded from backups.

See [PRIVACY.md](PRIVACY.md).

## Limitations

- Loaded through developer mode; not yet published to extension stores.
- Protected and browser-internal pages cannot show the floating button.
- AI output may be inaccurate; news-style passages are fictional practice material.
- Local CEFR estimates are approximate.
- Voice availability depends on the operating system.
- No cross-device sync.

## Roadmap

- [ ] Publish to Chrome Web Store / Edge Add-ons
- [ ] Review statistics and learning heatmap
- [ ] Anki / CSV import
- [ ] Custom article templates
- [ ] Optional cloud sync
- [ ] Demo GIF and more screenshots

## License

[MIT](LICENSE) © 2026 WordKeeper Contributors

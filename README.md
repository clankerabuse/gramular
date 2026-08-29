<div align="center">
  <img src="logo.svg" width="64" height="64" alt="Gramular logo"/>

  # Gramular

  **Inline grammar, spelling & clarity — powered by Claude or Grok.**
</div>

Gramular is a browser extension that places a small pencil bubble beside any text field as you type. Click it to instantly fix grammar and spelling, improve clarity, or run a custom AI edit.

## Features

- Pencil bubble appears beside eligible text fields on focus
- **Quick Fix** — one-click grammar/spelling/clarity improvement
- **Prompt** — describe any edit and run it against the field text
- Supports **Claude** (Anthropic) and **Grok** (xAI)
- Handles standard inputs, textareas, and `contenteditable` fields (including Draft.js editors on X/Twitter and Facebook)
- Dark mode aware

## Installation

### Firefox

1. Clone or download this repo.
2. Open Firefox and go to `about:debugging` > **This Firefox** > **Load Temporary Add-on**.
3. Select `manifest.json` from the project folder.
4. Click the Gramular toolbar icon and enter your API key.

### Chromium (Chrome, Edge, Brave, etc.)

1. Clone or download this repo.
2. Build the Chromium package:

   ```bash
   node scripts/build-chromium.mjs
   ```

3. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked**.
4. Select the `dist/chromium` folder (not the repo root).
5. Click the Gramular toolbar icon and enter your API key.

## Usage

1. Click into any text field on any page.
2. The blue pencil bubble appears to the right of the field.
3. Click the bubble to open the panel.
   - **Quick Fix** — rewrites the field text with grammar/spelling/clarity improvements applied automatically.
   - **Prompt** — enter instructions (e.g. _"make it more formal"_) and press **Run**.
4. The field is updated in place.

## Configuration

Open the extension popup (toolbar icon) to:

- Switch between **Claude (Anthropic)** and **Grok (xAI)**
- Enter your API key
- Choose a model
- Toggle the inline bubble on/off

## Supported Browsers

- **Firefox** 109+ — load the repo root (`manifest.json` uses Manifest V3 with background scripts).
- **Chromium** 109+ — load the output of `node scripts/build-chromium.mjs` (`dist/chromium`), which uses a service worker background and a small `browser.*` shim over `chrome.*`.

## License

MIT

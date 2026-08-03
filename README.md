English | [Korean](README_ko.md)

# MangoTL

MangoTL is an AI-powered translation browser extension and self-hostable server for comics, manga, and webtoons.

[View on Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/mangotl/)

## Add-on Screenshot

<img width="284" height="184" alt="376708" src="https://github.com/user-attachments/assets/299dadf8-b0b1-484f-a5df-7b5aa04eeb11" />
<img width="319" height="244" alt="376709" src="https://github.com/user-attachments/assets/441f589c-a228-40c3-8729-1130fe960d85" />
<img width="533" height="282" alt="376710" src="https://github.com/user-attachments/assets/e32dba97-171f-4024-947c-5080d0328708" />

### Image sample

- Lang: English to Korean
- Provider: OpenRouter
- Model: google/gemma-4-26b-a4b-it model.

<img width="230" alt="CleanShot 2026-05-31 at 19 14 22" src="https://github.com/user-attachments/assets/2f35ee24-6632-4952-bf59-6de508960d10" />
<img width="230" alt="CleanShot 2026-05-31 at 19 14 02" src="https://github.com/user-attachments/assets/ee5ce9d7-fac8-4432-9a50-079698304547" />

## Supported Items

MangoTL supports a variety of websites, languages, AI providers, and OCR engines.

You can check the full list below.

### Websites

- Pixiv
- X

### Source Languages (comic language)

- Japanese
- Korean
- English
- Chinese
- German
- Swedish

### Target Languages (your language)

- Japanese
- Korean
- English
- Chinese
- German
- Swedish

### AI Providers

- [CrofAI](https://crof.ai)
- [OpenRouter](https://openrouter.ai)
- [OpenAI](https://openai.com)
- [Synthetic](https://synthetic.new)
- [Ollama](https://ollama.com) (local)
- [Ollama Cloud](https://ollama.com)
- [ZenMux](https://zenmux.ai)
- [Upstage](https://upstage.ai)

### Detection/OCR Engines

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) — detection, OCR
- [manga-ocr](https://huggingface.co/mayocream/manga-ocr-onnx) (Japanese default) — OCR

## Server Setup

1. Install dependencies.

    ```sh
    bun install
    ```

2. Start the server.

    ```sh
    bun run start
    ```

3. Specify the provider, API key, and model at localhost:8787/config. Settings are saved in `server/secrets/settings.json`.

4. You can now use MangoTL through the browser add-on.

## Operation Flow

1. **Browser:** The user clicks the button overlaid on the image. The browser sends the image information to the server.
2. **Server:** Downloads the image and extracts text using OCR engines such as PaddleOCR and manga-ocr.
3. **Server:** Sends the extracted text to the configured AI model for translation.
4. **Server:** Removes the original comic bubble text from the image, inserts the translated text on top, and sends the final image back to the browser.
5. **Browser:** Overlays the received image onto the original image. The user can now see the translated comic.

## Extension Install

### Install from Firefox Add-ons (recommended)

1. [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/mangotl/) to install.

### Build and install manually

1. Build the release zip: `bun run release:extension`
2. In Firefox, open `about:debugging` → **This Firefox** → **Load Temporary Add-on** and select any file inside `extension/`.

## Documentation

- [Third-party software](docs/THIRD_PARTY.md)
- [Contributing](CONTRIBUTING.md)

## License

MangoTL is free software licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later).

Copyright © 2026 gpdir16 and MangoTL contributors.

If you modify this software and make it available to users over a network, you must provide the corresponding source code under the same license. See the [AGPL FAQ](https://www.gnu.org/licenses/agpl-faq.html) for details.

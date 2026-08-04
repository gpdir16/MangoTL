English | [Korean](README_ko.md)

# MangoTL

MangoTL is an AI-powered translation browser extension and self-hostable server for comics, manga, and webtoons.

## Add-on Screenshots

<img width="190" alt="376711" src="https://github.com/user-attachments/assets/74f7cc2c-4c11-4c66-ad5a-bf5200758168" />
<img width="250" alt="376712" src="https://github.com/user-attachments/assets/722e52c5-ef4f-4b21-94aa-1aca45256e85" />
<img width="460" alt="376713" src="https://github.com/user-attachments/assets/083f12ad-3731-4370-8ba3-dcb41a3c0fdf" />

### Image sample

- Lang: English to Korean
- Provider: OpenRouter
- Model: google/gemma-4-26b-a4b-it

<img width="200" alt="CleanShot 2026-05-31 at 19 14 22" src="https://github.com/user-attachments/assets/2f35ee24-6632-4952-bf59-6de508960d10" />
<img width="200" alt="CleanShot 2026-05-31 at 19 14 02" src="https://github.com/user-attachments/assets/ee5ce9d7-fac8-4432-9a50-079698304547" />

## Supported Items

MangoTL supports a variety of websites, languages, AI providers, and OCR engines.

You can check the full list below.

### Websites

- Pixiv.net
- X.com

### Source and target languages

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

## Server Install and Setup

### Method 1: Docker (recommended)

Requires [Docker](https://www.docker.com/).

1. The image is published to GHCR on every release and can be run with:

```sh
docker pull ghcr.io/gpdir16/mangotl
docker run -d --name mangotl \
    -p 8787:8787 \
    -v mangotl-secrets:/app/server/secrets \
    -v mangotl-ocr-cache:/app/server/.ocr-cache \
    --restart unless-stopped \
    ghcr.io/gpdir16/mangotl
```

> Settings are saved to the `mangotl-secrets` volume; downloaded OCR models are cached in the `mangotl-ocr-cache` volume.

2. Open http://localhost:8787/config in your browser and specify the provider, API key, and model in the settings.
3. You can now use MangoTL through the browser add-on. See the [browser add-on install](#browser-add-on-install-and-setup) section.

### Method 2: Run directly

Requires [Bun](https://bun.sh), [NodeJS](https://nodejs.org), [Git](https://git-scm.com/).

1. Clone the Git repository and run it:

```sh
git clone https://github.com/gpdir16/MangoTL.git
cd MangoTL
bun install
bun run start
```

> Settings are saved in `server/secrets/settings.json`.

2. Specify the provider, API key, and model at localhost:8787/config.
3. You can now use MangoTL through the browser add-on. See the [browser add-on install](#browser-add-on-install-and-setup) section.

## Browser Add-on Install and Setup

### Method 1: Install from Firefox Add-ons (recommended)

1. Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/mangotl/).
2. Click the installed add-on icon and open the settings in the popup to set the server URL (if changed) and target language.
3. You can now translate images on websites right away. Try it on the supported websites above.

### Method 2: Build and install temporarily

1. Build the release zip: `bun run release:extension`
2. In Firefox, open `about:debugging` → **This Firefox** → **Load Temporary Add-on** and select a file inside `extension/`.
3. Click the installed add-on icon and open the settings in the popup to set the server URL (if changed) and target language.
4. You can now translate images on websites right away. Try it on the supported websites above.

## Documentation

- [Third-party software](docs/THIRD_PARTY.md)
- [Contributing](CONTRIBUTING.md)

## License

MangoTL is free software licensed under the [GNU Affero General Public License v3.0 or later](LICENSE) (AGPL-3.0-or-later).

Copyright © 2026 gpdir16 and MangoTL contributors.

If you modify this software and make it available to users over a network, you must provide the corresponding source code under the same license. See the [AGPL FAQ](https://www.gnu.org/licenses/agpl-faq.html) for details.

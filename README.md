English | [Korean](README_ko.md)

# MangoTL

MangoTL is an AI-powered manga, manhwa, webtoon, and comic image translator. It ships as a browser extension plus a self-hostable local server. The extension reads the selected image and uploads the image bytes to the server, then the server runs OCR, translates detected text with an OpenAI-compatible provider, and returns a rendered translated image.

## Supported Items

MangoTL supports a variety of websites, languages, AI providers, and OCR engines.

You can check the full list below.

### Websites

- Pixiv

### Source Languages (comic language)

- Japanese
- Korean
- English
- Latin script

### Target Languages (your language)

- Korean
- Japanese
- English
- Chinese

### AI Providers

- [CrofAI](https://crof.ai)
- OpenAI-compatible endpoints

### Detection/OCR Engines

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) — detection, OCR
- [manga-ocr](https://huggingface.co/mayocream/manga-ocr-onnx) (Japanese default) — OCR

## Server Setup

1. Install dependencies.

    ```sh
    bun install
    ```

2. Create your environment file.

    ```sh
    cp .env.example .env
    ```

3. Add your provider API key to `.env`.

    ```env
    CROFAI_API_KEY=your_api_key_here
    ```

4. Start the server.

    ```sh
    bun run start
    ```

5. Check that the server is ready.

    ```sh
    curl http://localhost:8787/health
    ```

## Operation Flow

1. **Browser:** The user clicks the button overlaid on the image. The browser sends the image information to the server.
2. **Server:** Downloads the image and extracts text using OCR engines such as PaddleOCR and manga-ocr.
3. **Server:** Sends the extracted text to the configured AI model for translation.
4. **Server:** Removes the original comic bubble text from the image, inserts the translated text on top, and sends the final image back to the browser.
5. **Browser:** Overlays the received image onto the original image. The user can now see the translated comic.

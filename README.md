# WIP

This project is still a work in progress and is not yet ready for use.

Development is ongoing, so please save this repository and check back later.

You can use it if you wish, but features may be incomplete, and some parts of the UI may only be available in Korean.

---

English | [Korean](README_ko.md)

# MangoTL

MangoTL is an AI-powered translation browser extension and self-hostable server for manga, comics, and webtoons.

The goal is to provide professional-grade manga translation, similar to Immersive Translate's manga translation feature, without any complex setup.

## Support List

MangoTL supports various websites, languages, AI providers, and more.

You can check the full list below.

### Websites

- Pixiv.net
- X.com

### Source Languages (Manga Language)

- Japanese
- Korean
- English
- Latin

### Target Languages (Your Language)

- Korean
- Japanese
- English
- Chinese

### AI Providers

- [CrofAI](https://crof.ai)
- OpenAI-compatible endpoints

### Detection Engine

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)

### OCR Engines

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)
- [manga-ocr](https://huggingface.co/mayocream/manga-ocr-onnx) (Default for Japanese)

## Workflow

1. **Browser:** The user clicks a button on the image. The browser sends the image information to the server.
2. **Server:** Downloads the image and extracts text using OCR engines like PaddleOCR or manga-ocr.
3. **Server:** Sends the extracted text to the configured AI model for translation.
4. **Server:** Erases the speech bubble text from the original image and inserts the translated text. The finished image is sent back to the browser.
5. **Browser:** Overlays the received image onto the original. The user can now view the translated manga.

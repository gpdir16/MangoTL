# Third-Party Software

MangoTL bundles or depends on the following notable open-source components. See each project for its license terms.

## Runtime dependencies (server)

| Component                                                             | License | Notes                           |
| --------------------------------------------------------------------- | ------- | ------------------------------- |
| [Elysia](https://elysiajs.com/)                                       | MIT     | HTTP server framework           |
| [@snowfluke/ppu-paddle-ocr](https://jsr.io/@snowfluke/ppu-paddle-ocr) | MIT     | PaddleOCR wrapper               |
| [onnxruntime-node](https://github.com/microsoft/onnxruntime)          | MIT     | ONNX inference (e.g. manga-ocr) |
| [ppu-ocv](https://www.npmjs.com/package/ppu-ocv)                      | MIT     | Image utilities                 |
| [Prettier](https://prettier.io/)                                      | MIT     | Development formatting only     |

## Models and external services (not shipped in repo)

| Component                                                         | License / terms | Notes                                     |
| ----------------------------------------------------------------- | --------------- | ----------------------------------------- |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)            | Apache-2.0      | Downloaded at runtime via OCR engine      |
| [manga-ocr ONNX](https://huggingface.co/mayocream/manga-ocr-onnx) | Apache-2.0      | Japanese OCR model                        |
| AI providers (CrofAI, OpenAI-compatible, etc.)                    | Provider ToS    | Configured via `server/config/providers/` |

## Browser extension

The extension uses only WebExtension APIs and project-owned assets. Icons are project-owned unless noted otherwise in the repository.

## AGPL and combined works

MangoTL is licensed under **AGPL-3.0-or-later**. If you distribute a modified version or offer it as a network service, you must comply with AGPL source-offer requirements for MangoTL itself. Third-party libraries remain under their respective licenses; incompatible licensing of combined works is your responsibility when you redistribute.

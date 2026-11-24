# Third-Party Software

MangoTL bundles or depends on the following notable open-source components. See each project for its license terms.

## Runtime dependencies (server)

| Component                                                             | License | Notes                       |
| --------------------------------------------------------------------- | ------- | --------------------------- |
| [Elysia](https://elysiajs.com/)                                       | MIT     | HTTP server framework       |
| [@snowfluke/ppu-paddle-ocr](https://jsr.io/@snowfluke/ppu-paddle-ocr) | MIT     | PaddleOCR wrapper           |
| [onnxruntime-node](https://github.com/microsoft/onnxruntime)          | MIT     | ONNX inference              |
| [ppu-ocv](https://www.npmjs.com/package/ppu-ocv)                      | MIT     | Image utilities             |
| [Prettier](https://prettier.io/)                                      | MIT     | Development formatting only |

## Models and external services (not shipped in repo)

| Component                                                                            | License / terms                                                                         | Notes                                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR)                               | Apache-2.0                                                                              | Downloaded at runtime via OCR engine                                                       |
| [llama.cpp](https://github.com/ggml-org/llama.cpp)                                   | MIT                                                                                     | External Docker image or native executable                                                 |
| [PLaMo 3 Translate GGUF](https://huggingface.co/collections/pfnet/plamo-3-translate) | [PLaMo Community License](https://plamo.preferredai.jp/info/plamo-community-license-en) | Downloaded from Hugging Face after user selection; commercial use may require registration |
| [Hy-MT2 GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF)                       | Apache-2.0                                                                              | Downloaded from Hugging Face after user selection                                          |
| AI providers (OpenAI-compatible, Ollama, etc.)                                       | Provider ToS                                                                            | Configured via `server/config/providers/`                                                  |

GGUF weights are not shipped in this repository or in the MangoTL application image. Model downloads and use are subject to each model's license and terms.

## Browser extension

The extension uses only WebExtension APIs and project-owned assets. Icons are project-owned unless noted otherwise in the repository.

## AGPL and combined works

MangoTL is licensed under **AGPL-3.0-or-later**. If you distribute a modified version or offer it as a network service, you must comply with AGPL source-offer requirements for MangoTL itself. Third-party libraries remain under their respective licenses; incompatible licensing of combined works is your responsibility when you redistribute.

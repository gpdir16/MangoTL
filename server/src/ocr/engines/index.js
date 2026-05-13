import { recognizeWithPaddle } from "./paddle.js";
import { recognizeWithMangaOcr } from "./mangaocr.js";
import { HttpError } from "../../utils/http-error.js";

const LOG = "[MangoTL-OCR]";

/**
 * Registered OCR recognition engines.
 * Engine selection is resolved in the pipeline from language routing config
 * and each engine's declared language support.
 */
const ENGINES = {
    paddle: recognizeWithPaddle,
    mangaocr: recognizeWithMangaOcr,
};

/**
 * Runs the recognition stage for an already-detected image.
 * @param detection result of runDetection: { canvas, boxes, width, height }
 */
export async function recognize(detection, ocrEngineConfig) {
    console.log(`${LOG} Recognizing with engine: ${ocrEngineConfig.id} (type: ${ocrEngineConfig.type})`);

    const engine = ENGINES[ocrEngineConfig.type];
    if (!engine) {
        throw new HttpError(400, "ocr_engine_not_supported", `Unsupported OCR engine: ${ocrEngineConfig.type}`);
    }

    return engine(detection, ocrEngineConfig);
}

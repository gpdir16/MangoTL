import { runDetection } from "../detection-engines/index.js";
import { recognize } from "./engines/index.js";
import { normalizeOcrResult } from "./normalize.js";

const LOG = "[MangoTL-OCR]";

/**
 * Runs the full OCR pipeline: detection (engine-agnostic) followed by
 * recognition (PaddleOCR or manga-ocr). Detection boxes are reused by
 * whichever recognition engine is selected.
 *
 * @returns {{ items: Array<{ id, text, confidence, coords }>, canvas, width: number, height: number }}
 */
export async function runOcr(image, detectionEngineConfig, ocrEngineConfig) {
    console.log(`${LOG} Pipeline start — detection: ${detectionEngineConfig.type}, recognition: ${ocrEngineConfig.type}`);

    try {
        const detection = await runDetection(image, detectionEngineConfig);
        console.log(`${LOG} Detection produced ${detection.boxes.length} boxes`);

        if (detection.boxes.length === 0) {
            console.warn(`${LOG} No text regions detected`);
            return { items: [], canvas: detection.canvas, width: detection.width, height: detection.height };
        }

        const raw = await recognize(detection, ocrEngineConfig);
        const normalized = normalizeOcrResult(raw, detection, ocrEngineConfig);

        console.log(`${LOG} Pipeline produced ${normalized.length} usable text items`);
        return { items: normalized, canvas: detection.canvas, width: detection.width, height: detection.height };
    } catch (error) {
        console.error(`${LOG} Error:`, error.message);
        throw error;
    }
}

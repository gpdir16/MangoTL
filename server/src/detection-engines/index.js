import { createCanvas, loadImage } from "ppu-ocv/canvas";
import { detectWithPaddle } from "./paddle.js";
import { HttpError } from "../utils/http-error.js";

const LOG = "[MangoTL-Detection]";

/**
 * Detects text regions in an image. Detection is engine-agnostic and shared
 * by every OCR recognition engine.
 *
 * @returns {{ canvas, boxes: Array<{x,y,width,height}>, width: number, height: number }}
 */
export async function runDetection(image, detectionEngineConfig) {
    console.log(`${LOG} Running detection with engine: ${detectionEngineConfig.id} (type: ${detectionEngineConfig.type})`);

    const canvas = await prepareCanvas(image);

    let boxes;
    if (detectionEngineConfig.type === "paddle") {
        boxes = await detectWithPaddle(canvas, detectionEngineConfig);
    } else {
        throw new HttpError(400, "detection_engine_not_supported", `Unsupported detection engine: ${detectionEngineConfig.type}`);
    }

    return { canvas, boxes, width: canvas.width, height: canvas.height };
}

async function prepareCanvas(image) {
    if (!image?.buffer) {
        throw new HttpError(400, "invalid_image", "Image buffer is missing for detection.");
    }

    const decoded = await loadImage(image.buffer);
    const canvas = createCanvas(decoded.width, decoded.height);
    canvas.getContext("2d").drawImage(decoded, 0, 0);
    return canvas;
}

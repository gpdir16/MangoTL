import * as ort from "onnxruntime-node";
import { DetectionService } from "@snowfluke/ppu-paddle-ocr";
import { fetchAndCacheModelPath, modelCacheFileName } from "../utils/model-cache.js";
import { createDetectionModelPreset } from "../ocr-models/presets.js";
import { getOcrModelManager } from "../ocr-models/manager.js";
import { ortSessionOptions } from "../utils/ort-options.js";
import { HttpError } from "../utils/http-error.js";

const LOG = "[MangoTL-Detection-Paddle]";

const detectorPromises = new Map();

/**
 * Runs PaddleOCR text-region detection on a prepared canvas.
 * Returns an array of { x, y, width, height } boxes in source-image coordinates.
 */
export async function detectWithPaddle(canvas, detectionEngineConfig) {
    const preset = createDetectionModelPreset(detectionEngineConfig, detectionEngineConfig.model);
    return getOcrModelManager().runWithPreset(preset, async () => {
        const detector = await getDetector(detectionEngineConfig, preset.id);

        const start = Date.now();
        const boxes = normalizeBoxes(await detector.run(canvas));
        console.log(`${LOG} Detected ${boxes.length} text regions in ${Date.now() - start}ms`);

        return boxes;
    });
}

async function getDetector(config, presetId) {
    const cacheKey = getDetectorCacheKey(config);
    const cached = detectorPromises.get(cacheKey);

    if (cached) {
        return cached;
    }

    const detectorPromise = (async () => {
        const modelUrl = config.model?.detection;
        if (!modelUrl) {
            throw new HttpError(500, "detection_config_invalid", "Detection model URL is missing in detection engine config.");
        }

        console.log(`${LOG} Initializing PaddleOCR detection...`);
        // 경로로 생성해야 가중치가 mmap로 올라가 세션 메모리가 크게 줄어든다
        const modelPath = await fetchAndCacheModelPath(modelUrl, modelCacheFileName("paddle-det", modelUrl), LOG);

        const session = await ort.InferenceSession.create(modelPath, ortSessionOptions());
        console.log(`${LOG} Detection session ready (input: ${session.inputNames}, output: ${session.outputNames})`);

        const engine = config.processing?.engine || "canvas-native";
        const detector = new ManagedDetectionService(session, config.options || {}, config.debugging || {}, engine);
        getOcrModelManager().registerRuntime(presetId, async () => {
            if (detectorPromises.get(cacheKey) === detectorPromise) detectorPromises.delete(cacheKey);
            if (typeof session.release === "function") await session.release();
        });
        return detector;
    })();

    detectorPromises.set(cacheKey, detectorPromise);
    detectorPromise.catch(() => detectorPromises.delete(cacheKey));

    return detectorPromise;
}

class ManagedDetectionService extends DetectionService {
    async runInference(data, width, height) {
        const input = new ort.Tensor("float32", data, [1, 3, height, width]);
        let outputs;
        try {
            outputs = await this.session.run({ [this.session.inputNames[0]]: input });
            return Float32Array.from(outputs[this.session.outputNames[0]].data);
        } finally {
            input.dispose();
            for (const tensor of Object.values(outputs || {})) tensor.dispose();
        }
    }
}

function getDetectorCacheKey(config) {
    return JSON.stringify({
        model: config.model?.detection || null,
        options: config.options || {},
        debugging: config.debugging || {},
        engine: config.processing?.engine || "canvas-native",
    });
}

function normalizeBoxes(boxes) {
    if (!Array.isArray(boxes)) {
        return [];
    }

    return boxes
        .map((box) => ({
            x: Number(box?.x),
            y: Number(box?.y),
            width: Number(box?.width),
            height: Number(box?.height),
        }))
        .filter((box) => [box.x, box.y, box.width, box.height].every(Number.isFinite))
        .filter((box) => box.width > 0 && box.height > 0);
}

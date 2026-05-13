import * as ort from "onnxruntime-node";
import { RecognitionService } from "@snowfluke/ppu-paddle-ocr";
import { fetchAndCacheModel } from "../../utils/model-cache.js";
import { HttpError } from "../../utils/http-error.js";

const LOG = "[MangoTL-OCR-Paddle]";

const recognizerPromises = new Map();

/**
 * Recognizes text inside the boxes produced by the detection stage.
 * Returns the raw recognition items: [{ text, box, confidence }].
 */
export async function recognizeWithPaddle(detection, ocrEngineConfig) {
    const { recognizer, dictionary } = await getRecognizer(ocrEngineConfig);
    const strategy = ocrEngineConfig.strategy || "per-box";

    const start = Date.now();
    const results = await recognizer.run(detection.canvas, detection.boxes, dictionary, strategy);
    console.log(`${LOG} Recognized ${results.length} boxes in ${Date.now() - start}ms (strategy: ${strategy})`);

    return results;
}

async function getRecognizer(config) {
    const model = config.model || {};
    const cacheKey = getRecognizerCacheKey(config);

    const cached = recognizerPromises.get(cacheKey);
    if (cached) {
        return cached;
    }

    const promise = (async () => {
        const recognitionUrl = model.recognition;
        const dictionaryUrl = model.charactersDictionary;

        if (!recognitionUrl || !dictionaryUrl) {
            throw new HttpError(500, "ocr_config_invalid", "PaddleOCR recognition model or dictionary URL is missing.");
        }

        const language = model.language || "default";
        console.log(`${LOG} Initializing recognition (language: ${language})...`);

        const [recognitionBuffer, dictionaryBuffer] = await Promise.all([
            fetchAndCacheModel(recognitionUrl, `paddle-rec-${language}-${basename(recognitionUrl)}`, LOG),
            fetchAndCacheModel(dictionaryUrl, `paddle-dict-${language}-${basename(dictionaryUrl)}`, LOG),
        ]);

        const session = await ort.InferenceSession.create(recognitionBuffer, { executionProviders: ["cpu"] });
        const dictionary = dictionaryBuffer.toString("utf-8").split("\n");
        console.log(`${LOG} Recognition session ready (${dictionary.length} dictionary entries)`);

        const engine = config.processing?.engine || "canvas-native";
        const recognizer = new RecognitionService(session, { ...config.options, charactersDictionary: dictionary }, config.debugging || {}, engine);

        return { recognizer, dictionary };
    })();

    recognizerPromises.set(cacheKey, promise);
    promise.catch(() => recognizerPromises.delete(cacheKey));
    return promise;
}

function getRecognizerCacheKey(config) {
    const model = config.model || {};

    return JSON.stringify({
        recognition: model.recognition || null,
        charactersDictionary: model.charactersDictionary || null,
        language: model.language || "default",
        options: config.options || {},
        debugging: config.debugging || {},
        engine: config.processing?.engine || "canvas-native",
    });
}

function basename(url) {
    try {
        return new URL(url).pathname.split("/").pop() || "model";
    } catch {
        return "model";
    }
}

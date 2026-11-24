import * as ort from "onnxruntime-node";
import { RecognitionService } from "@snowfluke/ppu-paddle-ocr";
import { createCanvas } from "ppu-ocv/canvas";
import { fetchAndCacheModel, fetchAndCacheModelPath, modelCacheFileName } from "../../utils/model-cache.js";
import { createRecognitionModelPreset } from "../../ocr-models/presets.js";
import { getOcrModelManager } from "../../ocr-models/manager.js";
import { ortSessionOptions } from "../../utils/ort-options.js";
import { HttpError } from "../../utils/http-error.js";
import { recognizeJapaneseLayout } from "./paddle-layout.js";
import { parsePaddleDictionary } from "./paddle-dictionary.js";

const LOG = "[MangoTL-OCR-Paddle]";

const recognizerPromises = new Map();

/**
 * Recognizes text inside the boxes produced by the detection stage.
 * Returns the raw recognition items: [{ text, box, confidence }].
 */
export async function recognizeWithPaddle(detection, ocrEngineConfig) {
    const preset = createRecognitionModelPreset(ocrEngineConfig, ocrEngineConfig.model);
    return getOcrModelManager().runWithPreset(preset, async () => {
        const { recognizer, dictionary } = await getRecognizer(ocrEngineConfig, preset.id);
        const strategy = ocrEngineConfig.strategy || "per-box";

        const start = Date.now();
        let results;
        if (ocrEngineConfig.model?.layout === "japanese") {
            results = await recognizeJapaneseLayout(recognizer, detection, dictionary);
        } else if (strategy === "per-box") {
            results = recognizer.sortResultsByReadingOrder(await recognizeJapaneseLayout(recognizer, detection, dictionary, { vertical: false }));
        } else {
            results = await recognizer.run(detection.canvas, detection.boxes, dictionary, strategy);
        }
        console.log(`${LOG} Recognized ${results.length} boxes in ${Date.now() - start}ms (strategy: ${strategy})`);

        return results;
    });
}

async function getRecognizer(config, presetId) {
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

        // 인식 세션은 경로로 생성해 가중치를 mmap로 올린다(사전은 텍스트라 버퍼 유지)
        const [recognitionPath, dictionaryBuffer] = await Promise.all([
            fetchAndCacheModelPath(recognitionUrl, modelCacheFileName(`paddle-rec-${language}`, recognitionUrl), LOG),
            fetchAndCacheModel(dictionaryUrl, modelCacheFileName(`paddle-dict-${language}`, dictionaryUrl), LOG),
        ]);

        const session = await ort.InferenceSession.create(recognitionPath, ortSessionOptions());
        const dictionary = parsePaddleDictionary(dictionaryBuffer, model.dictionaryFormat);
        console.log(`${LOG} Recognition session ready (${dictionary.length} dictionary entries)`);

        const engine = config.processing?.engine || "canvas-native";
        const recognizer = new ManagedRecognitionService(
            session,
            { ...config.options, charactersDictionary: dictionary },
            config.debugging || {},
            engine,
        );

        getOcrModelManager().registerRuntime(presetId, async () => {
            if (recognizerPromises.get(cacheKey) === promise) recognizerPromises.delete(cacheKey);
            if (typeof session.release === "function") await session.release();
        });

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
        dictionaryFormat: model.dictionaryFormat || null,
        language: model.language || "default",
        options: config.options || {},
        debugging: config.debugging || {},
        engine: config.processing?.engine || "canvas-native",
    });
}

// The upstream recognizer retains output tensors. Release both input and
// output after every crop; propagate inference failures instead of empty OCR.
class ManagedRecognitionService extends RecognitionService {
    async preprocessImage(crop) {
        const height = this.options.imageHeight ?? 48;
        const resizedWidth = Math.min(this.options.maxImageWidth ?? 3200, Math.max(8, Math.ceil((height * crop.width) / crop.height)));
        const width = Math.max(320, resizedWidth);
        const canvas = createCanvas(resizedWidth, height);
        const context = canvas.getContext("2d");
        context.fillStyle = "white";
        context.fillRect(0, 0, resizedWidth, height);
        context.drawImage(crop, 0, 0, resizedWidth, height);
        const pixels = context.getImageData(0, 0, resizedWidth, height).data;
        // Official RecResizeImg: BGR, [-1,1], zero padding to minimum 320.
        // Replicating the red channel loses coloured text, especially red ink.
        const imageTensor = new Float32Array(3 * width * height);
        for (let y = 0; y < height; y++)
            for (let x = 0; x < resizedWidth; x++) {
                const p = (y * resizedWidth + x) * 4;
                for (let c = 0; c < 3; c++) imageTensor[c * width * height + y * width + x] = pixels[p + 2 - c] / 127.5 - 1;
            }
        return { imageTensor, tensorWidth: width, tensorHeight: height };
    }

    async recognizeText(crop, dictionary) {
        const { imageTensor, tensorWidth, tensorHeight } = await this.preprocessImage(crop);
        const input = new ort.Tensor("float32", imageTensor, [1, 3, tensorHeight, tensorWidth]);
        let outputs;
        try {
            outputs = await this.session.run({ [this.session.inputNames[0]]: input });
            const output = outputs[this.session.outputNames[0]];
            const classes = output.dims[2];
            if (dictionary.length !== classes && dictionary.length !== classes - 1) {
                throw new HttpError(500, "ocr_dictionary_mismatch", `Model has ${classes} classes but dictionary has ${dictionary.length} entries`);
            }
            return this.decodeResults(output, dictionary);
        } finally {
            input.dispose();
            for (const tensor of Object.values(outputs || {})) tensor.dispose();
        }
    }
}

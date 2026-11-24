import { modelCacheFileName, modelUrlHash } from "../utils/model-cache.js";
import { HttpError } from "../utils/http-error.js";

const LANGUAGE_NAMES = {
    ja: "Japanese",
    ko: "Korean",
    en: "English",
    de: "German",
    sv: "Swedish",
    korean: "Korean",
    latin: "Latin",
    "v6-medium": "Japanese",
};
const LAMA_MODEL_URL = "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx";

export function createOcrModelPresets({ ocrEngines = [], detectionEngines = [] } = {}) {
    const presets = [];

    for (const engine of detectionEngines) {
        if (engine.type !== "paddle") continue;
        if (engine.model?.detection) addPreset(presets, createDetectionModelPreset(engine, engine.model));
        for (const [language, override] of Object.entries(engine.languages || {})) {
            if (override.model?.detection) addPreset(presets, createDetectionModelPreset(engine, override.model, language));
        }
    }

    for (const engine of ocrEngines) {
        if (engine.type !== "paddle") continue;
        for (const [language, model] of Object.entries(engine.languages || {})) {
            addPreset(presets, createRecognitionModelPreset(engine, model, [language]));
        }
    }

    addPreset(presets, createLamaModelPreset());
    return presets;
}

export function createDetectionModelPreset(engine, model, language) {
    const url = model?.detection;
    if (!url) {
        throw new HttpError(500, "detection_config_invalid", "Detection model URL is missing in detection engine config.");
    }

    return {
        id: `ocr:${engine.id}:detection:${modelUrlHash(url)}`,
        name: detectionModelName(url, language),
        kind: "ocr",
        files: [{ url, fileName: modelCacheFileName("paddle-det", url) }],
        sourceUrl: sourcePage(url),
        supportedLanguages: language ? [language] : [],
    };
}

export function createRecognitionModelPreset(engine, model, supportedLanguages = []) {
    const recognitionUrl = model?.recognition;
    const dictionaryUrl = model?.charactersDictionary;
    if (!recognitionUrl || !dictionaryUrl) {
        throw new HttpError(500, "ocr_config_invalid", "PaddleOCR recognition model or dictionary URL is missing.");
    }

    const language = model.language || supportedLanguages[0] || "default";
    return {
        id: `ocr:${engine.id}:recognition:${language}`,
        name: recognitionModelName(recognitionUrl, language),
        kind: "ocr",
        files: [
            { url: recognitionUrl, fileName: modelCacheFileName(`paddle-rec-${language}`, recognitionUrl) },
            { url: dictionaryUrl, fileName: modelCacheFileName(`paddle-dict-${language}`, dictionaryUrl) },
        ],
        sourceUrl: sourcePage(recognitionUrl),
        supportedLanguages,
    };
}

export function createLamaModelPreset() {
    return {
        id: "inpaint:lama",
        name: "LaMa Inpainting",
        kind: "inpaint",
        files: [{ url: LAMA_MODEL_URL, fileName: "lama_fp32.onnx" }],
        sourceUrl: sourcePage(LAMA_MODEL_URL),
        supportedLanguages: [],
    };
}

function detectionModelName(url, language) {
    let name = "PaddleOCR Text Detection";
    if (url.includes("PP-OCRv6_small_det")) name = "PaddleOCR PP-OCRv6 Small Detection";
    if (url.includes("PP-OCRv5_mobile_det")) name = "PaddleOCR PP-OCRv5 Mobile Detection";
    return language ? `${name} (${LANGUAGE_NAMES[language] || language})` : name;
}

function recognitionModelName(url, language) {
    let name = "PaddleOCR Text Recognition";
    if (url.includes("PP-OCRv6_medium_rec")) name = "PaddleOCR PP-OCRv6 Medium Recognition";
    if (url.includes("PP-OCRv5_mobile_rec")) name = "PaddleOCR PP-OCRv5 Mobile Recognition";
    return `${name} (${LANGUAGE_NAMES[language] || language})`;
}

function addPreset(presets, preset) {
    const current = presets.find((entry) => entry.id === preset.id);
    if (!current) {
        presets.push(preset);
        return;
    }
    current.supportedLanguages = [...new Set([...current.supportedLanguages, ...preset.supportedLanguages])];
}

function sourcePage(value) {
    try {
        const url = new URL(value);
        if (url.hostname === "huggingface.co") return value.replace("/resolve/", "/blob/");
        if (url.hostname === "raw.githubusercontent.com") {
            const [owner, repo, branch, ...rest] = url.pathname.slice(1).split("/");
            return `https://github.com/${owner}/${repo}/blob/${branch}/${rest.join("/")}`;
        }
        if (url.hostname === "media.githubusercontent.com") {
            const match = /^\/media\/([^/]+)\/([^/]+)\/refs\/heads\/([^/]+)\/(.+)$/.exec(url.pathname);
            if (match) return `https://github.com/${match[1]}/${match[2]}/blob/${match[3]}/${match[4]}`;
        }
    } catch {
        return value;
    }
    return value;
}

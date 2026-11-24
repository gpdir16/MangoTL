import { HttpError } from "../utils/http-error.js";
import { targetLanguageProbeDescriptor } from "../ocr/index.js";

/**
 * 요청 설정에서 파이프라인이 사용할 각 엔진/프로바이더를 해석한다.
 * 언어별 라우팅(config/ocr-routing.json)이 있으면 우선 적용하고,
 * 프로브용 엔진은 해석에 실패해도 파이프라인을 막지 않는다(보조 기능).
 */

export function resolveProvider(config) {
    const id = config.defaultProvider;
    const provider = config.providers.find((candidate) => candidate.id === id);

    if (!provider) {
        throw new HttpError(400, "provider_not_found", `AI provider not found: ${id || "(none)"}`);
    }

    if (id === "openai-compatible" && config.baseUrl) {
        return { ...provider, baseUrl: config.baseUrl };
    }

    return provider;
}

export function resolveDetectionEngine(config, sourceLanguage) {
    const language = sourceLanguage || config.defaultSourceLanguage || config.appDefaults?.sourceLanguage;
    const id = getLanguageRouting(config, language)?.detectionEngine || config.defaultDetectionEngine;
    const engine = config.detectionEngines.find((candidate) => candidate.id === id);

    if (!engine) {
        throw new HttpError(400, "detection_engine_not_found", `Detection engine not found: ${id || "(none)"}`);
    }

    const overrides = engine.languages?.[language];
    return overrides ? { ...engine, model: { ...engine.model, ...overrides.model }, options: { ...engine.options, ...overrides.options } } : engine;
}

export function resolveOcrEngine(config, sourceLanguage) {
    const language = sourceLanguage || config.defaultSourceLanguage || config.appDefaults?.sourceLanguage;
    const routedId = getLanguageRouting(config, language)?.ocrEngine;

    return prepareOcrEngine(findOcrEngine(config, routedId || config.defaultOcrEngine), language, config);
}

/**
 * 목표 언어 텍스트가 이미 들어있는지 확인하는 프로브용 엔진.
 * 목표 언어를 읽을 수 있는 OCR 엔진이 라우팅되어 있을 때만 준비한다.
 */
export function resolveTargetLanguageProbe(config, request) {
    if (!request.targetLanguage || request.targetLanguage === request.sourceLanguage) {
        return null;
    }
    try {
        const engine = resolveOcrEngine(config, request.targetLanguage);
        // 판정 스크립트가 없는 목표 언어는 프로브를 아예 실행하지 않는다
        return targetLanguageProbeDescriptor(request.targetLanguage, engine);
    } catch {
        return null;
    }
}

function prepareOcrEngine(engine, language, config) {
    if (!supportsLanguage(engine, language)) {
        throw new HttpError(400, "ocr_engine_not_found", `OCR engine "${engine.id}" does not support source language: ${language || "(none)"}`);
    }

    const languageModel = resolveLanguageModel(engine, language, config);

    if (!languageModel) {
        return engine;
    }

    return {
        ...engine,
        model: { ...engine.model, ...languageModel },
    };
}

function supportsLanguage(engine, language) {
    if (!language) {
        return true;
    }

    if (Array.isArray(engine.supportedLanguages)) {
        return engine.supportedLanguages.includes(language);
    }

    if (engine.languages && typeof engine.languages === "object") {
        return Object.hasOwn(engine.languages, language);
    }

    return true;
}

function getLanguageRouting(config, language) {
    return language ? config.ocrRouting?.languages?.[language] || null : null;
}

function resolveLanguageModel(engine, language, config) {
    if (!engine.languages || typeof engine.languages !== "object") {
        return null;
    }

    const fallbackLanguage = engine.defaultLanguage || config.defaultSourceLanguage;
    return engine.languages[language] || engine.languages[fallbackLanguage] || null;
}

function findOcrEngine(config, engineId) {
    const engine = config.ocrEngines.find((candidate) => candidate.id === engineId);

    if (!engine) {
        throw new HttpError(400, "ocr_engine_not_found", `OCR engine not found: ${engineId || "(none)"}`);
    }

    return engine;
}

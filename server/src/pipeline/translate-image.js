import { translateWithOpenAICompatible } from "../ai/openai-compatible.js";
import { runOcr } from "../ocr/index.js";
import { analyzeBlockStyles } from "../text/analyze-style.js";
import { groupTextBlocks } from "../text/group-blocks.js";
import { encodeImage, inpaintTextRegions } from "../text/inpaint.js";
import { renderTranslatedText } from "../text/render-text.js";
import { HttpError } from "../utils/http-error.js";
import { createImageResultCacheKey, readCachedImageResult, writeCachedImageResult } from "../utils/image-result-cache.js";

export async function translateImage(request, config, options = {}) {
    const provider = request.dryRun ? null : resolveProvider(config);
    const detectionEngine = resolveDetectionEngine(config, request.sourceLanguage);
    const ocrEngine = resolveOcrEngine(config, request.sourceLanguage);
    const imageUrl = request.imageUrl;

    throwIfAborted(options.signal);
    options.onProgress?.({
        step: "processing",
        imageUrl,
        label: "Translating image...",
    });

    const cacheKey = createImageResultCacheKey({
        imageUrl,
        request,
        provider,
        detectionEngine,
        ocrEngine,
    });
    const cachedResult = await readCachedImageResult(cacheKey);
    throwIfAborted(options.signal);

    if (cachedResult) {
        const result = attachImageResultContext(cachedResult, request, imageUrl);
        console.log(`[MangoTL] Using cached image translation: ${imageUrl}`);
        options.onProgress?.({
            step: "completed",
            imageUrl,
            label: "Image translated",
        });
        return result;
    }

    const image = await fetchImage(imageUrl, options.signal);

    try {
        const ocr = await runOcr(image, detectionEngine, ocrEngine);
        throwIfAborted(options.signal);

        // Drop blocks with no actual letters (rows of dots, stray symbols):
        // these are OCR noise picked off the artwork, not translatable text.
        const groupedBlocks = groupTextBlocks(ocr.items).filter((block) => /\p{L}/u.test(block.sourceText));
        const sourceBlocks = analyzeBlockStyles(groupedBlocks, ocr.canvas);

        if (sourceBlocks.length === 0) {
            const result = {
                imageUrl,
                sourceLanguage: request.sourceLanguage,
                targetLanguage: request.targetLanguage,
                blocks: [],
            };
            await cacheImageResult(cacheKey, result);
            throwIfAborted(options.signal);
            options.onProgress?.({
                step: "completed",
                imageUrl,
                label: "Image translated",
            });
            return result;
        }

        const translatedBlocks = request.dryRun
            ? sourceBlocks.map((block) => ({
                  id: block.id,
                  translatedText: block.sourceText,
                  type: block.type,
                  direction: block.direction,
              }))
            : await translateWithOpenAICompatible({
                  provider,
                  sourceLanguage: request.sourceLanguage,
                  targetLanguage: request.targetLanguage,
                  blocks: sourceBlocks,
                  signal: options.signal,
              });

        // Drop blocks the model returned empty for — garbled OCR or text
        // that needs no translation. Those are left as the original art.
        const blocks = mergeTranslations(sourceBlocks, translatedBlocks).filter((block) => block.translatedText.trim().length > 0);

        // Produce the finished page server-side: erase the original glyphs,
        // then draw the translation in their place. The extension only has
        // to swap this image over the original.
        inpaintTextRegions(ocr.canvas, blocks);
        renderTranslatedText(ocr.canvas, blocks);
        const renderedImage = encodeImage(ocr.canvas);

        const result = {
            imageUrl,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            renderedImage,
            blocks,
        };
        await cacheImageResult(cacheKey, result);
        throwIfAborted(options.signal);
        options.onProgress?.({
            step: "completed",
            imageUrl,
            label: "Image translated",
        });
        return result;
    } catch (imageError) {
        console.error("[MangoTL] Failed to process image:", imageError.message);
        throw imageError;
    }
}

async function cacheImageResult(cacheKey, result) {
    try {
        await writeCachedImageResult(cacheKey, stripImageResultContext(result));
    } catch (error) {
        console.warn("[MangoTL] Failed to cache image result:", error.message);
    }
}

function attachImageResultContext(cachedResult, request, imageUrl) {
    return {
        ...cachedResult,
        imageUrl,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
    };
}

function stripImageResultContext(result) {
    const { imageUrl, ...cacheableResult } = result;
    return cacheableResult;
}

function resolveProvider(config) {
    const id = config.defaultProvider;
    const provider = config.providers.find((candidate) => candidate.id === id && candidate.enabled !== false);

    if (!provider) {
        throw new HttpError(400, "provider_not_found", `AI provider not found or disabled: ${id || "(none)"}`);
    }

    if (provider.type !== "openai-compatible") {
        throw new HttpError(400, "provider_not_supported", `Unsupported provider type: ${provider.type}`);
    }

    return provider;
}

function resolveDetectionEngine(config, sourceLanguage) {
    const language = sourceLanguage || config.defaultSourceLanguage;
    const id = getLanguageRouting(config, language)?.detectionEngine || config.defaultDetectionEngine;
    const engine = config.detectionEngines.find((candidate) => candidate.id === id && candidate.enabled !== false);

    if (!engine) {
        throw new HttpError(400, "detection_engine_not_found", `Detection engine not found or disabled: ${id || "(none)"}`);
    }

    return engine;
}

function resolveOcrEngine(config, sourceLanguage) {
    const language = sourceLanguage || config.defaultSourceLanguage;
    const routedId = getLanguageRouting(config, language)?.ocrEngine;

    return prepareOcrEngine(findOcrEngine(config, routedId || config.defaultOcrEngine), language, config);
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
    const engine = config.ocrEngines.find((candidate) => candidate.id === engineId && candidate.enabled !== false);

    if (!engine) {
        throw new HttpError(400, "ocr_engine_not_found", `OCR engine not found or disabled: ${engineId || "(none)"}`);
    }

    return engine;
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException("Translation stopped", "AbortError");
    }
}

async function fetchImage(imageUrl, signal) {
    let parsedUrl;

    try {
        parsedUrl = new URL(imageUrl);
    } catch {
        throw new HttpError(400, "invalid_image_url", `Invalid image URL: ${imageUrl}`);
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        throw new HttpError(400, "invalid_image_url", `Unsupported image URL protocol: ${parsedUrl.protocol}`);
    }

    const response = await fetch(parsedUrl, {
        headers: getImageFetchHeaders(parsedUrl),
        signal,
    });

    if (!response.ok) {
        throw new HttpError(response.status, "image_fetch_failed", `Failed to fetch image: ${imageUrl}`);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";

    if (!contentType.startsWith("image/")) {
        throw new HttpError(415, "unsupported_image_type", `URL did not return an image: ${imageUrl}`);
    }

    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType,
    };
}

function getImageFetchHeaders(parsedUrl) {
    const headers = {
        Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        "User-Agent": "MangoTL/0.1",
    };

    if (parsedUrl.hostname.endsWith("pximg.net")) {
        headers.Referer = "https://www.pixiv.net/";
    }

    return headers;
}

function mergeTranslations(sourceBlocks, translatedBlocks) {
    const byId = new Map(translatedBlocks.map((block) => [String(block.id), block]));

    return sourceBlocks.map((sourceBlock) => {
        const translated = byId.get(String(sourceBlock.id));

        return {
            id: sourceBlock.id,
            order: sourceBlock.order,
            originalText: sourceBlock.sourceText,
            // An explicit empty string from the model means "skip"; only fall
            // back to the source text when the model omitted the block entirely.
            translatedText: translated ? translated.translatedText : sourceBlock.sourceText,
            coords: sourceBlock.coords,
            type: translated?.type || sourceBlock.type,
            direction: translated?.direction || sourceBlock.direction,
            confidence: sourceBlock.confidence,
            sourceBlockIds: sourceBlock.sourceBlockIds,
            style: sourceBlock.style || null,
        };
    });
}

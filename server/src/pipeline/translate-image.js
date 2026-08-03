import { translateWithOpenAICompatible } from "../ai/openai-compatible.js";
import { runOcr } from "../ocr/index.js";
import { analyzeBlockStyles } from "../text/analyze-style.js";
import { groupTextBlocks } from "../text/group-blocks.js";
import { encodeImage, inpaintTextRegions } from "../text/inpaint.js";
import { renderTranslatedText } from "../text/render-text.js";
import { HttpError } from "../utils/http-error.js";
import { createImageResultCacheKey, readCachedImageResult, writeCachedImageResult } from "../utils/image-result-cache.js";
import { createHash } from "node:crypto";

export async function translateImage(request, config, options = {}) {
    const provider = request.dryRun ? null : resolveProvider(config);
    const detectionEngine = resolveDetectionEngine(config, request.sourceLanguage);
    const ocrEngine = resolveOcrEngine(config, request.sourceLanguage);
    const imageId = request.imageId || "image";
    const imageHash = createHash("sha256").update(request.image.buffer).digest("hex");

    throwIfAborted(options.signal);
    options.onProgress?.({
        step: "processing",
        imageId,
        label: "Translating image...",
    });

    const cacheKey = createImageResultCacheKey({
        imageHash,
        request,
        provider,
        model: config.defaultModel,
        detectionEngine,
        ocrEngine,
    });
    const cachedResult = await readCachedImageResult(cacheKey);
    throwIfAborted(options.signal);

    if (cachedResult) {
        const result = attachImageResultContext(cachedResult, request, imageId);
        console.log(`[MangoTL] Using cached image translation: ${imageId}`);
        options.onProgress?.({
            step: "completed",
            imageId,
            label: "Image translated",
        });
        return result;
    }

    const image = request.image;

    try {
        const ocr = await runOcr(image, detectionEngine, ocrEngine);
        throwIfAborted(options.signal);

        // Drop blocks with no actual letters (rows of dots, stray symbols):
        // these are OCR noise picked off the artwork, not translatable text.
        const textItems = ocr.items.filter((item) => /\p{L}/u.test(item.text));
        const groupedBlocks = groupTextBlocks(textItems).filter((block) => /\p{L}/u.test(block.sourceText));
        const sourceBlocks = analyzeBlockStyles(groupedBlocks, ocr.canvas)
            .map((block) => applyDetectedBubbleBox(block, ocr.width, ocr.height))
            .filter((block) => shouldTranslateBlock(block, ocr.width, ocr.height));

        if (sourceBlocks.length === 0) {
            const result = {
                imageId,
                sourceLanguage: request.sourceLanguage,
                targetLanguage: request.targetLanguage,
                blocks: [],
            };
            await cacheImageResult(cacheKey, result);
            throwIfAborted(options.signal);
            options.onProgress?.({
                step: "completed",
                imageId,
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
                  model: config.defaultModel,
                  apiKey: config.apiKey,
                  sourceLanguage: request.sourceLanguage,
                  targetLanguage: request.targetLanguage,
                  blocks: sourceBlocks,
                  signal: options.signal,
              });

        // Drop blocks the model returned empty for — garbled OCR or text
        // that needs no translation. Those are left as the original art.
        const blocks = mergeTranslations(sourceBlocks, translatedBlocks, request.targetLanguage).filter(
            (block) => block.translatedText.trim().length > 0,
        );

        // Produce the finished page server-side: erase the original glyphs,
        // then draw the translation in their place. The extension only has
        // to swap this image over the original.
        inpaintTextRegions(ocr.canvas, blocks);
        renderTranslatedText(ocr.canvas, blocks);
        const renderedImage = encodeImage(ocr.canvas);

        const result = {
            imageId,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
            renderedImage,
            blocks,
        };
        await cacheImageResult(cacheKey, result);
        throwIfAborted(options.signal);
        options.onProgress?.({
            step: "completed",
            imageId,
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

function attachImageResultContext(cachedResult, request, imageId) {
    return {
        ...cachedResult,
        imageId,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
    };
}

function stripImageResultContext(result) {
    const { imageId, ...cacheableResult } = result;
    return cacheableResult;
}

function resolveProvider(config) {
    const id = config.defaultProvider;
    const provider = config.providers.find((candidate) => candidate.id === id);

    if (!provider) {
        throw new HttpError(400, "provider_not_found", `AI provider not found: ${id || "(none)"}`);
    }

    if (provider.type !== "openai-compatible") {
        throw new HttpError(400, "provider_not_supported", `Unsupported provider type: ${provider.type}`);
    }

    return provider;
}

function resolveDetectionEngine(config, sourceLanguage) {
    const language = sourceLanguage || config.defaultSourceLanguage;
    const id = getLanguageRouting(config, language)?.detectionEngine || config.defaultDetectionEngine;
    const engine = config.detectionEngines.find((candidate) => candidate.id === id);

    if (!engine) {
        throw new HttpError(400, "detection_engine_not_found", `Detection engine not found: ${id || "(none)"}`);
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
    const engine = config.ocrEngines.find((candidate) => candidate.id === engineId);

    if (!engine) {
        throw new HttpError(400, "ocr_engine_not_found", `OCR engine not found: ${engineId || "(none)"}`);
    }

    return engine;
}

function throwIfAborted(signal) {
    if (signal?.aborted) {
        throw new DOMException("Translation stopped", "AbortError");
    }
}

function mergeTranslations(sourceBlocks, translatedBlocks, targetLanguage) {
    const byId = new Map(translatedBlocks.map((block) => [String(block.id), block]));

    return sourceBlocks.map((sourceBlock) => {
        const translated = byId.get(String(sourceBlock.id));
        const translatedText = translated ? translated.translatedText : sourceBlock.sourceText;

        return {
            id: sourceBlock.id,
            order: sourceBlock.order,
            originalText: sourceBlock.sourceText,
            // An explicit empty string from the model means "skip"; only fall
            // back to the source text when the model omitted the block entirely.
            translatedText,
            coords: sourceBlock.coords,
            eraseCoords: sourceBlock.eraseCoords || sourceBlock.coords,
            type: translated?.type || sourceBlock.type,
            direction: normalizeRenderDirection(translated?.direction, sourceBlock.direction, translatedText, targetLanguage),
            confidence: sourceBlock.confidence,
            sourceBlockIds: sourceBlock.sourceBlockIds,
            style: sourceBlock.style || null,
        };
    });
}

function shouldTranslateBlock(block, imageWidth, imageHeight) {
    const text = String(block.sourceText || "").trim();
    const compact = text.replace(/\s+/g, "");

    if (!compact) {
        return false;
    }

    if (block.type === "sfx") {
        return false;
    }

    if (isMetadataText(compact)) {
        return false;
    }

    if (compact.length <= 1) {
        return false;
    }

    if (!hasDrawableTextSurface(block)) {
        return false;
    }

    if (isLowQualityDecorativeBlock(block, compact, imageWidth, imageHeight)) {
        return false;
    }

    return true;
}

function applyDetectedBubbleBox(block, imageWidth, imageHeight) {
    const bubbleBox = block.style?.bubbleBox;

    if (!bubbleBox || !shouldUseDetectedBubbleBox(block, bubbleBox, imageWidth, imageHeight)) {
        return block;
    }

    const coords = getRenderBox(block, bubbleBox);

    return {
        ...block,
        coords,
        eraseCoords: block.coords,
        renderBackground: isTopEdgeVerticalSource(block.coords, bubbleBox),
    };
}

function getRenderBox(block, bubbleBox) {
    const coords = block.coords;

    if (isTopEdgeVerticalSource(coords, bubbleBox)) {
        return getTopEdgeVerticalRenderBox(coords, bubbleBox);
    }

    if (coords.height > coords.width * 1.15) {
        return bubbleBox;
    }

    const targetWidth = Math.min(bubbleBox.width, Math.max(coords.width, coords.width * 1.35));
    const targetHeight = Math.min(bubbleBox.height, Math.max(coords.height, coords.height * 2.1));
    const centerX = coords.x + coords.width / 2;
    const centerY = coords.y + coords.height / 2;
    const x = clamp(centerX - targetWidth / 2, bubbleBox.x, bubbleBox.x + bubbleBox.width - targetWidth);
    const y = clamp(centerY - targetHeight / 2, bubbleBox.y, bubbleBox.y + bubbleBox.height - targetHeight);

    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(targetWidth),
        height: Math.round(targetHeight),
    };
}

function getTopEdgeVerticalRenderBox(coords, bubbleBox) {
    const targetWidth = Math.min(bubbleBox.width * 0.6, Math.max(coords.width * 1.42, 120));
    const targetHeight = Math.min(bubbleBox.height * 0.5, Math.max(coords.height * 0.85, 96));
    const centerX = coords.x + coords.width / 2;
    const centerY = coords.y + coords.height / 2 + 8;
    const x = clamp(centerX - targetWidth / 2, bubbleBox.x, bubbleBox.x + bubbleBox.width - targetWidth);
    const y = clamp(centerY - targetHeight / 2, bubbleBox.y, bubbleBox.y + bubbleBox.height - targetHeight);

    return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(targetWidth),
        height: Math.round(targetHeight),
    };
}

function shouldUseDetectedBubbleBox(block, bubbleBox, imageWidth, imageHeight) {
    const coords = block.coords;
    const compactLength = String(block.sourceText || "").replace(/\s+/g, "").length;
    const originalArea = coords.width * coords.height;
    const bubbleArea = bubbleBox.width * bubbleBox.height;
    const imageArea = Math.max(1, imageWidth * imageHeight);
    const containsText =
        bubbleBox.x <= coords.x + coords.width * 0.25 &&
        bubbleBox.y <= coords.y + coords.height * 0.25 &&
        bubbleBox.x + bubbleBox.width >= coords.x + coords.width * 0.75 &&
        bubbleBox.y + bubbleBox.height >= coords.y + coords.height * 0.75;
    const expansion = bubbleArea / Math.max(1, originalArea);
    const verticalSourceText = coords.height > coords.width * 1.15 && coords.width < 160;
    const horizontalDialogue = coords.width >= coords.height && compactLength >= 8;
    const needsMoreRoom = verticalSourceText || horizontalDialogue;
    const reasonableExpansion = bubbleArea >= originalArea * 1.05 && expansion <= 10 && bubbleArea / imageArea <= 0.14;

    return containsText && needsMoreRoom && reasonableExpansion;
}

function isMetadataText(compact) {
    return /^D\+\d+$/i.test(compact) || /^D\+\d+@?[\w.-]+$/i.test(compact) || /^@[\w.-]+$/i.test(compact);
}

function isLowQualityDecorativeBlock(block, compact, imageWidth, imageHeight) {
    const areaRatio = (block.coords.width * block.coords.height) / Math.max(1, imageWidth * imageHeight);
    const punctuationRatio = punctuationCount(compact) / Math.max(1, compact.length);
    const confidence = typeof block.confidence === "number" ? block.confidence : 1;
    const touchesPageEdge = block.coords.x <= 8 || block.coords.y <= 8 || block.coords.x + block.coords.width >= imageWidth - 8;
    const hugeEdgeBlock = touchesPageEdge && areaRatio > 0.08 && !isLikelySpeechBubble(block);
    const noisyLargeBlock = areaRatio > 0.045 && punctuationRatio > 0.22 && confidence < 0.92;
    const noisyLowConfidenceBlock = confidence < 0.82 && punctuationRatio > 0.2;
    const verticalArtworkNoise = block.direction === "vertical" && !block.style?.bubbleBox && areaRatio < 0.05 && confidence < 0.96;
    const coloredInkDialogueNoise =
        block.type === "dialogue" && !block.style?.bubbleBox && confidence < 0.96 && colorSaturation(block.style?.textColor) > 45;
    const tinyNonBubbleText = !block.style?.bubbleBox && compact.length <= 7 && block.coords.height < 24;
    const shortDecorativeText = compact.length <= 2 && !isLikelySpeechBubble(block);

    return (
        hugeEdgeBlock ||
        noisyLargeBlock ||
        noisyLowConfidenceBlock ||
        verticalArtworkNoise ||
        coloredInkDialogueNoise ||
        shortDecorativeText ||
        tinyNonBubbleText
    );
}

function hasDrawableTextSurface(block) {
    if (block.style?.bubbleBox) {
        return true;
    }

    if (!isLikelySpeechBubble(block)) {
        return false;
    }

    const coords = block.coords;
    const compactLength = String(block.sourceText || "").replace(/\s+/g, "").length;
    const enoughRoom = coords.width * coords.height >= 11000;

    return enoughRoom || compactLength >= 8;
}

function isTopEdgeVerticalSource(coords, bubbleBox) {
    return Boolean(bubbleBox) && bubbleBox.y <= 1 && coords.y < 24 && coords.height > coords.width * 1.1;
}

function isLikelySpeechBubble(block) {
    const background = hexToRgb(block.style?.background);

    if (!background) {
        return false;
    }

    const [r, g, b] = background;
    const brightness = (r + g + b) / 3;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);

    return brightness > 225 && saturation < 35;
}

function punctuationCount(text) {
    return [...text].filter((character) => !/\p{L}|\p{N}/u.test(character)).length;
}

function hexToRgb(hex) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));

    if (!match) {
        return null;
    }

    const value = Number.parseInt(match[1], 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function colorSaturation(hex) {
    const color = hexToRgb(hex);

    if (!color) {
        return 0;
    }

    return Math.max(...color) - Math.min(...color);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function normalizeRenderDirection(translatedDirection, sourceDirection, text, targetLanguage) {
    if (usesHorizontalTargetLayout(targetLanguage)) {
        return "horizontal";
    }

    if (translatedDirection === "horizontal" || translatedDirection === "vertical") {
        return translatedDirection;
    }

    if (!/[^\x00-\x7F]/.test(text)) {
        return "horizontal";
    }

    return sourceDirection || "horizontal";
}

function usesHorizontalTargetLayout(targetLanguage) {
    return ["ko", "en", "de", "sv"].includes(targetLanguage);
}

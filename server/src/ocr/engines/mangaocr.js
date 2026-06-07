import * as ort from "onnxruntime-node";
import { createCanvas } from "ppu-ocv/canvas";
import { fetchAndCacheModel } from "../../utils/model-cache.js";
import { HttpError } from "../../utils/http-error.js";

const LOG = "[MangoTL-OCR-MangaOcr]";

const SPECIAL_TOKENS = new Set(["[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]"]);

const modelPromises = new Map();

/**
 * Recognizes Japanese text inside detected boxes using manga-ocr.
 *
 * Detection (PaddleOCR) is reused; this engine only performs recognition:
 * each box is cropped and run through the manga-ocr vision-encoder /
 * text-decoder ONNX models via onnxruntime-node.
 *
 * Returns the raw recognition items shared with the PaddleOCR engine:
 *   [{ text, box, confidence }]
 */
export async function recognizeWithMangaOcr(detection, ocrEngineConfig) {
    const model = await getModel(ocrEngineConfig);
    const boxes = getRecognitionBoxes(detection);

    console.log(`${LOG} Recognizing ${boxes.length} regions...`);
    const start = Date.now();
    const results = [];

    for (let index = 0; index < boxes.length; index += 1) {
        const box = boxes[index];
        const crop = cropRegion(detection.canvas, box, model.imageSize);
        const { text, confidence } = await recognizeRegion(crop, model);
        console.log(`${LOG} Box ${index + 1}/${boxes.length}: "${text}" (confidence ${confidence.toFixed(3)})`);
        results.push({ text, box, confidence });
    }

    console.log(`${LOG} Completed ${boxes.length} regions in ${Date.now() - start}ms`);

    return results;
}

function getRecognitionBoxes(detection) {
    const sourceBoxes = detection.boxes.filter((box) => box.width > 0 && box.height > 0);
    const bubbleBoxes = detectLightBubbleTextBoxes(detection.canvas);
    const boxes = [...sourceBoxes];

    for (const bubbleBox of bubbleBoxes) {
        if (!boxes.some((box) => isSameRegion(box, bubbleBox))) {
            boxes.push(bubbleBox);
        }
    }

    return boxes;
}

function detectLightBubbleTextBoxes(canvas) {
    let ctx;

    try {
        ctx = canvas.getContext("2d");
    } catch {
        return [];
    }

    const width = canvas.width;
    const height = canvas.height;
    const imageArea = Math.max(1, width * height);
    const { data } = ctx.getImageData(0, 0, width, height);
    const visited = new Uint8Array(imageArea);
    const candidates = [];

    for (let seed = 0; seed < imageArea; seed += 1) {
        if (visited[seed] || !isLightNeutralPixel(data, seed)) {
            continue;
        }

        const component = floodLightComponent(data, width, height, seed, visited);
        const componentArea = component.width * component.height;
        const fillRatio = component.pixelIndexes.length / Math.max(1, componentArea);

        if (
            component.pixelIndexes.length < 450 ||
            component.width < 20 ||
            component.height < 20 ||
            componentArea / imageArea >= 0.09 ||
            fillRatio < 0.35
        ) {
            continue;
        }

        const textBox = getInteriorInkBox(data, width, height, component);

        if (textBox && isLikelyVerticalTextBox(textBox) && !candidates.some((candidate) => isSameRegion(candidate, textBox))) {
            candidates.push(textBox);
        }
    }

    return candidates;
}

function floodLightComponent(data, width, height, seed, visited) {
    const stack = [seed];
    const pixelIndexes = [];
    visited[seed] = 1;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    while (stack.length > 0) {
        const index = stack.pop();
        const x = index % width;
        const y = (index / width) | 0;
        pixelIndexes.push(index);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);

        for (const neighbor of [
            x > 0 ? index - 1 : -1,
            x < width - 1 ? index + 1 : -1,
            y > 0 ? index - width : -1,
            y < height - 1 ? index + width : -1,
        ]) {
            if (neighbor >= 0 && !visited[neighbor] && isLightNeutralPixel(data, neighbor)) {
                visited[neighbor] = 1;
                stack.push(neighbor);
            }
        }
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        pixelIndexes,
    };
}

function getInteriorInkBox(data, width, height, component) {
    const componentMask = new Set(component.pixelIndexes);
    const edgeInset = 7;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let inkPixels = 0;

    for (let y = component.y + edgeInset; y < component.y + component.height - edgeInset; y += 1) {
        for (let x = component.x + edgeInset; x < component.x + component.width - edgeInset; x += 1) {
            const index = y * width + x;

            if (!isDarkInkPixel(data, index) || !hasNearbyComponentPixel(componentMask, width, height, x, y)) {
                continue;
            }

            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            inkPixels += 1;
        }
    }

    if (inkPixels < 18 || maxX < minX || maxY < minY) {
        return null;
    }

    const padding = 4;
    const x = Math.max(0, minX - padding);
    const y = Math.max(0, minY - padding);

    return {
        x,
        y,
        width: Math.max(1, Math.min(width - x, maxX - minX + 1 + padding * 2)),
        height: Math.max(1, Math.min(height - y, maxY - minY + 1 + padding * 2)),
    };
}

function isLikelyVerticalTextBox(box) {
    return box.height > box.width * 1.15;
}

function hasNearbyComponentPixel(componentMask, width, height, x, y) {
    for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
            const xx = x + dx;
            const yy = y + dy;

            if (xx >= 0 && xx < width && yy >= 0 && yy < height && componentMask.has(yy * width + xx)) {
                return true;
            }
        }
    }

    return false;
}

function isLightNeutralPixel(data, index) {
    const offset = index * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const brightness = (r + g + b) / 3;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    return brightness > 246 && saturation < 18;
}

function isDarkInkPixel(data, index) {
    const offset = index * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const brightness = (r + g + b) / 3;
    const saturation = Math.max(r, g, b) - Math.min(r, g, b);
    return brightness < 110 && saturation < 80;
}

function isSameRegion(a, b) {
    const overlap = intersectionArea(a, b);
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const smallerArea = Math.min(areaA, areaB);
    const largerArea = Math.max(areaA, areaB);
    return smallerArea > 0 && overlap / smallerArea > 0.85 && largerArea / smallerArea < 1.4;
}

function intersectionArea(a, b) {
    const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
    const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
    return width * height;
}

async function getModel(config) {
    const cacheKey = getModelCacheKey(config);
    const cached = modelPromises.get(cacheKey);

    if (cached) {
        return cached;
    }

    const modelPromise = (async () => {
        const model = config.model || {};
        const repo = String(model.repo || "").replace(/\/+$/, "");

        if (!repo || !model.encoder || !model.decoder || !model.vocab) {
            throw new HttpError(500, "ocr_config_invalid", "Manga OCR model config is incomplete (repo/encoder/decoder/vocab required).");
        }

        console.log(`${LOG} Loading manga-ocr model (first run downloads the model, ~450MB)...`);
        const [encoderBuffer, decoderBuffer, vocabBuffer] = await Promise.all([
            fetchAndCacheModel(`${repo}/${model.encoder}`, `mangaocr-${model.encoder}`, LOG),
            fetchAndCacheModel(`${repo}/${model.decoder}`, `mangaocr-${model.decoder}`, LOG),
            fetchAndCacheModel(`${repo}/${model.vocab}`, `mangaocr-${model.vocab}`, LOG),
        ]);

        const [encoder, decoder] = await Promise.all([
            ort.InferenceSession.create(encoderBuffer, { executionProviders: ["cpu"] }),
            ort.InferenceSession.create(decoderBuffer, { executionProviders: ["cpu"] }),
        ]);

        const vocab = vocabBuffer
            .toString("utf-8")
            .split("\n")
            .map((token) => token.replace(/\r$/, ""));

        console.log(`${LOG} Model ready — encoder in:[${encoder.inputNames}] out:[${encoder.outputNames}]`);
        console.log(`${LOG} Model ready — decoder in:[${decoder.inputNames}] out:[${decoder.outputNames}], vocab:${vocab.length}`);

        const generation = config.generation || {};
        const image = config.image || {};

        return {
            encoder,
            decoder,
            vocab,
            io: resolveModelIo(encoder, decoder),
            decoderStartTokenId: generation.decoderStartTokenId ?? 2,
            eosTokenId: generation.eosTokenId ?? 3,
            maxLength: generation.maxLength ?? 128,
            imageSize: image.size ?? 224,
            mean: image.mean ?? 0.5,
            std: image.std ?? 0.5,
        };
    })();

    modelPromises.set(cacheKey, modelPromise);
    modelPromise.catch(() => modelPromises.delete(cacheKey));

    return modelPromise;
}

function getModelCacheKey(config) {
    const model = config.model || {};

    return JSON.stringify({
        repo: String(model.repo || "").replace(/\/+$/, ""),
        encoder: model.encoder || null,
        decoder: model.decoder || null,
        vocab: model.vocab || null,
        generation: config.generation || {},
        image: config.image || {},
    });
}

function resolveModelIo(encoder, decoder) {
    const encoderInput = encoder.inputNames.find((name) => /pixel|image|input/i.test(name)) || encoder.inputNames[0];
    const encoderOutput = encoder.outputNames.find((name) => /hidden|last/i.test(name)) || encoder.outputNames[0];

    const decoderInputIds =
        decoder.inputNames.find((name) => /input_ids|^ids$|tokens/i.test(name)) || decoder.inputNames.find((name) => !/encoder|mask/i.test(name));
    const decoderEncoderHidden = decoder.inputNames.find((name) => /encoder_hidden|hidden/i.test(name));
    const decoderEncoderMask = decoder.inputNames.find((name) => /attention_mask|encoder_attention/i.test(name));
    const decoderOutput = decoder.outputNames.find((name) => /logits|prediction/i.test(name)) || decoder.outputNames[0];

    if (!encoderInput || !encoderOutput || !decoderInputIds || !decoderEncoderHidden || !decoderOutput) {
        throw new HttpError(
            500,
            "ocr_boot_failed",
            `Could not resolve manga-ocr model I/O. encoder in:[${encoder.inputNames}] out:[${encoder.outputNames}], decoder in:[${decoder.inputNames}] out:[${decoder.outputNames}]`,
        );
    }

    return { encoderInput, encoderOutput, decoderInputIds, decoderEncoderHidden, decoderEncoderMask, decoderOutput };
}

async function recognizeRegion(cropCanvas, model) {
    const { io } = model;

    const pixelValues = canvasToPixelTensor(cropCanvas, model);
    const encoderOutput = await model.encoder.run({ [io.encoderInput]: pixelValues });
    const encoderHidden = encoderOutput[io.encoderOutput];

    const ids = [model.decoderStartTokenId];
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (let step = 0; step < model.maxLength; step += 1) {
        const inputIds = new ort.Tensor(
            "int64",
            BigInt64Array.from(ids, (value) => BigInt(value)),
            [1, ids.length],
        );
        const feeds = {
            [io.decoderInputIds]: inputIds,
            [io.decoderEncoderHidden]: encoderHidden,
        };

        if (io.decoderEncoderMask) {
            const maskLength = encoderHidden.dims[1];
            feeds[io.decoderEncoderMask] = new ort.Tensor("int64", new BigInt64Array(maskLength).fill(1n), [1, maskLength]);
        }

        const decoded = await model.decoder.run(feeds);
        const { tokenId, probability } = argmaxLastStep(decoded[io.decoderOutput]);

        confidenceSum += probability;
        confidenceCount += 1;

        if (tokenId === model.eosTokenId) {
            break;
        }

        ids.push(tokenId);
    }

    return {
        text: decodeTokens(ids.slice(1), model.vocab),
        confidence: confidenceCount ? confidenceSum / confidenceCount : 0,
    };
}

function cropRegion(sourceCanvas, box, size) {
    const sourceX = Math.max(0, Math.min(box.x, sourceCanvas.width - 1));
    const sourceY = Math.max(0, Math.min(box.y, sourceCanvas.height - 1));
    const sourceWidth = Math.max(1, Math.min(box.width, sourceCanvas.width - sourceX));
    const sourceHeight = Math.max(1, Math.min(box.height, sourceCanvas.height - sourceY));

    const canvas = createCanvas(size, size);
    canvas.getContext("2d").drawImage(sourceCanvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, size, size);
    return canvas;
}

function canvasToPixelTensor(canvas, model) {
    const size = model.imageSize;
    const data = canvas.getContext("2d").getImageData(0, 0, size, size).data;
    const plane = size * size;
    const tensor = new Float32Array(3 * plane);

    // (value / 255 - mean) / std  ==  value * scale - shift
    const scale = 1 / (255 * model.std);
    const shift = model.mean / model.std;

    for (let i = 0; i < plane; i += 1) {
        const pixel = i * 4;
        tensor[i] = data[pixel] * scale - shift;
        tensor[plane + i] = data[pixel + 1] * scale - shift;
        tensor[2 * plane + i] = data[pixel + 2] * scale - shift;
    }

    return new ort.Tensor("float32", tensor, [1, 3, size, size]);
}

function argmaxLastStep(logits) {
    const { dims, data } = logits;
    const vocabSize = dims[dims.length - 1];
    const sequenceLength = dims[dims.length - 2];
    const offset = (sequenceLength - 1) * vocabSize;

    let maxIndex = 0;
    let maxValue = data[offset];
    for (let v = 1; v < vocabSize; v += 1) {
        const value = data[offset + v];
        if (value > maxValue) {
            maxValue = value;
            maxIndex = v;
        }
    }

    // Softmax probability of the chosen token (numerically stable).
    let expSum = 0;
    for (let v = 0; v < vocabSize; v += 1) {
        expSum += Math.exp(data[offset + v] - maxValue);
    }

    return { tokenId: maxIndex, probability: expSum > 0 ? 1 / expSum : 0 };
}

function decodeTokens(tokenIds, vocab) {
    let text = "";

    for (const id of tokenIds) {
        const token = vocab[id];
        if (token === undefined || SPECIAL_TOKENS.has(token)) {
            continue;
        }
        text += token.startsWith("##") ? token.slice(2) : token;
    }

    return text.replace(/\s+/g, "").trim();
}

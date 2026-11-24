import * as ort from "onnxruntime-node";
import { cv, createCanvas, ImageProcessor } from "ppu-ocv";
import { fetchAndCacheModelPath } from "../../utils/model-cache.js";
import { createLamaModelPreset } from "../../ocr-models/presets.js";
import { getOcrModelManager } from "../../ocr-models/manager.js";
import { ortSessionOptions } from "../../utils/ort-options.js";

const SIZE = 512;
let sessionPromise = null;

async function getSession(preset) {
    if (!sessionPromise) {
        const promise = (async () => {
            // 경로 로드로 200MB 가중치를 mmap 처리해 메모리를 절약한다
            const modelPath = await fetchAndCacheModelPath(preset.files[0].url, preset.files[0].fileName, "[MangoTL-Inpaint]");
            const session = await ort.InferenceSession.create(modelPath, ortSessionOptions(4));
            getOcrModelManager().registerRuntime(preset.id, async () => {
                if (sessionPromise === promise) sessionPromise = null;
                if (typeof session.release === "function") await session.release();
            });
            return session;
        })();
        sessionPromise = promise;
        promise.catch(() => {
            if (sessionPromise === promise) sessionPromise = null;
        });
    }
    return sessionPromise;
}

function candidateFor(block) {
    const box = block.eraseCoords || block.coords;
    if (!box) return null;
    if (block.artCaption) {
        return {
            kind: "white-caption",
            region: {
                x: Math.round(box.x - 15),
                y: Math.round(box.y - 15),
                width: Math.round(box.width + 30),
                height: Math.round(box.height + 30),
            },
        };
    }
    if (block.confirmedRepeatedEffect || block.footstepEffect || block.insetHandwritten) {
        return {
            kind: "dark-lettering",
            region: { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) },
        };
    }
    return null;
}

function makeMask(imageData, region, cropX, cropY, kind) {
    const mask = cv.Mat.zeros(SIZE, SIZE, cv.CV_8UC1);
    const left = Math.max(0, region.x - cropX);
    const top = Math.max(0, region.y - cropY);
    const right = Math.min(SIZE, left + region.width);
    const bottom = Math.min(SIZE, top + region.height);
    for (let row = top; row < bottom; row += 1) {
        for (let column = left; column < right; column += 1) {
            const index = row * SIZE + column;
            const offset = index * 4;
            const red = imageData.data[offset];
            const green = imageData.data[offset + 1];
            const blue = imageData.data[offset + 2];
            const selected =
                kind === "white-caption"
                    ? Math.min(red, green, blue) > 235 && Math.max(red, green, blue) - Math.min(red, green, blue) < 20
                    : Math.max(red, green, blue) < 80;
            if (selected) mask.data[index] = 255;
        }
    }
    if (kind === "dark-lettering") {
        const seen = new Uint8Array(SIZE * SIZE);
        for (let origin = 0; origin < seen.length; origin += 1) {
            if (mask.data[origin] !== 255 || seen[origin]) continue;
            const queue = [origin];
            seen[origin] = 1;
            let minX = SIZE;
            let minY = SIZE;
            let maxX = 0;
            let maxY = 0;
            for (let cursor = 0; cursor < queue.length; cursor += 1) {
                const index = queue[cursor];
                const column = index % SIZE;
                const row = Math.floor(index / SIZE);
                minX = Math.min(minX, column);
                minY = Math.min(minY, row);
                maxX = Math.max(maxX, column);
                maxY = Math.max(maxY, row);
                for (const next of [index - 1, index + 1, index - SIZE, index + SIZE]) {
                    if (next < 0 || next >= seen.length || seen[next] || mask.data[next] !== 255 || Math.abs((next % SIZE) - column) > 1) continue;
                    seen[next] = 1;
                    queue.push(next);
                }
            }
            if (
                queue.length < 8 ||
                minX <= left + 2 ||
                maxX >= right - 3 ||
                minY <= top + 2 ||
                maxY >= bottom - 3 ||
                maxX - minX > 80 ||
                maxY - minY > 80
            ) {
                for (const index of queue) mask.data[index] = 0;
            }
        }
    }
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(kind === "dark-lettering" ? 19 : 7, kind === "dark-lettering" ? 19 : 7));
    const dilated = new cv.Mat();
    try {
        cv.findContours(mask, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        cv.drawContours(mask, contours, -1, new cv.Scalar(255), -1);
        cv.dilate(mask, dilated, kernel);
        return Uint8Array.from(dilated.data, (value) => (value > 0 ? 1 : 0));
    } finally {
        for (const resource of [mask, contours, hierarchy, kernel, dilated]) resource.delete();
    }
}

async function restoreOne(canvas, ctx, block, candidate, session) {
    const region = candidate.region;
    if (region.width > SIZE - 24 || region.height > SIZE - 24) return false;
    const cropX = Math.max(0, Math.min(canvas.width - SIZE, Math.round(region.x + region.width / 2 - SIZE / 2)));
    const cropY = Math.max(0, Math.min(canvas.height - SIZE, Math.round(region.y + region.height / 2 - SIZE / 2)));
    const crop = createCanvas(SIZE, SIZE);
    const cropCtx = crop.getContext("2d");
    cropCtx.drawImage(canvas, cropX, cropY, SIZE, SIZE, 0, 0, SIZE, SIZE);
    const image = cropCtx.getImageData(0, 0, SIZE, SIZE);
    const mask = makeMask(image, region, cropX, cropY, candidate.kind);
    if (mask.reduce((sum, value) => sum + value, 0) < 100) return false;
    const input = new Float32Array(3 * SIZE * SIZE);
    const maskInput = new Float32Array(SIZE * SIZE);
    for (let index = 0; index < SIZE * SIZE; index += 1) {
        for (let channel = 0; channel < 3; channel += 1) input[channel * SIZE * SIZE + index] = image.data[index * 4 + channel] / 255;
        maskInput[index] = mask[index];
    }
    const output = await session.run({
        image: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]),
        mask: new ort.Tensor("float32", maskInput, [1, 1, SIZE, SIZE]),
    });
    const pixels = output[session.outputNames[0]].data;
    for (let index = 0; index < SIZE * SIZE; index += 1) {
        if (!mask[index]) continue;
        for (let channel = 0; channel < 3; channel += 1) image.data[index * 4 + channel] = pixels[channel * SIZE * SIZE + index];
    }
    cropCtx.putImageData(image, 0, 0);
    ctx.drawImage(crop, region.x - cropX, region.y - cropY, region.width, region.height, region.x, region.y, region.width, region.height);
    return true;
}

export function findDetailedTextRegionIds(canvas, blocks) {
    if (canvas.width < SIZE || canvas.height < SIZE) return new Set();
    return new Set(blocks.filter((block) => candidateFor(block)).map((block) => block.id));
}

export async function restoreDetailedTextRegions(canvas, blocks, sourceCanvas = canvas) {
    if (sourceCanvas.width < SIZE || sourceCanvas.height < SIZE) return new Set();
    const ctx = canvas.getContext("2d");
    const candidates = blocks.map((block) => ({ block, candidate: candidateFor(block) })).filter((entry) => entry.candidate);
    if (candidates.length === 0) return new Set();
    const restored = new Set();
    const preset = createLamaModelPreset();
    try {
        await getOcrModelManager().runWithPreset(preset, async () => {
            await ImageProcessor.initRuntime();
            const session = await getSession(preset);
            for (const { block, candidate } of candidates) {
                try {
                    if (await restoreOne(sourceCanvas, ctx, block, candidate, session)) {
                        restored.add(block.id);
                    }
                } catch (error) {
                    console.warn(`[MangoTL-Inpaint] Detailed restoration failed for ${block.id}: ${error.message}`);
                }
            }
        });
    } catch (error) {
        console.warn(`[MangoTL-Inpaint] Model unavailable, using local repair: ${error.message}`);
    }
    return restored;
}

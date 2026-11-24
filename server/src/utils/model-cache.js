import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cacheRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.ocr-cache");
const inFlight = new Map();

export function modelCacheFileName(prefix, url) {
    return sanitizeFileName(`${prefix}-${modelUrlHash(url)}-${modelUrlBasename(url)}`);
}

export function modelUrlHash(url) {
    return createHash("sha256").update(url).digest("hex").slice(0, 12);
}

function modelUrlBasename(url) {
    try {
        return new URL(url).pathname.split("/").pop() || "model";
    } catch {
        return "model";
    }
}

/**
 * 모델 리소스를 다운로드해 server/.ocr-cache에 캐시한다.
 * 같은 파일에 대한 동시 요청은 하나의 다운로드를 공유한다.
 */
export async function fetchAndCacheModel(url, fileName, logPrefix = "[MangoTL-OCR]") {
    const cachePath = await ensureCachedModel(url, fileName, logPrefix);
    return readFile(cachePath);
}

/**
 * 모델이 캐시된 파일 경로만 반환한다. ONNX Runtime 세션은 경로로 생성해야
 * 가중치가 mmap로 올라가 Buffer 복사분만큼 메모리가 절약된다.
 */
export function fetchAndCacheModelPath(url, fileName, logPrefix = "[MangoTL-OCR]") {
    return ensureCachedModel(url, fileName, logPrefix);
}

async function ensureCachedModel(url, fileName, logPrefix) {
    const cachePath = path.join(cacheRoot, sanitizeFileName(fileName));

    if (existsSync(cachePath)) {
        console.log(`${logPrefix} Using cached model: ${fileName}`);
        return cachePath;
    }

    const pending = inFlight.get(cachePath);
    if (pending) {
        await pending;
        return cachePath;
    }

    const download = (async () => {
        console.log(`${logPrefix} Downloading model: ${fileName}`);
        console.log(`${logPrefix} Source: ${url}`);

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download model from ${url} (HTTP ${response.status})`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());

        if (!existsSync(cacheRoot)) {
            mkdirSync(cacheRoot, { recursive: true });
        }

        const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;

        try {
            await writeFile(tempPath, buffer);
            await rename(tempPath, cachePath);
        } catch (error) {
            await unlink(tempPath).catch(() => {});
            throw error;
        }

        console.log(`${logPrefix} Cached model: ${cachePath} (${buffer.byteLength} bytes)`);
    })();

    inFlight.set(cachePath, download);
    try {
        await download;
    } finally {
        inFlight.delete(cachePath);
    }
    return cachePath;
}

function sanitizeFileName(fileName) {
    return path.basename(String(fileName || "model")).replace(/[^\w.-]/g, "_") || "model";
}

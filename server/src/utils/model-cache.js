import { existsSync, mkdirSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cacheRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.ocr-cache");
const inFlight = new Map();

/**
 * Downloads a model resource and caches it under server/.ocr-cache.
 * Concurrent requests for the same file share a single download.
 */
export async function fetchAndCacheModel(url, fileName, logPrefix = "[MangoTL-OCR]") {
    const cachePath = path.join(cacheRoot, sanitizeFileName(fileName));

    if (existsSync(cachePath)) {
        console.log(`${logPrefix} Using cached model: ${fileName}`);
        return readFile(cachePath);
    }

    const pending = inFlight.get(cachePath);
    if (pending) {
        return pending;
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
        return buffer;
    })();

    inFlight.set(cachePath, download);
    download.then(
        () => inFlight.delete(cachePath),
        () => inFlight.delete(cachePath),
    );
    return download;
}

function sanitizeFileName(fileName) {
    return path.basename(String(fileName || "model")).replace(/[^\w.-]/g, "_") || "model";
}

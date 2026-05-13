import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cacheVersion = 1;
const cacheRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.image-cache");

export async function clearImageResultCache(logPrefix = "[MangoTL]") {
    await rm(cacheRoot, { recursive: true, force: true });
    await mkdir(cacheRoot, { recursive: true });
    console.log(`${logPrefix} Cleared image result cache: ${cacheRoot}`);
}

export function createImageResultCacheKey({ imageUrl, request, provider, detectionEngine, ocrEngine }) {
    const keyPayload = {
        version: cacheVersion,
        imageUrl,
        sourceLanguage: request.sourceLanguage,
        targetLanguage: request.targetLanguage,
        dryRun: Boolean(request.dryRun),
        providerId: request.dryRun ? null : provider?.id || null,
        model: request.dryRun ? null : provider?.defaultModel || null,
        detectionEngineId: detectionEngine?.id || null,
        ocrEngineId: ocrEngine?.id || null,
    };

    return createHash("sha256").update(JSON.stringify(keyPayload)).digest("hex");
}

export async function readCachedImageResult(cacheKey) {
    try {
        const raw = await readFile(getCachePath(cacheKey), "utf8");
        const payload = JSON.parse(raw);

        if (payload?.version !== cacheVersion || !payload.result) {
            return null;
        }

        return payload.result;
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }

        console.warn("[MangoTL] Ignoring unreadable image cache entry:", error.message);
        return null;
    }
}

export async function writeCachedImageResult(cacheKey, result) {
    await mkdir(cacheRoot, { recursive: true });

    const cachePath = getCachePath(cacheKey);
    const tempPath = `${cachePath}.${process.pid}.${randomUUID()}.tmp`;
    const payload = JSON.stringify({
        version: cacheVersion,
        result,
    });

    try {
        await writeFile(tempPath, payload);
        await rename(tempPath, cachePath);
    } catch (error) {
        await unlink(tempPath).catch(() => {});
        throw error;
    }
}

function getCachePath(cacheKey) {
    return path.join(cacheRoot, `${cacheKey}.json`);
}

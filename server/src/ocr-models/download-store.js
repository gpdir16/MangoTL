import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { HttpError } from "../utils/http-error.js";

const cacheRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.ocr-cache");

export async function inspectModelFiles(files) {
    let complete = files.length > 0;
    let hasPartial = false;
    let finalBytes = 0;
    let partialBytes = 0;

    for (const file of files) {
        const finalInfo = await fileStat(path.join(cacheRoot, file.fileName));
        const partialInfo = await fileStat(path.join(cacheRoot, `${file.fileName}.part`));
        if (finalInfo) {
            finalBytes += finalInfo.size;
        } else {
            complete = false;
        }
        if (!finalInfo && partialInfo) {
            hasPartial = true;
            partialBytes += partialInfo.size;
        }
    }

    return { complete, hasPartial, finalBytes, partialBytes };
}

export async function downloadModelFiles(files, { signal, onProgress }) {
    if (!files.length) throw new HttpError(500, "ocr_model_files_missing", "The OCR model preset has no downloadable files.");
    await mkdir(cacheRoot, { recursive: true });

    for (const file of files) {
        const finalPath = path.join(cacheRoot, file.fileName);
        const partialPath = `${finalPath}.part`;
        const finalInfo = await fileStat(finalPath);
        if (finalInfo) {
            onProgress(file.fileName, finalInfo.size, finalInfo.size);
            continue;
        }

        let resumed = (await fileStat(partialPath))?.size || 0;
        validateRemoteUrl(file.url);
        let response = await fetch(file.url, {
            headers: resumed > 0 ? { Range: `bytes=${resumed}-` } : undefined,
            signal,
        });

        if (response.status === 416 && resumed > 0) {
            await unlink(partialPath).catch(() => {});
            resumed = 0;
            response = await fetch(file.url, { signal });
        }

        if (!response.ok || !response.body) {
            throw new HttpError(502, "ocr_model_download_failed", `Model download failed with HTTP ${response.status}: ${file.url}`);
        }

        if (resumed > 0 && response.status !== 206) resumed = 0;
        const total = responseTotal(response, resumed);
        onProgress(file.fileName, resumed, total);
        let done = resumed;
        const progress = new Transform({
            transform(chunk, encoding, callback) {
                done += chunk.length;
                onProgress(file.fileName, done, total);
                callback(null, chunk);
            },
        });

        await pipeline(Readable.fromWeb(response.body), progress, createWriteStream(partialPath, { flags: resumed > 0 ? "a" : "w" }));
        await rename(partialPath, finalPath);
        const written = await stat(finalPath);
        onProgress(file.fileName, written.size, written.size);
    }
}

export async function deleteModelFiles(files) {
    let deleted = false;
    for (const file of files) {
        for (const filePath of [path.join(cacheRoot, file.fileName), path.join(cacheRoot, `${file.fileName}.part`)]) {
            try {
                await unlink(filePath);
                deleted = true;
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
        }
    }
    return deleted;
}

async function fileStat(filePath) {
    try {
        const info = await stat(filePath);
        return info.isFile() ? info : null;
    } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
    }
}

function responseTotal(response, resumed) {
    const range = response.headers.get("content-range");
    const match = range ? /\/(\d+)$/.exec(range) : null;
    if (match) return Number(match[1]);
    const rawLength = response.headers.get("content-length");
    if (rawLength === null) return null;
    const length = Number(rawLength);
    return Number.isFinite(length) && length >= 0 ? resumed + length : null;
}

function validateRemoteUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new HttpError(500, "ocr_model_url_invalid", "OCR model downloads must use HTTP or HTTPS.");
    }
}

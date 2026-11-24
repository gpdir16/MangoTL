import { readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearImageResultCache } from "../utils/image-result-cache.js";
import { HttpError } from "../utils/http-error.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ocrCacheRoot = path.join(serverRoot, ".ocr-cache");
const STORAGE = [
    { id: "image-cache", path: path.join(serverRoot, ".image-cache"), clearable: true },
    { id: "settings", path: path.join(serverRoot, "secrets"), clearable: false },
];

export async function listStorageUsage() {
    const [storageEntries, resources] = await Promise.all([
        Promise.all(
            STORAGE.map(async (entry) => {
                const usage = await directoryUsage(entry.path);
                return { id: entry.id, path: path.relative(serverRoot, entry.path), clearable: entry.clearable, ...usage };
            }),
        ),
        listCacheResources(),
    ]);
    return [...storageEntries, ...resources];
}

export async function clearStorageCache(target) {
    if (target === "image-cache") {
        await clearImageResultCache();
        return { ok: true, id: target };
    }

    const resource = (await listCacheResources()).find((entry) => entry.id === target && entry.clearable);
    if (!resource) {
        throw new HttpError(400, "invalid_storage_target", `Storage entry cannot be cleared: ${target || "(none)"}.`);
    }

    await unlink(path.join(ocrCacheRoot, resource.fileName));
    return { ok: true, id: resource.id };
}

async function listCacheResources() {
    let entries;
    try {
        entries = await readdir(ocrCacheRoot, { withFileTypes: true });
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }

    const resources = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (!entry.isFile() || entry.isSymbolicLink() || isManagedModelFile(entry.name)) continue;
        const filePath = path.join(ocrCacheRoot, entry.name);
        const info = await stat(filePath);
        resources.push({
            id: `resource:${entry.name}`,
            name: entry.name.startsWith("font-") ? fontName(entry.name) : entry.name,
            path: path.relative(serverRoot, filePath),
            clearable: true,
            files: 1,
            bytes: info.size,
            fileName: entry.name,
        });
    }
    return resources;
}

function isManagedModelFile(fileName) {
    return /^(?:paddle-(?:det|rec|dict)-|lama_fp32\.onnx(?:\.part)?$)/.test(fileName);
}

function fontName(fileName) {
    return fileName
        .replace(/^font-/, "")
        .replace(/\.[^.]+$/, "")
        .replace("CJKkr", "CJK KR")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("-", " ");
}

async function directoryUsage(directory) {
    let files = 0;
    let bytes = 0;

    async function visit(current) {
        let entries;
        try {
            entries = await readdir(current, { withFileTypes: true });
        } catch (error) {
            if (error.code === "ENOENT") return;
            throw error;
        }

        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) {
                await visit(fullPath);
            } else if (entry.isFile()) {
                files += 1;
                const info = await stat(fullPath);
                bytes += info.size;
            }
        }
    }

    await visit(directory);
    return { files, bytes };
}

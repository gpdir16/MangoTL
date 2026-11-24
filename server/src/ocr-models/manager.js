import { createOcrModelPresets } from "./presets.js";
import { deleteModelFiles, downloadModelFiles, inspectModelFiles } from "./download-store.js";
import { HttpError } from "../utils/http-error.js";

let sharedManager = null;

export function getOcrModelManager(staticConfig) {
    if (!sharedManager) sharedManager = createOcrModelManager();
    if (staticConfig) sharedManager.registerPresets(createOcrModelPresets(staticConfig));
    return sharedManager;
}

export function createOcrModelManager() {
    const presets = new Map();
    const downloads = new Map();
    const runtimes = new Map();
    const operations = new Map();
    const activeTranslations = new Map();
    const loading = new Set();
    const errors = new Map();

    function registerPresets(entries) {
        for (const preset of entries) {
            const current = presets.get(preset.id);
            presets.set(preset.id, {
                ...preset,
                supportedLanguages: [...new Set([...(current?.supportedLanguages || []), ...(preset.supportedLanguages || [])])],
            });
        }
    }

    async function listLocalModels() {
        return Promise.all(
            [...presets.values()].map(async (preset) => {
                const usage = await inspectModelFiles(preset.files);
                const task = downloads.get(preset.id);
                const status = task
                    ? "downloading"
                    : loading.has(preset.id)
                      ? "loading"
                      : runtimes.has(preset.id)
                        ? "loaded"
                        : errors.has(preset.id)
                          ? "failed"
                          : usage.complete
                            ? "unloaded"
                            : usage.hasPartial || usage.finalBytes > 0
                              ? "incomplete"
                              : "not_downloaded";
                const { files, ...publicPreset } = preset;
                return {
                    ...publicPreset,
                    downloadBytes: usage.finalBytes,
                    status,
                    done: task?.done ?? usage.finalBytes + usage.partialBytes,
                    total: task?.total ?? null,
                    active: activeCount(preset.id) > 0,
                    error: errors.get(preset.id) || null,
                };
            }),
        );
    }

    async function startDownload(presetId) {
        const preset = requirePreset(presetId);
        await waitForOperations(preset.id);
        ensureDownloadTask(preset);
        return { accepted: true };
    }

    async function cancelDownload(presetId) {
        const preset = requirePreset(presetId);
        return runExclusive(preset.id, async () => {
            assertIdle(preset.id);
            await cancelTask(preset.id);
            return { success: true };
        });
    }

    async function unloadPreset(presetId) {
        const preset = requirePreset(presetId);
        return runExclusive(preset.id, async () => {
            assertIdle(preset.id);
            await unloadRuntime(preset.id);
            return { success: true };
        });
    }

    async function deletePreset(presetId) {
        const preset = requirePreset(presetId);
        return runExclusive(preset.id, async () => {
            assertIdle(preset.id);
            await cancelTask(preset.id);
            await unloadRuntime(preset.id);
            const deleted = await deleteModelFiles(preset.files);
            errors.delete(preset.id);
            return { deleted };
        });
    }

    async function runWithPreset(presetOrId, callback) {
        const preset = typeof presetOrId === "string" ? requirePreset(presetOrId) : presetOrId;
        registerPresets([preset]);
        await waitForOperations(preset.id);
        activeTranslations.set(preset.id, activeCount(preset.id) + 1);
        loading.add(preset.id);
        errors.delete(preset.id);

        try {
            const usage = await inspectModelFiles(preset.files);
            if (!usage.complete) await ensureDownloadTask(preset).promise;
            return await callback();
        } catch (error) {
            if (error.code !== "ocr_model_download_cancelled") errors.set(preset.id, error.message);
            throw error;
        } finally {
            loading.delete(preset.id);
            const remaining = activeCount(preset.id) - 1;
            if (remaining > 0) activeTranslations.set(preset.id, remaining);
            else activeTranslations.delete(preset.id);
        }
    }

    function registerRuntime(presetId, unload) {
        runtimes.set(presetId, { unload });
        errors.delete(presetId);
    }

    function ensureDownloadTask(preset) {
        const current = downloads.get(preset.id);
        if (current) return current;

        const task = {
            controller: new AbortController(),
            promise: null,
            done: 0,
            total: null,
            progress: new Map(),
        };
        downloads.set(preset.id, task);
        task.promise = downloadModelFiles(preset.files, {
            signal: task.controller.signal,
            onProgress: (fileName, done, total) => updateProgress(task, preset.files, fileName, done, total),
        });
        task.promise.then(
            () => {
                errors.delete(preset.id);
                finishDownload(preset.id, task);
            },
            (error) => {
                if (task.controller.signal.aborted || error.name === "AbortError") {
                    errors.delete(preset.id);
                } else {
                    errors.set(preset.id, error.message);
                }
                finishDownload(preset.id, task);
            },
        );
        return task;
    }

    function finishDownload(presetId, task) {
        if (downloads.get(presetId) === task) downloads.delete(presetId);
    }

    async function cancelTask(presetId) {
        const task = downloads.get(presetId);
        if (!task) return;
        task.controller.abort();
        await task.promise.catch(() => {});
    }

    async function unloadRuntime(presetId) {
        const runtime = runtimes.get(presetId);
        if (!runtime) return;
        await runtime.unload();
        runtimes.delete(presetId);
    }

    async function waitForOperations(presetId) {
        while (operations.has(presetId)) await operations.get(presetId).catch(() => {});
    }

    async function runExclusive(presetId, callback) {
        const previous = operations.get(presetId) || Promise.resolve();
        const current = previous.catch(() => {}).then(callback);
        operations.set(presetId, current);
        try {
            return await current;
        } finally {
            if (operations.get(presetId) === current) operations.delete(presetId);
        }
    }

    function requirePreset(presetId) {
        const preset = presets.get(presetId);
        if (!preset) throw new HttpError(400, "invalid_local_model", `Unknown local model preset: "${presetId}".`);
        return preset;
    }

    function assertIdle(presetId) {
        if (activeCount(presetId) > 0) throw new HttpError(409, "local_model_busy", `Local model is currently translating: ${presetId}.`);
    }

    function activeCount(presetId) {
        return activeTranslations.get(presetId) || 0;
    }

    return {
        registerPresets,
        registerRuntime,
        listLocalModels,
        startDownload,
        cancelDownload,
        unloadPreset,
        deletePreset,
        runWithPreset,
        hasPreset: (presetId) => presets.has(presetId),
    };
}

function updateProgress(task, files, fileName, done, total) {
    task.progress.set(fileName, { done, total });
    task.done = [...task.progress.values()].reduce((sum, file) => sum + file.done, 0);
    task.total = files.every((file) => Number.isFinite(task.progress.get(file.fileName)?.total))
        ? [...task.progress.values()].reduce((sum, file) => sum + file.total, 0)
        : null;
}

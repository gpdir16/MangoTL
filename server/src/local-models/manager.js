import { ensureLocalRuntime } from "./runtime.js";
import {
    cancelRouterDownload,
    deleteRouterModel,
    listRouterModels,
    loadRouterModel,
    normalizeRouterModel,
    startRouterDownload,
    unloadRouterModel,
} from "./router-client.js";
import { assertLocalModelLanguages, listLocalModelPresets, requireLocalModelPreset } from "./presets.js";
import { HttpError } from "../utils/http-error.js";

const DEFAULT_ROUTER = {
    listRouterModels,
    startRouterDownload,
    cancelRouterDownload,
    loadRouterModel,
    unloadRouterModel,
    deleteRouterModel,
};
const managers = new Map();
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function getLocalModelManager(provider) {
    if (!managers.has(provider.id)) {
        managers.set(provider.id, createLocalModelManager({ provider }));
    }
    return managers.get(provider.id);
}

export function resetLocalModelManagersForTests() {
    managers.clear();
}

export function createLocalModelManager({
    provider,
    runtimeImpl = ensureLocalRuntime,
    routerImpl = DEFAULT_ROUTER,
    waitImpl = wait,
    nowImpl = Date.now,
    pollIntervalMs = 2000,
    downloadTimeoutMs = 3600000,
    loadTimeoutMs = 300000,
}) {
    const downloads = new Map();
    const cancelledDownloads = new Set();
    const operations = new Map();
    const activeTranslations = new Map();
    const errors = new Map();
    let runtimeOperation = Promise.resolve();

    async function listLocalModels() {
        const { baseUrl } = await runtimeImpl();
        const entries = await routerImpl.listRouterModels({ baseUrl });
        const byModel = new Map(entries.map((entry) => [String(entry.id), normalizeRouterModel(entry)]));

        return listLocalModelPresets(provider).map((preset) => {
            const current = byModel.get(preset.model);
            return {
                ...preset,
                status: current?.status || "not_downloaded",
                done: current?.done || 0,
                total: current?.total ?? null,
                active: activeCount(preset.id) > 0,
                error: errors.get(preset.id) || null,
            };
        });
    }

    async function startDownload(presetId) {
        const preset = requireLocalModelPreset(provider, presetId);
        await waitForOperations(preset.id);
        if (cancelledDownloads.has(preset.id)) {
            const pending = downloads.get(preset.id);
            if (pending) {
                await pending.catch(() => {});
            }
            cancelledDownloads.delete(preset.id);
        }
        ensureDownloadTask(preset, true);
        return { accepted: true };
    }

    async function cancelDownload(presetId) {
        const preset = requireLocalModelPreset(provider, presetId);
        assertIdle(preset.id);
        const pending = downloads.get(preset.id);
        if (pending) {
            cancelledDownloads.add(preset.id);
        }
        return runExclusive(preset.id, async () => {
            const { baseUrl } = await runtimeImpl();
            const current = await getNormalized(baseUrl, preset.model);
            if (current?.status === "downloading") {
                assertIdle(preset.id);
                cancelledDownloads.add(preset.id);
                await routerImpl.cancelRouterDownload({ baseUrl, model: preset.model });
            }
            return { success: true };
        }).then(async (result) => {
            if (pending) {
                await pending.catch(() => {});
            }
            return result;
        });
    }

    async function unloadPreset(presetId) {
        const preset = requireLocalModelPreset(provider, presetId);
        assertIdle(preset.id);
        return runExclusive(preset.id, () =>
            runRuntimeExclusive(async () => {
                const { baseUrl } = await runtimeImpl();
                const current = await getNormalized(baseUrl, preset.model);
                if (current && ["loading", "loaded", "sleeping"].includes(current.status)) {
                    assertIdle(preset.id);
                    return routerImpl.unloadRouterModel({ baseUrl, model: preset.model });
                }
                return { success: true };
            }),
        );
    }

    async function deletePreset(presetId) {
        const preset = requireLocalModelPreset(provider, presetId);
        assertIdle(preset.id);
        if (downloads.has(preset.id)) {
            cancelledDownloads.add(preset.id);
        }
        return runExclusive(preset.id, () =>
            runRuntimeExclusive(async () => {
                const pending = downloads.get(preset.id);
                if (pending) {
                    cancelledDownloads.add(preset.id);
                }
                const { baseUrl } = await runtimeImpl();
                let current = await getNormalized(baseUrl, preset.model);

                if (current?.status === "downloading") {
                    assertIdle(preset.id);
                    cancelledDownloads.add(preset.id);
                    await routerImpl.cancelRouterDownload({ baseUrl, model: preset.model });
                } else if (current && ["loading", "loaded", "sleeping", "failed"].includes(current.status)) {
                    assertIdle(preset.id);
                    await routerImpl.unloadRouterModel({ baseUrl, model: preset.model });
                }

                if (pending) {
                    await pending.catch(() => {});
                }
                await waitForDeletableState(baseUrl, preset);
                current = await getNormalized(baseUrl, preset.model);
                if (!current) {
                    errors.delete(preset.id);
                    return { deleted: false };
                }

                assertIdle(preset.id);
                const result = await routerImpl.deleteRouterModel({ baseUrl, model: preset.model });
                errors.delete(preset.id);
                return result;
            }),
        );
    }

    async function ensurePresetReady(presetId) {
        const preset = requireLocalModelPreset(provider, presetId);
        const { baseUrl, current: downloaded } = await ensureDownloaded(preset);
        let current = downloaded;

        if (["loaded", "sleeping"].includes(current.status)) {
            return { preset, baseUrl, current };
        }

        if (current.status === "unloaded") {
            current = await getNormalized(baseUrl, preset.model);
            if (!["loaded", "sleeping", "loading"].includes(current?.status)) {
                if (current?.failed) {
                    throw failure("local_model_load_failed", `Local model failed to load: ${preset.id}.`);
                }
                await routerImpl.loadRouterModel({ baseUrl, model: preset.model });
            }
        }

        current = await waitForState({
            baseUrl,
            preset,
            kind: "load",
            accept: (entry) => ["loaded", "sleeping"].includes(entry?.status),
        });
        return { preset, baseUrl, current };
    }

    async function runWithPreset(presetId, { sourceLanguage, targetLanguage }, callback) {
        const preset = requireLocalModelPreset(provider, presetId);
        assertLocalModelLanguages(preset, sourceLanguage, targetLanguage);
        return runExclusive(preset.id, () =>
            runRuntimeExclusive(async () => {
                activeTranslations.set(preset.id, activeCount(preset.id) + 1);

                try {
                    const { baseUrl } = await ensurePresetReady(preset.id);
                    return await callback({ preset, baseUrl });
                } finally {
                    const remaining = activeCount(preset.id) - 1;
                    if (remaining > 0) {
                        activeTranslations.set(preset.id, remaining);
                    } else {
                        activeTranslations.delete(preset.id);
                    }
                }
            }),
        );
    }

    function ensureDownloadTask(preset, retryFailed) {
        if (downloads.has(preset.id)) {
            return downloads.get(preset.id);
        }

        const task = downloadAndWait(preset, retryFailed);
        downloads.set(preset.id, task);
        task.then(
            () => {
                errors.delete(preset.id);
                finishDownload(preset.id, task);
            },
            (error) => {
                if (error.code === "local_model_download_cancelled") {
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
        if (downloads.get(presetId) === task) {
            downloads.delete(presetId);
        }
        cancelledDownloads.delete(presetId);
    }

    function assertDownloadNotCancelled(preset) {
        if (cancelledDownloads.has(preset.id)) {
            throw new HttpError(409, "local_model_download_cancelled", `Local model download was cancelled: ${preset.id}.`);
        }
    }

    async function ensureDownloaded(preset) {
        errors.delete(preset.id);
        if (cancelledDownloads.has(preset.id)) {
            const pending = downloads.get(preset.id);
            if (pending) {
                await pending.catch(() => {});
            }
            cancelledDownloads.delete(preset.id);
        }
        return ensureDownloadTask(preset, false);
    }

    async function downloadAndWait(preset, retryFailed) {
        assertDownloadNotCancelled(preset);
        const { baseUrl } = await runtimeImpl();
        assertDownloadNotCancelled(preset);
        let current = await getNormalized(baseUrl, preset.model);

        if (current?.failed && !retryFailed) {
            throw failure("local_model_download_failed", `Local model download failed: ${preset.id}.`);
        }

        if (isDownloaded(current)) {
            return { baseUrl, current };
        }

        if (current?.status !== "downloading") {
            current = await getNormalized(baseUrl, preset.model);
            if (!isDownloaded(current) && current?.status !== "downloading") {
                if (current?.failed && !retryFailed) {
                    throw failure("local_model_download_failed", `Local model download failed: ${preset.id}.`);
                }
                assertDownloadNotCancelled(preset);
                await routerImpl.startRouterDownload({ baseUrl, model: preset.model });
                if (cancelledDownloads.has(preset.id)) {
                    current = await getNormalized(baseUrl, preset.model);
                    if (current?.status === "downloading") {
                        await routerImpl.cancelRouterDownload({ baseUrl, model: preset.model });
                    }
                    assertDownloadNotCancelled(preset);
                }
            }
        }

        current = await waitForState({
            baseUrl,
            preset,
            kind: "download",
            accept: isDownloaded,
        });
        return { baseUrl, current };
    }

    async function waitForState({ baseUrl, preset, kind, accept }) {
        const deadline = nowImpl() + (kind === "download" ? downloadTimeoutMs : loadTimeoutMs);

        while (true) {
            const current = await getNormalized(baseUrl, preset.model);
            if (accept(current)) {
                return current;
            }
            if (current?.failed) {
                throw failure(
                    kind === "download" ? "local_model_download_failed" : "local_model_load_failed",
                    `Local model ${kind} failed: ${preset.id}.`,
                );
            }
            if (kind === "download" && !current) {
                throw new HttpError(409, "local_model_download_cancelled", `Local model download was cancelled: ${preset.id}.`);
            }
            if (kind === "download" && current.status === "incomplete" && cancelledDownloads.has(preset.id)) {
                throw new HttpError(409, "local_model_download_cancelled", `Local model download was cancelled: ${preset.id}.`);
            }
            if (nowImpl() >= deadline) {
                throw new HttpError(504, `local_model_${kind}_timeout`, `Timed out waiting for local model ${kind}: ${preset.id}.`);
            }
            await waitImpl(pollIntervalMs);
        }
    }

    async function waitForDeletableState(baseUrl, preset) {
        const deadline = nowImpl() + loadTimeoutMs;
        while (true) {
            const current = await getNormalized(baseUrl, preset.model);
            if (!current || ["incomplete", "unloaded"].includes(current.status)) {
                return;
            }
            if (nowImpl() >= deadline) {
                throw new HttpError(504, "local_model_unload_timeout", `Timed out waiting for local model unload: ${preset.id}.`);
            }
            await waitImpl(pollIntervalMs);
        }
    }

    async function getNormalized(baseUrl, model) {
        const entries = await routerImpl.listRouterModels({ baseUrl });
        const entry = entries.find((candidate) => String(candidate.id) === model);
        return entry ? normalizeRouterModel(entry) : null;
    }

    async function waitForOperations(presetId) {
        while (operations.has(presetId)) {
            await operations.get(presetId).catch(() => {});
        }
    }

    async function runRuntimeExclusive(callback) {
        const current = runtimeOperation.catch(() => {}).then(callback);
        runtimeOperation = current;
        return current;
    }

    async function runExclusive(presetId, callback) {
        const previous = operations.get(presetId) || Promise.resolve();
        const current = previous.catch(() => {}).then(callback);
        operations.set(presetId, current);
        try {
            return await current;
        } finally {
            if (operations.get(presetId) === current) {
                operations.delete(presetId);
            }
        }
    }

    function assertIdle(presetId) {
        if (activeCount(presetId) > 0) {
            throw new HttpError(409, "local_model_busy", `Local model is currently translating: ${presetId}.`);
        }
    }

    function activeCount(presetId) {
        return activeTranslations.get(presetId) || 0;
    }

    return {
        listLocalModels,
        startDownload,
        cancelDownload,
        unloadPreset,
        deletePreset,
        ensurePresetReady,
        runWithPreset,
        hasPreset: (presetId) => listLocalModelPresets(provider).some((preset) => preset.id === presetId),
    };
}

function isDownloaded(entry) {
    return Boolean(entry && ["unloaded", "loading", "loaded", "sleeping"].includes(entry.status));
}

function failure(code, message) {
    return new HttpError(502, code, message);
}

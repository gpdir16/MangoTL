import { HttpError } from "../utils/http-error.js";

const ACTIONS = ["startDownload", "cancelDownload", "unloadPreset", "deletePreset"];

export function createCombinedModelManager(managers) {
    const combined = {
        async listLocalModels() {
            const lists = await Promise.all(managers.map((manager) => manager.listLocalModels()));
            return lists.flat();
        },
    };

    for (const action of ACTIONS) {
        combined[action] = (presetId) => managerFor(presetId)[action](presetId);
    }

    function managerFor(presetId) {
        const manager = managers.find((candidate) => candidate.hasPreset(presetId));
        if (!manager) throw new HttpError(400, "invalid_local_model", `Unknown local model preset: "${presetId}".`);
        return manager;
    }

    return combined;
}

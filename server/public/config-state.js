export function resolveModelControl({ providerId, providers, currentModel }) {
    const provider = providers.find((entry) => entry.id === providerId);
    const local = providerId === "local-gguf";
    const presets = local && Array.isArray(provider?.models) ? provider.models : [];

    if (!local) {
        return { local: false, presets: [], model: currentModel };
    }

    return {
        local: true,
        presets,
        model: presets.some((preset) => preset.id === currentModel) ? currentModel : presets[0]?.id || "",
    };
}

export function summarizeModelProgress({ done, total }) {
    if (!Number.isFinite(total) || total <= 0) {
        return { percent: null, indeterminate: true };
    }
    const percent = Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
    return { percent, indeterminate: false };
}

export function shouldPollLocalModels(models) {
    return models.some((model) => ["downloading", "loading"].includes(model.status));
}

export function getAvailableModelActions(model) {
    if (model.active) {
        return [];
    }

    switch (model.status) {
        case "not_downloaded":
            return ["download"];
        case "incomplete":
        case "failed":
            return ["download", "delete"];
        case "downloading":
            return ["cancel", "delete"];
        case "loading":
            return ["delete"];
        case "loaded":
        case "sleeping":
            return ["unload", "delete"];
        case "unloaded":
            return ["delete"];
        default:
            return [];
    }
}

export function createSettingsSavePayload(key, snapshot) {
    const payload = { [key]: snapshot[key] };
    if (key === "provider") {
        payload.model = snapshot.model;
        payload.baseUrl = snapshot.baseUrl;
    }
    return payload;
}

export function getModelActionRequest(action, presetId) {
    if (!["download", "cancel", "unload", "delete"].includes(action)) {
        throw new Error(`Unsupported local model action: ${action}.`);
    }
    return {
        url: `/api/local-models/${action}`,
        method: "POST",
        body: { presetId },
    };
}

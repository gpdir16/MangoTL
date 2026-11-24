import { requireLocalModelPreset } from "../local-models/presets.js";

export function assertProviderModelAllowed(staticConfig, providerId, model) {
    if (providerId !== "local-gguf") {
        return;
    }

    const provider = staticConfig.providers.find((entry) => entry.id === providerId);
    requireLocalModelPreset(provider, model);
}

export function assertProviderModelUpdateAllowed(staticConfig, current, update, updated) {
    if (!("provider" in update) && !("model" in update)) {
        return;
    }
    assertProviderModelAllowed(staticConfig, updated.provider, updated.model);
}

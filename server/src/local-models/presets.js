import { HttpError } from "../utils/http-error.js";

export function listLocalModelPresets(provider) {
    return Array.isArray(provider?.models) ? provider.models : [];
}

export function requireLocalModelPreset(provider, presetId) {
    const preset = listLocalModelPresets(provider).find((entry) => entry.id === presetId);

    if (!preset) {
        throw new HttpError(400, "invalid_local_model", `Unknown local model preset: "${presetId}".`);
    }

    return preset;
}

export function assertLocalModelLanguages(preset, sourceLanguage, targetLanguage) {
    const supported = new Set(preset.supportedLanguages || []);

    if (!supported.has(sourceLanguage) || !supported.has(targetLanguage)) {
        throw new HttpError(
            400,
            "local_model_language_unsupported",
            `Local model "${preset.id}" does not support ${sourceLanguage} → ${targetLanguage}. Supported languages: ${[...supported].join(", ")}.`,
        );
    }
}

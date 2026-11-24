import { getLocalModelManager } from "../../local-models/manager.js";
import { translateTextBlocks } from "./block-translator.js";

export async function translateWithLocalGguf({
    provider,
    model,
    sourceLanguage,
    targetLanguage,
    blocks,
    signal,
    manager,
    fetchImpl,
    env = process.env,
}) {
    if (blocks.length === 0) {
        return [];
    }

    const localModels = manager || getLocalModelManager(provider);
    return localModels.runWithPreset(model, { sourceLanguage, targetLanguage }, ({ preset, baseUrl }) =>
        translateTextBlocks({
            baseUrl,
            model: preset.model,
            profile: preset.profile,
            sourceLanguage,
            targetLanguage,
            blocks,
            signal,
            parallel: positiveParallel(env.LOCAL_GGUF_PARALLEL),
            fetchImpl,
        }),
    );
}

function positiveParallel(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 2;
}

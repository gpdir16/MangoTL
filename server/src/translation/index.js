import { HttpError } from "../utils/http-error.js";

export { isUntranslatedText } from "./shared.js";

/**
 * 번역 프로바이더 type → 구현 로더 레지스트리.
 * 모듈은 지연 로딩되므로 선택되지 않은 프로바이더의 의존성은 로드되지 않는다.
 * 새 프로바이더 추가 = 구현 모듈 + 여기 한 줄 + config/providers/*.json.
 */
const PROVIDERS = {
    "openai-compatible": async () => (await import("./openai-compatible.js")).translateWithOpenAICompatible,
    "local-gguf": async () => (await import("./local-gguf/index.js")).translateWithLocalGguf,
};

/**
 * @param provider config/providers/*.json 엔트리 (type으로 구현 선택)
 * @param args { model, apiKey, sourceLanguage, targetLanguage, blocks, signal }
 */
export async function translateBlocks(provider, args) {
    const load = PROVIDERS[provider?.type];
    if (!load) {
        throw new HttpError(400, "provider_not_supported", `Unsupported provider type: ${provider?.type || "(none)"}`);
    }
    const translate = await load();
    return translate({ provider, ...args });
}

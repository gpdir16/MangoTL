import { buildTranslationMessages } from "../text/prompt.js";
import { HttpError } from "../utils/http-error.js";

const MAX_TRANSLATION_ATTEMPTS = 2;

export async function translateWithOpenAICompatible({ provider, sourceLanguage, targetLanguage, blocks, signal }) {
    if (blocks.length === 0) {
        return [];
    }

    const apiKey = process.env[provider.apiKeyEnv];
    const baseUrl = provider.baseUrl;
    const selectedModel = provider.defaultModel;

    if (!apiKey) {
        throw new HttpError(503, "ai_api_key_missing", `Missing API key env: ${provider.apiKeyEnv}`);
    }

    if (!baseUrl) {
        throw new HttpError(500, "ai_base_url_missing", `Missing provider base URL: ${provider.id}`);
    }

    if (!selectedModel) {
        throw new HttpError(500, "ai_model_missing", `Missing provider model: ${provider.id}`);
    }

    const endpointUrl = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const messages = buildTranslationMessages({
        sourceLanguage,
        targetLanguage,
        blocks,
    });
    const { translations } = await requestTranslationsWithRetry({
        endpointUrl,
        apiKey,
        provider,
        selectedModel,
        messages,
        signal,
    });

    return translations.map((translation) => ({
        id: String(translation.id),
        translatedText: String(translation.translatedText || translation.text || "").trim(),
        type: translation.type || null,
        direction: translation.direction || null,
    }));
}

async function requestTranslationsWithRetry({ endpointUrl, apiKey, provider, selectedModel, messages, signal }) {
    let lastPayload = null;

    for (let attempt = 1; attempt <= MAX_TRANSLATION_ATTEMPTS; attempt += 1) {
        let response;

        try {
            response = await fetch(endpointUrl, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: selectedModel,
                    temperature: attempt === 1 ? 0.4 : 0.2,
                    response_format: provider.responseFormat || { type: "json_object" },
                    messages,
                }),
                signal,
            });
        } catch (error) {
            if (error.name === "AbortError" || attempt === MAX_TRANSLATION_ATTEMPTS) {
                throw error;
            }

            lastPayload = {
                transportError: error.message,
            };
            continue;
        }

        const payload = await response.json().catch(() => null);
        lastPayload = payload;

        if (!response.ok) {
            if (attempt < MAX_TRANSLATION_ATTEMPTS && isRetryableStatus(response.status)) {
                continue;
            }

            throw new HttpError(response.status, "ai_request_failed", getProviderErrorMessage(payload, response.status), payload);
        }

        const content = payload?.choices?.[0]?.message?.content;
        const parsed = tryParseJsonContent(content);

        if (!parsed.ok) {
            lastPayload = {
                payload,
                parseError: parsed.error.message,
            };
            continue;
        }

        const translations = Array.isArray(parsed.value) ? parsed.value : parsed.value?.translations;

        if (Array.isArray(translations)) {
            return { translations, payload };
        }
    }

    throw new HttpError(502, "ai_response_invalid", "AI response did not contain a translations array.", lastPayload);
}

function isRetryableStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function getProviderErrorMessage(payload, status) {
    return payload?.error?.message || payload?.message || `AI provider request failed with status ${status}`;
}

function parseJsonContent(content) {
    if (!content || typeof content !== "string") {
        throw new HttpError(502, "ai_response_invalid", "AI response content is empty.");
    }

    try {
        return JSON.parse(content);
    } catch {
        const match = content.match(/\{[\s\S]*\}/);

        if (!match) {
            throw new HttpError(502, "ai_response_invalid", "AI response content was not JSON.");
        }

        return JSON.parse(match[0]);
    }
}

function tryParseJsonContent(content) {
    try {
        return {
            ok: true,
            value: parseJsonContent(content),
        };
    } catch (error) {
        return {
            ok: false,
            error,
        };
    }
}

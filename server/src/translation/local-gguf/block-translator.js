import { HttpError } from "../../utils/http-error.js";
import { createLinkedTimeoutSignal } from "../../utils/timeout-signal.js";
import { requireLocalModelProfile } from "./profiles.js";

const MAX_ATTEMPTS = 2;

export async function translateTextBlocks({
    baseUrl,
    model,
    profile,
    blocks,
    sourceLanguage,
    targetLanguage,
    signal,
    parallel = 2,
    requestTimeoutMs = 120000,
    fetchImpl = fetch,
}) {
    if (blocks.length === 0) {
        return [];
    }

    const buildRequest = requireLocalModelProfile(profile);
    const results = new Array(blocks.length);
    const workerCount = Math.min(Math.max(1, parallel), blocks.length);
    let nextIndex = 0;
    let firstError = null;

    async function worker() {
        while (!firstError) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= blocks.length) {
                return;
            }

            const block = blocks[index];
            try {
                const translatedText = await requestWithRetry({
                    baseUrl,
                    body: buildRequest({ model, block, blocks, sourceLanguage, targetLanguage }),
                    signal,
                    requestTimeoutMs,
                    fetchImpl,
                });
                results[index] = {
                    id: String(block.id),
                    translatedText,
                    type: block.type || null,
                    direction: block.direction || null,
                };
            } catch (error) {
                firstError = error;
                return;
            }
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    if (firstError) {
        throw firstError;
    }
    return results;
}

async function requestWithRetry({ baseUrl, body, signal, requestTimeoutMs, fetchImpl }) {
    const endpoint = `${baseUrl.replace(/\/+$/, "")}/v1/chat/completions`;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const timeout = createLinkedTimeoutSignal({ signal, timeoutMs: requestTimeoutMs });

        try {
            const response = await fetchImpl(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
                signal: timeout.signal,
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok) {
                if (attempt < MAX_ATTEMPTS && isRetryableStatus(response.status)) {
                    continue;
                }
                throw new HttpError(
                    response.status,
                    "local_model_request_failed",
                    payload?.error?.message || payload?.message || `Local model request failed with status ${response.status}.`,
                    payload,
                );
            }

            const choice = payload?.choices?.[0];
            if (choice?.finish_reason === "length") {
                throw new HttpError(502, "local_model_output_truncated", "Local model output was truncated before the translation completed.");
            }

            const translatedText = typeof choice?.message?.content === "string" ? choice.message.content.trim() : "";
            if (translatedText) {
                return translatedText;
            }
            if (attempt === MAX_ATTEMPTS) {
                throw new HttpError(502, "local_model_response_invalid", "Local model returned an empty or invalid translation response.", payload);
            }
        } catch (error) {
            if (timeout.timedOut()) {
                if (attempt < MAX_ATTEMPTS) {
                    continue;
                }
                throw new HttpError(504, "local_model_request_timeout", `Local model request timed out after ${requestTimeoutMs}ms.`);
            }
            if (error.name === "AbortError") {
                throw error;
            }
            if (error instanceof HttpError) {
                throw error;
            }
            if (attempt < MAX_ATTEMPTS) {
                continue;
            }
            throw new HttpError(503, "local_model_request_failed", `Local model request failed: ${error.message}`);
        } finally {
            timeout.cleanup();
        }
    }

    throw new HttpError(502, "local_model_response_invalid", "Local model did not return a translation.");
}

function isRetryableStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

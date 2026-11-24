import { HttpError } from "../utils/http-error.js";
import { createLinkedTimeoutSignal } from "../utils/timeout-signal.js";

const KNOWN_STATUSES = new Set(["downloading", "incomplete", "loading", "loaded", "sleeping", "unloaded", "failed"]);

export async function listRouterModels(context) {
    const payload = await requestRouter({ ...context, path: "/models" });

    if (!Array.isArray(payload?.data)) {
        throw new HttpError(502, "local_router_response_invalid", "llama.cpp router returned an invalid model list.");
    }

    return payload.data;
}

export async function startRouterDownload(context) {
    return mutateModel(context, "/models");
}

export async function cancelRouterDownload(context) {
    return mutateModel(context, "/models/unload");
}

export async function loadRouterModel(context) {
    return mutateModel(context, "/models/load");
}

export async function unloadRouterModel(context) {
    return mutateModel(context, "/models/unload");
}

export async function deleteRouterModel(context) {
    return requestRouter({
        ...context,
        path: `/models?${new URLSearchParams({ model: context.model }).toString()}`,
        method: "DELETE",
    });
}

export function normalizeRouterModel(entry) {
    const status = entry?.status || {};
    const requestedStatus = status.value || "failed";
    const failed = Boolean(status.failed) || requestedStatus === "failed" || !KNOWN_STATUSES.has(requestedStatus);
    const progress = status.progress && typeof status.progress === "object" ? Object.values(status.progress) : [];
    let done = 0;
    let total = 0;
    let hasCompleteTotal = progress.length > 0;

    for (const file of progress) {
        if (Number.isFinite(file?.done) && file.done >= 0) {
            done += file.done;
        }
        if (Number.isFinite(file?.total) && file.total >= 0) {
            total += file.total;
        } else {
            hasCompleteTotal = false;
        }
    }

    return {
        id: String(entry?.id || ""),
        status: failed ? "failed" : requestedStatus,
        done,
        total: hasCompleteTotal ? total : null,
        failed,
    };
}

function mutateModel(context, path) {
    return requestRouter({ ...context, path, method: "POST", body: { model: context.model } });
}

async function requestRouter({ baseUrl, path, method = "GET", body, fetchImpl = fetch, signal, timeoutMs = 10000 }) {
    const timeout = createLinkedTimeoutSignal({ signal, timeoutMs });

    try {
        const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${path}`, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: timeout.signal,
        });
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
            throw new HttpError(
                response.status,
                "local_router_request_failed",
                payload?.error?.message || payload?.message || `llama.cpp router request failed with status ${response.status}.`,
                payload,
            );
        }

        if (!payload || typeof payload !== "object") {
            throw new HttpError(502, "local_router_response_invalid", "llama.cpp router returned an invalid JSON response.");
        }

        return payload;
    } catch (error) {
        if (timeout.timedOut()) {
            throw new HttpError(504, "local_router_timeout", `llama.cpp router request timed out after ${timeoutMs}ms.`);
        }
        if (error.name === "AbortError") {
            throw error;
        }
        if (error instanceof HttpError) {
            throw error;
        }
        throw new HttpError(503, "local_runtime_unavailable", `Could not reach llama.cpp router: ${error.message}`);
    } finally {
        timeout.cleanup();
    }
}

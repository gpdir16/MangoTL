import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HttpError } from "../utils/http-error.js";
import { createLinkedTimeoutSignal } from "../utils/timeout-signal.js";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

let activeRuntime = null;
let startingPromise = null;
let cleanupRegistered = false;

export async function ensureLocalRuntime(options = {}) {
    const env = options.env || process.env;
    const configuredUrl = env.LOCAL_GGUF_BASE_URL?.trim();
    const mode = env.LOCAL_GGUF_MODE || (configuredUrl ? "external" : "native");

    if (mode === "external" || mode === "docker") {
        if (!configuredUrl) {
            throw unavailable(`LOCAL_GGUF_BASE_URL is required in ${mode} mode.`);
        }
        return { baseUrl: normalizeBaseUrl(configuredUrl), mode };
    }

    if (mode !== "native") {
        throw unavailable(`Unsupported LOCAL_GGUF_MODE: ${mode}.`);
    }

    if (configuredUrl) {
        return { baseUrl: normalizeBaseUrl(configuredUrl), mode: "external" };
    }

    if (activeRuntime && !activeRuntime.exited) {
        return { baseUrl: activeRuntime.baseUrl, mode: "native" };
    }

    if (startingPromise) {
        return startingPromise;
    }

    const start = startNativeRuntime(options, env);
    startingPromise = start;

    try {
        return await start;
    } finally {
        if (startingPromise === start) {
            startingPromise = null;
        }
    }
}

export async function closeLocalRuntime() {
    const runtime = activeRuntime;
    activeRuntime = null;

    if (runtime) {
        await stopChild(runtime);
    }

    if (startingPromise) {
        await startingPromise.catch(() => {});
    }
}

export async function resetLocalRuntimeForTests() {
    await closeLocalRuntime();
    activeRuntime = null;
    startingPromise = null;
}

async function startNativeRuntime(options, env) {
    const port = positiveInteger(env.LOCAL_GGUF_PORT, 9931);
    const cachePath = env.LOCAL_GGUF_CACHE ? path.resolve(env.LOCAL_GGUF_CACHE) : path.join(serverRoot, ".llama-cache");
    const mkdirImpl = options.mkdirImpl || mkdir;
    const spawnImpl = options.spawnImpl || spawn;
    const fetchImpl = options.fetchImpl || fetch;
    const waitImpl = options.waitImpl || wait;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const startupTimeoutMs = options.startupTimeoutMs ?? 30000;
    const baseUrl = `http://127.0.0.1:${port}`;
    const args = [
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--models-max",
        "1",
        "--sleep-idle-seconds",
        String(positiveInteger(env.LOCAL_GGUF_IDLE_SECONDS, 300)),
        "--ctx-size",
        String(positiveInteger(env.LOCAL_GGUF_CONTEXT_SIZE, 8192)),
        "--parallel",
        String(positiveInteger(env.LOCAL_GGUF_PARALLEL, 2)),
        "--n-gpu-layers",
        "0",
        "--models-autoload",
        "--jinja",
        "--no-prefill-assistant",
    ];

    await mkdirImpl(cachePath, { recursive: true });
    registerCleanup();

    let runtime;
    try {
        const child = spawnImpl(env.LOCAL_GGUF_BINARY || "llama-server", args, {
            detached: false,
            env: { ...process.env, LLAMA_CACHE: cachePath },
            stdio: ["ignore", "pipe", "pipe"],
        });
        runtime = { baseUrl, child, exited: false, error: null };
        activeRuntime = runtime;

        child.stdout?.on("data", (chunk) => logChildOutput(chunk));
        child.stderr?.on("data", (chunk) => logChildOutput(chunk));
        child.once("error", (error) => {
            runtime.error = error;
            runtime.exited = true;
            if (activeRuntime === runtime) {
                activeRuntime = null;
            }
        });
        child.once("exit", () => {
            runtime.exited = true;
            if (activeRuntime === runtime) {
                activeRuntime = null;
            }
        });

        await waitForHealth({
            runtime,
            fetchImpl,
            waitImpl,
            pollIntervalMs,
            startupTimeoutMs,
            healthRequestTimeoutMs: options.healthRequestTimeoutMs ?? 1000,
        });
        return { baseUrl, mode: "native" };
    } catch (error) {
        if (activeRuntime === runtime) {
            activeRuntime = null;
        }
        if (runtime) {
            await stopChild(runtime);
        }
        throw error instanceof HttpError ? error : unavailable(`Could not start llama-server: ${error.message}`);
    }
}

async function waitForHealth({ runtime, fetchImpl, waitImpl, pollIntervalMs, startupTimeoutMs, healthRequestTimeoutMs }) {
    const attempts = Math.max(1, Math.ceil(startupTimeoutMs / pollIntervalMs));

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (runtime.exited || runtime.error) {
            throw unavailable(
                `llama-server exited before becoming ready${runtime.error ? `: ${runtime.error.message}` : "."} Install llama-server or set LOCAL_GGUF_BINARY/LOCAL_GGUF_BASE_URL.`,
            );
        }

        const timeout = createLinkedTimeoutSignal({ timeoutMs: healthRequestTimeoutMs });
        try {
            const response = await fetchImpl(`${runtime.baseUrl}/health`, { signal: timeout.signal });
            if (runtime.exited || runtime.error) {
                throw unavailable(`llama-server exited before becoming ready${runtime.error ? `: ${runtime.error.message}` : "."}`);
            }
            if (response.ok) {
                return;
            }
        } catch (error) {
            if (error instanceof HttpError) {
                throw error;
            }
            if (runtime.exited || runtime.error) {
                throw unavailable(`llama-server exited before becoming ready${runtime.error ? `: ${runtime.error.message}` : "."}`);
            }
            // 시작 직후의 연결 거부와 개별 health timeout은 다음 확인까지 기다린다.
        } finally {
            timeout.cleanup();
        }

        await waitImpl(pollIntervalMs);
    }

    throw unavailable("Timed out waiting for llama-server readiness.");
}

async function stopChild(runtime) {
    if (!runtime?.child || runtime.exited) {
        return;
    }

    const child = runtime.child;
    const exited = new Promise((resolve) => child.once("exit", resolve));

    try {
        child.kill("SIGTERM");
        await Promise.race([exited, wait(1000)]);
    } catch (error) {
        console.warn(`[llama.cpp] Failed to stop native process: ${error.message}`);
    }

    if (!runtime.exited) {
        try {
            child.kill("SIGKILL");
        } catch {
            // 이미 종료된 프로세스라면 추가 정리는 필요 없다.
        }
    }
}

function registerCleanup() {
    if (cleanupRegistered) {
        return;
    }
    cleanupRegistered = true;

    const stopSynchronously = () => {
        if (activeRuntime?.child && !activeRuntime.exited) {
            activeRuntime.child.kill("SIGTERM");
            activeRuntime = null;
        }
    };

    process.once("SIGINT", () => {
        closeLocalRuntime().finally(() => process.exit(130));
    });
    process.once("SIGTERM", () => {
        closeLocalRuntime().finally(() => process.exit(143));
    });
    process.once("exit", stopSynchronously);
}

function normalizeBaseUrl(value) {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw unavailable("LOCAL_GGUF_BASE_URL must use HTTP or HTTPS.");
    }
    return value.replace(/\/+$/, "");
}

function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function unavailable(message) {
    return new HttpError(503, "local_runtime_unavailable", message);
}

function logChildOutput(chunk) {
    const message = String(chunk).trim();
    if (message) {
        console.log(`[llama.cpp] ${message}`);
    }
}

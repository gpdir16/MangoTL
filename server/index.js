import { Elysia, t } from "elysia";
import { readFile } from "node:fs/promises";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import {
    loadStaticServerConfig,
    loadUserSettings,
    applyUserSettings,
    saveUserSettings,
    getPositiveInteger,
} from "./src/config/load-server-config.js";
import { buildPublicConfig } from "./src/config/public-config.js";
import { normalizeTranslateRequest } from "./src/http/normalize-translate-request.js";
import { translateImage } from "./src/pipeline/translate-image.js";
import { HttpError } from "./src/utils/http-error.js";
import { clearImageResultCache } from "./src/utils/image-result-cache.js";

await clearImageResultCache();
const staticConfig = await loadStaticServerConfig();
const initialConfig = applyUserSettings(staticConfig, await loadUserSettings());

if (!initialConfig.defaultProvider || !initialConfig.defaultModel) {
    console.warn("[MangoTL] Warning: no AI provider/model configured yet. Server stays up — configure it at http://localhost:8787/config.");
}

const port = initialConfig.port;
const hostname = initialConfig.host;

// Settings saved to server/secrets/settings.json take effect on the next request
// (no restart needed). Port is the exception: rebinding requires a restart.
async function getRequestConfig() {
    return applyUserSettings(staticConfig, await loadUserSettings());
}

const app = new Elysia()
    .onError(({ error, set }) => errorResponse(error, set))
    .onRequest(({ set }) => {
        set.headers["Access-Control-Allow-Origin"] = "*";
        set.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
        set.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization,X-Access-Key";
    })
    .options("/*", ({ set }) => {
        set.status = 204;
        return null;
    })
    .get("/health", async () => {
        const config = await getRequestConfig();
        return {
            ok: true,
            name: "MangoTL server",
            version: "0.1.0",
            configured: Boolean(config.defaultProvider && config.defaultModel),
            detectionEngine: config.defaultDetectionEngine,
            ocrEngine: config.defaultOcrEngine,
            ocrRouting: config.ocrRouting?.languages || {},
            defaultProvider: config.defaultProvider,
        };
    })
    .get("/api/config", async () => buildPublicConfig(await getRequestConfig()))
    .get(
        "/",
        async () =>
            new Response(await readFile(new URL("./public/index.html", import.meta.url), "utf8"), {
                headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
    )
    .get(
        "/config",
        async () =>
            new Response(await readFile(new URL("./public/config.html", import.meta.url), "utf8"), {
                headers: { "Content-Type": "text/html; charset=utf-8" },
            }),
    )
    .get("/api/settings", async ({ request, set }) => {
        const settings = await loadUserSettings();
        const settingsHash = settings.security?.settingsPasswordHash;

        // Once a settings password is set, the saved values (provider/model/masked
        // key preview) are gated behind it — the settings page shows a lock screen
        // until the password is supplied via the X-Access-Key header.
        if (settingsHash && !verifyPassword(accessKeyFrom(request), settingsHash)) {
            set.status = 401;
            return { error: "unauthorized", message: "Settings password required.", settingsPasswordRequired: true };
        }

        return {
            providers: staticConfig.providers.map(({ id, name, apiKeyOptional }) => ({ id, name, apiKeyOptional: Boolean(apiKeyOptional) })),
            settings: {
                provider: settings.provider || "",
                model: settings.model || "",
                // Never send the full key — only a masked preview so the user can tell which key is saved.
                apiKeySet: Boolean(settings.apiKey),
                apiKeyPreview: maskApiKey(settings.apiKey),
                sourceLanguage: settings.sourceLanguage || staticConfig.appDefaults.sourceLanguage || "",
                targetLanguage: settings.targetLanguage || staticConfig.appDefaults.targetLanguage || "",
                maxImageBytes: getPositiveInteger(settings.maxImageBytes, staticConfig.appDefaults.maxImageBytes),
                port: getPositiveInteger(settings.port, staticConfig.appDefaults.port) || 8787,
                host: (settings.host && String(settings.host).trim()) || staticConfig.appDefaults.host || "0.0.0.0",
                security: {
                    settingsPasswordSet: Boolean(settingsHash),
                    translatePasswordSet: Boolean(settings.security?.translatePasswordHash),
                },
            },
        };
    })
    .post(
        "/api/settings",
        async ({ request, body, set }) => {
            if (!isSameOriginRequest(request)) {
                set.status = 403;
                return { error: "forbidden", message: "Cross-origin settings changes are not allowed." };
            }

            // Bootstrap: while no settings password is set yet, anyone reachable can
            // configure the server (including setting that first password). Once set,
            // every change — including changing/removing the password itself — needs it.
            const current = await loadUserSettings();
            if (current.security?.settingsPasswordHash && !verifyPassword(accessKeyFrom(request), current.security.settingsPasswordHash)) {
                set.status = 401;
                return { error: "unauthorized", message: "Settings password required.", settingsPasswordRequired: true };
            }

            if (!body || typeof body !== "object") {
                throw new HttpError(400, "invalid_body", "Request body must be a JSON object.");
            }

            const updated = applySettingsUpdate(current, body, staticConfig);
            await saveUserSettings(updated);
            return { ok: true };
        },
        { body: t.Any() },
    )
    .post(
        "/api/translate",
        async ({ request: httpRequest, body, query, set }) => {
            const config = await getRequestConfig();

            const translatePasswordHash = config.security?.translatePasswordHash;

            if (translatePasswordHash) {
                const accessKey = accessKeyFrom(httpRequest);

                if (!accessKey) {
                    set.status = 401;
                    return { error: "unauthorized", message: "Translate password required.", translatePasswordRequired: true };
                }

                if (!verifyPassword(accessKey, translatePasswordHash)) {
                    set.status = 401;
                    return { error: "unauthorized", message: "Translate password is incorrect.", translatePasswordIncorrect: true };
                }
            }

            const request = await normalizeTranslateRequest(body, query, config);
            const startTime = Date.now();

            try {
                const result = await translateImage(request, config);
                const duration = Date.now() - startTime;

                console.log("[MangoTL] Translation completed:", {
                    imageId: result.imageId,
                    duration: `${duration}ms`,
                    timestamp: new Date().toISOString(),
                });

                return result;
            } catch (error) {
                const duration = Date.now() - startTime;

                console.error("[MangoTL] Translation failed:", {
                    imageId: request.imageId,
                    duration: `${duration}ms`,
                    error: error.message,
                    code: error.code,
                });

                throw error;
            }
        },
        {
            body: t.Any(),
            query: t.Object({
                target: t.Optional(t.String()),
                source: t.Optional(t.String()),
                dryRun: t.Optional(t.String()),
                websiteId: t.Optional(t.String()),
                website: t.Optional(t.String()),
            }),
        },
    )
    .listen({ port, hostname });

console.log("[MangoTL] Server starting...");
console.log(`[MangoTL] Listening on http://localhost:${app.server?.port || port}`);
console.log(`[MangoTL] Bind address: ${hostname}`);
console.log("[MangoTL] Detection Engine:", initialConfig.defaultDetectionEngine);
console.log("[MangoTL] OCR Engine fallback:", initialConfig.defaultOcrEngine);
console.log("[MangoTL] OCR Language routing:", initialConfig.ocrRouting?.languages || {});
console.log(
    "[MangoTL] Website configs:",
    initialConfig.websites.map((website) => website.id),
);
console.log("[MangoTL] Default Provider:", initialConfig.defaultProvider);
console.log("[MangoTL] Default Model:", initialConfig.defaultModel);

// Show only the first 6 characters of the API key, never the rest.
function maskApiKey(apiKey) {
    if (!apiKey) {
        return "";
    }

    // Prefix (everything up to and including the last dash) never counts toward
    // the revealed characters — only the actual key part does, and only 4 of it.
    const dashIndex = apiKey.lastIndexOf("-");
    const prefix = dashIndex >= 0 ? apiKey.slice(0, dashIndex + 1) : "";
    const keyPart = dashIndex >= 0 ? apiKey.slice(dashIndex + 1) : apiKey;

    if (keyPart.length <= 4) {
        return `${prefix}${"•".repeat(keyPart.length)}`;
    }

    // Mask length mirrors the real remaining key length.
    return `${prefix}${keyPart.slice(0, 4)}${"•".repeat(keyPart.length - 4)}`;
}

// Passwords are hashed with scrypt + a per-password random salt (node:crypto,
// no dependencies). Stored as "saltHex:hashHex". An empty stored value means the
// password is not set, which is also the bootstrap state that lets the first
// settings password be configured without authentication.
function hashPassword(password) {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 32);
    return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
    if (!password || typeof stored !== "string" || !stored) {
        return false;
    }

    const [saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) {
        return false;
    }

    try {
        const hash = scryptSync(password, Buffer.from(saltHex, "hex"), 32);
        // ponytail: scryptSync per gated request (~tens of ms); translation itself
        // takes seconds so this is noise. Move to a cached verify if a high-QPS
        // public translate endpoint ever needs it.
        return timingSafeEqual(hash, Buffer.from(hashHex, "hex"));
    } catch {
        return false;
    }
}

function accessKeyFrom(request) {
    return request.headers.get("x-access-key") || "";
}

// Only same-origin requests (the settings page itself) may change settings,
// so a random website cannot read/overwrite the API key via CORS.
function isSameOriginRequest(request) {
    const origin = request.headers.get("origin");

    if (!origin) {
        return true;
    }

    try {
        return new URL(origin).host === request.headers.get("host");
    } catch {
        return false;
    }
}

function applySettingsUpdate(current, update, staticConfig) {
    const updated = { ...current };

    if ("provider" in update) {
        const provider = String(update.provider ?? "");

        if (!staticConfig.providers.some((entry) => entry.id === provider)) {
            throw new HttpError(
                400,
                "invalid_provider",
                `Unknown provider: "${provider}". Available: ${staticConfig.providers.map((entry) => entry.id).join(", ")}.`,
            );
        }

        updated.provider = provider;
    }

    if ("model" in update) {
        const model = String(update.model ?? "").trim();

        if (!model) {
            throw new HttpError(400, "invalid_model", "Model must not be empty.");
        }

        updated.model = model;
    }

    // An empty/omitted apiKey keeps the current key, so the page never needs to round-trip it.
    if ("apiKey" in update && typeof update.apiKey === "string") {
        const apiKey = update.apiKey.trim();

        if (apiKey) {
            updated.apiKey = apiKey;
        }
    }

    for (const key of ["maxImageBytes", "port"]) {
        if (key in update) {
            const value = getPositiveInteger(update[key]);

            if (!value) {
                throw new HttpError(400, `invalid_${key}`, `${key} must be a positive integer.`);
            }

            updated[key] = value;
        }
    }

    // Bind address (e.g. 0.0.0.0 for all interfaces, 127.0.0.1 for localhost only).
    // Like port, it only takes effect after a restart.
    if ("host" in update) {
        const host = String(update.host ?? "").trim();

        if (!host) {
            throw new HttpError(400, "invalid_host", "Host must not be empty.");
        }

        updated.host = host;
    }

    // Independent passwords for settings changes and translation usage.
    // A non-empty string sets/replaces the password (hashed before storage);
    // null removes it; an empty string leaves the current value unchanged.
    if ("security" in update && update.security && typeof update.security === "object") {
        const sec = update.security;
        updated.security = { ...(current.security || {}) };

        for (const [field, hashField] of [
            ["settingsPassword", "settingsPasswordHash"],
            ["translatePassword", "translatePasswordHash"],
        ]) {
            if (field in sec) {
                const value = sec[field];

                if (value === null) {
                    updated.security[hashField] = "";
                } else if (typeof value === "string" && value.trim()) {
                    updated.security[hashField] = hashPassword(value.trim());
                }
            }
        }
    }

    return updated;
}

function errorResponse(error, set) {
    if (error instanceof HttpError) {
        set.status = error.statusCode;
        return {
            error: error.code,
            message: error.message,
            details: error.details || null,
        };
    }

    if (error?.code === "NOT_FOUND" || error?.message === "NOT_FOUND") {
        set.status = 404;
        return {
            error: "not_found",
            message: "Route not found",
            details: null,
        };
    }

    console.error(error);
    set.status = 500;
    return {
        error: "internal_error",
        message: error.message || "Unexpected server error",
        details: null,
    };
}

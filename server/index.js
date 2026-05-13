import { Elysia, t } from "elysia";
import { loadServerConfig } from "./src/config/load-server-config.js";
import { buildPublicConfig } from "./src/config/public-config.js";
import { normalizeTranslateRequest } from "./src/http/normalize-translate-request.js";
import { translateImage } from "./src/pipeline/translate-image.js";
import { HttpError } from "./src/utils/http-error.js";
import { clearImageResultCache } from "./src/utils/image-result-cache.js";

await clearImageResultCache();
const config = await loadServerConfig();
const port = Number(process.env.PORT || config.port || 8787);

const app = new Elysia()
    .onError(({ error, set }) => errorResponse(error, set))
    .onRequest(({ set }) => {
        set.headers["Access-Control-Allow-Origin"] = "*";
        set.headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
        set.headers["Access-Control-Allow-Headers"] = "Content-Type,Authorization";
    })
    .options("/*", ({ set }) => {
        set.status = 204;
        return null;
    })
    .get("/health", () => {
        return {
            ok: true,
            name: "MangoTL server",
            version: "0.1.0",
            detectionEngine: config.defaultDetectionEngine,
            ocrEngine: config.defaultOcrEngine,
            ocrRouting: config.ocrRouting?.languages || {},
            defaultProvider: config.defaultProvider,
        };
    })
    .get("/api/config", () => buildPublicConfig(config))
    .post(
        "/api/translate",
        async ({ body, query }) => {
            const request = normalizeTranslateRequest(body, query, config);
            const startTime = Date.now();

            try {
                const result = await translateImage(request, config);
                const duration = Date.now() - startTime;

                console.log("[MangoTL] Translation completed:", {
                    imageUrl: result.imageUrl,
                    duration: `${duration}ms`,
                    timestamp: new Date().toISOString(),
                });

                return result;
            } catch (error) {
                const duration = Date.now() - startTime;

                console.error("[MangoTL] Translation failed:", {
                    imageUrl: request.imageUrl,
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
    .listen(port);

console.log("[MangoTL] Server starting...");
console.log("[MangoTL] Listening on http://localhost:", app.server?.port || port);
console.log("[MangoTL] Detection Engine:", config.defaultDetectionEngine);
console.log("[MangoTL] OCR Engine fallback:", config.defaultOcrEngine);
console.log("[MangoTL] OCR Language routing:", config.ocrRouting?.languages || {});
console.log(
    "[MangoTL] Website configs:",
    config.websites.map((website) => website.id),
);
console.log("[MangoTL] Default Provider:", config.defaultProvider);

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

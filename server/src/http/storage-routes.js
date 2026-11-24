import { t } from "elysia";
import { createSettingsGuard } from "./settings-guard.js";
import { clearStorageCache, listStorageUsage } from "../storage/storage.js";
import { HttpError } from "../utils/http-error.js";

export function registerStorageRoutes(app, { loadSettings }) {
    const authorize = createSettingsGuard(loadSettings);

    app.get("/api/storage", async ({ request, set }) => {
        const denied = await authorize(request, set, false);
        return denied || listStorageUsage();
    });

    app.post(
        "/api/storage/clear",
        async ({ request, body, set }) => {
            const denied = await authorize(request, set, true);
            if (denied) return denied;
            if (!body || typeof body !== "object" || typeof body.target !== "string" || !body.target) {
                throw new HttpError(400, "invalid_body", "Request body must include a non-empty target.");
            }
            return await clearStorageCache(body.target);
        },
        { body: t.Any() },
    );

    return app;
}

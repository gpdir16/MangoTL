import { t } from "elysia";
import { getLocalModelManager } from "../local-models/manager.js";
import { createCombinedModelManager } from "../local-models/combined-manager.js";
import { getOcrModelManager } from "../ocr-models/manager.js";
import { createSettingsGuard } from "./settings-guard.js";
import { HttpError } from "../utils/http-error.js";

const ACTIONS = {
    download: "startDownload",
    cancel: "cancelDownload",
    unload: "unloadPreset",
    delete: "deletePreset",
};

export function registerLocalModelRoutes(app, { provider, staticConfig, loadSettings }) {
    const manager = createCombinedModelManager([getOcrModelManager(staticConfig), getLocalModelManager(provider)]);
    const handlers = createLocalModelHandlers({ manager, loadSettings });
    app.get("/api/local-models", handlers.list);

    for (const action of Object.keys(ACTIONS)) {
        app.post(`/api/local-models/${action}`, (context) => handlers.action(action, context), { body: t.Any() });
    }

    return app;
}

export function createLocalModelHandlers({ manager, loadSettings }) {
    const authorize = createSettingsGuard(loadSettings);

    async function list({ request, set }) {
        const denied = await authorize(request, set, false);
        return denied || manager.listLocalModels();
    }

    async function action(actionName, { request, body, set }) {
        const denied = await authorize(request, set, true);
        if (denied) {
            return denied;
        }
        if (!body || typeof body !== "object" || typeof body.presetId !== "string" || !body.presetId) {
            throw new HttpError(400, "invalid_body", "Request body must include a non-empty presetId.");
        }

        const method = ACTIONS[actionName];
        if (!method) {
            throw new HttpError(400, "invalid_local_model_action", `Unknown local model action: ${actionName}.`);
        }

        const result = await manager[method](body.presetId);
        if (actionName === "download") {
            set.status = 202;
        }
        return result;
    }

    return { list, action };
}

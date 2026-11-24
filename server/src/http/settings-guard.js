import { accessKeyFrom, isSameOriginRequest, verifyPassword } from "./request-security.js";

export function createSettingsGuard(loadSettings) {
    return async function authorize(request, set, mutation) {
        if (mutation && !isSameOriginRequest(request)) {
            set.status = 403;
            return { error: "forbidden", message: "Cross-origin settings changes are not allowed." };
        }

        const settings = await loadSettings();
        if (settings.security?.settingsPasswordHash && !verifyPassword(accessKeyFrom(request), settings.security.settingsPasswordHash)) {
            set.status = 401;
            return { error: "unauthorized", message: "Settings password required.", settingsPasswordRequired: true };
        }
        return null;
    };
}

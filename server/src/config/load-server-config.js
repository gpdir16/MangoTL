import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseConfigTopLevelKeys = ["id", "kind", "name", "type", "settings"];
const optionalConfigTopLevelKeysByKind = {
    "ocr-engine": ["capabilities"],
};

const defaultSettings = {
    provider: "",
    model: "",
    apiKey: "",
    sourceLanguage: "ja",
    targetLanguage: "ko",
    maxImageBytes: 20971520,
};

// Static config (providers, OCR engines, websites, defaults) is loaded once at boot.
// User settings (secrets/settings.json) are re-read per request so the settings
// page can save changes without a server restart. Port is the exception: rebinding
// it requires a restart, so it is applied only at boot.
export async function loadStaticServerConfig() {
    const app = (await loadConfigFile(path.join(serverRoot, "config/app.json"))) || {};
    const providers = await loadConfigDirectory(path.join(serverRoot, "config/providers"));
    const ocrEngines = await loadConfigDirectory(path.join(serverRoot, "config/ocr-engines"));
    const detectionEngines = await loadConfigDirectory(path.join(serverRoot, "config/detection-engines"));
    const websites = await loadConfigDirectory(path.join(serverRoot, "config/websites"));
    const ocrRouting = await loadConfigFile(path.join(serverRoot, "config/ocr-routing.json"));

    return {
        appDefaults: {
            port: app.port || 8787,
            maxImageBytes: app.security?.maxImageBytes || null,
            sourceLanguage: app.languages?.source || null,
            targetLanguage: app.languages?.target || null,
        },
        languageSettings: app.languages || {},
        providers,
        ocrEngines,
        detectionEngines,
        websites,
        ocrRouting,
        defaultOcrEngine: ocrRouting?.ocrEngine || null,
        defaultDetectionEngine: ocrRouting?.detectionEngine || detectionEngines[0]?.id || null,
    };
}

// Read the settings store (written by the settings page). Creates it with defaults
// on first boot so the page always has a store to read/write.
export async function loadUserSettings() {
    const settingsPath = path.join(serverRoot, "secrets/settings.json");
    const settings = await loadJsonFile(settingsPath);

    if (settings) {
        return settings;
    }

    await writeFile(settingsPath, `${JSON.stringify(defaultSettings, null, 4)}\n`);
    return defaultSettings;
}

export async function saveUserSettings(settings) {
    const settingsPath = path.join(serverRoot, "secrets/settings.json");
    const tmpPath = `${settingsPath}.tmp`;
    await writeFile(tmpPath, `${JSON.stringify(settings, null, 4)}\n`);
    await rename(tmpPath, settingsPath);
}

export function applyUserSettings(staticConfig, settings) {
    return {
        ...staticConfig,
        port: getPositiveInteger(settings.port, staticConfig.appDefaults.port) || 8787,
        maxImageBytes: getPositiveInteger(settings.maxImageBytes, staticConfig.appDefaults.maxImageBytes),
        defaultSourceLanguage: settings.sourceLanguage || staticConfig.appDefaults.sourceLanguage,
        defaultTargetLanguage: settings.targetLanguage || staticConfig.appDefaults.targetLanguage,
        defaultProvider: settings.provider || null,
        defaultModel: settings.model || null,
        apiKey: settings.apiKey || null,
    };
}

async function loadConfigDirectory(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const jsonFiles = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();

    return Promise.all(
        jsonFiles.map(async (fileName) => {
            const fullPath = path.join(directoryPath, fileName);
            return loadConfigFile(fullPath);
        }),
    );
}

async function loadConfigFile(filePath) {
    const entry = await loadJsonFile(filePath);
    return entry ? normalizeConfigEntry(entry, filePath) : null;
}

function normalizeConfigEntry(entry, filePath) {
    assertCommonConfigShape(entry, filePath);

    const capabilities = entry.kind === "ocr-engine" ? entry.capabilities : null;
    const settings = entry.settings || {};
    const normalized = {
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        type: entry.type,
        ...settings,
    };

    if (Array.isArray(capabilities?.languages)) {
        normalized.supportedLanguages = capabilities.languages;
    }

    return normalized;
}

function assertCommonConfigShape(entry, filePath) {
    if (!isPlainObject(entry)) {
        throw new Error(`Invalid config structure in ${relativeConfigPath(filePath)}: root must be an object.`);
    }

    const keys = Object.keys(entry);
    const allowedKeys = getAllowedConfigTopLevelKeys(entry);
    const requiredKeys = baseConfigTopLevelKeys.filter((key) => !(optionalConfigTopLevelKeysByKind[entry.kind] || []).includes(key));
    const missingKeys = requiredKeys.filter((key) => !keys.includes(key));
    const extraKeys = keys.filter((key) => !allowedKeys.includes(key));

    if (missingKeys.length > 0 || extraKeys.length > 0) {
        throw new Error(
            `Invalid config structure in ${relativeConfigPath(filePath)}. Missing keys: ${formatKeys(missingKeys)}. Extra keys: ${formatKeys(extraKeys)}.`,
        );
    }

    if ("capabilities" in entry && !isPlainObject(entry.capabilities)) {
        throw new Error(`Invalid config structure in ${relativeConfigPath(filePath)}: capabilities must be an object.`);
    }

    if (!isPlainObject(entry.settings)) {
        throw new Error(`Invalid config structure in ${relativeConfigPath(filePath)}: settings must be an object.`);
    }
}

function getAllowedConfigTopLevelKeys(entry) {
    return [...baseConfigTopLevelKeys, ...(optionalConfigTopLevelKeysByKind[entry.kind] || [])];
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatKeys(keys) {
    return keys.length > 0 ? keys.join(", ") : "(none)";
}

function relativeConfigPath(filePath) {
    return path.relative(serverRoot, filePath);
}

export function getPositiveInteger(...values) {
    for (const value of values) {
        const parsed = Number(value);

        if (Number.isSafeInteger(parsed) && parsed > 0) {
            return parsed;
        }
    }

    return null;
}

async function loadJsonFile(filePath) {
    try {
        const raw = await readFile(filePath, "utf8");
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

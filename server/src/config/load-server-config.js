import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseConfigTopLevelKeys = ["id", "kind", "name", "type", "enabled", "default", "settings"];
const optionalConfigTopLevelKeysByKind = {
    "ocr-engine": ["capabilities"],
};

export async function loadServerConfig() {
    const app = (await loadConfigFile(path.join(serverRoot, "config/app.json"))) || {};
    const providers = await loadConfigDirectory(path.join(serverRoot, "config/providers"));
    const ocrEngines = await loadConfigDirectory(path.join(serverRoot, "config/ocr-engines"));
    const detectionEngines = await loadConfigDirectory(path.join(serverRoot, "config/detection-engines"));
    const websites = await loadConfigDirectory(path.join(serverRoot, "config/websites"));
    const ocrRouting = await loadConfigFile(path.join(serverRoot, "config/ocr-routing.json"));

    const enabledProviders = providers.filter((provider) => provider.enabled !== false);
    const enabledOcrEngines = ocrEngines.filter((engine) => engine.enabled !== false);
    const enabledDetectionEngines = detectionEngines.filter((engine) => engine.enabled !== false);

    return {
        port: app.port || 8787,
        defaultSourceLanguage: process.env.MANGOTL_SOURCE_LANGUAGE || app.languages?.source || null,
        defaultTargetLanguage: process.env.MANGOTL_TARGET_LANGUAGE || app.languages?.target || null,
        languageSettings: app.languages || {},
        providers,
        ocrEngines,
        detectionEngines,
        websites,
        ocrRouting,
        defaultProvider:
            process.env.MANGOTL_AI_PROVIDER || enabledProviders.find((provider) => provider.default)?.id || enabledProviders[0]?.id || null,
        defaultOcrEngine: ocrRouting?.ocrEngine || enabledOcrEngines.find((engine) => engine.default)?.id || enabledOcrEngines[0]?.id || null,
        defaultDetectionEngine:
            ocrRouting?.detectionEngine || enabledDetectionEngines.find((engine) => engine.default)?.id || enabledDetectionEngines[0]?.id || null,
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
        enabled: entry.enabled,
        default: entry.default,
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
    const missingKeys = baseConfigTopLevelKeys.filter((key) => !keys.includes(key));
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

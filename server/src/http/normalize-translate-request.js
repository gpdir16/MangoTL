import { HttpError } from "../utils/http-error.js";

export function normalizeTranslateRequest(body, query = {}, config = {}) {
    const imageUrl = getImageUrl(body);

    if (!imageUrl) {
        throw new HttpError(400, "invalid_request", "POST body must be an object with imageUrl.");
    }

    const websiteId = firstNonBlank(query.websiteId, query.website, body?.websiteId, getBodyWebsiteId(body));
    const website = resolveWebsite(config, websiteId);
    const targetLanguage = firstNonBlank(query.target, body?.targetLanguage, body?.target, config.defaultTargetLanguage);
    const sourceLanguage = firstNonBlank(query.source, body?.sourceLanguage, body?.source, website?.sourceLanguage, config.defaultSourceLanguage);

    if (!targetLanguage || !sourceLanguage) {
        throw new HttpError(400, "invalid_request", "Source and target languages are required when no defaults are configured.");
    }

    assertSupportedLanguage(
        "source",
        sourceLanguage,
        getConfiguredLanguageCodes(config, "sourceOptions", getSourceLanguageFallbacks(config, website)),
    );
    assertSupportedLanguage("target", targetLanguage, getConfiguredLanguageCodes(config, "targetOptions", [config.defaultTargetLanguage]));

    return {
        imageUrl,
        targetLanguage,
        sourceLanguage,
        websiteId: website?.id || websiteId || null,
        dryRun: isTruthyFlag(query.dryRun) || isTruthyFlag(body?.dryRun),
    };
}

function getImageUrl(body) {
    const value = typeof body === "string" ? body : body?.imageUrl || body?.image || body?.url;

    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed || null;
}

function getBodyWebsiteId(body) {
    if (!body?.website || typeof body.website !== "object") {
        return body?.website;
    }

    return body.website.id;
}

function resolveWebsite(config, websiteId) {
    if (!websiteId) {
        return null;
    }

    const website = config.websites?.find((candidate) => candidate.id === websiteId && candidate.enabled !== false);

    if (!website) {
        throw new HttpError(400, "website_not_found", `Website config not found or disabled: ${websiteId}`);
    }

    return website;
}

function assertSupportedLanguage(kind, language, allowedLanguages) {
    if (allowedLanguages.size > 0 && !allowedLanguages.has(language)) {
        throw new HttpError(400, "unsupported_language", `Unsupported ${kind} language: ${language}`);
    }
}

function getConfiguredLanguageCodes(config, optionKey, fallbacks) {
    const configuredOptions = config.languageSettings?.[optionKey];
    const codes =
        Array.isArray(configuredOptions) && configuredOptions.length > 0
            ? configuredOptions.map((option) => (typeof option === "string" ? option : option?.code))
            : fallbacks;

    return new Set(codes.filter(Boolean));
}

function getSourceLanguageFallbacks(config, website) {
    const codes = [website?.sourceLanguage, config.defaultSourceLanguage];

    for (const engine of config.ocrEngines || []) {
        if (engine.enabled === false || !Array.isArray(engine.supportedLanguages)) {
            continue;
        }

        codes.push(...engine.supportedLanguages);
    }

    return codes;
}

function firstNonBlank(...values) {
    for (const value of values) {
        if (typeof value !== "string") {
            if (value !== undefined && value !== null) {
                return value;
            }
            continue;
        }

        const trimmed = value.trim();
        if (trimmed) {
            return trimmed;
        }
    }

    return null;
}

function isTruthyFlag(value) {
    return value === true || value === "1" || value === "true";
}

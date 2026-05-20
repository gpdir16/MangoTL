import { HttpError } from "../utils/http-error.js";

export async function normalizeTranslateRequest(body, query = {}, config = {}) {
    const image = await getSubmittedImage(body, config);

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
        image,
        imageId: getImageId(body, image),
        targetLanguage,
        sourceLanguage,
        websiteId: website?.id || websiteId || null,
        dryRun: isTruthyFlag(query.dryRun) || isTruthyFlag(body?.dryRun),
    };
}

async function getSubmittedImage(body, config) {
    const file = getImageFile(body);

    if (!file) {
        throw new HttpError(400, "invalid_request", "POST body must include an image file field.");
    }

    const contentType = getImageContentType(file);

    if (!contentType.startsWith("image/")) {
        throw new HttpError(415, "unsupported_image_type", `Uploaded file is not an image: ${contentType}`);
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (buffer.byteLength === 0) {
        throw new HttpError(400, "invalid_request", "Uploaded image is empty.");
    }

    if (config.maxImageBytes && buffer.byteLength > config.maxImageBytes) {
        throw new HttpError(413, "image_too_large", `Uploaded image is larger than ${config.maxImageBytes} bytes.`);
    }

    return {
        buffer,
        contentType,
        fileName: typeof file.name === "string" ? file.name : "image",
    };
}

function getImageFile(body) {
    if (isFileLike(body)) {
        return body;
    }

    return [body?.image, body?.file].find(isFileLike) || null;
}

function isFileLike(value) {
    return Boolean(value) && typeof value.arrayBuffer === "function";
}

function getImageContentType(file) {
    return typeof file.type === "string" && file.type ? file.type : "application/octet-stream";
}

function getImageId(body, image) {
    const value = firstNonBlank(body?.imageId, body?.id, image.fileName);
    return value || "image";
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

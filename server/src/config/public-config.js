const LANGUAGE_LABELS = {
    ja: "Japanese",
    ko: "Korean",
    en: "English",
    zh: "Chinese",
    de: "German",
    sv: "Swedish",
};

export function buildPublicConfig(config) {
    return {
        defaults: {
            sourceLanguage: config.defaultSourceLanguage,
            targetLanguage: config.defaultTargetLanguage,
        },
        languages: {
            sources: normalizeLanguageOptions(config.languageSettings?.sourceOptions, getSourceLanguageFallbacks(config)),
            targets: normalizeLanguageOptions(config.languageSettings?.targetOptions, [config.defaultTargetLanguage].filter(Boolean)),
        },
        websites: config.websites.map(toPublicWebsiteConfig),
        // Lets the add-on warn the user (and send the password) when the server
        // has a translate password set. Booleans only — never any hash.
        security: {
            settingsPasswordSet: Boolean(config.security?.settingsPasswordHash),
            translatePasswordSet: Boolean(config.security?.translatePasswordHash),
        },
    };
}

function normalizeLanguageOptions(configuredOptions, fallbackCodes) {
    const options = Array.isArray(configuredOptions) && configuredOptions.length > 0 ? configuredOptions : fallbackCodes.map((code) => ({ code }));
    const seen = new Set();
    const normalized = [];

    for (const option of options) {
        const code = typeof option === "string" ? option : option?.code;

        if (!code || seen.has(code)) {
            continue;
        }

        seen.add(code);
        normalized.push({
            code,
            label: typeof option === "object" && option?.label ? option.label : LANGUAGE_LABELS[code] || code,
        });
    }

    return normalized;
}

function getSourceLanguageFallbacks(config) {
    const codes = [config.defaultSourceLanguage];

    for (const engine of config.ocrEngines || []) {
        if (!Array.isArray(engine.supportedLanguages)) {
            continue;
        }

        codes.push(...engine.supportedLanguages);
    }

    return [...new Set(codes.filter(Boolean))];
}

function toPublicWebsiteConfig(website) {
    return {
        id: website.id,
        name: website.name,
        sourceLanguage: website.sourceLanguage || null,
        hostPatterns: website.hostPatterns || [],
        imageHostPatterns: website.imageHostPatterns || [],
        imageSelectors: website.imageSelectors || [],
        imageFetch: website.imageFetch || {},
        includeUrlPatterns: website.includeUrlPatterns || [],
        excludeUrlPatterns: website.excludeUrlPatterns || [],
        minImageWidth: website.minImageWidth || null,
        minImageHeight: website.minImageHeight || null,
        urlNormalizer: website.urlNormalizer || {},
        imageKeyPattern: website.imageKeyPattern || null,
    };
}

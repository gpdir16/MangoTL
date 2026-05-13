(function installMangoTLI18n(global) {
    const DEFAULT_LOCALE = "en";
    const LOCALE_ALIASES = {
        ko: "ko",
        "ko-kr": "ko",
        en: "en",
        "en-us": "en",
        "en-gb": "en",
    };
    const LANGUAGE_MESSAGE_KEYS = {
        ja: "languageJapanese",
        ko: "languageKorean",
        en: "languageEnglish",
        latin: "languageLatin",
        zh: "languageChinese",
        "zh-CN": "languageSimplifiedChinese",
        "zh-TW": "languageTraditionalChinese",
    };

    function getExtensionApi() {
        if (typeof browser !== "undefined") {
            return browser;
        }

        if (typeof chrome !== "undefined") {
            return chrome;
        }

        return null;
    }

    function normalizeLocale(locale) {
        const normalized = String(locale || DEFAULT_LOCALE).toLowerCase();
        return LOCALE_ALIASES[normalized] || (normalized.startsWith("ko") ? "ko" : DEFAULT_LOCALE);
    }

    function getLocale() {
        const api = getExtensionApi();
        const uiLanguage = api?.i18n?.getUILanguage?.() || global.navigator?.language || DEFAULT_LOCALE;
        return normalizeLocale(uiLanguage);
    }

    function t(messageKey, substitutions) {
        if (!messageKey) {
            return "";
        }

        const api = getExtensionApi();
        const values = substitutions === undefined ? undefined : Array.isArray(substitutions) ? substitutions.map(String) : [String(substitutions)];
        const message = values === undefined ? api?.i18n?.getMessage?.(messageKey) : api?.i18n?.getMessage?.(messageKey, values);

        return message || messageKey;
    }

    function localizeDocument(root = global.document) {
        if (!root) {
            return;
        }

        const documentElement = root.ownerDocument?.documentElement || root.documentElement;

        if (documentElement) {
            documentElement.lang = getLocale();
        }

        root.querySelectorAll("[data-i18n]").forEach((element) => {
            element.textContent = t(element.dataset.i18n);
        });

        root.querySelectorAll("[data-i18n-attr]").forEach((element) => {
            for (const pair of element.dataset.i18nAttr.split(";")) {
                const [attribute, key] = pair.split(":").map((value) => value.trim());

                if (attribute && key) {
                    element.setAttribute(attribute, t(key));
                }
            }
        });
    }

    function languageLabel(option) {
        const code = typeof option === "string" ? option : option?.code;
        const fallback = typeof option === "object" && option?.label ? option.label : code || "";
        const key = LANGUAGE_MESSAGE_KEYS[code];
        const localized = key ? t(key) : "";

        return localized && localized !== key ? localized : fallback;
    }

    global.MangoTLI18n = {
        getLocale,
        languageLabel,
        localizeDocument,
        t,
    };
})(globalThis);

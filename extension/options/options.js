const DEFAULT_SETTINGS = {
    serverUrl: "http://localhost:8787",
};
const LANGUAGE_PREFS_KEY = "mangotlLanguagePreferences";
const { languageLabel, localizeDocument, t } = MangoTLI18n;

const state = {
    serverConfig: null,
    languagePreferences: {},
};

const form = document.getElementById("options-form");
const serverUrl = document.getElementById("server-url");
const targetLanguage = document.getElementById("target-language");
const serverStatus = document.getElementById("server-status");
const saveStatus = document.getElementById("save-status");

localizeDocument();
document.addEventListener("DOMContentLoaded", restoreOptions);
form.addEventListener("submit", saveOptions);
serverUrl.addEventListener("change", () => refreshServerConfig(serverUrl.value));

async function restoreOptions() {
    const settings = {
        ...DEFAULT_SETTINGS,
        ...(await browser.storage.local.get(Object.keys(DEFAULT_SETTINGS))),
    };

    serverUrl.value = settings.serverUrl;
    state.languagePreferences = await readLanguagePreferences();
    await refreshServerConfig(settings.serverUrl);
}

async function saveOptions(event) {
    event.preventDefault();

    const nextServerUrl = normalizeServerUrl(serverUrl.value);
    await browser.storage.local.set({
        serverUrl: nextServerUrl,
    });

    if (targetLanguage.value) {
        state.languagePreferences = {
            targetLanguage: targetLanguage.value,
        };
        await browser.storage.local.set({ [LANGUAGE_PREFS_KEY]: state.languagePreferences });
    }

    serverUrl.value = nextServerUrl;
    saveStatus.textContent = t("optionsSavedStatus");
    setTimeout(() => {
        saveStatus.textContent = "";
    }, 1600);
}

async function refreshServerConfig(rawServerUrl) {
    const normalizedServerUrl = normalizeServerUrl(rawServerUrl);
    serverStatus.textContent = t("optionsServerStatusLoading");
    setLanguageControlsEnabled(false);

    try {
        state.serverConfig = await fetchServerConfig(normalizedServerUrl);
        renderLanguageControls();
        serverStatus.textContent = t("optionsServerStatusLoaded");
    } catch (error) {
        state.serverConfig = null;
        clearLanguageControls();
        serverStatus.textContent = t("optionsServerStatusUnavailable", error.message);
    }
}

async function fetchServerConfig(baseUrl) {
    const response = await fetch(`${baseUrl}/api/config`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const config = await response.json();

    return {
        defaults: config?.defaults || {},
        languages: config?.languages || {},
    };
}

async function readLanguagePreferences() {
    const stored = await browser.storage.local.get(LANGUAGE_PREFS_KEY);
    const preferences = stored[LANGUAGE_PREFS_KEY];
    return preferences && typeof preferences === "object" && !Array.isArray(preferences) && preferences.targetLanguage
        ? { targetLanguage: preferences.targetLanguage }
        : {};
}

function renderLanguageControls() {
    const defaults = state.serverConfig?.defaults || {};
    const targetOptions = state.serverConfig?.languages?.targets || [];
    const selectedTarget = firstAvailableLanguage(targetOptions, state.languagePreferences.targetLanguage, defaults.targetLanguage);

    renderLanguageOptions(targetLanguage, targetOptions, selectedTarget);
    setLanguageControlsEnabled(targetOptions.length > 0);
}

function renderLanguageOptions(select, options, selectedCode) {
    select.textContent = "";

    for (const option of options) {
        const element = document.createElement("option");
        element.value = option.code;
        element.textContent = languageLabel(option);
        element.selected = option.code === selectedCode;
        select.append(element);
    }
}

function clearLanguageControls() {
    targetLanguage.textContent = "";
    setLanguageControlsEnabled(false);
}

function setLanguageControlsEnabled(enabled) {
    targetLanguage.disabled = !enabled;
}

function firstAvailableLanguage(options, ...codes) {
    for (const code of codes) {
        if (code && options.some((option) => option.code === code)) {
            return code;
        }
    }

    return options[0]?.code || "";
}

function normalizeServerUrl(value) {
    return (value || DEFAULT_SETTINGS.serverUrl).trim().replace(/\/$/, "");
}

const DEFAULT_SETTINGS = {
    serverUrl: "http://localhost:8787",
    imageFetchStrategy: "canvas-first",
    imageFetchCredentials: "omit",
    canvasQuality: 0.95,
};
const LANGUAGE_PREFS_KEY = "mangotlLanguagePreferences";
const { getLocale, languageLabel, localizeDocument, t } = MangoTLI18n;

const state = {
    serverConfig: null,
    languagePreferences: {},
    currentServerUrl: "",
};

let original = null;

const messageEl = document.getElementById("message");
const serverUrlEl = document.getElementById("server-url");
const targetLanguageEl = document.getElementById("target-language");
const imageFetchStrategyEl = document.getElementById("image-fetch-strategy");
const imageFetchCredentialsEl = document.getElementById("image-fetch-credentials");
const canvasQualityEl = document.getElementById("canvas-quality");
const languageStatusEl = document.getElementById("language-status");
const statusDotEl = document.getElementById("status-dot");
const statusTextEl = document.getElementById("status-text");
const serverInfoEl = document.getElementById("server-info");
const infoNameEl = document.getElementById("info-name");
const infoVersionEl = document.getElementById("info-version");
const infoProviderEl = document.getElementById("info-provider");
const infoConfiguredEl = document.getElementById("info-configured");
const infoDetectionEl = document.getElementById("info-detection");
const infoOcrEl = document.getElementById("info-ocr");
const unavailableNoticeEl = document.getElementById("server-unavailable-notice");
const installGuideLinkEl = document.getElementById("install-guide-link");
const serverRoutingEl = document.getElementById("server-routing");
const routingBodyEl = document.getElementById("routing-body");

localizeDocument();
installGuideLinkEl.href = readmeServerInstallUrl();
document.addEventListener("DOMContentLoaded", loadSettings);

function readmeServerInstallUrl() {
    const isKo = getLocale() === "ko";
    const file = isKo ? "README_ko.md" : "README.md";
    const anchor = isKo ? "서버-설치-및-설정" : "server-install-and-setup";
    return `https://github.com/gpdir16/MangoTL/blob/main/${file}#${anchor}`;
}

function qualityOr(raw, fallback) {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(Math.max(parsed, 0.1), 1);
}

// Normalized form state: an empty canvas-quality field falls back to the saved
// value, so clearing it counts as "no change".
function formSnapshot() {
    const saved = original || {};
    return {
        serverUrl: serverUrlEl.value.trim(),
        targetLanguage: targetLanguageEl.value,
        imageFetchStrategy: imageFetchStrategyEl.value,
        imageFetchCredentials: imageFetchCredentialsEl.value,
        canvasQuality: qualityOr(canvasQualityEl.value, saved.canvasQuality ?? DEFAULT_SETTINGS.canvasQuality),
    };
}

function updateFieldButtons() {
    const snapshot = formSnapshot();
    const saved = original || {};

    for (const key of ["serverUrl", "targetLanguage", "imageFetchStrategy", "imageFetchCredentials", "canvasQuality"]) {
        const button = document.querySelector(`[data-save="${key}"]`);
        const changed = snapshot[key] !== saved[key];
        button.hidden = key === "targetLanguage" ? !(targetLanguageEl.disabled === false && changed) : !changed;
    }
}

let messageTimer = null;

function showMessage(text, kind) {
    messageEl.textContent = text;
    messageEl.className = kind || "";
    if (kind === "success") {
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => {
            messageEl.textContent = "";
            messageEl.className = "";
        }, 4000);
    }
}

async function loadSettings() {
    const settings = {
        ...DEFAULT_SETTINGS,
        ...(await browser.storage.local.get([...Object.keys(DEFAULT_SETTINGS), LANGUAGE_PREFS_KEY])),
    };

    serverUrlEl.value = settings.serverUrl;
    imageFetchStrategyEl.value = settings.imageFetchStrategy || DEFAULT_SETTINGS.imageFetchStrategy;
    imageFetchCredentialsEl.value = settings.imageFetchCredentials || DEFAULT_SETTINGS.imageFetchCredentials;
    canvasQualityEl.value = parseFloat(settings.canvasQuality) || DEFAULT_SETTINGS.canvasQuality;
    state.languagePreferences = normalizeLanguagePreferences(settings[LANGUAGE_PREFS_KEY]);

    await refreshServerConfig(settings.serverUrl);
    startHealthPolling();
}

const HEALTH_POLL_INTERVAL = 10000;
let healthPollTimer = null;

function startHealthPolling() {
    if (healthPollTimer !== null) {
        return;
    }
    healthPollTimer = setInterval(pollServerHealth, HEALTH_POLL_INTERVAL);
}

async function refreshServerConfig(rawServerUrl) {
    const normalizedServerUrl = normalizeServerUrl(rawServerUrl);
    state.currentServerUrl = normalizedServerUrl;
    languageStatusEl.textContent = t("optionsServerStatusLoading");
    setLanguageControlsEnabled(false);
    setServerHealthPending();

    const [configResult, healthResult] = await Promise.allSettled([fetchServerConfig(normalizedServerUrl), fetchServerHealth(normalizedServerUrl)]);

    if (configResult.status === "fulfilled") {
        state.serverConfig = configResult.value;
        renderLanguageControls();
        languageStatusEl.textContent = t("optionsServerStatusLoaded");
    } else {
        state.serverConfig = null;
        clearLanguageControls();
        languageStatusEl.textContent = t("optionsServerStatusUnavailable", configResult.reason.message);
    }

    renderServerHealth(healthResult.status === "fulfilled" ? healthResult.value : null);

    original = formSnapshot();
    updateFieldButtons();
}

async function fetchServerHealth(baseUrl) {
    const response = await fetch(`${baseUrl}/health`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
}

function setServerHealthPending() {
    statusDotEl.className = "status-dot checking";
    statusTextEl.textContent = t("optionsServerStatusChecking");
    serverInfoEl.hidden = true;
    serverRoutingEl.hidden = true;
    unavailableNoticeEl.hidden = true;
}

function renderServerHealth(health) {
    if (!health) {
        statusDotEl.className = "status-dot disconnected";
        statusTextEl.textContent = t("optionsServerStatusDisconnected");
        serverInfoEl.hidden = true;
        serverRoutingEl.hidden = true;
        unavailableNoticeEl.hidden = false;
        return;
    }

    statusDotEl.className = "status-dot connected";
    statusTextEl.textContent = t("optionsServerStatusConnected");
    unavailableNoticeEl.hidden = true;

    infoNameEl.textContent = health.name || "";
    infoVersionEl.textContent = health.version || "";
    infoProviderEl.textContent = health.defaultProvider || "—";
    infoConfiguredEl.textContent = health.configured ? t("optionsServerInferenceReadyYes") : t("optionsServerInferenceReadyNo");
    infoDetectionEl.textContent = health.detectionEngine || "—";
    infoOcrEl.textContent = health.ocrEngine || "—";
    serverInfoEl.hidden = false;

    renderRoutingTable(health.ocrRouting || {});
}

function renderRoutingTable(routing) {
    routingBodyEl.textContent = "";

    const entries = Object.entries(routing);
    if (entries.length === 0) {
        const row = document.createElement("tr");
        row.className = "routing-empty";
        const cell = document.createElement("td");
        cell.colSpan = 3;
        cell.textContent = t("optionsServerRoutingEmpty");
        row.append(cell);
        routingBodyEl.append(row);
        serverRoutingEl.hidden = false;
        return;
    }

    for (const [language, engines] of entries) {
        const row = document.createElement("tr");
        const langCell = document.createElement("td");
        const detectionCell = document.createElement("td");
        const ocrCell = document.createElement("td");

        langCell.textContent = language;
        detectionCell.textContent = engines?.detectionEngine || "—";
        ocrCell.textContent = engines?.ocrEngine || "—";
        row.append(langCell, detectionCell, ocrCell);
        routingBodyEl.append(row);
    }

    serverRoutingEl.hidden = false;
}

async function pollServerHealth() {
    if (document.hidden || !state.currentServerUrl) {
        return;
    }

    let health = null;
    try {
        health = await fetchServerHealth(state.currentServerUrl);
    } catch {
        health = null;
    }
    renderServerHealth(health);
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

function renderLanguageControls() {
    const defaults = state.serverConfig?.defaults || {};
    const targetOptions = state.serverConfig?.languages?.targets || [];
    const selectedTarget = firstAvailableLanguage(targetOptions, state.languagePreferences.targetLanguage, defaults.targetLanguage);

    renderLanguageOptions(targetLanguageEl, targetOptions, selectedTarget);
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
    targetLanguageEl.textContent = "";
    setLanguageControlsEnabled(false);
}

function setLanguageControlsEnabled(enabled) {
    targetLanguageEl.disabled = !enabled;
}

function normalizeLanguagePreferences(preferences) {
    return preferences && typeof preferences === "object" && !Array.isArray(preferences) && preferences.targetLanguage
        ? { targetLanguage: preferences.targetLanguage }
        : {};
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

async function saveField(key) {
    const snapshot = formSnapshot();
    const button = document.querySelector(`[data-save="${key}"]`);
    button.disabled = true;

    try {
        if (key === "serverUrl") {
            const nextServerUrl = normalizeServerUrl(snapshot.serverUrl);
            await browser.storage.local.set({ serverUrl: nextServerUrl });
            serverUrlEl.value = nextServerUrl;
            await refreshServerConfig(nextServerUrl);
        } else if (key === "targetLanguage") {
            if (!snapshot.targetLanguage) {
                button.disabled = false;
                return;
            }
            state.languagePreferences = { targetLanguage: snapshot.targetLanguage };
            await browser.storage.local.set({ [LANGUAGE_PREFS_KEY]: state.languagePreferences });
            original[key] = snapshot[key];
        } else if (key === "canvasQuality") {
            await browser.storage.local.set({ canvasQuality: snapshot.canvasQuality });
            canvasQualityEl.value = snapshot.canvasQuality;
            original[key] = snapshot.canvasQuality;
        } else {
            await browser.storage.local.set({ [key]: snapshot[key] });
            original[key] = snapshot[key];
        }
    } catch (error) {
        button.disabled = false;
        showMessage(t("optionsSaveError", error.message || ""), "error");
        return;
    }

    button.disabled = false;
    updateFieldButtons();
    showMessage(t("optionsSaveSuccess"), "success");
}

const HASH_BY_TAB = { server: "server", language: "language", image: "image" };
const TAB_BY_HASH = { server: "server", language: "language", image: "image" };

function activateTab(tabId) {
    document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("active", item.dataset.tab === tabId));
    document.querySelectorAll(".panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `panel-${tabId}`);
    });
}

function tabFromHash() {
    return TAB_BY_HASH[location.hash.slice(1)] || "server";
}

document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
        const tabId = tab.dataset.tab;
        if (!tabId) {
            return;
        }
        activateTab(tabId);
        if (location.hash !== `#${HASH_BY_TAB[tabId]}`) {
            location.hash = HASH_BY_TAB[tabId];
        }
    });
});

window.addEventListener("hashchange", () => activateTab(tabFromHash()));
activateTab(tabFromHash());

document
    .getElementById("help-btn")
    .addEventListener("click", () =>
        window.open(`https://github.com/gpdir16/MangoTL/blob/main/${getLocale() === "ko" ? "README_ko.md" : "README.md"}`, "_blank", "noopener"),
    );

serverUrlEl.addEventListener("input", updateFieldButtons);
targetLanguageEl.addEventListener("change", updateFieldButtons);
imageFetchStrategyEl.addEventListener("change", updateFieldButtons);
imageFetchCredentialsEl.addEventListener("change", updateFieldButtons);
canvasQualityEl.addEventListener("input", updateFieldButtons);

document.querySelectorAll(".field-save").forEach((button) => {
    button.addEventListener("click", () => saveField(button.dataset.save));
});

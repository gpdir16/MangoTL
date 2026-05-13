const DEFAULT_SETTINGS = {
    serverUrl: "http://localhost:8787",
};
const LANGUAGE_PREFS_KEY = "mangotlLanguagePreferences";
const { languageLabel, t } = MangoTLI18n;
const OVERLAY_INTERACTIVE_SELECTOR = ".mangotl-overlay-container, .mangotl-translation-popup, .mangotl-status-panel";

const overlayState = {
    serverUrl: DEFAULT_SETTINGS.serverUrl,
    serverConfig: null,
    serverAvailable: true,
    languagePreferences: {},
    website: null,
    sourceLanguage: "",
    targetLanguage: "",
    translationContext: "",
    controlsByImage: new Map(),
    resultsByKey: new Map(),
    inFlightByKey: new Map(),
    resizeObserver: null,
    overlayUpdateFrame: null,
    overlayReconcileFrame: null,
    configRefreshTimer: null,
    activeControl: null,
    activeStatusControl: null,
    translationPopup: null,
    serverStatusPopup: null,
};

window.addEventListener("resize", scheduleOverlayUpdate);
window.addEventListener("scroll", scheduleOverlayUpdate, { passive: true });
document.addEventListener("click", handleDocumentClick, true);
document.addEventListener("keydown", handleDocumentKeydown, true);
document.addEventListener("load", handleImageLoad, true);
browser.storage.onChanged.addListener(handleStorageChange);

installSpaNavigationGuards();
installDomChangeGuard();
scheduleConfigurationRefresh(0);

function handleStorageChange(changes, areaName) {
    if (areaName !== "local") {
        return;
    }

    if (changes.serverUrl || changes[LANGUAGE_PREFS_KEY]) {
        scheduleConfigurationRefresh();
    }
}

function handleImageLoad(event) {
    if (overlayState.website && event.target instanceof HTMLImageElement) {
        scheduleOverlayReconcile();
    }
}

function handleDocumentClick(event) {
    if (!(event.target instanceof Element) || event.target.closest(OVERLAY_INTERACTIVE_SELECTOR)) {
        return;
    }

    closeTranslationPopup();
    hideAllServerUnavailableNotices();
}

function handleDocumentKeydown(event) {
    if (event.key !== "Escape") {
        return;
    }

    if (isTranslationPopupOpen()) {
        closeTranslationPopup();
    }

    if (isServerUnavailableNoticeOpen()) {
        hideAllServerUnavailableNotices();
    }
}

function installSpaNavigationGuards() {
    const scheduleRefresh = () => scheduleConfigurationRefresh(120);

    for (const methodName of ["pushState", "replaceState"]) {
        const original = history[methodName];

        history[methodName] = function patchedHistoryMethod(...args) {
            const result = original.apply(this, args);
            setTimeout(scheduleRefresh, 0);
            return result;
        };
    }

    window.addEventListener("popstate", scheduleRefresh);
    window.addEventListener("hashchange", scheduleRefresh);
}

function installDomChangeGuard() {
    const observer = new MutationObserver((mutations) => {
        if (mutations.every(isOverlayOnlyMutation)) {
            return;
        }

        if (overlayState.website) {
            scheduleOverlayReconcile();
        }
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
    });
}

function isOverlayOnlyMutation(mutation) {
    const target = mutation.target;

    if (isOverlayNode(target)) {
        return true;
    }

    return [...mutation.addedNodes, ...mutation.removedNodes].every(isOverlayNode);
}

function isOverlayNode(node) {
    return node instanceof Element && Boolean(node.closest(OVERLAY_INTERACTIVE_SELECTOR));
}

function scheduleConfigurationRefresh(delay = 150) {
    if (overlayState.configRefreshTimer !== null) {
        clearTimeout(overlayState.configRefreshTimer);
    }

    overlayState.configRefreshTimer = setTimeout(() => {
        overlayState.configRefreshTimer = null;
        refreshConfiguration().catch((error) => {
            console.debug("[MangoTL-Content] Configuration unavailable:", error.message);
            overlayState.serverAvailable = false;
        });
    }, delay);
}

async function refreshConfiguration() {
    const settings = {
        ...DEFAULT_SETTINGS,
        ...(await browser.storage.local.get(Object.keys(DEFAULT_SETTINGS))),
    };
    const serverUrl = normalizeServerUrl(settings.serverUrl);
    let serverConfig = null;
    let serverAvailable = true;

    try {
        serverConfig = await fetchServerConfig(serverUrl);
    } catch {
        serverAvailable = false;
        serverConfig = await fetchBundledServerConfig();
    }

    const website = matchWebsite(location.href, serverConfig?.websites || []);
    const languagePreferences = await readLanguagePreferences();
    const sourceLanguage = chooseSourceLanguage(serverConfig, website);
    const targetLanguage = chooseTargetLanguage(serverConfig, languagePreferences);
    const translationContext = [serverUrl, website?.id || "", sourceLanguage, targetLanguage].join("|");
    const contextChanged = overlayState.translationContext && overlayState.translationContext !== translationContext;

    overlayState.serverUrl = serverUrl;
    overlayState.serverConfig = serverConfig;
    overlayState.serverAvailable = serverAvailable;
    overlayState.languagePreferences = languagePreferences;
    overlayState.website = website || null;
    overlayState.sourceLanguage = sourceLanguage;
    overlayState.targetLanguage = targetLanguage;
    overlayState.translationContext = translationContext;

    if (contextChanged) {
        abortInFlightTranslations();
        overlayState.resultsByKey.clear();
        clearOverlays();
    }

    if (!website) {
        clearOverlays();
        return;
    }

    reconcileOverlays();
}

async function fetchServerConfig(serverUrl) {
    const response = await fetch(`${serverUrl}/api/config`);

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const config = await response.json();

    return normalizeServerConfig(config);
}

async function fetchBundledServerConfig() {
    const response = await fetch(browser.runtime.getURL("config/public-config.json"));

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    return normalizeServerConfig(await response.json());
}

function normalizeServerConfig(config) {
    return {
        defaults: config?.defaults || {},
        languages: config?.languages || {},
        websites: Array.isArray(config?.websites) ? config.websites : [],
    };
}

async function readLanguagePreferences() {
    const stored = await browser.storage.local.get(LANGUAGE_PREFS_KEY);
    const preferences = stored[LANGUAGE_PREFS_KEY];
    return preferences && typeof preferences === "object" && !Array.isArray(preferences) && preferences.targetLanguage
        ? { targetLanguage: preferences.targetLanguage }
        : {};
}

function chooseSourceLanguage(serverConfig, website) {
    const sourceOptions = serverConfig?.languages?.sources || [];
    return firstAvailableLanguage(sourceOptions, website?.sourceLanguage, serverConfig?.defaults?.sourceLanguage);
}

function chooseTargetLanguage(serverConfig, preferences) {
    const targetOptions = serverConfig?.languages?.targets || [];
    return firstAvailableLanguage(targetOptions, preferences?.targetLanguage, serverConfig?.defaults?.targetLanguage);
}

function firstAvailableLanguage(options, ...codes) {
    for (const code of codes) {
        if (!code) {
            continue;
        }

        if (options.length === 0 || options.some((option) => option.code === code)) {
            return code;
        }
    }

    return options[0]?.code || "";
}

function matchWebsite(rawUrl, websites) {
    if (!rawUrl) {
        return null;
    }

    let url;

    try {
        url = new URL(rawUrl);
    } catch {
        return null;
    }

    return websites.find((website) => website.hostPatterns.some((pattern) => hostMatchesPattern(url.hostname, pattern)));
}

function hostMatchesPattern(hostname, pattern) {
    if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(2);
        return hostname === suffix || hostname.endsWith(`.${suffix}`);
    }

    return hostname === pattern;
}

function collectImageElements(website) {
    const entries = [];
    const seenElements = new Set();
    const selectors = Array.isArray(website?.imageSelectors) ? website.imageSelectors : [];

    for (const selector of selectors) {
        for (const element of document.querySelectorAll(selector)) {
            if (!(element instanceof HTMLImageElement) || seenElements.has(element)) {
                continue;
            }

            const rect = element.getBoundingClientRect();
            const width = element.naturalWidth || rect.width;
            const height = element.naturalHeight || rect.height;

            if (width < (website.minImageWidth || 1) || height < (website.minImageHeight || 1)) {
                continue;
            }

            const url = normalizeImageUrl(element.currentSrc || element.src, website.urlNormalizer || {});

            if (!url || !matchesUrlFilters(url, website)) {
                continue;
            }

            const key = getImageKey(url, website.imageKeyPattern);

            seenElements.add(element);
            entries.push({
                element,
                url,
                key,
                identity: key || url,
            });
        }
    }

    return entries;
}

function getImageKey(url, pattern) {
    if (!pattern?.match) {
        return url;
    }

    let match;

    try {
        match = url.match(new RegExp(pattern.match, pattern.flags || ""));
    } catch {
        return url;
    }

    return match?.[pattern.group || 1] || url;
}

function normalizeImageUrl(rawUrl, normalizer) {
    if (!rawUrl) {
        return null;
    }

    let url;

    try {
        url = new URL(rawUrl, location.href);
    } catch {
        return null;
    }

    if (normalizer.stripHash) {
        url.hash = "";
    }

    if (normalizer.stripQuery) {
        url.search = "";
    }

    return url.toString();
}

function matchesUrlFilters(url, website) {
    const includePatterns = website.includeUrlPatterns || [];
    const excludePatterns = website.excludeUrlPatterns || [];

    if (includePatterns.length > 0 && !includePatterns.some((pattern) => url.includes(pattern))) {
        return false;
    }

    return !excludePatterns.some((pattern) => url.includes(pattern));
}

function scheduleOverlayUpdate() {
    if (overlayState.overlayUpdateFrame !== null) {
        return;
    }

    overlayState.overlayUpdateFrame = requestAnimationFrame(() => {
        overlayState.overlayUpdateFrame = null;
        updateOverlayPositions();
    });
}

function scheduleOverlayReconcile() {
    if (overlayState.overlayReconcileFrame !== null) {
        return;
    }

    overlayState.overlayReconcileFrame = requestAnimationFrame(() => {
        overlayState.overlayReconcileFrame = null;
        reconcileOverlays();
    });
}

function reconcileOverlays() {
    if (!overlayState.website) {
        clearOverlays();
        return;
    }

    const imageEntries = collectImageElements(overlayState.website);
    const entriesByImage = new Map(imageEntries.map((entry) => [entry.element, entry]));

    for (const [image, control] of overlayState.controlsByImage) {
        const nextEntry = entriesByImage.get(image);

        if (!nextEntry || control.container.parentElement !== image.parentElement) {
            removeControl(image);
        }
    }

    ensureResizeObserver();

    for (const entry of imageEntries) {
        let control = overlayState.controlsByImage.get(entry.element);

        if (!control) {
            control = createImageControl(entry);
        }

        control.entry = entry;

        const translationKey = getControlTranslationKey(control);
        const result = overlayState.resultsByKey.get(translationKey);
        const inFlight = overlayState.inFlightByKey.has(translationKey);

        renderImageResult(control, result);

        setButtonState(control, getControlState(result, inFlight));
    }

    updateOverlayPositions();
}

function ensureResizeObserver() {
    if (!overlayState.resizeObserver) {
        overlayState.resizeObserver = new ResizeObserver(scheduleOverlayUpdate);
    }
}

function ensureServerStatusPopup() {
    if (overlayState.serverStatusPopup) {
        return overlayState.serverStatusPopup;
    }

    const panel = document.createElement("div");
    panel.className = "mangotl-status-panel";
    panel.hidden = true;
    panel.addEventListener("click", (event) => event.stopPropagation());

    const title = document.createElement("div");
    title.className = "mangotl-status-title";
    title.textContent = t("contentServerUnavailableTitle");

    const body = document.createElement("div");
    body.className = "mangotl-status-body";
    body.textContent = t("contentServerUnavailableBody");

    const actions = document.createElement("div");
    actions.className = "mangotl-status-actions";

    const openSettings = document.createElement("button");
    openSettings.type = "button";
    openSettings.className = "mangotl-status-button";
    openSettings.textContent = t("contentOpenSettings");
    openSettings.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        hideAllServerUnavailableNotices();
        openOptionsPage();
    });

    actions.append(openSettings);
    panel.append(title, body, actions);
    (document.body || document.documentElement).append(panel);

    overlayState.serverStatusPopup = {
        element: panel,
        openSettings,
    };

    return overlayState.serverStatusPopup;
}

function createImageControl(entry) {
    const container = createImageOverlayContainer(entry.element);
    const button = document.createElement("button");
    const control = {
        container,
        button,
        sourceLanguage: overlayState.sourceLanguage,
        rendered: null,
        entry,
    };

    button.className = "mangotl-translate-button";
    button.type = "button";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleTranslationPopup(control);
    });

    container.append(button);
    overlayState.controlsByImage.set(entry.element, control);
    overlayState.resizeObserver?.observe(entry.element);

    if (entry.element.parentElement) {
        overlayState.resizeObserver?.observe(entry.element.parentElement);
    }

    return control;
}

function createImageOverlayContainer(image) {
    const wrapper = image.parentElement;

    if (!wrapper) {
        throw new Error("Cannot create overlay for a detached image.");
    }

    const computedStyle = getComputedStyle(wrapper);

    if (computedStyle.position === "static") {
        if (!wrapper.dataset.mangotlPositionPatched) {
            wrapper.dataset.mangotlOriginalPosition = wrapper.style.position || "";
        }
        wrapper.dataset.mangotlPositionPatched = "true";
        wrapper.style.position = "relative";
    }

    const container = document.createElement("div");
    container.className = "mangotl-overlay-container";
    wrapper.appendChild(container);
    syncContainerToImage(container, image);
    return container;
}

function syncContainerToImage(container, image) {
    if (!image.parentElement) {
        container.remove();
        return;
    }

    const imageRect = image.getBoundingClientRect();
    const parentRect = image.parentElement.getBoundingClientRect();
    container.style.left = `${imageRect.left - parentRect.left}px`;
    container.style.top = `${imageRect.top - parentRect.top}px`;
    container.style.width = `${imageRect.width}px`;
    container.style.height = `${imageRect.height}px`;
}

function updateOverlayPositions() {
    for (const [image, control] of overlayState.controlsByImage) {
        const rect = image.getBoundingClientRect();

        if (rect.width === 0 || rect.height === 0 || !image.isConnected) {
            removeControl(image);
            continue;
        }

        syncContainerToImage(control.container, image);
    }

    positionTranslationPopup();
    positionServerStatusPopup();
}

function getControlState(result, inFlight) {
    if (inFlight) {
        return "running";
    }

    if (!result) {
        return "idle";
    }

    return result.renderedImage ? "translated" : "empty";
}

function toggleTranslationPopup(control) {
    if (overlayState.activeControl === control && isTranslationPopupOpen()) {
        closeTranslationPopup(control);
        return;
    }

    openTranslationPopup(control);
}

function openTranslationPopup(control) {
    if (!control?.entry) {
        return;
    }

    const previousControl = overlayState.activeControl;

    if (previousControl && previousControl !== control) {
        previousControl.button?.setAttribute("aria-expanded", "false");
    }

    hideAllServerUnavailableNotices();

    const popup = ensureTranslationPopup();
    overlayState.activeControl = control;
    syncTranslationPopup(control);
    popup.element.hidden = false;
    control.button.setAttribute("aria-expanded", "true");
    positionTranslationPopup();

    requestAnimationFrame(() => {
        popup.translateButton.focus({ preventScroll: true });
    });
}

function closeTranslationPopup(control = overlayState.activeControl) {
    const popup = overlayState.translationPopup;

    if (!popup) {
        return;
    }

    popup.element.hidden = true;

    if (control?.button) {
        control.button.setAttribute("aria-expanded", "false");
    }

    if (!control || overlayState.activeControl === control) {
        overlayState.activeControl = null;
    }
}

function isTranslationPopupOpen() {
    return Boolean(overlayState.translationPopup && overlayState.translationPopup.element.hidden === false);
}

function ensureTranslationPopup() {
    if (overlayState.translationPopup) {
        return overlayState.translationPopup;
    }

    const form = document.createElement("form");
    const sourceRow = document.createElement("div");
    const sourceLabel = document.createElement("span");
    const sourceSelect = document.createElement("select");
    const targetRow = document.createElement("div");
    const targetLabel = document.createElement("span");
    const targetValue = document.createElement("span");
    const actions = document.createElement("div");
    const translateButton = document.createElement("button");
    const closeButton = document.createElement("button");

    form.className = "mangotl-translation-popup";
    form.hidden = true;
    form.noValidate = true;
    form.setAttribute("role", "dialog");
    form.setAttribute("aria-label", t("contentTranslateButton"));
    form.addEventListener("click", (event) => event.stopPropagation());
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const control = overlayState.activeControl;

        if (!control) {
            return;
        }

        translateImageFromControl(control, sourceSelect.value).catch((error) => {
            console.error("[MangoTL-Content] Translation failed:", error);
            setButtonState(control, "failed", error.message || t("contentTitleFailed"));
        });
    });

    sourceRow.className = "mangotl-translation-row";
    sourceLabel.className = "mangotl-translation-label";
    sourceSelect.className = "mangotl-source-select";
    sourceLabel.textContent = t("contentSourceLanguageLabel");

    targetRow.className = "mangotl-translation-row";
    targetLabel.className = "mangotl-translation-label";
    targetValue.className = "mangotl-translation-value";
    targetLabel.textContent = t("contentTargetLanguageLabel");

    actions.className = "mangotl-translation-actions";
    translateButton.className = "mangotl-translation-submit";
    translateButton.type = "submit";
    translateButton.textContent = t("contentTranslateButton");

    closeButton.className = "mangotl-translation-close";
    closeButton.type = "button";
    closeButton.textContent = t("contentCloseButton");
    closeButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeTranslationPopup();
    });

    sourceRow.append(sourceLabel, sourceSelect);
    targetRow.append(targetLabel, targetValue);
    actions.append(translateButton, closeButton);
    form.append(sourceRow, targetRow, actions);
    (document.body || document.documentElement).append(form);

    overlayState.translationPopup = {
        element: form,
        sourceSelect,
        targetValue,
        translateButton,
        closeButton,
    };

    return overlayState.translationPopup;
}

function syncTranslationPopup(control) {
    const popup = ensureTranslationPopup();
    renderSourceLanguageOptions(popup.sourceSelect, control.sourceLanguage || overlayState.sourceLanguage);
    popup.targetValue.textContent = formatLanguage("targets", overlayState.targetLanguage);
}

function renderSourceLanguageOptions(select, selectedLanguage) {
    const options = getSourceLanguageOptions(selectedLanguage);
    select.textContent = "";

    for (const option of options) {
        const element = document.createElement("option");
        element.value = option.code;
        element.textContent = languageLabel(option);
        element.selected = option.code === selectedLanguage;
        select.append(element);
    }
}

function getSourceLanguageOptions(selectedLanguage) {
    const options = overlayState.serverConfig?.languages?.sources || [];

    if (options.length === 0) {
        return [
            {
                code: selectedLanguage || "",
                label: selectedLanguage || t("contentServerDefaultLanguage"),
            },
        ];
    }

    if (!selectedLanguage || options.some((option) => option.code === selectedLanguage)) {
        return options;
    }

    return [
        {
            code: selectedLanguage,
            label: selectedLanguage,
        },
        ...options,
    ];
}

function formatLanguage(group, code) {
    if (!code) {
        return t("contentServerDefaultLanguage");
    }

    const option = overlayState.serverConfig?.languages?.[group]?.find((candidate) => candidate.code === code);
    return languageLabel(option || code);
}

function positionTranslationPopup() {
    const popup = overlayState.translationPopup;
    const control = overlayState.activeControl;

    if (!popup || popup.element.hidden || !control?.button?.isConnected) {
        return;
    }

    if (!positionPopupNearButton(popup.element, control.button)) {
        closeTranslationPopup(control);
    }
}

function positionServerStatusPopup() {
    const popup = overlayState.serverStatusPopup;
    const control = overlayState.activeStatusControl;

    if (!popup || popup.element.hidden || !control?.button?.isConnected) {
        return;
    }

    if (!positionPopupNearButton(popup.element, control.button)) {
        hideServerUnavailableNotice(control);
    }
}

function positionPopupNearButton(element, button) {
    const margin = 10;
    const gap = 4;
    const buttonRect = button.getBoundingClientRect();

    if (
        buttonRect.width === 0 ||
        buttonRect.height === 0 ||
        buttonRect.bottom < 0 ||
        buttonRect.top > window.innerHeight ||
        buttonRect.right < 0 ||
        buttonRect.left > window.innerWidth
    ) {
        return false;
    }

    const popupRect = element.getBoundingClientRect();
    const popupWidth = popupRect.width || 232;
    const popupHeight = popupRect.height || 126;
    const maxLeft = Math.max(margin, window.innerWidth - popupWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - popupHeight - margin);
    const left = clamp(buttonRect.right - popupWidth, margin, maxLeft);
    let top = buttonRect.bottom + gap;
    let placement = "bottom";

    if (top + popupHeight + margin > window.innerHeight) {
        top = buttonRect.top - popupHeight - gap;
        placement = "top";
    }

    if (top < margin) {
        top = clamp(buttonRect.bottom + gap, margin, maxTop);
        placement = "bottom";
    }

    element.dataset.placement = placement;
    element.style.left = `${Math.round(left)}px`;
    element.style.top = `${Math.round(clamp(top, margin, maxTop))}px`;
    return true;
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

async function translateImageFromControl(control, sourceLanguage) {
    const entry = control.entry;

    if (!entry) {
        return;
    }

    closeTranslationPopup(control);

    if (!overlayState.serverAvailable) {
        await refreshConfiguration();

        if (!overlayState.serverAvailable) {
            showServerUnavailableNotice(control);
            return;
        }
    }

    if (!overlayState.controlsByImage.has(entry.element)) {
        return;
    }

    hideAllServerUnavailableNotices();

    const selectedSourceLanguage = sourceLanguage || control.sourceLanguage || overlayState.sourceLanguage;
    const translationKey = getTranslationKey(entry, selectedSourceLanguage);

    if (overlayState.inFlightByKey.has(translationKey)) {
        return;
    }

    control.sourceLanguage = selectedSourceLanguage;
    setMatchingControlsSourceLanguage(entry.identity, selectedSourceLanguage);

    const controller = new AbortController();
    overlayState.inFlightByKey.set(translationKey, controller);
    setMatchingControlsState(translationKey, "running");

    try {
        const result = await requestImageTranslation(entry, selectedSourceLanguage, controller.signal);
        overlayState.resultsByKey.set(translationKey, result);
        renderMatchingImageResults(translationKey, result);
    } catch (error) {
        if (isAbortError(error)) {
            return;
        }

        if (isNetworkFailure(error)) {
            overlayState.serverAvailable = false;
            showServerUnavailableNotice(control);
            return;
        }

        throw error;
    } finally {
        overlayState.inFlightByKey.delete(translationKey);
        reconcileOverlays();
    }
}

async function requestImageTranslation(entry, sourceLanguage, signal) {
    const query = new URLSearchParams();

    if (overlayState.website?.id) {
        query.set("websiteId", overlayState.website.id);
    }

    if (sourceLanguage) {
        query.set("source", sourceLanguage);
    }

    if (overlayState.targetLanguage) {
        query.set("target", overlayState.targetLanguage);
    }

    const queryString = query.toString();
    const response = await fetch(`${overlayState.serverUrl}/api/translate${queryString ? `?${queryString}` : ""}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            imageUrl: entry.url,
        }),
        signal,
    });

    const responseText = await response.text();
    const payload = parseJsonResponse(responseText);

    if (!response.ok) {
        const message = payload?.message || responseText || t("contentServerError", response.status);
        throw new Error(message);
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error(t("contentMissingResultError"));
    }

    return {
        ...payload,
        imageUrl: payload.imageUrl || entry.url,
    };
}

function getControlTranslationKey(control) {
    return getTranslationKey(control.entry, control.sourceLanguage || overlayState.sourceLanguage);
}

function getTranslationKey(entry, sourceLanguage) {
    return [entry.identity, sourceLanguage || "", overlayState.targetLanguage || ""].join("|");
}

function renderMatchingImageResults(translationKey, result) {
    for (const control of overlayState.controlsByImage.values()) {
        if (getControlTranslationKey(control) !== translationKey) {
            continue;
        }

        renderImageResult(control, result);
        setButtonState(control, getControlState(result, false));
    }
}

function setMatchingControlsSourceLanguage(identity, sourceLanguage) {
    for (const control of overlayState.controlsByImage.values()) {
        if (control.entry.identity === identity) {
            control.sourceLanguage = sourceLanguage;
        }
    }
}

function renderImageResult(control, result) {
    if (!result?.renderedImage) {
        control.rendered?.remove();
        control.rendered = null;
        return;
    }

    if (!control.rendered) {
        control.rendered = document.createElement("img");
        control.rendered.className = "mangotl-rendered-image";
        control.container.prepend(control.rendered);
    }

    control.rendered.src = result.renderedImage;
}

function setMatchingControlsState(translationKey, state, message = "") {
    for (const control of overlayState.controlsByImage.values()) {
        if (getControlTranslationKey(control) === translationKey) {
            setButtonState(control, state, message);
        }
    }
}

function setButtonState(control, state, message = "") {
    if (overlayState.serverAvailable) {
        hideServerUnavailableNotice(control);
    }

    const labels = {
        idle: t("contentButtonIdle"),
        running: t("contentButtonRunning"),
        translated: t("contentButtonIdle"),
        empty: t("contentButtonIdle"),
        failed: t("contentButtonFailed"),
    };
    const titles = {
        idle: t("contentTitleIdle"),
        running: t("contentTitleRunning"),
        translated: t("contentTitleTranslated"),
        empty: t("contentTitleEmpty"),
        failed: message || t("contentTitleFailed"),
    };

    control.button.dataset.state = state;
    control.button.textContent = labels[state] || labels.idle;
    control.button.title = titles[state] || titles.idle;
    control.button.setAttribute("aria-label", titles[state] || titles.idle);
    control.button.disabled = state === "running";
}

function showServerUnavailableNotice(control) {
    hideAllServerUnavailableNotices();

    const popup = ensureServerStatusPopup();

    overlayState.activeStatusControl = control;
    popup.element.hidden = false;
    control.button.setAttribute("aria-expanded", "true");
    positionServerStatusPopup();
}

function hideServerUnavailableNotice(control) {
    if (control && overlayState.activeStatusControl && overlayState.activeStatusControl !== control) {
        return;
    }

    const popup = overlayState.serverStatusPopup;

    if (popup) {
        popup.element.hidden = true;
    }

    if (overlayState.activeStatusControl?.button && overlayState.activeControl !== overlayState.activeStatusControl) {
        overlayState.activeStatusControl.button.setAttribute("aria-expanded", "false");
    }

    overlayState.activeStatusControl = null;
}

function hideAllServerUnavailableNotices() {
    hideServerUnavailableNotice();
}

function isServerUnavailableNoticeOpen() {
    return Boolean(overlayState.serverStatusPopup && overlayState.serverStatusPopup.element.hidden === false);
}

function removeControl(image) {
    const control = overlayState.controlsByImage.get(image);

    if (!control) {
        return;
    }

    if (overlayState.activeControl === control) {
        closeTranslationPopup(control);
    }

    if (overlayState.activeStatusControl === control) {
        hideServerUnavailableNotice(control);
    }

    overlayState.resizeObserver?.unobserve(image);

    if (image.parentElement) {
        overlayState.resizeObserver?.unobserve(image.parentElement);
    }

    const parent = control.container.parentElement;
    control.container.remove();
    overlayState.controlsByImage.delete(image);
    restorePatchedParentIfUnused(parent);
}

function abortInFlightTranslations() {
    for (const controller of overlayState.inFlightByKey.values()) {
        controller.abort();
    }

    overlayState.inFlightByKey.clear();
}

function clearOverlays() {
    closeTranslationPopup();
    hideAllServerUnavailableNotices();

    if (overlayState.resizeObserver) {
        overlayState.resizeObserver.disconnect();
        overlayState.resizeObserver = null;
    }

    if (overlayState.overlayUpdateFrame !== null) {
        cancelAnimationFrame(overlayState.overlayUpdateFrame);
        overlayState.overlayUpdateFrame = null;
    }

    if (overlayState.overlayReconcileFrame !== null) {
        cancelAnimationFrame(overlayState.overlayReconcileFrame);
        overlayState.overlayReconcileFrame = null;
    }

    const patchedParents = new Set();

    for (const control of overlayState.controlsByImage.values()) {
        const parent = control.container.parentElement;

        if (parent?.dataset.mangotlPositionPatched === "true") {
            patchedParents.add(parent);
        }

        control.container.remove();
    }

    overlayState.controlsByImage.clear();

    for (const parent of patchedParents) {
        restorePatchedParentIfUnused(parent);
    }
}

function restorePatchedParentIfUnused(parent) {
    if (!parent?.dataset || parent.dataset.mangotlPositionPatched !== "true") {
        return;
    }

    const hasOverlayChild = [...parent.children].some((child) => child.classList?.contains("mangotl-overlay-container"));

    if (hasOverlayChild) {
        return;
    }

    if (parent.style.position === "relative") {
        parent.style.position = parent.dataset.mangotlOriginalPosition || "";
    }

    delete parent.dataset.mangotlPositionPatched;
    delete parent.dataset.mangotlOriginalPosition;
}

function normalizeServerUrl(serverUrl) {
    return (serverUrl || DEFAULT_SETTINGS.serverUrl).trim().replace(/\/$/, "");
}

function parseJsonResponse(responseText) {
    if (!responseText) {
        return null;
    }

    try {
        return JSON.parse(responseText);
    } catch {
        return null;
    }
}

async function openOptionsPage() {
    try {
        const response = await browser.runtime.sendMessage({ type: "MANGOTL_OPEN_OPTIONS" });

        if (response?.ok) {
            return;
        }
    } catch {}

    try {
        const optionsUrl = browser?.runtime?.getURL?.("options/options.html");

        if (optionsUrl) {
            window.open(optionsUrl, "_blank", "noopener,noreferrer");
        }
    } catch {}
}

function isAbortError(error) {
    return error?.name === "AbortError";
}

function isNetworkFailure(error) {
    if (!error || error?.name === "AbortError") {
        return false;
    }

    if (error instanceof TypeError) {
        return true;
    }

    const message = String(error.message || "");
    return /failed to fetch|networkerror|load failed/i.test(message);
}

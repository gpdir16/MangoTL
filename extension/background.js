const DEFAULT_SETTINGS = {
    serverUrl: "http://localhost:8787",
    imageFetchStrategy: "canvas-first",
    imageFetchCredentials: "omit",
    canvasQuality: 0.95,
    translatePassword: "",
};
const LANGUAGE_PREFS_KEY = "mangotlLanguagePreferences";

browser.runtime.onInstalled.addListener(async () => {
    const existing = await browser.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    const missing = Object.fromEntries(Object.entries(DEFAULT_SETTINGS).filter(([key]) => existing[key] === undefined));

    if (Object.keys(missing).length > 0) {
        await browser.storage.local.set(missing);
    }

    await browser.storage.local.remove(["targetLanguage", "mangotlProgressByTab"]);
    await removeStoredSourceLanguagePreferences();
});

const activeTranslations = new Map();

browser.runtime.onMessage.addListener((message) => {
    if (message?.type === "MANGOTL_OPEN_OPTIONS") {
        return browser.runtime.openOptionsPage().then(
            () => ({ ok: true }),
            (error) => ({ ok: false, message: error?.message || "Failed to open options." }),
        );
    }

    if (message?.type === "MANGOTL_FETCH_IMAGE") {
        return fetchImageBytes(message.url, message.imageFetch);
    }

    if (message?.type === "MANGOTL_FETCH_CONFIG") {
        return proxyServerConfig(message.serverUrl);
    }

    if (message?.type === "MANGOTL_TRANSLATE_IMAGE") {
        const existing = activeTranslations.get(message.translationKey);
        if (existing) {
            existing.abort();
        }

        const controller = new AbortController();
        activeTranslations.set(message.translationKey, controller);

        return proxyTranslateImage(message, controller.signal).finally(() => {
            if (activeTranslations.get(message.translationKey) === controller) {
                activeTranslations.delete(message.translationKey);
            }
        });
    }

    if (message?.type === "MANGOTL_ABORT_TRANSLATION") {
        const controller = activeTranslations.get(message.translationKey);
        if (controller) {
            controller.abort();
            activeTranslations.delete(message.translationKey);
        }
        return { ok: true };
    }

    return undefined;
});

async function fetchImageBytes(url, imageFetch = {}, credentials) {
    const response = await fetch(url, {
        headers: {
            Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        },
        referrer: imageFetch.referrer || undefined,
        referrerPolicy: imageFetch.referrerPolicy || undefined,
        credentials: credentials || "omit",
    });

    if (!response.ok) {
        throw new Error(`Failed to read image (HTTP ${response.status}).`);
    }

    const contentType = response.headers.get("content-type") || "application/octet-stream";

    if (!contentType.startsWith("image/")) {
        throw new Error(`The selected resource is not an image (${contentType}).`);
    }

    return {
        buffer: await response.arrayBuffer(),
        contentType,
    };
}

async function fetchImageBytesFromDataUrl(dataUrl) {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return {
        buffer: await blob.arrayBuffer(),
        contentType: blob.type || "image/jpeg",
    };
}

async function proxyServerConfig(serverUrl) {
    const response = await fetch(`${serverUrl}/api/config`);
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
}

async function proxyTranslateImage(params, signal) {
    const {
        serverUrl,
        imageUrl,
        imageDataUrl,
        imageFetch,
        imageFetchCredentials,
        imageId,
        sourceLanguage,
        targetLanguage,
        websiteId,
        translatePassword,
    } = params;
    const image = imageDataUrl ? await fetchImageBytesFromDataUrl(imageDataUrl) : await fetchImageBytes(imageUrl, imageFetch, imageFetchCredentials);
    const formData = new FormData();
    formData.append("image", new Blob([image.buffer], { type: image.contentType }), "image");
    formData.append("imageId", imageId || "image");

    const query = new URLSearchParams();
    if (sourceLanguage) query.set("source", sourceLanguage);
    if (targetLanguage) query.set("target", targetLanguage);
    if (websiteId) query.set("websiteId", websiteId);
    const queryString = query.toString();

    const headers = {};
    if (translatePassword) {
        headers["X-Access-Key"] = translatePassword;
    }

    const response = await fetch(`${serverUrl}/api/translate${queryString ? `?${queryString}` : ""}`, {
        method: "POST",
        body: formData,
        headers,
        signal,
    });

    const responseText = await response.text();
    let payload = null;
    try {
        payload = JSON.parse(responseText);
    } catch {}

    if (!response.ok) {
        throw new Error(payload?.message || responseText || `Server error: ${response.status}`);
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new Error("The server response did not include a translation result.");
    }

    return {
        ...payload,
        imageId: payload.imageId || imageId || null,
    };
}

async function removeStoredSourceLanguagePreferences() {
    const stored = await browser.storage.local.get(LANGUAGE_PREFS_KEY);
    const preferences = stored[LANGUAGE_PREFS_KEY];

    if (!preferences || typeof preferences !== "object" || Array.isArray(preferences)) {
        return;
    }

    await browser.storage.local.set({
        [LANGUAGE_PREFS_KEY]: preferences.targetLanguage ? { targetLanguage: preferences.targetLanguage } : {},
    });
}

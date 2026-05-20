const DEFAULT_SETTINGS = {
    serverUrl: "http://localhost:8787",
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

    return undefined;
});

async function fetchImageBytes(url, imageFetch = {}) {
    const response = await fetch(url, {
        headers: {
            Accept: "image/avif,image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
        },
        referrer: imageFetch.referrer || undefined,
        referrerPolicy: imageFetch.referrerPolicy || undefined,
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

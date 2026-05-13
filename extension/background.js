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
    if (message?.type !== "MANGOTL_OPEN_OPTIONS") {
        return undefined;
    }

    return browser.runtime.openOptionsPage().then(
        () => ({ ok: true }),
        (error) => ({ ok: false, message: error?.message || "Failed to open options." }),
    );
});

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

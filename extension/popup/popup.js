MangoTLI18n.localizeDocument();

document.getElementById("options-button").addEventListener("click", async () => {
    await browser.runtime.openOptionsPage();
    window.close();
});

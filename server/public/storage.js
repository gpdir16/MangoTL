import { createRowActions } from "/config/row-actions.js";

export function createStorageView({ t, getAccessKey, onUnauthorized, showMessage }) {
    const LABEL_KEYS = {
        "image-cache": "storageImageCache",
        settings: "storageSettings",
    };
    let entries = [];

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
        if (bytes < 1000) return `${bytes} B`;
        if (bytes < 1000000) return `${(bytes / 1000).toFixed(1)} KB`;
        if (bytes < 1000000000) return `${(bytes / 1000000).toFixed(1)} MB`;
        return `${(bytes / 1000000000).toFixed(2)} GB`;
    }

    async function load() {
        const errorElement = document.getElementById("storage-error");
        try {
            const response = await fetch("/api/storage", { headers: { "X-Access-Key": getAccessKey() } });
            if (response.status === 401) {
                onUnauthorized();
                return;
            }
            const data = await response.json().catch(() => null);
            if (!response.ok || !Array.isArray(data)) {
                throw new Error(data?.message || t("storageLoadError"));
            }
            entries = data;
            errorElement.hidden = true;
        } catch (error) {
            entries = [];
            errorElement.textContent = error.message || t("storageLoadError");
            errorElement.hidden = false;
        } finally {
            render();
        }
    }

    function render() {
        const container = document.getElementById("storage-list");
        if (!container) return;
        container.textContent = "";

        for (const entry of entries) {
            const row = document.createElement("tr");
            row.dataset.storageId = entry.id;
            const name = entry.name || t(LABEL_KEYS[entry.id]) || entry.id;

            const nameCell = document.createElement("td");
            const label = document.createElement("label");
            label.textContent = name;
            nameCell.append(label);

            const filesCell = document.createElement("td");
            filesCell.className = "hint";
            filesCell.textContent = t("storageFileCount").replace("{count}", entry.files);

            const sizeCell = document.createElement("td");
            sizeCell.textContent = formatBytes(entry.bytes);

            const actionsCell = document.createElement("td");
            if (entry.clearable) {
                actionsCell.append(
                    createRowActions({
                        label: `${t("rowActions")}: ${name}`,
                        actions: [
                            {
                                text: t("clearCache"),
                                className: "secondary-btn danger",
                                dataset: { storageTarget: entry.id },
                                ariaLabel: `${t("clearCache")}: ${name}`,
                            },
                        ],
                    }),
                );
            }

            row.append(nameCell, filesCell, sizeCell, actionsCell);
            container.append(row);
        }
    }

    document.getElementById("storage-list").addEventListener("click", async (event) => {
        const button = event.target.closest("button[data-storage-target]");
        if (!button || button.disabled) return;
        const target = button.dataset.storageTarget;
        const entry = entries.find((candidate) => candidate.id === target);
        const label = entry?.name || t(LABEL_KEYS[target]) || target;
        if (!window.confirm(t("clearCacheConfirm").replace("{name}", label))) return;

        button.disabled = true;
        try {
            const response = await fetch("/api/storage/clear", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Access-Key": getAccessKey() },
                body: JSON.stringify({ target }),
            });
            if (response.status === 401) {
                onUnauthorized();
                return;
            }
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
            await load();
            showMessage(t("storageCleared"), "success");
        } catch (error) {
            showMessage(t("storageClearError") + error.message, "error");
        } finally {
            button.disabled = false;
        }
    });

    return { load, render };
}

import { getAvailableModelActions, getModelActionRequest, shouldPollLocalModels, summarizeModelProgress } from "/config/config-state.js";
import { createRowActions } from "/config/row-actions.js";

export function createLocalModelView({ t, getAccessKey, getSelectedPresetId, onUnauthorized, showMessage }) {
    let models = [];
    let showNotInstalled = false;
    let loading = false;
    let pollTimer = null;
    let watchUntil = 0;
    const pendingActions = new Set();

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return "";
        if (bytes === 0) return "0 B";
        if (bytes < 1000) return `${bytes} B`;
        if (bytes < 1000000) return `${(bytes / 1000).toFixed(1)} KB`;
        if (bytes < 1000000000) return `${Math.round(bytes / 1000000)} MB`;
        return `${(bytes / 1000000000).toFixed(2)} GB`;
    }

    function statusText(model) {
        const status = t(`localModelStatus_${model.status}`) || model.status;
        const progress = summarizeModelProgress(model);
        if (model.status === "downloading" && progress.percent !== null) {
            return `${status} — ${progress.percent}% (${formatBytes(model.done)} / ${formatBytes(model.total)})`;
        }
        return status;
    }

    function schedulePolling() {
        clearTimeout(pollTimer);
        pollTimer = null;
        if (!shouldPollLocalModels(models) && Date.now() >= watchUntil) return;
        pollTimer = setTimeout(() => load({ background: true }), 2000);
    }

    async function load({ background = false } = {}) {
        if (loading) return;
        loading = true;
        const errorElement = document.getElementById("local-models-error");

        try {
            const response = await fetch("/api/local-models", { headers: { "X-Access-Key": getAccessKey() } });
            if (response.status === 401) {
                onUnauthorized();
                return;
            }
            const data = await response.json().catch(() => null);
            if (!response.ok || !Array.isArray(data)) {
                throw new Error(data?.message || t("localModelsLoadError"));
            }
            models = data;
            errorElement.hidden = true;
        } catch (error) {
            models = [];
            errorElement.textContent = error.message || t("localModelsLoadError");
            errorElement.hidden = false;
        } finally {
            loading = false;
            render();
            schedulePolling();
        }
    }

    function render() {
        const container = document.getElementById("local-model-list");
        if (!container) return;
        container.textContent = "";
        const selectedId = getSelectedPresetId();
        const visibilityToggle = document.getElementById("toggle-not-installed");
        visibilityToggle.textContent = t(showNotInstalled ? "hideNotInstalled" : "showNotInstalled");
        visibilityToggle.setAttribute("aria-pressed", String(showNotInstalled));

        for (const model of models) {
            if (!showNotInstalled && model.status === "not_downloaded") continue;
            const row = document.createElement("tr");
            row.dataset.presetId = model.id;

            const nameCell = document.createElement("td");
            if (model.sourceUrl) {
                const link = document.createElement("a");
                link.href = model.sourceUrl;
                link.target = "_blank";
                link.rel = "noopener";
                link.textContent = model.name;
                link.title = t("localModelSource");
                nameCell.append(link);
            } else {
                nameCell.textContent = model.name;
            }

            const statusCell = document.createElement("td");
            statusCell.className = "hint";
            const states = [statusText(model)];
            if (model.id === selectedId) states.push(t("localModelSelected"));
            if (model.active) states.push(t("localModelActive"));
            statusCell.textContent = states.join(", ");

            if (model.error) {
                const error = document.createElement("div");
                error.textContent = model.error;
                statusCell.append(error);
            }

            const progress = summarizeModelProgress(model);
            if (model.status === "downloading") {
                const bar = document.createElement("progress");
                bar.max = 100;
                if (progress.percent === null) {
                    bar.removeAttribute("value");
                    bar.setAttribute("aria-label", t("localModelProgressUnknown"));
                } else {
                    bar.value = progress.percent;
                    bar.setAttribute("aria-label", `${statusText(model)}`);
                }
                statusCell.append(bar);
            }

            const sizeCell = document.createElement("td");
            sizeCell.textContent = model.downloadBytes > 0 ? formatBytes(model.downloadBytes) : "—";

            const actionsCell = document.createElement("td");
            const actions = getAvailableModelActions(model).map((action) => {
                const text = t(
                    action === "download" && ["incomplete", "failed"].includes(model.status)
                        ? "localModelActionResume"
                        : `localModelAction${action[0].toUpperCase()}${action.slice(1)}`,
                );
                return {
                    text,
                    className: action === "delete" ? "secondary-btn danger" : "secondary-btn",
                    dataset: { modelAction: action, presetId: model.id },
                    disabled: pendingActions.has(`${model.id}:${action}`) || model.active,
                    ariaLabel: `${text}: ${model.name}`,
                };
            });
            if (actions.length) {
                actionsCell.append(createRowActions({ label: `${t("rowActions")}: ${model.name}`, actions }));
            }

            row.append(nameCell, statusCell, sizeCell, actionsCell);
            container.append(row);
        }
    }

    async function runAction(action, presetId) {
        const model = models.find((entry) => entry.id === presetId);
        if (action === "delete" && !window.confirm(t("localModelDeleteConfirm").replace("{model}", model?.name || presetId))) {
            return;
        }

        const request = getModelActionRequest(action, presetId);
        pendingActions.add(`${presetId}:${action}`);
        watchUntil = Date.now() + 10000;
        render();

        try {
            const response = await fetch(request.url, {
                method: request.method,
                headers: { "Content-Type": "application/json", "X-Access-Key": getAccessKey() },
                body: JSON.stringify(request.body),
            });
            if (response.status === 401) {
                onUnauthorized();
                return;
            }
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.message || `HTTP ${response.status}`);
            }
            await load({ background: true });
        } catch (error) {
            showMessage(t("localModelActionError") + error.message, "error");
        } finally {
            pendingActions.delete(`${presetId}:${action}`);
            render();
            schedulePolling();
        }
    }

    document.getElementById("toggle-not-installed").addEventListener("click", () => {
        showNotInstalled = !showNotInstalled;
        render();
    });

    document.getElementById("local-model-list").addEventListener("click", (event) => {
        const button = event.target.closest("button[data-model-action]");
        if (button && !button.disabled) {
            runAction(button.dataset.modelAction, button.dataset.presetId);
        }
    });

    return {
        load,
        render,
        stopPolling: () => {
            clearTimeout(pollTimer);
            pollTimer = null;
        },
    };
}

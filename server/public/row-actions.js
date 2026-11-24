export function createRowActions({ label, actions }) {
    const container = document.createElement("div");
    container.className = "row-actions";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary-btn row-action-toggle";
    toggle.textContent = "...";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", "false");

    const menu = document.createElement("div");
    menu.className = "row-action-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;

    for (const action of actions) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = action.className || "secondary-btn";
        button.textContent = action.text;
        button.disabled = Boolean(action.disabled);
        button.setAttribute("role", "menuitem");
        if (action.ariaLabel) button.setAttribute("aria-label", action.ariaLabel);
        Object.assign(button.dataset, action.dataset || {});
        button.addEventListener("click", () => closeRowActions());
        menu.append(button);
    }

    toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const willOpen = menu.hidden;
        closeRowActions(container);
        menu.hidden = !willOpen;
        toggle.setAttribute("aria-expanded", String(willOpen));
    });

    container.append(toggle, menu);
    return container;
}

function closeRowActions(except) {
    document.querySelectorAll(".row-actions").forEach((container) => {
        if (container === except) return;
        const menu = container.querySelector(".row-action-menu");
        const toggle = container.querySelector(".row-action-toggle");
        if (menu) menu.hidden = true;
        toggle?.setAttribute("aria-expanded", "false");
    });
}

document.addEventListener("click", (event) => {
    if (!event.target.closest(".row-actions")) closeRowActions();
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeRowActions();
});

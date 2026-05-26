function getRoutePlannerPanelWidth() {
    const searchElement = document.getElementById("search");
    if (!searchElement) {
        return 320;
    }

    return Math.round(searchElement.getBoundingClientRect().width) || 320;
}

function normalizeHardcodedMapContextMenuIcons() {
    const leadingIconPattern = /^([\p{Emoji_Presentation}\p{Extended_Pictographic}]\uFE0F?)\s+/u;
    document.querySelectorAll("#map-context-menu .map-context-menu__item").forEach((buttonElement) => {
        if (buttonElement.querySelector(".map-context-menu__icon")) {
            return;
        }

        const text = buttonElement.textContent.replace(/\s+/g, " ").trim();
        const match = text.match(leadingIconPattern);
        if (!match) {
            return;
        }

        const icon = match[1];
        const label = text.slice(match[0].length).trim();
        buttonElement.textContent = "";

        const iconElement = document.createElement("span");
        iconElement.className = "map-context-menu__icon";
        iconElement.setAttribute("aria-hidden", "true");
        iconElement.textContent = icon;

        const labelElement = document.createElement("span");
        labelElement.className = "map-context-menu__label";
        labelElement.textContent = label;

        buttonElement.append(iconElement, labelElement);
    });
}

normalizeHardcodedMapContextMenuIcons();

$("#toggle-button").off("click").on("click", () => {
    const panelWidth = getRoutePlannerPanelWidth();
    const leftPos = isSearchPanelHidden ? "0px" : `-${panelWidth}px`;
    const btnPos = isSearchPanelHidden ? `${panelWidth}px` : "0px";

    $("#search").stop(true).animate({ left: leftPos }, 500);
    $("#toggle-button").stop(true).animate({ left: btnPos }, 500);
    isSearchPanelHidden = !isSearchPanelHidden;
});

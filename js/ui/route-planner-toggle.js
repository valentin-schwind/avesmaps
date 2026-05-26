function getRoutePlannerPanelWidth() {
    const searchElement = document.getElementById("search");
    if (!searchElement) {
        return 305;
    }

    return Math.round(searchElement.getBoundingClientRect().width) || 305;
}

$("#toggle-button").off("click").on("click", () => {
    const panelWidth = getRoutePlannerPanelWidth();
    const leftPos = isSearchPanelHidden ? "0px" : `-${panelWidth}px`;
    const btnPos = isSearchPanelHidden ? `${panelWidth}px` : "0px";

    $("#search").stop(true).animate({ left: leftPos }, 500);
    $("#toggle-button").stop(true).animate({ left: btnPos }, 500);
    isSearchPanelHidden = !isSearchPanelHidden;
});

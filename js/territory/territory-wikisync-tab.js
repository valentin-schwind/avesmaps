"use strict";

function openPoliticalTerritoryWikiSyncSettingsInNewTab() {
	const settingsUrl = "/html/wiki-dom-playground.html";
	const openedWindow = window.open(settingsUrl, "_blank");
	if (openedWindow) {
		openedWindow.opener = null;
		return;
	}
	window.location.href = settingsUrl;
}

window.startWikiSyncTerritoryRun = function startWikiSyncTerritoryRunFromNewTabOverride() {
	if (typeof setWikiSyncStatus === "function") {
		setWikiSyncStatus("Synchronisierungseinstellungen werden geöffnet...", "pending");
	}
	openPoliticalTerritoryWikiSyncSettingsInNewTab();
};

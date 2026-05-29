(function initDerivedBoundaryContextAction() {
	"use strict";

	const ACTION = "refresh-derived-boundary";

	function ensureContextMenuButton() {
		const menu = document.getElementById("region-context-menu");
		if (!menu || menu.querySelector(`[data-region-context-action="${ACTION}"]`)) {
			return;
		}

		const propertiesButton = menu.querySelector('[data-region-context-action="edit-properties"]');
		const button = document.createElement("button");
		button.type = "button";
		button.className = "map-context-menu__item";
		button.dataset.regionContextAction = ACTION;
		button.textContent = "Außengrenzen erzeugen/aktualisieren";
		if (propertiesButton) {
			propertiesButton.insertAdjacentElement("afterend", button);
			return;
		}

		menu.appendChild(button);
	}

	async function handleContextAction(event) {
		const actionElement = event.target?.closest?.(`[data-region-context-action="${ACTION}"]`);
		if (!actionElement) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();

		const regionEntry = activeRegionContextEntry;
		closeRegionContextMenu();
		if (!regionEntry) {
			showFeedbackToast("Kein Herrschaftsgebiet ausgewählt.", "warning");
			return;
		}
		if (!window.AvesmapsDerivedBoundaryEditor?.generateOrUpdateForRegion) {
			showFeedbackToast("Boundary-Editor ist noch nicht geladen.", "warning");
			return;
		}

		try {
			await window.AvesmapsDerivedBoundaryEditor.generateOrUpdateForRegion(regionEntry);
		} catch (error) {
			console.error("Außengrenze konnte nicht erzeugt werden:", error);
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", ensureContextMenuButton, { once: true });
	} else {
		ensureContextMenuButton();
	}
	document.addEventListener("click", (event) => {
		void handleContextAction(event);
	}, true);
})();

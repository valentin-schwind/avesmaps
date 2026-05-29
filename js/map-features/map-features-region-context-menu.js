/*
 * Extracted region context menu DOM/state helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

function getRegionContextMenuElement() {
	return document.getElementById("region-context-menu");
}

function openRegionContextMenu(regionEntry, regionLayer, latlng, clientX, clientY) {
	activeRegionContextEntry = regionEntry;
	activeRegionContextLayer = regionLayer || regionEntry.layer || null;
	activeRegionContextPolygonIndex = Number.isInteger(regionLayer?._regionPolygonIndex) ? regionLayer._regionPolygonIndex : null;
	pendingContextMenuLatLng = L.latLng(latlng);
	closeMapContextMenu();
	const menuElement = getRegionContextMenuElement();
	if (!menuElement) {
		return;
	}

	const extractActionElement = menuElement.querySelector('[data-region-context-action="extract"]');
	if (extractActionElement) {
		const layerCount = getRegionEntryLayers(regionEntry).length;
		extractActionElement.hidden = !(regionEntry?.source === "political_territory" && layerCount > 1 && regionLayer);
	}

	menuElement.hidden = false;
	positionContextMenuElement(menuElement, clientX, clientY);
}

function closeRegionContextMenu() {
	const menuElement = getRegionContextMenuElement();
	if (menuElement) {
		menuElement.hidden = true;
	}
	activeRegionContextEntry = null;
	activeRegionContextLayer = null;
	activeRegionContextPolygonIndex = null;
}

function positionContextMenuElement(menuElement, clientX, clientY) {
	const viewportPadding = 8;
	menuElement.style.left = "0px";
	menuElement.style.top = "0px";
	const width = menuElement.offsetWidth;
	const height = menuElement.offsetHeight;
	const left = Math.max(viewportPadding, Math.min(clientX + MAP_CONTEXT_MENU_OFFSET_X, window.innerWidth - width - viewportPadding));
	const top = Math.max(viewportPadding, Math.min(clientY + MAP_CONTEXT_MENU_OFFSET_Y, window.innerHeight - height - viewportPadding));
	menuElement.style.left = `${left}px`;
	menuElement.style.top = `${top}px`;
}

async function deleteDerivedRegionGeometry(regionEntry) {
	const territoryPublicId = String(regionEntry?.territoryPublicId || "").trim();
	if (!territoryPublicId) {
		showFeedbackToast("Die Außengeometrie hat kein Ziel-Herrschaftsgebiet.", "warning");
		return;
	}

	const name = regionEntry.name || "Herrschaftsgebiet";
	if (!window.confirm(`${name} wirklich loeschen?`)) {
		return;
	}

	try {
		const result = await politicalTerritoryRepository.deleteDerivedGeometry(territoryPublicId);
		removeRegionEntryFromMap(regionEntry);
		regionData = regionData.filter((feature) => {
			const properties = feature.properties || {};
			return properties.derived_geometry_public_id !== regionEntry.geometryPublicId
				&& properties.geometry_public_id !== regionEntry.geometryPublicId
				&& properties.public_id !== regionEntry.geometryPublicId;
		});
		clearRegionGeometryEdit();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		void loadChangeLog();
		showFeedbackToast((result?.affected || 0) > 0 ? "Geometrie geloescht." : "Keine aktive Geometrie gefunden.", "success");
	} catch (error) {
		console.error("Geometrie konnte nicht geloescht werden:", error);
		showFeedbackToast(error.message || "Geometrie konnte nicht geloescht werden.", "warning");
	}
}

document.addEventListener("click", (event) => {
	const actionElement = event.target?.closest?.('[data-region-context-action="delete"]');
	if (!actionElement || activeRegionContextEntry?.isDerivedGeometry !== true) {
		return;
	}

	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation();
	const regionEntry = activeRegionContextEntry;
	closeRegionContextMenu();
	void deleteDerivedRegionGeometry(regionEntry);
}, true);

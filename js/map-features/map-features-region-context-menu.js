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

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

	// 🔴 Beschriftungen wandern, KENNUNGEN bleiben: data-region-context-action="delete" ist der
	// Anker des Handlers weiter unten in dieser Datei.
	const menuPlan = avesmapsRegionContextMenuPlan(regionEntry);
	const deleteActionElement = menuElement.querySelector('[data-region-context-action="delete"]');
	if (deleteActionElement) {
		deleteActionElement.textContent = menuPlan.deleteLabel;
	}
	menuElement.querySelectorAll("[data-region-context-action]").forEach((item) => {
		const action = item.dataset.regionContextAction || "";
		if (menuPlan.actions === null) {
			// extract hat seine eigene Regel oben und wird hier nicht ueberstimmt.
			if (action !== "extract") item.hidden = false;
			return;
		}
		item.hidden = !menuPlan.actions.includes(action);
	});

	// 💣 EIN LEERES UNTERMENÜ IST SCHLIMMER ALS KEINES. Seit dem 19.08.2026 stecken „Verschieben"/
	// „Gebiet zerschneiden" und die vier Verrechnungen in Untermenüs -- und die Regel oben blendet
	// EINZELNE Einträge aus. Für eine verwaiste Außenhülle bleiben genau drei übrig
	// (AVESMAPS_REGION_SOURCELESS_HULL_ACTIONS), beide Gruppen wären also sichtbar und innen leer:
	// man klappt auf und findet nichts. Die Gruppe leitet ihre Sichtbarkeit deshalb von ihrem Inhalt
	// ab, statt ein eigenes `hidden` zu bekommen -- ein zweiter Zustand hätte genau einen Aufrufer
	// und beim nächsten Umbau einen zu wenig.
	menuElement.querySelectorAll(".map-context-menu__group[data-region-context-group]").forEach((group) => {
		const sichtbare = group.querySelectorAll(".map-context-submenu [data-region-context-action]:not([hidden])");
		group.hidden = sichtbare.length === 0;
	});

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

function countVisibleChildDerivedBoundaries(regionEntry) {
	const territoryPublicId = String(regionEntry?.territoryPublicId || "").trim();
	if (!territoryPublicId) {
		return 0;
	}

	return regionPolygons
		.map((polygon) => polygon?._regionEntry)
		.filter((entry) => entry?.isDerivedGeometry === true)
		.filter((entry) => String(entry.territoryPublicId || "").trim() !== territoryPublicId)
		.filter((entry) => String(entry.hiddenByDerivedTerritoryPublicId || "").trim() === territoryPublicId)
		.length;
}

async function deleteDerivedRegionGeometry(regionEntry) {
	const territoryPublicId = String(regionEntry?.territoryPublicId || "").trim();
	if (!territoryPublicId) {
		showFeedbackToast("Die Außengeometrie hat kein Ziel-Herrschaftsgebiet.", "warning");
		return;
	}

	const name = regionEntry.name || "Herrschaftsgebiet";
	const visibleChildBoundaryCount = countVisibleChildDerivedBoundaries(regionEntry);
	// 🔴 Seit 16.08.2026 entscheidet der Server je Huelle hart/weich (Quellenlage) -- vor dem Klick
	// weiss der Client das nicht. Die Bestaetigung darf deshalb keine der beiden Formen versprechen.
	const confirmation = visibleChildBoundaryCount > 0
		? `${name} wirklich löschen?\n\nEs wurden ${visibleChildBoundaryCount} sichtbare Unter-Außengrenzen gefunden. Diese werden je nach Quellenlage entfernt oder deaktiviert.`
		: `${name} wirklich löschen?`;
	if (!window.confirm(confirmation)) {
		return;
	}

	try {
		const result = await politicalTerritoryRepository.deleteDerivedGeometryTree(territoryPublicId);
		removeRegionEntryFromMap(regionEntry);
		const affectedTerritoryIds = new Set((result?.affected_territories || []).map((entry) => String(entry?.territory_public_id || "").trim()).filter(Boolean));
		regionData = regionData.filter((feature) => {
			const properties = feature.properties || {};
			const featureTerritoryPublicId = String(properties.territory_public_id || "").trim();
			return properties.derived_geometry_public_id !== regionEntry.geometryPublicId
				&& properties.geometry_public_id !== regionEntry.geometryPublicId
				&& properties.public_id !== regionEntry.geometryPublicId
				&& !affectedTerritoryIds.has(featureTerritoryPublicId);
		});
		clearRegionGeometryEdit();
		schedulePoliticalTerritoryLayerReload({ immediate: true });
		void loadChangeLog();
		// 🔴 `affected` zaehlt Zeilen (hart geloescht + deaktiviert zusammen), `hard_deleted` nur die
		// Territorien mit einer wirklich entfernten Huelle -- die Weiche sitzt serverseitig
		// (avesmapsPoliticalDeleteDerivedGeometryForTerritory), der Toast muss ihr Ergebnis nur lesen.
		const affectedCount = Number(result?.affected || 0);
		const hardDeletedCount = Number(result?.hard_deleted || 0);
		let successMessage;
		if (affectedCount <= 0) {
			successMessage = "Keine aktive Außengrenze gefunden.";
		} else if (hardDeletedCount > 0) {
			successMessage = "Außengrenze endgültig gelöscht – das lässt sich nicht rückgängig machen.";
		} else {
			successMessage = "Außengrenze gelöscht.";
		}
		showFeedbackToast(successMessage, "success");
	} catch (error) {
		console.error("Geometrie konnte nicht gelöscht werden:", error);
		showFeedbackToast(error.message || "Geometrie konnte nicht gelöscht werden.", "warning");
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

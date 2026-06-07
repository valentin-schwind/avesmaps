"use strict";
(function () {
const TERRITORY_DRAG_JSON_TYPE = "application/x-avesmaps-territory-node-json";
const TERRITORY_DRAG_NODE_TYPE = "application/x-avesmaps-territory-node-id";
const TERRITORY_DRAG_ID_TYPE = "application/x-avesmaps-territory";
let activeWikiSyncTerritoryDragPayload = null;

function normalizeWikiSyncTerritoryTransferText(value) {
	return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function parseWikiSyncTerritoryTransferNumber(value) {
	if (value === "" || value === null || typeof value === "undefined") return null;
	const number = Number(value);
	return Number.isFinite(number) ? Math.round(number) : null;
}

function readWikiSyncTerritoryStartYear(row = {}) {
	return parseWikiSyncTerritoryTransferNumber(row.founded_display_bf ?? row.founded_start_bf ?? row.founded_end_bf ?? null);
}

function readWikiSyncTerritoryEndYear(row = {}) {
	return parseWikiSyncTerritoryTransferNumber(row.dissolved_display_bf ?? row.dissolved_start_bf ?? row.dissolved_end_bf ?? null);
}

function formatWikiSyncTerritoryNodePeriod(row = {}) {
	const startYear = readWikiSyncTerritoryStartYear(row);
	const endYear = readWikiSyncTerritoryEndYear(row);
	if (startYear === null && endYear === null) return "";
	const startText = startYear === null ? "?" : `${startYear} BF`;
	const endText = endYear === null ? "heute" : `${endYear} BF`;
	return `${startText} - ${endText}`;
}

function formatWikiSyncTerritoryNodeLabel(row = {}, fallbackLabel = "") {
	const baseName = normalizeWikiSyncTerritoryTransferText(row.name || fallbackLabel || "Herrschaftsgebiet");
	const period = formatWikiSyncTerritoryNodePeriod(row);
	return period ? `${baseName} (${period})` : baseName;
}

function stripWikiSyncTerritoryPeriodLabel(label) {
	return normalizeWikiSyncTerritoryTransferText(label).replace(/\s*\([^)]*\bBF\s*-\s*(?:[^)]*)\)\s*$/iu, "").trim();
}

function defaultWikiSyncTerritoryZoomRange(chainLength, index) {
	if (chainLength <= 1) return { zoomMin: 0, zoomMax: 6 };
	if (chainLength === 2) return index === 0 ? { zoomMin: 0, zoomMax: 1 } : { zoomMin: 2, zoomMax: 6 };
	if (chainLength === 3) {
		if (index === 0) return { zoomMin: 0, zoomMax: 1 };
		if (index === 1) return { zoomMin: 2, zoomMax: 2 };
		return { zoomMin: 3, zoomMax: 6 };
	}
	if (chainLength === 4) {
		if (index === 0) return { zoomMin: 0, zoomMax: 1 };
		if (index === 1) return { zoomMin: 2, zoomMax: 2 };
		if (index === 2) return { zoomMin: 3, zoomMax: 3 };
		return { zoomMin: 4, zoomMax: 6 };
	}
	if (chainLength === 5) {
		if (index === 0) return { zoomMin: 0, zoomMax: 1 };
		if (index === 1) return { zoomMin: 2, zoomMax: 2 };
		if (index === 2) return { zoomMin: 3, zoomMax: 3 };
		if (index === 3) return { zoomMin: 4, zoomMax: 4 };
		return { zoomMin: 5, zoomMax: 6 };
	}
	if (index === 0) return { zoomMin: 0, zoomMax: 1 };
	if (index === 1) return { zoomMin: 2, zoomMax: 2 };
	if (index === 2) return { zoomMin: 3, zoomMax: 3 };
	if (index === 3) return { zoomMin: 4, zoomMax: 4 };
	if (index === 4) return { zoomMin: 5, zoomMax: 5 };
	return { zoomMin: 6, zoomMax: 6 };
}

function installWikiSyncTerritoryTreeDisplayPatch() {
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	if (!treeModule || treeModule.__avesmapsPeriodLabelPatch === true || typeof treeModule.buildTree !== "function") {
		return Boolean(treeModule?.__avesmapsPeriodLabelPatch);
	}
	treeModule.__avesmapsPeriodLabelPatch = true;
	return true;
}

function dataTransferHasType(dataTransfer, expectedType) {
	const types = dataTransfer?.types;
	if (!types) return false;
	if (typeof types.contains === "function") return types.contains(expectedType);
	return Array.from(types).includes(expectedType);
}

function isWikiSyncTerritoryDragTransfer(dataTransfer) {
	return Boolean(activeWikiSyncTerritoryDragPayload)
		|| dataTransferHasType(dataTransfer, TERRITORY_DRAG_JSON_TYPE)
		|| dataTransferHasType(dataTransfer, TERRITORY_DRAG_NODE_TYPE)
		|| dataTransferHasType(dataTransfer, TERRITORY_DRAG_ID_TYPE);
}

function readWikiSyncTerritoryDragPayload(dataTransfer) {
	if (!dataTransfer) return activeWikiSyncTerritoryDragPayload;
	const rawJson = dataTransfer.getData(TERRITORY_DRAG_JSON_TYPE);
	if (rawJson) {
		try {
			const payload = JSON.parse(rawJson);
			if (payload && Array.isArray(payload.path) && payload.path.length > 0) return payload;
		} catch (error) {
			// Keep fallback below.
		}
	}
	return activeWikiSyncTerritoryDragPayload;
}

function createWikiSyncTerritoryTransferReference(node) {
	const row = node?.row || {};
	const wikiKey = normalizeWikiSyncTerritoryTransferText(row.wiki_key || node?.id || "");
	const name = normalizeWikiSyncTerritoryTransferText(row.name || stripWikiSyncTerritoryPeriodLabel(node?.label || ""));
	const endYear = readWikiSyncTerritoryEndYear(row);
	return {
		id: node?.id || wikiKey || name,
		key: wikiKey || node?.id || name,
		label: formatWikiSyncTerritoryNodeLabel(row, node?.label || name),
		name,
		kind: node?.kind || row.type || "Herrschaftsgebiet",
		wikiKey,
		rowId: row.id ?? null,
		territoryPublicId: normalizeWikiSyncTerritoryTransferText(row.public_id || ""),
		territoryId: row.territory_id ?? null,
		type: normalizeWikiSyncTerritoryTransferText(row.type || "Herrschaftsgebiet"),
		status: normalizeWikiSyncTerritoryTransferText(row.status || ""),
		validLabel: normalizeWikiSyncTerritoryTransferText(row.valid_label || ""),
		wikiUrl: normalizeWikiSyncTerritoryTransferText(row.wiki_url || ""),
		coatOfArmsUrl: normalizeWikiSyncTerritoryTransferText(row.coat_of_arms_url || ""),
		startYear: readWikiSyncTerritoryStartYear(row),
		endYear,
		existsUntilToday: endYear === null,
		path: [],
		pathKeys: [],
	};
}

function createWikiSyncTerritoryDragPayloadFromNode(node) {
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	const pathNodes = typeof treeModule?.getNodePath === "function" ? treeModule.getNodePath(node) : [];
	const path = pathNodes.map(createWikiSyncTerritoryTransferReference);
	path.forEach((entry, index) => {
		entry.path = path.slice(0, index + 1).map((part) => part.label);
		entry.pathKeys = path.slice(0, index + 1).map((part) => part.wikiKey || part.key || part.id);
	});
	return { node: path[path.length - 1] || createWikiSyncTerritoryTransferReference(node), path };
}

function findWikiSyncTerritoryTreeElement(event) {
	const target = event?.target;
	if (!(target instanceof Element)) return null;
	return target.closest("#wiki-sync-territory-tree, #treeView, [data-wiki-sync-panel-section='territories']");
}

function findDraggedTreeItem(event) {
	const target = event?.target;
	if (!(target instanceof Element)) return null;
	return target.closest(".tree-item[data-node-id], .wiki-sync-territory-tree__item[data-node-id]");
}

function findWikiSyncTerritoryNodeForEvent(event) {
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	const rows = Array.isArray(window.wikiSyncTerritoryTreeRowsCache) ? window.wikiSyncTerritoryTreeRowsCache : [];
	if (!treeModule || typeof treeModule.buildTree !== "function" || rows.length < 1) return null;
	const draggedItem = findDraggedTreeItem(event);
	const nodeId = normalizeWikiSyncTerritoryTransferText(
		event?.dataTransfer?.getData(TERRITORY_DRAG_NODE_TYPE)
		|| event?.dataTransfer?.getData("text/plain")
		|| draggedItem?.dataset?.nodeId
		|| ""
	);
	if (!nodeId) return null;
	const fullTree = treeModule.buildTree(rows);
	return fullTree?.nodeRegistry instanceof Map ? fullTree.nodeRegistry.get(nodeId) || null : null;
}

function enhanceWikiSyncTerritoryDragEvent(event) {
	if (!event?.dataTransfer) return;
	const node = findWikiSyncTerritoryNodeForEvent(event);
	if (!node) return;
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	if (typeof treeModule?.applyDragData === "function") treeModule.applyDragData(event, node);
	const payload = createWikiSyncTerritoryDragPayloadFromNode(node);
	if (!payload.path.length) return;
	activeWikiSyncTerritoryDragPayload = payload;
	const selected = payload.node || payload.path[payload.path.length - 1];
	event.dataTransfer.setData(TERRITORY_DRAG_JSON_TYPE, JSON.stringify(payload));
	event.dataTransfer.setData(TERRITORY_DRAG_ID_TYPE, selected.territoryPublicId || selected.wikiKey || selected.key || selected.id || "");
	event.dataTransfer.setData("text/plain", selected.territoryPublicId || selected.wikiKey || selected.key || selected.id || "");
}

function clearActiveWikiSyncTerritoryDragPayload() {
	activeWikiSyncTerritoryDragPayload = null;
}

function wikiSyncTerritoryReferenceToAssignmentNode(reference = {}) {
	return {
		territory: {
			public_id: reference.wikiKey || reference.key || reference.territoryPublicId || reference.id || "",
			name: reference.name || stripWikiSyncTerritoryPeriodLabel(reference.label || ""),
			type: reference.type || reference.kind || "Herrschaftsgebiet",
			status: reference.status || "",
			valid_label: reference.validLabel || "",
			wiki_name: reference.name || stripWikiSyncTerritoryPeriodLabel(reference.label || ""),
			wiki_url: reference.wikiUrl || "",
			coat_of_arms_url: reference.coatOfArmsUrl || "",
			valid_from_bf: reference.startYear ?? null,
			valid_to_bf: reference.existsUntilToday ? null : reference.endYear ?? null,
		},
	};
}

function buildWikiSyncTerritoryAssignmentValueFromPayload(payload) {
	const path = Array.isArray(payload?.path) ? payload.path : [];
	const assignedPath = path.map((entry, index) => ({
		id: entry.id || entry.key || entry.wikiKey || entry.name || "",
		key: entry.key || entry.wikiKey || entry.id || entry.name || "",
		label: entry.name || stripWikiSyncTerritoryPeriodLabel(entry.label || ""),
		kind: entry.type || entry.kind || "Herrschaftsgebiet",
		isSynthetic: false,
		wikiKey: entry.wikiKey || entry.key || "",
		rowId: entry.rowId ?? null,
		territoryPublicId: entry.territoryPublicId || "",
		territoryId: entry.territoryId ?? null,
		path: path.slice(0, index + 1).map((part) => part.name || stripWikiSyncTerritoryPeriodLabel(part.label || "")),
		pathKeys: path.slice(0, index + 1).map((part) => part.wikiKey || part.key || part.id || ""),
	}));
	const displays = path.map((entry, index) => {
		const zoom = defaultWikiSyncTerritoryZoomRange(path.length, index);
		return {
			nodeId: entry.id || entry.key || entry.wikiKey || entry.name || "",
			nodeKey: entry.key || entry.wikiKey || entry.id || entry.name || "",
			wikiKey: entry.wikiKey || entry.key || "",
			rowId: entry.rowId ?? null,
			territoryPublicId: entry.territoryPublicId || "",
			territoryId: entry.territoryId ?? null,
			name: entry.name || stripWikiSyncTerritoryPeriodLabel(entry.label || ""),
			displayName: entry.name || stripWikiSyncTerritoryPeriodLabel(entry.label || ""),
			coatOfArmsUrl: entry.coatOfArmsUrl || "",
			zoomMin: zoom.zoomMin,
			zoomMax: zoom.zoomMax,
			color: "#888888",
			opacity: 0.33,
			startYear: entry.startYear ?? null,
			endYear: entry.existsUntilToday ? null : entry.endYear ?? null,
			existsUntilToday: Boolean(entry.existsUntilToday),
			implicitDragDefault: true,
			depth: index,
			path: path.slice(0, index + 1).map((part) => part.name || stripWikiSyncTerritoryPeriodLabel(part.label || "")),
			pathKeys: path.slice(0, index + 1).map((part) => part.wikiKey || part.key || part.id || ""),
			kind: entry.type || entry.kind || "Herrschaftsgebiet",
		};
	});
	const selectedDisplay = displays[displays.length - 1] || null;
	return {
		assignedPath,
		editedPath: assignedPath,
		displays,
		display: selectedDisplay ? {
			name: selectedDisplay.displayName,
			displayName: selectedDisplay.displayName,
			coatOfArmsUrl: selectedDisplay.coatOfArmsUrl,
			zoomMin: selectedDisplay.zoomMin,
			zoomMax: selectedDisplay.zoomMax,
			color: selectedDisplay.color,
			opacity: selectedDisplay.opacity,
		} : {},
		validity: selectedDisplay ? {
			startYear: selectedDisplay.startYear,
			endYear: selectedDisplay.endYear,
			existsUntilToday: selectedDisplay.existsUntilToday,
		} : {},
	};
}

function buildWikiSyncTerritoryWikiNodesFromPayload(payload, displays) {
	const path = Array.isArray(payload?.path) ? payload.path : [];
	return path.map((entry, index) => ({
		key: entry.wikiKey || entry.key || entry.id || "",
		territoryPublicId: entry.territoryPublicId || "",
		territoryId: entry.territoryId ?? null,
		name: entry.name || stripWikiSyncTerritoryPeriodLabel(entry.label || ""),
		type: entry.type || entry.kind || "Herrschaftsgebiet",
		status: entry.status || "",
		coat_of_arms_url: entry.coatOfArmsUrl || displays[index]?.coatOfArmsUrl || "",
		wiki_url: entry.wikiUrl || "",
		valid_label: entry.validLabel || "",
		founded_start_bf: entry.startYear ?? null,
		founded_display_bf: entry.startYear ?? null,
		dissolved_start_bf: entry.existsUntilToday ? null : entry.endYear ?? null,
		dissolved_display_bf: entry.existsUntilToday ? null : entry.endYear ?? null,
	}));
}

async function refreshWikiSyncTerritoryTreeAfterAssignment() {
	if (typeof renderWikiSyncTerritoryTree === "function") {
		await renderWikiSyncTerritoryTree({ forceReload: true });
	}
}

async function assignWikiSyncTerritoryPayloadToRegionGeometry(payload, regionEntry) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry || {});
	if (!geometryPublicId) throw new Error("Die Ziel-Geometrie hat keine Geometrie-ID.");
	const assignmentValue = buildWikiSyncTerritoryAssignmentValueFromPayload(payload);
	const wikiPublicIds = assignmentValue.assignedPath.map((node) => String(node.wikiKey || "").trim()).filter(Boolean);
	if (wikiPublicIds.length < 1) throw new Error("Der gezogene Wiki-Knoten hat keinen WikiKey.");
	const result = await submitPoliticalTerritoryEdit({
		action: "save_geometry_assignment",
		geometry_public_id: geometryPublicId,
		display_only: false,
		wiki_public_ids: wikiPublicIds,
		wiki_nodes: buildWikiSyncTerritoryWikiNodesFromPayload(payload, assignmentValue.displays),
		assignment: assignmentValue,
		display: assignmentValue.display,
		validity: assignmentValue.validity,
	});
	await syncPoliticalTerritoryEditorAssignmentZooms(assignmentValue);
	// Ein aktiver Geometrie-Edit unterdrückt sonst den Re-Render im Layer-Reload
	// (loadPoliticalTerritoryLayer bricht bei activeRegionGeometryEdit vor dem Neuzeichnen ab),
	// sodass das Label den alten/generischen Namen behaelt bis zum nächsten Render.
	if (typeof clearRegionGeometryEdit === "function") clearRegionGeometryEdit();
	refreshPoliticalTerritoryEditorMapLayer();
	await refreshWikiSyncTerritoryTreeAfterAssignment();
	if (typeof loadChangeLog === "function") void loadChangeLog();
	return result;
}

async function assignWikiSyncTerritoryPayloadInsideLegacyEditor(payload) {
	if (!payload?.path?.length || typeof ensurePoliticalTerritoryChainFromWikiPath !== "function") return false;
	const path = payload.path.map(wikiSyncTerritoryReferenceToAssignmentNode);
	const selected = path[path.length - 1] || null;
	const selectedPublicId = String(selected?.territory?.public_id || "").trim();
	if (!selected || !selectedPublicId) return false;
	regionAssignmentWikiPath = path;
	regionAssignmentEnsuredChain = [];
	regionAssignmentActiveWikiPublicId = selectedPublicId;
	storeRegionAssignmentBreadcrumbCaches(path, [], selectedPublicId);
	renderRegionAssignment(path, regionAssignmentEnsuredChain, selectedPublicId);
	setRegionEditStatus("Wiki-Hierarchie wird dem Gebiet zugewiesen...", "pending");
	const response = await ensurePoliticalTerritoryChainFromWikiPath(path);
	const selectedTerritoryId = response.selected?.territory?.public_id || "";
	if (!selectedTerritoryId) throw new Error("Das Herrschaftsgebiet konnte nicht aus dem Wiki-Knoten erzeugt werden.");
	regionAssignmentActiveWikiPublicId = selectedTerritoryId;
	storeRegionAssignmentBreadcrumbCaches(path, response.chain || [], selectedTerritoryId);
	await activatePrimaryRegionEditTabForTerritory(selectedTerritoryId);
	renderRegionAssignment(path, regionAssignmentEnsuredChain, selectedTerritoryId);
	setRegionEditStatus("Herrschaftsgebiet zugewiesen. Speichern übernimmt die Geometrie dauerhaft.", "success");
	return true;
}

function findRegionLayerForWikiSyncDrop(event) {
	if (typeof map === "undefined" || typeof getOverlappingPoliticalRegionLayersAtLatLng !== "function") return null;
	const latlng = map.mouseEventToLatLng(event);
	const candidates = getOverlappingPoliticalRegionLayersAtLatLng(latlng);
	return candidates[0] || null;
}

function isEventTargetInsideSelector(event, selector) {
	const target = event?.target;
	return target instanceof Element && typeof target.closest === "function" && Boolean(target.closest(selector));
}

function isEventOnPoliticalTerritoryMap(event) {
	return isEventTargetInsideSelector(event, "#map, .leaflet-container");
}

function acceptWikiSyncTerritoryDropTarget(event) {
	if (!isWikiSyncTerritoryDragTransfer(event.dataTransfer)) return false;
	if (!isEventOnPoliticalTerritoryMap(event) && !isEventTargetInsideSelector(event, "#region-edit-assignment-drop")) return false;
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
	return true;
}

function initializeWikiSyncTerritoryDragAssignment() {
	installWikiSyncTerritoryTreeDisplayPatch();
	let attempts = 0;
	const patchTimer = window.setInterval(() => {
		attempts += 1;
		if (installWikiSyncTerritoryTreeDisplayPatch() || attempts > 120) window.clearInterval(patchTimer);
	}, 25);

	document.addEventListener("dragstart", (event) => {
		if (!findWikiSyncTerritoryTreeElement(event) && !findDraggedTreeItem(event)) return;
		enhanceWikiSyncTerritoryDragEvent(event);
	});

	document.addEventListener("dragend", clearActiveWikiSyncTerritoryDragPayload);

	document.addEventListener("dragenter", (event) => {
		acceptWikiSyncTerritoryDropTarget(event);
	});

	document.addEventListener("dragover", (event) => {
		acceptWikiSyncTerritoryDropTarget(event);
	});

	document.addEventListener("drop", (event) => {
		const payload = readWikiSyncTerritoryDragPayload(event.dataTransfer);
		clearActiveWikiSyncTerritoryDragPayload();
		if (!payload) return;
		if (isEventTargetInsideSelector(event, "#region-edit-assignment-drop")) {
			event.preventDefault();
			event.stopPropagation();
			void assignWikiSyncTerritoryPayloadInsideLegacyEditor(payload).catch((error) => {
				console.error("Herrschaftsgebiet konnte nicht im Editor zugewiesen werden:", error);
				if (typeof setRegionEditStatus === "function") setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht zugewiesen werden.", "error");
			});
			return;
		}
		if (!isEventOnPoliticalTerritoryMap(event)) return;
		event.preventDefault();
		event.stopPropagation();
		const regionLayer = findRegionLayerForWikiSyncDrop(event);
		const regionEntry = regionLayer?._regionEntry || null;
		if (!regionEntry || regionEntry.source !== "political_territory") {
			if (typeof showFeedbackToast === "function") showFeedbackToast("Bitte auf eine Herrschaftsgebiets-Geometrie ziehen.", "warning");
			return;
		}
		void assignWikiSyncTerritoryPayloadToRegionGeometry(payload, regionEntry).then(() => {
			if (typeof showFeedbackToast === "function") showFeedbackToast("Herrschaftsgebiet wurde der Geometrie zugewiesen.", "success");
		}).catch((error) => {
			console.error("Herrschaftsgebiet konnte der Geometrie nicht zugewiesen werden:", error);
			if (typeof showFeedbackToast === "function") showFeedbackToast(error.message || "Herrschaftsgebiet konnte nicht zugewiesen werden.", "warning");
		});
	});
}

window.AvesmapsPoliticalTerritoryDragAssignment = {
	initialize: initializeWikiSyncTerritoryDragAssignment,
	assignPayloadToRegionGeometry: assignWikiSyncTerritoryPayloadToRegionGeometry,
	assignPayloadInsideLegacyEditor: assignWikiSyncTerritoryPayloadInsideLegacyEditor,
	readDragPayload: readWikiSyncTerritoryDragPayload,
	buildAssignmentValueFromPayload: buildWikiSyncTerritoryAssignmentValueFromPayload,
};
})();

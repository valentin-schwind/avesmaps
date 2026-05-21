"use strict";

let activePoliticalTerritoryEditorRegion = null;
let pendingPoliticalTerritoryEditorFrameSetup = null;

function createPoliticalTerritoryEditorUrl(regionEntry = {}) {
	const params = new URLSearchParams();
	const geometryPublicId = String(regionEntry.geometryPublicId || regionEntry.geometry_public_id || regionEntry.publicId || "").trim();
	const geometryId = String(regionEntry.geometryId || regionEntry.geometry_id || "").trim();
	const territoryPublicId = String(regionEntry.territoryPublicId || regionEntry.territory_public_id || "").trim();
	const wikiKey = String(regionEntry.wikiKey || regionEntry.wiki_key || regionEntry.wikiId || regionEntry.wiki_id || "").trim();
	const name = String(regionEntry.displayName || regionEntry.name || "").trim();
	const color = String(regionEntry.color || "").trim();
	const opacity = Number(regionEntry.opacity);
	const minZoom = regionEntry.minZoom ?? regionEntry.min_zoom ?? "";
	const maxZoom = regionEntry.maxZoom ?? regionEntry.max_zoom ?? "";
	const validFromBf = regionEntry.validFromBf ?? regionEntry.valid_from_bf ?? "";
	const validToBf = regionEntry.validToBf ?? regionEntry.valid_to_bf ?? "";

	if (geometryPublicId) params.set("geometry_public_id", geometryPublicId);
	if (geometryId) params.set("geometry_id", geometryId);
	if (territoryPublicId) params.set("territory_public_id", territoryPublicId);
	if (wikiKey) params.set("wiki_key", wikiKey);
	if (name) params.set("name", name);
	if (color) params.set("color", color);
	if (Number.isFinite(opacity)) params.set("opacity", String(opacity));
	if (minZoom !== "" && minZoom !== null && typeof minZoom !== "undefined") params.set("min_zoom", String(minZoom));
	if (maxZoom !== "" && maxZoom !== null && typeof maxZoom !== "undefined") params.set("max_zoom", String(maxZoom));
	if (validFromBf !== "" && validFromBf !== null && typeof validFromBf !== "undefined") params.set("valid_from_bf", String(validFromBf));
	if (validToBf !== "" && validToBf !== null && typeof validToBf !== "undefined") params.set("valid_to_bf", String(validToBf));

	return `/html/political-territory-editor.html${params.toString() ? `?${params.toString()}` : ""}`;
}

function getPoliticalTerritoryEditorElements() {
	return {
		overlay: document.getElementById("political-territory-editor-overlay"),
		dialog: document.getElementById("political-territory-editor-dialog"),
		closeButton: document.getElementById("political-territory-editor-close"),
		frame: document.getElementById("political-territory-editor-frame"),
	};
}

function setPoliticalTerritoryEditorOpen(isOpen) {
	const { overlay, dialog } = getPoliticalTerritoryEditorElements();
	if (!overlay) {
		return;
	}

	overlay.hidden = !isOpen;
	if (typeof syncModalDialogBodyState === "function") {
		syncModalDialogBodyState();
	}

	if (isOpen) {
		dialog?.focus();
	}
}

function isPoliticalTerritoryEditorOpen() {
	const { overlay } = getPoliticalTerritoryEditorElements();
	return Boolean(overlay && !overlay.hidden);
}

function closePoliticalTerritoryEditor() {
	const { frame } = getPoliticalTerritoryEditorElements();
	setPoliticalTerritoryEditorOpen(false);
	activePoliticalTerritoryEditorRegion = null;
	pendingPoliticalTerritoryEditorFrameSetup = null;
	if (frame) {
		frame.removeAttribute("src");
	}
}

function createEmbeddedPoliticalTerritoryEditorUrl(regionEntry = {}) {
	const url = createPoliticalTerritoryEditorUrl(regionEntry);
	const separator = url.includes("?") ? "&" : "?";
	return `${url}${separator}embedded=1`;
}

function openPoliticalTerritoryEditor(regionEntry = {}) {
	const { overlay, frame } = getPoliticalTerritoryEditorElements();
	if (!overlay || !frame) {
		if (typeof openRegionEditDialog === "function") {
			openRegionEditDialog(regionEntry, { title: "Eigenschaften bearbeiten" });
		}
		return;
	}

	activePoliticalTerritoryEditorRegion = regionEntry;
	pendingPoliticalTerritoryEditorFrameSetup = regionEntry;
	frame.src = createEmbeddedPoliticalTerritoryEditorUrl(regionEntry);
	setPoliticalTerritoryEditorOpen(true);
}

function setupPoliticalTerritoryEditorFrame() {
	const { frame } = getPoliticalTerritoryEditorElements();
	const regionEntry = pendingPoliticalTerritoryEditorFrameSetup || activePoliticalTerritoryEditorRegion;
	if (!frame || !regionEntry) {
		return;
	}

	const assignmentModule = frame.contentWindow?.AvesmapsPoliticalTerritoryAssignment;
	if (!assignmentModule || typeof assignmentModule.configure !== "function") {
		return;
	}

	assignmentModule.configure({
		onSave: (value) => savePoliticalTerritoryEditorAssignment(regionEntry, value),
		onUnassign: () => unassignPoliticalTerritoryEditorGeometry(regionEntry),
		onCancel: () => {
			closePoliticalTerritoryEditor();
		},
	});
	pendingPoliticalTerritoryEditorFrameSetup = null;
}

async function savePoliticalTerritoryEditorAssignment(regionEntry, value = {}) {
	const geometryPublicId = String(regionEntry.geometryPublicId || regionEntry.geometry_public_id || regionEntry.publicId || "").trim();
	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Bitte das Herrschaftsgebiet erneut aus der Karte oeffnen.");
	}

	const assignedPath = Array.isArray(value.assignedPath) ? value.assignedPath : [];
	const displays = Array.isArray(value.displays) ? value.displays : [];
	const wikiPublicIds = assignedPath
		.map((node) => String(node?.wikiKey || "").trim())
		.filter(Boolean);
	const territoryPublicIds = assignedPath
		.map((node) => String(node?.territoryPublicId || "").trim())
		.filter(Boolean);
	const hasAssignedTerritory = assignedPath.length > 0 && (wikiPublicIds.length > 0 || territoryPublicIds.length > 0);
	const display = buildPoliticalTerritoryEditorDisplayPayload(regionEntry, value);
	const validity = buildPoliticalTerritoryEditorValidityPayload(regionEntry, value);
	const displayName = String(display.displayName || display.name || "").trim();
	const shouldCreateTerritoryFromGeometry = !hasAssignedTerritory && displayName !== "";

	const result = await submitPoliticalTerritoryEdit({
		action: "save_geometry_assignment",
		geometry_public_id: geometryPublicId,
		display_only: !hasAssignedTerritory && !shouldCreateTerritoryFromGeometry,
		create_territory_if_missing: shouldCreateTerritoryFromGeometry,
		territory_name: shouldCreateTerritoryFromGeometry ? displayName : "",
		display,
		validity,
		wiki_public_ids: wikiPublicIds,
		territory_public_ids: territoryPublicIds,
		wiki_nodes: buildPoliticalTerritoryEditorWikiNodes(assignedPath, displays, wikiPublicIds),
		assignment: value,
	});

	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast(result?.message || "Herrschaftsgebiet gespeichert.", "success");
	}
	window.setTimeout(closePoliticalTerritoryEditor, 0);

	return result;
}

async function unassignPoliticalTerritoryEditorGeometry(regionEntry) {
	const geometryPublicId = String(regionEntry.geometryPublicId || regionEntry.geometry_public_id || regionEntry.publicId || "").trim();
	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Bitte das Herrschaftsgebiet erneut aus der Karte oeffnen.");
	}

	const result = await submitPoliticalTerritoryEdit({
		action: "unassign_geometry",
		geometry_public_id: geometryPublicId,
	});
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast(result?.message || "Zuweisung entfernt.", "success");
	}
	window.setTimeout(closePoliticalTerritoryEditor, 0);
	return result;
}

function buildPoliticalTerritoryEditorDisplayPayload(regionEntry, value = {}) {
	const display = value.display || {};
	const opacity = Number(display.opacity ?? regionEntry.opacity ?? 0.33);
	return {
		name: String(display.name || display.displayName || regionEntry.displayName || regionEntry.name || "").trim(),
		displayName: String(display.displayName || display.name || regionEntry.displayName || regionEntry.name || "").trim(),
		coatOfArmsUrl: String(display.coatOfArmsUrl || display.alternateCoatOfArmsUrl || regionEntry.coatOfArmsUrl || "").trim(),
		zoomMin: parsePoliticalTerritoryEditorNumber(display.zoomMin ?? regionEntry.minZoom ?? regionEntry.min_zoom),
		zoomMax: parsePoliticalTerritoryEditorNumber(display.zoomMax ?? regionEntry.maxZoom ?? regionEntry.max_zoom),
		color: String(display.color || regionEntry.color || "#888888").trim() || "#888888",
		opacity: Number.isFinite(opacity) ? Math.max(0, Math.min(1, opacity)) : 0.33,
	};
}

function buildPoliticalTerritoryEditorValidityPayload(regionEntry, value = {}) {
	const validity = value.validity || {};
	const endYear = parsePoliticalTerritoryEditorNumber(validity.endYear ?? regionEntry.validToBf ?? regionEntry.valid_to_bf);
	const existsUntilToday = typeof validity.existsUntilToday === "boolean"
		? validity.existsUntilToday
		: endYear === null;
	return {
		startYear: parsePoliticalTerritoryEditorNumber(validity.startYear ?? regionEntry.validFromBf ?? regionEntry.valid_from_bf),
		endYear: existsUntilToday ? null : endYear,
		existsUntilToday,
	};
}

function buildPoliticalTerritoryEditorWikiNodes(assignedPath, displays, wikiPublicIds) {
	return assignedPath.map((node, index) => {
		const display = displays[index] || {};
		return {
			key: wikiPublicIds[index] || node?.wikiKey || node?.territoryPublicId || "",
			territoryPublicId: node?.territoryPublicId || "",
			territoryId: node?.territoryId || null,
			name: display.displayName || node?.label || node?.key || "",
			type: node?.kind || "Herrschaftsgebiet",
			status: "",
			coat_of_arms_url: display.coatOfArmsUrl || "",
			wiki_url: "",
		};
	});
}

function parsePoliticalTerritoryEditorNumber(value) {
	if (value === "" || value === null || typeof value === "undefined") {
		return null;
	}

	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function refreshPoliticalTerritoryEditorMapLayer() {
	if (typeof loadPoliticalTerritoryOptions === "function") {
		void loadPoliticalTerritoryOptions({ force: true });
	}
	if (typeof schedulePoliticalTerritoryLayerReload === "function") {
		schedulePoliticalTerritoryLayerReload({ immediate: true });
	}
}

function normalizeWikiSyncTerritoryTransferText(value) {
	return String(value ?? "")
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function parseWikiSyncTerritoryTransferNumber(value) {
	if (value === "" || value === null || typeof value === "undefined") {
		return null;
	}

	const number = Number(value);
	return Number.isFinite(number) ? Math.round(number) : null;
}

function readWikiSyncTerritoryStartYear(row = {}) {
	return parseWikiSyncTerritoryTransferNumber(
		row.founded_display_bf
		?? row.founded_start_bf
		?? row.founded_end_bf
		?? null
	);
}

function readWikiSyncTerritoryEndYear(row = {}) {
	return parseWikiSyncTerritoryTransferNumber(
		row.dissolved_display_bf
		?? row.dissolved_start_bf
		?? row.dissolved_end_bf
		?? null
	);
}

function formatWikiSyncTerritoryNodePeriod(row = {}) {
	const startYear = readWikiSyncTerritoryStartYear(row);
	const endYear = readWikiSyncTerritoryEndYear(row);
	if (startYear === null && endYear === null) {
		return "";
	}

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

	if (chainLength === 2) {
		if (index === 0) return { zoomMin: 0, zoomMax: 2 };
		return { zoomMin: 3, zoomMax: 6 };
	}

	if (chainLength === 3) {
		if (index === 0) return { zoomMin: 0, zoomMax: 2 };
		if (index === 1) return { zoomMin: 3, zoomMax: 4 };
		return { zoomMin: 5, zoomMax: 6 };
	}

	if (chainLength === 4) {
		if (index === 0) return { zoomMin: 0, zoomMax: 2 };
		if (index === 1) return { zoomMin: 3, zoomMax: 3 };
		if (index === 2) return { zoomMin: 4, zoomMax: 4 };
		return { zoomMin: 5, zoomMax: 6 };
	}

	if (chainLength === 5) {
		if (index === 0) return { zoomMin: 0, zoomMax: 2 };
		if (index === 1) return { zoomMin: 3, zoomMax: 3 };
		if (index === 2) return { zoomMin: 4, zoomMax: 4 };
		if (index === 3) return { zoomMin: 5, zoomMax: 5 };
		return { zoomMin: 6, zoomMax: 6 };
	}

	if (chainLength === 6) {
		if (index === 0) return { zoomMin: 0, zoomMax: 1 };
		if (index === 1) return { zoomMin: 2, zoomMax: 2 };
		if (index === 2) return { zoomMin: 3, zoomMax: 3 };
		if (index === 3) return { zoomMin: 4, zoomMax: 4 };
		if (index === 4) return { zoomMin: 5, zoomMax: 5 };
		return { zoomMin: 6, zoomMax: 6 };
	}

	// Fallback fuer sehr tiefe Ketten:
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

	const originalBuildTree = treeModule.buildTree;
	treeModule.buildTree = function buildTreeWithNumericPeriodLabels(rows) {
		const result = originalBuildTree.call(this, rows);
		const visit = (node) => {
			if (!node || typeof node !== "object") return;
			if (node.row) {
				node.label = formatWikiSyncTerritoryNodeLabel(node.row, node.label);
			}
			(node.children || []).forEach(visit);
		};
		visit(result?.root);
		return result;
	};
	treeModule.__avesmapsPeriodLabelPatch = true;
	return true;
}

function readWikiSyncTerritoryDragPayload(dataTransfer) {
	if (!dataTransfer) return null;
	const rawJson = dataTransfer.getData("application/x-avesmaps-territory-node-json");
	if (!rawJson) return null;
	try {
		const payload = JSON.parse(rawJson);
		if (!payload || !Array.isArray(payload.path) || payload.path.length < 1) return null;
		return payload;
	} catch (error) {
		return null;
	}
}

function createWikiSyncTerritoryTransferReference(node) {
	const row = node?.row || {};
	const wikiKey = normalizeWikiSyncTerritoryTransferText(row.wiki_key || node?.id || "");
	const name = normalizeWikiSyncTerritoryTransferText(row.name || stripWikiSyncTerritoryPeriodLabel(node?.label || ""));
	const startYear = readWikiSyncTerritoryStartYear(row);
	const endYear = readWikiSyncTerritoryEndYear(row);
	const existsUntilToday = endYear === null;
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
		startYear,
		endYear,
		existsUntilToday,
		path: [],
		pathKeys: [],
	};
}

function createWikiSyncTerritoryDragPayloadFromNode(node) {
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	const pathNodes = typeof treeModule?.getNodePath === "function"
		? treeModule.getNodePath(node)
		: [];
	const path = pathNodes.map(createWikiSyncTerritoryTransferReference);
	path.forEach((entry, index) => {
		entry.path = path.slice(0, index + 1).map((part) => part.label);
		entry.pathKeys = path.slice(0, index + 1).map((part) => part.wikiKey || part.key || part.id);
	});
	return {
		node: path[path.length - 1] || createWikiSyncTerritoryTransferReference(node),
		path,
	};
}

function enhanceWikiSyncTerritoryDragEvent(event) {
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	const rows = Array.isArray(window.wikiSyncTerritoryTreeRowsCache) ? window.wikiSyncTerritoryTreeRowsCache : [];
	if (!treeModule || typeof treeModule.buildTree !== "function" || rows.length < 1 || !event.dataTransfer) {
		return;
	}

	const nodeId = normalizeWikiSyncTerritoryTransferText(
		event.dataTransfer.getData("application/x-avesmaps-territory-node-id")
		|| event.dataTransfer.getData("text/plain")
	);
	if (!nodeId) {
		return;
	}

	const fullTree = treeModule.buildTree(rows);
	const node = fullTree?.nodeRegistry instanceof Map ? fullTree.nodeRegistry.get(nodeId) : null;
	if (!node) {
		return;
	}

	const payload = createWikiSyncTerritoryDragPayloadFromNode(node);
	if (!payload.path.length) {
		return;
	}

	const selected = payload.node || payload.path[payload.path.length - 1];
	event.dataTransfer.setData("application/x-avesmaps-territory-node-json", JSON.stringify(payload));
	event.dataTransfer.setData("application/x-avesmaps-territory", selected.territoryPublicId || selected.wikiKey || selected.key || selected.id || "");
	event.dataTransfer.setData("text/plain", selected.territoryPublicId || selected.wikiKey || selected.key || selected.id || "");
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
			founded_text: reference.startYear === null || typeof reference.startYear === "undefined" ? "" : `${reference.startYear} BF`,
			dissolved_text: reference.existsUntilToday ? "" : `${reference.endYear} BF`,
			valid_from_bf: reference.startYear ?? null,
			valid_to_bf: reference.existsUntilToday ? null : reference.endYear ?? null,
		},
	};
}

function buildWikiSyncTerritoryAssignmentValueFromPayload(payload) {
	const path = Array.isArray(payload?.path) ? payload.path : [];
	const chainLength = path.length;
	const assignedPath = path.map((entry) => ({
		id: entry.id || entry.key || entry.wikiKey || entry.name || "",
		key: entry.key || entry.wikiKey || entry.id || entry.name || "",
		label: entry.name || stripWikiSyncTerritoryPeriodLabel(entry.label || ""),
		kind: entry.type || entry.kind || "Herrschaftsgebiet",
		isSynthetic: false,
		wikiKey: entry.wikiKey || entry.key || "",
		rowId: entry.rowId ?? null,
		territoryPublicId: entry.territoryPublicId || "",
		territoryId: entry.territoryId ?? null,
		path: path.slice(0, path.indexOf(entry) + 1).map((part) => part.name || stripWikiSyncTerritoryPeriodLabel(part.label || "")),
		pathKeys: path.slice(0, path.indexOf(entry) + 1).map((part) => part.wikiKey || part.key || part.id || ""),
	}));
	const displays = path.map((entry, index) => {
		const zoom = defaultWikiSyncTerritoryZoomRange(chainLength, index);
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

async function assignWikiSyncTerritoryPayloadToRegionGeometry(payload, regionEntry) {
	const geometryPublicId = String(regionEntry?.geometryPublicId || regionEntry?.geometry_public_id || regionEntry?.publicId || "").trim();
	if (!geometryPublicId) {
		throw new Error("Die Ziel-Geometrie hat keine Geometrie-ID.");
	}

	const assignmentValue = buildWikiSyncTerritoryAssignmentValueFromPayload(payload);
	const wikiPublicIds = assignmentValue.assignedPath.map((node) => String(node.wikiKey || "").trim()).filter(Boolean);
	if (wikiPublicIds.length < 1) {
		throw new Error("Der gezogene Wiki-Knoten hat keinen WikiKey.");
	}

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

	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof loadChangeLog === "function") {
		void loadChangeLog();
	}
	return result;
}

async function assignWikiSyncTerritoryPayloadInsideLegacyEditor(payload) {
	if (!payload?.path?.length || typeof ensurePoliticalTerritoryChainFromWikiPath !== "function") {
		return false;
	}

	const path = payload.path.map(wikiSyncTerritoryReferenceToAssignmentNode);
	const selected = path[path.length - 1] || null;
	const selectedPublicId = String(selected?.territory?.public_id || "").trim();
	if (!selected || !selectedPublicId) {
		return false;
	}

	regionAssignmentWikiPath = path;
	regionAssignmentEnsuredChain = [];
	regionAssignmentActiveWikiPublicId = selectedPublicId;
	storeRegionAssignmentBreadcrumbCaches(path, [], selectedPublicId);
	renderRegionAssignment(path, regionAssignmentEnsuredChain, selectedPublicId);
	setRegionEditStatus("Wiki-Hierarchie wird dem Gebiet zugewiesen...", "pending");
	const response = await ensurePoliticalTerritoryChainFromWikiPath(path);
	const selectedTerritoryId = response.selected?.territory?.public_id || "";
	if (!selectedTerritoryId) {
		throw new Error("Das Herrschaftsgebiet konnte nicht aus dem Wiki-Knoten erzeugt werden.");
	}
	regionAssignmentActiveWikiPublicId = selectedTerritoryId;
	storeRegionAssignmentBreadcrumbCaches(path, response.chain || [], selectedTerritoryId);
	await activatePrimaryRegionEditTabForTerritory(selectedTerritoryId);
	renderRegionAssignment(path, regionAssignmentEnsuredChain, selectedTerritoryId);
	setRegionEditStatus("Herrschaftsgebiet zugewiesen. Speichern uebernimmt die Geometrie dauerhaft.", "success");
	return true;
}

function findRegionLayerForWikiSyncDrop(event) {
	if (typeof map === "undefined" || typeof L === "undefined" || typeof getOverlappingPoliticalRegionLayersAtLatLng !== "function") {
		return null;
	}

	const latlng = map.mouseEventToLatLng(event);
	const candidates = getOverlappingPoliticalRegionLayersAtLatLng(latlng);
	return candidates[0] || null;
}

function isEventTargetInsideSelector(event, selector) {
	const target = event?.target;
	return target instanceof Element && typeof target.closest === "function" && Boolean(target.closest(selector));
}

function initializeWikiSyncTerritoryDragAssignment() {
	installWikiSyncTerritoryTreeDisplayPatch();
	let attempts = 0;
	const patchTimer = window.setInterval(() => {
		attempts += 1;
		if (installWikiSyncTerritoryTreeDisplayPatch() || attempts > 120) {
			window.clearInterval(patchTimer);
		}
	}, 25);

	document.addEventListener("dragstart", (event) => {
		if (!isEventTargetInsideSelector(event, "#wiki-sync-territory-tree, #treeView")) {
			return;
		}
		enhanceWikiSyncTerritoryDragEvent(event);
	});

	document.addEventListener("dragover", (event) => {
		const payload = readWikiSyncTerritoryDragPayload(event.dataTransfer);
		if (!payload) {
			return;
		}

		if (isEventTargetInsideSelector(event, "#map") || isEventTargetInsideSelector(event, "#region-edit-assignment-drop")) {
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		}
	});

	document.addEventListener("drop", (event) => {
		const payload = readWikiSyncTerritoryDragPayload(event.dataTransfer);
		if (!payload) {
			return;
		}

		if (isEventTargetInsideSelector(event, "#region-edit-assignment-drop")) {
			event.preventDefault();
			event.stopPropagation();
			void assignWikiSyncTerritoryPayloadInsideLegacyEditor(payload).catch((error) => {
				console.error("Herrschaftsgebiet konnte nicht im Editor zugewiesen werden:", error);
				if (typeof setRegionEditStatus === "function") {
					setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht zugewiesen werden.", "error");
				}
			});
			return;
		}

		if (!isEventTargetInsideSelector(event, "#map")) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		const regionLayer = findRegionLayerForWikiSyncDrop(event);
		const regionEntry = regionLayer?._regionEntry || null;
		if (!regionEntry || regionEntry.source !== "political_territory") {
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast("Bitte auf eine Herrschaftsgebiets-Geometrie ziehen.", "warning");
			}
			return;
		}

		void assignWikiSyncTerritoryPayloadToRegionGeometry(payload, regionEntry).then(() => {
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast("Herrschaftsgebiet wurde der Geometrie zugewiesen.", "success");
			}
		}).catch((error) => {
			console.error("Herrschaftsgebiet konnte der Geometrie nicht zugewiesen werden:", error);
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(error.message || "Herrschaftsgebiet konnte nicht zugewiesen werden.", "warning");
			}
		});
	});
}

function initializePoliticalTerritoryEditorPopup() {
	const { overlay, closeButton, frame } = getPoliticalTerritoryEditorElements();
	closeButton?.addEventListener("click", closePoliticalTerritoryEditor);
	frame?.addEventListener("load", setupPoliticalTerritoryEditorFrame);
	overlay?.addEventListener("click", (event) => {
		if (event.target === overlay) {
			closePoliticalTerritoryEditor();
		}
	});
	initializeWikiSyncTerritoryDragAssignment();
}

function openPoliticalTerritoryWikiSyncSettings() {
	const settingsUrl = "/html/wiki-dom-sync-settings.html";
	const openedWindow = window.open(settingsUrl, "_blank", "noopener,noreferrer");
	if (!openedWindow && typeof setWikiSyncStatus === "function") {
		setWikiSyncStatus("Popup blockiert: Bitte Popups erlauben oder Link in neuem Tab öffnen.", "error");
	}
}

window.startWikiSyncTerritoryRun = function startWikiSyncTerritoryRunFromSettingsLink() {
	if (typeof setWikiSyncStatus === "function") {
		setWikiSyncStatus("Synchronisierungseinstellungen werden geöffnet...", "pending");
	}
	openPoliticalTerritoryWikiSyncSettings();
};

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", initializePoliticalTerritoryEditorPopup, { once: true });
} else {
	initializePoliticalTerritoryEditorPopup();
}

window.AvesmapsPoliticalTerritoryEditorLink = {
	createUrl: createPoliticalTerritoryEditorUrl,
	open: openPoliticalTerritoryEditor,
	close: closePoliticalTerritoryEditor,
	isOpen: isPoliticalTerritoryEditorOpen,
};
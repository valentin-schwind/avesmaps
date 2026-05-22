"use strict";

const POLITICAL_TERRITORY_DISPLAY_OVERRIDES_API_URL = "/api/political-territory-display-overrides.php";

let activePoliticalTerritoryEditorRegion = null;
let pendingPoliticalTerritoryEditorFrameSetup = null;
let activePoliticalTerritoryEditorPendingLocalOverride = false;
let activePoliticalTerritoryEditorPromoteNextSave = false;

function createPoliticalTerritoryEditorUrl(regionEntry = {}) {
	const params = new URLSearchParams();
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry);
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

function getPoliticalTerritoryEditorGeometryPublicId(regionEntry = {}) {
	return String(regionEntry.geometryPublicId || regionEntry.geometry_public_id || regionEntry.publicId || "").trim();
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
	if (!overlay) return;
	overlay.hidden = !isOpen;
	if (typeof syncModalDialogBodyState === "function") syncModalDialogBodyState();
	if (isOpen) dialog?.focus();
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
	activePoliticalTerritoryEditorPendingLocalOverride = false;
	activePoliticalTerritoryEditorPromoteNextSave = false;
	if (frame) frame.removeAttribute("src");
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
	activePoliticalTerritoryEditorPendingLocalOverride = false;
	activePoliticalTerritoryEditorPromoteNextSave = false;
	frame.src = createEmbeddedPoliticalTerritoryEditorUrl(regionEntry);
	setPoliticalTerritoryEditorOpen(true);
}

function setupPoliticalTerritoryEditorFrame() {
	const { frame } = getPoliticalTerritoryEditorElements();
	const regionEntry = pendingPoliticalTerritoryEditorFrameSetup || activePoliticalTerritoryEditorRegion;
	if (!frame || !regionEntry) return;

	const assignmentModule = frame.contentWindow?.AvesmapsPoliticalTerritoryAssignment;
	if (!assignmentModule || typeof assignmentModule.configure !== "function") return;

	assignmentModule.configure({
		onSave: (value) => savePoliticalTerritoryEditorAssignment(regionEntry, value),
		onUnassign: () => unassignPoliticalTerritoryEditorGeometry(regionEntry),
		onCancel: () => closePoliticalTerritoryEditor(),
	});
	installPoliticalTerritoryEditorOverrideFooter(frame, regionEntry);
	void refreshPoliticalTerritoryEditorOverrideFooter(regionEntry);
	pendingPoliticalTerritoryEditorFrameSetup = null;
}

function getPoliticalTerritoryEditorFrameDocument(frame = getPoliticalTerritoryEditorElements().frame) {
	return frame?.contentDocument || frame?.contentWindow?.document || null;
}

function installPoliticalTerritoryEditorOverrideFooter(frame, regionEntry) {
	const doc = getPoliticalTerritoryEditorFrameDocument(frame);
	if (!doc || doc.getElementById("political-territory-local-override-footer")) return;

	const style = doc.createElement("style");
	style.textContent = `
		.local-override-footer {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			gap: 10px;
			align-items: center;
			padding: 10px 12px;
			border: 1px solid #cdb79f;
			border-radius: 8px;
			background: #fff4df;
			color: #4f3b29;
		}
		.local-override-footer[hidden] { display: none !important; }
		.local-override-footer__text { font-weight: 700; }
		.local-override-footer__text small { display: block; margin-top: 2px; color: #806c59; font-weight: 400; }
		.local-override-footer__actions { display: inline-flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
		@media (max-width: 620px) { .local-override-footer { grid-template-columns: 1fr; } .local-override-footer__actions { justify-content: stretch; } .local-override-footer__actions button { flex: 1; } }
	`;
	doc.head.append(style);

	const footer = doc.createElement("div");
	footer.id = "political-territory-local-override-footer";
	footer.className = "local-override-footer";
	footer.hidden = true;
	footer.innerHTML = `
		<div class="local-override-footer__text">
			Lokale Einstellung aktiv. Globale Darstellung wird überschrieben.
			<small>Diese Werte gelten nur für diese Geometrie, bis sie zurückgesetzt oder global übernommen werden.</small>
		</div>
		<div class="local-override-footer__actions">
			<button class="secondary" type="button" data-local-override-action="reset">Zurücksetzen zu global</button>
			<button type="button" data-local-override-action="promote">Zu global machen</button>
		</div>
	`;
	(doc.querySelector(".manual-data-box") || doc.querySelector(".manual-data-panel"))?.append(footer);

	footer.querySelector('[data-local-override-action="reset"]')?.addEventListener("click", () => {
		void resetPoliticalTerritoryEditorLocalDisplay(regionEntry);
	});
	footer.querySelector('[data-local-override-action="promote"]')?.addEventListener("click", () => {
		void promotePoliticalTerritoryEditorLocalDisplay(frame);
	});

	doc.querySelectorAll("#displayNameInput, #alternateCoatInput, #zoomFromInput, #zoomToInput, #colorInput, #transparencyInput, #startYearInput, #endYearInput, #existsUntilTodayInput").forEach((element) => {
		["input", "change"].forEach((eventName) => {
			element.addEventListener(eventName, () => {
				activePoliticalTerritoryEditorPendingLocalOverride = true;
				syncPoliticalTerritoryEditorOverrideFooterVisibility(true);
			});
		});
	});
}

function syncPoliticalTerritoryEditorOverrideFooterVisibility(isVisible) {
	const doc = getPoliticalTerritoryEditorFrameDocument();
	const footer = doc?.getElementById("political-territory-local-override-footer");
	if (footer) footer.hidden = !isVisible;
}

async function refreshPoliticalTerritoryEditorOverrideFooter(regionEntry = activePoliticalTerritoryEditorRegion) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry || {});
	if (!geometryPublicId) return;
	try {
		const state = await submitPoliticalTerritoryDisplayOverrideAction({
			action: "state",
			geometry_public_id: geometryPublicId,
		});
		syncPoliticalTerritoryEditorOverrideFooterVisibility(Boolean(state?.has_override || activePoliticalTerritoryEditorPendingLocalOverride));
	} catch (error) {
		console.warn("Lokaler Darstellungsstatus konnte nicht gelesen werden:", error);
	}
}

async function resetPoliticalTerritoryEditorLocalDisplay(regionEntry = activePoliticalTerritoryEditorRegion) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry || {});
	if (!geometryPublicId) return;
	if (!window.confirm("Lokale Darstellung verwerfen und wieder globale Einstellungen verwenden?")) return;

	await submitPoliticalTerritoryDisplayOverrideAction({
		action: "reset_local",
		geometry_public_id: geometryPublicId,
	});
	activePoliticalTerritoryEditorPendingLocalOverride = false;
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") showFeedbackToast("Lokale Darstellung zurückgesetzt.", "success");
	const assignmentModule = getPoliticalTerritoryEditorElements().frame?.contentWindow?.AvesmapsPoliticalTerritoryAssignment;
	if (typeof assignmentModule?.reload === "function") {
		await assignmentModule.reload();
		installPoliticalTerritoryEditorOverrideFooter(getPoliticalTerritoryEditorElements().frame, regionEntry);
	}
	syncPoliticalTerritoryEditorOverrideFooterVisibility(false);
}

async function promotePoliticalTerritoryEditorLocalDisplay(frame = getPoliticalTerritoryEditorElements().frame) {
	activePoliticalTerritoryEditorPromoteNextSave = true;
	const assignmentModule = frame?.contentWindow?.AvesmapsPoliticalTerritoryAssignment;
	if (typeof assignmentModule?.save !== "function") {
		activePoliticalTerritoryEditorPromoteNextSave = false;
		throw new Error("Die lokale Darstellung konnte nicht global übernommen werden.");
	}
	await assignmentModule.save();
}

async function submitPoliticalTerritoryDisplayOverrideAction(payload) {
	const response = await fetch(POLITICAL_TERRITORY_DISPLAY_OVERRIDES_API_URL, {
		method: "POST",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/json",
			"Accept": "application/json",
		},
		body: JSON.stringify(payload),
	});
	const result = await response.json().catch(() => null);
	if (!response.ok || result?.ok === false) {
		throw new Error(result?.error || `Darstellungs-Override fehlgeschlagen: HTTP ${response.status}`);
	}
	return result;
}

async function snapshotPoliticalTerritoryEditorGlobals(value = {}) {
	const displays = Array.isArray(value.displays) ? value.displays : [];
	if (displays.length < 1) return null;
	return submitPoliticalTerritoryDisplayOverrideAction({
		action: "snapshot_globals",
		displays,
	});
}

async function restorePoliticalTerritoryEditorGlobals(snapshotResult) {
	const snapshots = Array.isArray(snapshotResult?.snapshots) ? snapshotResult.snapshots : [];
	if (snapshots.length < 1) return null;
	return submitPoliticalTerritoryDisplayOverrideAction({
		action: "restore_globals",
		snapshots,
	});
}

async function clearPoliticalTerritoryEditorLocalOverrides(geometryPublicId) {
	if (!geometryPublicId) return null;
	return submitPoliticalTerritoryDisplayOverrideAction({
		action: "reset_local",
		geometry_public_id: geometryPublicId,
	});
}

async function savePoliticalTerritoryEditorAssignment(regionEntry, value = {}) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry);
	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Bitte das Herrschaftsgebiet erneut aus der Karte oeffnen.");
	}

	const shouldPromote = activePoliticalTerritoryEditorPromoteNextSave === true;
	activePoliticalTerritoryEditorPromoteNextSave = false;
	const globalSnapshot = shouldPromote ? null : await snapshotPoliticalTerritoryEditorGlobals(value);
	const assignedPath = Array.isArray(value.assignedPath) ? value.assignedPath : [];
	const displays = Array.isArray(value.displays) ? value.displays : [];
	const wikiPublicIds = assignedPath.map((node) => String(node?.wikiKey || "").trim()).filter(Boolean);
	const territoryPublicIds = assignedPath.map((node) => String(node?.territoryPublicId || "").trim()).filter(Boolean);
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

	await syncPoliticalTerritoryEditorAssignmentZooms(value);
	if (shouldPromote) {
		await clearPoliticalTerritoryEditorLocalOverrides(geometryPublicId);
	} else {
		await restorePoliticalTerritoryEditorGlobals(globalSnapshot);
	}

	activePoliticalTerritoryEditorPendingLocalOverride = false;
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast(shouldPromote ? "Lokale Darstellung global übernommen." : result?.message || "Herrschaftsgebiet gespeichert.", "success");
	}
	window.setTimeout(closePoliticalTerritoryEditor, 0);
	return result;
}

async function syncPoliticalTerritoryEditorAssignmentZooms(value = {}) {
	const displays = Array.isArray(value.displays) ? value.displays : [];
	const syncDisplays = displays.filter((display) => String(display?.territoryPublicId || "").trim() !== "");
	if (syncDisplays.length < 1) return null;

	try {
		const response = await fetch("/api/political-territory-assignment-zoom-sync.php", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ displays: syncDisplays }),
		});
		const result = await response.json().catch(() => null);
		if (!response.ok || result?.ok === false) {
			throw new Error(result?.error || "Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden.");
		}
		return result;
	} catch (error) {
		console.warn("Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden:", error);
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast(error.message || "Breadcrumb-Zoomstufen konnten nicht global synchronisiert werden.", "warning");
		}
		return null;
	}
}

async function unassignPoliticalTerritoryEditorGeometry(regionEntry) {
	const geometryPublicId = getPoliticalTerritoryEditorGeometryPublicId(regionEntry);
	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Bitte das Herrschaftsgebiet erneut aus der Karte oeffnen.");
	}

	const result = await submitPoliticalTerritoryEdit({
		action: "unassign_geometry",
		geometry_public_id: geometryPublicId,
	});
	refreshPoliticalTerritoryEditorMapLayer();
	if (typeof showFeedbackToast === "function") showFeedbackToast(result?.message || "Zuweisung entfernt.", "success");
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
	const existsUntilToday = typeof validity.existsUntilToday === "boolean" ? validity.existsUntilToday : endYear === null;
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
	if (value === "" || value === null || typeof value === "undefined") return null;
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function refreshPoliticalTerritoryEditorMapLayer() {
	if (typeof loadPoliticalTerritoryOptions === "function") void loadPoliticalTerritoryOptions({ force: true });
	if (typeof schedulePoliticalTerritoryLayerReload === "function") schedulePoliticalTerritoryLayerReload({ immediate: true });
}

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

function readWikiSyncTerritoryDragPayload(dataTransfer) {
	if (!dataTransfer) return null;
	const rawJson = dataTransfer.getData("application/x-avesmaps-territory-node-json");
	if (!rawJson) return null;
	try {
		const payload = JSON.parse(rawJson);
		return payload && Array.isArray(payload.path) && payload.path.length > 0 ? payload : null;
	} catch (error) {
		return null;
	}
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

function enhanceWikiSyncTerritoryDragEvent(event) {
	const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
	const rows = Array.isArray(window.wikiSyncTerritoryTreeRowsCache) ? window.wikiSyncTerritoryTreeRowsCache : [];
	if (!treeModule || typeof treeModule.buildTree !== "function" || rows.length < 1 || !event.dataTransfer) return;
	const nodeId = normalizeWikiSyncTerritoryTransferText(event.dataTransfer.getData("application/x-avesmaps-territory-node-id") || event.dataTransfer.getData("text/plain"));
	if (!nodeId) return;
	const fullTree = treeModule.buildTree(rows);
	const node = fullTree?.nodeRegistry instanceof Map ? fullTree.nodeRegistry.get(nodeId) : null;
	if (!node) return;
	const payload = createWikiSyncTerritoryDragPayloadFromNode(node);
	if (!payload.path.length) return;
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
	refreshPoliticalTerritoryEditorMapLayer();
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
	setRegionEditStatus("Herrschaftsgebiet zugewiesen. Speichern uebernimmt die Geometrie dauerhaft.", "success");
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

function initializeWikiSyncTerritoryDragAssignment() {
	installWikiSyncTerritoryTreeDisplayPatch();
	let attempts = 0;
	const patchTimer = window.setInterval(() => {
		attempts += 1;
		if (installWikiSyncTerritoryTreeDisplayPatch() || attempts > 120) window.clearInterval(patchTimer);
	}, 25);

	document.addEventListener("dragstart", (event) => {
		if (!isEventTargetInsideSelector(event, "#wiki-sync-territory-tree, #treeView")) return;
		enhanceWikiSyncTerritoryDragEvent(event);
	});

	document.addEventListener("dragover", (event) => {
		const payload = readWikiSyncTerritoryDragPayload(event.dataTransfer);
		if (!payload) return;
		if (isEventTargetInsideSelector(event, "#map") || isEventTargetInsideSelector(event, "#region-edit-assignment-drop")) {
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
		}
	});

	document.addEventListener("drop", (event) => {
		const payload = readWikiSyncTerritoryDragPayload(event.dataTransfer);
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
		if (!isEventTargetInsideSelector(event, "#map")) return;
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

function initializePoliticalTerritoryEditorPopup() {
	const { overlay, closeButton, frame } = getPoliticalTerritoryEditorElements();
	closeButton?.addEventListener("click", closePoliticalTerritoryEditor);
	frame?.addEventListener("load", setupPoliticalTerritoryEditorFrame);
	overlay?.addEventListener("click", (event) => {
		if (event.target === overlay) closePoliticalTerritoryEditor();
	});
	initializeWikiSyncTerritoryDragAssignment();
}

function openPoliticalTerritoryWikiSyncSettings() {
	const openedWindow = window.open("/html/wiki-dom-sync-settings.html", "_blank", "noopener,noreferrer");
	if (!openedWindow && typeof setWikiSyncStatus === "function") {
		setWikiSyncStatus("Popup blockiert: Bitte Popups erlauben oder Link in neuem Tab öffnen.", "error");
	}
}

window.startWikiSyncTerritoryRun = function startWikiSyncTerritoryRunFromSettingsLink() {
	if (typeof setWikiSyncStatus === "function") setWikiSyncStatus("Synchronisierungseinstellungen werden geöffnet...", "pending");
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

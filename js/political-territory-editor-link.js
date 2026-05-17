"use strict";

let activePoliticalTerritoryEditorRegion = null;
let pendingPoliticalTerritoryEditorFrameSetup = null;

function createPoliticalTerritoryEditorUrl(regionEntry = {}) {
	const params = new URLSearchParams();
	const geometryPublicId = String(regionEntry.geometryPublicId || regionEntry.geometry_public_id || regionEntry.publicId || "").trim();
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
	if (territoryPublicId) params.set("territory_public_id", territoryPublicId);
	if (wikiKey) params.set("wiki_key", wikiKey);
	if (name) params.set("name", name);
	if (color) params.set("color", color);
	if (Number.isFinite(opacity)) params.set("opacity", String(opacity));
	if (minZoom !== "" && minZoom !== null && typeof minZoom !== "undefined") params.set("min_zoom", String(minZoom));
	if (maxZoom !== "" && maxZoom !== null && typeof maxZoom !== "undefined") params.set("max_zoom", String(maxZoom));
	if (validFromBf !== "" && validFromBf !== null && typeof validFromBf !== "undefined") params.set("valid_from_bf", String(validFromBf));
	if (validToBf !== "" && validToBf !== null && typeof validToBf !== "undefined") params.set("valid_to_bf", String(validToBf));

	return `html/political-territory-editor.html${params.toString() ? `?${params.toString()}` : ""}`;
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
		.map((node) => String(node?.wikiKey || node?.id || node?.key || node?.label || "").trim())
		.filter(Boolean);
	const hasAssignedTerritory = assignedPath.length > 0 && wikiPublicIds.length > 0;
	const display = buildPoliticalTerritoryEditorDisplayPayload(regionEntry, value);
	const validity = buildPoliticalTerritoryEditorValidityPayload(regionEntry, value);

	const result = await submitPoliticalTerritoryEdit({
		action: "save_geometry_assignment",
		geometry_public_id: geometryPublicId,
		display_only: !hasAssignedTerritory,
		display,
		validity,
		wiki_public_ids: wikiPublicIds,
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
			key: wikiPublicIds[index] || node?.wikiKey || node?.id || node?.key || node?.label || "",
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

function initializePoliticalTerritoryEditorPopup() {
	const { overlay, closeButton, frame } = getPoliticalTerritoryEditorElements();
	closeButton?.addEventListener("click", closePoliticalTerritoryEditor);
	frame?.addEventListener("load", setupPoliticalTerritoryEditorFrame);
	overlay?.addEventListener("click", (event) => {
		if (event.target === overlay) {
			closePoliticalTerritoryEditor();
		}
	});
}

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

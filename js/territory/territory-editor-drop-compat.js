"use strict";

(function installTerritoryEditorDropCompat() {
	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function makeKey(value) {
		return normalizeText(value)
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/ß/g, "ss")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	function parseJsonData(dataTransfer, type) {
		try {
			const raw = dataTransfer?.getData(type) || "";
			return raw ? JSON.parse(raw) : null;
		} catch (error) {
			return null;
		}
	}

	function readDragPayload(dataTransfer) {
		const jsonPayload = parseJsonData(dataTransfer, "application/x-avesmaps-territory-node-json")
			|| parseJsonData(dataTransfer, "application/json")
			|| parseJsonData(dataTransfer, "text/json");
		if (jsonPayload?.node || Array.isArray(jsonPayload?.path)) {
			return jsonPayload;
		}

		const territoryPublicId = normalizeText(dataTransfer?.getData("application/x-avesmaps-territory") || "");
		if (territoryPublicId) {
			const row = findCachedRowByPublicId(territoryPublicId);
			if (row) return payloadFromCachedRow(row);
			return { node: { territoryPublicId, key: territoryPublicId, label: territoryPublicId, name: territoryPublicId }, path: [] };
		}

		return null;
	}

	function findCachedRowByPublicId(publicId) {
		const rows = Array.isArray(window.AvesmapsWikiSyncTerritoryTreeRowsCache)
			? window.AvesmapsWikiSyncTerritoryTreeRowsCache
			: [];
		return rows.find((row) => normalizeText(row?.public_id) === publicId) || null;
	}

	function payloadFromCachedRow(row) {
		const rows = Array.isArray(window.AvesmapsWikiSyncTerritoryTreeRowsCache)
			? window.AvesmapsWikiSyncTerritoryTreeRowsCache
			: [];
		const pathNames = Array.isArray(row?.affiliation_path) ? row.affiliation_path.map(normalizeText).filter(Boolean) : [];
		const path = [];
		for (const pathName of pathNames) {
			const pathKey = makeKey(pathName);
			const pathRow = rows.find((candidate) => makeKey(candidate?.name) === pathKey) || null;
			path.push(referenceFromRow(pathRow, pathName));
		}
		path.push(referenceFromRow(row, normalizeText(row?.name)));
		return { node: path[path.length - 1], path };
	}

	function referenceFromRow(row, fallbackLabel = "") {
		const label = normalizeText(row?.name || fallbackLabel);
		return {
			id: normalizeText(row?.wiki_key || row?.public_id || row?.slug || label),
			key: normalizeText(row?.wiki_key || row?.public_id || row?.slug || label),
			label,
			name: label,
			kind: normalizeText(row?.type || "Herrschaftsgebiet"),
			wikiKey: normalizeText(row?.wiki_key || ""),
			rowId: row?.id || null,
			territoryPublicId: normalizeText(row?.public_id || ""),
			territoryId: row?.territory_id || null,
			slug: normalizeText(row?.slug || ""),
			coatOfArmsUrl: normalizeText(row?.coat_of_arms_url || ""),
			startYear: row?.founded_start_bf ?? row?.founded_display_bf ?? null,
			endYear: row?.dissolved_end_bf ?? row?.dissolved_display_bf ?? null,
			existsUntilToday: row?.dissolved_end_bf === null || typeof row?.dissolved_end_bf === "undefined",
		};
	}

	function displayKey(display) {
		return normalizeText(
			display?.territoryPublicId
			|| display?.wikiKey
			|| display?.slug
			|| display?.nodeKey
			|| display?.key
			|| display?.name
			|| display?.label
		);
	}

	function defaultDisplay(reference, index) {
		return {
			nodeId: reference.id || reference.key || reference.label || "",
			nodeKey: makeKey(reference.label || reference.name || reference.key || ""),
			wikiKey: reference.wikiKey || "",
			rowId: reference.rowId || null,
			territoryPublicId: reference.territoryPublicId || "",
			territoryId: reference.territoryId || null,
			slug: reference.slug || "",
			name: reference.name || reference.label || "",
			displayName: reference.name || reference.label || "",
			coatOfArmsUrl: reference.coatOfArmsUrl || "",
			zoomMin: null,
			zoomMax: null,
			color: "#385d72",
			opacity: 0.33,
			startYear: reference.startYear ?? null,
			endYear: reference.existsUntilToday ? null : reference.endYear ?? null,
			existsUntilToday: reference.existsUntilToday !== false,
			depth: index,
		};
	}

	function buildAssignmentValue(payload, previousValue) {
		const path = Array.isArray(payload?.path) && payload.path.length > 0
			? payload.path
			: [payload.node].filter(Boolean);
		if (path.length < 1) return null;

		const previousDisplays = Array.isArray(previousValue?.displays) ? previousValue.displays : [];
		const previousByKey = new Map();
		for (const display of previousDisplays) {
			const key = displayKey(display);
			if (key) previousByKey.set(key, display);
		}

		const displays = path.map((reference, index) => {
			const base = defaultDisplay(reference, index);
			const key = displayKey(reference) || displayKey(base);
			const previous = key ? previousByKey.get(key) : null;
			return previous ? { ...base, ...previous, depth: index } : base;
		});

		return {
			version: "drop-compat",
			assignedTerritory: path[path.length - 1],
			activeDisplayNode: path[path.length - 1],
			assignedPath: path,
			editedPath: path,
			display: displays[displays.length - 1],
			validity: {
				startYear: displays[displays.length - 1]?.startYear ?? null,
				endYear: displays[displays.length - 1]?.endYear ?? null,
				existsUntilToday: displays[displays.length - 1]?.existsUntilToday !== false,
			},
			displays,
			source: {
				assignedRow: null,
				editedRow: null,
			},
		};
	}

	function onDrop(event) {
		const payload = readDragPayload(event.dataTransfer);
		if (!payload) return;
		const assignment = window.AvesmapsPoliticalTerritoryAssignment;
		if (!assignment?.setValue || !assignment?.getValue) return;

		event.preventDefault();
		event.stopImmediatePropagation();
		document.getElementById("dropZone")?.classList.remove("drag-over");

		const nextValue = buildAssignmentValue(payload, assignment.getValue());
		if (!nextValue) return;
		assignment.setValue(nextValue);
	}

	function install() {
		const dropZone = document.getElementById("dropZone");
		if (!dropZone) return;
		dropZone.addEventListener("drop", onDrop, true);
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
	else install();
})();

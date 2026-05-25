"use strict";

(function installWikiSyncTerritoryAssignmentDropFix(globalObject) {
	function normalizeText(value) {
		return String(value ?? "")
			.replace(/\u00a0/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function parseOptionalYear(value) {
		if (value === "" || value === null || typeof value === "undefined") {
			return null;
		}

		const number = Number(value);
		return Number.isFinite(number) ? Math.round(number) : null;
	}

	function readStartYear(row = {}) {
		return parseOptionalYear(row.founded_display_bf ?? row.founded_start_bf ?? row.founded_end_bf ?? null);
	}

	function readEndYear(row = {}) {
		return parseOptionalYear(row.dissolved_display_bf ?? row.dissolved_start_bf ?? row.dissolved_end_bf ?? null);
	}

	function formatYear(year) {
		if (!Number.isFinite(year)) {
			return "";
		}

		return year < 0 ? `${Math.abs(year)} v. BF` : `${year} BF`;
	}

	function formatPeriod(row = {}) {
		const startYear = readStartYear(row);
		const endYear = readEndYear(row);
		if (startYear === null && endYear === null) {
			return "";
		}

		return `${startYear === null ? "?" : formatYear(startYear)} - ${endYear === null ? "heute" : formatYear(endYear)}`;
	}

	function makeKey(value) {
		const treeModule = globalObject.AvesmapsPoliticalTerritoryWikiTree;
		if (treeModule && typeof treeModule.makeKey === "function") {
			return treeModule.makeKey(value);
		}

		return normalizeText(value)
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/\u00df/g, "ss")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	function getCachedRows() {
		if (Array.isArray(globalObject.AvesmapsWikiSyncTerritoryTreeRowsCache)) {
			return globalObject.AvesmapsWikiSyncTerritoryTreeRowsCache;
		}

		if (Array.isArray(globalObject.wikiSyncTerritoryTreeRowsCache)) {
			return globalObject.wikiSyncTerritoryTreeRowsCache;
		}

		try {
			if (Array.isArray(wikiSyncTerritoryTreeRowsCache)) {
				return wikiSyncTerritoryTreeRowsCache;
			}
		} catch (error) {
			// Global lexical cache is not visible in this execution context.
		}

		return [];
	}

	function getDataTransferNodeId(dataTransfer) {
		if (!dataTransfer) {
			return "";
		}

		return normalizeText(
			dataTransfer.getData("application/x-avesmaps-territory-node-id")
			|| dataTransfer.getData("application/x-avesmaps-territory")
			|| dataTransfer.getData("text/plain")
		);
	}

	function findNodeInRegistry(registry, nodeId) {
		if (!(registry instanceof Map) || !nodeId) {
			return null;
		}

		if (registry.has(nodeId)) {
			return registry.get(nodeId);
		}

		const normalizedId = makeKey(nodeId.replace(/^wiki:/i, ""));
		for (const node of registry.values()) {
			const row = node?.row || {};
			const candidates = [
				node.id,
				row.wiki_key,
				row.public_id,
				row.name,
			].map(makeKey).filter(Boolean);
			if (candidates.includes(normalizedId)) {
				return node;
			}
		}

		return null;
	}

	function resolveFullWikiSyncNodeFromDrop(dataTransfer) {
		const treeModule = globalObject.AvesmapsPoliticalTerritoryWikiTree;
		const rows = getCachedRows();
		const nodeId = getDataTransferNodeId(dataTransfer);
		if (!treeModule || typeof treeModule.buildTree !== "function" || !nodeId || rows.length < 1) {
			return null;
		}

		const tree = treeModule.buildTree(rows);
		return findNodeInRegistry(tree?.nodeRegistry, nodeId);
	}

	function nodeToLegacyAssignmentPathEntry(node) {
		const row = node?.row || {};
		const name = normalizeText(row.name || node?.label || "Herrschaftsgebiet").replace(/\s*\([^)]*\bBF\s*-\s*[^)]*\)\s*$/iu, "").trim();
		const period = formatPeriod(row);
		const startYear = readStartYear(row);
		const endYear = readEndYear(row);
		const wikiKey = normalizeText(row.wiki_key || node?.id || name);

		return {
			territory: {
				public_id: wikiKey,
				wiki_key: wikiKey,
				name,
				type: normalizeText(row.type || "Herrschaftsgebiet"),
				status: normalizeText(row.status || ""),
				valid_label: period,
				wiki_name: name,
				wiki_url: normalizeText(row.wiki_url || ""),
				coat_of_arms_url: normalizeText(row.coat_of_arms_url || ""),
				founded_text: startYear === null ? normalizeText(row.founded_text || "") : formatYear(startYear),
				dissolved_text: endYear === null ? normalizeText(row.dissolved_text || "") : formatYear(endYear),
				valid_from_bf: startYear,
				valid_to_bf: endYear,
			},
		};
	}

	function buildFullLegacyPathFromDrop(dataTransfer) {
		const node = resolveFullWikiSyncNodeFromDrop(dataTransfer);
		const treeModule = globalObject.AvesmapsPoliticalTerritoryWikiTree;
		if (!node || typeof treeModule?.getNodePath !== "function") {
			return [];
		}

		return treeModule.getNodePath(node).map(nodeToLegacyAssignmentPathEntry);
	}

	async function assignFullPathInsideEditor(path) {
		if (!Array.isArray(path) || path.length < 1) {
			throw new Error("Der vollständige Wiki-Pfad konnte nicht bestimmt werden.");
		}

		const selected = path[path.length - 1] || null;
		const selectedPublicId = normalizeText(selected?.territory?.public_id || "");
		if (!selectedPublicId) {
			throw new Error("Der gezogene Wiki-Knoten hat keinen WikiKey.");
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
	}

	function handleEditorAssignmentDropCapture(event) {
		if (!(event.target instanceof HTMLElement) || !event.target.closest("#region-edit-assignment-drop")) {
			return;
		}

		const path = buildFullLegacyPathFromDrop(event.dataTransfer);
		if (path.length < 1) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		event.stopImmediatePropagation();
		event.dataTransfer.dropEffect = "copy";

		void assignFullPathInsideEditor(path).catch((error) => {
			console.error("Vollständiger Herrschaftsgebiet-Pfad konnte nicht zugewiesen werden:", error);
			if (typeof setRegionEditStatus === "function") {
				setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht zugewiesen werden.", "error");
			}
		});
	}

	document.addEventListener("drop", handleEditorAssignmentDropCapture, true);
})(window);

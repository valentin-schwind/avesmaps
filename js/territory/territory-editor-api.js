"use strict";

(function initPoliticalTerritoryEditorApi() {
	const WRITE_API_URL = "/api/app/political-territories.php?debug_errors=1";

	let hierarchyRows = [];
	let hierarchyLoaded = false;

	function getFormModule() {
		return window.AvesmapsPoliticalTerritoryEditorForm || null;
	}

	function normalizeText(value) {
		return getFormModule()?.normalizeText?.(value) || String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function parseOptionalNumber(value, fallback = null) {
		return getFormModule()?.parseOptionalNumber?.(value, fallback) ?? fallback;
	}

	function normalizePath(value) {
		if (typeof value === "string" && value.trim().startsWith("[")) {
			try {
				return normalizePath(JSON.parse(value));
			} catch (error) {
				return [];
			}
		}
		return Array.isArray(value)
			? value.map(item => typeof item === "object" ? normalizeText(item.name || item.label || item.key || "") : normalizeText(item)).filter(Boolean)
			: [];
	}

	function flattenHierarchy(nodes, parent = null) {
		const rows = [];
		for (const node of Array.isArray(nodes) ? nodes : []) {
			if (!node || typeof node !== "object") continue;
			rows.push({ ...node, parent: node.parent || parent });
			rows.push(...flattenHierarchy(node.children || node.items || node.territories || [], node));
		}
		return rows;
	}

	function readTerritoriesFromPayload(payload) {
		if (Array.isArray(payload?.territories)) return payload.territories;
		if (Array.isArray(payload?.items)) return payload.items;
		if (Array.isArray(payload?.hierarchy)) return flattenHierarchy(payload.hierarchy);
		if (payload?.hierarchy && typeof payload.hierarchy === "object") return flattenHierarchy(Object.values(payload.hierarchy));
		return [];
	}

	function normalizeTerritoryRow(row) {
		const parent = row.parent && typeof row.parent === "object" ? row.parent : {};
		return {
			id: parseOptionalNumber(row.id ?? row.territoryId ?? row.territory_id),
			publicId: normalizeText(row.publicId || row.public_id || row.territoryPublicId || row.territory_public_id || row.key || ""),
			wikiKey: normalizeText(row.wikiKey || row.wiki_key || ""),
			parentId: parseOptionalNumber(row.parentId ?? row.parent_id ?? parent.id ?? parent.territoryId ?? parent.territory_id),
			parentPublicId: normalizeText(row.parentPublicId || row.parent_public_id || parent.publicId || parent.public_id || parent.territoryPublicId || parent.territory_public_id || ""),
			name: normalizeText(row.name || row.displayName || row.display_name || row.label || row.wikiName || row.wiki_name || ""),
			path: normalizePath(row.path || row.pathKeys || row.affiliationPath || row.affiliation_path || row.wikiAffiliationPath || row.wiki_affiliation_path || row.wiki_affiliation_path_json)
		};
	}

	async function loadTerritoryHierarchy(options = {}) {
		if (hierarchyLoaded && !options.forceReload) return hierarchyRows;

		const separator = WRITE_API_URL.includes("?") ? "&" : "?";
		const response = await fetch(`${WRITE_API_URL}${separator}action=hierarchy`, {
			method: "GET",
			credentials: "same-origin",
			headers: { "Accept": "application/json" }
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || payload?.ok === false) {
			throw new Error(apiErrorMessage(payload, `Herrschaftsgebiete konnten nicht geladen werden: HTTP ${response.status}`));
		}

		hierarchyRows = readTerritoriesFromPayload(payload).map(normalizeTerritoryRow).filter(row => row.name || row.publicId);
		hierarchyLoaded = true;
		return hierarchyRows;
	}

	function clearHierarchyCache() {
		hierarchyRows = [];
		hierarchyLoaded = false;
	}

	window.AvesmapsPoliticalTerritoryEditorApi = {
		writeApiUrl: WRITE_API_URL,
		loadTerritoryHierarchy,
		clearHierarchyCache,
		normalizeTerritoryRow,
		readTerritoriesFromPayload,
		flattenHierarchy
	};
})();

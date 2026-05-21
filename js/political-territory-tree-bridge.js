"use strict";

(function initPoliticalTerritoryTreeBridge(globalObject) {
	const API_URL = "/api/political-territory-wiki.php";
	const SELECTORS = [
		{
			containerId: "treeView",
			infoId: "treeInfo",
			searchId: "searchInput",
			summaryId: "",
			autoLoad: true
		},
		{
			containerId: "wiki-sync-territory-tree",
			infoId: "wiki-sync-territories-summary",
			searchId: "wiki-sync-territory-filter",
			summaryId: "wiki-sync-territories-summary",
			autoLoad: false
		}
	];

	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function getTreeModule() {
		return globalObject.AvesmapsPoliticalTerritoryWikiTree || null;
	}

	function getContext(config) {
		const container = document.getElementById(config.containerId);
		if (!container) return null;
		return {
			container,
			infoElement: config.infoId ? document.getElementById(config.infoId) : null,
			searchElement: config.searchId ? document.getElementById(config.searchId) : null,
			summaryElement: config.summaryId ? document.getElementById(config.summaryId) : null
		};
	}

	async function fetchRows() {
		const treeModule = getTreeModule();
		if (treeModule && typeof treeModule.fetchRows === "function") {
			const result = await treeModule.fetchRows({ apiUrl: API_URL });
			return Array.isArray(result?.rows) ? result.rows : [];
		}

		const requestUrl = new URL(API_URL, globalObject.location?.href || "http://localhost");
		requestUrl.searchParams.set("_", String(Date.now()));
		const response = await fetch(requestUrl.toString(), {
			method: "GET",
			credentials: "omit",
			cache: "no-store",
			headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" }
		});
		const payload = await response.json();
		if (!response.ok || !payload?.ok) {
			throw new Error(payload?.error || `HTTP ${response.status}`);
		}
		return Array.isArray(payload.items) ? payload.items : [];
	}

	function filterRows(rows, searchText) {
		const query = normalizeText(searchText).toLowerCase();
		if (!query) return rows;
		return rows.filter((row) => [
			row?.name,
			row?.type,
			row?.status,
			row?.continent,
			row?.affiliation_raw,
			row?.affiliation_root,
			Array.isArray(row?.affiliation_path) ? row.affiliation_path.join(" ") : "",
			row?.wiki_key,
			row?.wiki_url,
			row?.founded_text,
			row?.dissolved_text,
			row?.valid_label
		].map((value) => normalizeText(value).toLowerCase()).join(" ").includes(query));
	}

	function setInfo(context, text) {
		if (context.infoElement) context.infoElement.textContent = text;
		if (context.summaryElement && context.summaryElement !== context.infoElement) context.summaryElement.textContent = text;
	}

	function renderTreeForContext(config, rows) {
		const treeModule = getTreeModule();
		const context = getContext(config);
		if (!treeModule || !context || typeof treeModule.buildTree !== "function" || typeof treeModule.renderTree !== "function") {
			return;
		}

		const visibleRows = filterRows(rows, context.searchElement?.value || "");
		const tree = treeModule.buildTree(visibleRows);
		treeModule.renderTree({
			container: context.container,
			root: tree.root,
			rowCount: visibleRows.length,
			totalRowCount: rows.length,
			searchText: context.searchElement?.value || "",
			infoElement: context.infoElement,
			enableDrag: true
		});

		if (visibleRows.length > 0) {
			setInfo(context, `${visibleRows.length} Herrschaftsgebiete in ${tree.root.children.length} Wurzelbereichen.`);
		}
	}

	async function loadAndRender(config) {
		const context = getContext(config);
		if (!context) return;
		try {
			setInfo(context, "Herrschaftsgebiete werden geladen...");
			const rows = await fetchRows();
			context.container.__avesmapsTerritoryTreeBridgeRows = rows;
			renderTreeForContext(config, rows);
		} catch (error) {
			setInfo(context, error?.message || "Herrschaftsgebiete konnten nicht geladen werden.");
		}
	}

	function rerenderFromCache(config) {
		const context = getContext(config);
		if (!context) return;
		const rows = Array.isArray(context.container.__avesmapsTerritoryTreeBridgeRows)
			? context.container.__avesmapsTerritoryTreeBridgeRows
			: [];
		if (rows.length > 0) renderTreeForContext(config, rows);
	}

	function bindContext(config) {
		const context = getContext(config);
		if (!context || context.container.__avesmapsTerritoryTreeBridgeBound === true) return;
		context.container.__avesmapsTerritoryTreeBridgeBound = true;
		context.searchElement?.addEventListener("input", () => rerenderFromCache(config));

		if (config.containerId === "wiki-sync-territory-tree") {
			document.getElementById("wiki-sync-territories")?.addEventListener("click", () => loadAndRender(config));
			const territoryTab = document.querySelector('[data-wiki-sync-panel-tab="territories"], [data-wiki-sync-panel-section-button="territories"]');
			territoryTab?.addEventListener("click", () => {
				const rows = Array.isArray(context.container.__avesmapsTerritoryTreeBridgeRows)
					? context.container.__avesmapsTerritoryTreeBridgeRows
					: [];
				if (rows.length > 0) rerenderFromCache(config);
				else loadAndRender(config);
			});
		}

		if (config.autoLoad) {
			loadAndRender(config);
		}
	}

	function bindAll() {
		SELECTORS.forEach(bindContext);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", bindAll, { once: true });
	} else {
		bindAll();
	}
})(window);

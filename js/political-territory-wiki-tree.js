"use strict";

(function initPoliticalTerritoryWikiTreeModule(globalObject) {
	const MODULE_VERSION = "2026-05-21-filter-keeps-ancestors";
	const DEFAULT_API_URL = "/api/political-territory-wiki.php";
	const DISPLAY_SUFFIXES = ["Staat", "Imperium", "Reich", "Kalifat"];

	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function parseOptionalNumber(value, fallback = null) {
		if (value === "" || value === null || typeof value === "undefined") return fallback;
		const number = Number(value);
		return Number.isFinite(number) ? number : fallback;
	}

	function makeKey(value) {
		return normalizeText(value)
			.toLowerCase()
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			.replace(/\u00df/g, "ss")
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
	}

	function rowKey(row) {
		return makeKey(row?.name || row?.wiki_key || row?.id || "");
	}

	function canonicalLabel(value) {
		return normalizeText(value).replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
	}

	function escapeRegExp(value) {
		return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function readOptionalYear(row, fields) {
		for (const field of fields) {
			const value = row?.[field];
			if (value === "" || value === null || typeof value === "undefined") continue;
			const number = Number(value);
			if (Number.isFinite(number)) return Math.round(number);
		}
		return null;
	}

	function formatBfYear(year) {
		if (!Number.isFinite(year)) return "";
		return year < 0 ? `${Math.abs(year)} v. BF` : `${year} BF`;
	}

	function buildTerritoryPeriodLabel(row) {
		const startYear = readOptionalYear(row, ["founded_display_bf", "founded_start_bf", "founded_end_bf"]);
		const endYear = readOptionalYear(row, ["dissolved_display_bf", "dissolved_start_bf", "dissolved_end_bf"]);
		if (startYear === null && endYear === null) return "";
		const startText = startYear === null ? "?" : formatBfYear(startYear);
		const endText = endYear === null ? "heute" : formatBfYear(endYear);
		return `${startText} - ${endText}`;
	}

	function buildTreeNodeLabel(row, fallbackLabel = "") {
		const label = normalizeText(fallbackLabel || row?.name || "");
		const periodLabel = buildTerritoryPeriodLabel(row);
		return periodLabel ? `${label} (${periodLabel})` : label;
	}

	function extractParentheticalContents(value) {
		const text = normalizeText(value);
		if (!text) return [];
		const contents = [];
		for (const match of text.matchAll(/\(([^)]+)\)/gu)) {
			const content = normalizeText(match[1] || "");
			if (content) contents.push(content);
		}
		return contents;
	}

	function buildRowStatusFilterTags(name, status) {
		const tags = new Set();
		const normalizedStatus = normalizeText(status).toLowerCase();
		if (normalizedStatus) tags.add(normalizedStatus);
		for (const content of extractParentheticalContents(name)) {
			const normalizedContent = normalizeText(content).toLowerCase();
			if (normalizedContent && normalizedContent.split(/\s+/u).length <= 3) tags.add(normalizedContent);
		}
		return [...tags];
	}

	function normalizeAffiliationPath(row) {
		const candidatePaths = [
			row.affiliation_path,
			row.affiliation && Array.isArray(row.affiliation.path) ? row.affiliation.path : null,
			row.affiliation_root ? [row.affiliation_root] : null,
			row.affiliation_raw ? [normalizeText(row.affiliation_raw).split(":")[0]] : null,
		];
		for (const candidatePath of candidatePaths) {
			const normalized = normalizeAffiliationPathCandidate(candidatePath);
			if (!normalized.hasSource) continue;
			if (normalized.isIndependent) return [];
			if (normalized.parts.length > 0) return normalized.parts;
		}
		return [];
	}

	function normalizeAffiliationPathCandidate(pathCandidate) {
		if (!Array.isArray(pathCandidate)) return { hasSource: false, isIndependent: false, parts: [] };
		const parts = pathCandidate.map(normalizeText).filter(Boolean);
		if (parts.length === 0) return { hasSource: false, isIndependent: false, parts: [] };
		if (parts.some(isIndependentAffiliationSegment)) return { hasSource: true, isIndependent: true, parts: [] };
		const cleanedParts = [...parts];
		while (cleanedParts.length > 0 && isGenericAffiliationSegment(cleanedParts[0])) cleanedParts.shift();
		return { hasSource: true, isIndependent: false, parts: cleanedParts };
	}

	function isIndependentAffiliationSegment(segment) {
		const key = makeKey(segment);
		return key.startsWith("unabhangig") || key.startsWith("unabhaengig");
	}

	function isGenericAffiliationSegment(segment) {
		const key = makeKey(segment);
		return key === "sonstiges" || key === "sonstige" || key === "misc" || key === "unbekannt" || key === "ungeklart";
	}

	function normalizeApiRows(rows) {
		const normalizedRows = (Array.isArray(rows) ? rows : [])
			.map((row) => {
				const normalizedName = normalizeText(row?.name);
				const normalizedStatus = normalizeText(row?.status);
				return {
					...(row || {}),
					id: parseOptionalNumber(row?.id, null),
					name: normalizedName,
					type: normalizeText(row?.type),
					continent: normalizeText(row?.continent),
					affiliation_raw: normalizeText(row?.affiliation_raw || row?.political),
					affiliation_root: normalizeText(row?.affiliation_root),
					affiliation_path: normalizeAffiliationPath(row || {}),
					status: normalizedStatus,
					status_filter_tags: buildRowStatusFilterTags(normalizedName, normalizedStatus),
					form_of_government: normalizeText(row?.form_of_government),
					capital_name: normalizeText(row?.capital_name),
					seat_name: normalizeText(row?.seat_name),
					ruler: normalizeText(row?.ruler),
					language: normalizeText(row?.language),
					currency: normalizeText(row?.currency),
					trade_goods: normalizeText(row?.trade_goods),
					population: normalizeText(row?.population),
					founded_text: normalizeText(row?.founded_text),
					founded_start_bf: parseOptionalNumber(row?.founded_start_bf, null),
					founded_end_bf: parseOptionalNumber(row?.founded_end_bf, null),
					founded_display_bf: parseOptionalNumber(row?.founded_display_bf, null),
					founder: normalizeText(row?.founder),
					dissolved_text: normalizeText(row?.dissolved_text),
					dissolved_start_bf: parseOptionalNumber(row?.dissolved_start_bf, null),
					dissolved_end_bf: parseOptionalNumber(row?.dissolved_end_bf, null),
					dissolved_display_bf: parseOptionalNumber(row?.dissolved_display_bf, null),
					geographic: normalizeText(row?.geographic),
					political: normalizeText(row?.political),
					trade_zone: normalizeText(row?.trade_zone),
					blazon: normalizeText(row?.blazon),
					wiki_url: normalizeText(row?.wiki_url),
					coat_of_arms_url: normalizeText(row?.coat_of_arms_url),
					map_assigned: Boolean(row?.map_assigned) || Number(row?.map_geometry_count || 0) > 0,
					map_territory_count: parseOptionalNumber(row?.map_territory_count, 0),
					map_geometry_count: parseOptionalNumber(row?.map_geometry_count, 0),
				};
			})
			.filter((row) => row.name);
		return dedupeRowsByIdentity(normalizedRows);
	}

	function dedupeRowsByIdentity(rows) {
		const dedupedByKey = new Map();
		const rowOrder = [];
		for (const row of rows) {
			const key = rowIdentityKey(row) || `row:${rowKey(row)}`;
			const existing = dedupedByKey.get(key);
			if (!existing) {
				dedupedByKey.set(key, row);
				rowOrder.push(key);
				continue;
			}
			dedupedByKey.set(key, mergeRowsByIdentity(existing, row));
		}
		return rowOrder.map((key) => dedupedByKey.get(key)).filter(Boolean);
	}

	function rowIdentityKey(row) {
		if (!row || typeof row !== "object") return "";
		const wikiKey = makeKey(row.wiki_key || "");
		if (wikiKey !== "") return `wiki_key:${wikiKey}`;
		const wikiTitle = wikiTitleFromUrl(row.wiki_url || "");
		if (wikiTitle !== "") return `wiki_title:${makeKey(wikiTitle)}|name:${makeKey(row.name || "")}|type:${makeKey(row.type || "")}`;
		const nameKey = makeKey(row.name || "");
		const typeKey = makeKey(row.type || "");
		if (nameKey !== "") return `name:${nameKey}|type:${typeKey}`;
		const id = normalizeText(row.id);
		return id !== "" ? `id:${id}` : "";
	}

	function wikiTitleFromUrl(url) {
		const rawUrl = normalizeText(url);
		if (!rawUrl) return "";
		try {
			const parsed = new URL(rawUrl, globalObject.location?.origin || "http://localhost");
			const marker = "/wiki/";
			const markerIndex = (parsed.pathname || "").indexOf(marker);
			if (markerIndex < 0) return "";
			return decodeURIComponent(parsed.pathname.slice(markerIndex + marker.length)).replace(/_/g, " ").trim();
		} catch (error) {
			return "";
		}
	}

	function mergeRowsByIdentity(primary, secondary) {
		const merged = rowMergeScore(secondary) > rowMergeScore(primary) ? { ...secondary } : { ...primary };
		const fallback = merged === primary ? secondary : primary;
		for (const key of Object.keys(fallback || {})) {
			const mergedValue = merged[key];
			const fallbackValue = fallback[key];
			if ((mergedValue === null || typeof mergedValue === "undefined" || mergedValue === "")
				&& fallbackValue !== null && typeof fallbackValue !== "undefined" && fallbackValue !== "") {
				merged[key] = fallbackValue;
			}
		}
		merged.map_territory_count = Math.max(Number(merged.map_territory_count || 0), Number(fallback?.map_territory_count || 0));
		merged.map_geometry_count = Math.max(Number(merged.map_geometry_count || 0), Number(fallback?.map_geometry_count || 0));
		merged.map_assigned = Boolean(merged.map_assigned) || merged.map_geometry_count > 0;
		return merged;
	}

	function rowMergeScore(row) {
		let score = 0;
		score += Number(row?.map_geometry_count || 0) * 100;
		score += Number(row?.map_territory_count || 0) * 20;
		for (const field of ["wiki_url", "wiki_key", "coat_of_arms_url", "founded_text", "dissolved_text", "type", "status", "affiliation_raw", "capital_name", "seat_name", "ruler", "language", "currency", "trade_goods", "population"]) {
			if (normalizeText(row?.[field]) !== "") score += 1;
		}
		if (Array.isArray(row?.affiliation_path)) score += row.affiliation_path.filter(Boolean).length;
		return score;
	}

	function stripDisplaySuffix(name) {
		let normalizedName = normalizeText(name);
		for (const suffix of DISPLAY_SUFFIXES) {
			normalizedName = normalizeText(normalizedName.replace(new RegExp(`\\s*\\(${escapeRegExp(suffix)}\\)\\s*$`, "iu"), ""));
		}
		return normalizedName;
	}

	function getDisplayAliases(name) {
		const aliases = new Set();
		for (const alias of getFixedAliases(name)) aliases.add(alias);
		const normalizedName = normalizeText(name);
		for (const suffix of DISPLAY_SUFFIXES) {
			const suffixPattern = new RegExp(`\\s*\\(${escapeRegExp(suffix)}\\)\\s*$`, "u");
			if (suffixPattern.test(normalizedName)) aliases.add(normalizeText(normalizedName.replace(suffixPattern, "")));
		}
		return [...aliases].filter(Boolean);
	}

	function getFixedAliases(name) {
		return {
			"Wiedererstandenes Reich des Horas": ["Horasreich"],
			"Heiliges Neues Kaiserreich vom Greifenthron zu Gareth": ["Mittelreich"],
			"Theaterritterliche Republik an Born und Walsach": ["Bornland"],
		}[name] || [];
	}

	function buildRowIndex(rows) {
		const index = new Map();
		for (const row of rows) {
			const labels = new Set([row.name, stripDisplaySuffix(row.name), wikiTitleFromUrl(row.wiki_url || "")]);
			for (const alias of getDisplayAliases(row.name)) labels.add(alias);
			for (const label of labels) {
				const key = makeKey(label);
				if (key && !index.has(key)) index.set(key, row);
			}
		}
		return index;
	}

	function createTreeNode(id, label, kind, row = null) {
		return { id, label, kind, row, parent: null, children: [], childMap: new Map() };
	}

	function buildTree(rows) {
		const normalizedRows = Array.isArray(rows) ? rows : [];
		const root = createTreeNode("root", "Herrschaftsgebiete", "root");
		const rowIndex = buildRowIndex(normalizedRows);
		const nodeByIdentity = new Map();
		for (const row of normalizedRows) {
			const identityKey = rowIdentityKey(row);
			if (!identityKey) continue;
			let current = root;
			for (const segment of Array.isArray(row.affiliation_path) ? row.affiliation_path : []) {
				const segmentKey = makeKey(segment);
				if (!segmentKey) continue;
				const matchingRow = rowIndex.get(segmentKey) || null;
				if (!matchingRow) continue;
				const matchingIdentityKey = rowIdentityKey(matchingRow);
				if (!matchingIdentityKey || matchingIdentityKey === identityKey) continue;
				let pathNode = nodeByIdentity.get(matchingIdentityKey) || null;
				if (!pathNode) {
					pathNode = createTreeNode(rowKey(matchingRow) || makeKey(matchingRow.name) || matchingIdentityKey, buildTreeNodeLabel(matchingRow, matchingRow.name || segment), "territory-group", matchingRow);
					nodeByIdentity.set(matchingIdentityKey, pathNode);
				}
				attachChild(current, pathNode);
				current = pathNode;
			}
			let ownNode = nodeByIdentity.get(identityKey) || null;
			if (!ownNode) {
				ownNode = createTreeNode(rowKey(row) || makeKey(row.name) || identityKey, buildTreeNodeLabel(row, row.name), "territory", row);
				nodeByIdentity.set(identityKey, ownNode);
			} else {
				ownNode.row = mergeRowsByIdentity(ownNode.row || row, row);
				ownNode.label = buildTreeNodeLabel(ownNode.row, ownNode.row?.name || row.name || ownNode.label);
				ownNode.kind = ownNode.children.length > 0 ? "territory-group" : "territory";
			}
			attachChild(current, ownNode);
		}
		sortTree(root);
		const nodeRegistry = new Map();
		registerTree(root, nodeRegistry);
		return { root, nodeRegistry };
	}

	function attachChild(parent, node) {
		if (node.parent && node.parent !== parent) node.parent.children = node.parent.children.filter((child) => child !== node);
		node.parent = parent;
		if (!parent.children.includes(node)) parent.children.push(node);
		parent.childMap.set(node.id, node);
		if (node.row?.name) parent.childMap.set(makeKey(node.row.name), node);
	}

	function registerTree(node, nodeRegistry) {
		if (node.id !== "root") nodeRegistry.set(node.id, node);
		for (const child of node.children) registerTree(child, nodeRegistry);
	}

	function sortTree(node) {
		node.children.sort((left, right) => {
			const leftFolder = left.children.length > 0 ? 0 : 1;
			const rightFolder = right.children.length > 0 ? 0 : 1;
			if (leftFolder !== rightFolder) return leftFolder - rightFolder;
			return String(left.label || "").localeCompare(String(right.label || ""), "de");
		});
		for (const child of node.children) sortTree(child);
	}

	function doesRowMatchStructuralFilters(row, filters = {}) {
		const continent = normalizeText(filters.continent);
		const type = normalizeText(filters.type);
		const status = normalizeText(filters.status).toLowerCase();
		if (continent && row.continent !== continent) return false;
		if (type && row.type !== type) return false;
		if (status) {
			const rowStatus = normalizeText(row.status).toLowerCase();
			const rowStatusTags = Array.isArray(row.status_filter_tags) ? row.status_filter_tags : [];
			if (rowStatus !== status && !rowStatusTags.includes(status)) return false;
		}
		return true;
	}

	function doesRowMatchSearch(row, search) {
		if (!search) return true;
		const haystack = [
			row.name,
			row.type,
			row.continent,
			row.affiliation_raw,
			row.affiliation_root,
			Array.isArray(row.affiliation_path) ? row.affiliation_path.join(" ") : "",
			row.status,
			row.capital_name,
			row.seat_name,
			row.ruler,
			row.geographic,
			row.political,
			buildTerritoryPeriodLabel(row),
		].join(" ").toLowerCase();
		return haystack.includes(search);
	}

	function collectAncestorRowsForSearchResult(row, rowIndex) {
		const ancestors = [];
		const ownIdentityKey = rowIdentityKey(row);
		const seenAncestorKeys = new Set();
		for (const segment of Array.isArray(row.affiliation_path) ? row.affiliation_path : []) {
			const segmentKey = makeKey(segment);
			if (!segmentKey) continue;
			const ancestorRow = rowIndex.get(segmentKey) || null;
			if (!ancestorRow) continue;
			const ancestorIdentityKey = rowIdentityKey(ancestorRow);
			if (!ancestorIdentityKey || ancestorIdentityKey === ownIdentityKey || seenAncestorKeys.has(ancestorIdentityKey)) continue;
			ancestors.push(ancestorRow);
			seenAncestorKeys.add(ancestorIdentityKey);
		}
		return ancestors;
	}

	function filterRows(rows, filters = {}) {
		const allRows = Array.isArray(rows) ? rows : [];
		const search = normalizeText(filters.search || filters.query || "").toLowerCase();
		const structurallyFilteredRows = allRows.filter((row) => doesRowMatchStructuralFilters(row, filters));
		if (!search) return structurallyFilteredRows;

		const rowIndex = buildRowIndex(allRows);
		const filteredRowsWithAncestors = [];
		const includedKeys = new Set();
		const appendRow = (row) => {
			const key = rowIdentityKey(row) || `row:${rowKey(row)}`;
			if (!key || includedKeys.has(key)) return;
			filteredRowsWithAncestors.push(row);
			includedKeys.add(key);
		};

		for (const row of structurallyFilteredRows) {
			if (!doesRowMatchSearch(row, search)) continue;
			collectAncestorRowsForSearchResult(row, rowIndex).forEach(appendRow);
			appendRow(row);
		}

		return filteredRowsWithAncestors;
	}

	function isSyntheticNode(node) {
		return node.kind === "synthetic" && !node.row;
	}

	function isTreeNodeAssignedToMap(node) {
		return Boolean(node?.row?.map_assigned) || Number(node?.row?.map_geometry_count || 0) > 0;
	}

	function getTreeCoverageStatus(node) {
		const ownAssigned = isTreeNodeAssignedToMap(node);
		const children = Array.isArray(node?.children) ? node.children : [];
		if (children.length === 0) return { kind: ownAssigned ? "all" : "none", ownAssigned, hasAnyCoverage: ownAssigned, isComplete: ownAssigned };
		const childStatuses = children.map(getTreeCoverageStatus);
		const hasAnyChildCoverage = childStatuses.some((status) => status.hasAnyCoverage);
		const allChildrenComplete = childStatuses.every((status) => status.isComplete);
		const hasAnyCoverage = ownAssigned || hasAnyChildCoverage;
		if (ownAssigned && allChildrenComplete) return { kind: "all", ownAssigned, hasAnyCoverage, isComplete: true };
		if (ownAssigned) return { kind: "own-only", ownAssigned, hasAnyCoverage, isComplete: false };
		if (hasAnyChildCoverage && allChildrenComplete) return { kind: "all", ownAssigned, hasAnyCoverage, isComplete: true };
		if (hasAnyChildCoverage) return { kind: "children-only", ownAssigned, hasAnyCoverage, isComplete: false };
		return { kind: "none", ownAssigned, hasAnyCoverage: false, isComplete: false };
	}

	function getTreeMapStatus(node) {
		const status = getTreeCoverageStatus(node);
		if (status.kind === "all") return { kind: "all", label: status.ownAssigned ? "Gebiet und Untergebiete sind auf der Karte vorhanden" : "Alle Untergebiete sind auf der Karte vorhanden" };
		if (status.kind === "own-only") return { kind: "own-only", label: "Gebiet ist auf der Karte vorhanden, Untergebiete fehlen oder sind nicht vollständig" };
		if (status.kind === "children-only") return { kind: "children-only", label: "Gebiet ist indirekt durch Untergebiete auf der Karte vorhanden, Untergebiete fehlen oder sind nicht vollständig" };
		return { kind: "none", label: "Gebiet und Untergebiete fehlen auf der Karte" };
	}

	function getNodePath(node) {
		const path = [];
		let current = node;
		while (current && current.id !== "root") {
			path.unshift(current);
			current = current.parent;
		}
		return path;
	}

	function createNodeReference(node) {
		if (!node) return null;
		return {
			id: node.id,
			key: node.row?.wiki_key || node.row?.public_id || node.id || makeKey(node.label),
			label: node.label,
			kind: node.kind,
			isSynthetic: isSyntheticNode(node),
			wikiKey: node.row?.wiki_key || "",
			rowId: node.row?.id || null,
			territoryPublicId: node.row?.public_id || "",
			territoryId: node.row?.territory_id || null,
			slug: node.row?.slug || "",
			path: getNodePath(node).map((pathNode) => pathNode.label),
			pathKeys: getNodePath(node).map((pathNode) => pathNode.row?.wiki_key || pathNode.row?.public_id || pathNode.id || makeKey(pathNode.label)),
		};
	}

	function createDragPayload(node) {
		return { node: createNodeReference(node), path: getNodePath(node).map(createNodeReference) };
	}

	function applyDragData(event, node) {
		const dataTransfer = event?.dataTransfer;
		if (!dataTransfer || !node) return;
		const nodeId = String(node.id || "").trim();
		if (!nodeId) return;
		dataTransfer.effectAllowed = "copy";
		dataTransfer.setData("application/x-avesmaps-territory-node-id", nodeId);
		dataTransfer.setData("text/plain", nodeId);
		const territoryPublicId = normalizeText(node?.row?.public_id || "");
		if (territoryPublicId) dataTransfer.setData("application/x-avesmaps-territory", territoryPublicId);
		try {
			dataTransfer.setData("application/x-avesmaps-territory-node-json", JSON.stringify(createDragPayload(node)));
		} catch (error) {
			// Ignore payload encoding errors for drag data.
		}
	}

	function getDraggedNodeId(dataTransfer) {
		if (!dataTransfer) return "";
		return normalizeText(dataTransfer.getData("application/x-avesmaps-territory-node-id") || dataTransfer.getData("text/plain") || "");
	}

	function renderTree(options = {}) {
		const container = options.container;
		if (!(container instanceof HTMLElement)) return;
		const root = options.root;
		const rowCount = Number(options.rowCount || 0);
		const totalRowCount = Number(options.totalRowCount ?? rowCount);
		const searchText = normalizeText(options.searchText || "");
		const selectedNodeId = normalizeText(options.selectedNodeId || "");
		const infoElement = options.infoElement instanceof HTMLElement ? options.infoElement : null;
		const itemClassName = normalizeText(options.itemClassName || "");
		container.innerHTML = "";
		if (rowCount === 0) {
			if (infoElement) infoElement.textContent = totalRowCount === 0 ? "Noch keine Daten geladen." : "Keine Treffer.";
			return;
		}
		const treeRootElement = document.createElement("ul");
		treeRootElement.className = "tree-root";
		renderTreeChildren(treeRootElement, root.children, 0, { searchText, selectedNodeId, itemClassName, onItemClick: options.onItemClick, onItemDragStart: options.onItemDragStart, enableDrag: options.enableDrag !== false });
		container.appendChild(treeRootElement);
		if (infoElement) infoElement.textContent = `${rowCount} Herrschaftsgebiete in ${root.children.length} Wurzelbereichen.`;
	}

	function renderTreeChildren(parentElement, children, depth, options) {
		for (const child of children.filter((child) => !isSyntheticNode(child))) parentElement.appendChild(renderTreeNode(child, depth, options));
	}

	function renderTreeNode(node, depth, options) {
		const listItem = document.createElement("li");
		listItem.className = "tree-node";
		if (node.children.length > 0) {
			const details = document.createElement("details");
			details.open = normalizeText(options.searchText).length > 0 || depth > 0;
			const summary = document.createElement("summary");
			const toggle = document.createElement("span");
			toggle.className = "tree-toggle";
			toggle.setAttribute("aria-hidden", "true");
			summary.appendChild(toggle);
			summary.appendChild(renderTreeItem(node, options));
			details.appendChild(summary);
			const childrenList = document.createElement("ul");
			renderTreeChildren(childrenList, node.children, depth + 1, options);
			details.appendChild(childrenList);
			listItem.appendChild(details);
		} else {
			listItem.appendChild(renderTreeItem(node, options));
		}
		return listItem;
	}

	function renderTreeItem(node, options) {
		const itemElement = document.createElement("span");
		const classParts = [node.kind === "synthetic" ? "tree-item synthetic" : "tree-item"];
		if (options.itemClassName) classParts.push(options.itemClassName);
		itemElement.className = classParts.join(" ");
		itemElement.draggable = options.enableDrag === true;
		itemElement.dataset.nodeId = node.id;
		itemElement.title = node.kind === "synthetic" ? "Abgeleiteter Gruppenknoten ohne eigenen Wiki-Datensatz" : "Herrschaftsgebiet";
		if (options.selectedNodeId && node.id === options.selectedNodeId) itemElement.classList.add("selected");
		const handle = document.createElement("span");
		handle.className = "drag-handle";
		handle.textContent = "⠿";
		itemElement.appendChild(handle);
		const name = document.createElement("span");
		name.className = "tree-item-name";
		const rowId = Number(node?.row?.id || 0);
		name.textContent = rowId > 0 ? `${node.label} (ID: ${rowId})` : node.label;
		itemElement.appendChild(name);
		const mapStatus = getTreeMapStatus(node);
		const mapStatusElement = document.createElement("span");
		mapStatusElement.className = `tree-map-status tree-map-status--${mapStatus.kind}`;
		mapStatusElement.title = mapStatus.label;
		mapStatusElement.setAttribute("aria-label", mapStatus.label);
		itemElement.appendChild(mapStatusElement);
		itemElement.title = `${itemElement.title}: ${mapStatus.label}`;
		itemElement.addEventListener("click", (event) => {
			if (typeof options.onItemClick === "function") options.onItemClick(node, event);
			else event.stopPropagation();
		});
		if (options.enableDrag === true) {
			itemElement.addEventListener("dragstart", (event) => {
				applyDragData(event, node);
				if (typeof options.onItemDragStart === "function") options.onItemDragStart(node, event);
			});
		}
		return itemElement;
	}

	function setAllTreeDetailsOpen(container, open) {
		if (!(container instanceof HTMLElement)) return;
		for (const details of container.querySelectorAll("details")) details.open = Boolean(open);
	}

	async function fetchRows(options = {}) {
		const apiUrl = normalizeText(options.apiUrl || DEFAULT_API_URL) || DEFAULT_API_URL;
		const requestUrl = new URL(apiUrl, globalObject.location?.href || "http://localhost");
		requestUrl.searchParams.set("_", String(Date.now()));
		const response = await fetch(requestUrl.toString(), {
			method: "GET",
			credentials: options.credentials || "omit",
			cache: "no-store",
			headers: { Accept: "application/json", "Cache-Control": "no-cache", Pragma: "no-cache" },
			signal: options.signal,
		});
		const payload = await response.json();
		if (!response.ok || !payload?.ok) throw new Error(payload?.error || `HTTP ${response.status}`);
		const rows = normalizeApiRows(payload.items || []);
		globalObject.AvesmapsWikiSyncTerritoryTreeRowsCache = rows;
		globalObject.wikiSyncTerritoryTreeRowsCache = rows;
		return { rows, payload };
	}

	async function loadTree(options = {}) {
		const { rows, payload } = await fetchRows(options);
		const { root, nodeRegistry } = buildTree(rows);
		return { rows, root, nodeRegistry, payload };
	}

	globalObject.AvesmapsPoliticalTerritoryWikiTree = {
		version: MODULE_VERSION,
		defaultApiUrl: DEFAULT_API_URL,
		__avesmapsNoSyntheticBuildTree: true,
		normalizeText,
		parseOptionalNumber,
		makeKey,
		rowKey,
		canonicalLabel,
		normalizeApiRows,
		filterRows,
		buildTree,
		renderTree,
		setAllTreeDetailsOpen,
		getTreeCoverageStatus,
		getTreeMapStatus,
		isTreeNodeAssignedToMap,
		isSyntheticNode,
		getNodePath,
		createNodeReference,
		applyDragData,
		getDraggedNodeId,
		fetchRows,
		loadTree,
	};
})(window);

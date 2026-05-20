"use strict";

(function initPoliticalTerritoryWikiTreeModule(globalObject) {
	const MODULE_VERSION = "2026-05-20-shared-tree";
	const DEFAULT_API_URL = "/api/political-territory-wiki.php";
	const DISPLAY_SUFFIXES = [
		"Staat",
		"Imperium",
		"Reich",
		"Kalifat",
	];

	function normalizeText(value) {
		return String(value ?? "")
			.replace(/\u00a0/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function parseOptionalNumber(value, fallback = null) {
		if (value === "" || value === null || typeof value === "undefined") {
			return fallback;
		}

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
		return normalizeText(value)
			.replace(/\s*\([^)]*\)\s*/g, " ")
			.replace(/\s+/g, " ")
			.trim();
	}

	function escapeRegExp(value) {
		return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	}

	function buildRowStatusFilterTags(name, status) {
		const tags = new Set();
		const normalizedStatus = normalizeText(status).toLowerCase();
		if (normalizedStatus) {
			tags.add(normalizedStatus);
		}

		for (const content of extractParentheticalContents(name)) {
			const normalizedContent = normalizeText(content).toLowerCase();
			if (!normalizedContent) {
				continue;
			}

			if (normalizedContent.split(/\s+/u).length <= 3) {
				tags.add(normalizedContent);
			}
		}

		return [...tags];
	}

	function extractParentheticalContents(value) {
		const text = normalizeText(value);
		if (!text) {
			return [];
		}

		const contents = [];
		const pattern = /\(([^)]+)\)/gu;
		for (const match of text.matchAll(pattern)) {
			const content = normalizeText(match[1] || "");
			if (content) {
				contents.push(content);
			}
		}

		return contents;
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

			if (!normalized.hasSource) {
				continue;
			}

			if (normalized.isIndependent) {
				return [];
			}

			if (normalized.parts.length > 0) {
				return normalized.parts;
			}
		}

		return ["ungekl\u00e4rt"];
	}

	function normalizeAffiliationPathCandidate(pathCandidate) {
		if (!Array.isArray(pathCandidate)) {
			return {
				hasSource: false,
				isIndependent: false,
				parts: [],
			};
		}

		const parts = pathCandidate.map(normalizeText).filter(Boolean);

		if (parts.length === 0) {
			return {
				hasSource: false,
				isIndependent: false,
				parts: [],
			};
		}

		if (parts.some(isIndependentAffiliationSegment)) {
			return {
				hasSource: true,
				isIndependent: true,
				parts: [],
			};
		}

		const cleanedParts = [...parts];

		while (cleanedParts.length > 0 && isGenericAffiliationSegment(cleanedParts[0])) {
			cleanedParts.shift();
		}

		return {
			hasSource: true,
			isIndependent: false,
			parts: cleanedParts,
		};
	}

	function isIndependentAffiliationSegment(segment) {
		const key = makeKey(segment);
		return key.startsWith("unabhangig") || key.startsWith("unabhaengig");
	}

	function isGenericAffiliationSegment(segment) {
		const key = makeKey(segment);

		return key === "sonstiges"
			|| key === "sonstige"
			|| key === "misc"
			|| key === "unbekannt"
			|| key === "ungeklart";
	}

	function normalizeApiRows(rows) {
		const normalizedRows = (Array.isArray(rows) ? rows : [])
			.map((row) => {
				const normalizedName = normalizeText(row?.name);
				const normalizedStatus = normalizeText(row?.status);
				const statusFilterTags = buildRowStatusFilterTags(normalizedName, normalizedStatus);

				return {
					...(row || {}),
					name: normalizedName,
					type: normalizeText(row?.type),
					continent: normalizeText(row?.continent),
					affiliation_raw: normalizeText(row?.affiliation_raw || row?.political),
					affiliation_root: normalizeText(row?.affiliation_root),
					affiliation_path: normalizeAffiliationPath(row || {}),
					status: normalizedStatus,
					status_filter_tags: statusFilterTags,
					form_of_government: normalizeText(row?.form_of_government),
					capital_name: normalizeText(row?.capital_name),
					seat_name: normalizeText(row?.seat_name),
					ruler: normalizeText(row?.ruler),
					language: normalizeText(row?.language),
					currency: normalizeText(row?.currency),
					trade_goods: normalizeText(row?.trade_goods),
					population: normalizeText(row?.population),
					founded_text: normalizeText(row?.founded_text),
					dissolved_text: normalizeText(row?.dissolved_text),
					founder: normalizeText(row?.founder),
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
		if (!row || typeof row !== "object") {
			return "";
		}

		const wikiKey = makeKey(row.wiki_key || "");
		if (wikiKey !== "") {
			return `wiki_key:${wikiKey}`;
		}

		const wikiTitle = wikiTitleFromUrl(row.wiki_url || "");
		if (wikiTitle !== "") {
			const nameKeyFromWikiTitle = makeKey(row.name || "");
			const typeKeyFromWikiTitle = makeKey(row.type || "");
			return `wiki_title:${makeKey(wikiTitle)}|name:${nameKeyFromWikiTitle}|type:${typeKeyFromWikiTitle}`;
		}

		const nameKey = makeKey(row.name || "");
		const typeKey = makeKey(row.type || "");
		if (nameKey !== "") {
			return `name:${nameKey}|type:${typeKey}`;
		}

		const id = normalizeText(row.id);
		if (id !== "") {
			return `id:${id}`;
		}

		return "";
	}

	function wikiTitleFromUrl(url) {
		const rawUrl = normalizeText(url);
		if (!rawUrl) {
			return "";
		}

		try {
			const parsed = new URL(rawUrl, globalObject.location?.origin || "http://localhost");
			const marker = "/wiki/";
			const path = parsed.pathname || "";
			const markerIndex = path.indexOf(marker);
			if (markerIndex < 0) {
				return "";
			}

			const rawTitle = path.slice(markerIndex + marker.length);
			if (!rawTitle) {
				return "";
			}

			return decodeURIComponent(rawTitle).replace(/_/g, " ").trim();
		} catch (error) {
			return "";
		}
	}

	function mergeRowsByIdentity(primary, secondary) {
		const merged = rowMergeScore(secondary) > rowMergeScore(primary)
			? { ...secondary }
			: { ...primary };
		const fallback = merged === primary ? secondary : primary;

		for (const key of Object.keys(fallback)) {
			const mergedValue = merged[key];
			const fallbackValue = fallback[key];

			if (
				(mergedValue === null || typeof mergedValue === "undefined" || mergedValue === "")
				&& fallbackValue !== null
				&& typeof fallbackValue !== "undefined"
				&& fallbackValue !== ""
			) {
				merged[key] = fallbackValue;
			}
		}

		merged.map_territory_count = Math.max(
			Number(merged.map_territory_count || 0),
			Number(fallback.map_territory_count || 0)
		);
		merged.map_geometry_count = Math.max(
			Number(merged.map_geometry_count || 0),
			Number(fallback.map_geometry_count || 0)
		);
		merged.map_assigned = Boolean(merged.map_assigned) || merged.map_geometry_count > 0;

		return merged;
	}

	function rowMergeScore(row) {
		let score = 0;
		score += Number(row?.map_geometry_count || 0) * 100;
		score += Number(row?.map_territory_count || 0) * 20;

		const fields = [
			"wiki_url",
			"wiki_key",
			"coat_of_arms_url",
			"founded_text",
			"dissolved_text",
			"type",
			"status",
			"affiliation_raw",
			"capital_name",
			"seat_name",
			"ruler",
			"language",
			"currency",
			"trade_goods",
			"population",
		];

		for (const field of fields) {
			if (normalizeText(row?.[field]) !== "") {
				score += 1;
			}
		}

		if (Array.isArray(row?.affiliation_path)) {
			score += row.affiliation_path.filter(Boolean).length;
		}

		return score;
	}

	function buildTree(rows) {
		const root = createTreeNode("root", "Herrschaftsgebiete", "root");
		const rowIndex = buildRowIndex(rows);
		const nodeByRowId = new Map();
		const nodeRegistry = new Map();

		for (const row of rows) {
			let current = root;
			const pathParts = [];
			const identityKey = rowIdentityKey(row);

			for (const segment of row.affiliation_path) {
				const label = canonicalLabel(segment);

				if (!label) {
					continue;
				}

				pathParts.push(label);
				current = getOrCreatePathNode(current, label, pathParts, rowIndex, nodeByRowId);
				registerRowNodeById(nodeByRowId, current);
			}

			const currentIdentityKey = rowIdentityKey(current.row);
			if (identityKey && currentIdentityKey && identityKey === currentIdentityKey) {
				current.row = mergeRowsByIdentity(current.row || row, row);
				current.label = current.label || getPreferredDisplayAlias(row.name) || row.name;
				current.kind = current.children.length > 0 ? "territory-group" : "territory";
				registerRowNodeById(nodeByRowId, current);
				continue;
			}

			const existingRowNode = getRegisteredRowNodeById(nodeByRowId, row);
			if (existingRowNode) {
				existingRowNode.row = mergeRowsByIdentity(existingRowNode.row || row, row);
				existingRowNode.label = existingRowNode.label || getPreferredDisplayAlias(row.name) || row.name;
				existingRowNode.kind = existingRowNode.children.length > 0 ? "territory-group" : "territory";
				continue;
			}

			const nodeKey = rowKey(row);
			const nameKey = makeKey(row.name);
			let ownNode = null;

			if (nameKey && current.childMap.has(nameKey)) {
				ownNode = current.childMap.get(nameKey);
			} else if (nodeKey && current.childMap.has(nodeKey)) {
				ownNode = current.childMap.get(nodeKey);
			}

			if (!ownNode) {
				ownNode = createTreeNode(nodeKey || nameKey || `row:${row.id}`, row.name, "territory");
				ownNode.parent = current;
				current.childMap.set(ownNode.id, ownNode);

				if (nameKey && nameKey !== ownNode.id) {
					current.childMap.set(nameKey, ownNode);
				}

				if (nodeKey && nodeKey !== ownNode.id) {
					current.childMap.set(nodeKey, ownNode);
				}

				current.children.push(ownNode);
			}

			ownNode.row = row;
			ownNode.label = ownNode.label || getPreferredDisplayAlias(row.name) || row.name;
			ownNode.kind = ownNode.children.length > 0 ? "territory-group" : "territory";
			registerRowNodeById(nodeByRowId, ownNode);
		}

		pruneEmptySyntheticNodes(root);
		sortTree(root);
		registerTree(root, nodeRegistry);

		return {
			root,
			nodeRegistry,
		};
	}

	function buildRowIndex(rows) {
		const index = new Map();

		for (const row of rows) {
			const labels = new Set([row.name]);

			for (const alias of getDisplayAliases(row.name)) {
				labels.add(alias);
			}

			for (const label of labels) {
				const key = makeKey(label);
				if (key && !index.has(key)) {
					index.set(key, row);
				}
			}
		}

		return index;
	}

	function getDisplayAliases(name) {
		const aliases = new Set();

		for (const alias of getFixedAliases(name)) {
			aliases.add(alias);
		}

		for (const alias of getSuffixDisplayAliases(name)) {
			aliases.add(alias);
		}

		return [...aliases];
	}

	function getSuffixDisplayAliases(name) {
		const normalizedName = normalizeText(name);
		const aliases = [];

		for (const suffix of DISPLAY_SUFFIXES) {
			const suffixPattern = new RegExp(`\\s*\\(${escapeRegExp(suffix)}\\)\\s*$`, "u");

			if (suffixPattern.test(normalizedName)) {
				const alias = normalizeText(normalizedName.replace(suffixPattern, ""));

				if (alias) {
					aliases.push(alias);
				}
			}
		}

		return aliases;
	}

	function getFixedAliases(name) {
		const aliases = {
			"Wiedererstandenes Reich des Horas": ["Horasreich"],
			"Heiliges Neues Kaiserreich vom Greifenthron zu Gareth": ["Mittelreich"],
			"Theaterritterliche Republik an Born und Walsach": ["Bornland"],
		};

		return aliases[name] || [];
	}

	function getPreferredDisplayAlias(name) {
		return getSuffixDisplayAliases(name)[0] || "";
	}

	function getRowIdKey(row) {
		const id = normalizeText(row?.id || "");

		return id ? `id:${id}` : "";
	}

	function getRegisteredRowNodeById(nodeByRowId, row) {
		const idKey = getRowIdKey(row);

		return idKey ? nodeByRowId.get(idKey) || null : null;
	}

	function registerRowNodeById(nodeByRowId, node) {
		const idKey = getRowIdKey(node?.row);

		if (!idKey || nodeByRowId.has(idKey)) {
			return;
		}

		nodeByRowId.set(idKey, node);
	}

	function moveTreeNodeToParent(node, parent) {
		if (!node || !parent || node.parent === parent || isAncestorNode(node, parent)) {
			return;
		}

		if (node.parent) {
			removeTreeNodeReference(node.parent, node);
		}

		node.parent = parent;

		if (!parent.children.includes(node)) {
			parent.children.push(node);
		}
	}

	function removeTreeNodeReference(parent, node) {
		parent.children = parent.children.filter((child) => child !== node);

		for (const [key, value] of parent.childMap.entries()) {
			if (value === node) {
				parent.childMap.delete(key);
			}
		}
	}

	function isAncestorNode(possibleAncestor, node) {
		let current = node;

		while (current) {
			if (current === possibleAncestor) {
				return true;
			}

			current = current.parent;
		}

		return false;
	}

	function pruneEmptySyntheticNodes(node) {
		for (const child of [...node.children]) {
			pruneEmptySyntheticNodes(child);

			if (isSyntheticNode(child) && child.children.length === 0) {
				removeTreeNodeReference(node, child);
			}
		}
	}

	function getOrCreatePathNode(parent, label, pathParts, rowIndex, nodeByRowId) {
		const key = makeKey(label);
		let node = parent.childMap.get(key);

		if (!node) {
			const matchingRow = rowIndex.get(key);
			const existingRowNode = matchingRow ? getRegisteredRowNodeById(nodeByRowId, matchingRow) : null;

			if (existingRowNode) {
				node = existingRowNode;
				moveTreeNodeToParent(node, parent);
				node.label = label;
				node.kind = node.children.length > 0 ? "territory-group" : "territory";
			} else {
				const nodeId = matchingRow ? rowKey(matchingRow) : `path:${pathParts.map(makeKey).join("/")}`;

				node = createTreeNode(nodeId, label, matchingRow ? "territory-group" : "synthetic");
				node.parent = parent;

				if (matchingRow) {
					node.row = matchingRow;
					node.label = label;
					registerRowNodeById(nodeByRowId, node);
				}

				parent.children.push(node);
			}

			parent.childMap.set(key, node);

			if (node.id && node.id !== key) {
				parent.childMap.set(node.id, node);
			}

			if (node.row) {
				const matchingNameKey = makeKey(node.row.name);
				const matchingRowKey = rowKey(node.row);

				if (matchingNameKey) {
					parent.childMap.set(matchingNameKey, node);
				}

				if (matchingRowKey) {
					parent.childMap.set(matchingRowKey, node);
				}
			}
		}

		return node;
	}

	function createTreeNode(id, label, kind) {
		return {
			id,
			label,
			kind,
			row: null,
			parent: null,
			children: [],
			childMap: new Map(),
		};
	}

	function registerTree(node, nodeRegistry) {
		if (node.id !== "root") {
			nodeRegistry.set(node.id, node);
		}

		for (const child of node.children) {
			registerTree(child, nodeRegistry);
		}
	}

	function sortTree(node) {
		node.children.sort(compareTreeNodes);

		for (const child of node.children) {
			sortTree(child);
		}
	}

	function compareTreeNodes(left, right) {
		const leftFolder = left.children.length > 0 ? 0 : 1;
		const rightFolder = right.children.length > 0 ? 0 : 1;

		if (leftFolder !== rightFolder) {
			return leftFolder - rightFolder;
		}

		return left.label.localeCompare(right.label, "de");
	}

	function filterRows(rows, filters = {}) {
		const search = normalizeText(filters.search || filters.query || "").toLowerCase();
		const continent = normalizeText(filters.continent);
		const type = normalizeText(filters.type);
		const status = normalizeText(filters.status).toLowerCase();

		return (Array.isArray(rows) ? rows : []).filter((row) => {
			if (continent && row.continent !== continent) {
				return false;
			}
			if (type && row.type !== type) {
				return false;
			}
			if (status) {
				const rowStatus = normalizeText(row.status).toLowerCase();
				const rowStatusTags = Array.isArray(row.status_filter_tags) ? row.status_filter_tags : [];
				if (rowStatus !== status && !rowStatusTags.includes(status)) {
					return false;
				}
			}

			if (!search) {
				return true;
			}

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
			].join(" ").toLowerCase();

			return haystack.includes(search);
		});
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

		if (children.length === 0) {
			return {
				kind: ownAssigned ? "all" : "none",
				ownAssigned,
				hasAnyCoverage: ownAssigned,
				isComplete: ownAssigned,
			};
		}

		const childStatuses = children.map(getTreeCoverageStatus);
		const hasAnyChildCoverage = childStatuses.some((status) => status.hasAnyCoverage);
		const allChildrenComplete = childStatuses.every((status) => status.isComplete);
		const hasAnyCoverage = ownAssigned || hasAnyChildCoverage;

		if (ownAssigned && allChildrenComplete) {
			return {
				kind: "all",
				ownAssigned,
				hasAnyCoverage,
				isComplete: true,
			};
		}

		if (ownAssigned) {
			return {
				kind: "own-only",
				ownAssigned,
				hasAnyCoverage,
				isComplete: false,
			};
		}

		if (hasAnyChildCoverage && allChildrenComplete) {
			return {
				kind: "all",
				ownAssigned,
				hasAnyCoverage,
				isComplete: true,
			};
		}

		if (hasAnyChildCoverage) {
			return {
				kind: "children-only",
				ownAssigned,
				hasAnyCoverage,
				isComplete: false,
			};
		}

		return {
			kind: "none",
			ownAssigned,
			hasAnyCoverage: false,
			isComplete: false,
		};
	}

	function getTreeMapStatus(node) {
		const status = getTreeCoverageStatus(node);

		if (status.kind === "all") {
			return {
				kind: "all",
				label: status.ownAssigned
					? "Gebiet und Untergebiete sind auf der Karte vorhanden"
					: "Alle Untergebiete sind auf der Karte vorhanden",
			};
		}

		if (status.kind === "own-only") {
			return {
				kind: "own-only",
				label: "Gebiet ist auf der Karte vorhanden, Untergebiete fehlen oder sind nicht vollst\u00e4ndig",
			};
		}

		if (status.kind === "children-only") {
			return {
				kind: "children-only",
				label: "Gebiet ist indirekt durch Untergebiete auf der Karte vorhanden, Untergebiete fehlen oder sind nicht vollst\u00e4ndig",
			};
		}

		return {
			kind: "none",
			label: "Gebiet und Untergebiete fehlen auf der Karte",
		};
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
		if (!node) {
			return null;
		}

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
			pathKeys: getNodePath(node).map((pathNode) => {
				return pathNode.row?.wiki_key || pathNode.row?.public_id || pathNode.id || makeKey(pathNode.label);
			}),
		};
	}

	function createDragPayload(node) {
		return {
			node: createNodeReference(node),
			path: getNodePath(node).map(createNodeReference),
		};
	}

	function applyDragData(event, node) {
		const dataTransfer = event?.dataTransfer;
		if (!dataTransfer || !node) {
			return;
		}

		const nodeId = String(node.id || "").trim();
		if (!nodeId) {
			return;
		}

		dataTransfer.effectAllowed = "copy";
		dataTransfer.setData("application/x-avesmaps-territory-node-id", nodeId);
		dataTransfer.setData("text/plain", nodeId);

		const territoryPublicId = normalizeText(node?.row?.public_id || "");
		if (territoryPublicId) {
			dataTransfer.setData("application/x-avesmaps-territory", territoryPublicId);
		}

		try {
			dataTransfer.setData("application/x-avesmaps-territory-node-json", JSON.stringify(createDragPayload(node)));
		} catch (error) {
			// Ignore payload encoding errors for drag data.
		}
	}

	function getDraggedNodeId(dataTransfer) {
		if (!dataTransfer) {
			return "";
		}

		return normalizeText(
			dataTransfer.getData("application/x-avesmaps-territory-node-id")
			|| dataTransfer.getData("text/plain")
			|| ""
		);
	}

	function renderTree(options = {}) {
		const container = options.container;
		if (!(container instanceof HTMLElement)) {
			return;
		}

		const root = options.root;
		const rowCount = Number(options.rowCount || 0);
		const totalRowCount = Number(options.totalRowCount ?? rowCount);
		const searchText = normalizeText(options.searchText || "");
		const selectedNodeId = normalizeText(options.selectedNodeId || "");
		const infoElement = options.infoElement instanceof HTMLElement ? options.infoElement : null;
		const itemClassName = normalizeText(options.itemClassName || "");

		container.innerHTML = "";

		if (rowCount === 0) {
			if (infoElement) {
				infoElement.textContent = totalRowCount === 0 ? "Noch keine Daten geladen." : "Keine Treffer.";
			}
			return;
		}

		const treeRootElement = document.createElement("ul");
		treeRootElement.className = "tree-root";

		renderTreeChildren(treeRootElement, root.children, 0, {
			searchText,
			selectedNodeId,
			itemClassName,
			onItemClick: options.onItemClick,
			onItemDragStart: options.onItemDragStart,
			enableDrag: options.enableDrag !== false,
		});

		container.appendChild(treeRootElement);

		if (infoElement) {
			infoElement.textContent = `${rowCount} Herrschaftsgebiete in ${root.children.length} Wurzelbereichen.`;
		}
	}

	function renderTreeChildren(parentElement, children, depth, options) {
		const normalChildren = children.filter((child) => !isSyntheticNode(child));
		const syntheticChildren = children.filter(isSyntheticNode);

		for (const child of normalChildren) {
			parentElement.appendChild(renderTreeNode(child, depth, options));
		}

		if (syntheticChildren.length > 0) {
			const separator = document.createElement("li");
			separator.className = "tree-separator";
			separator.textContent = "Sonstiges";
			parentElement.appendChild(separator);

			for (const child of syntheticChildren) {
				parentElement.appendChild(renderTreeNode(child, depth, options));
			}
		}
	}

	function renderTreeNode(node, depth, options) {
		const listItem = document.createElement("li");
		listItem.className = "tree-node";

		if (node.children.length > 0) {
			const details = document.createElement("details");
			const hasActiveSearch = normalizeText(options.searchText).length > 0;

			details.open = hasActiveSearch || depth > 0;

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
		if (options.itemClassName) {
			classParts.push(options.itemClassName);
		}
		itemElement.className = classParts.join(" ");
		itemElement.draggable = options.enableDrag === true;
		itemElement.dataset.nodeId = node.id;
		itemElement.title = node.kind === "synthetic"
			? "Abgeleiteter Gruppenknoten ohne eigenen Wiki-Datensatz"
			: "Herrschaftsgebiet";

		if (options.selectedNodeId && node.id === options.selectedNodeId) {
			itemElement.classList.add("selected");
		}

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
			if (typeof options.onItemClick === "function") {
				options.onItemClick(node, event);
			} else {
				event.stopPropagation();
			}
		});

		if (options.enableDrag === true) {
			itemElement.addEventListener("dragstart", (event) => {
				applyDragData(event, node);
				if (typeof options.onItemDragStart === "function") {
					options.onItemDragStart(node, event);
				}
			});
		}

		return itemElement;
	}

	function setAllTreeDetailsOpen(container, open) {
		if (!(container instanceof HTMLElement)) {
			return;
		}

		for (const details of container.querySelectorAll("details")) {
			details.open = Boolean(open);
		}
	}

	async function fetchRows(options = {}) {
		const apiUrl = normalizeText(options.apiUrl || DEFAULT_API_URL) || DEFAULT_API_URL;
		const requestUrl = new URL(apiUrl, globalObject.location?.href || "http://localhost");
		requestUrl.searchParams.set("_", String(Date.now()));

		const response = await fetch(requestUrl.toString(), {
			method: "GET",
			credentials: options.credentials || "omit",
			cache: "no-store",
			headers: {
				Accept: "application/json",
				"Cache-Control": "no-cache",
				Pragma: "no-cache",
			},
			signal: options.signal,
		});

		const payload = await response.json();

		if (!response.ok || !payload?.ok) {
			throw new Error(payload?.error || `HTTP ${response.status}`);
		}

		const rows = normalizeApiRows(payload.items || []);
		return {
			rows,
			payload,
		};
	}

	async function loadTree(options = {}) {
		const { rows, payload } = await fetchRows(options);
		const { root, nodeRegistry } = buildTree(rows);

		return {
			rows,
			root,
			nodeRegistry,
			payload,
		};
	}

	globalObject.AvesmapsPoliticalTerritoryWikiTree = {
		version: MODULE_VERSION,
		defaultApiUrl: DEFAULT_API_URL,
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

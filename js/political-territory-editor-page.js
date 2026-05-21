"use strict";

const API_URL = "/api/political-territory-wiki.php";
const WRITE_API_URL = "/api/political-territories.php?debug_errors=1";

const MODULE_VERSION = "2026-05-16-module-save-api";
const wikiTreeComponent = window.AvesmapsPoliticalTerritoryWikiTree || null;

const DISPLAY_SUFFIXES = [
	"Staat",
	"Imperium",
	"Reich",
	"Kalifat"
];

if (new URLSearchParams(window.location.search).get("embedded") === "1") {
	document.body.classList.add("is-embedded");
}

/*
	Vorgeschlagenes DB-Schema für die spätere Speicher-API.
	Strategie: Beim Speichern wird die vollständige Breadcrumb-Darstellungskette
	für ein zugewiesenes Herrschaftsgebiet ersetzt.

	CREATE TABLE political_territory_geometry_assignment (
		id INT AUTO_INCREMENT PRIMARY KEY,
		source_territory_node_key VARCHAR(190) NOT NULL,
		source_territory_wiki_key VARCHAR(190) NULL,
		source_territory_name VARCHAR(255) NOT NULL,
		path_json JSON NOT NULL,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		UNIQUE KEY uniq_source_territory (source_territory_node_key)
	);

	CREATE TABLE political_territory_geometry_display (
		id INT AUTO_INCREMENT PRIMARY KEY,
		assignment_id INT NOT NULL,
		node_key VARCHAR(190) NOT NULL,
		node_wiki_key VARCHAR(190) NULL,
		node_name VARCHAR(255) NOT NULL,
		path_json JSON NOT NULL,
		depth INT NOT NULL,
		display_name VARCHAR(255) NOT NULL,
		coat_of_arms_url TEXT NULL,
		zoom_min INT NULL,
		zoom_max INT NULL,
		color CHAR(7) NOT NULL DEFAULT '#385d72',
		opacity DECIMAL(4,3) NOT NULL DEFAULT 0.330,
		start_year_bf INT NULL,
		end_year_bf INT NULL,
		exists_until_today TINYINT(1) NOT NULL DEFAULT 1,
		created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		CONSTRAINT fk_political_territory_geometry_display_assignment
			FOREIGN KEY (assignment_id)
			REFERENCES political_territory_geometry_assignment(id)
			ON DELETE CASCADE,
		UNIQUE KEY uniq_assignment_node (assignment_id, node_key)
	);
*/

let moduleOptions = {
	saveUrl: WRITE_API_URL,
	onSave: null,
	onUnassign: null,
	onCancel: null,
	onStatusChange: null,
	onTerritoryDrop: null
};
let initialized = false;
let pendingValue = null;

let allRows = [];
let currentTree = null;
let selectedNode = null;
let droppedNode = null;
let editedNode = null;
let displayStateByNodeId = new Map();
let nodeRegistry = new Map();

const els = {
	reloadButton: document.getElementById("reloadButton"),
	expandButton: document.getElementById("expandButton"),
	collapseButton: document.getElementById("collapseButton"),
	searchInput: document.getElementById("searchInput"),
	continentFilter: document.getElementById("continentFilter"),
	typeFilter: document.getElementById("typeFilter"),
	statusFilter: document.getElementById("statusFilter"),
	statusValue: document.getElementById("statusValue"),
	loadedValue: document.getElementById("loadedValue"),
	visibleValue: document.getElementById("visibleValue"),
	rootValue: document.getElementById("rootValue"),
	treeInfo: document.getElementById("treeInfo"),
	treeView: document.getElementById("treeView"),
	dropZone: document.getElementById("dropZone"),
	breadcrumb: document.getElementById("breadcrumb"),
	manualEditPath: document.getElementById("manualEditPath"),
	infoBox: document.getElementById("infoBox"),
	detailInfo: document.getElementById("detailInfo"),
	zoomFromInput: document.getElementById("zoomFromInput"),
	zoomToInput: document.getElementById("zoomToInput"),
	displayNameInput: document.getElementById("displayNameInput"),
	alternateCoatInput: document.getElementById("alternateCoatInput"),
	manualCoatPreview: document.getElementById("manualCoatPreview"),
	updateCoatButton: document.getElementById("updateCoatButton"),
	geometryDatabaseInfo: document.getElementById("geometryDatabaseInfo")
};

if (els.reloadButton) {
	els.reloadButton.addEventListener("click", loadData);
}

els.searchInput.addEventListener("input", render);
els.continentFilter.addEventListener("change", render);
els.typeFilter.addEventListener("change", render);
els.statusFilter.addEventListener("change", render);

const existsUntilTodayInput = document.getElementById("existsUntilTodayInput");
const endYearInput = document.getElementById("endYearInput");
const transparencyInput = document.getElementById("transparencyInput");
const transparencyOutput = document.getElementById("transparencyOutput");

function syncEndYearInputState() {
	if (!existsUntilTodayInput || !endYearInput) {
		return;
	}

	endYearInput.disabled = existsUntilTodayInput.checked;

	if (existsUntilTodayInput.checked) {
		endYearInput.value = "";
	}
}

if (existsUntilTodayInput) {
	existsUntilTodayInput.addEventListener("change", syncEndYearInputState);
	syncEndYearInputState();
}

function syncTransparencyOutput() {
	if (!transparencyInput || !transparencyOutput) {
		return;
	}

	transparencyOutput.value = `${transparencyInput.value}%`;
}

if (transparencyInput) {
	transparencyInput.addEventListener("input", syncTransparencyOutput);
	syncTransparencyOutput();
}

if (els.updateCoatButton) {
	els.updateCoatButton.addEventListener("click", updateWikiCoatPreviewFromManualInput);
}

const saveButton = document.getElementById("saveButton");
const cancelButton = document.getElementById("cancelButton");
const unassignButton = document.getElementById("unassignButton");

if (saveButton) {
	saveButton.addEventListener("click", handleSave);
}

if (cancelButton) {
	cancelButton.addEventListener("click", handleCancel);
}

if (unassignButton) {
	unassignButton.addEventListener("click", handleUnassign);
}

els.expandButton.addEventListener("click", () => setAllTreeDetailsOpen(true));
els.collapseButton.addEventListener("click", () => setAllTreeDetailsOpen(false));

els.dropZone.addEventListener("dragover", event => {
	event.preventDefault();
	event.dataTransfer.dropEffect = "copy";
	els.dropZone.classList.add("drag-over");
});

els.dropZone.addEventListener("dragleave", () => {
	els.dropZone.classList.remove("drag-over");
});

els.dropZone.addEventListener("drop", event => {
	event.preventDefault();
	els.dropZone.classList.remove("drag-over");

	const nodeId = getDraggedNodeId(event.dataTransfer);
	const node = nodeRegistry.get(nodeId);

	if (node) {
		droppedNode = node;
		displayStateByNodeId = new Map();
		renderDropZone();
		selectNode(node);

		if (typeof moduleOptions.onTerritoryDrop === "function") {
			moduleOptions.onTerritoryDrop(createNodeReference(node), getAssignmentValue());
		}
	}
});

if (wikiTreeComponent) {
	const componentNormalizeApiRows = wikiTreeComponent.normalizeApiRows;
	if (typeof componentNormalizeApiRows === "function") {
		normalizeApiRows = function normalizeApiRowsFromComponent(rows) {
			return componentNormalizeApiRows(rows);
		};
	}

	const componentBuildTree = wikiTreeComponent.buildTree;
	if (typeof componentBuildTree === "function") {
		buildTerritoryTree = function buildTerritoryTreeFromComponent(rows) {
			const treeResult = componentBuildTree(rows);
			nodeRegistry = treeResult?.nodeRegistry instanceof Map ? treeResult.nodeRegistry : new Map();
			return treeResult?.root || createTreeNode("root", "Herrschaftsgebiete", "root");
		};
	}

	const componentRenderTree = wikiTreeComponent.renderTree;
	if (typeof componentRenderTree === "function") {
		renderTree = function renderTreeFromComponent(root, rowCount) {
			componentRenderTree({
				container: els.treeView,
				root,
				rowCount,
				totalRowCount: allRows.length,
				searchText: els.searchInput?.value || "",
				infoElement: els.treeInfo,
				onItemClick: (node, event) => {
					event.stopPropagation();
				},
			});
		};
	}

	if (typeof wikiTreeComponent.isSyntheticNode === "function") {
		isSyntheticNode = function isSyntheticNodeFromComponent(node) {
			return wikiTreeComponent.isSyntheticNode(node);
		};
	}

	if (typeof wikiTreeComponent.getTreeMapStatus === "function") {
		getTreeMapStatus = function getTreeMapStatusFromComponent(node) {
			return wikiTreeComponent.getTreeMapStatus(node);
		};
	}

	if (typeof wikiTreeComponent.getTreeCoverageStatus === "function") {
		getTreeCoverageStatus = function getTreeCoverageStatusFromComponent(node) {
			return wikiTreeComponent.getTreeCoverageStatus(node);
		};
	}

	if (typeof wikiTreeComponent.isTreeNodeAssignedToMap === "function") {
		isTreeNodeAssignedToMap = function isTreeNodeAssignedToMapFromComponent(node) {
			return wikiTreeComponent.isTreeNodeAssignedToMap(node);
		};
	}
}

function init(options = {}) {
	configure(options);

	if (initialized) {
		return;
	}

	initialized = true;
	renderDropZone();
	showEmptyDetails();
	loadData();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init, { once: true });
} else {
	init();
}

async function loadData() {
	setStatus("Lädt");
	if (els.reloadButton) {
		els.reloadButton.disabled = true;
	}

	try {
		const response = await fetch(API_URL, {
			method: "GET",
			credentials: "omit",
			headers: {
				"Accept": "application/json"
			}
		});

		const payload = await response.json();

		if (!response.ok || !payload.ok) {
			throw new Error(payload.error || `HTTP ${response.status}`);
		}

		allRows = normalizeApiRows(payload.items || []);
		setStatus("Fertig");
		updateFilters();
		render();

		try {
			await loadExistingGeometryAssignmentFromUrl();
		} catch (assignmentError) {
			console.warn("Bestehende Eigenschaften konnten nicht geladen werden:", assignmentError);
			setFormStatus(
				assignmentError.message || "Bestehende Eigenschaften konnten nicht geladen werden.",
				"error"
			);
		}
	} catch (error) {
		allRows = [];
		currentTree = null;
		nodeRegistry.clear();
		setStatus("Fehler");
		els.treeInfo.innerHTML = `<span class="error">${escapeHtml(error.message || String(error))}</span>`;
		render();
		showEmptyDetails(error.message || String(error));
	} finally {
		if (els.reloadButton) {
			els.reloadButton.disabled = false;
		}
	}
}

function normalizeApiRows(rows) {
	const normalizedRows = rows
		.map(row => {
			const normalizedName = normalizeText(row.name);
			const normalizedStatus = normalizeText(row.status);
			const statusFilterTags = buildRowStatusFilterTags(normalizedName, normalizedStatus);

			return {
				...row,
				name: normalizedName,
				type: normalizeText(row.type),
				continent: normalizeText(row.continent),
				affiliation_raw: normalizeText(row.affiliation_raw || row.political),
				affiliation_root: normalizeText(row.affiliation_root),
				affiliation_path: normalizeAffiliationPath(row),
				status: normalizedStatus,
				status_filter_tags: statusFilterTags,
				form_of_government: normalizeText(row.form_of_government),
				capital_name: normalizeText(row.capital_name),
				seat_name: normalizeText(row.seat_name),
				ruler: normalizeText(row.ruler),
				language: normalizeText(row.language),
				currency: normalizeText(row.currency),
				trade_goods: normalizeText(row.trade_goods),
				population: normalizeText(row.population),
				founded_text: normalizeText(row.founded_text),
				dissolved_text: normalizeText(row.dissolved_text),
				founder: normalizeText(row.founder),
				geographic: normalizeText(row.geographic),
				political: normalizeText(row.political),
				trade_zone: normalizeText(row.trade_zone),
				blazon: normalizeText(row.blazon),
				wiki_url: normalizeText(row.wiki_url),
				coat_of_arms_url: normalizeText(row.coat_of_arms_url),
				map_assigned: Boolean(row.map_assigned) || Number(row.map_geometry_count || 0) > 0,
				map_territory_count: parseOptionalNumber(row.map_territory_count, 0),
				map_geometry_count: parseOptionalNumber(row.map_geometry_count, 0)
			};
		})
		.filter(row => row.name);

	return dedupeRowsByIdentity(normalizedRows);
}

async function loadExistingGeometryAssignmentFromUrl() {
	updateGeometryDatabaseInfo();

	const params = new URLSearchParams(window.location.search);
	const geometryPublicId = normalizeText(params.get("geometry_public_id") || "");

	if (!geometryPublicId) {
		return;
	}
	
	const separator = WRITE_API_URL.includes("?") ? "&" : "?";
	const response = await fetch(`${WRITE_API_URL}${separator}action=geometry_assignment&geometry_public_id=${encodeURIComponent(geometryPublicId)}`, {
		method: "GET",
		credentials: "same-origin",
		headers: {
			"Accept": "application/json"
		}
	});

	const payload = await response.json();

	if (response.status === 400 || response.status === 404) {
		setFormStatus(payload.error || "Noch keine gespeicherten Eigenschaften für diese Geometrie vorhanden.", "pending");
		return;
	}

	if (!response.ok || !payload.ok) {
		throw new Error(payload.error || `HTTP ${response.status}`);
	} 
	
	if (payload.assignment) {
		if (payload.geometry) {
			updateGeometryDatabaseInfo(payload.geometry);
		}

		setAssignmentValue(payload.assignment);
		setFormStatus("Bestehende Eigenschaften geladen.", "success");
	}
}

function updateGeometryDatabaseInfo(geometry = null) {
	const params = new URLSearchParams(window.location.search);
	const geometryPublicId = normalizeText(
		geometry?.publicId
		|| geometry?.public_id
		|| params.get("geometry_public_id")
		|| ""
	);
	const geometryId = normalizeText(
		geometry?.id
		|| geometry?.geometryId
		|| geometry?.geometry_id
		|| params.get("geometry_id")
		|| ""
	);

	if (!els.geometryDatabaseInfo) {
		return;
	}

	const idParts = [];
	if (geometryId) {
		idParts.push(`#${geometryId}`);
	}
	if (geometryPublicId) {
		idParts.push(geometryPublicId);
	}

	els.geometryDatabaseInfo.textContent = idParts.length > 0
		? `Geometrie in der Datenbank: ${idParts.join(" / ")}`
		: "Geometrie in der Datenbank";
}

function normalizeAffiliationPath(row) {
	const candidatePaths = [
		row.affiliation_path,
		row.affiliation && Array.isArray(row.affiliation.path) ? row.affiliation.path : null,
		row.affiliation_root ? [row.affiliation_root] : null,
		row.affiliation_raw ? [normalizeText(row.affiliation_raw).split(":")[0]] : null
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

	return ["ungeklärt"];
}

function normalizeAffiliationPathCandidate(pathCandidate) {
	if (!Array.isArray(pathCandidate)) {
		return {
			hasSource: false,
			isIndependent: false,
			parts: []
		};
	}

	const parts = pathCandidate.map(normalizeText).filter(Boolean);

	if (parts.length === 0) {
		return {
			hasSource: false,
			isIndependent: false,
			parts: []
		};
	}

	if (parts.some(isIndependentAffiliationSegment)) {
		return {
			hasSource: true,
			isIndependent: true,
			parts: []
		};
	}

	const cleanedParts = [...parts];

	while (cleanedParts.length > 0 && isGenericAffiliationSegment(cleanedParts[0])) {
		cleanedParts.shift();
	}

	return {
		hasSource: true,
		isIndependent: false,
		parts: cleanedParts
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

function render() {
	const rows = getFilteredRows();
	currentTree = buildTerritoryTree(rows);

	els.loadedValue.textContent = String(allRows.length);
	els.visibleValue.textContent = String(rows.length);
	els.rootValue.textContent = String(currentTree.children.length);

	renderTree(currentTree, rows.length);

	if (selectedNode && !nodeRegistry.has(selectedNode.id)) {
		selectedNode = null;
		showEmptyDetails();
	}
}

function buildTerritoryTree(rows) {
	const root = createTreeNode("root", "Herrschaftsgebiete", "root");
	const rowIndex = buildRowIndex(rows);
	const nodeByRowId = new Map();
	nodeRegistry = new Map();

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
	registerTree(root);

	return root;
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
	parent.children = parent.children.filter(child => child !== node);

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

function getPreferredDisplayAlias(name) {
	return getSuffixDisplayAliases(name)[0] || "";
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
		"Theaterritterliche Republik an Born und Walsach": ["Bornland"]
	};

	return aliases[name] || [];
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

	return rowOrder.map(key => dedupedByKey.get(key)).filter(Boolean);
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
	score += Number(row.map_geometry_count || 0) * 100;
	score += Number(row.map_territory_count || 0) * 20;

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
		"population"
	];

	for (const field of fields) {
		if (normalizeText(row[field]) !== "") {
			score += 1;
		}
	}

	if (Array.isArray(row.affiliation_path)) {
		score += row.affiliation_path.filter(Boolean).length;
	}

	return score;
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
		const parsed = new URL(rawUrl, window.location.origin);
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
		childMap: new Map()
	};
}

function registerTree(node) {
	if (node.id !== "root") {
		nodeRegistry.set(node.id, node);
	}

	for (const child of node.children) {
		registerTree(child);
	}
}

function sortTree(node) {
	node.children.sort(compareTreeNodes);

	for (const child of node.children) {
		sortTree(child);
	}
}

function compareTreeNodes(a, b) {
	const aFolder = a.children.length > 0 ? 0 : 1;
	const bFolder = b.children.length > 0 ? 0 : 1;

	if (aFolder !== bFolder) {
		return aFolder - bFolder;
	}

	return a.label.localeCompare(b.label, "de");
}

function renderTree(root, rowCount) {
	els.treeView.innerHTML = "";

	if (rowCount === 0) {
		els.treeInfo.textContent = allRows.length === 0 ? "Noch keine Daten geladen." : "Keine Treffer.";
		return;
	}

	const ul = document.createElement("ul");
	ul.className = "tree-root";

	renderTreeChildren(ul, root.children, 0);

	els.treeView.appendChild(ul);
	els.treeInfo.textContent = `${rowCount} Herrschaftsgebiete in ${root.children.length} Wurzelbereichen.`;
}

function renderTreeChildren(ul, children, depth) {
	const normalChildren = children.filter(child => !isSyntheticNode(child));
	const syntheticChildren = children.filter(isSyntheticNode);

	for (const child of normalChildren) {
		ul.appendChild(renderTreeNode(child, depth));
	}

	if (syntheticChildren.length > 0) {
		const separator = document.createElement("li");
		separator.className = "tree-separator";
		separator.textContent = "Sonstiges";
		ul.appendChild(separator);

		for (const child of syntheticChildren) {
			ul.appendChild(renderTreeNode(child, depth));
		}
	}
}

function isSyntheticNode(node) {
	return node.kind === "synthetic" && !node.row;
}

function renderTreeNode(node, depth) {
	const li = document.createElement("li");
	li.className = "tree-node";

	if (node.children.length > 0) {
		const details = document.createElement("details");
		const hasActiveSearch = normalizeText(els.searchInput.value).length > 0;

		details.open = hasActiveSearch || depth > 0;

		const summary = document.createElement("summary");

		const toggle = document.createElement("span");
		toggle.className = "tree-toggle";
		toggle.setAttribute("aria-hidden", "true");
		summary.appendChild(toggle);

		summary.appendChild(renderTreeItem(node));
		details.appendChild(summary);

		const ul = document.createElement("ul");

		renderTreeChildren(ul, node.children, depth + 1);

		details.appendChild(ul);
		li.appendChild(details);
	} else {
		li.appendChild(renderTreeItem(node));
	}

	return li;
}

function renderTreeItem(node) {
	const item = document.createElement("span");
	item.className = node.kind === "synthetic" ? "tree-item synthetic" : "tree-item";
	item.draggable = true;
	item.dataset.nodeId = node.id;
	item.title = node.kind === "synthetic" ? "Abgeleiteter Gruppenknoten ohne eigenen Wiki-Datensatz" : "Herrschaftsgebiet";

	const handle = document.createElement("span");
	handle.className = "drag-handle";
	handle.textContent = "⠿";
	item.appendChild(handle);

	const name = document.createElement("span");
	name.className = "tree-item-name";
	const rowId = Number(node?.row?.id || 0);
	name.textContent = rowId > 0 ? `${node.label} (ID: ${rowId})` : node.label;
	item.appendChild(name);

	const mapStatus = getTreeMapStatus(node);
	const mapStatusElement = document.createElement("span");
	mapStatusElement.className = `tree-map-status tree-map-status--${mapStatus.kind}`;
	mapStatusElement.title = mapStatus.label;
	mapStatusElement.setAttribute("aria-label", mapStatus.label);
	item.appendChild(mapStatusElement);
	item.title = `${item.title}: ${mapStatus.label}`;

	item.addEventListener("click", event => {
		event.stopPropagation();
	});

	item.addEventListener("dragstart", event => {
		event.dataTransfer.setData("text/plain", node.id);
		event.dataTransfer.effectAllowed = "copy";
	});

	return item;
}

function setAllTreeDetailsOpen(open) {
	if (wikiTreeComponent && typeof wikiTreeComponent.setAllTreeDetailsOpen === "function") {
		wikiTreeComponent.setAllTreeDetailsOpen(els.treeView, open);
		return;
	}

	for (const details of els.treeView.querySelectorAll("details")) {
		details.open = open;
	}
}

function getDraggedNodeId(dataTransfer) {
	if (wikiTreeComponent && typeof wikiTreeComponent.getDraggedNodeId === "function") {
		return wikiTreeComponent.getDraggedNodeId(dataTransfer);
	}

	return normalizeText(dataTransfer?.getData("text/plain") || "");
}

function setStatus(text) {
	els.statusValue.textContent = text;
}

function rowKey(row) {
	return makeKey(row.name || row.wiki_key || row.id || "");
}

function canonicalLabel(value) {
	return normalizeText(value)
		.replace(/\s*\([^)]*\)\s*/g, " ")
		.replace(/\s+/g, " ")
		.trim();
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

function normalizeText(value) {
	return String(value ?? "")
		.replace(/\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function formatInfoValue(value) {
	if (Array.isArray(value)) {
		return value.join(" > ");
	}

	if (value && typeof value === "object") {
		return JSON.stringify(value, null, 2);
	}

	return String(value ?? "");
}

function cssEscape(value) {
	if (window.CSS && typeof window.CSS.escape === "function") {
		return window.CSS.escape(value);
	}

	return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function escapeHtml(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function configure(options = {}) {
	moduleOptions = {
		...moduleOptions,
		...options
	};

	if (options.initialValue) {
		pendingValue = options.initialValue;
	}
}

function getAssignmentValue() {
	saveCurrentDisplayState();

	const assignedPath = droppedNode ? getNodePath(droppedNode) : [];
	const editedPath = editedNode ? getNodePath(editedNode) : [];
	const displays = getDisplayStatesForDroppedPath();
	const activeDisplay = editedNode ? getDisplayStateForNode(editedNode) : null;
	const manualDisplay = readDisplayStateFromForm(activeDisplay || createEmptyDisplayState());
	const effectiveDisplay = activeDisplay || manualDisplay;

	return {
		version: MODULE_VERSION,
		apiUrl: API_URL,
		assignedTerritory: createNodeReference(droppedNode),
		activeDisplayNode: createNodeReference(editedNode),
		assignedPath: assignedPath.map(createNodeReference),
		editedPath: editedPath.map(createNodeReference),
		display: {
			name: effectiveDisplay.displayName || effectiveDisplay.name || "",
			coatOfArmsUrl: effectiveDisplay.coatOfArmsUrl || "",
			zoomMin: effectiveDisplay.zoomMin,
			zoomMax: effectiveDisplay.zoomMax,
			color: effectiveDisplay.color || "#888888",
			opacity: effectiveDisplay.opacity
		},
		validity: {
			startYear: effectiveDisplay.startYear,
			endYear: effectiveDisplay.endYear,
			existsUntilToday: effectiveDisplay.existsUntilToday
		},
		displays,
		source: {
			assignedRow: droppedNode?.row || null,
			editedRow: editedNode?.row || null
		}
	};
}

function readDisplayStateFromForm(fallbackState = createEmptyDisplayState()) {
	const opacityPercent = parseOptionalNumber(
		transparencyInput?.value,
		Math.round((fallbackState.opacity ?? 0.33) * 100)
	);
	const color = normalizeHexColor(document.getElementById("colorInput")?.value)
		|| normalizeHexColor(fallbackState.color)
		|| "#888888";
	const isOpenEnded = Boolean(existsUntilTodayInput?.checked);

	return {
		...fallbackState,
		displayName: normalizeText(els.displayNameInput?.value || fallbackState.displayName || fallbackState.name || ""),
		coatOfArmsUrl: normalizeText(els.alternateCoatInput?.value || fallbackState.coatOfArmsUrl || ""),
		zoomMin: parseOptionalNumber(els.zoomFromInput?.value, fallbackState.zoomMin),
		zoomMax: parseOptionalNumber(els.zoomToInput?.value, fallbackState.zoomMax),
		color,
		opacity: opacityPercent / 100,
		startYear: parseOptionalNumber(document.getElementById("startYearInput")?.value, fallbackState.startYear),
		endYear: isOpenEnded
			? null
			: parseOptionalNumber(endYearInput?.value, fallbackState.endYear),
		existsUntilToday: isOpenEnded,
	};
}

function setAssignmentValue(value = {}) {
	pendingValue = value;

	const selectedIdentifier = value.territoryWikiKey
		|| value.assignedTerritory?.wikiKey
		|| value.assignedTerritory?.key
		|| value.assignedTerritory?.label
		|| "";

	let selectedFromTree = false;

	if (selectedIdentifier) {
		selectedFromTree = setSelectedTerritory(selectedIdentifier);
	}

	if (!selectedFromTree && Array.isArray(value.assignedPath) && value.assignedPath.length > 0) {
		selectedFromTree = setFallbackAssignedPath(value.assignedPath);
	}

	const display = value.display || value;

	setInputValue("displayNameInput", display.name || display.displayName);
	setInputValue("alternateCoatInput", display.coatOfArmsUrl || display.alternateCoatOfArmsUrl);
	setInputValue("zoomFromInput", display.zoomMin);
	setInputValue("zoomToInput", display.zoomMax);
	setInputValue("colorInput", normalizeHexColor(display.color) || (droppedNode ? createAutoTerritoryColor(droppedNode) : "#385d72"));

	if (typeof display.opacity === "number") {
		setInputValue("transparencyInput", Math.round(display.opacity * 100));
		syncTransparencyOutput();
	}

	const validity = value.validity || value;
	setInputValue("startYearInput", validity.startYear);
	setInputValue("endYearInput", validity.endYear);

	const existsUntilTodayInput = document.getElementById("existsUntilTodayInput");
	if (existsUntilTodayInput && typeof validity.existsUntilToday === "boolean") {
		existsUntilTodayInput.checked = validity.existsUntilToday;
		syncEndYearInputState();
	}

	if (Array.isArray(value.displays)) {
		displayStateByNodeId = new Map();

		for (const displayState of value.displays) {
			const node = findNodeForDisplayState(displayState);

			if (node) {
				displayStateByNodeId.set(node.id, normalizeIncomingDisplayState(node, displayState));
			}
		}

		if (editedNode) {
			applyDisplayStateToForm(getDisplayStateForNode(editedNode));
		}
	}

	renderManualCoatPreview(normalizeText(document.getElementById("alternateCoatInput")?.value || ""));
}

function findNodeForDisplayState(displayState) {
	const identifiers = [
		displayState.nodeId,
		displayState.nodeKey,
		displayState.wikiKey,
		displayState.territoryPublicId,
		displayState.slug,
		displayState.name,
		displayState.displayName
	].filter(Boolean);

	for (const identifier of identifiers) {
		const key = makeKey(identifier);

		for (const node of nodeRegistry.values()) {
			const candidates = [
				node.id,
				node.label,
				node.row?.wiki_key,
				node.row?.public_id,
				node.row?.territory_id,
				node.row?.slug,
				node.row?.name,
				node.row?.id
			].filter(value => value !== null && typeof value !== "undefined");

			if (candidates.some(candidate => makeKey(candidate) === key || String(candidate) === String(identifier))) {
				return node;
			}
		}
	}

	return null;
}

function normalizeIncomingDisplayState(node, displayState) {
	return {
		...createDefaultDisplayState(node),
		...displayState,
		nodeId: node.id,
		nodeKey: makeKey(node.label),
		wikiKey: node.row?.wiki_key || displayState.wikiKey || "",
		rowId: node.row?.id || displayState.rowId || null,
		territoryPublicId: node.row?.public_id || displayState.territoryPublicId || "",
		territoryId: node.row?.territory_id || displayState.territoryId || null,
		slug: node.row?.slug || displayState.slug || "",
		name: node.label,
		displayName: normalizeText(displayState.displayName || displayState.name || node.label),
		coatOfArmsUrl: normalizeText(displayState.coatOfArmsUrl || displayState.alternateCoatOfArmsUrl || ""),
		zoomMin: parseOptionalNumber(displayState.zoomMin),
		zoomMax: parseOptionalNumber(displayState.zoomMax),
		color: normalizeHexColor(displayState.color) || createAutoTerritoryColor(node),
		opacity: typeof displayState.opacity === "number" ? displayState.opacity : 0.33,
		startYear: parseOptionalNumber(displayState.startYear),
		endYear: parseOptionalNumber(displayState.endYear),
		existsUntilToday: Boolean(displayState.existsUntilToday)
	};
}

function setSelectedTerritory(identifier) {
	const key = makeKey(identifier);

	for (const node of nodeRegistry.values()) {
		const candidates = [
			node.id,
			node.label,
			node.row?.wiki_key,
			node.row?.name,
			node.row?.id
		].filter(value => value !== null && typeof value !== "undefined");

		if (candidates.some(candidate => makeKey(candidate) === key || String(candidate) === String(identifier))) {
			droppedNode = node;
			displayStateByNodeId = new Map();
			renderDropZone();
			selectNode(node);
			return true;
		}
	}

	return false;
}

function setFallbackAssignedPath(pathReferences) {
	const nodes = [];
	let parent = null;

	for (const reference of pathReferences) {
		const label = normalizeText(reference.label || reference.name || reference.key || reference.id || "");

		if (!label) {
			continue;
		}

		const node = createTreeNode(
			reference.id || reference.key || reference.territoryPublicId || makeKey(label),
			label,
			reference.kind || "territory"
		);

		node.parent = parent;
		node.row = {
			id: reference.rowId || null,
			territory_id: reference.territoryId || null,
			public_id: reference.territoryPublicId || "",
			slug: reference.slug || reference.nodeKey || reference.key || makeKey(label),
			wiki_key: reference.wikiKey || "",
			name: label,
			type: reference.kind || "Herrschaftsgebiet",
			coat_of_arms_url: reference.coatOfArmsUrl || "",
			map_assigned: true,
			map_geometry_count: 1
		};

		node.isExternalAssignment = true;

		if (parent) {
			parent.children = [node];
		}

		nodes.push(node);
		nodeRegistry.set(node.id, node);

		if (node.row.public_id) {
			nodeRegistry.set(node.row.public_id, node);
		}

		parent = node;
	}

	if (nodes.length === 0) {
		return false;
	}

	droppedNode = nodes[nodes.length - 1];
	displayStateByNodeId = new Map();

	renderDropZone();
	selectNode(droppedNode);

	return true;
}

function clearSelection() {
	droppedNode = null;
	selectedNode = null;
	editedNode = null;
	displayStateByNodeId = new Map();
	renderDropZone();
	showEmptyDetails();
}

async function handleSave() {
	const value = getAssignmentValue();

	if (!value) {
		setFormStatus("Keine Geometrie-Daten zum Speichern vorhanden.", "error");
		return;
	}

	setFormStatus("Speichere ...", "pending");

	try {
		let result = null;

		if (typeof moduleOptions.onSave === "function") {
			result = await moduleOptions.onSave(value);
		} else if (moduleOptions.saveUrl) {
			result = await defaultSaveAssignment(value);
		} else {
			console.log("Avesmaps territory assignment", value);
			setFormStatus("Kein saveUrl/onSave konfiguriert. Wert in der Konsole ausgegeben.", "pending");
			return;
		}

		setFormStatus(result?.message || "Gespeichert.", "success");
	} catch (error) {
		setFormStatus(error.message || String(error), "error");
	}
}

async function handleUnassign() {
	const params = new URLSearchParams(window.location.search);
	const geometryPublicId = normalizeText(params.get("geometry_public_id") || "");

	if (!geometryPublicId) {
		setFormStatus("Die Geometrie-ID fehlt. Öffnen Sie den Editor über Rechtsklick auf ein Herrschaftsgebiet.", "error");
		return;
	}

	if (!droppedNode) {
		return;
	}

	if (!window.confirm("Zuweisung zu einem Herrschaftsgebiet entfernen? Die Anzeigeeinstellungen der Geometrie bleiben erhalten.")) {
		return;
	}

	setFormStatus("Entferne Zuweisung ...", "pending");

	try {
		if (typeof moduleOptions.onUnassign === "function") {
			const result = await moduleOptions.onUnassign(getAssignmentValue());
			clearSelection();
			setFormStatus(result?.message || "Zuweisung entfernt. Anzeigeeinstellungen bleiben erhalten.", "success");
			return;
		}

		const response = await fetch(moduleOptions.saveUrl || WRITE_API_URL, {
			method: "PATCH",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json"
			},
			body: JSON.stringify({
				action: "unassign_geometry",
				geometry_public_id: geometryPublicId
			})
		});

		let result = null;

		try {
			result = await response.json();
		} catch (error) {
			result = { ok: response.ok };
		}

		if (!response.ok || result?.ok === false) {
			throw new Error(result?.error || `Zuweisung entfernen fehlgeschlagen: HTTP ${response.status}`);
		}

		clearSelection();
		await loadExistingGeometryAssignmentFromUrl();
		setFormStatus("Zuweisung entfernt. Anzeigeeinstellungen bleiben erhalten.", "success");
	} catch (error) {
		setFormStatus(error.message || String(error), "error");
	}
}

async function defaultSaveAssignment(value) {
	const params = new URLSearchParams(window.location.search);
	const geometryPublicId = normalizeText(params.get("geometry_public_id") || "");

	if (!geometryPublicId) {
		throw new Error("Die Geometrie-ID fehlt. Öffnen Sie den Editor über Rechtsklick auf ein Herrschaftsgebiet.");
	}

	const assignedPath = Array.isArray(value.assignedPath) ? value.assignedPath : [];
	const displays = Array.isArray(value.displays) ? value.displays : [];

	const wikiPublicIds = assignedPath
		.map(node => normalizeText(node.wikiKey || ""))
		.filter(Boolean);

	const territoryPublicIds = assignedPath
		.map(node => normalizeText(node.territoryPublicId || ""))
		.filter(Boolean);

	const hasAssignedTerritory = assignedPath.length > 0 && (wikiPublicIds.length > 0 || territoryPublicIds.length > 0);

	const displayNameInput = document.getElementById("displayNameInput");
	const alternateCoatInput = document.getElementById("alternateCoatInput");
	const colorInput = document.getElementById("colorInput");
	const startYearInput = document.getElementById("startYearInput");
	const endYearInput = document.getElementById("endYearInput");

	const display = {
		...(value.display || {}),
		name: normalizeText(displayNameInput?.value || value.display?.name || value.display?.displayName || params.get("name") || ""),
		displayName: normalizeText(displayNameInput?.value || value.display?.displayName || value.display?.name || params.get("name") || ""),
		coatOfArmsUrl: normalizeText(alternateCoatInput?.value || value.display?.coatOfArmsUrl || ""),
		zoomMin: parseOptionalNumber(els.zoomFromInput?.value, value.display?.zoomMin ?? parseOptionalNumber(params.get("min_zoom"))),
		zoomMax: parseOptionalNumber(els.zoomToInput?.value, value.display?.zoomMax ?? parseOptionalNumber(params.get("max_zoom"))),
		color: normalizeHexColor(colorInput?.value || value.display?.color || params.get("color"))
			|| (droppedNode ? createAutoTerritoryColor(droppedNode) : "#888888"),
		opacity: parseOptionalNumber(
			transparencyInput?.value,
			Math.round((value.display?.opacity ?? parseOptionalNumber(params.get("opacity"), 0.33)) * 100)
		) / 100
	};

	const rawEndYear = normalizeText(endYearInput?.value || "");
	const isOpenEnded = Boolean(existsUntilTodayInput?.checked) || rawEndYear === "";

	const validity = {
		...(value.validity || {}),
		startYear: parseOptionalNumber(startYearInput?.value, value.validity?.startYear ?? parseOptionalNumber(params.get("valid_from_bf"))),
		endYear: isOpenEnded ? null : parseOptionalNumber(rawEndYear),
		existsUntilToday: isOpenEnded
	};

	const response = await fetch(moduleOptions.saveUrl || WRITE_API_URL, {
		method: "PATCH",
		credentials: "same-origin",
		headers: {
			"Content-Type": "application/json",
			"Accept": "application/json"
		},
		body: JSON.stringify({
			action: "save_geometry_assignment",
			geometry_public_id: geometryPublicId,
			display_only: !hasAssignedTerritory,
			display: {
				name: display.name || display.displayName || "",
				displayName: display.displayName || display.name || "",
				coatOfArmsUrl: display.coatOfArmsUrl || "",
				zoomMin: display.zoomMin,
				zoomMax: display.zoomMax,
				color: normalizeHexColor(display.color) || "#888888",
				opacity: display.opacity,
			},
			validity: {
				startYear: validity.startYear,
				endYear: validity.endYear,
				existsUntilToday: validity.existsUntilToday,
			},
			wiki_public_ids: wikiPublicIds,
			territory_public_ids: territoryPublicIds,
			wiki_nodes: assignedPath.map((node, index) => {
				const display = displays[index] || {};
				return {
					key: wikiPublicIds[index] || node.wikiKey || node.territoryPublicId || node.id || node.key || node.label || "",
					territoryPublicId: node.territoryPublicId || "",
					territoryId: node.territoryId || null,
					name: display.displayName || node.label || node.key || "",
					type: node.kind || "Herrschaftsgebiet",
					status: "",
					coat_of_arms_url: display.coatOfArmsUrl || "",
					wiki_url: ""
				};
			}),
			assignment: value
		})
	});

	let result = null;

	try {
		result = await response.json();
	} catch (error) {
		result = { ok: response.ok };
	}

	if (!response.ok || result?.ok === false) {
		throw new Error(result?.error || `Speichern fehlgeschlagen: HTTP ${response.status}`);
	}

	return result;
}

function handleCancel() {
	if (typeof moduleOptions.onCancel === "function") {
		moduleOptions.onCancel(getAssignmentValue());
		return;
	}

	clearSelection();
	setFormStatus("Abgebrochen.", "pending");
}

function setFormStatus(message, type = "pending") {
	const formStatusInput = document.getElementById("formStatusInput");

	if (formStatusInput) {
		formStatusInput.value = message;
		formStatusInput.dataset.status = type;
	}

	if (typeof moduleOptions.onStatusChange === "function") {
		moduleOptions.onStatusChange(message, type);
	}
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
		path: getNodePath(node).map(pathNode => pathNode.label),
		pathKeys: getNodePath(node).map(pathNode => pathNode.row?.wiki_key || pathNode.row?.public_id || pathNode.id || makeKey(pathNode.label))
	};
}

function parseOptionalNumber(value, fallback = null) {
	if (value === "" || value === null || typeof value === "undefined") {
		return fallback;
	}

	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function setInputValue(id, value) {
	const input = document.getElementById(id);

	if (!input || value === null || typeof value === "undefined") {
		return;
	}

	input.value = String(value);
}

window.AvesmapsPoliticalTerritoryAssignment = {
	version: MODULE_VERSION,
	init,
	configure,
	load: loadData,
	reload: loadData,
	getValue: getAssignmentValue,
	setValue: setAssignmentValue,
	setSelectedTerritory,
	clearSelection,
	save: handleSave,
	setStatus: setFormStatus,
	normalizeRow: row => normalizeApiRows([row])[0] || null,
	buildTree: buildTerritoryTree
};

"use strict";

(function initPoliticalTerritoryEditorEmbeddedModule() {

		const API_URL = "/api/app/political-territory-wiki.php";
		// Tree-Daten kommen aus dem Sync-Monitor-Modell (parent_wiki_key -> affiliation_path),
		// NICHT mehr aus dem alten flachen Wiki-Spiegel. (API_URL bleibt fuer das Drag-Payload.)
		const TREE_API_URL = "/api/edit/wiki/sync-monitor.php?action=model_tree";
		const WRITE_API_URL = "/api/app/political-territories.php?debug_errors=1";
		
		const MODULE_VERSION = "2026-05-16-module-save-api";
		const wikiTreeComponent = window.AvesmapsPoliticalTerritoryWikiTree || null;

		// Eingabeparameter ueber die Kontext-Abstraktion lesen (iframe -> URL-Query,
		// inline -> gesetztes Kontext-Objekt). Liefert ein URLSearchParams-aehnliches
		// Objekt mit .get(), damit die bestehenden Aufrufstellen unveraendert bleiben.
		function editorParams() {
			return {
				get(key) {
					return window.AvesmapsEditorContext?.param?.(key, null) ?? null;
				},
			};
		}

		const DISPLAY_SUFFIXES = [
			"Staat",
			"Imperium",
			"Reich",
			"Kalifat"
		];

		if (editorParams().get("embedded") === "1") {
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
			onTerritoryDrop: null,
			onAssignmentLoaded: null
		};
		let initialized = false;
		let pendingValue = null;
		let lastLoadedAssignmentInfo = null;

		let allRows = [];
		let defaultModelViewApplied = false;
		let currentTree = null;
		let selectedNode = null;
		let droppedNode = null;
		let editedNode = null;
		let displayStateByNodeId = new Map();
		let nodeRegistry = new Map();
		const inheritColorVarianceButtonElement = document.getElementById("inheritColorVarianceButton");
		const inheritOpacityButtonElement = ensureInheritOpacityButton(inheritColorVarianceButtonElement);

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
			manualEditPath: document.getElementById("manualEditPath"),
			infoBox: document.getElementById("infoBox"),
			detailInfo: document.getElementById("detailInfo"),
			zoomFromInput: document.getElementById("zoomFromInput"),
			zoomToInput: document.getElementById("zoomToInput"),
			displayNameInput: document.getElementById("displayNameInput"),
			alternateCoatInput: document.getElementById("alternateCoatInput"),
			manualCoatPreview: document.getElementById("manualCoatPreview"),
			updateCoatButton: document.getElementById("updateCoatButton"),
			inheritColorVarianceButton: inheritColorVarianceButtonElement,
			inheritOpacityButton: inheritOpacityButtonElement,
			geometryDatabaseInfo: document.getElementById("geometryDatabaseInfo"),
			treeTimeFrom: document.getElementById("treeTimeFrom"),
			treeTimeTo: document.getElementById("treeTimeTo"),
			treeTimeToday: document.getElementById("treeTimeToday")
		};

		function ensureInheritOpacityButton(referenceButton) {
			const existingButton = document.getElementById("inheritOpacityButton");
			if (existingButton) {
				return existingButton;
			}
			if (!(referenceButton instanceof HTMLElement)) {
				return null;
			}

			const button = document.createElement("button");
			button.id = "inheritOpacityButton";
			button.type = "button";
			button.className = referenceButton.className || "secondary";
			button.textContent = "Transparenz vererben";
			button.hidden = referenceButton.hidden;
			referenceButton.insertAdjacentElement("afterend", button);
			return button;
		}

		if (els.reloadButton) {
			els.reloadButton.addEventListener("click", loadData);
		}

		els.searchInput.addEventListener("input", render);
		els.continentFilter.addEventListener("change", render);
		els.typeFilter.addEventListener("change", render);
		els.statusFilter.addEventListener("change", render);
		if (els.treeTimeFrom) els.treeTimeFrom.addEventListener("input", render);
		if (els.treeTimeTo) els.treeTimeTo.addEventListener("input", render);
		if (els.treeTimeToday) els.treeTimeToday.addEventListener("change", () => {
			const today = els.treeTimeToday.checked;
			if (els.treeTimeFrom) els.treeTimeFrom.disabled = today;
			if (els.treeTimeTo) els.treeTimeTo.disabled = today;
			render();
		});

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

		if (els.inheritColorVarianceButton) {
			els.inheritColorVarianceButton.addEventListener("click", inheritColorVarianceToDescendants);
		}

		if (els.inheritOpacityButton) {
			els.inheritOpacityButton.addEventListener("click", inheritOpacityToDescendants);
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
				const response = await fetch(TREE_API_URL, {
					method: "GET",
					credentials: "same-origin",
					headers: {
						"Accept": "application/json"
					}
				});

				const payload = await response.json();

				if (!response.ok || !payload.ok) {
					throw new Error(payload.error || `HTTP ${response.status}`);
				}

				allRows = normalizeApiRows(payload.nodes || payload.items || []);
				setStatus("Fertig");
				updateFilters();
				// Default-Modellansicht wie Sync-Monitor: Kontinent Aventurien (einmalig, danach frei waehlbar).
				if (!defaultModelViewApplied) {
					defaultModelViewApplied = true;
					if ([...els.continentFilter.options].some((option) => option.value === "Aventurien")) {
						els.continentFilter.value = "Aventurien";
					}
				}
				render();

				try {
					try{var _a=allRows.find(function(r){return /baronie-albumin/i.test(r.wiki_key||"");});var _tm=window.AvesmapsPoliticalTerritoryWikiTree;var _tf=(_tm&&_tm.readTimeFilter)?_tm.readTimeFilter(els.treeTimeFrom,els.treeTimeTo,els.treeTimeToday):null;var _m=(_a&&_tm&&_tm.doesRowMatchTimeFilter)?_tm.doesRowMatchTimeFilter(_a,_tf):null;var _inReg=false;for(var _n of nodeRegistry.values()){if(_n.row&&/baronie-albumin/i.test(_n.row.wiki_key||"")){_inReg=true;break;}}console.log("ARROWDBG row",_a?{name:_a.name,continent:_a.continent,ds_start:_a.dissolved_start_bf,ds_end:_a.dissolved_end_bf,ds_disp:_a.dissolved_display_bf,f_start:_a.founded_start_bf}:"NOT IN allRows","timeFilter",_tf,"matchesTime",_m,"inNodeRegistry",_inReg,"allRows",allRows.length,"regSize",nodeRegistry.size);}catch(_e){console.log("ARROWDBG err",_e);}
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
					// Effektiv = Override ?? Staging: Wiki-Sync-Overrides (metadata_overrides_json) ueber die
					// Staging-Felder legen, sonst nutzt der Editor-Baum rohe Staging-Werte -> via Override auf
					// "besteht" gesetzte Knoten werden bei time=heute ausgefiltert -> fehlen in der nodeRegistry
					// -> setSelectedTerritory findet sie nicht -> Fallback-Breadcrumb ohne Geschwisterpfeile.
					const ovr = (row && row.overrides && typeof row.overrides === "object" && !Array.isArray(row.overrides)) ? row.overrides : {};
					row = Object.assign({}, row, ovr);
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
						founded_start_bf: parseOptionalNumber(row.founded_start_bf, null),
						founded_end_bf: parseOptionalNumber(row.founded_end_bf, null),
						founded_display_bf: parseOptionalNumber(row.founded_start_bf, null),
						dissolved_start_bf: parseOptionalNumber(row.dissolved_start_bf, null),
						dissolved_end_bf: parseOptionalNumber(row.dissolved_end_bf, null),
						dissolved_display_bf: parseOptionalNumber(row.dissolved_end_bf, null),
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

			const params = editorParams();
			const geometryPublicId = normalizeText(params.get("geometry_public_id") || "");

			if (!geometryPublicId) {
				notifyAssignmentLoaded();
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
				notifyAssignmentLoaded(payload);
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

			notifyAssignmentLoaded(payload);
		}
		
		function readAssignmentDisplaysFromGeometryStyle(style = {}) {
			if (!style || typeof style !== "object") {
				return [];
			}

			if (Array.isArray(style.assignmentDisplays)) {
				return style.assignmentDisplays;
			}

			if (Array.isArray(style.assignment_displays)) {
				return style.assignment_displays;
			}

			return [];
		}

		function buildLoadedAssignmentInfo(payload = null) {
			const params = editorParams();
			const geometry = payload?.geometry && typeof payload.geometry === "object"
				? payload.geometry
				: null;
			const geometryPublicId = normalizeText(
				geometry?.publicId
				|| geometry?.public_id
				|| params.get("geometry_public_id")
				|| ""
			);
			const style = geometry?.style && typeof geometry.style === "object"
				? geometry.style
				: {};
			const assignmentDisplays = readAssignmentDisplaysFromGeometryStyle(style)
				.filter((display) => display && typeof display === "object");

			return {
				geometryPublicId,
				hasLocalAssignmentDisplays: assignmentDisplays.length > 0,
				assignmentDisplayCount: assignmentDisplays.length,
				payload
			};
		}

		function notifyAssignmentLoaded(payload = null) {
			const assignmentInfo = buildLoadedAssignmentInfo(payload);
			lastLoadedAssignmentInfo = assignmentInfo;

			if (typeof moduleOptions.onAssignmentLoaded !== "function") {
				return;
			}

			try {
				moduleOptions.onAssignmentLoaded(assignmentInfo);
			} catch (error) {
				console.warn("onAssignmentLoaded-Callback fehlgeschlagen:", error);
			}
		}
		function updateGeometryDatabaseInfo(geometry = null) {
			const params = editorParams();
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
				: "Keine Geometrie zugewiesen";
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
			els.treeInfo.textContent = `${rowCount} Knoten · ${root.children.length} Wurzelknoten`;
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
			name.textContent = node.label;
			item.appendChild(name);
			const metaInfo = buildTreeItemMetaInfo(node);
			if (metaInfo.text || metaInfo.wikiUrl) {
				const meta = document.createElement("span");
				meta.className = "tree-item-meta";

				if (metaInfo.text) {
					const metaText = document.createElement("span");
					metaText.textContent = metaInfo.text;
					meta.appendChild(metaText);
				}

				if (metaInfo.wikiUrl) {
					if (metaInfo.text) {
						const separator = document.createElement("span");
						separator.textContent = ", ";
						meta.appendChild(separator);
					}

					const wikiLink = document.createElement("a");
					wikiLink.href = metaInfo.wikiUrl;
					wikiLink.target = "_blank";
					wikiLink.rel = "noopener";
					wikiLink.textContent = "Wiki";
					wikiLink.addEventListener("click", event => event.stopPropagation());
					meta.appendChild(wikiLink);
				}

				item.appendChild(meta);
			}

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

		function getTreeMapStatus(node) {
			const status = getTreeCoverageStatus(node);

			if (status.kind === "all") {
				return {
					kind: "all",
					label: status.ownAssigned
						? "Gebiet und Untergebiete sind auf der Karte vorhanden"
						: "Alle Untergebiete sind auf der Karte vorhanden"
				};
			}

			if (status.kind === "own-only") {
				return {
					kind: "own-only",
					label: "Gebiet ist auf der Karte vorhanden, Untergebiete fehlen oder sind nicht vollständig"
				};
			}

			if (status.kind === "children-only") {
				return {
					kind: "children-only",
					label: "Gebiet ist indirekt durch Untergebiete auf der Karte vorhanden, Untergebiete fehlen oder sind nicht vollständig"
				};
			}

			return {
				kind: "none",
				label: "Gebiet und Untergebiete fehlen auf der Karte"
			};
		}

		function getTreeCoverageStatus(node) {
			const ownAssigned = isTreeNodeAssignedToMap(node);
			const children = Array.isArray(node?.children) ? node.children : [];

			if (children.length === 0) {
				return {
					kind: ownAssigned ? "all" : "none",
					ownAssigned,
					hasAnyCoverage: ownAssigned,
					isComplete: ownAssigned
				};
			}

			const childStatuses = children.map(getTreeCoverageStatus);
			const hasAnyChildCoverage = childStatuses.some(status => status.hasAnyCoverage);
			const allChildrenComplete = childStatuses.every(status => status.isComplete);
			const hasAnyCoverage = ownAssigned || hasAnyChildCoverage;

			if (ownAssigned && allChildrenComplete) {
				return {
					kind: "all",
					ownAssigned,
					hasAnyCoverage,
					isComplete: true
				};
			}

			if (ownAssigned) {
				return {
					kind: "own-only",
					ownAssigned,
					hasAnyCoverage,
					isComplete: false
				};
			}

			if (hasAnyChildCoverage && allChildrenComplete) {
				return {
					kind: "all",
					ownAssigned,
					hasAnyCoverage,
					isComplete: true
				};
			}

			if (hasAnyChildCoverage) {
				return {
					kind: "children-only",
					ownAssigned,
					hasAnyCoverage,
					isComplete: false
				};
			}

			return {
				kind: "none",
				ownAssigned,
				hasAnyCoverage: false,
				isComplete: false
			};
		}

		function isTreeNodeAssignedToMap(node) {
			return Boolean(node?.row?.map_assigned) || Number(node?.row?.map_geometry_count || 0) > 0;
		}

		function showNodeDetails(node, options = {}) {
			selectedNode = node;
			// Aktiven Knoten SOFORT in den beobachtbaren Store publizieren (Funnel aller
			// Selektionswechsel: Tree-Klick, Breadcrumb-Sprung, Geschwister-Blaettern).
			// Ersetzt das Warten auf den asynchronen ui-hints-MutationObserver -> der
			// Karten-Fokus (Host) bekommt den gewaehlten Knoten verlaesslich & synchron.
			try { window.AvesmapsEditorActiveNode?.set?.(createNodeReference(node)); } catch (error) { /* Store ist optional. */ }

			for (const element of els.treeView.querySelectorAll(".tree-item.selected")) {
				element.classList.remove("selected");
			}

			const selectedElement = els.treeView.querySelector(`.tree-item[data-node-id="${cssEscape(node.id)}"]`);

			if (selectedElement) {
				selectedElement.classList.add("selected");
			}

			// Den selektierten Knoten im Baum SICHTBAR machen: eingeklappte
			// Vorfahren aufklappen + ins Sichtfeld scrollen. Gilt einheitlich fuer
			// Tree-Klick, Breadcrumb-Sprung und Pfeil-Cycling. Defensiv gekapselt,
			// damit nichts bricht, falls die Tree-Komponente fehlt.
			// Bei Breadcrumb-Navigation (scrollTreeIntoView=false) NUR die Vorfahren
			// aufklappen, damit der Baum den Knoten zeigt, aber den Editor NICHT
			// automatisch dorthin scrollen (sonst springt die Ansicht auf den Baum).
			try {
				if (options.scrollTreeIntoView === false) {
					const item = els.treeView.querySelector(`.tree-item[data-node-id="${cssEscape(node.id)}"]`);
					let ancestor = item ? item.parentElement : null;
					while (ancestor && ancestor !== els.treeView) {
						if (ancestor.tagName === "DETAILS") ancestor.open = true;
						ancestor = ancestor.parentElement;
					}
				} else if (wikiTreeComponent && typeof wikiTreeComponent.revealNode === "function") {
					wikiTreeComponent.revealNode(els.treeView, node.id);
				}
			} catch (error) { /* Reveal ist optional. */ }

			renderInfoBox(node);

			// Geometrie-Statuszeile pro aktivem Wiki-Knoten aktualisieren: bei Knoten
			// mit Geometrie die DB-Info (aus URL-Params der geoeffneten Geometrie),
			// sonst den Hinweis "Keine Geometrie zugewiesen".
			try {
				if (isTreeNodeAssignedToMap(node)) {
					updateGeometryDatabaseInfo();
				} else if (els.geometryDatabaseInfo) {
					els.geometryDatabaseInfo.textContent = "Keine Geometrie zugewiesen";
				}
			} catch (error) { /* Statuszeile ist optional. */ }
		}

		function renderDropZone() {
			const unassignButton = document.getElementById("unassignButton");

			if (unassignButton) {
				unassignButton.hidden = !droppedNode;
			}
			els.dropZone.innerHTML = "";

			const title = document.createElement("div");
			title.className = "drop-zone-title";
			title.textContent = "Herrschaftsgebiet aus dem Wiki hier mit Drag'n'drop zuweisen";
			els.dropZone.appendChild(title);

			if (!droppedNode) {
				els.dropZone.classList.remove("has-node");
				return;
			}

			els.dropZone.classList.add("has-node");

			const card = document.createElement("div");
			card.className = "dropped-node";
			card.draggable = true;
			card.dataset.nodeId = droppedNode.id;

			const text = document.createElement("div");

			const name = document.createElement("div");
			name.className = "dropped-node-name";
			name.textContent = droppedNode.label;
			text.appendChild(name);

			const kind = document.createElement("div");
			kind.className = "dropped-node-kind";
			kind.textContent = droppedNode.row ? "Wiki-/SQL-Datensatz" : "Abgeleiteter Gruppenknoten";
			text.appendChild(kind);

			const handle = document.createElement("span");
			handle.className = "drag-handle";
			handle.textContent = "⠿";

			card.appendChild(text);
			card.appendChild(handle);

			card.addEventListener("click", () => selectNode(droppedNode));
			card.addEventListener("dragstart", event => {
				if (wikiTreeComponent && typeof wikiTreeComponent.applyDragData === "function") {
					wikiTreeComponent.applyDragData(event, droppedNode);
					return;
				}

				event.dataTransfer.setData("text/plain", droppedNode.id);
				event.dataTransfer.effectAllowed = "copy";
			});

			els.dropZone.appendChild(card);
		}

		function selectNode(node) {
			const path = getNodePath(node);
			const activeIndex = Math.max(0, path.length - 1);

			editedNode = path[activeIndex] || node;
			renderManualEditPath(node, activeIndex);
			applyDisplayStateToForm(getDisplayStateForNode(editedNode));
			updateInheritColorVarianceButtonVisibility();
			showNodeDetails(editedNode || node);
		}

		function applyZoomPresetForBreadcrumb(path, activeIndex) {
			const preset = getZoomPreset(path.length, activeIndex);

			if (!preset || !els.zoomFromInput || !els.zoomToInput) {
				return;
			}

			els.zoomFromInput.value = String(preset.from);
			els.zoomToInput.value = String(preset.to);
		}

		function getZoomPreset(pathLength, index) {
			const presets = {
				1: [[0, 6]],
				2: [[0, 2], [3, 6]],
				3: [[0, 2], [3, 4], [5, 6]],
				4: [[0, 2], [3, 4], [5, 5], [6, 6]],
				5: [[0, 2], [3, 3], [4, 4], [5, 5], [6, 6]]
			};

			const normalizedLength = Math.max(1, Math.min(5, pathLength));
			const normalizedIndex = Math.max(0, Math.min(index, normalizedLength - 1));
			const [from, to] = presets[normalizedLength][normalizedIndex];

			return { from, to };
		}

		function createAutoTerritoryColor(node) {
			const path = node ? getNodePath(node) : [];
			const rootNode = path[0] || node;
			const depth = Math.max(0, path.length - 1);
			const rootSeed = hashString(rootNode?.row?.wiki_key || rootNode?.id || rootNode?.label || "Herrschaftsgebiet");
			const nodeSeed = hashString(node?.row?.wiki_key || node?.id || node?.label || "Herrschaftsgebiet");
			const baseHue = rootSeed % 360;
			const hueOffset = depth === 0 ? 0 : ((nodeSeed % 37) - 18) + (depth * 4);
			const hue = (baseHue + hueOffset + 360) % 360;
			const saturation = clampNumber(58 + (rootSeed % 18) - Math.min(depth * 3, 12), 44, 74);
			const value = clampNumber(54 + (nodeSeed % 18) + Math.min(depth * 3, 10), 48, 78);

			return hsvToHex(hue, saturation, value);
		}

		function hashString(value) {
			const text = String(value || "");
			let hash = 2166136261;

			for (let index = 0; index < text.length; index += 1) {
				hash ^= text.charCodeAt(index);
				hash = Math.imul(hash, 16777619);
			}

			return hash >>> 0;
		}

		function hsvToHex(hue, saturationPercent, valuePercent) {
			const saturation = clampNumber(saturationPercent, 0, 100) / 100;
			const value = clampNumber(valuePercent, 0, 100) / 100;
			const chroma = value * saturation;
			const huePrime = (clampNumber(hue, 0, 360) % 360) / 60;
			const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
			const match = value - chroma;
			const [red, green, blue] = huePrime < 1
				? [chroma, secondary, 0]
				: huePrime < 2
				? [secondary, chroma, 0]
				: huePrime < 3
				? [0, chroma, secondary]
				: huePrime < 4
				? [0, secondary, chroma]
				: huePrime < 5
				? [secondary, 0, chroma]
				: [chroma, 0, secondary];

			return `#${[red, green, blue].map(channel => toHexByte((channel + match) * 255)).join("")}`;
		}

		function toHexByte(value) {
			return Math.round(clampNumber(value, 0, 255)).toString(16).padStart(2, "0");
		}

		function clampNumber(value, min, max) {
			const number = Number(value);
			if (!Number.isFinite(number)) {
				return min;
			}

			return Math.max(min, Math.min(max, number));
		}

		function normalizeHexColor(value) {
			const color = normalizeText(value);
			return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "";
		}

		function createColorVariantFromParent(parentColor) {
			const parentRgb = parseHexToRgb(parentColor);

			if (!parentRgb) {
				return normalizeHexColor(parentColor) || "#888888";
			}

			const parentHsv = rgbToHsv(parentRgb.red, parentRgb.green, parentRgb.blue);
			const hueOffset = randomBetween(-14, 14);
			const saturationOffset = randomBetween(-4, 4);
			const valueOffset = randomBetween(-4, 4);
			const hue = modulo(parentHsv.hue + hueOffset, 360);
			const saturation = clampNumber(parentHsv.saturation + saturationOffset, 0, 100);
			const value = clampNumber(parentHsv.value + valueOffset, 0, 100);
			return hsvToHex(hue, saturation, value);
		}

		function parseHexToRgb(color) {
			const normalized = normalizeHexColor(color);

			if (!normalized) {
				return null;
			}

			return {
				red: Number.parseInt(normalized.slice(1, 3), 16),
				green: Number.parseInt(normalized.slice(3, 5), 16),
				blue: Number.parseInt(normalized.slice(5, 7), 16)
			};
		}

		function rgbToHsv(red, green, blue) {
			const redChannel = clampNumber(red, 0, 255) / 255;
			const greenChannel = clampNumber(green, 0, 255) / 255;
			const blueChannel = clampNumber(blue, 0, 255) / 255;
			const maxChannel = Math.max(redChannel, greenChannel, blueChannel);
			const minChannel = Math.min(redChannel, greenChannel, blueChannel);
			const delta = maxChannel - minChannel;
			let hue = 0;

			if (delta > 0) {
				if (maxChannel === redChannel) {
					hue = ((greenChannel - blueChannel) / delta) % 6;
				} else if (maxChannel === greenChannel) {
					hue = ((blueChannel - redChannel) / delta) + 2;
				} else {
					hue = ((redChannel - greenChannel) / delta) + 4;
				}
			}

			return {
				hue: modulo(hue * 60, 360),
				saturation: maxChannel === 0 ? 0 : (delta / maxChannel) * 100,
				value: maxChannel * 100
			};
		}

		function randomBetween(min, max) {
			return (Math.random() * (max - min)) + min;
		}

		function modulo(value, divisor) {
			const result = value % divisor;
			return result < 0 ? result + divisor : result;
		}

		function renderManualEditPath(node, activeIndex = null) {
			els.manualEditPath.innerHTML = "";

			if (!node) {
				const emptyHint = document.createElement("span");
				emptyHint.className = "breadcrumb-empty";
				emptyHint.textContent = "Kein Knoten zugewiesen";
				els.manualEditPath.appendChild(emptyHint);
				updateInheritColorVarianceButtonVisibility();
				return;
			}

			const path = getNodePath(node);
			const currentIndex = Number.isInteger(activeIndex) ? activeIndex : path.length - 1;

			for (let i = 0; i < path.length; i++) {
				const segment = document.createElement("span");
				segment.className = "breadcrumb-segment";

				const siblings = (path[i] && path[i].parent && Array.isArray(path[i].parent.children))
					? path[i].parent.children
					: [];

				if (siblings.length > 1) {
					const prevButton = document.createElement("button");
					prevButton.type = "button";
					prevButton.className = "breadcrumb-cycle breadcrumb-cycle--prev";
					prevButton.textContent = "▲";
					prevButton.title = "Vorheriges Geschwister";
					prevButton.setAttribute("aria-label", "Vorheriges Geschwister");
					prevButton.addEventListener("click", () => cycleBreadcrumbSegment(path, i, -1));
					segment.appendChild(prevButton);
				}

				const item = document.createElement("button");
				item.type = "button";
				item.className = "breadcrumb-label";
				item.classList.toggle("is-active", i === currentIndex);
				item.textContent = path[i].label;
				item.addEventListener("click", () => selectManualBreadcrumbNode(node, path, i));
				segment.appendChild(item);

				if (siblings.length > 1) {
					const nextButton = document.createElement("button");
					nextButton.type = "button";
					nextButton.className = "breadcrumb-cycle breadcrumb-cycle--next";
					nextButton.textContent = "▼";
					nextButton.title = "Nächstes Geschwister";
					nextButton.setAttribute("aria-label", "Nächstes Geschwister");
					nextButton.addEventListener("click", () => cycleBreadcrumbSegment(path, i, 1));
					segment.appendChild(nextButton);
				}

				els.manualEditPath.appendChild(segment);

				if (i < path.length - 1) {
					const separator = document.createElement("span");
					separator.className = "separator";
					separator.textContent = "›";
					els.manualEditPath.appendChild(separator);
				}
			}

			updateInheritColorVarianceButtonVisibility();
		}

		function selectManualBreadcrumbNode(rootNode, path, activeIndex) {
			saveCurrentDisplayState();
			editedNode = path[activeIndex] || rootNode;
			renderManualEditPath(rootNode, activeIndex);
			applyDisplayStateToForm(getDisplayStateForNode(editedNode));
			updateInheritColorVarianceButtonVisibility();
			// Breadcrumb-Navigation: Baum aktualisieren, aber Editor nicht auto-scrollen.
			showNodeDetails(editedNode, { scrollTreeIntoView: false });
		}

		function descendToFirstLeaf(node) {
			let current = node;
			while (current && Array.isArray(current.children) && current.children.length > 0) {
				current = current.children[0];
			}
			return current;
		}

		// Feature #1: ein Breadcrumb-Segment durch seine Wiki-Geschwister (gleiche
		// Ebene, gleicher Eltern-Knoten) zirkulaer durchwechseln. Der gewaehlte
		// Knoten wird aktiv; der Pfad fuellt sich darunter ueber das jeweils erste
		// Kind bis zum Blatt. Reine Wiki-Affiliations-Navigation (keine Zuweisung).
		function cycleBreadcrumbSegment(path, index, direction) {
			const segmentNode = path[index];
			if (!segmentNode || !segmentNode.parent) return;
			const siblings = Array.isArray(segmentNode.parent.children) ? segmentNode.parent.children : [];
			if (siblings.length <= 1) return;
			const currentPos = siblings.indexOf(segmentNode);
			if (currentPos < 0) return;
			const nextPos = (currentPos + direction + siblings.length) % siblings.length;
			const sibling = siblings[nextPos];
			if (!sibling) return;
			const leaf = descendToFirstLeaf(sibling);
			selectManualBreadcrumbNode(leaf, getNodePath(leaf), index);
		}

		function updateInheritColorVarianceButtonVisibility() {
			const path = droppedNode ? getNodePath(droppedNode) : [];
			const currentIndex = editedNode ? path.findIndex(node => node.id === editedNode.id) : -1;
			const hasDescendantsInAssignedPath = currentIndex >= 0 && currentIndex < path.length - 1;
			if (els.inheritColorVarianceButton) {
				els.inheritColorVarianceButton.hidden = !hasDescendantsInAssignedPath;
			}
			if (els.inheritOpacityButton) {
				els.inheritOpacityButton.hidden = !hasDescendantsInAssignedPath;
			}
		}

		function inheritColorVarianceToDescendants() {
			if (window.AvesmapsPoliticalTerritorySubtreeDisplayTools?.handlesInheritanceButtons === true) {
				return;
			}

			if (!editedNode || !droppedNode) {
				return;
			}

			saveCurrentDisplayState();

			const path = getNodePath(droppedNode);
			const currentIndex = path.findIndex(node => node.id === editedNode.id);

			if (currentIndex < 0 || currentIndex >= path.length - 1) {
				updateInheritColorVarianceButtonVisibility();
				return;
			}

			let parentState = getDisplayStateForNode(path[currentIndex]);

			for (let index = currentIndex + 1; index < path.length; index += 1) {
				const childNode = path[index];
				const childState = getDisplayStateForNode(childNode);
				const inheritedState = {
					...childState,
					color: createColorVariantFromParent(parentState.color)
				};
				displayStateByNodeId.set(childNode.id, inheritedState);
				parentState = inheritedState;
			}

			setFormStatus("Farbtonvarianz auf Untergebiete uebertragen.", "success");
		}

		function inheritOpacityToDescendants() {
			if (window.AvesmapsPoliticalTerritorySubtreeDisplayTools?.handlesInheritanceButtons === true) {
				return;
			}

			if (!editedNode || !droppedNode) {
				return;
			}

			saveCurrentDisplayState();

			const path = getNodePath(droppedNode);
			const currentIndex = path.findIndex(node => node.id === editedNode.id);

			if (currentIndex < 0 || currentIndex >= path.length - 1) {
				updateInheritColorVarianceButtonVisibility();
				return;
			}

			let parentState = getDisplayStateForNode(path[currentIndex]);

			for (let index = currentIndex + 1; index < path.length; index += 1) {
				const childNode = path[index];
				const childState = getDisplayStateForNode(childNode);
				const inheritedState = {
					...childState,
					opacity: Number.isFinite(parentState.opacity)
						? clampNumber(parentState.opacity, 0, 1)
						: childState.opacity
				};
				displayStateByNodeId.set(childNode.id, inheritedState);
				parentState = inheritedState;
			}

			setFormStatus("Transparenz auf Untergebiete uebertragen.", "success");
		}

		function populateManualFieldsFromNode(node) {
			if (!node) {
				if (els.displayNameInput) els.displayNameInput.value = "";
				if (els.alternateCoatInput) els.alternateCoatInput.value = "";
				renderManualCoatPreview("");
				return;
			}

			const wikiName = normalizeText(node.row?.name || node.label || "");
			const wikiCoatUrl = normalizeText(node.row?.coat_of_arms_url || "");

			if (els.displayNameInput) {
				els.displayNameInput.value = wikiName;
			}

			if (els.alternateCoatInput) {
				els.alternateCoatInput.value = wikiCoatUrl;
			}

			renderManualCoatPreview(wikiCoatUrl);
		}

		function renderManualCoatPreview(url) {
			if (!els.manualCoatPreview) {
				return;
			}

			els.manualCoatPreview.innerHTML = "";

			if (!url) {
				const placeholder = document.createElement("span");
				placeholder.textContent = "kein Wappen";
				els.manualCoatPreview.appendChild(placeholder);
				return;
			}

			const img = document.createElement("img");
			img.src = url;
			img.alt = "Wappen-Vorschau";
			img.loading = "lazy";
			img.addEventListener("error", () => {
				els.manualCoatPreview.innerHTML = "";
				const placeholder = document.createElement("span");
				placeholder.textContent = "nicht geladen";
				els.manualCoatPreview.appendChild(placeholder);
			});
			els.manualCoatPreview.appendChild(img);
		}

		function getDisplayStateForNode(node) {
			if (!node) {
				return createEmptyDisplayState();
			}

			const existing = displayStateByNodeId.get(node.id);

			if (existing) {
				return existing;
			}

			const state = createDefaultDisplayState(node);
			displayStateByNodeId.set(node.id, state);
			return state;
		}

		function createEmptyDisplayState() {
			return {
				nodeId: "",
				nodeKey: "",
				wikiKey: "",
				rowId: null,
				territoryPublicId: "",
				territoryId: null,
				slug: "",
				name: "",
				displayName: "",
				coatOfArmsUrl: "",
				zoomMin: null,
				zoomMax: null,
				color: "#385d72",
				opacity: 0.33,
				startYear: null,
				endYear: null,
				existsUntilToday: true,
				depth: 0,
				path: [],
				pathKeys: []
			};
		}

		function createDefaultDisplayState(node) {
			const path = getNodePath(node);
			const depth = Math.max(0, path.length - 1);
			const zoomPreset = getZoomPreset(droppedNode ? getNodePath(droppedNode).length : path.length, depth);
			const displayName = normalizeText(node.label || node.row?.name || "");
			const coatOfArmsUrl = normalizeText(node.row?.coat_of_arms_url || "");

			return {
				nodeId: node.id,
				nodeKey: makeKey(node.label),
				wikiKey: node.row?.wiki_key || "",
				rowId: node.row?.id || null,
				territoryPublicId: node.row?.public_id || "",
				territoryId: node.row?.territory_id || null,
				slug: node.row?.slug || "",
				name: node.label,
				displayName,
				coatOfArmsUrl,
				zoomMin: zoomPreset?.from ?? null,
				zoomMax: zoomPreset?.to ?? null,
				color: createAutoTerritoryColor(node),
				opacity: 0.33,
				startYear: parseOptionalNumber(node.row?.founded_start_bf),
				endYear: parseOptionalNumber(node.row?.dissolved_end_bf),
				existsUntilToday: !node.row?.dissolved_text || /besteht|andauernd|heute/i.test(node.row?.dissolved_text || ""),
				depth,
				path: path.map(pathNode => pathNode.label),
				pathKeys: path.map(pathNode => makeKey(pathNode.label)),
				isSynthetic: isSyntheticNode(node),
				kind: node.kind
			};
		}

		function saveCurrentDisplayState() {
			if (!editedNode) {
				return;
			}

			const existing = displayStateByNodeId.get(editedNode.id) || createDefaultDisplayState(editedNode);
			const opacityPercent = parseOptionalNumber(transparencyInput?.value, Math.round((existing.opacity ?? 0.33) * 100));
			const color = normalizeHexColor(document.getElementById("colorInput")?.value)
				|| normalizeHexColor(existing.color)
				|| createAutoTerritoryColor(editedNode);

			displayStateByNodeId.set(editedNode.id, {
				...existing,
				displayName: normalizeText(els.displayNameInput?.value || ""),
				coatOfArmsUrl: normalizeText(els.alternateCoatInput?.value || ""),
				zoomMin: parseOptionalNumber(els.zoomFromInput?.value),
				zoomMax: parseOptionalNumber(els.zoomToInput?.value),
				color,
				opacity: opacityPercent / 100,
				startYear: parseOptionalNumber(document.getElementById("startYearInput")?.value),
				endYear: existsUntilTodayInput?.checked ? null : parseOptionalNumber(endYearInput?.value),
				existsUntilToday: Boolean(existsUntilTodayInput?.checked)
			});
		}

		function applyDisplayStateToForm(state) {
			if (els.displayNameInput) {
				els.displayNameInput.value = state.displayName || state.name || "";
			}

			if (els.alternateCoatInput) {
				els.alternateCoatInput.value = state.coatOfArmsUrl || "";
			}

			if (els.zoomFromInput) {
				els.zoomFromInput.value = state.zoomMin ?? "";
			}

			if (els.zoomToInput) {
				els.zoomToInput.value = state.zoomMax ?? "";
			}

			setInputValue("colorInput", normalizeHexColor(state.color) || (editedNode ? createAutoTerritoryColor(editedNode) : "#385d72"));

			if (transparencyInput) {
				transparencyInput.value = String(Math.round((state.opacity ?? 0.33) * 100));
				syncTransparencyOutput();
			}

			setInputValue("startYearInput", state.startYear);
			setInputValue("endYearInput", state.endYear);

			if (existsUntilTodayInput) {
				existsUntilTodayInput.checked = Boolean(state.existsUntilToday);
				syncEndYearInputState();
			}

			renderManualCoatPreview(state.coatOfArmsUrl || "");
		}

		function getDisplayStatesForDroppedPath() {
			if (!droppedNode) {
				return [];
			}

			return getNodePath(droppedNode).map(node => getDisplayStateForNode(node));
		}

		function renderInfoBox(node) {
			els.infoBox.innerHTML = "";
			els.detailInfo.textContent = node.row ? "Wiki-/SQL-Datensatz" : "Abgeleiteter Gruppenknoten";

			// Phase D: Herkunfts-Badge + Deep-Link „Im Wiki-Sync bearbeiten". Identität (Name, Wappen,
			// Gegründet/Aufgelöst, Status …) ist hier read-only und wird im Wiki-Sync gepflegt.
			const wikiKeyForLink = normalizeText(node.row?.wiki_key || "");
			const originBar = document.createElement("div");
			originBar.className = "info-origin-bar";
			originBar.style.cssText = "display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px";
			const originBadge = document.createElement("span");
			originBadge.className = "info-origin-badge";
			originBadge.style.cssText = "font-size:11px;background:#e8e0d4;color:#6b5a44;border-radius:10px;padding:2px 8px";
			originBadge.textContent = "aus Wiki-Sync (read-only)";
			originBar.appendChild(originBadge);
			if (wikiKeyForLink) {
				const originLink = document.createElement("a");
				originLink.className = "info-origin-link";
				originLink.style.cssText = "font-size:12px;cursor:pointer";
				// Fallback-URL (Mittel-/Strg-Klick oeffnet weiterhin den Tab); normaler Klick oeffnet
				// den Sync-Editor INLINE als Overlay im selben Tab (kein Seitenwechsel).
				originLink.href = `/html/wiki-sync-monitor.html?key=${encodeURIComponent(wikiKeyForLink)}`;
				originLink.target = "_blank";
				originLink.rel = "noopener";
				originLink.textContent = "Im Wiki-Sync bearbeiten ↗";
				originLink.addEventListener("click", (event) => {
					// Modifier-Klicks (neuer Tab/Fenster) der Standardbehandlung ueberlassen.
					if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) {
						return;
					}
					const opener = (typeof window.openAvesmapsSyncEditorOverlay === "function" && window.openAvesmapsSyncEditorOverlay)
						|| (window.parent && typeof window.parent.openAvesmapsSyncEditorOverlay === "function" && window.parent.openAvesmapsSyncEditorOverlay);
					if (opener) {
						event.preventDefault();
						opener(wikiKeyForLink);
					}
				});
				originBar.appendChild(originLink);
			}
			els.infoBox.appendChild(originBar);

			const values = node.row
				? [
					["Wappen", node.row.coat_of_arms_url || "", "coat"],
					["Hierarchie", getNodePath(node).map(pathNode => pathNode.label).join(" > ")],
					// Name/Staatsform/Status/... kommen read-only effektiv (Override ?? Wiki) via appendEffectiveWikiRows
				]
				: [
					["Name", node.label],
					["Status", "unbekannt"],
					["Knotenart", "Abgeleiteter Gruppenknoten"],
					["Hinweis", "Für diesen Knoten wurde kein eigener Wiki-/SQL-Datensatz in der aktuellen Ergebnismenge gefunden."],
					["Hierarchie", getNodePath(node).map(pathNode => pathNode.label).join(" > ")]
				];

			const grid = document.createElement("div");
			grid.className = "info-grid";

			for (const [key, value, type] of values) {
				if (value === "" || value === null || typeof value === "undefined") {
					continue;
				}

				const keyElement = document.createElement("div");
				keyElement.className = "info-key";
				keyElement.textContent = key;
				grid.appendChild(keyElement);

				const valueElement = document.createElement("div");
				valueElement.className = "info-value";

				if (type === "url") {
					const a = document.createElement("a");
					a.href = value;
					a.target = "_blank";
					a.rel = "noopener";
					a.textContent = value;
					valueElement.appendChild(a);
				} else if (type === "coat") {
					const coatUrl = normalizeText(value);
					if (coatUrl) {
						const img = document.createElement("img");
						img.className = "wappen";
						img.dataset.role = "wiki-coat-preview";
						img.src = coatUrl;
						img.alt = `Wappen ${node.label}`;
						img.loading = "lazy";
						valueElement.appendChild(img);

						const link = document.createElement("a");
						link.dataset.role = "wiki-coat-link";
						link.href = coatUrl;
						link.target = "_blank";
						link.rel = "noopener";
						link.textContent = coatUrl;
						valueElement.appendChild(document.createTextNode(" "));
						valueElement.appendChild(link);
					} else {
						valueElement.textContent = "-";
					}
				} else {
					valueElement.textContent = formatInfoValue(value);
				}

				grid.appendChild(valueElement);
			}

			// Tabelle direkt anzeigen (kein "Details"-Accordion mehr).
			els.infoBox.appendChild(grid);
			appendEffectiveWikiRows(node, grid);
		}

		function updateWikiCoatPreviewFromManualInput() {
			const url = normalizeText(els.alternateCoatInput?.value || "");

			renderManualCoatPreview(url);
			const img = els.infoBox.querySelector('[data-role="wiki-coat-preview"]');
			if (img && url) {
				img.src = url;
			}

			const link = els.infoBox.querySelector('[data-role="wiki-coat-link"]');
			if (link && url) {
				link.href = url;
				link.textContent = url;
			}
		}

		function getInfoRows(row) {
			return [
				["Typ", row.type],
				["Zugehörigkeit-Pfad", row.affiliation_path],
				["Herrschaftsform", row.form_of_government],
				["Hauptstadt", row.capital_name],
				["Herrschaftssitz", row.seat_name],
				["Oberhaupt", row.ruler],
				["Sprache", row.language],
				["Währung", row.currency],
				["Handelswaren", row.trade_goods],
				["Einwohnerzahl", row.population],
				["Gründungsdatum", row.founded_text],
				["Gründer", row.founder],
				["Aufgelöst", row.dissolved_text],
				["Geographisch", row.geographic],
				["Politisch", row.political],
				["Handelszone", row.trade_zone],
				["Blasonierung", row.blazon],
				["Wiki-URL", row.wiki_url, "url"]
			];
		}

		const WIKI_DETAIL_FIELDS = [
			["name", "Name"], ["type", "Staatsform"], ["status", "Status"],
			["founded_text", "Gegründet"], ["dissolved_text", "Aufgelöst"],
			["form_of_government", "Herrschaftsform"], ["continent", "Kontinent"],
			["capital_name", "Hauptstadt"], ["seat_name", "Herrschaftssitz"], ["ruler", "Oberhaupt"],
			["language", "Sprache"], ["currency", "Währung"], ["population", "Einwohnerzahl"],
			["founder", "Gründer"], ["political", "Politisch"], ["trade_zone", "Handelszone"],
			["trade_goods", "Handelswaren"], ["geographic", "Geographisch"], ["blazon", "Blasonierung"],
			["affiliation_raw", "Zugehörigkeit"], ["wiki_url", "Wiki-URL", "url"]
		];

		function appendInfoRow(grid, key, value, type) {
			if (value === "" || value === null || typeof value === "undefined") {
				return;
			}
			const keyElement = document.createElement("div");
			keyElement.className = "info-key";
			keyElement.textContent = key;
			grid.appendChild(keyElement);
			const valueElement = document.createElement("div");
			valueElement.className = "info-value";
			if (type === "url") {
				const a = document.createElement("a");
				a.href = value;
				a.target = "_blank";
				a.rel = "noopener";
				a.textContent = value;
				valueElement.appendChild(a);
			} else {
				valueElement.textContent = formatInfoValue(value);
			}
			grid.appendChild(valueElement);
		}

		// Zeigt die effektiven Wiki-Daten (Override ?? Wiki) read-only an - exakt wie der Sync-Monitor.
		// Match bevorzugt per wiki_key (im Editor ist node.row.public_id oft leer), sonst public_id.
		function appendEffectiveWikiRows(node, grid) {
			if (!node || !node.row) {
				return;
			}
			const wikiKey = normalizeText(node.row.wiki_key || "");
			const publicId = normalizeText(node.row.public_id || "");
			const refId = wikiKey || publicId;
			const renderLocalFallback = () => {
				for (const [key, value, type] of getInfoRows(node.row)) {
					appendInfoRow(grid, key, value, type);
				}
			};
			if (!refId) {
				renderLocalFallback();
				return;
			}
			const query = wikiKey
				? `wiki_key=${encodeURIComponent(wikiKey)}`
				: `territory=${encodeURIComponent(publicId)}`;
			const stillSelected = () => (normalizeText(selectedNode?.row?.wiki_key || "") || normalizeText(selectedNode?.row?.public_id || "")) === refId;
			fetch(`/api/app/territory-detail.php?${query}`)
				.then(response => response.json())
				.then(data => {
					if (!stillSelected()) {
						return;
					}
					if (!data || data.ok === false || !data.fields) {
						renderLocalFallback();
						return;
					}
					let any = false;
					for (const [key, label, type] of WIKI_DETAIL_FIELDS) {
						const before = grid.childElementCount;
						appendInfoRow(grid, label, data.fields[key], type);
						if (grid.childElementCount > before) {
							any = true;
						}
					}
					if (!any) {
						renderLocalFallback();
					}
				})
				.catch(() => {
					if (stillSelected()) {
						renderLocalFallback();
					}
				});
		}

		function showEmptyDetails(error = "") {
			selectedNode = null;
			editedNode = null;
			renderManualEditPath(null);
			populateManualFieldsFromNode(null);
			els.detailInfo.textContent = "Noch kein Gebiet ausgewählt.";
			els.infoBox.innerHTML = error
				? `<p class="error">${escapeHtml(error)}</p>`
				: "<p class=\"note\">Ziehen Sie ein Herrschaftsgebiet in die Drop-Zone, um die Wiki-Daten anzuzeigen.</p>";
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

		function getFilteredRows() {
			const search = normalizeText(els.searchInput.value).toLowerCase();
			const continent = els.continentFilter.value;
			const type = els.typeFilter.value;
			const status = normalizeText(els.statusFilter.value).toLowerCase();
			const treeModule = window.AvesmapsPoliticalTerritoryWikiTree;
			const timeFilter = (treeModule && typeof treeModule.readTimeFilter === "function")
				? treeModule.readTimeFilter(els.treeTimeFrom, els.treeTimeTo, els.treeTimeToday)
				: null;

			return allRows.filter(row => {
				if (timeFilter && treeModule && typeof treeModule.doesRowMatchTimeFilter === "function"
					&& !treeModule.doesRowMatchTimeFilter(row, timeFilter)) return false;
				if (continent && row.continent !== continent) return false;
				if (type && row.type !== type) return false;
				if (status) {
					const rowStatus = normalizeText(row.status).toLowerCase();
					const rowStatusTags = Array.isArray(row.status_filter_tags) ? row.status_filter_tags : [];
					if (rowStatus !== status && !rowStatusTags.includes(status)) return false;
				}

				if (!search) return true;

				const haystack = [
					row.name,
					row.type,
					row.continent,
					row.affiliation_raw,
					row.affiliation_root,
					row.affiliation_path.join(" "),
					row.status,
					row.capital_name,
					row.seat_name,
					row.ruler,
					row.geographic,
					row.political
				].join(" ").toLowerCase();

				return haystack.includes(search);
			});
		}

		function updateFilters() {
			fillSelect(els.continentFilter, "Alle Kontinente", uniqueValues(allRows, "continent"));
			fillSelect(els.typeFilter, "Alle Typen", uniqueValues(allRows, "type"));
			fillSelect(els.statusFilter, "Alle Status", uniqueStatusValues(allRows));
		}

		function fillSelect(select, firstLabel, values) {
			const previous = select.value;
			select.innerHTML = "";

			const first = document.createElement("option");
			first.value = "";
			first.textContent = firstLabel;
			select.appendChild(first);

			for (const value of values) {
				const option = document.createElement("option");
				option.value = value;
				option.textContent = value;
				select.appendChild(option);
			}

			if (values.includes(previous)) {
				select.value = previous;
			}
		}

		function uniqueValues(rows, key) {
			return [...new Set(rows.map(row => row[key]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
		}

		function uniqueStatusValues(rows) {
			const valuesByKey = new Map();

			const addValue = (rawValue) => {
				const value = normalizeText(rawValue);
				if (!value) {
					return;
				}

				const key = value.toLowerCase();
				if (!valuesByKey.has(key)) {
					valuesByKey.set(key, value);
				}
			};

			for (const row of rows) {
				addValue(row.status);
				for (const tag of (Array.isArray(row.status_filter_tags) ? row.status_filter_tags : [])) {
					addValue(tag);
				}
			}

			return [...valuesByKey.values()].sort((a, b) => a.localeCompare(b, "de"));
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

			if (typeof moduleOptions.onAssignmentLoaded === "function" && lastLoadedAssignmentInfo) {
				try {
					moduleOptions.onAssignmentLoaded(lastLoadedAssignmentInfo);
				} catch (error) {
					console.warn("onAssignmentLoaded-Callback fehlgeschlagen:", error);
				}
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

			console.log("ARROWDBG assign","identifier",selectedIdentifier,"setSelectedTerritory",selectedFromTree,"regSize",nodeRegistry.size);
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
				const pathNodes = droppedNode ? getNodePath(droppedNode) : [];

				for (const [index, displayState] of value.displays.entries()) {
					const node = findNodeForDisplayState(displayState) || pathNodes[index] || null;

					if (node) {
						displayStateByNodeId.set(node.id, normalizeIncomingDisplayState(node, displayState));
					}
				}

				const explicitActiveNode = value.activeDisplayNode
					? findNodeForDisplayState(value.activeDisplayNode)
					: null;
				const explicitActiveIndex = explicitActiveNode
					? pathNodes.findIndex(pathNode => pathNode.id === explicitActiveNode.id)
					: -1;
				const zoomActiveIndex = findDisplayIndexForCurrentZoom(value.displays);
				// Breadcrumb-Default = geklickte Anzeige-Ebene: das Zoom-Band, das die aktuelle
				// Kartenzoomstufe traegt, gewinnt (z.B. Zoom 0 -> aggregierender Wurzelknoten),
				// nicht der vom Backend gelieferte Geometrie-Besitzer (tiefster Knoten). Der
				// explizite activeDisplayNode greift nur, wenn die Zoomstufe nichts liefert.
				const nextActiveIndex = zoomActiveIndex >= 0 ? zoomActiveIndex : explicitActiveIndex;

				if (nextActiveIndex >= 0 && pathNodes[nextActiveIndex]) {
					editedNode = pathNodes[nextActiveIndex];
					renderManualEditPath(droppedNode, nextActiveIndex);
					applyDisplayStateToForm(getDisplayStateForNode(editedNode));
					updateInheritColorVarianceButtonVisibility();
					showNodeDetails(editedNode);
				} else if (editedNode) {
					applyDisplayStateToForm(getDisplayStateForNode(editedNode));
					showNodeDetails(editedNode);
				}
			}

			renderManualCoatPreview(normalizeText(document.getElementById("alternateCoatInput")?.value || ""));
		}

		function findDisplayIndexForCurrentZoom(displays) {
			const params = editorParams();
			const currentZoom = Number(params.get("current_zoom"));
			if (!Number.isFinite(currentZoom)) {
				return -1;
			}

			return displays.findIndex((display) => {
				const min = parseOptionalNumber(display.zoomMin);
				const max = parseOptionalNumber(display.zoomMax);
				if (min === null && max === null) {
					return false;
				}
				if (min !== null && currentZoom < min) {
					return false;
				}
				if (max !== null && currentZoom > max) {
					return false;
				}
				return true;
			});
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
			const params = editorParams();
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
			const params = editorParams();
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
			const colorInput = document.getElementById("colorInput");

			// Phase D: Wappen + zeitliche Gültigkeit gehören dem Wiki-Sync (Identität). Der Editor
			// schreibt sie NICHT mehr nach political_territory -> diese Schlüssel werden bewusst aus
			// dem Payload weggelassen. Der Server bewahrt dann den Bestandswert (… ?? territory[…]).
			const stripIdentityFields = (entry) => {
				if (!entry || typeof entry !== "object") {
					return entry;
				}
				const { coatOfArmsUrl, startYear, endYear, existsUntilToday, ...rest } = entry;
				return rest;
			};

			const display = {
				...(value.display || {}),
				name: normalizeText(displayNameInput?.value || value.display?.name || value.display?.displayName || params.get("name") || ""),
				displayName: normalizeText(displayNameInput?.value || value.display?.displayName || value.display?.name || params.get("name") || ""),
				zoomMin: parseOptionalNumber(els.zoomFromInput?.value, value.display?.zoomMin ?? parseOptionalNumber(params.get("min_zoom"))),
				zoomMax: parseOptionalNumber(els.zoomToInput?.value, value.display?.zoomMax ?? parseOptionalNumber(params.get("max_zoom"))),
				color: normalizeHexColor(colorInput?.value || value.display?.color || params.get("color"))
					|| (droppedNode ? createAutoTerritoryColor(droppedNode) : "#888888"),
				opacity: parseOptionalNumber(
					transparencyInput?.value,
					Math.round((value.display?.opacity ?? parseOptionalNumber(params.get("opacity"), 0.33)) * 100)
				) / 100
			};

			const sanitizedAssignment = {
				...value,
				display: value.display ? stripIdentityFields(value.display) : value.display,
				displays: Array.isArray(value.displays) ? value.displays.map(stripIdentityFields) : value.displays
			};
			delete sanitizedAssignment.validity;

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
						zoomMin: display.zoomMin,
						zoomMax: display.zoomMax,
						color: normalizeHexColor(display.color) || "#888888",
						opacity: display.opacity,
					},
					wiki_public_ids: wikiPublicIds,
					territory_public_ids: territoryPublicIds,
					wiki_nodes: assignedPath.map((node, index) => {
						const nodeDisplay = displays[index] || {};
						return {
							key: wikiPublicIds[index] || node.wikiKey || node.territoryPublicId || node.id || node.key || node.label || "",
							territoryPublicId: node.territoryPublicId || "",
							territoryId: node.territoryId || null,
							name: nodeDisplay.displayName || node.label || node.key || "",
							type: node.kind || "Herrschaftsgebiet",
							status: "",
							coat_of_arms_url: nodeDisplay.coatOfArmsUrl || "",
							wiki_url: ""
						};
					}),
					assignment: sanitizedAssignment
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
				hasGeometry: isTreeNodeAssignedToMap(node),
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

		function readOptionalYear(row, fields) {
			for (const field of fields) {
				const value = row?.[field];
				if (value === "" || value === null || typeof value === "undefined") {
					continue;
				}

				const number = Number(value);
				if (Number.isFinite(number)) {
					return Math.round(number);
				}
			}

			return null;
		}

		function formatBfYear(year) {
			if (!Number.isFinite(year)) {
				return "";
			}

			return year < 0 ? `${Math.abs(year)} v. BF` : `${year} BF`;
		}

		function buildTerritoryPeriodLabel(row) {
			const startYear = readOptionalYear(row, ["founded_start_bf", "founded_display_bf", "founded_end_bf"]);
			const endYear = readOptionalYear(row, ["dissolved_end_bf", "dissolved_display_bf", "dissolved_start_bf"]);

			if (startYear === null && endYear === null) {
				return "";
			}

			const startText = startYear === null ? "?" : formatBfYear(startYear);
			const endText = endYear === null ? "heute" : formatBfYear(endYear);
			return `${startText} - ${endText}`;
		}

		function buildTreeItemMetaInfo(node) {
			const metaParts = [];
			const periodLabel = buildTerritoryPeriodLabel(node?.row || null);
			if (periodLabel) {
				metaParts.push(periodLabel);
			}

			const rowId = Number(node?.row?.id || 0);
			if (rowId > 0) {
				metaParts.push(`ID ${rowId}`);
			}

			const wikiUrl = normalizeText(node?.row?.wiki_url || "");
			return {
				text: metaParts.join(", "),
				wikiUrl
			};
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

})();

"use strict";

(function initPoliticalTerritoryEditorInheritance() {
	const CHECKBOX_IDS = [
		"inheritZoomToDescendantsCheckbox",
		"inheritColorToDescendantsCheckbox",
		"inheritOpacityToDescendantsCheckbox",
		"inheritOpacityToSubtreeCheckbox",
		"inheritValidityToDescendantsCheckbox"
	];

	// Diese vererben an GESCHWISTER (gleiche Ebene) -> auch für unterste Breadcrumbs/Blaetter sinnvoll.
	const SIBLING_CHECKBOX_IDS = ["inheritZoomToDescendantsCheckbox", "inheritOpacityToDescendantsCheckbox"];
	let territoryRows = [];
	let pendingColorPlan = null;
	// Seed für die ZUFÄLLIGE Zuordnung der Farbtöne zu Geschwistern (statt fester Index-Reihenfolge).
	// Neu gewürfelt bei jedem expliziten "Farbhierarchie erstellen"; sonst stabil (Vorschau springt nicht).
	let colorShuffleSeed = 0;

	// Farbhierarchie: HSV-Abweichung (0-256) pro absolutem Hierarchie-Level. Die Default-Werte
	// werden bei jedem Editor-Aufbau zufaellig aus diesen Bereichen gezogen (tiefer = enger).
	const LEVEL_VARIANCE_RANGES = { 1: [35, 40], 2: [30, 35], 3: [25, 30], 4: [20, 30], 5: [20, 30], 6: [20, 30] };

	function getFormModule() {
		return window.AvesmapsPoliticalTerritoryEditorForm || null;
	}

	function getApiModule() {
		return window.AvesmapsPoliticalTerritoryEditorApi || null;
	}

	function getSavePipeline() {
		return window.AvesmapsPoliticalTerritoryEditorSave || null;
	}

	function getSubtreeService() {
		return window.AvesmapsPoliticalTerritorySubtreeDisplayTools || null;
	}

	function getColorUtils() {
		return window.AvesmapsPoliticalTerritoryEditorColorUtils || null;
	}

	function normalizeText(value) {
		return getFormModule()?.normalizeText?.(value) || String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function makeKey(value) {
		return getFormModule()?.makeKey?.(value) || normalizeText(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
	}

	function escapeHtml(value) {
		return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
	}

	function readAssignmentValue() {
		return getFormModule()?.readAssignmentValue?.() || null;
	}

	function readRootSelection() {
		return getFormModule()?.readRootSelection?.() || null;
	}

	function setStatus(message, type = "pending") {
		getFormModule()?.setStatus?.(message, type);
	}

	function installUi() {
		const colorButton = document.getElementById("inheritColorVarianceButton");
		if (colorButton) {
			colorButton.textContent = "Farbhierarchie erstellen";
			colorButton.addEventListener("click", event => {
				event.preventDefault();
				event.stopImmediatePropagation();
				void createColorPlan(true);
			}, true);
		}

		// #2: Das "Farbhierarchie für alle Unterregionen"-Häkchen ist erst aktiv, NACHDEM eine
		// Farbhierarchie erstellt wurde (pendingColorPlan). Initial deaktiviert.
		const colorDescCbInit = document.getElementById("inheritColorToDescendantsCheckbox");
		if (colorDescCbInit) colorDescCbInit.disabled = true;
		removeOpacityInheritanceButton();
		cleanStrayCheckboxLabelText();
		prefillLevelVarianceDefaults();
		updateLevelVarianceFieldStates();

		document.getElementById("inheritColorToDescendantsCheckbox")?.addEventListener("change", event => {
			if (event.currentTarget.checked) void createColorPlan(false);
			else pendingColorPlan = null;
		});
		document.getElementById("colorInput")?.addEventListener("input", () => {
			if (document.getElementById("inheritColorToDescendantsCheckbox")?.checked) void createColorPlan(false);
		});
		document.addEventListener("click", () => window.setTimeout(syncInheritanceVisibility, 0), true);
		syncInheritanceVisibility();
	}

	function removeOpacityInheritanceButton() {
		document.getElementById("inheritOpacityButton")?.remove();
	}

	function cleanStrayCheckboxLabelText() {
		const checkboxIds = [
			"existsUntilTodayInput",
			"inheritValidityToDescendantsCheckbox"
		];

		for (const checkboxId of checkboxIds) {
			const label = document.getElementById(checkboxId)?.closest("label");
			if (!label) continue;
			for (const node of [...label.childNodes]) {
				if (node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== "") node.remove();
			}
		}
	}

	function syncInheritanceVisibility() {
		const hasLowerBreadcrumb = Boolean(getFormModule()?.hasLowerBreadcrumb?.());
		const hasActiveNode = Boolean(getFormModule()?.readRootSelection?.());
		// (A) Geschwister-Vererbung nur, wenn der aktive Knoten ECHTE Geschwister hat. Signal: sein
		// Breadcrumb-Segment trägt Zyklus-Pfeile (Wurzelreiche haben keine -> dort keine Geschwister).
		const hasActiveSiblings = !!document.querySelector(".breadcrumb-label.is-active")?.closest(".breadcrumb-segment")?.querySelector(".breadcrumb-cycle");
		const colorButton = document.getElementById("inheritColorVarianceButton");
		if (colorButton) colorButton.hidden = !hasLowerBreadcrumb;
		updateLevelVarianceFieldStates();

		for (const id of CHECKBOX_IDS) {
			const input = document.getElementById(id);
			const label = input?.closest(".deferred-subtree-checkbox");
			if (!input || !label) continue;
			const inheritVisible = SIBLING_CHECKBOX_IDS.includes(id) ? (hasActiveNode && hasActiveSiblings) : hasLowerBreadcrumb;
			label.hidden = !inheritVisible;
			if (!inheritVisible) input.checked = false;
		}
		if (!hasLowerBreadcrumb) {
			pendingColorPlan = null;
			const preview = document.getElementById("deferredColorHierarchyPreview");
			if (preview) preview.hidden = true;
		}
		// #2: Häkchen nur aktiv, solange eine Farbhierarchie vorbereitet ist.
		const colorDescCbSync = document.getElementById("inheritColorToDescendantsCheckbox");
		if (colorDescCbSync) colorDescCbSync.disabled = !pendingColorPlan;
	}

	async function loadTerritories() {
		const api = getApiModule();
		if (!api?.loadTerritoryHierarchy) throw new Error("Territory-Editor-API ist nicht geladen.");
		territoryRows = await api.loadTerritoryHierarchy();
		return territoryRows;
	}

	async function createColorPlan(checkCheckbox) {
		const root = readRootSelection();
		if (!root) {
			setStatus("Kein aktives Herrschaftsgebiet ausgewählt.", "error");
			return null;
		}
		await loadTerritories();
		prefillLevelVarianceDefaults();
		// Bei explizitem "Farbhierarchie erstellen" (Button, checkCheckbox=true) neu würfeln; sonst Seed beibehalten
		// (Vorschau-Updates / Speichern verwenden dieselbe Verteilung -> springt nicht).
		if (checkCheckbox || !colorShuffleSeed) {
			colorShuffleSeed = Math.floor(Math.random() * 1000000000) + 1;
		}
		const descendants = findDescendants(root);
		const updates = buildColorUpdates(root, descendants);
		ensureUniqueColors(updates);
		pendingColorPlan = { root, updates };
		const colorDescCbEnable = document.getElementById("inheritColorToDescendantsCheckbox");
		if (colorDescCbEnable) colorDescCbEnable.disabled = false;
		if (checkCheckbox) {
			// ANHAKEN, NICHT TOGGELN: ein erneuter Klick auf "Farbhierarchie erstellen" darf das Häkchen nicht wieder
			// ABwählen -> sonst läuft beim Speichern der Unterregionen-Apply (applyExplicitColorUpdates) nicht und nur
			// das aktive Gebiet wird gefärbt. Nur klicken, wenn noch nicht gesetzt.
			const colorDescCb = document.getElementById("inheritColorToDescendantsCheckbox");
			if (colorDescCb && !colorDescCb.checked) colorDescCb.click();
		}
		renderPreview(pendingColorPlan);
		setStatus(descendants.length > 0 ? `Farbhierarchie vorbereitet: ${descendants.length} Unterregionen.` : "Keine Unterregionen für das aktive Breadcrumb gefunden.", descendants.length > 0 ? "pending" : "error");
		return pendingColorPlan;
	}

	function findDescendants(root) {
		const rootRow = territoryRows.find(row => (root.territoryPublicId && row.publicId === root.territoryPublicId) || (root.territoryId !== null && row.id === root.territoryId) || (root.wikiKey && row.wikiKey === root.wikiKey) || (root.name && makeKey(row.name) === makeKey(root.name))) || null;
		const descendants = [];
		if (rootRow) {
			const byParentId = new Map();
			const byParentPublicId = new Map();
			for (const row of territoryRows) {
				addToMapList(byParentId, row.parentId, row);
				addToMapList(byParentPublicId, row.parentPublicId, row);
			}
			const stack = [...(byParentId.get(rootRow.id) || []), ...(byParentPublicId.get(rootRow.publicId) || [])].map(row => ({ row, depth: 1 }));
			const visited = new Set();
			while (stack.length) {
				const current = stack.pop();
				const key = current.row.publicId || current.row.id || current.row.name;
				if (!key || visited.has(key)) continue;
				visited.add(key);
				descendants.push({ ...current.row, depth: current.depth });
				for (const child of byParentId.get(current.row.id) || []) stack.push({ row: child, depth: current.depth + 1 });
				for (const child of byParentPublicId.get(current.row.publicId) || []) stack.push({ row: child, depth: current.depth + 1 });
			}
		}
		if (descendants.length > 0) return descendants.sort(compareByDepthAndName);
		const prefixKeys = root.pathPrefix.map(makeKey).filter(Boolean);
		return territoryRows.map(row => {
			const pathKeys = row.path.map(makeKey).filter(Boolean);
			const startIndex = findSubsequence(pathKeys, prefixKeys);
			return startIndex >= 0 && pathKeys.length > startIndex + prefixKeys.length ? { ...row, depth: pathKeys.length - (startIndex + prefixKeys.length) } : null;
		}).filter(Boolean).sort(compareByDepthAndName);
	}

	// Geschwister des aktiven Knotens (gleicher Elternknoten), ohne den Knoten selbst.
	// Für Zoom/Transparenz: alle gleichrangigen Gebiete auf denselben Wert normen.
	function findSiblings(root) {
		const rootRow = territoryRows.find(row => (root.territoryPublicId && row.publicId === root.territoryPublicId) || (root.territoryId !== null && row.id === root.territoryId) || (root.wikiKey && row.wikiKey === root.wikiKey) || (root.name && makeKey(row.name) === makeKey(root.name))) || null;
		if (!rootRow) return [];
		const rootKey = rootRow.publicId || rootRow.id || rootRow.name;
		const hasParentId = rootRow.parentId !== null && rootRow.parentId !== undefined && rootRow.parentId !== "";
		const hasParentPublicId = Boolean(rootRow.parentPublicId);
		if (!hasParentId && !hasParentPublicId) return [];
		const seen = new Set();
		return territoryRows.filter(row => {
			const key = row.publicId || row.id || row.name;
			if (!key || key === rootKey || seen.has(key)) return false;
			const sameParentId = hasParentId && row.parentId === rootRow.parentId;
			const sameParentPublicId = hasParentPublicId && row.parentPublicId === rootRow.parentPublicId;
			if (!sameParentId && !sameParentPublicId) return false;
			seen.add(key);
			return true;
		});
	}

	// #1: Default-Zoomregeln (depth-basiert, identisch zur Tabelle in territory-editor-ui-hints.js)
	// auf das GESAMTE vertikale Aggregat (Über- und Unterregionen) anwenden.
	const PARSED_DEFAULT_ZOOM_RULES = {
		1: [[0, 6]],
		2: [[0, 1], [2, 6]],
		3: [[0, 1], [2, 3], [4, 6]],
		4: [[0, 1], [2, 2], [3, 3], [4, 6]],
		5: [[0, 1], [2, 2], [3, 3], [4, 4], [5, 6]],
		6: [[0, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]]
	};

	function defaultZoomBand(totalLevels, depth) {
		const levels = Math.max(1, Math.min(6, Number(totalLevels) || 1));
		const bands = PARSED_DEFAULT_ZOOM_RULES[levels];
		const index = Math.max(1, Math.min(bands.length, Number(depth) || 1)) - 1;
		return bands[index];
	}

	async function buildDefaultZoomHierarchyUpdates() {
		const value = readAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		if (path.length === 0) return [];

		// Die Breadcrumb-Knoten tragen nur wiki_keys; das Zoom-Update braucht political_territory-UUIDs.
		// Über territoryRows (Modell-Hierarchie) per wiki_key auflösen. Reine Wiki-Knoten ohne eigenes
		// Territorium (z. B. Baronie Hahnfels) werden übersprungen.
		await loadTerritories();
		// territoryRows tragen oft KEINEN wiki_key, aber Name + publicId -> primär per wiki_key,
		// sonst per Name auflösen (wie findDescendants).
		const rowByKey = new Map();
		for (const row of territoryRows) {
			if (row.wikiKey) rowByKey.set("wiki:" + makeKey(row.wikiKey), row);
			const nameKey = "name:" + makeKey(row.name || "");
			if (row.name && !rowByKey.has(nameKey)) rowByKey.set(nameKey, row);
		}

		const spine = path.map((node, index) => {
			const wikiKey = makeKey(node.wikiKey || node.key || "");
			const nameKey = makeKey(node.label || node.name || "");
			const row = (wikiKey && rowByKey.get("wiki:" + wikiKey)) || (nameKey && rowByKey.get("name:" + nameKey)) || null;
			return { row, depth: index + 1 };
		});

		const deepestEntry = [...spine].reverse().find((entry) => entry.row) || null;
		if (!deepestEntry || !deepestEntry.row) return [];

		// Default-Zoomregeln aufs GANZE vertikale Aggregat (alle Zweige) anwenden: vom aktiven Knoten per
		// parent_id zur WURZEL (Reich) hochlaufen und von dort den kompletten Unterbaum erfassen. (Vorher
		// startete die Nachfahren-Suche beim AKTIVEN Knoten -> bei einer Baronie/mittleren Ebene wurden die
		// Geschwister-Zweige des Reichs uebersprungen = "biegt nicht in alle Zweige ab".) rowById fuer den
		// Hochlauf, childrenByParentId fuer den rekursiven Runterlauf.
		const childrenByParentId = new Map();
		const rowById = new Map();
		for (const row of territoryRows) {
			if (row.id !== null && row.id !== undefined) rowById.set(row.id, row);
			if (row.parentId === null || row.parentId === undefined) continue;
			if (!childrenByParentId.has(row.parentId)) childrenByParentId.set(row.parentId, []);
			childrenByParentId.get(row.parentId).push(row);
		}

		let rootRow = deepestEntry.row;
		const upSeen = new Set();
		while (rootRow.parentId !== null && rootRow.parentId !== undefined && rowById.has(rootRow.parentId)) {
			if (rootRow.id != null) { if (upSeen.has(rootRow.id)) break; upSeen.add(rootRow.id); }
			rootRow = rowById.get(rootRow.parentId);
		}

		// Vom Reich aus ALLE Zweige rekursiv erfassen (Tiefe ab Wurzel = 1).
		const aggregate = [];
		const visited = new Set();
		const stack = [{ row: rootRow, depth: 1 }];
		while (stack.length > 0) {
			const current = stack.pop();
			const visitKey = current.row.id != null ? "id:" + current.row.id : "pid:" + (current.row.publicId || "");
			if (visited.has(visitKey)) continue;
			visited.add(visitKey);
			aggregate.push(current);
			for (const child of childrenByParentId.get(current.row.id) || []) {
				stack.push({ row: child, depth: current.depth + 1 });
			}
		}
		// Gesamtebenen PRO KNOTEN = tiefste Blatt-Tiefe SEINES Teilbaums (absolute Tiefe ab Wurzel), NICHT die
		// globale Maximaltiefe des ganzen Reichs. So bekommt jeder Zweig die Default-Regel seiner EIGENEN Tiefe:
		// Reich > Grafschaft > Baronie (3 Ebenen) -> 0-1 / 2-3 / 4-6, auch wenn andere Reichs-Zweige 4+ tief sind.
		// (Global -> flache Zweige bekamen faelschlich die 4-Ebenen-Regel und das Blatt endete bei 3-3 statt 4-6
		// = Luecke bei Zoom 4-6.) Von tief nach flach verarbeiten, dann ist jedes Kind vor seinem Eltern fertig.
		const maxLeafDepthById = new Map();
		[...aggregate].sort((a, b) => b.depth - a.depth).forEach((entry) => {
			let deepest = entry.depth;
			for (const child of (childrenByParentId.get(entry.row.id) || [])) {
				const childDeepest = maxLeafDepthById.get(child.id);
				if (childDeepest != null && childDeepest > deepest) deepest = childDeepest;
			}
			maxLeafDepthById.set(entry.row.id, deepest);
		});

		const updates = [];
		const seen = new Set();
		const push = (territoryPublicId, depth, totalLevels) => {
			const key = normalizeText(territoryPublicId);
			if (!key || seen.has(key)) return;
			seen.add(key);
			const band = defaultZoomBand(totalLevels, depth);
			updates.push({ territoryPublicId: key, minZoom: band[0], maxZoom: band[1] });
		};
		aggregate.forEach((entry) => push(entry.row.publicId || "", entry.depth, maxLeafDepthById.get(entry.row.id) || entry.depth));
		return updates;
	}

	function buildColorUpdates(root, descendants) {
		const updates = [{ territoryPublicId: root.territoryPublicId, name: root.name || root.territoryPublicId || "Aktive Ebene", depth: 1, color: root.color }];

		// Rekursive Ableitung: jede Ebene variiert die bereits zugewiesene Farbe IHRES
		// direkten Elternknotens (Variation von Variation), statt alle aus der Wurzel-Farbe
		// zu rechnen -> die Farbe "wandert" mit leichten Abweichungen die Hierarchie hinab.
		// Wurzel-Keys aus den direkten Kindern ableiten (root.territoryPublicId kann ein
		// wiki:-Key sein, die echten parent-Keys der Kinder zeigen auf die UUID/ID).
		const directChildren = descendants.filter(row => Number(row.depth || 0) === 1);
		const rootPublicId = String(directChildren[0]?.parentPublicId || root.territoryPublicId || "").trim();
		const rootId = directChildren[0]?.parentId ?? root.territoryId ?? null;

		const colorByKey = new Map();
		const rememberColor = (publicId, id, color) => {
			if (publicId) colorByKey.set("pid:" + publicId, color);
			if (id !== null && id !== undefined && id !== "") colorByKey.set("id:" + id, color);
		};
		rememberColor(rootPublicId, rootId, root.color);

		// Geschwister je Elternknoten (für die Hue-Spreizung innerhalb einer Familie).
		const siblingsByParent = new Map();
		for (const row of descendants) {
			addToMapList(siblingsByParent, String(row.parentPublicId || row.parentId || "").trim(), row);
		}

		// ZUFÄLLIGE Zuordnung der (gleichmäßig gespreizten) Farbtöne zu den Geschwistern: dieselbe Hue-Spanne wie
		// bisher, aber jede Eltern-Gruppe wird per Seed gemischt -> benachbarte Gebiete bekommen nicht mehr
		// benachbarte Töne (sahen sich vorher fast gleich). Deterministisch pro Seed (Vorschau stabil), neu beim
		// "Farbhierarchie erstellen". Gilt rekursiv für JEDE Ebene (Mischung je Eltern-Gruppe).
		const seededUnit = getColorUtils()?.seededUnit || (() => 0.5);
		const shuffledSiblingIndex = new Map();   // Reihenfolge für den HUE
		const shuffledValueIndex = new Map();     // ZWEITE, unabhängige Mischung für die HELLIGKEIT (de-korreliert)
		for (const [parentKey, group] of siblingsByParent) {
			group
				.map(row => ({ key: row.publicId || row.id || row.name, r: seededUnit(`${colorShuffleSeed}:hue:${parentKey}:${row.publicId || row.id || row.name}`) }))
				.sort((left, right) => left.r - right.r)
				.forEach((entry, index) => shuffledSiblingIndex.set(entry.key, index));
			group
				.map(row => ({ key: row.publicId || row.id || row.name, r: seededUnit(`${colorShuffleSeed}:val:${parentKey}:${row.publicId || row.id || row.name}`) }))
				.sort((left, right) => left.r - right.r)
				.forEach((entry, index) => shuffledValueIndex.set(entry.key, index));
		}

		// Per-Level-Varianz: field[L] = HSV-Abweichung, mit der die KINDER eines Level-L-Knotens von
		// ihrem Elternknoten streuen (Felder Hierarchie-Level 1-6). Die ausgewählte Ebene = activeIndex+1.
		const levelVariances = readLevelVariances();
		const selectedLevel = Math.max(1, (Number(root.activeIndex) || 0) + 1);
		const varianceForAbsoluteLevel = (absoluteLevel) => levelVariances[Math.max(1, Math.min(6, absoluteLevel))];

		// In Tiefen-Reihenfolge, damit die Elternfarbe vor den Kindern feststeht.
		const ordered = [...descendants].sort((left, right) => (Number(left.depth || 0) - Number(right.depth || 0)) || String(left.name || "").localeCompare(String(right.name || ""), "de"));
		for (const row of ordered) {
			const parentColor = colorByKey.get("pid:" + String(row.parentPublicId || "").trim())
				?? colorByKey.get("id:" + (row.parentId ?? ""))
				?? root.color;
			const siblings = siblingsByParent.get(String(row.parentPublicId || row.parentId || "").trim()) || [row];
			const rowKey = row.publicId || row.id || row.name;
			const naturalIndex = Math.max(0, siblings.findIndex(entry => (entry.publicId && entry.publicId === row.publicId) || (entry.id != null && entry.id === row.id)));
			// Statt fester Index-Reihenfolge die gemischte Position nutzen (zufällige Ton-Verteilung).
			const siblingIndex = shuffledSiblingIndex.has(rowKey) ? shuffledSiblingIndex.get(rowKey) : naturalIndex;
			// Unabhängige Helligkeits-Position (de-korreliert vom Hue) -> garantiert distinkte Helligkeitsstufen.
			const valueIndex = shuffledValueIndex.has(rowKey) ? shuffledValueIndex.get(rowKey) : naturalIndex;
			// Hue-Abweichung kommt aus dem Feld des ELTERN-Levels: field[L] steuert, wie stark die
			// KINDER eines Level-L-Knotens streuen. Ein direktes Kind (row.depth 1) eines Knotens auf
			// selectedLevel nutzt also field[selectedLevel]; dessen Kind (depth 2) field[selectedLevel+1] usw.
			const parentLevel = selectedLevel + Number(row.depth || 1) - 1;
			const variance256 = varianceForAbsoluteLevel(parentLevel);
			// Seed mit hineingeben -> Helligkeit/Sättigung (in createHueVariant) würfeln beim "Farbhierarchie erstellen" neu.
			const color = createHueVariant(parentColor, 2, siblingIndex, siblings.length, `${colorShuffleSeed}:${row.publicId || row.name}`, variance256, valueIndex);
			rememberColor(row.publicId, row.id, color);
			updates.push({ territoryPublicId: row.publicId, name: row.name || row.publicId, depth: Math.max(1, Number(row.depth || 1)) + 1, color, parentKey: String(row.parentPublicId || row.parentId || "").trim() });
		}

		appendMissingBreadcrumbDepths(root, updates);
		return updates.filter(update => update.territoryPublicId || update.depth === 1).sort(compareByDepthAndName);
	}

	function appendMissingBreadcrumbDepths(root, updates) {
		const value = readAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		path.slice(root.activeIndex).forEach((node, index) => {
			const depth = index + 1;
			if (updates.some(update => update.depth === depth)) return;
			const name = normalizeText(node.label || node.name || node.key || node.territoryPublicId || `Ebene ${depth}`);
			updates.push({ territoryPublicId: normalizeText(node.territoryPublicId || node.territory_public_id || node.key || ""), name, depth, color: depth === 1 ? root.color : createHueVariant(root.color, depth, 0, 1, node.territoryPublicId || node.key || name) });
		});
	}

	function addToMapList(map, key, value) {
		if (key === null || key === "") return;
		if (!map.has(key)) map.set(key, []);
		map.get(key).push(value);
	}

	function findSubsequence(values, sequence) {
		for (let start = 0; start <= values.length - sequence.length; start += 1) if (sequence.every((item, index) => values[start + index] === item)) return start;
		return -1;
	}

	const compareByDepthAndName = (left, right) => (left.depth - right.depth) || left.name.localeCompare(right.name, "de");

	function levelVarianceInput(level) {
		return document.getElementById("hueVarianceLevel" + level + "Input");
	}

	function randomInVarianceRange(level) {
		const [min, max] = LEVEL_VARIANCE_RANGES[level] || [30, 30];
		return Math.round(min + Math.random() * (max - min));
	}

	// Leere/ungültige Level-Felder mit einem zufaelligen Default aus ihrem Bereich fuellen.
	function prefillLevelVarianceDefaults() {
		for (let level = 1; level <= 6; level += 1) {
			const input = levelVarianceInput(level);
			if (!input) continue;
			if (input.value === "" || !Number.isFinite(Number(input.value))) {
				input.value = String(randomInVarianceRange(level));
			}
		}
	}

	// 1-indizierte Liste der HSV-Abweichungen (0-256) pro Hierarchie-Level.
	function readLevelVariances() {
		const out = [];
		for (let level = 1; level <= 6; level += 1) {
			const input = levelVarianceInput(level);
			let value = input ? Number(input.value) : NaN;
			if (!Number.isFinite(value)) value = randomInVarianceRange(level);
			out[level] = Math.max(0, Math.min(256, value));
		}
		return out;
	}

	// Nur die Level-Felder aktiv lassen, die im aktiven Breadcrumb eine Rolle spielen: von der
	// ausgewählten Ebene (activeIndex+1) bis zur tiefsten Breadcrumb-Ebene. Darüber/darunter -> disabled.
	function updateLevelVarianceFieldStates() {
		const value = readAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const activeIndex = Number(getFormModule()?.getActivePathIndex?.(value));
		const selectedLevel = Number.isFinite(activeIndex) && activeIndex >= 0 ? activeIndex + 1 : 1;
		const totalLevels = path.length || selectedLevel;
		for (let level = 1; level <= 6; level += 1) {
			const input = levelVarianceInput(level);
			if (!input) continue;
			input.disabled = !(level >= selectedLevel && level <= totalLevels);
		}
	}

	// Stellt sicher, dass keine zwei geplanten Farben exakt gleich sind: Kollisionen werden per
	// Heuristik (Hue rotieren, Helligkeit leicht variieren) auf den nächstbesten freien Wert geschoben.
	// Wurzel-/Spine-Farben (depth <= 1) bleiben unangetastet.
	function ensureUniqueColors(updates) {
		const colorUtils = getColorUtils();
		if (!colorUtils?.parseHexToRgb || !Array.isArray(updates)) return updates;
		const seen = new Set();
		const ordered = [...updates].sort((a, b) => (Number(a.depth || 0) - Number(b.depth || 0)));
		for (const update of ordered) {
			const color = String(update.color || "").toLowerCase();
			if (!color) continue;
			if (!seen.has(color) || Number(update.depth || 0) <= 1) { seen.add(color); continue; }
			const free = findFreeColor(color, seen, colorUtils);
			update.color = free;
			seen.add(free.toLowerCase());
		}
		return updates;
	}

	function findFreeColor(hex, seen, colorUtils) {
		const rgb = colorUtils.parseHexToRgb(hex) || { red: 136, green: 136, blue: 136 };
		const hsv = colorUtils.rgbToHsv(rgb.red, rgb.green, rgb.blue);
		for (let step = 1; step <= 240; step += 1) {
			const deltaHue = (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2) * 2.5;
			for (const deltaValue of [0, 0.05, -0.05, 0.1, -0.1]) {
				const hue = (((hsv.hue + deltaHue) % 360) + 360) % 360;
				const value = Math.max(0.2, Math.min(1, hsv.value + deltaValue));
				const candidate = colorUtils.hsvToHex(hue, hsv.saturation, value).toLowerCase();
				if (!seen.has(candidate)) return candidate;
			}
		}
		return hex;
	}

	function createHueVariant(parentColor, depth, siblingIndex, siblingCount, seedText, variance256, valueIndex) {
		const colorUtils = getColorUtils();
		if (!colorUtils?.createHueVariant) return parentColor;
		const variance = Number.isFinite(variance256) ? variance256 : 30;
		return colorUtils.createHueVariant(parentColor, {
			depth,
			siblingIndex,
			siblingCount,
			seedText,
			valueIndex,
			range: { min256: variance, max256: variance }
		});
	}

	function renderPreview(plan) {
		const preview = document.getElementById("deferredColorHierarchyPreview");
		if (!preview) return;
		preview.hidden = false;
		if (!plan || plan.updates.length < 1) {
			preview.innerHTML = `<div class="deferred-subtree-empty">Keine Unterregionen für das aktive Breadcrumb gefunden.</div>`;
			return;
		}
		const byDepth = new Map();
		for (const update of plan.updates) addToMapList(byDepth, update.depth, update);
		const swatch = (update) => `<span class="deferred-subtree-swatch" style="background:${escapeHtml(update.color)}" title="${escapeHtml(`${update.name}: ${update.color}`)}"></span>`;
		const rows = [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([, updates]) => {
			// Pro Tiefe die Geschwister NACH FAMILIE (gleicher Elternteil) gruppieren -> man sieht, welche Kinder
			// zu welchem Elternteil gehören (Hierarchie wird abgebildet, statt zusammenhanglos durchzulaufen).
			const byParent = new Map();
			for (const update of updates) addToMapList(byParent, update.parentKey || "", update);
			const families = [...byParent.values()]
				.map(group => `<span style="display:inline-flex;gap:2px;margin:0 8px 3px 0">${group.map(swatch).join("")}</span>`)
				.join("");
			return `<tr><td><div class="deferred-subtree-swatches">${families}</div></td></tr>`;
		}).join("");
		preview.innerHTML = `<div class="deferred-subtree-preview-title">Geplante Farben ab „${escapeHtml(plan.root.name)}“</div><table class="deferred-subtree-table"><thead><tr><th>Farbe pro Ebene</th></tr></thead><tbody>${rows}</tbody></table>`;
	}

	async function applyGlobalInheritanceAfterSave(context) {
		const root = readRootSelection();
		const service = getSubtreeService();
		const messages = [];
		if (root && document.getElementById("inheritColorToDescendantsCheckbox")?.checked && service?.applyExplicitColorUpdates) {
			const plan = pendingColorPlan || await createColorPlan(false);
			messages.push(service.formatInheritanceMessage?.("Farbhierarchie", await service.applyExplicitColorUpdates(plan?.updates || [])) || "Farbhierarchie angewendet.");
		}
		if (root && document.getElementById("inheritOpacityToDescendantsCheckbox")?.checked && service?.applyExplicitOpacityUpdates) {
			await loadTerritories();
			const siblingOpacityUpdates = findSiblings(root).map(row => ({ territoryPublicId: row.publicId, opacity: root.opacity })).filter(update => update.territoryPublicId);
			const opacityResult = await service.applyExplicitOpacityUpdates(siblingOpacityUpdates);
			messages.push(`Transparenz auf ${siblingOpacityUpdates.length} Geschwisterregionen angewendet (${opacityResult && opacityResult.changed != null ? opacityResult.changed : 0} gespeichert).`);
		}
		if (root && document.getElementById("inheritOpacityToSubtreeCheckbox")?.checked && service?.applyExplicitOpacityUpdates) {
			await loadTerritories();
			const subtreeOpacityUpdates = findDescendants(root).map(row => ({ territoryPublicId: row.publicId, opacity: root.opacity })).filter(update => update.territoryPublicId);
			const subtreeOpacityResult = await service.applyExplicitOpacityUpdates(subtreeOpacityUpdates);
			messages.push(`Transparenz auf ${subtreeOpacityUpdates.length} Untergebiete angewendet (${subtreeOpacityResult && subtreeOpacityResult.changed != null ? subtreeOpacityResult.changed : 0} gespeichert).`);
		}
		if (root && document.getElementById("inheritZoomToDescendantsCheckbox")?.checked && service?.applyExplicitZoomUpdates) {
			await loadTerritories();
			const siblingZoomUpdates = findSiblings(root).map(row => ({ territoryPublicId: row.publicId, minZoom: root.zoomMin, maxZoom: root.zoomMax })).filter(update => update.territoryPublicId);
			const zoomResult = await service.applyExplicitZoomUpdates(siblingZoomUpdates);
			messages.push(`Zoom auf ${siblingZoomUpdates.length} Geschwisterregionen angewendet (${zoomResult && zoomResult.changed != null ? zoomResult.changed : 0} gespeichert).`);
		}
		if (document.getElementById("resetDefaultZoomToHierarchyCheckbox")?.checked && service?.applyExplicitZoomUpdates) {
			const defaultZoomUpdates = await buildDefaultZoomHierarchyUpdates();
			const defaultZoomResult = await service.applyExplicitZoomUpdates(defaultZoomUpdates);
			messages.push(`Default-Zoomregeln auf ${defaultZoomUpdates.length} Gebiete (Über-/Unterregionen) angewendet (${defaultZoomResult && defaultZoomResult.changed != null ? defaultZoomResult.changed : 0} gespeichert).`);
		}
		if (root && document.getElementById("inheritValidityToDescendantsCheckbox")?.checked && service?.applyExplicitValidityUpdates) {
			await loadTerritories();
			const validityUpdates = findDescendants(root).map(row => ({ territoryPublicId: row.publicId, startYear: root.startYear, endYear: root.endYear, existsUntilToday: root.existsUntilToday })).filter(update => update.territoryPublicId);
			const validityResult = await service.applyExplicitValidityUpdates(validityUpdates);
			messages.push(`Gültigkeit auf ${validityUpdates.length} Untergebiete angewendet (${validityResult && validityResult.changed != null ? validityResult.changed : 0} gespeichert).`);
		}
		if (messages.length < 1) return context.result;
		pendingColorPlan = null;
		service?.reloadEditorAndParentLayers?.();
		return { ...(context.result || {}), message: `${context.result?.message || "Gespeichert."} ${messages.join(" ")}` };
	}

	function registerSaveHooks() {
		const pipeline = getSavePipeline();
		const form = getFormModule();
		if (!pipeline || !form) return false;
		pipeline.registerBeforeSaveTransform?.(form.applyLocalDisplayInheritance);
		pipeline.registerAfterSaveHook?.(applyGlobalInheritanceAfterSave);
		return true;
	}

	function registerSaveHooksWhenReady() {
		if (!registerSaveHooks()) window.setTimeout(registerSaveHooksWhenReady, 50);
	}

	function init() {
		installUi();
		registerSaveHooksWhenReady();
	}

	if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
	else init();
})();

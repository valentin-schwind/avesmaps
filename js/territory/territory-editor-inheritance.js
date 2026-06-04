"use strict";

(function initPoliticalTerritoryEditorInheritance() {
	const CHECKBOX_IDS = [
		"inheritZoomToDescendantsCheckbox",
		"inheritColorToDescendantsCheckbox",
		"inheritOpacityToDescendantsCheckbox",
		"inheritOpacityToSubtreeCheckbox",
		"inheritValidityToDescendantsCheckbox"
	];

	// Diese vererben an GESCHWISTER (gleiche Ebene) -> auch fuer unterste Breadcrumbs/Blaetter sinnvoll.
	const SIBLING_CHECKBOX_IDS = ["inheritZoomToDescendantsCheckbox", "inheritOpacityToDescendantsCheckbox"];
	let territoryRows = [];
	let pendingColorPlan = null;

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
		const colorButton = document.getElementById("inheritColorVarianceButton");
		if (colorButton) colorButton.hidden = !hasLowerBreadcrumb;

		for (const id of CHECKBOX_IDS) {
			const input = document.getElementById(id);
			const label = input?.closest(".deferred-subtree-checkbox");
			if (!input || !label) continue;
			const inheritVisible = SIBLING_CHECKBOX_IDS.includes(id) ? hasActiveNode : hasLowerBreadcrumb;
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
			setStatus("Kein aktives Herrschaftsgebiet ausgewaehlt.", "error");
			return null;
		}
		await loadTerritories();
		const descendants = findDescendants(root);
		const updates = buildColorUpdates(root, descendants);
		pendingColorPlan = { root, updates };
		const colorDescCbEnable = document.getElementById("inheritColorToDescendantsCheckbox");
		if (colorDescCbEnable) colorDescCbEnable.disabled = false;
		if (checkCheckbox) document.getElementById("inheritColorToDescendantsCheckbox")?.click();
		renderPreview(pendingColorPlan);
		setStatus(descendants.length > 0 ? `Farbhierarchie vorbereitet: ${descendants.length} Unterregionen.` : "Keine Unterregionen fuer das aktive Breadcrumb gefunden.", descendants.length > 0 ? "pending" : "error");
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

	function buildDefaultZoomHierarchyUpdates() {
		const value = readAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		if (path.length === 0) return [];
		const deepest = path[path.length - 1];
		const deepestRoot = {
			territoryPublicId: deepest.territoryPublicId || deepest.territory_public_id || "",
			territoryId: deepest.territoryId ?? null,
			wikiKey: deepest.wikiKey || deepest.key || "",
			name: deepest.label || deepest.name || ""
		};
		const descendants = findDescendants(deepestRoot);
		const maxRelativeDepth = descendants.reduce((max, row) => Math.max(max, Number(row.depth || 1)), 0);
		const totalLevels = path.length + maxRelativeDepth;
		const updates = [];
		const seen = new Set();
		const push = (territoryPublicId, depth) => {
			const key = normalizeText(territoryPublicId);
			if (!key || seen.has(key)) return;
			seen.add(key);
			const band = defaultZoomBand(totalLevels, depth);
			updates.push({ territoryPublicId: key, minZoom: band[0], maxZoom: band[1] });
		};
		path.forEach((node, index) => push(node.territoryPublicId || node.territory_public_id || "", index + 1));
		descendants.forEach((row) => push(row.publicId || "", path.length + Number(row.depth || 1)));
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

		// Geschwister je Elternknoten (fuer die Hue-Spreizung innerhalb einer Familie).
		const siblingsByParent = new Map();
		for (const row of descendants) {
			addToMapList(siblingsByParent, String(row.parentPublicId || row.parentId || "").trim(), row);
		}

		// In Tiefen-Reihenfolge, damit die Elternfarbe vor den Kindern feststeht.
		const ordered = [...descendants].sort((left, right) => (Number(left.depth || 0) - Number(right.depth || 0)) || String(left.name || "").localeCompare(String(right.name || ""), "de"));
		for (const row of ordered) {
			const parentColor = colorByKey.get("pid:" + String(row.parentPublicId || "").trim())
				?? colorByKey.get("id:" + (row.parentId ?? ""))
				?? root.color;
			const siblings = siblingsByParent.get(String(row.parentPublicId || row.parentId || "").trim()) || [row];
			const siblingIndex = Math.max(0, siblings.findIndex(entry => (entry.publicId && entry.publicId === row.publicId) || (entry.id != null && entry.id === row.id)));
			// depth: 2 = "eine Ebene unter dem Elternknoten" -> konstante, leichte Abweichung pro
			// Schritt; die Helligkeitsstaffelung in createHueVariant kumuliert ueber die Tiefe.
			const color = createHueVariant(parentColor, 2, siblingIndex, siblings.length, row.publicId || row.name);
			rememberColor(row.publicId, row.id, color);
			updates.push({ territoryPublicId: row.publicId, name: row.name || row.publicId, depth: Math.max(1, Number(row.depth || 1)) + 1, color });
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

	function createHueVariant(parentColor, depth, siblingIndex, siblingCount, seedText) {
		const colorUtils = getColorUtils();
		if (!colorUtils?.createHueVariant) return parentColor;
		const service = getSubtreeService();
		return colorUtils.createHueVariant(parentColor, {
			depth,
			siblingIndex,
			siblingCount,
			seedText,
			range: service?.readHueVarianceRange256?.() || { min256: 30, max256: 30 }
		});
	}

	function renderPreview(plan) {
		const preview = document.getElementById("deferredColorHierarchyPreview");
		if (!preview) return;
		preview.hidden = false;
		if (!plan || plan.updates.length < 1) {
			preview.innerHTML = `<div class="deferred-subtree-empty">Keine Unterregionen fuer das aktive Breadcrumb gefunden.</div>`;
			return;
		}
		const byDepth = new Map();
		for (const update of plan.updates) addToMapList(byDepth, update.depth, update);
		const rows = [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([depth, updates]) => `<tr><th>${depth}. Ebene</th><td><div class="deferred-subtree-swatches">${updates.map(update => `<span class="deferred-subtree-swatch" style="background:${escapeHtml(update.color)}" title="${escapeHtml(`${update.name}: ${update.color}`)}"></span>`).join("")}</div></td></tr>`).join("");
		preview.innerHTML = `<div class="deferred-subtree-preview-title">Geplante Farben ab „${escapeHtml(plan.root.name)}“</div><table class="deferred-subtree-table"><thead><tr><th>Tiefe</th><th>Farbe pro Ebene</th></tr></thead><tbody>${rows}</tbody></table>`;
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
			await loadTerritories();
			const defaultZoomUpdates = buildDefaultZoomHierarchyUpdates();
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

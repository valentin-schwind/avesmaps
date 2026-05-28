"use strict";

(function initPoliticalTerritoryEditorInheritance() {
	const CHECKBOX_IDS = [
		"inheritZoomToDescendantsCheckbox",
		"inheritColorToDescendantsCheckbox",
		"inheritOpacityToDescendantsCheckbox",
		"inheritValidityToDescendantsCheckbox"
	];

	let territoryRows = [];

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

		const opacityButton = document.getElementById("inheritOpacityButton");
		if (opacityButton) opacityButton.hidden = true;

		document.getElementById("inheritColorToDescendantsCheckbox")?.addEventListener("change", event => {
			if (event.currentTarget.checked) void createColorPlan(false);
		});
		document.getElementById("colorInput")?.addEventListener("input", () => {
			if (document.getElementById("inheritColorToDescendantsCheckbox")?.checked) void createColorPlan(false);
		});
		document.addEventListener("click", () => window.setTimeout(syncInheritanceVisibility, 0), true);
		syncInheritanceVisibility();
	}

	function syncInheritanceVisibility() {
		const hasLowerBreadcrumb = Boolean(getFormModule()?.hasLowerBreadcrumb?.());
		const colorButton = document.getElementById("inheritColorVarianceButton");
		if (colorButton) colorButton.hidden = !hasLowerBreadcrumb;

		for (const id of CHECKBOX_IDS) {
			const input = document.getElementById(id);
			const label = input?.closest(".deferred-subtree-checkbox");
			if (!input || !label) continue;
			label.hidden = !hasLowerBreadcrumb;
			if (!hasLowerBreadcrumb) input.checked = false;
		}
		if (!hasLowerBreadcrumb) {
			const preview = document.getElementById("deferredColorHierarchyPreview");
			if (preview) preview.hidden = true;
		}
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
		if (checkCheckbox) document.getElementById("inheritColorToDescendantsCheckbox")?.click();
		renderPreview({ root, updates });
		setStatus(descendants.length > 0 ? `Farbhierarchie vorbereitet: ${descendants.length} Unterregionen.` : "Keine Unterregionen fuer das aktive Breadcrumb gefunden.", descendants.length > 0 ? "pending" : "error");
		return { root, updates };
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

	function buildColorUpdates(root, descendants) {
		const updates = [{ territoryPublicId: root.territoryPublicId, name: root.name || root.territoryPublicId || "Aktive Ebene", depth: 1, color: root.color }];
		const byDepth = new Map();
		for (const row of descendants) addToMapList(byDepth, Math.max(1, Number(row.depth || 1)) + 1, row);
		for (const depth of [...byDepth.keys()].sort((a, b) => a - b)) {
			const rows = byDepth.get(depth);
			for (let index = 0; index < rows.length; index += 1) {
				const row = rows[index];
				updates.push({ territoryPublicId: row.publicId, name: row.name || row.publicId, depth, color: createHueVariant(root.color, depth, index, rows.length, row.publicId || row.name) });
			}
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
		const rgb = parseHexToRgb(parentColor) || { red: 136, green: 136, blue: 136 };
		const hsv = rgbToHsv(rgb.red, rgb.green, rgb.blue);
		const service = getSubtreeService();
		const range = service?.readHueVarianceRange256?.() || { min256: 10, max256: 20 };
		let span = Math.min(24, 14 / (1 + ((Math.max(1, depth) - 2) * 0.45)) + Math.min(12, Math.max(0, siblingCount - 1) * 0.55));
		span = Math.max((range.min256 / 256) * 360, Math.min(span, (range.max256 / 256) * 360));
		const position = siblingCount > 1 ? siblingIndex / (siblingCount - 1) : 0.5;
		const offset = ((position * 2) - 1) * span;
		const jitter = (((seededUnit(`${seedText}:jitter`) * 2) - 1) * Math.max(0.75, Math.min(2.5, span * 0.18)));
		return hsvToHex((hsv.hue + offset + jitter + 360) % 360, hsv.saturation, hsv.value);
	}

	function seededUnit(value) {
		let hash = 2166136261;
		for (const char of String(value || "")) {
			hash ^= char.charCodeAt(0);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0) / 4294967295;
	}

	function parseHexToRgb(color) {
		const normalized = getFormModule()?.normalizeHexColor?.(color) || (/^#[0-9a-fA-F]{6}$/.test(normalizeText(color)) ? normalizeText(color).toLowerCase() : "");
		return normalized ? { red: Number.parseInt(normalized.slice(1, 3), 16), green: Number.parseInt(normalized.slice(3, 5), 16), blue: Number.parseInt(normalized.slice(5, 7), 16) } : null;
	}

	function rgbToHsv(red, green, blue) {
		const r = red / 255, g = green / 255, b = blue / 255;
		const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
		let hue = 0;
		if (delta > 0) {
			if (max === r) hue = ((g - b) / delta) % 6;
			else if (max === g) hue = ((b - r) / delta) + 2;
			else hue = ((r - g) / delta) + 4;
			hue *= 60;
			if (hue < 0) hue += 360;
		}
		return { hue, saturation: max <= 0 ? 0 : delta / max, value: max };
	}

	function hsvToHex(hue, saturation, value) {
		const chroma = value * saturation, huePrime = hue / 60, secondary = chroma * (1 - Math.abs((huePrime % 2) - 1)), match = value - chroma;
		const [r, g, b] = huePrime < 1 ? [chroma, secondary, 0] : huePrime < 2 ? [secondary, chroma, 0] : huePrime < 3 ? [0, chroma, secondary] : huePrime < 4 ? [0, secondary, chroma] : huePrime < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
		return `#${[r, g, b].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
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
		if (root && document.getElementById("inheritColorToDescendantsCheckbox")?.checked && service?.applyColorHierarchy) {
			const range = service.readHueVarianceRange256?.() || { min256: 10, max256: 20 };
			messages.push(service.formatInheritanceMessage?.("Farbhierarchie", await service.applyColorHierarchy(root, { hueVarianceRange: range })) || "Farbhierarchie angewendet.");
		}
		if (root && document.getElementById("inheritOpacityToDescendantsCheckbox")?.checked && service?.applyOpacityInheritance) {
			messages.push(service.formatInheritanceMessage?.("Transparenz", await service.applyOpacityInheritance(root)) || "Transparenz angewendet.");
		}
		if (messages.length < 1) return context.result;
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

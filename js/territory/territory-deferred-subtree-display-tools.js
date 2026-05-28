"use strict";

(function initPoliticalTerritoryDeferredSubtreeDisplayTools() {
	const TERRITORY_API_URL = "/api/app/political-territories.php?debug_errors=1";
	const SUBTREE_API_URL = "/api/edit/political/subtree-display.php";

	let territoryRows = [];
	let territoryRowsLoaded = false;
	let colorPlan = null;
	let externalOnSave = null;
	let patchingConfigure = false;

	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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

	function normalizeHexColor(value) {
		const color = normalizeText(value);
		return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "";
	}

	function parseOptionalNumber(value, fallback = null) {
		if (value === "" || value === null || typeof value === "undefined") {
			return fallback;
		}
		const number = Number(value);
		return Number.isFinite(number) ? number : fallback;
	}

	function clampNumber(value, min, max) {
		const number = Number(value);
		return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
	}

	function escapeHtml(value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	function readAssignmentValue() {
		return window.AvesmapsPoliticalTerritoryAssignment?.getValue?.() || null;
	}

	function setStatus(message, type = "pending") {
		window.AvesmapsPoliticalTerritoryAssignment?.setStatus?.(message, type);
	}

	function installStyles() {
		if (document.getElementById("deferredSubtreeDisplayStyles")) {
			return;
		}

		const style = document.createElement("style");
		style.id = "deferredSubtreeDisplayStyles";
		style.textContent = `
			.deferred-subtree-checkbox{display:inline-flex;align-items:center;gap:7px;color:var(--muted-2,#806c59);font-weight:700}.deferred-subtree-checkbox input{width:auto;padding:0}.deferred-subtree-preview{display:grid;gap:7px;margin-top:4px}.deferred-subtree-preview[hidden]{display:none!important}.deferred-subtree-preview-title{color:var(--muted-2,#806c59);font-size:11px;font-weight:700}.deferred-subtree-table{width:100%;border-collapse:collapse;border:1px solid #dccab8;border-radius:8px;overflow:hidden;background:#fff}.deferred-subtree-table th,.deferred-subtree-table td{padding:7px 8px;border-bottom:1px solid #eadbcb;vertical-align:top;text-align:left}.deferred-subtree-table th{background:var(--panel-soft,#fffaf5);color:#6a5543;font-size:11px}.deferred-subtree-table tr:last-child th,.deferred-subtree-table tr:last-child td{border-bottom:0}.deferred-subtree-swatches{display:flex;flex-wrap:wrap;gap:5px}.deferred-subtree-swatch{width:18px;height:18px;border:1px solid rgba(0,0,0,.22);border-radius:4px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}.deferred-subtree-empty{color:var(--muted,#6c5a49);font-size:11px;line-height:1.35}
		`;
		document.head.appendChild(style);
	}

	function replaceButtonWithoutOldListeners(button, text) {
		if (!(button instanceof HTMLElement)) {
			return null;
		}
		const replacement = button.cloneNode(true);
		replacement.textContent = text;
		replacement.hidden = button.hidden;
		button.replaceWith(replacement);
		return replacement;
	}

	function findSection(label) {
		return [...document.querySelectorAll(".manual-data-section")]
			.find(section => normalizeText(section.getAttribute("aria-label")) === label) || null;
	}

	function addCheckbox(section, id) {
		if (!section || document.getElementById(id)) {
			return;
		}
		const label = document.createElement("label");
		label.className = "deferred-subtree-checkbox";
		label.innerHTML = `<input id="${id}" type="checkbox"><span>Für alle Unterregionen übernehmen</span>`;
		section.appendChild(label);
	}

	function installUi() {
		installStyles();
		const colorButton = replaceButtonWithoutOldListeners(document.getElementById("inheritColorVarianceButton"), "Farbhierarchie erstellen");
		const opacityButton = document.getElementById("inheritOpacityButton");
		if (opacityButton) {
			opacityButton.remove();
		}

		const colorSection = findSection("Farbe");
		const opacitySection = findSection("Transparenz");
		addCheckbox(colorSection, "inheritColorToDescendantsCheckbox");
		addCheckbox(opacitySection, "inheritOpacityToDescendantsCheckbox");

		if (colorSection && !document.getElementById("deferredColorHierarchyPreview")) {
			const preview = document.createElement("div");
			preview.id = "deferredColorHierarchyPreview";
			preview.className = "deferred-subtree-preview";
			preview.hidden = true;
			colorSection.appendChild(preview);
		}

		const hint = colorSection?.querySelector(".manual-data-inline-hint");
		if (hint) {
			hint.textContent = "Hinweis: Die Farbhierarchie wird vorbereitet und erst beim Speichern auf die ausgewählten Unterregionen übertragen.";
		}

		colorButton?.addEventListener("click", event => {
			event.preventDefault();
			void createColorPlan();
		});
		document.getElementById("colorInput")?.addEventListener("input", () => {
			if (document.getElementById("inheritColorToDescendantsCheckbox")?.checked) {
				void createColorPlan(false);
			}
		});
		document.addEventListener("click", () => window.setTimeout(syncButtonVisibility, 0), true);
		syncButtonVisibility();
	}

	function syncButtonVisibility() {
		const button = document.getElementById("inheritColorVarianceButton");
		const value = readAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const index = getActivePathIndex(value);
		if (button) {
			button.hidden = !(index >= 0 && index < path.length - 1);
		}
	}

	function getActivePathIndex(value) {
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const active = value?.activeDisplayNode || null;
		if (active) {
			const index = path.findIndex(node => sameReference(node, active));
			if (index >= 0) {
				return index;
			}
		}
		return path.length - 1;
	}

	function sameReference(left, right) {
		const leftValues = referenceValues(left);
		const rightValues = referenceValues(right);
		return leftValues.some(leftValue => rightValues.some(rightValue => leftValue === rightValue || makeKey(leftValue) === makeKey(rightValue)));
	}

	function referenceValues(value) {
		return [
			value?.territoryPublicId,
			value?.territory_public_id,
			value?.territoryId,
			value?.territory_id,
			value?.wikiKey,
			value?.wiki_key,
			value?.key,
			value?.id,
			value?.label,
			value?.name
		].map(normalizeText).filter(Boolean);
	}

	function readRootSelection() {
		const value = readAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const displays = Array.isArray(value?.displays) ? value.displays : [];
		const activeIndex = getActivePathIndex(value);
		const rootNode = path[activeIndex] || null;
		const rootDisplay = displays[activeIndex] || value?.display || {};
		if (!rootNode) {
			return null;
		}

		const percent = parseOptionalNumber(document.getElementById("transparencyInput")?.value, Math.round((rootDisplay.opacity ?? 0.33) * 100));
		return {
			activeIndex,
			pathPrefix: path.slice(0, activeIndex + 1).map(node => normalizeText(node.label || node.name || node.key || "")).filter(Boolean),
			territoryId: parseOptionalNumber(rootNode.territoryId ?? rootNode.territory_id),
			territoryPublicId: normalizeText(rootNode.territoryPublicId || rootNode.territory_public_id || rootNode.key || ""),
			wikiKey: normalizeText(rootNode.wikiKey || rootNode.wiki_key || rootNode.key || ""),
			name: normalizeText(rootNode.label || rootDisplay.name || rootDisplay.displayName || ""),
			color: normalizeHexColor(document.getElementById("colorInput")?.value || rootDisplay.color) || "#888888",
			opacity: clampNumber(percent / 100, 0, 1)
		};
	}

	async function loadTerritories() {
		if (territoryRowsLoaded) {
			return territoryRows;
		}
		const separator = TERRITORY_API_URL.includes("?") ? "&" : "?";
		const response = await fetch(`${TERRITORY_API_URL}${separator}action=hierarchy`, {
			method: "GET",
			credentials: "same-origin",
			headers: { "Accept": "application/json" }
		});
		const payload = await response.json().catch(() => null);
		if (!response.ok || payload?.ok === false) {
			throw new Error(payload?.error || `Herrschaftsgebiete konnten nicht geladen werden: HTTP ${response.status}`);
		}
		territoryRows = readTerritoriesFromPayload(payload).map(normalizeTerritoryRow).filter(row => row.name || row.publicId);
		territoryRowsLoaded = true;
		return territoryRows;
	}

	function readTerritoriesFromPayload(payload) {
		if (Array.isArray(payload?.territories)) {
			return payload.territories;
		}
		if (Array.isArray(payload?.items)) {
			return payload.items;
		}
		if (Array.isArray(payload?.hierarchy)) {
			return flattenHierarchy(payload.hierarchy);
		}
		if (payload?.hierarchy && typeof payload.hierarchy === "object") {
			return flattenHierarchy(Object.values(payload.hierarchy));
		}
		return [];
	}

	function flattenHierarchy(nodes, parent = null) {
		const rows = [];
		for (const node of Array.isArray(nodes) ? nodes : []) {
			if (!node || typeof node !== "object") {
				continue;
			}
			rows.push({ ...node, parent: node.parent || parent });
			const children = node.children || node.items || node.territories || [];
			rows.push(...flattenHierarchy(children, node));
		}
		return rows;
	}

	function normalizeTerritoryRow(row) {
		const parent = row.parent && typeof row.parent === "object" ? row.parent : {};
		const publicId = normalizeText(row.publicId || row.public_id || row.territoryPublicId || row.territory_public_id || row.key || "");
		return {
			id: parseOptionalNumber(row.id ?? row.territoryId ?? row.territory_id),
			publicId,
			wikiKey: normalizeText(row.wikiKey || row.wiki_key || ""),
			slug: normalizeText(row.slug || row.nodeKey || row.node_key || ""),
			parentId: parseOptionalNumber(row.parentId ?? row.parent_id ?? parent.id ?? parent.territoryId ?? parent.territory_id),
			parentPublicId: normalizeText(row.parentPublicId || row.parent_public_id || parent.publicId || parent.public_id || parent.territoryPublicId || parent.territory_public_id || ""),
			name: normalizeText(row.name || row.displayName || row.display_name || row.label || row.wikiName || row.wiki_name || ""),
			path: normalizePath(row.path || row.pathKeys || row.affiliationPath || row.affiliation_path || row.wikiAffiliationPath || row.wiki_affiliation_path || row.wiki_affiliation_path_json)
		};
	}

	function normalizePath(value) {
		if (typeof value === "string" && value.trim().startsWith("[")) {
			try {
				return normalizePath(JSON.parse(value));
			} catch (error) {
				return [];
			}
		}
		if (!Array.isArray(value)) {
			return [];
		}
		return value.map(item => typeof item === "object" ? normalizeText(item.name || item.label || item.key || "") : normalizeText(item)).filter(Boolean);
	}

	async function createColorPlan(checkCheckbox = true) {
		const root = readRootSelection();
		if (!root) {
			setStatus("Kein aktives Herrschaftsgebiet ausgewaehlt.", "error");
			return;
		}
		await loadTerritories();
		const descendants = findDescendants(root);
		const updates = buildColorUpdates(root, descendants);
		colorPlan = { root, updates };
		if (checkCheckbox) {
			const checkbox = document.getElementById("inheritColorToDescendantsCheckbox");
			if (checkbox) {
				checkbox.checked = true;
			}
		}
		renderPreview(colorPlan);
		setStatus(updates.length > 0 ? `Farbhierarchie vorbereitet: ${updates.length} Unterregionen.` : "Keine Unterregionen fuer das aktive Breadcrumb gefunden.", updates.length > 0 ? "pending" : "error");
	}

	function findRootRow(root) {
		return territoryRows.find(row => {
			return (root.territoryPublicId && row.publicId === root.territoryPublicId)
				|| (root.territoryId !== null && row.id === root.territoryId)
				|| (root.wikiKey && row.wikiKey === root.wikiKey)
				|| (root.name && makeKey(row.name) === makeKey(root.name));
		}) || null;
	}

	function findDescendants(root) {
		const rootRow = findRootRow(root);
		const descendants = [];
		const visited = new Set();

		if (rootRow) {
			const byParentId = new Map();
			const byParentPublicId = new Map();
			for (const row of territoryRows) {
				if (row.parentId !== null) {
					addToMapList(byParentId, row.parentId, row);
				}
				if (row.parentPublicId) {
					addToMapList(byParentPublicId, row.parentPublicId, row);
				}
			}
			const stack = [];
			for (const row of byParentId.get(rootRow.id) || []) {
				stack.push({ row, depth: 1 });
			}
			for (const row of byParentPublicId.get(rootRow.publicId) || []) {
				stack.push({ row, depth: 1 });
			}
			while (stack.length > 0) {
				const current = stack.pop();
				const key = current.row.publicId || current.row.id || current.row.name;
				if (!key || visited.has(key)) {
					continue;
				}
				visited.add(key);
				descendants.push({ ...current.row, depth: current.depth });
				for (const child of byParentId.get(current.row.id) || []) {
					stack.push({ row: child, depth: current.depth + 1 });
				}
				for (const child of byParentPublicId.get(current.row.publicId) || []) {
					stack.push({ row: child, depth: current.depth + 1 });
				}
			}
		}

		if (descendants.length > 0) {
			return descendants.sort(compareByDepthAndName);
		}

		const prefixKeys = root.pathPrefix.map(makeKey).filter(Boolean);
		if (prefixKeys.length < 1) {
			return [];
		}
		return territoryRows.map(row => {
			const pathKeys = row.path.map(makeKey).filter(Boolean);
			const startIndex = findSubsequence(pathKeys, prefixKeys);
			if (startIndex < 0 || pathKeys.length <= startIndex + prefixKeys.length) {
				return null;
			}
			return { ...row, depth: pathKeys.length - (startIndex + prefixKeys.length) };
		}).filter(Boolean).sort(compareByDepthAndName);
	}

	function addToMapList(map, key, value) {
		if (key === null || key === "") {
			return;
		}
		if (!map.has(key)) {
			map.set(key, []);
		}
		map.get(key).push(value);
	}

	function findSubsequence(values, sequence) {
		for (let start = 0; start <= values.length - sequence.length; start += 1) {
			if (sequence.every((item, index) => values[start + index] === item)) {
				return start;
			}
		}
		return -1;
	}

	function compareByDepthAndName(left, right) {
		return (left.depth - right.depth) || left.name.localeCompare(right.name, "de");
	}

	function buildColorUpdates(root, descendants) {
		const rowsByDepth = new Map();
		for (const row of descendants) {
			const depth = Math.max(1, Number(row.depth || 1));
			addToMapList(rowsByDepth, depth, row);
		}
		const updates = [];
		for (const depth of [...rowsByDepth.keys()].sort((a, b) => a - b)) {
			const rows = rowsByDepth.get(depth);
			for (let index = 0; index < rows.length; index += 1) {
				const row = rows[index];
				updates.push({
					territoryPublicId: row.publicId,
					name: row.name || row.publicId,
					depth,
					color: createHueVariant(root.color, depth, index, rows.length, row.publicId || row.name)
				});
			}
		}
		return updates.filter(update => update.territoryPublicId);
	}

	function readHueVarianceRange() {
		const min256 = clampNumber(parseOptionalNumber(document.getElementById("hueVarianceMinInput")?.value, 10), 0, 256);
		const max256 = clampNumber(parseOptionalNumber(document.getElementById("hueVarianceMaxInput")?.value, 20), 0, 256);
		const min = Math.min(min256, max256);
		const max = Math.max(min256, max256);
		return { min256: min, max256: max, minDegrees: (min / 256) * 360, maxDegrees: (max / 256) * 360 };
	}

	function createHueVariant(parentColor, depth, siblingIndex, siblingCount, seedText) {
		const rgb = parseHexToRgb(parentColor) || { red: 136, green: 136, blue: 136 };
		const hsv = rgbToHsv(rgb.red, rgb.green, rgb.blue);
		const depthFactor = 1 / (1 + ((Math.max(1, depth) - 1) * 0.45));
		const densityBoost = Math.min(12, Math.max(0, siblingCount - 1) * 0.55);
		const range = readHueVarianceRange();
		let span = Math.min(24, (14 * depthFactor) + (densityBoost * depthFactor));
		span = Math.max(range.minDegrees, Math.min(span, range.maxDegrees));
		const position = siblingCount > 1 ? siblingIndex / (siblingCount - 1) : 0.5;
		const centeredOffset = ((position * 2) - 1) * span;
		const jitter = ((seededUnit(seedText) * 2) - 1) * Math.max(0.75, Math.min(2.5, span * 0.18));
		return hsvToHex((hsv.hue + centeredOffset + jitter + 360) % 360, hsv.saturation, hsv.value);
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
		const normalized = normalizeHexColor(color);
		return normalized ? {
			red: Number.parseInt(normalized.slice(1, 3), 16),
			green: Number.parseInt(normalized.slice(3, 5), 16),
			blue: Number.parseInt(normalized.slice(5, 7), 16)
		} : null;
	}

	function rgbToHsv(red, green, blue) {
		const r = red / 255;
		const g = green / 255;
		const b = blue / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const delta = max - min;
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
		const chroma = value * saturation;
		const huePrime = hue / 60;
		const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
		const match = value - chroma;
		const [r, g, b] = huePrime < 1 ? [chroma, secondary, 0] : huePrime < 2 ? [secondary, chroma, 0] : huePrime < 3 ? [0, chroma, secondary] : huePrime < 4 ? [0, secondary, chroma] : huePrime < 5 ? [secondary, 0, chroma] : [chroma, 0, secondary];
		return `#${[r, g, b].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
	}

	function renderPreview(plan) {
		const preview = document.getElementById("deferredColorHierarchyPreview");
		if (!preview) {
			return;
		}
		preview.hidden = false;
		if (!plan || plan.updates.length < 1) {
			preview.innerHTML = `<div class="deferred-subtree-empty">Keine Unterregionen fuer das aktive Breadcrumb gefunden.</div>`;
			return;
		}
		const byDepth = new Map();
		for (const update of plan.updates) {
			addToMapList(byDepth, update.depth, update);
		}
		const rows = [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([depth, updates]) => {
			const swatches = updates.map(update => {
				const title = `${update.name}: ${update.color}`;
				return `<span class="deferred-subtree-swatch" style="background:${escapeHtml(update.color)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"></span>`;
			}).join("");
			return `<tr><th>${depth} ${depth === 1 ? "Ebene" : "Ebenen"}</th><td><div class="deferred-subtree-swatches">${swatches}</div></td></tr>`;
		}).join("");
		preview.innerHTML = `<div class="deferred-subtree-preview-title">Geplante Farben ab „${escapeHtml(plan.root.name)}“</div><table class="deferred-subtree-table"><thead><tr><th>Tiefe</th><th>Farbe pro Ebene</th></tr></thead><tbody>${rows}</tbody></table>`;
	}

	async function saveWithDeferredInheritance(value) {
		const result = typeof externalOnSave === "function" ? await externalOnSave(value) : await window.AvesmapsPoliticalTerritoryAssignment.__avesmapsOriginalSave?.(value);
		const messages = [];
		const root = readRootSelection();
		if (root && document.getElementById("inheritColorToDescendantsCheckbox")?.checked) {
			const range = readHueVarianceRange();
			const colorResult = await submitSubtreeUpdate({
				action: "inherit_colors",
				root_territory_id: root.territoryId,
				root_territory_public_id: root.territoryPublicId,
				color: root.color,
				hue_variance_min_256: range.min256,
				hue_variance_max_256: range.max256
			});
			messages.push(formatInheritanceMessage("Farbhierarchie", colorResult));
		}
		if (root && document.getElementById("inheritOpacityToDescendantsCheckbox")?.checked) {
			const opacityResult = await submitSubtreeUpdate({
				action: "inherit_opacity",
				root_territory_id: root.territoryId,
				root_territory_public_id: root.territoryPublicId,
				opacity: root.opacity
			});
			messages.push(formatInheritanceMessage("Transparenz", opacityResult));
		}
		if (messages.length > 0) {
			window.parent?.loadPoliticalTerritoryOptions?.({ force: true });
			window.parent?.schedulePoliticalTerritoryLayerReload?.({ immediate: true });
			return { ...(result || {}), message: `${result?.message || "Gespeichert."} ${messages.join(" ")}` };
		}
		return result;
	}

	async function submitSubtreeUpdate(payload) {
		const response = await fetch(SUBTREE_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json", "Accept": "application/json" },
			body: JSON.stringify(payload)
		});
		const result = await response.json().catch(() => null);
		if (!response.ok || result?.ok === false) {
			throw new Error(result?.error || `Subtree-Aktualisierung fehlgeschlagen: HTTP ${response.status}`);
		}
		return result || {};
	}

	function formatInheritanceMessage(label, result) {
		return `${label}: ${Number(result?.descendants_count ?? 0)} Unterregionen, ${Number(result?.global_changed ?? 0)} global, ${Number(result?.local_display_changed ?? 0)} lokale Anzeigen.`;
	}

	function patchSave() {
		const module = window.AvesmapsPoliticalTerritoryAssignment;
		if (!module || module.__avesmapsDeferredSubtreeDisplayPatch === true || typeof module.configure !== "function") {
			return;
		}
		const originalConfigure = module.configure.bind(module);
		module.configure = function configureDeferredSubtreeDisplay(options = {}) {
			if (!patchingConfigure && typeof options.onSave === "function" && options.onSave !== saveWithDeferredInheritance) {
				externalOnSave = options.onSave;
			}
			return originalConfigure({ ...options, onSave: saveWithDeferredInheritance });
		};
		module.__avesmapsDeferredSubtreeDisplayPatch = true;
		patchingConfigure = true;
		try {
			module.configure({ onSave: saveWithDeferredInheritance });
		} finally {
			patchingConfigure = false;
		}
	}

	function init() {
		installUi();
		patchSave();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();

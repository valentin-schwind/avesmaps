"use strict";

(function initPoliticalTerritoryDeferredSubtreeDisplayTools() {
	const WIKI_API_URL = "/api/app/political-territory-wiki.php";
	const WRITE_API_URL = "/api/app/political-territories.php?debug_errors=1";
	const SUBTREE_API_URL = "/api/edit/political/subtree-display.php";

	let allTerritoryRows = [];
	let allTerritoryRowsLoaded = false;
	let activeColorPlan = null;
	let activeOpacityPlan = null;
	let externalOnSave = null;
	let isPatchingConfigure = false;

	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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
		if (!Number.isFinite(number)) {
			return min;
		}
		return Math.max(min, Math.min(max, number));
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

	function readAssignmentValue() {
		return window.AvesmapsPoliticalTerritoryAssignment?.getValue?.() || null;
	}

	function setStatus(message, type = "pending") {
		window.AvesmapsPoliticalTerritoryAssignment?.setStatus?.(message, type);
	}

	function escapeHtml(value) {
		return String(value ?? "")
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	function installStyles() {
		if (document.getElementById("deferredSubtreeDisplayStyles")) {
			return;
		}

		const style = document.createElement("style");
		style.id = "deferredSubtreeDisplayStyles";
		style.textContent = `
			.deferred-subtree-controls {
				display: grid;
				gap: 8px;
			}
			.deferred-subtree-checkbox {
				display: inline-flex;
				align-items: center;
				gap: 7px;
				color: var(--muted-2, #806c59);
				font-weight: 700;
			}
			.deferred-subtree-checkbox input {
				width: auto;
				padding: 0;
			}
			.deferred-subtree-preview {
				display: grid;
				gap: 7px;
				margin-top: 4px;
			}
			.deferred-subtree-preview[hidden] {
				display: none !important;
			}
			.deferred-subtree-preview-title {
				color: var(--muted-2, #806c59);
				font-size: 11px;
				font-weight: 700;
			}
			.deferred-subtree-table {
				width: 100%;
				border-collapse: collapse;
				border: 1px solid #dccab8;
				border-radius: 8px;
				overflow: hidden;
				background: #fff;
			}
			.deferred-subtree-table th,
			.deferred-subtree-table td {
				padding: 7px 8px;
				border-bottom: 1px solid #eadbcb;
				vertical-align: top;
				text-align: left;
			}
			.deferred-subtree-table th {
				background: var(--panel-soft, #fffaf5);
				color: #6a5543;
				font-size: 11px;
			}
			.deferred-subtree-table tr:last-child th,
			.deferred-subtree-table tr:last-child td {
				border-bottom: 0;
			}
			.deferred-subtree-swatches {
				display: flex;
				flex-wrap: wrap;
				gap: 5px;
			}
			.deferred-subtree-swatch {
				width: 18px;
				height: 18px;
				border: 1px solid rgba(0, 0, 0, 0.22);
				border-radius: 4px;
				box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25);
			}
			.deferred-subtree-empty {
				color: var(--muted, #6c5a49);
				font-size: 11px;
				line-height: 1.35;
			}
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
		replacement.dataset.deferredSubtreeDisplayTools = "1";
		button.replaceWith(replacement);
		return replacement;
	}

	function createCheckbox(id, text) {
		const label = document.createElement("label");
		label.className = "deferred-subtree-checkbox";
		const input = document.createElement("input");
		input.id = id;
		input.type = "checkbox";
		const span = document.createElement("span");
		span.textContent = text;
		label.append(input, span);
		return label;
	}

	function findSectionByAriaLabel(label) {
		return [...document.querySelectorAll(".manual-data-section")]
			.find(section => normalizeText(section.getAttribute("aria-label")) === label) || null;
	}

	function installUi() {
		installStyles();

		const colorButton = replaceButtonWithoutOldListeners(
			document.getElementById("inheritColorVarianceButton"),
			"Farbhierarchie erstellen"
		);
		const opacityButton = document.getElementById("inheritOpacityButton");
		if (opacityButton) {
			opacityButton.remove();
		}

		const colorSection = findSectionByAriaLabel("Farbe");
		const opacitySection = findSectionByAriaLabel("Transparenz");

		if (colorSection && !document.getElementById("inheritColorToDescendantsCheckbox")) {
			const controls = document.createElement("div");
			controls.className = "deferred-subtree-controls";
			controls.appendChild(createCheckbox("inheritColorToDescendantsCheckbox", "Für alle Unterregionen übernehmen"));
			const row = colorSection.querySelector(".manual-data-variance-row");
			if (row) {
				row.insertAdjacentElement("afterend", controls);
			} else {
				colorSection.appendChild(controls);
			}
		}

		if (colorSection && !document.getElementById("deferredColorHierarchyPreview")) {
			const preview = document.createElement("div");
			preview.id = "deferredColorHierarchyPreview";
			preview.className = "deferred-subtree-preview";
			preview.hidden = true;
			colorSection.appendChild(preview);
		}

		if (opacitySection && !document.getElementById("inheritOpacityToDescendantsCheckbox")) {
			const controls = document.createElement("div");
			controls.className = "deferred-subtree-controls";
			controls.appendChild(createCheckbox("inheritOpacityToDescendantsCheckbox", "Für alle Unterregionen übernehmen"));
			opacitySection.appendChild(controls);
		}

		const oldHint = colorSection?.querySelector(".manual-data-inline-hint");
		if (oldHint) {
			oldHint.textContent = "Hinweis: Die Farbhierarchie wird vorbereitet und erst beim Speichern auf die ausgewählten Unterregionen übertragen.";
		}

		if (colorButton) {
			colorButton.addEventListener("click", (event) => {
				event.preventDefault();
				void createColorHierarchyPlan();
			});
		}

		document.getElementById("inheritColorToDescendantsCheckbox")?.addEventListener("change", syncPreviewVisibility);
		document.getElementById("inheritOpacityToDescendantsCheckbox")?.addEventListener("change", () => {
			activeOpacityPlan = readRootSelectionPlan();
		});
		document.addEventListener("click", () => window.setTimeout(syncButtonVisibility, 0), true);
		document.getElementById("colorInput")?.addEventListener("input", () => {
			if (document.getElementById("inheritColorToDescendantsCheckbox")?.checked) {
				void createColorHierarchyPlan(false);
			}
		});
		syncButtonVisibility();
	}

	function syncButtonVisibility() {
		const button = document.getElementById("inheritColorVarianceButton");
		if (!button) {
			return;
		}
		const value = readAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const activeIndex = getActivePathIndex(value);
		button.hidden = !(activeIndex >= 0 && activeIndex < path.length - 1);
	}

	function syncPreviewVisibility() {
		const preview = document.getElementById("deferredColorHierarchyPreview");
		if (!preview) {
			return;
		}
		preview.hidden = !activeColorPlan;
	}

	async function loadTerritoryRows() {
		if (allTerritoryRowsLoaded) {
			return allTerritoryRows;
		}

		const response = await fetch(WIKI_API_URL, {
			method: "GET",
			credentials: "omit",
			headers: { "Accept": "application/json" }
		});
		const payload = await response.json();
		if (!response.ok || payload?.ok === false) {
			throw new Error(payload?.error || `Herrschaftsgebiete konnten nicht geladen werden: HTTP ${response.status}`);
		}
		allTerritoryRows = (payload.items || []).map(normalizeRow).filter(row => row.name);
		allTerritoryRowsLoaded = true;
		return allTerritoryRows;
	}

	function normalizeRow(row) {
		return {
			...row,
			id: parseOptionalNumber(row.id),
			territoryId: parseOptionalNumber(row.territory_id ?? row.territoryId ?? row.id),
			parentId: parseOptionalNumber(row.parent_id ?? row.parentId),
			territoryPublicId: normalizeText(row.public_id || row.territory_public_id || row.territoryPublicId || row.wiki_key || ""),
			wikiKey: normalizeText(row.wiki_key || ""),
			name: normalizeText(row.name),
			affiliationPath: normalizeAffiliationPath(row)
		};
	}

	function normalizeAffiliationPath(row) {
		const path = Array.isArray(row.affiliation_path)
			? row.affiliation_path
			: Array.isArray(row.affiliation?.path)
			? row.affiliation.path
			: row.affiliation_root
			? [row.affiliation_root]
			: [];
		return path.map(normalizeText).filter(Boolean);
	}

	function getActivePathIndex(value) {
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		if (path.length < 1) {
			return -1;
		}
		const active = value?.activeDisplayNode || null;
		if (active) {
			const activeIndex = path.findIndex(node => sameNodeReference(node, active));
			if (activeIndex >= 0) {
				return activeIndex;
			}
		}
		return path.length - 1;
	}

	function sameNodeReference(left, right) {
		const leftIds = [left?.territoryPublicId, left?.territory_public_id, left?.territoryId, left?.territory_id, left?.wikiKey, left?.key, left?.id, left?.label]
			.map(value => normalizeText(value)).filter(Boolean);
		const rightIds = [right?.territoryPublicId, right?.territory_public_id, right?.territoryId, right?.territory_id, right?.wikiKey, right?.key, right?.id, right?.label]
			.map(value => normalizeText(value)).filter(Boolean);
		return leftIds.some(leftId => rightIds.some(rightId => leftId === rightId || makeKey(leftId) === makeKey(rightId)));
	}

	function readRootSelectionPlan() {
		const value = readAssignmentValue();
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const displays = Array.isArray(value?.displays) ? value.displays : [];
		const activeIndex = getActivePathIndex(value);
		const rootNode = path[activeIndex] || null;
		const rootDisplay = displays[activeIndex] || value?.display || {};
		const colorInput = document.getElementById("colorInput");
		const transparencyInput = document.getElementById("transparencyInput");

		if (!rootNode) {
			return null;
		}

		return {
			activeIndex,
			rootNode,
			rootTerritoryId: parseOptionalNumber(rootNode.territoryId ?? rootNode.territory_id),
			rootTerritoryPublicId: normalizeText(rootNode.territoryPublicId || rootNode.territory_public_id || rootNode.key || ""),
			rootName: normalizeText(rootNode.label || rootDisplay.name || rootDisplay.displayName || ""),
			rootColor: normalizeHexColor(colorInput?.value || rootDisplay.color) || "#888888",
			rootOpacity: clampNumber(parseOptionalNumber(transparencyInput?.value, Math.round((rootDisplay.opacity ?? 0.33) * 100)) / 100, 0, 1)
		};
	}

	async function createColorHierarchyPlan(markCheckbox = true) {
		const root = readRootSelectionPlan();
		if (!root) {
			setStatus("Kein aktives Herrschaftsgebiet ausgewaehlt.", "error");
			return;
		}

		await loadTerritoryRows();
		const descendants = findDescendantRows(root);
		const updates = buildColorUpdates(root, descendants);
		activeColorPlan = {
			root,
			updates,
			rowsByPublicId: new Map(descendants.map(row => [row.territoryPublicId, row]))
		};

		if (markCheckbox) {
			const checkbox = document.getElementById("inheritColorToDescendantsCheckbox");
			if (checkbox) {
				checkbox.checked = true;
			}
		}

		renderColorPreview(activeColorPlan);
		setStatus(`Farbhierarchie vorbereitet: ${updates.length} Unterregionen.`, "pending");
	}

	function findRootRow(root) {
		return allTerritoryRows.find(row => {
			return (root.rootTerritoryPublicId && row.territoryPublicId === root.rootTerritoryPublicId)
				|| (root.rootTerritoryId !== null && row.territoryId === root.rootTerritoryId)
				|| (root.rootName && makeKey(row.name) === makeKey(root.rootName));
		}) || null;
	}

	function findDescendantRows(root) {
		const rootRow = findRootRow(root);
		if (!rootRow) {
			return [];
		}

		const rowsByParentId = new Map();
		for (const row of allTerritoryRows) {
			if (row.parentId === null) {
				continue;
			}
			if (!rowsByParentId.has(row.parentId)) {
				rowsByParentId.set(row.parentId, []);
			}
			rowsByParentId.get(row.parentId).push(row);
		}

		const rootId = rootRow.territoryId || rootRow.id;
		const byParent = [];
		if (rootId !== null && rowsByParentId.size > 0) {
			const stack = (rowsByParentId.get(rootId) || []).map(row => ({ row, depth: 1 }));
			const visited = new Set();
			while (stack.length > 0) {
				const current = stack.pop();
				const key = current.row.territoryPublicId || current.row.id || current.row.name;
				if (visited.has(key)) {
					continue;
				}
				visited.add(key);
				byParent.push({ ...current.row, relativeDepth: current.depth });
				const childRootId = current.row.territoryId || current.row.id;
				for (const child of rowsByParentId.get(childRootId) || []) {
					stack.push({ row: child, depth: current.depth + 1 });
				}
			}
		}

		if (byParent.length > 0) {
			return byParent.sort(compareRowsByDepthAndName);
		}

		const rootKey = makeKey(rootRow.name);
		return allTerritoryRows
			.map(row => {
				const pathKeys = row.affiliationPath.map(makeKey);
				const rootIndex = pathKeys.indexOf(rootKey);
				return rootIndex >= 0 ? { ...row, relativeDepth: pathKeys.length - rootIndex } : null;
			})
			.filter(row => row && row.territoryPublicId !== rootRow.territoryPublicId)
			.sort(compareRowsByDepthAndName);
	}

	function compareRowsByDepthAndName(a, b) {
		return (a.relativeDepth - b.relativeDepth) || a.name.localeCompare(b.name, "de");
	}

	function buildColorUpdates(root, descendants) {
		const groupedByDepth = new Map();
		for (const row of descendants) {
			const depth = Math.max(1, Number(row.relativeDepth || 1));
			if (!groupedByDepth.has(depth)) {
				groupedByDepth.set(depth, []);
			}
			groupedByDepth.get(depth).push(row);
		}

		const updates = [];
		const parentColorByDepth = new Map([[0, root.rootColor]]);
		for (const depth of [...groupedByDepth.keys()].sort((a, b) => a - b)) {
			const rows = groupedByDepth.get(depth);
			const parentColor = parentColorByDepth.get(depth - 1) || root.rootColor;
			for (let index = 0; index < rows.length; index += 1) {
				const row = rows[index];
				const color = createHueVariant(parentColor, depth, index, rows.length, row.territoryPublicId || row.name);
				updates.push({
					territoryPublicId: row.territoryPublicId,
					name: row.name,
					depth,
					color
				});
				if (!parentColorByDepth.has(depth)) {
					parentColorByDepth.set(depth, color);
				}
			}
		}
		return updates.filter(update => update.territoryPublicId);
	}

	function createHueVariant(parentColor, depth, siblingIndex, siblingCount, seedText) {
		const rgb = parseHexToRgb(parentColor) || { red: 136, green: 136, blue: 136 };
		const hsv = rgbToHsv(rgb.red, rgb.green, rgb.blue);
		const depthLevel = Math.max(1, depth);
		const safeSiblingCount = Math.max(1, siblingCount);
		const safeSiblingIndex = Math.max(0, Math.min(safeSiblingCount - 1, siblingIndex));
		const depthFactor = 1 / (1 + ((depthLevel - 1) * 0.45));
		const baseSpan = 14 * depthFactor;
		const densityBoost = Math.min(12, Math.max(0, safeSiblingCount - 1) * 0.55);
		let hueSpan = Math.min(24, baseSpan + (densityBoost * depthFactor));
		const range = readHueVarianceRange();
		hueSpan = Math.max(range.minDegrees, Math.min(hueSpan, range.maxDegrees));
		let centeredOffset = 0;
		if (safeSiblingCount > 1) {
			const position = safeSiblingIndex / (safeSiblingCount - 1);
			centeredOffset = ((position * 2) - 1) * hueSpan;
		}
		const jitterLimit = Math.max(0.75, Math.min(2.5, hueSpan * 0.18));
		const jitter = ((seededUnit(seedText) * 2) - 1) * jitterLimit;
		return hsvToHex((hsv.hue + centeredOffset + jitter + 360) % 360, hsv.saturation, hsv.value);
	}

	function readHueVarianceRange() {
		const minInput = document.getElementById("hueVarianceMinInput");
		const maxInput = document.getElementById("hueVarianceMaxInput");
		const min256 = clampNumber(parseOptionalNumber(minInput?.value, 10), 0, 256);
		const max256 = clampNumber(parseOptionalNumber(maxInput?.value, 20), 0, 256);
		const normalizedMin = Math.min(min256, max256);
		const normalizedMax = Math.max(min256, max256);
		return {
			min256: normalizedMin,
			max256: normalizedMax,
			minDegrees: (normalizedMin / 256) * 360,
			maxDegrees: (normalizedMax / 256) * 360
		};
	}

	function seededUnit(value) {
		let hash = 2166136261;
		const text = String(value || "");
		for (let index = 0; index < text.length; index += 1) {
			hash ^= text.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}
		return (hash >>> 0) / 4294967295;
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
		const r = clampNumber(red, 0, 255) / 255;
		const g = clampNumber(green, 0, 255) / 255;
		const b = clampNumber(blue, 0, 255) / 255;
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const delta = max - min;
		let hue = 0;
		if (delta > 0) {
			if (max === r) {
				hue = ((g - b) / delta) % 6;
			} else if (max === g) {
				hue = ((b - r) / delta) + 2;
			} else {
				hue = ((r - g) / delta) + 4;
			}
			hue *= 60;
			if (hue < 0) {
				hue += 360;
			}
		}
		return {
			hue,
			saturation: max <= 0 ? 0 : delta / max,
			value: max
		};
	}

	function hsvToHex(hue, saturation, value) {
		const s = clampNumber(saturation, 0, 1);
		const v = clampNumber(value, 0, 1);
		const h = ((hue % 360) + 360) % 360;
		const chroma = v * s;
		const huePrime = h / 60;
		const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
		const match = v - chroma;
		const [r, g, b] = huePrime < 1
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
		return `#${[r, g, b].map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
	}

	function renderColorPreview(plan) {
		const preview = document.getElementById("deferredColorHierarchyPreview");
		if (!preview) {
			return;
		}

		if (!plan || plan.updates.length < 1) {
			preview.hidden = false;
			preview.innerHTML = `<div class="deferred-subtree-empty">Keine Unterregionen fuer das aktive Breadcrumb gefunden.</div>`;
			return;
		}

		const rowsByDepth = new Map();
		for (const update of plan.updates) {
			if (!rowsByDepth.has(update.depth)) {
				rowsByDepth.set(update.depth, []);
			}
			rowsByDepth.get(update.depth).push(update);
		}

		const tableRows = [...rowsByDepth.entries()].sort((a, b) => a[0] - b[0]).map(([depth, updates]) => {
			const swatches = updates.map(update => {
				const title = `${update.name || update.territoryPublicId}: ${update.color}`;
				return `<span class="deferred-subtree-swatch" style="background:${escapeHtml(update.color)}" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"></span>`;
			}).join("");
			return `<tr><th>${depth} ${depth === 1 ? "Ebene" : "Ebenen"}</th><td><div class="deferred-subtree-swatches">${swatches}</div></td></tr>`;
		}).join("");

		preview.hidden = false;
		preview.innerHTML = `
			<div class="deferred-subtree-preview-title">Geplante Farben ab „${escapeHtml(plan.root.rootName)}“</div>
			<table class="deferred-subtree-table">
				<thead><tr><th>Tiefe</th><th>Farbe pro Ebene</th></tr></thead>
				<tbody>${tableRows}</tbody>
			</table>
		`;
	}

	async function saveWithDeferredInheritance(value) {
		const saveResult = typeof externalOnSave === "function"
			? await externalOnSave(value)
			: await defaultSaveAssignment(value);

		const inheritanceMessages = [];
		if (document.getElementById("inheritColorToDescendantsCheckbox")?.checked) {
			if (!activeColorPlan) {
				await createColorHierarchyPlan(false);
			}
			const root = activeColorPlan?.root || readRootSelectionPlan();
			if (root) {
				const result = await submitSubtreeUpdate({
					action: "inherit_colors",
					root_territory_id: root.rootTerritoryId,
					root_territory_public_id: root.rootTerritoryPublicId,
					color: root.rootColor,
					hue_variance_min_256: readHueVarianceRange().min256,
					hue_variance_max_256: readHueVarianceRange().max256
				});
				inheritanceMessages.push(buildInheritanceMessage("Farbhierarchie", result));
			}
		}

		if (document.getElementById("inheritOpacityToDescendantsCheckbox")?.checked) {
			const root = activeOpacityPlan || readRootSelectionPlan();
			if (root) {
				const result = await submitSubtreeUpdate({
					action: "inherit_opacity",
					root_territory_id: root.rootTerritoryId,
					root_territory_public_id: root.rootTerritoryPublicId,
					opacity: root.rootOpacity
				});
				inheritanceMessages.push(buildInheritanceMessage("Transparenz", result));
			}
		}

		if (inheritanceMessages.length > 0) {
			try {
				window.parent?.loadPoliticalTerritoryOptions?.({ force: true });
				window.parent?.schedulePoliticalTerritoryLayerReload?.({ immediate: true });
			} catch (error) {
				console.warn("Herrschaftsgebiet-Layer konnte nach Vererbung nicht direkt neu geladen werden:", error);
			}
			return {
				...(saveResult || {}),
				message: `${saveResult?.message || "Gespeichert."} ${inheritanceMessages.join(" ")}`
			};
		}

		return saveResult;
	}

	async function defaultSaveAssignment(value) {
		const params = new URLSearchParams(window.location.search);
		const geometryPublicId = normalizeText(params.get("geometry_public_id") || "");
		if (!geometryPublicId) {
			throw new Error("Die Geometrie-ID fehlt. Öffnen Sie den Editor über Rechtsklick auf ein Herrschaftsgebiet.");
		}

		const assignedPath = Array.isArray(value.assignedPath) ? value.assignedPath : [];
		const displays = Array.isArray(value.displays) ? value.displays : [];
		const wikiPublicIds = assignedPath.map(node => normalizeText(node.wikiKey || "")).filter(Boolean);
		const territoryPublicIds = assignedPath.map(node => normalizeText(node.territoryPublicId || "")).filter(Boolean);
		const hasAssignedTerritory = assignedPath.length > 0 && (wikiPublicIds.length > 0 || territoryPublicIds.length > 0);
		const displayNameInput = document.getElementById("displayNameInput");
		const alternateCoatInput = document.getElementById("alternateCoatInput");
		const colorInput = document.getElementById("colorInput");
		const transparencyInput = document.getElementById("transparencyInput");
		const startYearInput = document.getElementById("startYearInput");
		const endYearInput = document.getElementById("endYearInput");
		const existsUntilTodayInput = document.getElementById("existsUntilTodayInput");
		const rawEndYear = normalizeText(endYearInput?.value || "");
		const isOpenEnded = Boolean(existsUntilTodayInput?.checked) || rawEndYear === "";

		const display = {
			...(value.display || {}),
			name: normalizeText(displayNameInput?.value || value.display?.name || value.display?.displayName || params.get("name") || ""),
			displayName: normalizeText(displayNameInput?.value || value.display?.displayName || value.display?.name || params.get("name") || ""),
			coatOfArmsUrl: normalizeText(alternateCoatInput?.value || value.display?.coatOfArmsUrl || ""),
			zoomMin: parseOptionalNumber(document.getElementById("zoomFromInput")?.value, value.display?.zoomMin ?? parseOptionalNumber(params.get("min_zoom"))),
			zoomMax: parseOptionalNumber(document.getElementById("zoomToInput")?.value, value.display?.zoomMax ?? parseOptionalNumber(params.get("max_zoom"))),
			color: normalizeHexColor(colorInput?.value || value.display?.color || params.get("color")) || "#888888",
			opacity: parseOptionalNumber(transparencyInput?.value, Math.round((value.display?.opacity ?? parseOptionalNumber(params.get("opacity"), 0.33)) * 100)) / 100
		};
		const validity = {
			...(value.validity || {}),
			startYear: parseOptionalNumber(startYearInput?.value, value.validity?.startYear ?? parseOptionalNumber(params.get("valid_from_bf"))),
			endYear: isOpenEnded ? null : parseOptionalNumber(rawEndYear),
			existsUntilToday: isOpenEnded
		};

		const response = await fetch(WRITE_API_URL, {
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
					opacity: display.opacity
				},
				validity: {
					startYear: validity.startYear,
					endYear: validity.endYear,
					existsUntilToday: validity.existsUntilToday
				},
				wiki_public_ids: wikiPublicIds,
				territory_public_ids: territoryPublicIds,
				wiki_nodes: assignedPath.map((node, index) => {
					const displayState = displays[index] || {};
					return {
						key: wikiPublicIds[index] || node.wikiKey || node.territoryPublicId || node.id || node.key || node.label || "",
						territoryPublicId: node.territoryPublicId || "",
						territoryId: node.territoryId || null,
						name: displayState.displayName || node.label || node.key || "",
						type: node.kind || "Herrschaftsgebiet",
						status: "",
						coat_of_arms_url: displayState.coatOfArmsUrl || "",
						wiki_url: ""
					};
				}),
				assignment: value
			})
		});

		const result = await response.json().catch(() => ({ ok: response.ok }));
		if (!response.ok || result?.ok === false) {
			throw new Error(result?.error || `Speichern fehlgeschlagen: HTTP ${response.status}`);
		}
		return result;
	}

	async function submitSubtreeUpdate(payload) {
		const response = await fetch(SUBTREE_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json"
			},
			body: JSON.stringify(payload)
		});
		const result = await response.json().catch(() => null);
		if (!response.ok || result?.ok === false) {
			throw new Error(result?.error || `Subtree-Aktualisierung fehlgeschlagen: HTTP ${response.status}`);
		}
		return result || {};
	}

	function buildInheritanceMessage(label, result) {
		const descendants = Number(result?.descendants_count ?? result?.received ?? 0);
		const globalChanged = Number(result?.global_changed ?? result?.changed ?? 0);
		const localDisplayChanged = Number(result?.local_display_changed ?? 0);
		return `${label}: ${descendants} Unterregionen, ${globalChanged} global, ${localDisplayChanged} lokale Anzeigen.`;
	}

	function patchAssignmentSave() {
		const module = window.AvesmapsPoliticalTerritoryAssignment;
		if (!module || module.__avesmapsDeferredSubtreeDisplayPatch === true || typeof module.configure !== "function") {
			return;
		}

		const originalConfigure = module.configure.bind(module);
		module.configure = function configureDeferredSubtreeDisplay(options = {}) {
			if (isPatchingConfigure) {
				return originalConfigure(options);
			}
			if (typeof options.onSave === "function" && options.onSave !== saveWithDeferredInheritance) {
				externalOnSave = options.onSave;
			}
			return originalConfigure({
				...options,
				onSave: saveWithDeferredInheritance
			});
		};
		module.__avesmapsDeferredSubtreeDisplayPatch = true;

		isPatchingConfigure = true;
		try {
			module.configure({ onSave: saveWithDeferredInheritance });
		} finally {
			isPatchingConfigure = false;
		}
	}

	function init() {
		installUi();
		patchAssignmentSave();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();

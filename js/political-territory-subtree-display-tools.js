"use strict";

(function initPoliticalTerritorySubtreeDisplayTools() {
	const API_URL = "/api/political-territory-subtree-display.php";
	const WIKI_API_URL = "/api/political-territory-wiki.php";
	let rowsPromise = null;

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

	function canonicalLabel(value) {
		return normalizeText(value).replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
	}

	function normalizeAffiliationPath(row = {}) {
		const candidatePaths = [
			row.affiliation_path,
			row.affiliation && Array.isArray(row.affiliation.path) ? row.affiliation.path : null,
			row.affiliation_root ? [row.affiliation_root] : null,
			row.affiliation_raw ? [normalizeText(row.affiliation_raw || row.political).split(":")[0]] : null,
		];

		for (const candidatePath of candidatePaths) {
			if (!Array.isArray(candidatePath)) continue;
			const parts = candidatePath.map(canonicalLabel).filter(Boolean);
			if (parts.length > 0) return parts;
		}

		return [];
	}

	function buildRowPath(row = {}) {
		const path = normalizeAffiliationPath(row);
		const name = canonicalLabel(row.name || "");
		if (!name) return path;
		if (path.length < 1 || makeKey(path[path.length - 1]) !== makeKey(name)) {
			path.push(name);
		}
		return path;
	}

	function getActiveBreadcrumbPath() {
		const manualPath = document.getElementById("manualEditPath");
		const buttons = [...(manualPath?.querySelectorAll("button") || [])];
		const activeIndex = buttons.findIndex((button) => button.classList.contains("is-active"));
		if (activeIndex < 0) return [];
		return buttons.slice(0, activeIndex + 1).map((button) => canonicalLabel(button.textContent || "")).filter(Boolean);
	}

	function isPathPrefix(prefix, fullPath) {
		if (prefix.length < 1 || fullPath.length <= prefix.length) return false;
		return prefix.every((part, index) => makeKey(part) === makeKey(fullPath[index] || ""));
	}

	async function loadRows() {
		if (!rowsPromise) {
			rowsPromise = fetch(WIKI_API_URL, {
				method: "GET",
				credentials: "omit",
				headers: { "Accept": "application/json" },
			}).then(async (response) => {
				const payload = await response.json();
				if (!response.ok || payload?.ok === false) {
					throw new Error(payload?.error || `Wiki-Daten konnten nicht geladen werden: HTTP ${response.status}`);
				}
				return (Array.isArray(payload?.items) ? payload.items : [])
					.map((row) => ({ ...row, __path: buildRowPath(row) }))
					.filter((row) => row.__path.length > 0);
			});
		}
		return rowsPromise;
	}

	function parseHexToRgb(color) {
		const normalized = normalizeText(color);
		if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) return null;
		return {
			red: Number.parseInt(normalized.slice(1, 3), 16),
			green: Number.parseInt(normalized.slice(3, 5), 16),
			blue: Number.parseInt(normalized.slice(5, 7), 16),
		};
	}

	function clampNumber(value, min, max) {
		const number = Number(value);
		if (!Number.isFinite(number)) return min;
		return Math.max(min, Math.min(max, number));
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
			if (max === r) hue = ((g - b) / delta) % 6;
			else if (max === g) hue = ((b - r) / delta) + 2;
			else hue = ((r - g) / delta) + 4;
		}

		return {
			hue: modulo(hue * 60, 360),
			saturation: max === 0 ? 0 : (delta / max) * 100,
			value: max * 100,
		};
	}

	function hsvToHex(hue, saturationPercent, valuePercent) {
		const saturation = clampNumber(saturationPercent, 0, 100) / 100;
		const value = clampNumber(valuePercent, 0, 100) / 100;
		const chroma = value * saturation;
		const huePrime = modulo(hue, 360) / 60;
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
		return `#${[red, green, blue].map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
	}

	function modulo(value, divisor) {
		const result = value % divisor;
		return result < 0 ? result + divisor : result;
	}

	function randomSignedHsvOffset(min256 = 10, max256 = 20) {
		const magnitude = min256 + Math.random() * (max256 - min256);
		return (Math.random() < 0.5 ? -1 : 1) * (magnitude / 256) * 360;
	}

	function createHueVariant(parentColor) {
		const rgb = parseHexToRgb(parentColor);
		if (!rgb) return "#888888";
		const hsv = rgbToHsv(rgb.red, rgb.green, rgb.blue);
		return hsvToHex(
			modulo(hsv.hue + randomSignedHsvOffset(10, 20), 360),
			hsv.saturation,
			hsv.value
		);
	}

	function createVirtualNode(path) {
		return {
			path,
			row: null,
			children: new Map(),
		};
	}

	function buildVirtualSubtree(rows, selectedPath) {
		const root = createVirtualNode([...selectedPath]);
		const descendants = rows.filter((row) => isPathPrefix(selectedPath, row.__path));

		for (const row of descendants) {
			let node = root;
			for (let index = selectedPath.length; index < row.__path.length; index += 1) {
				const segment = row.__path[index];
				const key = makeKey(segment);
				if (!node.children.has(key)) {
					node.children.set(key, createVirtualNode(row.__path.slice(0, index + 1)));
				}
				node = node.children.get(key);
			}

			if (normalizeText(row.public_id || "")) {
				node.row = row;
			}
		}

		return {
			root,
			descendants: descendants.filter((row) => normalizeText(row.public_id || "")),
		};
	}

	function collectColorUpdatesFromVirtualNode(node, parentColor, updates = []) {
		for (const child of node.children.values()) {
			const color = createHueVariant(parentColor);
			if (child.row && normalizeText(child.row.public_id || "")) {
				updates.push({ territory_public_id: normalizeText(child.row.public_id), color });
			}
			collectColorUpdatesFromVirtualNode(child, color, updates);
		}

		return updates;
	}

	function buildOpacityUpdates(descendants, opacity) {
		return descendants.map((row) => ({
			territory_public_id: normalizeText(row.public_id),
			opacity,
		}));
	}

	async function submit(action, updates) {
		const response = await fetch(API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				"Content-Type": "application/json",
				"Accept": "application/json",
			},
			body: JSON.stringify({ action, updates }),
		});
		const result = await response.json().catch(() => null);
		if (!response.ok || result?.ok === false) {
			throw new Error(result?.error || `Subtree-Aktualisierung fehlgeschlagen: HTTP ${response.status}`);
		}
		return result;
	}

	function setStatus(message, type = "pending") {
		const module = window.AvesmapsPoliticalTerritoryAssignment;
		if (typeof module?.setStatus === "function") module.setStatus(message, type);
	}

	function getSelectedColor() {
		const color = normalizeText(document.getElementById("colorInput")?.value || "");
		return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#888888";
	}

	function getSelectedOpacity() {
		const percent = Number(document.getElementById("transparencyInput")?.value);
		return Number.isFinite(percent) ? clampNumber(percent / 100, 0, 1) : 0.33;
	}

	function notifyParentDisplayUpdated() {
		window.parent?.postMessage({ type: "avesmaps:political-territory-subtree-display-updated" }, window.location.origin);
		try {
			window.parent?.loadPoliticalTerritoryOptions?.({ force: true });
			window.parent?.schedulePoliticalTerritoryLayerReload?.({ immediate: true });
		} catch (error) {
			console.warn("Politische Gebietsebene konnte nicht direkt neu geladen werden:", error);
		}
	}

	async function inheritColorVariance() {
		const selectedPath = getActiveBreadcrumbPath();
		if (selectedPath.length < 1) return;

		setStatus("Berechne Farbtonvarianz fuer Untergebiete ...", "pending");
		const rows = await loadRows();
		const tree = buildVirtualSubtree(rows, selectedPath);
		const updates = collectColorUpdatesFromVirtualNode(tree.root, getSelectedColor());

		if (updates.length < 1) {
			setStatus("Keine Untergebiete mit globalem Datensatz gefunden.", "pending");
			return;
		}

		await submit("update_colors", updates);
		setStatus(`Farbtonvarianz fuer ${updates.length} Untergebiete global gespeichert.`, "success");
		notifyParentDisplayUpdated();
	}

	async function inheritOpacity() {
		const selectedPath = getActiveBreadcrumbPath();
		if (selectedPath.length < 1) return;

		setStatus("Uebertrage Transparenz auf Untergebiete ...", "pending");
		const rows = await loadRows();
		const tree = buildVirtualSubtree(rows, selectedPath);
		const updates = buildOpacityUpdates(tree.descendants, getSelectedOpacity());

		if (updates.length < 1) {
			setStatus("Keine Untergebiete mit globalem Datensatz gefunden.", "pending");
			return;
		}

		await submit("update_opacity", updates);
		setStatus(`Transparenz fuer ${updates.length} Untergebiete global gespeichert.`, "success");
		notifyParentDisplayUpdated();
	}

	function getOrCreateOpacityButton(colorButton) {
		const existingButton = document.getElementById("inheritOpacityButton");
		if (existingButton) {
			existingButton.textContent = "Transparenz vererben";
			existingButton.className = colorButton.className;
			return existingButton;
		}

		const button = document.createElement("button");
		button.id = "inheritOpacityButton";
		button.className = colorButton.className;
		button.type = "button";
		button.hidden = colorButton.hidden;
		button.textContent = "Transparenz vererben";
		colorButton.insertAdjacentElement("afterend", button);
		return button;
	}

	function syncButtons() {
		const colorButton = document.getElementById("inheritColorVarianceButton");
		if (!colorButton || colorButton.dataset.subtreeDisplayTools === "1") return;
		colorButton.dataset.subtreeDisplayTools = "1";
		colorButton.textContent = "Farbtonvarianz vererben";

		const opacityButton = getOrCreateOpacityButton(colorButton);
		opacityButton.dataset.subtreeDisplayTools = "1";

		colorButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			void inheritColorVariance().catch((error) => {
				console.error("Farbtonvarianz konnte nicht vererbt werden:", error);
				setStatus(error.message || "Farbtonvarianz konnte nicht vererbt werden.", "error");
			});
		}, true);

		opacityButton.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			void inheritOpacity().catch((error) => {
				console.error("Transparenz konnte nicht vererbt werden:", error);
				setStatus(error.message || "Transparenz konnte nicht vererbt werden.", "error");
			});
		}, true);

		const observer = new MutationObserver(() => {
			opacityButton.hidden = colorButton.hidden;
		});
		observer.observe(colorButton, { attributes: true, attributeFilter: ["hidden"] });
		opacityButton.hidden = colorButton.hidden;
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", syncButtons, { once: true });
	} else {
		syncButtons();
	}
})();

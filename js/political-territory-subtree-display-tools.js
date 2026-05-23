"use strict";

(function initPoliticalTerritorySubtreeDisplayTools() {
	const API_URL = "/api/political-territory-subtree-display.php";
	let activeBreadcrumbTerritoryPublicId = "";
	let activeBreadcrumbIndex = -1;

	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function clampNumber(value, min, max) {
		const number = Number(value);
		if (!Number.isFinite(number)) {
			return min;
		}
		return Math.max(min, Math.min(max, number));
	}

	function setStatus(message, type = "pending") {
		const module = window.AvesmapsPoliticalTerritoryAssignment;
		if (typeof module?.setStatus === "function") {
			module.setStatus(message, type);
		}
	}

	function readAssignmentValue() {
		return window.AvesmapsPoliticalTerritoryAssignment?.getValue?.() || null;
	}

	function getDisplayForTerritoryPublicId(territoryPublicId) {
		const value = readAssignmentValue();
		const displays = Array.isArray(value?.displays) ? value.displays : [];
		return displays.find(display => normalizeText(display?.territoryPublicId || display?.territory_public_id || "") === territoryPublicId) || null;
	}

	function getSelectedColor(rootTerritoryPublicId = "") {
		const value = readAssignmentValue();
		const activeDisplayNodePublicId = normalizeText(value?.activeDisplayNode?.territoryPublicId || "");
		const inputColor = normalizeText(document.getElementById("colorInput")?.value || "");
		if (rootTerritoryPublicId && activeDisplayNodePublicId === rootTerritoryPublicId && /^#[0-9a-fA-F]{6}$/.test(inputColor)) {
			return inputColor;
		}

		const displayColor = normalizeText(getDisplayForTerritoryPublicId(rootTerritoryPublicId)?.color || "");
		if (/^#[0-9a-fA-F]{6}$/.test(displayColor)) {
			return displayColor;
		}

		return /^#[0-9a-fA-F]{6}$/.test(inputColor) ? inputColor : "#888888";
	}

	function getSelectedOpacity(rootTerritoryPublicId = "") {
		const value = readAssignmentValue();
		const activeDisplayNodePublicId = normalizeText(value?.activeDisplayNode?.territoryPublicId || "");
		const percent = Number(document.getElementById("transparencyInput")?.value);
		if (rootTerritoryPublicId && activeDisplayNodePublicId === rootTerritoryPublicId && Number.isFinite(percent)) {
			return clampNumber(percent / 100, 0, 1);
		}

		const displayOpacity = Number(getDisplayForTerritoryPublicId(rootTerritoryPublicId)?.opacity);
		if (Number.isFinite(displayOpacity)) {
			return clampNumber(displayOpacity, 0, 1);
		}

		return Number.isFinite(percent) ? clampNumber(percent / 100, 0, 1) : 0.33;
	}

	function getRootTerritoryPublicId() {
		const value = readAssignmentValue();
		const assignedPath = Array.isArray(value?.assignedPath) ? value.assignedPath : [];

		if (activeBreadcrumbIndex >= 0 && assignedPath[activeBreadcrumbIndex]) {
			const publicId = normalizeText(assignedPath[activeBreadcrumbIndex]?.territoryPublicId || "");
			if (publicId) {
				activeBreadcrumbTerritoryPublicId = publicId;
				return publicId;
			}
		}

		if (activeBreadcrumbTerritoryPublicId) {
			return activeBreadcrumbTerritoryPublicId;
		}

		return normalizeText(
			value?.activeDisplayNode?.territoryPublicId
			|| value?.display?.territoryPublicId
			|| ""
		);
	}

	function rememberActiveBreadcrumbFromButton(button) {
		const container = button?.closest?.("#breadcrumb, #manualEditPath");
		if (!container) {
			return;
		}

		const buttons = [...container.querySelectorAll("button")];
		const index = buttons.indexOf(button);
		if (index < 0) {
			return;
		}

		const value = readAssignmentValue();
		const assignedPath = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const publicId = normalizeText(assignedPath[index]?.territoryPublicId || "");
		if (!publicId) {
			return;
		}

		activeBreadcrumbIndex = index;
		activeBreadcrumbTerritoryPublicId = publicId;
	}

	function installActiveBreadcrumbTracker() {
		document.addEventListener("click", (event) => {
			const button = event.target?.closest?.("#breadcrumb button, #manualEditPath button");
			if (button) {
				rememberActiveBreadcrumbFromButton(button);
			}
		}, true);
	}

	async function submit(payload) {
		const response = await fetch(API_URL, {
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

	function normalizeUpdateList(result, key) {
		const updates = Array.isArray(result?.updates) ? result.updates : [];
		const normalized = [];

		for (const update of updates) {
			const territoryPublicId = normalizeText(update?.territoryPublicId || update?.territory_public_id || "");
			if (!territoryPublicId || !(key in (update || {}))) {
				continue;
			}
			normalized.push({ territoryPublicId, [key]: update[key] });
		}

		return normalized;
	}

	function applyDisplayUpdatesToOpenEditor(updates) {
		if (!Array.isArray(updates) || updates.length < 1) {
			return false;
		}

		const assignmentModule = window.AvesmapsPoliticalTerritoryAssignment;
		if (typeof assignmentModule?.getValue !== "function" || typeof assignmentModule?.setValue !== "function") {
			return false;
		}

		const value = assignmentModule.getValue();
		const displays = Array.isArray(value?.displays) ? value.displays : [];
		if (displays.length < 1) {
			return false;
		}

		const updatesByPublicId = new Map(updates.map(update => [update.territoryPublicId, update]));
		let changed = false;
		const nextDisplays = displays.map(display => {
			const territoryPublicId = normalizeText(display?.territoryPublicId || display?.territory_public_id || "");
			const update = updatesByPublicId.get(territoryPublicId);
			if (!update) {
				return display;
			}

			changed = true;
			return {
				...display,
				...(typeof update.color === "string" ? { color: update.color } : {}),
				...(Number.isFinite(Number(update.opacity)) ? { opacity: Number(update.opacity) } : {})
			};
		});

		if (!changed) {
			return false;
		}

		const activePublicId = getRootTerritoryPublicId();
		const activeDisplay = nextDisplays.find(display => normalizeText(display?.territoryPublicId || display?.territory_public_id || "") === activePublicId) || value.display || {};

		assignmentModule.setValue({
			...value,
			displays: nextDisplays,
			display: {
				...value.display,
				...(typeof activeDisplay.color === "string" ? { color: activeDisplay.color } : {}),
				...(Number.isFinite(Number(activeDisplay.opacity)) ? { opacity: Number(activeDisplay.opacity) } : {})
			}
		});
		return true;
	}

	async function reloadEditorAndParentLayers() {
		try {
			window.parent?.loadPoliticalTerritoryOptions?.({ force: true });
			window.parent?.schedulePoliticalTerritoryLayerReload?.({ immediate: true });
		} catch (error) {
			console.warn("Politische Gebietsebene konnte nicht direkt neu geladen werden:", error);
		}

		const assignmentModule = window.AvesmapsPoliticalTerritoryAssignment;
		if (typeof assignmentModule?.reload === "function") {
			try {
				await assignmentModule.reload();
			} catch (error) {
				console.warn("Territory-Assignment-Modul konnte nach Subtree-Update nicht neu geladen werden:", error);
			}
		}
	}

	function buildSuccessMessage(prefix, result) {
		const globalChanged = Number(result?.global_changed ?? result?.changed ?? 0);
		const descendantCount = Number(result?.descendants_count ?? result?.received ?? 0);
		const localGeometryChanged = Number(result?.local_geometry_changed ?? 0);
		const localDisplayChanged = Number(result?.local_display_changed ?? 0);
		return `${prefix} Untergebiete: ${descendantCount}, global: ${globalChanged}, lokal: ${localGeometryChanged} Geometrien / ${localDisplayChanged} Displays.`;
	}

	async function inheritColorVariance() {
		const rootTerritoryPublicId = getRootTerritoryPublicId();
		if (!rootTerritoryPublicId) {
			setStatus("Kein aktives Gebiet mit globaler Territory-ID ausgewaehlt.", "error");
			return;
		}

		setStatus("Vererbe Farbtonvarianz auf Untergebiete ...", "pending");
		const result = await submit({
			action: "inherit_colors",
			root_territory_public_id: rootTerritoryPublicId,
			color: getSelectedColor(rootTerritoryPublicId)
		});
		applyDisplayUpdatesToOpenEditor(normalizeUpdateList(result, "color"));
		await reloadEditorAndParentLayers();
		setStatus(buildSuccessMessage("Farbtonvarianz vererbt.", result), "success");
	}

	async function inheritOpacity() {
		const rootTerritoryPublicId = getRootTerritoryPublicId();
		if (!rootTerritoryPublicId) {
			setStatus("Kein aktives Gebiet mit globaler Territory-ID ausgewaehlt.", "error");
			return;
		}

		setStatus("Vererbe Transparenz auf Untergebiete ...", "pending");
		const result = await submit({
			action: "inherit_opacity",
			root_territory_public_id: rootTerritoryPublicId,
			opacity: getSelectedOpacity(rootTerritoryPublicId)
		});
		applyDisplayUpdatesToOpenEditor(normalizeUpdateList(result, "opacity"));
		await reloadEditorAndParentLayers();
		setStatus(buildSuccessMessage("Transparenz vererbt.", result), "success");
	}

	function wrapAssignmentConfigureForFooterState() {
		const assignmentModule = window.AvesmapsPoliticalTerritoryAssignment;
		if (!assignmentModule || assignmentModule.__avesmapsFooterAssignmentDisplayPatch === true || typeof assignmentModule.configure !== "function") {
			return;
		}

		const originalConfigure = assignmentModule.configure.bind(assignmentModule);
		assignmentModule.configure = function configureWithoutAssignmentDisplayFooter(options = {}) {
			if (!options || typeof options.onAssignmentLoaded !== "function") {
				return originalConfigure(options);
			}

			const originalOnAssignmentLoaded = options.onAssignmentLoaded;
			return originalConfigure({
				...options,
				onAssignmentLoaded: (assignmentInfo = {}) => {
					originalOnAssignmentLoaded({
						...assignmentInfo,
						hasLocalAssignmentDisplays: false
					});
				}
			});
		};
		assignmentModule.__avesmapsFooterAssignmentDisplayPatch = true;
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
		if (!colorButton || colorButton.dataset.subtreeDisplayTools === "1") {
			return;
		}
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

	function init() {
		wrapAssignmentConfigureForFooterState();
		installActiveBreadcrumbTracker();
		syncButtons();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();

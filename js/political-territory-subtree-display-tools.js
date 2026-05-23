"use strict";

(function initPoliticalTerritorySubtreeDisplayTools() {
	const API_URL = "/api/political-territory-subtree-display.php";

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

	function getSelectedColor() {
		const color = normalizeText(document.getElementById("colorInput")?.value || "");
		return /^#[0-9a-fA-F]{6}$/.test(color) ? color : "#888888";
	}

	function getSelectedOpacity() {
		const percent = Number(document.getElementById("transparencyInput")?.value);
		return Number.isFinite(percent) ? clampNumber(percent / 100, 0, 1) : 0.33;
	}

	function getRootTerritoryPublicId() {
		const value = window.AvesmapsPoliticalTerritoryAssignment?.getValue?.();
		return normalizeText(
			value?.activeDisplayNode?.territoryPublicId
			|| value?.display?.territoryPublicId
			|| ""
		);
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
		const localGeometryChanged = Number(result?.local_geometry_changed ?? 0);
		const localDisplayChanged = Number(result?.local_display_changed ?? 0);
		return `${prefix} Global: ${globalChanged}, lokal: ${localGeometryChanged} Geometrien / ${localDisplayChanged} Displays.`;
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
			color: getSelectedColor()
		});
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
			opacity: getSelectedOpacity()
		});
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
		syncButtons();
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", init, { once: true });
	} else {
		init();
	}
})();

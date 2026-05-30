"use strict";

(function initPoliticalTerritorySubtreeDisplayTools() {
	const API_URL = "/api/edit/political/subtree-display.php";

	function normalizeText(value) {
		return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
	}

	function clampNumber(value, min, max) {
		const number = Number(value);
		return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
	}

	function readHueVarianceValue(input, fallback) {
		const rawValue = Number(input?.value);
		if (!Number.isFinite(rawValue)) {
			return fallback;
		}
		return Math.round(clampNumber(rawValue, 0, 256));
	}

	function readHueVarianceRange256() {
		const minInput = document.getElementById("hueVarianceMinInput");
		const maxInput = document.getElementById("hueVarianceMaxInput");
		const minValue = readHueVarianceValue(minInput, 10);
		const maxValue = readHueVarianceValue(maxInput, 20);
		const normalizedMin = Math.min(minValue, maxValue);
		const normalizedMax = Math.max(minValue, maxValue);

		if (minInput) minInput.value = String(normalizedMin);
		if (maxInput) maxInput.value = String(normalizedMax);

		return {
			min256: normalizedMin,
			max256: normalizedMax,
			minDegrees: (normalizedMin / 256) * 360,
			maxDegrees: (normalizedMax / 256) * 360,
		};
	}

	async function submitSubtreeUpdate(payload) {
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

	async function applyColorHierarchy(root, options = {}) {
		const hueVarianceRange = options.hueVarianceRange || readHueVarianceRange256();
		const payload = {
			action: "inherit_colors",
			root_territory_id: root.territoryId ?? null,
			root_territory_public_id: normalizeText(root.territoryPublicId || ""),
			color: root.color,
			hue_variance_min_256: hueVarianceRange.min256,
			hue_variance_max_256: hueVarianceRange.max256
		};
		return submitSubtreeUpdate(payload);
	}

	async function applyExplicitColorUpdates(updates) {
		const payloadUpdates = (Array.isArray(updates) ? updates : [])
			.map(update => ({
				territory_public_id: normalizeText(update.territoryPublicId || update.territory_public_id || ""),
				color: normalizeText(update.color || "")
			}))
			.filter(update => update.territory_public_id && update.color);

		if (payloadUpdates.length < 1) {
			return { ok: true, changed: 0, received: 0, updates: [] };
		}

		return submitSubtreeUpdate({
			action: "update_colors",
			updates: payloadUpdates
		});
	}

	async function applyOpacityInheritance(root) {
		const payload = {
			action: "inherit_opacity",
			root_territory_id: root.territoryId ?? null,
			root_territory_public_id: normalizeText(root.territoryPublicId || ""),
			opacity: root.opacity
		};
		return submitSubtreeUpdate(payload);
	}

	function reloadEditorAndParentLayers() {
		try {
			const host = window.AvesmapsEditorContext?.host?.() || window.parent;
			host?.loadPoliticalTerritoryOptions?.({ force: true });
			host?.schedulePoliticalTerritoryLayerReload?.({ immediate: true });
		} catch (error) {
			console.warn("Politische Gebietsebene konnte nicht direkt neu geladen werden:", error);
		}

		const assignmentModule = window.AvesmapsPoliticalTerritoryAssignment;
		if (typeof assignmentModule?.reload === "function") {
			void assignmentModule.reload().catch((error) => {
				console.warn("Territory-Assignment-Modul konnte nach Subtree-Update nicht neu geladen werden:", error);
			});
		}
	}

	function formatInheritanceMessage(label, result) {
		const changed = Number(result?.descendants_count ?? result?.changed ?? 0);
		const received = Number(result?.received ?? changed);
		if (typeof result?.changed !== "undefined") {
			return `${label}: ${received} geplante Farben, ${changed} gespeichert.`;
		}
		return `${label}: ${changed} Unterregionen, ${Number(result?.global_changed ?? 0)} global, ${Number(result?.local_display_changed ?? 0)} lokale Anzeigen.`;
	}

	window.AvesmapsPoliticalTerritorySubtreeDisplayTools = {
		apiUrl: API_URL,
		readHueVarianceRange256,
		submitSubtreeUpdate,
		applyColorHierarchy,
		applyExplicitColorUpdates,
		applyOpacityInheritance,
		reloadEditorAndParentLayers,
		formatInheritanceMessage,
	};
})();

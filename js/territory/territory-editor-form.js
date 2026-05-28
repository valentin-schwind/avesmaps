"use strict";

(function initPoliticalTerritoryEditorFormModule() {
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

	function parseOptionalNumber(value, fallback = null) {
		if (value === "" || value === null || typeof value === "undefined") return fallback;
		const number = Number(value);
		return Number.isFinite(number) ? number : fallback;
	}

	function clampNumber(value, min, max) {
		const number = Number(value);
		return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
	}

	function normalizeHexColor(value) {
		const color = normalizeText(value);
		return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : "";
	}

	function getAssignmentModule() {
		return window.AvesmapsPoliticalTerritoryAssignment || null;
	}

	function readAssignmentValue() {
		return getAssignmentModule()?.getValue?.() || null;
	}

	function setStatus(message, type = "pending") {
		getAssignmentModule()?.setStatus?.(message, type);
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

	function sameReference(left, right) {
		const leftValues = referenceValues(left);
		const rightValues = referenceValues(right);
		return leftValues.some(leftValue => rightValues.some(rightValue => leftValue === rightValue || makeKey(leftValue) === makeKey(rightValue)));
	}

	function getActivePathIndex(value = readAssignmentValue()) {
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const active = value?.activeDisplayNode || null;
		if (active) {
			const index = path.findIndex(node => sameReference(node, active));
			if (index >= 0) return index;
		}
		return path.length - 1;
	}

	function readRootSelection(value = readAssignmentValue()) {
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const displays = Array.isArray(value?.displays) ? value.displays : [];
		const activeIndex = getActivePathIndex(value);
		const rootNode = path[activeIndex] || null;
		const rootDisplay = displays[activeIndex] || value?.display || {};
		if (!rootNode) return null;

		const opacityPercent = parseOptionalNumber(
			document.getElementById("transparencyInput")?.value,
			Math.round((rootDisplay.opacity ?? 0.33) * 100)
		);

		return {
			activeIndex,
			pathPrefix: path.slice(0, activeIndex + 1).map(node => normalizeText(node.label || node.name || node.key || "")).filter(Boolean),
			territoryId: parseOptionalNumber(rootNode.territoryId ?? rootNode.territory_id),
			territoryPublicId: normalizeText(rootNode.territoryPublicId || rootNode.territory_public_id || rootNode.key || ""),
			wikiKey: normalizeText(rootNode.wikiKey || rootNode.wiki_key || rootNode.key || ""),
			name: normalizeText(rootNode.label || rootDisplay.name || rootDisplay.displayName || ""),
			color: normalizeHexColor(document.getElementById("colorInput")?.value || rootDisplay.color) || "#888888",
			opacity: clampNumber(opacityPercent / 100, 0, 1),
			zoomMin: parseOptionalNumber(document.getElementById("zoomFromInput")?.value, rootDisplay.zoomMin),
			zoomMax: parseOptionalNumber(document.getElementById("zoomToInput")?.value, rootDisplay.zoomMax),
			startYear: parseOptionalNumber(document.getElementById("startYearInput")?.value, rootDisplay.startYear),
			endYear: document.getElementById("existsUntilTodayInput")?.checked ? null : parseOptionalNumber(document.getElementById("endYearInput")?.value, rootDisplay.endYear),
			existsUntilToday: Boolean(document.getElementById("existsUntilTodayInput")?.checked)
		};
	}

	function hasLowerBreadcrumb(value = readAssignmentValue()) {
		const path = Array.isArray(value?.assignedPath) ? value.assignedPath : [];
		const activeIndex = getActivePathIndex(value);
		return activeIndex >= 0 && activeIndex < path.length - 1;
	}

	async function applyLocalDisplayInheritance(value) {
		const root = readRootSelection(value);
		if (!root) return value;

		const inheritZoom = Boolean(document.getElementById("inheritZoomToDescendantsCheckbox")?.checked);
		const inheritValidity = Boolean(document.getElementById("inheritValidityToDescendantsCheckbox")?.checked);
		if (!inheritZoom && !inheritValidity) return value;

		const nextValue = {
			...value,
			displays: Array.isArray(value.displays) ? value.displays.map(display => ({ ...display })) : []
		};

		for (let index = root.activeIndex + 1; index < nextValue.displays.length; index += 1) {
			const display = nextValue.displays[index] || {};
			if (inheritZoom) {
				display.zoomMin = root.zoomMin;
				display.zoomMax = root.zoomMax;
			}
			if (inheritValidity) {
				display.startYear = root.startYear;
				display.endYear = root.endYear;
				display.existsUntilToday = root.existsUntilToday;
			}
			nextValue.displays[index] = display;
		}

		return nextValue;
	}

	window.AvesmapsPoliticalTerritoryEditorForm = {
		normalizeText,
		makeKey,
		parseOptionalNumber,
		clampNumber,
		normalizeHexColor,
		readAssignmentValue,
		setStatus,
		getActivePathIndex,
		readRootSelection,
		hasLowerBreadcrumb,
		applyLocalDisplayInheritance
	};
})();

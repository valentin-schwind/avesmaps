"use strict";

(function initPoliticalTerritoryEditorDisplayState() {
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

	function readPath(value) {
		return Array.isArray(value?.assignedPath) ? value.assignedPath : [];
	}

	function readDisplays(value) {
		return Array.isArray(value?.displays) ? value.displays : [];
	}

	function getActivePathIndex(value) {
		const path = readPath(value);
		const active = value?.activeDisplayNode || null;
		if (active) {
			const index = path.findIndex(node => sameReference(node, active));
			if (index >= 0) return index;
		}
		return path.length - 1;
	}

	function hasLowerBreadcrumb(value) {
		const path = readPath(value);
		const activeIndex = getActivePathIndex(value);
		return activeIndex >= 0 && activeIndex < path.length - 1;
	}

	function readActiveNode(value) {
		return readPath(value)[getActivePathIndex(value)] || null;
	}

	function readActiveDisplay(value) {
		return readDisplays(value)[getActivePathIndex(value)] || value?.display || {};
	}

	function cloneDisplays(value) {
		return readDisplays(value).map(display => ({ ...display }));
	}

	function updateDescendantDisplays(value, activeIndex, transform) {
		const nextValue = { ...value, displays: cloneDisplays(value) };
		for (let index = activeIndex + 1; index < nextValue.displays.length; index += 1) {
			const currentDisplay = nextValue.displays[index] || {};
			nextValue.displays[index] = transform({ ...currentDisplay }, index);
		}
		return nextValue;
	}

	window.AvesmapsPoliticalTerritoryEditorDisplayState = {
		normalizeText,
		makeKey,
		referenceValues,
		sameReference,
		readPath,
		readDisplays,
		getActivePathIndex,
		hasLowerBreadcrumb,
		readActiveNode,
		readActiveDisplay,
		cloneDisplays,
		updateDescendantDisplays
	};
})();

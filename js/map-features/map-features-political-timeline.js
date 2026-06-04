// Editor: Zeitleiste immer aktiv. Frontend: nur wenn POLITICAL_TIMELINE_FRONTEND_ENABLED gesetzt
// ist (vorerst aus -> Jahr bleibt auf Standard 1049).
function isPoliticalTimelineEnabled() {
	return IS_EDIT_MODE || (typeof POLITICAL_TIMELINE_FRONTEND_ENABLED !== "undefined" && POLITICAL_TIMELINE_FRONTEND_ENABLED === true);
}

function syncPoliticalTimelineVisibility() {
	const timelineElement = document.getElementById("political-timeline");
	const isPoliticalMode = getSelectedMapLayerMode() === "political";

	if (!timelineElement) {
		return;
	}

	const showTimeline = isPoliticalMode && isPoliticalTimelineEnabled();
	timelineElement.hidden = !showTimeline;

	if (!showTimeline) {
		clearPoliticalTerritoryTimelineSelection();
		return;
	}

	syncPoliticalTimelineControls();
}

function syncPoliticalTimelineControls() {
	const rangeElement = document.getElementById("political-timeline-range");
	const yearElement = document.getElementById("political-timeline-year");
	const labelElement = document.getElementById("political-timeline-label");
	if (!rangeElement || !yearElement || !labelElement) {
		return;
	}

	rangeElement.value = String(politicalTimelineYear);
	yearElement.value = String(politicalTimelineYear);
	labelElement.textContent = formatPoliticalTimelineYear(politicalTimelineYear);
}

function formatPoliticalTimelineYear(yearBf) {
	return "BF";
}

function setPoliticalTimelineYear(value) {
	const parsedYear = Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsedYear)) {
		return;
	}

	politicalTimelineYear = Math.max(0, Math.min(1049, parsedYear));
	syncPoliticalTimelineControls();
	schedulePoliticalTerritoryLayerReload();
}

function showPoliticalTerritoryTimelineSelection(regionEntry) {
	if (!isPoliticalTimelineEnabled()) {
		return;
	}
	const panelElement = document.getElementById("political-territory-range");
	const nameElement = document.getElementById("political-territory-range-name");
	const yearsElement = document.getElementById("political-territory-range-years");
	const barElement = document.getElementById("political-territory-range-bar");

	if (!panelElement || !nameElement || !yearsElement || !barElement || !regionEntry) {
		return;
	}

	const startYear = normalizePoliticalTimelineYearValue(regionEntry.validFromBf);
	const endYear = normalizePoliticalTimelineYearValue(regionEntry.validToBf);
	const hasStart = startYear !== null;
	const hasEnd = endYear !== null && endYear < 9999;

	const minYear = 0;
	const maxYear = 1049;
	const range = maxYear - minYear;

	const effectiveStart = hasStart ? Math.max(startYear, minYear) : minYear;
	const effectiveEnd = hasEnd ? Math.min(endYear, maxYear) : maxYear;

	nameElement.textContent = normalizeRegionParentheticalSpacing(regionEntry.displayName || regionEntry.name || "Herrschaftsgebiet");
	yearsElement.textContent = formatPoliticalTerritoryRangeLabel(startYear, endYear, regionEntry.validLabel);

	const leftPercent = Math.max(0, Math.min(100, ((effectiveStart - minYear) / range) * 100));
	const rightPercent = Math.max(0, Math.min(100, ((effectiveEnd - minYear) / range) * 100));
	const widthPercent = rightPercent > leftPercent
		? Math.max(1.5, rightPercent - leftPercent)
		: 0;

	barElement.style.left = `${leftPercent}%`;
	barElement.style.width = `${widthPercent}%`;
	barElement.style.backgroundColor = normalizeRegionHexColor(regionEntry.color || "#888888");

	barElement.hidden = false;
	panelElement.hidden = false;
}

function clearPoliticalTerritoryTimelineSelection() {
	const panelElement = document.getElementById("political-territory-range");
	const barElement = document.getElementById("political-territory-range-bar");

	if (panelElement) {
		panelElement.hidden = true;
	}

	if (barElement) {
		barElement.hidden = true;
	}
}

function normalizePoliticalTimelineYearValue(value) {
	const number = Number(value);

	return Number.isFinite(number) ? number : null;
}

function formatPoliticalTerritoryRangeLabel(startYear, endYear, fallbackLabel = "") {
	const normalizedFallback = String(fallbackLabel || "").trim();

	if (normalizedFallback !== "") {
		return normalizedFallback;
	}

	const hasStart = startYear !== null;
	const hasEnd = endYear !== null && endYear < 9999;

	if (!hasStart && !hasEnd) {
		return "Zeitraum unbekannt";
	}

	if (hasStart && !hasEnd) {
		return `seit ${formatPoliticalTimelineYear(startYear)}`;
	}

	if (!hasStart && hasEnd) {
		return `bis ${formatPoliticalTimelineYear(endYear)}`;
	}

	return `${formatPoliticalTimelineYear(startYear)} â€“ ${formatPoliticalTimelineYear(endYear)}`;
}

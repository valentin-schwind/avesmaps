const SPOTLIGHT_SEARCH_MAX_RESULTS = 20;
const SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER = {
	location: 0,
	label: 1,
	region: 2,
	path: 3,
	powerline: 4,
};
const SPOTLIGHT_PATH_HIGHLIGHT_STYLE = {
	pane: "routePane",
	color: "#ffd72e",
	weight: 12,
	opacity: 0.96,
	interactive: false,
	bubblingMouseEvents: false,
	lineCap: "round",
	lineJoin: "round",
	className: "spotlight-path-highlight",
};

let spotlightRenderedEntries = [];
let spotlightActiveResultIndex = -1;
let spotlightHighlightLayer = null;
let spotlightActiveSelectionId = "";
let spotlightSearchRenderToken = 0;
let spotlightBackendAbortController = null;

function getSpotlightSearchElements() {
	return {
		overlay: document.getElementById("spotlight-search-overlay"),
		dialog: document.getElementById("spotlight-search-dialog"),
		input: document.getElementById("spotlight-search-input"),
		results: document.getElementById("spotlight-search-results"),
		status: document.getElementById("spotlight-search-status"),
	};
}

function isSpotlightSearchOpen() {
	const { overlay } = getSpotlightSearchElements();
	return Boolean(overlay && !overlay.hidden);
}

function openSpotlightSearch(initialValue = "") {
	const { overlay, input } = getSpotlightSearchElements();
	if (!overlay || !input) {
		return;
	}

	overlay.hidden = false;
	input.value = initialValue;
	updateSpotlightSearchResults();
	syncModalDialogBodyState();
	window.requestAnimationFrame(() => {
		input.focus();
		input.select();
	});
}

function closeSpotlightSearch({ resetInput = false } = {}) {
	const { overlay, input, results, status } = getSpotlightSearchElements();
	if (!overlay) {
		return;
	}

	overlay.hidden = true;
	spotlightSearchRenderToken++;
	spotlightRenderedEntries = [];
	spotlightActiveResultIndex = -1;
	if (resetInput && input) {
		input.value = "";
	}
	if (results) {
		results.innerHTML = "";
		results.hidden = true;
	}
	if (status) {
		status.textContent = "";
		status.hidden = true;
	}
	if (spotlightBackendAbortController) {
		spotlightBackendAbortController.abort();
		spotlightBackendAbortController = null;
	}
	syncModalDialogBodyState();
}

function initializeSpotlightSearch() {
	const { overlay, input, results } = getSpotlightSearchElements();
	if (!overlay || !input || !results) {
		return;
	}

	input.addEventListener("input", updateSpotlightSearchResults);
	input.addEventListener("keydown", handleSpotlightInputKeydown);
	results.addEventListener("click", handleSpotlightResultClick);
	results.addEventListener("mousemove", handleSpotlightResultMouseMove);
	overlay.addEventListener("click", (event) => {
		if (event.target === overlay) {
			closeSpotlightSearch({ resetInput: true });
			clearSpotlightSelection();
		}
	});
	document.addEventListener("keydown", handleSpotlightGlobalKeydown);
	document.addEventListener("click", handleSpotlightDocumentClick);
	map.on("click", () => clearSpotlightSelection());
}

function handleSpotlightGlobalKeydown(event) {
	if (event.key !== "Escape") {
		return;
	}

	if (isSpotlightSearchOpen()) {
		event.preventDefault();
		event.stopImmediatePropagation();
		closeSpotlightSearch({ resetInput: true });
		clearSpotlightSelection();
		return;
	}

	if (spotlightActiveSelectionId) {
		clearSpotlightSelection();
	}
}

function handleSpotlightDocumentClick(event) {
	if (!spotlightActiveSelectionId) {
		return;
	}

	const target = event.target instanceof Element ? event.target : null;
	if (target?.closest("#spotlight-search-overlay, #map-context-menu")) {
		return;
	}

	clearSpotlightSelection();
}

function handleSpotlightInputKeydown(event) {
	if (event.key === "ArrowDown") {
		event.preventDefault();
		setSpotlightActiveResultIndex(Math.min(spotlightRenderedEntries.length - 1, spotlightActiveResultIndex + 1));
		return;
	}

	if (event.key === "ArrowUp") {
		event.preventDefault();
		const nextIndex = spotlightActiveResultIndex <= 0 ? spotlightRenderedEntries.length - 1 : spotlightActiveResultIndex - 1;
		setSpotlightActiveResultIndex(nextIndex);
		return;
	}

	if (event.key === "Enter") {
		event.preventDefault();
		const selectedEntry = spotlightRenderedEntries[spotlightActiveResultIndex] || spotlightRenderedEntries[0];
		if (selectedEntry) {
			selectSpotlightSearchEntry(selectedEntry);
		}
	}
}

function handleSpotlightResultClick(event) {
	const button = event.target instanceof Element ? event.target.closest("[data-spotlight-result-index]") : null;
	if (!button) {
		return;
	}

	const resultIndex = Number(button.dataset.spotlightResultIndex);
	const entry = spotlightRenderedEntries[resultIndex];
	if (entry) {
		selectSpotlightSearchEntry(entry);
	}
}

function handleSpotlightResultMouseMove(event) {
	const button = event.target instanceof Element ? event.target.closest("[data-spotlight-result-index]") : null;
	if (!button) {
		return;
	}

	setSpotlightActiveResultIndex(Number(button.dataset.spotlightResultIndex));
}

function updateSpotlightSearchResults() {
	const { input } = getSpotlightSearchElements();
	const query = input?.value || "";
	const renderToken = ++spotlightSearchRenderToken;
	const localEntries = searchSpotlightEntries(query);
	renderSpotlightSearchResults(localEntries);

	if (!shouldUseBackendSpotlightSearch(query)) {
		return;
	}

	void fetchBackendSpotlightResults(query)
		.then((backendResults) => {
			if (renderToken !== spotlightSearchRenderToken || !backendResults) {
				return;
			}

			const resolvedEntries = resolveBackendSpotlightEntries(backendResults, localEntries);
			if (resolvedEntries.length) {
				renderSpotlightSearchResults(resolvedEntries);
			}
		})
		.catch((error) => {
			if (error?.name !== "AbortError") {
				console.warn("Spotlight-Suche konnte serverseitig nicht geladen werden:", error);
			}
		});
}

function shouldUseBackendSpotlightSearch(query) {
	return Boolean(String(MAP_SEARCH_API_URL || "").trim() && normalizeSpotlightSearchText(query));
}

async function fetchBackendSpotlightResults(query) {
	if (spotlightBackendAbortController) {
		spotlightBackendAbortController.abort();
	}

	spotlightBackendAbortController = new AbortController();
	const searchUrl = new URL(MAP_SEARCH_API_URL, window.location.href);
	searchUrl.searchParams.set("q", query);
	searchUrl.searchParams.set("limit", String(SPOTLIGHT_SEARCH_MAX_RESULTS));
	const response = await fetch(searchUrl.toString(), {
		headers: {
			Accept: "application/json",
		},
		signal: spotlightBackendAbortController.signal,
	});
	if (!response.ok) {
		throw new Error(`Spotlight-Suche antwortet mit HTTP ${response.status}.`);
	}

	const payload = await response.json();
	return Array.isArray(payload?.results) ? payload.results : [];
}

function resolveBackendSpotlightEntries(backendResults, localEntries) {
	const allLocalEntries = buildSpotlightSearchEntries();
	const byPublicId = new Map();
	const byPathGroup = new Map();
	const resolvedEntries = [];
	const seenEntryIds = new Set();

	allLocalEntries.forEach((entry) => {
		(entry.publicIds || []).forEach((publicId) => {
			byPublicId.set(`${entry.kind}:${publicId}`, entry);
		});
		if (entry.kind === "path") {
			byPathGroup.set(getSpotlightPathGroupKey(entry.name, entry.subtype), entry);
		}
	});

	backendResults.forEach((result) => {
		const kind = String(result.kind || "");
		let entry = null;
		const publicIds = Array.isArray(result.public_ids)
			? result.public_ids
			: [result.public_id].filter(Boolean);

		for (const publicId of publicIds) {
			entry = byPublicId.get(`${kind}:${publicId}`);
			if (entry) {
				break;
			}
		}

		if (!entry && kind === "path") {
			entry = byPathGroup.get(getSpotlightPathGroupKey(result.name, result.feature_subtype || result.subtype));
		}

		if (!entry || seenEntryIds.has(entry.id)) {
			return;
		}

		seenEntryIds.add(entry.id);
		resolvedEntries.push(entry);
	});

	if (resolvedEntries.length) {
		return resolvedEntries.slice(0, SPOTLIGHT_SEARCH_MAX_RESULTS);
	}

	return localEntries;
}

function searchSpotlightEntries(query) {
	const normalizedQuery = normalizeSpotlightSearchText(query);
	if (!normalizedQuery) {
		return [];
	}

	return buildSpotlightSearchEntries()
		.map((entry) => ({
			entry,
			score: getSpotlightSearchScore(entry, normalizedQuery),
		}))
		.filter((match) => Number.isFinite(match.score))
		.sort((left, right) => {
			const scoreDiff = left.score - right.score;
			if (scoreDiff !== 0) {
				return scoreDiff;
			}

			const typeDiff = (SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER[left.entry.kind] ?? 99) - (SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER[right.entry.kind] ?? 99);
			if (typeDiff !== 0) {
				return typeDiff;
			}

			return left.entry.name.localeCompare(right.entry.name, "de");
		})
		.slice(0, SPOTLIGHT_SEARCH_MAX_RESULTS)
		.map((match) => match.entry);
}

function getSpotlightSearchScore(entry, normalizedQuery) {
	const candidates = [entry.name, entry.typeLabel, ...(entry.aliases || [])]
		.map(normalizeSpotlightSearchText)
		.filter(Boolean);
	let bestScore = Infinity;

	candidates.forEach((candidate) => {
		if (candidate === normalizedQuery) {
			bestScore = Math.min(bestScore, 0);
			return;
		}
		if (candidate.startsWith(normalizedQuery)) {
			bestScore = Math.min(bestScore, 1);
			return;
		}
		if (candidate.split(" ").some((part) => part.startsWith(normalizedQuery))) {
			bestScore = Math.min(bestScore, 2);
			return;
		}
		if (candidate.includes(normalizedQuery)) {
			bestScore = Math.min(bestScore, 3);
		}
	});

	return bestScore;
}

function renderSpotlightSearchResults(entries) {
	const { input, results, status } = getSpotlightSearchElements();
	if (!results || !status) {
		return;
	}

	spotlightRenderedEntries = entries;
	results.innerHTML = entries.map((entry, index) => spotlightResultMarkup(entry, index)).join("");
	results.hidden = entries.length === 0;
	status.textContent = "";
	status.hidden = true;
	setSpotlightActiveResultIndex(entries.length ? 0 : -1);

	if (input) {
		input.setAttribute("aria-expanded", entries.length ? "true" : "false");
	}
}

function spotlightResultMarkup(entry, index) {
	const resultId = `spotlight-result-${index}`;
	return `
		<button id="${resultId}" type="button" class="spotlight-search__result" data-spotlight-result-index="${index}" role="option">
			<span class="spotlight-search__result-name">${escapeHtml(entry.name)}</span>
			<span class="spotlight-search__result-type">${escapeHtml(entry.typeLabel)}</span>
		</button>`;
}

function setSpotlightActiveResultIndex(index) {
	const { input, results } = getSpotlightSearchElements();
	spotlightActiveResultIndex = index;
	if (!results) {
		return;
	}

	Array.from(results.querySelectorAll(".spotlight-search__result")).forEach((button, buttonIndex) => {
		const isActive = buttonIndex === index;
		button.classList.toggle("is-active", isActive);
		button.setAttribute("aria-selected", isActive ? "true" : "false");
		if (isActive && input) {
			input.setAttribute("aria-activedescendant", button.id);
			button.scrollIntoView({ block: "nearest" });
		}
	});

	if (index < 0 && input) {
		input.removeAttribute("aria-activedescendant");
	}
}

function buildSpotlightSearchEntries() {
	return [
		...buildSpotlightLocationEntries(),
		...buildSpotlightLabelEntries(),
		...buildSpotlightRegionEntries(),
		...buildSpotlightPathEntries(),
		...buildSpotlightPowerlineEntries(),
	];
}

function buildSpotlightLocationEntries() {
	return locationMarkers
		.filter((entry) => entry?.location && !isCrossingLocation(entry.location))
		.map((entry) => ({
			id: `location:${entry.publicId || entry.name}`,
			kind: "location",
			name: entry.name,
			typeLabel: entry.locationTypeLabel || LOCATION_TYPE_CONFIG[entry.locationType]?.singularLabel || "Ort",
			publicIds: [entry.publicId].filter(Boolean),
			locationEntry: entry,
			aliases: [entry.location?.description, entry.location?.wikiUrl],
		}));
}

function buildSpotlightLabelEntries() {
	return labelMarkers
		.filter((entry) => String(entry?.label?.text || "").trim())
		.map((entry) => ({
			id: `label:${entry.label.publicId || entry.label.text}:${entry.label.coordinates.join(",")}`,
			kind: "label",
			name: entry.label.text,
			typeLabel: getSpotlightLabelTypeLabel(entry.label.labelType),
			publicIds: [entry.label.publicId].filter(Boolean),
			labelEntry: entry,
			aliases: [entry.label.labelType],
		}));
}

function buildSpotlightRegionEntries() {
	const regionGroups = new Map();
	regionPolygons.forEach((polygon) => {
		const regionEntry = polygon?._regionEntry;
		if (!regionEntry?.name) {
			return;
		}

		const key = regionEntry.publicId || regionEntry.name;
		if (!regionGroups.has(key)) {
			regionGroups.set(key, {
				id: `region:${key}`,
				kind: "region",
				name: regionEntry.name,
				typeLabel: "Herrschaftsgebiet",
				publicIds: [regionEntry.publicId].filter(Boolean),
				regionEntry,
				polygons: [],
				bounds: null,
				aliases: [regionEntry.wikiUrl],
			});
		}

		const group = regionGroups.get(key);
		group.polygons.push(polygon);
		group.bounds = extendSpotlightBounds(group.bounds, polygon.getBounds());
	});

	return Array.from(regionGroups.values());
}

function buildSpotlightPathEntries() {
	const pathGroups = new Map();
	pathData
		.filter((path) => shouldPathNameBeDisplayed(path) && shouldShowPathOnMap(path))
		.forEach((path) => {
			const displayName = String(getPathDisplayName(path) || "").trim();
			if (!displayName) {
				return;
			}

			const subtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
			const groupKey = getSpotlightPathGroupKey(displayName, subtype);
			if (!pathGroups.has(groupKey)) {
				pathGroups.set(groupKey, {
					id: `path:${groupKey}`,
					kind: "path",
					name: displayName,
					typeLabel: getSpotlightPathTypeLabel(subtype),
					subtype,
					publicIds: [],
					paths: [],
					bounds: null,
					aliases: [subtype],
				});
			}

			const group = pathGroups.get(groupKey);
			group.paths.push(path);
			if (getPathPublicId(path)) {
				group.publicIds.push(getPathPublicId(path));
			}
			group.bounds = extendSpotlightBounds(group.bounds, getSpotlightPathBounds(path));
		});

	return Array.from(pathGroups.values());
}

function buildSpotlightPowerlineEntries() {
	return powerlineData
		.filter((powerline) => String(getPowerlineDisplayName(powerline) || "").trim())
		.map((powerline) => ({
			id: `powerline:${powerline.id || powerline.properties?.public_id || getPowerlineDisplayName(powerline)}`,
			kind: "powerline",
			name: getPowerlineDisplayName(powerline),
			typeLabel: "Kraftlinie",
			publicIds: [powerline.id || powerline.properties?.public_id].filter(Boolean),
			powerline,
			bounds: getSpotlightLatLngBounds(getPowerlineLatLngs(powerline)),
			aliases: ["Nodix", "Kraftlinie"],
		}));
}

function getSpotlightLabelTypeLabel(labelType) {
	const labels = {
		region: "Region",
		fluss: "Fluss",
		meer: "Meer",
		gebirge: "Gebirge",
		berggipfel: "Berggipfel",
		wald: "Wald",
		kontinent: "Kontinent",
		wueste: "Wueste",
		suempfe_moore: "Sumpf/Moor",
		see: "See",
		insel: "Insel",
		sonstiges: "Label",
	};
	return labels[labelType] || "Label";
}

function getSpotlightPathTypeLabel(subtype) {
	const labels = {
		Reichsstrasse: "Weg",
		Strasse: "Weg",
		Weg: "Weg",
		Pfad: "Weg",
		Gebirgspass: "Gebirgspass",
		Wuestenpfad: "Wuestenpfad",
		Flussweg: "Fluss",
		Seeweg: "Seeweg",
	};
	return labels[subtype] || "Weg";
}

function getSpotlightPathGroupKey(displayName, subtype) {
	return `${normalizePathSubtype(subtype)}:${normalizeSpotlightSearchText(displayName)}`;
}

function normalizeSpotlightSearchText(value) {
	return String(value || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/ß/g, "ss")
		.replace(/æ/g, "ae")
		.replace(/œ/g, "oe")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function extendSpotlightBounds(bounds, nextBounds) {
	if (!nextBounds?.isValid?.()) {
		return bounds;
	}

	if (!bounds?.isValid?.()) {
		return L.latLngBounds(nextBounds.getSouthWest(), nextBounds.getNorthEast());
	}

	return bounds.extend(nextBounds);
}

function getSpotlightLatLngBounds(latLngs) {
	const normalizedLatLngs = (latLngs || []).map((latLng) => L.latLng(latLng));
	if (!normalizedLatLngs.length) {
		return null;
	}

	return L.latLngBounds(normalizedLatLngs);
}

function getSpotlightPathBounds(path) {
	const latLngs = (path?.geometry?.coordinates || []).map(([lng, lat]) => L.latLng(lat, lng));
	return getSpotlightLatLngBounds(latLngs);
}

function selectSpotlightSearchEntry(entry) {
	closeSpotlightSearch();
	clearSpotlightSelection();
	spotlightActiveSelectionId = entry.id;

	if (entry.kind === "location") {
		focusSpotlightLocation(entry);
		return;
	}

	if (entry.kind === "label") {
		focusSpotlightLabel(entry);
		return;
	}

	if (entry.kind === "region") {
		focusSpotlightRegion(entry);
		return;
	}

	if (entry.kind === "path") {
		focusSpotlightPath(entry);
		return;
	}

	if (entry.kind === "powerline") {
		focusSpotlightPowerline(entry);
	}
}

function focusSpotlightLocation(entry) {
	const markerEntry = entry.locationEntry;
	if (!markerEntry?.marker) {
		return;
	}

	setVisibleLocationTypesThrough(markerEntry.locationType, { syncUrl: true });
	syncLocationMarkerVisibility();
	const markerLatLng = markerEntry.marker.getLatLng();
	const preferredZoom = getSpotlightLocationZoom(markerEntry);
	map.setView(markerLatLng, preferredZoom);
	window.setTimeout(() => openLocationPopupByName(markerEntry.name), 0);
}

function getSpotlightLocationZoom(markerEntry) {
	const labelConfig = LOCATION_NAME_LABEL_CONFIG[markerEntry.locationType] || LOCATION_NAME_LABEL_CONFIG.dorf;
	return Math.max(labelConfig.minZoom || 0, Math.min(VISUAL_MAX_ZOOM_LEVEL, map.getMaxZoom()));
}

function focusSpotlightLabel(entry) {
	const labelEntry = entry.labelEntry;
	if (!labelEntry?.marker) {
		return;
	}

	setSelectedMapLayerMode("deregraphic");
	const maxZoom = Number.isFinite(Number(labelEntry.label.maxZoom)) ? Number(labelEntry.label.maxZoom) : VISUAL_MAX_ZOOM_LEVEL;
	const targetZoom = Math.max(Number(labelEntry.label.minZoom) || 0, Math.min(maxZoom, VISUAL_MAX_ZOOM_LEVEL));
	map.setView(labelEntry.marker.getLatLng(), targetZoom);
	syncLabelVisibility();
}

function focusSpotlightRegion(entry) {
	setSelectedMapLayerMode("political");
	if (entry.bounds?.isValid?.()) {
		focusSpotlightBounds(entry.bounds, 4);
	}
}

function focusSpotlightPath(entry) {
	$("#togglePaths").prop("checked", true);
	syncPathVisibility();
	syncPathLabels();
	syncPlannerStateToUrl();
	highlightSpotlightPaths(entry.paths || []);
	if (entry.bounds?.isValid?.()) {
		focusSpotlightBounds(entry.bounds, getSpotlightPathZoom(entry));
	}
}

function getSpotlightPathZoom(entry) {
	const minZoom = entry.subtype === "Flussweg" || entry.subtype === "Seeweg"
		? 3
		: LOCATION_NAME_LABEL_CONFIG.dorf.minZoom;
	return Math.max(minZoom, Math.min(VISUAL_MAX_ZOOM_LEVEL, map.getMaxZoom()));
}

function focusSpotlightPowerline(entry) {
	setSelectedMapLayerMode("powerlines");
	syncPowerlineLabels();
	if (entry.bounds?.isValid?.()) {
		const minZoom = shouldPowerlineNameBeDisplayed(entry.powerline) ? 2 : 3;
		focusSpotlightBounds(entry.bounds, Math.max(minZoom, Math.min(VISUAL_MAX_ZOOM_LEVEL, map.getMaxZoom())));
	}
}

function focusSpotlightBounds(bounds, preferredZoom) {
	if (!bounds?.isValid?.()) {
		return;
	}

	map.fitBounds(bounds.pad(0.16), {
		padding: [54, 54],
		maxZoom: preferredZoom,
	});

	if (map.getZoom() < preferredZoom) {
		map.setView(bounds.getCenter(), preferredZoom);
	}
}

function highlightSpotlightPaths(paths) {
	if (!paths.length) {
		return;
	}

	spotlightHighlightLayer = L.layerGroup();
	paths.forEach((path) => {
		const latLngs = getPathVisualLatLngCoordinates(path.geometry?.coordinates || []);
		if (latLngs.length < 2) {
			return;
		}

		L.polyline(latLngs, {
			...SPOTLIGHT_PATH_HIGHLIGHT_STYLE,
			weight: getSpotlightPathHighlightWeight(path),
		}).addTo(spotlightHighlightLayer);
	});

	if (spotlightHighlightLayer.getLayers().length) {
		spotlightHighlightLayer.addTo(map);
		spotlightHighlightLayer.eachLayer((layer) => layer.bringToFront?.());
	}
}

function getSpotlightPathHighlightWeight(path) {
	const subtype = normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name);
	if (subtype === "Flussweg" || subtype === "Seeweg") {
		return 13;
	}
	if (subtype === "Reichsstrasse") {
		return 12;
	}
	return 10;
}

function clearSpotlightSelection() {
	if (spotlightHighlightLayer) {
		map.removeLayer(spotlightHighlightLayer);
		spotlightHighlightLayer = null;
	}
	spotlightActiveSelectionId = "";
}

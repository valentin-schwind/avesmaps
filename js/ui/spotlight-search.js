const SPOTLIGHT_SEARCH_MAX_RESULTS = 20;
const SPOTLIGHT_SEARCH_INPUT_DEBOUNCE_MS = 140;
const SPOTLIGHT_BACKEND_MIN_QUERY_LENGTH = 2;
const SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER = {
	location: 0,
	label: 1,
	region: 2,
	path: 3,
	powerline: 4,
	// Maps are not map objects -- they are a pointer to one. Last, like the in-settlement objects.
	citymap: 6,
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

// Clicks that do NOT count as "outside" and therefore keep the current selection alive: the search
// overlay, the map context menu -- and an infobox (right panel or popup). The infobox belongs on this
// list because its "Anzeigen" tile is what CREATES a way highlight: handleSpotlightDocumentClick sits on
// document just like the jQuery action handler in routing.js, and stopPropagation() only stops other
// NODES, never other listeners on the same one. So we run right after the tile drew the highlight and
// would wipe it in the very same click. (A search result escapes that only by accident -- its list is
// emptied before we run, so !target.isConnected catches it. A panel button stays in the DOM.) Clicking
// inside the infobox of the very way that is highlighted is not "somewhere else" anyway.
// #review-panel joins for the same reason as the infobox: its lists (WikiSync „Ausreißer" and
// „Konflikte") draw a way highlight on a row click, and this handler sits on document just like
// theirs -- so without the exemption we wiped the highlight in the very same click and the row
// looked dead. Clicking a review row is also not "somewhere else": that panel exists to inspect
// the very object being highlighted.
const SPOTLIGHT_SELECTION_KEEPING_CLICK_SELECTOR = "#spotlight-search-overlay, #map-context-menu, .avesmaps-infopanel, .leaflet-popup, #review-panel";

let spotlightRenderedEntries = [];
let spotlightActiveResultIndex = -1;
let spotlightHighlightLayer = null;
let spotlightActiveSelectionId = "";
let spotlightSearchRenderToken = 0;
let spotlightBackendAbortController = null;
let spotlightSearchInputTimeout = null;
let spotlightSearchEntryCache = null;
let spotlightSearchEntryCacheSignature = "";
let spotlightSearchLookupCache = null;

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

	// Record the final search query once per closed session (this also captures searches that
	// end without picking a result), feeding the "Top-Suchbegriffe" visitor-analytics panel.
	if (!overlay.hidden && typeof trackVisitorEvent === "function") {
		const finalSpotlightQuery = String(input?.value || "").trim();
		if (finalSpotlightQuery.length >= 2) {
			trackVisitorEvent("search", finalSpotlightQuery.slice(0, 80));
		}
	}
	overlay.hidden = true;
	spotlightSearchRenderToken++;
	spotlightRenderedEntries = [];
	spotlightActiveResultIndex = -1;
	clearTimeout(spotlightSearchInputTimeout);
	spotlightSearchInputTimeout = null;
	if (spotlightRegionInfoboxPollTimer) {
		window.clearInterval(spotlightRegionInfoboxPollTimer);
		spotlightRegionInfoboxPollTimer = null;
	}
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

	input.addEventListener("input", scheduleSpotlightSearchResultsUpdate);
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

	// A detached target means the click hit UI that its own handler just removed from the DOM
	// (e.g. a result button: selectSpotlightSearchEntry -> closeSpotlightSearch empties the result
	// list BEFORE this document-level handler runs, so closest() can no longer see the overlay).
	// Treating that as an "outside" click wiped the just-drawn path highlight in the same tick.
	const target = event.target instanceof Element ? event.target : null;
	if (!target || !target.isConnected || target.closest(SPOTLIGHT_SELECTION_KEEPING_CLICK_SELECTOR)) {
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
		// Consume the click: it must not bubble to handleSpotlightDocumentClick, which would
		// clear the selection (and the path highlight) right after this handler drew it.
		event.stopPropagation();
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

function scheduleSpotlightSearchResultsUpdate() {
	clearTimeout(spotlightSearchInputTimeout);
	spotlightSearchInputTimeout = setTimeout(() => {
		spotlightSearchInputTimeout = null;
		updateSpotlightSearchResults();
	}, SPOTLIGHT_SEARCH_INPUT_DEBOUNCE_MS);
}

function updateSpotlightSearchResults() {
	const { input } = getSpotlightSearchElements();
	const query = input?.value || "";
	const renderToken = ++spotlightSearchRenderToken;
	const localEntries = searchSpotlightEntries(query);
	renderSpotlightSearchResults(localEntries);

	if (!shouldUseBackendSpotlightSearch(query)) {
		if (spotlightBackendAbortController) {
			spotlightBackendAbortController.abort();
			spotlightBackendAbortController = null;
		}
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
	const normalizedQuery = normalizeSpotlightSearchText(query);
	return Boolean(String(MAP_SEARCH_API_URL || "").trim() && normalizedQuery.length >= SPOTLIGHT_BACKEND_MIN_QUERY_LENGTH);
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

// Baut einen Such-Eintrag für ein politisches Gebiet, das aktuell NICHT als Polygon gerendert ist
// (nur aus dem Backend-Treffer: Name + public_id + Bounding-Box). Auswahl -> focusSpotlightRegion.
function buildSyntheticSpotlightRegionEntry(result, publicIds) {
	let bounds = null;
	const minX = Number(result.min_x), minY = Number(result.min_y), maxX = Number(result.max_x), maxY = Number(result.max_y);
	if ([minX, minY, maxX, maxY].every(Number.isFinite) && (minX !== maxX || minY !== maxY)) {
		bounds = L.latLngBounds([[minY, minX], [maxY, maxX]]);
	}
	return {
		id: `region:${publicIds[0]}`,
		kind: "region",
		name: String(result.name || ""),
		typeLabel: String(result.type_label || tr("spotlight.type.region", "Herrschaftsgebiet")),
		publicIds,
		regionEntry: null,
		polygons: [],
		bounds,
		minZoom: Number.isFinite(Number(result.min_zoom)) ? Number(result.min_zoom) : null,
		maxZoom: Number.isFinite(Number(result.max_zoom)) ? Number(result.max_zoom) : null,
		aliases: [],
		synthetic: true,
	};
}

// Ein Objekt, das IN einer Stadt liegt (Villa Gerbelstein, Plaza der Lüste, Webergasse) hat
// keine eigene Position auf der Weltkarte -- es steht nur in der Wiki-Registry und ist der
// Suche deshalb bisher gar nicht begegnet. Der Server kennt aber seine Stadt
// (api/_internal/wiki/place-scope.php) und schickt deren public_id mit.
//
// ⭐ Der Eintrag ERBT den Marker-Eintrag der Stadt und bleibt kind "location". Damit fliegt
// selectSpotlightSearchEntry über den GANZ NORMALEN Ortspfad (focusSpotlightLocation) --
// derselbe Flug, dieselbe Infobox, kein zweiter Navigationsweg, der auseinanderlaufen kann.
// Eigen sind nur Name und Beschriftung: gesucht wurde das Objekt, nicht die Stadt.
//
// 💣 Die id MUSS eine eigene sein. Übernähme der Eintrag die id der Stadt, würde er in
// resolveBackendSpotlightEntries per seenEntryIds gegen den echten Stadt-Treffer verrechnet
// -- je nach Reihenfolge verschwände einer der beiden.
function buildInSettlementSpotlightEntry(result) {
	const settlementPublicId = String(result.settlement_public_id || result.public_id || "");
	if (!settlementPublicId) {
		return null;
	}
	const { byPublicId } = getSpotlightSearchLookup();
	const settlementEntry = byPublicId.get(`location:${settlementPublicId}`);
	if (!settlementEntry) {
		return null; // Stadt gerade nicht auf der Karte -> nichts zum Anspringen
	}

	const name = String(result.name || "");
	return {
		...settlementEntry,
		id: `in_settlement:${settlementPublicId}:${name}`,
		name,
		typeLabel: String(result.type_label || ""),
		aliases: [],
		inSettlementName: String(result.settlement_name || ""),
		wikiUrl: String(result.wiki_url || ""),
		notOnMap: true,
	};
}

// The place kinds the Kartensammlung stores (settlement|territory|region|path) are NOT the kinds this
// file looks entries up by (location|region|label|path). Territories and landscape regions can both
// arrive as "region", and a landscape is a label here -- so each kind gets its candidate keys and the
// first one that exists wins. Getting this wrong would mark all 59 regional maps "not on the map".
function spotlightCitymapPlaceLookupKeys(placeKind, publicId) {
	const prefixes = {
		settlement: ["location"],
		territory: ["region"],
		region: ["region", "label"],
		path: ["path"],
	}[String(placeKind || "")] || [];
	return prefixes.map((prefix) => `${prefix}:${publicId}`);
}

// A map from the Kartensammlung. It has no position of its own -- it rides on the place it is assigned
// to, exactly like an in-settlement object. Modelled on buildInSettlementSpotlightEntry for the shared
// notOnMap-style presentation, but NOT for `kind`: that function deliberately KEEPS the inherited
// kind ("location") -- see ITS comment above -- specifically so the plain kind-dispatch in
// selectSpotlightSearchEntry just works unmodified. This entry instead OVERWRITES kind to "citymap" -- Task 7's
// result-list rendering needs a map hit to read as its own thing (a distinct row/section), not fold
// invisibly into whatever place it points to. That overwrite is exactly why selection/focus DOES need
// a special case here, unlike the in-settlement entry: placeEntryKind below preserves the placeEntry's
// original kind (location/region/label/path) so selectSpotlightSearchEntry's "citymap" branch
// (spotlight-search-focus.js: focusSpotlightCitymapPlace) knows which existing focus helper to
// delegate to -- the spread (`...base`) already carried that helper's expected fields
// (locationEntry/labelEntry/regionEntry+polygons+bounds/paths+bounds) along with it.
//
// A map with nothing to jump to is still LISTED -- being told the map exists is worth more than hiding
// it -- but it says so. Two independent reasons: the database never resolved the place (the server
// says so via `unresolved`, live 85 of 469), or the object is simply not loaded right now. Either way
// placeEntry stays null, unreachable is true, placeEntryKind is "" -- focusSpotlightCitymapPlace reads
// unreachable and no-ops rather than guessing a target.
function buildCitymapSpotlightEntry(result) {
	const name = String(result.name || "");
	if (!name) {
		return null;
	}

	const publicId = String(result.place_public_id || "");
	const { byPublicId } = getSpotlightSearchLookup();
	let placeEntry = null;
	if (publicId && !result.unresolved) {
		for (const key of spotlightCitymapPlaceLookupKeys(result.place_kind, publicId)) {
			placeEntry = byPublicId.get(key);
			if (placeEntry) {
				break;
			}
		}
	}

	const base = placeEntry || { bounds: null, publicIds: [], polygons: [] };
	return {
		...base,
		id: `citymap:${String(result.public_id || name)}`,
		kind: "citymap",
		// The placeEntry's own kind, saved off before the `kind: "citymap"` override above shadows it.
		// "" when placeEntry is null (unreachable) -- no place was resolved to have a kind at all.
		placeEntryKind: base.kind || "",
		name,
		typeLabel: String(result.type_label || ""),
		aliases: [],
		inSettlementName: String(result.place_name || ""),
		notOnMap: true,
		unreachable: !placeEntry,
		citymapTotal: Number(result.citymap_total) || 0,
	};
}

function resolveBackendSpotlightEntries(backendResults, localEntries) {
	const { byPublicId, byPathGroup } = getSpotlightSearchLookup();
	const resolvedEntries = [];
	const seenEntryIds = new Set();

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

		// Politisches Herrschaftsgebiet ohne lokal gerenderten Eintrag (Ebene nicht geladen /
		// ausserhalb des aktuellen Zoom-Bands): synthetischer Eintrag, der beim Auswählen auf die
		// politische Ebene schaltet, hinfliegt und die Infobox per public_id öffnet.
		if (!entry && kind === "region" && publicIds.length) {
			entry = buildSyntheticSpotlightRegionEntry(result, publicIds);
		}

		// Objekt INNERHALB einer Stadt (Villa, Platz, Stadttempel, Gasse). Es hat keine eigene
		// Kartenposition -- der Treffer trägt deshalb den Namen des Objekts, zeigt aber auf die
		// Stadt. Siehe buildInSettlementSpotlightEntry.
		if (!entry && kind === "in_settlement") {
			entry = buildInSettlementSpotlightEntry(result);
		}

		if (!entry && kind === "citymap") {
			entry = buildCitymapSpotlightEntry(result);
		}

		if (entry && entry.kind === "region") {
			if (Number.isFinite(Number(result.min_zoom))) entry.minZoom = Number(result.min_zoom);
			if (Number.isFinite(Number(result.max_zoom))) entry.maxZoom = Number(result.max_zoom);
		}

		if (!entry || seenEntryIds.has(entry.id)) {
			return;
		}

		seenEntryIds.add(entry.id);
		resolvedEntries.push(entry);
	});

	if (resolvedEntries.length) {
		// Maps sit outside the 20-result limit on purpose: the server already capped them at 5, and
		// counting them against the shared limit would let them displace exactly the map objects the
		// cap exists to protect.
		const mapObjects = resolvedEntries.filter((entry) => entry.kind !== "citymap");
		const citymaps = resolvedEntries.filter((entry) => entry.kind === "citymap");
		return [...mapObjects.slice(0, SPOTLIGHT_SEARCH_MAX_RESULTS), ...citymaps];
	}

	return localEntries;
}

function searchSpotlightEntries(query) {
	const normalizedQuery = normalizeSpotlightSearchText(query);
	if (!normalizedQuery) {
		return [];
	}

	return getSpotlightSearchEntries()
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

// Mirrors avesmapsCalculateSearchScore in api/_internal/app/map-search-scoring.php: every word of the
// query must hit at least one search text, the words may hit DIFFERENT ones, and the entry scores as
// badly as its weakest word. Both sides must agree -- a result list that mixes local and backend hits
// would otherwise rank the same object twice over by two different rules.
//
// NOTE: the two sides still NORMALISE differently (ue vs u for umlauts). That divergence is older than
// this function and is deliberately not touched here -- see the design doc, §7.
function getSpotlightSearchScore(entry, normalizedQuery) {
	const candidates = entry.normalizedSearchTexts || [entry.name, entry.typeLabel, ...(entry.aliases || [])]
		.map(normalizeSpotlightSearchText)
		.filter(Boolean);
	const words = String(normalizedQuery || "").split(" ").filter(Boolean);
	if (!words.length || !candidates.length) {
		return Infinity;
	}

	let worstWordScore = 0;
	for (const word of words) {
		let bestForWord = Infinity;
		candidates.forEach((candidate) => {
			bestForWord = Math.min(bestForWord, scoreSpotlightWord(candidate, word));
		});
		if (!Number.isFinite(bestForWord)) {
			return Infinity;
		}
		worstWordScore = Math.max(worstWordScore, bestForWord);
	}

	return worstWordScore;
}

// The four tiers, unchanged: equal / prefix / word-prefix / contained.
function scoreSpotlightWord(candidate, word) {
	if (candidate === word) {
		return 0;
	}
	if (candidate.startsWith(word)) {
		return 1;
	}
	if (candidate.split(" ").some((part) => part.startsWith(word))) {
		return 2;
	}
	if (candidate.includes(word)) {
		return 3;
	}

	return Infinity;
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
	// Innerorts-Objekte springen auf ihre STADT, nicht auf sich selbst -- das muss am Treffer
	// stehen, sonst sucht man nach dem Sprung einen Marker, den es nicht gibt. Der Zusatz hängt
	// unter der Typzeile („Palast in Mengbilla" / „Innerorts") und benutzt dasselbe Wort wie
	// der Lage-Filter im Editor, statt ein zweites für dieselbe Sache einzuführen.
	const notOnMap = entry.notOnMap
		? `<span class="spotlight-search__result-hint">${escapeHtml(tr("spotlight.inSettlement", "Innerorts"))}</span>`
		: "";
	const resultClass = "spotlight-search__result" + (entry.notOnMap ? " spotlight-search__result--not-on-map" : "");
	return `
		<button id="${resultId}" type="button" class="${resultClass}" data-spotlight-result-index="${index}" role="option">
			<span class="spotlight-search__result-name">${escapeHtml(entry.name)}</span>
			<span class="spotlight-search__result-type">${escapeHtml(entry.typeLabel)}${notOnMap}</span>
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

function getSpotlightSearchEntryCacheSignature() {
	return [
		locationMarkers.length,
		labelMarkers.length,
		regionPolygons.length,
		pathData.length,
		powerlineData.length,
	].join(":");
}

function invalidateSpotlightSearchEntryCache() {
	spotlightSearchEntryCache = null;
	spotlightSearchEntryCacheSignature = "";
	spotlightSearchLookupCache = null;
}

function getSpotlightSearchEntries() {
	const signature = getSpotlightSearchEntryCacheSignature();
	if (!spotlightSearchEntryCache || spotlightSearchEntryCacheSignature !== signature) {
		spotlightSearchEntryCache = buildSpotlightSearchEntries().map((entry) => ({
			...entry,
			normalizedSearchTexts: [entry.name, entry.typeLabel, ...(entry.aliases || [])]
				.map(normalizeSpotlightSearchText)
				.filter(Boolean),
		}));
		spotlightSearchEntryCacheSignature = signature;
		spotlightSearchLookupCache = null;
	}

	return spotlightSearchEntryCache;
}

function getSpotlightSearchLookup() {
	getSpotlightSearchEntries();
	if (spotlightSearchLookupCache) {
		return spotlightSearchLookupCache;
	}

	const byPublicId = new Map();
	const byPathGroup = new Map();
	getSpotlightSearchEntries().forEach((entry) => {
		(entry.publicIds || []).forEach((publicId) => {
			byPublicId.set(`${entry.kind}:${publicId}`, entry);
		});
		if (entry.kind === "path") {
			byPathGroup.set(getSpotlightPathGroupKey(entry.name, entry.subtype), entry);
		}
	});

	spotlightSearchLookupCache = { byPublicId, byPathGroup };
	return spotlightSearchLookupCache;
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
			typeLabel: entry.locationTypeLabel || tr("type." + entry.locationType + ".singular", LOCATION_TYPE_CONFIG[entry.locationType]?.singularLabel || "") || tr("spotlight.type.location", "Ort"),
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
				typeLabel: tr("spotlight.type.region", "Herrschaftsgebiet"),
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
	// Spotlight-Policy (Betreiber-Entscheid 2026-07-05): NUR wiki-verlinkte Wege sind suchbar --
	// show_label zaehlt nicht mehr (sonst standen Generik-Namen wie "Reichsstrasse-4903" in der
	// Suche). Gruppiert wird ueber die Weg-Identitaet wiki_key mit dem Wiki-Namen als Anzeige
	// (Altbestaende koennen noch Random-Segmentnamen tragen), und die Gruppe enthaelt ALLE
	// Segmente des Wegs -- Auswahl highlightet/zoomt damit den ganzen Weg, nicht nur die
	// gelabelten Teilstuecke.
	const pathGroups = new Map();
	pathData
		.filter((path) => !!path?.properties?.wiki_path)
		.forEach((path) => {
			const wikiPath = path.properties.wiki_path;
			const displayName = String(wikiPath.name || getPathDisplayName(path) || "").trim();
			if (!displayName) {
				return;
			}

			const subtype = normalizePathSubtype(path.properties?.feature_subtype || path.properties?.name);
			const groupKey = getSpotlightPathGroupKeyForPath(path, subtype);
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
					aliases: [subtype, wikiPath.wiki_url],
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
			typeLabel: tr("spotlight.type.powerline", "Kraftlinie"),
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
		vulkan: "Vulkan",
		wald: "Wald",
		steppe: "Steppe",
		huegelland: "Hügelland",
		tal: "Tal",
		tundra: "Tundra",
		kueste: "Küste",
		ebene: "Ebene",
		graslandschaft: "Graslandschaft",
		auenlandschaft: "Auenlandschaft",
		kontinent: "Kontinent",
		wueste: "Wueste",
		suempfe_moore: "Sumpf/Moor",
		see: "See",
		insel: "Insel",
		inselgruppe: "Inselgruppe",
		sonstiges: "Label",
	};
	return tr("spotlight.labelType." + labelType, labels[labelType] || "Label");
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
	return tr("spotlight.pathType." + subtype, labels[subtype] || "Weg");
}

function getSpotlightPathGroupKey(displayName, subtype) {
	return `${normalizePathSubtype(subtype)}:${normalizeSpotlightSearchText(displayName)}`;
}

// A way's spotlight identity: the wiki_key IS the way (avesmapsWikiPathAssign stamps one wiki_path onto
// every segment), a way without one falls back to name+subtype. Ask here instead of coining the key again:
// buildSpotlightPathEntries and the deep-link/"Anzeigen" route (focusWholeWikiDeeplinkPath) both need it,
// and two shapes for one way would make the same way read as two different selections. "" when the way has
// no usable name at all -- callers treat that as "no identity".
function getSpotlightPathGroupKeyForPath(path, subtype) {
	const wikiPath = path?.properties?.wiki_path || {};
	const wikiKey = String(wikiPath.wiki_key || "").trim();
	if (wikiKey !== "") {
		return `wiki:${wikiKey}`;
	}
	const displayName = String(wikiPath.name || getPathDisplayName(path) || "").trim();
	return displayName ? getSpotlightPathGroupKey(displayName, subtype) : "";
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

// (Spotlight focus/navigation moved to spotlight-search-focus.js - M5 split.)

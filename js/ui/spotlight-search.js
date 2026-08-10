const SPOTLIGHT_SEARCH_MAX_RESULTS = 20;
const SPOTLIGHT_SEARCH_INPUT_DEBOUNCE_MS = 140;
const SPOTLIGHT_BACKEND_MIN_QUERY_LENGTH = 2;
const SPOTLIGHT_SEARCH_RESULT_TYPE_ORDER = {
	location: 0,
	label: 1,
	region: 2,
	path: 3,
	powerline: 4,
	// None of these are map objects -- each is a pointer to one. Last, like the in-settlement objects.
	citymap: 6,
	adventure: 7,
	lore: 8,
};
// Sources that live NEXT to the map rather than on it. Each gets its own heading with a total, its own
// cap of 5 (enforced server-side) and sits OUTSIDE the 20-result limit -- counting them against the
// shared limit would let them displace exactly the map objects the cap exists to protect.
// The order of this array IS the order of the sections in the result list, and it matches the order
// api/app/map-search.php appends them in.
const SPOTLIGHT_SEARCH_SECTIONS = [
	{ kind: "citymap", totalField: "citymapTotal", labelKey: "spotlight.citymaps", label: "Kartensammlung", moreKey: "spotlight.citymapsMore", more: "… und {n} weitere Karten" },
	{ kind: "adventure", totalField: "gameLiteratureTotal", labelKey: "spotlight.gameLiterature", label: "Literatur", moreKey: "spotlight.gameLiteratureMore", more: "… und {n} weitere Werke" },
	{ kind: "lore", totalField: "loreTotal", labelKey: "spotlight.lore", label: "Vorkommen", moreKey: "spotlight.loreMore", more: "… und {n} weitere Vorkommen" },
];
const SPOTLIGHT_SECTION_KINDS = new Set(SPOTLIGHT_SEARCH_SECTIONS.map((section) => section.kind));
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

// The place kinds these sources store (settlement|territory|region|path) are NOT the kinds this file
// looks entries up by (location|region|label|path). Territories and landscape regions can both arrive
// as "region", and a landscape is a label here -- so each kind gets its candidate keys and the first
// one that exists wins. Getting this wrong would mark all 59 regional maps and all 311 region-starting
// adventures "not on the map".
function spotlightPlaceLookupKeys(placeKind, publicId) {
	const prefixes = {
		settlement: ["location"],
		territory: ["region"],
		region: ["region", "label"],
		path: ["path"],
	}[String(placeKind || "")] || [];
	return prefixes.map((prefix) => `${prefix}:${publicId}`);
}

// A hit that has NO position of its own and rides on a place: a map from the Kartensammlung, an
// adventure at the place it begins. Modelled on buildInSettlementSpotlightEntry for the shared notOnMap
// presentation, but NOT for `kind`: that function deliberately KEEPS the inherited kind ("location") so
// the plain kind-dispatch in selectSpotlightSearchEntry just works. This entry OVERWRITES kind, because
// the result list needs it to read as its own thing in its own section. That overwrite is exactly why
// selection/focus DOES need a case here: placeEntryKind preserves the placeEntry's original kind
// (location/region/label/path) so focusSpotlightPlaceEntry knows which existing focus helper to
// delegate to -- the spread (`...base`) already carried that helper's expected fields
// (locationEntry/labelEntry/regionEntry+polygons+bounds/paths+bounds) along with it.
//
// A hit with nothing to jump to is still LISTED -- being told the thing exists is worth more than
// hiding it -- but it says so. Two independent reasons: the database never resolved the place (the
// server says so via `unresolved`; live 85 of 469 map places, 376 of 1352 adventures), or the object is
// simply not loaded right now. Either way placeEntry stays null, unreachable is true, placeEntryKind is
// "" -- focusSpotlightPlaceEntry reads unreachable and no-ops rather than guessing a target.
function buildPlaceBoundSpotlightEntry(result, kind) {
	const name = String(result.name || "");
	if (!name) {
		return null;
	}

	const publicId = String(result.place_public_id || "");
	const { byPublicId } = getSpotlightSearchLookup();
	let placeEntry = null;
	if (publicId && !result.unresolved) {
		for (const key of spotlightPlaceLookupKeys(result.place_kind, publicId)) {
			placeEntry = byPublicId.get(key);
			if (placeEntry) {
				break;
			}
		}
	}

	const base = placeEntry || { bounds: null, publicIds: [], polygons: [] };
	return {
		...base,
		id: `${kind}:${String(result.public_id || name)}`,
		kind,
		// The placeEntry's own kind, saved off before the `kind` override above shadows it.
		// "" when placeEntry is null (unreachable) -- no place was resolved to have a kind at all.
		placeEntryKind: base.kind || "",
		name,
		typeLabel: String(result.type_label || ""),
		aliases: [],
		inSettlementName: String(result.place_name || ""),
		// "beginnt in Gareth" / "beschreibt Gareth" -- the wording carries the spoiler-free role (the
		// server sends WHICH one in place_role; it never sends a play place at all). Composed HERE, not
		// on the server: every other visible German string in the result list lives in this file, and the
		// server has no business owning one. Only shown when the place is actually reachable.
		placeHint: placeEntry && kind === "adventure" && result.place_name
			? (String(result.place_role || "") === "covers"
				? tr("spotlight.gameLiteratureCovers", "beschreibt {place}")
				: tr("spotlight.gameLiteratureStartsIn", "beginnt in {place}")).replace("{place}", String(result.place_name))
			: "",
		notOnMap: true,
		unreachable: !placeEntry,
		citymapTotal: Number(result.citymap_total) || 0,
		gameLiteratureTotal: Number(result.adventure_total) || 0,
	};
}

// Three tries, in this order (docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md
// §4.3): the stored wiki key, the title, the title without its parenthetical qualifier. The third
// exists because the wiki writes "Bornland (Region)" and the map says "Bornland" -- live, that single
// rule is what turns a miss into a hit.
//
// 💣 An empty wiki key is skipped, never looked up: "wk:" would otherwise be a real key that every
// keyless place matches, and whichever entry got inserted first would answer for all of them.
function resolveSpotlightLorePlace(byLorePlace, place) {
	const wikiKey = normalizeSpotlightSearchText(String((place && place.wiki_key) || ""));
	const title = String((place && place.title) || "");
	const titleKey = normalizeSpotlightSearchText(title);
	const bareKey = normalizeSpotlightSearchText(title.replace(/\s*\([^)]*\)\s*$/, ""));

	const candidates = [wikiKey ? `wk:${wikiKey}` : "", titleKey ? `nm:${titleKey}` : "", bareKey ? `nm:${bareKey}` : ""];
	for (const candidate of candidates) {
		const hit = candidate ? byLorePlace.get(candidate) : null;
		if (hit) {
			return hit;
		}
	}

	return null;
}

// An occurrence (Flora/Fauna/Ware) points at MANY places, not one -- so it cannot ride
// buildPlaceBoundSpotlightEntry, which inherits exactly one place's entry. And unlike a map or an
// adventure it has no resolved target at all: the server ships title + wiki key, this side does the
// join, because only this side knows what is loaded right now.
//
// The resolved place NAMES go into the row, up to three. They are the answer to the question the user
// actually asked -- "wo gibt es das?" -- and putting them there means the reader often need not click.
function buildLoreSpotlightEntry(result) {
	const name = String(result.name || "");
	if (!name) {
		return null;
	}

	const { byLorePlace } = getSpotlightSearchLookup();
	const places = Array.isArray(result.lore_places) ? result.lore_places : [];
	const resolved = [];
	const seen = new Set();
	places.forEach((place) => {
		const placeEntry = resolveSpotlightLorePlace(byLorePlace, place);
		if (placeEntry && !seen.has(placeEntry.id)) {
			seen.add(placeEntry.id);
			resolved.push(placeEntry);
		}
	});

	const shown = resolved.slice(0, 3).map((placeEntry) => placeEntry.name);
	const rest = resolved.length - shown.length;
	return {
		id: `lore:${String(result.public_id || name)}`,
		kind: "lore",
		name,
		typeLabel: String(result.type_label || ""),
		aliases: [],
		publicIds: [],
		bounds: null,
		lorePlaceEntries: resolved,
		placeHint: shown.join(" · ") + (rest > 0 ? ` +${rest}` : ""),
		notOnMap: true,
		// 31 % of occurrences carry no place at all and another 15 % name places the map does not have
		// (docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md §1.4). They stay
		// listed, hindmost and labelled -- "it exists, whereabouts unknown" beats no answer -- but a
		// click must not pretend to go somewhere.
		unreachable: resolved.length === 0,
		loreTotal: Number(result.lore_total) || 0,
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

		if (!entry && (kind === "citymap" || kind === "adventure")) {
			entry = buildPlaceBoundSpotlightEntry(result, kind);
		}

		if (!entry && kind === "lore") {
			entry = buildLoreSpotlightEntry(result);
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
		// Section hits sit outside the 20-result limit on purpose: the server already capped each
		// section at 5, and counting them against the shared limit would let them displace exactly the
		// map objects the cap exists to protect.
		const sectionOrder = SPOTLIGHT_SEARCH_SECTIONS.map((section) => section.kind);
		const mapObjects = resolvedEntries.filter((entry) => !SPOTLIGHT_SECTION_KINDS.has(entry.kind));
		// Array.prototype.sort is stable, so within one section the server's own ranking survives.
		const sectionEntries = resolvedEntries
			.filter((entry) => SPOTLIGHT_SECTION_KINDS.has(entry.kind))
			.sort((left, right) => sectionOrder.indexOf(left.kind) - sectionOrder.indexOf(right.kind));
		return [...mapObjects.slice(0, SPOTLIGHT_SEARCH_MAX_RESULTS), ...sectionEntries];
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
// this function and is deliberately not touched here -- see
// docs/superpowers/specs/2026-08-02-spotlight-kartensammlungen-design.md §7.
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

	// Each section is set apart with a heading rather than folded into the flat list: without it a hit
	// whose title does not contain the search word reads like a bug, and the count is the only place the
	// user learns that more exist than the cap shows.
	//
	// ⚠️ Heading and overflow line carry NO data-spotlight-result-index -- otherwise the arrow-key
	// navigation counts them as hits.
	const headingAt = new Map();
	const overflowAt = new Map();
	SPOTLIGHT_SEARCH_SECTIONS.forEach((section) => {
		const indices = [];
		entries.forEach((entry, index) => {
			if (entry.kind === section.kind) {
				indices.push(index);
			}
		});
		if (!indices.length) {
			return;
		}

		const total = Number(entries[indices[0]][section.totalField]) || 0;
		headingAt.set(indices[0], `<div class="spotlight-search__section" role="presentation">
				<span>${escapeHtml(tr(section.labelKey, section.label))}</span>
				<span>${total}</span>
			</div>`);
		if (total > indices.length) {
			overflowAt.set(indices[indices.length - 1], `<div class="spotlight-search__section-more" role="presentation">${escapeHtml(
				tr(section.moreKey, section.more).replace("{n}", String(total - indices.length))
			)}</div>`);
		}
	});

	results.innerHTML = entries
		.map((entry, index) => (headingAt.get(index) || "") + spotlightResultMarkup(entry, index) + (overflowAt.get(index) || ""))
		.join("");

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
	// A hit that points somewhere else needs a line saying so. Three cases, three wordings:
	//   in-settlement object   -> "Innerorts" (it sits inside the town the hit jumps to)
	//   unreachable pointer    -> "kein Ort auf der Karte" (map, adventure or occurrence with no target)
	//   reachable adventure /
	//   occurrence             -> its own hint (where it begins / where it occurs), set by its builder
	// A REACHABLE map deliberately gets NO hint: its typeLabel already names type and place
	// ("Grundriss · Gareth"). "Innerorts" must never appear under a section hit -- a territory or a way
	// is not a settlement, and in this project that is domain vocabulary, not a nuance.
	const hintText = entry.unreachable
		? tr("spotlight.noPlaceOnMap", "kein Ort auf der Karte")
		: (String(entry.placeHint || "")
			|| (entry.notOnMap && !SPOTLIGHT_SECTION_KINDS.has(entry.kind) ? tr("spotlight.inSettlement", "Innerorts") : ""));
	const notOnMap = hintText
		? `<span class="spotlight-search__result-hint">${escapeHtml(hintText)}</span>`
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
		spotlightEntryLookupPublicIds(entry).forEach((publicId) => {
			// First writer wins: a territory drawn as several region entries would otherwise have its
			// territory key point at whichever happened to come last.
			if (!byPublicId.has(`${entry.kind}:${publicId}`)) {
				byPublicId.set(`${entry.kind}:${publicId}`, entry);
			}
		});
		if (entry.kind === "path") {
			byPathGroup.set(getSpotlightPathGroupKey(entry.name, entry.subtype), entry);
		}
	});

	// Occurrence places arrive as a wiki key plus a title and NEVER as a resolved target
	// (docs/superpowers/specs/2026-08-02-spotlight-abenteuer-vorkommen-design.md §1.6), so they need a
	// key/name index rather than the public-id one.
	// Insert order IS the precedence -- label before region before location, first writer wins. 403 of
	// 465 resolvable occurrence places are labels, so a name that is both a landscape and a village
	// means the landscape: "Thorwal" the region, not the hamlet.
	const byLorePlace = new Map();
	const addLorePlaceKey = (key, entry) => {
		if (key && !byLorePlace.has(key)) {
			byLorePlace.set(key, entry);
		}
	};
	["label", "region", "location"].forEach((placeKind) => {
		getSpotlightSearchEntries().forEach((entry) => {
			if (entry.kind !== placeKind) {
				return;
			}
			const wikiKey = normalizeSpotlightSearchText(getSpotlightEntryWikiKey(entry));
			if (wikiKey) {
				addLorePlaceKey(`wk:${wikiKey}`, entry);
			}
			const nameKey = normalizeSpotlightSearchText(entry.name);
			if (nameKey) {
				addLorePlaceKey(`nm:${nameKey}`, entry);
			}
		});
	});

	spotlightSearchLookupCache = { byPublicId, byPathGroup, byLorePlace };
	return spotlightSearchLookupCache;
}

// Every public id an entry may be looked up by.
//
// 💣 A political territory carries TWO, and they are different strings: `regionEntry.publicId` is the
// rendered region's own id, `regionEntry.territoryPublicId` is the territory's. The index used to know
// only the first, while everything that POINTS at a territory -- an adventure's start place, a
// Kartensammlung entry, the backend's own region hits -- stores the second. Measured live 2026-08-02 on
// "Königreich Garetien": entry 25623a55-…, territory 99dacb52-…, and all 134 adventures beginning in a
// territory were listed as "kein Ort auf der Karte" while the political layer sat there fully rendered
// with 1356 areas. The click did nothing, and nothing anywhere said why.
function spotlightEntryLookupPublicIds(entry) {
	const publicIds = (entry.publicIds || []).filter(Boolean).map(String);
	const territoryPublicId = String(entry.regionEntry?.territoryPublicId || "");
	if (territoryPublicId && !publicIds.includes(territoryPublicId)) {
		publicIds.push(territoryPublicId);
	}

	return publicIds;
}

// The wiki key a spotlight entry carries -- the join key lore_place stores on its side. Every kind
// keeps it somewhere else: a label under label.wikiRegion, a settlement under location.wikiSettlement,
// a territory on the region entry (the same FIELDS avesmapsLorePlaceRefFromRegion reads in
// js/map-features/map-features-lore.js). Territory wiki keys carry a 'wiki:'/'name:' prefix
// (avesmapsPoliticalBuildWikiKey), but lore_place.place_wiki_key stores the BARE slug -- so the region
// branch strips it, the same two prefixes avesmapsLoreNormalizeKey strips, inlined here rather than
// calling that function: this file's load order relative to map-features-lore.js is not guaranteed.
// Label and settlement keys are already bare and need no stripping. "" when the object has no wiki page.
function getSpotlightEntryWikiKey(entry) {
	if (entry.kind === "label") {
		return String(entry.labelEntry?.label?.wikiRegion?.wiki_key || "");
	}
	if (entry.kind === "location") {
		return String(entry.locationEntry?.location?.wikiSettlement?.wiki_key || "");
	}
	if (entry.kind === "region") {
		const regionEntry = entry.regionEntry || {};
		const rawWikiKey = String(regionEntry.detail?.wiki_key || regionEntry.wikiRegion?.wiki_key || regionEntry.wikiKey || regionEntry.wiki_key || "");
		return rawWikiKey.replace(/^(?:wiki|name):/, "");
	}

	return "";
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

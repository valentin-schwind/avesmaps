// Clickable items in a way's infobox (Owner 2026-07-17): the stations in "Verlauf" and the tokens in "Lage"
// name objects we carry on the map ourselves, so they become gold fly-to links instead of dead text.
// Spec: docs/superpowers/specs/2026-07-17-weg-infobox-item-links-design.md
//
// The wiki link TARGETS are not available here -- the sync parser flattens both fields to display text:
// avesmapsWikiPathExtractVerlaufStations keeps end($parts) of a [[target|label]] link, and
// avesmapsWikiSyncCleanPoliticalTerritoryWikiValue strips [[...]] entirely. So we resolve by NAME against
// data the client already holds: no schema change, no re-sync, no extra request. Reformatting the stored
// `verlauf` to keep the targets is deliberately off the table -- avesmapsWikiPathCourseHash hashes that
// string, so a new format would flag every way as "changed" in the Verlauf sync.
//
// Owner rule: link ONLY what we actually have. A token we cannot resolve stays plain text -- never a link
// that leads nowhere.

// The separator avesmapsWikiPathExtractVerlaufStations joins the stations with (api/_internal/wiki/paths.php).
const PATH_ITEM_LINK_STATION_SEPARATOR = " → ";

// Two SEPARATE indexes, because one name can be two objects: "Perricum" is a territory in "Lage" AND a city
// in "Verlauf". The Lage token must open the territory, the station the city.
let pathItemLinkIndexCache = null;
let pathItemLinkIndexCacheSignature = "";

// Rendered markup per (field, value). Every segment of a way carries the SAME wiki_path object, so without
// this the identical Verlauf gets linkified once per SEGMENT (~1660 segments over ~320 ways = 5x the work)
// while refreshPathLayerPopup pre-builds every popup during hydration. Measured at production scale, dropping
// it costs ~190 ms instead of ~20 ms. Dropped whenever the index is rebuilt (it carries the index's refs).
let pathItemLinkMarkupCache = new Map();

// Cheap signature in the style of getSpotlightSearchEntryCacheSignature (js/ui/spotlight-search.js): the
// length of every array we harvest -- miss one and the index would never notice that source arriving or
// changing. View mode never mutates them; the edit mode's own rebuilds change the lengths whenever features
// are added or removed.
function pathItemLinkIndexSignature() {
	const len = (value) => Array.isArray(value) ? value.length : -1;
	return [
		len(typeof locationMarkers !== "undefined" ? locationMarkers : null),
		len(typeof locationData !== "undefined" ? locationData : null),
		len(typeof pathData !== "undefined" ? pathData : null),
		len(typeof labelMarkers !== "undefined" ? labelMarkers : null),
	].join(":");
}

// First key wins, so the caller controls precedence by insertion order (wiki_url pass before name pass).
function addPathItemLinkKey(index, key, value) {
	if (key && !index.has(key)) {
		index.set(key, value);
	}
}

// { items: Map<key, {kind, ref}>, territories: Map<key, {publicId, name}> }, memoized.
//
// `items` covers everything a Verlauf station can be. Measured on production (2026-07-17, 2946 stations over
// 320 ways): settlements alone resolve 57%, because a way's course legitimately names OTHER WAYS (junctions:
// "Reichsstraße 1", "Fürstenstraße"; rivers name rivers) and LANDSCAPES ("Trollzacken", "Goldene Bucht").
// Adding those two lifts it to 88%; the remaining ~11% we genuinely do not carry. `ref` is what the click
// needs per kind: a publicId for location/label, the way-identity key for path.
//
// Deliberately built from locationMarkers/locationData/pathData/labelMarkers and NOT from
// getSpotlightSearchEntries(): this runs inside preparePathData, and routing.js hydrates locations ->
// powerlines -> labels -> paths -> regions, so regionPolygons is still empty at that point -- building the
// spotlight cache here would do wasted work and store a premature signature. Our four sources are all filled
// by then (labels only because routing.js was reordered for exactly this -- see the note there). The CLICK
// resolves through the spotlight lookup instead, and by then everything is hydrated.
function getPathItemLinkIndexes() {
	const signature = pathItemLinkIndexSignature();
	if (pathItemLinkIndexCache && pathItemLinkIndexCacheSignature === signature) {
		return pathItemLinkIndexCache;
	}

	const items = new Map();
	const territories = new Map();
	const markers = (typeof locationMarkers !== "undefined" && Array.isArray(locationMarkers)) ? locationMarkers : [];

	// A marker is linkable only with a publicId: the click resolves through the spotlight byPublicId lookup
	// ("location:<id>"), so without one the link could not focus anything -- that would be a dead link.
	const linkableMarkers = markers.filter((markerEntry) => {
		const location = markerEntry?.location;
		if (!location || String(markerEntry?.publicId || "").trim() === "") {
			return false;
		}
		// Crossings are internal routing-graph nodes ("Kreuzung-7"), never a wiki station.
		return !(typeof isCrossingLocation === "function" && isCrossingLocation(location));
	});

	// Settlements first -- a station is primarily a place you pass, so a place beats a like-named way/landscape.
	// Pass 1 -- wiki_url: the stored wiki_url IS the object identity (invariant from the deep-link work), so it
	// gets precedence over any name coincidence.
	linkableMarkers.forEach((markerEntry) => {
		addPathItemLinkKey(items, wikiUrlToDeeplinkKey(markerEntry.location.wikiUrl), {
			kind: "location",
			ref: String(markerEntry.publicId).trim(),
		});
	});
	// Pass 2 -- display name: catches places whose wiki_url we never stored, and piped links whose label still
	// equals our own name.
	linkableMarkers.forEach((markerEntry) => {
		addPathItemLinkKey(items, normalizeWikiDeeplinkKey(markerEntry.name), {
			kind: "location",
			ref: String(markerEntry.publicId).trim(),
		});
	});

	// Ways: junctions to other roads, and the rivers a river's course names. WIKI-LINKED ONLY -- the Spotlight
	// policy (Owner 2026-07-05) is that a way without a wiki_path is not a searchable object, and its generic
	// "Reichsstrasse-4903" name is no identity to link to. Only 15 of 2946 stations would be gained by relaxing
	// this, so the policy costs nothing here. `ref` is always the wiki_url key: focusWholeWikiDeeplinkPath's
	// name channel compares a SEGMENT's raw name, which is not the wiki name -- the wiki_url channel is the
	// exact way identity.
	const paths = (typeof pathData !== "undefined" && Array.isArray(pathData)) ? pathData : [];
	paths.forEach((path) => {
		const wiki = path?.properties?.wiki_path;
		const wayKey = wikiUrlToDeeplinkKey(wiki?.wiki_url);
		if (!wiki?.wiki_url || !wayKey) {
			return;
		}
		addPathItemLinkKey(items, wayKey, { kind: "path", ref: wayKey });
		addPathItemLinkKey(items, normalizeWikiDeeplinkKey(wiki.name), { kind: "path", ref: wayKey });
	});

	// Landscapes/mountains/seas ("Trollzacken", "Meer der Sieben Winde") are map LABELS. Same publicId contract
	// as locations -- selectSpotlightSearchEntry routes kind "label" to focusSpotlightLabel.
	const labels = (typeof labelMarkers !== "undefined" && Array.isArray(labelMarkers)) ? labelMarkers : [];
	labels.forEach((labelEntry) => {
		const text = String(labelEntry?.label?.text || "").trim();
		const publicId = String(labelEntry?.label?.publicId || "").trim();
		if (text === "" || publicId === "") {
			return;
		}
		addPathItemLinkKey(items, normalizeWikiDeeplinkKey(text), { kind: "label", ref: publicId });
	});

	// Territories: harvested from the political hierarchy map-features.php already resolves per settlement
	// (location.political.hierarchy = the parent_id walk, leaf -> root, leaf included). Covers every territory
	// holding at least one settlement; a settlement-less territory stays plain text (documented limit).
	const locations = (typeof locationData !== "undefined" && Array.isArray(locationData)) ? locationData : [];
	locations.forEach((location) => {
		const chain = location?.political?.hierarchy;
		if (!Array.isArray(chain)) {
			return;
		}
		chain.forEach((node) => {
			const name = String(node?.name || "").trim();
			const publicId = String(node?.territory_public_id || "").trim();
			if (name === "" || publicId === "") {
				return;
			}
			addPathItemLinkKey(territories, normalizeWikiDeeplinkKey(name), { publicId, name });
		});
	});

	pathItemLinkIndexCache = { items, territories };
	pathItemLinkIndexCacheSignature = signature;
	// Rendered markup embeds publicIds from the index we just replaced -- it must not outlive it.
	pathItemLinkMarkupCache = new Map();
	return pathItemLinkIndexCache;
}

// Memoizes one field's markup. Resolves the index FIRST: a rebuild there drops this cache, so a stale entry
// can never survive it.
function cachedPathItemLinkMarkup(field, rawValue, build) {
	const indexes = getPathItemLinkIndexes();
	const cacheKey = `${field} ${String(rawValue || "")}`;
	if (pathItemLinkMarkupCache.has(cacheKey)) {
		return pathItemLinkMarkupCache.get(cacheKey);
	}
	const markup = build(indexes);
	pathItemLinkMarkupCache.set(cacheKey, markup);
	return markup;
}

// One resolved station. Its own class -- NOT .location-popup__political-link: that class already carries a
// delegated handler aiming at territories. Both would fire on one click (the political one bailing on the
// missing data attribute) -- working by accident, not by design. The shared gold look comes from the CSS rule
// listing both classes (css/features/location-popups-markers.css).
// The VISIBLE text stays the wiki's own token (the Verlauf line is a quote from the article); only the target
// is ours. kind+ref is everything the click needs -- no re-resolution, no ambiguity, no request.
function pathItemStationLinkMarkup(token, hit) {
	return '<button type="button" class="location-popup__station-link" '
		+ `data-station-kind="${escapeHtml(hit.kind)}" data-station-ref="${escapeHtml(hit.ref)}">`
		+ `${escapeHtml(token)}</button>`;
}

// Splits a field, resolves every token against `index`, and renders hits as links / misses as plain text.
// Returns "" for an empty field so the caller can drop the whole row.
//
// The padding around each token is re-emitted verbatim instead of being normalized away: we must match the
// token WITHOUT its surrounding spaces to resolve it, but the field is wiki prose and has to read exactly as
// before -- joining on the bare separator would turn "Nordmarken, Kosch" into "Nordmarken,Kosch".
function linkifyPathItemField(rawValue, separator, index, renderLink) {
	const value = String(rawValue || "").trim();
	if (value === "") {
		return "";
	}
	return value
		.split(separator)
		.map((part) => {
			const [, lead, token, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(part);
			if (token === "") {
				return escapeHtml(part);
			}
			const hit = index.get(normalizeWikiDeeplinkKey(token));
			const rendered = hit ? renderLink(token, hit) : escapeHtml(token);
			return escapeHtml(lead) + rendered + escapeHtml(trail);
		})
		.join(escapeHtml(separator));
}

// "Verlauf": the parser-made "A → B → C" chain, so the split is exact. A station can be a settlement, another
// way (a junction) or a landscape -- `items` holds all three.
function linkifyPathVerlauf(verlauf) {
	return cachedPathItemLinkMarkup("verlauf", verlauf, (indexes) => linkifyPathItemField(
		verlauf,
		PATH_ITEM_LINK_STATION_SEPARATOR,
		indexes.items,
		pathItemStationLinkMarkup
	));
}

// "Lage": free wiki prose whose [[...]] boundaries the cleaner already removed, so splitting on "," is a
// heuristic. A bad split just yields a token that resolves to nothing and stays text -- harmless under the
// "only link what we have" rule. Territory links reuse settlementTerritoryLinkMarkup verbatim: same markup,
// same class, same delegated handler as the settlement political line (js/routing/routing.js).
function linkifyPathLage(lage) {
	return cachedPathItemLinkMarkup("lage", lage, (indexes) => linkifyPathItemField(lage, ",", indexes.territories, function (token, hit) {
		return typeof settlementTerritoryLinkMarkup === "function"
			? settlementTerritoryLinkMarkup({ name: token, territory_public_id: hit.publicId })
			: escapeHtml(token);
	}));
}

// Owner: every kind of way EXCEPT sea routes. Rivers are in -- same code path, and their stations are places
// just like a road's.
function pathSupportsItemLinks(path) {
	const subtype = typeof normalizePathSubtype === "function"
		? normalizePathSubtype(path?.properties?.feature_subtype || path?.properties?.name)
		: "";
	return subtype !== "Seeweg";
}

// Click target of a station link. The index resolved kind+ref when the markup was built, so this only routes
// -- no re-resolution, no ambiguity, no request. Everything here is existing focus machinery: the spotlight
// and the wiki deep-link land in exactly the same places.
//
//   path  -> mark the WHOLE way and zoom to its extent (what "Anzeigen" / ?strasse= does). A junction to
//            "Reichsstraße 1" means the road, not a point on it.
//   other -> the spotlight entry by publicId; selectSpotlightSearchEntry routes location -> focusSpotlightLocation
//            (flies + opens the infopanel) and label -> focusSpotlightLabel (zooms to the landscape).
function focusPathItemStation(kind, ref) {
	const target = String(ref || "").trim();
	if (target === "") {
		return;
	}
	if (kind === "path") {
		if (typeof focusWholeWikiDeeplinkPath === "function") {
			focusWholeWikiDeeplinkPath(target);
		}
		return;
	}
	if (typeof getSpotlightSearchLookup !== "function" || typeof selectSpotlightSearchEntry !== "function") {
		return;
	}
	const entry = getSpotlightSearchLookup().byPublicId.get(`${kind}:${target}`);
	if (entry) {
		selectSpotlightSearchEntry(entry);
	}
}

// Click target of the "Anzeigen" tile: highlight the WHOLE way + zoom to its full extent -- literally what
// ?strasse=/?fluss= does, via the very same resolver (js/app/wiki-deeplink.js).
function showWholePathFromInfobox(path) {
	const wikiUrl = path?.properties?.wiki_path?.wiki_url || "";
	if (!wikiUrl || typeof focusWholeWikiDeeplinkPath !== "function" || typeof wikiUrlToDeeplinkKey !== "function") {
		return;
	}
	focusWholeWikiDeeplinkPath(wikiUrlToDeeplinkKey(wikiUrl));
}

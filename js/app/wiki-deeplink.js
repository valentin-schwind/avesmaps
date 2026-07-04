/*
 * Wiki-Aventurica deep-link resolver: focus a map object BY WIKI PAGE NAME.
 *
 * The operator drops a URL into each wiki infobox template; the query-parameter name mirrors the
 * infobox name 1:1 (?siedlung / ?staat / ?region / ?strasse / ?fluss). The value is the raw wiki
 * page name (URL-encoded by the wiki via {{PAGENAMEE}}/urlencode), e.g. `?staat=F%C3%BCrstentum_Kosch`.
 *
 * Resolution is intentionally NOT a re-implementation of the two divergent server slug normalizers
 * (avesmapsPoliticalSlug: ä->a, hyphens kept vs avesmapsWikiSyncCreateMatchKey: ä->a, separators
 * stripped). Instead we match the decoded+normalized pagename against each candidate object's STORED
 * `wiki_url` page segment -- the wiki_url holds the original page name, the single reliable source.
 * Spotlight entries already carry that wiki_url (locations/regions in their aliases, paths via their
 * grouped path features), so we reuse getSpotlightSearchEntries() + selectSpotlightSearchEntry() and
 * never re-invent focusing. If nothing matches client-side (object outside the current BF-year/zoom
 * band or not hydrated), we fall back to ONE request to our own /api/app/map-search.php.
 *
 * Wired from routing.js (after applyPlaceFocusFromUrl(), i.e. after markers/regions have hydrated).
 * Plain classic script: global function declarations, no top-level execution.
 */

// Parameter name -> routing kind precedence. First kind that yields a client-side wiki_url match (or a
// backend result) wins; a Reichsstadt carries {{Infobox Siedlung}} yet is a territory here, so we never
// hard-fail on the primary kind and always fall through the ordered candidates.
const WIKI_DEEPLINK_PARAM_ROUTING = {
	siedlung: ["location", "region", "label"],
	staat: ["region", "location"],
	region: ["region", "label", "location"],
	strasse: ["path"],
	fluss: ["path"],
};

// Kept in sync with the strip list in share-link.js so a shared ?s= code never re-embeds a deep-link param.
const WIKI_DEEPLINK_PARAM_NAMES = Object.keys(WIKI_DEEPLINK_PARAM_ROUTING);

// Read the deep-link params up front (INITIAL_SEARCH_PARAMS is captured synchronously in config.js before
// the planner rewrites the URL). Returns the first present {param, kinds, pageName} or null.
function readWikiDeeplinkRequest() {
	const params = typeof INITIAL_SEARCH_PARAMS !== "undefined" && INITIAL_SEARCH_PARAMS
		? INITIAL_SEARCH_PARAMS
		: (() => {
			try {
				return new URLSearchParams(window.location.search);
			} catch (error) {
				return new URLSearchParams("");
			}
		})();
	for (const paramName of WIKI_DEEPLINK_PARAM_NAMES) {
		const rawValue = params.get(paramName);
		if (rawValue && String(rawValue).trim()) {
			return {
				param: paramName,
				kinds: WIKI_DEEPLINK_PARAM_ROUTING[paramName],
				pageName: String(rawValue).trim(),
			};
		}
	}
	return null;
}

// Normalize a wiki page name (or a wiki_url page segment) to a separator-/case-insensitive comparison key.
// Decode percent-escapes, underscores->spaces, strip diacritics, ß->ss, drop everything non-alphanumeric so
// the incoming pagename and the object's stored wiki_url compare equal regardless of the wiki's URL encoding.
function normalizeWikiDeeplinkKey(value) {
	let decoded = String(value || "");
	try {
		// Wiki encodes spaces as underscores AND percent-escapes non-ASCII; decode both. Replace '+' first
		// (some encoders use it for space) so decodeURIComponent does not choke on a bare '+'.
		decoded = decodeURIComponent(decoded.replace(/\+/g, " "));
	} catch (error) {
		// Malformed percent-sequence -> keep the raw value, normalization below still yields a usable key.
		decoded = String(value || "");
	}
	return decoded
		.replace(/_/g, " ")
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/ß/g, "ss")
		.replace(/æ/g, "ae")
		.replace(/œ/g, "oe")
		.replace(/[^a-z0-9]+/g, "")
		.trim();
}

// Pull the `/wiki/<Page>` segment out of a stored wiki_url and normalize it. Accepts a full URL
// (https://de.wiki-aventurica.de/wiki/Havena) or a bare page name; returns "" when there is nothing usable.
function wikiUrlToDeeplinkKey(wikiUrl) {
	const raw = String(wikiUrl || "").trim();
	if (!raw) {
		return "";
	}
	let pageSegment = raw;
	const wikiMatch = /\/wiki\/([^?#]+)/i.exec(raw);
	if (wikiMatch) {
		pageSegment = wikiMatch[1];
	} else if (/^https?:\/\//i.test(raw)) {
		// A wiki URL without a /wiki/ path (unexpected) -> take the last path segment.
		const tail = raw.split(/[?#]/)[0].split("/").filter(Boolean).pop();
		pageSegment = tail || raw;
	}
	return normalizeWikiDeeplinkKey(pageSegment);
}

// Every wiki_url a spotlight entry can be matched on, by kind:
//  - location: entry.locationEntry.location.wikiUrl
//  - region:   entry.regionEntry.wikiUrl (synthetic backend entries have none -> matched via map-search)
//  - path:     any grouped path feature's properties.wiki_path.wiki_url
function spotlightEntryWikiKeys(entry) {
	const keys = [];
	const pushKey = (wikiUrl) => {
		const key = wikiUrlToDeeplinkKey(wikiUrl);
		if (key) {
			keys.push(key);
		}
	};
	if (entry.kind === "location") {
		pushKey(entry.locationEntry?.location?.wikiUrl);
	} else if (entry.kind === "region") {
		pushKey(entry.regionEntry?.wikiUrl);
	} else if (entry.kind === "path") {
		(entry.paths || []).forEach((path) => pushKey(path?.properties?.wiki_path?.wiki_url));
	} else if (entry.kind === "label") {
		pushKey(entry.labelEntry?.label?.wikiUrl);
	}
	return keys;
}

// Find a hydrated spotlight entry whose stored wiki_url matches `targetKey`, preferring the kinds in order.
function findWikiDeeplinkSpotlightEntry(targetKey, kinds) {
	if (!targetKey || typeof getSpotlightSearchEntries !== "function") {
		return null;
	}
	let entries;
	try {
		entries = getSpotlightSearchEntries();
	} catch (error) {
		return null;
	}
	if (!Array.isArray(entries) || !entries.length) {
		return null;
	}
	for (const kind of kinds) {
		const match = entries.find((entry) => entry.kind === kind && spotlightEntryWikiKeys(entry).includes(targetKey));
		if (match) {
			return match;
		}
	}
	return null;
}

// Fallback: our own unified search (map_features + political_territory) by page name. One request, no crawl.
// Reuse resolveBackendSpotlightEntries so backend rows become real focusable spotlight entries (including the
// synthetic-region path for territories not currently rendered), then pick the top result honoring precedence.
function resolveWikiDeeplinkViaMapSearch(request) {
	const endpoint = typeof MAP_SEARCH_API_URL !== "undefined" ? String(MAP_SEARCH_API_URL || "").trim() : "";
	if (!endpoint) {
		return;
	}
	let decodedPageName = request.pageName;
	try {
		decodedPageName = decodeURIComponent(request.pageName.replace(/\+/g, " "));
	} catch (error) {
		decodedPageName = request.pageName;
	}
	const searchUrl = new URL(endpoint, window.location.href);
	searchUrl.searchParams.set("q", decodedPageName.replace(/_/g, " "));
	searchUrl.searchParams.set("limit", "20");
	fetch(searchUrl.toString(), { headers: { Accept: "application/json" } })
		.then((response) => (response.ok ? response.json() : null))
		.then((payload) => {
			const results = Array.isArray(payload?.results) ? payload.results : [];
			if (!results.length || typeof resolveBackendSpotlightEntries !== "function") {
				return;
			}
			const resolvedEntries = resolveBackendSpotlightEntries(results, []);
			if (!resolvedEntries.length) {
				return;
			}
			// Prefer a result of a kind this param routes to; otherwise take the backend's own top hit.
			let chosen = null;
			for (const kind of request.kinds) {
				chosen = resolvedEntries.find((entry) => entry.kind === kind);
				if (chosen) {
					break;
				}
			}
			chosen = chosen || resolvedEntries[0];
			if (chosen && typeof selectSpotlightSearchEntry === "function") {
				selectSpotlightSearchEntry(chosen);
			}
		})
		.catch(() => {});
}

// Entry point: called once from the load path (routing.js, after applyPlaceFocusFromUrl) once markers and
// regions are hydrated. Resolves ?siedlung/?staat/?region/?strasse/?fluss to a map object and focuses it.
function applyWikiDeeplinkFromUrl() {
	const request = readWikiDeeplinkRequest();
	if (!request) {
		return;
	}
	const targetKey = normalizeWikiDeeplinkKey(request.pageName);
	const entry = findWikiDeeplinkSpotlightEntry(targetKey, request.kinds);
	if (entry && typeof selectSpotlightSearchEntry === "function") {
		// Reuse the spotlight focus router: it centers + opens the popup for locations, switches to the
		// political layer and polls the region infobox for territories, and highlights the segment for paths
		// (paths have no popup -- expected).
		selectSpotlightSearchEntry(entry);
		return;
	}
	// No client-side wiki_url match (object outside the current BF-year/zoom band or not hydrated) -> our API.
	resolveWikiDeeplinkViaMapSearch(request);
}

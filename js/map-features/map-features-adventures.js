// Abenteuer-Feature (Phase 1) -- client catalog + index. Loads the whole approved adventure catalog
// ONCE (only in infopanel mode) from api/app/adventures.php and builds lookup indices so the settlement
// infopanel (map-features-place-extras.js) and the questroute (map-features-questroute.js) can query
// adventures locally (B1 -- no server geometry, no per-popup fetch).
//
// Load order: this file is included AFTER map-features-infopanel.js, so config.js (IS_INFOPANEL_MODE,
// SQL_MAP_HOSTS), wiki-deeplink.js (normalizeWikiDeeplinkKey/wikiUrlToDeeplinkKey) and place-extras are
// all defined. It does NOT touch the Leaflet `map` at load time (map is created last in bootstrap.js).
//
// Matching axis (Spec §5 slug-divergence): the PRIMARY settlement match is by target_public_id (exact).
// The wiki-key indices are best-effort/forward-compat (Phase 2 aggregation) -- server slug (iconv ö->oe)
// and client normalizeWikiDeeplinkKey (ö->o) can diverge on umlauts, so never rely on the key alone for
// a settlement that has a public_id.

var avesmapsAdventureCatalogState = { loaded: false, loading: null, catalog: [], index: null };

// ---- pure core (exported for Node tests; no window/fetch/DOM) -------------------------------------

// Wiki "Ort" product-type slug -> German display label. Unknown slugs pass through capitalized-as-is.
function avesmapsAdventureProductTypeLabel(productType) {
	var labels = {
		gruppenabenteuer: "Gruppenabenteuer",
		soloabenteuer: "Soloabenteuer",
		kurzabenteuer: "Kurzabenteuer",
		szenario: "Szenario",
		anthologie: "Anthologie",
		kampagne: "Kampagne",
	};
	var key = String(productType == null ? "" : productType).toLowerCase();
	return labels[key] || (productType ? String(productType) : "");
}

// Normalize a stored wiki key ('wiki:<slug>') OR a page name into the client comparison key: strip the
// 'wiki:' prefix, then apply the deeplink normalizer (NFD diacritic strip, lowercase, drop non-alnum).
function avesmapsNormalizeAdventureKey(key) {
	if (!key) {
		return "";
	}
	var bare = String(key).replace(/^wiki:/i, "");
	if (typeof normalizeWikiDeeplinkKey === "function") {
		return normalizeWikiDeeplinkKey(bare);
	}
	var lowered = bare.normalize ? bare.normalize("NFD").replace(/[̀-ͯ]/g, "") : bare;
	return lowered.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

// Catalog adventure -> the render shape place-extras already consumes (title/type/year/yearLabel/cover/url).
function avesmapsAdventureToRenderShape(adventure) {
	return {
		public_id: adventure.public_id || "",
		title: adventure.title || "",
		type: avesmapsAdventureProductTypeLabel(adventure.product_type),
		edition: adventure.edition || "",
		year: Number(adventure.bf_year) || 0,
		yearLabel: adventure.bf_label || (adventure.bf_year ? adventure.bf_year + " BF" : ""),
		cover: adventure.cover_url || "",
		url: adventure.wiki_url || "",
		placeCount: Array.isArray(adventure.places) ? adventure.places.length : 0,
	};
}

// Build lookup indices from the catalog. Each index maps a place target -> [{ adv, role }] where role is
// the place's role AT that target ('start' = beginnt hier, 'play' = spielt hier).
function avesmapsBuildAdventureIndex(catalog, normalizeKey) {
	var norm = typeof normalizeKey === "function" ? normalizeKey : avesmapsNormalizeAdventureKey;
	var index = {
		bySettlementPublicId: {},
		bySettlementKey: {},
		byTerritoryKey: {},
		byRegionKey: {},
		byPublicId: {},
	};
	function pushEntry(bucket, key, entry) {
		if (!key) {
			return;
		}
		var list = bucket[key] || (bucket[key] = []);
		for (var i = 0; i < list.length; i += 1) {
			if (list[i].adv.public_id === entry.adv.public_id && list[i].role === entry.role) {
				return; // dedupe: same adventure + same role at the same target
			}
		}
		list.push(entry);
	}
	(catalog || []).forEach(function (adventure) {
		if (!adventure || !adventure.public_id) {
			return;
		}
		index.byPublicId[adventure.public_id] = adventure;
		(adventure.places || []).forEach(function (place) {
			var entry = { adv: adventure, role: place.role === "start" ? "start" : "play" };
			var normKey = norm(place.target_wiki_key);
			if (place.target_kind === "settlement") {
				pushEntry(index.bySettlementPublicId, place.target_public_id, entry);
				pushEntry(index.bySettlementKey, normKey, entry);
			} else if (place.target_kind === "territory") {
				pushEntry(index.byTerritoryKey, normKey, entry);
			} else if (place.target_kind === "region") {
				pushEntry(index.byRegionKey, normKey, entry);
			}
		});
	});
	return index;
}

// Select { adv, role } entries for a place reference { publicId, key } filtered by role
// ('start' | 'play' | 'all'), deduped by adventure (public_id wins once).
function avesmapsSelectAdventureEntries(index, ref, role) {
	if (!index || !ref) {
		return [];
	}
	var wantAll = role === "all" || !role;
	var seen = {};
	var collected = [];
	function collect(list) {
		(list || []).forEach(function (entry) {
			if (!wantAll && entry.role !== role) {
				return;
			}
			if (seen[entry.adv.public_id]) {
				return;
			}
			seen[entry.adv.public_id] = true;
			collected.push(entry);
		});
	}
	if (ref.publicId) {
		collect(index.bySettlementPublicId[ref.publicId]);
	}
	if (ref.key) {
		collect(index.bySettlementKey[ref.key]);
		collect(index.byTerritoryKey[ref.key]);
		collect(index.byRegionKey[ref.key]);
	}
	return collected;
}

// ---- browser wrappers (window API named by the instruction) --------------------------------------

function avesmapsAdventuresEndpointUrl() {
	if (typeof window !== "undefined" && window.AVESMAPS_ADVENTURES_ENDPOINT) {
		return window.AVESMAPS_ADVENTURES_ENDPOINT;
	}
	if (typeof SQL_MAP_HOSTS !== "undefined" && typeof window !== "undefined" && SQL_MAP_HOSTS.has(window.location.hostname)) {
		return "api/app/adventures.php";
	}
	return ""; // e.g. localhost dev without a backend -> ready-empty, place-extras keeps its fallback
}

function avesmapsApplyAdventureCatalog(catalog) {
	var state = avesmapsAdventureCatalogState;
	state.catalog = Array.isArray(catalog) ? catalog : [];
	state.index = avesmapsBuildAdventureIndex(state.catalog, avesmapsNormalizeAdventureKey);
	state.loaded = true;
	if (typeof window !== "undefined") {
		window.avesmapsAdventureCatalog = state.catalog;
		window.avesmapsAdventureCatalogReady = true;
	}
}

// Load the catalog once. Injected window.AVESMAPS_ADVENTURE_CATALOG (repro harness / tests) bypasses
// the fetch. Returns a promise resolving to the catalog array.
function avesmapsLoadAdventureCatalog() {
	var state = avesmapsAdventureCatalogState;
	if (state.loading) {
		return state.loading;
	}
	if (typeof window !== "undefined" && Array.isArray(window.AVESMAPS_ADVENTURE_CATALOG)) {
		avesmapsApplyAdventureCatalog(window.AVESMAPS_ADVENTURE_CATALOG);
		state.loading = Promise.resolve(state.catalog);
		return state.loading;
	}
	var url = avesmapsAdventuresEndpointUrl();
	if (!url || typeof fetch !== "function") {
		avesmapsApplyAdventureCatalog([]);
		state.loading = Promise.resolve(state.catalog);
		return state.loading;
	}
	state.loading = fetch(url, { headers: { Accept: "application/json" } })
		.then(function (response) { return response && response.ok ? response.json() : null; })
		.then(function (data) {
			var catalog = data && data.ok && Array.isArray(data.adventures) ? data.adventures : [];
			avesmapsApplyAdventureCatalog(catalog);
			return state.catalog;
		})
		.catch(function () {
			// Network/parse error: stay UNREADY so place-extras keeps its placeholder fallback and a
			// later open can retry (loading is reset so the next call re-fetches).
			state.loading = null;
			return [];
		});
	return state.loading;
}

function avesmapsAdventureCatalogIsReady() {
	return avesmapsAdventureCatalogState.loaded === true && !!avesmapsAdventureCatalogState.index;
}

// Build a place reference { publicId, key } from a location-like object (settlement popup passes the
// map-features `location`, which carries publicId + wikiUrl).
function avesmapsBuildAdventurePlaceRef(placeRef) {
	if (!placeRef) {
		return {};
	}
	var publicId = placeRef.publicId || placeRef.public_id || "";
	var key = "";
	var wikiUrl = placeRef.wikiUrl || placeRef.wiki_url || "";
	if (wikiUrl && typeof wikiUrlToDeeplinkKey === "function" && typeof normalizeWikiDeeplinkKey === "function") {
		key = normalizeWikiDeeplinkKey(wikiUrlToDeeplinkKey(wikiUrl));
	} else if (placeRef.wikiKey || placeRef.wiki_key) {
		key = avesmapsNormalizeAdventureKey(placeRef.wikiKey || placeRef.wiki_key);
	}
	return { publicId: publicId, key: key };
}

// Adventures for a place, in render shape. opts.role: 'start' (beginnt, default) | 'play' (spielt) | 'all'.
function getAdventuresForPlace(placeRef, opts) {
	var index = avesmapsAdventureCatalogState.index;
	if (!index) {
		return [];
	}
	var role = (opts && opts.role) || "start";
	var ref = avesmapsBuildAdventurePlaceRef(placeRef);
	return avesmapsSelectAdventureEntries(index, ref, role).map(function (entry) {
		return avesmapsAdventureToRenderShape(entry.adv);
	});
}

// All places of one adventure (in sort_order) -- for the questroute. Returns the raw place objects.
function getAdventurePlaces(publicId) {
	var index = avesmapsAdventureCatalogState.index;
	if (!index || !publicId) {
		return [];
	}
	var adventure = index.byPublicId[publicId];
	return adventure && Array.isArray(adventure.places) ? adventure.places.slice() : [];
}

// ---- exports -------------------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsAdventureProductTypeLabel: avesmapsAdventureProductTypeLabel,
		avesmapsNormalizeAdventureKey: avesmapsNormalizeAdventureKey,
		avesmapsAdventureToRenderShape: avesmapsAdventureToRenderShape,
		avesmapsBuildAdventureIndex: avesmapsBuildAdventureIndex,
		avesmapsSelectAdventureEntries: avesmapsSelectAdventureEntries,
	};
}
if (typeof window !== "undefined") {
	window.avesmapsLoadAdventureCatalog = avesmapsLoadAdventureCatalog;
	window.avesmapsAdventureCatalogIsReady = avesmapsAdventureCatalogIsReady;
	window.getAdventuresForPlace = getAdventuresForPlace;
	window.getAdventurePlaces = getAdventurePlaces;
	window.avesmapsAdventureCatalogReady = window.avesmapsAdventureCatalogReady || false;
	// Kick the single catalog fetch as early as possible when in infopanel mode; the popup opens
	// (user-initiated) generally after this resolves.
	if (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE) {
		avesmapsLoadAdventureCatalog();
	}
}

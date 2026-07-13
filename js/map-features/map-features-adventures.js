// Abenteuer-Feature (Phase 1) -- client catalog + index. Loads the whole approved adventure catalog
// ONCE (only in infopanel mode) from api/app/adventures.php and builds lookup indices so the settlement
// infopanel (map-features-place-extras.js) can query adventures locally (B1 -- no server geometry, no
// per-popup fetch). NB: the wiki "Ort" list order is NOT a quest route -- routes are editor-maintained
// per settlement (future), decoupled from the beginnt/spielt display.
//
// Load order: this file is included AFTER map-features-infopanel.js, so config.js (IS_INFOPANEL_MODE,
// SQL_MAP_HOSTS), wiki-deeplink.js (normalizeWikiDeeplinkKey/wikiUrlToDeeplinkKey) and place-extras are
// all defined. It does NOT touch the Leaflet `map` at load time (map is created last in bootstrap.js).
//
// Matching axis (Spec §5 slug-divergence): the PRIMARY settlement match is by target_public_id (exact).
// The wiki-key indices are best-effort/forward-compat (Phase 2 aggregation) -- server slug (iconv ö->oe)
// and client normalizeWikiDeeplinkKey (ö->o) can diverge on umlauts, so never rely on the key alone for
// a settlement that has a public_id.

var avesmapsAdventureCatalogState = { loaded: false, loading: null, catalog: [], index: null, territoryMeta: {}, coversEnabled: true };

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

// Sort key for the DSA edition so a "nach Edition" sort groups DSA1 < DSA2 < … < DSA5 < non-DSA rules <
// (no edition). Extracts the FIRST DSA<n>(.<m>) number ("DSA4.1 Basis" -> 4.1, "DSA1-Ausbau" -> 1, "DSA4 /
// DSA5" -> 4); a non-DSA ruleset (Aventuria, regelfrei, …) sorts at 98, an empty edition last at 99. Owner:
// the edition roughly approximates an adventure's era, so it is the more meaningful primary sort than title.
function avesmapsAdventureEditionSortKey(edition) {
	var s = String(edition == null ? "" : edition).trim();
	if (!s) {
		return 99;
	}
	var m = s.match(/DSA\s*(\d+(?:\.\d+)?)/i);
	return m ? parseFloat(m[1]) : 98;
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
// Phase 2.3 adds the facets the "Alle anzeigen" dialog filters on: official (bool), complexity (Spielleiter
// preferred, else Spieler), genre. Kept on the SAME shape so the settlement strip and the nested dialog read
// identical cards.
function avesmapsAdventureToRenderShape(adventure) {
	return {
		public_id: adventure.public_id || "",
		title: adventure.title || "",
		type: avesmapsAdventureProductTypeLabel(adventure.product_type),
		edition: adventure.edition || "",
		year: Number(adventure.bf_year) || 0,
		yearLabel: adventure.bf_label || (adventure.bf_year ? adventure.bf_year + " BF" : ""),
		cover: avesmapsAdventureCatalogState.coversEnabled === false ? "" : (adventure.cover_url || ""),
		url: adventure.wiki_url || "",
		fshop: adventure.fshop_code || "",
		linkUlisses: adventure.link_ulisses || "",
		linkFshop: adventure.link_fshop || "",
		isbn: adventure.isbn || "",
		containedIn: adventure.contained_in || "",
		official: adventure.is_official === true || adventure.is_official === 1,
		complexity: adventure.complexity_gm || adventure.complexity_pl || "",
		genre: adventure.genre || "",
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
		byRegionPublicId: {},
		byPathPublicId: {},
		byPathKey: {},
		byTerritoryPath: {},
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
				// Landscape region: match EXACTLY by the region label's map_features public_id (what the
				// resolver stores as target_public_id); byRegionKey is a best-effort wiki-key fallback.
				pushEntry(index.byRegionPublicId, place.target_public_id, entry);
				pushEntry(index.byRegionKey, normKey, entry);
			} else if (place.target_kind === "path") {
				// Paths are segmented (many map_features rows share one wiki_path namespace) -> the wiki_key
				// (UNPREFIXED, normalized) is the robust axis; public_id is a secondary exact match.
				pushEntry(index.byPathPublicId, place.target_public_id, entry);
				pushEntry(index.byPathKey, normKey, entry);
			}
			// Phase 2: index the adventure under EVERY territory in this place's ancestor path, so
			// byTerritoryPath[T] holds all adventures whose place lies in T's subtree (client aggregates
			// territory/region adventures without loading the political parent tree).
			(place.territory_path || []).forEach(function (pathKey) {
				pushEntry(index.byTerritoryPath, norm(pathKey), entry);
			});
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
	if (ref.territoryKey) {
		collect(index.byTerritoryPath[ref.territoryKey]); // subtree aggregation (Phase 2)
	}
	if (ref.regionPublicId) {
		collect(index.byRegionPublicId[ref.regionPublicId]); // landscape region, exact public_id
	}
	if (ref.regionKey) {
		collect(index.byRegionKey[ref.regionKey]); // landscape region, wiki-key fallback
	}
	if (ref.pathPublicId) {
		collect(index.byPathPublicId[ref.pathPublicId]); // path, exact segment public_id
	}
	if (ref.pathKey) {
		collect(index.byPathKey[ref.pathKey]); // path, wiki_path namespace (robust across segments)
	}
	return collected;
}

// ---- Phase 2.3: nested territory tree (deepest-wins) + dialog filter facets ----------------------

// Prettify a raw 'wiki:<slug>' key into a fallback display name -- ONLY used when territory_meta lacks the
// key (rare: a path node that is not an active political_territory). The slug is diacritic-stripped, so this
// is best-effort and never preferred over meta.name.
function avesmapsAdventurePrettifyKey(rawKey) {
	var bare = String(rawKey || "").replace(/^wiki:/i, "");
	if (!bare) {
		return "";
	}
	return bare.split(/[-_]+/).filter(Boolean).map(function (word) {
		return word.charAt(0).toUpperCase() + word.slice(1);
	}).join(" ");
}

// Build the nested subtree of adventures under a clicked territory (server 'wiki:'-key), DEEPEST-WINS:
// each adventure appears once PER ROLE at the deepest territory node of its (role) assignment inside the
// clicked subtree. Returns { key, name, rank, start:[shape], play:[shape], children:[node] } or null when
// the key is empty. Comparison runs on the NORMALIZED key axis (same as byTerritoryPath) so server/client
// umlaut transliteration cancels out; display name+rank come from territoryMeta (keyed by the raw
// 'wiki:'-key). Pure (no window/DOM) -> Node-testable.
function avesmapsBuildAdventureTerritoryTree(catalog, territoryMeta, rootKey, normalizeKey) {
	var norm = typeof normalizeKey === "function" ? normalizeKey : avesmapsNormalizeAdventureKey;
	var rootNorm = norm(rootKey);
	if (!rootNorm) {
		return null;
	}
	var metaByNorm = {};
	var rawByNorm = {};
	Object.keys(territoryMeta || {}).forEach(function (rawKey) {
		var n = norm(rawKey);
		if (!n) {
			return;
		}
		if (!metaByNorm[n]) {
			metaByNorm[n] = territoryMeta[rawKey];
		}
		if (!rawByNorm[n]) {
			rawByNorm[n] = rawKey;
		}
	});
	// Keep the RAW path key per normalized node so the fallback name (no meta) is readable (the normalized
	// node key has diacritics/separators stripped). Meta keys already claimed their slots (first-wins).
	(catalog || []).forEach(function (adventure) {
		((adventure && adventure.places) || []).forEach(function (place) {
			(place.territory_path || []).forEach(function (rawKey) {
				var n = norm(rawKey);
				if (n && !rawByNorm[n]) {
					rawByNorm[n] = rawKey;
				}
			});
		});
	});

	function makeNode(nkey) {
		if (!rawByNorm[nkey]) {
			rawByNorm[nkey] = nkey;
		}
		return { key: nkey, _childMap: {}, start: [], play: [], children: [] };
	}
	function childOf(node, nkey) {
		if (!node._childMap[nkey]) {
			var child = makeNode(nkey);
			node._childMap[nkey] = child;
			node.children.push(child);
		}
		return node._childMap[nkey];
	}
	var root = makeNode(rootNorm);

	(catalog || []).forEach(function (adventure) {
		if (!adventure || !adventure.public_id) {
			return;
		}
		["start", "play"].forEach(function (role) {
			// Deepest place of this role whose path contains the root -> one placement per (adventure, role).
			var bestChain = null; // normalized keys, deepest -> root
			(adventure.places || []).forEach(function (place) {
				var placeRole = place.role === "start" ? "start" : "play";
				if (placeRole !== role) {
					return;
				}
				var path = (place.territory_path || []).map(norm); // deepest -> root
				var rootIdx = path.indexOf(rootNorm);
				if (rootIdx < 0) {
					return;
				}
				var chain = path.slice(0, rootIdx + 1); // [deepest, ..., root]
				if (!bestChain || chain.length > bestChain.length) {
					bestChain = chain;
				}
			});
			if (!bestChain) {
				return;
			}
			var node = root; // walk root -> deepest (skip the last entry, which is the root itself)
			for (var i = bestChain.length - 2; i >= 0; i -= 1) {
				node = childOf(node, bestChain[i]);
			}
			node[role].push(avesmapsAdventureToRenderShape(adventure));
		});
	});

	(function finalize(node) {
		var meta = metaByNorm[node.key] || null;
		node.name = (meta && meta.name) || avesmapsAdventurePrettifyKey(rawByNorm[node.key]) || node.key;
		node.rank = (meta && meta.rank) || "";
		delete node._childMap;
		node.children.sort(function (a, b) {
			var an = (metaByNorm[a.key] && metaByNorm[a.key].name) || a.key;
			var bn = (metaByNorm[b.key] && metaByNorm[b.key].name) || b.key;
			return String(an).localeCompare(String(bn), "de");
		});
		node.children.forEach(finalize);
	})(root);

	return root;
}

// Distinct filter facets present across a set of render shapes (populates the dialog filter bar). Sorted
// for a stable UI; empty values dropped.
function avesmapsAdventureFacetOptions(shapes) {
	var types = {};
	var complexities = {};
	var genres = {};
	var editions = {};
	var minYear = 0;
	var maxYear = 0;
	(shapes || []).forEach(function (shape) {
		if (shape.type) {
			types[shape.type] = true;
		}
		if (shape.complexity) {
			complexities[shape.complexity] = true;
		}
		if (shape.genre) {
			genres[shape.genre] = true;
		}
		if (shape.edition) {
			editions[shape.edition] = true;
		}
		var y = Number(shape.year) || 0;
		if (y > 0) {
			if (minYear === 0 || y < minYear) { minYear = y; }
			if (y > maxYear) { maxYear = y; }
		}
	});
	function sorted(map) {
		return Object.keys(map).sort(function (a, b) {
			return a.localeCompare(b, "de");
		});
	}
	return {
		types: sorted(types), complexities: sorted(complexities), genres: sorted(genres),
		editions: sorted(editions), yearRange: { min: minYear, max: maxYear },
	};
}

// Does a render shape pass the active filter? filter = { types:[]|Set, complexity:"", genre:"", edition:"",
// yearFrom:0, yearTo:0, officialOnly:bool }. Empty/absent facets are "no constraint" (a year of 0 = undated ->
// excluded once a year bound is set). Kept pure so both the tree render and tests share one predicate.
function avesmapsAdventureMatchesFilter(shape, filter) {
	if (!filter || !shape) {
		return true;
	}
	var types = filter.types;
	if (types) {
		var size = typeof types.size === "number" ? types.size : (types.length || 0);
		var has = typeof types.has === "function" ? types.has(shape.type) : (typeof types.indexOf === "function" && types.indexOf(shape.type) >= 0);
		if (size > 0 && !has) {
			return false;
		}
	}
	if (filter.complexity && shape.complexity !== filter.complexity) {
		return false;
	}
	if (filter.genre && shape.genre !== filter.genre) {
		return false;
	}
	if (filter.edition && shape.edition !== filter.edition) {
		return false;
	}
	var year = Number(shape.year) || 0;
	if (filter.yearFrom && (!year || year < filter.yearFrom)) {
		return false;
	}
	if (filter.yearTo && (!year || year > filter.yearTo)) {
		return false;
	}
	if (filter.officialOnly && !shape.official) {
		return false;
	}
	return true;
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

function avesmapsApplyAdventureCatalog(catalog, territoryMeta, coversEnabled) {
	var state = avesmapsAdventureCatalogState;
	state.catalog = Array.isArray(catalog) ? catalog : [];
	state.territoryMeta = (territoryMeta && typeof territoryMeta === "object") ? territoryMeta : {};
	state.coversEnabled = coversEnabled !== false; // default ENABLED; only an explicit false (kill switch) hides covers
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
		avesmapsApplyAdventureCatalog(window.AVESMAPS_ADVENTURE_CATALOG, window.AVESMAPS_ADVENTURE_TERRITORY_META, window.AVESMAPS_ADVENTURE_COVERS_ENABLED);
		state.loading = Promise.resolve(state.catalog);
		return state.loading;
	}
	var url = avesmapsAdventuresEndpointUrl();
	if (!url || typeof fetch !== "function") {
		avesmapsApplyAdventureCatalog([], {});
		state.loading = Promise.resolve(state.catalog);
		return state.loading;
	}
	state.loading = fetch(url, { headers: { Accept: "application/json" } })
		.then(function (response) { return response && response.ok ? response.json() : null; })
		.then(function (data) {
			var catalog = data && data.ok && Array.isArray(data.adventures) ? data.adventures : [];
			var meta = data && data.territory_meta && typeof data.territory_meta === "object" ? data.territory_meta : {};
			var coversEnabled = data ? (data.covers_enabled !== false) : true;
			avesmapsApplyAdventureCatalog(catalog, meta, coversEnabled);
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

// Adventures aggregated over a TERRITORY/REGION SUBTREE, in render shape (Phase 2). territoryWikiKey = the
// political territory's wiki_key (server 'wiki:'-form, same axis as the per-place territory_path).
// opts.role: 'start' (beginnt) | 'play' (spielt) | 'all'. Deduped by adventure.
function getAdventuresForTerritory(territoryWikiKey, opts) {
	var index = avesmapsAdventureCatalogState.index;
	if (!index) {
		return [];
	}
	var role = (opts && opts.role) || "start";
	var key = avesmapsNormalizeAdventureKey(territoryWikiKey);
	if (!key) {
		return [];
	}
	return avesmapsSelectAdventureEntries(index, { territoryKey: key }, role).map(function (entry) {
		return avesmapsAdventureToRenderShape(entry.adv);
	});
}

// Adventures assigned DIRECTLY to a landscape region, in render shape (Phase 2, regions). Regions are leaf
// targets (no political subtree) -> a flat strip like a settlement. regionRef = the map label / regionEntry
// (carries .publicId + optionally .wikiRegion.wiki_key). Primary match = the region label's public_id (what
// the resolver stores as target_public_id, exact, no umlaut divergence); wiki_key is a fallback.
function getAdventuresForRegion(regionRef, opts) {
	var index = avesmapsAdventureCatalogState.index;
	if (!index || !regionRef) {
		return [];
	}
	var role = (opts && opts.role) || "start";
	var publicId = (typeof regionRef === "string") ? regionRef : (regionRef.publicId || regionRef.public_id || "");
	var wikiRegion = regionRef.wikiRegion || regionRef.wiki_region || null;
	var rawKey = (wikiRegion && wikiRegion.wiki_key) || regionRef.wikiKey || regionRef.wiki_key || "";
	var ref = {};
	if (publicId) {
		ref.regionPublicId = publicId;
	}
	if (rawKey) {
		ref.regionKey = avesmapsNormalizeAdventureKey(rawKey);
	}
	if (!ref.regionPublicId && !ref.regionKey) {
		return [];
	}
	return avesmapsSelectAdventureEntries(index, ref, role).map(function (entry) {
		return avesmapsAdventureToRenderShape(entry.adv);
	});
}

// Adventures assigned to a path/Weg, in render shape (Phase 2, paths). pathRef = { publicId, wikiKey }. Paths
// are segmented (one wiki_path namespace spans many segments) -> the wiki_key is the robust match axis; the
// clicked segment's public_id is a secondary exact match. Flat strip (a path is a leaf target).
function getAdventuresForPath(pathRef, opts) {
	var index = avesmapsAdventureCatalogState.index;
	if (!index || !pathRef) {
		return [];
	}
	var role = (opts && opts.role) || "start";
	var ref = {};
	var publicId = pathRef.publicId || pathRef.public_id || "";
	var rawKey = pathRef.wikiKey || pathRef.wiki_key || "";
	if (publicId) {
		ref.pathPublicId = publicId;
	}
	if (rawKey) {
		ref.pathKey = avesmapsNormalizeAdventureKey(rawKey);
	}
	if (!ref.pathPublicId && !ref.pathKey) {
		return [];
	}
	return avesmapsSelectAdventureEntries(index, ref, role).map(function (entry) {
		return avesmapsAdventureToRenderShape(entry.adv);
	});
}

// Nested territory subtree for the "Alle anzeigen" dialog (Phase 2.3): the deepest-wins tree rooted at
// territoryWikiKey (server 'wiki:'-form, same axis as territory_path). Returns null when the catalog is not
// ready or the key is empty. Each node carries name+rank (from territory_meta) and its direct start/play
// adventure render shapes; the dialog renders nested frames + filter bar from it.
function getAdventureTerritoryTree(territoryWikiKey) {
	var state = avesmapsAdventureCatalogState;
	if (!state.index) {
		return null;
	}
	return avesmapsBuildAdventureTerritoryTree(state.catalog, state.territoryMeta || {}, territoryWikiKey, avesmapsNormalizeAdventureKey);
}

// All places of one adventure (in sort_order). Returns the raw place objects (general catalog accessor,
// e.g. for a future editor-defined route). The list order is wiki position, NOT a route.
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
		avesmapsAdventureEditionSortKey: avesmapsAdventureEditionSortKey,
		avesmapsNormalizeAdventureKey: avesmapsNormalizeAdventureKey,
		avesmapsAdventureToRenderShape: avesmapsAdventureToRenderShape,
		avesmapsBuildAdventureIndex: avesmapsBuildAdventureIndex,
		avesmapsSelectAdventureEntries: avesmapsSelectAdventureEntries,
		avesmapsBuildAdventureTerritoryTree: avesmapsBuildAdventureTerritoryTree,
		avesmapsAdventureFacetOptions: avesmapsAdventureFacetOptions,
		avesmapsAdventureMatchesFilter: avesmapsAdventureMatchesFilter,
		avesmapsAdventurePrettifyKey: avesmapsAdventurePrettifyKey,
	};
}
if (typeof window !== "undefined") {
	window.avesmapsLoadAdventureCatalog = avesmapsLoadAdventureCatalog;
	window.avesmapsAdventureCatalogIsReady = avesmapsAdventureCatalogIsReady;
	window.avesmapsAdventureEditionSortKey = avesmapsAdventureEditionSortKey;
	window.getAdventuresForPlace = getAdventuresForPlace;
	window.getAdventuresForTerritory = getAdventuresForTerritory;
	window.getAdventuresForRegion = getAdventuresForRegion;
	window.getAdventuresForPath = getAdventuresForPath;
	window.getAdventureTerritoryTree = getAdventureTerritoryTree;
	window.getAdventurePlaces = getAdventurePlaces;
	// Cover kill switch (owner "emergency off"): false -> place-extras drops the "© Ulisses" cover credit
	// (covers already render as placeholders because the render shape zeroes cover_url when disabled).
	window.avesmapsAdventuresCoversEnabled = function () { return avesmapsAdventureCatalogState.coversEnabled !== false; };
	window.avesmapsAdventureCatalogReady = window.avesmapsAdventureCatalogReady || false;
	// Kick the single catalog fetch as early as possible when in infopanel mode; the popup opens
	// (user-initiated) generally after this resolves.
	if (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE) {
		avesmapsLoadAdventureCatalog();
	}
}

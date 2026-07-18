// Kartensammlung (Spec §3.9): catalog fetch + the client-side index that answers "which maps hang on this
// place". Sibling of map-features-adventures.js and deliberately the same shape -- one eager fetch of the
// whole approved catalog (api/app/citymaps.php), one index built once, then pure local lookups.
//
// A map can hang on a settlement, a territory, a region or a path/river, exactly like an adventure, so the
// index has the same axes. The one structural difference: no start/play role. An adventure BEGINS or is
// PLAYED somewhere; a map simply depicts a place.
//
// THE UMLAUT TRAP (inherited from the adventure feature, §3.9): the server slug (avesmapsPoliticalSlug,
// ö->oe) and the client normaliser (ö->o) diverge. For TERRITORIES always use the server wiki_key that
// arrives with territory-detail.php -- never a client-normalised wiki_url.

var avesmapsCitymapCatalogState = { loaded: false, loading: null, catalog: [], index: null, enabled: true };

// German defaults for the stable slugs (AGENTS.md §8: the slugs are domain content and never translated;
// their visible labels are UI strings and live in the i18n table, with the German text as tr()'s default).
var AVESMAPS_CITYMAP_TYPE_LABELS = {
	ortsplan: "Ortsplan", stadtplan: "Stadtplan", bezirk: "Bezirk", viertel: "Viertel",
	lageplan: "Lageplan", uebersicht: "Übersicht", schauplatz: "Schauplatz", grundriss: "Grundriss",
	befestigungen: "Befestigungen", dungeon: "Dungeon", hoehlen: "Höhlen", krypten: "Krypten",
	katakomben: "Katakomben", schatzkarte: "Schatzkarte", region: "Region", sonstige: "Sonstige",
};
var AVESMAPS_CITYMAP_ART_LABELS = {
	politisch: "Politisch", derographisch: "Derographisch", topologisch: "Topologisch", skizze: "Skizze",
};

function avesmapsCitymapTypeLabel(key) {
	var slug = String(key == null ? "" : key);
	if (!slug) {
		return "";
	}
	return (typeof tr === "function") ? tr("cityMaps.type." + slug, AVESMAPS_CITYMAP_TYPE_LABELS[slug] || slug) : (AVESMAPS_CITYMAP_TYPE_LABELS[slug] || slug);
}

function avesmapsCitymapArtLabel(key) {
	var slug = String(key == null ? "" : key);
	if (!slug) {
		return "";
	}
	return (typeof tr === "function") ? tr("cityMaps.art." + slug, AVESMAPS_CITYMAP_ART_LABELS[slug] || slug) : (AVESMAPS_CITYMAP_ART_LABELS[slug] || slug);
}

// Same normaliser the adventure index uses -- strips a 'wiki:' prefix, then the shared deeplink
// normalisation. Keeping the two on the same function is what lets a place resolve identically in both
// features.
function avesmapsNormalizeCitymapKey(rawKey) {
	var key = String(rawKey == null ? "" : rawKey).trim();
	if (!key) {
		return "";
	}
	if (key.indexOf("wiki:") === 0) {
		key = key.slice(5);
	}
	return (typeof normalizeWikiDeeplinkKey === "function") ? normalizeWikiDeeplinkKey(key) : key;
}

// The shape every renderer reads. Explicit field list on purpose: a map that reaches the dialog without
// its `links` or `types` would render an empty link column / no chips and look like a data problem rather
// than a mapping bug (the adventure render shape learned this the hard way).
function avesmapsCitymapToRenderShape(citymap) {
	return {
		public_id: citymap.public_id || "",
		title: citymap.title || "",
		parent_public_id: citymap.parent_public_id || "",
		// The server already gated the images by licence (§3.3) -- an empty thumb here means "we may not
		// show one", and the card falls back to its placeholder icon.
		thumb: citymap.thumb || "",
		map_url: citymap.map_url || "",
		map_local_url: citymap.map_local_url || "",
		art: citymap.art || "",
		types: Array.isArray(citymap.types) ? citymap.types : [],
		// Three-valued (§3.1): null = nobody recorded it. NEVER coerce to false -- the reader would be
		// shown a definite "nicht farbig" that nobody asserted, and the filter would match on it.
		is_color: (citymap.is_color == null) ? null : !!citymap.is_color,
		is_multilevel: (citymap.is_multilevel == null) ? null : !!citymap.is_multilevel,
		is_labeled: (citymap.is_labeled == null) ? null : !!citymap.is_labeled,
		is_official: (citymap.is_official == null) ? null : !!citymap.is_official,
		is_spoiler: (citymap.is_spoiler == null) ? null : !!citymap.is_spoiler,
		is_paid: (citymap.is_paid == null) ? null : !!citymap.is_paid,
		has_scale: (citymap.has_scale == null) ? null : !!citymap.has_scale,
		width_px: (citymap.width_px == null) ? null : Number(citymap.width_px),
		height_px: (citymap.height_px == null) ? null : Number(citymap.height_px),
		// The printed sheet size ("A2", "43 x 57 cm") -- a STRING, not a number. This is what the wiki
		// records; width_px is filled on 1 of 419 maps because the wiki writes centimetres, not pixels.
		format: citymap.format || "",
		valid_from_bf: (citymap.valid_from_bf == null) ? null : Number(citymap.valid_from_bf),
		valid_to_bf: (citymap.valid_to_bf == null) ? null : Number(citymap.valid_to_bf),
		author: citymap.author || "",
		// "Erschienen bei" -- who printed the book. NEVER merge this into author: author is who DREW the
		// map, and the suggest dialog says so in as many words.
		publisher: citymap.publisher || "",
		note: citymap.note || "",
		sources: Array.isArray(citymap.sources) ? citymap.sources : [],
		related: Array.isArray(citymap.related) ? citymap.related : [],
		links: Array.isArray(citymap.links) ? citymap.links : [],
	};
}

// ---- index -------------------------------------------------------------------------------------------
// Same axes as the adventure index (map-features-adventures.js:95), minus the role. byTerritoryPath is the
// subtree axis: a map is indexed under EVERY territory on its place's ancestor path, so a territory shows
// the maps of everything beneath it without the client ever loading the political parent tree.
function avesmapsBuildCitymapIndex(catalog, normalizeKey) {
	var norm = typeof normalizeKey === "function" ? normalizeKey : avesmapsNormalizeCitymapKey;
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
	function pushEntry(bucket, key, citymap) {
		if (!key) {
			return;
		}
		var list = bucket[key] || (bucket[key] = []);
		for (var i = 0; i < list.length; i += 1) {
			if (list[i].public_id === citymap.public_id) {
				return; // dedupe: the same map listed twice at the same target
			}
		}
		list.push(citymap);
	}
	(catalog || []).forEach(function (citymap) {
		if (!citymap || !citymap.public_id) {
			return;
		}
		index.byPublicId[citymap.public_id] = citymap;
		(citymap.places || []).forEach(function (place) {
			var normKey = norm(place.target_wiki_key);
			if (place.target_kind === "settlement") {
				pushEntry(index.bySettlementPublicId, place.target_public_id, citymap);
				pushEntry(index.bySettlementKey, normKey, citymap);
			} else if (place.target_kind === "territory") {
				pushEntry(index.byTerritoryKey, normKey, citymap);
			} else if (place.target_kind === "region") {
				// Landscape region: match EXACTLY by the region label's map_features public_id (what the
				// resolver stores); byRegionKey is a best-effort wiki-key fallback.
				pushEntry(index.byRegionPublicId, place.target_public_id, citymap);
				pushEntry(index.byRegionKey, normKey, citymap);
			} else if (place.target_kind === "path") {
				// Paths are segmented (many map_features rows share one wiki_path namespace) -> the
				// wiki_key is the robust axis; public_id is a secondary exact match.
				pushEntry(index.byPathPublicId, place.target_public_id, citymap);
				pushEntry(index.byPathKey, normKey, citymap);
			}
			(place.territory_path || []).forEach(function (pathKey) {
				pushEntry(index.byTerritoryPath, norm(pathKey), citymap);
			});
		});
	});
	return index;
}

// The ref shape drives WHICH axes are consulted -- an absent field simply asks nothing.
function avesmapsSelectCitymapEntries(index, ref) {
	if (!index || !ref) {
		return [];
	}
	var seen = {};
	var collected = [];
	function collect(list) {
		(list || []).forEach(function (citymap) {
			if (seen[citymap.public_id]) {
				return;
			}
			seen[citymap.public_id] = true;
			collected.push(citymap);
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
		// BOTH axes, deliberately. byTerritoryPath is the subtree aggregation and normally already
		// contains a directly-assigned territory (the resolver writes the territory itself as the first
		// entry of its own ancestor path). byTerritoryKey is the belt: a row whose target_territory_path
		// was never filled -- resolver not yet run, wiki_territory_model empty on a fresh DB -- is absent
		// from the path axis, and a map assigned straight to this territory would then be invisible on the
		// very territory it was assigned to. Deduped by public_id, so the overlap costs nothing.
		collect(index.byTerritoryPath[ref.territoryKey]);
		collect(index.byTerritoryKey[ref.territoryKey]);
	}
	if (ref.regionPublicId) {
		collect(index.byRegionPublicId[ref.regionPublicId]);
	}
	if (ref.regionKey) {
		collect(index.byRegionKey[ref.regionKey]);
	}
	if (ref.pathPublicId) {
		collect(index.byPathPublicId[ref.pathPublicId]);
	}
	if (ref.pathKey) {
		collect(index.byPathKey[ref.pathKey]);
	}
	return collected;
}

// ---- adaptive Facetten (Spec §4.1) ------------------------------------------------------------------
// Vokabular: Zeitraum, farbig, offiziell, kostenlos (Owner 2026-07-17). Typ, Art, Quelle, mehrstoeckig,
// beschriftet und "nur kostenpflichtige" sind ERSATZLOS gestrichen -- siehe die Umkehrungs-Warnung in der
// Spec §4.1, bevor jemand sie zurueckbaut.
//
// Die Regel: ein Filter erscheint nur, wenn er DIESE Liste wirklich teilt. Sonst stehen 13 Steuerelemente
// ueber einer Zeile (168 von 245 Orten haben genau eine Karte) und mehrstoeckig kann nie etwas treffen,
// weil die Daten es gar nicht kennen.
//
// AUSNAHME `spoiler` (Owner 2026-07-18): der GESTRICHENE Spoiler-Chip regelte die Listung (Umkehrung 2 in
// §4.1) -- dieser hier regelt den Deckel, den dieselbe Umkehrung ausdruecklich behaelt. Er ist deshalb kein
// Filter und folgt der Teilungs-Regel nicht; §4.1 sieht die Rueckkehr ueber die Datenlage ohnehin vor
// ("Kommt die Datenlage, kommen sie ueber dieselbe Regel zurueck"), und seit es Spoilerkarten gibt, ist
// sie da.
function avesmapsCitymapActiveFacets(shapes) {
	var list = shapes || [];
	function splits(pred) {
		var hit = 0;
		for (var i = 0; i < list.length; i++) {
			if (pred(list[i])) { hit++; }
		}
		return hit > 0 && hit < list.length;
	}
	var years = {};
	var withYear = 0;
	list.forEach(function (shape) {
		var has = false;
		[shape.valid_from_bf, shape.valid_to_bf].forEach(function (value) {
			var year = Number(value) || 0;
			// 9999 ist das offene Ende (AGENTS.md §5) -- ein echter Wert in den Daten, aber keine
			// Jahreszahl, die man einem Leser als Bereichsgrenze zeigt.
			if (year > 0 && year !== 9999) {
				years[year] = true;
				has = true;
			}
		});
		if (has) { withYear++; }
	});
	var keys = Object.keys(years).map(Number);
	return {
		color: splits(function (s) { return s.is_color === true; }),
		official: splits(function (s) { return s.is_official === true; }),
		free: splits(avesmapsCitymapHasFreeAccess),
		// Zwei Karten MIT Jahr und unterschiedliche Jahre. Eine Karte mit einer Spanne liefert zwar zwei
		// Zahlen, aber nichts zu filtern.
		years: withYear >= 2 && keys.length >= 2,
		// KEIN Filter, sondern der Sammelschalter fuer den Spoiler-Deckel (Owner 2026-07-18): ein einziger
		// Spoiler genuegt. Bewusst NICHT splits() -- er blendet nichts aus, er deckt auf, und bei 3 von 3
		// verdeckten Karten trennt er nichts und ist trotzdem am noetigsten. Siehe citymaps-index.test.js.
		spoiler: list.some(function (s) { return s && s.is_spoiler === true; }),
		yearRange: keys.length ? { min: Math.min.apply(null, keys), max: Math.max.apply(null, keys) } : { min: 0, max: 0 },
	};
}

// Spec §3.7: "Unbekannte Werte werden nicht angezeigt und matchen keinen Filter außer 'alle'." So every
// tri-state check below demands an explicit true -- null (unknown) fails, which is the whole point of
// keeping those fields three-valued all the way from the DB.
// DIE Frage, die der "nur kostenlose"-Filter stellt (Mehrfachlink-Spec §4.1) -- EINE Definition, weil ein
// Fehler hier LEISE danebengeht: die Karte verschwindet einfach, und niemand sieht, dass sie fehlt.
//
// Sie lautet "gibt es einen freien Weg zu dieser Karte?", NICHT "ist diese Karte kostenlos". Eine Karte,
// die im Shop verkauft UND auf ihrer Wiki-Seite frei lesbar ist, HAT einen freien Weg -- sie bleibt
// sichtbar. Sie auszublenden wuerde dem Leser das Gegenteil der Wahrheit erzaehlen. Es zaehlt nur, was
// jemand BEHAUPTET hat: unbekannt (null) ist kein Beleg fuer "frei" (§3.1) -- der Teil der alten Regel
// gilt unveraendert weiter.
function avesmapsCitymapHasFreeAccess(shape) {
	if (!shape) {
		return false;
	}
	var links = Array.isArray(shape.links) ? shape.links : [];
	for (var i = 0; i < links.length; i++) {
		if (links[i] && links[i].is_paid === false) {
			return true;
		}
	}
	// Rueckfall auf das Karten-Flag, solange es citymap.is_paid gibt (Spec §6, Schritt 5 raeumt es ab).
	// Er greift nur fuer eine Shape OHNE Linkliste -- die magere DOM-Shape einer Box ohne Katalog. Wo
	// Links da sind, entscheiden sie: der Karten-Link erbt is_paid von der Karte, deshalb koennen die
	// beiden sich gar nicht erst widersprechen.
	return shape.is_paid === false;
}

// Die Gegenrichtung (Owner 2026-07-17: "kostenpflichtige und nicht kostenpflichtige maps sollen danach
// gefiltert werden koennen"). Sie ist NICHT einfach die Verneinung von hasFreeAccess: "kein freier Weg
// bekannt" trifft auch auf eine Karte zu, ueber die niemand irgendetwas weiss -- die gehoert in KEINEN
// der beiden Filter (§3.7: unbekannt matcht nichts ausser "alle").
//
// "Kostenpflichtig" heisst deshalb: mindestens ein Weg ist BELEGT bezahlt, und kein Weg ist belegt frei.
// Ein Weg mit unbekannter Bedingung zaehlt nicht dagegen -- "wir wissen es nicht" ist kein Beleg fuer
// "gratis", dieselbe Regel wie oben, nur andersherum gelesen.
function avesmapsCitymapIsPaidOnly(shape) {
	if (!shape || avesmapsCitymapHasFreeAccess(shape)) {
		return false; // ein belegt freier Weg schliesst "kostenpflichtig" aus
	}
	var links = Array.isArray(shape.links) ? shape.links : [];
	for (var i = 0; i < links.length; i++) {
		if (links[i] && links[i].is_paid === true) {
			return true;
		}
	}
	// Rueckfall wie oben: magere DOM-Shape ohne Linkliste.
	return shape.is_paid === true;
}

function avesmapsCitymapMatchesFilter(shape, filter) {
	if (!filter || !shape) {
		return true;
	}
	// §3.7: "Unbekannte Werte matchen keinen Filter ausser 'alle'." Jeder Check verlangt ein explizites
	// true -- null (unbekannt) faellt durch, und genau dafuer sind die Felder dreiwertig.
	if (filter.colorOnly && shape.is_color !== true) {
		return false;
	}
	if (filter.officialOnly && shape.is_official !== true) {
		return false;
	}
	// Fragt die LINKS, nicht die Karte: derselbe Band ist im F-Shop bezahlt und auf seiner Wiki-Seite
	// frei. "Gibt es einen freien Weg zu dieser Karte?"
	if (filter.freeOnly && !avesmapsCitymapHasFreeAccess(shape)) {
		return false;
	}
	var from = Number(filter.yearFrom) || 0;
	var to = Number(filter.yearTo) || 0;
	if (from || to) {
		// BF validity is a RANGE on a map (valid_from_bf..valid_to_bf), not the single year an adventure
		// carries -> an OVERLAP test, not containment: "which maps were valid at any point in this span".
		var vf = (shape.valid_from_bf == null) ? null : Number(shape.valid_from_bf);
		var vt = (shape.valid_to_bf == null) ? null : Number(shape.valid_to_bf);
		if (vf === null && vt === null) {
			return false; // validity entirely unknown -> matches no year filter (§3.7)
		}
		// ONE known bound is enough, and the missing side is UNBOUNDED -- not collapsed onto the known
		// one. "Gültig ab 1030, Ende nicht erfasst" means "from 1030 onwards as far as we know"; folding
		// hi down to 1030 would assert the map stopped that year, which is just as invented as the
		// is_color=false a two-valued boolean would have claimed.
		var lo = (vf === null) ? -Infinity : vf;
		var hi = (vt === null) ? Infinity : vt;
		if (from && hi < from) {
			return false;
		}
		if (to && lo > to) {
			return false;
		}
	}
	return true;
}

// ---- catalog load ------------------------------------------------------------------------------------
function avesmapsCitymapsEndpointUrl() {
	if (typeof window !== "undefined" && window.AVESMAPS_CITYMAPS_ENDPOINT) {
		return window.AVESMAPS_CITYMAPS_ENDPOINT;
	}
	if (typeof SQL_MAP_HOSTS !== "undefined" && typeof window !== "undefined" && SQL_MAP_HOSTS.has(window.location.hostname)) {
		return "api/app/citymaps.php";
	}
	return ""; // e.g. localhost dev without a backend -> ready-empty, the section simply does not render
}

function avesmapsApplyCitymapCatalog(catalog, enabled, previewsEnabled) {
	var state = avesmapsCitymapCatalogState;
	state.catalog = Array.isArray(catalog) ? catalog : [];
	state.enabled = enabled !== false; // default ENABLED; only an explicit false (kill switch) hides it
	// The SECOND switch, for the preview pictures alone. The payload has already blanked the thumbs when
	// this is false; we keep it so the credit line can go with them (no covers, no credit needed).
	state.previewsEnabled = previewsEnabled !== false;
	state.index = avesmapsBuildCitymapIndex(state.catalog, avesmapsNormalizeCitymapKey);
	state.loaded = true;
	if (typeof window !== "undefined") {
		window.avesmapsCitymapCatalog = state.catalog;
		window.avesmapsCitymapCatalogReady = true;
		// A panel opened BEFORE this resolved was built without us and would stay that way forever -- the
		// section renders nothing without a catalog, and nothing re-renders on its own. On a deeplink that
		// is a real race: this small fetch queues behind the ~14 MB map-features payload. Rebuild once.
		if (typeof window.avesmapsRefreshInfopanel === "function") {
			window.avesmapsRefreshInfopanel();
		}
	}
}

// Nachladen auf Zuruf (Owner 2026-07-17): der Katalog wurde bisher genau EINMAL geholt -- state.loading
// merkt sich die Promise, jeder weitere Aufruf bekam dieselbe alte Antwort zurueck. Wer im Editor eine
// Karte aenderte, sah das in seiner offenen Seite erst nach F5. Das Zuruecksetzen ist der ganze Trick:
// avesmapsApplyCitymapCatalog baut danach den Index neu UND zeichnet ein offenes Panel neu.
// Aufrufer: das Schliessen des Kartensammlungs-Editors.
function avesmapsReloadCitymapCatalog() {
	avesmapsCitymapCatalogState.loading = null;
	return avesmapsLoadCitymapCatalog();
}

function avesmapsLoadCitymapCatalog() {
	var state = avesmapsCitymapCatalogState;
	if (state.loading) {
		return state.loading;
	}
	if (typeof window !== "undefined" && Array.isArray(window.AVESMAPS_CITYMAP_CATALOG)) {
		avesmapsApplyCitymapCatalog(window.AVESMAPS_CITYMAP_CATALOG, window.AVESMAPS_CITYMAPS_ENABLED);
		state.loading = Promise.resolve(state.catalog);
		return state.loading;
	}
	var url = avesmapsCitymapsEndpointUrl();
	if (!url || typeof fetch !== "function") {
		avesmapsApplyCitymapCatalog([], true);
		state.loading = Promise.resolve(state.catalog);
		return state.loading;
	}
	state.loading = fetch(url, { headers: { Accept: "application/json" } })
		.then(function (response) { return response && response.ok ? response.json() : null; })
		.then(function (data) {
			var catalog = data && data.ok && Array.isArray(data.citymaps) ? data.citymaps : [];
			var enabled = data ? (data.citymaps_enabled !== false) : true;
			var previewsEnabled = data ? (data.citymap_previews_enabled !== false) : true;
			avesmapsApplyCitymapCatalog(catalog, enabled, previewsEnabled);
			return state.catalog;
		})
		.catch(function () {
			// Network/parse error: stay UNREADY so the section does not render at all, and a later open
			// can retry (loading is reset so the next call re-fetches).
			state.loading = null;
			return [];
		});
	return state.loading;
}

function avesmapsCitymapCatalogIsReady() {
	return avesmapsCitymapCatalogState.loaded === true && !!avesmapsCitymapCatalogState.index;
}

// ---- getters -----------------------------------------------------------------------------------------
function avesmapsBuildCitymapPlaceRef(placeRef) {
	if (!placeRef) {
		return {};
	}
	var publicId = placeRef.publicId || placeRef.public_id || "";
	var key = "";
	var wikiUrl = placeRef.wikiUrl || placeRef.wiki_url || "";
	if (wikiUrl && typeof wikiUrlToDeeplinkKey === "function" && typeof normalizeWikiDeeplinkKey === "function") {
		key = normalizeWikiDeeplinkKey(wikiUrlToDeeplinkKey(wikiUrl));
	} else if (placeRef.wikiKey || placeRef.wiki_key) {
		key = avesmapsNormalizeCitymapKey(placeRef.wikiKey || placeRef.wiki_key);
	}
	return { publicId: publicId, key: key };
}

function getCityMapsForPlace(placeRef) {
	var index = avesmapsCitymapCatalogState.index;
	if (!index) {
		return [];
	}
	return avesmapsSelectCitymapEntries(index, avesmapsBuildCitymapPlaceRef(placeRef)).map(avesmapsCitymapToRenderShape);
}

// Territory: aggregate over the whole political subtree via the SERVER wiki_key (see the umlaut trap in
// the header). Pre-detail render -> no wiki_key yet -> [].
function getCityMapsForTerritory(territoryWikiKey) {
	var index = avesmapsCitymapCatalogState.index;
	if (!index) {
		return [];
	}
	var key = avesmapsNormalizeCitymapKey(territoryWikiKey);
	if (!key) {
		return [];
	}
	return avesmapsSelectCitymapEntries(index, { territoryKey: key }).map(avesmapsCitymapToRenderShape);
}

function getCityMapsForRegion(regionRef) {
	var index = avesmapsCitymapCatalogState.index;
	if (!index || !regionRef) {
		return [];
	}
	var publicId = (typeof regionRef === "string") ? regionRef : (regionRef.publicId || regionRef.public_id || "");
	var wikiRegion = regionRef.wikiRegion || regionRef.wiki_region || null;
	var rawKey = (wikiRegion && wikiRegion.wiki_key) || regionRef.wikiKey || regionRef.wiki_key || "";
	var ref = {};
	if (publicId) {
		ref.regionPublicId = publicId;
	}
	if (rawKey) {
		ref.regionKey = avesmapsNormalizeCitymapKey(rawKey);
	}
	if (!ref.regionPublicId && !ref.regionKey) {
		return [];
	}
	return avesmapsSelectCitymapEntries(index, ref).map(avesmapsCitymapToRenderShape);
}

function getCityMapsForPath(pathRef) {
	var index = avesmapsCitymapCatalogState.index;
	if (!index || !pathRef) {
		return [];
	}
	var ref = {};
	var publicId = pathRef.publicId || pathRef.public_id || "";
	var rawKey = pathRef.wikiKey || pathRef.wiki_key || "";
	if (publicId) {
		ref.pathPublicId = publicId;
	}
	if (rawKey) {
		ref.pathKey = avesmapsNormalizeCitymapKey(rawKey);
	}
	if (!ref.pathPublicId && !ref.pathKey) {
		return [];
	}
	return avesmapsSelectCitymapEntries(index, ref).map(avesmapsCitymapToRenderShape);
}

// Content accessor by public_id -- how the dialog turns a strip card back into its full shape. NOT a place
// query: re-running the lookup could return a different set than the strip rendered.
function getCityMapShape(publicId) {
	var index = avesmapsCitymapCatalogState.index;
	if (!index || !publicId) {
		return null;
	}
	var citymap = index.byPublicId[publicId];
	return citymap ? avesmapsCitymapToRenderShape(citymap) : null;
}

// ---- exports -----------------------------------------------------------------------------------------
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsNormalizeCitymapKey: avesmapsNormalizeCitymapKey,
		avesmapsCitymapToRenderShape: avesmapsCitymapToRenderShape,
		avesmapsBuildCitymapIndex: avesmapsBuildCitymapIndex,
		avesmapsSelectCitymapEntries: avesmapsSelectCitymapEntries,
		avesmapsCitymapActiveFacets: avesmapsCitymapActiveFacets,
		avesmapsCitymapMatchesFilter: avesmapsCitymapMatchesFilter,
		avesmapsCitymapHasFreeAccess: avesmapsCitymapHasFreeAccess,
		avesmapsCitymapIsPaidOnly: avesmapsCitymapIsPaidOnly,
		avesmapsCitymapTypeLabel: avesmapsCitymapTypeLabel,
		avesmapsCitymapArtLabel: avesmapsCitymapArtLabel,
	};
}
if (typeof window !== "undefined") {
	window.avesmapsLoadCitymapCatalog = avesmapsLoadCitymapCatalog;
	window.avesmapsReloadCitymapCatalog = avesmapsReloadCitymapCatalog;
	window.avesmapsCitymapCatalogIsReady = avesmapsCitymapCatalogIsReady;
	window.avesmapsCitymapActiveFacets = avesmapsCitymapActiveFacets;
	window.avesmapsCitymapMatchesFilter = avesmapsCitymapMatchesFilter;
	window.avesmapsCitymapTypeLabel = avesmapsCitymapTypeLabel;
	window.avesmapsCitymapArtLabel = avesmapsCitymapArtLabel;
	window.getCityMapsForPlace = getCityMapsForPlace;
	window.getCityMapsForTerritory = getCityMapsForTerritory;
	window.getCityMapsForRegion = getCityMapsForRegion;
	window.getCityMapsForPath = getCityMapsForPath;
	window.getCityMapShape = getCityMapShape;
	// Kill switch (§3.3): the server already ships an empty catalog when it is off; this lets the frontend
	// tell "switched off" apart from "no maps here".
	window.avesmapsCitymapsEnabled = function () { return avesmapsCitymapCatalogState.enabled !== false; };
	// Read by avesmapsCitymapCreditMarkup (place-extras). Default ON: the credit is an obligation, so an
	// unknown switch must fail towards showing it, not towards hiding it.
	window.avesmapsCitymapPreviewsEnabled = function () { return avesmapsCitymapCatalogState.previewsEnabled !== false; };
	window.avesmapsCitymapCatalogReady = window.avesmapsCitymapCatalogReady || false;
	// Kick the single catalog fetch as early as possible when in infopanel mode; the popup opens
	// (user-initiated) generally after this resolves. Must not touch the Leaflet `map` at load time --
	// bootstrap.js creates it, and this file is parsed before that finishes.
	if (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE) {
		avesmapsLoadCitymapCatalog();
	}
}

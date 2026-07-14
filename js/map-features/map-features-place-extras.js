// Place-Extras (Infopanel Phase 6): die Abschnitte "Stadtkarten" (kuratierte externe Karten-Links)
// und "Abenteuer in <Ort>" (aus der Wiki-<Ort>/Abenteuer-Unterseite) fuer das Siedlungs-Popup/-Panel.
//
// HEUTE nur STATISCHE PLATZHALTER-Daten (leicht ersetzbar): sobald echte Daten im map-features-
// Payload ankommen (location.adventures / location.cityMaps), liefern getPlaceAdventures /
// getPlaceCityMaps diese statt der Platzhalter -- der Rest (Markup, Sortierung, "mehr") bleibt gleich.
// Geplant: Abenteuer via Dump-Pipeline (analog Wiki-Publikationen), Stadtkarten kuratiert (Editor).
//
// Sortierung ("neueste/Art/alphabetisch") und "mehr" laufen ueber Document-Delegation und funktionieren
// daher gleich im schwebenden Popup UND im Infopanel. buildLocationMarkerPopupHtml haengt die beiden
// Abschnitte ein (nur fuer Wiki-Siedlungen).

// ---- Platzhalter-Daten (Demo: Gareth; echte Daten von der Wiki-Seite <Ort>/Abenteuer) ----
// cover: TEMPORAER hotgelinkte Wiki-Aventurica-Thumbnails (Owner-Freigabe fuer die Demo) -- spaeter
// ersetzt durch echte Payload-Daten (location.adventures[].cover), idealerweise ueber den coat.php-artigen
// Cache-Proxy statt Hotlink.
var AVESMAPS_PLACEHOLDER_ADVENTURES = [
	{ title: "Jagd nach dem Primoptolithen", type: "Soloabenteuer", edition: "", year: 1046, yearLabel: "1046 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/c/c5/Jagd_nach_dem_Primoptolithen.jpg/240px-Jagd_nach_dem_Primoptolithen.jpg" },
	{ title: "Siegelbruch", type: "Gruppenabenteuer", edition: "DSA5", year: 1044, yearLabel: "1044 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/5/55/AB_VA62.jpg/240px-AB_VA62.jpg" },
	{ title: "Aus den Augen, aber nicht aus dem Sinn", type: "Gruppenabenteuer", edition: "DSA5", year: 1041, yearLabel: "1041 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/a/a0/40_Jahre_und_ein_Schelm.jpg/240px-40_Jahre_und_ein_Schelm.jpg" },
	{ title: "Feuchte Albträume", type: "Szenario", edition: "DSA5", year: 1040, yearLabel: "1040 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/6/63/Kurtisanen_%26_Bordelle.jpg/240px-Kurtisanen_%26_Bordelle.jpg" },
	{ title: "Der Schattenmarschall", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1040, yearLabel: "Sommer 1040 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/0/04/AB_A212.jpg/240px-AB_A212.jpg" },
	{ title: "Seelanders Eleven", type: "Kurzabenteuer", edition: "DSA5", year: 1040, yearLabel: "etwa 1040 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/1/14/AB_KRK1.jpg/240px-AB_KRK1.jpg" },
	{ title: "Niobaras Vermächtnis", type: "Gruppenabenteuer", edition: "DSA5", year: 1038, yearLabel: "bis RAH 1038 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/3/3a/AB_VA14.jpg/240px-AB_VA14.jpg" },
	{ title: "Steinerne Schwingen", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1038, yearLabel: "1038 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/e/ea/AB_A201.jpg/240px-AB_A201.jpg" },
	{ title: "Herren der Unterwelt", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1037, yearLabel: "Anfang 1037 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/4/47/Box-AB_Gh.png/240px-Box-AB_Gh.png" },
	{ title: "Sturm der Gewalt", type: "Gruppenabenteuer", edition: "DSA4.1", year: 1037, yearLabel: "Hochsommer ab 1037 BF", cover: "https://de.wiki-aventurica.de/de/images/thumb/4/47/Box-AB_Gh.png/240px-Box-AB_Gh.png" },
];
var AVESMAPS_PLACEHOLDER_ADVENTURES_TOTAL = 57;
var AVESMAPS_PLACEHOLDER_CITYMAPS = [
	{ label: "Gesamtplan", url: "" },
	{ label: "Kaiserviertel", url: "" },
	{ label: "Südquartier", url: "" },
	{ label: "Tempelviertel", url: "" },
];

var AVESMAPS_CITYMAP_THUMB_SVG = '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>';
// Platzhalter-Icon fuer das Abenteuer-Cover (A4), solange kein echtes Cover-Bild (a.cover) vorliegt.
var AVESMAPS_ADV_COVER_PH_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="m4 16 5-4 4 3 3-2 4 3"/></svg>';

// Datenzugriff (Abenteuer-Feature Phase 1): sobald der Katalog geladen ist (map-features-adventures.js),
// liefern wir die ECHTEN "beginnt hier"-Abenteuer dieses Orts (leer erlaubt -> Abschnitt entfaellt). Nur
// solange der Katalog noch nicht bereit ist (oder ausserhalb des Infopanel-Modus) greifen die Platzhalter
// -- so gibt es keinen leeren Blitz waehrend des Ladens. location.adventures bleibt als Payload-Pfad erhalten.
function getPlaceAdventures(location) {
	if (typeof avesmapsAdventureCatalogIsReady === "function" && avesmapsAdventureCatalogIsReady()) {
		return getAdventuresForPlace(location, { role: "start" });
	}
	if (location && Array.isArray(location.adventures)) {
		return location.adventures;
	}
	return AVESMAPS_PLACEHOLDER_ADVENTURES;
}
function getPlaceAdventuresTotal(location) {
	if (typeof avesmapsAdventureCatalogIsReady === "function" && avesmapsAdventureCatalogIsReady()) {
		return getPlaceAdventures(location).length;
	}
	if (location && typeof location.adventuresTotal === "number") {
		return location.adventuresTotal;
	}
	return AVESMAPS_PLACEHOLDER_ADVENTURES_TOTAL;
}
function getPlaceCityMaps(location) {
	if (location && Array.isArray(location.cityMaps)) {
		return location.cityMaps;
	}
	return AVESMAPS_PLACEHOLDER_CITYMAPS;
}

function placeExtrasEscape(value) {
	return typeof escapeHtml === "function" ? escapeHtml(String(value == null ? "" : value)) : String(value == null ? "" : value);
}

// ---- Stadtkarten: waagrechter Streifen mit Thumbnail-Karten (externe Links) ----
function buildPlaceCityMapsMarkup(location) {
	var maps = getPlaceCityMaps(location);
	if (!maps || !maps.length) {
		return "";
	}
	var cards = maps.map(function (m) {
		var hasUrl = m && m.url;
		var href = hasUrl ? m.url : "#";
		return '<a class="avesmaps-citymaps__card" href="' + placeExtrasEscape(href) + '"'
			+ (hasUrl ? ' target="_blank" rel="noopener"' : ' onclick="return false"') + '>'
			+ '<span class="avesmaps-citymaps__thumb">' + AVESMAPS_CITYMAP_THUMB_SVG + '</span>'
			+ '<span class="avesmaps-citymaps__label">' + placeExtrasEscape(m && m.label) + '</span>'
			+ '</a>';
	}).join("");
	return '<div class="avesmaps-citymaps">'
		+ '<div class="avesmaps-citymaps__head">' + placeExtrasEscape(tr("cityMaps.heading", "Kartensammlung")) + ' <span class="avesmaps-citymaps__note">' + placeExtrasEscape(tr("cityMaps.note", "· Platzhalter · externe Links")) + '</span></div>'
		+ '<div class="avesmaps-citymaps__scroll">' + cards + '</div>'
		+ '</div>';
}

// ---- eine Abenteuer-Karte (Cover A4 + Titel + Jahr + Typ) -- fuer beginnt/spielt-Streifen UND Dialog ----
// isPlay=true -> "spielt hier"-Karte: gleiche Zeile, initial verborgen (display:none), wird beim Umschalten
// per Fade + Rechts-Scroll freigegeben. data-role gruppiert die Sortierung (beginnt bleibt vor spielt).
// The shop/reference links for an adventure, in click PRIORITY order (Owner): Ulisses e-book -> F-Shop ->
// the wiki page -> Deutsche Nationalbibliothek (DNB LAST). Ulisses + F-Shop are wiki-sourced (link_ulisses/
// link_fshop, may be empty); the wiki page is always available (so it wins over DNB, which is a mere ISBN/
// title search fallback and effectively never the cover target). Returns [{ key, label, url }], highest first.
function advShopLinks(a) {
	var links = [];
	var ulisses = (a && a.linkUlisses && String(a.linkUlisses).trim()) || "";
	var fshop = (a && a.linkFshop && String(a.linkFshop).trim()) || "";
	var isbn = (a && a.isbn && String(a.isbn).trim()) || "";
	var title = (a && a.title && String(a.title).trim()) || "";
	var wikiUrl = (a && a.url && String(a.url).trim()) || (title ? ("https://de.wiki-aventurica.de/wiki/" + encodeURIComponent(title)) : "");
	if (ulisses) { links.push({ key: "ulisses", label: "Ulisses eBook", url: ulisses }); }
	if (fshop) { links.push({ key: "fshop", label: "F-Shop", url: fshop }); }
	if (wikiUrl) { links.push({ key: "wiki", label: "Wiki Aventurica", url: wikiUrl }); }
	var dnbQuery = isbn || title;
	if (dnbQuery) { links.push({ key: "dnb", label: "Dt. Nationalbibliothek", url: "https://portal.dnb.de/opac/simpleSearch?query=" + encodeURIComponent(dnbQuery) }); }
	return links;
}
// The single best link (highest available priority) the cover click opens. null only when nothing is known.
function advBestLink(a) {
	var links = advShopLinks(a);
	return links.length ? links[0] : null;
}

function buildAdventureCardMarkup(a, isPlay, noInlineHide) {
	var wikiUrl = a.url || ("https://de.wiki-aventurica.de/wiki/" + encodeURIComponent(a.title || ""));
	// The COVER opens the highest-priority shop/reference link (Ulisses -> F-Shop -> DNB -> Wiki); the TITLE
	// stays the wiki page. Fall back to the wiki on the cover only when nothing is known.
	var best = advBestLink(a);
	var coverHref = (best && best.url) || wikiUrl;
	var coverTitle = best ? (best.label + ": " + (a.title || "")) : (a.title || "");
	var coverInner = a.cover
		? '<img class="avesmaps-adv__cover-img" src="' + placeExtrasEscape(a.cover) + '" alt="" loading="lazy">'
		: AVESMAPS_ADV_COVER_PH_SVG;
	// Meta line under the title: the DSA edition (DSA1/2/3…, shown for ~all adventures) plus the BF year when
	// present (only a few carry one). Edition first so it leads even when a year exists.
	var metaParts = [];
	if (a.edition) { metaParts.push(a.edition); }
	if (a.yearLabel) { metaParts.push(a.yearLabel); }
	var metaLine = metaParts.length ? '<div class="avesmaps-adv__meta">' + placeExtrasEscape(metaParts.join(" · ")) + '</div>' : "";
	var typeLine = a.type ? '<div class="avesmaps-adv__type">' + placeExtrasEscape(a.type) + '</div>' : "";
	// Anthology-only adventures ship inside a parent product -> the shop link points there; say why.
	var containedLine = a.containedIn ? '<div class="avesmaps-adv__contained">' + placeExtrasEscape(tr("adventures.containedInPrefix", "enthalten in: ")) + placeExtrasEscape(a.containedIn) + '</div>' : "";
	var extraClass = isPlay ? " is-play" : "";
	var hiddenStyle = (isPlay && !noInlineHide) ? ' style="display:none"' : "";
	return '<div class="avesmaps-adv__card' + extraClass + '"' + hiddenStyle + ' data-role="' + (isPlay ? "play" : "start") + '" data-year="' + (Number(a.year) || 0) + '" data-type="' + placeExtrasEscape(a.type) + '" data-title="' + placeExtrasEscape(a.title) + '" data-complexity="' + placeExtrasEscape(a.complexity || "") + '" data-genre="' + placeExtrasEscape(a.genre || "") + '" data-edition="' + placeExtrasEscape(a.edition || "") + '" data-official="' + (a.official ? "1" : "0") + '">'
		+ '<a class="avesmaps-adv__cover' + (a.cover ? " has-img" : "") + '" href="' + placeExtrasEscape(coverHref) + '" target="_blank" rel="noopener" title="' + placeExtrasEscape(coverTitle) + '">' + coverInner + '</a>'
		+ '<a class="avesmaps-adv__title" href="' + placeExtrasEscape(wikiUrl) + '" target="_blank" rel="noopener">' + placeExtrasEscape(a.title) + '</a>'
		+ metaLine
		+ typeLine
		+ containedLine
		+ '</div>';
}

// Lizenz-Fussnote (Cover © Ulisses Spiele + F-Shop-Link): geteilt vom Streifen UND beiden "Alle anzeigen"-
// Dialogen (flacher Siedlungs-Dialog hier + verschachtelter Territorien-Dialog in map-features-adventures-
// dialog.js), damit die Pflichtangabe ueberall steht, wo Cover zu sehen sind. Suppressed wenn der Cover-
// Killswitch aus ist -- keine Cover auf dem Schirm heisst kein Ulisses-Credit noetig.
function avesmapsAdventureCreditMarkup() {
	var coversOn = (typeof avesmapsAdventuresCoversEnabled !== "function") || avesmapsAdventuresCoversEnabled();
	return coversOn ? '<div class="avesmaps-adv__credit">' + tr("adventures.credit", "Cover © Ulisses Spiele — <a href=\"https://www.f-shop.de/\" target=\"_blank\" rel=\"noopener\">im F-Shop ansehen ↗</a>") + '</div>' : "";
}

// ---- Abenteuer in <Ort>: EIN Streifen (beginnt + spielt) + Sortierung + Umschalter + "Alle anzeigen" ----
// Unter der Sortierzeile ein Umschalter "Beginnt hier | Spielt hier (Spoiler)"; "Spielt hier" gibt die
// verborgenen spielt-Karten IM SELBEN Streifen per Fade frei und scrollt horizontal nach rechts zu ihnen.
//
// Kern-Renderer (Phase 2.2): baut den Abschnitt aus fertigen beginnt/spielt-Listen (render shape). Wird von
// der SIEDLUNG (buildPlaceAdventuresMarkup) UND vom TERRITORIUM/der REGION (buildTerritoryAdventuresMarkup)
// genutzt -- identisches Markup/identische Klassen, daher greifen Sortierung, Umschalter und "Alle anzeigen"
// (Document-Delegation weiter unten) fuer beide unveraendert. opts.total = Kopf-Zaehler (Default beginnt.length,
// fuer die Siedlung ggf. der Payload-/Platzhalter-Gesamtwert); opts.placeholderNote = Platzhalter-Hinweis
// (nur die Siedlung zeigt ihn, solange der echte Katalog noch nicht geladen ist).
function buildAdventuresSectionMarkup(placeName, beginnt, play, opts) {
	opts = opts || {};
	var hasBeginnt = beginnt && beginnt.length > 0;
	var hasPlay = play && play.length > 0;
	if (!hasBeginnt && !hasPlay) {
		return "";
	}
	var name = placeName || tr("adventures.fallbackPlace", "diesem Ort");
	var total = (opts.total != null) ? opts.total : (hasBeginnt ? beginnt.length : 0);
	// Kopf-Zaehler NUR, wenn kein Toggle da ist (sonst tragen die Toggle-Segmente die Zaehler).
	var countMarkup = (hasBeginnt && !hasPlay) ? ' <span class="avesmaps-adv__count">(' + placeExtrasEscape(total) + ')</span>' : "";

	// Sortierzeile (sortiert innerhalb der Rolle -- beginnt bleibt vor spielt).
	var sortsMarkup =
		'<div class="avesmaps-adv__sorts">'
		+ '<span class="avesmaps-adv__sort is-active" data-adv-sort="year">' + placeExtrasEscape(tr("adventures.sort.newest", "neueste zuerst")) + '</span>'
		+ '<span class="avesmaps-adv__sortsep"> · </span>'
		+ '<span class="avesmaps-adv__sort" data-adv-sort="type">' + placeExtrasEscape(tr("adventures.sort.byType", "nach Art")) + '</span>'
		+ '<span class="avesmaps-adv__sortsep"> · </span>'
		+ '<span class="avesmaps-adv__sort" data-adv-sort="edition">' + placeExtrasEscape(tr("adventures.sort.byEdition", "nach Edition")) + '</span>'
		+ '<span class="avesmaps-adv__sortsep"> · </span>'
		+ '<span class="avesmaps-adv__sort" data-adv-sort="alpha">' + placeExtrasEscape(tr("adventures.sort.alpha", "alphabetisch")) + '</span>'
		+ '</div>';

	// Umschalter unter der Sortierzeile (nur wenn es spielt-Orte gibt). Klick auf "Spielt hier" = Spoiler-Bestaetigung.
	var togglesMarkup = hasPlay
		? '<div class="avesmaps-adv__modes" role="tablist" aria-label="' + placeExtrasEscape(tr("adventures.modesAriaLabel", "Beginnt hier oder Spielt hier")) + '">'
			+ '<button type="button" class="avesmaps-adv__mode is-active" data-adv-mode="start" aria-selected="true">' + placeExtrasEscape(tr("adventures.mode.start", "Beginnt hier")) + ' <span class="avesmaps-adv__mode-count">(' + placeExtrasEscape(beginnt.length) + ')</span></button>'
			+ '<button type="button" class="avesmaps-adv__mode" data-adv-mode="play" aria-selected="false">' + placeExtrasEscape(tr("adventures.mode.play", "Spielt hier")) + ' <span class="avesmaps-adv__mode-note">' + placeExtrasEscape(tr("adventures.mode.spoiler", "(Spoiler)")) + '</span> <span class="avesmaps-adv__mode-count">(' + placeExtrasEscape(play.length) + ')</span></button>'
			+ '</div>'
		: "";

	var noteMarkup = opts.placeholderNote ? '<div class="avesmaps-adv__placeholder">' + placeExtrasEscape(tr("adventures.placeholderNote", "Platzhalter · Cover temporär aus dem Wiki")) + '</div>' : "";
	// Rand-Fall: hier beginnt nichts, es wird aber gespielt -> Hinweis in der beginnt-Sicht.
	var emptyHint = (!hasBeginnt && hasPlay) ? '<div class="avesmaps-adv__empty" data-adv-empty>' + placeExtrasEscape(tr("adventures.emptyHint", "Hier beginnt kein Abenteuer.")) + '</div>' : "";

	// EIN Streifen: beginnt-Karten, dann (verborgene) spielt-Karten.
	var cards = (hasBeginnt ? beginnt.map(function (a) { return buildAdventureCardMarkup(a, false); }).join("") : "")
		+ (hasPlay ? play.map(function (a) { return buildAdventureCardMarkup(a, true); }).join("") : "");
	var listMarkup = '<div class="avesmaps-adv__list">' + cards + '</div>';

	var alleMarkup = (hasBeginnt || hasPlay) ? '<div class="avesmaps-adv__actions"><button type="button" class="avesmaps-adv__all">' + placeExtrasEscape(tr("adventures.all", "Alle anzeigen")) + '</button></div>' : "";

	var creditMarkup = avesmapsAdventureCreditMarkup();

	// data-adv-territory-key markiert den Territoriums-/Regions-Block -> "Alle anzeigen" oeffnet den
	// datengetriebenen Nested-Dialog (getAdventureTerritoryTree, deepest-wins + Filter) statt des flachen
	// DOM-Klon-Dialogs der Siedlung. Bei der Siedlung fehlt das Attribut -> flacher Dialog wie bisher.
	var terrAttr = opts.territoryKey ? ' data-adv-scope="territory" data-adv-territory-key="' + placeExtrasEscape(opts.territoryKey) + '"' : "";
	return '<div class="avesmaps-adv"' + terrAttr + '>'
		+ '<div class="avesmaps-adv__head">' + tr("adventures.heading", "Abenteuer in {place}", { place: placeExtrasEscape(name) }) + countMarkup + '</div>'
		+ sortsMarkup
		+ togglesMarkup
		+ noteMarkup
		+ emptyHint
		+ listMarkup
		+ alleMarkup
		+ creditMarkup
		+ '</div>';
}

// Siedlung: die "beginnt hier"/"spielt hier"-Abenteuer dieses Orts (Phase 1). Delegiert an den Kern-Renderer.
function buildPlaceAdventuresMarkup(location) {
	var catalogReady = typeof avesmapsAdventureCatalogIsReady === "function" && avesmapsAdventureCatalogIsReady();
	var beginnt = getPlaceAdventures(location); // "beginnt hier" (Start-Ort liegt hier)
	var play = (catalogReady && typeof getAdventuresForPlace === "function") ? getAdventuresForPlace(location, { role: "play" }) : [];
	var hasBeginnt = beginnt && beginnt.length > 0;
	var placeName = (location && location.name) ? location.name : tr("adventures.fallbackPlace", "diesem Ort");
	return buildAdventuresSectionMarkup(placeName, beginnt, play, {
		total: hasBeginnt ? getPlaceAdventuresTotal(location) : 0,
		placeholderNote: hasBeginnt && !catalogReady,
	});
}

// Territorium/Region (Phase 2.2): die ueber den politischen Subtree aggregierten "beginnt/spielt"-Abenteuer.
// Nutzt den SERVER-wiki_key aus der territory-detail.php-Antwort (regionEntry.detail.wiki_key) -- NICHT aus
// wiki_url client-normalisiert: der Server-Slug (avesmapsPoliticalSlug, ö->oe) und der Client-Normalizer
// (ö->o) divergieren bei Umlauten, und getAdventuresForTerritory vergleicht gegen die per territory_path
// emittierten Server-Keys. Leer (kein detail / kein Treffer) -> Abschnitt entfaellt.
function buildTerritoryAdventuresMarkup(regionEntry) {
	if (typeof avesmapsAdventureCatalogIsReady !== "function" || !avesmapsAdventureCatalogIsReady()) {
		return "";
	}
	if (typeof getAdventuresForTerritory !== "function") {
		return "";
	}
	var name = (regionEntry && (regionEntry.displayName || regionEntry.name)) || tr("adventures.fallbackTerritory", "diesem Gebiet");
	// Political territory: aggregate over the whole political subtree via the SERVER wiki_key that arrives
	// with regionEntry.detail (territory-detail.php). Pre-detail render -> no wiki_key yet -> "".
	var detail = (regionEntry && regionEntry.detail && regionEntry.detail.ok) ? regionEntry.detail : null;
	var wikiKey = detail ? (detail.wiki_key || "") : "";
	if (wikiKey) {
		var beginnt = getAdventuresForTerritory(wikiKey, { role: "start" });
		var play = getAdventuresForTerritory(wikiKey, { role: "play" });
		if ((beginnt && beginnt.length) || (play && play.length)) {
			// territoryKey = der Server-wiki_key, den der Nested-Dialog an getAdventureTerritoryTree weitergibt.
			return buildAdventuresSectionMarkup(name, beginnt, play, { territoryKey: wikiKey });
		}
		return "";
	}
	// Landscape region rendered as a POLYGON (no political territoryPublicId): adventures assigned DIRECTLY
	// to this region, matched by its public_id. (Region LABELS go through buildRegionAdventuresMarkup below.)
	if (!regionEntry || regionEntry.territoryPublicId || typeof getAdventuresForRegion !== "function") {
		return "";
	}
	var rBeginnt = getAdventuresForRegion(regionEntry, { role: "start" });
	var rPlay = getAdventuresForRegion(regionEntry, { role: "play" });
	if ((!rBeginnt || !rBeginnt.length) && (!rPlay || !rPlay.length)) {
		return "";
	}
	return buildAdventuresSectionMarkup(name, rBeginnt, rPlay, {});
}

// Landschafts-Region-LABEL (Phase 2, Regionen): die diesem Label direkt zugeordneten "beginnt/spielt"-
// Abenteuer, EXAKT ueber label.publicId (= der vom Resolver gespeicherte target_public_id) gematcht -- flacher
// Streifen wie bei der Siedlung. Angehaengt in buildRegionLabelViewPopupHtml (map-features-labels.js). Regionen
// sind Blatt-Ziele (kein Subtree) -> kein territoryKey, "Alle anzeigen" oeffnet den flachen Dialog.
function buildRegionAdventuresMarkup(label) {
	if (typeof avesmapsAdventureCatalogIsReady !== "function" || !avesmapsAdventureCatalogIsReady()) {
		return "";
	}
	if (typeof getAdventuresForRegion !== "function" || !label) {
		return "";
	}
	var beginnt = getAdventuresForRegion(label, { role: "start" });
	var play = getAdventuresForRegion(label, { role: "play" });
	if ((!beginnt || !beginnt.length) && (!play || !play.length)) {
		return "";
	}
	var name = (label.text || (label.wikiRegion && label.wikiRegion.name)) || tr("adventures.fallbackRegion", "dieser Region");
	return buildAdventuresSectionMarkup(name, beginnt, play, {});
}

// Weg/Pfad (Phase 2, Wege): die diesem Weg zugeordneten "beginnt/spielt"-Abenteuer. Match primaer ueber die
// wiki_path-Namensgruppe (robust, da ein Weg aus vielen Segmenten besteht) + Segment-public_id. Flacher
// Streifen. Angehaengt in avesmapsShowPathInInfopanel (map-features-infopanel.js).
function buildPathAdventuresMarkup(path) {
	if (typeof avesmapsAdventureCatalogIsReady !== "function" || !avesmapsAdventureCatalogIsReady()) {
		return "";
	}
	if (typeof getAdventuresForPath !== "function" || !path) {
		return "";
	}
	var wikiPath = (path.properties && path.properties.wiki_path) || null;
	var ref = {
		publicId: (typeof getPathPublicId === "function") ? getPathPublicId(path) : (path.public_id || ""),
		wikiKey: (wikiPath && wikiPath.wiki_key) || "",
	};
	var beginnt = getAdventuresForPath(ref, { role: "start" });
	var play = getAdventuresForPath(ref, { role: "play" });
	if ((!beginnt || !beginnt.length) && (!play || !play.length)) {
		return "";
	}
	var name = (typeof getPathDisplayName === "function") ? getPathDisplayName(path) : (path.name || tr("adventures.fallbackPath", "diesem Weg"));
	return buildAdventuresSectionMarkup(name, beginnt, play, {});
}

// Floating-Box-Kachel "Abenteuer" (Owner via Design-Session): die schlanke Siedlungs-Box zeigt KEINEN
// Abenteuer-Streifen -> stattdessen ein Kachel-Button in der Aktionsleiste, der den flachen Dialog oeffnet.
// Nur wenn der Katalog geladen ist UND die Siedlung ueberhaupt Abenteuer hat (sonst "" -> keine Kachel). Die
// Kachel-Optik kommt aus location-popups-markers.css (jeder .location-popup__action-button wird dort zur
// Kachel); der Klick laeuft ueber data-adv-open-place + den Delegation-Handler (public_id -> Ort -> Dialog).
function buildFloatingAdventuresButtonMarkup(location, publicId) {
	if (!publicId || typeof popupActionButtonMarkup !== "function") {
		return "";
	}
	// Immer eine Kachel rendern (Owner via Design-Session): fehlen Abenteuer -- oder ist der Katalog noch
	// nicht geladen -- steht sie deaktiviert da, statt wegzufallen. So bleibt die Aktionsleiste stabil.
	var ready = typeof avesmapsAdventureCatalogIsReady === "function" && avesmapsAdventureCatalogIsReady();
	var all = (ready && typeof getAdventuresForPlace === "function") ? getAdventuresForPlace(location, { role: "all" }) : [];
	var hasAdventures = !!(all && all.length);
	var attributes = { "data-adv-open-place": publicId };
	if (!hasAdventures) {
		attributes["aria-disabled"] = "true";
	}
	return popupActionButtonMarkup({
		label: tr("adventures.label", "Abenteuer"),
		iconMarkup: '<img class="location-popup__action-img" src="img/menu/abenteuer.webp" alt="" width="20" height="20" />',
		attributes: attributes,
	});
}

// Floating-Box-Kachel "Stadtkarten" (Owner via Design-Session): noch Platzhalter -> immer sichtbar, aber
// deaktiviert. Kein Klick-Handler; die aria-disabled-Kachel gibt nur einen Ausblick auf das kommende Feature.
function buildFloatingCityMapsButtonMarkup(publicId) {
	if (!publicId || typeof popupActionButtonMarkup !== "function") {
		return "";
	}
	return popupActionButtonMarkup({
		// Weicher Trennstrich (U+00AD): unsichtbar, solange das Wort passt; bricht die 90px-Kachel sonst
		// sauber in zwei Zeilen statt zu ueberlaufen. Kein Eingriff in die geteilte hyphens:auto-Regel (die
		// ist bewusst nur fuer Fliesstext, nicht Buttons/Kacheln).
		label: tr("cityMaps.buttonLabel", "Karten­sammlung"),
		iconMarkup: '<img class="location-popup__action-img" src="img/menu/stadtkarte.webp" alt="" width="20" height="20" />',
		attributes: { "aria-disabled": "true", "data-citymaps-placeholder": "true" },
	});
}

// ---- Interaktivitaet via Document-Delegation (funktioniert in Popup UND Panel) ----
(function initPlaceExtrasDelegation() {
	if (typeof window.__avesmapsPlaceExtrasBound !== "undefined") {
		return;
	}
	window.__avesmapsPlaceExtrasBound = true;
	if (typeof $ === "undefined") {
		return;
	}

	// Dialog "Alle Abenteuer": modaler Overlay, einmal lazy gebaut und wiederverwendet.
	function ensureAdventuresDialog() {
		var overlay = document.getElementById("avesmaps-adv-dialog");
		if (overlay) {
			return overlay;
		}
		overlay = document.createElement("div");
		overlay.id = "avesmaps-adv-dialog";
		overlay.className = "avesmaps-adv-dialog";
		overlay.innerHTML = '<div class="avesmaps-adv-dialog__box" role="dialog" aria-modal="true">'
			+ '<div class="avesmaps-adv-dialog__head"><span class="avesmaps-adv-dialog__title"></span>'
			+ '<button type="button" class="avesmaps-adv-dialog__close" aria-label="' + placeExtrasEscape(tr("adventures.closeAria", "Schließen")) + '">✕</button></div>'
			+ '<div class="avesmaps-adv-dialog__grid"></div>'
			+ '<div class="avesmaps-adv-dialog__credit"></div></div>';
		document.body.appendChild(overlay);
		var close = function () { overlay.classList.remove("is-open"); };
		overlay.addEventListener("click", function (e) { if (e.target === overlay) { close(); } });
		overlay.querySelector(".avesmaps-adv-dialog__close").addEventListener("click", close);
		document.addEventListener("keydown", function (e) { if (e.key === "Escape") { close(); } });
		return overlay;
	}
	// Shape aus den Karten-data-Attributen -> avesmapsAdventureFacetOptions/avesmapsAdventureMatchesFilter
	// (geteilte, reine Funktionen aus map-features-adventures.js, gleiches Praedikat wie der Nested-Dialog).
	function cardShapeFromEl(card) {
		return {
			type: card.getAttribute("data-type") || "",
			edition: card.getAttribute("data-edition") || "",
			year: Number(card.getAttribute("data-year")) || 0,
			complexity: card.getAttribute("data-complexity") || "",
			genre: card.getAttribute("data-genre") || "",
			official: card.getAttribute("data-official") === "1",
		};
	}
	function dialogCardPasses(card, filter) {
		if (typeof avesmapsAdventureMatchesFilter !== "function") {
			return true;
		}
		return avesmapsAdventureMatchesFilter(cardShapeFromEl(card), filter);
	}

	// Filterleiste fuer den flachen Dialog -- gleiche Optik/Klassen wie der Nested-Dialog (adventures-dialog.css,
	// .avesmaps-adv-tree__filters/__chip/__selwrap/__fsel/__yearwrap/__yearin/__fdiv sind NICHT ancestor-scoped,
	// also visuell wiederverwendbar). Eigene, dialog-lokale State-/Event-Verdrahtung in buildDialogControls
	// (nicht $(document).on), damit sie den Nested-Dialog (#avesmaps-adv-tree-dialog) nicht beruehrt.
	function dialogFiltersMarkup(facets) {
		var parts = ['<span class="avesmaps-adv-tree__flabel">' + placeExtrasEscape(tr("adventures.filter.label", "Filter")) + '</span>'];
		if (facets.types && facets.types.length) {
			facets.types.forEach(function (t) {
				parts.push('<span class="avesmaps-adv-tree__chip" data-adv-filter="type" data-adv-value="' + placeExtrasEscape(t) + '">' + placeExtrasEscape(t) + '</span>');
			});
			parts.push('<span class="avesmaps-adv-tree__fdiv"></span>');
		}
		if (facets.editions && facets.editions.length) {
			parts.push('<span class="avesmaps-adv-tree__selwrap"><select class="avesmaps-adv-tree__fsel" data-adv-filter="edition"><option value="">' + placeExtrasEscape(tr("adventures.filter.edition", "DSA-Version")) + '</option>'
				+ facets.editions.map(function (e) { return '<option value="' + placeExtrasEscape(e) + '">' + placeExtrasEscape(e) + '</option>'; }).join('') + '</select></span>');
		}
		if (facets.complexities && facets.complexities.length) {
			parts.push('<span class="avesmaps-adv-tree__selwrap"><select class="avesmaps-adv-tree__fsel" data-adv-filter="complexity"><option value="">' + placeExtrasEscape(tr("adventures.filter.complexity", "Schwierigkeit")) + '</option>'
				+ facets.complexities.map(function (d) { return '<option value="' + placeExtrasEscape(d) + '">' + placeExtrasEscape(d) + '</option>'; }).join('') + '</select></span>');
		}
		if (facets.genres && facets.genres.length) {
			parts.push('<span class="avesmaps-adv-tree__selwrap"><select class="avesmaps-adv-tree__fsel" data-adv-filter="genre"><option value="">' + placeExtrasEscape(tr("adventures.filter.genre", "Genre")) + '</option>'
				+ facets.genres.map(function (g) { return '<option value="' + placeExtrasEscape(g) + '">' + placeExtrasEscape(g) + '</option>'; }).join('') + '</select></span>');
		}
		var yr = facets.yearRange || { min: 0, max: 0 };
		var fromPh = yr.min > 0 ? placeExtrasEscape(yr.min) : placeExtrasEscape(tr("adventures.filter.from", "von"));
		var toPh = yr.max > 0 ? placeExtrasEscape(yr.max) : placeExtrasEscape(tr("adventures.filter.to", "bis"));
		parts.push('<span class="avesmaps-adv-tree__yearwrap"><span class="avesmaps-adv-tree__ylabel">' + placeExtrasEscape(tr("adventures.filter.period", "Zeitraum (BF)")) + '</span>'
			+ '<input type="number" inputmode="numeric" class="avesmaps-adv-tree__yearin" data-adv-filter="yearFrom" placeholder="' + fromPh + '">'
			+ '<span class="avesmaps-adv-tree__ydash">–</span>'
			+ '<input type="number" inputmode="numeric" class="avesmaps-adv-tree__yearin" data-adv-filter="yearTo" placeholder="' + toPh + '"></span>');
		parts.push('<span class="avesmaps-adv-tree__fdiv"></span>');
		parts.push('<span class="avesmaps-adv-tree__chip" data-adv-filter="official">' + placeExtrasEscape(tr("adventures.filter.officialOnly", "nur offiziell")) + '</span>');
		return '<div class="avesmaps-adv-tree__filters">' + parts.join("") + '</div>';
	}

	// Dialog-Steuerzeile: Umschalter (nur wenn spielt-Karten da sind) + Filterleiste (nur wenn die aktuellen
	// Karten >=1 Facette hergeben) + Sortier-Links -- gleiche Reihenfolge wie der Nested-Dialog (Umschalter ->
	// Filter -> Sortierung). In eine eigene .__controls-Box, damit im Flex-Column-Dialog nichts auf volle
	// Breite gestreckt wird (CSS align-items:flex-start). Filter-Events sind box-lokal (nicht document-delegiert),
	// damit sie unabhaengig vom geteilten Sortier-/Umschalter-Handler bleiben.
	function buildDialogControls(overlay, startCount, playCount) {
		var existing = overlay.querySelector(".avesmaps-adv-dialog__controls");
		if (existing) {
			existing.parentNode.removeChild(existing);
		}
		var box = overlay.querySelector(".avesmaps-adv-dialog__box");
		var grid = overlay.querySelector(".avesmaps-adv-dialog__grid");
		var controls = document.createElement("div");
		controls.className = "avesmaps-adv-dialog__controls";
		var sortsHtml =
			'<div class="avesmaps-adv__sorts">'
			+ '<span class="avesmaps-adv__sort is-active" data-adv-sort="year">' + placeExtrasEscape(tr("adventures.sort.newest", "neueste zuerst")) + '</span>'
			+ '<span class="avesmaps-adv__sortsep"> · </span>'
			+ '<span class="avesmaps-adv__sort" data-adv-sort="type">' + placeExtrasEscape(tr("adventures.sort.byType", "nach Art")) + '</span>'
			+ '<span class="avesmaps-adv__sortsep"> · </span>'
			+ '<span class="avesmaps-adv__sort" data-adv-sort="edition">' + placeExtrasEscape(tr("adventures.sort.byEdition", "nach Edition")) + '</span>'
			+ '<span class="avesmaps-adv__sortsep"> · </span>'
			+ '<span class="avesmaps-adv__sort" data-adv-sort="alpha">' + placeExtrasEscape(tr("adventures.sort.alpha", "alphabetisch")) + '</span>'
			+ '</div>';
		var togglesHtml = playCount
			? '<div class="avesmaps-adv-dialog__modes" role="tablist">'
				+ '<button type="button" class="avesmaps-adv__mode is-active" data-adv-mode="start" aria-selected="true">' + placeExtrasEscape(tr("adventures.mode.start", "Beginnt hier")) + ' <span class="avesmaps-adv__mode-count" data-adv-count="start">(' + startCount + ')</span></button>'
				+ '<button type="button" class="avesmaps-adv__mode" data-adv-mode="play" aria-selected="false">' + placeExtrasEscape(tr("adventures.mode.play", "Spielt hier")) + ' <span class="avesmaps-adv__mode-note">' + placeExtrasEscape(tr("adventures.mode.spoiler", "(Spoiler)")) + '</span> <span class="avesmaps-adv__mode-count" data-adv-count="play">(' + playCount + ')</span></button>'
				+ '</div>'
			: "";

		var cards = grid ? Array.prototype.slice.call(grid.querySelectorAll(".avesmaps-adv__card")) : [];
		var shapes = cards.map(cardShapeFromEl);
		var facets = (typeof avesmapsAdventureFacetOptions === "function")
			? avesmapsAdventureFacetOptions(shapes)
			: { types: [], complexities: [], genres: [], editions: [] };
		var filtersHtml = dialogFiltersMarkup(facets);

		controls.innerHTML = togglesHtml + filtersHtml + sortsHtml;
		box.insertBefore(controls, grid);

		var filterState = { types: new Set(), complexity: "", genre: "", edition: "", yearFrom: 0, yearTo: 0, officialOnly: false };

		function applyFilters() {
			var visStart = 0;
			var visPlay = 0;
			cards.forEach(function (card) {
				var passes = dialogCardPasses(card, filterState);
				card.classList.toggle("is-filtered-out", !passes);
				if (passes) {
					if (card.classList.contains("is-play")) { visPlay += 1; } else { visStart += 1; }
				}
			});
			var cs = controls.querySelector('[data-adv-count="start"]');
			var cp = controls.querySelector('[data-adv-count="play"]');
			if (cs) { cs.textContent = "(" + visStart + ")"; }
			if (cp) { cp.textContent = "(" + visPlay + ")"; }
		}

		controls.addEventListener("click", function (e) {
			var chip = e.target.closest("[data-adv-filter]");
			if (!chip || !chip.classList.contains("avesmaps-adv-tree__chip")) {
				return;
			}
			var kind = chip.getAttribute("data-adv-filter");
			if (kind === "official") {
				filterState.officialOnly = !filterState.officialOnly;
				chip.classList.toggle("is-active", filterState.officialOnly);
			} else if (kind === "type") {
				var v = chip.getAttribute("data-adv-value");
				if (filterState.types.has(v)) {
					filterState.types.delete(v);
					chip.classList.remove("is-active");
				} else {
					filterState.types.add(v);
					chip.classList.add("is-active");
				}
			}
			applyFilters();
		});
		controls.addEventListener("change", function (e) {
			var el = e.target;
			var kind = el && el.getAttribute ? el.getAttribute("data-adv-filter") : "";
			if (kind === "complexity") { filterState.complexity = el.value || ""; applyFilters(); }
			else if (kind === "genre") { filterState.genre = el.value || ""; applyFilters(); }
			else if (kind === "edition") { filterState.edition = el.value || ""; applyFilters(); }
		});
		controls.addEventListener("input", function (e) {
			var el = e.target;
			var kind = el && el.getAttribute ? el.getAttribute("data-adv-filter") : "";
			if (kind === "yearFrom") { filterState.yearFrom = Number(el.value) || 0; applyFilters(); }
			else if (kind === "yearTo") { filterState.yearTo = Number(el.value) || 0; applyFilters(); }
		});
	}

	// Kern: den flachen Dialog aus einer .avesmaps-adv-SECTION befuellen (Titel + Karten aus dem Streifen klonen)
	// und oeffnen. Genutzt vom "Alle anzeigen"-Button (Streifen im Panel) UND vom Floating-Box-"Abenteuer"-Button
	// (der die Section on-demand aus den Ortsdaten baut -> openPlaceAdventuresDialog).
	function openFlatDialogForSection(section) {
		if (!section) {
			return;
		}
		var overlay = ensureAdventuresDialog();
		var head = section.querySelector(".avesmaps-adv__head");
		overlay.querySelector(".avesmaps-adv-dialog__title").textContent = head ? head.textContent.trim() : tr("adventures.label", "Abenteuer");
		var listEl = section.querySelector(".avesmaps-adv__list");
		var startCards = listEl ? listEl.querySelectorAll(".avesmaps-adv__card:not(.is-play)") : [];
		var playCards = listEl ? listEl.querySelectorAll(".avesmaps-adv__card.is-play") : [];
		var grid = overlay.querySelector(".avesmaps-adv-dialog__grid");
		grid.innerHTML = "";
		grid.classList.remove("show-play"); // Dialog startet in der beginnt-Sicht
		// beginnt-Karten (voll), dann spielt-Karten (verborgen). Inline-Opacity zuruecksetzen (Streifen evtl. gedimmt).
		Array.prototype.forEach.call(startCards, function (card) {
			var clone = card.cloneNode(true);
			clone.style.opacity = "";
			grid.appendChild(clone);
		});
		Array.prototype.forEach.call(playCards, function (card) {
			var clone = card.cloneNode(true);
			clone.style.opacity = "";
			clone.style.display = "none";
			grid.appendChild(clone);
		});
		buildDialogControls(overlay, startCards.length, playCards.length);
		var creditEl = overlay.querySelector(".avesmaps-adv-dialog__credit");
		if (creditEl) {
			creditEl.innerHTML = avesmapsAdventureCreditMarkup();
		}
		overlay.classList.add("is-open");
	}

	// Floating-Box-"Abenteuer"-Button: die schlanke Box rendert KEINEN Abenteuer-Streifen -> den Streifen-Markup
	// on-demand aus den Ortsdaten bauen (detached, nur als Karten-Quelle) und daraus den flachen Dialog oeffnen.
	function openPlaceAdventuresDialog(location) {
		if (!location || typeof buildPlaceAdventuresMarkup !== "function") {
			return;
		}
		var holder = document.createElement("div");
		holder.innerHTML = buildPlaceAdventuresMarkup(location);
		var section = holder.querySelector(".avesmaps-adv");
		if (section) {
			openFlatDialogForSection(section);
		}
	}

	// "Alle anzeigen" -> flacher Dialog (aus dem Streifen geklont); bei einem Territoriums-Block
	// (data-adv-territory-key) stattdessen der verschachtelte Baum-Dialog. Popup UND Panel.
	$(document).on("click", ".avesmaps-adv__all", function () {
		var section = $(this).closest(".avesmaps-adv")[0];
		if (!section) {
			return;
		}
		var territoryKey = section.getAttribute("data-adv-territory-key");
		if (territoryKey && typeof openNestedAdventuresDialog === "function") {
			openNestedAdventuresDialog(territoryKey, section);
			return;
		}
		openFlatDialogForSection(section);
	});

	// Floating-Box-Kachel "Abenteuer": public_id -> markerEntry -> Ort -> flacher Dialog. Eigener Selektor
	// (data-adv-open-place, NICHT data-popup-action) -> der zentrale routing.js-Actionhandler hat keinen Fall
	// dafuer; da er nur stopPropagation (nicht stopImmediatePropagation) nutzt, feuert dieser Handler trotzdem.
	$(document).on("click", "[data-adv-open-place]", function () {
		if (this.getAttribute("aria-disabled") === "true") {
			return; // deaktivierte Kachel (keine Abenteuer / Katalog nicht geladen) -- kein Dialog.
		}
		var publicId = this.getAttribute("data-adv-open-place");
		if (!publicId || typeof findLocationMarkerByPublicId !== "function") {
			return;
		}
		var entry = findLocationMarkerByPublicId(publicId);
		if (entry && entry.location) {
			openPlaceAdventuresDialog(entry.location);
		}
	});

	// Sortierung -- funktioniert im Streifen (.avesmaps-adv) UND im Dialog (.avesmaps-adv-dialog__box).
	$(document).on("click", ".avesmaps-adv__sort", function () {
		var container = $(this).closest(".avesmaps-adv, .avesmaps-adv-dialog__box")[0];
		if (!container) {
			return;
		}
		var mode = this.getAttribute("data-adv-sort");
		var cardBox = container.querySelector(".avesmaps-adv__list, .avesmaps-adv-dialog__grid");
		if (!cardBox) {
			return;
		}
		var compare = function (a, b) {
			if (mode === "alpha") {
				return String(a.dataset.title).localeCompare(String(b.dataset.title), "de");
			}
			if (mode === "type") {
				return String(a.dataset.type).localeCompare(String(b.dataset.type), "de") || ((Number(b.dataset.year) || 0) - (Number(a.dataset.year) || 0));
			}
			if (mode === "edition") {
				var ek = typeof avesmapsAdventureEditionSortKey === "function"
					? (avesmapsAdventureEditionSortKey(a.dataset.edition) - avesmapsAdventureEditionSortKey(b.dataset.edition)) : 0;
				return ek || String(a.dataset.title).localeCompare(String(b.dataset.title), "de");
			}
			return (Number(b.dataset.year) || 0) - (Number(a.dataset.year) || 0);
		};
		// Innerhalb der Rolle sortieren -- beginnt bleibt VOR spielt (Reihenfolge-Invariante).
		var startCards = Array.prototype.slice.call(cardBox.querySelectorAll(".avesmaps-adv__card:not(.is-play)")).sort(compare);
		var playCards = Array.prototype.slice.call(cardBox.querySelectorAll(".avesmaps-adv__card.is-play")).sort(compare);
		startCards.concat(playCards).forEach(function (c) { cardBox.appendChild(c); });
		if (!cardBox.classList.contains("show-play")) {
			cardBox.scrollLeft = 0;
		}
		// Aktiv-Zustand nur in der geklickten Sortierzeile (Streifen ODER Dialog).
		var sortsRow = $(this).closest(".avesmaps-adv__sorts")[0];
		var sorts = sortsRow ? sortsRow.querySelectorAll(".avesmaps-adv__sort") : [];
		for (var i = 0; i < sorts.length; i += 1) {
			sorts[i].classList.toggle("is-active", sorts[i] === this);
		}
	});

	// Kern: beginnt/spielt im SELBEN Karten-Container (Streifen ODER Dialog-Grid) umschalten. Bei "play" die
	// spielt-Karten per Fade freigeben (JS display + CSS-Opacity) und die beginnt-Karten dimmen (Owner-Wunsch:
	// "etwas ausblenden"); optional horizontal nach rechts scrollen (nur Streifen). Bei "start" umgekehrt.
	function applyAdventureMode(cardBox, mode, doScroll) {
		if (!cardBox) {
			return;
		}
		var playCards = cardBox.querySelectorAll(".avesmaps-adv__card.is-play");
		var j;
		if (mode === "play") {
			for (j = 0; j < playCards.length; j += 1) {
				playCards[j].style.display = "";
			}
			void cardBox.offsetWidth; // Reflow erzwingen, damit die Opacity-Transition greift
			cardBox.classList.add("show-play");
			if (doScroll) {
				var firstPlay = cardBox.querySelector(".avesmaps-adv__card.is-play");
				var firstCard = cardBox.querySelector(".avesmaps-adv__card");
				if (firstPlay && firstCard) {
					var target = firstPlay.offsetLeft - firstCard.offsetLeft;
					if (typeof cardBox.scrollTo === "function") {
						cardBox.scrollTo({ left: target, behavior: "smooth" });
					} else {
						cardBox.scrollLeft = target;
					}
				}
			}
		} else {
			cardBox.classList.remove("show-play");
			if (doScroll) {
				if (typeof cardBox.scrollTo === "function") {
					cardBox.scrollTo({ left: 0, behavior: "smooth" });
				} else {
					cardBox.scrollLeft = 0;
				}
			}
			setTimeout(function () {
				if (!cardBox.classList.contains("show-play")) {
					for (var k = 0; k < playCards.length; k += 1) {
						playCards[k].style.display = "none";
					}
				}
			}, 320);
		}
	}

	function syncModeButtons(container, mode) {
		var modes = container.querySelectorAll(".avesmaps-adv__mode");
		for (var i = 0; i < modes.length; i += 1) {
			var active = modes[i].getAttribute("data-adv-mode") === mode;
			modes[i].classList.toggle("is-active", active);
			modes[i].setAttribute("aria-selected", active ? "true" : "false");
		}
	}

	// Streifen-Umschalter (Infopanel/Popup): Buttons + Leer-Hinweis setzen, dann Karten umschalten (mit Scroll).
	$(document).on("click", ".avesmaps-adv__modes .avesmaps-adv__mode", function () {
		var section = $(this).closest(".avesmaps-adv")[0];
		if (!section) {
			return;
		}
		var mode = this.getAttribute("data-adv-mode");
		syncModeButtons(section, mode);
		var empty = section.querySelector("[data-adv-empty]");
		if (empty) {
			empty.style.display = (mode === "play") ? "none" : "";
		}
		applyAdventureMode(section.querySelector(".avesmaps-adv__list"), mode, true);
	});

	// Dialog-Umschalter ("Alle anzeigen"): gleiches Verhalten im Grid, ohne Scroll (Grid bricht um).
	$(document).on("click", ".avesmaps-adv-dialog__modes .avesmaps-adv__mode", function () {
		var overlay = document.getElementById("avesmaps-adv-dialog");
		if (!overlay) {
			return;
		}
		var mode = this.getAttribute("data-adv-mode");
		syncModeButtons(overlay, mode);
		applyAdventureMode(overlay.querySelector(".avesmaps-adv-dialog__grid"), mode, false);
	});
})();

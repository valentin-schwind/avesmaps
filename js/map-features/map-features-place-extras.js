// Place-Extras (Infopanel Phase 6): die Abschnitte "Kartensammlung" (kuratierte Karten) und
// "Abenteuer in <Ort>" fuer Siedlung, Territorium, Region und Weg -- Popup wie Panel.
//
// BEIDE sind seit Aufgabe C datengetrieben: die Abenteuer aus dem Katalog (map-features-adventures.js,
// api/app/adventures.php), die Karten aus dem Kartenkatalog (map-features-citymaps.js,
// api/app/citymaps.php). Von den Platzhaltern ist nur noch AVESMAPS_PLACEHOLDER_ADVENTURES uebrig, und
// zwar absichtlich: der Abenteuerkatalog kann laden, waehrend die Box schon offen ist, und ein leerer
// Blitz waere schlechter als eine Platzhalterkarte. Die Kartensammlung hat dieses Fenster nicht -- ohne
// Katalog erscheint der Abschnitt gar nicht erst, was eine ehrliche Antwort ist.
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
// AVESMAPS_PLACEHOLDER_CITYMAPS is gone (Aufgabe C): the Kartensammlung has a backend now
// (api/app/citymaps.php + map-features-citymaps.js), so a place with no maps renders NO section rather
// than four fake links. The adventure placeholders above still stand -- their catalog can be slow, and a
// blank flash is worse than a placeholder; the map section has no such window (it simply does not appear).

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
// Kartensammlung (Aufgabe C): the real catalog (map-features-citymaps.js) whenever it is loaded.
// location.cityMaps stays as the payload path for a box that carries its own maps. No placeholder tier --
// no maps means no section, which is a truthful answer rather than a blank flash.
function getPlaceCityMaps(location) {
	if (typeof avesmapsCitymapCatalogIsReady === "function" && avesmapsCitymapCatalogIsReady()) {
		return getCityMapsForPlace(location);
	}
	if (location && Array.isArray(location.cityMaps)) {
		return location.cityMaps;
	}
	return [];
}

function placeExtrasEscape(value) {
	return typeof escapeHtml === "function" ? escapeHtml(String(value == null ? "" : value)) : String(value == null ? "" : value);
}

// ---- Kartensammlung -------------------------------------------------------------------------------
// Only http(s) and our own /uploads/ paths may become an href. ESCAPING IS NOT ENOUGH HERE: escapeHtml
// leaves "javascript:alert(1)" untouched (it has no HTML metacharacters), and it would then be a live
// href. The write path already refuses anything else (avesmapsCitymapNormalizeUrl, api/_internal/app/
// citymaps.php) -- but getPlaceCityMaps also accepts a location.cityMaps payload that never passed
// through it, so the render side does not take that on trust.
function cityMapSafeUrl(value) {
	var url = String(value == null ? "" : value).trim();
	if (!url) {
		return "";
	}
	if (url.charAt(0) === "/" && url.charAt(1) !== "/") {
		return url; // our own upload path; a leading "//" would be protocol-relative and is not
	}
	return /^https?:\/\//i.test(url) ? url : "";
}

// The link a map card opens: our own copy when we are allowed to host one (the server already applied the
// licence gate, §3.3 -- a present map_local_url IS the permission), else the external map link. "" when a
// map has neither, which is a valid row: the card then shows the title and does not pretend to link.
function cityMapBestLink(m) {
	var local = cityMapSafeUrl(m && m.map_local_url);
	if (local) {
		return local;
	}
	return cityMapSafeUrl(m && m.map_url);
}

// ---- Spoiler-Schleier: EIN Mechanismus fuer Karten UND Abenteuer (Owner 2026-07-18) -----------------
// Die Regel, die beide Seiten teilen: **spoilerfrei steht sofort da, ein Spoiler steht auch da -- nur
// unkenntlich**, mit einem Label mittig auf dem Nebel. Ein Klick auf den Schleier deckt EINEN auf, der
// Sammelschalter der Leiste alle; beim naechsten Oeffnen ist wieder alles zu.
//
// Vorher waren es zwei Mechanismen: Karten blurrten, Abenteuer versteckten ihre Spoiler per display:none
// hinter einem Beginnt/Spielt-Umschalter. Das Verstecken sagte dem Leser erst NACH dem Klick, welche
// Eintraege die Spoiler sind -- der Nebel sagt es sofort und ohne Klick.
//
// Drei Bausteine, mehr braucht es nicht:
//   .is-spoiler            am Element -- verschleiert seine Kinder
//   .avesmaps-spoiler-veil das Label mittig darauf (Klick deckt genau dieses Element auf)
//   .show-spoilers         am Container -- hebt ALLE Schleier darin auf
// Das Element braucht `position: relative`, sonst legt sich der Schleier ueber den falschen Anker.
function avesmapsSpoilerVeilMarkup(label) {
	return '<span class="avesmaps-spoiler-veil" data-spoiler-reveal>' + placeExtrasEscape(label) + '</span>';
}

// Die ANFANGSreihenfolge einer Abenteuerliste: durchgehend nach Jahr, neueste zuerst -- Spoiler stehen
// dazwischen statt als Block am Ende (Owner 2026-07-18). Muss mit der Default-Sortierung der Sortierzeile
// uebereinstimmen (data-adv-sort="year" traegt is-active), sonst ordnet der erste Sortierklick sichtbar um,
// obwohl der Leser dieselbe Sortierung waehlt. Nimmt/liefert {a, isPlay}-Paare, weil die Rolle beim
// Rendern gebraucht wird; stabil, damit Jahrgleiche ihre Eingangsreihenfolge behalten.
function avesmapsSortAdventureEntries(entries) {
	return entries.slice().sort(function (x, y) {
		return (Number(y.a && y.a.year) || 0) - (Number(x.a && x.a.year) || 0);
	});
}

// A spoiler map hides behind a blurred thumb + an overlay until the reader asks (§3.7). Only an EXPLICIT
// is_spoiler === true counts: unknown (null) is not a spoiler, and treating it as one would hide maps
// nobody ever classified.
function cityMapIsSpoiler(m) {
	return !!(m && m.is_spoiler === true);
}

// The thumb, or the placeholder icon when there is none -- which is also what a map whose licence forbids
// a preview looks like (the server ships an empty thumb, §3.3). Shared by the strip card and the dialog
// row so the two can never drift on how a missing preview reads.
function cityMapThumbMarkup(m) {
	var thumb = cityMapSafeUrl(m && m.thumb);
	return thumb
		? '<img class="avesmaps-citymaps__thumb-img" src="' + placeExtrasEscape(thumb) + '" alt="" loading="lazy">'
		: AVESMAPS_CITYMAP_THUMB_SVG;
}

function cityMapCardMarkup(m) {
	var href = cityMapBestLink(m);
	var spoiler = cityMapIsSpoiler(m);
	var thumbInner = cityMapThumbMarkup(m);
	// The overlay sits INSIDE the anchor and swallows the first click (see the delegated reveal handler),
	// so a spoiler can never be opened by accident on the way to uncovering it.
	var spoilerOverlay = spoiler
		? avesmapsSpoilerVeilMarkup(tr("cityMaps.spoilerReveal", "Spoiler (Spielinhalte)"))
		: "";
	var openAttrs = href
		? ' href="' + placeExtrasEscape(href) + '" target="_blank" rel="noopener"'
		: ' href="#" onclick="return false" aria-disabled="true"';
	return '<a class="avesmaps-citymaps__card' + (spoiler ? " is-spoiler" : "") + '"' + openAttrs
		+ cityMapDataAttributes(m) + ' title="' + placeExtrasEscape(m.title) + '">'
		+ '<span class="avesmaps-citymaps__thumb" data-spoiler-image>' + thumbInner + '</span>'
		+ '<span class="avesmaps-citymaps__label">' + placeExtrasEscape(m.title) + '</span>'
		+ spoilerOverlay
		+ '</a>';
}

// The data-* contract shared by the strip card AND the dialog row -- the dialog's filter predicate reads
// these off whatever element it finds, so both MUST stamp the identical set (the adventure card/row pair
// learned this: a row missing one silently disables a control rather than breaking loudly).
// data-public-id is the row's link back into the catalog.
function cityMapDataAttributes(m) {
	return ' data-public-id="' + placeExtrasEscape(m.public_id || "") + '"'
		+ ' data-title="' + placeExtrasEscape(m.title || "") + '"'
		+ ' data-types="' + placeExtrasEscape((m.types || []).join(",")) + '"'
		+ ' data-art="' + placeExtrasEscape(m.art || "") + '"'
		// Tri-state travels as "1" | "0" | "" -- an empty attribute is UNKNOWN, not false (§3.1). A
		// data-color="0" would claim we know the map is not coloured.
		+ ' data-color="' + cityMapTriAttr(m.is_color) + '"'
		+ ' data-multilevel="' + cityMapTriAttr(m.is_multilevel) + '"'
		+ ' data-labeled="' + cityMapTriAttr(m.is_labeled) + '"'
		+ ' data-official="' + cityMapTriAttr(m.is_official) + '"'
		+ ' data-spoiler="' + cityMapTriAttr(m.is_spoiler) + '"'
		+ ' data-paid="' + cityMapTriAttr(m.is_paid) + '"'
		+ ' data-from="' + (m.valid_from_bf == null ? "" : Number(m.valid_from_bf)) + '"'
		+ ' data-to="' + (m.valid_to_bf == null ? "" : Number(m.valid_to_bf)) + '"'
		+ ' data-sources="' + placeExtrasEscape((m.sources || []).map(function (s) { return s && s.label; }).filter(Boolean).join("|")) + '"';
}

function cityMapTriAttr(value) {
	return value == null ? "" : (value ? "1" : "0");
}

// Kern-Renderer: baut den Abschnitt aus einer fertigen Kartenliste. Genutzt von Siedlung, Territorium,
// Region und Weg -- identisches Markup/identische Klassen, daher greifen "Alle anzeigen" und der
// Spoiler-Reveal (Document-Delegation) fuer alle vier unveraendert.
function buildCityMapsSectionMarkup(placeName, maps, opts) {
	opts = opts || {};
	if (!maps || !maps.length) {
		return "";
	}
	var cards = maps.map(cityMapCardMarkup).join("");
	var name = placeName || tr("cityMaps.fallbackPlace", "diesem Ort");
	// data-citymap-territory-key marks a territory/region block so the dialog can rebuild the SAME set
	// from the catalog.
	var scopeAttr = opts.territoryKey
		? ' data-citymap-territory-key="' + placeExtrasEscape(opts.territoryKey) + '"'
		: "";
	// Ortsreferenz (§3.8): "Karte vorschlagen" haengt den Vorschlag an genau den Ort, aus dessen
	// Kartensammlung der Dialog geoeffnet wurde -- der Melder soll den Ort nicht abtippen, den er gerade
	// offen hat. Bis hierher trug NUR der Territoriumsblock eine Referenz (fuer den Set-Rebuild); der
	// Kommentar daneben behauptete zwar, der Siedlungsblock trage "seine place ref", aber alle drei
	// anderen Aufrufer uebergaben {}.
	//
	// kind+publicId genuegt: den wiki_key leitet der Server aus der id ab (avesmapsAddCitymapPlace), was
	// die §3.9-Falle gar nicht erst aufmacht -- Server-Slug (ö->oe) und Client-Normalisierer (ö->o)
	// divergieren. Nur das Territorium schickt einen Key, und zwar den, den der SERVER geliefert hat.
	var place = opts.place || null;
	var placeAttr = place ? citymapPlaceAttrs(place, name) : "";
	// "Karte vorschlagen" gleich hier, neben "Alle anzeigen" (Owner 2026-07-17) -- nicht nur unten im
	// Dialog, den man dafuer erst oeffnen muesste. Der Button traegt die Ortsreferenz SELBST, wie sein
	// Zwilling in der Dialog-Fussleiste: ein Vorschlag haengt am Ort, nicht an der Sektion, und derselbe
	// Klick-Handler bedient dadurch beide, ohne zu wissen, wo er gerade sitzt.
	//
	// Ohne Ortsreferenz kein Button: der Dialog fragt "Karte vorschlagen – <Ort>" und haenge den Vorschlag
	// genau dort an. Ohne Ort waere er ein Formular ins Nichts. Faellt heute nie an (alle vier Aufrufer
	// liefern einen Ort), aber der Zustand ist gueltig und darf nicht als kaputter Button erscheinen.
	var suggestButton = place
		? '<button type="button" class="avesmaps-citymaps__suggest"' + citymapPlaceAttrs(place, name) + '>'
			+ placeExtrasEscape(tr("cityMaps.suggest", "Karte vorschlagen")) + '</button>'
		: "";
	// Die Lizenz-Fussnote reist MIT den Covern, nicht hinter ihnen her: sie ist die Bedingung, unter der
	// wir sie ueberhaupt zeigen duerfen (Ulisses-Fanrichtlinien, NOTICE.md).
	var creditMarkup = cityMapsHaveVisibleCover(maps) ? avesmapsCitymapCreditMarkup() : "";
	return '<div class="avesmaps-citymaps"' + scopeAttr + placeAttr + '>'
		+ '<div class="avesmaps-citymaps__head">' + tr("cityMaps.headingIn", "Kartensammlung von {place}", { place: placeExtrasEscape(name) })
		+ ' <span class="avesmaps-citymaps__count">(' + placeExtrasEscape(maps.length) + ')</span></div>'
		+ '<div class="avesmaps-citymaps__scroll">' + cards + '</div>'
		+ '<div class="avesmaps-citymaps__actions">'
		+ '<button type="button" class="avesmaps-citymaps__all">' + placeExtrasEscape(tr("cityMaps.all", "Alle anzeigen")) + '</button>'
		+ suggestButton
		+ '</div>'
		+ creditMarkup
		+ '</div>';
}

// Die Pflichtangabe nur, wenn hier wirklich ein Verlagscover haengt (Owner-Regel + NOTICE.md). Praeziser
// als das Abenteuer-Vorbild, das allein seinen Killswitch fragt: dort HAT faktisch jedes Abenteuer ein
// Cover, hier haengt es an der Quelle -- eine Sammlung, deren Karten alle kein Seitenbild haben, zeigt
// nichts und braucht dann auch keinen Credit. Umgekehrt gilt es strikt: sobald EIN Cover sichtbar ist,
// steht die Angabe darunter.
function cityMapsHaveVisibleCover(maps) {
	for (var i = 0; i < (maps || []).length; i++) {
		if (cityMapSafeUrl(maps[i] && maps[i].thumb)) {
			return true;
		}
	}
	return false;
}

// Die vier data-Attribute, die einen Ort identifizieren -- an EINER Stelle, weil sie an drei sitzen: an der
// Sektion (dort liest der Dialog sie, wenn er seine Fussleiste baut) und an beiden Vorschlag-Buttons (dort
// liest sie der Klick-Handler). Auseinanderlaufende Kopien waeren ein Vorschlag am falschen Ort.
function citymapPlaceAttrs(place, fallbackName) {
	return ' data-citymap-place-kind="' + placeExtrasEscape(place.kind || "") + '"'
		+ ' data-citymap-place-name="' + placeExtrasEscape(place.name || fallbackName || "") + '"'
		+ ' data-citymap-place-id="' + placeExtrasEscape(place.publicId || "") + '"'
		+ ' data-citymap-place-key="' + placeExtrasEscape(place.wikiKey || "") + '"';
}

// Siedlung.
function buildPlaceCityMapsMarkup(location) {
	var maps = getPlaceCityMaps(location);
	if (!maps || !maps.length) {
		return "";
	}
	var placeName = (location && location.name) ? location.name : tr("cityMaps.fallbackPlace", "diesem Ort");
	return buildCityMapsSectionMarkup(placeName, maps, {
		place: {
			kind: "settlement",
			name: placeName,
			publicId: (location && (location.publicId || location.public_id)) || "",
		},
	});
}

// Territorium/Region-Polygon: die ueber den politischen Subtree aggregierten Karten. Nutzt den
// SERVER-wiki_key aus der territory-detail.php-Antwort -- NICHT aus wiki_url client-normalisiert: der
// Server-Slug (ö->oe) und der Client-Normalizer (ö->o) divergieren bei Umlauten (§3.9).
function buildTerritoryCityMapsMarkup(regionEntry) {
	if (typeof avesmapsCitymapCatalogIsReady !== "function" || !avesmapsCitymapCatalogIsReady()) {
		return "";
	}
	var name = (regionEntry && (regionEntry.displayName || regionEntry.name)) || tr("cityMaps.fallbackTerritory", "diesem Gebiet");
	var detail = (regionEntry && regionEntry.detail && regionEntry.detail.ok) ? regionEntry.detail : null;
	var wikiKey = detail ? (detail.wiki_key || "") : "";
	if (wikiKey) {
		var maps = getCityMapsForTerritory(wikiKey);
		return maps.length ? buildCityMapsSectionMarkup(name, maps, {
			territoryKey: wikiKey,
			// Der einzige Fall, der einen wiki_key mitschickt -- und zwar den SERVER-Key aus
			// territory-detail.php (oben aus detail.wiki_key gelesen), nie einen clientnormalisierten (§3.9).
			place: { kind: "territory", name: name, wikiKey: wikiKey },
		}) : "";
	}
	// Landscape region rendered as a POLYGON (no political territoryPublicId): maps assigned DIRECTLY to
	// this region, matched by its public_id.
	if (!regionEntry || regionEntry.territoryPublicId || typeof getCityMapsForRegion !== "function") {
		return "";
	}
	var regionMaps = getCityMapsForRegion(regionEntry);
	return regionMaps.length ? buildCityMapsSectionMarkup(name, regionMaps, {
		place: { kind: "region", name: name, publicId: regionEntry.publicId || regionEntry.public_id || "" },
	}) : "";
}

// Landschafts-Region-LABEL: die diesem Label direkt zugeordneten Karten, exakt ueber label.publicId.
function buildRegionCityMapsMarkup(label) {
	if (typeof avesmapsCitymapCatalogIsReady !== "function" || !avesmapsCitymapCatalogIsReady()) {
		return "";
	}
	if (typeof getCityMapsForRegion !== "function" || !label) {
		return "";
	}
	var maps = getCityMapsForRegion(label);
	if (!maps.length) {
		return "";
	}
	var name = (label.text || (label.wikiRegion && label.wikiRegion.name)) || tr("cityMaps.fallbackRegion", "dieser Region");
	return buildCityMapsSectionMarkup(name, maps, {
		place: { kind: "region", name: name, publicId: label.publicId || label.public_id || "" },
	});
}

// Weg/Fluss: Match primaer ueber die wiki_path-Namensgruppe (robust, da ein Weg aus vielen Segmenten
// besteht) + Segment-public_id.
function buildPathCityMapsMarkup(path) {
	if (typeof avesmapsCitymapCatalogIsReady !== "function" || !avesmapsCitymapCatalogIsReady()) {
		return "";
	}
	if (typeof getCityMapsForPath !== "function" || !path) {
		return "";
	}
	var wikiPath = (path.properties && path.properties.wiki_path) || null;
	var pathPublicId = (typeof getPathPublicId === "function") ? getPathPublicId(path) : (path.public_id || "");
	var maps = getCityMapsForPath({
		publicId: pathPublicId,
		wikiKey: (wikiPath && wikiPath.wiki_key) || "",
	});
	if (!maps.length) {
		return "";
	}
	var name = (typeof getPathDisplayName === "function") ? getPathDisplayName(path) : (path.name || tr("cityMaps.fallbackPath", "diesem Weg"));
	return buildCityMapsSectionMarkup(name, maps, {
		place: { kind: "path", name: name, publicId: pathPublicId },
	});
}

// ---- Kartensammlung-Dialog: Filterleiste + Zeile (Spec §3.7) --------------------------------------
// Dieselbe Grammatik wie die Abenteuerleiste (avesmapsFilterBarMarkup), eigene Gruppenliste. Ein Filter
// steht nur da, wenn avesmapsCitymapActiveFacets ihn fuer trennend haelt -- traegt nichts, kommt "" zurueck
// und der Dialog hat gar keine Leiste.
function citymapFiltersMarkup(facets) {
	facets = facets || {};
	var groups = [];
	if (facets.years) {
		groups.push({
			kind: "years", from: "yearFrom", to: "yearTo",
			label: tr("cityMaps.filter.period", "Zeitraum (BF)"),
			range: facets.yearRange || { min: 0, max: 0 },
			fromPlaceholder: tr("cityMaps.filter.from", "von"),
			toPlaceholder: tr("cityMaps.filter.to", "bis"),
		});
	}
	if (facets.color) { groups.push({ kind: "toggle", filter: "color", label: tr("cityMaps.filter.color", "farbig") }); }
	if (facets.official) { groups.push({ kind: "toggle", filter: "official", label: tr("cityMaps.filter.officialOnly", "offiziell") }); }
	if (facets.free) { groups.push({ kind: "toggle", filter: "free", label: tr("cityMaps.filter.freeOnly", "kostenlos") }); }
	// Kein Filter, sondern der Sammelschalter fuer den Spoiler-Deckel (Owner 2026-07-18): "aus" ist der
	// Startzustand -- er zeigt also nie ungefragt, was verdeckt ist -- und ein Klick nimmt den Blur von
	// ALLEN verdeckten Zeilen statt eine nach der anderen. Steht am Ende und darf die Leiste allein tragen.
	if (facets.spoiler) { groups.push({ kind: "toggle", filter: "spoiler", label: tr("cityMaps.filter.spoiler", "Spoiler (Spielinhalte)") }); }
	if (!groups.length) {
		return "";
	}
	return avesmapsFilterBarMarkup([{ kind: "label", text: tr("cityMaps.filter.label", "Filter") }].concat(groups));
}

// "1027–1045 BF" | "seit 1027 BF" | "bis 1045 BF" | "" -- leer heisst UNBEKANNT und faellt weg (§3.1:
// unbekannte Eigenschaften werden ausgelassen, nicht als "unbekannt" ausgeschrieben).
// 9999 ist das offene Ende (AGENTS.md §5) und wird als "seit …" gelesen, nicht als Jahreszahl gedruckt.
function cityMapValidityLabel(m) {
	var from = (m.valid_from_bf == null) ? null : Number(m.valid_from_bf);
	var to = (m.valid_to_bf == null || Number(m.valid_to_bf) === 9999) ? null : Number(m.valid_to_bf);
	if (from == null && to == null) {
		return "";
	}
	if (from != null && to != null) {
		return from + "–" + to + " BF";
	}
	if (from != null) {
		return tr("cityMaps.since", "seit {year} BF", { year: from });
	}
	return tr("cityMaps.until", "bis {year} BF", { year: to });
}

// Der Bandname ist die Identitaet eines Katalogeintrags: 86% der Titel sind die Formel
// "{Typ} von {Ort} ({Quelle})", und in einem Dialog namens "Kartensammlung von Gareth" ist alles daran
// redundant AUSSER der Klammer. sources[0].label kommt zuerst, weil es ein strukturiertes Feld mit 87%
// Abdeckung ist -- die Klammer ist geraten und nur der Rueckfall.
function cityMapBandLabel(m) {
	var sources = (m && m.sources) || [];
	for (var i = 0; i < sources.length; i++) {
		if (sources[i] && sources[i].label) {
			return String(sources[i].label);
		}
	}
	var title = String((m && m.title) || "").trim();
	if (title.charAt(title.length - 1) !== ")") {
		return title;
	}
	// Rueckwaerts bis zur BALANCIERENDEN Klammer, nicht bis zur ersten: "Umgebungskarte von Gareth
	// (Abenteuer Basis-Spiel (DSA3))" ist echt, und /\(([^)]*)\)$/ liefert dort "DSA3".
	var depth = 0;
	for (var j = title.length - 1; j >= 0; j--) {
		var ch = title.charAt(j);
		if (ch === ")") {
			depth++;
		} else if (ch === "(") {
			depth--;
			if (depth === 0) {
				return title.slice(j + 1, title.length - 1).trim() || title;
			}
		}
	}
	return title;
}

// Die muted Fortsetzung der Titelzeile. Typ und Ausfuehrung stehen hier, weil der Owner die Typ-GRUPPEN
// und die Ausfuehrungs-SPALTE gestrichen hat -- ohne beides hiessen vier der neun Gareth-Zeilen wortgleich
// "Herz des Reiches". Als Spalte weg, als Information da.
function cityMapRowSuffix(m) {
	var parts = [];
	if (m && m.types && m.types.length && typeof avesmapsCitymapTypeLabel === "function") {
		parts.push(m.types.map(avesmapsCitymapTypeLabel).join(" & "));
	}
	// is_color === false ist BEKANNT, nicht unbekannt -- es zu drucken ist die Anwendung von §3.1, nicht
	// ihr Bruch (dieselbe Begruendung wie bei "kostenlos"). Nur null faellt weg.
	if (m && m.is_color === true) {
		parts.push(tr("cityMaps.trait.color", "farbig"));
	} else if (m && m.is_color === false) {
		parts.push(tr("cityMaps.trait.greyscale", "schwarzweiß"));
	}
	return parts.join(" · ");
}

// Die Fakten der AUFGEKLAPPTEN Zeile. Kein Feld kommt neu dazu; sie bekommen nur Platz. Nur explizit
// bejahte Merkmale -- ein "nicht offiziell" hat niemand behauptet.
function cityMapRowFacts(m) {
	var parts = [];
	if (!m) {
		return parts;
	}
	if (m.art && typeof avesmapsCitymapArtLabel === "function") { parts.push(avesmapsCitymapArtLabel(m.art)); }
	if (m.is_official === true) { parts.push(tr("cityMaps.trait.official", "offiziell")); }
	if (m.is_labeled === true) { parts.push(tr("cityMaps.trait.labeled", "beschriftet")); }
	if (m.is_multilevel === true) { parts.push(tr("cityMaps.trait.multilevel", "mehrstöckig")); }
	// Wie die anderen: NUR das bejahte. Ein „ohne Maßstab" waere fuer den Leser ein Mangel, obwohl die
	// Wiki-Spalte schlicht „Nein" sagt -- und bei 24 von 230 Zeilen steht dort „Forum", also gar keine
	// Antwort. Der unlesbare Wert und ein ausgeschriebener Maßstab stehen beide sichtbar in der Notiz.
	if (m.has_scale === true) { parts.push(tr("cityMaps.trait.scale", "mit Maßstab")); }
	var validity = cityMapValidityLabel(m);
	if (validity) { parts.push(validity); }
	// Format steht NEBEN der Aufloesung, nicht statt ihr: sie messen dasselbe Blatt in verschiedenen
	// Einheiten (Zentimeter/DIN aus dem Wiki, Pixel aus einem Scan) und kollidieren praktisch nie --
	// width_px ist bei genau 1 von 419 Karten gefuellt.
	if (m.format) { parts.push(String(m.format)); }
	if (m.author) { parts.push(String(m.author)); }
	// Der Verlag steht NEBEN dem Urheber, nie an seiner Stelle: „Ulisses" hat den Band gedruckt, „Ina
	// Kramer" die Karte gezeichnet. Er traegt echte Information, weil er variiert (Fanpro / Schmidt Spiele
	// & Droemer Knaur / Ulisses), nicht ein Wort auf 419 Zeilen.
	if (m.publisher) { parts.push(String(m.publisher)); }
	if (m.width_px && m.height_px) { parts.push(m.width_px + " × " + m.height_px + " px"); }
	// note ist halbstrukturierter Sync-Output ("Format: A4 · Maßstab: 1:12.750.000") und traegt genau die
	// Fragen, die ein Nachschlagewerk beantworten soll. Eigene Spalten waeren richtig -- das ist ein
	// Datenprojekt, kein Design (Spec §6).
	if (m.note) { parts.push(String(m.note)); }
	return parts;
}

// Eine Karten-ZEILE im Dialog: zugeklappt einzeilig, per Klick animiert aufgeklappt (CSS, siehe
// place-extras.css). Grid 56px | minmax(0,1fr) | 148px.
//
// Traegt bewusst AUCH .avesmaps-citymaps__card: Filter und Spoiler-Reveal sind geteilte Handler, die auf
// diese Klasse zielen. Die abweichende Optik haengt an .avesmaps-citymap-row.
function buildCityMapRowMarkup(m) {
	var href = cityMapBestLink(m);
	var spoiler = cityMapIsSpoiler(m);
	var spoilerOverlay = spoiler
		? avesmapsSpoilerVeilMarkup(tr("cityMaps.spoilerReveal", "Spoiler (Spielinhalte)"))
		: "";
	var openAttrs = href
		? ' href="' + placeExtrasEscape(href) + '" target="_blank" rel="noopener"'
		: ' href="#" onclick="return false" aria-disabled="true"';

	var suffix = cityMapRowSuffix(m);
	var facts = cityMapRowFacts(m);
	var factsMarkup = '<div class="avesmaps-citymap-row__facts">'
		+ (facts.length ? placeExtrasEscape(facts.join(" · ")) : placeExtrasEscape(tr("cityMaps.noFacts", "Keine weiteren Angaben erfasst.")))
		+ '</div>';

	// Same link line as the adventure dialog now (Owner 2026-07-18): source-named labels, shared order,
	// and the reachability marker IS shown -- "(online)"/"(offline)" is useful reader info, not just
	// editor knowledge. advNormalizeLinks derives label/order/paywall from each URL's host.
	var linksMarkup = (m.links && m.links.length)
		? '<ul class="avesmaps-adv-row__links">' + advNormalizeLinks(m.links).map(function (link) {
			return advRowLinkMarkup(link);
		}).join("") + '</ul>'
		: '<span class="avesmaps-citymap-row__nolink">' + placeExtrasEscape(tr("cityMaps.noLink", "keine Fundstelle")) + '</span>';

	// "+ Neuer Fundort" traegt seine Karte selbst: der Melde-Dialog ist EINE wiederverwendete Huelle, eine
	// gemerkte Referenz waere beim zweiten Melden falsch. Sichtbar nur in der offenen Zeile (CSS).
	var addLink = m.public_id
		? '<button type="button" class="avesmaps-citymap-row__addlink"'
			+ ' data-citymap-id="' + placeExtrasEscape(m.public_id) + '"'
			+ ' data-citymap-title="' + placeExtrasEscape(m.title || "") + '">'
			+ placeExtrasEscape(tr("cityMaps.addFundort", "+ Neuer Fundort")) + '</button>'
		: "";

	// "Karte bearbeiten" (Owner 2026-07-18): springt DIREKT zu DIESER Karte im Editor. Ersetzt den
	// generischen "Sammlung bearbeiten" der Fusszeile -- der oeffnete nur die Sammlung und liess einen
	// die gerade offene Karte dort erneut suchen. Nur bei IS_EDIT_MODE (?edit=1), wie jede andere
	// Redakteursflaeche; durchgesetzt wird serverseitig (avesmapsRequireUserWithCapability).
	// EIGENE Klasse, NICHT addlink mitbenutzen: an .avesmaps-citymap-row__addlink haengt der
	// "Neuer Fundort"-Handler (citymaps-suggest.js) -- eine geteilte Klasse haette diesen Knopf den
	// Melde-Dialog oeffnen lassen. Die Optik teilt sich stattdessen die CSS-Regel (place-extras.css),
	// also weiterhin kein neuer Farb-/Radiuswert.
	var editLink = (m.public_id && typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE)
		? '<button type="button" class="avesmaps-citymap-row__editmap"'
			+ ' data-citymap-edit-id="' + placeExtrasEscape(m.public_id) + '">'
			+ placeExtrasEscape(tr("cityMaps.editMap", "Karte bearbeiten")) + '</button>'
		: "";

	return '<div class="avesmaps-citymaps__card avesmaps-citymap-row' + (spoiler ? " is-spoiler" : "") + '"' + cityMapDataAttributes(m) + '>'
		+ '<a class="avesmaps-citymap-row__thumb' + (cityMapSafeUrl(m.thumb) ? " has-img" : "") + '" data-spoiler-image' + openAttrs + ' title="' + placeExtrasEscape(m.title) + '">'
		+ cityMapThumbMarkup(m) + '</a>'
		+ '<div class="avesmaps-citymap-row__main">'
		+ '<div class="avesmaps-citymap-row__band">' + placeExtrasEscape(cityMapBandLabel(m))
		+ (suffix ? ' <span class="avesmaps-citymap-row__suffix">· ' + placeExtrasEscape(suffix) + '</span>' : "")
		+ '</div>'
		+ '<div class="avesmaps-citymap-row__detail"><div class="avesmaps-citymap-row__detail-inner">'
		+ factsMarkup + addLink + editLink
		+ '</div></div>'
		+ '</div>'
		+ '<div class="avesmaps-citymap-row__side">' + linksMarkup + '</div>'
		// Der Schleier liegt ueber der GANZEN Zeile, als direktes Kind -- wie bei der Kachel und beim
		// Abenteuer-Cover. Vorher steckte er im Thumb-Anker: dort traf ihn die Anzeige-Regel nicht (sie
		// verlangt ein direktes Kind), und selbst sichtbar waere er mitgeblurrt worden, weil er in einem
		// verschleierten Element sass -- Nebel ohne Label. Sein alter Zweck, den Klick vom Kartenlink
		// fernzuhalten, bleibt erfuellt: er deckt jetzt die ganze Zeile ab, nicht nur das Vorschaubild.
		+ spoilerOverlay
		+ '</div>';
}

// ---- eine Abenteuer-Karte (Cover A4 + Titel + Jahr + Typ) -- fuer beginnt/spielt-Streifen UND Dialog ----
// isPlay=true -> "spielt hier"-Karte: gleiche Zeile, initial verborgen (display:none), wird beim Umschalten
// per Fade + Rechts-Scroll freigegeben. data-role gruppiert die Sortierung (beginnt bleibt vor spielt).
// The shop/reference links for an adventure, in click PRIORITY order, highest first: Ulisses e-book ->
// F-Shop -> the wiki page -> Deutsche Nationalbibliothek (DNB LAST, it is a mere ISBN/title search).
//
// The SERVER list wins whenever the payload carries one (Spec §2.5): avesmapsAdventureLinks() in
// api/_internal/app/adventures.php is the single definition of that priority rule, it is what the
// linkchecker probes, and only its entries carry the checked `state` and the curated extras (§2.4).
// An EMPTY array is an answer ("this adventure has no identifiable link"), not a miss -- only a MISSING
// list falls through to the builder below, which is the placeholder path on a box without a backend.
// A link's TYPE -> display label + paywall flag + sort rank, so maps and adventures name AND order their
// links identically (Owner 2026-07-18). The type is known by KEY where the payload sets one (adventures:
// ulisses/fshop/wiki/dnb) and otherwise by the URL host (maps: the map_url points at the wiki, F-Shop or
// Ulisses). Ulisses e-book + F-Shop are paid; wiki + DNB are free. Anything unrecognised (a curated extra,
// a community link) keeps its given label, sorts last, and honours a manual is_paid.
function advLinkMeta(link) {
	var key = String((link && link.key) || "").toLowerCase();
	var u = String((link && link.url) || "");
	if (key === "ulisses" || /ulisses-ebooks\.de/i.test(u)) { return { label: "Ulisses eBook", paid: true, rank: 1 }; }
	if (key === "fshop" || /f-shop\.de/i.test(u)) { return { label: "F-Shop", paid: true, rank: 2 }; }
	if (key === "wiki" || /wiki-aventurica\.de/i.test(u)) { return { label: "Wiki Aventurica", paid: false, rank: 3 }; }
	if (key === "dnb" || /portal\.dnb\.de/i.test(u)) { return { label: "Dt. Nationalbibliothek", paid: false, rank: 4 }; }
	return { label: ((link && link.label && String(link.label).trim())) || "Link", paid: (link && link.is_paid === true), rank: 5 };
}

// Normalise a link list (from EITHER dialog) to the shared shape: label + paywall by type, the linkchecker
// `state` kept, sorted by rank. A curated extra keeps its own key so the linkchecker still tracks it.
function advNormalizeLinks(links) {
	var out = (links || []).map(function (link) {
		var info = advLinkMeta(link);
		return {
			key: link.key || info.label,
			label: info.label,
			url: link.url,
			state: link.state,
			is_paid: info.paid,
			rank: info.rank,
		};
	});
	out.sort(function (a, b) { return a.rank - b.rank; });
	return out;
}

// The reachability WORD + its colour class for the combined "(online, …)" note -- the word alone (no
// parentheses), so status and paywall share ONE bracket. Same states as avesmapsLinkStatusMarkup
// (js/app/link-status.js): online = green, dead = red, unchecked = neutral. null when unknown/empty.
function advLinkStatusWord(state) {
	var s = String(state == null ? "" : state).trim();
	if (s === "online") { return { word: tr("linkStatus.onlineWord", "online"), cls: "link-status--online" }; }
	if (s === "dead") { return { word: tr("linkStatus.offlineWord", "offline"), cls: "link-status--dead" }; }
	// "unbekannt", nicht "ungeprüft" (Owner 2026-07-18): der Zustand deckt ZWEI Faelle ab -- nie geprueft,
	// UND geprueft-aber-abgewiesen (401/403, s. state.php). "Ungeprueft" schoebe uns zu, was die Gegenstelle
	// tut. Der Zustandsschluessel + die CSS-Klasse bleiben `unchecked`: die benennen den GESPEICHERTEN
	// Zustand (API-Vertrag), nicht die Anzeige.
	if (s === "unchecked") { return { word: tr("linkStatus.unknownWord", "Status unbekannt"), cls: "link-status--unchecked" }; }
	return null;
}

function advShopLinks(a) {
	if (a && Array.isArray(a.links)) {
		return advNormalizeLinks(a.links);
	}
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
	return advNormalizeLinks(links);
}
// The single best link (highest available priority) the cover click opens. null only when nothing is known.
function advBestLink(a) {
	var links = advShopLinks(a);
	return links.length ? links[0] : null;
}

function buildAdventureCardMarkup(a, isPlay) {
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
	// "spielt hier" IST der Spoiler (Owner 2026-07-18): er steht jetzt da, nur verschleiert -- vorher war er
	// display:none, und der Leser erfuhr erst NACH dem Umschalten, welche Eintraege es ueberhaupt betrifft.
	// is-play bleibt der ROLLEN-Marker (data-role, Zaehler, Filter), is-spoiler ist der SCHUTZ-Zustand.
	var extraClass = isPlay ? " is-play is-spoiler" : "";
	var veil = isPlay ? avesmapsSpoilerVeilMarkup(tr("adventures.spoilerVeil", "Spoiler (spielt hier)")) : "";
	return '<div class="avesmaps-adv__card' + extraClass + '"' + advCardDataAttributes(a, isPlay) + '>'
		+ '<a class="avesmaps-adv__cover' + (a.cover ? " has-img" : "") + '" data-spoiler-image href="' + placeExtrasEscape(coverHref) + '" target="_blank" rel="noopener" title="' + placeExtrasEscape(coverTitle) + '">' + coverInner + '</a>'
		+ '<a class="avesmaps-adv__title" href="' + placeExtrasEscape(wikiUrl) + '" target="_blank" rel="noopener">' + placeExtrasEscape(a.title) + '</a>'
		+ metaLine
		+ typeLine
		+ containedLine
		+ veil
		+ '</div>';
}

// The data-* contract shared by the card AND the dialog row. The sort handler, the filter predicate and
// the beginnt/spielt toggle all read these attributes off whatever element they find, so card and row MUST
// stamp the identical set -- a row missing one would silently disable a control rather than break loudly.
// data-public-id is the row's link back into the catalog (see advDialogShapesFromSection).
function advCardDataAttributes(a, isPlay) {
	return ' data-role="' + (isPlay ? "play" : "start") + '"'
		+ ' data-public-id="' + placeExtrasEscape(a.public_id || "") + '"'
		+ ' data-year="' + (Number(a.year) || 0) + '"'
		+ ' data-type="' + placeExtrasEscape(a.type) + '"'
		+ ' data-title="' + placeExtrasEscape(a.title) + '"'
		+ ' data-complexity="' + placeExtrasEscape(a.complexity || "") + '"'
		+ ' data-genre="' + placeExtrasEscape(a.genre || "") + '"'
		+ ' data-edition="' + placeExtrasEscape(a.edition || "") + '"'
		+ ' data-official="' + (a.official ? "1" : "0") + '"';
}

// One link line in the row's right-hand column: the link + its checked-state marker (Spec §1.8). A dead
// link stays CLICKABLE on purpose -- our cache may be stale and the reader may still want to try -- so it
// is struck through and greyed rather than removed. Every one of these is off-site, hence the ↗ (§12).
//
// „(kostenpflichtig)" haengt an der ZEILE, weil is_paid am LINK haengt und nicht an der Karte: derselbe
// Band ist im F-Shop bezahlt und auf seiner Wiki-Seite frei (Mehrfachlink-Spec §2). Nur ein bekanntes JA
// wird gezeigt -- bei null steht da nichts, denn „unbekannt" ist eine gueltige Antwort und nie ein
// erfundenes „frei" (§3.1). Abenteuer-Links tragen kein is_paid und bleiben damit unveraendert.
//
// opts.showStatus === false laesst den Linkchecker-Marker weg. Die Kartensammlung nutzt das: (online) ist
// Redakteursinfo. Der Default bleibt an -- die beiden Abenteuerdialoge teilen sich diese Funktion, und ein
// stiller Wegfall dort waere eine Aenderung, die niemand bestellt hat.
function advRowLinkMarkup(link, opts) {
	var deadClass = (typeof avesmapsLinkStatusLinkClass === "function") ? avesmapsLinkStatusLinkClass(link.state) : "";
	var showStatus = !opts || opts.showStatus !== false;
	// Reachability WORD (coloured: online=green, offline=red, "Status unbekannt"=neutral) + "kostenpflichtig"
	// (neutral) share ONE bracket: "(online, kostenpflichtig)". The brackets/comma inherit the neutral
	// meta colour; only the status word is coloured.
	var parts = [];
	var status = showStatus ? advLinkStatusWord(link.state) : null;
	if (status) { parts.push('<span class="' + status.cls + '">' + placeExtrasEscape(status.word) + '</span>'); }
	if (link.is_paid === true) { parts.push(placeExtrasEscape(tr("cityMaps.link.paidWord", "kostenpflichtig"))); }
	var meta = parts.length ? ' <span class="avesmaps-adv-row__linkmeta">(' + parts.join(", ") + ')</span>' : "";
	return '<li class="avesmaps-adv-row__linkitem">'
		+ '<a class="avesmaps-adv-row__link' + deadClass + '" href="' + placeExtrasEscape(link.url) + '"'
		+ ' target="_blank" rel="noopener" title="' + placeExtrasEscape(link.url) + '">'
		+ placeExtrasEscape(link.label) + ' ↗</a>'
		+ meta
		+ '</li>';
}

// ---- eine Abenteuer-ZEILE (Dialog, Spec §2.3) ----------------------------------------------------
// Der Dialog zeigt Zeilen statt Kacheln: Grid 62px | minmax(0,1fr) | 196px -- links das A4-Thumb (weiter
// der PRIMAERLINK wie in der Kachel), Mitte Titel + Einordnung, rechts ALLE Links mit Status-Marker. Genau
// dafuer gibt es die Zeile: in eine 78px-Kachel passt keine Link-Spalte.
//
// Traegt bewusst AUCH .avesmaps-adv__card: Sortierung, Filter und der beginnt/spielt-Umschalter sind
// geteilte Handler, die auf diese Klasse + .is-play + .is-filtered-out zielen. So gilt fuer die Zeile
// automatisch dieselbe Steuerung wie fuer die Kachel; die abweichende Optik haengt an .avesmaps-adv-row.
function buildAdventureRowMarkup(a, isPlay) {
	var wikiUrl = a.url || ("https://de.wiki-aventurica.de/wiki/" + encodeURIComponent(a.title || ""));
	var links = advShopLinks(a);
	var best = links.length ? links[0] : null;
	var coverHref = (best && best.url) || wikiUrl;
	var coverTitle = best ? (best.label + ": " + (a.title || "")) : (a.title || "");
	var coverInner = a.cover
		? '<img class="avesmaps-adv__cover-img" src="' + placeExtrasEscape(a.cover) + '" alt="" loading="lazy">'
		: AVESMAPS_ADV_COVER_PH_SVG;

	// Erste Meta-Zeile: Edition · BF-Jahr · Produkttyp. In der Kachel steht der Typ eine Zeile tiefer --
	// die Zeile hat die Breite, alles drei nebeneinander zu tragen.
	var metaParts = [];
	if (a.edition) { metaParts.push(a.edition); }
	if (a.yearLabel) { metaParts.push(a.yearLabel); }
	if (a.type) { metaParts.push(a.type); }
	var metaLine = metaParts.length ? '<div class="avesmaps-adv-row__meta">' + placeExtrasEscape(metaParts.join(" · ")) + '</div>' : "";

	// Zweite Meta-Zeile: Genre · Komplexität -- in der Kachel gibt es sie gar nicht (kein Platz), im
	// Dialog filtert man danach, also gehoert sie sichtbar an die Zeile.
	var factParts = [];
	if (a.genre) { factParts.push(a.genre); }
	if (a.complexity) { factParts.push(a.complexity); }
	var factLine = factParts.length ? '<div class="avesmaps-adv-row__facts">' + placeExtrasEscape(factParts.join(" · ")) + '</div>' : "";

	var containedLine = a.containedIn
		? '<div class="avesmaps-adv-row__contained">' + placeExtrasEscape(tr("adventures.containedInPrefix", "enthalten in: ")) + placeExtrasEscape(a.containedIn) + '</div>'
		: "";
	var linksMarkup = links.length ? '<ul class="avesmaps-adv-row__links">' + links.map(function (link) {
		return advRowLinkMarkup(link);
	}).join("") + '</ul>' : "";

	var extraClass = isPlay ? " is-play is-spoiler" : "";
	var veil = isPlay ? avesmapsSpoilerVeilMarkup(tr("adventures.spoilerVeil", "Spoiler (spielt hier)")) : "";
	return '<div class="avesmaps-adv__card avesmaps-adv-row' + extraClass + '"' + advCardDataAttributes(a, isPlay) + '>'
		+ '<a class="avesmaps-adv-row__cover' + (a.cover ? " has-img" : "") + '" data-spoiler-image href="' + placeExtrasEscape(coverHref) + '" target="_blank" rel="noopener" title="' + placeExtrasEscape(coverTitle) + '">' + coverInner + '</a>'
		+ '<div class="avesmaps-adv-row__main">'
		+ '<a class="avesmaps-adv-row__title" href="' + placeExtrasEscape(wikiUrl) + '" target="_blank" rel="noopener">' + placeExtrasEscape(a.title) + '</a>'
		+ metaLine
		+ factLine
		+ containedLine
		+ '</div>'
		+ '<div class="avesmaps-adv-row__side">' + linksMarkup + '</div>'
		+ veil
		+ '</div>';
}

// Lizenz-Fussnote (Cover © Ulisses Spiele + F-Shop-Link): geteilt vom Streifen UND beiden "Alle anzeigen"-
// Dialogen (flacher Siedlungs-Dialog hier + verschachtelter Territorien-Dialog in map-features-adventures-
// dialog.js), damit die Pflichtangabe ueberall steht, wo Cover zu sehen sind. Suppressed wenn der Cover-
// Killswitch aus ist -- keine Cover auf dem Schirm heisst kein Ulisses-Credit noetig.
function avesmapsAdventureCreditMarkup() {
	var coversOn = (typeof avesmapsAdventuresCoversEnabled !== "function") || avesmapsAdventuresCoversEnabled();
	return coversOn ? '<div class="avesmaps-adv__credit">' + tr("adventures.credit", "Bilder © Ulisses Spiele bzw. der jeweiligen Rechteinhaber — <a href=\"https://www.f-shop.de/\" target=\"_blank\" rel=\"noopener\">im F-Shop ansehen ↗</a>") + '</div>' : "";
}

// Lizenz-Fussnote der Kartensammlung. Dieselbe Pflichtangabe wie bei den Abenteuern und derselbe
// GENERISCHE F-Shop-Link -- es gibt keinen pro Karte, 364 der 365 Karten-Links zeigen ins Wiki.
//
// EIGENE Funktion mit EIGENEM Schalter, obwohl der Text fast derselbe ist: die Erlaubnis gilt "nur bis auf
// Widerruf" (NOTICE.md), und dann will man Karten-Vorschauen abschalten koennen, ohne die Abenteuer-Cover
// zu verlieren. avesmapsAdventureCreditMarkup wiederzuverwenden haette die beiden Flaechen an einen
// Schalter gekettet, der nach der einen von beiden benannt ist.
//
// Fehlt der Schalter (aelterer Payload), zeigt die Fussnote TROTZDEM: bei einer Pflichtangabe ist "im
// Zweifel anzeigen" die richtige Richtung.
function avesmapsCitymapCreditMarkup() {
	var on = (typeof avesmapsCitymapPreviewsEnabled !== "function") || avesmapsCitymapPreviewsEnabled();
	return on ? '<div class="avesmaps-adv__credit">' + tr("cityMaps.credit", "Bilder © Ulisses Spiele bzw. der jeweiligen Rechteinhaber — <a href=\"https://www.f-shop.de/\" target=\"_blank\" rel=\"noopener\">im F-Shop ansehen ↗</a>") + '</div>' : "";
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
	// Kopf-Zaehler IMMER: seit der Umschalter ein blosser Spoiler-Schalter ist, hat "Beginnt hier" kein
	// eigenes Segment mehr, das seine Zahl tragen koennte (Owner 2026-07-18: "'Beginnt hier' schrumpft zur
	// Zahl im Kopf").
	var countMarkup = ' <span class="avesmaps-adv__count">(' + placeExtrasEscape(total) + ')</span>';

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

	// EIN Schalter unter der Sortierzeile, kein Umschalter mehr (Owner 2026-07-18): die spielt-Eintraege
	// stehen ohnehin da, nur verschleiert -- es gibt nichts umzuschalten, nur aufzudecken. Deshalb auch
	// kein role="tablist"/aria-selected mehr, sondern ein gedrueckter Zustand (aria-pressed).
	var togglesMarkup = hasPlay
		? '<div class="avesmaps-adv__modes">'
			+ '<button type="button" class="avesmaps-adv__mode" data-adv-mode="spoiler" aria-pressed="false">' + placeExtrasEscape(tr("adventures.mode.play", "Spoiler")) + ' <span class="avesmaps-adv__mode-note">' + placeExtrasEscape(tr("adventures.mode.playNote", "(spielt hier)")) + '</span> <span class="avesmaps-adv__mode-count">(' + placeExtrasEscape(play.length) + ')</span></button>'
			+ '</div>'
		: "";

	var noteMarkup = opts.placeholderNote ? '<div class="avesmaps-adv__placeholder">' + placeExtrasEscape(tr("adventures.placeholderNote", "Platzhalter · Cover temporär aus dem Wiki")) + '</div>' : "";
	// Rand-Fall: hier beginnt nichts, es wird aber gespielt -> Hinweis in der beginnt-Sicht.
	var emptyHint = (!hasBeginnt && hasPlay) ? '<div class="avesmaps-adv__empty" data-adv-empty>' + placeExtrasEscape(tr("adventures.emptyHint", "Hier beginnt kein Abenteuer.")) + '</div>' : "";

	// EIN Streifen, DURCHGEHEND sortiert (Owner 2026-07-18): ein Spoiler steht an seinem Sortierplatz
	// zwischen den anderen, nicht als Block am Ende. Die Anfangsreihenfolge MUSS der Default-Sortierung der
	// Sortierzeile entsprechen ("neueste zuerst", is-active) -- sonst springen die Karten beim ersten
	// Sortierklick, ohne dass sich die Sortierung geaendert haette.
	var cards = avesmapsSortAdventureEntries(
		(hasBeginnt ? beginnt.map(function (a) { return { a: a, isPlay: false }; }) : [])
			.concat(hasPlay ? play.map(function (a) { return { a: a, isPlay: true }; }) : [])
	).map(function (e) { return buildAdventureCardMarkup(e.a, e.isPlay); }).join("");
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

// Floating-Box-Kachel "Kartensammlung": die schlanke Siedlungs-Box zeigt KEINEN Kartenstreifen ->
// stattdessen ein Kachel-Button, der den Dialog oeffnet. Seit Aufgabe C echt verdrahtet (bis dahin eine
// dauerhaft deaktivierte Vorschau-Kachel).
//
// Immer eine Kachel rendern (Owner via Design-Session, wie bei "Abenteuer"): fehlen Karten -- oder ist der
// Katalog noch nicht geladen -- steht sie deaktiviert da, statt wegzufallen. So bleibt die Aktionsleiste
// stabil und springt nicht, wenn der Katalog nachlaedt.
function buildFloatingCityMapsButtonMarkup(location, publicId) {
	if (!publicId || typeof popupActionButtonMarkup !== "function") {
		return "";
	}
	var ready = typeof avesmapsCitymapCatalogIsReady === "function" && avesmapsCitymapCatalogIsReady();
	var maps = ready ? getPlaceCityMaps(location) : [];
	var attributes = { "data-citymaps-open-place": publicId };
	if (!maps.length) {
		attributes["aria-disabled"] = "true";
	}
	return popupActionButtonMarkup({
		// Weicher Trennstrich (U+00AD): unsichtbar, solange das Wort passt; bricht die 90px-Kachel sonst
		// sauber in zwei Zeilen statt zu ueberlaufen. Kein Eingriff in die geteilte hyphens:auto-Regel (die
		// ist bewusst nur fuer Fliesstext, nicht Buttons/Kacheln).
		label: tr("cityMaps.buttonLabel", "Karten­sammlung"),
		iconMarkup: '<img class="location-popup__action-img" src="img/menu/stadtkarte.webp" alt="" width="20" height="20" />',
		attributes: attributes,
	});
}

// ---- Filterleiste, geteilt von BEIDEN "Alle anzeigen"-Dialogen (Spec §2.2) ------------------------
// "Filter"-Label + Art-Chips (Mehrfachauswahl) + Divider + DSA-Version/Schwierigkeit/Genre als Selects +
// Zeitraum + Divider + "nur offiziell"-Chip. Nur Dimensionen, zu denen die aktuelle Menge ueberhaupt eine
// Facette hergibt -- ausser dem Zeitraum, der immer steht, damit das Feld auffindbar bleibt.
//
// Lag bis Aufgabe B zweimal fast identisch vor (dialogFiltersMarkup hier, filtersMarkup im Nested-Dialog):
// ~40 Zeilen, die bei jeder Filteraenderung an zwei Stellen nachgezogen werden mussten -- und genau eine
// davon wurde dann vergessen. Die .avesmaps-adv-tree__*-Klassen sind NICHT ancestor-scoped, deshalb traegt
// dieselbe Leiste in beiden Dialogen. Die Verdrahtung bleibt pro Dialog eigen (box-lokal vs. document).
//
// Seit Aufgabe C ist das hier nur noch die ABENTEUER-FORM: die Grammatik (Label / Chips / Trenner /
// Selects / Jahresspanne / Toggle) baut avesmapsFilterBarMarkup (js/ui/filter-bar.js), weil die
// Kartensammlung (§3.7) dieselbe Grammatik mit voellig anderen Dimensionen braucht. Das Markup ist
// unveraendert -- byte-gleich, abgesichert in js/ui/__tests__/filter-bar.test.js.
function advFiltersMarkup(facets) {
	facets = facets || {};
	return avesmapsFilterBarMarkup([
		{ kind: "label", text: tr("adventures.filter.label", "Filter") },
		// dividerAfter statt eines eigenen Trenner-Eintrags: ohne Art-Facette faellt der Trenner MIT den
		// Chips weg (sonst stuende eine Linie direkt hinter dem "Filter"-Label).
		{ kind: "chips", filter: "type", values: facets.types || [], dividerAfter: true },
		{ kind: "select", filter: "edition", placeholder: tr("adventures.filter.edition", "DSA-Version"), values: facets.editions },
		{ kind: "select", filter: "complexity", placeholder: tr("adventures.filter.complexity", "Schwierigkeit"), values: facets.complexities },
		{ kind: "select", filter: "genre", placeholder: tr("adventures.filter.genre", "Genre"), values: facets.genres },
		{
			kind: "years", from: "yearFrom", to: "yearTo",
			label: tr("adventures.filter.period", "Zeitraum (BF)"),
			range: facets.yearRange || { min: 0, max: 0 },
			fromPlaceholder: tr("adventures.filter.from", "von"),
			toPlaceholder: tr("adventures.filter.to", "bis"),
		},
		{ kind: "divider" },
		{ kind: "toggle", filter: "official", label: tr("adventures.filter.officialOnly", "nur offiziell") },
	]);
}

// ---- Interaktivitaet via Document-Delegation (funktioniert in Popup UND Panel) ----
(function initPlaceExtrasDelegation() {
	// Node (unit tests): nothing to bind, and touching `window` here would throw before the pure markup
	// builders above could ever be required. Same guard as map-features-adventures-dialog.js.
	if (typeof window === "undefined" || typeof document === "undefined") {
		return;
	}
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
	// Das ist die MAGERE Shape: sie kennt nur, was als Attribut am Element steht -- insbesondere KEINE Links.
	// Fuer die Dialogzeile wird sie deshalb nach Moeglichkeit durch die Katalog-Shape ersetzt (siehe unten).
	function cardShapeFromEl(card) {
		return {
			public_id: card.getAttribute("data-public-id") || "",
			title: card.getAttribute("data-title") || "",
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

	// Die Abenteuer einer Streifen-Section als VOLLE Katalog-Shapes (Spec §2.2: der flache Dialog wird
	// datengetrieben). Bis Aufgabe B klonte der Dialog die Streifenkarten -- aus einer 78px-Kachel laesst
	// sich aber keine Link-Spalte klonen, denn die Links stehen dort gar nicht im DOM.
	//
	// Der Streifen bleibt die Quelle der WELCHE-Frage (welche Abenteuer, in welcher Rolle): so koennen
	// Streifen und Dialog nie verschiedene Mengen zeigen. Den INHALT holt jede Zeile ueber ihre public_id
	// frisch aus dem Katalog -- dort haengen die Links samt geprueftem Status. Kein Katalog-Treffer
	// (Platzhalterdaten ohne Backend) -> die magere DOM-Shape, aus der advShopLinks clientseitig wieder
	// Wiki + DNB ableitet. Beide Wege liefern eine gueltige Zeile, nur die eine ohne Status-Marker.
	function advDialogShapesFromSection(section) {
		var listEl = section.querySelector(".avesmaps-adv__list");
		var cards = listEl ? listEl.querySelectorAll(".avesmaps-adv__card") : [];
		return Array.prototype.map.call(cards, function (card) {
			var fromCatalog = (typeof getAdventureShape === "function")
				? getAdventureShape(card.getAttribute("data-public-id"))
				: null;
			return {
				shape: fromCatalog || cardShapeFromEl(card),
				isPlay: card.classList.contains("is-play"),
			};
		});
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
			? '<div class="avesmaps-adv-dialog__modes">'
				+ '<button type="button" class="avesmaps-adv__mode" data-adv-mode="spoiler" aria-pressed="false">' + placeExtrasEscape(tr("adventures.mode.play", "Spoiler")) + ' <span class="avesmaps-adv__mode-note">' + placeExtrasEscape(tr("adventures.mode.playNote", "(spielt hier)")) + '</span> <span class="avesmaps-adv__mode-count" data-adv-count="play">(' + playCount + ')</span></button>'
				+ '</div>'
			: "";

		var cards = grid ? Array.prototype.slice.call(grid.querySelectorAll(".avesmaps-adv__card")) : [];
		var shapes = cards.map(cardShapeFromEl);
		var facets = (typeof avesmapsAdventureFacetOptions === "function")
			? avesmapsAdventureFacetOptions(shapes)
			: { types: [], complexities: [], genres: [], editions: [] };
		var filtersHtml = advFiltersMarkup(facets);

		controls.innerHTML = togglesHtml + filtersHtml + sortsHtml;
		box.insertBefore(controls, grid);

		var filterState = { types: new Set(), complexity: "", genre: "", edition: "", yearFrom: 0, yearTo: 0, officialOnly: false };

		function applyFilters() {
			// Nur noch der Spoiler-Zaehler: seit der Umschalter ein einzelner Schalter ist, gibt es kein
			// "Beginnt hier"-Segment mehr, das eine zweite Zahl tragen koennte.
			var visPlay = 0;
			cards.forEach(function (card) {
				var passes = dialogCardPasses(card, filterState);
				card.classList.toggle("is-filtered-out", !passes);
				if (passes && card.classList.contains("is-play")) { visPlay += 1; }
			});
			var cp = controls.querySelector('[data-adv-count="play"]');
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

	// Kern: den flachen Dialog aus einer .avesmaps-adv-SECTION befuellen und oeffnen. Genutzt vom
	// "Alle anzeigen"-Button (Streifen im Panel) UND vom Floating-Box-"Abenteuer"-Button (der die Section
	// on-demand aus den Ortsdaten baut -> openPlaceAdventuresDialog).
	//
	// Seit Aufgabe B datengetrieben (Spec §2.2): der Streifen sagt nur noch, WELCHE Abenteuer in welcher
	// Rolle gemeint sind; die Zeilen werden aus den Katalog-Shapes NEU gebaut, nicht aus den Kacheln
	// geklont. Erst dadurch gibt es ueberhaupt eine Link-Spalte -- die Links stehen in keiner Kachel.
	function openFlatDialogForSection(section) {
		if (!section) {
			return;
		}
		var overlay = ensureAdventuresDialog();
		var head = section.querySelector(".avesmaps-adv__head");
		overlay.querySelector(".avesmaps-adv-dialog__title").textContent = head ? head.textContent.trim() : tr("adventures.label", "Abenteuer");
		var entries = advDialogShapesFromSection(section);
		var startEntries = entries.filter(function (e) { return !e.isPlay; });
		var playEntries = entries.filter(function (e) { return e.isPlay; });
		var grid = overlay.querySelector(".avesmaps-adv-dialog__grid");
		grid.classList.remove("show-spoilers"); // Dialog startet verschleiert -- Spoiler sind bei jedem Oeffnen wieder zu
		// Durchgehend sortiert wie der Streifen -- Spoilerzeilen stehen an ihrem Platz, nicht als Block am
		// Ende. Dieselbe Hilfsfunktion, damit Streifen und Dialog nicht auseinanderlaufen koennen.
		grid.innerHTML = avesmapsSortAdventureEntries(
			entries.map(function (e) { return { a: e.shape, isPlay: e.isPlay }; })
		).map(function (e) { return buildAdventureRowMarkup(e.a, e.isPlay); }).join("");
		buildDialogControls(overlay, startEntries.length, playEntries.length);
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
		// DURCHGEHEND sortieren, ohne Rollen-Bloecke (Owner 2026-07-18). Die alte Invariante "beginnt bleibt
		// vor spielt" war keine inhaltliche Entscheidung, sondern eine Folge des Umschalters: der gab die
		// spielt-Karten per Fade frei und scrollte nach rechts zu ihnen, dafuer mussten sie hinten liegen.
		// Ohne Umschalter hat sie keinen Grund mehr -- die Spoiler stehen jetzt verschleiert an ihrem
		// Sortierplatz, mitten zwischen den anderen.
		var allCards = Array.prototype.slice.call(cardBox.querySelectorAll(".avesmaps-adv__card")).sort(compare);
		allCards.forEach(function (c) { cardBox.appendChild(c); });
		cardBox.scrollLeft = 0;
		// Aktiv-Zustand nur in der geklickten Sortierzeile (Streifen ODER Dialog).
		var sortsRow = $(this).closest(".avesmaps-adv__sorts")[0];
		var sorts = sortsRow ? sortsRow.querySelectorAll(".avesmaps-adv__sort") : [];
		for (var i = 0; i < sorts.length; i += 1) {
			sorts[i].classList.toggle("is-active", sorts[i] === this);
		}
	});

	// Sammelschalter: nimmt die Schleier ALLER Spoiler im Container weg -- oder legt sie zurueck.
	//
	// Das ersetzt den frueheren beginnt/spielt-Umschalter (Owner 2026-07-18). Der musste display umschalten,
	// einen Reflow erzwingen, per Fade ein- und ausblenden, nach rechts scrollen und die Karten nach 320 ms
	// wieder verstecken -- all das nur, um Eintraege zu verbergen, die jetzt schlicht dastehen. Uebrig
	// bleibt eine Container-Klasse.
	function applyAdventureSpoilers(cardBox, reveal) {
		if (!cardBox) {
			return;
		}
		cardBox.classList.toggle("show-spoilers", reveal);
	}

	// Ein Schalter, kein Umschalter: er hat kein Gegenstueck mehr, weil nichts mehr versteckt wird.
	// Streifen (Infopanel/Popup) und "Alle anzeigen"-Dialog teilen sich denselben Handler -- der Container
	// ist das Einzige, was sich unterscheidet.
	$(document).on("click", ".avesmaps-adv__modes .avesmaps-adv__mode, .avesmaps-adv-dialog__modes .avesmaps-adv__mode", function () {
		var reveal = !this.classList.contains("is-active");
		this.classList.toggle("is-active", reveal);
		this.setAttribute("aria-pressed", reveal ? "true" : "false");
		var overlay = $(this).closest(".avesmaps-adv-dialog")[0];
		var section = $(this).closest(".avesmaps-adv")[0];
		var cardBox = overlay
			? overlay.querySelector(".avesmaps-adv-dialog__grid")
			: (section ? section.querySelector(".avesmaps-adv__list") : null);
		applyAdventureSpoilers(cardBox, reveal);
	});
})();

// ---- exports -------------------------------------------------------------------------------------
// Node export of the PURE markup builders (inert in the browser, where index.html loads this as a plain
// script and everything above is a global). The delegation IIFE needs a DOM and is not exported.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		advShopLinks: advShopLinks,
		advBestLink: advBestLink,
		advFiltersMarkup: advFiltersMarkup,
		buildAdventureCardMarkup: buildAdventureCardMarkup,
		buildAdventureRowMarkup: buildAdventureRowMarkup,
		avesmapsSortAdventureEntries: avesmapsSortAdventureEntries,
		cityMapSafeUrl: cityMapSafeUrl,
		cityMapBestLink: cityMapBestLink,
		cityMapIsSpoiler: cityMapIsSpoiler,
		cityMapValidityLabel: cityMapValidityLabel,
		cityMapCardMarkup: cityMapCardMarkup,
		cityMapDataAttributes: cityMapDataAttributes,
		avesmapsCitymapCreditMarkup: avesmapsCitymapCreditMarkup,
		buildCityMapsSectionMarkup: buildCityMapsSectionMarkup,
		citymapFiltersMarkup: citymapFiltersMarkup,
		buildCityMapRowMarkup: buildCityMapRowMarkup,
		cityMapBandLabel: cityMapBandLabel,
		cityMapRowSuffix: cityMapRowSuffix,
		cityMapRowFacts: cityMapRowFacts,
		advRowLinkMarkup: advRowLinkMarkup,
	};
}

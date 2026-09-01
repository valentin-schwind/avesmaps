/*
 * Extracted location marker entry and popup helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

// Die Typzeile der Infobox: was fuer ein Ort ist das?
//
// Drei Stufen, absichtlich in dieser Reihenfolge:
//   1. location.placeKind  -- die vom Editor gesetzte Ortsart ("Brücke", "Oase", ...). Eigener
//      Wert schlaegt Wiki, dieselbe Vorrangregel wie bei Wappen und Abenteuer-Covern: jemand hat
//      hier bewusst hingeschaut, das Wiki hat nur abgeleitet.
//   2. wikiSettlement.building_type -- der aus dem Wiki gecrawlte Bauwerkstyp (Festung/Turm/…).
//   3. locationTypeLabel -- die Ortsgroesse, also „Dorf" oder „Besondere Bauwerke/Stätten".
//
// „(Ruine)" haengt hinten dran, wenn die Wiki-Siedlung als Ruine gilt -- Ruine ist bei uns ein
// eigenes Merkmal, keine Art. ⚠️ Absichtlich UNVERAENDERT gegenueber dem Stand vor 2026-08-03:
// der Zusatz haengt nur an einer Art (Stufe 1 oder 2), nie an der blossen Ortsgroesse, und er
// liest nur wikiSettlement.is_ruined, nicht das eigene is_ruined des Kartenpunkts. Beides waere
// vertretbar zu aendern -- aber nicht nebenbei in einem Commit, der die Typzeile umbaut.
//
// PURE: nimmt das location-Objekt, gibt einen String zurueck. Stand bis 2026-08-03 zweimal
// wortgleich inline (schwebende Box + Popup) -- die dritte Stufe waere die dritte Kopie gewesen.
function locationTypeLabelForDisplay(location) {
	if (!location) {
		return "";
	}
	const wikiSettlement = location.wikiSettlement;
	const placeKind = String(location.placeKind || "").trim();
	let label = String(location.locationTypeLabel || "");
	let carriesAKind = false;
	if (placeKind) {
		label = placeKind;
		carriesAKind = true;
	} else if (wikiSettlement && wikiSettlement.building_type) {
		label = String(wikiSettlement.building_type);
		carriesAKind = true;
	}
	// 🔴 DAS EIGENE FELD GEWINNT (Owner 15.08.2026: „die infobox soll auch das eigene feld lesen").
	// Bis dahin las diese Zeile NUR wikiSettlement.is_ruined -- am Livebestand trugen 70 Orte das
	// eigene Feld, 44 das aus dem Wiki, und 31 NUR das eigene: die sagten im Spotlight „Ruine" und in
	// der Infobox nichts, darunter „Ruine Khell Dairon". Dieselbe Vorrangregel wie bei Wappen und
	// Covern: jemand hat hier bewusst hingeschaut, das Wiki hat nur abgeleitet.
	// ⚠️ `carriesAKind` BLEIBT. „Dorf (Ruine)" stand nie da und soll nicht neu entstehen -- eine
	// zerfallene Siedlung ist immer noch eine Siedlung. Die 24 Ruinen ohne Art sagen es weiter ueber
	// die Statuszeile („Ruine oder zerstoert.") und die dritte Spotlight-Zeile.
	const istRuine = Boolean(location.isRuined) || Boolean(wikiSettlement && wikiSettlement.is_ruined);
	// 💣 EINE KLAMMER FUER BEIDE, mit demselben Trenner wie die dritte Spotlight-Zeile („Ruine ·
	// Verborgen"). Zwei Klammern hintereinander lesen sich wie zwei Aussagen ueber zwei Dinge.
	// ⚠️ Die beiden folgen ABSICHTLICH verschiedenen Regeln: „Ruine" haengt an einer Art (siehe oben),
	// „Verborgen" an keiner -- es beschreibt nicht, was der Ort IST, sondern wie die Karte mit ihm
	// umgeht, und das gilt fuer ein Dorf so gut wie fuer einen Turm.
	const zusaetze = [];
	// Die Gottheit macht aus „Tempel" ein „Rahja-Tempel" (Discord #54). Sie ist eine eigene Achse,
	// keine Ortsart -- deshalb tritt sie VOR das Label, statt es zu ersetzen.
	// 🔴 Sie steht NUR in der Registry (wiki_settlement), genau wie building_type darueber. Ein
	// eigenes properties-Feld waere eine zweite Wahrheit und Handarbeit fuer 775 Tempel.
	// Mehrwertig gespeichert („Ingerimm,Rondra") -- die Zeile nennt die erste.
	const deity = String((wikiSettlement && wikiSettlement.deity) || "").split(",")[0].trim();
	if (deity) {
		label = label ? deity + "-" + label : deity;
		// ⚠️ carriesAKind mitsetzen: die Ruinen-Regel darunter haengt „(Ruine)" nur an ein Label,
		// das wirklich eine Art nennt -- „Rahja-Tempel (Ruine)" ist genau so ein Fall.
		carriesAKind = true;
	}

	if (carriesAKind && istRuine && !/ruine/i.test(label)) {
		zusaetze.push(tr("popup.typeRuined", "Ruine"));
	}
	if (location.isHidden) {
		zusaetze.push(tr("popup.typeHidden", "Verborgen"));
	}
	return zusaetze.length ? `${label} (${zusaetze.join(" · ")})` : label;
}

// Baut den HTML-Inhalt des Marker-Popups (frisch erzeugbar, damit der Route-Button
// "hinzufügen"/"entfernen" den aktuellen Routenzustand widerspiegelt).
function buildLocationMarkerPopupHtml(markerEntry, opts) {
	// Floating box (infopanel mode): the SAME infobox as the panel but slimmed -- no "Publikationen"
	// tabs, no Stadtkarten/Abenteuer, reviews as a compact summary-link instead of the full list.
	const floating = Boolean(opts && opts.floating);
	if (markerEntry.locationType === CROSSING_LOCATION_TYPE) {
		return locationPopupMarkup({
			name: markerEntry.name,
			locationType: CROSSING_LOCATION_TYPE,
			locationTypeLabel: tr("locationType.crossing", "Kreuzung"),
			showHeaderIcon: false,
			showDescription: false,
			showWikiLink: false,
			actionsMarkup: crossingActionsMarkup(markerEntry.name, markerEntry.publicId),
		});
	}

	const wikiSettlement = markerEntry.location.wikiSettlement;
	const hasWikiSettlement = Boolean(wikiSettlement && wikiSettlement.title);
	// Multi-source system: ONE source line covers the wiki/other-source either-or that used to live
	// here -- rendered synchronously from the map-features payload (renderFeatureSourceLine in
	// js/ui/popups.js resolves this element's approved sources; no lazy fetch, no flash).
	// Floating box (Owner): drop the whole source line ("Quelle: Wiki …") -- it lives in the panel.
	const settlementSourceMarkup = (typeof renderFeatureSourceLine === "function" && !floating)
		? renderFeatureSourceLine("settlement", markerEntry.publicId, markerEntry.location.wikiUrl, "location-popup__wiki-link")
		: "";
	// Floating box (Owner, round 2): drop the ENTIRE attribute table too (no Einwohner/Oberhaupt/
	// Beschreibung/source) -- the floating box is just header + route/share actions + the rating row.
	// 💣 Fix-Runde 1 (Task 4b): OHNE Wiki-Artikel lief settlementWikiInfoboxMarkup nie -- und das ist
	// die EINZIGE Stelle, die Vorkommen (Waren/Fauna/Flora) und Klimazone abruft/rendert. Betraf live
	// 2.975 von 4.883 Siedlungen (61 %, gemessen), genau die Zielgruppe der Lebensraum-Regel. Der
	// Sonst-Zweig bekommt jetzt dieselben Zeilen ueber settlementLoreOnlyInfoboxMarkup, OHNE den
	// ganzen Wiki-Attributbauer aufzurufen (der wuerde eine leere Attributtabelle rendern).
	const settlementInfobox = floating
		? ""
		: (hasWikiSettlement
			? settlementWikiInfoboxMarkup(markerEntry.location, settlementSourceMarkup)
			: settlementLoreOnlyInfoboxMarkup(markerEntry.location, settlementSourceMarkup));
	// Header icon: the floating box shows the realistic settlement illustration by SIZE (Owner: "ersetze
	// das wappen durch die stadtgroesse"); everywhere else the coat of arms (only when public-domain/own).
	const coatIconMarkup = floating
		? (typeof settlementRealisticIconMarkup === "function" ? settlementRealisticIconMarkup(markerEntry.locationType, markerEntry.location.locationTypeLabel) : "")
		: (typeof settlementCoatIconMarkup === "function" ? settlementCoatIconMarkup(markerEntry.location.coat) : "");
	// Ortsart statt blosser Ortsgroesse als Unterüberschrift (Editor-Wert > Wiki > Groesse).
	const typeLabel = locationTypeLabelForDisplay(markerEntry.location);
	// Community-Bewertungen (Durchschnitt + letzte Bewertungen) ganz unten; wird beim Öffnen async geladen.
	const reviewsSlot = markerEntry.publicId
		? `<div class="location-reviews"${floating ? " data-reviews-compact=\"1\"" : ""} data-reviews-public-id="${escapeHtml(markerEntry.publicId)}" data-reviews-name="${escapeHtml(markerEntry.name)}"></div>`
		: "";
	// Place-Extras (Infopanel Phase 6): "Stadtkarten" + "Abenteuer in <Ort>" -- nur bei Wiki-Siedlungen UND
	// nur im Infopanel-Modus (rechtes Panel). Im schwebenden Default-Popup NICHT: "ohne Flag aendert sich
	// nichts" (infopanel-instruction) + schlanke Optik. Aktuell statische Platzhalter
	// (js/map-features/map-features-place-extras.js), spaeter echte Daten.
	let placeExtrasMarkup = "";
	if (hasWikiSettlement && !floating && typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE) {
		if (typeof buildPlaceCityMapsMarkup === "function") {
			placeExtrasMarkup += buildPlaceCityMapsMarkup(markerEntry.location);
		}
		if (typeof buildPlaceGameLiteratureMarkup === "function") {
			placeExtrasMarkup += buildPlaceGameLiteratureMarkup(markerEntry.location);
		}
	}
	// "Liegt in" breadcrumb (Owner Variante A): the full leaf -> root territory chain as gold fly-to links,
	// its own labelled section under the action buttons. Infopanel only (like Stadtkarten/Abenteuer) -- the
	// slim floating box AND the classic on-map popup stay compact (the header political line already carries
	// the primary relation there). Independent of the wiki settlement: the hierarchy is the stored ray-cast
	// territory assignment.
	const breadcrumbMarkup = (!floating
		&& typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE
		&& typeof buildSettlementHierarchyMarkup === "function"
		&& markerEntry.location && markerEntry.location.political)
		? buildSettlementHierarchyMarkup(markerEntry.location.political.hierarchy)
		: "";
	// Owner: the full (panel) settlement infobox gets the 16:9 header image (Metropole for now; more
	// settlement graphics to follow); the slim floating box keeps the realistic-size icon. In panel mode
	// locationPopupMarkup replaces the WHOLE icon+type header, so the political-context line (typeSuffixMarkup)
	// drops out here -- the "Liegt in" breadcrumb below already carries the territory chain.
	// Politischer Kontext ("Hauptstadt von X" / "in X" als Gold-Fly-to, sonst neutrales "Lage") EINMAL bauen
	// und BEIDE Kopf-Varianten damit speisen: den Bild-Header-Untertitel (Panel) und die type-Zeile der
	// schlanken Box (floating). So kehrt die Zeile zurueck, die der Bild-Header sonst verschluckte.
	const settlementTypeSuffix = (function () {
		var polLine = (typeof buildSettlementPoliticalLineMarkup === "function")
			? buildSettlementPoliticalLineMarkup(markerEntry.location.political)
			: "";
		return polLine || `<span class="location-popup__political-none">${escapeHtml(tr("popup.locationFallback", "Lage"))}</span>`;
	})();
	const settlementHeaderImg = (!floating && typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE && typeof infoHeaderImageMarkup === "function")
		? infoHeaderImageMarkup(settlementHeaderImageBasename(markerEntry.locationType), markerEntry.name, typeLabel,
			typeof settlementCoatIconMarkup === "function" ? settlementCoatIconMarkup(markerEntry.location.coat) : "",
			markerEntry.location.images, settlementTypeSuffix)
		: "";
	return locationPopupMarkup({
		name: markerEntry.name,
		locationType: markerEntry.locationType,
		locationTypeLabel: typeLabel,
		headerImageMarkup: settlementHeaderImg,
		headerIconMarkup: coatIconMarkup,
		description: markerEntry.location.description,
		wikiUrl: markerEntry.location.wikiUrl,
		isRuined: markerEntry.location.isRuined,
		// Das Kanon-Etikett unter Art und Herrschaft. ⚠️ Auch in der SCHLANKEN Box (weiter unten):
		// anders als die Quellenzeile, die der Owner dort ausdruecklich weggenommen hat („die lebt
		// im Panel"), ist das Etikett KEINE Quellenangabe, sondern eine Aussage ueber das OBJEKT --
		// wer einen Marker anklickt, soll „inoffiziell" sehen, ohne erst das Panel zu oeffnen.
		// Ein unbelegtes Objekt bekommt hier nichts: renderFeatureKanonBadge gibt "".
		kanonMarkup: typeof renderFeatureKanonBadge === "function"
			? renderFeatureKanonBadge("settlement", markerEntry.publicId) : "",
		showType: true,
		// Political context under the type ("Metropole · Hauptstadt des Kaiserreichs" / "Stadt · Baronie
		// Vierok"), a gold link that flies to that region. Resolved server-side. When nothing resolves, a
		// neutral non-link "Lage" placeholder stands in (Owner) so the type never sits alone.
		typeSuffixMarkup: settlementTypeSuffix,
		showDescription: !hasWikiSettlement,
		// Der alte Wiki-Credit ("Informationen aus dem Wiki Aventurica. Mehr hier ↗") entfällt -- die
		// neue Quell-Zeile (renderFeatureSourceLine) zeigt den Wiki-Link jetzt als "Quellen: …".
		showWikiLink: false,
		// Aktions-Buttons DIREKT unter den Kopf (Owner: "Buttons unter den Titel"), dann die Daten-Infobox,
		// dann Stadtkarten/Abenteuer, dann der Bewertungs-Bereich. In der schlanken Box ist settlementInfobox
		// leer -> dort stehen die Buttons ohnehin schon oben; im Panel wandern sie jetzt nach oben.
		// Floating box (Owner via Design-Session): "Abenteuer"- UND "Stadtkarten"-Kachel-Buttons in die
		// Aktionsleiste -- NUR in der schlanken Box (das rechte Panel zeigt den Abenteuer-Streifen ohnehin
		// inline). Beide sind IMMER sichtbar und stehen deaktiviert da, wenn nichts vorliegt (statt wegzufallen).
		actionsMarkup: locationActionsMarkup(markerEntry.name, markerEntry.publicId, markerEntry.location,
			floating
				? [
					typeof buildFloatingGameLiteratureButtonMarkup === "function" ? buildFloatingGameLiteratureButtonMarkup(markerEntry.location, markerEntry.publicId) : "",
					typeof buildFloatingCityMapsButtonMarkup === "function" ? buildFloatingCityMapsButtonMarkup(markerEntry.location, markerEntry.publicId) : "",
				]
				: [], { floating }) + breadcrumbMarkup + settlementInfobox + placeExtrasMarkup + reviewsSlot,
	});
}

// Schlanke Infobox (Owner-Vorgabe): Kopf (Wappen/Icon, Name, Typ) -> "Beschreibung" + Beschreibungstext
// -> Quell-Zeile -> Aktionen (Reiseziel hinzufügen/entfernen + Link teilen). OHNE Attribut-Tabelle,
// Abenteuer, Bewertungen, Stadtkarten. Wird im schwebenden Karten-Popup (Direktklick) UND im Hover-Popup
// der Wegpunkt-Icons gezeigt. Die Vollansicht bleibt dem rechten Panel vorbehalten.
function buildSlimLocationPopupHtml(markerEntry) {
	if (!markerEntry || markerEntry.locationType === CROSSING_LOCATION_TYPE) {
		return buildLocationMarkerPopupHtml(markerEntry);
	}
	const location = markerEntry.location;
	const typeLabel = locationTypeLabelForDisplay(location);
	const coatIconMarkup = typeof settlementCoatIconMarkup === "function" ? settlementCoatIconMarkup(location.coat) : "";
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine("settlement", markerEntry.publicId, location.wikiUrl, "location-popup__wiki-link")
		: "";
	const descBlock = location.description
		? `<div class="location-popup__desc-label">${escapeHtml(tr("popup.descriptionLabel", "Beschreibung"))}</div>`
			+ `<div class="location-popup__description">${escapeHtml(location.description)}</div>`
		: "";
	// Reiseziel hinzufuegen · Anzeigen · Link teilen (Owner 2026-07-18: die ersten beiden getauscht).
	// Die schwebende Wegpunkt-Infobox behaelt ihre Reihenfolge: dort steht an zweiter Stelle "Reiseziel
	// ENTFERNEN" -- eine destruktive Aktion, die nicht auf den ersten Platz gehoert. Gleiche Reihenfolge
	// waere hier also gerade nicht dasselbe.
	// "Anzeigen" (Sextant) oeffnet die VOLLE Info dieses Ortes im rechten Panel -- nur im Panel-Modus
	// sinnvoll (ohne Panel gaebe es kein Ziel).
	const actionButtons = [];
	actionButtons.push(routeToggleActionButtonMarkup(markerEntry.name));
	if (typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE) {
		actionButtons.push(popupActionButtonMarkup({
			label: tr("popup.showInPanel", "Anzeigen"),
			iconMarkup: '<img class="location-popup__action-img" src="icons/sextant.webp" alt="" width="20" height="20" />',
			attributes: { "data-popup-action": "show-in-panel", "data-place-name": markerEntry.name },
		}));
	}
	const shareButton = typeof sharePlaceActionButtonMarkup === "function"
		? sharePlaceActionButtonMarkup(markerEntry.publicId, { wikiUrl: location.wikiUrl || "", wikiParam: "siedlung" })
		: "";
	if (shareButton) {
		actionButtons.push(shareButton);
	}
	return locationPopupMarkup({
		name: markerEntry.name,
		locationType: markerEntry.locationType,
		locationTypeLabel: typeLabel,
		headerIconMarkup: coatIconMarkup,
		kanonMarkup: typeof renderFeatureKanonBadge === "function"
			? renderFeatureKanonBadge("settlement", markerEntry.publicId) : "",
		showType: true,
		showDescription: false,
		// Kopf-Trenner NUR wenn eine Beschreibung folgt -- sonst traegt die durchgehende Linie ueber der
		// Quelle/den Aktionen die Trennung (verhindert zwei direkt gestapelte Linien = Doppellinie).
		showDivider: Boolean(descBlock),
		showWikiLink: false,
		// Beschreibung + Quelle + Aktionen als ein Block nach dem Trenner.
		actionsMarkup: descBlock + sourceMarkup + locationPopupActionsMarkup(actionButtons),
	});
}

function refreshLocationMarkerPopup(markerEntry) {
	markerEntry.marker.setIcon(createLocationMarkerIcon(markerEntry.locationType));
	markerEntry.iconZoomLevel = map.getZoom();
	// Alle Nicht-Kreuzungs-Popups nutzen die settlement-popup-Optik (feste Breite + voll-breite Trenner
	// über Daten-Infobox, Quell-Zeile und Aktionen). Kreuzungen bleiben schlicht.
	const maxHeight = locationMarkerPopupMaxHeight();
	// In infopanel mode the bound popup is the slim FLOATING box (the panel holds the full info). Lazy
	// content so the slim variant is built up front -> no full-box flash before the popupopen handler runs.
	const infopanelMode = typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE;
	// Popup-Inhalt LAZY binden (Leaflet akzeptiert eine Content-Funktion): das HTML entsteht erst beim
	// Öffnen. Vorher wurde es hier für JEDEN Marker beim Start gebaut (~3000 × Infobox/Buttons/Bewertungs-
	// Markup) und beim Öffnen via popupopen ohnehin neu gesetzt -> reiner Startup-Ballast.
	// Kreuzungen bekamen hier lange NUR { maxHeight } -- "Kreuzungen bleiben schlicht" meinte den INHALT
	// (keine Datenbox, keine Bewertungen; das entscheidet buildLocationMarkerPopupHtml), traf aber die KISTE:
	// ohne "settlement-popup" bleibt .location-popup auf 260px gedeckelt, vier Kacheln brauchen ~384px --
	// also fielen die fuenf Editor-Aktionen untereinander (Owner-Meldung "haessliche schwebende Infobox").
	// Kein CSS setzt je flex-direction auf die Aktionsleiste; es war immer nur der fehlende Breiten-Anker
	// (dieselbe Diagnose wie 36ac9a2b bei den Kontinent-Labels). Jede schwebende Box bekommt jetzt dieselbe.
	markerEntry.marker.bindPopup(
		() => buildLocationMarkerPopupHtml(markerEntry, infopanelMode ? { floating: true } : undefined),
		{ minWidth: 320, maxWidth: 400, maxHeight, className: infopanelMode ? "settlement-popup floating-location-popup" : "settlement-popup" }
	);
	// Inhalt bei jedem Öffnen neu setzen -> Route-Button spiegelt den aktuellen Zustand
	// (Ort bereits Wegpunkt? -> "Reiseziel entfernen"). Nur EINMAL pro Marker binden.
	if (!markerEntry._routeAwarePopupBound) {
		markerEntry._routeAwarePopupBound = true;
		markerEntry.marker.on("popupopen", () => {
			// maxHeight an die aktuelle Kartenhöhe anpassen -> Popup scrollt statt am Rand abzuschneiden.
			const popup = markerEntry.marker.getPopup();
			if (popup && popup.options) {
				popup.options.maxHeight = locationMarkerPopupMaxHeight();
			}
			// Infopanel mode: the bound popup IS the slim FLOATING box (already slim from bindPopup, no
			// flash). Fill the right panel with the FULL info; leave the floating box OPEN on the map (Owner:
			// keep seeing WHERE the place is). Covers real DOM markers (edit mode); canvas dots go through the
			// click-arbiter. Reviews here are the compact summary-link variant (data-reviews-compact).
			if (infopanelMode && typeof window.avesmapsShowLocationInInfopanel === "function") {
				window.avesmapsShowLocationInInfopanel(markerEntry);
				if (typeof hydrateLocationReviews === "function") {
					const floatEl = popup && typeof popup.getElement === "function" ? popup.getElement() : null;
					if (floatEl) {
						hydrateLocationReviews(floatEl.querySelector(".location-reviews"));
					}
				}
				return;
			}
			markerEntry.marker.setPopupContent(buildLocationMarkerPopupHtml(markerEntry));
			// Bewertungen async nachladen (Durchschnitt + letzte Bewertungen).
			if (typeof hydrateLocationReviews === "function") {
				const popupEl = popup && typeof popup.getElement === "function" ? popup.getElement() : null;
				if (popupEl) {
					hydrateLocationReviews(popupEl.querySelector(".location-reviews"));
				}
			}
		});
	}
}

// Maximalhöhe des Orts-Popups = Kartenhöhe minus Rand -> Leaflet macht den Inhalt scrollbar,
// statt das Popup (und die Bewertungen unten) am Rand abzuschneiden.
function locationMarkerPopupMaxHeight() {
	const mapHeight = (typeof map !== "undefined" && map && typeof map.getSize === "function") ? map.getSize().y : 600;
	return Math.max(240, mapHeight - 90);
}

// Nur den ersten Satz der Wiki-Beschreibung — schneidet eingeschleppte Infobox-Reste
// ("Stadtteil= |Befestigung= …") hinter dem Satzende ab.
function settlementFirstSentence(text) {
	let value = String(text || "").replace(/\s+/g, " ").trim();
	// Leerzeichen vor Komma entfernen ("Punin , die" -> "Punin, die") — die Wiki-Extraktion
	// schleppt das oft ein (Link/Template hinterlaesst ein Leerzeichen vor dem Komma).
	value = value.replace(/ +,/g, ",");
	if (value === "") {
		return "";
	}
	const match = value.match(/^.*?[.!?](?=\s|$)/u);
	let sentence = (match ? match[0] : value).trim();
	// Sicherheitsnetz: falls kein sauberer Satzpunkt, ab erstem Template-Rest ("|" oder "Feld=") kappen.
	sentence = sentence.replace(/\s*[|}].*$/u, "").replace(/\s+[A-ZÄÖÜ][\wäöüß]*\s*=.*$/u, "").trim();
	if (sentence.length > 220) {
		sentence = sentence.slice(0, 220).trim() + " …";
	}
	return sentence;
}

// Siedlungen OHNE Wiki-Artikel (Fix-Runde 1, Task 4b): dieselben Vorkommen-/Klimazone-Zeilen wie
// settlementWikiInfoboxMarkup, aber OHNE dessen Wiki-Attributbauer -- der wuerde bei einer Siedlung
// ohne Wiki-Datensatz nur eine leere Attributtabelle rendern. Live betraf das 2.975 von 4.883
// Siedlungen (61 %) -- genau die Zielgruppe der Lebensraum-Regel, denn eine Regel greift nur, wo
// kein Wiki-Artikel die Vorkommen schon auflistet.
//
// 🔴 Reihenfolge Vorkommen -> Klimazone, dieselbe wie im Wiki-Zweig (Owner 2026-08-03: „Klimazone"
// steht direkt unter Flora, an allen vier Oberflaechen).
//
// Kommen BEIDE leer heraus (kein Vorkommen-Container -- z. B. weil der Ort nicht einmal eine
// public_id hat --, keine Klimazone bekannt), bleibt es beim heutigen Verhalten: die Quell-Zeile
// bzw. „Keine Quelle gefunden". Kein leerer Kasten.
//
// ⚠️ Steht mindestens eine Zeile da, wird NICHT mehr auf „Keine Quelle gefunden" zurueckgefallen --
// dieselbe Huelle wie settlementWikiInfoboxMarkup, die dort auch nur die rohe (ggf. leere)
// sourceMarkup anhaengt. Der Hinweis „keine Quelle" beschreibt die Quellenlage, nicht „nichts zu
// zeigen"; sobald die Regel Vorkommen liefert, ist da etwas zu zeigen.
function settlementLoreOnlyInfoboxMarkup(location, sourceMarkup = "") {
	let rows = "";
	// „Stätten": die besonderen Bauwerke IN diesem Ort — ÜBER den Vorkommen (Owner 2026-08-15:
	// „tu die stätten über Waren"). Sie gehören zum ORT wie Verkehrswege und Handelszone;
	// darunter folgt die Natur-Gruppe geschlossen, deren innere Ordnung („Klimazone DIREKT
	// unter Flora") damit unberührt bleibt.
	// ⭐ Synchron: die Liste reist im Kartenpayload mit (in_settlement_places), es wird nichts
	// nachgeladen — anders als Waren/Fauna/Flora, die auf api/app/lore.php warten.
	// 💣 Diese Zeile steht in BEIDEN Zweigen: settlementWikiInfoboxMarkup (Ort MIT Wikiartikel)
	// und settlementLoreOnlyInfoboxMarkup (Ort OHNE). Ein Bauwerk nennt seinen Standort im
	// eigenen Artikel — der Ort selbst braucht dafür keinen.
	if (typeof avesmapsStaettenRowMarkup === "function") {
		rows += avesmapsStaettenRowMarkup(location.name);
	}
	if (typeof buildLoreMarkup === "function" && typeof avesmapsLorePlaceRefFromLocation === "function") {
		rows += buildLoreMarkup(avesmapsLorePlaceRefFromLocation(location));
	}
	if (typeof avesmapsClimateRowForKey === "function") {
		rows += avesmapsClimateRowForKey(location.climateZone);
	}
	if (!rows) {
		return sourceMarkup || `<div class="location-popup__nowiki">${escapeHtml(tr("popup.noSource", "Keine Quelle gefunden"))}</div>`;
	}
	return (
		'<div class="region-info-box region-info-box--settlement">' +
		`<dl class="region-info-box__data">${rows}</dl>` +
		sourceMarkup +
		"</div>"
	);
}

// Infobox aus dem verbundenen Wiki-Siedlungs-Datensatz. Gleiche Struktur/Klassen wie die
// Herrschaftsgebiete-/Label-Infobox (.region-info-box) -> erbt deren Styles/Abstaende. Wappen
// nur bei nachweislich freier Lizenz (derzeit ausgeblendet, wie bei Regionen/Wegen).
function settlementWikiInfoboxMarkup(location, sourceMarkup = "", opts) {
	const floating = Boolean(opts && opts.floating);
	const wiki = location.wikiSettlement || {};
	const name = wiki.name || location.name || "";
	const art = String(wiki.art || "").trim();
	const row = (dtLabel, value) => {
		if (!value || String(value).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${escapeHtml(value)}</dd></div>`;
	};

	let rows = "";
	// Reihenfolge (Owner): Beschreibung zuerst, dann Oberhaupt, Einwohner, Handelszone, Verkehrswege;
	// die selten befuellten Felder (Bevoelkerung ~2%, Tempel ~0%) ans Ende. row() unterdrueckt leere Werte.
	// Floating box: KEINE Beschreibungszeile (Owner) -- die schlanke Box zeigt sie separat als eigenen Block.
	if (!floating) {
		rows += row(tr("popup.fieldDescription", "Beschreibung"), settlementFirstSentence(wiki.description));
	}
	rows += row(tr("popup.fieldRuler", "Oberhaupt"), wiki.oberhaupt);
	rows += row(tr("popup.fieldInhabitants", "Einwohner"), wiki.einwohner);
	// Wieder aufgenommen (Owner) -- in ce8e796f "entschlackt", aber projektweit haeufig befuellt
	// (Handelszone 62%, Verkehrswege 58%); die Daten reisen ohnehin im Payload mit.
	// Verkehrswege anklickbar: die Namen werden gegen die geladenen Wege aufgelöst, ein
	// Klick springt zur Straße auf der Karte. Nicht über row(), weil das den Wert
	// escaped -- avesmapsTrafficRoutesMarkup escaped selbst und liefert fertiges HTML.
	// Ohne die Datei (typeof-Guard) bleibt es die alte Textzeile.
	if (typeof avesmapsTrafficRoutesMarkup === "function" && String(wiki.verkehrswege || "").trim() !== "") {
		rows += '<div class="region-info-box__row"><dt>'
			+ escapeHtml(tr("popup.fieldTrafficRoutes", "Verkehrswege")) + "</dt><dd>"
			+ avesmapsTrafficRoutesMarkup(wiki.verkehrswege, wiki.verkehrswege_links) + "</dd></div>";
	} else {
		rows += row(tr("popup.fieldTrafficRoutes", "Verkehrswege"), wiki.verkehrswege);
	}
	// Handelszone NACH den Verkehrswegen (Owner 2026-07-21): beide beschreiben, wie der
	// Ort am Handel hängt, und die Wege sind das Konkretere -- die Zone ordnet ein.
	rows += row(tr("popup.fieldTradeZone", "Handelszone"), wiki.handelszone);
	rows += row(tr("popup.fieldPopulation", "Bevölkerung"), wiki.bevoelkerung);
	rows += row(tr("popup.fieldTemples", "Tempel"), wiki.tempel);
	// „Stätten": die besonderen Bauwerke IN diesem Ort — ÜBER den Vorkommen (Owner 2026-08-15:
	// „tu die stätten über Waren"). Sie gehören zum ORT wie Verkehrswege und Handelszone;
	// darunter folgt die Natur-Gruppe geschlossen, deren innere Ordnung („Klimazone DIREKT
	// unter Flora") damit unberührt bleibt.
	// ⭐ Synchron: die Liste reist im Kartenpayload mit (in_settlement_places), es wird nichts
	// nachgeladen — anders als Waren/Fauna/Flora, die auf api/app/lore.php warten.
	// 💣 Diese Zeile steht in BEIDEN Zweigen: settlementWikiInfoboxMarkup (Ort MIT Wikiartikel)
	// und settlementLoreOnlyInfoboxMarkup (Ort OHNE). Ein Bauwerk nennt seinen Standort im
	// eigenen Artikel — der Ort selbst braucht dafür keinen.
	if (typeof avesmapsStaettenRowMarkup === "function") {
		rows += avesmapsStaettenRowMarkup(location.name);
	}
	// Waren / Fauna / Flora / Spezies als eigene Zeilen (Owner). Der Container kommt
	// leer und füllt sich, sobald api/app/lore.php geantwortet hat -- die Siedlung
	// erreicht ihre Gegend über das Territorium aus dem Raycast, weil sie selbst kein
	// Region-Feld trägt.
	if (typeof buildLoreMarkup === "function" && typeof avesmapsLorePlaceRefFromLocation === "function") {
		rows += buildLoreMarkup(avesmapsLorePlaceRefFromLocation(location));
	}
	// „Klimazone" DIREKT unter Flora (Owner 2026-08-03). Anders als die Lore-Zeilen darüber ist sie
	// synchron da: die Zone reist im Kartenpayload mit, es gibt nichts nachzuladen.
	if (typeof avesmapsClimateRowForKey === "function") {
		rows += avesmapsClimateRowForKey(location.climateZone);
	}

	// Kein Kopf/Name/Art hier — der Popup-Kopf zeigt Name + Größe bereits (sonst Dopplung/Strich).
	// Quellen-Zeile: der Aufrufer (buildLocationMarkerPopupHtml) reicht die fertige
	// renderFeatureSourceLine-Quell-Zeile durch (Multi-source system).
	return (
		'<div class="region-info-box region-info-box--settlement">' +
		`<dl class="region-info-box__data">${rows}</dl>` +
		sourceMarkup +
		"</div>"
	);
}

function refreshAllLocationMarkerPopups() {
	locationMarkers.forEach((markerEntry) => refreshLocationMarkerPopup(markerEntry));
}

function createEditablePointMarkerEntry(location) {
	const marker = L.marker(location.coordinates, {
		icon: createLocationMarkerIcon(location.locationType),
		pane: "locationsPane",
		keyboard: true,
		draggable: false,
	});
	const markerEntry = {
		marker,
		locationType: location.locationType,
		name: location.name,
		publicId: location.publicId,
		location,
	};
	marker.on("dragend", async () => {
		const saveSucceeded = await saveMovedLocationMarker(markerEntry, marker.getLatLng());
		if (!saveSucceeded && activeLocationEdit?.originalLatLng) {
			marker.setLatLng(activeLocationEdit.originalLatLng);
			syncLocationNameLabelVisibility();
		}
		setLocationEditActive(markerEntry, false);
	});
	refreshLocationMarkerPopup(markerEntry);
	return markerEntry;
}


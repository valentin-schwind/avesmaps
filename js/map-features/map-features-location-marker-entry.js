/*
 * Extracted location marker entry and popup helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

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
	const settlementInfobox = floating
		? ""
		: (hasWikiSettlement
			? settlementWikiInfoboxMarkup(markerEntry.location, settlementSourceMarkup)
			: (settlementSourceMarkup || `<div class="location-popup__nowiki">${escapeHtml(tr("popup.noSource", "Keine Quelle gefunden"))}</div>`));
	// Header icon: the floating box shows the realistic settlement illustration by SIZE (Owner: "ersetze
	// das wappen durch die stadtgroesse"); everywhere else the coat of arms (only when public-domain/own).
	const coatIconMarkup = floating
		? (typeof settlementRealisticIconMarkup === "function" ? settlementRealisticIconMarkup(markerEntry.locationType, markerEntry.location.locationTypeLabel) : "")
		: (typeof settlementCoatIconMarkup === "function" ? settlementCoatIconMarkup(markerEntry.location.coat) : "");
	// Bauwerke: genauer Typ (Festung/Turm/…) als Unterüberschrift statt „Besondere Bauwerke/Stätten".
	let typeLabel = markerEntry.location.locationTypeLabel;
	if (wikiSettlement && wikiSettlement.building_type) {
		typeLabel = String(wikiSettlement.building_type);
		if (wikiSettlement.is_ruined && !/ruine/i.test(typeLabel)) {
			typeLabel += " (Ruine)";
		}
	}
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
		if (typeof buildPlaceAdventuresMarkup === "function") {
			placeExtrasMarkup += buildPlaceAdventuresMarkup(markerEntry.location);
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
	return locationPopupMarkup({
		name: markerEntry.name,
		locationType: markerEntry.locationType,
		locationTypeLabel: typeLabel,
		headerIconMarkup: coatIconMarkup,
		description: markerEntry.location.description,
		wikiUrl: markerEntry.location.wikiUrl,
		isRuined: markerEntry.location.isRuined,
		showType: true,
		// Political context under the type ("Metropole · Hauptstadt des Kaiserreichs" / "Stadt · Baronie
		// Vierok"), a gold link that flies to that region. Resolved server-side. When nothing resolves, a
		// neutral non-link "Lage" placeholder stands in (Owner) so the type never sits alone.
		typeSuffixMarkup: (function () {
			var polLine = (typeof buildSettlementPoliticalLineMarkup === "function")
				? buildSettlementPoliticalLineMarkup(markerEntry.location.political)
				: "";
			return polLine || `<span class="location-popup__political-none">${escapeHtml(tr("popup.locationFallback", "Lage"))}</span>`;
		})(),
		showDescription: !hasWikiSettlement,
		// Der alte Wiki-Credit ("Informationen aus dem Wiki Aventurica. Mehr hier ↗") entfällt -- die
		// neue Quell-Zeile (renderFeatureSourceLine) zeigt den Wiki-Link jetzt als "Quellen: …".
		showWikiLink: false,
		// Aktions-Buttons DIREKT unter den Kopf (Owner: "Buttons unter den Titel"), dann die Daten-Infobox,
		// dann Stadtkarten/Abenteuer, dann der Bewertungs-Bereich. In der schlanken Box ist settlementInfobox
		// leer -> dort stehen die Buttons ohnehin schon oben; im Panel wandern sie jetzt nach oben.
		actionsMarkup: locationActionsMarkup(markerEntry.name, markerEntry.publicId, markerEntry.location) + breadcrumbMarkup + settlementInfobox + placeExtrasMarkup + reviewsSlot,
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
	const wikiSettlement = location.wikiSettlement;
	let typeLabel = location.locationTypeLabel;
	if (wikiSettlement && wikiSettlement.building_type) {
		typeLabel = String(wikiSettlement.building_type);
		if (wikiSettlement.is_ruined && !/ruine/i.test(typeLabel)) {
			typeLabel += " (Ruine)";
		}
	}
	const coatIconMarkup = typeof settlementCoatIconMarkup === "function" ? settlementCoatIconMarkup(location.coat) : "";
	const sourceMarkup = typeof renderFeatureSourceLine === "function"
		? renderFeatureSourceLine("settlement", markerEntry.publicId, location.wikiUrl, "location-popup__wiki-link")
		: "";
	const descBlock = location.description
		? `<div class="location-popup__desc-label">${escapeHtml(tr("popup.descriptionLabel", "Beschreibung"))}</div>`
			+ `<div class="location-popup__description">${escapeHtml(location.description)}</div>`
		: "";
	const actionButtons = [routeToggleActionButtonMarkup(markerEntry.name)];
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
	const isCrossingPopup = markerEntry.locationType === CROSSING_LOCATION_TYPE;
	const maxHeight = locationMarkerPopupMaxHeight();
	// In infopanel mode the bound popup is the slim FLOATING box (the panel holds the full info). Lazy
	// content so the slim variant is built up front -> no full-box flash before the popupopen handler runs.
	const infopanelMode = typeof IS_INFOPANEL_MODE !== "undefined" && IS_INFOPANEL_MODE;
	// Popup-Inhalt LAZY binden (Leaflet akzeptiert eine Content-Funktion): das HTML entsteht erst beim
	// Öffnen. Vorher wurde es hier für JEDEN Marker beim Start gebaut (~3000 × Infobox/Buttons/Bewertungs-
	// Markup) und beim Öffnen via popupopen ohnehin neu gesetzt -> reiner Startup-Ballast.
	markerEntry.marker.bindPopup(
		() => buildLocationMarkerPopupHtml(markerEntry, infopanelMode ? { floating: true } : undefined),
		isCrossingPopup
			? { maxHeight }
			: { minWidth: 320, maxWidth: 400, maxHeight, className: infopanelMode ? "settlement-popup floating-location-popup" : "settlement-popup" }
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
	rows += row(tr("popup.fieldInhabitants", "Einwohner"), wiki.einwohner);
	rows += row(tr("popup.fieldRuler", "Oberhaupt"), wiki.oberhaupt);
	rows += row(tr("popup.fieldPopulation", "Bevölkerung"), wiki.bevoelkerung);
	if (wiki.tempel) {
		rows += row(tr("popup.fieldTemples", "Tempel"), wiki.tempel);
	}
	// Floating box: drop the description row (Owner) -- it's in the panel.
	if (!floating) {
		rows += row(tr("popup.fieldDescription", "Beschreibung"), settlementFirstSentence(wiki.description));
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


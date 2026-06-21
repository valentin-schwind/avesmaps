/*
 * Extracted location marker entry and popup helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

// Baut den HTML-Inhalt des Marker-Popups (frisch erzeugbar, damit der Route-Button
// "hinzufügen"/"entfernen" den aktuellen Routenzustand widerspiegelt).
function buildLocationMarkerPopupHtml(markerEntry) {
	if (markerEntry.locationType === CROSSING_LOCATION_TYPE) {
		return locationPopupMarkup({
			name: markerEntry.name,
			locationType: CROSSING_LOCATION_TYPE,
			locationTypeLabel: "Kreuzung",
			showHeaderIcon: false,
			showDescription: false,
			showWikiLink: false,
			actionsMarkup: crossingActionsMarkup(markerEntry.name, markerEntry.publicId),
		});
	}

	const wikiSettlement = markerEntry.location.wikiSettlement;
	const hasWikiSettlement = Boolean(wikiSettlement && wikiSettlement.title);
	const settlementInfobox = hasWikiSettlement
		? settlementWikiInfoboxMarkup(markerEntry.location)
		: '<div class="location-popup__nowiki">Kein Wiki-Eintrag gefunden</div>';
	// Wappen ersetzt das Siedlungs-Icon (nur gesetzt, wenn gemeinfrei/eigen).
	const coatIconMarkup = typeof settlementCoatIconMarkup === "function" ? settlementCoatIconMarkup(markerEntry.location.coat) : "";
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
		? `<div class="location-reviews" data-reviews-public-id="${escapeHtml(markerEntry.publicId)}" data-reviews-name="${escapeHtml(markerEntry.name)}"></div>`
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
		showDescription: !hasWikiSettlement,
		showWikiLink: !hasWikiSettlement,
		// Infobox zuerst, Aktions-Buttons, dann der Bewertungs-Bereich.
		actionsMarkup: settlementInfobox + locationActionsMarkup(markerEntry.name, markerEntry.publicId, markerEntry.location) + reviewsSlot,
	});
}

function refreshLocationMarkerPopup(markerEntry) {
	markerEntry.marker.setIcon(createLocationMarkerIcon(markerEntry.locationType));
	markerEntry.iconZoomLevel = map.getZoom();
	const hasWikiSettlement = markerEntry.locationType !== CROSSING_LOCATION_TYPE
		&& Boolean(markerEntry.location.wikiSettlement && markerEntry.location.wikiSettlement.title);
	const maxHeight = locationMarkerPopupMaxHeight();
	// Popup-Inhalt LAZY binden (Leaflet akzeptiert eine Content-Funktion): das HTML entsteht erst beim
	// Öffnen. Vorher wurde es hier für JEDEN Marker beim Start gebaut (~3000 × Infobox/Buttons/Bewertungs-
	// Markup) und beim Öffnen via popupopen ohnehin neu gesetzt -> reiner Startup-Ballast.
	markerEntry.marker.bindPopup(
		() => buildLocationMarkerPopupHtml(markerEntry),
		hasWikiSettlement
			? { minWidth: 320, maxWidth: 400, maxHeight, className: "settlement-popup" }
			: { maxHeight }
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
function settlementWikiInfoboxMarkup(location) {
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
	rows += row(tr("popup.fieldDescription", "Beschreibung"), settlementFirstSentence(wiki.description));
	const wikiLink = wiki.wiki_url
		? `<a class="region-info-box__link" href="${escapeHtml(wiki.wiki_url)}" target="_blank" rel="noopener">${escapeHtml(name)} ${escapeHtml(tr("popup.wikiLinkSuffixArrow", "im Wiki-Aventurica ↗"))}</a>`
		: "";

	// Kein Kopf/Name/Art hier — der Popup-Kopf zeigt Name + Größe bereits (sonst Dopplung/Strich).
	return (
		'<div class="region-info-box region-info-box--settlement">' +
		`<dl class="region-info-box__data">${rows}</dl>` +
		wikiLink +
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


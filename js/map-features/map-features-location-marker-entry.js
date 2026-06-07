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
		// Infobox zuerst, Aktions-Buttons darunter.
		actionsMarkup: settlementInfobox + locationActionsMarkup(markerEntry.name, markerEntry.publicId, markerEntry.location),
	});
}

function refreshLocationMarkerPopup(markerEntry) {
	markerEntry.marker.setIcon(createLocationMarkerIcon(markerEntry.locationType));
	const hasWikiSettlement = markerEntry.locationType !== CROSSING_LOCATION_TYPE
		&& Boolean(markerEntry.location.wikiSettlement && markerEntry.location.wikiSettlement.title);
	markerEntry.marker.bindPopup(
		buildLocationMarkerPopupHtml(markerEntry),
		hasWikiSettlement ? { minWidth: 320, maxWidth: 400, className: "settlement-popup" } : undefined
	);
	// Inhalt bei jedem Öffnen neu setzen -> Route-Button spiegelt den aktuellen Zustand
	// (Ort bereits Wegpunkt? -> "Aus Route entfernen"). Nur EINMAL pro Marker binden.
	if (!markerEntry._routeAwarePopupBound) {
		markerEntry._routeAwarePopupBound = true;
		markerEntry.marker.on("popupopen", () => {
			markerEntry.marker.setPopupContent(buildLocationMarkerPopupHtml(markerEntry));
		});
	}
}

// Nur den ersten Satz der Wiki-Beschreibung — schneidet eingeschleppte Infobox-Reste
// ("Stadtteil= |Befestigung= …") hinter dem Satzende ab.
function settlementFirstSentence(text) {
	let value = String(text || "").replace(/\s+/g, " ").trim();
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

	// Verkehrswege in ein inertes <a> wickeln: iOS/Android-Data-Detectors lassen den Inhalt von
	// Links in Ruhe (keine Google/Apple-Maps-Verlinkung) — es ist aber NICHT klickbar und macht
	// nichts (CSS pointer-events:none, kein Link-Look).
	const wayValue = String(wiki.verkehrswege || "").trim();
	const waysHtml = wayValue ? `<a class="region-info-box__plain" href="#">${escapeHtml(wayValue)}</a>` : "";

	let rows = "";
	rows += row("Einwohner", wiki.einwohner);
	rows += row("Lage", wiki.lage);
	rows += row("Oberhaupt", wiki.oberhaupt);
	rows += row("Bevölkerung", wiki.bevoelkerung);
	rows += row("Handelszone", wiki.handelszone);
	if (waysHtml) {
		rows += `<div class="region-info-box__row"><dt>Verkehrswege</dt><dd>${waysHtml}</dd></div>`;
	}
	if (wiki.tempel) {
		rows += row("Tempel", wiki.tempel);
	}
	rows += row("Beschreibung", settlementFirstSentence(wiki.description));
	const wikiLink = wiki.wiki_url
		? `<a class="region-info-box__link" href="${escapeHtml(wiki.wiki_url)}" target="_blank" rel="noopener">${escapeHtml(name)} im Wiki-Aventurica ↗</a>`
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


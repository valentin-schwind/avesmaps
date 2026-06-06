/*
 * Extracted location marker entry and popup helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

function refreshLocationMarkerPopup(markerEntry) {
	markerEntry.marker.setIcon(createLocationMarkerIcon(markerEntry.locationType));
	if (markerEntry.locationType === CROSSING_LOCATION_TYPE) {
		markerEntry.marker.bindPopup(
			locationPopupMarkup({
				name: markerEntry.name,
				locationType: CROSSING_LOCATION_TYPE,
				locationTypeLabel: "Kreuzung",
				showHeaderIcon: false,
				showDescription: false,
				showWikiLink: false,
				actionsMarkup: crossingActionsMarkup(markerEntry.name, markerEntry.publicId),
			})
		);
		return;
	}

	const wikiSettlement = markerEntry.location.wikiSettlement;
	const hasWikiSettlement = Boolean(wikiSettlement && wikiSettlement.title);
	const settlementInfobox = hasWikiSettlement
		? settlementWikiInfoboxMarkup(markerEntry.location)
		: '<div class="location-popup__nowiki">Kein Wiki-Eintrag gefunden</div>';
	markerEntry.marker.bindPopup(
		locationPopupMarkup({
			name: markerEntry.name,
			locationType: markerEntry.locationType,
			locationTypeLabel: markerEntry.location.locationTypeLabel,
			description: markerEntry.location.description,
			wikiUrl: markerEntry.location.wikiUrl,
			isRuined: markerEntry.location.isRuined,
			showType: true,
			showDescription: !hasWikiSettlement,
			showWikiLink: !hasWikiSettlement,
			// Infobox zuerst, Aktions-Buttons darunter.
			actionsMarkup: settlementInfobox + locationActionsMarkup(markerEntry.name, markerEntry.publicId, markerEntry.location),
		}),
		hasWikiSettlement ? { minWidth: 320, maxWidth: 400, className: "settlement-popup" } : undefined
	);
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

	// Verkehrswege als echte Links auf unsere eigene Spotlight-Suche — verhindert, dass Handys die
	// Namen als reale Orte erkennen (Google/Apple Maps) und verbindet stattdessen mit unserer Karte.
	const wayValue = String(wiki.verkehrswege || "").trim();
	const waysHtml = wayValue
		? wayValue
			.split(/\s*,\s*/)
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => `<a class="region-info-box__waylink" href="#" role="button" data-spotlight="${escapeHtml(part)}">${escapeHtml(part)}</a>`)
			.join(", ")
		: "";

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
	const description = String(wiki.description || "").trim();
	rows += row("Beschreibung", description.length > 130 ? description.slice(0, 130).trim() + " …" : description);
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

// Klick auf einen Verkehrswege-Link öffnet unsere eigene Spotlight-Suche (verbindet mit unserer
// Karte) statt externer Karten-Apps. Der echte <a> verhindert zudem die Handy-Auto-Erkennung.
document.addEventListener("click", (event) => {
	const link = event.target && event.target.closest && event.target.closest(".region-info-box__waylink");
	if (!link) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	const query = link.dataset.spotlight || link.textContent || "";
	// Deferred öffnen, damit kein konkurrierender Document-Click-Handler (Spotlight-Schließen) die
	// gerade geöffnete Suche im selben Klick sofort wieder zumacht.
	window.setTimeout(() => {
		if (typeof openSpotlightSearch === "function") {
			openSpotlightSearch(query);
		}
	}, 0);
});

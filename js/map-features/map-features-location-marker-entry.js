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

	// Verkehrswege als echte Links auf unsere eigene Spotlight-Suche — verhindert, dass Handys die
	// Namen als reale Orte erkennen (Google/Apple Maps) und verbindet stattdessen mit unserer Karte.
	const wayValue = String(wiki.verkehrswege || "").trim();
	const waysHtml = wayValue
		? wayValue
			.split(/\s*,\s*/)
			.map((part) => part.trim())
			.filter(Boolean)
			.map((part) => `<a class="region-info-box__waylink" href="#" role="button" data-way-name="${escapeHtml(part)}">${escapeHtml(part)}</a>`)
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

// Fliegt direkt zum gleichnamigen Weg/Fluss auf unserer Karte (pathData enthält auch Flüsse, die
// in der Spotlight-Suche fehlen). Exakter Name bevorzugt, sonst Teilstring. Mehrteilige Flüsse:
// Gesamt-Bounds aller passenden Segmente.
function focusWayByName(query) {
	if (typeof pathData === "undefined" || !Array.isArray(pathData) || typeof map === "undefined" || !map) {
		return false;
	}
	const norm = (value) => String(value || "").toLowerCase().replace(/ß/g, "ss").replace(/[^\p{L}\p{N}]+/gu, "");
	// Der echte Wiki-Name steckt in display_name/original_name; properties.name ist der generierte
	// Fallback (z. B. "Flussweg-1234").
	const wayName = (path) => path?.properties?.display_name || path?.properties?.original_name || path?.properties?.name || "";

	// Kandidaten: "Reichsstraßen 2 und 3" -> "Reichsstraße 2" + "Reichsstraße 3" (Plural+und auflösen).
	const text = String(query || "");
	const nums = text.match(/\d+/g) || [];
	const base = text
		.replace(/\d+/g, " ")
		.replace(/\b(und|sowie|nach|bis|zur|zum|von|der|die|das)\b/gi, " ")
		.replace(/straßen/gi, "straße")
		.replace(/strassen/gi, "strasse")
		.replace(/,/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const candidates = [];
	if (base && nums.length) {
		nums.forEach((n) => candidates.push(`${base} ${n}`));
	}
	if (base) {
		candidates.push(base);
	}
	candidates.push(text);
	const candNorms = Array.from(new Set(candidates.map(norm).filter((c) => c.length >= 2)));

	// Generierte Fallback-Namen ("Pfad-12", "Reichsstrasse-226") raus — sie kollidieren sonst nach
	// Normalisierung mit echten Namen ("Reichsstraße 2"). Echte Namen enden nicht auf "-<Zahl>".
	const named = pathData
		.map((path) => ({ path, raw: String(wayName(path)) }))
		.filter((entry) => entry.raw && !/-\d+$/.test(entry.raw))
		.map((entry) => ({ path: entry.path, n: norm(entry.raw) }))
		.filter((entry) => entry.n);
	let matches = named.filter((entry) => candNorms.includes(entry.n));
	if (matches.length === 0) {
		matches = named.filter((entry) => entry.n.length >= 4 && candNorms.some((c) => c.includes(entry.n) || (c.length >= 4 && entry.n.includes(c))));
	}
	if (matches.length === 0) {
		return false;
	}
	const latlngs = [];
	matches.forEach((entry) => {
		(entry.path?.geometry?.coordinates || []).forEach((coord) => {
			if (Array.isArray(coord) && coord.length >= 2) {
				latlngs.push([coord[1], coord[0]]);
			}
		});
	});
	if (latlngs.length === 0) {
		return false;
	}
	map.closePopup();
	map.flyToBounds(L.latLngBounds(latlngs), { padding: [60, 60], maxZoom: 5, duration: 0.6 });
	return true;
}

// Klick auf einen Verkehrswege-Link fliegt direkt zum Weg/Fluss auf unserer Karte (statt externer
// Karten-Apps). Der echte <a> verhindert zudem die Handy-Auto-Erkennung.
document.addEventListener("click", (event) => {
	const link = event.target && event.target.closest && event.target.closest(".region-info-box__waylink");
	if (!link) {
		return;
	}
	event.preventDefault();
	event.stopPropagation();
	const query = link.dataset.wayName || link.textContent || "";
	if (!focusWayByName(query)) {
		showFeedbackToast?.(`„${query}" ist auf der Karte (noch) nicht als Weg/Fluss hinterlegt.`, "info");
	}
});

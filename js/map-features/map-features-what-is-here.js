// „Was ist hier?" -- das Infopanel einer angeklickten Kartenstelle.
// Entwurf: docs/superpowers/specs/2026-08-15-was-ist-hier-design.md
//
// 💣 DIE MARKIERUNG IST HIER DOCH EIN ORTSKASTEN -- und das widerspricht dem alten Merksatz am
// (mit Aufgabe 4, 15.08.2026, geloeschten) schwebenden Markierungsmenue NICHT. Dort stand „wer hier
// etwas anbaut, fragt zuerst, ob der Ortskasten es koennte -- und wenn ja, gehoert es dorthin." Ab
// jetzt KANN er es: die Stelle hat eine Herrschaftskette, vier Landschaftszeilen, Natur & Waren und
// eine Nachbarschaft. Der schwebende 215-px-Kasten ist gefallen, der 400-px-Ortskasten im Panel traegt.

"use strict";

let whatIsHereToken = null;

/**
 * Das Kopfbild-Basename einer Landschafts-Antwort: der ERSTE Treffer, der wirklich ein Bild ergibt --
 * erst Vegetation durchgehen, dann Topographie, dann der allgemeine Rueckfall. Aufgeloest ueber
 * INFO_HEADER_IMAGE_BY_ART -- keine zweite Tabelle.
 *
 * 🔴 Fix-Runde 6, Befund B: NICHT einfach vegetation[0]/topographie[0]. Am gemessenen Landpunkt war
 * der erste Vegetationstreffer „Flusslande" (type_label „Flussland/Flusstal", nicht in
 * INFO_HEADER_IMAGE_BY_ART), der ZWEITE „Dunkelwald (Wald)" haette wald.webp ergeben --
 * regionHeaderImageBasename() faellt bei unbekanntem Typ auf "region" zurueck, und genau daran wird
 * ein Fehlschlag erkannt: weitersuchen statt den ersten Treffer blind zu uebernehmen.
 * ⚠️ Der Seepunkt bleibt unveraendert richtig (meer.webp): dort liegt keine Vegetation, die
 * Topographie-Schleife greift direkt.
 *
 * Eigene Funktion (nicht inline in avesmapsWhatIsHereMarkup), damit genau dieser Fall -- mehrere
 * Vegetationstreffer, der erste ohne Bild, der zweite mit -- ausgefuehrt statt nur im Quelltext
 * gesucht geprueft werden kann (js/map-features/__tests__/what-is-here-panel.test.js).
 */
function avesmapsWhatIsHereHeaderImageBasename(flaechen) {
	const ersterBildtreffer = (treffer) => {
		for (const t of (treffer || [])) {
			const kandidat = regionHeaderImageBasename(t.type_label || "");
			if (kandidat !== "region") {
				return kandidat;
			}
		}
		return null;
	};
	const f = flaechen || {};
	return ersterBildtreffer(f.vegetation) || ersterBildtreffer(f.topographie) || "region";
}

/** Der Zustand einer angezeigten Stelle: die Koordinate plus, sobald sie da ist, die Serverantwort. */
function avesmapsWhatIsHereMarkup(latlng, antwort) {
	const esc = escapeHtml;
	const titel = tr("whatIsHere.title", "Markierte Stelle");
	const koordinate = typeof formatLocationReportCoordinates === "function"
		? formatLocationReportCoordinates(latlng)
		: `${latlng.lat.toFixed(3)}, ${latlng.lng.toFixed(3)}`;

	const flaechen = (antwort && antwort.landscapes) || {};
	const bild = avesmapsWhatIsHereHeaderImageBasename(flaechen);
	const kopf = infoHeaderImageMarkup(bild, titel, koordinate, "", [], "");

	const kacheln = locationPopupActionsMarkup([
		popupActionButtonMarkup({
			label: tr("popup.addToRoutePlain", "Reiseziel hinzufügen"),
			className: "location-popup__action-button--accent",
			iconMarkup: '<span class="location-popup__action-icon" aria-hidden="true">+</span>',
			attributes: { "data-popup-action": "travel-to-share-pin" },
		}),
		popupActionButtonMarkup({
			// shareLinkActionLabel (js/ui/popups.js, dicht bei sharePlaceActionButtonMarkup) traegt den
			// Text -- EINE Stelle kennt den i18n-Schluessel popup.shareLink und die Emoji-Regex, nicht zwei.
			label: shareLinkActionLabel(),
			iconMarkup: '<img class="location-popup__action-img" src="img/menu/linkteilen.webp" alt="" width="36" height="36" />',
			attributes: { "data-popup-action": "share-what-is-here" },
		}),
		popupActionButtonMarkup({
			label: tr("popup.removeMarker", "Entfernen"),
			className: "location-popup__action-button--danger",
			iconMarkup: '<img class="location-popup__action-img" src="img/menu/papierkorb.webp" alt="" width="36" height="36" />',
			attributes: { "data-popup-action": "remove-share-pin" },
		}),
	]);

	// 🔴 Die Treppe UNVERAENDERT durchgereicht (Blatt -> Wurzel, buildSettlementHierarchyMarkup dreht
	// selbst um). Das Schluesselfeld territory_public_id traegt der Endpunkt bereits selbst
	// (avesmapsWhatIsHereTerritoryPayload, api/_internal/app/what-is-here.php -- Fix-Runde 1: die
	// Umbenennung public_id -> territory_public_id gehoert an ihren Ursprung, nicht an den Aufrufort).
	const treppe = (antwort && antwort.territories && antwort.territories.length)
		? buildSettlementHierarchyMarkup(antwort.territories)
		: "";

	// 🔴 Eine Zeile ohne Antwort faellt WEG. Am Seepunkt bleiben genau zwei uebrig, und das ist
	// eine vollstaendige Auskunft, kein Fehler.
	const zeile = (bezeichnung, treffer) => {
		const werte = (treffer || []).map((t) => esc(t.region_name)
			+ (t.type_label ? ' <span class="avesmaps-wih__type">(' + esc(t.type_label) + ")</span>" : ""));
		return werte.length
			? '<div class="region-info-box__row"><dt>' + esc(bezeichnung) + "</dt><dd>"
				+ werte.join(" · ") + "</dd></div>"
			: "";
	};

	let zeilen = zeile(tr("whatIsHere.derographic", "Derographie"), flaechen.derographisch)
		+ zeile(tr("whatIsHere.topography", "Topographie"), flaechen.topographie)
		+ zeile(tr("whatIsHere.vegetation", "Vegetation"), flaechen.vegetation);

	// Waren · Fauna · Flora baut der vorhandene Container selbst und fuellt sich, sobald lore.php
	// geantwortet hat -- genau wie bei einer Siedlung. Hier wird nichts an der Lore gebaut.
	if (antwort && antwort.lore && typeof buildLoreMarkup === "function") {
		zeilen += buildLoreMarkup({
			key: (antwort.lore.place || []).join(","),
			area: (antwort.lore.area || []).join(","),
			name: titel,
		});
	}
	// 🔴 IMMER direkt unter Flora (Owner 2026-08-03).
	const klima = ((flaechen.klima || [])[0] || {}).region_name || "";
	if (klima && typeof avesmapsClimateRowMarkup === "function") {
		zeilen += avesmapsClimateRowMarkup([{ label: klima, share: 1 }]);
	}

	const box = zeilen
		? '<div class="region-info-box region-info-box--settlement">'
			+ '<dl class="region-info-box__data">' + zeilen + "</dl></div>"
		: "";

	// 💣 Kein window.mapFeatureData -- den Namen gibt es im Haus nicht (geprueft: js/routing/routing.js
	// haelt die geladenen GeoJSON-Features nirgends global, nur drei Teilstuecke davon:
	// window.__sourceCatalog/__featureSourceRefs/avesmapsInSettlementPlaces). avesmapsWhatIsHereNearby
	// braucht aber genau die rohen Features (feature.properties.feature_type/feature.geometry.coordinates),
	// nicht die bereits umgebauten locationData/pathData-Listen. Ergaenzt in routing.js als vierten Stash
	// nach demselben Muster wie die drei bestehenden (window.avesmapsMapFeatureData).
	const nachbarn = avesmapsWhatIsHereNearbyMarkup(
		avesmapsWhatIsHereNearby({ x: latlng.lng, y: latlng.lat }, window.avesmapsMapFeatureData || [])
	);

	return '<div class="location-popup">' + kopf + kacheln + treppe + box + nachbarn + "</div>";
}

/**
 * Die Stelle im Panel zeigen -- zwei Runden.
 *
 * 💣 DIE KOORDINATE DREHT SICH HIER, und nur hier: Leaflet spricht [lat, lng], der Endpunkt
 * spricht {x, y}. x = lng, y = lat.
 *
 * ⚠️ Eigener Staleness-Token wie beim Gebiet (avesmapsShowRegionInInfopanel): wer zweimal
 * schnell hintereinander klickt, darf nicht die erste Antwort ueber die zweite Stelle bekommen.
 *
 * 💣 KEIN avesmapsLoreFillOpenContainers -- die Funktion gibt es im Haus nicht (geprueft:
 * map-features-lore.js kennt nur avesmapsLoreFillContainers(placeKey, placeName, data), einen
 * privaten Helfer, der erst NACH einem Abruf mit dessen Antwort gerufen wird). buildLoreMarkup
 * stoesst den Abruf selbst an: sein Container landet per body.innerHTML im DOM, der dortige
 * MutationObserver (avesmapsLoreLoadPendingContainers) findet ihn von selbst und laedt nach.
 */
window.avesmapsShowWhatIsHere = function (latlng) {
	const punkt = L.latLng(latlng);
	avesmapsShowInfopanel(avesmapsWhatIsHereMarkup(punkt, null));

	const token = {};
	whatIsHereToken = token;
	fetch("/api/app/what-is-here.php?x=" + encodeURIComponent(punkt.lng)
			+ "&y=" + encodeURIComponent(punkt.lat), { credentials: "same-origin" })
		.then((r) => (r.ok ? r.json() : null))
		.then(function (daten) {
			if (!daten || daten.ok === false || whatIsHereToken !== token) {
				return; // andere Stelle inzwischen angezeigt -> veraltete Antwort verwerfen
			}
			avesmapsShowInfopanel(avesmapsWhatIsHereMarkup(punkt, daten));
		})
		.catch(function () { /* still: die erste Runde steht bereits */ });
};

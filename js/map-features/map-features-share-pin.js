function createSharePinIcon() {
	return L.divIcon({
		className: "share-pin-marker",
		html: sharePinVisualMarkup("share-pin-visual--marker"),
		iconSize: [34, 42],
		iconAnchor: [17, 31],
		popupAnchor: [0, -34],
	});
}

function clearSharePin({ syncUrl = true } = {}) {
	if (sharePinMarker) {
		map.removeLayer(sharePinMarker);
		sharePinMarker = null;
	}

	sharePinCoordinates = null;

	// 🔴 Die Markierung wegzunehmen und einen leeren Kasten stehen zu lassen waere genau der
	// Zustand, den es im Infopanel nicht gibt (Owner-Vorgabe: nie leer geoeffnet).
	if (typeof avesmapsShowInfopanel === "function") {
		avesmapsShowInfopanel("");
	}

	if (syncUrl) {
		syncPlannerStateToUrl();
	}
}

/**
 * Die Markierung am Marker ziehen -- der EINZIGE Weg, sie zu verschieben (Owner 15.08.2026:
 * „verschieben kann wieder weg, drag n drop geht ja immer"). Die Kachel dafuer ist mit diesem Satz
 * gefallen, samt ihrem wartenden Klick-Zustand.
 *
 * 💣 HIER WIRD setSharePin NICHT AUFGERUFEN, so naheliegend das waere. Diese Funktion wirft den
 * Marker weg und baut einen neuen -- also genau den, an dem Leaflet gerade noch seinen Drag
 * abschliesst. Leaflet raeumt dann auf einem Element auf, das es nicht mehr gibt (TypeError in
 * `finishDrag`); derselbe Fall ist am freien Kartenpunkt schon einmal aufgetreten und dort mit
 * einem setTimeout entschaerft. Nur: der Marker liegt nach dem Ziehen bereits richtig, gezeichnet
 * von Leaflet. Zu tun bleibt, was NICHT am Marker haengt -- die Koordinate und der geteilte Link.
 */
function bindSharePinDragging(marker) {
	marker.on("dragstart", () => {
		// ⚠️ HIER WIRD KEIN wartendes „Verschieben" abgeraeumt. Bis zum 15.08.2026 stand hier ein
		// cancelMapPointRelocation() -- richtig, solange die Markierung selbst eine Verschieben-Kachel
		// hatte. Jetzt kann nur noch der KARTENPUNKT auf einen Klick warten, und den geht das Ziehen
		// der Markierung nichts an: ihn abzuraeumen hiesse, dem Nutzer eine andere, laufende Handlung
		// stillschweigend wegzunehmen.
	});

	marker.on("dragend", () => {
		const droppedAt = marker.getLatLng();

		// Die Kartengrenze gilt fuers Ziehen genauso wie fuers Setzen (setSharePin lehnt draussen ab).
		// Der Marker springt dann auf seine letzte gueltige Stelle zurueck, statt ausserhalb der Karte
		// liegen zu bleiben -- ein Link dorthin liesse sich nicht mehr oeffnen.
		if (!isWithinMapBounds(droppedAt)) {
			if (sharePinCoordinates) {
				marker.setLatLng(sharePinCoordinates);
			}
			window.avesmapsShowWhatIsHere(marker.getLatLng());
			return;
		}

		sharePinCoordinates = droppedAt;
		syncPlannerStateToUrl();
		// Die Auskunft neu rechnen, aus demselben Grund wie beim Klick-Weg (completeMapPointRelocationAt):
		// die naechste Handlung -- nochmal ruecken, entfernen, als Reiseziel eintragen -- soll ohne einen
		// weiteren Klick erreichbar sein. Beide Wege enden damit im selben Bild.
		window.avesmapsShowWhatIsHere(marker.getLatLng());
	});
}

function setSharePin(latlng, { syncUrl = true } = {}) {
	const normalizedLatLng = L.latLng(latlng);
	if (!isWithinMapBounds(normalizedLatLng)) {
		return false;
	}

	sharePinCoordinates = normalizedLatLng;

	if (sharePinMarker) {
		map.removeLayer(sharePinMarker);
	}

	sharePinMarker = L.marker(normalizedLatLng, {
		icon: createSharePinIcon(),
		title: "Geteilte Markierung",
		keyboard: true,
		// Owner 15.08.2026: „kann ich nicht auch ziehen? drag n drop?" -- und im selben Zug ist die
		// Kachel „Verschieben" gefallen („drag n drop geht ja immer"). Ziehen ist damit der EINZIGE
		// Weg, die Markierung zu ruecken. Dass man ihm das ansieht, leistet der Greifzeiger an
		// `.share-pin-marker.leaflet-marker-draggable` (css/features/location-popups-markers.css) --
		// Leaflet selbst setzt ihn nur waehrend des Ziehens, die Geste waere sonst unsichtbar.
		// Vorbild: bindRouteWaypointDragging in js/routing/route-render.js.
		draggable: true,
	})
		.addTo(map);

	// 🔴 Ein Klick auf die Markierung zeigt ihre Auskunft -- dieselbe Regel wie bei jedem anderen
	// Feature der Karte. Der schwebende Zwei-Kachel-Kasten ist damit ersatzlos gefallen: seine drei
	// Befehle stehen jetzt im Aktionsband des Panels.
	sharePinMarker.on("click", function () {
		window.avesmapsShowWhatIsHere(sharePinMarker.getLatLng());
	});

	bindSharePinDragging(sharePinMarker);

	if (syncUrl) {
		syncPlannerStateToUrl();
	}

	return true;
}

function fallbackCopyTextToClipboard(text) {
	const textarea = document.createElement("textarea");
	textarea.value = text;
	textarea.setAttribute("readonly", "readonly");
	textarea.style.position = "fixed";
	textarea.style.opacity = "0";
	textarea.style.pointerEvents = "none";
	document.body.append(textarea);
	textarea.focus();
	textarea.select();
	textarea.setSelectionRange(0, textarea.value.length);

	const didCopy = document.execCommand("copy");
	textarea.remove();
	return didCopy;
}

async function copyTextToClipboard(text) {
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch (error) {
			console.warn("Kopieren über navigator.clipboard fehlgeschlagen. Es wird ein Fallback versucht.", error);
		}
	}

	try {
		return fallbackCopyTextToClipboard(text);
	} catch (error) {
		console.warn("Kopieren in die Zwischenablage fehlgeschlagen.", error);
		return false;
	}
}

function copyCurrentUrlToClipboard() {
	return copyTextToClipboard(window.location.href);
}

// Direkter Teil-Link auf eine konkrete Stelle (Siedlung/Region). Wenn das Objekt einen
// verknuepften Wiki-Artikel hat, wird der DOKUMENTIERTE Deep-Link-Parameter genutzt
// (?siedlung/?staat/?region/?strasse/?fluss, js/app/wiki-deeplink.js) statt ?place=<publicId> --
// harmonisiert "Link teilen" mit den Wiki-Deep-Links (gleicher Ziel-Artikel -> gleicher Link-Kanal).
// Ohne Wiki-Url (oder ohne wikiParam-Option) bleibt der bisherige ?place=<publicId>-Link
// unveraendert (Rueckwaertskompatibilitaet fuer bestehende Aufrufer).
//
// Pure Teil-Funktion (nur die Query-String-Logik, kein window.location-Zugriff) fuer die
// Unit-Tests unter tools/paths/test-share-link-builder.mjs.
function buildShareLinkPath(publicId, wikiUrl, wikiParam) {
	const rawWikiUrl = String(wikiUrl || "").trim();
	if (rawWikiUrl && wikiParam) {
		const wikiMatch = /\/wiki\/([^?#]+)/i.exec(rawWikiUrl);
		if (wikiMatch && wikiMatch[1]) {
			return `${encodeURIComponent(wikiParam)}=${wikiMatch[1]}`;
		}
	}
	return `place=${encodeURIComponent(publicId)}`;
}

// { wikiUrl, wikiParam } optional: wenn beide gesetzt sind UND wikiUrl einen "/wiki/<Page>"-Pfad
// enthaelt, gewinnt der Wiki-Deep-Link; sonst (keine Optionen, kein Treffer) der ?place=-Fallback.
function buildPlaceShareLink(publicId, { wikiUrl, wikiParam } = {}) {
	return `${window.location.origin}${window.location.pathname}?${buildShareLinkPath(publicId, wikiUrl, wikiParam)}`;
}

async function sharePlaceLinkWithFeedback(publicId, shareLinkOptions = {}) {
	if (!publicId) {
		return false;
	}
	const url = buildPlaceShareLink(publicId, shareLinkOptions);
	const didCopy = await copyTextToClipboard(url);
	showFeedbackToast(
		didCopy ? tr("toast.share.placeCopied", "Link zu dieser Stelle in die Zwischenablage kopiert.") : tr("toast.share.copyFailed", "Link konnte nicht automatisch kopiert werden."),
		didCopy ? "success" : "warning"
	);
	return didCopy;
}

// Teil-Link auf eine frei markierte Stelle (Rechtsklick -> "Stelle markieren und teilen"). Baut den
// dokumentierten Pin-Deep-Link (?pin=<lat,lng>, beim Laden gelesen von readSharePinFromUrl in
// map-features-layer-state.js). Die Adresszeile wird bewusst NIE automatisch umgeschrieben (URL-Policy,
// Owner 2026-07-06) -- deshalb MUSS der teilbare Link hier explizit erzeugt werden statt window.location.href
// zu kopieren (das enthielte den Pin nie -> der Grund des gemeldeten "Teilen liefert keinen Parameter"-Bugs).
// SHARE_PIN_QUERY_PARAM (js/config.js) und formatSharePinQueryValue (map-features-layer-state.js) sind
// global und zur Klickzeit laengst geladen.
function buildSharePinLink(latlng) {
	const params = new URLSearchParams();
	params.set(SHARE_PIN_QUERY_PARAM, formatSharePinQueryValue(latlng));
	return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
}

async function copySharePinLinkWithFeedback(latlng) {
	const url = buildSharePinLink(latlng);
	const didCopy = await copyTextToClipboard(url);
	showFeedbackToast(
		didCopy ? tr("toast.share.pinCopied", "Link zur markierten Stelle in die Zwischenablage kopiert.") : tr("toast.share.copyFailed", "Link konnte nicht automatisch kopiert werden."),
		didCopy ? "success" : "warning"
	);
	return didCopy;
}

// „Kreuzung melden": legt eine Zeile in die Zwischenablage, mit der ein Editor dem Owner eine
// STELLE nennen kann statt einer Nummer, die sich verschiebt. „Kreuzung-2090" entsteht erst im
// Browser als laufender Zaehler ueber die Payload-Reihenfolge (prepareLocationData,
// js/routing/routing.js): legt jemand eine Kreuzung an, die frueher einsortiert, rutscht jede
// folgende Nummer um eins. Als Meldung an den Owner waere sie damit unbrauchbar -- deshalb traegt
// die Zeile die publicId/den Pin-Link, nie den angezeigten Namen.
//
// 💣 Baut den Index NICHT. Die Armzahl war Beiwerk und ist raus (Owner 2026-08-15: "2 Arme" steht
// in JEDER markierten Zeile -- Regel 1 verlangt genau SPARSE_CROSSING_WAY_COUNT, die Zahl
// unterscheidet also nichts). Die Wegart ist die einzig unterscheidende Angabe und wird ebenfalls
// nur gelesen, wenn der Index ohnehin schon steht (locationConnectivityIndex befuellt). Absichtlich
// NICHT ueber getSparseCrossingWayType() (route-graph-routing.js): der folgt der Form seiner
// Nachbarn und baut den Index bei Bedarf lazy -- genau das darf ein Popup-Klick nicht ausloesen,
// also liest dieser Aufrufer weiterhin direkt am globalen Objekt, wie schon istMarkiert.
async function reportCrossingWithFeedback(publicId) {
	const markerEntry = publicId ? findLocationMarkerByPublicId(publicId) : null;
	const koordinaten = markerEntry?.location?.coordinates;
	if (!Array.isArray(koordinaten)) {
		return false;
	}

	const stelle = { lat: koordinaten[0], lng: koordinaten[1] };
	const istMarkiert = locationConnectivityIndex
		&& locationConnectivityIndex.sparseCrossings.has(publicId);
	const wegart = istMarkiert ? (locationConnectivityIndex.crossingWayTypes.get(publicId) || "") : "";
	const befund = wegart ? ` (${wegart})` : "";
	const didCopy = await copyTextToClipboard(`Kreuzung${befund} · ${buildSharePinLink(stelle)}`);
	showFeedbackToast(
		didCopy ? tr("toast.share.crossingCopied", "Kreuzung in die Zwischenablage kopiert.") : tr("toast.share.copyFailed", "Link konnte nicht automatisch kopiert werden."),
		didCopy ? "success" : "warning"
	);
	return didCopy;
}

async function copyCurrentUrlToClipboardWithFeedback() {
	const didCopy = await copyCurrentUrlToClipboard();
	showFeedbackToast(
		didCopy ? tr("toast.share.linkCopied", "Link in die Zwischenablage kopiert.") : "Link konnte nicht automatisch kopiert werden.",
		didCopy ? "success" : "warning"
	);
	return didCopy;
}

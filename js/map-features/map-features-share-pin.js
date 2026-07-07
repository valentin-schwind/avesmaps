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

	if (syncUrl) {
		syncPlannerStateToUrl();
	}
}

function setSharePin(latlng, { openPopup = false, syncUrl = true } = {}) {
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
	})
		.bindPopup(sharePinPopupMarkup(), {
			autoClose: false,
		})
		.addTo(map);

	if (openPopup) {
		sharePinMarker.openPopup();
	}

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

async function copyCurrentUrlToClipboardWithFeedback() {
	const didCopy = await copyCurrentUrlToClipboard();
	showFeedbackToast(
		didCopy ? tr("toast.share.linkCopied", "Link in die Zwischenablage kopiert.") : "Link konnte nicht automatisch kopiert werden.",
		didCopy ? "success" : "warning"
	);
	return didCopy;
}

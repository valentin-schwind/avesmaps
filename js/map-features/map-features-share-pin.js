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
			console.warn("Kopieren Ã¼ber navigator.clipboard fehlgeschlagen. Es wird ein Fallback versucht.", error);
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

async function copyCurrentUrlToClipboardWithFeedback() {
	const didCopy = await copyCurrentUrlToClipboard();
	showFeedbackToast(
		didCopy ? "Link in die Zwischenablage kopiert." : "Link konnte nicht automatisch kopiert werden.",
		didCopy ? "success" : "warning"
	);
	return didCopy;
}

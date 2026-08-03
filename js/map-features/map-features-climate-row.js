// Die Zeile „Klimazone" in der Infobox -- EIN Baustein, drei Zulieferer.
//
// Sie steht unter Flora (Owner 2026-08-03) und reiht sich in dieselbe Feldliste ein wie
// Oberhaupt/Einwohner/Waren/Fauna/Flora -- .region-info-box__row + dt/dd, kein eigener Block daneben.
//
// 🔴 DREI ZULIEFERER, EIN RENDERER. Die drei Dinge kennen ihre Zone auf drei verschiedenen Wegen, weil
// sie drei verschiedene Formen haben:
//   * ein ORT ist ein Punkt   -> properties.climate_zone, ein Schlüssel   (aus dem Kartenpayload)
//   * eine REGION ist eine Fläche -> properties.climate_zones, mit Anteilen (aus dem Kartenpayload)
//   * ein WEG ist eine Linie  -> buildClimateLine()                        (aus api/app/path-landscapes.php)
// Sie enden trotzdem alle in avesmapsClimateRowMarkup. Drei eigene Zeilenbauer sähen am Anfang gleich
// aus und wären nach dem zweiten Feinschliff drei verschiedene Zeilen -- genau so sind Infobox und
// Routenplaner einmal auseinandergelaufen (AGENTS.md §12).
//
// 💣 KEIN ABRUF IN DIESER DATEI. Ort und Region tragen ihre Zone im Payload; der Weg holt seine über
// den Beobachter in map-features-path-landscapes.js, der ohnehin schon läuft. Ein eigener Abruf je
// geöffnetem Popup wäre das Fan-out, das am 2026-07-21 den PHP-Pool gesättigt hat.

"use strict";

// Schlüssel -> Anzeigename, aus dem Kartenpayload (`climate_zones`, sieben Einträge von Nord nach Süd).
// Ein Ort trägt nur den Schlüssel; der Name steht einmal hier statt 4.650-mal im Payload.
var avesmapsClimateZoneLabels = {};

function avesmapsClimateSetVocabulary(list) {
	avesmapsClimateZoneLabels = {};
	(list || []).forEach(function (zone) {
		var key = String((zone && zone.key) || "");
		if (key !== "") {
			avesmapsClimateZoneLabels[key] = String((zone && zone.label) || key);
		}
	});
}

// "" wenn der Schlüssel unbekannt ist. Das ist kein Fehler, sondern der Zustand zwischen zwei Deploys:
// ein Client mit altem Payload kennt eine neu benannte Zone noch nicht, und eine leere Zeile ist besser
// als ein roher Schlüssel („subtropen_winterfeucht") in der Infobox.
function avesmapsClimateZoneLabel(key) {
	var normalized = String(key == null ? "" : key).trim();
	return normalized === "" ? "" : (avesmapsClimateZoneLabels[normalized] || "");
}

function avesmapsClimateRowEscape(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

// Ab diesem Anteil wird KEIN Prozentwert gedruckt. Derselbe Wert und derselbe Grund wie bei „Führt
// durch": das meiste liegt ganz in einer Zone, und „(100 %)" hinter jedem Namen trägt keine Information
// mehr. Wird der echte Wert aus map-features-path-landscapes.js benutzt, sobald der geladen ist -- die
// 0,9 hier ist nur der Rückfall, damit diese Datei allein (Node-Test) lädt.
function avesmapsClimateFullShare() {
	return typeof AVESMAPS_LANDSCAPE_FULL_SHARE === "number" ? AVESMAPS_LANDSCAPE_FULL_SHARE : 0.9;
}

// EINE Zeile aus [{ label, share }]. Leere Liste -> "" (keine Zeile): „wir wissen es nicht" gehört nicht
// als leeres Feld in die Box, sondern gar nicht hinein -- dieselbe Regel wie bei den Lore-Zeilen.
//
// Der Trenner ist „ · " wie bei „Führt durch" und bewusst kein Komma: zwei Zonen sind keine Aufzählung
// eines Ganzen, sondern zwei Abschnitte desselben Dings.
function avesmapsClimateRowMarkup(entries) {
	var usable = (entries || []).filter(function (entry) {
		return entry && String(entry.label || "").trim() !== "";
	});
	if (usable.length === 0) {
		return "";
	}
	var full = avesmapsClimateFullShare();
	var label = typeof tr === "function" ? tr("infobox.climateZone", "Klimazone") : "Klimazone";
	var names = usable.map(function (entry) {
		var name = avesmapsClimateRowEscape(entry.label);
		var share = Number(entry.share);
		return (!isFinite(share) || share >= full)
			? name
			: name + " (" + Math.round(share * 100) + " %)";
	}).join(" · ");

	return '<div class="region-info-box__row avesmaps-climate__row"><dt>' + avesmapsClimateRowEscape(label)
		+ "</dt><dd>" + names + "</dd></div>";
}

// Ein ORT: genau eine Zone, kein Anteil. Ein Punkt liegt in einem Band, nicht zu 62 % darin.
function avesmapsClimateRowForKey(key) {
	var label = avesmapsClimateZoneLabel(key);
	return label === "" ? "" : avesmapsClimateRowMarkup([{ label: label, share: 1 }]);
}

// Eine REGION: [[schlüssel, anteil], ...], größter Anteil zuerst (der Server sortiert bereits).
function avesmapsClimateRowForShares(pairs) {
	return avesmapsClimateRowMarkup((pairs || []).map(function (pair) {
		return { label: avesmapsClimateZoneLabel(pair && pair[0]), share: pair && pair[1] };
	}));
}

// Ein WEG: die Einträge aus buildClimateLine tragen den Namen schon ausgeschrieben (sie kommen aus
// path-landscapes.php und nicht aus dem Vokabular des Payloads).
function avesmapsClimateRowForLandscapeEntries(entries) {
	return avesmapsClimateRowMarkup((entries || []).map(function (entry) {
		return { label: (entry && entry.name) || "", share: entry && entry.share };
	}));
}

// Bequemer Einstieg für die zwei Payload-Formen: nimmt die properties eines Features und liefert die
// fertige Zeile -- oder "". Die Aufrufstellen bleiben damit einzeilig.
function buildClimateRowMarkup(properties) {
	if (!properties) {
		return "";
	}
	if (Array.isArray(properties.climate_zones) && properties.climate_zones.length) {
		return avesmapsClimateRowForShares(properties.climate_zones);
	}
	return avesmapsClimateRowForKey(properties.climate_zone);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsClimateSetVocabulary,
		avesmapsClimateZoneLabel,
		avesmapsClimateRowMarkup,
		avesmapsClimateRowForKey,
		avesmapsClimateRowForShares,
		avesmapsClimateRowForLandscapeEntries,
		buildClimateRowMarkup,
	};
}

// Verkehrswege in Infoboxen anklickbar machen (Siedlung, Region, Herrschaftsgebiet).
//
// 💣 DIE LINKZIELE SIND WEG. Im Wiki steht „|Verkehrswege=[[Yaquir]], [[Eisenstraße]]",
// aber avesmapsWikiSyncCleanPoliticalTerritoryWikiValue (territories-parsing.php:199)
// löst Wikilinks zu reinem Anzeigetext auf, BEVOR der Wert in die Datenbank geht. Im
// Payload steht also nur noch „Yaquir, Eisenstraße". Deshalb wird hier NICHT ein
// verlorener Link wiederhergestellt, sondern der NAME gegen die geladenen Wege der
// Karte aufgelöst.
//
// Das ist auch die nützlichere Auflösung: ein Klick springt zur Straße AUF DER KARTE,
// statt das Wiki in einem neuen Tab zu öffnen. Findet sich kein Weg dieses Namens,
// bleibt der Eintrag schlichter Text -- ein toter Link wäre schlechter als keiner.

"use strict";

// Wege sind SEGMENTIERT: eine Reichsstraße besteht aus vielen Teilstücken, die alle
// denselben Namen tragen. Deshalb wird auf die Gesamtausdehnung ALLER gleichnamigen
// Segmente gezoomt und nicht auf das erste zufällige Stück.
function avesmapsFindPathsByName(name) {
	var wanted = String(name || "").trim().toLowerCase();
	if (!wanted || typeof pathData === "undefined" || !Array.isArray(pathData)) {
		return [];
	}
	return pathData.filter(function (path) {
		var props = (path && path.properties) || {};
		var candidate = String(props.name || path.name || "").trim().toLowerCase();
		return candidate !== "" && candidate === wanted;
	});
}

// Zoomt auf alle Segmente dieses Namens und schaltet die zugehörige Anzeige-Ebene ein
// -- ein Sprung zu einem ausgeblendeten Weg zeigt sonst leere Karte.
function avesmapsFocusPathsByName(name) {
	var matches = avesmapsFindPathsByName(name);
	if (!matches.length || typeof map === "undefined" || typeof L === "undefined") {
		return false;
	}

	// Anzeige-Ebene einschalten: dieselbe Zuordnung wie focusPathOnMap
	// (review-path-sync.js), damit ein Fluss nicht unsichtbar bleibt.
	var subtype = String((matches[0].properties && matches[0].properties.feature_subtype) || "").toLowerCase();
	var toggleId = subtype === "flussweg" ? "#toggleRivers" : (subtype === "seeweg" ? "#toggleSeaPaths" : "#togglePaths");
	if (typeof $ === "function") {
		var toggle = $(toggleId);
		if (toggle.length && !toggle.prop("checked")) {
			toggle.prop("checked", true).trigger("change");
		}
	}

	var points = [];
	matches.forEach(function (path) {
		var coords = path && path.geometry && Array.isArray(path.geometry.coordinates) ? path.geometry.coordinates : null;
		if (!coords) {
			return;
		}
		coords.forEach(function (pair) {
			// GeoJSON speichert [x, y]; Leaflet CRS.Simple will [lat, lng] = [y, x].
			if (Array.isArray(pair) && pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])) {
				points.push([pair[1], pair[0]]);
			}
		});
	});
	if (!points.length) {
		return false;
	}

	map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 4) });
	return true;
}

// „Yaquir, Eisenstraße, Zedernstraße nach Mhanadistan" -> anklickbare Namen.
// Getrennt wird NUR an Kommas und Semikolons: „Zedernstraße nach Mhanadistan" ist ein
// Eintrag, kein zwei.
function avesmapsTrafficRoutesMarkup(raw) {
	var text = String(raw == null ? "" : raw).trim();
	if (!text) {
		return "";
	}
	var esc = typeof escapeHtml === "function"
		? escapeHtml
		: function (value) { return String(value == null ? "" : value); };

	return text.split(/\s*[,;]\s*/).filter(Boolean).map(function (part) {
		var name = part.trim();
		if (!name) {
			return "";
		}
		// Nur verlinken, wenn die Karte diesen Weg wirklich kennt. Sonst bleibt es Text
		// -- ein Link, der nirgendwo hinführt, ist ein Versprechen, das bricht.
		if (avesmapsFindPathsByName(name).length === 0) {
			return esc(name);
		}
		return '<button type="button" class="avesmaps-traffic-link" data-traffic-path="'
			+ esc(name) + '" title="Auf der Karte zeigen">' + esc(name) + "</button>";
	}).filter(Boolean).join(", ");
}

// Ein Handler auf Dokumentebene, einmal registriert -- nicht je Popup, sonst stapeln
// sie sich bei jedem Öffnen (dieselbe Falle wie beim Spoiler-Schalter der
// Kartensammlung).
if (typeof document !== "undefined" && !document.__avesmapsTrafficLinksBound) {
	document.__avesmapsTrafficLinksBound = true;
	document.addEventListener("click", function (event) {
		var button = event.target && event.target.closest ? event.target.closest("[data-traffic-path]") : null;
		if (!button) {
			return;
		}
		event.preventDefault();
		var name = button.getAttribute("data-traffic-path") || "";
		if (!avesmapsFocusPathsByName(name) && typeof showFeedbackToast === "function") {
			showFeedbackToast("Dieser Weg ist gerade nicht geladen.", "info");
		}
	});
}

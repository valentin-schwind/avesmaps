// Verkehrswege in der Siedlungs-Infobox anklickbar machen.
//
// 💣 DIE LINKZIELE SIND WEG, BEVOR DIE DATEN ANKOMMEN. Im Wiki steht
// „|Verkehrswege=[[Yaquir]], [[Eisenstraße]]", aber
// avesmapsWikiSyncCleanPoliticalTerritoryWikiValue (territories-parsing.php:199) löst
// Wikilinks schon beim Sync zu reinem Text auf. Im Payload steht nur „Yaquir,
// Eisenstraße". Es wird hier also kein Link wiederhergestellt, sondern der NAME
// aufgelöst.
//
// UND ZWAR MIT DER SPOTLIGHT-SUCHE, nicht mit einer eigenen (Owner 2026-07-21). Die
// kennt die Fallstricke bereits:
//   - properties.name ist der AUTO-NAME („Pfad-170", „Gebirgspass-239"), nicht der
//     lesbare -- ein erster Versuch verglich dagegen und fand bei 5.385 geladenen
//     Wegen exakt NULL Treffer, obwohl „Eisenstraße" dreimal vorhanden war
//   - Wege sind SEGMENTIERT; Spotlight gruppiert alle Segmente über den wiki_key und
//     hält deren Gesamt-Bounds, sodass der ganze Weg angesprungen wird
//   - nur wiki-verlinkte Wege sind überhaupt suchbar (Policy 2026-07-05), was hier
//     genau richtig ist: alles andere hat keinen echten Namen
//
// Damit verhält sich ein Klick auf „Eisenstraße" identisch zur Auswahl desselben Wegs
// in der Spotlight-Suche -- inklusive Hervorhebung und dem Einschalten der Ebene.

"use strict";

// Weg-Eintrag der Spotlight-Suche zu einem Namen, oder null. Nutzt deren eigene
// Normalisierung, damit „Reichsstraße 2" hier nicht anders behandelt wird als dort.
function avesmapsFindTrafficRouteEntry(name) {
	var wanted = String(name || "").trim();
	if (!wanted || typeof getSpotlightSearchEntries !== "function") {
		return null;
	}
	var normalize = typeof normalizeSpotlightSearchText === "function"
		? normalizeSpotlightSearchText
		: function (value) { return String(value || "").trim().toLowerCase(); };
	var target = normalize(wanted);
	if (!target) {
		return null;
	}
	var entries = getSpotlightSearchEntries() || [];
	for (var i = 0; i < entries.length; i++) {
		if (entries[i] && entries[i].kind === "path" && normalize(entries[i].name) === target) {
			return entries[i];
		}
	}
	return null;
}

// „Yaquir, Eisenstraße, Zedernstraße nach Mhanadistan" -> anklickbare Namen.
// Getrennt wird NUR an Komma und Semikolon: „Zedernstraße nach Mhanadistan" ist EIN
// Eintrag. Namen ohne passenden Weg bleiben schlichter Text -- ein Link, der nirgendwo
// hinführt, ist schlechter als keiner.
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
		if (!avesmapsFindTrafficRouteEntry(name)) {
			return esc(name);
		}
		return '<button type="button" class="avesmaps-traffic-link" data-traffic-path="'
			+ esc(name) + '" title="Auf der Karte zeigen">' + esc(name) + "</button>";
	}).filter(Boolean).join(", ");
}

// Ein Handler auf Dokumentebene, EINMAL registriert -- nicht je Popup, sonst stapeln
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
		var entry = avesmapsFindTrafficRouteEntry(button.getAttribute("data-traffic-path") || "");
		if (entry && typeof selectSpotlightSearchEntry === "function") {
			// Exakt derselbe Weg wie über die Suche: zoomen, hervorheben, Ebene an.
			selectSpotlightSearchEntry(entry);
		} else if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Dieser Weg ist gerade nicht geladen.", "info");
		}
	});
}

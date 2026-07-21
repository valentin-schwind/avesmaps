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

// 💣 NAMENSREGISTER STATT LINEARER SUCHE. Diese Funktion läuft für JEDEN Wegnamen
// JEDER Siedlung -- und Siedlungs-Popups werden per bindPopup schon beim Kartenaufbau
// vorgebaut (map-features-location-marker-entry.js:213). Die erste Fassung lief dabei
// linear über alle ~3.800 Spotlight-Einträge: sechs Namen je Siedlung, tausende
// Siedlungen, zweistellige Millionen Vergleiche VOR dem ersten Bild. Der Browser stand.
//
// Jetzt einmal ein Register aufbauen, danach ist jeder Blick O(1). Das Register hängt
// an der IDENTITÄT der Spotlight-Liste: liefert sie ein neues Array (weil Daten
// nachgeladen wurden), wird neu aufgebaut -- sonst nie.
var avesmapsTrafficRouteIndex = null;
var avesmapsTrafficRouteIndexSource = null;

function avesmapsTrafficRouteNormalize(value) {
	return typeof normalizeSpotlightSearchText === "function"
		? normalizeSpotlightSearchText(value)
		: String(value || "").trim().toLowerCase();
}

function avesmapsGetTrafficRouteIndex() {
	if (typeof getSpotlightSearchEntries !== "function") {
		return null;
	}
	var entries = getSpotlightSearchEntries() || [];
	if (avesmapsTrafficRouteIndex && avesmapsTrafficRouteIndexSource === entries) {
		return avesmapsTrafficRouteIndex;
	}
	var index = new Map();
	for (var i = 0; i < entries.length; i++) {
		var entry = entries[i];
		if (entry && entry.kind === "path") {
			var key = avesmapsTrafficRouteNormalize(entry.name);
			if (key && !index.has(key)) {
				index.set(key, entry);
			}
		}
	}
	avesmapsTrafficRouteIndex = index;
	avesmapsTrafficRouteIndexSource = entries;
	return index;
}

// Weg-Eintrag zu einem Namen, oder null. ZWEI WEGE, in dieser Reihenfolge:
//
//   1. ÜBER DAS LINKZIEL (zuverlässig). wiki_settlement.verkehrswege_links bildet
//      Anzeigetext -> echten Wegnamen ab, gerettet aus dem Rohwert vor der Bereinigung
//      (settlements.php). Nur so findet „Kronstraße nach Perricum" die Straße
//      „Kronstraße von Perricum nach Zorgan" -- rund 8 % der Angaben sind solche
//      Pipe-Links und über den Namen grundsätzlich nicht auflösbar.
//   2. ÜBER DEN NAMEN (Rückfallebene). Greift für die übrigen ~92 % und für alle
//      Datensätze, die noch keinen neuen Sync gesehen haben. Ohne diesen Fallback
//      wären nach dem Ausrollen zunächst ALLE Wege unverlinkt.
function avesmapsFindTrafficRouteEntry(name, linkTargets) {
	var raw = String(name || "").trim();
	if (!raw) {
		return null;
	}
	var index = avesmapsGetTrafficRouteIndex();
	if (!index) {
		return null;
	}

	if (linkTargets && typeof linkTargets === "object") {
		var mapped = linkTargets[raw];
		if (mapped) {
			var viaTarget = index.get(avesmapsTrafficRouteNormalize(mapped));
			if (viaTarget) {
				return viaTarget;
			}
		}
	}

	return index.get(avesmapsTrafficRouteNormalize(raw)) || null;
}

// „Yaquir, Eisenstraße, Zedernstraße nach Mhanadistan" -> anklickbare Namen.
// Getrennt wird NUR an Komma und Semikolon: „Zedernstraße nach Mhanadistan" ist EIN
// Eintrag. Namen ohne passenden Weg bleiben schlichter Text -- ein Link, der nirgendwo
// hinführt, ist schlechter als keiner.
// 💣 HIER WIRD NICHT NACHGESCHLAGEN. Diese Funktion läuft beim Bauen JEDES
// Siedlungs-Popups -- und die entstehen alle beim Kartenaufbau (bindPopup). Würde hier
// der Spotlight-Index angefasst, baute ihn die erste Siedlung komplett auf (5.385 Wege
// plus Orte und Labels), bevor die Karte erscheint. Bisher entstand er erst, wenn
// jemand die Suche öffnete; das darf so bleiben.
//
// Also: nur Text und ein Merker. Verlinkt wird erst, wenn das Popup wirklich im DOM
// steht -- siehe Beobachter unten. Dasselbe Muster wie bei den Lore-Zeilen.
function avesmapsTrafficRoutesMarkup(raw, linkTargets) {
	var text = String(raw == null ? "" : raw).trim();
	if (!text) {
		return "";
	}
	var esc = typeof escapeHtml === "function"
		? escapeHtml
		: function (value) { return String(value == null ? "" : value); };

	// Die Anzeigetext->Wegname-Zuordnung reist im Element mit, damit sie beim späteren
	// Verlinken und beim Klick verfügbar ist, ohne den Ort erneut nachzuschlagen.
	var mapAttr = "";
	if (linkTargets && typeof linkTargets === "object" && Object.keys(linkTargets).length) {
		try {
			mapAttr = ' data-traffic-map="' + esc(JSON.stringify(linkTargets)) + '"';
		} catch (error) {
			mapAttr = "";
		}
	}

	return '<span class="avesmaps-traffic" data-traffic-raw="' + esc(text) + '"' + mapAttr + ">"
		+ esc(text) + "</span>";
}

// Liest die mitgereiste Zuordnung eines Containers zurück. Fehlt oder bricht sie, wird
// still auf den Namensabgleich zurückgefallen -- lieber ein Weg weniger verlinkt als
// eine Ausnahme im Popup-Aufbau.
function avesmapsTrafficLinkTargets(element) {
	var raw = element ? element.getAttribute("data-traffic-map") : "";
	if (!raw) {
		return null;
	}
	try {
		var parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch (error) {
		return null;
	}
}

// Ersetzt den Rohtext eines Containers durch anklickbare Namen. Läuft nur für
// Container, die WIRKLICH im Dokument stehen -- also je geöffnetem Popup einmal, nicht
// tausendfach beim Kartenaufbau.
function avesmapsTrafficLinkifyPending() {
	var pending = document.querySelectorAll("[data-traffic-raw]:not([data-traffic-done])");
	if (!pending.length) {
		return;
	}
	var esc = typeof escapeHtml === "function"
		? escapeHtml
		: function (value) { return String(value == null ? "" : value); };

	for (var i = 0; i < pending.length; i++) {
		var element = pending[i];
		element.setAttribute("data-traffic-done", "1");
		var raw = element.getAttribute("data-traffic-raw") || "";
		var targets = avesmapsTrafficLinkTargets(element);
		// Getrennt wird NUR an Komma und Semikolon: „Zedernstraße nach Mhanadistan"
		// ist EIN Eintrag. Namen ohne passenden Weg bleiben Text -- ein Link ins Leere
		// ist schlechter als keiner.
		element.innerHTML = raw.split(/\s*[,;]\s*/).filter(Boolean).map(function (part) {
			var name = part.trim();
			if (!name) {
				return "";
			}
			if (!avesmapsFindTrafficRouteEntry(name, targets)) {
				return esc(name);
			}
			// Das aufgelöste Ziel wandert an den Knopf, damit der Klick nicht erneut
			// zuordnen muss -- und im Titel sieht man, wie die Straße wirklich heißt.
			var resolved = (targets && targets[name]) || name;
			return '<button type="button" class="avesmaps-traffic-link" data-traffic-path="'
				+ esc(resolved) + '" title="' + esc(resolved) + ' auf der Karte zeigen">'
				+ esc(name) + "</button>";
		}).filter(Boolean).join(", ");
	}
}

// Ein Handler auf Dokumentebene, EINMAL registriert -- nicht je Popup, sonst stapeln
// sie sich bei jedem Öffnen (dieselbe Falle wie beim Spoiler-Schalter der
// Kartensammlung).
if (typeof document !== "undefined" && !document.__avesmapsTrafficLinksBound) {
	document.__avesmapsTrafficLinksBound = true;

	// Verlinkt, sobald ein Popup wirklich im Dokument steht. Entprellt, weil ein
	// geöffnetes Popup viele Mutationen auslöst.
	var trafficScanTimer = null;
	var scheduleTrafficScan = function () {
		window.clearTimeout(trafficScanTimer);
		trafficScanTimer = window.setTimeout(avesmapsTrafficLinkifyPending, 120);
	};
	if (typeof MutationObserver === "function") {
		new MutationObserver(scheduleTrafficScan).observe(document.documentElement, { childList: true, subtree: true });
	}

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

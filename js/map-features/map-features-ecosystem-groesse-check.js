// Der Prüfhaken „Zu große Flächen" (Owner 09.10.2026: „bau 1-3, prüfhaken auch").
//
// Färbt die Kontur jeder Landschaftsfläche orange, die zum Speichern zu groß ist (dick) oder ab 75 % der
// Grenze nah daran (dünner). Grenze und Stufen kommen aus ecosystem-groesse.js -- derselben Regel,
// nach der der Schreibkanal ablehnt und der Hinweisstreifen warnt. Eine Fläche, die der Haken nicht
// markiert, wird also auch nicht abgelehnt, und umgekehrt.
//
// 🔴 GESCHÄTZT AUS DER GESPEICHERTEN GEOMETRIE, nicht gemessen am Rumpf: es gibt hier keinen
// Speichervorgang. Der Zuschlag für Aktion, Kennung und Umschlag steckt in der Schätzung
// (AVESMAPS_SPEICHER_RUMPF_ZUSCHLAG), eine Fläche knapp an der Grenze kann deshalb um einige hundert Byte
// danebenliegen -- in der vorsichtigen Richtung.
//
// Bauart wie „Keine Wiki-Zuweisung" (map-features-wiki-zuweisung-check.js): die Marke geht über
// ecosystemAreaStyle in Farbe und Strichstärke der Kontur. Sichtbar ist sie also dort, wo Konturen
// gezeichnet werden -- in der Ebene, die man bearbeitet. Wie jener Haken BLENDET ER NICHTS EIN: Flächen
// gibt es nur in der Landschaften-Ansicht.
//
// ⚠️ Treffen beide Haken dieselbe Fläche, gewinnt dieser: eine Fläche, die sich nicht speichern lässt,
// ist das dringendere Problem als ein fehlender Wiki-Artikel (ecosystemAreaStyle).
// ⚠️ Klimabänder bleiben aussen vor: sie sind abgeleitet, niemand speichert sie von Hand.
(function avesmapsEcosystemGroesseCheck() {
	"use strict";

	// Je Fläche einmal gerechnet und gemerkt -- die Schätzung serialisiert die ganze Geometrie, und
	// ecosystemAreaStyle läuft bei jedem Neuzeichnen. Der Schlüssel trägt die Geometrie-Revision: ein
	// Speichern ändert sie, die Marke wird dann neu gerechnet.
	const gemerkt = new Map();

	function istVerfuegbar() {
		return typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE
			&& typeof map !== "undefined" && Boolean(map);
	}

	// 💣 Der Riegel `IS_EDIT_MODE` steht HIER und nicht nur am ausgeblendeten Menüeintrag:
	// `?toggleBigAreas=1` im geteilten Link erreicht sonst auch einen Besucher.
	window.avesmapsIstGroesseCheckAktiv = function avesmapsIstGroesseCheckAktiv() {
		return istVerfuegbar() && typeof $ === "function" && $("#toggleBigAreas").is(":checked");
	};

	// "" | "gross" | "zu_gross"
	window.avesmapsEcosystemGroesseMarkeFlaeche = function avesmapsEcosystemGroesseMarkeFlaeche(area) {
		if (!area || !avesmapsIstGroesseCheckAktiv() || String(area.kind) === "klima"
			|| typeof avesmapsEcosystemFlaechenGroesse !== "function") {
			return "";
		}
		const schluessel = `${area.public_id}#${area.geometry_revision ?? ""}`;
		if (!gemerkt.has(schluessel)) {
			const geometrie = area.geometry_geojson || area.geometry;
			const stufe = geometrie ? avesmapsEcosystemGroesseStufe(avesmapsEcosystemFlaechenGroesse(geometrie).bytes) : "ok";
			gemerkt.set(schluessel, stufe === "ok" ? "" : stufe);
		}
		return gemerkt.get(schluessel);
	};

	// 💣 DER TOKEN WIRD AUSGELESEN, NICHT DURCHGEREICHT: Leaflet schreibt `color` als SVG-Attribut, und
	// darin löst `var()` nicht auf (dieselbe Begründung wie bei avesmapsWikiZuweisungFarbe). Gepinnter
	// Kartenton, einmal gelesen.
	// 🔴 EIN Ton für beide Stufen -- die Stufe sagt die Strichstärke (avesmapsEcosystemGroesseStrich);
	// warum kein zweiter Ton, steht am Token in css/base/tokens.css.
	let farbe = "";
	window.avesmapsEcosystemGroesseFarbe = function avesmapsEcosystemGroesseFarbe() {
		if (!farbe) {
			farbe = getComputedStyle(document.documentElement).getPropertyValue("--color-check-area-size").trim()
				|| "#ff6d00";
		}
		return farbe;
	};

	// Dick heißt „wird nicht gespeichert", dünner „bald". Beide deutlich über der Grundkontur (2 px) und
	// der Wiki-Marke (3,5 px) -- bei „gross" bewusst darunter, damit die beiden Stufen nie gleich dick sind.
	window.avesmapsEcosystemGroesseStrich = function avesmapsEcosystemGroesseStrich(marke) {
		return marke === "zu_gross" ? 5 : 3;
	};

	// Nach dem Umlegen: ALLE Flächen neu stylen -- auch beim Ausschalten muss die Farbe dort weg, wo sie
	// eben noch lag.
	window.avesmapsSyncGroesseCheck = function avesmapsSyncGroesseCheck() {
		if (!istVerfuegbar()) {
			return;
		}
		if (typeof avesmapsRefreshEcosystemDisplay === "function") {
			avesmapsRefreshEcosystemDisplay();
		}
	};
})();

/*
 * Der Pruefhaken „Doppelte Beschriftungen" -- der Teil, der das DOM anfasst.
 * =========================================================================
 * Die REGEL steht nebenan in doppelte-beschriftung.js und ist rein. Hier steht alles, was sie nicht
 * darf: der Haken, der Index und das Nachziehen der zwei Zeichenflaechen.
 *
 * 🔴 ER STEHT IN DER GRUPPE „Pruefen", der Scheinwerfer „Freie Labels markieren" nicht -- und das
 * ist keine Kosmetik: dieser hier RECHNET einen Befund aus (ein Name steht mehrfach auf der Karte),
 * jener leuchtet nur eine gewaehlte Art an. Deshalb blendet dieser seine Funde auch ein (Owner
 * 02.09.2026, „dass ich auf allen zoomstufen die markierungen sehe") -- die Hausregel „ein
 * Pruefhaken ZEIGT seine Funde" (Owner 14.08.2026).
 */

(function () {
	"use strict";

	function istVerfuegbar() {
		return typeof IS_EDIT_MODE !== "undefined" && IS_EDIT_MODE
			&& typeof map !== "undefined" && Boolean(map);
	}

	// 💣 Der Riegel `IS_EDIT_MODE` steht HIER und nicht nur am ausgeblendeten Menueeintrag:
	// `?toggleDuplicateLabels=1` im geteilten Link erreicht sonst auch einen Besucher -- dieselbe
	// Falle, die bei „Offene Wegenden" schon einmal zugeschnappt ist.
	window.avesmapsIstDoppelteBeschriftungCheckAktiv = function avesmapsIstDoppelteBeschriftungCheckAktiv() {
		return istVerfuegbar() && $("#toggleDuplicateLabels").is(":checked");
	};

	// --- der Index ------------------------------------------------------------------------------
	//
	// ⭐ GEBAUT WIRD NUR BEI EINGESCHALTETEM HAKEN, und dann einmal je Sync statt einmal je Label:
	// `avesmapsLabelMarke` fragt fuer JEDE der 1017 Beschriftungen, und der Index laeuft ueber 1017
	// Namen plus 6041 Wege. Gemessen kostet ein Aufbau rund 4 ms -- pro Label waeren es 6 Sekunden.
	//
	// 💣 DIE ABLAGE HAENGT AN DEN BESTANDSGROESSEN, nicht an einer Zeitmarke: `prepareLabelData`
	// laeuft auch nach einem Live-Abgleich im Editor, und ein Index, der die geloeschte Beschriftung
	// von vorhin noch zaehlt, meldet eine Dublette, die es nicht mehr gibt. Dieselbe Bauform wie der
	// Wegpunkt-Cache (der misst ebenfalls die ANZAHL der Orte).
	// ⚠️ Sie faengt damit ein Umbenennen bei gleicher Anzahl NICHT -- deshalb wirft
	// avesmapsSyncDoppelteBeschriftungCheck sie zusaetzlich ausdruecklich weg. Ein Label-Speichern
	// geht durch dieselbe Naht.
	let ablage = null;

	window.avesmapsDoppelteBeschriftungAblageVerwerfen = function avesmapsDoppelteBeschriftungAblageVerwerfen() {
		ablage = null;
	};

	function index() {
		const labels = (typeof labelData !== "undefined" && Array.isArray(labelData)) ? labelData : [];
		const wege = (typeof pathData !== "undefined" && Array.isArray(pathData)) ? pathData : [];
		if (ablage && ablage.labels === labels.length && ablage.wege === wege.length) {
			return ablage.namen;
		}
		if (typeof avesmapsDoppelteBeschriftungIndex !== "function") {
			return null;
		}
		// 💣 DER ECHTE WEGNAME KOMMT VON `getPathTitleName`, UND ER WIRD NICHT NACHGEBAUT.
		// `properties.name` traegt im Browser den MASCHINENnamen (`Flussweg-2191`) -- der echte liegt
		// je nach Herkunft in `wiki_path.name`, `display_name` oder `original_name`, und genau diese
		// Kette kennt jene Funktion. Sie liefert "" fuer einen Weg ohne Menschennamen; die 3798
		// automatisch benannten fallen damit von selbst heraus.
		const wegNamen = typeof getPathTitleName === "function"
			? wege.map((weg) => getPathTitleName(weg)).filter(Boolean)
			: [];
		ablage = {
			labels: labels.length,
			wege: wege.length,
			namen: avesmapsDoppelteBeschriftungIndex(labels.map((l) => l.text), wegNamen),
		};
		return ablage.namen;
	}

	/**
	 * Traegt diese Beschriftung den Befund? Der Einstieg fuer den Trichter (label-markierungen.js).
	 */
	window.avesmapsDoppelteBeschriftungMarke = function avesmapsDoppelteBeschriftungMarke(label) {
		if (!avesmapsIstDoppelteBeschriftungCheckAktiv()
			|| typeof avesmapsIstDoppelteBeschriftung !== "function") {
			return false;
		}
		return avesmapsIstDoppelteBeschriftung(label, index());
	};


	// --- das Nachziehen -------------------------------------------------------------------------
	//
	// 💣 DREI DINGE IN EINEM AUFRUF, und das dritte ist neu gegenueber dem Scheinwerfer: weil ein
	// markierter Name sein Zoomband ueberspringt, aendert das Umlegen dieses Hakens die SICHTBARKEIT
	// -- `syncLabelVisibility` muss also mitlaufen, sonst kommen die Funde ausserhalb ihres Bandes
	// erst beim naechsten Zoomschritt auf die Karte.
	window.avesmapsSyncDoppelteBeschriftungCheck = function avesmapsSyncDoppelteBeschriftungCheck() {
		if (!istVerfuegbar()) {
			return;
		}
		avesmapsDoppelteBeschriftungAblageVerwerfen();
		if (typeof syncLabelVisibility === "function") {
			syncLabelVisibility();
		}
		if (typeof avesmapsLabelIconsNeuBauen === "function") {
			avesmapsLabelIconsNeuBauen();
		}
		if (typeof avesmapsKurvenlabelAblageVerwerfen === "function") {
			avesmapsKurvenlabelAblageVerwerfen();
		}
	};
})();

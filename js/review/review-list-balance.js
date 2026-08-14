/**
 * Die Bilanzzeile der acht WikiSync-Listen — EIN Erzeuger, nicht acht.
 *
 * 🔴 Sie trägt NUR, was sich durch die Filterung ändert. Owner 14.08.2026:
 * „eine Bilanzzeile unter der Suche, aber nur wenn die Bilanzzeile durch die filterung
 * beeinflusst wird (also z.B. A…= 103 von 1851 Regionen)". Die Zahlen des letzten Syncs
 * bewegen sich beim Tippen nicht und bleiben deshalb als stille Zeile ÜBER der Suche stehen.
 *
 * ⚠️ Die Zeile ist nie leer. Ungefiltert nennt sie die Gesamtzahl — sonst spränge die Liste
 * beim ersten Tastendruck um eine Zeile.
 *
 * 💣 Acht Kopien dieser Formel wären in drei Monaten wieder achtfach verschieden. Genau dieser
 * Zustand — dieselbe Angabe an acht Stellen unterschiedlich geschrieben — war der Anlass des
 * Umbaus: „1957 / 1957" bei Literatur, „200 von 1382" bei Vorkommen, ganze Sätze bei den
 * übrigen. Wer hier eine zweite Formel danebenstellt, stellt den Zustand wieder her.
 *
 * Entwurf: docs/superpowers/specs/2026-08-14-wikisync-listen-vereinheitlichung-design.md §4
 */
"use strict";

/**
 * Deutscher Tausenderpunkt. Bis 14.08.2026 machte ihn nur Vorkommen — im selben Panel standen
 * „Alle (3434)" und „Alle (5.104)" untereinander.
 */
function avesmapsListBalanceNumber(wert) {
	return Number(wert || 0).toLocaleString("de-DE");
}

/**
 * @param {string} wort      Substantiv im Nominativ Plural („Regionen", „Orte", „Werke").
 * @param {number} sichtbar  Zeilen nach Suche UND Filtertrichter.
 * @param {number} gesamt    Zeilen der aktiven Ansicht ohne Suche und Filter.
 * @param {string} [dativ]   Dativ Plural, falls die Faustregel ihn falsch bildet.
 * @returns {string}
 */
function avesmapsListBalanceText(wort, sichtbar, gesamt, dativ) {
	const g = Number(gesamt || 0);
	const s = Number(sichtbar || 0);
	if (g < 1) {
		return "Keine " + wort;
	}
	if (s >= g) {
		return avesmapsListBalanceNumber(g) + " " + wort;
	}
	// Faustregel Dativ Plural: die deutschen Wörter hier hängen -n an, außer sie enden schon so.
	// 💣 Sie gilt NICHT für die Vorkommen-Ansichten: „Fauna" und „Flora" sind lateinisch und
	// unveränderlich — die Faustregel machte daraus „Faunan". Diese Aufrufer geben den Dativ mit.
	const form = dativ || (/n$/.test(wort) ? wort : wort + "n");
	return avesmapsListBalanceNumber(s) + " von " + avesmapsListBalanceNumber(g) + " " + form;
}

/**
 * Schreibt die Bilanzzeile in ihr Element. Fehlt das Element, passiert nichts — die acht Listen
 * rendern teils, bevor ihr Abschnitt je sichtbar war.
 */
function avesmapsListBalanceRender(elementId, wort, sichtbar, gesamt, dativ) {
	const element = document.getElementById(elementId);
	if (!element) {
		return;
	}
	element.textContent = avesmapsListBalanceText(wort, sichtbar, gesamt, dativ);
}

if (typeof window !== "undefined") {
	window.avesmapsListBalanceNumber = avesmapsListBalanceNumber;
	window.avesmapsListBalanceText = avesmapsListBalanceText;
	window.avesmapsListBalanceRender = avesmapsListBalanceRender;
}
if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsListBalanceNumber, avesmapsListBalanceText, avesmapsListBalanceRender };
}

/*
 * „Freie Labels markieren" -- die REGEL, ohne DOM.
 * ===============================================
 * Owner 02.09.2026: „ich würd gerne alle freien labels vom typ z.B. ‚Fluss‘ markieren (roter
 * rahmen) […] mein ziel ist eigentlich die zu entfernen, die wir doppelt auf der karte haben
 * (z.B. Inoscha)".
 *
 * 🔴 ES IST KEIN PRUEFHAKEN, SONDERN EIN SCHEINWERFER. Die acht Haken der Gruppe „Prüfen" kennen
 * jeder einen BEFUND („nicht angebunden", „keine Wiki-Zuweisung") und rechnen ihn aus. Hier gibt
 * es keinen: welche zwei Namen dieselbe Sache meinen, entscheidet ein Mensch. Live gemessen am
 * 02.09.2026 tragen von den 19 Fluss-Beschriftungen genau 6 auch einen gleichnamigen Flussweg
 * (Escarra, Horne, Inoscha, Rôn, Selke, Weidenbach) -- die uebrigen 13 (die Mhanadi-Arme, die
 * Wasserfaelle) haben keinen und sind berechtigt. Eine Maschine, die daraus einen Befund macht,
 * meldet 13 Fehltreffer. Deshalb waehlt der Editor eine ART und sieht selbst nach.
 * ⚠️ Und deshalb steht das Feld unter „Mapstil" und nicht in der Gruppe „Prüfen": es ist eine
 * Einstellung der Anzeige, keine Fundliste.
 *
 * 🔴 REIN: kein DOM, kein `map`, kein Modulzustand. Alles, was der Browser dazu braucht -- das
 * Auswahlfeld, der Farbton, das Nachziehen der zwei Zeichenflaechen --, steht in
 * map-features-freie-label-markierung-check.js daneben. Dieselbe Zweiteilung wie bei
 * wiki-zuweisung.js / map-features-wiki-zuweisung-check.js.
 */

// Die zwei Sonderwerte des Auswahlfelds. Kein Labeltyp heisst so, und keiner darf je so heissen --
// `AVESMAPS_LABEL_ART_NAMEN` (js/ui/label-arten.js) traegt nur Kleinbuchstaben und Unterstriche.
const AVESMAPS_FREIE_LABEL_KEINE = "";
const AVESMAPS_FREIE_LABEL_ALLE = "*";

/**
 * Die Art einer Beschriftung.
 *
 * 💣 DERSELBE RUECKFALL WIE BEIM EINLESEN. `prepareLabelData` (map-features-labels.js) schreibt
 * `labelType: properties.feature_subtype || feature.feature_subtype || "region"` -- eine
 * Beschriftung ohne Art IST hier eine Region, und wer stattdessen "" zurueckgibt, laesst sie aus
 * jeder Auswahl fallen: sie waere die einzige, die sich nie markieren liesse.
 *
 * @param {object} label eine Beschriftung aus `labelData`
 * @returns {string} der Artschluessel
 */
function avesmapsFreieLabelArt(label) {
	const art = String((label && label.labelType) || "").trim();
	return art || "region";
}

/**
 * Traegt diese Beschriftung die Markierung?
 *
 * @param {object} label eine Beschriftung aus `labelData`
 * @param {string} wahl der Wert des Auswahlfelds ("" | "*" | ein Artschluessel)
 * @returns {boolean}
 */
function avesmapsFreieLabelMarkiert(label, wahl) {
	const gewaehlt = String(wahl === null || wahl === undefined ? "" : wahl).trim();
	if (!label || gewaehlt === AVESMAPS_FREIE_LABEL_KEINE) {
		return false;
	}
	if (gewaehlt === AVESMAPS_FREIE_LABEL_ALLE) {
		return true;
	}
	return avesmapsFreieLabelArt(label) === gewaehlt;
}

/**
 * Welche Arten liegen im Bestand, und wie viele je Art -- die Zeilen des Auswahlfelds.
 *
 * 🔴 DIE ANZAHL GEHOERT INS FELD. „Wald (175)" sagt vor dem Klick, was gleich passiert; ohne die
 * Zahl waehlt man blind zwischen einer Art mit 175 Namen und einer mit zweien.
 *
 * 💣 EINE UNBEKANNTE ART BEKOMMT TROTZDEM IHRE ZEILE, unter ihrem rohen Schluessel. Faellt sie
 * heraus, weil `avesmapsLabelArtName` sie (noch) nicht kennt, liessen sich ausgerechnet die
 * Beschriftungen nie markieren, die am ehesten Handarbeit brauchen -- und es faellt niemandem auf,
 * weil eine fehlende Zeile in einer Auswahlliste nichts meldet. Live betrifft das heute keine
 * einzige, aber die Tabelle ist Handarbeit und die naechste neue Art kommt vor ihrem Eintrag.
 *
 * ⚠️ Sortiert nach dem ANZEIGENAMEN, nicht nach der Anzahl: das Feld ist ein Nachschlagewerk
 * („wo ist Fluss?"), keine Rangliste. `localeCompare` mit "de", damit Ü hinter U steht.
 *
 * @param {Array<object>} labels der Bestand (`labelData`)
 * @returns {Array<{art: string, name: string, anzahl: number}>}
 */
function avesmapsFreieLabelArtenListe(labels) {
	const zaehler = new Map();
	(Array.isArray(labels) ? labels : []).forEach((label) => {
		const art = avesmapsFreieLabelArt(label);
		zaehler.set(art, (zaehler.get(art) || 0) + 1);
	});
	const namen = typeof avesmapsLabelArtName === "function" ? avesmapsLabelArtName : () => "";
	return [...zaehler.entries()]
		.map(([art, anzahl]) => ({ art, name: namen(art) || art, anzahl }))
		.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_FREIE_LABEL_KEINE,
		AVESMAPS_FREIE_LABEL_ALLE,
		avesmapsFreieLabelArt,
		avesmapsFreieLabelMarkiert,
		avesmapsFreieLabelArtenListe,
	};
}

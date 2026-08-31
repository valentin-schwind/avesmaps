/*
 * Bauwerk oder Siedlung? -- EINE Frage, vier Leser im Browser.
 * ===========================================================
 * Das Gegenstueck zu api/_internal/ortsklassen.php; die Begruendung steht dort ausfuehrlich.
 * Kurz: `gebaeude` war Klasse UND Merkmal in einem, solange es genau eine Bauwerksklasse gab.
 * Mit `stadtviertel` (Owner 30.08.2026) sind es zwei, und ein `locationType === "gebaeude"` haette
 * das Viertel STILL als Siedlung behandelt -- als Kreis statt als Raute, und im Editor im falschen
 * Unterfilter.
 *
 * 🔴 Vier Leser, und sie liegen in DREI Dokumenten: die zwei Marker-Zeichner und die Panel-Liste
 * im Kartenfenster (index.html), dazu die Liste im Ortseditor
 * (html/wiki-sync-settlement-editor.html), der ein eigenstaendiges iframe-Dokument ist und das
 * Ruestzeug des Hauptfensters nicht laedt. Deshalb steht das hier abhaengigkeitsfrei -- dieselbe
 * Bauform wie js/ui/label-arten.js und js/ui/ribbon-menu.js.
 *
 * ⚠️ Die Liste traegt NUR das Vokabular, nie die Rueckfall-Politik: was ein unbekannter Wert
 * bedeutet, entscheidet der Aufrufer. Hier ist ein unbekannter Wert schlicht kein Bauwerk.
 */

const AVESMAPS_BAUWERKSKLASSEN = ["gebaeude", "stadtviertel"];

/**
 * Ist diese Ortsklasse ein Bauwerk (und damit keine Siedlung)?
 *
 * @param {string} klasse der gespeicherte Slug (feature_subtype bzw. settlement_class)
 * @returns {boolean}
 */
function avesmapsIstBauwerksklasse(klasse) {
	return AVESMAPS_BAUWERKSKLASSEN.indexOf(
		String(klasse === null || klasse === undefined ? "" : klasse).trim()
	) !== -1;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { AVESMAPS_BAUWERKSKLASSEN, avesmapsIstBauwerksklasse };
}

// Die Klickfolge „erst die ganze Strasse, dann der Abschnitt" (Entwurf 2026-09-14 §3.1) als REINE Regel:
// kein DOM, kein Leaflet, kein Modulzustand. Zustand und Linienfarbe leben in map-features-weg-auswahl.js.
// ⚠️ Normales Skript, NICHT in <template data-nur-editor> (nur-editor-skripte.test.js, Teil C).

/**
 * REIN: der Zustand nach einem Klick auf den Abschnitt `publicId` der Strasse `gruppe`.
 * @param {{gruppe: string, publicId: (string|null)}|null} vorher
 */
function avesmapsWegAuswahlNachKlick(vorher, gruppe, publicId) {
	const key = String(gruppe || "");
	const id = String(publicId || "");
	if (!key || !id) { return null; }
	if (!vorher || vorher.gruppe !== key) { return { gruppe: key, publicId: null }; }
	if (vorher.publicId === id) { return { gruppe: key, publicId: null }; }
	return { gruppe: key, publicId: id };
}

/** REIN: die public_ids, die gelb werden. */
function avesmapsWegAuswahlIds(auswahl, gruppenIds) {
	if (!auswahl) { return []; }
	if (auswahl.publicId !== null && auswahl.publicId !== undefined) { return [String(auswahl.publicId)]; }
	return (Array.isArray(gruppenIds) ? gruppenIds : []).map(String);
}

/** REIN: „Ganze Straße: A – B" bzw. „Abschnitt: A – B"; ohne Enden nur das Wort (Entwurf §4). */
function avesmapsWegMarkierungszeile(auswahl, strecke) {
	if (!auswahl) { return ""; }
	const wort = auswahl.publicId === null || auswahl.publicId === undefined ? "Ganze Straße" : "Abschnitt";
	const text = String(strecke || "").trim();
	return text ? wort + ": " + text : wort;
}

function avesmapsWegAuswahlEsc(wert) {
	return String(wert == null ? "" : wert)
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** REIN: dieselbe Zeile als HTML, das Wort fett (wie im Mockup). */
function avesmapsWegMarkierungszeileMarkup(auswahl, strecke) {
	const text = avesmapsWegMarkierungszeile(auswahl, strecke);
	if (!text) { return ""; }
	const trenner = text.indexOf(": ");
	return trenner === -1
		? "<b>" + avesmapsWegAuswahlEsc(text) + "</b>"
		: "<b>" + avesmapsWegAuswahlEsc(text.slice(0, trenner + 1)) + "</b> " + avesmapsWegAuswahlEsc(text.slice(trenner + 2));
}

/** REIN: „Verlauf bearbeiten" gibt es nur am Abschnitt -- eine Linienaenderung ueber eine ganze Strasse nicht (§3.4). */
function avesmapsWegVerlaufKachelErlaubt(auswahl) {
	return !auswahl || (auswahl.publicId !== null && auswahl.publicId !== undefined);
}

/** REIN: traegt dieser Abschnitt den Artikel als WEITERE Zuweisung? */
function avesmapsWegTraegtWeiteren(way, wikiKey) {
	const key = String(wikiKey || "");
	return Boolean(key) && (Array.isArray(way && way.wiki_path_weitere) ? way.wiki_path_weitere : [])
		.some((eintrag) => String((eintrag && eintrag.wiki_key) || "") === key);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWegAuswahlNachKlick, avesmapsWegAuswahlIds, avesmapsWegMarkierungszeile,
		avesmapsWegMarkierungszeileMarkup, avesmapsWegVerlaufKachelErlaubt, avesmapsWegTraegtWeiteren,
	};
}

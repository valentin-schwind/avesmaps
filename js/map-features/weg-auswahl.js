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

/** REIN: kleinster Abstand des Punkts [x, y] zu einer Linie aus [x, y]-Punkten, in Karteneinheiten. Infinity ohne Linie. */
function avesmapsWegAbstandZurLinie(punkt, koordinaten) {
	const px = Number(punkt && punkt[0]);
	const py = Number(punkt && punkt[1]);
	const liste = Array.isArray(koordinaten) ? koordinaten : [];
	if (!Number.isFinite(px) || !Number.isFinite(py) || liste.length === 0) { return Infinity; }
	let bester = Infinity;
	for (let i = 0; i < liste.length; i++) {
		const a = liste[i];
		const b = liste[Math.min(i + 1, liste.length - 1)];
		const ax = Number(a[0]); const ay = Number(a[1]);
		const dx = Number(b[0]) - ax; const dy = Number(b[1]) - ay;
		const laenge2 = dx * dx + dy * dy;
		const t = laenge2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / laenge2)) : 0;
		const abstand = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
		if (abstand < bester) { bester = abstand; }
	}
	return bester;
}

/**
 * REIN: welcher Abschnitt eines Namens liegt dem Klickpunkt am naechsten (Nachtrag 2026-09-14-wege-mehrfachzuweisung-
 * design.md §9.4)? Das Namensregister des Overlays kennt nur den Wiki-Schluessel, keine `public_id`.
 * @param {Array<{public_id: string, koordinaten: Array}>} abschnitte  in der Nummernfolge des Wege-Editors
 * @param {Array<number>} punkt  [x, y] -- ⚠️ GeoJSON-Ordnung, der Aufrufer dreht Leaflets latlng
 * @return {string|null}  bei Gleichstand der erste
 */
function avesmapsWegNaechsterAbschnitt(abschnitte, punkt) {
	let bester = null;
	let besterAbstand = Infinity;
	(Array.isArray(abschnitte) ? abschnitte : []).forEach((abschnitt) => {
		if (!abschnitt || !abschnitt.public_id) { return; }
		const abstand = avesmapsWegAbstandZurLinie(punkt, abschnitt.koordinaten);
		if (abstand < besterAbstand) {
			bester = String(abschnitt.public_id);
			besterAbstand = abstand;
		}
	});
	return bester;
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWegAuswahlNachKlick, avesmapsWegAuswahlIds, avesmapsWegMarkierungszeile,
		avesmapsWegMarkierungszeileMarkup, avesmapsWegVerlaufKachelErlaubt, avesmapsWegTraegtWeiteren,
		avesmapsWegAbstandZurLinie, avesmapsWegNaechsterAbschnitt,
	};
}

// Die Klickfolge auf der KARTE (Entwurf 2026-09-14 §3): der erste Klick markiert die ganze Strasse, der zweite
// den Abschnitt. Die Regel steht rein in weg-auswahl.js; hier nur Zustand, Linienfarbe und Aufheben.
// 🔴 NUR IM BEARBEITEN-MODUS. Besucher klicken wie bisher (E4 gilt dem Bearbeiten).
// ⚠️ Normales Skript, NICHT in <template data-nur-editor>: der Klick-Zuhoerer in
// map-features-path-rendering.js nennt diese Namen, und der laedt fuer jeden (nur-editor-skripte.test.js).

// Der Strich fremder Traeger: angezeigt, nicht mitbearbeitet (§3.3). Kein Farbwert, daher kein Token.
const AVESMAPS_WEG_AUSWAHL_STRICH = "8 8";

let avesmapsWegAuswahlStand = null;           // {gruppe, publicId|null} oder null
let avesmapsWegAuswahlMarkiert = new Set();   // public_ids mit gelber Linie
let avesmapsWegAuswahlTraeger = new Set();    // fremde Abschnitte mit dem Artikel als weiterer Zuweisung
let avesmapsWegAuswahlVerdrahtet = false;

// 💣 Gelesen, nie abgeschrieben: dieselbe Farbe wie die Hervorhebung der Suche (Entwurf §3.3).
function avesmapsWegAuswahlFarbe() {
	return typeof SPOTLIGHT_PATH_HIGHLIGHT_STYLE !== "undefined" && SPOTLIGHT_PATH_HIGHLIGHT_STYLE
		? SPOTLIGHT_PATH_HIGHLIGHT_STYLE.color || null
		: null;
}

/**
 * Die Mittellinie nach dem Zustand faerben. Gerufen am ENDE von updatePathLayerStyle -- damit ueberlebt die
 * Markierung jedes Neufaerben, ohne dass ein Neufaerber sie kennen muss.
 * 💣 updatePathLayerStyle setzt `dashArray` nie zurueck: der Strich eines ehemaligen Traegers wird HIER entfernt.
 */
function avesmapsWegAuswahlStilNachziehen(path) {
	const mitte = path && Array.isArray(path._pathLines) ? path._pathLines[1] : null;
	if (!mitte || typeof mitte.setStyle !== "function") { return; }
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	const farbe = avesmapsWegAuswahlFarbe();
	if (farbe && avesmapsWegAuswahlMarkiert.has(id)) {
		mitte.setStyle({ color: farbe, dashArray: null });
	} else if (farbe && avesmapsWegAuswahlTraeger.has(id)) {
		mitte.setStyle({ color: farbe, dashArray: AVESMAPS_WEG_AUSWAHL_STRICH });
	} else if (mitte.options && mitte.options.dashArray) {
		mitte.setStyle({ dashArray: null });
	}
}

function avesmapsWegAuswahlNeuZeichnen(ids) {
	ids.forEach((id) => {
		const pfad = typeof findPathByPublicId === "function" ? findPathByPublicId(id) : null;
		if (!pfad) { return; }
		if (typeof updatePathLayerStyle === "function") { updatePathLayerStyle(pfad); }
		// Markierungszeile und Editorband stehen im zwischengespeicherten Markup (path._popupMarkup).
		if (typeof refreshPathLayerPopup === "function") { refreshPathLayerPopup(pfad); }
	});
}

function avesmapsWegAuswahlSetzen(stand, abschnitt) {
	const vorher = new Set([...avesmapsWegAuswahlMarkiert, ...avesmapsWegAuswahlTraeger]);
	avesmapsWegAuswahlStand = stand;
	avesmapsWegAuswahlMarkiert = new Set();
	avesmapsWegAuswahlTraeger = new Set();
	if (stand && abschnitt) {
		const gruppenIds = abschnitt.gruppe.segments.map((way) => way.public_id);
		avesmapsWegAuswahlMarkiert = new Set(avesmapsWegAuswahlIds(stand, gruppenIds));
		// Fremde Traeger nur bei der GANZEN Strasse eines ARTIKELS -- eine Namensgruppe hat keinen Schluessel.
		const key = stand.publicId === null && stand.gruppe.indexOf("wiki:") === 0 ? stand.gruppe.slice(5) : "";
		if (key && typeof avesmapsWegTraegerIndex === "function") {
			(avesmapsWegTraegerIndex().get(key) || []).forEach((traeger) => {
				const id = getPathPublicId(traeger);
				if (!avesmapsWegAuswahlMarkiert.has(id)) { avesmapsWegAuswahlTraeger.add(id); }
			});
		}
	}
	avesmapsWegAuswahlNeuZeichnen(new Set([...vorher, ...avesmapsWegAuswahlMarkiert, ...avesmapsWegAuswahlTraeger]));
}

function avesmapsWegAuswahlKlick(path) {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) { return null; }
	const abschnitt = typeof avesmapsWegAbschnittAufKarte === "function" ? avesmapsWegAbschnittAufKarte(path) : null;
	if (!abschnitt) { return null; }
	const stand = avesmapsWegAuswahlNachKlick(avesmapsWegAuswahlStand, abschnitt.gruppe.key, abschnitt.way.public_id);
	avesmapsWegAuswahlSetzen(stand, stand ? abschnitt : null);
	return stand;
}

function avesmapsWegAuswahlAufheben() {
	if (!avesmapsWegAuswahlStand) { return; }
	avesmapsWegAuswahlSetzen(null, null);
	if (typeof window !== "undefined" && typeof window.avesmapsRefreshInfopanel === "function") {
		window.avesmapsRefreshInfopanel();
	}
}

/** Die Auswahl, wenn DIESER Pfad markiert ist (als Abschnitt oder als Teil der ganzen Strasse); sonst null. */
function avesmapsWegAuswahlFuerPfad(path) {
	const id = typeof getPathPublicId === "function" ? getPathPublicId(path) : "";
	return avesmapsWegAuswahlStand && avesmapsWegAuswahlMarkiert.has(id) ? { ...avesmapsWegAuswahlStand } : null;
}

/** Die Pfade der ganzen Strasse dieses Pfads, in der Nummernfolge des Wege-Editors. */
function avesmapsWegAuswahlGruppenPfade(path) {
	const ways = typeof avesmapsWegGruppeAufKarte === "function" ? avesmapsWegGruppeAufKarte(path) : [];
	return ways
		.map((way) => (typeof findPathByPublicId === "function" ? findPathByPublicId(way.public_id) : null))
		.filter(Boolean);
}

function avesmapsWegAuswahlVerdrahten() {
	if (avesmapsWegAuswahlVerdrahtet || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) { return; }
	if (typeof map === "undefined" || !map || typeof map.on !== "function") { return; }
	avesmapsWegAuswahlVerdrahtet = true;
	// Ein Klick daneben hebt die Markierung auf (§3.1). Ein Klick AUF einen Weg erreicht die Karte nicht:
	// beide Linien tragen `bubblingMouseEvents: false` (createPathLayer).
	map.on("click", avesmapsWegAuswahlAufheben);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsWegAuswahlKlick, avesmapsWegAuswahlAufheben, avesmapsWegAuswahlFuerPfad,
		avesmapsWegAuswahlGruppenPfade, avesmapsWegAuswahlStilNachziehen, avesmapsWegAuswahlVerdrahten,
	};
}

// Die Karten-Beschriftungen (Regionen, Landschaften, Meere, Gipfel) bei BEDARF rastern statt alle
// beim Start. Vorgabe AUS; `?labelbedarf=1` schaltet ein.
//
// 💣 DER BEFUND. `prepareLabelData` legt beim Kaltstart fuer JEDE Beschriftung sofort ein Icon an --
// das heisst je Beschriftung eine Canvas plus ein synchrones `toDataURL()` -- und baut im
// Ansichtsmodus zusaetzlich das vollstaendige Popup-Markup. Live gemessen am 26.08.2026: rund 940
// Beschriftungen, davon 1,2-1,7 s in dem 2,788 s langen Stillstand nach dem Start, in dem auch die
// Windrose des Startschleiers stehenbleibt. Sichtbar ist bei Startzoom 3 ein Bruchteil.
//
// ⭐ DAS MUSTER STEHT NEBENAN. `createLocationNameLabelEntry`
// (js/map-features/map-features-location-name-labels.js) legt seine ~3000 Siedlungsnamen seit
// laengerem mit einem LEEREN Platzhalter-Icon an und rastert erst in
// `syncLocationNameLabelVisibility`, wenn ein Name wirklich sichtbar wird. Hier ist dasselbe, eine
// Beschriftungsart weiter.
//
// 🔴 VORGABE AUS, UND DAS IST KEINE VORSICHT, SONDERN DIE HAUSREGEL. Dieser Umbau aendert, WAS
// gezeichnet wird, und niemand schaut zu, waehrend er entsteht. Am 27.08.2026 sind zwei
// Zoom-Aenderungen live gegangen, die nach der ZAHL besser und nach dem BILD schlechter waren; der
// URL-Schalter war beide Male der Ausweg (Owner: „probiers unter neuem parameter"). Das Projekt hat
// die Form laengst: `?crossfade=0`, `?parallelfade=0`, `?zoomlupe=N`, `?markerscale=0`,
// `?labelparallel=0`, `?zoombuendel=0`. Ueber die Umstellung entscheidet der Owner an seinem Bild,
// nicht diese Datei an ihrer Zahl.
//
// 🔴 DIE REIHENFOLGE IN routing.js BLEIBT UNBERUEHRT, UND SIE IST TRAGEND. `prepareLabelData` laeuft
// VOR `preparePathData`, weil ein Weg-Popup in seinem „Verlauf" die Landschaften verlinkt, die es
// nennt, und der Index dafuer aus `labelMarkers` in genau diesem Moment gebaut wird
// (map-features-path-item-links.js). Deshalb entstehen die Eintraege in `labelMarkers` weiterhin
// VOLLZAEHLIG und sofort -- gespart wird ausschliesslich ihr BILD und ihr POPUP-Markup, nicht ihr
// Eintrag. Wer daran je etwas verschiebt, laesst jede Landschaft in bereits gebautem Markup
// unverlinkt.
//
// Geladen von index.html VOR map-features-labels.js: `const` auf Dateiebene wird in einem
// klassischen Script nicht gehoistet, spaeter geladen stuende hier `undefined`.
// Bewacht von js/map-features/__tests__/label-bedarf.test.js.

const AVESMAPS_LABEL_BEDARF_AN = (() => {
	try {
		// Dieselbe tolerante Lesart wie beim Zeichen-Buendler: ein zweites `?` in der Adresse (aus einem
		// zusammengesetzten Link) darf den Schalter nicht verschlucken.
		return new URLSearchParams(String(window.location.search || "").replace(/\?/g, "&")).get("labelbedarf") === "1";
	} catch (fehler) {
		return false;   // ohne Adresszeile gilt die Vorgabe
	}
})();

// 🔴 DIE WIRKUNG SOLL EINE ZAHL SEIN, KEIN EINDRUCK. Dasselbe Motiv wie bei `avesmapsZeichenBilanz()`
// (js/map-features/zeichen-buendel.js): ohne Zaehler bliebe „fuehlt sich schneller an", und genau
// daran ist am 27.08.2026 schon ein Umbau gescheitert.
//
// 💣 UND DER ZAEHLER LAEUFT IN BEIDEN ZUSTAENDEN, mit und ohne Schalter. Wer nur den neuen Zustand
// misst, vergleicht zwei Messungen, die verschieden zustande kamen.
const avesmapsLabelBilanzStand = {
	bedarf: AVESMAPS_LABEL_BEDARF_AN,
	gerastert: 0,        // Aufrufe von createLabelIcon insgesamt (jeder ist eine Canvas + ein toDataURL)
	beimStart: 0,        // davon bis zum Ende von prepareLabelData -- die Zahl, um die es hier geht
	popups: 0,           // im Voraus gebaute Beschriftungs-Popups (Ansichtsmodus)
	popupsBeimStart: 0,  // davon bis zum Ende von prepareLabelData
	labels: 0,           // Eintraege in labelMarkers nach prepareLabelData -- die Gegenprobe, dass nichts fehlt
	prepareMs: 0,        // Dauer von prepareLabelData
};

/** Ist die Rasterung bei Bedarf eingeschaltet? (`?labelbedarf=1`) */
function avesmapsLabelBedarfAktiv() {
	return AVESMAPS_LABEL_BEDARF_AN;
}

/** Eine Beschriftung wurde gerastert (Canvas + toDataURL). */
function avesmapsLabelGerastertZaehlen() {
	avesmapsLabelBilanzStand.gerastert += 1;
}

/** Ein Beschriftungs-Popup wurde im Voraus als Markup gebaut. */
function avesmapsLabelPopupZaehlen() {
	avesmapsLabelBilanzStand.popups += 1;
}

/**
 * Haelt den Stand am Ende von `prepareLabelData` fest -- den Startzustand, um den es hier geht.
 *
 * @param {number} labelAnzahl Eintraege in labelMarkers (die Gegenprobe: darf sich NICHT aendern)
 * @param {number} dauerMs Dauer von prepareLabelData
 */
function avesmapsLabelStartFesthalten(labelAnzahl, dauerMs) {
	avesmapsLabelBilanzStand.labels = Number(labelAnzahl) || 0;
	avesmapsLabelBilanzStand.prepareMs = Math.round((Number(dauerMs) || 0) * 10) / 10;
	avesmapsLabelBilanzStand.beimStart = avesmapsLabelBilanzStand.gerastert;
	avesmapsLabelBilanzStand.popupsBeimStart = avesmapsLabelBilanzStand.popups;
}

/** Die Bilanz als Kopie -- in der Konsole ablesbar: `avesmapsLabelBilanz()`. */
function avesmapsLabelBilanz() {
	return Object.assign({}, avesmapsLabelBilanzStand);
}

/** Setzt die Zaehler zurueck (fuer eine zweite Messung im selben Tab). */
function avesmapsLabelBilanzZuruecksetzen() {
	avesmapsLabelBilanzStand.gerastert = 0;
	avesmapsLabelBilanzStand.beimStart = 0;
	avesmapsLabelBilanzStand.popups = 0;
	avesmapsLabelBilanzStand.popupsBeimStart = 0;
	avesmapsLabelBilanzStand.labels = 0;
	avesmapsLabelBilanzStand.prepareMs = 0;
}

// Node-Export (im Browser inert, dort sind es schlicht Globale).
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsLabelBedarfAktiv,
		avesmapsLabelGerastertZaehlen,
		avesmapsLabelPopupZaehlen,
		avesmapsLabelStartFesthalten,
		avesmapsLabelBilanz,
		avesmapsLabelBilanzZuruecksetzen,
	};
}

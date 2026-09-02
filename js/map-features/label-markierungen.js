/*
 * Traegt diese Beschriftung einen Kasten -- und welchen? DER TRICHTER.
 * ===================================================================
 * Es gibt ZWEI Werkzeuge, die einen Rahmen um eine Kartenbeschriftung ziehen:
 *   „Freie Labels markieren"  -- ein SCHEINWERFER auf eine gewaehlte Labelart (Anzeige-Menue,
 *                                unter „Mapstil"), karminrot.
 *   „Doppelte Beschriftungen" -- ein BEFUND: der Name steht mehrfach auf der Karte (Gruppe
 *                                „Pruefen"), violett.
 * Und es gibt DREI Leser: der waagerechte Name (divIcon, CSS-Klasse), der gebogene (Canvas,
 * gemalter Rahmen) und die Sichtbarkeit (ein markierter Name steht auf JEDER Zoomstufe).
 *
 * 💣 ZWEI WERKZEUGE MAL DREI LESER SIND SECHS STELLEN, an denen dieselbe Frage beantwortet wird --
 * und die naechste Markierung waere die neunte. Genau daran ist in diesem Haus schon die
 * Verkehrsmittel-Sperre gescheitert (eine Regel, die einen von vier Erzeugern bindet, ist keine
 * Regel). Deshalb fragt jeder Leser NUR hier, und ein drittes Werkzeug kostet eine Zeile in
 * `MARKIERER`.
 *
 * 🔴 DER BEFUND SCHLAEGT DEN SCHEINWERFER. Wer „Fluss" anleuchtet und gleichzeitig die Dubletten
 * sucht, will bei einem doppelten Flussnamen den BEFUND sehen -- die Art kennt er schon, er hat sie
 * selbst gewaehlt. Die Reihenfolge in `MARKIERER` IST diese Regel; die erste Marke gewinnt.
 *
 * 🔴 REIN GENUG, UM GEPRUEFT ZU WERDEN: die Datei kennt kein DOM und keinen Zustand. Sie ruft die
 * zwei Werkzeug-Module ueber `typeof`-Riegel -- fehlt eins, gibt es eben keine Marke.
 */

// Reihenfolge = Rangfolge. Jeder Eintrag: der Name der Frage-Funktion und die Marke, die sie ergibt.
// 💣 Die Klassennamen sind zugleich die CSS-Modifikatoren (css/features/map-labels.css) und die
// Schluessel der Farbtabelle unten -- drei Verwendungen, EINE Zeichenkette.
const AVESMAPS_LABEL_MARKIERER = [
	{ marke: "doppelt", frage: "avesmapsDoppelteBeschriftungMarke", token: "--color-check-duplicate-label" },
	{ marke: "markiert", frage: "avesmapsFreieLabelMarke", token: "--color-check-free-label" },
];

/**
 * Welche Marke traegt diese Beschriftung?
 *
 * @param {object} label eine Beschriftung aus `labelData`
 * @returns {string} "doppelt" | "markiert" | "" (keine)
 */
function avesmapsLabelMarke(label) {
	if (!label) {
		return "";
	}
	for (const eintrag of AVESMAPS_LABEL_MARKIERER) {
		const frage = typeof globalThis !== "undefined" ? globalThis[eintrag.frage] : undefined;
		if (typeof frage === "function" && frage(label) === true) {
			return eintrag.marke;
		}
	}
	return "";
}

/**
 * Die CSS-Klasse fuer den waagerechten Namen (divIcon) -- mit fuehrendem Leerzeichen oder "".
 */
function avesmapsLabelMarkeKlasse(label) {
	const marke = avesmapsLabelMarke(label);
	return marke ? ` map-label--${marke}` : "";
}

/**
 * Der Farbton fuer den gemalten Rahmen am gebogenen Namen.
 *
 * 💣 AUSGELESEN, NICHT DURCHGEREICHT: im 2D-Kontext loest `var()` nicht auf, der Rahmen bliebe
 * schwarz. Hausmuster, siehe avesmapsWikiZuweisungFarbe. Einmal gelesen und behalten -- die Toene
 * sind in tokens.css gepinnt (kein Dark-Override, sie liegen auf den immer hellen Kartenkacheln).
 *
 * @param {string} marke das Ergebnis von avesmapsLabelMarke
 * @returns {string} eine Farbe, oder "" wenn keine Marke
 */
const avesmapsLabelMarkeFarben = {};
function avesmapsLabelMarkeFarbe(marke) {
	const eintrag = AVESMAPS_LABEL_MARKIERER.find((e) => e.marke === marke);
	if (!eintrag) {
		return "";
	}
	if (!avesmapsLabelMarkeFarben[eintrag.token]) {
		const gelesen = (typeof getComputedStyle === "function" && typeof document !== "undefined")
			? getComputedStyle(document.documentElement).getPropertyValue(eintrag.token).trim()
			: "";
		// ⚠️ Die Rueckfallwerte sind die Notbremse, wenn der Token fehlt -- geaendert wird der Wert
		// IMMER in tokens.css. Zeichengleich zu halten ist Pflicht (der Test haelt beide gegeneinander).
		avesmapsLabelMarkeFarben[eintrag.token] = gelesen
			|| (marke === "doppelt" ? "#6a1b9a" : "#d1005d");
	}
	return avesmapsLabelMarkeFarben[eintrag.token];
}

/**
 * Steht diese Beschriftung wegen einer Markierung auf JEDER Zoomstufe?
 *
 * 🔴 Owner 02.09.2026: „mach dass die anzeigen zoomstufen unabhängig sind (sprich, dass ich auf
 * allen zoomstufen die markierungen sehe)". Das nimmt die Zusage „blendet nichts ein" vom selben
 * Tag ausdruecklich zurueck und stellt die aeltere Hausregel wieder her: ein Pruefhaken ZEIGT seine
 * Funde (Owner 14.08.2026).
 * ⚠️ Es hebt NUR das Zoomband auf -- nicht den Labels-Schalter, nicht „Regionname anzeigen", nicht
 * die Landschaftsebene und nicht das Culling am Bildrand. Ein Werkzeug, das einen ausgeschalteten
 * Schalter ueberstimmt, ist kein Werkzeug mehr, sondern eine Ueberraschung.
 */
function avesmapsLabelMarkeHebtZoomband(label) {
	return avesmapsLabelMarke(label) !== "";
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_LABEL_MARKIERER,
		avesmapsLabelMarke,
		avesmapsLabelMarkeKlasse,
		avesmapsLabelMarkeFarbe,
		avesmapsLabelMarkeHebtZoomband,
	};
}

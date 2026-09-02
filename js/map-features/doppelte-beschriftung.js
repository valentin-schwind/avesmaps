/*
 * Der Pruefhaken „Doppelte Beschriftungen" -- die REGEL, ohne DOM.
 * ================================================================
 * Owner 02.09.2026, nach dem Scheinwerfer nebenan: „mach den haken für doppelte beschriftungen".
 *
 * 🔴 ZWEI SORTEN DUBLETTE, UND DIE ZWEITE IST DIE GEMELDETE. Am Livebestand vom 02.09.2026:
 *   (a) derselbe Name mehrfach als freie Beschriftung -- 34 Namen, 72 Beschriftungen
 *       (Yaquirtal viermal, Hexenwald und Ingvaltal dreimal).
 *   (b) eine freie Beschriftung UND ein gleichnamiger WEG -- 9 Beschriftungen, darunter der
 *       gemeldete Fall: „Inoscha" steht einmal als freies Label und einmal als Name seines
 *       Flusswegs, beide praktisch auf demselben Punkt.
 * Wer nur (a) baut, findet den Fall nicht, der den Haken ausgeloest hat. Wer nur `labelData` gegen
 * sich selbst haelt, sieht (b) nie.
 *
 * 💣 DIE NAMEN WERDEN HEREINGEREICHT, NICHT AUS DEN OBJEKTEN GELESEN. Im Browser traegt
 * `properties.name` eines Weges den MASCHINENnamen (`normalizeRoutePathFeature` schreibt beim Laden
 * `<Art>-<n>` hinein und legt den echten nach `original_name`) -- eine Regel, die hier selbst
 * nachschlaegt, misst tadellos und ist live wirkungslos. Genau das hat der Pruefhaken „Keine
 * Wiki-Zuweisung" am 01.09.2026 gekostet: er erklaerte ALLE 6041 Wege fuer „nicht gemeint", waehrend
 * beide Tests gruen waren, weil sie die ROHE Nutzlast nachbauten. Wer die Antwort hereinreicht, kann
 * kein Feld verwechseln.
 *
 * 🔴 REIN: kein DOM, kein `map`, kein Modulzustand. Alles Uebrige steht nebenan in
 * map-features-doppelte-beschriftung-check.js -- dieselbe Zweiteilung wie bei wiki-zuweisung.js.
 */

/**
 * Der Vergleichsschluessel eines Namens.
 *
 * ⚠️ Getrimmt und kleingeschrieben (deutsche Regeln, damit „Ä" und „ä" zusammenfallen). Am
 * Livebestand aendert das heute nichts -- es gibt keine Gross-/Kleinschreibvariante --, aber ein
 * Haken, der „Hexenwald" und „hexenwald" fuer verschiedene Dinge haelt, verfehlt genau die
 * Handarbeit, die er finden soll.
 * 🪤 KEIN Abschneiden von Klammerzusaetzen und kein Fuzzy-Vergleich: „Nostria (Siedlung)" und
 * „Nostria" sind zwei Eintraege, und der Haken behauptet hier nichts, was er nicht messen kann --
 * dieselbe Regel wie beim Statuskreis der Vorkommen.
 *
 * @param {string} name
 * @returns {string} der Schluessel, oder "" fuer einen leeren Namen
 */
function avesmapsBeschriftungsSchluessel(name) {
	return String(name === null || name === undefined ? "" : name).trim().toLocaleLowerCase("de");
}

/**
 * Welche Namen kommen doppelt vor?
 *
 * @param {Array<string>} labelNamen die Namen ALLER freien Beschriftungen
 * @param {Array<string>} wegNamen  die ECHTEN Namen aller Wege (Maschinennamen gehoeren nicht dazu --
 *                                  der Aufrufer filtert sie, siehe `getPathTitleName`)
 * @returns {Set<string>} die Schluessel der doppelt vergebenen Namen
 */
function avesmapsDoppelteBeschriftungIndex(labelNamen, wegNamen) {
	const labelZahl = new Map();
	(Array.isArray(labelNamen) ? labelNamen : []).forEach((name) => {
		const key = avesmapsBeschriftungsSchluessel(name);
		if (key) {
			labelZahl.set(key, (labelZahl.get(key) || 0) + 1);
		}
	});
	const wege = new Set();
	(Array.isArray(wegNamen) ? wegNamen : []).forEach((name) => {
		const key = avesmapsBeschriftungsSchluessel(name);
		if (key) {
			wege.add(key);
		}
	});

	const doppelt = new Set();
	labelZahl.forEach((anzahl, key) => {
		// (a) mehrfach als Beschriftung ODER (b) einmal als Beschriftung und dazu an einem Weg.
		// 💣 Ein Name, den es NUR an Wegen doppelt gibt, gehoert NICHT hierher: „Reichsstrasse 2"
		// liegt in 57 Abschnitten, das ist ein Weg und keine Dublette. Der Haken spricht ueber
		// BESCHRIFTUNGEN, und die Wegnamen sind nur der Gegenpart.
		if (anzahl > 1 || wege.has(key)) {
			doppelt.add(key);
		}
	});
	return doppelt;
}

/**
 * Traegt diese Beschriftung einen doppelt vergebenen Namen?
 *
 * @param {object} label eine Beschriftung aus `labelData`
 * @param {Set<string>} index das Ergebnis von avesmapsDoppelteBeschriftungIndex
 * @returns {boolean}
 */
function avesmapsIstDoppelteBeschriftung(label, index) {
	if (!label || !index || typeof index.has !== "function") {
		return false;
	}
	const key = avesmapsBeschriftungsSchluessel(label.text);
	return key !== "" && index.has(key);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		avesmapsBeschriftungsSchluessel,
		avesmapsDoppelteBeschriftungIndex,
		avesmapsIstDoppelteBeschriftung,
	};
}

// Ein Bündler für die Voll-Neuzeichnungen der Zeichenflächen. Vorgabe AN; `?zoombuendel=0` zurück.
//
// 💣 ACHT VOLLE NEUZEICHNUNGEN JE ZOOMSCHRITT. Grenzen- und Schraffur-Overlay hängen beide an
// `moveend zoomend viewreset resize`, und Leaflet feuert am Zoomende **beide** Ereignisse -- der
// Handler läuft also zweimal. Jeder Lauf zeichnet sofort einmal voll und meldet dazu drei blinde
// Nachzieh-Timer an (120/350/800 ms). Macht 2 + 6 = 8 Voll-Neuzeichnungen à 52-99 ms, verteilt über
// rund eine Sekunde nach jedem Zoom.
//
// 🔴 WARUM DAS JETZT ZÄHLT: Owner 27.08.2026 hat die Schwelle ausgemessen -- bei 1500 ms Zoomdauer
// ist das Bild sauber, bei 1000 ms sieht er „doppel", bei 500 ms liegen die Straßen versetzt. Ein
// Fehler, der bei 4 s verschwindet und bei 500 ms stört, ist ein FESTER Betrag Arbeit, kein
// anteiliger Effekt. Für einen flotten Zoom muss also rund eine Sekunde Arbeit aus dem Zoomschritt
// heraus -- nicht anders getaktet, sondern weg.
//
// 🔴 VORGABE SEIT 27.08.2026 AN. Sie kam als Versuch hinter `?zoombuendel=1` live, weil an diesem
// Tag zwei Zoom-Änderungen nach der ZAHL besser und nach dem BILD schlechter waren -- der Schalter
// war der Ausweg (Owner: „probiers unter neuem parameter"). Nach seinem Blick darauf: „das beste
// was ich bisher gesehen hab".
// ⚠️ `?zoombuendel=0` stellt den alten Zustand her und BLEIBT erreichbar: er ist die
// Vergleichsgrundlage. Ohne ihn liesse sich eine spätere Verschlechterung nicht mehr gegen den
// Ausgangspunkt halten.
//
// ⚠️ Der Bündler ist absichtlich dumm: er sammelt Aufrufe bis zum nächsten Bild und macht daraus
// EINEN. Er entscheidet nicht, OB gezeichnet werden muss -- das tut der Aufrufer.
//
// Geladen von index.html VOR den Overlays, die ihn benutzen. `const` auf Dateiebene wird nicht
// gehoistet; zu spät geladen stünde dort `undefined`.
// Bewacht von js/map-features/__tests__/zeichen-buendel.test.js.

const AVESMAPS_ZEICHEN_BUENDEL_AN = (() => {
	try {
		return new URLSearchParams(String(window.location.search || "").replace(/\?/g, "&")).get("zoombuendel") !== "0";
	} catch (fehler) {
		return true;   // ohne Adresszeile gilt die Vorgabe
	}
})();

// 🔴 DIE WIRKUNG SOLL EINE ZAHL SEIN, KEIN EINDRUCK. Ohne Zähler bliebe nur „fühlt sich besser an",
// und genau daran ist heute schon ein Umbau gescheitert. `avesmapsZeichenBilanz()` liefert die
// Aufrufe je Fläche seit dem letzten Zurücksetzen.
const avesmapsZeichenZaehler = Object.create(null);

function avesmapsZeichenBilanz() {
	return Object.assign(Object.create(null), avesmapsZeichenZaehler);
}

function avesmapsZeichenBilanzZuruecksetzen() {
	for (const name of Object.keys(avesmapsZeichenZaehler)) {
		delete avesmapsZeichenZaehler[name];
	}
}

/**
 * Macht aus einer Zeichenfunktion eine, die höchstens EINMAL pro Bild läuft.
 *
 * ⚠️ Mit `?zoombuendel=0` wird NICHT gebündelt -- nur gezählt. Damit misst man den alten Zustand
 * mit demselben Werkzeug wie den neuen; sonst vergleicht man zwei Messungen, die verschieden
 * zustande kamen. Gemessen am 27.08.2026: 16 Voll-Neuzeichnungen je Zoomschritt gegen 4.
 *
 * @param {string} name Für die Bilanz, z. B. "grenzen" oder "schraffur"
 * @param {Function} zeichne Die eigentliche Voll-Neuzeichnung
 * @returns {Function}
 */
function avesmapsZeichenGebuendelt(name, zeichne) {
	// 🔴 OHNE `requestAnimationFrame` GIBT ES KEIN „naechstes Bild", in das gebuendelt werden koennte
	// -- dann ist sofort zeichnen die einzig richtige Antwort, nicht eine stille Ausweiche. Das
	// trifft Test-Umgebungen (VM ohne Browser-Fenster) und waere in einem echten Browser unmoeglich.
	// ⚠️ Ohne diese Pruefung wirft der Buendler dort `window.requestAnimationFrame is not a
	// function` -- so gefunden am 27.08.2026 beim Umstellen der Vorgabe, in einem FREMDEN Test.
	const kannNaechstesBild = typeof window !== "undefined"
		&& typeof window.requestAnimationFrame === "function";
	if (!AVESMAPS_ZEICHEN_BUENDEL_AN || !kannNaechstesBild) {
		// ?zoombuendel=0 -- der Zustand von vor dem 27.08.2026: jeder Aufruf zeichnet sofort.
		return function () {
			avesmapsZeichenZaehler[name] = (avesmapsZeichenZaehler[name] || 0) + 1;
			zeichne();
		};
	}

	let angemeldet = 0;
	return function () {
		if (angemeldet) {
			return;   // in diesem Bild ist schon eine Zeichnung angemeldet
		}
		angemeldet = window.requestAnimationFrame(() => {
			angemeldet = 0;
			avesmapsZeichenZaehler[name] = (avesmapsZeichenZaehler[name] || 0) + 1;
			zeichne();
		});
	};
}

/**
 * Ein Nachzieh-Zeichner, der nur zeichnet, wenn sich die Daten seit dem letzten Mal geändert haben.
 *
 * 💣 DIE DREI SETTLE-TIMER SIND HEUTE BLIND: sie zeichnen nach 120/350/800 ms voll neu, ob sich
 * etwas geändert hat oder nicht. Ihr Zweck ist, einen später eintreffenden `regionData`-Stand
 * nachzuholen -- also fragen sie das jetzt.
 * ⭐ Die Prüfung ist eine IDENTITÄT, kein Vergleich: der Loader weist `regionData` bei jedem Laden
 * ein FRISCHES Array zu, die Referenz wechselt also genau dann, wenn neue Daten da sind. Ein
 * Inhaltsvergleich über ~1000 Flächen wäre teurer als das Zeichnen, das er sparen soll.
 * ⚠️ Seit dem geparsten Ebenen-Zwischenspeicher (27.08.2026) kommt bei einem Treffer DASSELBE Array
 * zurück -- dann ist „nichts Neues" auch sachlich richtig.
 *
 * @param {string} name Für die Bilanz
 * @param {Function} zeichne Die eigentliche Voll-Neuzeichnung
 * @param {Function} datenStand Liefert den aktuellen Datenstand (Referenz)
 * @returns {Function}
 */
function avesmapsZeichenNachzugWennNeu(name, zeichne, datenStand) {
	let zuletzt = null;
	let ersterLauf = true;
	return function () {
		if (!AVESMAPS_ZEICHEN_BUENDEL_AN) {   // ?zoombuendel=0: die drei Timer bleiben blind
			avesmapsZeichenZaehler[name] = (avesmapsZeichenZaehler[name] || 0) + 1;
			zeichne();
			return;
		}
		let jetzt = null;
		try {
			jetzt = datenStand();
		} catch (fehler) {
			jetzt = null;   // im Zweifel zeichnen
			zuletzt = undefined;
		}
		if (!ersterLauf && jetzt === zuletzt) {
			return;
		}
		ersterLauf = false;
		zuletzt = jetzt;
		avesmapsZeichenZaehler[name] = (avesmapsZeichenZaehler[name] || 0) + 1;
		zeichne();
	};
}

// Node-Export (im Browser inert, dort sind es schlicht Globale).
if (typeof module !== "undefined" && module.exports) {
	module.exports = { avesmapsZeichenGebuendelt, avesmapsZeichenNachzugWennNeu };
}

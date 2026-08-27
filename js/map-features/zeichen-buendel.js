// Ein Bündler für die Voll-Neuzeichnungen der Zeichenflächen — VERSUCHSWEISE, hinter `?zoombuendel=1`.
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
// 🔴 VORGABE IST AUS. Ohne `?zoombuendel=1` reicht dieser Bündler jeden Aufruf unverändert und
// synchron durch; die Karte verhält sich zeichengleich wie vorher. Owner-Entscheid 27.08.2026
// („probiers unter neuem parameter"), und er ist an diesem Tag zweimal richtig gewesen: eine
// Zoom-Änderung, die nur gemessen und nicht gesehen wurde, war beide Male schlechter als der
// Ausgangszustand.
//
// ⚠️ Der Bündler ist absichtlich dumm: er sammelt Aufrufe bis zum nächsten Bild und macht daraus
// EINEN. Er entscheidet nicht, OB gezeichnet werden muss -- das tut der Aufrufer.
//
// Geladen von index.html VOR den Overlays, die ihn benutzen. `const` auf Dateiebene wird nicht
// gehoistet; zu spät geladen stünde dort `undefined`.
// Bewacht von js/map-features/__tests__/zeichen-buendel.test.js.

const AVESMAPS_ZEICHEN_BUENDEL_AN = (() => {
	try {
		return new URLSearchParams(String(window.location.search || "").replace(/\?/g, "&")).get("zoombuendel") === "1";
	} catch (fehler) {
		return false;
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
 * ⚠️ Ohne den Schalter wird NICHT gebündelt -- nur gezählt. Damit misst man den Ist-Zustand mit
 * demselben Werkzeug, mit dem man den Soll-Zustand misst; sonst vergleicht man zwei Messungen, die
 * verschieden zustande kamen.
 *
 * @param {string} name Für die Bilanz, z. B. "grenzen" oder "schraffur"
 * @param {Function} zeichne Die eigentliche Voll-Neuzeichnung
 * @returns {Function}
 */
function avesmapsZeichenGebuendelt(name, zeichne) {
	if (!AVESMAPS_ZEICHEN_BUENDEL_AN) {
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
		if (!AVESMAPS_ZEICHEN_BUENDEL_AN) {
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

// Leertaste sperrt beim Landschaften-Zeichnen (map-features-ecosystem-draw.js) Doppelklick und
// Kartenverschieben, solange sie gehalten wird (Discord-Wunsch, 2026-09-25): schnelles Klicken der
// Eckpunkte wurde manchmal als Kartenverschieben gewertet, oder ein ungewollter Doppelklick schloss die
// Fläche vorzeitig ab. Die Sperre gilt NUR beim Zeichnen ("Malen"), nicht im Ecken-Editor ("Zupfen").
//
// ZUR LAUFZEIT gefahren: die echten Klick-/Doppelklick-/Tastatur-Handler laufen im vm-Kontext gegen eine
// Karten- und Dokument-Attrappe, die Ereignisse wirklich weiterleitet (kein Quelltext-Grep).
//
// `ecosystemDrawPoints`/`ecosystemDrawLockActive` sind modulinterne `let`-Variablen und deshalb von
// aussen nicht lesbar (anders als `function`-Deklarationen landen `let`s nie als Eigenschaft auf dem
// vm-Kontext). Geprueft wird deshalb an BEOBACHTBAREN Wirkungen: wie oft ein Punkt gesetzt wurde
// (`updateEcosystemDrawPreview` nach dem Laden durch einen Zaehler ersetzt -- sie wird ausschliesslich
// von einem erfolgreich gesetzten Punkt gerufen), ob abgeschlossen wurde (`finishEcosystemAreaDrawing`
// ebenso ersetzt) und was `map.dragging` wirklich tat.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const wurzel = path.join(__dirname, "..", "..", "..");
// ⭐ Zeilenenden-neutral (AGENTS.md §9): Arbeitskopie CRLF, CI LF.
const lies = (datei) => fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");

const quelle = lies("js/map-features/map-features-ecosystem-draw.js");

// ---- Buehne ---------------------------------------------------------------------------------------

function baueMap() {
	const handler = new Map();
	const draggingAufrufe = [];
	return {
		draggingAufrufe,
		on(typ, fn) { if (!handler.has(typ)) handler.set(typ, []); handler.get(typ).push(fn); },
		off(typ, fn) { const l = handler.get(typ) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
		fire(typ, event) { (handler.get(typ) || []).slice().forEach((fn) => fn(event)); },
		addLayer() {}, removeLayer() {}, hasLayer: () => false,
		getContainer: () => ({ classList: { add() {}, remove() {} } }),
		dragging: {
			_aktiv: true,
			disable() { this._aktiv = false; draggingAufrufe.push("disable"); },
			enable() { this._aktiv = true; draggingAufrufe.push("enable"); },
		},
		doubleClickZoom: { _an: true, enable() { this._an = true; }, disable() { this._an = false; }, enabled() { return this._an; } },
	};
}

// Ein Dokument, das Handler wirklich HAELT -- die Sperre haengt an echten keydown/keyup-Ereignissen,
// nicht an einem Blick in den Quelltext.
function baueEreignisquelle() {
	const handler = new Map();
	return {
		addEventListener(typ, fn) { if (!handler.has(typ)) handler.set(typ, []); handler.get(typ).push(fn); },
		removeEventListener(typ, fn) { const l = handler.get(typ) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
		fire(typ, event) { (handler.get(typ) || []).slice().forEach((fn) => fn(event)); },
	};
}

function punkt(x, y) {
	return { x, y, distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y); } };
}

function klick(x, y) {
	return { latlng: { lat: y, lng: x }, containerPoint: punkt(x, y) };
}

function leertaste(ziel = {}) {
	return { code: "Space", key: " ", target: ziel, preventDefault() {}, stopPropagation() {} };
}

function baueKontext(map, dokument, fenster) {
	const punkteZaehler = { anzahl: 0 };
	const abschluesse = { anzahl: 0 };
	const uhr = { jetzt: 0 };
	const kontext = {
		console, JSON, Math, Number, String, Boolean, Array, Object, Promise,
		document: dokument,
		performance: { now: () => uhr.jetzt },
		L: { DomEvent: { stop() {} } },
		map,
		isEcosystemLayerModeActive: () => true,
		closeEcosystemGeometryEdit() {},
		setSelectedEcosystemArea() {},
		syncEcosystemMapEditingClass() {},
		syncEcosystemDoubleClickZoom() {},
		clearEcosystemEditSnapPreview() {},
		renderEcosystemEditSnapPreview() {},
		ecosystemEditSnapTarget: () => null,
		isEcosystemEditDetachModifier: () => false,
		showFeedbackToast() {},
	};
	kontext.window = fenster;
	kontext.globalThis = kontext;
	vm.createContext(kontext);
	vm.runInContext(quelle, kontext);
	// Nach dem Laden ersetzt -- die echten Funktionen speichern (postEcosystemEdit fehlt hier absichtlich),
	// dieser Test prueft nur die GESTE (Klick/Doppelklick/Leertaste), nicht das Speichern.
	kontext.updateEcosystemDrawPreview = () => { punkteZaehler.anzahl += 1; };
	kontext.finishEcosystemAreaDrawing = () => { abschluesse.anzahl += 1; return Promise.resolve(); };
	return { kontext, punkteZaehler, abschluesse, uhr };
}

// ---- A. Ohne gehaltene Leertaste: Referenzverhalten unveraendert ----------------------------------

{
	const map = baueMap();
	const dokument = baueEreignisquelle();
	const fenster = baueEreignisquelle();
	const { kontext, punkteZaehler, abschluesse, uhr } = baueKontext(map, dokument, fenster);

	kontext.startEcosystemAreaDrawing();

	uhr.jetzt = 0;
	map.fire("click", klick(0, 0));
	uhr.jetzt = 1000;
	map.fire("click", klick(100, 0));
	assert.strictEqual(punkteZaehler.anzahl, 2, "zwei zeitlich/räumlich getrennte Klicks setzen zwei Punkte");

	// Der Doppelklick: ein zweiter Klick nahe an Ort und Zeit wird geschluckt (Sporn-Schutz, unveraendert),
	// das Doppelklick-Ereignis schliesst ab.
	uhr.jetzt = 1010;
	map.fire("click", klick(100, 2));
	assert.strictEqual(punkteZaehler.anzahl, 2, "der geschluckte zweite Klick des Doppelklicks setzt KEINEN Punkt");
	map.fire("dblclick", { latlng: { lat: 2, lng: 100 } });
	assert.strictEqual(abschluesse.anzahl, 1, "ohne Sperre schliesst der Doppelklick weiterhin ab");
}

// ---- B. Leertaste gehalten: jeder Klick zaehlt, kein Abschluss, kein Verschieben -------------------

{
	const map = baueMap();
	const dokument = baueEreignisquelle();
	const fenster = baueEreignisquelle();
	const { kontext, punkteZaehler, abschluesse, uhr } = baueKontext(map, dokument, fenster);

	kontext.startEcosystemAreaDrawing();

	uhr.jetzt = 0;
	map.fire("click", klick(0, 0));
	uhr.jetzt = 1000;
	map.fire("click", klick(100, 0));
	assert.strictEqual(punkteZaehler.anzahl, 2, "Vorbedingung: zwei Punkte gesetzt");

	dokument.fire("keydown", leertaste());
	assert.deepStrictEqual(map.draggingAufrufe, ["disable"],
		"gehaltene Leertaste sperrt das Kartenverschieben sofort");
	assert.strictEqual(map.dragging._aktiv, false);

	// Zwei schnelle, eng benachbarte Klicks -- genau das Muster, das ohne Sperre als EIN Doppelklick
	// gilt. Bei gehaltener Leertaste zaehlt jeder einzeln.
	uhr.jetzt = 1010;
	map.fire("click", klick(100, 2));
	uhr.jetzt = 1015;
	map.fire("click", klick(100, 2));
	assert.strictEqual(punkteZaehler.anzahl, 4,
		"bei gehaltener Leertaste setzt JEDER Klick einen eigenen Punkt, auch eng benachbarte");

	map.fire("dblclick", { latlng: { lat: 2, lng: 100 } });
	assert.strictEqual(abschluesse.anzahl, 0,
		"bei gehaltener Leertaste schliesst ein Doppelklick die Flaeche NICHT ab");
	assert.strictEqual(punkteZaehler.anzahl, 4, "der unterdrueckte Abschluss setzt selbst keinen Punkt");

	// Loslassen: Verschieben kommt zurueck, und das ALTE Doppelklick-Verhalten gilt wieder.
	dokument.fire("keyup", leertaste());
	assert.deepStrictEqual(map.draggingAufrufe, ["disable", "enable"], "Loslassen gibt das Verschieben zurueck");
	assert.strictEqual(map.dragging._aktiv, true);

	uhr.jetzt = 2000;
	map.fire("click", klick(300, 300));
	uhr.jetzt = 2005;
	map.fire("click", klick(300, 301));
	assert.strictEqual(punkteZaehler.anzahl, 5, "nach dem Loslassen schluckt die Sporn-Pruefung wieder");
	map.fire("dblclick", { latlng: { lat: 301, lng: 300 } });
	assert.strictEqual(abschluesse.anzahl, 1, "nach dem Loslassen schliesst ein Doppelklick wieder ab");
}

// ---- C. Leertaste in einem Tippfeld (offener Eigenschaften-Dialog) bleibt wirkungslos --------------

{
	const map = baueMap();
	const dokument = baueEreignisquelle();
	const fenster = baueEreignisquelle();
	const { kontext } = baueKontext(map, dokument, fenster);

	kontext.startEcosystemAreaDrawing();
	dokument.fire("keydown", leertaste({ tagName: "INPUT" }));
	assert.deepStrictEqual(map.draggingAufrufe, [], "Leertaste in einem Textfeld sperrt nichts");
	assert.strictEqual(map.dragging._aktiv, true);
}

// ---- D. Ein Abschluss/Abbruch bei noch gehaltener Leertaste gibt das Verschieben zurueck -----------

{
	const map = baueMap();
	const dokument = baueEreignisquelle();
	const fenster = baueEreignisquelle();
	const { kontext } = baueKontext(map, dokument, fenster);

	kontext.startEcosystemAreaDrawing();
	dokument.fire("keydown", leertaste());
	assert.strictEqual(map.dragging._aktiv, false, "Vorbedingung: Sperre aktiv");

	// Enter/Escape rufen intern stopEcosystemAreaDrawing() -- hier direkt simuliert (derselbe Weg).
	kontext.stopEcosystemAreaDrawing();
	assert.strictEqual(map.dragging._aktiv, true,
		"das Werkzeug darf beim Beenden nicht mit gesperrtem Verschieben zurueckbleiben");
}

// ---- E. Fokusverlust (Alt-Tab) mit gehaltener Leertaste loest die Sperre ----------------------------

{
	const map = baueMap();
	const dokument = baueEreignisquelle();
	const fenster = baueEreignisquelle();
	const { kontext } = baueKontext(map, dokument, fenster);

	kontext.startEcosystemAreaDrawing();
	dokument.fire("keydown", leertaste());
	assert.strictEqual(map.dragging._aktiv, false, "Vorbedingung: Sperre aktiv");

	fenster.fire("blur", {});
	assert.strictEqual(map.dragging._aktiv, true,
		"ein Fokusverlust ohne folgendes keyup darf das Verschieben nicht fuer immer sperren");
}

console.log("ecosystem-draw-leertastensperre.test.js: alle Zusicherungen erfuellt");

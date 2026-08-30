// Ein Klick auf ein Import-Objekt AUF DER KARTE waehlt es im Importer aus.
// Owner 30.08.2026: „wenn sie auf ein zu importierendes objekt klicken koennten und es wuerde im
// importer automatisch in der anzeigen-liste selektiert".
//
// 🔴 UND DAS WICHTIGSTE ZUERST (Owner, ausdruecklich): „ausgewaehlt" ist NICHT „markiert".
// Der Importer kennt beides und sie tun Verschiedenes:
//   · AUSGEWAEHLT (`detailKey`) -- die Einzelansicht rechts, die durchgehende Kontur auf der Karte.
//     Reine Anzeige, sie aendert nichts und wird nirgends weiterverwendet.
//   · MARKIERT (`markiert`, das Haekchen) -- eine Auswahl, die der Editor spaeter wiederfindet:
//     sie speist „Markierte anzeigen" und die Sammelhandlungen.
// Ein Kartenklick, der nebenbei anhaekelt, macht aus einem BLICK eine ENTSCHEIDUNG, die niemand
// getroffen hat -- und sie taucht spaeter in einer Sammelhandlung wieder auf. Genau davor steht
// dieser Test.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-karte-klick.test.js
"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function wahr(bed, warum) { assert.ok(bed, warum || ""); checks++; }

// ---- Leaflet-Attrappe: dieselbe Form wie in garetien-karte.test.js, plus `on` ------------------
function gefaelschteEbene(bauer, punkte, optionen) {
	return {
		_art: "polyline", _bauer: bauer, _punkte: punkte, _karte: null, _tooltip: null, _handler: {},
		options: optionen || {},
		bindTooltip(text, opt) { this._tooltip = { text: text, optionen: opt || {} }; return this; },
		on(name, fn) { (this._handler[name] = this._handler[name] || []).push(fn); return this; },
		feuere(name, ereignis) { (this._handler[name] || []).slice().forEach((fn) => fn(ereignis || {})); },
		addTo(k) { k.addLayer(this); return this; },
		remove() { if (this._karte) { this._karte.removeLayer(this); } return this; },
	};
}
global.L = {
	polyline(p, o) { return gefaelschteEbene("polyline", p, o); },
	polygon(p, o) { return gefaelschteEbene("polygon", p, o); },
	circleMarker(p, o) { return gefaelschteEbene("circleMarker", [p], o); },
	layerGroup() {
		return {
			_art: "group", _kinder: [], _karte: null,
			addTo(k) { k.addLayer(this); return this; },
			addLayer(s) { this._kinder.push(s); if (this._karte) { this._karte.addLayer(s); } return this; },
			clearLayers() {
				this._kinder.slice().forEach((s) => { if (this._karte) { this._karte.removeLayer(s); } });
				this._kinder = [];
				return this;
			},
			getLayers() { return this._kinder.slice(); },
			remove() { this.clearLayers(); if (this._karte) { this._karte.removeLayer(this); } return this; },
		};
	},
	latLngBounds(p) { return { _punkte: p }; },
};
function gefaelschteKarte() {
	const drin = [];
	return {
		zoom: 5, panes: {},
		getZoom() { return this.zoom; },
		createPane(name) { this.panes[name] = { name: name, style: {}, classList: { add() {} } }; return this.panes[name]; },
		getPane(name) { return this.panes[name]; },
		addLayer(s) {
			if (drin.indexOf(s) === -1) { drin.push(s); s._karte = this; (s._kinder || []).forEach((k) => this.addLayer(k)); }
			return this;
		},
		removeLayer(s) {
			const i = drin.indexOf(s);
			if (i !== -1) { drin.splice(i, 1); }
			s._karte = null;
			(s._kinder || []).slice().forEach((k) => this.removeLayer(k));
			return this;
		},
		hasLayer(s) { return drin.indexOf(s) !== -1; },
		flyToBounds() {}, fitBounds() {},
		ebenen() { return drin.filter((s) => s._art === "polyline"); },
	};
}

global.window = global.window || {};
global.document = global.document || {
	getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, setAttribute() {} }),
	addEventListener() {}, body: null, documentElement: { style: { setProperty() {} } },
};

const zeichner = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));
const importer = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

// Ein Objekt, wie es aus der Importliste kommt -- Form abgeschaut bei garetien-karte.test.js,
// damit hier nicht ein erfundenes Format geprueft wird, das der Zeichner nie sieht.
// ⚠️ MIT Abschnitt: nur so wird auch UNSERE Seite gezeichnet, und der Test kann zeigen, dass beide
// Formen desselben Objekts denselben Schluessel melden.
const OBJEKT = {
	key: "ggp:Gewaesser:Fluss:Natter",
	name: "Natter",
	urteil: "ergaenzung",
	ebene: "Gewaesser",
	geometrie_typ: "LineString",
	geometrie: [[100, 700], [110, 720], [120, 760]],
	abschnitte: [
		{ public_id: "w-4471", name: "Natter", punkte: 9, geometrie: [[300, 900], [310, 910]] },
	],
	// 💣 UNSERE Seite kommt aus `items[].abschnitt` mit `selected: true` -- NICHT aus `abschnitte`
	// (das traegt nur die Geometrie). Ohne diesen Block zeichnet der Zeichner allein ihre Seite,
	// und eine Zusicherung „beide Seiten sind klickbar" scheitert an den TESTDATEN statt am Code.
	// Genau so gefunden am 30.08.2026.
	items: [
		{ selected: true, abschnitt: { public_id: "w-4471", name: "Natter" } },
	],
};

// =================================================================================================
// 1. Der Name des Hakens steht in BEIDEN Dateien und ist zeichengleich
// =================================================================================================
// 💣 GEKOPPELTER WERT IN ZWEI DATEIEN -- dieselbe Lage wie bei den zwei Feldnamen daneben, und aus
// demselben Grund: der Zeichner darf den Importer nicht voraussetzen (er wird im Test allein
// geladen) und das Fenster nicht die Karte (es laeuft auch auf Seiten ohne). Liefe der Name
// auseinander, riefe der Zeichner ins Leere -- und zwar STILL.
wahr(typeof zeichner.AVESMAPS_GARETIEN_HAKEN_KLICK === "string"
	&& zeichner.AVESMAPS_GARETIEN_HAKEN_KLICK !== "",
	"der Zeichner nennt den Namen des Klick-Hakens nicht");
gleich(importer.AVESMAPS_GARETIEN_HAKEN_KLICK, zeichner.AVESMAPS_GARETIEN_HAKEN_KLICK,
	"Zeichner und Importer benutzen VERSCHIEDENE Hakennamen -- der Klick liefe ins Leere");

const HAKEN = zeichner.AVESMAPS_GARETIEN_HAKEN_KLICK;

// =================================================================================================
// 2. Die gezeichneten Formen melden den Klick -- mit dem Schluessel des Objekts
// =================================================================================================
const karte = gefaelschteKarte();
const gerufen = [];
window[HAKEN] = function (schluessel) { gerufen.push(schluessel); };
zeichner.avesmapsGaretienKarteZeigen([OBJEKT], karte);

const formen = karte.ebenen();
wahr(formen.length > 0, "es wurde gar nichts gezeichnet");
const mitKlick = formen.filter((e) => (e._handler.click || []).length > 0);
wahr(mitKlick.length > 0, "keine einzige Form meldet einen Klick");

mitKlick[0].feuere("click", {});
gleich(gerufen.length, 1, "der Klick meldet sich nicht genau einmal");
gleich(gerufen[0], OBJEKT.key, "der Klick meldet den falschen Schluessel");

// 🔴 IHRE UND UNSERE FORM GEHOEREN DEMSELBEN OBJEKT. Egal, welche der beiden man trifft -- es ist
// dasselbe Stueck, und beide muessen denselben Schluessel melden. Waere nur eine verdrahtet, haenge
// es vom Zufall der Ueberlappung ab, ob ein Klick wirkt.
gerufen.length = 0;
mitKlick.forEach((e) => e.feuere("click", {}));
gleich(gerufen.length, mitKlick.length, "nicht jede klickbare Form meldet");
wahr(gerufen.every((k) => k === OBJEKT.key), "eine Form meldet einen fremden Schluessel");
// 🪤 Und wirklich BEIDE SEITEN, gemessen an der PANE -- nicht bloss „mindestens zwei Formen".
// Jede Seite zeichnet zwei Formen (Hof + Form), eine Zaehlung auf >= 2 ist also auch dann erfuellt,
// wenn nur IHRE Seite verdrahtet ist. Genau das ueberlebte am 30.08.2026 die Mutationsprobe.
const panes = {};
mitKlick.forEach((e) => { panes[e.options.pane] = (panes[e.options.pane] || 0) + 1; });
gleich(Object.keys(panes).length, 2,
	"nur EINE der beiden Seiten ist klickbar (gefunden: " + Object.keys(panes).join(", ") + ") -- "
	+ "welche Form ein Klick trifft, haenge dann vom Zufall der Ueberlappung ab");
// 🔴 Und je Seite BEIDE Formen: der HOF ist der dicke Ring und damit die groessere Trefferflaeche,
// die Form daneben ist duenn. Waere nur die Form klickbar, muesste der Editor die duenne Linie
// treffen -- und es saehe aus, als reagiere die Karte mal und mal nicht.
// 🪤 Eine Zaehlung der PANES allein faengt das nicht: die Pane ist auch dann vertreten, wenn nur
// eine ihrer zwei Formen meldet. Genau so ueberlebte es am 30.08.2026 die Mutationsprobe.
Object.keys(panes).forEach(function (name) {
	gleich(panes[name], 2,
		"in " + name + " melden " + panes[name] + " statt 2 Formen -- Hof und Form muessen BEIDE "
		+ "klickbar sein, sonst haengt es an der Strichbreite, ob ein Klick ankommt");
});

// =================================================================================================
// 3. Ohne Haken wirft nichts
// =================================================================================================
// 🔴 Das Fenster kann geschlossen sein, und der Zeichner laeuft auch ohne es. Ein Wurf im
// Klick-Handler risse die Leaflet-Ereigniskette mit -- und zwar fuer die ganze Karte.
delete window[HAKEN];
mitKlick[0].feuere("click", {});
window[HAKEN] = function () { throw new Error("darf hier nicht mehr gerufen werden"); };
delete window[HAKEN];
checks++;

// =================================================================================================
// 4. DER KERN: der Klick waehlt AUS und haekelt NICHT an
// =================================================================================================
// 🔴 Owner 30.08.2026, ausdruecklich: „wichtig ist dass du ausgewaehlt nicht mit markiert
// (angehaekelt) verwechselst".
wahr(typeof importer.avesmapsGaretienKarteKlickBehandeln === "function",
	"der Importer hat keinen Behandler fuer den Kartenklick");

// Vorher: nichts markiert, nichts ausgewaehlt.
importer.avesmapsGaretienAnzeigeLeeren();
importer.avesmapsGaretienAnzeigeHinzufuegen([OBJEKT]);
gleich(importer.avesmapsGaretienMarkierungHat(OBJEKT.key), false, "vorher darf nichts markiert sein");

const ergebnis = importer.avesmapsGaretienKarteKlickBehandeln(OBJEKT.key, [OBJEKT]);

// AUSGEWAEHLT: ja.
gleich(ergebnis, OBJEKT.key, "der Klick waehlt das Objekt nicht aus");
// MARKIERT: nein, und das ist die Zusicherung, um die der Owner ausdruecklich gebeten hat.
gleich(importer.avesmapsGaretienMarkierungHat(OBJEKT.key), false,
	"der Kartenklick hat das Objekt ANGEHAEKELT -- er darf nur auswaehlen. Das Haekchen ist eine "
	+ "Entscheidung, die der Editor spaeter in 'Markierte anzeigen' und den Sammelhandlungen "
	+ "wiederfindet; ein Blick darf sie nicht treffen.");

// Und ein zweiter Klick auf dasselbe Objekt haekelt es auch nicht nachtraeglich an.
importer.avesmapsGaretienKarteKlickBehandeln(OBJEKT.key, [OBJEKT]);
gleich(importer.avesmapsGaretienMarkierungHat(OBJEKT.key), false,
	"der zweite Kartenklick haekelt an -- er darf die Markierung nie beruehren");

// ⚠️ Gegenprobe: die Markierung LAESST sich setzen -- sonst belegte die Zusicherung oben nur, dass
// avesmapsGaretienMarkierungHat immer false liefert (die Vakuum-Falle dieser Aufgabe).
importer.avesmapsGaretienMarkierungUmschalten(OBJEKT.key);
gleich(importer.avesmapsGaretienMarkierungHat(OBJEKT.key), true,
	"die Markierung laesst sich gar nicht setzen -- die Zusicherung darueber waere wertlos");
// Und ein Kartenklick nimmt sie auch nicht WEG.
importer.avesmapsGaretienKarteKlickBehandeln(OBJEKT.key, [OBJEKT]);
gleich(importer.avesmapsGaretienMarkierungHat(OBJEKT.key), true,
	"der Kartenklick hat die Markierung geloescht -- er darf sie in KEINE Richtung anfassen");
importer.avesmapsGaretienMarkierungUmschalten(OBJEKT.key);

// =================================================================================================
// 5. Ein unbekannter Schluessel faellt offen aus
// =================================================================================================
// ⚠️ Die Anzeige-Menge und die Kartendaten koennen auseinanderlaufen (ein Objekt wurde eingefuegt
// und ist fort). Ein Wurf hier risse die Ereigniskette der Karte mit.
importer.avesmapsGaretienKarteKlickBehandeln("gibt-es-nicht", [OBJEKT]);
checks++;

// 🔴 Und ein LEERER Schluessel darf die Auswahl nicht AUFHEBEN. Das ist der eigentliche Grund fuer
// den Riegel, und er ist kein Zierrat: garetienDetailWaehlen(null) setzt `detailKey` auf null --
// ein Klick, der aus irgendeinem Grund ohne Schluessel ankommt, schloesse dem Editor die
// Einzelansicht, an der er gerade arbeitet.
// 🪤 Ohne diese Zusicherung ueberlebte das Entfernen des Riegels die Mutationsprobe: „wirft nicht"
// ist auch ohne ihn erfuellt.
gleich(importer.avesmapsGaretienKarteKlickBehandeln(OBJEKT.key, [OBJEKT]), OBJEKT.key);
gleich(importer.avesmapsGaretienKarteKlickBehandeln(null, [OBJEKT]), null,
	"ein Klick ohne Schluessel meldet nicht null zurueck");
gleich(importer.avesmapsGaretienKarteKlickBehandeln("", null), null);
// Die vorige Auswahl steht noch -- der leere Klick hat sie NICHT aufgehoben.
gleich(importer.avesmapsGaretienFensterZustand().detailKey, OBJEKT.key,
	"ein Klick ohne Schluessel hat die Einzelansicht geschlossen");

// =================================================================================================
// 6. Der Importer SETZT den Haken -- sonst meldet der Zeichner ins Leere
// =================================================================================================
// 🪤 „Es gibt einen Behandler" ist auch dann erfuellt, wenn niemand ihn anmeldet. Der Klick kaeme
// dann nirgends an, und zwar STILL -- die Karte reagierte einfach nicht.
// ⚠️ Geprueft am QUELLTEXT, weil `window` in diesem Test schon vor dem Laden des Importers steht
// und der Haken oben absichtlich ueberschrieben wird.
const fs = require("fs");
const importerQuelle = fs.readFileSync(path.resolve(__dirname, "..", "review-garetien-importer.js"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^[ \t]*\/\/.*$/gm, "");
wahr(/window\[AVESMAPS_GARETIEN_HAKEN_KLICK\]\s*=/.test(importerQuelle),
	"der Importer meldet sich gar nicht am Klick-Haken an -- der Zeichner riefe ins Leere");
wahr(/avesmapsGaretienKarteKlickBehandeln\(schluessel/.test(importerQuelle),
	"der angemeldete Haken ruft nicht den Behandler");

console.log("OK: Garetien-Kartenklick -- " + checks + " Zusicherungen (waehlt aus, haekelt NICHT an).");

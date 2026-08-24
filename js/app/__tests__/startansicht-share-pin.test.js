// Ein geteilter `?pin=`-Link SÄT seinen Punkt als Startansicht (24.08.2026).
//
// 🪤 DER BEFUND WAR NICHT „es zentriert nicht", SONDERN „es zentriert zu spät".
// `focusMapOnActiveTargets()` (map-features.js) setzt die Ansicht auf den Pin schon lange -- aber
// erst im `.then()` des Karten-Abrufs, und der lädt rund 20 MB. Wer den Link öffnet und hinsieht,
// sieht bis dahin den Kontinent. Owner 24.08.2026: „pin setzt übrigens ein pin aber fliegt nicht
// hin". Live nachgemessen: nach dem Abruf stand die Karte sehr wohl auf 465,00/529,59 @ z4 --
// die Meldung galt der Wartezeit, nicht einer fehlenden Zeile.
//
// 🔴 GEPRÜFT WIRD DIE ECHTE FUNKTION, NICHT IHR TEXT. bootstrap.js baut beim Laden eine echte
// Leaflet-Karte auf und ist nicht require-bar (siehe bootstrap-panes.test.js); der Ausweg des
// Hauses ist statische Textprüfung. Hier geht es einen Schritt weiter: die Funktion wird aus der
// Datei GESCHNITTEN und mit Stubs ausgeführt -- ohne Leaflet, aber mit ihrem echten Rumpf. Eine
// abgeschriebene Kopie hätte den Fehler, den sie fangen soll, nicht gefangen.
//
// Aus der Wurzel des Repos:  node js/app/__tests__/startansicht-share-pin.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const quelle = fs.readFileSync(path.join(__dirname, "..", "bootstrap.js"), "utf8");

// ---- Die Funktion herausschneiden ----------------------------------------------------------------
// ⚠️ Klammern zählen, nicht auf ein `}` am Zeilenanfang hoffen: der Rumpf trägt einen try/catch.
const start = quelle.indexOf("function avesmapsInitialViewFromSharePin()");
assert.ok(start >= 0, "avesmapsInitialViewFromSharePin steht in bootstrap.js");
let tiefe = 0;
let ende = -1;
for (let i = quelle.indexOf("{", start); i < quelle.length; i += 1) {
	if (quelle[i] === "{") { tiefe += 1; }
	if (quelle[i] === "}") { tiefe -= 1; if (tiefe === 0) { ende = i + 1; break; } }
}
assert.ok(ende > start, "die Funktion laesst sich vollstaendig herausschneiden");
const rumpf = quelle.slice(start, ende);

function lauf(stubs) {
	const ctx = {
		window: stubs.window || {},
		URLSearchParams,
		Math,
		Number,
		readSharePinFromUrl: stubs.readSharePinFromUrl,
		avesmapsDefaultMapZoom: stubs.avesmapsDefaultMapZoom || (() => 3),
		DEFAULT_SHARE_PIN_ZOOM: stubs.DEFAULT_SHARE_PIN_ZOOM !== undefined ? stubs.DEFAULT_SHARE_PIN_ZOOM : 4,
	};
	vm.createContext(ctx);
	vm.runInContext(`${rumpf}\n__ergebnis = avesmapsInitialViewFromSharePin();`, ctx);
	return ctx.__ergebnis;
}

const FENSTER = { location: { search: "?pin=465.000,529.594" } };

// ---- A. Mit Pin: die Karte geht dort auf ----------------------------------------------------------
const mitPin = lauf({
	window: FENSTER,
	readSharePinFromUrl: () => ({ lat: 465, lng: 529.594 }),
});
// ⚠️ Elementweise, nicht deepStrictEqual: das Array entsteht IM vm-Kontext und hat dort einen
// eigenen Array-Prototyp -- der Vergleich schlaegt sonst mit identisch gedruckten Werten fehl.
assert.strictEqual(mitPin.center[0], 465, "der Mittelpunkt IST der Pin (lat = y)");
assert.strictEqual(mitPin.center[1], 529.594, "und lng = x -- in dieser Reihenfolge");
assert.strictEqual(mitPin.zoom, 4, "und die Zoomstufe mindestens DEFAULT_SHARE_PIN_ZOOM");

// 🔴 Am Telefon steht die Standardstufe eine Stufe weiter heraus (2) -- der Pin zieht sie trotzdem
// auf 4 hoch. Ein geteilter Punkt, den man nicht findet, ist kein geteilter Punkt.
assert.strictEqual(lauf({
	window: FENSTER,
	readSharePinFromUrl: () => ({ lat: 465, lng: 529.594 }),
	avesmapsDefaultMapZoom: () => 2,
}).zoom, 4, "am Telefon zieht der Pin die Stufe hoch");

// Und umgekehrt gewinnt die groessere Stufe, falls die Startansicht je naeher heranginge.
assert.strictEqual(lauf({
	window: FENSTER,
	readSharePinFromUrl: () => ({ lat: 465, lng: 529.594 }),
	avesmapsDefaultMapZoom: () => 6,
}).zoom, 6, "eine naehere Startstufe wird nicht herausgezoomt");

// ---- B. Ohne Pin: nichts -- der normale Weg bleibt unberuehrt -------------------------------------
assert.strictEqual(lauf({ window: { location: { search: "" } }, readSharePinFromUrl: () => null }), null,
	"ohne Pin liefert die Saat nichts");

// 💣 Ein kaputter Parameter darf die Startansicht NICHT verhindern -- bootstrap.js ist ein flaches
// Skript ohne try/catch, ein Wurf hier legt alles darunter tot (die Lehre aus bootstrap-panes).
assert.strictEqual(lauf({
	window: FENSTER,
	readSharePinFromUrl: () => { throw new Error("kaputt"); },
}), null, "ein Wurf im Leser wird gefangen und faellt auf die normale Startansicht zurueck");

// ⚠️ Und wenn der Leser noch gar nicht geladen ist (Ladereihenfolge verstellt), ebenfalls kein Wurf.
assert.strictEqual(lauf({ window: FENSTER, readSharePinFromUrl: undefined }), null,
	"fehlender Leser -> null, kein ReferenceError");

// ---- C. Verdrahtung: die Saat wird auch benutzt, und sie schlaegt den Editor-Ausschnitt ----------
// 💣 Ohne diese Haelfte ist die Rechnung oben folgenlos (Hausregel).
assert.ok(/const avesmapsInitialMapView = avesmapsInitialViewFromSharePin\(\) \|\| getInitialEditMapView\(\);/.test(quelle),
	"der Pin schlaegt den gespeicherten Editor-Ausschnitt und die Vorgabe");
assert.ok(/setView\(avesmapsInitialMapView\.center, avesmapsInitialMapView\.zoom\)/.test(quelle),
	"und die Karte wird mit genau dieser Ansicht angelegt");

// ---- D. Die gekoppelte Zahl -----------------------------------------------------------------------
// 💣 `focusMapOnActiveTargets()` laeuft nach dem Abruf ueber dieselbe Lage und rechnet
// `max(map.getZoom(), DEFAULT_SHARE_PIN_ZOOM)`. Nur weil die Saat MINDESTENS diese Stufe setzt, ist
// jener Aufruf ein No-op -- sonst ruckt die Karte doch noch, nur spaeter. Beide muessen dieselbe
// Konstante lesen; eine abgeschriebene Zahl hier oder dort bringt den Sprung zurueck.
const karte = fs.readFileSync(path.join(__dirname, "..", "..", "map-features", "map-features.js"), "utf8");
assert.ok(/Math\.max\(map\.getZoom\(\), DEFAULT_SHARE_PIN_ZOOM\)/.test(karte),
	"focusMapOnActiveTargets rechnet weiterhin mit DEFAULT_SHARE_PIN_ZOOM");
assert.ok(/DEFAULT_SHARE_PIN_ZOOM/.test(quelle),
	"und die Saat liest dieselbe Konstante, statt eine Zahl abzuschreiben");

console.log("startansicht-share-pin: alle Zusicherungen erfuellt");

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Prüfhaken „Offene Wegenden" (Idee #86). Bewacht drei Dinge, die alle schon einmal woanders im Haus
// schiefgegangen sind:
//   1. die Rechnung wird GERUFEN, nicht nachgebaut (sonst zweite Wahrheit -- AGENTS.md §5),
//   2. ohne Bestand gibt es KEIN Urteil (sonst meldet der Haken beim Start alle 6.023 Wege als kaputt),
//   3. der Haken ZEIGT seine Funde (Owner 14.08.2026) -- Wegart-Filter und Zoom-Skalierung fallen,
//      Bildausschnitt und Kraftlinien-Modus bleiben.
const repoRoot = path.join(__dirname, "../../..");
const ladeBrowserSkript = (relativerPfad) => {
	const absolut = path.join(repoRoot, relativerPfad);
	vm.runInThisContext(fs.readFileSync(absolut, "utf8"), { filename: absolut });
};

// --- Umgebung -----------------------------------------------------------------------------------
// ⚠️ `globalThis`, nicht `{}` wie in den Nachbartests: das geprüfte Modul exportiert über `window.…`,
// und map-features-display-mode.js liest dieselben Namen als BLANKE Bezeichner. Im Browser ist das
// dasselbe, gegen ein leeres Objekt sähe pathShouldBeOnMap den Prüfhaken nie -- der Test wäre grün,
// weil er den Zusammenhang gar nicht herstellt, den er behauptet zu prüfen.
global.window = globalThis;
global.IS_EDIT_MODE = true;

let hakenAn = false;
// `.val()` gehoert dazu: map-features-display-mode.js bringt sein EIGENES getSelectedMapLayerMode mit
// und ueberschreibt beim Laden jeden Stub von hier -- es liest die Ansicht per jQuery aus dem Markup.
global.$ = (selektor) => ({
	is: () => selektor === "#toggleOpenPathEnds" && hakenAn,
	val: () => "deregraphic",
});
global.DEFAULT_PLANNER_STATE = { mapLayerMode: "deregraphic" };

// Leaflet nur so weit, wie das Zeichnen der Ringe es anfasst.
const gezeichneteMarker = [];
global.L = {
	divIcon: (optionen) => ({ optionen }),
	marker: (latlng) => {
		const marker = {
			latlng,
			bindTooltip() { return marker; },
			on() { return marker; },
			addTo() { return marker; },
		};
		gezeichneteMarker.push(marker);
		return marker;
	},
	layerGroup: () => ({ addTo() { return this; }, removeLayer() {} }),
	DomEvent: { stop() {} },
	// Fuer das echte getPathGeomBounds aus display-mode.js -- der Bildausschnitt wird unten geprueft,
	// und dafuer muss die bbox ein Objekt sein, ueber das ctx.bounds.intersects entscheiden darf.
	latLngBounds: () => ({ istBbox: true }),
};
global.map = { getZoom: () => 5 };
global.document = { documentElement: {} };
global.getComputedStyle = () => ({ getPropertyValue: () => "#e01b24" });

// 🔴 DER SPION. `getLocationAtPathEndpoint` ist die Rechnung, mit der BEIDE Graphbauer einen Weg
// annehmen oder verwerfen. Wird sie hier nicht gerufen, sondern nachgebaut, laufen Prüfhaken und
// Router auseinander -- genau der Fehler, der den Kreuzungs-Prüfhaken 182 Falschmeldungen kostete.
let endpunktAufrufe = 0;
let orte = [];
global.getLocationAtPathEndpoint = ([x, y]) => {
	endpunktAufrufe += 1;
	return orte.find((ort) => Math.abs(ort[0] - x) < 0.5 && Math.abs(ort[1] - y) < 0.5) || null;
};

global.pathData = [];
global.locationData = [];
global.getPathDisplayName = (p) => p?.properties?.name || "";
global.escapeHtml = (s) => String(s);
global.syncPathVisibility = () => {};
global.updatePathLayerStyle = () => {};
global.startPathGeometryEdit = () => {};
global.normalizePathSubtype = (s) => s;
global.getSelectedMapLayerMode = () => "deregraphic";

ladeBrowserSkript("js/map-features/map-features-open-path-check.js");

const weg = (name, von, bis) => ({
	properties: { name, feature_subtype: "Pfad" },
	geometry: { type: "LineString", coordinates: [von, [von[0] + 1, von[1] + 1], bis] },
});

// --- 1. Die Rechnung ----------------------------------------------------------------------------
orte = [[10, 10], [20, 20]];
const heil = weg("heil", [10, 10], [20, 20]);
const offenAmEnde = weg("offen-ende", [10, 10], [60, 60]);
const offenAmAnfang = weg("offen-anfang", [70, 70], [20, 20]);
global.pathData = [heil, offenAmEnde, offenAmAnfang];
global.locationData = [{ name: "irgendwas" }];
window.avesmapsInvalidateOpenPathEndCheck();

assert.strictEqual(window.avesmapsPathHasOpenEnd(heil), false,
	"ein Weg mit Ort an beiden Enden ist kein Befund");
assert.strictEqual(window.avesmapsPathHasOpenEnd(offenAmEnde), true,
	"ein Weg ohne Ort am ENDE ist ein Befund");
assert.strictEqual(window.avesmapsPathHasOpenEnd(offenAmAnfang), true,
	"ein Weg ohne Ort am ANFANG ebenso -- beide Enden zaehlen, nicht nur das letzte");
assert.strictEqual(window.avesmapsOpenPathEndCount(), 2, "zwei offene Enden auf drei Wegen");

// 💣 Und die Rechnung stammt nicht von hier. Ohne diese Zusicherung darf jemand die Endpunktsuche
// „schneller" nachbauen, und die zwei Fassungen driften beim ersten Toleranz-Feinschliff auseinander.
assert.ok(endpunktAufrufe >= 6, "getLocationAtPathEndpoint wird je Wegende GERUFEN (3 Wege x 2 Enden), nicht nachgebaut");

// 💣 Nur die ENDEN, nie ein innerer Stuetzpunkt. Der mittlere Punkt jedes Testwegs liegt bewusst im
// Nirgendwo -- wer versehentlich ueber alle Koordinaten laeuft, meldet auch `heil` als kaputt.
assert.strictEqual(window.avesmapsPathHasOpenEnd(heil), false,
	"ein innerer Stuetzpunkt ohne Ort ist KEIN offenes Ende");

// --- 2. Kein Bestand, kein Urteil ---------------------------------------------------------------
// 💣 Vor dem Eintreffen der Features faende die Endpunktsuche nirgends einen Ort. Ein Index, der das
// als Befund liest, meldet beim Start schlagartig JEDEN Weg der Karte als kaputt -- und cacht es.
global.locationData = [];
window.avesmapsInvalidateOpenPathEndCheck();
assert.strictEqual(window.avesmapsPathHasOpenEnd(offenAmEnde), false,
	"ohne locationData wird gar nicht geurteilt");
assert.strictEqual(window.avesmapsOpenPathEndCount(), 0, "und auch nichts gezaehlt");

// Und der Verzicht friert nicht ein: sobald der Bestand da ist, urteilt er wieder.
global.locationData = [{ name: "irgendwas" }];
assert.strictEqual(window.avesmapsPathHasOpenEnd(offenAmEnde), true,
	"der ausgesetzte Index wird beim naechsten Zugriff neu versucht, nicht als leer zementiert");

// --- 3. Der Riegel am Editiermodus --------------------------------------------------------------
hakenAn = true;
assert.strictEqual(window.avesmapsIsOpenPathEndCheckActive(), true, "im Editiermodus mit Haken: aktiv");
global.IS_EDIT_MODE = false;
assert.strictEqual(window.avesmapsIsOpenPathEndCheckActive(), false,
	"💣 ohne Editiermodus NIE aktiv -- sonst holt `?toggleOpenPathEnds=1` im geteilten Link den Haken zu jedem Besucher");
global.IS_EDIT_MODE = true;

// --- 4. Die Mindestbreite -----------------------------------------------------------------------
// 💣 getPathWidthScale faehrt eine Wegart auf kleinen Zoomstufen auf 0. Ein Fund der Breite 0 waere
// eingeblendet und trotzdem unsichtbar -- der Haken haette dann "seine Funde gezeigt" und nichts getan.
assert.ok(window.avesmapsOpenPathEndStyle(0).breite >= 3.5,
	"eine wegskalierte Wegart bekommt trotzdem eine sichtbare Breite");
assert.strictEqual(window.avesmapsOpenPathEndStyle(9).breite, 9,
	"eine ohnehin breitere Linie wird nicht duenner gemacht");
assert.strictEqual(window.avesmapsOpenPathEndStyle(1).farbe, "#e01b24",
	"💣 die Farbe ist ein AUSGELESENER Tokenwert, kein `var(...)`: Leaflet-Linienfarben tragen kein CSS-var");

// --- 5. „Ein Prüfhaken ZEIGT seine Funde" -------------------------------------------------------
// Die eigentliche Regel. Geprueft an der echten pathShouldBeOnMap, nicht an einer Nacherzaehlung.
global.getPathWidthScale = () => 0;          // Wegart auf dieser Zoomstufe weggerechnet
global.getVectorRenderer = () => null;
ladeBrowserSkript("js/map-features/map-features-display-mode.js");

const ctxAus = {
	showPaths: false, showRivers: false, showSeaPaths: false,   // ALLE Wegarten abgeschaltet
	zoom: 1, bounds: null, openEndCheck: true, powerlineMode: false,
};
assert.strictEqual(pathShouldBeOnMap(offenAmEnde, ctxAus), true,
	"🔴 ein Befund erscheint, obwohl seine Wegart abgeschaltet UND auf Breite 0 skaliert ist");
assert.strictEqual(pathShouldBeOnMap(heil, ctxAus), false,
	"ein gesunder Weg folgt weiter den Filtern -- der Haken blendet NUR seine Funde ein");

const ctxOhneHaken = { ...ctxAus, openEndCheck: false };
assert.strictEqual(pathShouldBeOnMap(offenAmEnde, ctxOhneHaken), false,
	"ohne Haken bleibt alles wie vorher");

// ⚠️ Was BLEIBT: der Kraftlinien-Modus (eine ANSICHT ohne jeden Weg, kein Filter ueber Wegarten)
// und der Bildausschnitt (sonst zeichnet die Karte alles).
assert.strictEqual(pathShouldBeOnMap(offenAmEnde, { ...ctxAus, powerlineMode: true }), false,
	"im Kraftlinien-Modus zeigt auch der Prüfhaken nichts");
assert.strictEqual(
	pathShouldBeOnMap(offenAmEnde, { ...ctxAus, bounds: { intersects: () => false } }), false,
	"und ausserhalb des Bildausschnitts wird nicht gezeichnet");
assert.strictEqual(
	pathShouldBeOnMap(offenAmEnde, { ...ctxAus, bounds: { intersects: () => true } }), true,
	"im Bildausschnitt dagegen schon (Gegenprobe -- sonst belegt die Zeile darueber nur, dass irgendetwas false ist)");

// --- 6. Das AUSSCHALTEN nimmt die Farbe zurück --------------------------------------------------
// 💣 Im Browser gemessen (22.08.2026): beim Ausschalten verschwanden die Ringe, die Linien blieben
// rot. Grund war der Performance-Riegel eine Ebene höher -- ohne Haken wird der Index nicht mehr
// gerechnet, also lief die Schleife über `index.wege` ins Leere und fasste keinen Weg mehr an.
// Ein Weg muss nach dem Ausschalten wieder durch getPathStyleColors laufen, sonst bleibt er rot.
const nachgezogen = [];
global.updatePathLayerStyle = (p) => nachgezogen.push(p.properties.name);

hakenAn = true;
window.avesmapsInvalidateOpenPathEndCheck();
window.avesmapsSyncOpenPathEndCheck({ zieheWegeNach: false });
assert.deepStrictEqual(nachgezogen.sort(), ["offen-anfang", "offen-ende"],
	"beim Einschalten werden genau die Funde neu gezeichnet");

nachgezogen.length = 0;
hakenAn = false;
window.avesmapsSyncOpenPathEndCheck({ zieheWegeNach: false });
assert.deepStrictEqual(nachgezogen.sort(), ["offen-anfang", "offen-ende"],
	"🔴 und beim AUSSCHALTEN ebenso -- sonst bleibt die rote Linie stehen, nachdem ihr Ring weg ist");

nachgezogen.length = 0;
window.avesmapsSyncOpenPathEndCheck({ zieheWegeNach: false });
assert.deepStrictEqual(nachgezogen, [],
	"beim zweiten Ausschalten ist nichts mehr zurueckzunehmen (die Liste leert sich)");

console.log("offene-wegenden: alle Zusicherungen erfuellt");

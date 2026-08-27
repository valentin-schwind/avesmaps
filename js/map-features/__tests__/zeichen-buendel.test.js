// Der Bündler für die Voll-Neuzeichnungen -- Vorgabe AN, `?zoombuendel=0` zurück.
//
// 💣 ACHT VOLL-NEUZEICHNUNGEN JE ZOOMSCHRITT. Grenzen- und Schraffur-Overlay hängen beide an
// `moveend zoomend viewreset resize`, und Leaflet feuert am Zoomende BEIDE -- der Handler läuft
// zweimal, zeichnet zweimal voll und meldet je drei blinde Nachzieh-Timer an (120/350/800 ms).
// Macht 2 + 6 = 8, je 52-99 ms.
//
// 🔴 Owner 27.08.2026 hat die Schwelle ausgemessen: bei 1500 ms Zoomdauer ist das Bild sauber, bei
// 1000 ms sieht er „doppel", bei 500 ms liegen die Straßen versetzt. Ein Fehler, der bei 4 s
// verschwindet und bei 500 ms stört, ist ein FESTER Betrag Arbeit -- für einen flotten Zoom muss
// rund eine Sekunde davon aus dem Zoomschritt heraus.
//
// 🔴 SEIT DEM 27.08.2026 IST ES DIE VORGABE. Es kam als Versuch hinter `?zoombuendel=1` live --
// weil an diesem Tag zwei Zoom-Änderungen nach der ZAHL besser und nach dem BILD schlechter waren
// und der Schalter der Ausweg war (Owner: „probiers unter neuem parameter"). Nach seinem Blick:
// „das beste was ich bisher gesehen hab".
// ⚠️ `?zoombuendel=0` muss den ALTEN Zustand exakt herstellen und bleibt deshalb geprüft: er ist
// die Vergleichsgrundlage für jede spätere Messung an dieser Stelle.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/zeichen-buendel.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const modulPfad = path.join(wurzel, "js/map-features/zeichen-buendel.js");

// Ein steuerbares requestAnimationFrame -- sonst misst der Test die Laune des Zeitgebers.
let bildWarteschlange = [];
function bildAusloesen() {
	const dran = bildWarteschlange;
	bildWarteschlange = [];
	dran.forEach((fn) => fn());
}

function ladeMit(suche) {
	global.window = {
		location: { search: suche },
		requestAnimationFrame(fn) { bildWarteschlange.push(fn); return bildWarteschlange.length; },
	};
	delete require.cache[require.resolve(modulPfad)];
	return require(modulPfad);
}

// --- ?zoombuendel=0: der alte Zustand, unveraendert und SYNCHRON -------------------------------
{
	const m = ladeMit("?zoombuendel=0");
	let laeufe = 0;
	const zeichne = m.avesmapsZeichenGebuendelt("test", () => { laeufe++; });
	zeichne(); zeichne(); zeichne();
	assert.strictEqual(laeufe, 3,
		"🔴 Mit `?zoombuendel=0` muss jeder Aufruf sofort zeichnen -- das ist der Notausgang auf den "
		+ "alten Zustand, und er ist die Vergleichsgrundlage.");
	assert.strictEqual(bildWarteschlange.length, 0,
		"🔴 Mit ?zoombuendel=0 darf nichts auf das naechste Bild verschoben werden.");

	// Und der Nachzug zeichnet ohne Schalter IMMER -- auch bei unveraenderten Daten.
	const daten = [1, 2, 3];
	let nachzuege = 0;
	const nachzug = m.avesmapsZeichenNachzugWennNeu("test-nachzug", () => { nachzuege++; }, () => daten);
	nachzug(); nachzug(); nachzug();
	assert.strictEqual(nachzuege, 3, "🔴 Mit ?zoombuendel=0 bleiben die drei blinden Nachzuege blind.");
}

// --- VORGABE (ohne Parameter): hoechstens EINE Zeichnung je Bild -------------------------------
{
	const m = ladeMit("");
	let laeufe = 0;
	const zeichne = m.avesmapsZeichenGebuendelt("test", () => { laeufe++; });
	// Das ist der Zoomende-Fall: `moveend` UND `zoomend` im selben Bild.
	zeichne(); zeichne();
	assert.strictEqual(laeufe, 0, "Vor dem naechsten Bild darf noch nichts gezeichnet sein.");
	bildAusloesen();
	assert.strictEqual(laeufe, 1,
		"💣 Zwei Aufrufe im selben Bild muessen EINE Zeichnung ergeben -- das ist der ganze Zweck.");
	// Und im naechsten Bild geht es wieder.
	zeichne();
	bildAusloesen();
	assert.strictEqual(laeufe, 2, "Ein spaeterer Aufruf muss wieder zeichnen (kein Dauer-Riegel).");
}

// --- VORGABE: der Nachzug fragt die DATEN ------------------------------------------------------
{
	const m = ladeMit("");
	let stand = ["a"];
	let laeufe = 0;
	const nachzug = m.avesmapsZeichenNachzugWennNeu("test-nachzug", () => { laeufe++; }, () => stand);

	nachzug();
	assert.strictEqual(laeufe, 1, "Der erste Nachzug zeichnet immer -- er kennt den Stand noch nicht.");
	nachzug(); nachzug();
	assert.strictEqual(laeufe, 1,
		"💣 Unveraenderte Daten duerfen keine Voll-Neuzeichnung ausloesen -- die drei Timer waren blind.");

	// ⭐ Geprueft wird die IDENTITAET, nicht der Inhalt: der Loader weist bei jedem Laden ein
	// FRISCHES Array zu. Ein gleicher INHALT unter neuer Referenz ist also neuer Stand.
	stand = ["a"];
	nachzug();
	assert.strictEqual(laeufe, 2, "Ein frisch zugewiesenes Array ist ein neuer Stand.");

	// 🪤 Und wenn der Datenstand WIRFT (Bindung noch nicht da), wird im Zweifel gezeichnet --
	// nicht geschluckt.
	let werfer = 0;
	const nachzug2 = m.avesmapsZeichenNachzugWennNeu("test-wurf", () => { werfer++; }, () => {
		throw new ReferenceError("regionData ist noch nicht da");
	});
	nachzug2(); nachzug2();
	assert.strictEqual(werfer, 2, "⚠️ Ein Wurf beim Datenstand darf nicht zum Schweigen fuehren.");
}

// --- Ohne „naechstes Bild" wird sofort gezeichnet ----------------------------------------------
// 🔴 KEINE STILLE AUSWEICHE, SONDERN EINE FAEHIGKEITSPRUEFUNG: gibt es kein
// `requestAnimationFrame`, gibt es auch kein Bild, in das gebuendelt werden koennte -- dann ist
// sofort zeichnen die einzig richtige Antwort. In einem echten Browser tritt der Fall nicht ein.
// 🪤 Gefunden am 27.08.2026 beim Umstellen der Vorgabe, und zwar in einem FREMDEN Test: der fuehrt
// das Grenzen-Overlay in einer VM aus, deren Fenster-Attrappe kein rAF hat -- „window.
// requestAnimationFrame is not a function".
{
	global.window = { location: { search: "" } };   // Fenster ohne rAF
	delete require.cache[require.resolve(modulPfad)];
	const m = require(modulPfad);
	let laeufe = 0;
	const zeichne = m.avesmapsZeichenGebuendelt("test-ohne-bild", () => { laeufe++; });
	zeichne(); zeichne(); zeichne();
	assert.strictEqual(laeufe, 3,
		"💣 Ohne requestAnimationFrame muss sofort gezeichnet werden -- sonst wirft der Buendler.");
}

// --- Ohne lesbare Adresszeile gilt die VORGABE --------------------------------------------------
// ⚠️ Der Rueckfall im catch. Er war beim Umstellen der Vorgabe zuerst ungeprueft: eine Mutation auf
// `return false` blieb gruen, weil kein Fall ihn erreichte.
{
	global.window = {
		get location() { throw new Error("keine Adresszeile"); },
		requestAnimationFrame(fn) { bildWarteschlange.push(fn); return bildWarteschlange.length; },
	};
	delete require.cache[require.resolve(modulPfad)];
	const m = require(modulPfad);
	let laeufe = 0;
	const zeichne = m.avesmapsZeichenGebuendelt("test-ohne-adresse", () => { laeufe++; });
	zeichne(); zeichne();
	assert.strictEqual(laeufe, 0, "⚠️ Ohne Adresszeile muss die VORGABE gelten -- also buendeln.");
	bildAusloesen();
	assert.strictEqual(laeufe, 1, "⚠️ Ohne Adresszeile muss die VORGABE gelten -- also buendeln.");
}

// --- Die Verdrahtung: beide Overlays benutzen ihn, und er wird VORHER geladen -------------------
const lies = (rel) => fs.readFileSync(path.join(wurzel, rel), "utf8").split("\r\n").join("\n");
const ohneKommentare = (t) => t
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

for (const [datei, name] of [
	["js/map-features/map-features-boundary-canvas-overlay.js", "grenzen"],
	["js/map-features/map-features-contested-hatch-overlay.js", "schraffur"],
]) {
	const q = ohneKommentare(lies(datei));
	// ⚠️ Zeilenumbruch-tolerant: der Nachzug-Aufruf steht mehrzeilig. Ein Test, der die einzeilige
	// Form voraussetzt, ist beim ersten Umbruch rot, ohne dass etwas kaputt waere -- genau das ist
	// hier im ersten Lauf passiert.
	const ruftAuf = (fn, arg) => new RegExp(fn + "\\(\\s*\"" + arg + "\"").test(q);
	assert.ok(ruftAuf("avesmapsZeichenGebuendelt", name),
		datei + ": meldet seine Voll-Neuzeichnung nicht beim Buendler an.");
	assert.ok(ruftAuf("avesmapsZeichenNachzugWennNeu", name + "-nachzug"),
		datei + ": die drei Nachzieh-Timer sind noch blind.");
	// 💣 Der Handler darf nicht MEHR direkt zeichnen -- sonst steht der Buendler daneben und wirkt nie.
	// 🪤 NICHT bis zum ersten `});` schneiden -- im Rumpf steht ein `forEach(... });`, und der Schnitt
	// landete davor. Bis zum naechsten `map.on(` ist die Grenze, die der Handler wirklich hat.
	const abHandler = q.slice(q.indexOf('map.on("moveend zoomend viewreset resize"'));
	const naechster = abHandler.indexOf("map.on(", 1);
	const bisEnde = naechster === -1 ? abHandler : abHandler.slice(0, naechster);
	assert.ok(!/\bredraw\(\);/.test(bisEnde),
		datei + ": der moveend/zoomend-Handler zeichnet weiterhin direkt -- der Buendler ist wirkungslos.");
	assert.ok(/zeichneGebuendelt\(\);/.test(bisEnde),
		datei + ": der Handler ruft den Buendler nicht.");
	assert.ok(/window\.setTimeout\(zeichneNachzug, delay\)/.test(q),
		datei + ": die Settle-Timer rufen nicht den datengetriebenen Nachzug.");
}

// 🔴 Ladereihenfolge: `const` auf Dateiebene wird nicht gehoistet.
const html = lies("index.html");
const posBuendel = html.indexOf("js/map-features/zeichen-buendel.js");
assert.ok(posBuendel > 0, "index.html laedt den Buendler gar nicht.");
for (const w of [
	"js/map-features/map-features-boundary-canvas-overlay.js",
	"js/map-features/map-features-contested-hatch-overlay.js",
]) {
	assert.ok(posBuendel < html.indexOf(w),
		"💣 zeichen-buendel.js wird NACH " + w + " geladen -- dort stuende dann undefined.");
}

console.log("OK: Vorgabe buendelt (eine Zeichnung je Bild, Nachzug datengetrieben), ?zoombuendel=0 stellt den alten Zustand her.");

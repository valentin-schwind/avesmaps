const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Die Haekchenmatrix „Namen -- Kollision" (Owner 02.09.2026: „berggipfel werden derzeit in die
// kollisionserkennung aufgenommen und verschoben"). Zwei Haekchen je NAMENSART, eingestellt im
// Fenster „Darstellung" des Landschaften-Editors:
//   teil   nimmt der Name am Ausweichen teil? Aus = er steht fest und belegt NICHTS.
//   fest   er nimmt teil, rueckt aber selbst nicht -- sein Rechteck wird VORGELEGT.
// Mockup: docs/label-kollision-matrix-mockup.html
//
// 🔴 DIESER TEST FAEHRT DEN ECHTEN DURCHGANG. Er stubbt weder ecosystem-display.js noch
// label-placement.js -- ein Stub hiesse, gegen erfundene Vorgaben zu pruefen, waehrend die Karte
// mit anderen laeuft. Bauform und Fake-DOM woertlich aus label-kollision-zoomband.test.js daneben.
//
// Lauf (aus dem Wurzelverzeichnis):  node js/map-features/__tests__/kollisionsmatrix.test.js

const loadBrowserScript = (absolutePath) => {
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};

// ⚠️ `getComputedStyle` braucht nur Abschnitt 2f: der ORTSNAME-Pfad liest seine Grundstellung aus
// CSS-Variablen. Leer heisst „nimm den Rueckfall" (LOCATION_LABEL_GAP) -- fuer die Frage dieses
// Tests („nimmt er ueberhaupt teil?") ist die genaue Stellung ohne Belang.
global.window = { getComputedStyle: () => ({ getPropertyValue: () => "" }) };
global.location = { search: "" };
global.document = { getElementById: () => null };
global.avesmapsLocationLabelSpacing = (name) => (name === "repel" ? 2 : 8);
global.avesmapsLocationZoomBandMinZoom = () => 0;
global.LOCATION_LABEL_GAP = 6;
global.locationNameLabels = [];
global.regionLabels = [];
global.map = { hasLayer: () => true, getZoom: () => 5 };

function macheLabelElement(box) {
	const klassen = new Set(["leaflet-marker-icon", "map-label"]);
	const bild = { getBoundingClientRect: () => ({ ...box }) };
	const gesetzt = {};
	return {
		classList: {
			contains: (name) => klassen.has(name),
			add: (name) => klassen.add(name),
			remove: (name) => klassen.delete(name),
		},
		querySelector: (auswahl) => (auswahl === "img" ? bild : null),
		style: { setProperty(name, wert) { gesetzt[name] = wert; } },
		istVersteckt: () => klassen.has("is-colliding"),
		versatzY: () => parseFloat(gesetzt["--label-offset-y"] || "0"),
		versatzX: () => parseFloat(gesetzt["--label-offset-x"] || "0"),
	};
}

function macheBox(links, oben, breite, hoehe) {
	return { left: links, top: oben, right: links + breite, bottom: oben + hoehe, width: breite, height: hoehe };
}

function macheLabelEintrag({ text, labelType, box, ecosystemRegionPublicId = "" }) {
	const element = macheLabelElement(box);
	return {
		label: {
			publicId: text, text, labelType, size: 18, rotation: 0,
			minZoom: 0, maxZoom: 7, priority: 3, showName: true, ecosystemRegionPublicId,
		},
		marker: { getElement: () => element, getLatLng: () => ({ lat: 0, lng: 0 }) },
		element,
	};
}

loadBrowserScript(path.join(__dirname, "../label-placement.js"));
loadBrowserScript(path.join(__dirname, "../ecosystem-display.js"));
loadBrowserScript(path.join(__dirname, "../map-features-label-collisions.js"));

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 1. DIE REGEL: die Vorgabe ist das HEUTIGE Bild, und alles Kaputte faellt darauf zurueck.
// ══════════════════════════════════════════════════════════════════════════════════════════════
avesmapsEcosystemDisplayInstall(null);
assert.deepStrictEqual(avesmapsEcosystemDisplayKollision("berggipfel"), { teil: true, fest: false },
	"ohne gespeicherte Tafel gilt die Vorgabe: teilnehmen ja, verschieben ja");
assert.strictEqual(avesmapsEcosystemDisplayKollisionsRolle("berggipfel"), "beweglich",
	"und die Rolle heisst dann „beweglich\" -- so zeichnet die Karte heute");

// 💣 DIE VORGABE MUSS DAS HEUTIGE BILD SEIN. Waere sie „fest" oder „aus", aenderte allein das
// Ausliefern das Kartenbild fuer 1018 Beschriftungen -- dieselbe Regel wie bei den Zoombaendern
// (zoombaender-vorgabe.test.js).
assert.deepStrictEqual(AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE, { teil: true, fest: false },
	"die Vorgabe reproduziert das heutige Verhalten Ziffer fuer Ziffer");

avesmapsEcosystemDisplayInstall({ kollision: { berggipfel: { teil: true, fest: true } } });
assert.strictEqual(avesmapsEcosystemDisplayKollisionsRolle("berggipfel"), "fest");
assert.strictEqual(avesmapsEcosystemDisplayKollisionsRolle("wald"), "beweglich",
	"eine Art ohne Eintrag bleibt bei der Vorgabe");

avesmapsEcosystemDisplayInstall({ kollision: { berggipfel: { teil: false } } });
assert.strictEqual(avesmapsEcosystemDisplayKollisionsRolle("berggipfel"), "aus");
assert.deepStrictEqual(avesmapsEcosystemDisplayKollision("berggipfel"), { teil: false, fest: false },
	"ein fehlendes Feld faellt einzeln auf die Vorgabe zurueck, nicht die ganze Zeile");

// 🔴 ALLES, WAS KEIN BOOLEAN IST, FAELLT AUF DIE VORGABE. `1` und `"true"` sehen aus wie ja und
// sind es nicht; der schlimmste Fall eines kaputten Einstellungswertes muss „es bleibt beim Alten"
// sein und nie „alle Namen verschwinden".
[{ teil: 1 }, { teil: "false" }, { teil: null }, [], "aus", 7, null].forEach((mist) => {
	avesmapsEcosystemDisplayInstall({ kollision: { berggipfel: mist } });
	assert.strictEqual(avesmapsEcosystemDisplayKollisionsRolle("berggipfel"), "beweglich",
		"kaputter Wert " + JSON.stringify(mist) + " faellt offen aus");
});

// Die Rolle aus einem MITGEGEBENEN Satz -- der Weg, den das Fenster geht (es darf seine
// Arbeitstafel nicht ins Modul schieben, siehe ecoDisplayInstalliereKurve).
assert.strictEqual(avesmapsEcosystemKollisionsRolleAus({ teil: true, fest: true }), "fest");
assert.strictEqual(avesmapsEcosystemKollisionsRolleAus({ teil: false, fest: true }), "aus",
	"„fest\" ohne „teil\" hat keinen Gegenstand -- die Rolle ist „aus\"");
assert.strictEqual(avesmapsEcosystemKollisionsRolleAus(undefined), "aus");
assert.deepStrictEqual(avesmapsEcosystemKollisionAus({ fest: true }), { teil: true, fest: true });

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 2. DER DURCHGANG. Zwei Namen, die einander im Weg stehen: ein Gipfel und ein Waldname, beide
//    auf demselben Fleck. Die Boxen sind an der gemessenen Groesse eines Gipfelnamens orientiert
//    (171 x 60 px bei Zoom 5, live 20.08.2026).
// ══════════════════════════════════════════════════════════════════════════════════════════════
const BREITE = 171;
const HOEHE = 60;

function fahre(regel, { gruppeGipfel = "", gruppeWald = "" } = {}) {
	avesmapsEcosystemDisplayInstall(regel ? { kollision: { berggipfel: regel } } : null);
	// Der Waldname steht ZUERST in der Liste und hat dieselbe Prioritaet -- bei Gleichstand
	// entscheidet die Reihenfolge, er bekommt seinen Platz also vor dem Gipfel.
	const wald = macheLabelEintrag({
		text: "Farindel", labelType: "wald", box: macheBox(100, 100, BREITE, HOEHE),
		ecosystemRegionPublicId: gruppeWald,
	});
	const gipfel = macheLabelEintrag({
		text: "Drei Schwestern", labelType: "berggipfel", box: macheBox(120, 110, BREITE, HOEHE),
		ecosystemRegionPublicId: gruppeGipfel,
	});
	global.labelMarkers = [wald, gipfel];
	const belegt = resolveLabelCollisions([]);
	return { wald, gipfel, belegt };
}

// ---- 2a. Heute: der Gipfel weicht aus -------------------------------------------------------
const heute = fahre(null);
assert.strictEqual(heute.gipfel.element.istVersteckt(), false, "heute bleibt er sichtbar");
assert.notStrictEqual(
	heute.gipfel.element.versatzX() + heute.gipfel.element.versatzY(), 0,
	"… aber er WEICHT AUS -- genau der gemeldete Zustand");
assert.strictEqual(heute.belegt.length, 2, "beide belegen Platz");

// ---- 2b. „Verschiebung unterdruecken": er steht, die anderen weichen IHM aus -----------------
const fest = fahre({ teil: true, fest: true });
assert.strictEqual(fest.gipfel.element.versatzX(), 0, "der festgenagelte Gipfel rueckt waagerecht nicht");
assert.strictEqual(fest.gipfel.element.versatzY(), 0, "und senkrecht auch nicht");
assert.strictEqual(fest.gipfel.element.istVersteckt(), false,
	"💣 UND ER VERSCHWINDET NICHT. „steht still ODER verschwindet\" machte aus „verschieb meine "
	+ "Gipfel nicht\" ein „loesch meine Gipfel\" -- deshalb ist er eine Vorbelegung, kein Teilnehmer");
assert.notStrictEqual(
	fest.wald.element.versatzX() + fest.wald.element.versatzY(), 0,
	"stattdessen weicht der Waldname aus -- die Richtung hat sich umgedreht");
assert.ok(fest.belegt.some((r) => r.left === 120 - 2 && r.top === 110 - 2),
	"das Rechteck des Gipfels liegt an seiner UNVERSCHOBENEN Stelle in der Belegung "
	+ "(Repel 2 px rundum) -- daran weichen ihm auch die Weg- und Flussnamen aus");

// ---- 2c. „Nicht beruecksichtigen": er steht, aber er belegt NICHTS ---------------------------
const aus = fahre({ teil: false, fest: false });
assert.strictEqual(aus.gipfel.element.versatzX(), 0, "er rueckt nicht");
assert.strictEqual(aus.gipfel.element.versatzY(), 0);
assert.strictEqual(aus.gipfel.element.istVersteckt(), false, "und er verschwindet nicht");
assert.strictEqual(aus.wald.element.versatzX(), 0,
	"⚠️ ABER NIEMAND WEICHT IHM AUS: der Waldname bleibt auf seinem Platz und ueberlappt ihn");
assert.strictEqual(aus.wald.element.versatzY(), 0);
assert.strictEqual(aus.belegt.length, 1,
	"nur der Waldname steht in der Belegung -- ein Strassenname darf durch den Gipfel hindurch");

// ---- 2d. Die Flaechen-Gruppe reist mit ------------------------------------------------------
// 💣 Ohne sie blockierte ein festgenagelter Name die uebrigen Namen SEINER EIGENEN Flaeche.
// Der Finsterkamm traegt seinen Namen im Norden UND im Sueden (Owner 2026-07-28); die zwei
// duerfen einander ueberlappen, und zwar weiterhin.
const gleicheFlaeche = fahre({ teil: true, fest: true }, { gruppeGipfel: "F-1", gruppeWald: "F-1" });
assert.strictEqual(gleicheFlaeche.wald.element.versatzX(), 0,
	"ein Name DERSELBEN Flaeche weicht dem festgenagelten NICHT aus");
assert.strictEqual(gleicheFlaeche.wald.element.versatzY(), 0);
assert.ok(gleicheFlaeche.belegt.some((r) => r.group === "F-1"),
	"die Gruppe steht am vorgelegten Rechteck -- sonst waere die Ausnahme nicht baubar");

// ---- 2e. Der Versatz wird auch bei den Ausgenommenen ZURUECKGESETZT --------------------------
// 💣 Ein Name, den die Tafel aus dem Durchgang nimmt, behielte sonst den Versatz des LETZTEN
// Durchgangs -- er bliebe fuer immer dort stehen, wohin ihn ein Nachbar geschoben hat.
// Gefahren wird das echte Nacheinander: erst beweglich (er weicht aus), dann „aus".
const nacheinander = (() => {
	const wald = macheLabelEintrag({ text: "Farindel", labelType: "wald", box: macheBox(100, 100, BREITE, HOEHE) });
	const gipfel = macheLabelEintrag({ text: "Drei Schwestern", labelType: "berggipfel", box: macheBox(120, 110, BREITE, HOEHE) });
	global.labelMarkers = [wald, gipfel];
	avesmapsEcosystemDisplayInstall(null);
	resolveLabelCollisions([]);
	const vorher = gipfel.element.versatzY();
	avesmapsEcosystemDisplayInstall({ kollision: { berggipfel: { teil: false } } });
	resolveLabelCollisions([]);
	return { vorher, nachher: gipfel.element.versatzY() };
})();
assert.notStrictEqual(nacheinander.vorher, 0, "im ersten Durchgang ist er ausgewichen");
assert.strictEqual(nacheinander.nachher, 0,
	"nach dem Umschalten steht er wieder auf seinem Punkt -- nicht eingefroren, wo er zuletzt lag");

// ---- 2f. Ortsnamen kennen diese Tafel nicht -------------------------------------------------
// ⚠️ Sie ist die der LANDSCHAFTEN. Selbst wenn jemand eine Ortsklasse als Namensart eintruege,
// darf ein Ortsname davon nichts merken.
avesmapsEcosystemDisplayInstall({ kollision: { stadt: { teil: false }, dorf: { teil: false } } });
global.labelMarkers = [];
global.locationNameLabels = [(() => {
	const element = macheLabelElement(macheBox(300, 300, 90, 20));
	element.classList.add("location-name-label");
	return {
		marker: { getElement: () => element },
		markerEntry: { locationType: "stadt" },
		element,
	};
})()];
assert.strictEqual(resolveLabelCollisions([]).length, 1,
	"der Ortsname nimmt weiter teil -- die Tafel der Landschaften gilt ihm nicht");
global.locationNameLabels = [];

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 3. DIE KURVEN-NAHT (Owner 02.09.2026: „kurven auch nachziehen").
//    Ein Name auf einer gerechneten Kurve laeuft NICHT durch den Durchgang -- er wird davor
//    gesetzt und nur als Hindernis gemeldet. Ohne den Riegel dort waere „nimmt nicht teil" fuer
//    ihn wirkungslos, und zwar fuer 85 von 1018 Beschriftungen (live 02.09.2026), darunter 44 der
//    75 Gebirgsnamen. Geprueft wird am QUELLTEXT, weil die Funktion im Rumpf eines IIFE mit
//    Leaflet-Abhaengigkeit steht.
// ══════════════════════════════════════════════════════════════════════════════════════════════
const overlay = fs.readFileSync(
	path.join(__dirname, "../map-features-path-label-canvas-overlay.js"), "utf8"
).replace(/\r\n/g, "\n");   // 💣 zeilenendenneutral: hier CRLF, im Deploy-Tor LF (AGENTS.md §9)

// 🪤 KOMMENTARE RAUS, BEVOR GEZAEHLT WIRD. Ueber der Funktion steht ein Block, der genau diese
// Bezeichner erklaert -- ein Test, der ihn mitliest, ist gruen, auch wenn der Code fehlt.
const overlayCode = overlay.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

assert.ok(/function kurvenlabelIstHindernis\(/.test(overlayCode),
	"der Riegel der Kurvennamen steht in der Datei");
assert.ok(/avesmapsEcosystemDisplayKollisionsRolle\([^)]*\)\s*!==\s*["']aus["']/.test(overlayCode),
	"… und er fragt DIESELBE Regel wie der Durchgang, statt eine eigene Auslegung zu bauen");
assert.ok(/if\s*\(!kurvenlabelIstHindernis\(eintrag\.label\)\)\s*\{\s*continue;\s*\}/.test(overlayCode),
	"… und er wird in avesmapsKurvenlabelPlatzierungen wirklich AUFGERUFEN "
	+ "(eine Funktion, die niemand ruft, ist die haeufigste Form von „gebaut, aber wirkungslos\")");

// 🔴 UND ER STEHT NUR DORT. „Nicht beruecksichtigen" ist eine Aussage ueber die Kollision, nicht
// ueber die Sichtbarkeit -- der Name bleibt auf der Karte, er haelt nur niemanden mehr ab. Ein
// Aufruf im Zeichner oder in berechneKurvenlabels() liesse ihn verschwinden.
assert.strictEqual((overlayCode.match(/kurvenlabelIstHindernis\(/g) || []).length, 2,
	"genau zwei Vorkommen: die Definition und der EINE Aufruf in avesmapsKurvenlabelPlatzierungen");

// ══════════════════════════════════════════════════════════════════════════════════════════════
// 4. DAS FENSTER liest die Tafel und schreibt sie -- ohne sie ins geteilte Modul zu schieben.
// ══════════════════════════════════════════════════════════════════════════════════════════════
const editor = fs.readFileSync(
	path.join(__dirname, "../../../html/landschaften-editor.html"), "utf8"
).replace(/\r\n/g, "\n");
const editorCode = editor.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

assert.ok(/ECO_DISPLAY_ABSCHNITTE\s*=\s*\[[^\]]*"kollision"/.test(editorCode),
	"💣 „kollision\" steht in ECO_DISPLAY_ABSCHNITTE -- der EINEN Liste, aus der Laden, Speichern "
	+ "und Zuruecksetzen ihre Abschnitte ziehen. Fehlt sie dort, verschwindet der Abschnitt beim "
	+ "Speichern lautlos");
// 🪤 NICHT einfach nach `ecoDisplayZeichneKollision();` suchen -- dieser Aufruf steht AUCH in
// ecoDisplaySetzKollision (das Neuzeichnen nach einem Häkchen). Eine Mutationsprobe hat genau das
// gefangen: die Zeile aus ecoDisplayZeichne() entfernt, und der Test blieb gruen. Geprueft wird
// deshalb der RUMPF des Zeichners. Die Verwandtschaft zur Falle „Quelltexttest trifft die
// Definitionszeile mit" ist kein Zufall: ein Bezeichner allein sagt nichts darueber, WER ihn ruft.
const zeichnerRumpf = (() => {
	const anfang = editorCode.indexOf("function ecoDisplayZeichne() {");
	assert.notStrictEqual(anfang, -1, "ecoDisplayZeichne() steht in der Datei");
	const rest = editorCode.slice(anfang);
	const ende = rest.indexOf("\n}");
	// ⚠️ KEIN `|| `-Rueckfall auf ein indexOf-Ergebnis: `-1 + 2` ist 1 und damit truthy -- der
	// Rumpf schrumpfte auf ein Zeichen zusammen, und die Zusicherung darunter waere Vakuum.
	assert.notStrictEqual(ende, -1, "… und ihr Rumpf ist geschlossen");
	return rest.slice(0, ende);
})();
assert.ok(/ecoDisplayZeichneKollision\(\);/.test(zeichnerRumpf),
	"der Abschnitt wird in ecoDisplayZeichne() wirklich gezeichnet -- nicht nur irgendwo in der Datei");
assert.ok(/avesmapsEcosystemKollisionAus\(ecoDisplayTeil\("kollision"\)\[art\]\)/.test(editorCode),
	"💣 das Fenster reicht seinen eigenen Satz HEREIN, statt den Modulzustand zu lesen -- die "
	+ "Arbeitstafel ins Modul zu schieben machte es zum Spiegel des Fensters (24.08.2026)");
assert.ok(!/avesmapsEcosystemDisplayInstall\(ecoDisplayZumSenden\(\)\)/.test(editorCode),
	"… und genau dieser Aufruf steht NICHT darin");

// 🔴 Die freien Namensarten werden GERECHNET, nicht aufgeschrieben.
assert.ok(/function ecoDisplayKollisionZeilen\(/.test(editorCode));
assert.ok(/mitFlaeche\s*=\s*new Set\(regionTypes\.map/.test(editorCode),
	"die freien Arten sind „Namensart ohne gleichnamige Flaechenart\" -- gerechnet aus regionTypes");
assert.ok(!/\[\s*["']berggipfel["']\s*,\s*["']vulkan["']/.test(editorCode),
	"💣 und NICHT als feste Liste der heute vier -- das waere ein zweites Vokabular (AGENTS.md §5) "
	+ "und liefe beim naechsten neuen Subtyp still auseinander");
assert.ok(/String\(kind\)\s*!==\s*"derographisch"/.test(editorCode),
	"… und sie stehen bei DEROGRAPHIE (Owner 02.09.2026)");

console.log("kollisionsmatrix.test.js: alle Zusicherungen erfuellt");

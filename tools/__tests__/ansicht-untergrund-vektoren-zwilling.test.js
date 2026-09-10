// Die neun `OVERLAYS`-Eintraege des Kartenfaechers (deregraphic/political/powerlines/ecosystem/
// none, dazu die vier Landschafts-Icons eco_derographisch/eco_vegetation/eco_topographie/
// eco_klima) stehen zweimal im Haus: als `OVERLAYS` in js/ui/map-layer-picker.js -- dem Bauteil,
// das wirklich auf der Karte erscheint -- und als Zwilling derselben Tabelle in
// tools/bau-ansicht-untergrund-mockup.js, dem Generator von docs/ansicht-untergrund-mockup.html.
//
// Der Zwilling ist kein Versehen: der Generator ist ABHAENGIGKEITSFREI und laeuft unter Node
// (`node tools/bau-ansicht-untergrund-mockup.js`, siehe dessen Dateikopf). Der Picker dagegen ist
// eine IIFE, die am Dateiende sofort `document` anspricht -- ihn im selben Node-Prozess zu
// `require`n braeuchte einen DOM-Stub, den der Generator ausdruecklich nicht haben soll. Deshalb
// zwei Dateien, nicht eine gemeinsame.
//
// 💣 GENAU DAS IST DIE LUECKE, DIE DIESER TEST SCHLIESST: der Owner nimmt die Icons im MOCKUP ab,
// ausgeliefert wird der PICKER. Laufen beide auseinander, gibt der Owner ein Icon frei, das nie
// auf der Karte erscheint -- und es faellt niemandem auf, weil jede Seite fuer sich richtig
// aussieht. tools/__tests__/ansicht-untergrund-mockup.test.js haelt nur die eine Haelfte
// (Generator-Ausgabe == docs/ansicht-untergrund-mockup.html); eine Aenderung ALLEIN im Picker
// faellt dort nie auf, weil dieser Test den Picker gar nicht liest.
//
// ⭐ Verglichen werden die WERTE, nicht der Quelltext: beide `OVERLAYS`-Literale werden aus ihrer
// Datei ausgeschnitten und unter `vm` als echtes JS-Objekt ausgefuehrt (im Haus ueblich, siehe
// z.B. js/app/__tests__/kartendaten-speicher.test.js). Ein Quelltextvergleich braeche an jedem
// Zeilenumbruch und jeder Einrueckung, die inhaltlich nichts bedeuten -- der Picker haengt an
// einer Tab-Einrueckung in einer IIFE, der Generator an keiner.
//
// ⚠️ Geprueft werden ALLE gemeinsamen Schluessel, nicht nur die vier neuen -- ecosystem,
// deregraphic, political, powerlines und none stehen ebenfalls doppelt, und der Wasserton hat den
// ecosystem-Vektor schon einmal in BEIDEN Dateien anfassen muessen (09.09.2026, Owner: der See
// traegt seither dieselbe Farbe wie der Fluss). Die Schluesselmenge wird zur LAUFZEIT gezaehlt,
// nie als Zahl im Kommentar behauptet -- eine Zahl liest sich wie eine vollstaendige Liste, und
// niemand zaehlt nach (AGENTS.md §9/§11).
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node tools/__tests__/ansicht-untergrund-vektoren-zwilling.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.join(__dirname, "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8");

/**
 * Schneidet ein Objekt-Literal `name = { ... }` aus Quelltext aus -- durch Klammertiefe, nicht
 * durch ein gieriges Regex bis zum naechsten `};`. Zeilen- und Blockkommentare werden dabei
 * uebersprungen, BEVOR Anfuehrungszeichen gezaehlt werden: ein Apostroph mitten in einem
 * deutschen Kommentar ("...die Karte sie...") wuerde sonst die Zeichenketten-Erkennung aus dem
 * Tritt bringen und die Suche liefe bis zum Dateiende, ohne je die schliessende Klammer zu sehen.
 * Das ist keine graue Theorie -- die erste Fassung dieses Helfers ist genau daran gescheitert.
 */
function schneideObjektLiteralAus(quelle, name) {
	const anker = new RegExp("\\b" + name + "\\s*=\\s*\\{");
	const treffer = anker.exec(quelle);
	assert.ok(treffer, "Anker `" + name + " = {` nicht gefunden");
	let i = treffer.index + treffer[0].length - 1; // Position der oeffnenden Klammer
	const anfang = i;
	let tiefe = 0;
	let inString = null;
	for (; i < quelle.length; i++) {
		const c = quelle[i];
		if (inString) {
			if (c === "\\") { i++; continue; } // Escape ueberspringen, z.B. \' oder \"
			if (c === inString) { inString = null; }
			continue;
		}
		if (c === "/" && quelle[i + 1] === "/") {
			const zeilenende = quelle.indexOf("\n", i);
			i = zeilenende === -1 ? quelle.length : zeilenende;
			continue;
		}
		if (c === "/" && quelle[i + 1] === "*") {
			const blockende = quelle.indexOf("*/", i + 2);
			i = blockende === -1 ? quelle.length : blockende + 1;
			continue;
		}
		if (c === "'" || c === '"') { inString = c; continue; }
		if (c === "{") { tiefe++; continue; }
		if (c === "}") {
			tiefe--;
			if (tiefe === 0) {
				return quelle.slice(anfang, i + 1);
			}
		}
	}
	throw new Error("`" + name + "`: keine schliessende Klammer gefunden");
}

/** Fuehrt ein ausgeschnittenes Objekt-Literal in einem frischen Kontext aus und gibt es zurueck. */
function alsObjekt(literalText) {
	return vm.runInNewContext("(" + literalText + ")", {}, { timeout: 2000 });
}

const pickerQuelle = lies("js", "ui", "map-layer-picker.js");
const generatorQuelle = lies("tools", "bau-ansicht-untergrund-mockup.js");

const picker = alsObjekt(schneideObjektLiteralAus(pickerQuelle, "OVERLAYS"));
const generator = alsObjekt(schneideObjektLiteralAus(generatorQuelle, "OVERLAYS"));

// ---- Schluesselmenge: BEIDE Seiten muessen dieselben Ebenen kennen -------------------------------
const alleSchluessel = Array.from(
	new Set(Object.keys(picker).concat(Object.keys(generator)))
).sort();

assert.ok(alleSchluessel.length > 0, "OVERLAYS ist in keiner der beiden Dateien leer");

const nurImPicker = alleSchluessel.filter((k) => !(k in generator));
const nurImGenerator = alleSchluessel.filter((k) => !(k in picker));

assert.deepStrictEqual(nurImPicker, [],
	"js/ui/map-layer-picker.js kennt Ebenen, die im Generator-Zwilling"
	+ " (tools/bau-ansicht-untergrund-mockup.js) fehlen: " + nurImPicker.join(", ")
	+ " -- der Owner sieht diese Icons im Mockup nie, obwohl sie auf der Karte erscheinen.");

assert.deepStrictEqual(nurImGenerator, [],
	"tools/bau-ansicht-untergrund-mockup.js kennt Ebenen, die es im ausgelieferten Picker"
	+ " (js/ui/map-layer-picker.js) nicht gibt: " + nurImGenerator.join(", ")
	+ " -- der Owner nimmt hier ein Icon ab, das nie auf der Karte erscheint.");

// ---- Wertgleichheit je gemeinsamem Schluessel ----------------------------------------------------
function kurzerAusschnitt(a, b) {
	let i = 0;
	const n = Math.min(a.length, b.length);
	while (i < n && a[i] === b[i]) { i++; }
	const spanne = 24;
	const schnitt = (t) => JSON.stringify(t.slice(Math.max(0, i - 8), i + spanne));
	return "\n  ab Zeichen " + i + " (Laenge " + a.length + " gegen " + b.length + "):"
		+ "\n  Picker:    " + schnitt(a)
		+ "\n  Generator: " + schnitt(b);
}

for (const schluessel of alleSchluessel) {
	const wertPicker = picker[schluessel];
	const wertGenerator = generator[schluessel];
	assert.strictEqual(typeof wertPicker, "string", "OVERLAYS." + schluessel + " ist im Picker ein String");
	assert.strictEqual(typeof wertGenerator, "string", "OVERLAYS." + schluessel + " ist im Generator ein String");
	assert.ok(wertPicker === wertGenerator,
		"OVERLAYS." + schluessel + " weicht zwischen js/ui/map-layer-picker.js und"
		+ " tools/bau-ansicht-untergrund-mockup.js ab -- der Owner nimmt im Mockup ein anderes"
		+ " Icon ab, als der Picker tatsaechlich zeichnet."
		+ kurzerAusschnitt(wertPicker, wertGenerator));
}

console.log(
	"ansicht-untergrund-vektoren-zwilling.test.js: " + alleSchluessel.length
	+ " OVERLAYS-Schluessel zeichengleich (" + alleSchluessel.join(", ") + ")"
);

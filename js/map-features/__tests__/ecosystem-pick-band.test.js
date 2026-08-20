// Bug #69 — waehrend einer booleschen Zielwahl trifft die KONTUR, nicht die Flaeche.
//
// Geprueft wird, was hier lautlos kippt und was man auf der Karte erst merkt, wenn eine Flaeche
// unerreichbar ist:
//   1. Die Bandbreite steht EINMAL als Token und wird von BEIDEN Regeln gelesen. Traegt die
//      Hervorhebung unter dem Zeiger wieder eine eigene Zahl, schrumpft der Anfasser genau in dem
//      Augenblick, in dem der Zeiger ihn erreicht.
//   2. Die Zielwahl trifft ueber `stroke` -- fuer die ruhenden UND fuer die aktive Ebene. Fehlt die
//      zweite, bleibt der gemeldete Fall (Vegetation <-> Vegetation) kaputt.
//   3. Die Kontur der Zielwahl gilt auch in 'Alle'. Ohne Kontur gibt es nichts zu treffen.
//   4. Klima bleibt draussen -- es kann kein Ziel sein und laege kartenbreit ueber allem.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/map-features/__tests__/ecosystem-pick-band.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im Kommentar
 *  ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts haelt.
 *  Dieselbe Vorsichtsmassnahme wie in js/app/__tests__/touch-scale.test.js. */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

const tokens = withoutComments(read("css", "base", "tokens.css"));
const sheet = withoutComments(read("css", "features", "ecosystem-layer.css"));

/** Alle Regelbloecke, deren Selektorliste `needle` enthaelt -> [{ selector, body }]. */
function rules(needle) {
	const found = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let match;
	while ((match = re.exec(sheet)) !== null) {
		const selector = match[1].trim();
		if (selector.includes(needle)) {
			found.push({ selector, body: match[2] });
		}
	}
	return found;
}

const TOKEN = "--ecosystem-pick-band-width";

// ---- 1. Die Breite steht einmal, und beide Regeln lesen sie -------------------------------------
const tokenLine = tokens.match(new RegExp(`${TOKEN}\\s*:\\s*([^;]+);`));
assert.ok(tokenLine, `${TOKEN} fehlt in css/base/tokens.css -- die Bandbreite ist der Anfasser, sie`
	+ " gehoert als Token an EINE Stelle (AGENTS.md §12).");
assert.strictEqual(tokenLine[1].trim(), "12px",
	`${TOKEN} steht auf "${tokenLine[1].trim()}" -- Owner-Entscheid 2026-08-14 ist 12px.`);

// 🪤 EXAKT, nicht per Teilstring: die beiden pointer-events-Regeln enden auf denselben Zeichen
// (`… .ecosystem-pane--picking > svg path.leaflet-interactive`) und faenden sich sonst mit.
const bandRules = rules(".ecosystem-pane--picking > svg path.leaflet-interactive")
	.filter((rule) => rule.selector.replace(/\s+/g, " ") === ".ecosystem-pane--picking > svg path.leaflet-interactive");
assert.strictEqual(bandRules.length, 1,
	`Das Trefferband wird von ${bandRules.length} Regeln beschrieben -- es muss genau EINE sein.`);
assert.ok(bandRules[0].body.includes(`stroke-width: var(${TOKEN})`),
	"Die Band-Regel liest die Breite nicht aus dem Token. Eine Zahl hier ist die zweite Wahrheit ueber"
	+ " dasselbe Trefferfeld.");

const targetRules = rules(".ecosystem-area--target");
assert.ok(targetRules.length > 0, "Die Regel fuer die Flaeche unter dem Zeiger ist verschwunden.");
targetRules.forEach((rule) => {
	// 💣 DIE EIGENTLICHE FALLE. Hier stand bis 2026-08-14 `stroke-width: 5`. Mit dem Band von 12px
	// waere das ein Sprung nach UNTEN in dem Moment, in dem der Zeiger die Kante erreicht -- der
	// Treffer ginge unter der Hand verloren, und zwar nur beim Ueberfahren, also genau dann nicht,
	// wenn man es per Screenshot nachstellt.
	const width = rule.body.match(/stroke-width\s*:\s*([^;]+);/);
	if (width) {
		assert.strictEqual(width[1].trim(), `var(${TOKEN})`,
			`.ecosystem-area--target setzt stroke-width auf "${width[1].trim()}" statt auf den`
			+ ` gemeinsamen Token. Beim Ueberfahren spraenge das Band von 12px auf diesen Wert.`);
	}
});

// ---- 2. Getroffen wird ueber die Kontur, in BEIDEN Ebenen-Zustaenden ----------------------------
// Klima bleibt hier draussen -- es hat seine eigene „none"-Regel, und die prueft Abschnitt 4.
const pickPointer = rules("ecosystem-pane--picking").filter((rule) =>
	/pointer-events\s*:/.test(rule.body)
	&& rule.selector.includes("path.leaflet-interactive")
	&& !rule.selector.includes(".ecosystem-pane--klima."));
assert.ok(pickPointer.length >= 2,
	`Nur ${pickPointer.length} pointer-events-Regel(n) fuer die Zielwahl gefunden. Es braucht die`
	+ " ruhenden UND die aktive Ebene -- der gemeldete Fall war Vegetation gegen Vegetation, also"
	+ " zweimal dieselbe Pane.");

const aktiv = pickPointer.filter((rule) => rule.selector.includes("ecosystem-pane--active"));
const ruhend = pickPointer.filter((rule) => rule.selector.includes("ecosystem-pane--resting"));
assert.strictEqual(aktiv.length, 1, "Die aktive Ebene hat keine eigene Zielwahl-Regel."
	+ " Ohne sie bleibt Leaflets `pointer-events: auto` stehen und die Fuellung trifft weiter.");
assert.strictEqual(ruhend.length, 1, "Die ruhenden Ebenen haben keine Zielwahl-Regel mehr.");

[...aktiv, ...ruhend].forEach((rule) => {
	const value = rule.body.match(/pointer-events\s*:\s*([^;]+);/);
	assert.ok(value, `Regel ohne pointer-events-Wert: ${rule.selector}`);
	assert.strictEqual(value[1].trim(), "stroke",
		`"${rule.selector}" trifft ueber "${value[1].trim()}" statt ueber "stroke". Mit "auto" nimmt`
		+ " die FUELLUNG den Klick, und eine ueberdeckte Flaeche ist wieder unerreichbar (Bug #69).");
});

// Klima ist in der aktiven Regel ausdruecklich ausgenommen -- ohne den :not haette es in 'Alle'
// dieselbe Klassenzahl wie seine eigene „none"-Regel, und die Reihenfolge im Stylesheet entschiede.
assert.ok(aktiv[0].selector.includes(":not(.ecosystem-pane--klima)"),
	"Die Zielwahl-Regel der aktiven Ebene nimmt Klima nicht aus. In 'Alle' stuende sie damit auf"
	+ " gleicher Staerke wie die Regel, die Klima klickdurchlaessig haelt -- und ein kartenbreites"
	+ " Band faenge wieder jeden Zielklick ab.");

// ---- 3. Die Kontur der Zielwahl gilt AUCH in 'Alle' ---------------------------------------------
const konturRules = rules("ecosystem-pane--picking").filter((rule) =>
	/--eco-contour\s*:/.test(rule.body) && !rule.selector.includes("path"));
assert.ok(konturRules.length > 0, "Keine Regel setzt --eco-contour fuer die Zielwahl.");

const fuerAktive = konturRules.filter((rule) => rule.selector.includes("ecosystem-pane--active"));
assert.strictEqual(fuerAktive.length, 1,
	"Die aktive Ebene bekommt waehrend der Zielwahl keine eigene Konturregel.");
// 💣 Das ist der Befund aus der Messung: `:not(.ecosystem-pane--showall)` an der allgemeinen
// Editier-Regel liess 'Alle' mit --eco-contour: 0 zurueck. Wer diese Ausnahme hier nachbaut, macht
// genau den Modus wieder blind, in dem man Ueberlappungen ansieht.
assert.ok(!fuerAktive[0].selector.includes(":not(.ecosystem-pane--showall)"),
	"Die Zielwahl-Konturregel schliesst 'Alle' aus. Dann ist dort die Kontur 0 -- und seit der Klick"
	+ " ueber die Kontur geht, gaebe es nichts mehr zu treffen.");
// 🪤 Nur die Regeln pruefen, die eine SICHTBARE Kontur setzen. Klima hat eine eigene, die sie waehrend
// der Zielwahl auf 0 zieht -- die ist der Punktfix von 2026-08-03 und soll Klima gerade treffen.
konturRules
	.filter((rule) => !/--eco-contour\s*:\s*0\s*;/.test(rule.body))
	.forEach((rule) => {
		assert.ok(rule.selector.includes(":not(.ecosystem-pane--klima)"),
			`"${rule.selector}" gibt auch Klima ein Leuchtband. Klima kann kein Ziel sein und laege`
			+ " kartenbreit ueber allem.");
	});

// ---- 4. Klima bleibt klickdurchlaessig ----------------------------------------------------------
const klima = rules(".ecosystem-pane--klima")
	.filter((rule) => rule.selector.includes("picking") && /pointer-events/.test(rule.body));
assert.ok(klima.some((rule) => /pointer-events\s*:\s*none/.test(rule.body)),
	"Die Regel, die ein Klimaband aus der Zielwahl heraushaelt, ist weg. Sie ist der Punktfix von"
	+ " 2026-08-03 (`ich kann nur die Klimazone anklicken`) und traegt weiter.");

// ---- 5. Die Flaeche unter dem Zeiger hebt sich WIRKLICH ab (Owner 20.08.2026) -------------------
//
// 💣 Bis dahin trugen Kandidat und Ziel DIESELBE Farbe und unterschieden sich allein in der Deckkraft
// der Kontur. Owner: „das highlight etwas staerker ... als nur minimal die transparenz der kontur zu
// veraendern." Geprueft wird deshalb, dass es mehr als eine Zahl ist, die die beiden trennt.
const bandFarbe = bandRules[0].body.match(/stroke\s*:\s*var\((--[a-z-]+)\)/);
assert.ok(bandFarbe, "Die Band-Regel setzt keine Konturfarbe mehr.");

const zielRegel = targetRules.find((rule) => /stroke\s*:\s*var\(/.test(rule.body));
assert.ok(zielRegel, "Die Regel fuer die Flaeche unter dem Zeiger setzt keine Konturfarbe.");
const zielFarbe = zielRegel.body.match(/stroke\s*:\s*var\((--[a-z-]+)\)/);

assert.notStrictEqual(zielFarbe[1], bandFarbe[1],
	`Kandidaten und Ziel lesen beide "${bandFarbe[1]}". Dann trennt die beiden Zustaende nur noch die`
	+ " Deckkraft -- der schwaechste Unterschied, den zwei Zustaende haben koennen, und auf zehn"
	+ " verschiedenen Grundtoenen stellenweise gar nicht zu sehen.");

assert.ok(/filter\s*:\s*drop-shadow/.test(zielRegel.body),
	"Dem Ziel fehlt sein Schein. Er traegt den Unterschied auf dunklen Grundtoenen, wo Farbe allein zu"
	+ " wenig ist. ⚠️ `filter` ist bewusst gewaehlt: es malt, ohne die Geometrie anzufassen, an der"
	+ " `pointer-events: stroke` das Treffen misst -- eine dickere Kontur waere ein anderer Anfasser.");

// 💣 UND DIE FUELLUNG MUSS AUCH GEWINNEN. Mit drei Klassen (0,3,2) verlor sie gegen
// `.ecosystem-pane--derographisch.ecosystem-pane--active > svg path.leaflet-interactive` weiter unten
// -- gleiche Staerke, spaeter im Blatt -- und die Hervorhebung blieb ausgerechnet auf der Ebene der
// grossen Behaelter bei 0,16 haengen. Genau dort liegen die Flaechen, um die es dem Owner ging.
const klassen = (selektor) => (selektor.match(/\.[a-zA-Z][\w-]*/g) || []).length;
const derographischFuellung = rules("ecosystem-pane--derographisch")
	.find((rule) => /fill-opacity/.test(rule.body) && rule.selector.includes("path.leaflet-interactive"));
assert.ok(derographischFuellung, "Die Fuellungsregel der derographischen Ebene ist verschwunden -- die"
	+ " Zusicherung darunter haette dann keinen Gegner mehr und waere still wertlos.");

const zielKlassen = Math.min(...zielRegel.selector.split(",").map(klassen));
assert.ok(zielKlassen > klassen(derographischFuellung.selector),
	`Die Ziel-Regel hat ${zielKlassen} Klassen, die Fuellungsregel der derographischen Ebene`
	+ ` ${klassen(derographischFuellung.selector)}. Bei gleicher Staerke gewinnt die spaetere im Blatt`
	+ " -- und das ist die derographische. Die Hervorhebung bliebe dort bei 0,16 haengen.");

// ---- 6. Der Schwebezettel kommt bei der ZIELWAHL zurueck ----------------------------------------
//
// 🔴 „Wartet eine Zielwahl" ist etwas anderes als „laeuft irgendetwas". Beim Malen, Zeichnen,
// Verschieben und Zerschneiden IST der Zeiger das Werkzeug, und ein Zettel daran verdeckt die Stelle,
// an der gearbeitet wird (Owner 2026-07-28). Bei der Zielwahl waehlt er aus -- da ist der Zettel die
// Antwort auf die Frage, die man stellt.
const ops = read("js", "map-features", "map-features-ecosystem-geometry-ops.js");
const renderer = read("js", "map-features", "map-features-ecosystem-rendering.js");

assert.ok(/isPickingTarget\s*:/.test(ops),
	"map-features-ecosystem-geometry-ops.js bietet kein `isPickingTarget` mehr an -- ohne das kann der"
	+ " Renderer die Zielwahl nicht von einer laufenden Bearbeitung unterscheiden.");
assert.ok(renderer.includes("isPickingTarget"),
	"Der Zettel-Riegel im Renderer fragt `isPickingTarget` nicht mehr. Dann schweigt der Zettel auch"
	+ " bei der Zielwahl, und man sieht wieder nicht, welche Flaeche man gleich waehlt.");
assert.ok(!/isEcosystemEditingInProgress\(\)\s*\)\s*\{\s*layer\.closeTooltip/.test(withoutComments(renderer)),
	"Der Riegel schliesst den Zettel wieder bedingungslos bei jeder Bearbeitung -- die Ausnahme fuer"
	+ " die Zielwahl ist weg.");

console.log("ecosystem-pick-band.test.js: alle Zusicherungen halten.");

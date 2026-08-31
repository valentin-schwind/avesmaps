// Die gemeldete Doppelbeschriftung bei Tiefenfurt (01.09.2026): EIN Weg, ZWEI Namen nebeneinander.
// Ursache war ein Zwischenraum, den Kanal A für eine Ortsstoß-Lücke hielt, obwohl dort ein Segment
// DESSELBEN Wegs ohne Wiki-Zuweisung liegt -- Kanal A malte über die gedachte Gerade, Kanal B
// entlang der echten Kurve. Dieser Test hält BEIDE Hälften fest: die Regel selbst (mit den echten
// Koordinaten des Falls) und ihre Verdrahtung im Zeichner -- eine Regel, die ihr einziger Aufrufer
// nicht benutzt, ist keine Regel.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const wayLabelsQuelle = fs.readFileSync(path.join(wurzel, "js", "map-features", "map-features-way-labels.js"), "utf8");
const overlayQuelle = fs.readFileSync(path.join(wurzel, "js", "map-features", "map-features-path-label-canvas-overlay.js"), "utf8");

// Die zwei reinen Helfer ausschneiden und WIRKLICH AUSFÜHREN -- ein Test, der nur nach Zeichenketten
// sucht, sähe einen vertauschten Koordinatenindex nie.
function schneideFunktion(quelle, name) {
	const start = quelle.indexOf("function " + name + "(");
	assert.ok(start !== -1, "Funktion " + name + " nicht gefunden");
	let tiefe = 0;
	for (let i = quelle.indexOf("{", start); i < quelle.length; i += 1) {
		if (quelle[i] === "{") {
			tiefe += 1;
		} else if (quelle[i] === "}") {
			tiefe -= 1;
			if (tiefe === 0) {
				return quelle.slice(start, i + 1);
			}
		}
	}
	throw new Error("unausgeglichene Klammern in " + name);
}

// ⚠️ Die zwei Toleranzen werden AUS DER QUELLE gelesen, nie hier abgeschrieben: eine Zahl, die der
// Test selbst setzt, prüft nur noch sich selbst und bleibt grün, wenn jemand die echte verstellt.
function schneideKonstante(quelle, name) {
	const start = quelle.indexOf("const " + name + " = ");
	assert.ok(start !== -1, "Konstante " + name + " nicht gefunden");
	const ende = quelle.indexOf(";", start);
	assert.ok(ende !== -1, "Konstante " + name + " nicht abgeschlossen");
	return quelle.slice(start, ende + 1);
}

const sandkasten = new Function([
	schneideKonstante(wayLabelsQuelle, "WAY_LABEL_CHAIN_GAP_EPS"),
	schneideKonstante(wayLabelsQuelle, "WAY_LABEL_FILLER_TOUCH_EPS"),
	schneideFunktion(wayLabelsQuelle, "wayLabelEndpointKey"),
	schneideFunktion(wayLabelsQuelle, "wayLabelArmDirection"),
	schneideFunktion(wayLabelsQuelle, "buildWayLabelChains"),
	schneideFunktion(wayLabelsQuelle, "buildWayLabelGapFillerIndex"),
	"return { buildWayLabelChains, buildWayLabelGapFillerIndex };",
].join("\n"))();
const { buildWayLabelChains, buildWayLabelGapFillerIndex } = sandkasten;

// Der Anzeigename, wie ihn der Zeichner sieht (im Browser: getPathDisplayName).
const anzeigename = (p) => String(p?.properties?.display_name || p?.properties?.original_name || p?.properties?.name || "").trim();

// --- 1. Der gemeldete Fall, mit den live gemessenen Koordinaten ------------------------------
// Sieben-Baronien-Weg: 26ac6ab6 endet an Glaumensee, 445aa217 beginnt an Tiefenfurt, dazwischen
// liegt 19df216a -- 3,30 Einheiten, das einzige unzugewiesene Segment dieses Wegs mit show_label.
const glaumensee = [660.422, 674.586];
const tiefenfurt = [660.82, 677.859];
const zugewiesen = [
	{ id: "26ac6ab6", coordinates: [[655.133, 675.328], glaumensee] },
	{ id: "445aa217", coordinates: [tiefenfurt, [662.453, 677.914]] },
];
// 💣 Der Füller beginnt NICHT exakt an Glaumensee (0,0422 daneben) -- genau deshalb hat Phase 1 ihn
// nie verkettet und Phase 2 den Rest für eine Lücke gehalten.
const fueller = [{ id: "19df216a", coordinates: [[660.438, 674.547], tiefenfurt] }];

assert.strictEqual(buildWayLabelChains(zugewiesen).length, 1,
	"ohne Füller-Wissen überbrückt Kanal A die 3,30 Einheiten wie bisher (der gemeldete Fehler)");
assert.strictEqual(buildWayLabelChains(zugewiesen, undefined, fueller).length, 2,
	"liegt dort ein Segment desselben Wegs, wird NICHT überbrückt");

// Gegenprobe: ein FREMDER Weg im Zwischenraum ist kein Füller -- dort macht der eigene Weg wirklich
// eine Lücke, und die Brücke bleibt richtig.
const index = buildWayLabelGapFillerIndex([
	{ properties: { public_id: "19df216a", name: "Sieben-Baronien-Weg" }, geometry: { type: "LineString", coordinates: fueller[0].coordinates } },
	{ properties: { public_id: "319b57ca", name: "Goblinpfad" }, geometry: { type: "LineString", coordinates: [[660.438, 674.547], tiefenfurt] } },
	{ properties: { public_id: "26ac6ab6", name: "Sieben-Baronien-Weg", wiki_path: { wiki_key: "w:sbw" } }, geometry: { type: "LineString", coordinates: [[655.133, 675.328], glaumensee] } },
], anzeigename);
// 💣 DER NAME KOMMT AUS DEM ANZEIGENAMEN, NICHT AUS properties.name -- und das ist kein Detail,
// sondern war die erste, wirkungslose Fassung dieses Fixes. Im CLIENT trägt properties.name den
// Autonamen ("Strasse-5854"), während der Weg "Hagweg" heißt; der echte Name steht in
// original_name/display_name, und getPathDisplayName ist die eine Stelle, die das auflöst -- exakt
// die Funktion, aus der der Zeichner auch group.name bildet. Ein Index über properties.name findet
// deshalb im Browser NICHTS, obwohl er gegen die rohe API-Nutzlast tadellos misst (dort steht der
// Klarname). Live gemessen 01.09.2026 am Hagweg.
// ⚠️ Genau deshalb ist die Namensfunktion ein PARAMETER: eine zweite Namensregel im Index wäre eine
// zweite Wahrheit über den Wegnamen.
const indexMitAutonamen = buildWayLabelGapFillerIndex([
	{ properties: { public_id: "efdb9ff3", name: "Strasse-5854", display_name: "Hagweg" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
], anzeigename);
assert.deepStrictEqual((indexMitAutonamen.get("Hagweg") || []).map((f) => f.id), ["efdb9ff3"],
	"ein Segment mit Autonamen muss unter seinem ANZEIGENAMEN im Index stehen");
assert.strictEqual(indexMitAutonamen.get("Strasse-5854"), undefined,
	"der Autoname ist kein Wegname und darf kein eigenes Fach bekommen");
// Ohne Namensfunktion bleibt der Index leer -- die sichere Richtung: kein Füller heißt altes
// Verhalten, während ein stiller Rückfall auf properties.name genau den Fehler oben zementierte.
assert.strictEqual(buildWayLabelGapFillerIndex([
	{ properties: { public_id: "x", name: "Hagweg" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
]).size, 0, "ohne Namensfunktion wird nichts indiziert");

// 💣 Die Namenstrennung leistet der INDEX, nicht die Kettenfunktion: die kennt nur Geometrie und
// würde jedes übergebene Segment als Füller nehmen. Deshalb ist DAS hier die tragende Zusicherung --
// der Goblinpfad läuft durch denselben Zwischenraum und darf nicht unter dem Wegnamen auftauchen,
// sonst sperrte ein fremder Weg eine Brücke, an der der eigene Weg wirklich eine Lücke hat.
assert.deepStrictEqual((index.get("Sieben-Baronien-Weg") || []).map((f) => f.id), ["19df216a"],
	"nur das unzugewiesene Segment DESSELBEN Namens ist Füller -- das zugewiesene gehört schon zu seiner Kette");
assert.deepStrictEqual((index.get("Goblinpfad") || []).map((f) => f.id), ["319b57ca"],
	"der fremde Weg liegt in seinem eigenen Fach, nicht im Fach des Sieben-Baronien-Wegs");
// Und ein Weg, für den es gar keinen Füller gibt, wird weiter überbrückt wie eh und je.
assert.strictEqual(buildWayLabelChains(zugewiesen, undefined, index.get("Reichsstrasse 2") || []).length, 1,
	"ohne Füller bleibt es beim bisherigen Verhalten");

// --- 2. Die Verdrahtung im Zeichner ----------------------------------------------------------
// ⚠️ Kommentare zuerst weg: dieser Abschnitt ist im Overlay ausführlich begründet, und ein Test, der
// die Begründung mitliest, bleibt grün, sobald jemand die Regel nur noch BESCHREIBT.
// ⚠️ Zeilenendenneutral: hier CRLF, im Deploy-Tor LF.
const ohneKommentare = overlayQuelle
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.split(/\r?\n/)
	.map((zeile) => zeile.replace(/(^|\s)\/\/.*$/, "$1"))
	.join("\n");

// 💣 MIT der Namensfunktion -- ohne sie liefert der Index im Browser einen LEEREN Fächer, weil
// properties.name dort der Autoname ist. Genau diese Fassung war einmal gebaut und wirkungslos.
const indexAufruf = ohneKommentare.indexOf("buildWayLabelGapFillerIndex(pathData, getPathDisplayName)");
assert.ok(indexAufruf !== -1,
	"der Zeichner muss den Index aus pathData UND getPathDisplayName bauen -- dieselbe Namensquelle wie group.name");
const gruppenSchleife = ohneKommentare.indexOf("wayGroups.forEach(");
assert.ok(gruppenSchleife !== -1, "Kanal-A-Gruppenschleife nicht gefunden");
assert.ok(indexAufruf < gruppenSchleife,
	"der Index wird EINMAL je Redraw gebaut, nicht je Gruppe (~410 Gruppen x ~6000 Pfade)");

const kettenAufrufe = ohneKommentare.match(/buildWayLabelChains\([^)]*\)/g) || [];
assert.ok(kettenAufrufe.length > 0, "der Zeichner ruft buildWayLabelChains");

// 💣 „Drei Argumente" reicht als Zusicherung NICHT. Eine Mutationsprobe hat genau das gezeigt:
// setzt man die Füller-Variable auf ein leeres Array, bleibt der Aufruf dreistellig, beide Hälften
// bleiben grün -- und der Fehler ist live zurück. Geprüft wird deshalb die KETTE: die Variable, die
// als dritter Parameter reist, muss dieselbe sein, die aus dem Index gefüllt wird.
const zuweisung = ohneKommentare.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*gapFillerIndex\.get\(/);
assert.ok(zuweisung, "die Füller müssen aus gapFillerIndex.get(...) kommen, nicht aus dem Nichts");
const fuellerVariable = zuweisung[1];
kettenAufrufe.forEach((aufruf) => {
	const teile = aufruf.replace(/^buildWayLabelChains\(/, "").split(",").map((t) => t.trim());
	assert.strictEqual(teile.length, 3,
		"jeder Ketten-Aufruf muss die Füller mitgeben, sonst wirkt die Regel nie: " + aufruf);
	assert.strictEqual(teile[2].replace(/\)$/, ""), fuellerVariable,
		"der dritte Parameter muss die aus dem Index gefüllte Variable sein: " + aufruf);
});

console.log("wegenamen-luecke-gefuellt: alle Zusicherungen erfüllt");

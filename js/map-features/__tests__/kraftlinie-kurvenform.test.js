// Die Rechnung hinter der Kurvenform einer Kraftlinie -- rein, ohne Leaflet und ohne DOM.
// Lauf (aus dem Repo-Wurzelverzeichnis):
//   node js/map-features/__tests__/kraftlinie-kurvenform.test.js
//
// Entwurf: docs/superpowers/specs/2026-08-29-kraftlinien-kurvenform-design.md
const assert = require("assert");
const {
	avesmapsPowerlineCurveNormalOffset,
	avesmapsPowerlineCurveSteps,
	avesmapsPowerlineCurvedPoints,
} = require("../powerline-topology.js");

// ---- 1. Die Nicht-Regression: curve = 0 ist EXAKT null -------------------------------------
// 🔴 Das ist die wichtigste Zusicherung des ganzen Vorhabens. Alle 62 Kraftlinien im Bestand sind
// gerade; wenn hier etwas anderes als eine harte Null herauskommt, wackelt die ganze Karte.
for (const t of [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1]) {
	assert.strictEqual(
		avesmapsPowerlineCurveNormalOffset(0, t, 0, 0, 20, 0), 0,
		`curve = 0 muss bei t = ${t} exakt 0 sein, nicht nur nahe null`
	);
}
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(null, 0.5, 0, 0, 20, 0), 0);
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(undefined, 0.5, 0, 0, 20, 0), 0);
assert.strictEqual(avesmapsPowerlineCurveNormalOffset("quatsch", 0.5, 0, 0, 20, 0), 0);

// ---- 2. Die Scheitelhoehe ist der versprochene Prozentsatz der SEHNE ------------------------
// Sehne 20 Einheiten, 25 % => 5,0 Einheiten im Scheitel. Die Parabel 4h*t(1-t) erreicht bei
// t = 0,5 genau h.
assert.ok(
	Math.abs(avesmapsPowerlineCurveNormalOffset(25, 0.5, 0, 0, 20, 0) - 5) < 1e-9,
	"Scheitel bei t=0,5 muss curve/100 * Sehnenlaenge sein"
);
// Und sie skaliert mit der Sehne, nicht absolut: dieselbe Zahl auf halber Laenge = halbe Hoehe.
assert.ok(
	Math.abs(avesmapsPowerlineCurveNormalOffset(25, 0.5, 0, 0, 10, 0) - 2.5) < 1e-9,
	"der Wert ist relativ zur Sehne -- halbe Sehne, halbe Hoehe"
);

// Die KURVENART, nicht nur der Scheitel. Alle vier im Mockup verglichenen Formen erreichen bei
// t = 0,5 exakt dieselbe Hoehe -- eine Zusicherung nur auf den Scheitel haelt die Owner-Entscheidung
// "Parabel" also gar nicht fest. Bei t = 0,25 trennen sie sich: Parabel 0,750 h, Sinus-Glocke
// 0,707 h, Kreisbogen 0,764 h, glatte Glocke 0,500 h.
assert.ok(
	Math.abs(avesmapsPowerlineCurveNormalOffset(25, 0.25, 0, 0, 20, 0) - 3.75) < 1e-9,
	"bei t = 0,25 muss die Parabel exakt 0,75 * h liefern (h = 5) -- sonst ist es eine andere Kurvenart"
);

// ---- 3. Die Enden sind null (die Nodices liegen AUF der Linie) ------------------------------
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(45, 0, 0, 0, 20, 0), 0);
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(45, 1, 0, 0, 20, 0), 0);

// ---- 4. Negativ spiegelt positiv EXAKT (der Owner-Satz vom 29.08.2026) ----------------------
for (const t of [0.15, 0.35, 0.5, 0.8]) {
	assert.strictEqual(
		avesmapsPowerlineCurveNormalOffset(-30, t, 0, 0, 20, 0),
		-avesmapsPowerlineCurveNormalOffset(30, t, 0, 0, 20, 0),
		`-30 muss bei t = ${t} die exakte Spiegelung von +30 sein`
	);
}

// ---- 5. Der Bereich wird GEKLEMMT, nicht abgelehnt ------------------------------------------
assert.strictEqual(
	avesmapsPowerlineCurveNormalOffset(999, 0.5, 0, 0, 20, 0),
	avesmapsPowerlineCurveNormalOffset(45, 0.5, 0, 0, 20, 0),
	"ueber 45 wird auf 45 geklemmt"
);
assert.strictEqual(
	avesmapsPowerlineCurveNormalOffset(-999, 0.5, 0, 0, 20, 0),
	avesmapsPowerlineCurveNormalOffset(-45, 0.5, 0, 0, 20, 0),
	"unter -45 wird auf -45 geklemmt"
);

// ---- 6. DIE KANONISCHE RICHTUNG -------------------------------------------------------------
// 💣 Der Kern von Entwurf §7: dasselbe Segment mit vertauschten Endpunkten muss auf DIESELBE
// Seite der Karte ausschlagen. Sonst klappt ein Umsortieren der Nodices (avesmapsReorderPowerlineLine
// kann Segmentrichtungen tauschen) jeden Bogen der Linie still um.
//
// Der Versatz laeuft entlang der Normalen n = (-ty, tx). Bei umgekehrter Speicherrichtung dreht
// sich n; damit der Punkt dennoch am selben Fleck liegt, muss der Versatz das Vorzeichen wechseln.
const hin = avesmapsPowerlineCurveNormalOffset(30, 0.5, 0, 0, 20, 0);    // West -> Ost
const her = avesmapsPowerlineCurveNormalOffset(30, 0.5, 20, 0, 0, 0);    // Ost -> West
assert.strictEqual(her, -hin, "die kanonische Richtung muss das Vorzeichen mitdrehen");

// Bei senkrechten Segmenten entscheidet y (Sued -> Nord ist die kanonische Richtung).
const hoch = avesmapsPowerlineCurveNormalOffset(30, 0.5, 0, 0, 0, 20);
const runter = avesmapsPowerlineCurveNormalOffset(30, 0.5, 0, 20, 0, 0);
assert.strictEqual(runter, -hoch, "bei gleichem x entscheidet y ueber die kanonische Richtung");

// Die Gegenprobe, die den Sinn der Regel misst: die tatsaechlich GEZEICHNETEN Punkte liegen bei
// vertauschten Endpunkten am selben Fleck (nur in umgekehrter Reihenfolge).
const bahnHin = avesmapsPowerlineCurvedPoints(0, 0, 20, 0, 30, 8);
const bahnHer = avesmapsPowerlineCurvedPoints(20, 0, 0, 0, 30, 8);
assert.strictEqual(bahnHin.length, bahnHer.length);
bahnHin.forEach((p, i) => {
	const q = bahnHer[bahnHer.length - 1 - i];
	assert.ok(Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9,
		`Punkt ${i} liegt bei vertauschten Endpunkten nicht am selben Fleck`);
});

// ---- 7. Die Stuetzpunktzahl -----------------------------------------------------------------
// 🔴 Bei curve = 0 EXAKT die heutige Grundzahl -- die 62 geraden Linien zahlen nichts.
assert.strictEqual(avesmapsPowerlineCurveSteps(0, 8), 8);
assert.strictEqual(avesmapsPowerlineCurveSteps(45, 8), 24, "voller Ausschlag => 24");
assert.strictEqual(avesmapsPowerlineCurveSteps(-45, 8), 24, "das Vorzeichen aendert die Zahl nicht");
// Monoton dazwischen.
let vorher = avesmapsPowerlineCurveSteps(0, 8);
for (let c = 1; c <= 45; c++) {
	const jetzt = avesmapsPowerlineCurveSteps(c, 8);
	assert.ok(jetzt >= vorher, `Stuetzpunkte duerfen bei ${c} nicht sinken`);
	vorher = jetzt;
}
// ⚠️ Eine Grundzahl ueber 24 darf nicht nach unten gezogen werden (jemand dreht segmentCount hoch).
assert.strictEqual(avesmapsPowerlineCurveSteps(45, 32), 32, "die Grundzahl ist die Untergrenze");

// ---- 8. Die Bahn: Endpunkte exakt getroffen -------------------------------------------------
const bahn = avesmapsPowerlineCurvedPoints(3, 7, 23, 7, 25, 12);
assert.strictEqual(bahn.length, 13, "steps = 12 ergibt 13 Punkte");
assert.ok(Math.abs(bahn[0].x - 3) < 1e-9 && Math.abs(bahn[0].y - 7) < 1e-9,
	"der erste Punkt IST der Nodix -- er darf nicht danebenliegen");
assert.ok(Math.abs(bahn[12].x - 23) < 1e-9 && Math.abs(bahn[12].y - 7) < 1e-9,
	"der letzte Punkt IST der Nodix");
assert.ok(Math.abs(bahn[6].y - (7 + 5)) < 1e-9, "der Scheitel steht 25 % von 20 = 5 Einheiten ab");

// ---- 9. Entartete Faelle fallen offen aus ---------------------------------------------------
// Ein Segment der Laenge 0 darf nicht durch null teilen und keine NaN erzeugen.
const entartet = avesmapsPowerlineCurvedPoints(5, 5, 5, 5, 40, 8);
entartet.forEach((p, i) => {
	assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), `Punkt ${i} eines Nullsegments ist NaN`);
});

// Und die Zusicherung, die den Sehnen-Riegel WIRKLICH misst. Eine Mutationsprobe am 29.08.2026
// zeigte: beim Nullsegment wird h ohnehin 0, der Riegel ist dort wirkungslos -- der Fall darueber
// haette ihn also loeschen lassen, ohne rot zu werden. Er faengt in Wahrheit UNBRAUCHBARE
// Koordinaten ab, und die sind nicht hypothetisch: getPowerlineLatLngs faellt auf die rohe
// Geometrie zurueck, wenn ein Nodix-Marker fehlt.
assert.strictEqual(avesmapsPowerlineCurveNormalOffset(30, 0.5, NaN, 0, 20, 0), 0,
	"eine unbrauchbare Koordinate muss 0 ergeben, nicht NaN -- ein NaN wandert sonst in die Geometrie");
avesmapsPowerlineCurvedPoints(NaN, 0, 20, 0, 30, 8).forEach((p, i) => {
	assert.ok(!Number.isNaN(p.y), `Punkt ${i} traegt ein NaN im Normalenversatz`);
});

console.log("OK: Kraftlinien-Kurvenform -- Rechnung, kanonische Richtung, Stuetzpunkte, Bahn.");

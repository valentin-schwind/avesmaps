// Kommt die Kurve aus dem Payload am normalisierten Label an -- und ist sie gedreht?
const assert = require("assert");
const fs = require("fs");
const path = require("path");

// ⚠️ map-features-labels.js laesst sich nicht als Ganzes laden (sie fasst beim Laden `map` an).
// Geprueft wird deshalb der Rumpf von normalizeLabelFeature, aus der Datei geschnitten und in einem
// eigenen Kontext ausgefuehrt. Das ist knauserig, aber ehrlich: der Test misst genau die Funktion,
// um die es geht, und behauptet nichts ueber den Rest der Datei.
// ⚠️ Der Schnitt beginnt NICHT erst bei normalizeLabelFeature selbst, sondern schon bei
// readLabelCurveLine: die beiden Kurven-Helfer stehen im Datei-Kontext DAVOR und wuerden sonst als
// Stubs eingeschleust -- dann pruefte der Test seine eigenen Attrappen statt der echten Drehung und
// Klemmung. `readFeatureOtherSource` bleibt Stub (der lebt in einer anderen Datei, js/app/utils.js,
// und interessiert diesen Test nicht); `readLabelHeightSchritt` ist real mit dabei, weil sie im
// selben Ausschnitt liegt.
const quelle = fs.readFileSync(path.join(__dirname, "..", "map-features-labels.js"), "utf8");
const von = quelle.indexOf("function readLabelCurveLine(");
assert.ok(von >= 0, "readLabelCurveLine steht in der Datei");
const endeMarke = quelle.indexOf("function normalizeLabelFeature(");
assert.ok(endeMarke > von, "normalizeLabelFeature steht dahinter");
const bis = quelle.indexOf("\n}", endeMarke);
assert.ok(bis > endeMarke, "und hat ein Ende");
const rumpf = quelle.slice(von, bis + 2);

// Der einzige Helfer, den der Ausschnitt ruft und der ausserhalb dieser Datei lebt.
const readFeatureOtherSource = () => null;
const normalizeLabelFeature = new Function(
  "readFeatureOtherSource",
  rumpf + "; return normalizeLabelFeature;"
)(readFeatureOtherSource);

// --- Ohne Kurve -------------------------------------------------------------------------------
const ohne = normalizeLabelFeature({
  geometry: {coordinates: [10, 20]},
  properties: {public_id: "l1", text: "Meer der Sieben Winde"},
});
assert.strictEqual(ohne.curveLine, null, "kein curve_label_line -> null, nicht []");
assert.strictEqual(ohne.curveMax, 1, "die Vorgabe ist 1");

// --- Mit Kurve -------------------------------------------------------------------------------
// 💣 Der Payload fuehrt [x, y]; Leaflet will [lat, lng] = [y, x]. Der Tausch ist die einzige Aufgabe
// dieser Zeile, und er ist genau die Sorte Fehler, die man auf der Karte erst sieht, wenn das Label
// irgendwo im Meer steht.
const mit = normalizeLabelFeature({
  geometry: {coordinates: [10, 20]},
  properties: {
    public_id: "l2",
    text: "Drachensteine",
    curve_label_line: [[100, 200], [110, 210], [120, 205]],
    curve_label_max: 2,
  },
});
assert.deepStrictEqual(mit.curveLine, [[200, 100], [210, 110], [205, 120]], "x/y getauscht zu lat/lng");
assert.strictEqual(mit.curveMax, 2);

// --- Schranken -------------------------------------------------------------------------------
const einPunkt = normalizeLabelFeature({
  geometry: {coordinates: [0, 0]},
  properties: {curve_label_line: [[1, 2]], curve_label_max: 1},
});
assert.strictEqual(einPunkt.curveLine, null, "ein einzelner Punkt ist keine Kurve");

// 🔴 Der Deckel ist 3 und die Untergrenze 1 -- serverseitig geklemmt, hier ein zweites Mal. Zwei
// Riegel sind hier KEIN Riegel zu viel: der Payload kann alt sein (der Deploy loescht nie,
// AGENTS.md §10), und eine 7 wuerde sieben Namen auf eine Kurve setzen.
const zuGross = normalizeLabelFeature({
  geometry: {coordinates: [0, 0]},
  properties: {curve_label_line: [[1, 2], [3, 4]], curve_label_max: 7},
});
assert.strictEqual(zuGross.curveMax, 3);
const zuKlein = normalizeLabelFeature({
  geometry: {coordinates: [0, 0]},
  properties: {curve_label_line: [[1, 2], [3, 4]], curve_label_max: 0},
});
assert.strictEqual(zuKlein.curveMax, 1);

// Eine kaputte Koordinate wirft die KURVE weg, nicht das LABEL.
const kaputt = normalizeLabelFeature({
  geometry: {coordinates: [0, 0]},
  properties: {text: "Koschberge", curve_label_line: [[1, 2], ["x", 4]], curve_label_max: 1},
});
assert.strictEqual(kaputt.curveLine, null, "kaputte Koordinate -> keine Kurve");
assert.strictEqual(kaputt.text, "Koschberge", "das Label selbst bleibt");

console.log("curve-label-normalize: alle Zusicherungen erfuellt");

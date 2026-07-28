const assert = require("assert");

// map-features-ecosystem-rendering.js reads `ecosystemGeometryArea` from the global scope in the
// browser (both files are plain <script> tags). Under Node it has to be put there before the module is
// required -- the same arrangement the geometry-ops test uses.
global.ecosystemGeometryArea = require("../map-features-ecosystem-geometry.js").ecosystemGeometryArea;

const {
	ecosystemDialogTitle,
	formatEcosystemAreaTooltip,
	ecosystemStackingOrder,
} = require("../map-features-ecosystem-rendering.js");

// ------------------------------------------------------------------------ DIALOGTITEL ---
// Owner 2026-07-28, wörtlich: „Vegetations-Label bearbeiten", „Derographie-Label bearbeiten",
// „Topographie-Label bearbeiten" -- und dasselbe mit „-Fläche". Das sind SEINE Wörter, keine aus
// ECOSYSTEM_KIND_LABELS abgeleiteten: dort heisst die Ebene „Derographische Region", und
// „Derographische Region-Label" wäre kein Deutsch.
assert.strictEqual(ecosystemDialogTitle("vegetation", "label"), "Vegetations-Label bearbeiten");
assert.strictEqual(ecosystemDialogTitle("derographisch", "label"), "Derographie-Label bearbeiten");
assert.strictEqual(ecosystemDialogTitle("topographie", "label"), "Topographie-Label bearbeiten");
assert.strictEqual(ecosystemDialogTitle("vegetation", "flaeche"), "Vegetations-Fläche bearbeiten");
assert.strictEqual(ecosystemDialogTitle("derographisch", "flaeche"), "Derographie-Fläche bearbeiten");
assert.strictEqual(ecosystemDialogTitle("topographie", "flaeche"), "Topographie-Fläche bearbeiten");

// 🪤 Ohne Ebene bleibt es allgemein. Ein Kontinent, ein Meer oder ein freier Kartentitel gehört zu
// keiner Landschaftsebene -- ihm „Vegetations-Label" überzuschreiben wäre eine erfundene Zuordnung.
// Gilt auch für den Moment, in dem die Zugehörigkeit noch nicht aufgelöst ist (der Titel wird
// zweistufig gesetzt), weshalb dieser Fall der häufigste von allen ist.
assert.strictEqual(ecosystemDialogTitle("", "label"), "Label bearbeiten");
assert.strictEqual(ecosystemDialogTitle(null, "flaeche"), "Fläche bearbeiten");
assert.strictEqual(ecosystemDialogTitle("unbekannt", "label"), "Label bearbeiten");
// Alles, was nicht "label" ist, ist eine Fläche -- ein Tippfehler im Aufruf darf keinen leeren Titel geben.
assert.strictEqual(ecosystemDialogTitle("vegetation", undefined), "Vegetations-Fläche bearbeiten");

// ---------------------------------------------------------------------------- TOOLTIP ---
// 🔴 Die Art mit ihrer BEZEICHNUNG, nicht mit ihrem Schlüssel. `region_type` ist `wald` -- ein
// Verbindungsschlüssel, kleingeschrieben, weil Schlüssel so aussehen; im Zettel las sich das wie ein
// Tippfehler (Owner-Screenshot 2026-07-28: „Mein Wald 1 (wald, Vegetation)").
assert.strictEqual(
	formatEcosystemAreaTooltip({
		region_name: "Mein Wald 1", kind: "vegetation",
		region_type: "wald", region_type_label: "Wald",
		region_area_count: 3, region_label_count: 2,
	}),
	"Mein Wald 1 (Wald, Vegetation) · Flächen (3) und Labels (2)"
);

// Fehlt die Bezeichnung (alter Zwischenspeicher, frisch gesäte Art), bleibt der Schlüssel stehen --
// ein Schlüssel ist schlechter als die Bezeichnung, aber besser als eine Lücke.
assert.strictEqual(
	formatEcosystemAreaTooltip({ region_name: "Mein Wald 1", kind: "vegetation", region_type: "wald" }),
	"Mein Wald 1 (wald, Vegetation) · Flächen (0) und Labels (0)"
);

// Ohne Art entfällt der Artteil ganz, statt ein einsames Komma zu hinterlassen. „Keine Art" ist ein
// gültiger Zustand -- der Flächendialog bietet ihn als „— keine Vegetation —" an.
assert.strictEqual(
	formatEcosystemAreaTooltip({ region_name: "Namenlos", kind: "topographie", region_type: "", region_area_count: 1, region_label_count: 1 }),
	"Namenlos (Topographie) · Flächen (1) und Labels (1)"
);

// Eine Fläche ohne Namen ist ein gültiger Zustand und braucht trotzdem einen Zettel.
assert.strictEqual(
	formatEcosystemAreaTooltip({ kind: "derographisch", region_area_count: 2, region_label_count: 0 }),
	"Ohne Namen (Derographische Region) · Flächen (2) und Labels (0)"
);

// 0 ist eine Aussage, kein Fehler: eine Region ohne Label gibt es wirklich (Wald-001, Wald-002).
assert.ok(formatEcosystemAreaTooltip({ region_name: "Wald-001", kind: "vegetation" }).endsWith("Labels (0)"));

// -------------------------------------------------------------------- STAPELREIHENFOLGE ---
// Ein Quadrat der Kantenlänge n hat den Flächeninhalt n².
const quadrat = (publicId, size) => ({
	public_id: publicId,
	geometry: { type: "Polygon", coordinates: [[[0, 0], [size, 0], [size, size], [0, size], [0, 0]]] },
});

// 🔴 Gross zuerst. Der Aufrufer holt in dieser Reihenfolge nach vorn, also landet die KLEINSTE zuletzt
// und damit ganz oben -- die enthaltene Fläche liegt auf ihrem Behälter und ist anklickbar.
assert.deepStrictEqual(
	ecosystemStackingOrder([quadrat("klein", 1), quadrat("gross", 10), quadrat("mittel", 5)]),
	["gross", "mittel", "klein"]
);

// Der Verschachtelungsfall, um den es geht: Kontinent ⊃ Insel ⊃ Provinz.
assert.deepStrictEqual(
	ecosystemStackingOrder([quadrat("provinz", 2), quadrat("kontinent", 100), quadrat("insel", 20)]),
	["kontinent", "insel", "provinz"]
);

// 🪤 STABIL bei Gleichstand: gleich grosse Flächen behalten ihre Eingangsreihenfolge. Ohne das würfelte
// jedes Nachladen die Stapelung neu, und derselbe Klick träfe beim zweiten Mal etwas anderes.
assert.deepStrictEqual(
	ecosystemStackingOrder([quadrat("a", 4), quadrat("b", 4), quadrat("c", 4)]),
	["a", "b", "c"]
);

// Eine Fläche ohne brauchbare Geometrie zählt als 0 und landet damit ganz oben -- oben ist der
// ungefährliche Platz: sie verdeckt nichts und ist nur selbst erreichbar.
assert.deepStrictEqual(
	ecosystemStackingOrder([{ public_id: "kaputt", geometry: null }, quadrat("gross", 10)]),
	["gross", "kaputt"]
);

// Zeilen ohne public_id fallen raus, statt eine leere Kennung in die Reihenfolge zu tragen.
assert.deepStrictEqual(ecosystemStackingOrder([{ geometry: null }, quadrat("da", 3)]), ["da"]);

// Leere und unsinnige Eingaben ergeben eine leere Reihenfolge, keinen Absturz.
assert.deepStrictEqual(ecosystemStackingOrder([]), []);
assert.deepStrictEqual(ecosystemStackingOrder(null), []);

console.log("ecosystem-rendering tests passed");

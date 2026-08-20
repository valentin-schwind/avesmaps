// Die Stapelreihenfolge der Landschaftsflächen kommt seit 19.08.2026 aus `stack_order`, nicht mehr
// aus der Flächengröße.
//
// 💣 DER GROSSE KASTEN STEHT HIER ABSICHTLICH VORN (hoher stack_order). Wäre die Größenregel noch
// aktiv, käme er nach hinten — der Test fällt also genau dann um, wenn jemand sie wiederbelebt.
// Die Regel lief am 19.08.2026 ein letztes Mal, als Startaufstellung auf dem Server
// (avesmapsEcosystemSeedStackOrder), und ist seither aufgelöst.

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const wurzel = path.join(__dirname, "..", "..", "..");

// Dieselbe Ladeform wie der Nachbartest ecosystem-rendering.test.js: die Datei liest
// `ecosystemGeometryArea` im Browser aus dem globalen Namensraum (beide sind schlichte
// <script>-Tags), unter Node muss es also vorher dort stehen.
// ⚠️ Kein `vm`-Kontext: eine Liste, die IM vm entsteht, hat eine andere Array-Prototype-Kette, und
// `deepStrictEqual` gegen ein hiesiges `[]` schlägt dann fehl — bei jeder Eingabe, die die Funktion
// nicht durchreicht, also ausgerechnet bei den Robustheitsfällen.
global.ecosystemGeometryArea = require("../map-features-ecosystem-geometry.js").ecosystemGeometryArea;

const { ecosystemStapelOrdnung } = require("../map-features-ecosystem-rendering.js");
assert.strictEqual(typeof ecosystemStapelOrdnung, "function", "ecosystemStapelOrdnung fehlt");

const quelle = fs.readFileSync(
	path.join(wurzel, "js/map-features/map-features-ecosystem-rendering.js"),
	"utf8"
);

// Ein n×n-Quadrat. Die Geometrie ist hier nur noch Beiwerk — und beweist damit genau das, worum es
// geht: sie wird für die Reihenfolge NICHT mehr gelesen.
const quadrat = (seite) => ({
	type: "Polygon",
	coordinates: [[[0, 0], [seite, 0], [seite, seite], [0, seite], [0, 0]]],
});

// ---- Die Zahl entscheidet, nicht die Fläche ------------------------------------------------------
assert.deepStrictEqual(
	ecosystemStapelOrdnung([
		{ public_id: "klein", kind: "vegetation", stack_order: 30, geometry: quadrat(1) },
		{ public_id: "gross", kind: "vegetation", stack_order: 40, geometry: quadrat(100) },
		{ public_id: "mittel", kind: "vegetation", stack_order: 10, geometry: quadrat(10) },
	]),
	["mittel", "klein", "gross"],
	"aufsteigend nach stack_order — die vorderste zuletzt, damit bringToFront sie obenauf legt"
);

// ---- Stabil bei Gleichstand ----------------------------------------------------------------------
// 🪤 Zwei Flächen mit derselben Zahl behalten ihre Eingangsreihenfolge. Sonst würfelte jedes
// Nachladen die Stapelung neu, und ein Klick träfe beim zweiten Mal etwas anderes.
assert.deepStrictEqual(
	ecosystemStapelOrdnung([
		{ public_id: "a", kind: "vegetation", stack_order: 10 },
		{ public_id: "b", kind: "vegetation", stack_order: 10 },
		{ public_id: "c", kind: "vegetation", stack_order: 10 },
	]),
	["a", "b", "c"],
	"Gleichstand behält die Eingangsreihenfolge"
);

// ---- Ohne Zahl: hinten ----------------------------------------------------------------------------
// Eine Fläche ohne `stack_order` ist noch nicht einsortiert (frisch angelegt, alter Payload) und
// zählt 0. Sie liegt damit hinten und verdeckt nichts, was schon eine Zahl hat.
assert.deepStrictEqual(
	ecosystemStapelOrdnung([
		{ public_id: "ohne", kind: "vegetation" },
		{ public_id: "mit", kind: "vegetation", stack_order: 5 },
	]),
	["ohne", "mit"],
	"ohne Zahl zählt 0 und liegt hinten"
);

// Unbrauchbare Werte zählen ebenfalls 0 statt NaN — eine NaN-Sortierung ist keine Sortierung.
assert.deepStrictEqual(
	ecosystemStapelOrdnung([
		{ public_id: "kaputt", kind: "vegetation", stack_order: "abc" },
		{ public_id: "gut", kind: "vegetation", stack_order: 5 },
	]),
	["kaputt", "gut"],
	"unbrauchbare Zahl zählt 0"
);

// ---- Robustheit ------------------------------------------------------------------------------------
assert.deepStrictEqual(ecosystemStapelOrdnung(null), [], "null ergibt eine leere Liste");
assert.deepStrictEqual(ecosystemStapelOrdnung([{ kind: "vegetation", stack_order: 5 }]), [],
	"eine Fläche ohne public_id fällt heraus — sie ließe sich nicht nach vorn holen");

// ---- Die abgeschaffte Regel darf nicht zurückkommen ----------------------------------------------
// 💣 Ein blanker Bezeichner, KEIN Aufrufmuster: `ecosystemStackingOrder(` fände einen Zugriff per
// `.ecosystemStackingOrder` nie. Genau diese Lücke ließ bei den Zoombändern drei Fundstellen
// fast durchrutschen.
["ecosystemStackingOrder"].forEach((name) => {
	assert.ok(
		!quelle.includes(name),
		`${name} steht noch in map-features-ecosystem-rendering.js — die Größenregel ist aufgelöst, `
			+ "eine zweite gerechnete Ordnung neben der gespeicherten wäre genau die Divergenz, "
			+ "die dieser Umbau abgeschafft hat."
	);
});

// ⚠️ `ecosystemGeometryArea` bleibt und ist NICHT die Regel — sie trägt die Plausibilitätsprüfung
// der booleschen Operationen und die Höhenkombination. Diese Zeile hält fest, dass sie beim
// Aufräumen nicht mitgenommen wurde.
const geometrie = fs.readFileSync(
	path.join(wurzel, "js/map-features/map-features-ecosystem-geometry.js"),
	"utf8"
);
assert.ok(
	geometrie.includes("function ecosystemGeometryArea"),
	"ecosystemGeometryArea fehlt — sie gehört nicht zur Stapelregel und muss bleiben"
);

console.log("ok - ecosystem-stapelreihenfolge");

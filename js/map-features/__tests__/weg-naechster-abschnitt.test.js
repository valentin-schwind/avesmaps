"use strict";
// Welcher Abschnitt eines Namens liegt dem Klickpunkt am naechsten (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.4)?
// Aus der Wurzel: node js/map-features/__tests__/weg-naechster-abschnitt.test.js
const assert = require("assert");
const path = require("path");
const A = require(path.join(path.resolve(__dirname, "..", "..", ".."), "js/map-features/weg-auswahl.js"));

// Abstand zur STRECKE, nicht zum naechsten Stuetzpunkt
assert.strictEqual(A.avesmapsWegAbstandZurLinie([5, 3], [[0, 0], [10, 0]]), 3, "senkrecht auf die Strecke");
assert.strictEqual(A.avesmapsWegAbstandZurLinie([-4, 3], [[0, 0], [10, 0]]), 5, "hinter dem Anfang zaehlt der Endpunkt");
assert.strictEqual(A.avesmapsWegAbstandZurLinie([2, 2], [[2, 2]]), 0, "eine Linie aus einem Punkt");
assert.strictEqual(A.avesmapsWegAbstandZurLinie([1, 1], []), Infinity);
assert.strictEqual(A.avesmapsWegAbstandZurLinie([NaN, 1], [[0, 0], [1, 0]]), Infinity);

const abschnitte = [
	{ public_id: "rs-6", koordinaten: [[0, 0], [10, 0]] },
	{ public_id: "rs-7", koordinaten: [[10, 0], [20, 0], [20, 10]] },
	{ public_id: "rs-8", koordinaten: [[20, 10], [30, 10]] },
];
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt(abschnitte, [19, 6]), "rs-7", "die Mitte einer Strecke von rs-7 liegt naeher als jeder Stuetzpunkt");
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt(abschnitte, [28, 12]), "rs-8");
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt(abschnitte, [10, 1]), "rs-6", "Gleichstand am gemeinsamen Ende: der erste in der Nummernfolge");
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt([], [1, 1]), null);
assert.strictEqual(A.avesmapsWegNaechsterAbschnitt([{ public_id: "", koordinaten: [[0, 0]] }, null], [0, 0]), null, "ohne Kennung kein Ziel");

console.log("weg-naechster-abschnitt.test.js: ok");

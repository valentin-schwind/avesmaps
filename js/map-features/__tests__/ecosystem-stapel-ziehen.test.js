// Drag-and-drop in der Stapelliste (Owner 20.08.2026: „über drag-n-drop die reihenfolge ändern").
//
// 💣 DER FEHLER UM EINS. Wird eine Zeile nach UNTEN gezogen, rutscht alles zwischen Start und Ziel um
// eine Stelle hoch, sobald sie herausgenommen ist — ohne Korrektur landet sie eine Stelle zu weit.
// Nach oben gezogen passiert das nicht. Beim Ausprobieren hält man das für ungenaues Ziehen und
// nicht für einen Rechenfehler; deshalb steht die Rechnung einzeln und wird einzeln geprüft.

const assert = require("node:assert");

// Die Datei ist eine IIFE, die sich beim Laden verdrahtet — unter Node fehlt `document`, und genau
// dafür trägt sie ihren `typeof document !== "undefined"`-Riegel.
const { avesmapsStapelZielIndex, avesmapsStapelUmsortieren } =
	require("../map-features-ecosystem-stapel.js");

assert.strictEqual(typeof avesmapsStapelZielIndex, "function", "avesmapsStapelZielIndex fehlt");
assert.strictEqual(typeof avesmapsStapelUmsortieren, "function", "avesmapsStapelUmsortieren fehlt");

// ---- Die Zielstelle --------------------------------------------------------------------------------
// Liste: 0 1 2 3 4 — gezogen wird die Zeile mit Index `von`, losgelassen über `zeile`.

// Nach OBEN: keine Korrektur, die Stellen darüber bleiben, wo sie sind.
assert.strictEqual(avesmapsStapelZielIndex(3, 1, true), 1, "über Zeile 1 abgelegt → Platz 1");
assert.strictEqual(avesmapsStapelZielIndex(3, 1, false), 2, "unter Zeile 1 abgelegt → Platz 2");
assert.strictEqual(avesmapsStapelZielIndex(4, 0, true), 0, "ganz nach oben");

// Nach UNTEN: eine Stelle abziehen, weil die gezogene Zeile vorher herausgenommen wird.
assert.strictEqual(avesmapsStapelZielIndex(0, 3, false), 3, "unter Zeile 3 abgelegt → Platz 3, nicht 4");
assert.strictEqual(avesmapsStapelZielIndex(0, 3, true), 2, "über Zeile 3 abgelegt → Platz 2");
assert.strictEqual(avesmapsStapelZielIndex(1, 4, false), 4, "ans Ende");

// Auf sich selbst abgelegt: nichts passiert (beide Hälften).
assert.strictEqual(avesmapsStapelZielIndex(2, 2, true), 2, "auf sich selbst, obere Hälfte");
assert.strictEqual(avesmapsStapelZielIndex(2, 2, false), 2, "auf sich selbst, untere Hälfte");

// ---- Die Umsortierung selbst -----------------------------------------------------------------------
const liste = ["a", "b", "c", "d", "e"];

assert.deepStrictEqual(avesmapsStapelUmsortieren(liste, 0, 2), ["b", "c", "a", "d", "e"], "nach unten");
assert.deepStrictEqual(avesmapsStapelUmsortieren(liste, 4, 0), ["e", "a", "b", "c", "d"], "nach ganz oben");
assert.deepStrictEqual(avesmapsStapelUmsortieren(liste, 2, 2), liste, "auf sich selbst ändert nichts");

// 🪤 Die Eingangsliste wird NICHT verändert — der Aufrufer hält sie als Stand VOR dem Ziehen fest,
// um bei einem abgelehnten Schreibvorgang dorthin zurückzukehren. Ein `splice` auf dem Original
// nähme ihm genau diesen Rückweg, und die Liste zeigte dann eine Reihenfolge, die es nicht gibt.
assert.deepStrictEqual(liste, ["a", "b", "c", "d", "e"], "die Eingangsliste bleibt unberührt");

// Unsinnige Stellen ergeben eine Kopie, keinen Absturz.
assert.deepStrictEqual(avesmapsStapelUmsortieren(liste, -1, 2), liste, "negativer Start");
assert.deepStrictEqual(avesmapsStapelUmsortieren(liste, 0, 99), liste, "Ziel ausserhalb");
assert.deepStrictEqual(avesmapsStapelUmsortieren(null, 0, 1), [], "keine Liste");

// ---- Und beides zusammen: die Kette, die beim Loslassen wirklich läuft -----------------------------
// „b" (Index 1) unter „d" (Index 3) fallen lassen → b landet direkt hinter d.
const ziel = avesmapsStapelZielIndex(1, 3, false);
assert.deepStrictEqual(
	avesmapsStapelUmsortieren(liste, 1, ziel),
	["a", "c", "d", "b", "e"],
	"b unter d abgelegt"
);

// Und die Gegenrichtung: „d" (Index 3) über „b" (Index 1) → d landet direkt vor b.
assert.deepStrictEqual(
	avesmapsStapelUmsortieren(liste, 3, avesmapsStapelZielIndex(3, 1, true)),
	["a", "d", "b", "c", "e"],
	"d über b abgelegt"
);

console.log("ok - ecosystem-stapel-ziehen");

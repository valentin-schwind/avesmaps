"use strict";
// „Ganze Straße" nennt Enden nur, wenn BEIDE Orte sind (Nachtrag 2026-09-14-wege-mehrfachzuweisung-design.md §9.3,
// Auslegung von §4: „fehlt dort ein Ortsname, steht nur ‚Ganze Straße'").
// Aus der Wurzel: node js/pages/__tests__/wege-ganze-strecke-nur-orte.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const M = require(path.join(WURZEL, "js/pages/wege-editor-model.js"));
const W = require(path.join(WURZEL, "js/map-features/weg-abschnitte.js"));
const A = require(path.join(WURZEL, "js/map-features/weg-auswahl.js"));

// Zwei Abschnitte hintereinander; `mitte` ist das gemeinsame innere Ende.
const kette = (von, mitte, bis) => [
	{ public_id: "a", ends: { from: [0, 0], to: [1, 0] }, enden: { von: von, bis: mitte } },
	{ public_id: "b", ends: { from: [1, 0], to: [2, 0] }, enden: { von: mitte, bis: bis } },
];

assert.ok(["Perz – Helmdahl", "Helmdahl – Perz"].includes(M.wpGanzeStrecke(kette("Perz", "Kreuzung", "Helmdahl"))),
	"beide aeusseren Enden Orte: die Strecke steht da, eine Kreuzung in der MITTE stoert nicht");
assert.strictEqual(M.wpGanzeStrecke(kette("Kreuzung", "Wieha", "Wegende")), "", "kein aeusseres Ende ist ein Ort");
assert.strictEqual(M.wpGanzeStrecke(kette("Perz", "Wieha", "Kreuzung")), "", "EIN fehlender Ortsname genuegt");
assert.strictEqual(M.wpGanzeStrecke(kette("Wegende", "Wieha", "Helmdahl")), "", "auch am anderen Ende");
assert.strictEqual(M.wpGanzeStrecke([]), "");

// Die Zeile, die daraus entsteht
assert.strictEqual(A.avesmapsWegMarkierungszeile({ gruppe: "g", publicId: null }, M.wpGanzeStrecke(kette("Kreuzung", "Wieha", "Wegende"))),
	"Ganze Straße", "die Markierungszeile sagt dann nur „Ganze Straße“");

// Ein ABSCHNITT darf weiter an einer Kreuzung oder einem Wegende enden (§4)
assert.strictEqual(M.wpAbschnittLabel({ enden: { von: "Perz", bis: "Kreuzung" } }, 3), "Abschnitt 3: Perz – Kreuzung");

// Die Woerter sind DIESELBEN wie im JS/PHP-Zwilling
assert.strictEqual(M.WP_ENDE_KREUZUNG, W.AVESMAPS_WEG_ENDE_KREUZUNG);
assert.strictEqual(M.WP_ENDE_OFFEN, W.AVESMAPS_WEG_ENDE_OFFEN);
const php = fs.readFileSync(path.join(WURZEL, "api/_internal/map/weg-abschnitt-ende.php"), "utf8").replace(/\r\n/g, "\n");
assert.ok(php.includes("const AVESMAPS_WEG_ENDE_KREUZUNG = '" + M.WP_ENDE_KREUZUNG + "';"), "PHP-Zwilling: Kreuzung");
assert.ok(php.includes("const AVESMAPS_WEG_ENDE_OFFEN = '" + M.WP_ENDE_OFFEN + "';"), "PHP-Zwilling: Wegende");

console.log("wege-ganze-strecke-nur-orte.test.js: ok");

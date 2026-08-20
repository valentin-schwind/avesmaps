// Die reine Frage hinter der Klick-Sperre: greift sie gerade?
//
// 🔴 ZWEI BEDINGUNGEN, und die zweite ist keine Formsache. Die Sperre gilt NUR im Bearbeiten-Modus.
// Für einen Besucher wäre eine gesperrte Region eine Region ohne Infopanel — ein Funktionsverlust,
// den er nicht erklären und nicht rückgängig machen kann.

const assert = require("node:assert");
const { avesmapsEcosystemSperreGreift } = require("../map-features-ecosystem-sperre.js");

const gesperrt = { public_id: "a", is_locked: true };
const offen = { public_id: "b", is_locked: false };

// ---- Die vier Fälle --------------------------------------------------------------------------------
assert.strictEqual(avesmapsEcosystemSperreGreift(gesperrt, true), true, "gesperrt + Editor = greift");
assert.strictEqual(avesmapsEcosystemSperreGreift(gesperrt, false), false,
	"gesperrt + Besucher = greift NICHT — sein Infopanel bleibt");
assert.strictEqual(avesmapsEcosystemSperreGreift(offen, true), false, "offen + Editor = greift nicht");
assert.strictEqual(avesmapsEcosystemSperreGreift(offen, false), false, "offen + Besucher = greift nicht");

// ---- Fehlendes zählt als „nicht gesperrt" ---------------------------------------------------------
// ⚠️ Die sichere Richtung: im Zweifel bleibt die Fläche bedienbar. Eine Fläche, die aus Versehen
// nicht mehr reagiert, sucht man lange — eine, die aus Versehen reagiert, fällt sofort auf.
assert.strictEqual(avesmapsEcosystemSperreGreift(undefined, true), false, "keine Fläche");
assert.strictEqual(avesmapsEcosystemSperreGreift(null, true), false, "null");
assert.strictEqual(avesmapsEcosystemSperreGreift({ public_id: "c" }, true), false, "kein Feld");
assert.strictEqual(avesmapsEcosystemSperreGreift({ is_locked: undefined }, true), false, "undefined");

// 💣 `=== true`, nicht `Boolean(...)`: `is_locked` reist als echter BOOLEAN im Payload
// (api/_internal/app/ecosystem.php gibt `(int) $row['is_locked'] === 1` heraus). Käme dort je eine
// „1" als Zeichenkette an, wäre das ein Fehler im Lesepfad und keine Sperre — er soll auffallen,
// statt zufällig zu funktionieren.
assert.strictEqual(avesmapsEcosystemSperreGreift({ is_locked: 1 }, true), false, "Zahl 1 ist kein true");
assert.strictEqual(avesmapsEcosystemSperreGreift({ is_locked: "1" }, true), false, "Zeichenkette ist kein true");

// Und dasselbe für die zweite Bedingung: ein fehlender Nachbar heisst NEIN.
assert.strictEqual(avesmapsEcosystemSperreGreift(gesperrt, undefined), false,
	'ohne Antwort auf „darf bearbeiten" greift die Sperre nicht');

console.log("ok - ecosystem-sperre-durchlass");

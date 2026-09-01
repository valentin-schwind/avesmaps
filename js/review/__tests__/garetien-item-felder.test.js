"use strict";

// =================================================================================================
// 🔴 WAS DIE KNOPFLEISTE AN EINEM ITEM LIEST, MUSS DER SERVER AUCH SCHICKEN
// =================================================================================================
//
// Meldung des Owners am 01.09.2026: „wie kann ich die übernommenen wieder öffnen?" — im Reiter
// „Übernommen" stand ein Objekt, und es trug KEINEN einzigen Knopf. Weder „Zurücknehmen" noch
// „Ablehnen" noch „Zurück nach Offen", nur die Zeile „Verändert ein bestehendes Objekt — nicht
// rücknehmbar".
//
// 💣 DIE URSACHE WAR EIN FELD, DAS DIE TÜR NIE VERLASSEN HAT. „Übernommen" hat zwei Quellen:
// `apply_state = 'done'` (nur im GERADE laufenden Lauf) und `applied` (der dauerhafte Vermerk in
// `sync_decision`, der ein „Holen & Rechnen" überlebt). Der Reiter rechnete serverseitig längst
// mit beiden — `avesmapsGaretienListeObjektStand` liest sie Zeile für Zeile —, und am 31.08.2026
// wurde eigens im Browser nachgezogen, dass „Zurück nach Offen" ebenfalls beide sieht
// (`item.apply_state === "done" || item.applied === true`).
//
// Nur schickte die Item-Nutzlast `applied` gar nicht mit. `item.applied` war im Browser für immer
// `undefined`, der zweite Zweig toter Code — und der Test dazu war grün, weil seine Fixture das
// Feld selbst erfunden hatte. Ein Leser, den nur der Test erreicht, ist kein Leser.
//
// ⭐ Dieser Test misst deshalb nicht ein Feld, sondern die FUGE: jedes `item.<feld>`, das die
// Fensterdatei liest, muss in der Nutzlast von garetien-liste.php stehen. Er fängt die ganze
// Klasse, nicht den einen Fall.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const PHP = path.join(WURZEL, "api", "_internal", "import", "garetien-liste.php");
const JS = path.join(WURZEL, "js", "review", "review-garetien-importer.js");

let pruefungen = 0;

// -------------------------------------------------------------------------------------------------
// Die Nutzlast: die Schlüssel des Arrays, das `'items' => array_map(…)` je Item zurückgibt.
// ⚠️ Der Anker `'items' => array_map` selbst gehört NICHT dazu — sonst zählte sich der Block als
// eigenes Feld mit und der Test wäre um genau diesen einen Namen zu großzügig.
// -------------------------------------------------------------------------------------------------
const phpText = fs.readFileSync(PHP, "utf8");
const von = phpText.indexOf("'items' => array_map");
assert.ok(von > 0, "der Item-Block muss auffindbar sein");
const bis = phpText.indexOf("}, $items)", von);
assert.ok(bis > von, "und sein Ende ebenso");
// 💣 Kommentare zuerst weg. In diesem Block stehen ganze Absätze Prosa, und darin stehen
// Feldnamen in Anführungszeichen — ein Test, der sie mitliest, hält jedes ERWÄHNTE Feld für
// geschickt und wäre damit blind für genau den Fehler, den er sucht.
const block = phpText.slice(von + "'items' => array_map".length, bis).replace(/\/\/[^\n]*/g, "");
const nutzlast = Array.from(new Set(
	Array.from(block.matchAll(/'([a-z_]+)'\s*=>/g), function (m) { return m[1]; })
));
nutzlast.sort();

assert.ok(nutzlast.length >= 8,
	"die Nutzlast muss wirklich gelesen worden sein, gefunden: " + nutzlast.join(", "));
assert.ok(nutzlast.indexOf("apply_state") !== -1, "und `apply_state` enthalten");
pruefungen += 2;

// -------------------------------------------------------------------------------------------------
// Die Leser: jedes `item.<feld>` in der Fensterdatei.
// -------------------------------------------------------------------------------------------------
let jsText = fs.readFileSync(JS, "utf8");
jsText = jsText.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
const gelesen = Array.from(new Set(
	Array.from(jsText.matchAll(/\bitem\.([A-Za-z_][A-Za-z0-9_]*)/g), function (m) { return m[1]; })
));
gelesen.sort();

assert.ok(gelesen.length >= 6,
	"die Leser müssen wirklich gefunden worden sein, gefunden: " + gelesen.join(", "));
pruefungen++;

// -------------------------------------------------------------------------------------------------
// 🔴 DIE ZUSICHERUNG.
// -------------------------------------------------------------------------------------------------
const fehlend = gelesen.filter(function (feld) { return nutzlast.indexOf(feld) === -1; });
assert.deepStrictEqual(fehlend, [],
	"🔴 diese Felder liest der Browser an einem Item, aber garetien-liste.php schickt sie nicht: "
	+ fehlend.join(", ") + "\n   Nutzlast: " + nutzlast.join(", ")
	+ "\n   gelesen:  " + gelesen.join(", "));
pruefungen++;

// ⚠️ Und die Gegenprobe zur Gegenprobe: `applied` steht auf BEIDEN Seiten. Ohne diese Zeile wäre
// der Test auch dann grün, wenn beide Seiten das Feld gemeinsam verlören — dann stimmten sie
// überein, und die Knopfleiste wäre wieder so kaputt wie am 01.09.2026.
assert.ok(nutzlast.indexOf("applied") !== -1, "🔴 `applied` muss in der Nutzlast stehen");
assert.ok(gelesen.indexOf("applied") !== -1, "🔴 und im Browser gelesen werden");
pruefungen += 2;

console.log("garetien-item-felder: " + pruefungen + " Prüfungen bestanden");

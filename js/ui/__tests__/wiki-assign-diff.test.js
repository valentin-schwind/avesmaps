// Die reine Diff-Rechnung der Sync-Vorschau (Aufgabe 2, Entwurf §6). Testcode aus dem Brief
// woertlich uebernommen -- er ist die Abnahme, kein Vorschlag.
const assert = require("assert");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");

const felder = [
	{ wiki: "name", karte: "name", label: "Name" },
	{ wiki: "art", karte: "settlement_type", label: "Art" },
	{ wiki: "einwohner", karte: "einwohner", label: "Einwohner" },
	{ wiki: "oberhaupt", karte: "oberhaupt", label: "Herrscher" },
];

// 💣 Was ohnehin gleich ist, steht NICHT in der Liste -- in einem Kasten voller Haekchen sucht man
// sonst die eine Zeile, die zaehlt.
const gleich = avesmapsWikiAssignDiff(felder,
	{ name: "Havena", settlement_type: "metropole", einwohner: "12.000", oberhaupt: "" },
	{ name: "Havena", art: "metropole", einwohner: "12.000", oberhaupt: "" }, []);
assert.deepStrictEqual(gleich, []);

const d = avesmapsWikiAssignDiff(felder,
	{ name: "Havena", settlement_type: "grossstadt", einwohner: "14.200", oberhaupt: "Growin" },
	{ name: "Havena (Stadt)", art: "metropole", einwohner: "12.000", oberhaupt: "" },
	["einwohner"]);
const nach = Object.fromEntries(d.map((z) => [z.karte, z]));

// 🔴 SEIT DEM 16.08.2026 (Owner-Entscheid): eine Zeile, die einen bereits GEFUELLTEN Kartenwert
// ersetzen wuerde, startet UNGEHAKT. Hier stand bis dahin `gehakt === true` -- die Zusicherung ist
// MITGEWANDERT, nicht geloescht, und nagelt die neue Regel genauso scharf fest wie die alte.
// 💣 Ueberschreiben ist eine Entscheidung, kein Vorschlag: „Havena" ist ein gepflegter Name, und ein
// unbedachter Klick auf „Uebernehmen" haette ihn durch „Havena (Stadt)" ersetzt.
assert.strictEqual(nach.name.gehakt, false, "ein gefuellter Kartenwert wird wieder vorangehakt");
assert.strictEqual(nach.name.grund, "auf der Karte steht bereits ein Wert", nach.name.grund);
assert.strictEqual(nach.settlement_type.gehakt, false);
assert.strictEqual(nach.settlement_type.grund, "auf der Karte steht bereits ein Wert");

// 🔴 Von Hand gesetzt: gelistet, MARKIERT, aber NICHT gehakt.
// 💣 UND SEIN GRUND STICHT DEN ALLGEMEINEN. Eine handgesetzte Angabe ist per Definition auch
// GEFUELLT -- stuende die neue Regel vor dieser, laese der Editor „auf der Karte steht bereits ein
// Wert" und wuesste nicht, dass seine eigene Korrektur der Grund ist. Die Reihenfolge IST die Regel.
assert.strictEqual(nach.einwohner.gehakt, false);
assert.ok(String(nach.einwohner.grund).includes("Hand"), nach.einwohner.grund);

// 🔴 Das Wiki sagt nichts, die Karte schon: das ist der Fall "Geloescht" der grossen
// Uebernahme-Vorschau -- gelistet, aber NIE vorangehakt.
assert.strictEqual(nach.oberhaupt.gehakt, false);
assert.strictEqual(nach.oberhaupt.neu, "");
assert.ok(String(nach.oberhaupt.grund).includes("Wiki sagt nichts"), nach.oberhaupt.grund);

// In dieser Fixture unterscheiden sich ALLE vier Felder -- also genau vier Zeilen, keine fuenfte.
assert.strictEqual(d.length, 4);
assert.deepStrictEqual(d.map((z) => z.karte), ["name", "settlement_type", "einwohner", "oberhaupt"]);

// ── DIE EINE ZEILE, DIE WEITERHIN VORANGEHAKT IST: das FUELLEN einer LUECKE ────────────────────
// 🔴 „Ein leeres Feld zu fuellen bleibt vorangehakt" (Owner, woertlich). Ohne diese Probe waere die
// neue Regel von „gar nichts ist mehr vorangehakt" nicht zu unterscheiden -- und genau das waere ein
// anderer Entscheid.
const luecke = avesmapsWikiAssignDiff(felder,
	{ name: "Havena", settlement_type: "metropole", einwohner: "", oberhaupt: "" },
	{ name: "Havena", art: "metropole", einwohner: "12.000", oberhaupt: "Growin" }, []);
assert.strictEqual(luecke.length, 2, "es sollten genau die zwei leeren Felder uebrig sein");
assert.ok(luecke.every((z) => z.gehakt === true),
	"das Fuellen einer Luecke ist nicht mehr vorangehakt: " + JSON.stringify(luecke.map((z) => [z.karte, z.gehakt])));
assert.ok(luecke.every((z) => z.grund === ""), "eine vorangehakte Zeile traegt einen Grund");

// ⚠️ Und die Grenze dazwischen ist wirklich „leer", nicht „kurz": ein Kartenwert aus lauter
// Leerzeichen zaehlt als LEER (der Vergleich normalisiert beide Seiten), sonst haenge die Regel an
// einer Formatierung.
const nurLeerzeichen = avesmapsWikiAssignDiff([{ wiki: "einwohner", karte: "einwohner" }],
	{ einwohner: "   " }, { einwohner: "12.000" }, []);
assert.strictEqual(nurLeerzeichen.length, 1);
// 🪤 Der Fehlertext hier sagte einmal „ein Feld aus Leerzeichen gilt als gefuellt" -- formal richtig
// als Beschreibung des FEHLERZUSTANDS, beim Ueberfliegen aber das Gegenteil der Regel darueber.
// Ein Fehlertext, den man zweimal lesen muss, hilft im roten Lauf nicht.
assert.strictEqual(nurLeerzeichen[0].gehakt, true,
	"erwartet: vorangehakt, weil „   “ als LEER gilt (der Vergleich beschneidet beide Seiten). "
	+ "Ist die Zeile ungehakt, haengt die Regel an einer Formatierung statt am Inhalt.");

// 🔴 Und der handgesetzte Fall auf einem LEEREN Kartenwert bleibt ebenfalls ungehakt -- `handgesetzt`
// sticht auch die Luecken-Regel, nicht nur die allgemeine.
const handAufLeer = avesmapsWikiAssignDiff([{ wiki: "einwohner", karte: "einwohner" }],
	{ einwohner: "" }, { einwohner: "12.000" }, ["einwohner"]);
assert.strictEqual(handAufLeer[0].gehakt, false);
assert.ok(String(handAufLeer[0].grund).includes("Hand"), handAufLeer[0].grund);

console.log("wiki-assign-diff: alle Zusicherungen erfuellt");

// 🔴 Eigene Zusicherung (Schnittstelle #2 aus der Aufgabe, nicht im Brief-Test): eine Feldzeile mit
// `karte: ""` ist eine ANZEIGE-Zeile ohne Ziel -- sie kann per Definition nichts uebernehmen und
// darf deshalb NIE in der Diff-Liste stehen, auch wenn ihr Wiki-Wert vom (nicht vorhandenen)
// Kartenwert abweicht. So tragen die Kraftlinien ihre vier Wiki-Felder (js/ui/wiki-assign-registry.js).
const felderMitAnzeige = felder.concat([{ wiki: "staerke", karte: "", label: "Stärke" }]);
const mitAnzeige = avesmapsWikiAssignDiff(felderMitAnzeige,
	{ name: "Havena", settlement_type: "grossstadt", einwohner: "14.200", oberhaupt: "Growin" },
	{ name: "Havena (Stadt)", art: "metropole", einwohner: "12.000", oberhaupt: "", staerke: "kontinental" },
	["einwohner"]);
assert.strictEqual(mitAnzeige.length, 4, "eine Anzeige-Zeile (karte: \"\") ist in der Diff-Liste gelandet");
assert.ok(mitAnzeige.every((z) => z.karte !== ""), "eine Zeile ohne Kartenziel steht in der Diff-Liste");
console.log("wiki-assign-diff: Anzeige-Zeile (karte: \"\") bleibt aussen vor");

// Das Fenster „Tempowerte" und sein Endpunkt sprechen dieselben Namen.
//
// 💣 WARUM DAS EINEN TEST BRAUCHT. Zwischen `js/pages/wege-editor.js` und
// `api/edit/map/travel-values.php` liegt eine JSON-Nutzlast, und die hat keine Signatur. Schickt das
// Fenster `ground` und liest der Server `ground_penalties`, passiert genau NICHTS: der Server
// ueberspringt, was er nicht kennt, antwortet `ok: true`, und das Fenster meldet „Gespeichert.".
// Ein falscher Abschnittsname beim Ruecksetzer gibt immerhin ein 400 -- aber auch das erst zur
// Laufzeit, im Browser des Owners.
//
// ⭐ Der Test liest beide Seiten als TEXT. Das Fenster ist DOM-Code in einem IIFE und laesst sich
// nicht einzeln laden (deshalb hat wege-editor.js keinen Verhaltenstest); die Namen stehen aber
// woertlich da, und genau sie sind der Vertrag.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/tempowerte-dialog.test.js
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..", "..", "..");
const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), "utf8");

const dialog = read("js/pages/wege-editor.js");
const endpoint = read("api/edit/map/travel-values.php");
const library = read("api/_internal/routing/travel-values.php");

// ---- 1. Die Abschnitte des Ruecksetzers -------------------------------------------------------

// Die Liste, die der Endpunkt annimmt -- aus seinem eigenen in_array().
const allowed = (() => {
	const match = endpoint.match(/in_array\(\$section, \[([^\]]+)\], true\)/);
	assert.ok(match, "die Abschnittsliste des Endpunkts wurde gefunden");
	return match[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
})();

// Entwurf §8.1 nennt sie namentlich. Faellt eine weg, faellt hier auf, dass der Knopf ins Leere geht.
assert.deepStrictEqual(
	allowed.slice().sort(),
	["all", "day_miles", "ground", "landscapes", "misc", "path_factors"],
	"der Endpunkt kennt genau die sechs Abschnitte aus Entwurf §8.1 — ist: " + allowed.join(", ")
);

const used = [...dialog.matchAll(/data-section="([a-z_]+)"/g)].map((m) => m[1]);
assert.ok(used.length >= 4, "das Fenster hat Ruecksetzer-Knoepfe: " + used.length);
used.forEach((section) => {
	assert.ok(
		allowed.includes(section),
		`der Knopf „${section}" ruft einen Abschnitt, den der Endpunkt ablehnt (er kennt: ${allowed.join(", ")})`
	);
});

// ---- 2. Die Schluessel der Nutzlast -----------------------------------------------------------

// 🔴 DIE STILLE HAELFTE. Ein unbekannter Schluessel wird vom Server ueberspringen -- ohne Fehler,
// ohne Meldung, und das Fenster sagt trotzdem „Gespeichert.".
[
	["grid", /\$payload\['grid'\]/],
	["landscapes", /\$payload\['landscapes'\]/],
	["ground_penalties", /\$payload\['ground_penalties'\]/],
].forEach(([key, serverPattern]) => {
	assert.ok(
		dialog.includes(key + ":") || dialog.includes('"' + key + '"'),
		`das Fenster schickt \`${key}\``
	);
	assert.ok(
		serverPattern.test(endpoint) || serverPattern.test(library),
		`und der Server liest \`${key}\``
	);
});

// Die beiden Einzelzahlen reisen als eigene Schluessel im Rumpf, nicht in einem Objekt.
["river_ratio", "calibration_target_miles"].forEach((key) => {
	assert.ok(dialog.includes(key), `das Fenster kennt \`${key}\``);
	assert.ok(
		library.includes("'" + key + "'"),
		`und der Server nimmt \`${key}\` entgegen`
	);
});

// ---- 3. Die Landschaftszeile traegt BEIDE Teile ihres Schluessels -------------------------------

// 💣 (Ebene, Art) ist das Paar, nicht die Art allein: `wald` gibt es in `vegetation`, und nichts
// verbietet einer zweiten Ebene denselben Artnamen. Der Server verlangt beide Felder; schickte das
// Fenster nur eins, faende sein UPDATE keine Zeile — lautlos.
assert.ok(dialog.includes('data-kind="'), "die Landschaftszeile traegt ihre Ebene");
assert.ok(/wp-tempo__ls[\s\S]{0,400}data-kind/.test(dialog), "und zwar an der Landschafts-Eingabe selbst");
assert.ok(library.includes("\$entry['kind']"), "der Server liest die Ebene");
assert.ok(library.includes("\$entry['type_key']"), "und die Art");

// ---- 4. Alle sechs Abschnitte des Entwurfs stehen im Fenster ------------------------------------

// §4: Tagesleistung + Wegtypen (das Raster), Landschaften, Boden, Fluss und Eichung, Befund, Gesperrt.
[
	"Raster: Reisemittel × Wegtyp",
	"Landschaften querfeldein",
	"Boden nach Jahreszeit",
	"Fluss und Eichung",
	"Was von der Quelle abweicht",
	"Nicht aus der Quelle",
].forEach((heading) => {
	assert.ok(dialog.includes(heading), `Abschnitt „${heading}" fehlt im Fenster`);
});

// ---- 5. Genau EIN gefuellter Knopf --------------------------------------------------------------

// AGENTS.md §12: die Haupthandlung ist gefuellt, jede Abschnittshandlung weich/outline. Ein zweiter
// `is-primary` im selben Fenster multipliziert sich mit der Zahl der Abschnitte.
const markup = read("html/wege-editor.html");
const tempoBox = markup.slice(markup.indexOf('id="wpTempoOverlay"'), markup.indexOf('id="wpTempoOverlay"') + 2000);
assert.strictEqual(
	(tempoBox.match(/is-primary/g) || []).length,
	1,
	"genau ein gefuellter Knopf im Tempowerte-Fenster"
);
assert.ok(!/wp-tempo__reset[^>]*is-primary/.test(dialog), "kein Ruecksetzer ist gefuellt");

console.log("tempowerte-dialog.test.js: Fenster und Endpunkt sprechen dieselben Namen");

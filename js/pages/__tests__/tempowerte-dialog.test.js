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

// ---- 3b. Die Bodenprobe: der Name muss auf beiden Seiten derselbe sein -------------------------

// 🔴 Sie ist die Antwort auf den stillen Not-Aus (Entwurf §7). Heisst sie im Fenster anders als im
// Endpunkt, ist das Feld schlicht `undefined` -- und die Zeile behauptet dann „nicht angelegt",
// waehrend in Wahrheit alles in Ordnung ist. Ein falscher Alarm ist hier so schlimm wie keiner.
assert.ok(dialog.includes("terrain_probe"), "das Fenster liest `terrain_probe`");
assert.ok(endpoint.includes("'terrain_probe'"), "und der Endpunkt schickt es");
assert.ok(
	library.includes("function avesmapsTravelValuesTerrainProbe("),
	"die Probe steht im Server, nicht als zweite Rechnung im Browser"
);
["checked", "known", "areas", "sample_label", "max_factor"].forEach((field) => {
	assert.ok(dialog.includes("probe." + field), `das Fenster liest \`${field}\``);
	assert.ok(library.includes("'" + field + "'"), `und der Server liefert \`${field}\``);
});

// ---- 3c. Der Ruecksetzer je Zeile ---------------------------------------------------------------

// ⚠️ Er nimmt die eigene Eingabe zurueck, ohne Serveraufruf -- deshalb muss jedes Eingabefeld seinen
// geladenen Wert bei sich tragen. Fehlt `data-loaded` an einem der vier Zeilenbauer, ist der Knopf
// dort wirkungslos und setzt still auf "" statt auf den Wert.
assert.strictEqual(
	(dialog.match(/data-loaded="/g) || []).length,
	4,
	"alle vier Zeilenbauer (Raster, Landschaft, Boden, Einzelwert) tragen `data-loaded`"
);
assert.ok(dialog.includes("wp-tempo__undo"), "und es gibt den Zeilen-Ruecksetzer");
const css = read("css/pages/wege-editor.css");
assert.ok(
	/tr\.is-dirty .wp-tempo__undo \{ visibility: visible/.test(css),
	"er wird erst sichtbar, wenn der Wert abweicht — 75 dauerhafte Knoepfe waeren AGENTS.md §12"
);

// ---- 3d. Anzeigezellen tragen ein KOMMA, nicht einen Punkt -------------------------------------

// 💣 DAS FELD SCHREIBT SCHON KOMMA. `input type="number"` stellt seinen Wert in der Sprache des
// Browsers dar, also „3,45"; ein `toFixed()` daneben liefert „3.38", und beide standen im Fenster
// in DERSELBEN ZEILE nebeneinander. In einer deutschen Oberflaeche liest sich der Punkt als
// Tausendertrenner -- „1.124" ist dann nicht 1,124, sondern tausendeinhundertvierundzwanzig.
// ⚠️ Geprueft wird nur die ANZEIGE. Im `value`-Attribut MUSS der Punkt stehen: `type="number"` nimmt
// nichts anderes an, und ein Komma dort hiesse, das Feld ist beim Aufgehen leer.
// 🪤 Die Klasse steht im Quelltext in ZWEI Schreibweisen -- `'<td class="…">'` und
// `"<td class=\"…\">"`. Ein Suchmuster auf die eine findet die andere nicht, und der Waechter waere
// gruen geblieben, waehrend die Haelfte der Zellen ungeprueft ist. (Genau so ist er beim Bauen zuerst
// durchgefallen: die Falsifikationsprobe blieb gruen.) Deshalb die Escapes vorher aufloesen.
const dialogFlach = dialog.replace(/\\"/g, '"');
["wp-tempo__ga", "wp-tempo__eff"].forEach((cellClass) => {
	let from = 0;
	let gefunden = 0;
	for (;;) {
		const at = dialogFlach.indexOf(cellClass + '">', from);
		if (at === -1) { break; }
		gefunden++;
		const ausdruck = dialogFlach.slice(at, at + 160);
		assert.ok(
			!/\.toFixed\(/.test(ausdruck),
			`eine \`${cellClass}\`-Zelle formatiert mit toFixed statt num() — dort steht dann ein Punkt `
			+ `neben dem Komma des Eingabefelds:\n  ${ausdruck.slice(0, 120)}`
		);
		from = at + 1;
	}
	// ⭐ Und der Waechter muss ueberhaupt etwas gefunden haben -- eine leere Schleife ist gruen und
	// prueft nichts. Genau daran ist er beim ersten Versuch gescheitert.
	assert.ok(gefunden >= 3, `\`${cellClass}\` wurde wirklich gefunden (${gefunden} Zellen)`);
});

// ⭐ Und zwar ueber die Funktion, die es im Haus schon gibt. Eine zweite Zahlenformatierung in
// derselben Datei ist genau die Doppelung, die spaeter auseinanderlaeuft -- sie war beim Bauen
// schon einmal da und ist wieder raus.
assert.ok(
	/function num\(value, digits\)/.test(dialog),
	"die Formatierung heisst num() und steht einmal in der Datei"
);
assert.strictEqual(
	(dialog.match(/function num\(/g) || []).length,
	1,
	"und zwar genau einmal"
);

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

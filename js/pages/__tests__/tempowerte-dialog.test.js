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
// 🔴 `offroad` kam am 15.08.2026 dazu (der Querfeldein-Laengenaufschlag, Entwurf
// 2026-08-15-querfeldein-laengenaufschlag-design.md §6).
assert.deepStrictEqual(
	allowed.slice().sort(),
	["all", "day_miles", "ground", "landscapes", "misc", "offroad", "path_factors"],
	"der Endpunkt kennt genau die sieben Abschnitte — ist: " + allowed.join(", ")
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
	5,
	"alle fuenf Zeilenbauer (Raster, Landschaft, Boden, Einzelwert, Querfeldein-Aufschlag) tragen `data-loaded`"
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

// ---- 3e. Jede `wp-tempo__`-Klasse aus dem Fenster hat auch eine Regel ---------------------------

// 💣 EINE KLASSE OHNE REGEL FAELLT NICHT AUF. Sie rendert -- nur ungestylt, und in einer Tabelle mit
// fuenfundsiebzig Zeilen sieht man das nicht. Beim Bauen hiess die Marke im JS `wp-tempo__war` und im
// CSS `wp-tempo__was`; ohne diese Pruefung waere sie farblos erschienen und niemandem aufgefallen.
// (Dieselbe Zusicherung wie in tools/__tests__/scope-editor-css.test.js, nur fuer dieses Fenster.)
const cssQuelle = read("css/pages/wege-editor.css");
const klassen = new Set(
	[...dialogFlach.matchAll(/class="([^"]*wp-tempo__[^"]*)"/g)]
		.flatMap((m) => m[1].split(/\s+/))
		.filter((c) => c.startsWith("wp-tempo__"))
);
assert.ok(klassen.size >= 8, "die Klassen wurden wirklich eingesammelt: " + klassen.size);
klassen.forEach((klasse) => {
	assert.ok(
		cssQuelle.includes("." + klasse),
		`\`${klasse}\` steht im Fenster, aber es gibt keine CSS-Regel dafuer`
	);
});

// ---- 3f. BEIDE Antworten des Endpunkts tragen dieselben Schluessel -----------------------------

// 💣 GEMESSEN AM EIGENEN FEHLER (14.08.2026). Der Endpunkt antwortet an ZWEI Stellen: auf `get` und
// nach `save`/`reset`. Die zweite hatte `terrain_probe` nicht — und weil das Fenster nach jedem
// Speichern aus derselben Antwort neu zeichnet, waere die Bodenprobe danach auf den Zweig
// „Spalte nicht angelegt" gefallen: ein ROTER Alarm, ausgeloest durch ein erfolgreiches Speichern.
// Ein fehlender Schluessel ist im Client kein Fehler, sondern `undefined` -- und `undefined` sieht
// hier aus wie eine echte Aussage.
{
	const bloecke = [...endpoint.matchAll(/avesmapsJsonResponse\(200, \[([\s\S]*?)\n\s*\]\);/g)]
		.map((m) => m[1]);
	assert.strictEqual(bloecke.length, 2, "der Endpunkt antwortet an genau zwei Stellen mit 200");
	const schluessel = bloecke.map((b) =>
		[...b.matchAll(/'([a-z_]+)' =>/g)].map((m) => m[1]).sort());
	assert.deepStrictEqual(
		schluessel[0], schluessel[1],
		"beide Antworten tragen dieselben Schluessel — sonst zeichnet das Fenster nach dem Speichern "
		+ "aus einer aermeren Antwort neu:\n  get:  " + schluessel[0].join(", ")
		+ "\n  save: " + schluessel[1].join(", ")
	);
	["values", "landscapes", "terrain_probe", "calibration", "source_table", "deviations"].forEach((k) => {
		assert.ok(schluessel[0].includes(k), `beide Antworten tragen \`${k}\``);
	});
}

// ---- 4. Alle sieben Abschnitte stehen im Fenster ------------------------------------------------

// §4: Tagesleistung + Wegtypen (das Raster), Landschaften, Boden, Fluss und Eichung, Befund, Gesperrt.
// 🔴 „Querfeldein-Aufschlag" kam am 15.08.2026 dazu (Entwurf
// 2026-08-15-querfeldein-laengenaufschlag-design.md §6).
[
	"Raster: Reisemittel × Wegtyp",
	"Landschaften querfeldein",
	"Boden nach Jahreszeit",
	"Fluss und Eichung",
	"Querfeldein-Aufschlag",
	"Was von der Quelle abweicht",
	"Nicht aus der Quelle",
].forEach((heading) => {
	assert.ok(dialog.includes(heading), `Abschnitt „${heading}" fehlt im Fenster`);
});

// Beide Zahlen sind einstellbar, und beide lassen sich gemeinsam zuruecksetzen.
// 💣 DER DECKEL WIRD MIT-EINGESTELLT, NICHT FESTGENAGELT. Eine Steigung ohne erreichbaren Deckel
// ist eine versteckte Kopplung: wer sie verdoppelt, verschiebt die Grenze, ab der sie nicht mehr
// wirkt, und sieht es nirgends.
// ⚠️ Geprueft wird der AUFRUF, nicht das fertige Attribut: `data-key` entsteht erst zur Laufzeit
// aus dem Argument (data-key="' + escapeHtml(key) + '"), steht also nirgends woertlich im Quelltext.
assert.ok(dialog.includes('tempoRampRow("per_mile"'), "die Steigung ist einstellbar");
assert.ok(dialog.includes('tempoRampRow("max"'), "der Hoechstaufschlag ebenso");
assert.ok(dialog.includes('data-section="offroad"'), "und beide lassen sich zuruecksetzen");
// 🔴 KEIN GA-WERT. Die Quelle kennt ueberhaupt keine laengenabhaengige Regel; stuende dort eine
// Zahl, waere sie erfunden.
assert.ok(!/Querfeldein-Aufschlag[\s\S]*?wp-tempo__ga">0/.test(dialog),
	"die GA-Spalte des Aufschlags traegt keine erfundene Zahl");

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

// ⚠️ Und die Leiste traegt BEIDE Haelften der Entscheidung. Verlaesst nur „Speichern" den Dialog,
// wirkt die andere Seite tot -- genau diese Meldung kam am 17.07.2026 aus zwei anderen Editoren.
assert.ok(tempoBox.includes('id="wpTempoCancel"'), "die Leiste hat ein Abbrechen");
assert.ok(
	/id="wpTempoCancel"(?![^>]*is-primary)/.test(tempoBox),
	"und es ist NICHT der gefuellte Knopf -- die Haupthandlung bleibt Speichern"
);
assert.ok(
	/function cancelTempo\(\)[\s\S]{0,900}hidden = true/.test(dialog),
	"Abbrechen verwirft UND geht zu"
);

console.log("tempowerte-dialog.test.js: Fenster und Endpunkt sprechen dieselben Namen");

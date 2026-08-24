const assert = require("assert");
const fs = require("fs");
const path = require("path");

// Das Fenster „Darstellung" im Landschaften-Editor (Entwurf §5).
//
// 🔴 Die VORGABEN stehen nicht im Fenster, sondern in js/map-features/ecosystem-display.js -- der
// Datei, gegen die auch die Karte zeichnet. Eine zweite Tafel im Fenster liefe beim ersten
// geaenderten Wert auseinander, und der Editor saehe etwas anderes als der Besucher.
//
// Aus der Wurzel des Repos:  node js/pages/__tests__/darstellung-fenster.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const editor = fs.readFileSync(path.join(wurzel, "html/landschaften-editor.html"), "utf8");
const editorCss = fs.readFileSync(path.join(wurzel, "css/pages/landschaften-editor.css"), "utf8");
const geteiltCss = fs.readFileSync(path.join(wurzel, "css/components/editor-page.css"), "utf8");
const endpunkt = fs.readFileSync(path.join(wurzel, "api/edit/map/ecosystem-display.php"), "utf8");
const fundament = fs.readFileSync(path.join(wurzel, "api/_internal/app/ecosystem-display.php"), "utf8");

// ---- A. Die siebte Kachel ---------------------------------------------------------------------
assert.ok(/id="ecoDisplay"/.test(editor), "die Kachel „Darstellung“ steht im Menueband");
const kachel = editor.match(/id="ecoDisplay"[^>]*title="([^"]*)"/);
assert.ok(kachel, "die Kachel traegt einen title");
// 🪤 Zwei Kacheln heissen jetzt „Darstellung" und zeigen Verschiedenes (Orte gegen Landschaften).
// Das ist gewollt -- aber der title MUSS es aussprechen, sonst ist es eine Falle fuer den Editor.
assert.ok(/Landschaft/i.test(kachel[1]), "und der title sagt, dass es um LANDSCHAFTEN geht");
assert.ok(/Orte/.test(kachel[1]), "und grenzt ausdruecklich gegen „Orte“ ab");

// Sieben Kacheln: Syncen, Zugehoerigkeit, Hoehenraster, Wegprofile, Gelaende, Kurven, Darstellung.
const kacheln = (editor.match(/class="avm-tile[^"]*"/g) || []).length;
assert.strictEqual(kacheln, 7, `das Menueband hat ${kacheln} Kacheln, erwartet sind sieben`);

// ---- B. Vier Reiter, aus EINER Liste ------------------------------------------------------------
assert.ok(/ECO_DISPLAY_EBENEN/.test(editor), "die Ebenen stehen in einer Liste");
["derographisch", "vegetation", "topographie", "klima"].forEach((k) => {
	assert.ok(new RegExp('"' + k + '"').test(editor), `die Ebene ${k} ist dabei`);
});

// ---- C. EINE Tabelle fuer Flaeche UND Name (Owner 23.08.2026) ---------------------------------
assert.ok(/id="ecoDisplayRows"/.test(editor), "die gemeinsame Tabelle hat einen Rumpf");
assert.ok(!/id="ecoDisplayFcRows"/.test(editor), "und es gibt KEINE zweite Liste fuer die Namensfarben");
// Die zwei Bereiche trennt eine LINIE, kein Kasten (§12).
assert.ok(/\.dt \.dt-sep/.test(editorCss), "der Trenner ist eine Linie");

// ---- D. 🔴 KEINE zweite Vokabelliste im Fenster ------------------------------------------------
// Die Flaechenarten kommen aus `regionTypes` (dem Server-Seed), die Namensarten aus dem BESTAND.
// Eine abgeschriebene Liste im Fenster waere genau die Divergenz, die dieser Umbau abbaut.
assert.ok(/typesOfKind\(kind\)/.test(editor), "die Flaechenarten kommen aus regionTypes");
assert.ok(/label_subtypes/.test(editor), "die Namensarten kommen aus der Antwort");
assert.ok(/avesmapsEcosystemDisplayLabelSubtypes/.test(endpunkt), "und der Endpunkt liefert sie");
assert.ok(/SELECT DISTINCT feature_subtype/.test(fundament), "aus den Daten, nicht aus einer Liste");

// ---- E. 🔴 Die VORGABEN kommen aus dem geteilten Modul -----------------------------------------
assert.ok(/avesmapsEcosystemDisplayDeckkraft/.test(editor),
	"die Vorgabe-Deckkraft kommt aus dem Modul, gegen das auch die Karte zeichnet");
// 💣 Und sie steht NICHT noch einmal im Fenster.
assert.ok(!/derographisch:\s*0\.16/.test(editor), "keine abgeschriebene Deckkraft-Tafel im Fenster");
assert.ok(/ecosystem-display\.js/.test(editor), "das Modul ist eingehaengt");

// ---- F. 🔴 KEINE Farbe im Fenster --------------------------------------------------------------
// Die ~20 Namenstoene stehen in map-labels.css, die Flaechentoene in tokens.css. Das Fenster liest
// sie -- mit derselben Sonde wie der Canvas-Renderer -- und schreibt keine ab.
const skripte = (editor.match(/<script>([\s\S]*?)<\/script>/g) || []).join("\n");
const ohneKommentare = skripte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/[^\n]*$/gm, "");
const eigeneToene = ohneKommentare.match(/#[0-9a-fA-F]{6}/g) || [];
// „#888888" ist der Notton der Hex-Normalisierung, kein Farbwert der Karte.
assert.deepStrictEqual([...new Set(eigeneToene)], ["#888888"],
	"im Fenster steht kein Kartenfarbwert -- gefunden: " + [...new Set(eigeneToene)].join(", "));
assert.ok(/map-label--/.test(editor), "die Namenstoene kommen aus der CSS-Sonde");
assert.ok(/map-labels\.css/.test(editor),
	"und dafuer MUSS map-labels.css geladen sein -- sonst kaeme ueberall derselbe Grundton");

// ---- G. Der Riegel steht auch im Fenster -------------------------------------------------------
assert.ok(/can_save/.test(editor), "das Fenster liest can_save");
assert.ok(/ecoDisplayDarfSpeichern/.test(editor), "und sperrt danach die Bedienelemente");
// ⚠️ Aber es VERMUTET die Rolle nicht selbst -- der Riegel steht serverseitig.
assert.ok(!/isAdmin|istAdmin/.test(editor), "das Fenster raet die Rolle nicht");

// ---- H. Gespeichert wird NUR die Abweichung ----------------------------------------------------
assert.ok(/function ecoDisplayZumSenden/.test(editor), "es gibt einen Bauer fuer den Sendekoerper");
const vonS = editor.indexOf("function ecoDisplayZumSenden");
const bisS = editor.indexOf("\n}", vonS);
assert.ok(/Object\.keys\(teil\)\.length > 0/.test(editor.slice(vonS, bisS)),
	"leere Abschnitte fallen raus -- nie eine Kopie der Vorgabe");

// ---- I. Die geteilte Modal-Huelle --------------------------------------------------------------
assert.ok(/\.avm-modal \{/.test(geteiltCss), "die Huelle steht im GETEILTEN Blatt");
assert.ok(/class="avm-modal"/.test(editor), "und das Fenster benutzt sie");
// 🪤 Der aeltere Zwilling `.modal*` steht inline im Orte-Editor. Verschiedene Namen, damit sie
// sich nicht kollidieren -- und ein Vermerk, damit die Doppelung nicht still weiterlebt.
assert.ok(/AELTEREN ZWILLING/.test(geteiltCss),
	"der Vermerk zur Inline-Fassung des Orte-Editors steht dabei");

// ---- J. 🪤 DAS MARKUP STEHT VOR DEM SKRIPT ------------------------------------------------------
// Der Editor ist EINE grosse IIFE ohne DOMContentLoaded: sie verdrahtet beim Laden. Das Fenster
// stand zuerst kurz vor `</body>`, also NACH dem Skript -- `addEventListener` auf `null`, und der
// ganze Editor brach mit einem TypeError ab. Kein Quelltext-Test sah das; erst der Klick im Browser.
const posMarkup = editor.indexOf('id="ecoDisplayDialog"');
// Gesucht wird der erste Bezeichner AUS dem Skript -- ohne Zeilenumbruch im Suchtext.
const posSkript = editor.indexOf("ECO_DISPLAY_EBENEN");
assert.ok(posMarkup >= 0 && posSkript >= 0, "beide Stellen stehen in der Datei");
assert.ok(posMarkup < posSkript,
	"das Fenster-Markup steht VOR dem Skript, das es verdrahtet");

console.log("darstellung-fenster: alle Zusicherungen gruen");

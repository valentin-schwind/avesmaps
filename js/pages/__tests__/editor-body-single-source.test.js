// Der gemeinsame Editor-KOERPER -- Menueband, Kacheln, Spalten, Reiter, Rollkasten -- steht
// genau EINMAL, als css/components/editor-body.css.
//
// 🔴 DIESER TEST EXISTIERT WEGEN DES FUENFTEN UMZUGS. Die Regeln standen bis 2026-08-27 in
// css/components/editor-page.css, und die laedt NUR die sechs Editor-iframes in html/, nie
// index.html. Das Fenster „Garetien Importer" lebt aber in index.html, weil es die laufende
// Karte freigeben muss -- es kann also kein iframe sein. Ohne diesen Umzug haette das Fenster die
// Formen abschreiben muessen, und genau daraus ist die Divergenz gewachsen, die die
// Vereinheitlichung vom 14.08.2026 beseitigt hat (sieben Zeilenformen, vier davon Abschriften).
// Dieselbe Reise wie --avm-* -> tokens.css, .avm-row -> editor-row.css, der Statuskreis ->
// map-status-circle.css und der Wiki-Override -> wiki-override.css.
//
// Run: node js/pages/__tests__/editor-body-single-source.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");

// 💣 Zeilenendenneutral: hier ist LF, im Deploy-Tor auch -- aber die Regel gilt projektweit
// (AGENTS.md §9), also nie hart auf \r\n oder \n verlassen.
const ohneZeilenenden = (s) => s.replace(/\r\n/g, "\n");
// 💣 Kommentare VOR dem Vergleich strippen -- sonst schlaegt der Test an der eigenen Warnung an,
// die vor dem Muster warnt, und der naechste Leser loescht ausgerechnet den Kommentar.
const ohneKommentare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

let checks = 0;

const editorPage = ohneZeilenenden(lies("css", "components", "editor-page.css"));
const editorBody = ohneZeilenenden(lies("css", "components", "editor-body.css"));
const styles = ohneZeilenenden(lies("css", "styles.css"));

const editorPageOhneKommentare = ohneKommentare(editorPage);

// ---- 1. Die Formen stehen GENAU EINMAL -- in editor-body.css, nicht mehr in editor-page.css ----
const gewanderteSelektoren = [
	".avm-ribbon-bar", ".avm-ribbon", ".avm-tile", ".avm-cols", ".avm-col",
	".avm-col__title", ".avm-col__bar", ".avm-scroll", ".avm-scroll--pad",
	".avm-tabs", ".avm-tab", ".avm-empty", ".avm-error", ".avm-pill",
];
for (const sel of gewanderteSelektoren) {
	const kopf = new RegExp("^" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{", "m");
	assert.ok(!kopf.test(editorPageOhneKommentare),
		`${sel} steht wieder in editor-page.css -- daraus wird die naechste Divergenz. Die Regel `
		+ "gehoert jetzt nach css/components/editor-body.css.");
	checks++;
	assert.ok(kopf.test(ohneKommentare(editorBody)),
		`${sel} fehlt in css/components/editor-body.css -- das Fenster "Garetien Importer" in `
		+ "index.html haette dann keine Form dafuer.");
	checks++;
}

// ---- 2. BEIDE Wirte binden die Datei: styles.css fuer index.html, editor-page.css fuer die -----
//         sechs Editor-Seiten.
assert.ok(styles.includes('@import url("components/editor-body.css")'),
	"css/styles.css bindet editor-body.css nicht -- das Fenster in index.html haette keine Form.");
checks++;
assert.ok(editorPage.includes('@import url("editor-body.css")'),
	"editor-page.css bindet editor-body.css nicht -- die sechs Editorseiten verloeren ihr "
	+ "Menueband, ihre Spalten, ihre Reiter und ihren Rollkasten.");
checks++;

// ⚠️ Ein @import gilt nur VOR jeder Regel (nur Kommentare duerfen davor stehen). Steht er weiter
// unten, ignorieren ihn die Browser stillschweigend.
const vorImportPage = editorPage.slice(0, editorPage.indexOf('@import url("editor-body.css")'));
assert.ok(!/[^\s]\s*\{/.test(ohneKommentare(vorImportPage)),
	"In editor-page.css steht eine Regel VOR dem @import von editor-body.css. Ein @import nach "
	+ "der ersten Regel wird ignoriert -- die sechs Editorseiten haetten dann kein Menueband, ohne "
	+ "jede Fehlermeldung.");
checks++;

const vorImportStyles = styles.slice(0, styles.indexOf('@import url("components/editor-body.css")'));
assert.ok(!/[^\s]\s*\{/.test(ohneKommentare(vorImportStyles)),
	"In css/styles.css steht eine Regel VOR dem @import von editor-body.css.");
checks++;

// ---- 3. KEIN lokaler Alias in der geteilten Datei -----------------------------------------------
// 💣 --panel/--line/--mut & Co. existieren NUR im :root von editor-page.css. In index.html gibt
// es sie nicht -- eine ungueltige var() macht die GANZE Deklaration ungueltig, lautlos: der
// Rollkasten haette dort keinen weissen Grund und keinen Rahmen, der Reiter keine gedaempfte
// Schrift.
const aliase = ["--bg", "--panel", "--soft", "--line", "--line2", "--fg", "--mut", "--accent",
	"--warn", "--bad", "--ok"];
const editorBodyOhneKommentare = ohneKommentare(editorBody);
aliase.forEach((alias) => {
	assert.ok(!new RegExp("var\\(\\s*" + alias + "\\s*[,)]").test(editorBodyOhneKommentare),
		`editor-body.css benutzt den lokalen Alias ${alias}. Der steht nur im :root von `
		+ "editor-page.css und existiert in index.html NICHT -- eine ungueltige var() macht die "
		+ "ganze Deklaration ungueltig, lautlos. Echtes Token benutzen.");
	checks++;
});

// ---- 4. .type-filter bleibt, wo es ist -----------------------------------------------------------
// ⭐ .type-filter ist NICHT Teil dieses Umzugs -- css/features/review-panel.css traegt bereits eine
// zweite Fassung, die index.html erreicht. Wer .type-filter aus editor-page.css entfernt, entfernt
// die einzige Fassung, die die sechs Editorseiten noch sehen.
assert.ok(/^\.type-filter\s*\{/m.test(editorPageOhneKommentare),
	".type-filter fehlt in editor-page.css -- dieser Umzug sollte .type-filter NICHT anfassen "
	+ "(css/features/review-panel.css traegt bereits eine zweite Fassung fuer index.html).");
checks++;

// ---- 5. .avm-cols bleibt dreispurig, der Modifier ist ZUSAETZLICH, keine Ersetzung -------------
assert.ok(/\.avm-cols\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/.test(editorBodyOhneKommentare),
	".avm-cols ist nicht mehr dreispurig -- sechs Editoren stehen darauf.");
checks++;
assert.ok(/\.avm-cols--2\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/.test(editorBodyOhneKommentare),
	".avm-cols--2 fehlt -- das Fenster \"Garetien Importer\" braucht zwei Spuren statt drei.");
checks++;

console.log(`editor-body-single-source: ${checks} Pruefungen bestanden.`);

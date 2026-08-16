// Die Abschnittsreihenfolge der Editorfenster -- EINE Ordnung, sechs Fenster.
//
// 🔴 DIE ORDNUNG IST EIN OWNER-ENTSCHEID VOM 16.08.2026, wörtlich:
//     (wappen/bild/cover wenn ort/territorium/literatur)
//     Identität
//     Eigenschaften
//     Wiki-Sync
//     Quellen
//     --- Keine ungespeicherten Änderungen. --> Button: Speichern --- (wie bei "Wegeeditor")
//     Lage & Zugehörigkeit (wenn passend)
//     Gemeinsame Regionen mit (wenn passend)
// Die Trennlinie ist die Speicherleiste: alles Bearbeitbare steht darüber, alles Abgeleitete
// darunter. Anlass war „du hast null Konsistenz" nach dem Durchklicken aller sechs Fenster.
//
// 💣 DIESER TEST EXISTIERT, WEIL DIE ORDNUNG SONST WIEDER AUSEINANDERLÄUFT. Vor dem Umbau trug
// jedes Fenster seine eigene: der Ortseditor hatte „Lage & Zugehörigkeit" VOR der Wiki-Zuweisung
// und den Speichern-Knopf als letzte Zeile IM Identitätsraster; der Karteneditor hatte
// „Einordnung/Eigenschaften/Typ" GANZ UNTEN hinter den Bildern; der Literatureditor hatte
// „F-Shop & Cover" HINTER der Wiki-Zuweisung; der Kraftlinieneditor hatte „Beschreibung"
// darunter; der Wegeeditor hatte „Zugehörigkeit" ÜBER der Speicherleiste. Jedes davon war für
// sich plausibel -- zusammen war es keine Ordnung.
//
// ⚠️ ER LIEST DEN QUELLTEXT, nicht das gerenderte DOM. Fünf der sechs Renderer sind
// Template-Literale in einer einzigen Funktion in einer HTML-Datei -- sie ohne Browser
// auszuführen hieße, die halbe Seite nachzubauen. Was hier geprüft wird, ist die REIHENFOLGE, in
// der die Abschnittsköpfe im Erzeuger stehen, und genau die ist die Reihenfolge auf dem Schirm:
// alle sechs Erzeuger hängen ihre Abschnitte in Quelltextreihenfolge aneinander (Zeichenkette
// oder `parts.push`), keiner sortiert nachträglich um.
//
// 💣 GESUCHT WIRD IM RENDERER, NICHT IN DER GANZEN DATEI. Ohne den Ausschnitt fände „Identität"
// zuerst irgendeinen Kommentar oder einen zweiten Renderpfad, und der Test prüfte etwas anderes
// als das, was er zu prüfen behauptet. Jeder Eintrag nennt deshalb Anfang UND Ende seines
// Ausschnitts, und beide werden als vorhanden zugesichert -- verschwindet ein Anker durch eine
// Umbenennung, fällt der Test um, statt still ein leeres Fenster zu prüfen.
//
// Run: node js/pages/__tests__/editor-abschnittsreihenfolge.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");

/**
 * Der Ausschnitt zwischen zwei Ankern. Beide müssen da sein und in dieser Reihenfolge stehen --
 * sonst ist der Test wertlos, und das soll er sagen, statt es zu verschweigen.
 */
function ausschnitt(quelle, datei, von, bis) {
	const start = quelle.indexOf(von);
	assert.ok(start !== -1, `${datei}: Startanker nicht gefunden -- ${von}`);
	const ende = quelle.indexOf(bis, start + von.length);
	assert.ok(ende !== -1, `${datei}: Endanker nicht gefunden -- ${bis}`);
	return quelle.slice(start, ende);
}

// Je Fenster: die Abschnitte in der Soll-Reihenfolge, jeder mit dem Textstück, das ihn im
// Erzeuger eindeutig macht. „Nadel" ist bewusst der sichtbare Kopf bzw. die Kennung des
// Behälters -- beides ändert sich nicht beiläufig.
const FENSTER = [
	{
		datei: ["js", "pages", "wege-editor.js"],
		von: "function renderDetail() {",
		bis: "function markDirty()",
		abschnitte: [
			["Identität", '"dt-grp">Identität<'],
			["Eigenschaften (Transportmittel)", '"dt-grp">Erlaubte Transportmittel'],
			["Eigenschaften (Strömung)", '"dt-grp">Strömung<'],
			["Wiki-Zuweisung", 'id="wpWikiAssign"'],
			["Quellen", '"dt-grp">Andere Quelle<'],
			["Speicherleiste", '"avm-savebar"'],
			["Lage & Zugehörigkeit", '"dt-grp">Zugehörigkeit'],
		],
	},
	{
		datei: ["html", "wiki-sync-powerline-editor.html"],
		von: "host.innerHTML =",
		bis: '$("plSave").addEventListener',
		abschnitte: [
			["Identität", '"dt-grp">Identität<'],
			["Eigenschaften (Beschreibung)", '"dt-grp">Beschreibung<'],
			["Wiki-Zuweisung", 'id="plWikiAssign"'],
			["Quellen", '"dt-grp">Quellen<'],
			["Speicherleiste", '"avm-savebar avm-savebar--flush"'],
		],
	},
	{
		datei: ["html", "wiki-sync-settlement-editor.html"],
		// 🪤 ANKER IST DER `return`, NICHT DER FUNKTIONSKOPF. Mit dem Kopf begann der Ausschnitt bei
		// den `const`-Zeilen, und dort steht `wikiHtml` schon vor `form.properties` -- der Test
		// meldete eine Vertauschung, die es in der Ausgabe gar nicht gab. Die Reihenfolge, auf die
		// es ankommt, ist die der ZUSAMMENSETZUNG.
		von: "return coatHtml + imagesHtml",
		bis: "// ---- Territorium: assign / clear",
		abschnitte: [
			["Wappen", "coatHtml"],
			["Bilder", "imagesHtml"],
			["Identität", "form.identity"],
			["Eigenschaften", "form.properties"],
			["Wiki-Zuweisung", "wikiHtml"],
			["Quellen", "form.sources"],
			["Speicherleiste", "form.actions"],
			["Lage & Zugehörigkeit", "locationHtml"],
		],
	},
	{
		// Der zweite Renderpfad desselben Fensters: eine reine Wiki-Zeile ohne Kartenpunkt. Er hat
		// weniger Abschnitte (kein Formular, keine Quellen, keine Leiste), aber dieselbe Ordnung --
		// und genau hier stand der Owner-Befund „Eigenschaften vor Identität, verkehrt!".
		datei: ["html", "wiki-sync-settlement-editor.html"],
		von: "function buildWikiOnlySettlementDetailHtml(item) {",
		bis: "function renderWikiOnlySettlementDetail",
		abschnitte: [
			["Identität", '"dt-grp">Identität<'],
			["Eigenschaften", '"dt-grp">Eigenschaften<'],
		],
	},
	{
		datei: ["html", "landschaften-editor.html"],
		von: "function regionEditBlock(",
		bis: "function wireEditBlocks(",
		abschnitte: [
			["Identität (Name/Art)", 'data-f="name"'],
			["Wiki-Zuweisung", 'data-f="wiki-host"'],
			["Dauerzeile „erst mit Speichern“", "Zuweisen und Lösen wirken hier erst mit"],
			["Quellen", '"dt-grp">Quellen<'],
			["Speicherleiste", '"avm-savebar"'],
		],
	},
	{
		// Der umgebende Renderer: der Regionsblock oben, danach die zwei abgeleiteten Abschnitte.
		datei: ["html", "landschaften-editor.html"],
		von: "const parts = ['<div class=\"dt-grp\">Identität</div>",
		bis: "host.innerHTML = parts.join",
		abschnitte: [
			["Identität", '"dt-grp">Identität<'],
			["Regionsblöcke (mit Speicherleiste)", "regionEditBlock(region)"],
			["Lage & Zugehörigkeit", '"dt-grp">Liegt in<'],
			["Gemeinsame Regionen mit", '"dt-grp">Gemeinsame Regionen mit<'],
		],
	},
	{
		datei: ["html", "game-literature-editor.html"],
		von: "body.innerHTML = `",
		bis: "// Cover actions (upload / re-fetch)",
		abschnitte: [
			["Cover", "aeCoverGroup(v, o)"],
			["Identität", 'ae-grp__title">Identität<'],
			["Eigenschaften (Datierung)", 'ae-grp__title">Datierung'],
			["Eigenschaften (F-Shop & Cover)", 'ae-grp__title">F-Shop'],
			["Wiki-Zuweisung", 'id="aeWikiAssign"'],
			["Quellen (Shop-Links)", "aeLinksGroup(v, o)"],
			["Quellen (Weitere Links)", "aeExtraLinksGroup()"],
		],
	},
	{
		datei: ["html", "citymap-editor.html"],
		von: "const parentOptions = state.citymaps",
		bis: '// "Verwandte Karten" is HIDDEN here',
		abschnitte: [
			["Identität", 'ce-grp__title">Identität<'],
			["Eigenschaften (Einordnung)", 'ce-grp__title">Einordnung<'],
			["Eigenschaften", 'ce-grp__title">Eigenschaften<'],
			["Eigenschaften (Typ)", 'ce-grp__title">Typ ('],
			["Wiki-Zuweisung", 'id="ceWikiAssign"'],
			["Bilder (zugelassene Abweichung)", "ceImageGroup(\"thumb\""],
			["Quellen (Fundorte)", "ceLinksGroup()"],
			["Quellen (Belege)", 'ce-grp__title">Quellen<'],
		],
	},
];

let geprueft = 0;
for (const fenster of FENSTER) {
	const name = fenster.datei[fenster.datei.length - 1] + " · " + fenster.von.slice(0, 40);
	const block = ausschnitt(lies(...fenster.datei), name, fenster.von, fenster.bis);

	let vorigeStelle = -1;
	let vorigerName = "(Anfang)";
	for (const [abschnitt, nadel] of fenster.abschnitte) {
		const stelle = block.indexOf(nadel);
		assert.ok(
			stelle !== -1,
			`${name}: Abschnitt „${abschnitt}" nicht im Renderer gefunden (gesucht: ${nadel}). ` +
			"Entweder ist er verschwunden oder umbenannt -- beides gehoert in den Test."
		);
		assert.ok(
			stelle > vorigeStelle,
			`${name}: „${abschnitt}" steht VOR „${vorigerName}". Die Owner-Reihenfolge lautet ` +
			"Bild/Wappen/Cover · Identität · Eigenschaften · Wiki-Zuweisung · Quellen · " +
			"SPEICHERLEISTE · Lage & Zugehörigkeit · Gemeinsame Regionen mit."
		);
		vorigeStelle = stelle;
		vorigerName = abschnitt;
		geprueft += 1;
	}
}

// 💣 DIE SPEICHERLEISTE HAT GENAU EINE FASSUNG. Bis zum 16.08.2026 waren es vier: `.wp-savebar`
// (nur im Wege-Editor geladen), `.dt-actions` (Landschaften, Kraftlinien), `.dt-edit-actions`
// (Orte) und die zwei Fussleisten `.ae-savebar`/`.ce-savebar`. Die ersten drei sind eingezogen;
// die zwei Fussleisten bleiben, weil sie die ganze Detailspalte abschliessen statt im Fluss zu
// stehen -- eine begruendete Ausnahme, kein Rest.
const editorPageCss = lies("css", "components", "editor-page.css");
assert.ok(editorPageCss.includes(".avm-savebar {"), "Die geteilte Speicherleiste fehlt in editor-page.css.");
assert.ok(
	!lies("css", "pages", "wege-editor.css").includes(".wp-savebar {"),
	"css/pages/wege-editor.css traegt wieder eine eigene Speicherleiste -- sie ist nach " +
	"css/components/editor-page.css gewandert, weil diese Datei nur EINE Seite laedt."
);
for (const datei of ["wiki-sync-settlement-editor.html", "wiki-sync-powerline-editor.html", "landschaften-editor.html"]) {
	const quelle = lies("html", datei);
	assert.ok(quelle.includes("avm-savebar"), `${datei}: benutzt die geteilte Speicherleiste nicht.`);
}
assert.ok(
	!lies("html", "wiki-sync-settlement-editor.html").includes(".dt-edit-actions {"),
	"Der Ortseditor traegt wieder seine eigene Knopfzeile (.dt-edit-actions)."
);

// 🔴 DER RUHEZUSTAND IST DER OWNER-WORTLAUT und steht in ALLEN sechs Fenstern. Er ist die halbe
// Vorgabe („--- Keine ungespeicherten Änderungen. --> Button: Speichern ---"); ohne ihn steht die
// Leiste stumm da, und „nichts zu speichern" sieht aus wie „ich sag's nur nicht".
const RUHE = "Keine ungespeicherten Änderungen.";
for (const [ordner, datei] of [
	["js/pages", "wege-editor.js"],
	["html", "wiki-sync-powerline-editor.html"],
	["html", "wiki-sync-settlement-editor.html"],
	["html", "landschaften-editor.html"],
	["html", "game-literature-editor.html"],
	["html", "citymap-editor.html"],
]) {
	const quelle = lies(...ordner.split("/"), datei);
	assert.ok(quelle.includes(RUHE), `${datei}: die Speicherleiste nennt den Ruhezustand nicht („${RUHE}").`);
}

console.log(`OK: Abschnittsreihenfolge -- ${geprueft} Abschnitte in ${FENSTER.length} Renderern, eine Speicherleiste.`);

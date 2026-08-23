// Die Vorgabefarben des SVG-Exports -- die EINE Stelle, die Browser und naechtlicher Lauf
// teilen. Lauf: node js/pages/__tests__/svg-export-farben.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const F = require("../svg-export-farben.js");
const B = require("../svg-export-build.js");

// Ein Nachschlager wie getComputedStyle: unbekannt -> leerer String.
const tafel = {
	"--color-ecosystem-vegetation": "#5f7d33",
	"--color-ecosystem-vegetation-wald": "#3f6b2c",
	"--color-ecosystem-vegetation-suempfe-moore": "#4a5d3a",
	"--color-ecosystem-topographie": "#7a6c5e",
	"--color-ecosystem-topographie-meer": "#2d5f8a",
	"--color-marker-waypoint": "#e33b35",
};
const token = (name) => tafel[name] || "";

// ---- 1. Die Owner-Vorgaben schlagen die Kartenfarbe -----------------------------------
// 🔴 Owner 15.08.2026: „seen sind 82befe, flüsse 4c89c6, wege f5ffe9, wälder 589a64,
// gebirge acaea2, der rest wie aus dem programm."
assert.strictEqual(F.svgxFarbeVorgabe("landschaften/topographie/see", token, {}, ""), "#82befe");
assert.strictEqual(F.svgxFarbeVorgabe("landschaften/vegetation/wald", token, {}, ""), "#589a64",
	"die Vorgabe schlaegt den Token #3f6b2c");
assert.strictEqual(F.svgxFarbeVorgabe("landschaften/topographie/gebirge", token, {}, ""), "#acaea2");
// ⚠️ „wege" heisst die sechs LANDwege. Seeweg bleibt bei seinem Kartenton.
["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad"].forEach((art) => {
	assert.strictEqual(F.svgxFarbeVorgabe(`wege/${art}`, token, B.SVGX_WAY_COLORS, ""), "#f5ffe9",
		`${art} ist ein Landweg`);
});
assert.strictEqual(F.svgxFarbeVorgabe("wege/Flussweg", token, B.SVGX_WAY_COLORS, ""), "#4c89c6");
assert.strictEqual(F.svgxFarbeVorgabe("wege/Seeweg", token, B.SVGX_WAY_COLORS, ""),
	B.SVGX_WAY_COLORS.Seeweg, "der Seeweg ist eine Schiffsroute, kein Landweg");

// ---- 2. Ohne Vorgabe: erst der Typ-Token, dann der Art-Token, dann der Rueckfall -------
// 💣 Der Unterstrich wird zum Bindestrich -- suempfe_moore -> …-suempfe-moore.
assert.strictEqual(F.svgxFarbeVorgabe("landschaften/vegetation/suempfe_moore", token, {}, ""),
	"#4a5d3a", "der Typ-Token gewinnt");
assert.strictEqual(F.svgxFarbeVorgabe("landschaften/vegetation/steppe", token, {}, ""),
	"#5f7d33", "ohne Typ-Token faellt es auf den Token der Art zurueck");
assert.strictEqual(F.svgxFarbeVorgabe("landschaften/gibtsnicht/auchnicht", token, {}, ""),
	"#dfd6bd", "und zuletzt auf den Beigeton");

// ---- 3. Die uebrigen Ebenen -----------------------------------------------------------
assert.strictEqual(F.svgxFarbeVorgabe("gebiete", token, {}, ""), "#8a6a3f");
assert.strictEqual(F.svgxFarbeVorgabe("kraftlinien", token, {}, ""), "#7a5ea8");
// 🔴 Orte in der Farbe der Kartenmarkierung, nicht im Braun der Schrift (Owner 16.08.2026).
assert.strictEqual(F.svgxFarbeVorgabe("orte/dorf", token, {}, ""), "#e33b35");
assert.strictEqual(F.svgxFarbeVorgabe("orte/dorf", () => "", {}, B.SVGX_PLACE_COLOR),
	B.SVGX_PLACE_COLOR, "ohne Token der Wert aus dem Bauer");
assert.strictEqual(F.svgxFarbeVorgabe("beschriftungen", token, {}, ""), "#3b2a18",
	"Beschriftungen bleiben braun");
// Eine unbekannte Wegart darf nicht farblos werden.
assert.strictEqual(F.svgxFarbeVorgabe("wege/Schwebebahn", token, B.SVGX_WAY_COLORS, ""), "#888888");

// ---- 4. Die Flaechenfarben werden aus den DATEN abgeleitet -----------------------------
// 💣 Nicht aus einer Liste von Kaestchen: ein neu eingefuehrter Gelaendetyp, den die
// Exportseite noch gar nicht kennt, bekommt trotzdem seine Farbe.
const farbenAusDaten = F.svgxLandschaftsFarben([
	{ properties: { kind: "vegetation", region_type: "wald" } },
	{ properties: { kind: "topographie", region_type: "meer" } },
	{ properties: { kind: "vegetation", region_type: "wald" } },
	{ properties: { kind: "vegetation" } },
	{ properties: { kind: "topographie", region_type: "brandneuer_typ" } },
], token);
assert.strictEqual(farbenAusDaten.wald, "#3f6b2c", "hier gilt der Token, nicht die Owner-Vorgabe");
assert.strictEqual(farbenAusDaten.meer, "#2d5f8a");
// 💣 Der Rueckfall heisst `ohne_typ` -- 49 Flaechen tragen keinen region_type, und unter dem
// Namen der Art haetten sie einen Gruppennamen, den kein Kaestchen kennt.
assert.strictEqual(farbenAusDaten.ohne_typ, "#5f7d33");
assert.strictEqual(farbenAusDaten.brandneuer_typ, "#7a6c5e",
	"ein unbekannter Typ faellt auf den Token seiner Art, nie auf gar nichts");
assert.deepStrictEqual(F.svgxLandschaftsFarben(null, token), {}, "keine Daten, kein Krach");

// ---- 5. 💣 DIE DIVERGENZWACHE ---------------------------------------------------------
// Diese Datei existiert, weil die Regel bis zum 23.08.2026 im Kitt eingesperrt war. Schriebe
// jemand sie dort wieder hin -- oder in den Laeufer --, gaebe es zwei Faelle, und ein neuer
// Gelaendetyp bekaeme im Browserabzug seine Farbe und im naechtlichen die des Rueckfalls.
const wurzel = path.resolve(__dirname, "..", "..", "..");
const kitt = fs.readFileSync(path.join(wurzel, "js", "pages", "svg-export-page.js"), "utf8");
const laeufer = fs.readFileSync(path.join(wurzel, "tools", "svg-export", "abzug-bauen.js"), "utf8");

[["svg-export-page.js", kitt], ["abzug-bauen.js", laeufer]].forEach(([wo, quelle]) => {
	assert.ok(!/const\s+SVGX_COLOR_PRESETS\s*=/.test(quelle),
		`${wo} fuehrt keine eigene Vorgabetafel`);
	assert.ok(!quelle.includes("#82befe") && !quelle.includes("#f5ffe9"),
		`${wo} schreibt keine Vorgabefarbe ab`);
});
// Und beide benutzen die geteilte Datei wirklich -- „keine Kopie" allein waere auch dann
// gruen, wenn gar keine Farbe mehr gesetzt wuerde.
assert.ok(kitt.includes("AvesmapsSvgExportFarben"), "der Kitt greift auf das geteilte Bauteil zu");
assert.ok(/require\(["'][^"']*svg-export-farben/.test(laeufer),
	"der Laeufer laedt dasselbe Bauteil");
// 🔴 Und die Seite laedt es auch -- ein Bauteil, das nur der Laeufer kennt, waere im Browser
// ein „AvesmapsSvgExportFarben is undefined" beim ersten Klick.
const seite = fs.readFileSync(path.join(wurzel, "edit", "svg-export.php"), "utf8");
// ⚠️ GEPRUEFT WERDEN DIE SKRIPT-TAGS, NICHT DER FLIESSTEXT. Der Kopfkommentar der Seite nennt
// svg-export-page.js in Zeile 10 -- ein blosses indexOf faende die Erklaerung und behauptete
// eine Reihenfolge, die mit dem Laden nichts zu tun hat.
const skripte = [...seite.matchAll(/<script\s+src="\.\.\/(js\/pages\/[^"?]+)/g)].map((m) => m[1]);
assert.ok(skripte.includes("js/pages/svg-export-farben.js"),
	`edit/svg-export.php bindet das geteilte Bauteil ein, geladen wird: ${skripte.join(", ")}`);
assert.ok(skripte.indexOf("js/pages/svg-export-farben.js")
	< skripte.indexOf("js/pages/svg-export-page.js"),
	"und zwar VOR dem Kitt, der es benutzt");

// ⚠️ Der Stempel muss mitwandern, sonst serviert der Browser den alten Kitt weiter
// (AGENTS.md sec.7 -- der Stempler erreicht diese PHP-Seite nie, sie ist handgestempelt).
// 🔴 Geprueft werden die DREI SKRIPTE, nicht auch das Stylesheet: die drei laden gemeinsam
// und muessen zueinander passen -- ein zurueckgebliebener Kitt neben einem neuen Bauteil ist
// genau der Fehler, den der Stempel verhindern soll. Das Stylesheet ist davon unabhaengig und
// steht im Repo bewusst auf einem eigenen Stand (23.08.2026: css -16, Skripte -18); es
// mitzuzaehlen hiesse, bei jeder JS-Aenderung eine CSS-Datei anzufassen, die niemand geaendert hat.
const stempel = [...seite.matchAll(/js\/pages\/svg-export(?:-build|-farben|-page)\.js\?v=([^"']+)/g)]
	.map((m) => m[1]);
assert.strictEqual(stempel.length, 3,
	`drei gestempelte Skripte: build, farben, page -- gefunden: ${stempel.length}`);
assert.strictEqual(new Set(stempel).size, 1,
	`alle drei tragen denselben Stempel, gefunden: ${[...new Set(stempel)].join(", ")}`);

console.log("svg-export-farben: ok");

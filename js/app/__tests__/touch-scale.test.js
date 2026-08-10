// Die Massschicht: EIN Ort fuer Bedienmasse, und die iOS-Schwelle.
//
// Geprueft wird, was hier nicht selbsterklaerend ist und beim naechsten Anfassen lautlos kippt:
// dass es genau einen Finger-Block gibt, dass die Schwelle ihren WERT haelt (nicht bloss gesetzt
// ist), dass kein Feld daneben seine eigene Schriftgroesse schreibt -- und dass der falsche Fix
// (maximum-scale im Viewport-Meta) nicht nachwaechst.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/touch-scale.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. In diesem Repo sind schon vier Zusicherungen darauf hereingefallen. */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

function escapeRe(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tokens = withoutComments(read("css", "base", "tokens.css"));
const planner = withoutComments(read("css", "features", "route-planner.css"));
const indexHtml = withoutComments(read("index.html"));

// ---- Der EINE Finger-Block ----------------------------------------------------------------------
const coarseBlocks = tokens.match(/@media\s*\(pointer:\s*coarse\)\s*\{[\s\S]*?\n\}/g) || [];
assert.strictEqual(coarseBlocks.length, 1,
	`tokens.css traegt ${coarseBlocks.length} (pointer: coarse)-Bloecke -- es muss genau EINER sein.`
	+ " Zwei waeren zwei Wahrheiten, und die faende man erst, wenn sie auseinanderlaufen.");
const coarse = coarseBlocks[0];

// ---- Die iOS-Schwelle: der WERT, nicht die blosse Anwesenheit ------------------------------------
const controlFont = coarse.match(/--font-size-control:\s*([0-9.]+)px/);
assert.ok(controlFont, "der Finger-Block setzt --font-size-control");
assert.ok(Number(controlFont[1]) >= 16,
	`--font-size-control ist am Finger ${controlFont[1]}px -- unter 16 faehrt Safari beim Fokus in`
	+ " jedes Feld hinein und kehrt nicht zurueck. 16 ist eine Schwelle, kein Richtwert: 15,5 zoomt.");

// ---- Kein Feld schreibt daneben seine eigene Schrift ----------------------------------------------
//
// ⚠️ `.waypoint-input` steht NICHT in dieser Liste: seine Klassenregel gewinnt nachweislich nicht
// (live gemessen 13,33px statt der 15px, die dort stehen). Es wird darunter gesondert geprueft.
const FELD_REGELN = [".route-planner-options-panel input", ".display-options__row"];
FELD_REGELN.forEach((selector) => {
	const rule = planner.match(new RegExp(escapeRe(selector) + "[^{]*\\{([^}]*)\\}"));
	assert.ok(rule, `Regel fuer ${selector} gefunden`);
	const font = rule[1].match(/font-size:\s*([^;]+);/);
	assert.ok(font, `${selector} setzt eine Schriftgroesse`);
	assert.ok(/var\(--font-size-control\)/.test(font[1]),
		`${selector} liest --font-size-control statt "${font[1].trim()}" -- ein Literal hier schlaegt`
		+ " den Basisselektor (0,1,0 gegen 0,0,1) und die Schwelle bliebe wirkungslos");
});

// ---- Das Wegpunktfeld: die eine Ausnahme, und sie muss am Finger greifen --------------------------
//
// 💣 Live gemessen am 10.08.2026, durch Einspritzen beider Fassungen in die laufende Seite:
// `.waypoint-input { font-size: 16px }` bewegt NICHTS (bleibt 13,33px), `input.waypoint-input`
// setzt sich durch. Ohne die hoehere Spezifitaet bliebe die Schwelle am wichtigsten Feld des
// Planers wirkungslos, und zwar lautlos.
const wegpunktRegel = planner.match(
	/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*input\.waypoint-input\s*\{([^}]*)\}/);
assert.ok(wegpunktRegel,
	"route-planner.css traegt eine (pointer: coarse)-Regel fuer `input.waypoint-input`"
	+ " -- mit blossem `.waypoint-input` bliebe die Schwelle dort wirkungslos (live gemessen)");
assert.ok(/var\(--font-size-control\)/.test(wegpunktRegel[1]),
	"und sie liest den Token");
assert.ok(/\.waypoint-input\s*\{[^}]*font-size:\s*15px/.test(planner),
	"die alte 15px-Regel bleibt unangetastet -- sie gewinnt heute ohnehin nicht, und sie zu aendern"
	+ " koennte den Zeiger verschieben, falls die Kaskade dort einmal repariert wird");

// ---- Der falsche Fix darf nicht nachwachsen ------------------------------------------------------
const viewport = indexHtml.match(/<meta\s+name="viewport"[^>]*>/);
assert.ok(viewport, "index.html traegt ein Viewport-Meta");
assert.ok(!/maximum-scale|user-scalable/.test(viewport[0]),
	"das Viewport-Meta sperrt das Aufziehen NICHT -- das naehme allen die Zoomgeste, also genau die,"
	+ " die am Finger die einzige Zoomhilfe ist. Neuere iOS-Fassungen ignorieren es ohnehin.");

// ---- Die Gasse: EINE Zahl, und ABGELEITET --------------------------------------------------------
const layout = withoutComments(read("css", "layout", "map-layout.css"));
const infopanelCss = withoutComments(read("css", "features", "infopanel.css"));

const gutter = tokens.match(/--avesmaps-panel-gutter:\s*([^;]+);/);
assert.ok(gutter, "tokens.css definiert --avesmaps-panel-gutter");
assert.ok(/var\(--avesmaps-tab-w\)/.test(gutter[1]),
	"die Gasse rechnet sich aus der LASCHENBREITE, nicht aus einer freien Zahl -- sonst kann sie"
	+ " jederzeit wieder unter die 30px der Lasche rutschen und sie anschneiden. Genau das ist"
	+ " heute der Fall: von der 30px-Lasche des Planers stehen auf 360px Schirm 10px im Bild.");

[["map-layout.css", layout], ["infopanel.css", infopanelCss]].forEach(([name, css]) => {
	assert.ok(!/100vw\s*-\s*\d+px/.test(css),
		`${name} rechnet die Gasse NICHT von Hand (100vw - Npx) -- beide Panels lesen denselben Token,`
		+ " sonst laufen die zwei Zahlen beim naechsten Anfassen auseinander");
});
assert.ok(/var\(--avesmaps-panel-gutter\)/.test(layout), "#search liest die Gasse");
assert.ok(/var\(--avesmaps-panel-gutter\)/.test(infopanelCss), "das Infopanel liest die Gasse");

// ---- 140dvh kommt nicht zurueck -------------------------------------------------------------------
const schmal = layout.match(/@media\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\n\}/);
assert.ok(schmal, "map-layout.css hat den Schmal-Block");
const maxH = schmal[0].match(/#search[^{]*\{[^}]*max-height:\s*([^;]+);/);
if (maxH) {
	assert.ok(!/1[0-9]{2}dvh/.test(maxH[1]),
		`#search traegt am Telefon max-height ${maxH[1].trim()} -- ueber 100dvh greift die Grenze nie,`
		+ " das Panel scrollt nicht, und stattdessen scrollt die SEITE: gemessen auf 360x640 ragten"
		+ " 136px unter den Rand und die Karte fuhr weg");
}
assert.ok(/#search\s*\{[^}]*height:\s*100dvh/.test(schmal[0]),
	"#search laeuft am Telefon ueber die volle Hoehe -- daran haengt, dass sein overflow-y greift");

console.log("touch-scale tests passed");

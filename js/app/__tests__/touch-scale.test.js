// Die iOS-Schwelle: Eingabefelder tragen am groben Zeiger mindestens 16px.
//
// Geprueft wird, was hier lautlos kippt: dass es genau EINEN Finger-Block gibt, dass die Schwelle
// ihren WERT haelt (nicht bloss gesetzt ist), dass die Felder den Token lesen statt eines Literals
// -- und dass der falsche Fix (maximum-scale im Viewport-Meta) nicht nachwaechst.
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

// ---- Die Schwelle: der WERT, nicht die blosse Anwesenheit ----------------------------------------
const controlFont = coarse.match(/--font-size-control:\s*([0-9.]+)px/);
assert.ok(controlFont, "der Finger-Block setzt --font-size-control");
assert.ok(Number(controlFont[1]) >= 16,
	`--font-size-control ist am Finger ${controlFont[1]}px -- unter 16 faehrt Safari beim Fokus in`
	+ " jedes Feld hinein und kehrt nicht zurueck. 16 ist eine Schwelle, kein Richtwert: 15,5 zoomt.");

// ---- Die Felder lesen den Token ------------------------------------------------------------------
const feldRegel = planner.match(
	/^\.route-planner-options-panel input\[type="number"\],[\s\S]*?\{([^}]*)\}/m);
assert.ok(feldRegel, "die Regel fuer Zahlenfeld und Select ist auffindbar");
const font = feldRegel[1].match(/font-size:\s*([^;]+);/);
assert.ok(font && /var\(--font-size-control\)/.test(font[1]),
	`Zahlenfeld/Select liest --font-size-control statt "${font ? font[1].trim() : "nichts"}"`);
assert.ok(feldRegel[1].indexOf("font: inherit") < feldRegel[1].indexOf("font-size:"),
	"und zwar NACH `font: inherit` -- die Kurzform setzt font-size mit und ueberschriebe die Zeile sonst");

// ---- Das Wegpunktfeld: die eine Ausnahme ---------------------------------------------------------
//
// 💣 Am 10.08.2026 live gemessen, durch Einspritzen beider Fassungen in die laufende Seite:
// `.waypoint-input { font-size: 16px }` bewegt NICHTS (das Feld bleibt bei 13,33px), erst
// `input.waypoint-input` setzt sich durch. Ohne die hoehere Spezifitaet bliebe die Schwelle am
// wichtigsten Feld des Planers wirkungslos, und zwar lautlos.
const wegpunktRegel = planner.match(
	/@media\s*\(pointer:\s*coarse\)\s*\{[^}]*input\.waypoint-input\s*\{([^}]*)\}/);
assert.ok(wegpunktRegel,
	"route-planner.css traegt eine (pointer: coarse)-Regel fuer `input.waypoint-input`"
	+ " -- mit blossem `.waypoint-input` bliebe die Schwelle dort wirkungslos (live gemessen)");
assert.ok(/var\(--font-size-control\)/.test(wegpunktRegel[1]), "und sie liest den Token");
assert.ok(/\.waypoint-input\s*\{[^}]*font-size:\s*15px/.test(planner),
	"die alte 15px-Regel bleibt unangetastet -- sie gewinnt heute ohnehin nicht, und sie zu aendern"
	+ " koennte den Zeiger verschieben, falls die Kaskade dort einmal repariert wird");

// ---- Die Beschriftungen bleiben, wie sie sind ----------------------------------------------------
//
// 🔴 Absichtlich NICHT mitgehoben. Die Felder haben feste Hoehen (25px / 32px), ihre Schrift waechst
// nach innen. Beschriftungszeilen haben keine feste Hoehe -- sie mitzuheben machte den Planer am
// Telefon hoeher, und dessen Hoehenbudget ist eine eigene, groessere Frage (der Versuch vom 10.08.
// wurde deshalb zurueckgerollt). Die Zoom-Falle betrifft ohnehin nur Eingabefelder.
const zeilenRegel = planner.match(/^\.display-options__row,[\s\S]*?\{([^}]*)\}/m);
assert.ok(zeilenRegel, "die Beschriftungszeile ist auffindbar");
assert.ok(!/var\(--font-size-control\)/.test(zeilenRegel[1]),
	"die Beschriftungszeilen lesen den Token NICHT -- sie haben keine feste Hoehe und wuerden den"
	+ " Planer am Telefon wachsen lassen");

// ---- Die uebrigen Besucher-Fenster mit Eingabefeldern --------------------------------------------
//
// Die Schwelle gilt UEBERALL, wo ein Besucher tippt -- nicht nur im Routenplaner. Drei Fenster
// haben eigene Formulare; das Bewertungsformular teilt sich die Regeln des Meldedialogs
// (es traegt class="location-report-form"), deshalb sind es drei Regeln und nicht vier.
//
// ⚠️ Anders als die Planerfelder haben diese KEINE feste Hoehe -- sie wachsen am Finger mit der
// Schrift. Hier unschaedlich, weil alle drei Fenster scrollen; im Planer waere es das nicht
// gewesen (dessen Hoehenbudget ist eine eigene Frage).
const DIALOG_FELDER = [
	["css/components/legal-dialog.css", ".legal-contact input", "Kontaktformular"],
	["css/components/location-report-dialog.css", ".location-report-form__field input",
		"Meldedialog + Bewertungsformular"],
	["css/components/location-report-dialog.css", ".report-sources__add input[type=\"text\"]",
		"Quellen-Unterformular"],
];
DIALOG_FELDER.forEach(([rel, selector, name]) => {
	const css = withoutComments(read(...rel.split("/")));
	const rule = css.match(new RegExp("^" + escapeRe(selector) + "[\\s\\S]*?\\{([^}]*)\\}", "m"));
	assert.ok(rule, `Feldregel fuer ${name} gefunden (${selector})`);
	assert.ok(/font-size:\s*var\(--font-size-control\)/.test(rule[1]),
		`${name} liest --font-size-control -- sonst zoomt iOS beim Fokus in das Feld`);
	assert.ok(rule[1].indexOf("font: inherit") < rule[1].indexOf("font-size:"),
		`${name}: die Schwelle steht NACH \`font: inherit\` -- die Kurzform setzt font-size mit`);
});

// Und die Fenster muessen scrollen, sonst waere das Wachsen der Felder ein Ueberlauf.
[["css/components/location-report-dialog.css", "Meldedialog"],
 ["css/features/location-reviews.css", "Bewertungen"],
 ["css/components/legal-dialog.css", "Hinweise"]].forEach(([rel, name]) => {
	const css = withoutComments(read(...rel.split("/")));
	assert.ok(/overflow-y:\s*auto/.test(css),
		`${name} scrollt -- daran haengt, dass die groesseren Felder nicht ueberlaufen`);
});

// ---- Die Suchkachel: EINE Regel mit ihren Nachbarn ------------------------------------------------
//
// Owner 11.08.2026: "kachel aber farbe und outline wie Hinweise bzw Neuigkeiten". Das ist erfuellt,
// indem sie in DERSELBEN Regel steht -- nicht, indem die Werte abgeschrieben sind. Ein gefuellter
// Knopf trug seine Rangfolge im Dunkelmodus ohnehin nicht: dort liegen --color-button (#6b6456) und
// --color-panel (#312e26) beide im selben Braun.
const legalCss = withoutComments(read("css", "components", "legal-dialog.css"));
const gemeinsam = legalCss.match(/^#map-search-button,\s*\r?\n#legal-button,\s*\r?\n#news-button\s*\{/m);
assert.ok(gemeinsam,
	"die Suchkachel steht in DERSELBEN Regel wie #legal-button und #news-button -- kopierte Werte"
	+ " waeren die Divergenz, vor der AGENTS.md §12 warnt");
const eigen = legalCss.match(/^#map-search-button\s*\{([^}]*)\}/m);
assert.ok(eigen, "und hat einen eigenen Block fuer das, was eine Kachel ausmacht");
["background", "border:", "border-radius", "box-shadow", "color:"].forEach((prop) => {
	assert.ok(!new RegExp(escapeRe(prop)).test(eigen[1]),
		`der Kachel-Block setzt ${prop} NICHT selbst -- das kommt aus der gemeinsamen Regel`);
});
// 💣 Die Kachel darf ihre Hoehe NICHT selbst setzen -- sie entsteht aus der gemeinsamen
// Schriftgroesse und der gemeinsamen Luft. Eine eigene Zahl hier waere eine Kopie, die beim
// naechsten Wachsen des Bundes stehenbleibt.
// ⚠️ Und NICHT ueber align-self: stretch + aspect-ratio: der Bund hat keine eigene Hoehe, das ist
// ein Zirkel -- gemessen wurde die Kachel damit 302x302 und sprengte die Reihe.
assert.ok(!/(^|[^-])height:/.test(eigen[1]) && !/aspect-ratio/.test(eigen[1]),
	"die Kachel setzt weder height noch aspect-ratio -- ihre Hoehe entsteht aus Schrift und Luft"
	+ " der gemeinsamen Regel und waechst mit dem Bund mit");
assert.ok(/padding:\s*7px;/.test(eigen[1]),
	"waagerecht dieselbe Luft wie senkrecht -- das ist der einzige Unterschied zu den Textknoepfen");

const indexSuch = indexHtml.indexOf('id="map-search-button"');
const indexBund = indexHtml.indexOf('id="map-corner-actions"');
const indexNews = indexHtml.indexOf('id="news-button"');
assert.ok(indexBund > -1 && indexSuch > indexBund && indexSuch < indexNews,
	"und sie steht IM Bund, als erstes Element vor \"Neuigkeiten\"");

const layoutCss = withoutComments(read("css", "layout", "map-layout.css"));
assert.ok(/@media\s*\(pointer:\s*coarse\)[\s\S]*?\.leaflet-control-zoom[^}]*display:\s*none/.test(layoutCss),
	"der Zoom-Control wird am Finger ausgeblendet -- er und die Kachel teilen sich die Ecke nie");
const bootstrapJs = withoutComments(read("js", "app", "bootstrap.js"));
assert.ok(/L\.control\.zoom\(/.test(bootstrapJs),
	"...aber weiterhin ANGELEGT: sonst stuende die Platzierungsregel in infopanel.css als tote"
	+ " Zusicherung da, die map-corner-actions.test.js prueft");
assert.ok(/openSpotlightSearch\s*\(/.test(bootstrapJs),
	"die Kachel ruft die vorhandene Suche, statt eine zweite zu bauen");

// ---- Der falsche Fix darf nicht nachwachsen ------------------------------------------------------
const viewport = indexHtml.match(/<meta\s+name="viewport"[^>]*>/);
assert.ok(viewport, "index.html traegt ein Viewport-Meta");
assert.ok(!/maximum-scale|user-scalable/.test(viewport[0]),
	"das Viewport-Meta sperrt das Aufziehen NICHT -- das naehme allen die Zoomgeste, und neuere"
	+ " iOS-Fassungen ignorieren es ohnehin");

console.log("touch-scale tests passed");

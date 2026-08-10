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

// ---- Kein zweiter Ort fuer Steuermasse -----------------------------------------------------------
const HOEHEN = ["--control-h", "--control-h-sm", "--control-h-field", "--tap-min"];
HOEHEN.forEach((name) => {
	assert.ok(new RegExp(escapeRe(name) + ":").test(tokens), `${name} steht in tokens.css`);
	assert.ok(new RegExp(escapeRe(name) + ":").test(coarse), `${name} wird im Finger-Block angehoben`);
});
["css/features/route-planner.css", "css/layout/map-layout.css", "css/components/legal-dialog.css"]
	.forEach((rel) => {
		const css = withoutComments(read(...rel.split("/")));
		assert.ok(!/@media\s*\(pointer:\s*coarse\)[^{]*\{[^}]*--control-h/.test(css),
			`${rel} hebt die Steuerhoehen NICHT selbst an -- das gehoert in tokens.css,`
			+ " sonst gibt es zwei Wahrheiten");
	});

// ---- Die Fingerwerte sind Fingerwerte -------------------------------------------------------------
const tap = coarse.match(/--tap-min:\s*([0-9.]+)px/);
assert.ok(tap && Number(tap[1]) >= 44,
	`--tap-min ist am Finger ${tap ? tap[1] + "px" : "nicht gesetzt"} -- unter 44 ist es kein Fingerziel`);
const controlH = coarse.match(/--control-h:\s*([0-9.]+)px/);
assert.ok(controlH && Number(controlH[1]) >= 44,
	`--control-h ist am Finger ${controlH ? controlH[1] + "px" : "nicht gesetzt"} -- Felder und Knoepfe`
	+ " sind die Haupt-Bedienelemente des Planers");

// ---- Die Komponenten lesen die Token, statt Hoehen zu tragen ---------------------------------------
// 💣 Die Wegpunktzeile steht NICHT hier drin. Ihre Masse besitzt
// css/features/route-planner-waypoint-timeline.css -- die Datei wird nach route-planner.css
// importiert und arbeitet mit `#waypoints …` plus !important. Eine Hoehe in route-planner.css ist
// dort wirkungslos; gemessen, nachdem genau das passiert war (Griff und Loeschknopf blieben am
// Finger auf 32/24px, obwohl die Token schon standen). Deshalb wird sie unten gesondert geprueft.
const HOEHEN_REGELN = [
	[".input-options button", "--control-h"],
	["#inputLocation", "--control-h"],
	[".planner-group__toggle", "--control-h-sm"],
	[".route-planner-options-panel input", "--control-h-field"],
];
HOEHEN_REGELN.forEach(([selector, token]) => {
	// 💣 Am ZEILENANFANG verankert. Ohne das greift `.planner-group__toggle` die weiter oben
	// stehende `.planner-group__head:has(.planner-group__toggle:hover) .planner-group__toggle`-Regel
	// -- eine andere Regel, deren Rumpf den Token nie enthaelt. Der Test waere rot, obwohl der Code
	// stimmt; genauso koennte er gruen sein, obwohl er nicht stimmt.
	const rule = planner.match(new RegExp("^" + escapeRe(selector) + "[^{]*\\{([^}]*)\\}", "m"));
	assert.ok(rule, `Regel fuer ${selector} gefunden`);
	assert.ok(new RegExp(escapeRe("var(" + token + ")")).test(rule[1]),
		`${selector} liest ${token} -- eine harte Hoehe hier bliebe am Finger stehen`);
});

// ---- Die Wegpunktzeile: dort, wo ihre Masse wirklich stehen --------------------------------------
const timeline = withoutComments(read("css", "features", "route-planner-waypoint-timeline.css"));
[["#waypoints .waypoint-drag-handle", "--control-h"],
 ["#waypoints .waypoint-input", "--control-h"],
 ["#waypoints .remove-waypoint", "--control-h-sm"]].forEach(([selector, token]) => {
	const rule = timeline.match(new RegExp("^" + escapeRe(selector) + "\\s*\\{([^}]*)\\}", "m"));
	assert.ok(rule, `Regel fuer ${selector} in der Timeline-Datei gefunden`);
	assert.ok(new RegExp(escapeRe("var(" + token + ")")).test(rule[1]),
		`${selector} liest ${token} -- diese Datei gewinnt ueber route-planner.css (#waypoints +`
		+ " !important), eine Hoehe dort waere wirkungslos");
});

// 💣 Die nackten Kaestchen bleiben 14px: sie zu vergroessern verzieht die Zeile. Das Klickziel ist
// das umgebende <label>, und DAS traegt --tap-min -- und zwar an der Regel, die auch GEWINNT:
// `.transport-filter-label` steht dreimal in route-planner.css, und die spaeteste setzt min-height
// zurueck. Ein --tap-min an der ersten blieb wirkungslos (gemessen: Zeile blieb 20px statt 44).
const zeilenRegeln = planner.match(/^\.transport-filter-label\s*\{[^}]*\}/gm) || [];
assert.ok(zeilenRegeln.length >= 1, "die Kaestchen-Zeile ist auffindbar");
assert.ok(/var\(--tap-min\)/.test(zeilenRegeln[zeilenRegeln.length - 1])
	|| zeilenRegeln.some((r) => /min-height:\s*var\(--tap-min\)/.test(r)),
	"die LETZTE .transport-filter-label-Regel traegt min-height: var(--tap-min)"
	+ " -- eine fruehere wuerde von ihrem `min-height: auto` ueberschrieben");
assert.ok(!zeilenRegeln.some((r) => /min-height:\s*auto/.test(r)),
	"und keine spaetere setzt es wieder auf auto zurueck");

// ---- Der Zoom raeumt am Finger, und die Suche zieht ein -------------------------------------------
assert.ok(/@media\s*\(pointer:\s*coarse\)[^{]*\{[\s\S]*?\.leaflet-control-zoom[^}]*display:\s*none/.test(layout),
	"der Zoom-Control wird am Finger AUSGEBLENDET -- am Finger ist die Zwei-Finger-Geste die"
	+ " Zoomhilfe, und zwei 26px-Kacheln daneben kosten nur Kartenflaeche");
const bootstrap = withoutComments(read("js", "app", "bootstrap.js"));
assert.ok(/L\.control\.zoom\(/.test(bootstrap),
	"...aber er wird weiterhin ANGELEGT. Nicht bei addTo weglassen: die Platzierungsregel"
	+ " `.avesmaps-infopanel-mode .leaflet-control-zoom` in infopanel.css stuende sonst als tote"
	+ " Zusicherung da, und map-corner-actions.test.js prueft sie.");

assert.ok(/id="map-search-button"/.test(indexHtml), "der Suchknopf steht im Markup");
const bundIdx = indexHtml.indexOf('id="map-corner-actions"');
const suchIdx = indexHtml.indexOf('id="map-search-button"');
assert.ok(bundIdx > -1 && suchIdx > -1 && suchIdx < bundIdx,
	"und VOR dem Knopfbund -- er sitzt UEBER ihm, nicht darin: die Ecke traegt damit eine"
	+ " Rangfolge, eine Handlung (gefuellt) neben zwei Verweisen (weich)");
assert.ok(/openSpotlightSearch\s*\(/.test(bootstrap),
	"der Knopf ruft die VORHANDENE Suche -- ein zweites Suchfeld waere eine zweite Trefferlogik");

// ---- Das Suchfenster sitzt am Finger unten, und die Tastatur verdeckt es nicht --------------------
const spotlightCss = withoutComments(read("css", "components", "spotlight-search.css"));
assert.ok(/@media\s*\(pointer:\s*coarse\)[\s\S]*?align-items:\s*flex-end/.test(spotlightCss),
	"am Finger ist das Suchfenster unten verankert -- dort war der Knopf, dort ist der Daumen");
assert.ok(/order:\s*\d/.test(spotlightCss),
	"die Treffer wachsen per `order` nach oben, nicht per flex-direction: column-reverse"
	+ " -- die Umkehrung erwischte auch die versteckte Ueberschrift und die Statuszeile");
const spotlightJs = withoutComments(read("js", "ui", "spotlight-search.js"));
assert.ok(/visualViewport/.test(spotlightJs),
	"das Feld haengt an der SICHThoehe (visualViewport): iOS schrumpft den Layout-Viewport bei"
	+ " offener Tastatur NICHT, 100dvh zeigt weiter auf den Bildschirmrand und das Feld"
	+ " verschwindet dahinter");

// ---- Kein Token-Wert steht doppelt ----------------------------------------------------------------
//
// 21x `8px` und 5x `5px` schrieben den Wert von --radius-md bzw. --radius-sm von Hand ab. Die sehen
// richtig AUS und verstellen sich nie mit -- genau die Divergenz, vor der AGENTS.md §12 warnt.
// ⚠️ Nur DEKLARATIONEN, und Kommentare sind vorher heraus: css/components/editor-page.css
// BESCHREIBT einen 6px-Sonderfall in Prosa und nennt dabei beide Tokenwerte. Die erste Zaehlung
// beim Bauen ist genau darauf hereingefallen.
const FRONTEND_CSS_DIRS = [["css", "features"], ["css", "components"], ["css", "layout"], ["css", "base"]];
const doppelt = [];
FRONTEND_CSS_DIRS.forEach((dir) => {
	const abs = path.join(ROOT, ...dir);
	fs.readdirSync(abs).filter((f) => f.endsWith(".css")).forEach((file) => {
		const css = withoutComments(fs.readFileSync(path.join(abs, file), "utf8"));
		const treffer = css.match(/border-radius:\s*(?:8px|5px)\s*;/g) || [];
		if (treffer.length) {
			doppelt.push(`${dir.join("/")}/${file}: ${treffer.length}x`);
		}
	});
});
assert.deepStrictEqual(doppelt, [],
	"diese Dateien schreiben einen Tokenwert von Hand ab (8px = --radius-md, 5px = --radius-sm):\n  "
	+ doppelt.join("\n  "));

// ---- Die Knoepfe der Kartenecke tragen EINEN Abschluss ---------------------------------------------
const legalCss = withoutComments(read("css", "components", "legal-dialog.css"));
const eckRegel = legalCss.match(/#legal-button,\s*\r?\n?#news-button\s*\{([^}]*)\}/);
assert.ok(eckRegel, "die Eckknoepfe teilen sich eine Regel");
assert.ok(/border-radius:\s*var\(--radius-md\)/.test(eckRegel[1]),
	"und tragen --radius-md, wie AGENTS.md §12 es fuer Knoepfe vorschreibt (sie trugen --radius-sm)."
	+ " Die Panel-HUELLE bleibt bei -sm: der Unterschied Panel<->Knopf ist gewollt, Knopf<->Knopf nie.");
assert.ok(/\.leaflet-control-zoom[^{]*\{[^}]*border-radius/.test(layout),
	"der Zoom-Abschluss wird in map-layout.css ueberschrieben -- css/third-party/leaflet.css wird"
	+ " im Haus nie bearbeitet, und die Zoom-FARBEN liegen aus demselben Grund schon dort");

console.log("touch-scale tests passed");

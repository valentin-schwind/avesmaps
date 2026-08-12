// Das Anzeige-Menue (Auge) in der Kartenecke: der Knopf ueber dem Suchknopf und das Klappmenue,
// in dem Ortsklassen und Kartenebenen einzeln ein- und ausgeblendet werden.
// Entwurf: docs/superpowers/specs/2026-08-12-anzeige-menue-design.md
//
// Geprueft wird, was beim naechsten Anfassen LAUTLOS kippt -- nicht, dass die Datei existiert.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis:
//   node js/app/__tests__/map-display-menu.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

const indexHtml = read("index.html");
const legalCss = read("css", "components", "legal-dialog.css");

/** 💣 In diesen Dateien erklaert die Prosa genau das, wonach gesucht wird -- ein Treffer im
 *  Kommentar ist deshalb kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen,
 *  der nichts haelt. */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

// ---- Der Knopf steht im Bund, und zwar UEBER dem Suchknopf ---------------------------------------
//
// 💣 Faengt: jemand haengt ihn unten an den Bund. Die DOM-Reihenfolge im Bund IST die Anzeige --
// er ist eine Spalte, und der Owner hat den Platz ueber dem Suchknopf ausdruecklich benannt.
const bund = indexHtml.match(/<div id="map-corner-actions">([\s\S]*?)\r?\n\t\t<\/div>/);
assert.ok(bund, "index.html traegt den Bund #map-corner-actions");
const displayAt = bund[1].indexOf('id="map-display-button"');
const searchAt = bund[1].indexOf('id="map-search-button"');
assert.ok(displayAt > -1, "der Anzeige-Knopf steht im Bund");
assert.ok(searchAt > -1, "der Suchknopf steht im Bund");
assert.ok(displayAt < searchAt, "und der Anzeige-Knopf VOR ihm -- oben in der Spalte");

// ---- Er traegt die GEMEINSAME Eckknopf-Regel, in BEIDEN Listen ------------------------------------
//
// 💣 Faengt: genau den Fehler, den die Ansichts-Kachel schon hatte. Sie stand seit dem 11.08.2026
// in der Grundregel (Farbe, Kontur, Radius), aber nicht in der Hover-Regel -- und blieb als
// einziger der Eckknoepfe unter dem Zeiger stumm. Wer den einen Selektor ergaenzt, ergaenzt beide.
const legalCssOhneProsa = withoutComments(legalCss);
const grundregel = legalCssOhneProsa.match(/#map-search-button,[^{]*\{/);
assert.ok(grundregel, "die gemeinsame Eckknopf-Grundregel existiert");
assert.ok(/#map-display-button\b/.test(grundregel[0]),
	"der Anzeige-Knopf steht in der Grundregel (Farbe, Kontur, Radius, Schatten)");
const hoverRegel = legalCssOhneProsa.match(/#map-search-button:hover,[^{]*\{/);
assert.ok(hoverRegel, "die gemeinsame Hover-/Fokus-Regel existiert");
assert.ok(/#map-display-button:hover/.test(hoverRegel[0]),
	"und der Anzeige-Knopf auch in der Hover-/Fokus-Regel");

// ---- Die Menuehuelle -----------------------------------------------------------------------------
const menue = indexHtml.match(/<div id="map-display-menu"[\s\S]*?\r?\n\t\t\t<\/div>/);
assert.ok(menue, "die Menuehuelle #map-display-menu steht in index.html");
assert.ok(/\shidden(\s|>)/.test(menue[0].slice(0, menue[0].indexOf(">") + 1)),
	"und startet zugeklappt");

// ---- Die sechs Ortsklassen sind UMGEZOGEN, nicht kopiert ------------------------------------------
//
// 💣 Faengt: jemand baut sie im Menue nach und laesst die alten im Routenplaner stehen. Dann gibt
// es zwoelf Knoepfe fuer sechs Zustaende, die Zifferntasten treffen die falschen, und zwei
// Bedienelemente streiten sich um denselben Zustand. Der Entwurf §6 haengt an dieser einen Zahl.
const alleToggles = indexHtml.match(/class="location-toggle"/g) || [];
assert.strictEqual(alleToggles.length, 6,
	"es gibt GENAU sechs .location-toggle im ganzen Dokument (umgezogen, nicht kopiert)");
assert.strictEqual((menue[0].match(/class="location-toggle"/g) || []).length, 6,
	"und alle sechs stehen im Anzeige-Menue");

// 💣 Faengt: die Reihenfolge wird beim Umzug vertauscht. js/app/keyboard-shortcuts.js:290 nimmt
// document.querySelectorAll(".location-toggle") und trifft mit den Ziffern 1..6 die n-te in
// DOM-Reihenfolge -- bewusst, weil gezaehlt wird, was der Besucher sieht. Ein Tausch legt damit
// stumm die Tastenbelegung um und sieht im Quelltext harmlos aus.
const reihenfolge = [...menue[0].matchAll(/data-location-type="([a-z]+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(reihenfolge,
	["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"],
	"in unveraenderter Reihenfolge -- die Zifferntasten zaehlen sie");

// ---- Die Derographie-Zeile bleibt, wo sie ist -----------------------------------------------------
//
// 🔴 Faengt: jemand raeumt .display-options ganz weg, weil sie leer aussieht. Das <select> IST der
// Zustand der Ansicht (getSelectedMapLayerMode, geteilter Link), und js/ui/map-layer-picker.js
// versteckt seine Zeile ueber select.closest(".display-options__select-row"). Ohne den Vorfahren
// laeuft das ins Leere -- und ?layerPanelActive=0, der Notausgang der Ansichts-Kachel, haette
// nichts mehr zurueckzuholen.
assert.ok(/<div class="display-options">/.test(indexHtml),
	".display-options bleibt als Huelle stehen");
const derographieZeile = indexHtml.match(/<label class="display-options__row display-options__select-row"[\s\S]*?<\/label>/);
assert.ok(derographieZeile, "die Derographie-Zeile traegt weiter ihre Klasse display-options__select-row");
assert.ok(/id="mapLayerModeSelect"/.test(derographieZeile[0]),
	"und darin steht das <select>, das den Zustand der Ansicht haelt");

// ---- Das Besucher-Tracking zeigt auf den NEUEN Ort ------------------------------------------------
//
// 💣 Faengt: Falle 1 des Bauplans. js/app/visitor-tracking.js delegiert von .display-options aus
// auf `input[type=checkbox]` und `.location-toggle`. Ziehen die Schalter aus diesem Container
// heraus, hoert das Tracking LAUTLOS auf -- kein Fehler, keine Meldung, nur eine Statistik, die ab
// einem Tag nichts mehr zaehlt.
const tracking = withoutComments(read("js", "app", "visitor-tracking.js"));
assert.ok(/#map-display-menu/.test(tracking),
	"visitor-tracking.js delegiert auch vom Anzeige-Menue aus (sonst zaehlt es lautlos nichts mehr)");
// ⚠️ Und NICHT vom ganzen Dokument: `input[type=checkbox]` traefe dann auch #allowLand, #allowRiver
// und jede andere Checkbox der Seite -- aus einer Anzeige-Statistik wuerde eine Klick-Statistik.
assert.ok(!/jq\(document\)\.on\("change", "input\[type=checkbox\]"/.test(tracking),
	"aber nicht vom ganzen Dokument aus");

// ---- Das Menue haengt im Fluss und misst den Bund nach --------------------------------------------
//
// 💣 Faengt: das Menue wird schwebend gebaut. Beim Ansichts-Menue legte sich genau das ueber die
// Zoom-Knoepfe, die schlicht dahinter verschwanden (Owner 11.08.2026). Im Fluss waechst der Bund,
// und der Zoom darueber liest dessen GEMESSENE Hoehe.
const menueJs = withoutComments(read("js", "ui", "map-display-menu.js"));
assert.ok(/syncMapCornerStack/.test(menueJs),
	"map-display-menu.js misst den Knopfbund nach jedem Auf- und Zuklappen nach");
const menueCss = withoutComments(read("css", "components", "map-display-menu.css"));
assert.ok(!/position:\s*(absolute|fixed)/.test(menueCss),
	"und das Menue steht im Fluss, nicht schwebend");

// 💣 Faengt: der Zustand des Menues haengt wieder an `hidden` oder an der Klasse `is-open`.
// Beides ist WAHR, aber zu spaet: `hidden` springt erst nach der 120-ms-Blende um, `is-open` erst
// im naechsten Bild (sonst laeuft die Blende nicht). Wer in dieser Spanne ein zweites Mal klickt --
// bei einem Auf-/Zuklapp-Knopf der Normalfall -- bekaeme das Gegenteil dessen, was er will.
// Gemessen am 12.08.2026: Klick 2 schloss, Klick 3 oeffnete nicht mehr.
const offenFn = menueJs.match(/function offen\(\)\s*\{[^}]*\}/);
assert.ok(offenFn, "map-display-menu.js hat eine offen()-Abfrage");
assert.ok(!/hidden|classList/.test(offenFn[0]),
	"und sie liest weder `hidden` noch eine Klasse -- der Zustand ist eine eigene Variable");

// 💣 Faengt: jemand ergaenzt stopPropagation am Knopf-Handler, weil die Nachbardatei es auch tut.
// Genau dieser Klick MUSS das Dokument erreichen -- dort haengt der Zuhoerer, der das
// Ansichts-Menue zuklappt. Ohne ihn stehen beide Menuees offen uebereinander und schieben den
// halben Bund aus dem Bild.
const knopfHandler = menueJs.match(/knopf\.addEventListener\("click"[\s\S]*?\n\t\t\}\);/);
assert.ok(knopfHandler, "der Knopf-Handler existiert");
assert.ok(!/stopPropagation/.test(knopfHandler[0]),
	"und stoppt die Ausbreitung NICHT -- der Klick muss das Dokument erreichen");

// 💣 Faengt: der Aussenklick-Zuhoerer wird von Capture auf Bubbling umgestellt. Der Ansichts-Knopf
// ruft in seinem Handler stopPropagation; ein Bubbling-Zuhoerer am Dokument saehe dessen Klick nie,
// und dieses Menue bliebe offen, waehrend daneben das zweite aufgeht.
assert.ok(/document\.addEventListener\("click",[\s\S]*?\}, true\);/.test(menueJs),
	"der Aussenklick-Zuhoerer laeuft in der CAPTURE-Phase (das `true` am Ende)");

// 💣 Faengt: der Deckel fehlt. Im Editor ist der Menue-Inhalt ueber 650px hoch -- ohne max-height
// schoebe er Suchknopf, Ansichts-Kachel und beide Verweise aus dem Bild.
assert.ok(/max-height:\s*min\(/.test(menueCss),
	"das Menue hat einen Deckel (max-height), relativ zur Schirmhoehe");
assert.ok(/overflow-y:\s*auto/.test(menueCss), "und scrollt darin selbst");

// ---- Kein hartkodierter Farbwert ------------------------------------------------------------------
//
// 💣 Faengt: AGENTS.md §12. Ein Literal hier ist die Divergenz, die Infobox und Routenplaner
// auseinandergetrieben hat.
const literale = menueCss.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [];
assert.deepStrictEqual(literale, [],
	"map-display-menu.css enthaelt keinen hartkodierten Farbwert (alles aus tokens.css)");

// ---- Das Stylesheet ist auch verlinkt --------------------------------------------------------------
//
// 💣 Faengt: die Datei existiert, wird aber nie geladen -- ein unsichtbares Menue, das im Quelltext
// vollstaendig aussieht.
assert.ok(/@import url\("components\/map-display-menu\.css"\)/.test(read("css", "styles.css")),
	"css/styles.css importiert das neue Stylesheet");
assert.ok(/<script src="js\/ui\/map-display-menu\.js"/.test(indexHtml),
	"index.html laedt js/ui/map-display-menu.js");

console.log("map-display-menu.test.js: alles gruen");

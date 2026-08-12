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
// ⚠️ Geprueft wird die HUELLE, nicht die Datei: ein `position: absolute` weiter unten ist legitim
// (die Zustands-Checkbox wird so aus dem Bild genommen, ohne ihre Semantik zu verlieren).
const huelleRegel = menueCss.match(/\n\.map-display-menu \{[^}]*\}/);
assert.ok(huelleRegel, "die Regel .map-display-menu existiert");
assert.ok(!/position:\s*(absolute|fixed)/.test(huelleRegel[0]),
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

// ---- Die vier Ebenen sind umgezogen und wirken im Frontend ----------------------------------------
//
// 💣 Faengt: eine Zeile wird im Menue NACHGEBAUT statt umgezogen. Dann gibt es die Checkbox
// zweimal, und welcher Zustand gilt, haengt davon ab, welche zuletzt angefasst wurde -- die
// URL-Persistenz und `$("#togglePaths").is(":checked")` treffen die falsche.
["togglePaths", "toggleMapLabels", "toggleTerritoryBorders", "toggleRivers"].forEach((id) => {
	const treffer = indexHtml.match(new RegExp(`id="${id}"`, "g")) || [];
	assert.strictEqual(treffer.length, 1, `#${id} steht GENAU einmal im Dokument`);
	assert.ok(menue[0].includes(`id="${id}"`), `#${id} steht im Anzeige-Menue`);
});

// 💣 Faengt: aus dem <label> wird ein <div> mit eigenem Knopf. Das Auge ist DARSTELLUNG, die
// Checkbox ist der Zustand -- umschliesst das Label beide, kommen Klickflaeche, Tastatur,
// Fokusreihenfolge und Vorlesbarkeit vom Browser. Ein nachgebauter Knopf muesste alles vier
// selbst mitbringen und haette es beim ersten Mal halb.
const ebenenGruppe = indexHtml.match(/<div class="map-display-menu__group" id="display-group-layers">[\s\S]*?\r?\n\t\t\t\t<\/div>/);
assert.ok(ebenenGruppe, "die Gruppe Ebenen steht im Menue");
assert.strictEqual((ebenenGruppe[0].match(/<label class="map-display-menu__row"/g) || []).length, 5,
	"und traegt fuenf Zeilen, jede ein <label> (vier oeffentliche + Seewege fuer Editoren)");
assert.ok(!/<button/.test(ebenenGruppe[0]),
	"ohne eigenen Knopf -- das Label schaltet die Checkbox nativ");

// 💣 Faengt: der Zustand wird per `display: none` verborgen. Dann ist die Checkbox nicht mehr
// fokussierbar, und die Zeile ist mit der Tastatur unerreichbar -- unsichtbar sein und
// unbedienbar sein sind zwei verschiedene Dinge.
const stateRegel = menueCss.match(/\.map-display-menu__state \{[^}]*\}/);
assert.ok(stateRegel, "die Zustands-Checkbox hat eine eigene Regel");
assert.ok(!/display:\s*none/.test(stateRegel[0]) && !/visibility:\s*hidden/.test(stateRegel[0]),
	"und wird nicht per display/visibility entfernt -- sie muss fokussierbar bleiben");

// 💣 Faengt: das Auge folgt nicht mehr der Checkbox, sondern einem zweiten Zustand in JavaScript.
// Genau dann laufen Anzeige und Wirkung auseinander, sobald der Zustand von woanders kommt --
// Moduswechsel, geteilter Link, Tastenkuerzel.
assert.ok(/\.map-display-menu__state:checked/.test(menueCss),
	"das Auge folgt der Checkbox per :checked, nicht einem eigenen Zustand");

// ---- Die zwei Overrides gelten jetzt auch im Frontend ---------------------------------------------
//
// 💣 Faengt: der Umbau bleibt auf halbem Weg stehen. Die Haken waeren sichtbar, aenderten
// ausserhalb des Bearbeiten-Modus aber nichts -- ein Schalter, der luegt.
const labelsJs = withoutComments(read("js", "map-features", "map-features-labels.js"));
const labelOverride = labelsJs.match(/function isMapLabelEditorOverrideActive\(\)[\s\S]*?\n\}/);
assert.ok(labelOverride, "isMapLabelEditorOverrideActive existiert");
assert.ok(!/IS_EDIT_MODE/.test(labelOverride[0]),
	"und haengt den Labels-Haken nicht mehr am Bearbeiten-Modus auf");

const boundaryJs = withoutComments(read("js", "map-features", "map-features-boundary-canvas-overlay.js"));
const boundaryOverride = boundaryJs.match(/const editorOverride = [^;]*;/);
assert.ok(boundaryOverride, "der Grenzen-Haken wird gelesen");
assert.ok(!/IS_EDIT_MODE/.test(boundaryOverride[0]),
	"und ebenfalls ohne Vorbehalt auf den Bearbeiten-Modus");

// 💣 Faengt: §9 des Entwurfs kippt („die Ansicht gewinnt"). Ohne diese Aenderung bliebe ein
// umgelegter Labels-/Grenzen-Haken ueber den Ansichtswechsel stehen, waehrend Wege und Fluesse
// zurueckspringen -- zwei Schalter im selben Menue mit zwei verschiedenen Regeln.
const displayModeJs = withoutComments(read("js", "map-features", "map-features-display-mode.js"));
const syncFn = displayModeJs.match(/function syncEditorDisplayTogglesToMode\(mode\)[\s\S]*?\n\}/);
assert.ok(syncFn, "syncEditorDisplayTogglesToMode existiert");
assert.ok(!/IS_EDIT_MODE/.test(syncFn[0]),
	"und setzt die beiden Haken auch im Frontend beim Moduswechsel");

// ---- Die Breite haengt am Routenplaner, nicht an einer zweiten Zahl --------------------------------
//
// 💣 Faengt: jemand schreibt die 350 hier noch einmal hin. Zwei Zahlen, die dasselbe meinen, laufen
// beim ersten Anfassen auseinander -- genau der Fall aus AGENTS.md §12, und derselbe, der
// --avesmaps-edge-gap seinen Kommentar eingebracht hat (12 gegen 14, sichtbar 2px versetzt).
assert.ok(/width:\s*var\(--avesmaps-planner-width\)/.test(menueCss),
	"das Menue misst sich am Token --avesmaps-planner-width, nicht an einer eigenen Zahl");
const layoutCss = withoutComments(read("css", "layout", "map-layout.css"));
assert.ok(/width:\s*var\(--avesmaps-planner-width\)/.test(layoutCss),
	"und der Routenplaner selbst benutzt dasselbe Token");
assert.ok(/--avesmaps-planner-width:\s*\d/.test(read("css", "base", "tokens.css")),
	"das Token ist in tokens.css definiert");

// 💣 Faengt: die Telefon-Breite faellt weg. Owner 12.08.2026: am Telefon die Breite des Schirms.
assert.ok(/@media \(max-width: 560px\)[\s\S]*?width:\s*calc\(100vw/.test(menueCss),
	"am Telefon nimmt das Menue die Schirmbreite");

// ---- Die leere Huelle im Routenplaner faellt weg ---------------------------------------------------
//
// 💣 Faengt: die Regel verschwindet, und im Frontend steht wieder ein leerer Streifen mit ZWEI
// Trennlinien zwischen Kopf und Wegpunkten (gemeldet vom Owner am 12.08.2026, nachdem die
// Schalter ausgezogen waren).
const plannerCss = withoutComments(read("css", "features", "route-planner.css"));
assert.ok(/\.display-options:not\(:has\(> :not\(\[hidden\]\)\)\)\s*\{\s*display:\s*none/.test(plannerCss),
	".display-options faellt weg, solange kein direktes Kind sichtbar ist");

// 💣 Faengt: jemand setzt wieder ein sichtbares Element in .display-options. Die Regel oben greift
// nur, solange KEIN direktes Kind sichtbar ist -- ein einziges genuegt, und der leere Streifen ist
// zurueck. Die Derographie-Zeile ist die eine erlaubte Ausnahme, und die traegt ihr `hidden` von
// js/ui/map-layer-picker.js.
// (Der Vollstaendigkeits-Test dazu steht weiter unten bei den Editor-Gruppen.)

// ---- Der Riegel: was eine Ansicht ohnehin sperrt, ist ausgegraut ----------------------------------
//
// 💣 Faengt: die Tabelle wird zur if-Kette, oder ein Modus fehlt darin. Genau dieser Fehler liess
// FRONTEND_LAYER_MODE_DEFAULTS bis 2026-08-05 zwei Ansichten die Lage ihres VORGAENGERS erben --
// dieselbe Ansicht sah verschieden aus, je nachdem woher man kam. Alle sechs muessen dastehen,
// auch die mit leerem Eintrag: „hier ist nichts gesperrt" ist eine Aussage, kein Weglassen.
const gesperrtTabelle = menueJs.match(/var GESPERRT = \{[\s\S]*?\n\t\};/);
assert.ok(gesperrtTabelle, "map-display-menu.js traegt die Tabelle GESPERRT");
["none", "original", "deregraphic", "political", "powerlines", "ecosystem"].forEach((modus) => {
	assert.ok(new RegExp(`\\b${modus}\\s*:`).test(gesperrtTabelle[0]),
		`und darin einen Eintrag fuer die Ansicht "${modus}"`);
});

// 💣 Faengt: die Grenzen-Sperre wird vergessen. In diesen drei Ansichten laedt
// map-features-political-territory-loader.js (TERRITORY_BOUNDARY_MODES) gar keine
// Territoriumsdaten -- der Haken haette nichts zum Zeichnen und taete sichtbar nichts.
["none", "original", "powerlines"].forEach((modus) => {
	const eintrag = gesperrtTabelle[0].match(new RegExp(`${modus}\\s*:\\s*\\{[^}]*\\}`));
	assert.ok(eintrag && /toggleTerritoryBorders/.test(eintrag[0]),
		`"${modus}" sperrt den Grenzen-Haken (dort sind keine Territorien geladen)`);
});

// 💣 Faengt: die Kraftlinien-Sperre wird vergessen. shouldShowPathOnMap steigt fuer "powerlines"
// VOR jeder Haken-Pruefung aus, shouldShowLocationMarker zeigt dort nur Nodices -- vier Schalter,
// die sich umlegen liessen und sichtbar nichts taeten.
const powerlinesEintrag = gesperrtTabelle[0].match(/powerlines\s*:\s*\{[^}]*\}/);
assert.ok(powerlinesEintrag, "der Eintrag fuer powerlines existiert");
// ⚠️ toggleSeaPaths gehoert dazu -- Seewege sind Pfade, und shouldShowPathOnMap steigt fuer
// "powerlines" VOR der Unterscheidung nach Wegart aus. Sie fehlten zunaechst, weil sie erst mit
// dem Editor-Teil ins Menue kamen: genau die Luecke, gegen die eine vollstaendige Tabelle steht.
["togglePaths", "toggleRivers", "toggleSeaPaths", "toggleTerritoryBorders"].forEach((id) => {
	assert.ok(powerlinesEintrag[0].includes(id), `powerlines sperrt #${id}`);
});
assert.ok(/orte|places/.test(powerlinesEintrag[0]), "und die Ortsklassen");

// 💣 Faengt: der Riegel wird EINMAL beim Aufbau gesetzt und friert ein. Ab dem naechsten
// Ansichtswechsel waere er gelogen -- genau der Fehler, den die Transport-Combobox schon hatte.
// Ein Moduswechsel feuert KEIN Ereignis (setSelectedMapLayerMode setzt den Wert per jQuery .val(),
// und das feuert nichts); beobachtet wird deshalb die Beschriftung, die bei jedem Wechsel neu
// geschrieben wird -- derselbe Weg wie in js/ui/map-layer-picker.js.
assert.ok(/mapLayerModeLabel/.test(menueJs),
	"der Riegel haengt an der Beschriftung der Auswahlbox, die sich bei JEDEM Wechsel aendert");
assert.ok(/MutationObserver/.test(menueJs),
	"und wird ueber einen MutationObserver nachgezogen, nicht einmalig gesetzt");

// 💣 Faengt: gesperrt wird nur optisch. Ein ausgegrauter, aber klickbarer Schalter ist schlimmer
// als ein normaler -- er sieht kaputt aus UND tut nichts.
assert.ok(/\.disabled = /.test(menueJs) || /disabled",\s*(true|false)/.test(menueJs),
	"die Sperre setzt `disabled`, nicht nur eine Klasse");

// ---- Der Editor-Teil: eigene Gruppen, die als GANZES mitverstecken --------------------------------
//
// 💣 Faengt: die Haken sind versteckt, ihre Gruppe nicht. Dann stuende im Frontend eine goldene
// Ueberschrift ueber einer Trennlinie ueber nichts. Fuer „Pruefen" war das frueher geloest (die
// Ueberschrift hing am Bearbeiten-Modus, nicht an den Haken darin) -- die zwei neuen Gruppen
// brauchen dieselbe Behandlung.
["display-group-checks", "display-group-mapstyle"].forEach((id) => {
	const huelle = indexHtml.match(new RegExp(`<div class="map-display-menu__group" id="${id}"[^>]*>`));
	assert.ok(huelle, `die Gruppe #${id} steht im Menue`);
	assert.ok(/\shidden(\s|>)/.test(huelle[0]), `und startet versteckt (nur Editoren)`);
	assert.ok(menue[0].includes(`id="${id}"`), `und liegt innerhalb von #map-display-menu`);
});

// 💣 Faengt: „Seewege" bekommt eine EIGENE Gruppe. Es ist eine Kartenebene wie die vier darueber
// und gehoert in dieselbe Gruppe -- eine Gruppe „Seewege" mit einer einzigen Zeile „Seewege" waere
// eine Ueberschrift, die ihren Inhalt wiederholt. Nur die ZEILE ist versteckt, nicht die Gruppe.
const seewegeZeile = indexHtml.match(/<label class="map-display-menu__row" id="toggleSeaPathsControl"[^>]*>/);
assert.ok(seewegeZeile, "die Seewege-Zeile ist eine gewoehnliche Ebenen-Zeile");
assert.ok(/\shidden(\s|>)/.test(seewegeZeile[0]), "und startet versteckt (nur Editoren)");
assert.ok(ebenenGruppe[0].includes('id="toggleSeaPathsControl"'),
	"und steht in der Gruppe Ebenen, nicht in einer eigenen");

// 💣 Faengt: der Bearbeiten-Modus deckt die Haken auf, aber nicht ihre Gruppe -- dann blieben sie
// unsichtbar, denn ein versteckter Vorfahr gewinnt. Genau dieser Fall hat schon einmal Zeit
// gekostet (#displayOptionsToggleRow, 12.08.2026).
const bootstrapJs = withoutComments(read("js", "app", "bootstrap.js"));
const mapFeaturesJs = withoutComments(read("js", "map-features", "map-features.js"));
["display-group-checks", "display-group-mapstyle"].forEach((id) => {
	assert.ok(bootstrapJs.includes(id) || mapFeaturesJs.includes(id),
		`der Bearbeiten-Modus deckt die Gruppe #${id} auf`);
});
assert.ok(mapFeaturesJs.includes("#toggleSeaPathsControl"),
	"und die Seewege-ZEILE (ihre Gruppe ist auch im Frontend sichtbar)");

// 💣 Faengt: der Mapstil wandert mit und behaelt seine .display-options__*-Klassen. Er stuende
// dann nicht mehr in den Anzeigeoptionen, truege aber weiter deren Regeln -- ein Bauteil, das
// aussieht wie ein Gast im falschen Haus, und ein Selektor, den niemand mehr findet.
const mapstyle = indexHtml.match(/<label id="mapStyleControl"[^>]*>/);
assert.ok(mapstyle, "#mapStyleControl existiert");
assert.ok(!/display-options__/.test(mapstyle[0]),
	"und hat seine display-options-Klassen beim Umzug abgelegt");

// 💣 Faengt: .display-options behaelt einen sichtbaren Rest und der leere Streifen im Routenplaner
// ist zurueck. Nach dem Umzug ALLER Schalter darf dort nur noch die Derographie-Zeile stehen.
const huelleInhalt = indexHtml.match(/<div class="display-options">([\s\S]*?)\r?\n\t\t\t<\/div>/);
assert.ok(huelleInhalt, ".display-options existiert");
// Was dort NICHT mehr stehen darf -- jedes einzelne haelt die Huelle offen und bringt den leeren
// Streifen zwischen Kopf und Wegpunkten zurueck.
["togglePaths", "toggleRivers", "toggleSeaPaths", "toggleMapLabels", "toggleTerritoryBorders",
 "toggleCrossings", "toggleNodix", "toggleUnconnected", "toggleLabelsWithRegion",
 "toggleSparseCrossings", "mapStyleSelect", "location-toggle"].forEach((was) => {
	assert.ok(!huelleInhalt[1].includes(was),
		`"${was}" ist aus .display-options ausgezogen`);
});
// Und was dort bleiben MUSS.
assert.ok(huelleInhalt[1].includes('id="mapLayerModeSelect"'),
	"die Derographie-Auswahlbox bleibt -- sie IST der Zustand der Ansicht");

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

// Die Panel-Zeilenform der WikiSync-Listen steht genau EINMAL.
//
// 🔴 DIESER TEST EXISTIERT, WEIL DIE REZEPTUR ZWEIMAL GESCHRIEBEN WAR. `.wikisync-itemlist
// .tree-item` (css/components/region-sync.css) und `#wiki-sync-territory-tree .tree-item`
// (css/pages/political-territory-wiki-tree.css) setzten beide dasselbe Raster, dieselbe
// Polsterung, denselben Zeilenabstand und denselben Statuskreis samt seiner Fuellvarianten --
// in zwei Dateien, zweimal gepflegt. Der Kommentar ueber der einen sagte woertlich, sie
// uebernehme "1:1 die Struktur" der anderen. Genau daraus wuchs die Divergenz, die der Owner
// am 14.08.2026 gemeldet hat ("diese listen sind im design sehr unterschiedlich").
//
// Ohne diesen Test waechst sie nach: die naechste Aenderung fasst wieder nur eine der beiden
// an, und niemand sieht es, weil beide Listen fuer sich genommen richtig aussehen. Erst
// nebeneinander faellt es auf -- und dazu muss man zwei Reiter umschalten.
//
// 💣 Die Ladereihenfolge rettet nicht: "#wiki-sync-territory-tree .tree-item" hat Spezifitaet
// (1,1,0) gegen (0,2,0). Die ID gewinnt, egal welche Datei spaeter kommt. Beide Selektoren
// muessen deshalb an DERSELBEN Regel stehen.
//
// Entwurf: docs/superpowers/specs/2026-08-14-wikisync-listen-vereinheitlichung-design.md §2
//
// Run: node js/review/__tests__/wikisync-list-form.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");

const regionSync = lies("css", "components", "region-sync.css");
const wikiTree = lies("css", "pages", "political-territory-wiki-tree.css");

let checks = 0;

// ---- 1. Der Territorien-Block ist fort ---------------------------------------------------------
assert.ok(!/#wiki-sync-territory-tree\s+\.tree-item\s*\{/.test(wikiTree),
	'political-territory-wiki-tree.css definiert wieder eine eigene "#wiki-sync-territory-tree '
	+ '.tree-item"-Regel. Die Panel-Zeilenform gehoert NUR nach css/components/region-sync.css.');
checks++;

// ---- 2. Die Basisregel bleibt -- sie gehoert einer ANDEREN Oberflaeche -------------------------
// ⚠️ ".tree-item" ohne ID davor ist display:inline-flex mit cursor:grab und traegt den Baum im
// Territorien-EDITOR, nicht im Panel. Wer beim Aufraeumen zu viel loescht, zerlegt den.
assert.ok(/(^|\r?\n)\.tree-item\s*\{/.test(wikiTree),
	'Die Basisregel ".tree-item" fehlt in political-territory-wiki-tree.css. Sie traegt den Baum '
	+ 'im Territorien-Editor (inline-flex, cursor:grab) und darf NICHT mit entfernt werden -- sie '
	+ 'hat mit der Panel-Liste nichts zu tun.');
checks++;

// ---- 3. Die gemeinsame Regel nennt beide Selektoren --------------------------------------------
const gemeinsam = regionSync.match(
	/\.wikisync-itemlist \.tree-item,\s*\r?\n#wiki-sync-territory-tree \.tree-item\s*\{([\s\S]*?)\r?\n\}/);
assert.ok(gemeinsam,
	"In region-sync.css fehlt die gemeinsame Regel. Erwartet werden BEIDE Selektoren an DERSELBEN "
	+ "Regel:\n  .wikisync-itemlist .tree-item,\n  #wiki-sync-territory-tree .tree-item { ... }\n"
	+ "Zwei getrennte Regeln reichen nicht -- die ID hat Spezifitaet (1,1,0) gegen (0,2,0) und "
	+ "gewinnt unabhaengig von der Ladereihenfolge.");
checks++;

const rumpf = gemeinsam[1];

// ---- 4. Territorien traegt jetzt volle Breite ---------------------------------------------------
// Die Zeile stand auf inline-grid + width:max-content: die Ueberfahrt war nur so breit wie der
// Text, und eine Trennlinie hatte sie gar nicht. Beides war Territorien-Sonderverhalten.
assert.ok(!/display:\s*inline-grid/.test(rumpf),
	'Die gemeinsame Zeile steht auf "inline-grid". Damit waere die Ueberfahrt nur so breit wie der '
	+ "Text -- das war Territorien-Sonderverhalten und faellt weg.");
checks++;

// ---- 5. Die Trennlinie liegt auf dem Trenn-Token ------------------------------------------------
// ⚠️ Sie stand auf --color-panel-muted. Das ist eine FLAECHENfarbe (#f1ece1 hell) und im hellen
// Thema als Linie fast unsichtbar. --color-divider ist laut tokens.css "section separator --
// same everywhere".
// ⚠️ Auf die WIRKUNG geprueft, nicht auf die Schreibweise: seit die drei <button>-Listen dieselbe
// Zeile tragen, steht dort "border: 0 solid var(--color-divider); border-bottom-width: 1px"
// statt der Kurzform -- ein Knopf bringt einen eigenen Rahmen mit, den ein blosses border-bottom
// stehen liesse. Ein Test, der die Kurzform verlangt, verbietet die richtige Loesung.
assert.ok(/border(-bottom)?:[^;]*var\(--color-divider\)/.test(rumpf),
	"Der gemeinsamen Zeile fehlt die Trennfarbe var(--color-divider). Eine Fuellfarbe wie "
	+ "--color-panel-muted als Linie zu benutzen ist genau der Griff, den AGENTS.md §12 verbietet.");
checks++;
assert.ok(/border-bottom-width:\s*1px/.test(rumpf) || /border-bottom:\s*1px/.test(rumpf),
	"Der gemeinsamen Zeile fehlt die 1px starke untere Kante.");
checks++;
// ⚠️ Kommentare zuerst raus -- der Rumpf ERKLAERT, dass --color-panel-muted hier stand, und ein
// naiver Test haelt die Erklaerung fuer den Verstoss. (Zum zweiten Mal in dieser Datei: dasselbe
// passierte bei Pruefung 11. In einem Projekt, das seine Regeln im Stylesheet begruendet, muss
// jeder CSS-Test die Kommentare entfernen, bevor er etwas verbietet.)
const rumpfOhneKommentare = rumpf.replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(!/--color-panel-muted/.test(rumpfOhneKommentare),
	"Die Zeile benutzt wieder --color-panel-muted, eine Flaechenfarbe, als Linie.");
checks++;

// ---- 6. Die Maße der kompakten Zeile -----------------------------------------------------------
// 💣 Der Zeilenabstand war 7px und ist BEWUSST auf 2px zurueckgedreht (Owner 14.08.2026:
// "ja die 7px umdrehen"). Der alte Kommentar in dieser Datei begruendete die 7px damit, sie seien
// "einheitlich wie Siedlungen" -- das galt, solange Siedlungen 7px hatte. Jetzt haben alle 2px,
// die Einheitlichkeit ist also gewahrt, nur enger. Gemessen 48,7px -> 42,0px je Zeile.
assert.ok(/row-gap:\s*2px/.test(rumpf),
	'Der gemeinsamen Zeile fehlt "row-gap: 2px" (war 7px). Daher kommt der groesste Teil der '
	+ "Hoehenersparnis -- nicht aus kleinerer Schrift.");
checks++;

assert.ok(/padding:\s*5px 8px/.test(rumpf),
	'Der gemeinsamen Zeile fehlt "padding: 5px 8px" (war 6px 8px).');
checks++;

// ---- 7. Die Schriftskala -- 11px ist die Untergrenze --------------------------------------------
function regel(name) {
	const m = regionSync.match(
		new RegExp("\\.wikisync-itemlist " + name + ",\\s*\\r?\\n#wiki-sync-territory-tree " + name + "\\s*\\{([\\s\\S]*?)\\r?\\n\\}"));
	assert.ok(m, `Die gemeinsame Regel fuer ".wikisync-itemlist ${name}" fehlt oder nennt nicht beide Selektoren.`);
	return m[1];
}

const nameRumpf = regel("\\.tree-item-name");
assert.ok(/font-size:\s*var\(--font-size-body\)/.test(nameRumpf),
	"Der Name muss auf var(--font-size-body) = 13px stehen. Vorher erbte er body{font-size:10pt} "
	+ "= 13,33px -- ein Wert, den die Skala in tokens.css gar nicht kennt.");
checks++;
assert.ok(/font-weight:\s*var\(--font-weight-bold\)/.test(nameRumpf),
	"Der Name muss sein Gewicht selbst setzen. Es kam bisher aus der Basisregel .tree-item in "
	+ "political-territory-wiki-tree.css -- also aus einer Regel, die dem Territorien-EDITOR gehoert. "
	+ "Eine Panel-Zeile darf nicht davon abhaengen, was eine fremde Oberflaeche vererbt.");
checks++;

const metaRumpf = regel("\\.tree-item-meta");
assert.ok(/font-size:\s*var\(--font-size-caption\)/.test(metaRumpf),
	"Die Meta-Zeile muss auf var(--font-size-caption) = 11px stehen. Vorher 0.78em = 10,4px, also "
	+ "UNTER der Untergrenze aus docs/design-language.md. Sie wird dabei GROESSER -- Kompaktheit "
	+ "kommt aus der Polsterung, nie aus dem Unterschreiten der Schriftgrenze.");
checks++;
assert.ok(/font-weight:\s*var\(--font-weight-bold\)/.test(metaRumpf),
	'Die Meta-Zeile stand auf "font-weight: 600". tokens.css sagt: "two weights only -- no 500 / '
	+ '600 / 800". Die geloeschte Territorien-Fassung benutzte bereits var(--font-weight-bold); die '
	+ "beiden Kopien waren sich hier nicht einmal einig.");
checks++;

assert.ok(!/font-size:\s*0\.78em/.test(regionSync),
	'In region-sync.css steht wieder "font-size: 0.78em" (= 10,4px), unter der 11px-Untergrenze.');
checks++;

// ---- 8. Die Ueberfahrt liegt auf ihrem eigenen Token --------------------------------------------
const hoverRumpf = regel("\\.tree-item:hover");
assert.ok(/background:\s*var\(--color-hover-wash\)/.test(hoverRumpf),
	"Die Ueberfahrt muss var(--color-hover-wash) sein -- tokens.css beschreibt das Token woertlich "
	+ 'als "row / option hover". Vorher --color-panel-soft, eine Flaechenfarbe.');
checks++;

// ---- 9. Der Statuskreis gehoert NUR den fuenf Karten-Subjekten ---------------------------------
// 🔴 Literatur, Karten und Vorkommen haben kein "liegt auf der Karte". Ein Kreis dort waere eine
// Behauptung ueber Daten, die es nicht gibt -- sein FEHLEN ist die Information.
// 💣 Die Regel darf deshalb nicht an ".tree-item" haengen: sobald die drei Listen dieselbe Zeile
// tragen, bekaemen sie den Kreis automatisch mit. Beim ersten Entwurf des Mockups ist genau das
// passiert, und gesehen hat es der Owner, nicht das Werkzeug.
assert.ok(/\.tree-item\.has-map-status \.tree-item-name::after/.test(regionSync),
	'Die Statuskreis-Regel haengt nicht an ".tree-item.has-map-status". An ".tree-item" allein '
	+ "bekommen Literatur, Karten und Vorkommen einen Kreis, den ihre Daten nicht hergeben.");
checks++;
assert.ok(!/(^|[^-\w.])\.tree-item \.tree-item-name::after/m.test(regionSync),
	"Es gibt noch eine Kreis-Regel ohne .has-map-status.");
checks++;

// ⚠️ Kraftlinien setzt als einziges Karten-Subjekt gar keinen .tree-map-status-Marker (0 Treffer in
// review-powerline-list.js) und traegt trotzdem einen -- immer leeren -- Kreis. Deshalb ist die
// Klasse ausdruecklich und nicht aus den Daten abgeleitet: ein datengetriebenes :has(.tree-map-status)
// haette Kraftlinien den Kreis lautlos weggenommen, und das waere eine sichtbare Aenderung, die
// niemand bestellt hat.
const setztKlasse = [
	["review-settlement-list.js", "js/review/review-settlement-list.js"],
	["review-region-sync.js", "js/review/review-region-sync.js"],
	["review-path-sync.js", "js/review/review-path-sync.js"],
	["review-powerline-list.js", "js/review/review-powerline-list.js"],
	["territory-wiki-tree.js", "js/territory/territory-wiki-tree.js"],
];
for (const [name, pfad] of setztKlasse) {
	assert.ok(/has-map-status/.test(lies(...pfad.split("/"))),
		`${name} setzt die Klasse "has-map-status" nicht mehr. Dann verliert dieses Subjekt seinen `
		+ "Statuskreis -- und zwar lautlos, weil eine fehlende Klasse nichts wirft.");
	checks++;
}

// ---- 10. Bauart B ist fort ----------------------------------------------------------------------
const reviewPanel = lies("css", "features", "review-panel.css");
assert.ok(!/\.wiki-sync-adv-picker__row\s*\{/.test(reviewPanel),
	".wiki-sync-adv-picker__row existiert noch. Literatur, Karten und Vorkommen sollen die "
	+ "gemeinsame Zeile tragen, nicht eine zweite Rezeptur mit eigenen Schriftgroessen.");
checks++;

const scrollRegel = reviewPanel.match(/\.wiki-sync-adv-picker__scroll\s*\{([\s\S]*?)\}/);
assert.ok(scrollRegel, ".wiki-sync-adv-picker__scroll fehlt -- der Scroll-Behaelter wird noch gebraucht.");
assert.ok(!/border:\s*1px solid/.test(scrollRegel[1]),
	"Der Kasten um die Liste (.wiki-sync-adv-picker__scroll mit border) steht noch. Gruppiert wird "
	+ "per Trennlinie, nicht per Rahmen (AGENTS.md §12).");
checks += 2;

// Die drei Renderer duerfen die alten Klassen nicht mehr schreiben.
for (const [name, pfad] of [
	["Literatur/Karten", "js/review/review-settlement-list.js"],
	["Vorkommen", "js/review/review-wiki-sync.js"],
]) {
	assert.ok(!/wiki-sync-adv-picker__(row|title|meta)/.test(lies(...pfad.split("/"))),
		`${name} schreibt noch die alten Klassen wiki-sync-adv-picker__row/__title/__meta. `
		+ "Ohne Regel dahinter faellt die Zeile auf Browser-Voreinstellungen zurueck.");
	checks++;
}

// ---- 11. Keine ID-Regel darf die geteilten Zeilenwerte noch einmal setzen ----------------------
// 💣 GEFUNDEN BEIM UMBAU AM 14.08.2026. Es gab eine DRITTE Fassung derselben Werte:
//   #region-sync-list .region-sync__item, #path-sync-list .region-sync__item
//   { padding: 6px 8px; border-bottom: 1px solid var(--color-panel-muted); }
// Die Zeilen der Regionen- und Wegeliste tragen beide Klassen ("tree-item region-sync__item"),
// und diese Regel schlug mit (1,1,0) die geteilte mit (0,2,0). Zwei der acht Listen hoerten also
// gar nicht auf die gemeinsame Regel -- eine Aenderung dort waere bei ihnen wirkungslos geblieben,
// ohne Fehler, ohne Hinweis. Genau so verschwindet eine Vereinheitlichung wieder.
// ⚠️ Die gemeinsame Regel nennt selbst eine ID als ZWEITEN Selektor -- sie ist hier ausgenommen,
// erkennbar daran, dass ihre Selektorliste auch ".wikisync-itemlist" enthaelt. Ohne diese
// Ausnahme meldet der Test genau die Regel, die er schuetzen soll.
// ⚠️ Kommentare zuerst entfernen. Dieses Projekt begruendet Regeln ausfuehrlich IM Stylesheet,
// und der Kommentar an der entfernten Regel zitiert ihren Selektor woertlich -- ein naiver
// Parser haelt das Zitat fuer die Regel selbst und meldet genau die Zeile als Verstoss, die
// dokumentiert, dass der Verstoss beseitigt wurde.
const regionSyncOhneKommentare = regionSync.replace(/\/\*[\s\S]*?\*\//g, "");
const idUeberschreibt = [...regionSyncOhneKommentare.matchAll(/(?:^|\})\s*([^{}]+?)\s*\{([^}]*)\}/g)]
	.map(([, selektoren, koerper]) => ({ selektoren, koerper }))
	.filter(({ selektoren }) => /#[\w-]+/.test(selektoren))
	.filter(({ selektoren }) => !/\.wikisync-itemlist/.test(selektoren))
	.filter(({ selektoren }) => /region-sync__item|\.tree-item/.test(selektoren))
	.filter(({ koerper }) => /(^|[\s;])(padding|border-bottom|row-gap)\s*:/.test(koerper))
	.map(({ selektoren }) => selektoren.split(/\r?\n/).map(z => z.trim()).join(" "));
assert.deepStrictEqual(idUeberschreibt, [],
	"Eine ID-Regel setzt padding/border-bottom/row-gap auf den Listenzeilen noch einmal und "
	+ "ueberstimmt damit die geteilte Regel (ID = Spezifitaet 1,1,0 gegen 0,2,0). Solche Werte "
	+ "gehoeren AUSSCHLIESSLICH in die gemeinsame Regel -- sonst aendert man sie dort und zwei "
	+ "Listen folgen stillschweigend nicht.");
checks++;

// ---- Wer .tree-item-Zeilen bekommt, muss auch als Liste ausgezeichnet sein --------------------
// 💣 DIE ANDERE HAELFTE DERSELBEN FALLE, gemeldet vom Owner am 15.08.2026 („die vorkommen liste
// ist vollkommen zerstoert"). Oben steht, dass die Rezeptur nur EINMAL geschrieben sein darf --
// aber sie haengt an der LISTE (`.wikisync-itemlist .tree-item`), nicht an der Zeile. Ein
// Container, in den jemand .tree-item-Zeilen schreibt, ohne ihn als Liste auszuzeichnen, faellt
// still auf die Basisregel zurueck: die Zeile wird inline-flex und damit nur so breit wie ihr
// Text -- gemessen 185px in einer 466px-Spalte. Nichts wirft, nichts warnt.
//
// Genau das ist bei der Vereinheitlichung (70f8d984) passiert: die Zeilenform wanderte auf
// .tree-item, die Panel-Liste #lore-list-scroll bekam die Klasse, ihre Zwillingsliste im
// Vorkommen-Fenster nicht. Beide werden von DERSELBEN Funktion gefuellt
// (avesmapsLoreListRowHtml ueber AVESMAPS_LORE_VIEWS), also kann es gar nicht bei einer bleiben.
// 🔴 #lore-dlg-scroll (Auswahlspalte im Vorkommen-FENSTER) steht hier bewusst NICHT mehr. Sie hat
// am 15.08.2026 auf die EDITOR-Zeile gewechselt (.avm-row, css/components/editor-row.css), weil das
// Fenster neben Karten-, Literatur- und Ortseditor steht und die alle schwebende gerundete Zeilen
// zeigen (Owner: „angleichen"). Ihr Wachtest ist js/pages/__tests__/editor-row-single-source.test.js.
// ⚠️ Wer sie hier wieder einträgt, verlangt zwei Zeilenformen für einen Container.
const indexHtml = lies("index.html");
const listenContainer = [
	{ id: "lore-list-scroll", wo: "Reiter „Vorkommen“ im WikiSync-Panel" },
	{ id: "settlement-list", wo: "Ortsliste im WikiSync-Panel" },
	{ id: "region-sync-list", wo: "Regionenliste im WikiSync-Panel" },
	{ id: "path-sync-list", wo: "Wegeliste im WikiSync-Panel" },
	{ id: "powerline-sync-list", wo: "Kraftlinienliste im WikiSync-Panel" },
	{ id: "wiki-sync-adv-scroll", wo: "Literaturliste im WikiSync-Panel" },
	{ id: "wiki-sync-cm-scroll", wo: "Kartenliste im WikiSync-Panel" },
];
for (const { id, wo } of listenContainer) {
	const treffer = indexHtml.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`))
		|| indexHtml.match(new RegExp(`<div[^>]*class="[^"]*"[^>]*id="${id}"`));
	assert.ok(treffer, `#${id} steht nicht mehr in index.html (${wo}).`);
	assert.ok(/wikisync-itemlist/.test(treffer[0]),
		`#${id} (${wo}) bekommt .tree-item-Zeilen, traegt aber nicht .wikisync-itemlist. `
		+ "Die Zeilenform haengt an der LISTE, nicht an der Zeile -- ohne die Klasse fallen die "
		+ "Zeilen auf inline-flex zurueck und werden nur so breit wie ihr Text.");
	checks++;
}

console.log(`wikisync-list-form: ${checks} Pruefungen bestanden.`);

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
assert.ok(/border-bottom:\s*1px solid var\(--color-divider\)/.test(rumpf),
	"Der gemeinsamen Zeile fehlt die Trennlinie auf var(--color-divider). Eine Fuellfarbe wie "
	+ "--color-panel-muted als Linie zu benutzen ist genau der Griff, den AGENTS.md §12 verbietet.");
checks++;

// ---- 6. Keine ID-Regel darf die geteilten Zeilenwerte noch einmal setzen -----------------------
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

console.log(`wikisync-list-form: ${checks} Pruefungen bestanden.`);

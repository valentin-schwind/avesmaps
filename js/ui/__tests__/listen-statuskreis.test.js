// Der geteilte Statuskreis-Bauer (js/ui/listen-statuskreis.js) und seine VERDRAHTUNG.
//
// 🔴 Zwei Halbzeiten, und die zweite ist die wichtigere. Eine getestete Funktion, die niemand
// aufruft, ist der Fehler, den dieses Projekt schon sechs Code-Reviews lang uebersehen hat -- und
// er ist am 18.08.2026 in der Panel-Liste der Kraftlinien tatsaechlich passiert (die Zeile trug
// `has-map-status` seit jeher und emittierte NIE einen Marker: ihr Ring war fuer jede Kraftlinie
// leer, ein unmoeglicher Zustand). Deshalb prueft dieser Test je OBERFLAECHE, nicht je Modul.
//
// Run (aus dem Repo-Wurzelverzeichnis):  node js/ui/__tests__/listen-statuskreis.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(wurzel, ...teile), "utf8");
const kreis = require("../listen-statuskreis.js");
let checks = 0;

// ── Die Form ────────────────────────────────────────────────────────────────────────────────────
// 🔴 Genau EIN unsichtbarer <span>, kein zweites Zeichen daneben (am 17.08.2026 wurde fuer die
// Kraftlinienliste ein Rauten-Symbol gebaut und auf Owner-Entscheid zurueckgebaut, 94889119).
for (const [name, markup] of [
	["voll", kreis.avesmapsStatuskreisMarkup("voll")],
	["halb", kreis.avesmapsStatuskreisMarkup("halb")],
	["leer", kreis.avesmapsStatuskreisMarkup("leer")],
]) {
	assert.ok(/^<span class="tree-map-status( tree-map-status--[a-z-]+)?" aria-hidden="true"><\/span>$/.test(markup),
		`Der Marker fuer "${name}" ist nicht mehr genau EIN unsichtbarer <span> der geteilten `
		+ `Rezeptur. Erhalten: ${markup}`);
	checks++;
}
assert.ok(/--all/.test(kreis.avesmapsStatuskreisMarkup("voll")), "voll muss --all sein.");
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisMarkup("halb")), "halb muss --own-only sein.");
assert.ok(!/--/.test(kreis.avesmapsStatuskreisMarkup("leer")),
	"leer darf KEINEN Modifier tragen -- der leere Ring IST die Aussage 'nicht auf der Karte'.");
checks += 3;

// ── ORT ─────────────────────────────────────────────────────────────────────────────────────────
// Drei Zustaende, und alle drei kommen im Bestand vor. Gemessen 18.08.2026 (map-features, 2846
// Kartenorte): 1914 voll, 932 halb; die reinen Wiki-Zeilen kommen in beiden Listen dazu.
assert.ok(/--all/.test(kreis.avesmapsStatuskreisOrt(true, true)),
	"Ein Ort auf der Karte MIT Wiki-Zuweisung muss den vollen Kreis tragen.");
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisOrt(true, false)),
	"Ein Ort auf der Karte OHNE Wiki-Zuweisung muss halb sein.");
assert.ok(!/--/.test(kreis.avesmapsStatuskreisOrt(false, false)),
	"Eine reine Wiki-Zeile liegt nicht auf der Karte -- leerer Ring.");
checks += 3;
// 💣 „Nicht auf der Karte" schlaegt alles. Eine Registry-Zeile kann keine Kartenzuweisung haben;
// stuende die Wiki-Frage zuerst, meldete sie sich als fertig.
assert.ok(!/--/.test(kreis.avesmapsStatuskreisOrt(false, true)),
	"Nicht auf der Karte muss leer bleiben, auch wenn eine Wiki-Zuweisung mitkommt.");
checks++;
// ⚠️ Strikt `=== true`: der Server liefert `on_map` als Bool, aber ein fehlendes Feld darf nicht
// als „ja" durchgehen -- die sichere Richtung.
assert.ok(!/--/.test(kreis.avesmapsStatuskreisOrt(undefined, undefined)),
	"Ohne Angaben darf nicht 'auf der Karte' herauskommen.");
checks++;

// ── VERDRAHTUNG: Ortsliste im ORTSEDITOR ────────────────────────────────────────────────────────
const ortsEditor = lies("html", "wiki-sync-settlement-editor.html");
assert.ok(/<script src="\/js\/ui\/listen-statuskreis\.js"><\/script>/.test(ortsEditor),
	"Der Ortseditor laedt js/ui/listen-statuskreis.js nicht. Dann wirft die Zeile beim ersten "
	+ "Zeichnen einen ReferenceError und die ganze Liste bleibt leer.");
checks++;
assert.ok(/avesmapsStatuskreisOrtZustand\(/.test(ortsEditor),
	"Der Ortseditor ruft den geteilten Bauer nicht auf.");
checks++;
assert.ok(/"avm-row has-map-status"/.test(ortsEditor),
	'Die Zeile des Ortseditors setzt "has-map-status" nicht. Ohne die Klasse greift KEINE Regel '
	+ "in map-status-circle.css -- der Marker steht unsichtbar im DOM und der Kreis fehlt, lautlos.");
checks++;
// 💣 Der Marker gehoert NEBEN den Namen, nicht hinein: `.avm-row__name` traegt `overflow:hidden`
// + `text-overflow:ellipsis` (editor-row.css), und was darin liegt, verschwindet mit den
// Auslassungspunkten.
assert.ok(/line1\.appendChild\(kreis\)/.test(ortsEditor),
	"Der Statuskreis wird nicht mehr an `.avm-row__l1` gehaengt. Innerhalb von `.avm-row__name` "
	+ "schneidet die Ellipse ihn bei langen Namen weg.");
checks++;
// ⚠️ Diese eine Liste baut ihre Zeile aus KNOTEN statt aus einer Zeichenkette und nimmt deshalb die
// Klassenfassung des geteilten Bauers. Selbst zusammengesetzte Klassen waeren genau die zweite
// Fassung, die dieses Modul verhindern soll.
assert.ok(/kreis\.className = avesmapsStatuskreisKlasse\(/.test(ortsEditor),
	"Der Ortseditor setzt die Kreis-Klassen nicht mehr ueber avesmapsStatuskreisKlasse -- dann "
	+ "stehen die drei Modifier ein zweites Mal in einer Datei, die niemand mitpflegt.");
checks++;

// 💣 Und er liest das RICHTIGE Feld. `item.wiki_url` steht in derselben Antwort und ist NICHT die
// Zuweisung -- es haengt nur daran und wird im Lesepfad sogar geraten (99 Phantome, live gemessen).
assert.ok(/avesmapsStatuskreisOrtZustand\(item\.on_map === true, item\.wiki_assigned === true\)/.test(ortsEditor),
	"Der Ortseditor misst die Zuweisung nicht mehr an `wiki_assigned`. Das Feld kommt vom Server "
	+ "und liest `properties.wiki_settlement`; `wiki_url` daneben ist geraten.");
checks++;

// ⚠️ Und der Server muss es auch liefern -- aus dem NEST, nicht aus dem flachen Feld.
const settlementsLib = lies("api", "_internal", "wiki", "settlements.php");
assert.ok(/'wiki_assigned' => is_array\(\$ws\) && trim\(\(string\) \(\$ws\['title'\] \?\? ''\)\) !== ''/.test(settlementsLib),
	"avesmapsWikiSettlementEditorList liefert `wiki_assigned` nicht mehr aus "
	+ "`properties.wiki_settlement`. Aus `wiki_url` abgeleitet zaehlt es Phantome mit.");
checks++;
// 🪤 Beide Haelften der Liste muessen das Feld tragen. Eine fehlende Angabe liest sich im Browser
// wie `false` -- zufaellig richtig fuer die Registry-Zeilen, und damit unbemerkt falsch, sobald
// jemand die Bedeutung aendert.
assert.strictEqual((settlementsLib.match(/'wiki_assigned' =>/g) || []).length, 2,
	"avesmapsWikiSettlementEditorList setzt `wiki_assigned` nicht an BEIDEN Stellen "
	+ "(Kartenorte und reine Registry-Zeilen).");
checks++;

// ── VERDRAHTUNG: Ortsliste im WIKISYNC-PANEL ────────────────────────────────────────────────────
// 🔴 Dieselbe Objektart, dieselbe Frage, derselbe Bauer. Die zwei Listen liegen in verschiedenen
// Dokumenten; ohne ein gemeinsam geladenes Modul stuende die Regel zweimal da.
const panelListe = lies("js", "review", "review-settlement-list.js");
assert.ok(/avesmapsStatuskreisOrt\(/.test(panelListe),
	"Die Panel-Ortsliste ruft den geteilten Bauer nicht auf -- sie haette wieder ihre eigene "
	+ "Fassung der Regel, und die zwei liefen auseinander, ohne dass es auffaellt.");
checks++;
assert.ok(/<script src="js\/ui\/listen-statuskreis\.js"><\/script>/.test(lies("index.html")),
	"index.html laedt js/ui/listen-statuskreis.js nicht. Dann wirft die Panel-Liste beim ersten "
	+ "Zeichnen einen ReferenceError.");
checks++;

// ── WEG ───────────────────────────────────────────────────────────────────────────────
const wegSeg = (key) => ({ wiki_path: key ? { wiki_key: key } : null });
assert.ok(/--all/.test(kreis.avesmapsStatuskreisWeg([wegSeg("wiki:reichsstrasse"), wegSeg("wiki:reichsstrasse")])),
	"Ein Weg, dessen Segmente ALLE zugewiesen sind, muss voll sein.");
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisWeg([wegSeg(""), wegSeg("")])),
	"Ein Weg ohne jede Zuweisung ist halb -- er liegt auf der Karte, haengt aber an keinem Artikel.");
checks += 2;
// 💣 `every`, nicht `some`. Am Livebestand kann diese Zeile nicht ausloesen (die Gruppierung
// laesst keine gemischte Gruppe zu), aber sie ist die Regel und ueberlebt eine andere Gruppierung.
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisWeg([wegSeg("wiki:a"), wegSeg("")])),
	"Ein NUR TEILWEISE zugewiesener Weg muss halb sein. Ein `some` meldete ihn als fertig.");
checks++;
// 💣 Gelesen wird `wiki_path`, nie `wiki_url` -- und dort irrt es in BEIDE Richtungen
// (12 Phantome, 79 Gegenfaelle, live gemessen).
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisWeg([{ wiki_url: "https://de.wiki-aventurica.de/wiki/X" }])),
	"Ein gesetztes `wiki_url` faerbt den Kreis voll. Die Zuweisung ist `properties.wiki_path`.");
checks++;
// ⚠️ Ein Weg IST eine gezeichnete Geometrie -- ohne Segmente gaebe es die Zeile nicht.
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisWeg([])),
	"Ohne Segmente darf nicht 'zugewiesen' herauskommen.");
checks++;

// ── VERDRAHTUNG: Wegeliste im WEGEEDITOR ───────────────────────────────────────────
assert.ok(/<script src="\/js\/ui\/listen-statuskreis\.js"><\/script>/.test(lies("html", "wege-editor.html")),
	"html/wege-editor.html laedt js/ui/listen-statuskreis.js nicht -- js/pages/wege-editor.js ruft "
	+ "den Bauer beim ersten Zeichnen und faellt mit einem ReferenceError aus.");
checks++;
const wegeEditor = lies("js", "pages", "wege-editor.js");
assert.strictEqual((wegeEditor.match(/avesmapsStatuskreisWeg\(group\.segments\)/g) || []).length, 2,
	"Der Wegeeditor ruft den geteilten Bauer nicht an BEIDEN Zeilen, die einen Weg darstellen: "
	+ "dem Gruppenkopf und der einteiligen Zeile (segmentRow mit index === null).");
checks++;
assert.ok(/'<div class="avm-row has-map-status wp-group"/.test(wegeEditor),
	'Die Gruppenzeile des Wegeeditors setzt "has-map-status" nicht -- ohne die Klasse greift keine '
	+ "Regel in map-status-circle.css und der Kreis fehlt, lautlos.");
checks++;
assert.ok(/\(index === null \? " has-map-status" : " wp-segment"\)/.test(wegeEditor),
	"Die einteilige Wegzeile setzt \"has-map-status\" nicht mehr -- oder ein Abschnitt bekommt sie "
	+ "jetzt auch.");
checks++;
// 🔴 Und der ABSCHNITT bekommt keinen. Der Kreis gehoert dem Weg; die Gruppierung erzwingt,
// dass jeder Abschnitt denselben Zustand haette wie sein Kopf -- N Wiederholungen derselben
// Aussage in einer schmalen Spalte (AGENTS.md §12).
assert.ok(!/'<span class="avm-row__name">Abschnitt ' \+ index \+ "<\/span>"\s*\+ avesmapsStatuskreis/.test(wegeEditor),
	"Die Abschnittszeile bekommt jetzt auch einen Statuskreis. Sie traegt zwingend denselben "
	+ "Zustand wie ihr Gruppenkopf -- das ist Wiederholung, keine Information.");
checks++;

console.log(`OK -- ${checks} Zusicherungen (geteilter Statuskreis-Bauer).`);

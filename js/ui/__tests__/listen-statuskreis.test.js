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
// ⚠️ OHNE schliessendes Anfuehrungszeichen: seit dem 19.08.2026 haengt an der Klassenliste
// der Gruppenzeile die Auswahl der WEG-EBENE (is-selected). Die Zusicherung ist dieselbe --
// die Zeile traegt has-map-status --, nur ihr Ende ist nicht mehr fest.
assert.ok(/'<div class="avm-row has-map-status wp-group/.test(wegeEditor),
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

// ── ORTSBEZUG (Literatur und Karte teilen die Regel) ────────────────────────────────────────────
// 🔴 Owner 18.08.2026: „literatur (voll wenn mindestens ein ort zugewiesen wurde, halb wenn
// mindestens ein ort nicht aufgeloest ist)" \u00b7 „karten genauso".
assert.ok(!/--/.test(kreis.avesmapsStatuskreisOrtsbezug([])),
	"Ein Werk ohne jeden zugeordneten Ort liegt nirgends -- leerer Ring.");
assert.ok(/--all/.test(kreis.avesmapsStatuskreisOrtsbezug([{ kind: "settlement" }, { kind: "region" }])),
	"Sind alle Orte aufgeloest, muss der Kreis voll sein.");
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisOrtsbezug([{ kind: "unresolved" }])),
	"Ein unaufgeloester Ort macht den Kreis halb.");
checks += 3;

// 💣 DER VORRANG: halb schlaegt voll. Die zwei Bedingungen des Owners ueberschneiden sich, und
// diese Fixture ist der einzige Ort, an dem das geprueft wird -- am Livebestand sind nur 5 der 89
// halben Karten echt gemischt, der Bestand pruefte die Regel also fast nicht.
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisOrtsbezug([
	{ kind: "settlement" }, { kind: "territory" }, { kind: "unresolved" },
])), "Zwei aufgeloeste Orte PLUS ein offener muessen halb ergeben, nicht voll. Solange etwas "
	+ "unaufgeloest ist, ist die Arbeit nicht fertig -- genau das soll der Kreis zeigen.");
checks++;

// 💣 DIESELBE SPALTE HEISST IM EINEN PAYLOAD `target_kind` UND IM ANDEREN `kind`. Beide
// Literatur-Oberflaechen lesen die LISTENantwort (`kind`); Detailansicht und oeffentlicher
// Katalog liefern `target_kind`. Wer nur einen der zwei Namen prueft, bekommt lauter `undefined`,
// faerbt jede Zeile gleich -- und sein Test bleibt gruen, weil `undefined` auch „offen" heisst.
assert.strictEqual(
	kreis.avesmapsStatuskreisOrtsbezug([{ target_kind: "settlement" }]),
	kreis.avesmapsStatuskreisOrtsbezug([{ kind: "settlement" }]),
	"`target_kind` und `kind` muessen dasselbe Urteil ergeben -- es ist dieselbe Spalte unter zwei "
	+ "Namen (Listen- gegen Detailantwort).");
checks++;
// ⚠️ Ein leerer/unbekannter Wert zaehlt als OFFEN -- die sichere Richtung.
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisOrtsbezug([{ raw_name: "Gareth" }])),
	"Ein Ort ohne jede Art-Angabe muss als offen gelten, nicht als aufgeloest.");
checks++;
// Und die Zahlenfassung entscheidet identisch -- sie ist der Eingang der Karten.
for (const [gesamt, offen, erwartet] of [[0, 0, "leer"], [3, 0, "voll"], [3, 1, "halb"], [3, 3, "halb"]]) {
	assert.strictEqual(
		kreis.avesmapsStatuskreisOrtsbezugZahlen(gesamt, offen),
		kreis.avesmapsStatuskreisMarkup(erwartet),
		`avesmapsStatuskreisOrtsbezugZahlen(${gesamt}, ${offen}) muss "${erwartet}" ergeben.`);
	checks++;
}

// ── VERDRAHTUNG: Literaturliste im LITERATUREDITOR ──────────────────────────────────────────────
const litEditor = lies("html", "game-literature-editor.html");
assert.ok(/<script src="\/js\/ui\/listen-statuskreis\.js"><\/script>/.test(litEditor),
	"Der Literatureditor laedt js/ui/listen-statuskreis.js nicht.");
checks++;
assert.ok(/avesmapsStatuskreisOrtsbezug\(a\.places\)/.test(litEditor),
	"Der Literatureditor ruft den geteilten Bauer nicht mit `a.places` auf. 💣 `a.place_count` "
	+ "reicht NICHT -- die Zahl kennt nur 'wie viele', nicht 'wie viele davon zeigen ins Leere'.");
checks++;
assert.ok(/class="avm-row has-map-status\$\{/.test(litEditor),
	'Die Zeile des Literatureditors setzt "has-map-status" nicht.');
checks++;
// ⚠️ Der Marker muss IN `.avm-row__l1` stehen (Flex, gap), nicht in `.avm-row__name` (ellipsiert).
assert.ok(/<span class="avm-row__name">\$\{aeEscape\(a\.title\)\}<\/span>\$\{avesmapsStatuskreisOrtsbezug/.test(litEditor),
	"Der Kreis steht nicht direkt hinter `.avm-row__name` in `.avm-row__l1`. Innerhalb des Namens "
	+ "schneidet die Ellipse ihn bei langen Titeln weg (bis 67 Zeichen im Bestand).");
checks++;

// ── VERDRAHTUNG: Literaturliste im WIKISYNC-PANEL ───────────────────────────────────────────────
assert.ok(/avesmapsStatuskreisOrtsbezug\(a\.places\)/.test(panelListe),
	"Die Panel-Literaturliste ruft den geteilten Bauer nicht auf. 🪤 Genau hier stand bis "
	+ "18.08.2026 'KEIN has-map-status' -- der Owner hat es an diesem Tag umgedreht.");
checks++;
assert.ok(/class="tree-item has-map-status" data-adv-id=/.test(panelListe),
	'Die Panel-Literaturzeile setzt "has-map-status" nicht -- ohne die Klasse bleibt der Kreis aus.');
checks++;

// ── VERDRAHTUNG: Kartenliste im KARTENEDITOR ────────────────────────────────────────────────────
const kartenEditor = lies("html", "citymap-editor.html");
assert.ok(/<script src="\/js\/ui\/listen-statuskreis\.js"><\/script>/.test(kartenEditor),
	"Der Karteneditor laedt js/ui/listen-statuskreis.js nicht.");
checks++;
assert.ok(/avesmapsStatuskreisOrtsbezugZahlen\(c\.place_count, c\.place_open_count\)/.test(kartenEditor),
	"Der Karteneditor ruft den geteilten Bauer nicht mit BEIDEN Zahlen auf. 💣 `place_count` allein "
	+ "kann 'keine Orte' nicht von 'alle offen' unterscheiden -- die Liste zeigt hier nur NAMEN.");
checks++;
assert.ok(/class="avm-row has-map-status\$\{/.test(kartenEditor),
	'Die Zeile des Karteneditors setzt "has-map-status" nicht.');
checks++;
// ⚠️ Diese Liste hatte als einzige der sechs kein `.avm-row__l1`; ohne die Huelle sitzt der Marker
// im falschen Fluss und ohne Abstand. Titel im Median 42 Zeichen, p90 60 -- ohne den Flex-Kasten
// waere der Kreis genau bei der Haelfte des Bestands unsichtbar.
assert.ok(/<span class="avm-row__l1"><span class="avm-row__name">\$\{ceEscape\(c\.title\)\}<\/span>\$\{avesmapsStatuskreis/.test(kartenEditor),
	"Die Kartenzeile fuehrt Name und Kreis nicht in `.avm-row__l1`. Ohne den Flex-Kasten fehlt dem "
	+ "Marker der Abstand, und der Name ellipsiert ueber ihn hinweg.");
checks++;

// ── VERDRAHTUNG: Kartenliste im WIKISYNC-PANEL ──────────────────────────────────────────────────
assert.ok(/avesmapsStatuskreisOrtsbezugZahlen\(c\.place_count, c\.place_open_count\)/.test(panelListe),
	"Die Panel-Kartenliste ruft den geteilten Bauer nicht auf.");
checks++;
assert.ok(/class="tree-item has-map-status" data-cm-id=/.test(panelListe),
	'Die Panel-Kartenzeile setzt "has-map-status" nicht.');
checks++;

// 🔴 UND DER SERVER MUSS DIE ZWEITE ZAHL LIEFERN. Sie ist der Grund, aus dem die Kartenliste den
// Kreis ueberhaupt rechnen kann: bis 18.08.2026 selektierte diese Abfrage nur `citymap_id,
// raw_name` und gab `places` als reine Namensliste heraus -- `target_kind` reiste gar nicht mit.
// 💣 In DERSELBEN Abfrage, nicht in einer zweiten: eine Abfrage je Zeile waeren ~450 fuer einen
// Tastendruck, und genau davor warnt der Kommentar an dieser Stelle seit jeher (STRATO).
const citymapsLib = lies("api", "_internal", "app", "citymaps.php");
assert.ok(/SELECT citymap_id, raw_name, target_kind FROM citymap_place/.test(citymapsLib),
	"avesmapsListCitymapsForEdit holt `target_kind` nicht mehr mit. Ohne die Spalte kann die Liste "
	+ "'aufgeloest' von 'offen' nicht unterscheiden und der Kreis waere geraten.");
checks++;
assert.ok(/'place_open_count' => \$placeOpenCounts\[\$id\] \?\? 0,/.test(citymapsLib),
	"avesmapsListCitymapsForEdit gibt `place_open_count` nicht mehr heraus.");
checks++;

// ── LANDSCHAFT: ZWEI unabhaengige Bits ──────────────────────────────────────────────────────────
// 🔴 Owner 18.08.2026: „Linker halbkreis gefüllt wenn mind. 1 zugewiesenes Label. Rechter
// Halbkreis wenn mindestens eine zugewiesene Fläche. voll wenn beides."
assert.ok(/tree-map-status--children-only/.test(kreis.avesmapsStatuskreisLandschaft(true, false)),
	"Nur ein zugewiesenes LABEL muss die LINKE Haelfte fuellen (--children-only).");
assert.ok(/tree-map-status--own-only/.test(kreis.avesmapsStatuskreisLandschaft(false, true)),
	"Nur eine zugewiesene FLAECHE muss die RECHTE Haelfte fuellen (--own-only).");
assert.ok(/tree-map-status--all/.test(kreis.avesmapsStatuskreisLandschaft(true, true)),
	"Label UND Flaeche muessen voll ergeben.");
assert.ok(!/--/.test(kreis.avesmapsStatuskreisLandschaft(false, false)),
	"Weder Label noch Flaeche: leerer Ring.");
checks += 4;
// 💣 Die zwei Bits sind UNABHAENGIG, keine Stufenleiter -- die zwei Halbformen duerfen nicht
// dieselbe sein, sonst ist „nur Label" von „nur Flaeche" nicht zu unterscheiden.
assert.notStrictEqual(
	kreis.avesmapsStatuskreisLandschaft(true, false),
	kreis.avesmapsStatuskreisLandschaft(false, true),
	"nur Label und nur Flaeche liefern dieselbe Form -- dann sagt der Kreis nur noch halb "
	+ "und die zwei Bits sind wieder eine Stufenleiter.");
checks++;
// ⚠️ Und „halb" (Ort/Weg/Ortsbezug) IST dieselbe Form wie „nur Flaeche" -- absichtlich, aber unter
// zwei Namen, damit ein Umbau die zwei Aussagen nicht zusammenzieht.
assert.strictEqual(kreis.avesmapsStatuskreisKlasse("halb"), kreis.avesmapsStatuskreisKlasse("nurFlaeche"),
	"halb und nurFlaeche muessen dieselbe rechte Haelfte zeichnen.");
checks++;

// ── VERDRAHTUNG: Regionenliste im LANDSCHAFTEN-EDITOR ───────────────────────────────────────────
const landEditor = lies("html", "landschaften-editor.html");
assert.ok(/<script src="\/js\/ui\/listen-statuskreis\.js"><\/script>/.test(landEditor),
	"Der Landschaften-Editor laedt js/ui/listen-statuskreis.js nicht.");
checks++;
assert.ok(/avesmapsStatuskreisLandschaft\(/.test(landEditor),
	"Der Landschaften-Editor ruft den geteilten Bauer nicht auf.");
checks++;
assert.ok(/'<div class="avm-row has-map-status'/.test(landEditor),
	'Die Zeile des Landschaften-Editors setzt "has-map-status" nicht.');
checks++;
// 💣 `label.assigned`, nicht `row.labels.length`: die Trefferliste des Servers zaehlt auch blossen
// Namensgleichstand als Treffer (195 von 540 live).
assert.ok(/label\.assigned === true/.test(landEditor),
	"Der Landschaften-Editor misst das Label-Bit nicht an `assigned`. Ein blosses "
	+ "`row.labels.length` behauptet eine Zuweisung, die es nicht gibt.");
checks++;

// ── VERDRAHTUNG: Regionenliste im WIKISYNC-PANEL ────────────────────────────────────────────────
const regionPanel = lies("js", "review", "review-region-sync.js");
assert.ok(/avesmapsStatuskreisLandschaft\(/.test(regionPanel),
	"Die Panel-Regionenliste ruft den geteilten Bauer nicht auf.");
checks++;
assert.ok(/label\.assigned === true/.test(regionPanel),
	"Die Panel-Regionenliste misst das Label-Bit nicht an `assigned`.");
checks++;
// 🪤 Und kein fest verdrahtetes `--all` mehr. Genau das stand hier: 238 map-only-Zeilen zeigten
// den vollen Kreis ohne jede Wiki-Verbindung.
assert.ok(!/tree-map-status--all/.test(regionPanel),
	"review-region-sync.js schreibt wieder ein festes `tree-map-status--all`. Der Kreis muss "
	+ "gerechnet werden -- sonst meldet sich eine unverbundene Zeile als fertig.");
checks++;

// ⚠️ Und der Server muss `assigned` ueberhaupt mitschicken -- an BEIDEN Stellen, an denen er
// Labels ausgibt: den Treffern und den Karten-Labels ohne Wiki-Treffer.
const regionsLib = lies("api", "_internal", "wiki", "regions.php");
assert.strictEqual((regionsLib.match(/\$label\['assigned'\] = /g) || []).length, 3,
	"avesmapsWikiRegionMatch markiert nicht mehr alle drei Label-Quellen mit `assigned` "
	+ "(Namensgleichstand = false, ausdrueckliche Zuweisung = true, unmatched = false). Fehlt "
	+ "eine, liest der Browser dort `undefined` und der Kreis raet.");
checks++;

// ── VORKOMMEN: die vierte Regel, und sie ist der von Literatur/Karte ENTGEGENGESETZT ────────────
// Owner 18.08.2026: „halbgefuellt, wenn sie vorkommen aber nicht mit einem ort oder einer region
// auf der karte zugewiesen sind (z.b. schiff), voll wenn sie auf der karte irgendwo vorkommen“.
assert.ok(/--all/.test(kreis.avesmapsStatuskreisVorkommen(3, 1)),
	"EIN verorteter Fundort genuegt fuer den vollen Kreis -- eine Ware, die es in Belhanka gibt, "
	+ "kommt auf der Karte vor, auch wenn zwei weitere Nennungen ins Leere zeigen.");
checks++;
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisVorkommen(2, 0)),
	'Genannte Orte, aber keiner auf der Karte („Schiff“, „Myranor“) muss HALB sein.');
checks++;
assert.ok(!/--/.test(kreis.avesmapsStatuskreisVorkommen(0, 0)),
	"Ohne jede Ortsangabe („ohne Ortsangabe“) bleibt der Ring leer.");
checks++;
// 🔴 DIE PROBE AUF DIE GEGENLAEUFIGKEIT. Dieselben zwei Zahlen, zwei Objektarten, zwei
// entgegengesetzte Antworten -- und genau das ist beabsichtigt: bei einem WERK ist jeder
// unaufgeloeste Ort offene Arbeit (halb schlaegt voll), bei einer WARE genuegt ein Fundort.
// Wer die beiden Bauer je zusammenlegt, bricht diese Zusicherung, und das ist ihr einziger Zweck.
assert.ok(/--all/.test(kreis.avesmapsStatuskreisVorkommen(3, 1))
	&& /--own-only/.test(kreis.avesmapsStatuskreisOrtsbezugZahlen(3, 2)),
	"Vorkommen und Literatur/Karte muessen bei „3 Orte, 1 davon aufgeloest“ VERSCHIEDEN antworten: "
	+ "die Ware voll, das Werk halb. Kommt hier dasselbe heraus, wurden die zwei Regeln "
	+ "vereinheitlicht -- und mindestens eine Aussage ist damit umgedreht.");
checks++;
// ⚠️ Strikt: ein fehlendes Feld darf nicht als „verortet“ durchgehen (sichere Richtung).
assert.ok(/--own-only/.test(kreis.avesmapsStatuskreisVorkommen(2, undefined)),
	"Ohne Angabe zur Verortung darf nicht „voll“ herauskommen.");
checks++;

// ── VERDRAHTUNG: Vorkommen-Liste (Reiter UND Fenster, beide in index.html) ──────────────────────
// 🔴 EIN Zeilenbauer fuer beide Oberflaechen (avesmapsLoreListRowHtml, `form` = "tree"|"avm") --
// deshalb steht die Verdrahtung hier nur einmal, anders als bei den fuenf Nachbarn.
// ⚠️ Dass index.html das Skript laedt, steht schon oben bei der Panel-Ortsliste; eine zweite
// Zusicherung dafuer waere tot (sie loeste nie als erste aus). Beide Vorkommen-Listen leben in
// index.html, also gilt sie hier mit.
const vorkommenListe = lies("js", "review", "review-wiki-sync.js");
// 💣 Seit 19.08.2026 sind es VIER Zahlen, nicht zwei: eine Lebensraum-Regel mit Verbreitung ist
// ein gleichwertiges Vorkommen (Owner). Geprueft wird, dass beide PAARE eingehen -- addiert wird
// nur hier, `place_count` bleibt die Zahl der Ortszeilen (daran haengt der „+N"-Zaehler der
// Meta-Zeile).
for (const feld of ["item.place_count", "item.rule_count", "item.place_mapped_count", "item.rule_mapped_count"]) {
	assert.ok(new RegExp(feld.replace(".", "\.")).test(vorkommenListe),
		`Die Vorkommen-Zeile liest ${feld} nicht mehr. Ohne das eine Paar zaehlen Ortszeilen nicht `
		+ "mehr, ohne das andere sind Regeln wieder unsichtbar -- beides faerbt Zeilen still falsch.");
	checks++;
}
assert.ok(/avesmapsStatuskreisVorkommen\(\s*\(Number\(item\.place_count\) \|\| 0\) \+ \(Number\(item\.rule_count\) \|\| 0\),/.test(vorkommenListe),
	"Ortszeilen und Regeln muessen fuer die ERSTE Zahl (gesamt) addiert werden -- sonst ist ein "
	+ "Eintrag mit Regel und ohne Ortszeile wieder leer statt mindestens halb.");
checks++;
// ⚠️ Dass die Zahl NICHT aus der auf 6 gekappten `places`-Liste gezaehlt werden darf, prueft
// js/review/__tests__/lore-dialog-layout.test.js am VERHALTEN (Eintrag mit sieben Orten, der
// einzige verortete ist der siebte) -- hier waere es nur eine Aussage ueber die Schreibweise.
assert.ok(/class="tree-item has-map-status"/.test(vorkommenListe),
	'Die Vorkommen-Zeile im REITER setzt "has-map-status" nicht -- ohne die Klasse greift keine '
	+ "Regel in map-status-circle.css und der Kreis fehlt lautlos.");
checks++;
assert.ok(/class="avm-row has-map-status'/.test(vorkommenListe),
	'Die Vorkommen-Zeile im FENSTER setzt "has-map-status" nicht.');
checks++;
// ⚠️ Im Fenster gehoert der Marker NEBEN den Namen in `.avm-row__l1` -- `.avm-row__name`
// ellipsiert (editor-row.css), und was darin liegt, verschwindet mit den Auslassungspunkten.
assert.ok(/avm-row__l1"><span class="avm-row__name">' \+ name \+ "<\/span>" \+ kreis/.test(vorkommenListe),
	"Im Vorkommen-Fenster steht der Kreis nicht neben dem Namen in `.avm-row__l1`.");
checks++;
// 💣 Und der Server muss die Zahl ueberhaupt liefern -- sonst prueft der Bauer fuer immer
// `undefined` und faerbt jede Zeile mit Orten halb (gruener Test, wirkungslose Liste).
const loreLib = lies("api", "_internal", "app", "lore.php");
assert.ok(/'place_mapped_count' => \$mappedPlaces,/.test(loreLib),
	"api/_internal/app/lore.php liefert `place_mapped_count` nicht mehr im Katalog-Eintrag.");
checks++;
assert.ok(/avesmapsLoreReadPlaceKeysOnMap\(\$pdo, array_keys\(\$allPlaceKeys\)\)/.test(loreLib),
	"Der Katalog fragt die Kartenschluessel nicht mehr ab -- ohne sie ist `place_mapped_count` "
	+ "ueberall 0 und jede Zeile mit Orten waere halb.");
checks++;

// ── Die Panel-Wegeliste: zwei alte Fehlbefunde ──────────────────────────────────────────────────
const pathPanel = lies("js", "review", "review-path-sync.js");
// 🪤 Eine map-only-Zeile ist ein Weg AUF der Karte OHNE Wiki-Zeile -- der halbe Zustand. Sie trug
// ein fest verdrahtetes `--all`; 3744 Zeilen meldeten sich als fertig.
assert.ok(!/tree-map-status--all/.test(pathPanel),
	"review-path-sync.js schreibt wieder ein festes `tree-map-status--all`. Die map-only-Zeilen "
	+ "sind auf der Karte OHNE Wiki -- halb, nicht voll.");
checks++;
assert.ok(/avesmapsStatuskreisMarkup\("halb"\)/.test(pathPanel),
	"Die map-only-Zeile nimmt nicht mehr den halben Kreis aus dem geteilten Bauer.");
checks++;
// 🪤 Und die vier Diagnoselisten (Ausreisser, Fusszeile, Flussrichtung, Verlauf-Konflikte) trugen
// `has-map-status` samt Marker OHNE Modifier -- ein Ring, der IMMER leer blieb. Gemessen an
// „Flussrichtung unbekannt": 86 Zeilen, alle leer, und jede liegt auf der Karte.
assert.strictEqual((pathPanel.match(/class="tree-item has-map-status/g) || []).length, 2,
	"review-path-sync.js setzt `has-map-status` nicht mehr an genau ZWEI Stellen (map-only und "
	+ "Wiki-Weg). Die vier Diagnoselisten duerfen keinen tragen -- ihr Ring kann nur leer sein, "
	+ "und das ist fuer einen gezeichneten Weg ein unmoeglicher Zustand.");
checks++;
assert.ok(!/'<span class="tree-map-status" aria-hidden="true"><\/span>'/.test(pathPanel),
	"review-path-sync.js emittiert wieder einen Marker ohne Modifier. Der faerbt nichts und sagt "
	+ "'nicht auf der Karte' -- fuer diese Listen unmoeglich.");
checks++;

// ── Die DRITTE Kreisfassung: `.cov` im Territorienbaum ──────────────────────────────────────────
// 🪤 Sie ist aelter als die geteilte Regel und bleibt eigen, weil sie eigenes Markup schreibt
// (.all/.own-only/.children-only). Aber sie steht im Ortseditor in der LINKEN Spalte, direkt neben
// der Liste in der Mitte -- und stand auf 12px gegen 11px. Dieselbe Aussage in zwei Groessen, in
// einem Blick. Die Groesse ist seither EIN Token.
assert.ok(/--map-status-circle-size:\s*\d+px;/.test(lies("css", "base", "tokens.css")),
	"Das Token --map-status-circle-size fehlt. Ohne es steht die Kreisgroesse an drei Stellen "
	+ "einzeln da (AGENTS.md §12: nie hartkodieren).");
checks++;
for (const [name, pfad] of [
	["css/components/map-status-circle.css", ["css", "components", "map-status-circle.css"]],
	["html/wiki-sync-settlement-editor.html", ["html", "wiki-sync-settlement-editor.html"]],
	["html/wiki-sync-monitor.html", ["html", "wiki-sync-monitor.html"]],
]) {
	assert.ok(/var\(--map-status-circle-size\)/.test(lies(...pfad)),
		`${name} setzt die Kreisgroesse wieder als Zahl statt ueber --map-status-circle-size. `
		+ "Im Ortseditor stehen zwei dieser Kreise nebeneinander -- ein Unterschied faellt sofort auf.");
	checks++;
}

// ── Der Territorien-Editor: Wappen fuehrt die Zeile an, der Kreis schliesst sie ─────────────────
// Owner 18.08.2026: „den kreis (so wie im editorpanel) auch ans ende der 1. zeile und deren platz
// mit den wappen tauschen. achte dass der text auch ohne wappen dann immer untereinandersteht".
// 🪤 Der Auftrag verortete die Zeile in js/territory/territory-wiki-tree.js -- dort gibt es gar kein
// Wappen. Sie steht in html/wiki-sync-monitor.html („Territorien bearbeiten"), einem eigenstaendigen
// iframe-Dokument mit eigenem <style> und eigenem Markup (.cov/.wp statt .tree-map-status).
const monitor = lies("html", "wiki-sync-monitor.html");

// (1) Beide Erzeuger: Wappen VOR dem Namen, Abdeckungs-Kreis HINTER ihm.
for (const [erzeuger, zeile] of [
	["renderList (linke Liste)", (monitor.match(/^.*out\.push\(`<div class="row.*$/m) || [""])[0]],
	["buildTreeNode (rechter Baum)", (monitor.match(/^.*let html = `<li data-li=.*$/m) || [""])[0]],
]) {
	assert.ok(zeile !== "", `${erzeuger}: die Zeile wurde nicht gefunden -- der Test misst nichts mehr.`);
	const wappenPos = zeile.indexOf("${wappenThumb(n)}");
	const kreisPos = zeile.indexOf("${covCircle(n)}");
	const namePos = zeile.indexOf("${esc(dispName(n))}");
	assert.ok(wappenPos >= 0 && kreisPos >= 0 && namePos >= 0,
		`${erzeuger}: Wappen, Kreis oder Name fehlt in der Zeile.`);
	assert.ok(wappenPos < namePos,
		`${erzeuger}: das Wappen steht nicht mehr VOR dem Namen. Es fuehrt die Zeile an -- das war `
		+ "der Tausch, den der Owner am 18.08.2026 verlangt hat.");
	assert.ok(kreisPos > namePos,
		`${erzeuger}: der Abdeckungs-Kreis steht nicht mehr HINTER dem Namen. Genau dort sitzt er `
		+ "im WikiSync-Panel (::after an .tree-item-name) und in den Editorfenstern (.avm-row__l1); "
		+ "weil .nm waechst, ist das das Ende der ersten Zeile.");
	checks += 4;
}

// (2) Der reservierte Platz. 1.386 von 1.581 Gebieten (87,7 %) haben KEIN Wappen -- ohne
// Platzhalter fehlte in sieben von acht Zeilen das ERSTE Element, und der Name spraenge.
const thumb = (monitor.match(/^function wappenThumb\(n\)\{.*$/m) || [""])[0];
assert.ok(/wp-slot/.test(thumb),
	"wappenThumb() gibt bei fehlendem Wappen keinen Platzhalter mehr zurueck. Eine leere "
	+ "Zeichenkette laesst die erste Zelle ersatzlos wegfallen -- 87,7 % der Zeilen ruecken dann "
	+ "gegen die 12,3 % mit Wappen ein. Dieselbe Regel wie bei der Ziehgriff-Spalte (AGENTS.md §11).");
checks++;
assert.ok(!/return '';/.test(thumb),
	"wappenThumb() faellt wieder auf die leere Zeichenkette zurueck.");
checks++;
// 🔴 Der Platzhalter darf keinen Lizenzstatus behaupten: .pd/.gray gehoeren dem BILD.
// 🪤 Hier stand zuerst ein Reihenfolgevergleich ("wp-slot" vor "licClass") -- der blieb bei der
// Mutationsprobe GRUEN, obwohl die Lizenzklasse im Platzhalter stand: sie steht dann eben HINTER
// ihm. Gemessen wird deshalb die Eigenschaft selbst: der Platzhalter ist eine KONSTANTE.
const platzhalter = (thumb.match(/return\s+('[^']*wp-slot[^']*')/) || ["", ""])[1];
assert.ok(platzhalter !== "", "Der Platzhalter-Rueckgabewert von wappenThumb() ist keine Zeichenkette mehr.");
checks++;
assert.ok(!/licClass|\$\{/.test(platzhalter),
	`Der leere Platzhalter setzt etwas aus den Daten ein (${platzhalter}). Ein gruener Lizenzring `
	+ "oder ein Ausgrauen an einer LEEREN Zelle behauptet einen Status, den es dort nicht gibt -- "
	+ "der Platzhalter haelt nur Platz und ist deshalb eine Konstante.");
checks++;

// (3) 💣 Bild und Platzhalter teilen EINE Groessenangabe. Wer sie an einer der beiden aendert,
// bricht die Ausrichtung genau so, wie sie vor dem 18.08.2026 gebrochen war (Name bei 17 px ODER
// 38 px). Gemessen wird deshalb die WIRKUNG, nicht die Schreibweise: beide Breiten gleich.
// ⚠️ Nur der <style>-Block, und OHNE Kommentare: der Kommentar ueber der Regel nennt ".wp" selbst,
// und im JS-Teil derselben Datei stehen tausende geschweifte Klammern. Beides macht aus einer
// naiven Regelsuche Rauschen -- und ein Test, der nichts findet, ist gruen aus dem falschen Grund.
const stilblock = (monitor.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1]
	.replace(/\/\*[\s\S]*?\*\//g, "");
assert.ok(/\.wp-slot/.test(stilblock), "Im <style>-Block gibt es keine Regel fuer .wp-slot.");
checks++;
const breiteVon = (selektor) => {
	let wert = "";
	for (const treffer of stilblock.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
		if (!treffer[1].split(",").map((teil) => teil.trim()).includes(selektor)) continue;
		for (const deklaration of treffer[2].matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) {
			if (deklaration[1] === "width") wert = deklaration[2].trim();
		}
	}
	return wert;
};
const breiteBild = breiteVon(".wp");
const breitePlatz = breiteVon(".wp-slot");
assert.ok(breiteBild !== "", "Die Regel fuer .wp setzt keine Breite mehr.");
assert.strictEqual(breitePlatz, breiteBild,
	`Wappen (${breiteBild || "—"}) und Platzhalter (${breitePlatz || "—"}) sind verschieden breit. `
	+ "Genau dann steht der Name je nach Wappen woanders -- der Zustand, den der Umbau vom "
	+ "18.08.2026 beseitigt hat. Die Breite gehoert in EINE Regel fuer beide Selektoren.");
checks += 2;

// (4) 🔴 Der PANEL-Baum bleibt unberuehrt. Ihn baut ein anderer Zeichner
// (js/territory/territory-wiki-tree.js, derselbe auch fuer den eingebetteten Karten-Editor) -- dort
// haengt der Marker als LETZTES Kind und es gibt kein Wappen. Ohne diese Zusicherung wandert der
// Umbau irgendwann lautlos dorthin, und der Panel-Baum sieht ploetzlich anders aus als gestern.
const panelZeichner = lies("js", "territory", "territory-wiki-tree.js");
const panelBauer = (panelZeichner.match(/function renderTreeItem\(node, options\) \{[\s\S]*?\n\t\}/) || [""])[0];
assert.ok(panelBauer !== "", "renderTreeItem() in territory-wiki-tree.js nicht gefunden.");
checks++;
const anhaengungen = [...panelBauer.matchAll(/itemElement\.appendChild\((\w+)\)/g)].map((t) => t[1]);
assert.strictEqual(anhaengungen[anhaengungen.length - 1], "mapStatusElement",
	"Im Panel-Baum ist der Statusmarker nicht mehr das LETZTE Kind der Zeile. Diese Oberflaeche "
	+ "stand ausdruecklich NICHT im Auftrag vom 18.08.2026 -- der Tausch gehoert allein dem "
	+ "Territorien-Editor (html/wiki-sync-monitor.html).");
checks++;
assert.ok(!/coat_of_arms|wappen|wp-slot/i.test(panelBauer),
	"Der Panel-Baum zeichnet neuerdings ein Wappen in seine Zeile. Er hatte nie eines -- genau "
	+ "daran war zu erkennen, dass der Auftrag vom 18.08.2026 eine andere Datei meinte.");
checks++;


// ── Der Kreis darf nicht auf Zeile 2 rutschen ────────────────────────────────────────────────
// 🪤 DIESER FEHLER WAR MIT DER REIHENFOLGE NICHT ZU FANGEN: sie war die ganze Zeit richtig.
// `.row` ist flex-wrap:wrap; solange `.nm` einen Boden von 9.5em hatte, ergab sich eine
// Mindestbreite von ~161,5 px, und unter rund 607 px Fensterbreite fiel der Kreis auf eine
// zweite Zeile -- genau dorthin, wo der Owner ihn ausdruecklich NICHT wollte.
// ⚠️ Diese Zusicherung prueft die tragende EIGENSCHAFT, nicht die Darstellung. Ob der Kreis im
// Bild oben sitzt, kann nur ein Browser beantworten; das bleibt offen und wird hier nicht
// behauptet.
{
	const monitor = fs.readFileSync(path.join(wurzel, "html", "wiki-sync-monitor.html"), "utf8");
	const regel = monitor.match(/\.row \.nm \{[^}]*\}/);
	assert.ok(regel, "Die Regel .row .nm steht nicht mehr in html/wiki-sync-monitor.html.");
	assert.ok(/min-width:\s*0\s*;/.test(regel[0]),
		"`.row .nm` braucht min-width:0, sonst schiebt der Namensboden den Statuskreis in einer"
		+ " schmalen Spalte auf die zweite Zeile -- der Owner-Auftrag lautete 'ans Ende der 1. Zeile'.");
	checks++;
}

console.log(`OK -- ${checks} Zusicherungen (Statuskreis-Bauer + Territorien-Editor-Zeile).`);

// Der ORT als Objektart mit ZWEI Oberflaechen und einer eigenen Falle (Aufgabe 5).
//
// 🔴 Vier Dinge werden hier festgenagelt, und jedes ist einmal danebengegangen oder haette es
// koennen:
//   1. `assign_to` adressiert den ORT ueber seinen TITEL, nicht ueber den `wiki_key` -- anders als
//      beim Weg. Wer den Rumpf des Wegs abschreibt, schickt einen Schluessel, den der Endpunkt nie
//      nachschlaegt, und bekommt „title/public_id fehlt".
//   2. Die SUCHE liefert KEINE Infoboxwerte. Sie kommen erst in der Antwort des Schreibvorgangs --
//      ohne Anreicherung staende der Zuweisungskasten nach der Wahl fast leer da.
//   3. Die Wiki-Ortsklasse ist ein Schluessel und darf NICHT geraten werden: die Hausfassung
//      `normalizeLocationType` faellt auf „dorf" zurueck, und das schriebe aus einer Metropole ein
//      Dorf.
//   4. `laden` LEHNT AB, statt etwas Leeres zu liefern -- der Vertrag aus dem Kopf von
//      js/ui/wiki-assign.js, in BEIDEN Oberflaechen gefahren.
//
// ⭐ Und die Lehre aus den Aufgaben 3 und 4 steht ueber allem: eine Textprobe misst die FORM des
// Codes, nicht sein Verhalten. Ab Teil 3 laufen die ECHTEN Oberflaechen in einem vm-Sandkasten mit
// untergeschobenem `fetch`; geklickt wird ueber die Zuhoerer, die `mount` selbst angehaengt hat.
//
// Run: node js/ui/__tests__/wiki-assign-ort.test.js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { AVESMAPS_WIKI_ASSIGN_REGISTRY } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
const { avesmapsWikiAssignMount } = require("../wiki-assign.js");
const {
	AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN,
	AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER,
	avesmapsWikiAssignOrtSyncLeer,
	avesmapsWikiAssignOrtOrtsgroesse,
	avesmapsWikiAssignOrtWerte,
	avesmapsWikiAssignOrtTreffer,
	avesmapsWikiAssignOrtTitel,
	avesmapsWikiAssignOrtTrefferAnreichern,
	avesmapsWikiAssignOrtArtikel,
	avesmapsWikiAssignOrtZustand,
	avesmapsWikiAssignOrtZuweisungsKoerper,
	avesmapsWikiAssignOrtAntwortPruefen,
	avesmapsWikiAssignOrtSyncWerte,
} = require("../wiki-assign-ort.js");

// Im Browser legen die <script>-Zeilen diese Globalen an; `avesmapsWikiAssignMount` prueft BEIDE
// und liefert sonst nur einen Blindgaenger.
global.avesmapsWikiAssignSubject = require("../wiki-assign-registry.js").avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;

const wurzel = path.resolve(__dirname, "..", "..", "..");
let checks = 0;
function zaehl() { checks++; }

// Eine Suchzeile, wie avesmapsWikiSettlementSearch sie WIRKLICH liefert
// (api/_internal/wiki/settlements.php:710-758) -- sechs Spalten, kein einziger Infoboxwert.
const SUCHZEILE = {
	title: "Havena",
	name: "Havena",
	wiki_key: "wiki:havena",
	settlement_class: "grossstadt",
	settlement_label: "Großstadt",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Havena",
};

// Das Objekt, das assign_to bzw. ?action=preview zurueckgibt (avesmapsWikiSettlementParseInfobox).
const SIEDLUNG = {
	title: "Havena",
	name: "Havena",
	wiki_key: "wiki:havena",
	match_key: "havena",
	settlement_class: "grossstadt",
	settlement_label: "Großstadt",
	art: "Hafenstadt",
	einwohner: "9.400",
	bevoelkerung: "Menschen",
	oberhaupt: "Gräfin Yppolita",
	region: "Albernia",
	staat: "Mittelreich",
	lage: "Albernia · Mittelreich",
	handelszone: "Westküste",
	verkehrswege: "Reichsstraße 5",
	tempel: "Efferd",
	description: "Die größte Stadt Alberniens.",
	wappen_url: "https://de.wiki-aventurica.de/img/havena.png",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Havena",
	synced_at: "2026-08-16T00:00:00Z",
};

// ══ TEIL 1: die reinen Bausteine ══════════════════════════════════════════════════════════════

// ── 1) DIE ORTSGROESSE WIRD NICHT GERATEN ─────────────────────────────────────────────────────
// 💣 `normalizeLocationType` (js/routing/routing.js:37) gibt bei unbekanntem Wert „dorf" zurueck.
// Als Vorbelegung eines Auswahlfelds vertretbar, als SYNC-VORSCHLAG eine Vermutung, die echte
// Daten schreibt -- und hier entscheidet der Wert die DARSTELLUNG des Ortes.
// 🔴 SEIT 17.08.2026 MIT EINER AUSNAHME, UND SIE IST DER FALL GARETH (unten ausfuehrlich): `dorf`
// ist zugleich der geratene Rueckfall des SERVER-Parsers, und ein Nest, das nicht sagt, ob geraten
// wurde, wird vorsichtig gelesen. Die Zusicherung ist MITGEWANDERT, nicht geloescht -- sie nagelt
// die neue Regel genauso scharf fest wie vorher die alte.
AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.forEach((schluessel) => {
	const nest = { settlement_class_guessed: false }; // „das Wiki sagt das wirklich"
	assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse(schluessel, nest), schluessel, schluessel + " faellt durch");
	zaehl();
});
["burg", "siedlung", "Handelsstadt", "", null, undefined, "Großstadt"].forEach((unbekannt) => {
	assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse(unbekannt), "",
		"eine unbekannte Ortsklasse (" + JSON.stringify(unbekannt) + ") faellt auf eine geratene Groesse zurueck");
	zaehl();
});
// Die sechs Schluessel sind genau die des Servers und der zwei Auswahlfelder -- keine Zahl im
// Kommentar, sondern die Liste selbst.
assert.deepStrictEqual(
	AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.slice().sort(),
	["dorf", "gebaeude", "grossstadt", "kleinstadt", "metropole", "stadt"],
	"die Ortsgroessen weichen von den stabilen Schluesseln ab (AGENTS.md §2)"
);
zaehl();

// ── 2) DIE SUCHZEILE TRAEGT NUR DIE ORTSGROESSE ───────────────────────────────────────────────
const trefferAusSuche = avesmapsWikiAssignOrtTreffer(SUCHZEILE);
assert.strictEqual(trefferAusSuche.wiki_key, "wiki:havena");
assert.strictEqual(trefferAusSuche.werte.settlement_label, "Großstadt");
assert.strictEqual(trefferAusSuche.werte.einwohner, "", "die Suche liefert keine Einwohnerzahl -- sie darf hier nicht erfunden werden");
assert.strictEqual(trefferAusSuche.werte.art, "");
assert.strictEqual(trefferAusSuche.werte.ortsgroesse, "grossstadt", "settlement_class steht in der Suchzeile und wird abgebildet");
// 🔴 Der TITEL ist die Adresse, nicht der Schluessel: assign_to schlaegt die Seite ueber `title`
// nach (settlements.php:807).
assert.strictEqual(avesmapsWikiAssignOrtTitel(trefferAusSuche), "Havena");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 3) DIE ANREICHERUNG NACH DEM SCHREIBEN ────────────────────────────────────────────────────
// 💣 `trefferWaehlen` uebernimmt `treffer.werte` NACH dem Aufloesen von `zuweisen` in den Artikel.
// Ohne diesen Schritt staende der Zuweisungskasten unmittelbar nach der Wahl fast leer da.
const angereichert = avesmapsWikiAssignOrtTrefferAnreichern(avesmapsWikiAssignOrtTreffer(SUCHZEILE), SIEDLUNG);
assert.strictEqual(angereichert.werte.einwohner, "9.400");
assert.strictEqual(angereichert.werte.oberhaupt, "Gräfin Yppolita");
assert.strictEqual(angereichert.werte.art, "Hafenstadt");
// 🪤 Diese Zusicherung war zuerst BLIND: sie fragte nur nach `roh.title`, und den traegt die
// Siedlung genauso -- die Mutation „roh = settlement" lief gruen durch. Jetzt wird die IDENTITAET
// geprueft, und das ist die einzige Form, die den Unterschied sieht.
assert.strictEqual(angereichert.roh, SUCHZEILE,
	"die rohe Suchzeile muss die Anreicherung ueberleben -- sie ist die Quelle des Titels");
assert.ok(!("einwohner" in angereichert.roh), "in `roh` steht die Siedlung, nicht die Suchzeile");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 4) DER ARTIKEL AUS DEM NEST ───────────────────────────────────────────────────────────────
assert.strictEqual(avesmapsWikiAssignOrtArtikel(null), null);
assert.strictEqual(avesmapsWikiAssignOrtArtikel({}), null, "ein Nest ohne Titel ist keine Zuweisung");
assert.strictEqual(avesmapsWikiAssignOrtArtikel(SIEDLUNG).werte.region, "Albernia");
// ⚠️ Die beim ANLEGEN gemerkte Wahl kennt nur drei Felder und hat noch keinen Schluessel -- ein
// Riegel auf `wiki_key` liesse sie unsichtbar.
const gemerkt = avesmapsWikiAssignOrtArtikel({ title: "Gareth", name: "Gareth", wiki_url: "https://x/wiki/Gareth" });
assert.ok(gemerkt && gemerkt.name === "Gareth", "die gemerkte Wahl ohne wiki_key faellt durch");
assert.strictEqual(gemerkt.wiki_key, "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 5) DER VERTRAG: `laden` LEHNT AB, STATT ETWAS LEERES ZU LIEFERN ───────────────────────────
[null, undefined, [], 5, "x"].forEach((kaputt) => {
	assert.throws(() => avesmapsWikiAssignOrtZustand(kaputt),
		"avesmapsWikiAssignOrtZustand(" + JSON.stringify(kaputt) + ") liefert einen Zustand, statt zu werfen");
	zaehl();
});
// Ohne Zuweisung ist `artikel` null -- ein GUELTIGER Zustand.
const ohne = avesmapsWikiAssignOrtZustand({ wiki_settlement: null, name: "Havena", feature_subtype: "dorf" });
assert.strictEqual(ohne.artikel, null);
assert.strictEqual(ohne.kartenwerte.name, "Havena");
assert.strictEqual(ohne.kartenwerte.feature_subtype, "dorf");
// 🔴 DER DRITTE ZUSTAND IST NICHT AUS DER ZUWEISUNG ABLEITBAR: „keine Zuweisung" heisst „noch
// niemand hat nachgesehen", der Merker heisst „jemand HAT nachgesehen und es gibt keinen". Ohne
// Angabe ist er falsch, und nur ein ausdrueckliches `true` setzt ihn.
assert.strictEqual(ohne.keinArtikel, false);
assert.strictEqual(
	avesmapsWikiAssignOrtZustand({ wiki_settlement: null, kein_artikel: true }).keinArtikel, true,
	"der Merker „kein Wiki-Artikel“ erreicht den Zustand nicht -- das Haekchen startet dann immer leer"
);
["", 0, "true", null, undefined].forEach((weich) => {
	assert.strictEqual(avesmapsWikiAssignOrtZustand({ kein_artikel: weich }).keinArtikel, false,
		"ein weicher Wert (" + JSON.stringify(weich) + ") setzt den Merker");
	zaehl();
});
// Und die drei neuen Kartenfelder kommen mit -- sonst vergliche die Sync-Vorschau gegen Leerwerte
// und boete jedes Mal eine Aenderung an, die das Formular daneben laengst zeigt.
const mitFeldern = avesmapsWikiAssignOrtZustand({
	wiki_settlement: null, name: "Havena", feature_subtype: "dorf",
	einwohner: "9.400", lage: "Albernia · Mittelreich", oberhaupt: "Gräfin Yppolita",
});
assert.deepStrictEqual(
	AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER.map((feld) => mitFeldern.kartenwerte[feld]),
	["Havena", "dorf", "9.400", "Albernia · Mittelreich", "Gräfin Yppolita"],
	"nicht jedes Kartenfeld erreicht den Zustand"
);
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// 💣 LESEFUNKTIONEN: der Kartenwert wird beim LESEN geholt, nicht beim Laden eingefroren.
let formularName = "Havena (alt)";
const lebend = avesmapsWikiAssignOrtZustand({
	wiki_settlement: SIEDLUNG,
	name: () => formularName,
	feature_subtype: () => "dorf",
});
assert.strictEqual(lebend.kartenwerte.name, "Havena (alt)");
formularName = "Havena";
assert.strictEqual(lebend.kartenwerte.name, "Havena",
	"der Kartenwert ist eingefroren -- die Sync-Vorschau vergliche gegen einen Stand, den das Formular nicht mehr zeigt");
zaehl(); zaehl();

// ── 6) DIE HTTP-ANTWORT: WIRFT BEI JEDEM NEIN ─────────────────────────────────────────────────
assert.throws(() => avesmapsWikiAssignOrtAntwortPruefen({ ok: false, error: { message: "forbidden" } }), /forbidden/);
assert.throws(() => avesmapsWikiAssignOrtAntwortPruefen(null));
assert.throws(() => avesmapsWikiAssignOrtAntwortPruefen([]));
assert.throws(() => avesmapsWikiAssignOrtAntwortPruefen(undefined));
const gut = { ok: true, applied: 1 };
assert.strictEqual(avesmapsWikiAssignOrtAntwortPruefen(gut), gut);
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 7) DER ZUWEISUNGSRUMPF ────────────────────────────────────────────────────────────────────
const koerper = avesmapsWikiAssignOrtZuweisungsKoerper("Havena", "loc-1");
assert.deepStrictEqual(koerper, { action: "assign_to", title: "Havena", public_id: "loc-1", dry_run: false, confirm: "apply" });
assert.ok(!("wiki_key" in koerper), "der Ort wird ueber den TITEL adressiert, nicht ueber den Schluessel");
zaehl(); zaehl();

// ── 8) DIE UEBERNAHME LIEST NUR ANGEHAKTE ZEILEN ──────────────────────────────────────────────
// 🔴 FUENF Ziele seit dem 16.08.2026 (Aufgabe 5b): Einwohner, Lage und Herrscher haben eigene
// Kartenfelder bekommen. Die Liste steht EINMAL (AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER) -- hier wird
// gegen sie geprueft, nicht gegen eine abgeschriebene zweite.
const KEINE_UEBERNAHME = {};
AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER.forEach((feld) => { KEINE_UEBERNAHME[feld] = null; });
assert.deepStrictEqual(avesmapsWikiAssignOrtSyncWerte([]), KEINE_UEBERNAHME);
assert.deepStrictEqual(
	avesmapsWikiAssignOrtSyncWerte([{ karte: "name", neu: "Havena" }]),
	Object.assign({}, KEINE_UEBERNAHME, { name: "Havena" })
);
assert.deepStrictEqual(
	avesmapsWikiAssignOrtSyncWerte([{ karte: "feature_subtype", neu: "grossstadt" }, { karte: "art", neu: "Hafenstadt" }]),
	Object.assign({}, KEINE_UEBERNAHME, { feature_subtype: "grossstadt" }),
	"ein Feld ohne Kartenziel darf nicht in die Uebernahme rutschen"
);
// 💣 DIE DREI NEUEN ZIELE KOMMEN WIRKLICH AN. Bliebe avesmapsWikiAssignOrtSyncWerte bei den zwei
// alten Schluesseln, zeigte das Bauteil die Zeile „Einwohner" -- und der Haken taete nichts.
assert.deepStrictEqual(
	avesmapsWikiAssignOrtSyncWerte([
		{ karte: "einwohner", neu: "9.400" }, { karte: "lage", neu: "Albernia · Mittelreich" },
		{ karte: "oberhaupt", neu: "Gräfin Yppolita" },
	]),
	Object.assign({}, KEINE_UEBERNAHME, { einwohner: "9.400", lage: "Albernia · Mittelreich", oberhaupt: "Gräfin Yppolita" }),
	"die drei neuen Kartenfelder erreichen die Uebernahme nicht"
);
// 💣 „Nichts angehakt" zaehlt ALLE Ziele. Fragte die Oberflaeche weiterhin nur `name` und
// `feature_subtype` ab, waere eine allein angehakte Einwohnerzahl „nichts" -- die Uberflaeche wuerfe,
// das Bauteil laese das als „es ist nichts passiert", und der Haken bliebe wirkungslos stehen.
assert.strictEqual(avesmapsWikiAssignOrtSyncLeer(KEINE_UEBERNAHME), true);
assert.strictEqual(
	avesmapsWikiAssignOrtSyncLeer(Object.assign({}, KEINE_UEBERNAHME, { einwohner: "9.400" })),
	false,
	"eine allein angehakte Einwohnerzahl gilt als „nichts angehakt“"
);
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ══ TEIL 2: die Erklaerung `ort` im Register ══════════════════════════════════════════════════
const ort = AVESMAPS_WIKI_ASSIGN_REGISTRY.ort;
assert.ok(ort, "die Erklaerung `ort` fehlt im Register");
assert.strictEqual(ort.suche.art, "server");
assert.strictEqual(ort.suche.url, "/api/edit/wiki/settlements.php");
// 💣 DIE ZWEI LISTEN MUESSEN SICH DECKEN. Das Register erklaert, WELCHES Wiki-Feld auf welches
// Kartenfeld zeigt; AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER sagt, welche Kartenfelder es gibt. Laeuft
// eines der zwei weiter, zeigt das Bauteil eine Sync-Zeile, die die Uebernahme lautlos verwirft (oder
// die Uebernahme kennt ein Feld, fuer das nie eine Zeile entsteht).
assert.deepStrictEqual(
	ort.felder.filter((feld) => feld.karte !== "").map((feld) => feld.karte).slice().sort(),
	AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER.slice().sort(),
	"die Kartenziele der Erklaerung `ort` und AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER laufen auseinander"
);
// 🔴 Einwohner, Lage und Herrscher HABEN seit dem 16.08.2026 ein Kartenziel, und es heisst wie das
// Wiki-Feld -- genau darum ist die Erklaerung je eine Zeile und niemand uebersetzt.
[["einwohner", "einwohner"], ["lage", "lage"], ["oberhaupt", "oberhaupt"]].forEach(([wikiFeld, ziel]) => {
	const zeile = ort.felder.filter((feld) => feld.wiki === wikiFeld)[0];
	assert.ok(zeile, "Feldzeile fuer „" + wikiFeld + "“ fehlt");
	assert.strictEqual(zeile.karte, ziel, wikiFeld + " zeigt nicht auf das gleichnamige Kartenfeld");
	zaehl();
});
// Und die Anzeigezeilen bleiben Anzeige -- fuer sie gibt es weiterhin kein Feld, und hier wird
// nichts auf Vorrat erklaert.
["art", "bevoelkerung", "region", "staat", "handelszone", "verkehrswege", "tempel"].forEach((wikiFeld) => {
	const zeile = ort.felder.filter((feld) => feld.wiki === wikiFeld)[0];
	assert.ok(zeile, "Feldzeile fuer „" + wikiFeld + "“ fehlt");
	assert.strictEqual(zeile.karte, "", wikiFeld + " hat ploetzlich ein Kartenziel -- gibt es das Feld wirklich?");
	zaehl();
});
// 🔴 DER DRITTE ZUSTAND wird angeboten. Ohne diese Zeile zeichnet das Bauteil das Haekchen gar nicht
// (avesmapsWikiAssignModell prueft `extra.keinArtikelHaken === true`) -- und „Entfernen" hielte beim
// Ort weiterhin nicht ueber ein Neuladen der Karte hinweg (Discord #38).
assert.strictEqual(ort.extra.keinArtikelHaken, true, "der Ort bietet den dritten Zustand nicht an");
assert.ok(String(ort.extra.keinArtikelHinweis || "").trim() !== "", "der Hinweis zum dritten Zustand fehlt");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── Die Diff-Rechnung auf der ECHTEN Erklaerung ───────────────────────────────────────────────
// 💣 Die Sync-Vorschau kennt nur Zeilen MIT Kartenziel. 🔴 Bis zum 16.08.2026 fiel die Einwohnerzahl
// genau daran heraus -- „syncen und die Einwohnerzahl ungehakt lassen" war damals gar nicht
// ausfuehrbar. Seit sie ein Kartenfeld hat, IST sie anhakbar, und der Handgriff wird weiter unten in
// beiden Oberflaechen wirklich gefahren.
const diffZeilen = avesmapsWikiAssignDiff(
	ort.felder,
	{ name: "Havena (alt)", feature_subtype: "dorf", einwohner: "", lage: "", oberhaupt: "" },
	avesmapsWikiAssignOrtWerte(SIEDLUNG),
	[]
);
assert.deepStrictEqual(diffZeilen.map((zeile) => zeile.karte),
	["name", "feature_subtype", "einwohner", "oberhaupt", "lage"]);
assert.deepStrictEqual(diffZeilen.map((zeile) => zeile.neu),
	["Havena", "grossstadt", "9.400", "Gräfin Yppolita", "Albernia · Mittelreich"]);
// 🔴 SEIT DEM 16.08.2026 ENTSCHEIDET DER KARTENWERT, NICHT DER WIKI-WERT (Owner-Entscheid): Name und
// Ortsgroesse sind GEFUELLT und starten deshalb ungehakt; Einwohner, Herrscher und Lage sind hier
// LEER -- das Fuellen einer Luecke bleibt vorangehakt. Hier stand „alle fuenf sind vorangehakt".
// 💣 Diese eine Fixture zeigt beide Haelften der Regel nebeneinander; eine Probe, die nur „alle
// ungehakt" fordert, waere von „gar nichts ist mehr gehakt" nicht zu unterscheiden.
assert.deepStrictEqual(
	diffZeilen.map((zeile) => [zeile.karte, zeile.gehakt]),
	[["name", false], ["feature_subtype", false], ["einwohner", true], ["oberhaupt", true], ["lage", true]],
	"die Vorhaekelung folgt nicht dem Kartenwert"
);
assert.strictEqual(diffZeilen[0].grund, "auf der Karte steht bereits ein Wert", diffZeilen[0].grund);
assert.strictEqual(diffZeilen[2].grund, "", "eine vorangehakte Zeile traegt einen Grund");
// Und die Anzeigefelder bleiben draussen: „Tempel" hat einen Wert im Wiki und kein Kartenziel.
assert.ok(!diffZeilen.some((zeile) => zeile.karte === "tempel"),
	"eine Anzeige-Zeile steht in der Sync-Vorschau -- sie kann nichts uebernehmen");
// 🔴 `lage` ist die ZUSAMMENSETZUNG aus Region und Staat -- die zwei Haelften stehen daneben als
// Anzeige und duerfen NICHT ebenfalls in der Vorschau landen.
assert.ok(!diffZeilen.some((zeile) => zeile.karte === "region" || zeile.karte === "staat"),
	"Region/Staat stehen in der Sync-Vorschau, obwohl nur ihre Zusammensetzung ein Kartenfeld hat");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// 🔴 Sagt das Wiki zur Ortsgroesse nichts (unbekannte Klasse), steht die Zeile drin, aber NIE
// vorangehakt -- sonst leerte ein unbedachter Klick ein gepflegtes Feld.
const diffLeer = avesmapsWikiAssignDiff(
	ort.felder,
	{
		name: "Havena", feature_subtype: "grossstadt", einwohner: SIEDLUNG.einwohner,
		lage: SIEDLUNG.lage, oberhaupt: SIEDLUNG.oberhaupt,
	},
	avesmapsWikiAssignOrtWerte(Object.assign({}, SIEDLUNG, { settlement_class: "burg" })),
	[]
);
assert.strictEqual(diffLeer.length, 1);
assert.strictEqual(diffLeer[0].karte, "feature_subtype");
assert.strictEqual(diffLeer[0].gehakt, false);
assert.ok(/würde die Angabe leeren/.test(diffLeer[0].grund), diffLeer[0].grund);
zaehl(); zaehl(); zaehl(); zaehl();

// Die zwei Dokumente im Rohtext -- Teil 2a und 2b stellen Fragen, die nur sie beantworten koennen.
const indexHtmlRoh = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const editorHtmlRoh = fs.readFileSync(path.join(wurzel, "html/wiki-sync-settlement-editor.html"), "utf8");

// ══ TEIL 2a: DIE ZWEI AUSWAHLLISTEN GEGEN DIE SECHS SCHLUESSEL ════════════════════════════════
// 💣 Die Uebernahme prueft den Wert gegen die `<option>`-Liste der Oberflaeche und LEHNT AB, wenn er
// fehlt. Beide Oberflaechen fuehren heute exakt die sechs Schluessel -- kommt ein siebter in NUR
// eine der zwei Listen, sagt die eine Oberflaeche ja und die andere nein zu derselben Wiki-Angabe,
// und niemand faellt darueber. Deshalb haengen die zwei Listen hier an einer Quelle.
// ⚠️ Textprobe, und das ist hier richtig: die Frage ist, was in den DOKUMENTEN steht -- ein Ablauf
// kann das nicht beantworten, weil er die Liste selbst mitbringt.
const kartenOptionen = (/<select id="location-edit-type"[\s\S]*?<\/select>/.exec(indexHtmlRoh) || [""])[0]
	.match(/value="([a-z]+)"/g) || [];
assert.deepStrictEqual(
	kartenOptionen.map((t) => t.replace(/value="|"/g, "")).sort(),
	AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.slice().sort(),
	"die Ortsgroessen des Kartendialogs weichen von den sechs Schluesseln ab"
);
const editorOptionen = (/const SETTLEMENT_EDIT_TYPE_OPTIONS = \[[\s\S]*?\];/.exec(editorHtmlRoh) || [""])[0]
	.match(/value: "([a-z]+)"/g) || [];
assert.deepStrictEqual(
	editorOptionen.map((t) => t.replace(/value: "|"/g, "")).sort(),
	AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.slice().sort(),
	"die Ortsgroessen des Orte-Editors weichen von den sechs Schluesseln ab"
);
zaehl(); zaehl();

// ══ TEIL 2b: WELCHES STYLESHEET ERREICHT WELCHES DOKUMENT ═════════════════════════════════════
// 💣 Genau daran ist Aufgabe 3 einmal gescheitert: die `.label-wiki-*`-Regeln stehen in
// region-sync.css und die laedt NUR index.html; die `.dt-*`-Regeln stehen in editor-page.css und
// die laedt nur das iframe. Eine Huelle im falschen Dokument ist nicht „etwas anders", sondern
// voellig ungestylt -- und keine Ablaufprobe der Welt sieht das, weil im Sandkasten kein CSS gilt.
// ⚠️ Das ist die eine Frage, die eine Textprobe WIRKLICH beantworten kann: welche Datei ein
// Dokument bindet. Ueber die Regeln selbst sagt sie nichts -- die zaehlt
// js/ui/__tests__/wiki-assign-weg.test.js je Rolle beider Huellen nach.
// 🪤 GEPRUEFT WIRD DIE `<link>`-ZEILE, NICHT DER DATEINAME. Die erste Fassung suchte schlicht nach
// „editor-page.css" -- und blieb gruen, als die Mutation die Zeile ENTFERNTE: der Name steht im
// selben Dokument noch viermal in KOMMENTAREN. Dieselbe Blindheit wie in Aufgabe 4, wo eine
// CSS-Kommentarzeile die Probe gefuettert hat.
function bindetStylesheet(inhalt, datei) {
	return new RegExp('<link[^>]+href="[^"]*' + datei.replace(/\./g, "\\.") + '[^"]*"').test(inhalt);
}
assert.ok(bindetStylesheet(indexHtmlRoh, "components/region-sync.css"),
	"index.html bindet region-sync.css nicht -- die Huelle „label-wiki“ des Kartendialogs waere ungestylt");
assert.ok(bindetStylesheet(editorHtmlRoh, "components/editor-page.css"),
	"der Orte-Editor bindet editor-page.css nicht -- die Huelle „dt“ waere dort ungestylt");
// Und die Gegenrichtung: keins der zwei Dokumente bindet das Stylesheet des anderen, es gibt also
// keinen stillen Rueckfall, der eine falsche Huelle trotzdem passabel aussehen liesse.
assert.ok(!bindetStylesheet(editorHtmlRoh, "components/region-sync.css"), "der Orte-Editor bindet region-sync.css mit");
zaehl(); zaehl(); zaehl();

// ══ TEIL 3+4: die zwei Oberflaechen, WIRKLICH gefahren ════════════════════════════════════════

/** Ein Behaelter, der Klicks wirklich ausloest (Vorbild: js/ui/__tests__/wiki-assign-weg.test.js). */
function scheinBehaelter(id) {
	const zuhoerer = {};
	return {
		id: id || "host", textContent: "", innerHTML: "", className: "", value: "",
		dataset: {}, style: {}, options: [], hidden: false, disabled: false,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		contains() { return true; },
		// Der Orte-Editor baut seine Listen mit appendChild -- ohne diese Handvoll faellt sein
		// Selbststart um, bevor die Zuweisung ueberhaupt drankommt.
		appendChild() {}, removeChild() {}, remove() {}, insertBefore() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, focus() {}, dispatchEvent() { return true; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
		feuere(typ, ziel) { if (zuhoerer[typ]) { zuhoerer[typ]({ target: ziel, preventDefault() {} }); } },
	};
}

/** Ein Ereignisziel mit GENAU einem Merkmal -- `aufKlick` fragt nacheinander nach zwei Selektoren. */
function scheinZiel(merkmal, wert, zusatz) {
	const element = Object.assign({
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	}, zusatz || {});
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

/** Ein Formularfeld mit Wert (Namensfeld, Auswahlliste, verstecktes Feld). */
function scheinFeld(wert, optionen) {
	return {
		value: wert === undefined ? "" : wert,
		options: (optionen || []).map((v) => ({ value: v })),
		checked: false, disabled: false, hidden: false, textContent: "", innerHTML: "", className: "",
		dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
		setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
		focus() {}, dispatchEvent() { return true; }, contains() { return false; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
	};
}

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 5));

/**
 * Ein Sandkasten mit Dokument-Attrappe und aufgezeichnetem `fetch`.
 * `behaelterIds` bekommen einen klickfaehigen Behaelter, alles andere ein Formularfeld.
 */
function sandkastenBauen(dateien, felder, behaelterIds, fetchAntwort) {
	const elemente = {};
	Object.keys(felder || {}).forEach((id) => { elemente[id] = felder[id]; });
	(behaelterIds || []).forEach((id) => { elemente[id] = scheinBehaelter(id); });
	const gesendet = [];
	const dokument = {
		readyState: "complete",
		// ⚠️ `hasOwnProperty`, nicht `!elemente[id]`: ein ausdruecklich auf `null` gesetzter Eintrag
		// heisst „dieses Element gibt es NICHT" -- und genau damit wird der Fehlerpfad gefahren.
		// Mit der Wahrheitswert-Pruefung legte die Attrappe stattdessen ein neues Feld an, und der
		// Riegel, den die Probe darunter sucht, kaeme nie zum Zug.
		getElementById(id) {
			if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = scheinFeld(""); }
			return elemente[id];
		},
		querySelector() { return scheinFeld(""); },
		querySelectorAll() { return []; },
		createElement() { return scheinFeld(""); },
		addEventListener() {},
		body: scheinFeld(""), documentElement: scheinFeld(""),
	};
	const kasten = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
		String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, Promise, isFinite, isNaN,
		parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Event: function () {},
		document: dokument,
		location: { href: "http://pruefstand.local/html/wiki-sync-settlement-editor.html" },
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		confirm: () => true,
		apiErrorMessage: (antwort, rueckfall) => rueckfall,
		showFeedbackToast: () => {},
		fetch(url, opt) {
			const rumpf = opt && opt.body ? JSON.parse(opt.body) : null;
			gesendet.push({ url: String(url), rumpf: rumpf, methode: (opt && opt.method) || "GET" });
			const antwort = fetchAntwort(String(url), rumpf);
			return Promise.resolve({ ok: antwort.httpOk !== false, status: antwort.status || 200, json: () => Promise.resolve(antwort) });
		},
		gemounted: [],
	};
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	dateien.forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	return { kasten: kasten, elemente: elemente, gesendet: gesendet };
}

/**
 * 🔴 DIE SKRIPTLISTE WIRD AUS DEM DOKUMENT GELESEN, NICHT HIER AUFGEZAEHLT.
 *
 * 💣 Sonst prueft der Sandkasten nur sich selbst: er laedt das Bauteil, weil er es aufzaehlt, und
 * eine im Dokument VERGESSENE `<script>`-Zeile bliebe unsichtbar -- live gaebe `mount` dann einen
 * Blindgaenger. Die Ladereihenfolge ist Vertrag (Register, Diff, Bauteil, Datenweg); dass sie
 * eingehalten wird, kann nur eine Probe sehen, die sie aus der Datei nimmt.
 * ⚠️ Nur Dateien, die es im Baum gibt -- index.html verweist auch auf Fremdes.
 */
function skripteAus(htmlDatei, muster) {
	const inhalt = fs.readFileSync(path.join(wurzel, htmlDatei), "utf8");
	const treffer = inhalt.match(/<script[^>]+src="([^"]+)"/g) || [];
	return treffer
		.map((tag) => (/src="([^"]+)"/.exec(tag) || [])[1] || "")
		.map((src) => src.replace(/^\//, "").split("?")[0])
		.filter((src) => (muster ? muster.test(src) : true))
		.filter((src) => fs.existsSync(path.join(wurzel, src)));
}

(async () => {
	// ══ TEIL 3: DER KARTENDIALOG („Ort bearbeiten") ═══════════════════════════════════════════
	const felder = {
		"location-edit-name": scheinFeld("Havena (alt)"),
		"location-edit-type": scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
		"location-edit-wiki-url": scheinFeld("https://de.wiki-aventurica.de/wiki/Havena_(Andergast)"),
		"location-edit-description": scheinFeld("Alte Beschreibung."),
		// Die drei neuen Kartenfelder (Aufgabe 5b) -- leer, wie bei einem Ort, den noch niemand
		// gesynct hat.
		"location-edit-einwohner": scheinFeld(""),
		"location-edit-lage": scheinFeld(""),
		"location-edit-oberhaupt": scheinFeld(""),
	};
	// Die vier Zeilen aus index.html, in DEREN Reihenfolge -- fehlt eine, liefert `mount` unten
	// einen Blindgaenger und die erste Zusicherung faellt um.
	const dialogSkripte = skripteAus("index.html", /wiki-assign|review-settlement-wiki/);
	// ⚠️ `wiki-assign-weg.js` und `wiki-assign-landschaft.js` stehen mit in der Liste -- es sind die
	// Datenwege der NACHBAR-Objektarten und haengen von nichts ab; mitgeladen schaden sie nicht und
	// die Reihenfolge bleibt pruefbar.
	// 🪤 Diese Zusicherung ist am 16.08.2026 UMGEFALLEN, als Aufgabe 6 eine Zeile ergaenzte -- der
	// gewollte Fall, und genau deshalb steht hier eine Liste und keine Teilmengen-Pruefung: eine
	// zusaetzliche Zeile soll GESEHEN werden. Wer sie ergaenzt, prueft, ob die drei Voraussetzungen
	// (Register, Diff, Bauteil) weiterhin VOR jedem Datenweg stehen.
	assert.deepStrictEqual(dialogSkripte, [
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-weg.js", "js/ui/wiki-assign-ort.js", "js/ui/wiki-assign-landschaft.js",
		"js/ui/wiki-assign-territorium.js",
		"js/review/review-settlement-wiki.js",
	], "index.html bindet die Wiki-Zuweisung nicht (oder in der falschen Reihenfolge): " + dialogSkripte.join(" "));
	zaehl();

	const k = sandkastenBauen(dialogSkripte, felder,
		["settlement-wiki-assign-host"],
		(url, rumpf) => {
			if (rumpf && rumpf.action === "assign_to") {
				return { ok: true, wiki_name: "Havena", revision: 4711, settlement: SIEDLUNG };
			}
			if (rumpf && rumpf.action === "clear_assign") {
				return { ok: true, revision: 4712 };
			}
			return { ok: true, query: "", rows: [SUCHZEILE] };
		});
	vm.runInContext("var locationEditMarkerEntry = { publicId: 'loc-1', name: 'Havena (alt)',"
		+ " location: { name: 'Havena (alt)' } };"
		+ "var locationEditPendingWikiSettlement = null;"
		+ "var setLocationEditSizeAufrufe = [];"
		+ "function setLocationEditSize(wert) { setLocationEditSizeAufrufe.push(wert);"
		+ " document.getElementById('location-edit-type').value = wert; }", k.kasten);

	const host = k.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", k.kasten);
	await ruhe();
	assert.ok(host.innerHTML.indexOf("Wiki-Ort") !== -1, "der Kasten traegt die Ueberschrift der Erklaerung: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf("— keine —") !== -1, "ohne Zuweisung steht „— keine —“ da");
	// Die Huelle „label-wiki", nicht „dt" -- index.html laedt region-sync.css, nicht
	// editor-page.css; mit der falschen Huelle staende der Kasten voellig ungestylt im Dialog.
	assert.ok(host.innerHTML.indexOf("label-wiki-reference") !== -1 && host.innerHTML.indexOf("dt-grp") === -1,
		"der Kartendialog mountet die falsche Huelle: " + host.innerHTML);
	zaehl(); zaehl(); zaehl();

	// ---- Suchen -------------------------------------------------------------------------------
	host.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	const suchAufruf = k.gesendet.filter((s) => s.url.indexOf("action=search") !== -1)[0];
	assert.ok(suchAufruf, "es wurde gar nicht gesucht: " + JSON.stringify(k.gesendet));
	assert.ok(/\/api\/edit\/wiki\/settlements\.php\?action=search&q=&limit=40$/.test(suchAufruf.url),
		"die Suche fragt nicht die gemessene Adresse ab: " + suchAufruf.url);
	// Die Trefferzeile: Name plus die EINZIGE Angabe, die die Suche liefert.
	assert.ok(host.innerHTML.indexOf("Havena") !== -1, host.innerHTML);
	assert.ok(host.innerHTML.indexOf("Großstadt") !== -1,
		"die Meta-Zeile des Treffers ist leer -- die flachen Antwortzeilen kommen unaufbereitet an: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Null Treffer: der Leerzustand sagt, was zu TUN ist ------------------------------------
	// 🔴 Der alte Picker schrieb „Keine Treffer in der Registry. Ggf. erst die Orte-Sync laufen
	// lassen." -- die HANDLUNGSANWEISUNG ist der Teil, der zaehlt: die Ortssuche liest die Registry,
	// nicht das Wiki. Ohne sie sagt der Kasten nur, DASS nichts da ist.
	// 💣 An BEIDEN Stellen geprueft: der Leerkasten traegt `role="presentation"` und ist fuer
	// Hilfsmittel unsichtbar -- dort erreicht der Rat nur ueber den Zaehlsatz darunter.
	const kLeerTreffer = sandkastenBauen(dialogSkripte,
		{
			"location-edit-name": scheinFeld("Havena"),
			"location-edit-type": scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
			"location-edit-wiki-url": scheinFeld(""),
		},
		["settlement-wiki-assign-host"],
		(url, rumpf) => (rumpf ? { ok: true } : { ok: true, query: "", rows: [] }));
	vm.runInContext("var locationEditMarkerEntry = { publicId: 'loc-2', location: {} };"
		+ "var locationEditPendingWikiSettlement = null;", kLeerTreffer.kasten);
	const hostLeer = kLeerTreffer.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", kLeerTreffer.kasten);
	await ruhe();
	hostLeer.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	assert.ok(hostLeer.innerHTML.indexOf("Keine Treffer. Ggf. erst die Orte-Sync laufen lassen.") !== -1,
		"der Leerkasten sagt nicht mehr, was zu tun ist: " + hostLeer.innerHTML);
	assert.ok(/data-wa-hinweis[^>]*>Keine Treffer · Ggf\. erst die Orte-Sync laufen lassen\./.test(hostLeer.innerHTML),
		"der Rat fehlt im Zaehlsatz -- fuer Hilfsmittel ist er damit gar nicht da: " + hostLeer.innerHTML);
	zaehl(); zaehl();

	// ⚠️ Und NIE beim Suchfehler: „Suche fehlgeschlagen. Ggf. erst die Orte-Sync laufen lassen."
	// waere bei einem 403 ein falscher Rat.
	const kFehler = sandkastenBauen(dialogSkripte,
		{
			"location-edit-name": scheinFeld("Havena"),
			"location-edit-type": scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
		},
		["settlement-wiki-assign-host"],
		() => ({ httpOk: false, status: 403 }));
	vm.runInContext("var locationEditMarkerEntry = { publicId: 'loc-3', location: {} };"
		+ "var locationEditPendingWikiSettlement = null;", kFehler.kasten);
	const hostFehler = kFehler.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", kFehler.kasten);
	await ruhe();
	hostFehler.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	assert.ok(hostFehler.innerHTML.indexOf("Suche fehlgeschlagen") !== -1, hostFehler.innerHTML);
	assert.ok(hostFehler.innerHTML.indexOf("Orte-Sync") === -1,
		"ein Suchfehler bekommt den Registry-Rat -- das schickt den Editor in den falschen Ablauf: " + hostFehler.innerHTML);
	zaehl(); zaehl();

	// ---- Waehlen: der Rumpf, und die Anreicherung ---------------------------------------------
	host.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	const zuweisung = k.gesendet.filter((s) => s.rumpf && s.rumpf.action === "assign_to")[0];
	assert.ok(zuweisung, "es wurde nichts zugewiesen: " + JSON.stringify(k.gesendet.map((s) => s.rumpf)));
	// 🔴 DIE FALLE DES ORTS: der TITEL adressiert, nicht der Schluessel.
	assert.strictEqual(zuweisung.rumpf.title, "Havena",
		"der Ort wird nicht ueber seinen Titel adressiert -- assign_to schlaegt genau darueber nach");
	assert.ok(!("wiki_key" in zuweisung.rumpf), "ein wiki_key im Rumpf ist der abgeschriebene Weg-Rumpf");
	assert.strictEqual(zuweisung.rumpf.public_id, "loc-1");
	assert.strictEqual(zuweisung.rumpf.dry_run, false);
	assert.strictEqual(zuweisung.rumpf.confirm, "apply");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// 💣 Der Kasten zeigt die Infoboxwerte, obwohl die SUCHE keine geliefert hat.
	assert.ok(host.innerHTML.indexOf("Einwohner") !== -1 && host.innerHTML.indexOf("9.400") !== -1,
		"der Zuweisungskasten zeigt nach der Wahl keine Infoboxwerte -- die Anreicherung kam nicht an: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf("Gräfin Yppolita") !== -1, host.innerHTML);
	assert.ok(host.innerHTML.indexOf("Hafenstadt") !== -1, host.innerHTML);
	// Leere Felder fallen weg -- SIEDLUNG traegt keine, also steht auch keine leere Zeile da.
	assert.ok(host.innerHTML.indexOf('data-wa-aktion="sync"') !== -1, "ohne Sync-Knopf gaebe es nichts ins Formular zu holen");
	zaehl(); zaehl(); zaehl(); zaehl();

	// Das versteckte wiki_url-Feld wurde mitgezogen (Discord #38, unveraendert gueltig).
	assert.strictEqual(felder["location-edit-wiki-url"].value, SIEDLUNG.wiki_url,
		"das versteckte wiki_url-Feld traegt noch die alte Adresse -- das naechste Speichern schriebe sie zurueck");
	// 💣 assign_to loescht die Beschreibung serverseitig; bliebe sie im Feld, schriebe das naechste
	// Speichern sie zurueck.
	assert.strictEqual(felder["location-edit-description"].value, "",
		"die Beschreibung steht noch im Formular, obwohl der Server sie gerade geloescht hat");
	zaehl(); zaehl();

	// ---- Sync: EINE Zeile ungehakt lassen -----------------------------------------------------
	// 🔴 FUENF Zeilen seit Aufgabe 5b. Genau der Handgriff, den Aufgabe 5 als „nicht ausfuehrbar"
	// melden musste: „syncen und die Einwohnerzahl ungehakt lassen" -- damals hatte sie kein
	// Kartenfeld und war gar nicht anhakbar. Hier wird sie ANGEHAKT uebernommen und die Ortsgroesse
	// abgehakt; die Gegenprobe („Einwohnerzahl abgehakt") steht gleich darunter.
	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(host.innerHTML.indexOf("5 von 5 Angaben würden sich ändern") !== -1,
		"die Sync-Vorschau zaehlt falsch: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf("Havena (alt)") !== -1 && host.innerHTML.indexOf("grossstadt") !== -1, host.innerHTML);
	assert.ok(host.innerHTML.indexOf("9.400") !== -1 && host.innerHTML.indexOf("Albernia · Mittelreich") !== -1,
		"die drei neuen Kartenfelder stehen nicht in der Vorschau: " + host.innerHTML);
	// 🔴 DER KNOPFTEXT ZAEHLT DIE HAKEN, und seit dem Owner-Entscheid sind das DREI von fuenf: Name
	// und Ortsgroesse sind auf der Karte gefuellt und starten ungehakt, die drei leeren Felder nicht.
	// Hier stand „5 Angaben übernehmen".
	assert.ok(host.innerHTML.indexOf(">3 Angaben übernehmen<") !== -1,
		"der Knopf zaehlt nicht die tatsaechlich angehakten Zeilen: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();
	// Den Namen ausdruecklich ANhaken (er startet jetzt ungehakt), die Ortsgroesse ungehakt lassen.
	// ⚠️ Das ist die Umkehrung der alten Probe -- und die bessere: sie faehrt BEIDE Richtungen des
	// Haekchens, nicht nur das Abhaken.
	host.feuere("change", scheinZiel("data-wa-sync-haken", "0", { checked: true }));
	await ruhe();
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(felder["location-edit-name"].value, "Havena", "der angehakte Name wurde nicht uebernommen");
	assert.strictEqual(felder["location-edit-type"].value, "dorf",
		"die ABGEHAKTE Ortsgroesse wurde trotzdem uebernommen -- ein Haken, der nichts bedeutet");
	assert.strictEqual(vm.runInContext("setLocationEditSizeAufrufe.length", k.kasten), 0,
		"die Ortsgroesse wurde gesetzt, obwohl ihre Zeile abgehakt war");
	// 🔴 Und die drei neuen Felder sind WIRKLICH gefuellt worden -- nicht bloss angeboten.
	assert.strictEqual(felder["location-edit-einwohner"].value, "9.400",
		"die angehakte Einwohnerzahl ist nicht im Formular angekommen");
	assert.strictEqual(felder["location-edit-lage"].value, "Albernia · Mittelreich");
	assert.strictEqual(felder["location-edit-oberhaupt"].value, "Gräfin Yppolita");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Sync ein zweites Mal: jetzt bleibt genau die eine Zeile, und sie geht durch den Setzer -
	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(host.innerHTML.indexOf("1 von 5 Angaben würde sich ändern") !== -1,
		"die zweite Vorschau kennt den frisch uebernommenen Stand nicht -- die Kartenwerte sind eingefroren: " + host.innerHTML);
	// 🔴 Und sie ist UNGEHAKT (die Ortsgroesse „dorf" ist gefuellt), der Uebernehmen-Knopf also
	// abgeschaltet -- „0 Angaben übernehmen". Ohne das Anhaken darunter passierte gar nichts.
	assert.ok(host.innerHTML.indexOf(">0 Angaben übernehmen<") !== -1
		&& /data-wa-aktion="sync-uebernehmen" disabled/.test(host.innerHTML),
		"eine Zeile auf einem gefuellten Kartenwert startet gehakt (oder der Knopf ist nicht abgeschaltet): " + host.innerHTML);
	host.feuere("change", scheinZiel("data-wa-sync-haken", "0", { checked: true }));
	await ruhe();
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	// 🔴 setLocationEditSize, nicht `select.value = …`: an der Ortsgroesse haengt die Sperre des
	// Feldes „Art" (place_kind), und ein programmatisches Setzen feuert kein change-Ereignis.
	// ⚠️ Ueber JSON verglichen: eine Liste aus dem Sandkasten hat einen ANDEREN Array-Prototyp, und
	// deepStrictEqual faellt daran, nicht am Inhalt.
	assert.strictEqual(vm.runInContext("JSON.stringify(setLocationEditSizeAufrufe)", k.kasten), '["grossstadt"]',
		"die Ortsgroesse wurde am einzigen Setzer vorbei geschrieben -- die place_kind-Sperre bliebe falsch");
	assert.strictEqual(felder["location-edit-type"].value, "grossstadt");
	zaehl(); zaehl(); zaehl();

	// ---- KEINE HALBE UEBERNAHME ---------------------------------------------------------------
	// 🔴 Schlaegt die Pruefung der Ortsgroesse fehl, darf der Name NICHT schon geschrieben sein: das
	// Bauteil liest die Ablehnung als „es ist nichts passiert" und laesst die Vorschau samt Haken
	// stehen -- der Editor saehe eine unveraenderte Vorschau ueber einem veraenderten Formular.
	// 💣 Erreichbar gemacht, indem die Auswahlliste die Ortsgroesse NICHT fuehrt -- genau der
	// Zustand, den ein siebter Schluessel in nur einer der zwei Oberflaechen erzeugt.
	const kHalb = sandkastenBauen(dialogSkripte,
		{
			"location-edit-name": scheinFeld("Havena (alt)"),
			// Ohne „grossstadt": die Uebernahme MUSS daran scheitern.
			"location-edit-type": scheinFeld("dorf", ["dorf", "kleinstadt"]),
			"location-edit-wiki-url": scheinFeld(""),
			"location-edit-einwohner": scheinFeld(""),
			"location-edit-lage": scheinFeld(""),
			"location-edit-oberhaupt": scheinFeld(""),
		},
		["settlement-wiki-assign-host"],
		(url, rumpf) => (rumpf && rumpf.action === "assign_to"
			? { ok: true, wiki_name: "Havena", settlement: SIEDLUNG }
			: { ok: true, query: "", rows: [SUCHZEILE] }));
	vm.runInContext("var locationEditMarkerEntry = { publicId: 'loc-4', location: {} };"
		+ "var locationEditPendingWikiSettlement = null;", kHalb.kasten);
	const hostHalb = kHalb.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", kHalb.kasten);
	await ruhe();
	hostHalb.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	hostHalb.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	hostHalb.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(hostHalb.innerHTML.indexOf("5 von 5 Angaben würden sich ändern") !== -1, hostHalb.innerHTML);
	// 🔴 Die Ortsgroesse ausdruecklich ANhaken -- seit dem Owner-Entscheid startet sie ungehakt (der
	// Kartenwert „dorf" ist gefuellt), und ohne den Haken kaeme die Ablehnung gar nicht zustande: die
	// Probe liefe an ihrem Gegenstand vorbei und waere gruen, ohne irgendetwas zu belegen.
	hostHalb.feuere("change", scheinZiel("data-wa-sync-haken", "1", { checked: true }));
	await ruhe();
	hostHalb.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(kHalb.elemente["location-edit-name"].value, "Havena (alt)",
		"der Name wurde geschrieben, obwohl die Ortsgroesse danach abgelehnt hat -- eine halbe Uebernahme, "
		+ "die sich dem Bauteil gegenueber als gar keine ausgibt");
	// 🔴 UND DIE DREI NEUEN GENAUSO. Mit fuenf Zielen hat „halb" jetzt vier Formen statt einer: die
	// Pruefung MUSS vor jedem einzelnen Schreibvorgang stehen, nicht nur vor dem Namen.
	assert.strictEqual(kHalb.elemente["location-edit-einwohner"].value, "",
		"die Einwohnerzahl wurde geschrieben, obwohl die Ortsgroesse danach abgelehnt hat");
	assert.strictEqual(kHalb.elemente["location-edit-lage"].value, "");
	assert.strictEqual(kHalb.elemente["location-edit-oberhaupt"].value, "");
	// Und die Vorschau steht noch -- das Bauteil hat die Ablehnung richtig verstanden.
	assert.ok(hostHalb.innerHTML.indexOf("data-wa-sync-haken") !== -1,
		"die Sync-Vorschau ist trotz Ablehnung geschlossen: " + hostHalb.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Entfernen ----------------------------------------------------------------------------
	host.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	const loesung = k.gesendet.filter((s) => s.rumpf && s.rumpf.action === "clear_assign")[0];
	assert.ok(loesung, "es wurde nichts geloest");
	assert.strictEqual(loesung.rumpf.public_id, "loc-1");
	assert.strictEqual(loesung.rumpf.confirm, "apply");
	assert.strictEqual(felder["location-edit-wiki-url"].value, "",
		"das versteckte wiki_url-Feld wurde nicht mitgeleert -- der Auto-Connect stellte die Verbindung beim naechsten Speichern wieder her");
	assert.ok(host.innerHTML.indexOf("— keine —") !== -1, "nach dem Entfernen steht die Zuweisung noch da: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Ein NEIN des Servers laesst alles stehen ---------------------------------------------
	// 🔴 Ohne Ablehnungszweig malte das Bauteil eine Zuweisung, die es auf dem Server nicht gibt.
	const kNein = sandkastenBauen(dialogSkripte,
		{
			"location-edit-name": scheinFeld("Havena"),
			"location-edit-type": scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
			"location-edit-wiki-url": scheinFeld(""),
		},
		["settlement-wiki-assign-host"],
		(url, rumpf) => (rumpf ? { ok: false, error: { message: "Wiki-Seite nicht gefunden" } } : { ok: true, rows: [SUCHZEILE] }));
	vm.runInContext("var locationEditMarkerEntry = { publicId: 'loc-9', location: {} };"
		+ "var locationEditPendingWikiSettlement = null;", kNein.kasten);
	const hostNein = kNein.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", kNein.kasten);
	await ruhe();
	hostNein.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	hostNein.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	// Der Knopf „Entfernen" gibt es NUR im Zustand „zugewiesen" -- er ist damit die genaueste Probe
	// darauf, ob das Bauteil eine Zuweisung gemalt hat, die es auf dem Server nicht gibt.
	assert.ok(hostNein.innerHTML.indexOf('data-wa-aktion="entfernen"') === -1,
		"nach einem abgelehnten Zuweisen steht eine Zuweisung im Kasten: " + hostNein.innerHTML);
	assert.ok(hostNein.innerHTML.indexOf("Schlüssel") === -1, hostNein.innerHTML);
	assert.strictEqual(kNein.elemente["location-edit-wiki-url"].value, "",
		"ein abgelehntes Zuweisen hat trotzdem ins versteckte Feld geschrieben");
	zaehl(); zaehl();

	// ---- Der Vertrag, durch die ECHTE Oberflaeche hindurch -------------------------------------
	// 💣 Nicht am Bauer geprueft, sondern an der VERDRAHTUNG: der geteilte Zustandsbauer wird zum
	// Werfen gebracht (das Formular fehlt), und der Fehler MUSS durch die Oberflaeche kommen. Ein
	// `try { … } catch { return {}; }` an JEDER Stelle von settlementWikiZustand faellt hier um.
	const kLeer = sandkastenBauen(dialogSkripte, {},
		["settlement-wiki-assign-host"], () => ({ ok: true, rows: [] }));
	vm.runInContext("var locationEditMarkerEntry = null; var locationEditPendingWikiSettlement = null;", kLeer.kasten);
	// Ohne Formularfelder: `document.getElementById` liefert Attrappen, deshalb werden die zwei
	// Pflichtfelder ausdruecklich auf `null` gesetzt.
	kLeer.elemente["location-edit-name"] = null;
	kLeer.elemente["location-edit-type"] = null;
	assert.throws(() => vm.runInContext("settlementWikiZustand()", kLeer.kasten),
		"der Kartendialog liefert ohne Formular einen Zustand, statt zu werfen -- das Bauteil hielte sich fuer geladen");
	zaehl();
	// 🪤 UND DIE SCHAERFERE FASSUNG, weil die obige NICHT reicht: sie erreicht nur die fruehe Wache
	// („kein Formular"), und ein `try { … } catch { return {}; }` um den UNTEREN Teil von
	// settlementWikiZustand blieb damit gruen -- genau die halbe Blindheit, die Aufgabe 4 in ihrer
	// Nachbesserung gemessen hat. Deshalb wird hier der GETEILTE Bauer zum Werfen gebracht: sein
	// Fehler muss durch die Oberflaeche hindurch, und das faengt ein `catch` an JEDER Stelle.
	vm.runInContext("var echterOrtZustand = avesmapsWikiAssignOrtZustand;"
		+ "avesmapsWikiAssignOrtZustand = function () { throw new Error('BAUER WIRFT'); };", k.kasten);
	assert.throws(() => vm.runInContext("settlementWikiZustand()", k.kasten), /BAUER WIRFT/,
		"der Kartendialog schluckt einen Fehler des geteilten Zustandsbauers");
	vm.runInContext("avesmapsWikiAssignOrtZustand = echterOrtZustand;", k.kasten);
	zaehl();
	// Und was daraus ueber `mount` folgt: nicht bereit, kein Schreibwert.
	const steuerung = avesmapsWikiAssignMount(scheinBehaelter("x"), {
		subject: "ort", skin: "label-wiki",
		laden: () => { throw new Error("kein Ort"); },
	});
	await steuerung.neuLaden();
	assert.strictEqual(steuerung.bereit, false);
	assert.strictEqual(steuerung.lies(), null);
	const steuerung2 = avesmapsWikiAssignMount(scheinBehaelter("y"), {
		subject: "ort", skin: "dt",
		laden: () => Promise.reject(new Error("HTTP 500")),
	});
	await steuerung2.neuLaden();
	assert.strictEqual(steuerung2.bereit, false);
	assert.strictEqual(steuerung2.lies(), null);
	zaehl(); zaehl(); zaehl(); zaehl();

	// ══ TEIL 4: DER ORTE-EDITOR (html/wiki-sync-settlement-editor.html) ═══════════════════════
	// Das Fenster ist eine HTML-Seite mit EINEM grossen Inline-Skript; es wird hier unveraendert
	// aus der Datei geschnitten und im Sandkasten gefahren -- dieselbe Bauart wie beim Wege-Editor
	// (dort lag das Skript nur schon als eigene Datei vor).
	// ⚠️ `\r?\n`: die Datei liegt im Arbeitsbaum mit CRLF (git normalisiert erst beim Commit,
	// .gitattributes `* text=auto`). Ein Schnitt auf `<script>\n` findet auf einem Windows-Checkout
	// GAR NICHTS -- und ohne die Zusicherung darunter waere das ein leeres, gruen laufendes Skript.
	const editorHtml = fs.readFileSync(path.join(wurzel, "html/wiki-sync-settlement-editor.html"), "utf8");
	const skriptTeile = editorHtml.split(/<script>\r?\n/);
	const editorSkript = skriptTeile[skriptTeile.length - 1].split("</script>")[0];
	assert.ok(editorSkript.indexOf("function mountSettlementWikiAssign") !== -1,
		"der Schnitt hat das falsche Skript erwischt");
	zaehl();

	const eFelder = {
		dtEditName: scheinFeld("Havena (alt)"),
		dtEditType: scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
		dtEditMsg: scheinFeld(""),
		// Das flache, sichtbare (readonly) Wiki-Adressfeld ueber dem Kasten -- NICHT die Zuweisung,
		// aber es reist bei jedem Speichern mit. Startwert: eine alte, falsche Adresse.
		dtEditWikiUrl: scheinFeld("https://de.wiki-aventurica.de/wiki/Havena_(Andergast)"),
		// Die drei neuen Kartenfelder (Aufgabe 5b) -- leer, wie bei einem ungesyncten Ort.
		dtEditEinwohner: scheinFeld(""),
		dtEditLage: scheinFeld(""),
		dtEditOberhaupt: scheinFeld(""),
	};
	// 🔴 DIE ATTRAPPE MODELLIERT DEN NEUAUFBAU DES FORMULARS. `renderSettlementDetail` baut
	// #seDetailBody per innerHTML neu, und `buildSettlementEditFormHtml` schreibt dabei den ROHEN
	// Spaltenwert `props.wiki_url` frisch in ein neues `#dtEditWikiUrl`. Ohne dieses Modell wuerde
	// eine Zuweisung, die das Feld VOR dem Neuaufbau setzt, in der Probe faelschlich bestehen --
	// live waere ihr Wert weg.
	// 💣 Und der rohe Wert ist NICHT leer: weder `assign_to` noch `clear_assign` fassen
	// `properties.wiki_url` an (settlements.php:840-844 / :884), der Neuaufbau holt also genau die
	// Adresse zurueck, die vorher dort stand. Ein leeres Modell haette die Entfernen-Probe blind
	// gemacht -- sie waere auch ohne das Mitleeren gruen gewesen (gemessen).
	let roheAdresse = "https://de.wiki-aventurica.de/wiki/Havena_(Andergast)";
	// 🔴 Auch hier kommt die Skriptliste AUS DEM DOKUMENT, in dessen Reihenfolge -- fehlt eine der
	// vier Zeilen der Wiki-Zuweisung, liefert `mount` unten einen Blindgaenger.
	const editorSkripte = skripteAus("html/wiki-sync-settlement-editor.html");
	assert.deepStrictEqual(
		editorSkripte.filter((src) => /wiki-assign/.test(src)),
		["js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js", "js/ui/wiki-assign-ort.js"],
		"der Orte-Editor bindet die Wiki-Zuweisung nicht (oder in der falschen Reihenfolge)"
	);
	zaehl();
	const e = sandkastenBauen(
		editorSkripte,
		eFelder, ["dtWikiAssign", "seDetailBody", "seList", "seTree"],
		(url, rumpf) => {
			if (rumpf && rumpf.action === "assign_to") {
				return { ok: true, wiki_name: "Havena", revision: 4711, settlement: SIEDLUNG };
			}
			if (rumpf && rumpf.action === "clear_assign") {
				return { ok: true, revision: 4712 };
			}
			if (url.indexOf("action=settlement_detail") !== -1) {
				// Der Neuaufbau belegt das flache Feld aus der ROHEN Spalte neu -- siehe oben.
				eFelder.dtEditWikiUrl.value = roheAdresse;
				return { ok: true, detail: { public_id: "loc-1", name: "Havena (alt)", feature_subtype: "dorf", on_map: true, properties: {} } };
			}
			if (url.indexOf("action=search") !== -1) {
				return { ok: true, query: "", rows: [SUCHZEILE] };
			}
			return { ok: true, items: [], nodes: [], synced: {} };
		});
	vm.runInContext(editorSkript, e.kasten, { filename: "html/wiki-sync-settlement-editor.html" });
	await ruhe();

	// 🔴 Ueber den ECHTEN Weg, nicht per Direktaufruf: einen Ort auswaehlen laesst
	// renderSettlementDetail das Panel bauen UND das Bauteil einhaengen. Eine Probe, die
	// mountSettlementWikiAssign() selbst ruft, bliebe gruen, wenn die Verdrahtung fehlt -- gemessen
	// (Mutation „Editor mountet gar nicht" lief gegen die erste Fassung gruen durch).
	vm.runInContext("selectedPublicId = 'loc-1'; renderSettlementDetail('loc-1');", e.kasten);
	await ruhe();
	const eHost = e.elemente.dtWikiAssign;
	assert.ok(vm.runInContext("$('seDetailBody').innerHTML", e.kasten).indexOf('id="dtWikiAssign"') !== -1,
		"das Panel traegt den Behaelter der Zuweisung nicht");
	assert.ok(eHost.innerHTML.indexOf("avm-wiki-assign") !== -1,
		"renderSettlementDetail haengt das Bauteil nicht ein: " + eHost.innerHTML);
	// Die Huelle „dt", nicht „label-wiki" -- das Editorfenster laedt editor-page.css, nicht
	// region-sync.css; mit der falschen Huelle staende der Kasten voellig ungestylt da.
	assert.ok(eHost.innerHTML.indexOf("dt-grp") !== -1 && eHost.innerHTML.indexOf("label-wiki") === -1,
		"der Orte-Editor mountet die falsche Huelle: " + eHost.innerHTML);
	assert.ok(eHost.innerHTML.indexOf("— keine —") !== -1, eHost.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	eHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	eHost.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	const eZuweisung = e.gesendet.filter((s) => s.rumpf && s.rumpf.action === "assign_to")[0];
	assert.ok(eZuweisung, "der Orte-Editor hat nichts zugewiesen: " + JSON.stringify(e.gesendet.map((s) => s.rumpf)));
	assert.strictEqual(eZuweisung.rumpf.title, "Havena", "auch hier adressiert der TITEL");
	assert.ok(!("wiki_key" in eZuweisung.rumpf));
	assert.strictEqual(eZuweisung.rumpf.public_id, "loc-1");
	assert.strictEqual(eZuweisung.rumpf.confirm, "apply");
	// 💣 Danach wird das Panel neu geladen -- sonst stuende die serverseitig geloeschte Beschreibung
	// noch im Textfeld und das naechste Speichern schriebe sie zurueck.
	assert.ok(e.gesendet.some((s) => s.url.indexOf("action=settlement_detail") !== -1),
		"nach dem Zuweisen wird das Panel nicht neu geladen");
	// 🔴 UND DAS FLACHE `wiki_url`-FELD IST MITGEZOGEN -- Discord #38 in der neuen Haelfte.
	// 💣 Diese Zusicherung prueft zugleich die REIHENFOLGE: die Dokument-Attrappe setzt das Feld bei
	// jeder settlement_detail-Antwort auf den rohen Serverwert zurueck (leer, weil assign_to das
	// flache Feld nicht anfasst). Wer es VOR `reloadSettlementDetail()` schreibt, findet hier "".
	assert.strictEqual(eFelder.dtEditWikiUrl.value, SIEDLUNG.wiki_url,
		"der Orte-Editor zieht das flache wiki_url-Feld nicht mit (oder schreibt es VOR dem Neuaufbau, "
		+ "der es wieder ueberschreibt) -- das naechste Speichern bestaetigte die alte Adresse");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Sync im Editor: fuellt Namensfeld und Auswahl ----------------------------------------
	vm.runInContext("settlementDetailCache = { publicId: 'loc-1', detail: { public_id: 'loc-1',"
		+ " name: 'Havena (alt)', feature_subtype: 'dorf', on_map: true,"
		+ " properties: { wiki_settlement: " + JSON.stringify(SIEDLUNG) + " } } };"
		+ "mountSettlementWikiAssign();", e.kasten);
	await ruhe();
	assert.ok(eHost.innerHTML.indexOf("9.400") !== -1, "der Editor zeigt die Infoboxwerte nicht: " + eHost.innerHTML);
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(eHost.innerHTML.indexOf("5 von 5 Angaben würden sich ändern") !== -1, eHost.innerHTML);
	// 🔴 HIER wird die EINWOHNERZAHL abgehakt -- die Gegenprobe zum Kartendialog oben, und wortgleich
	// der Handgriff, den der Brief zu Aufgabe 5 verlangt hatte und der damals unmoeglich war.
	// ⚠️ Der Name (0) startet seit dem Owner-Entscheid ohnehin ungehakt (Kartenwert gefuellt) -- das
	// Abhaken bleibt trotzdem stehen: es macht die ABSICHT der Probe lesbar und ist auch dann richtig,
	// wenn die Vorbelegung sich wieder aendert. Die Ortsgroesse (1) wird dafuer ausdruecklich
	// ANgehakt, sonst hat diese Probe kein positives Gegenstueck mehr.
	eHost.feuere("change", scheinZiel("data-wa-sync-haken", "0", { checked: false }));
	eHost.feuere("change", scheinZiel("data-wa-sync-haken", "1", { checked: true }));
	eHost.feuere("change", scheinZiel("data-wa-sync-haken", "2", { checked: false }));
	await ruhe();
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(eFelder.dtEditName.value, "Havena (alt)",
		"der ABGEHAKTE Name wurde trotzdem uebernommen");
	assert.strictEqual(eFelder.dtEditType.value, "grossstadt", "die angehakte Ortsgroesse wurde nicht uebernommen");
	assert.strictEqual(eFelder.dtEditEinwohner.value, "",
		"die ABGEHAKTE Einwohnerzahl wurde trotzdem uebernommen -- ein Haken, der nichts bedeutet");
	assert.strictEqual(eFelder.dtEditOberhaupt.value, "Gräfin Yppolita", "der angehakte Herrscher wurde nicht uebernommen");
	assert.strictEqual(eFelder.dtEditLage.value, "Albernia · Mittelreich", "die angehakte Lage wurde nicht uebernommen");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Und dieselbe Regel im Editor: KEINE halbe Uebernahme ---------------------------------
	// 🔴 Wortgleich zum Kartendialog geprueft, weil beide Oberflaechen bei derselben Handlung
	// dasselbe tun muessen -- genau das war der Befund, der diese Nachbesserung ausgeloest hat.
	eFelder.dtEditType.options = [{ value: "dorf" }, { value: "kleinstadt" }];
	eFelder.dtEditType.value = "dorf";
	eFelder.dtEditName.value = "Havena (alt)";
	vm.runInContext("mountSettlementWikiAssign();", e.kasten);
	await ruhe();
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(eFelder.dtEditName.value, "Havena (alt)",
		"der Orte-Editor schreibt den Namen, obwohl die Ortsgroesse danach abgelehnt hat");
	eFelder.dtEditType.options = AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN.map((v) => ({ value: v }));
	zaehl();

	// ---- Entfernen im Editor: das flache Feld MUSS mitgeleert werden --------------------------
	// 🔴 `clear_assign` fasst `properties.wiki_url` nicht an; ohne das Mitleeren zeigte der Kasten
	// „— keine —", waehrend darueber weiter eine Wiki-Adresse stuende, die das naechste Speichern
	// bestaetigt. Owner-Regel: Entfernen bleibt entfernt.
	// Der Ort traegt jetzt die richtige Adresse -- in der rohen Spalte UND im Formular. Genau so
	// sieht ein gespeicherter, verknuepfter Ort aus.
	roheAdresse = "https://de.wiki-aventurica.de/wiki/Havena";
	eFelder.dtEditWikiUrl.value = roheAdresse;
	eHost.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	const eLoesung = e.gesendet.filter((s) => s.rumpf && s.rumpf.action === "clear_assign")[0];
	assert.ok(eLoesung, "der Orte-Editor hat nichts geloest");
	assert.strictEqual(eLoesung.rumpf.public_id, "loc-1");
	assert.strictEqual(eLoesung.rumpf.confirm, "apply");
	assert.strictEqual(eFelder.dtEditWikiUrl.value, "",
		"der Orte-Editor leert das flache wiki_url-Feld nicht mit -- die entfernte Verbindung kehrt beim naechsten Speichern zurueck");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Der Vertrag im Editor ----------------------------------------------------------------
	// 💣 Wieder an der VERDRAHTUNG: der Cache gehoert einem anderen Ort -- genau der Zustand nach
	// einem gescheiterten Detail-Abruf.
	vm.runInContext("settlementDetailCache = null;", e.kasten);
	assert.throws(() => vm.runInContext("settlementWikiAssignZustand()", e.kasten),
		"der Orte-Editor liefert ohne geladenen Ort einen Zustand, statt zu werfen");
	vm.runInContext("settlementDetailCache = { publicId: 'ein-anderer', detail: { properties: {} } };", e.kasten);
	assert.throws(() => vm.runInContext("settlementWikiAssignZustand()", e.kasten),
		"ein Cache fuer einen ANDEREN Ort gilt als Stand dieses Ortes");
	zaehl(); zaehl();
	// 🪤 Und dieselbe schaerfere Fassung wie oben: der GETEILTE Bauer wird zum Werfen gebracht, und
	// sein Fehler muss durch die Oberflaeche hindurch. Die zwei Proben darueber erreichen nur die
	// fruehe Wache; ein `catch` um den unteren Teil bliebe von ihnen ungesehen.
	vm.runInContext("settlementDetailCache = { publicId: 'loc-1', detail: { public_id: 'loc-1',"
		+ " name: 'Havena', feature_subtype: 'dorf', on_map: true, properties: {} } };"
		+ "var echterOrtZustandE = avesmapsWikiAssignOrtZustand;"
		+ "avesmapsWikiAssignOrtZustand = function () { throw new Error('BAUER WIRFT'); };", e.kasten);
	assert.throws(() => vm.runInContext("settlementWikiAssignZustand()", e.kasten), /BAUER WIRFT/,
		"der Orte-Editor schluckt einen Fehler des geteilten Zustandsbauers");
	vm.runInContext("avesmapsWikiAssignOrtZustand = echterOrtZustandE;", e.kasten);
	zaehl();

	// ══ TEIL 5: DER DRITTE ZUSTAND („Kein Wiki-Artikel vorhanden", Aufgabe 5b) ════════════════
	// 🔴 Er ist beim Ort nicht bloss ein Ordnungsmerkmal wie bei den Kraftlinien, sondern die
	// REPARATUR von Discord #38: ohne ihn raet avesmapsEnrichMapFeatureWikiUrl beim naechsten
	// Kartenladen eine Adresse aus dem Ortsnamen zurueck, und ein „Entfernen" haelt nicht.
	// ⚠️ Gefahren wird der ganze Weg -- Marker-Eintrag → Kasten → Haekchen → Payload --, nicht der
	// Bauer allein. Genau daran ist in den Aufgaben 3-5 acht Mal eine Zusicherung vorbeigelaufen.

	/** Ein Kartendialog-Sandkasten mit gewaehltem Merker-Stand. */
	function merkerDialog(wikiNoArticle, wikiUrlWert) {
		const eigeneFelder = {
			"location-edit-name": scheinFeld("Havena"),
			"location-edit-type": scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
			"location-edit-wiki-url": scheinFeld(wikiUrlWert || ""),
			"location-edit-einwohner": scheinFeld(""),
			"location-edit-lage": scheinFeld(""),
			"location-edit-oberhaupt": scheinFeld(""),
		};
		const kasten = sandkastenBauen(dialogSkripte, eigeneFelder, ["settlement-wiki-assign-host"],
			() => ({ ok: true, query: "", rows: [] }));
		vm.runInContext("var locationEditMarkerEntry = { publicId: 'loc-merker', location: "
			+ JSON.stringify({ wikiNoArticle: wikiNoArticle === true }) + " };"
			+ "var locationEditPendingWikiSettlement = null;", kasten.kasten);
		return kasten;
	}

	// ---- Der gespeicherte Merker erreicht das Häkchen -----------------------------------------
	const kGesetzt = merkerDialog(true, "");
	const hostGesetzt = kGesetzt.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", kGesetzt.kasten);
	await ruhe();
	assert.ok(hostGesetzt.innerHTML.indexOf("Kein Wiki-Artikel vorhanden") !== -1,
		"der Kartendialog zeigt den dritten Zustand gar nicht: " + hostGesetzt.innerHTML);
	// 💣 Und zwar ANGEHAKT. Ohne den Weg properties → Payload → prepareLocationData →
	// settlementWikiZustand startete das Häkchen immer leer, und das naechste beliebige Speichern
	// naehme eine Entscheidung zurueck, die oft im Konfliktzentrum getroffen wurde.
	assert.ok(/data-wa-kein-artikel checked/.test(hostGesetzt.innerHTML),
		"der gespeicherte Merker erreicht das Haekchen nicht -- es startet leer: " + hostGesetzt.innerHTML);
	// 🔴 UND ER REIST NICHT MIT, SOLANGE NIEMAND IHN ANFASST (Owner-Entscheid 16.08.2026 anstelle
	// eines `expected_revision`). Hier stand `true` -- die Zusicherung ist mitgewandert, und sie ist
	// die halbe Regel: ein frisch geladener, unangetasteter Dialog darf den Merker eines zweiten
	// Editors nicht mitschreiben. Die andere Haelfte (bewusst umgelegt ⇒ reist mit) steht darunter.
	assert.strictEqual(vm.runInContext("settlementWikiKeinArtikelFuerPayload()", kGesetzt.kasten), null,
		"ein unangetastetes Haekchen reist mit -- damit koennte ein alter Dialog eine fremde Entscheidung ueberschreiben");
	// 🔴 UND DAS BEWUSSTE ENTFERNEN KOMMT TROTZDEM DURCH: `false`, nicht `null`. Haenge der Riegel an
	// „gesetzt" statt an „veraendert", wuerde man den Merker nie wieder los.
	hostGesetzt.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: false }));
	await ruhe();
	assert.strictEqual(vm.runInContext("settlementWikiKeinArtikelFuerPayload()", kGesetzt.kasten), false,
		"ein bewusst ENTFERNTES Haekchen wird verschluckt -- der Merker liesse sich nie wieder loeschen");
	// Und zurueck auf den geladenen Wert heisst wieder „nichts zu schicken".
	hostGesetzt.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: true }));
	await ruhe();
	assert.strictEqual(vm.runInContext("settlementWikiKeinArtikelFuerPayload()", kGesetzt.kasten), null,
		"ein auf seinen geladenen Wert zurueckgelegtes Haekchen reist mit");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Setzen leert das flache Adressfeld ---------------------------------------------------
	// 💣 `update_point` LEHNT „Adresse UND kein Artikel" ab (avesmapsApplyPointWikiFields), und
	// `#location-edit-wiki-url` ist in diesem Dialog `type="hidden"`: der Editor bekaeme eine Absage,
	// deren Ursache er nirgends sieht. Also wird hier geleert, statt dort abzulehnen.
	const kSetzen = merkerDialog(false, "https://de.wiki-aventurica.de/wiki/Havena");
	const hostSetzen = kSetzen.elemente["settlement-wiki-assign-host"];
	vm.runInContext("renderSettlementWikiReference();", kSetzen.kasten);
	await ruhe();
	assert.ok(!/data-wa-kein-artikel checked/.test(hostSetzen.innerHTML),
		"das Haekchen startet gesetzt, obwohl der Ort den Merker nicht traegt: " + hostSetzen.innerHTML);
	// Unangetastet ⇒ nichts zu schicken (auch wenn der geladene Wert `false` ist).
	assert.strictEqual(vm.runInContext("settlementWikiKeinArtikelFuerPayload()", kSetzen.kasten), null);
	hostSetzen.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: true }));
	await ruhe();
	assert.strictEqual(vm.runInContext("settlementWikiKeinArtikelFuerPayload()", kSetzen.kasten), true,
		"das umgelegte Haekchen erreicht den Speicherweg nicht");
	assert.strictEqual(kSetzen.elemente["location-edit-wiki-url"].value, "",
		"das flache Adressfeld steht noch -- das naechste Speichern liefe in den Widerspruchs-Riegel des Servers");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- NUR EIN NEUES FELD ANGEHAKT -----------------------------------------------------------
	// 🪤 DIESE PROBE FEHLTE, und die Mutation hat es gezeigt: die Leerpruefung „nichts angehakt"
	// stand als `werte.name === null && werte.feature_subtype === null` da. Mit fuenf Zielen sagt sie
	// dann bei einer ALLEIN angehakten Einwohnerzahl „nichts angehakt" -- die Oberflaeche wirft, das
	// Bauteil liest die Ablehnung als „es ist nichts passiert", und der Haken bleibt wirkungslos
	// stehen. Alle uebrigen Proben hatten immer auch Name oder Ortsgroesse angehakt und liefen gruen
	// durch. Gefahren wird deshalb genau der Fall: vier Haken weg, einer bleibt.
	async function nurEinFeldUebernehmen(sandkasten, hostName, hakenIndex) {
		const kastenHost = sandkasten.elemente[hostName];
		kastenHost.feuere("click", scheinZiel("data-wa-aktion", "sync"));
		await ruhe();
		[0, 1, 2, 3, 4].filter((i) => i !== hakenIndex).forEach((i) => {
			kastenHost.feuere("change", scheinZiel("data-wa-sync-haken", String(i), { checked: false }));
		});
		await ruhe();
		kastenHost.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
		await ruhe();
	}

	const kEinzeln = merkerDialog(false, "");
	// ⚠️ Der Name muss ABWEICHEN, sonst hat die Vorschau nur vier Zeilen und der Zaehlindex unten
	// zeigt auf eine andere Angabe -- gemessen, nicht angenommen (der erste Anlauf hakte „Herrscher"
	// an und die Probe fiel aus dem falschen Grund um).
	kEinzeln.elemente["location-edit-name"].value = "Havena (alt)";
	vm.runInContext("locationEditMarkerEntry = { publicId: 'loc-einzeln', location: {"
		+ " wikiSettlement: " + JSON.stringify(SIEDLUNG) + " } };", kEinzeln.kasten);
	vm.runInContext("renderSettlementWikiReference();", kEinzeln.kasten);
	await ruhe();
	// Index 2 ist „Einwohner" (Reihenfolge der Erklaerung: Name, Ortsgröße, Einwohner, Herrscher, Lage).
	await nurEinFeldUebernehmen(kEinzeln, "settlement-wiki-assign-host", 2);
	assert.strictEqual(kEinzeln.elemente["location-edit-einwohner"].value, "9.400",
		"eine ALLEIN angehakte Einwohnerzahl wird nicht uebernommen -- die Leerpruefung zaehlt nur die alten zwei Ziele");
	assert.strictEqual(kEinzeln.elemente["location-edit-name"].value, "Havena (alt)",
		"der abgehakte Name wurde trotzdem geschrieben");
	assert.strictEqual(kEinzeln.elemente["location-edit-oberhaupt"].value, "",
		"der abgehakte Herrscher wurde trotzdem geschrieben");
	zaehl(); zaehl(); zaehl();

	// ---- `buildLocationEditPayload`: die ECHTE Funktion, aus der ECHTEN Datei ------------------
	// 🔴 NICHT der Bauer allein, sondern die VERDRAHTUNG: der Payload-Bauer wohnt in
	// js/review/review-locations.js und muss den Merker aus dem Bauteil und die drei Textfelder aus
	// dem Formular holen. Fehlte eines, loeschte der Server es beim naechsten Speichern -- lautlos.
	// ⚠️ `FormData` ist im Sandkasten nachgebaut, und zwar mit der EINEN Eigenschaft, auf der die
	// Regel steht: ein Feld, das es nicht gibt, liefert `null` (nicht "").
	const payloadSkripte = skripteAus("index.html", /wiki-assign|review-settlement-wiki|review-locations/);
	assert.ok(payloadSkripte.indexOf("js/review/review-locations.js") !== -1,
		"index.html bindet review-locations.js nicht: " + payloadSkripte.join(" "));
	const kPayload = sandkastenBauen(payloadSkripte,
		{
			"location-edit-name": scheinFeld("Havena"),
			"location-edit-type": scheinFeld("dorf", AVESMAPS_WIKI_ASSIGN_ORT_GROESSEN),
			"location-edit-wiki-url": scheinFeld(""),
			"location-edit-einwohner": scheinFeld(""),
			"location-edit-lage": scheinFeld(""),
			"location-edit-oberhaupt": scheinFeld(""),
			"location-edit-public-id": scheinFeld("loc-merker"),
		},
		["settlement-wiki-assign-host"],
		() => ({ ok: true, query: "", rows: [] }));
	vm.runInContext("locationEditMarkerEntry = { publicId: 'loc-merker', location: { wikiNoArticle: true } };"
		+ "var locationEditPendingWikiSettlement = null;"
		+ "function FormData(el) { this._w = (el && el.werte) || {}; }"
		+ "FormData.prototype.get = function (n) {"
		+ "  return Object.prototype.hasOwnProperty.call(this._w, n) ? this._w[n] : null; };", kPayload.kasten);
	vm.runInContext("renderSettlementWikiReference();", kPayload.kasten);
	await ruhe();
	const vollesFormular = {
		public_id: "loc-merker", name: "Havena", feature_subtype: "grossstadt", description: "",
		wiki_url: "", place_kind: "", einwohner: "9.400", lage: "Albernia · Mittelreich",
		oberhaupt: "Gräfin Yppolita",
	};
	const bauePayload = () => JSON.parse(vm.runInContext(
		"JSON.stringify(buildLocationEditPayload({ werte: " + JSON.stringify(vollesFormular) + " }))",
		kPayload.kasten));
	const hostPayload = kPayload.elemente["settlement-wiki-assign-host"];
	const gebaut = bauePayload();
	assert.strictEqual(gebaut.einwohner, "9.400");
	assert.strictEqual(gebaut.lage, "Albernia · Mittelreich");
	assert.strictEqual(gebaut.oberhaupt, "Gräfin Yppolita");
	// 🔴 DER MERKER REIST NUR MIT, WENN ER BEWUSST VERAENDERT WURDE (Owner-Entscheid 16.08.2026).
	// Hier stand `wiki_no_article === true` fuer einen Dialog, den niemand angefasst hat -- genau der
	// Fall, der die Entscheidung eines zweiten Editors ueberschreibt.
	assert.ok(!("wiki_no_article" in gebaut),
		"ein unangetastetes Haekchen steht im Speicher-Payload -- ein alter offener Dialog schriebe damit "
		+ "die Entscheidung eines zweiten Editors zurueck");
	// ---- BEIDE RICHTUNGEN, als Ablauf durch die echte Oberflaeche -----------------------------
	// (1) gesetzt -> ENTFERNT: `false` muss ankommen, sonst wird man den Merker nie wieder los.
	hostPayload.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: false }));
	await ruhe();
	const nachEntfernen = bauePayload();
	assert.strictEqual(nachEntfernen.wiki_no_article, false,
		"ein bewusst ENTFERNTES Haekchen erreicht den Payload nicht -- der Merker liesse sich nie loeschen");
	// (2) zurueck auf den geladenen Wert: wieder nichts zu schicken.
	hostPayload.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: true }));
	await ruhe();
	assert.ok(!("wiki_no_article" in bauePayload()),
		"ein auf seinen geladenen Wert zurueckgelegtes Haekchen steht trotzdem im Payload");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// 💣 UND DER RIEGEL GEGEN DIE LADELUECKE: kennt das Formular ein Feld gar nicht (eine gecachte
	// index.html nach einem Deploy, AGENTS.md §7), wird der Schluessel WEGGELASSEN statt als ""
	// geschickt -- `update_point` fasst ihn dann nicht an. Ein "" waere eine Loeschung, die niemand
	// angeordnet hat.
	const altesFormular = JSON.parse(vm.runInContext(
		"JSON.stringify(buildLocationEditPayload({ werte: "
		+ JSON.stringify({ public_id: "loc-merker", name: "Havena", feature_subtype: "dorf", description: "", wiki_url: "", place_kind: "" })
		+ " }))", kPayload.kasten));
	["einwohner", "lage", "oberhaupt"].forEach((feld) => {
		assert.ok(!(feld in altesFormular),
			"ein Formular ohne „" + feld + "“ schickt den Schluessel trotzdem -- der Server loescht die Angabe");
		zaehl();
	});

	// 💣 Und dasselbe fuer den Merker, wenn das Bauteil NICHT bereit ist (Blindgaenger). `false` waere
	// hier eine Loeschung der Entscheidung des Konfliktzentrums.
	vm.runInContext("settlementWikiAssign = null;", kPayload.kasten);
	const ohneBauteil = JSON.parse(vm.runInContext(
		"JSON.stringify(buildLocationEditPayload({ werte: " + JSON.stringify(vollesFormular) + " }))",
		kPayload.kasten));
	assert.ok(!("wiki_no_article" in ohneBauteil),
		"ein nicht bereites Bauteil schickt trotzdem einen Merker-Wert -- ein Blindgaenger loeschte damit die Entscheidung");
	assert.strictEqual(vm.runInContext("settlementWikiKeinArtikelFuerPayload()", kPayload.kasten), null);
	zaehl(); zaehl();

	// ---- Und dieselbe Einzelfeld-Probe im Orte-Editor -----------------------------------------
	// 🔴 Wortgleich, weil die Leerpruefung dort eine ZWEITE Fassung ist: beide Oberflaechen muessen
	// bei derselben Handlung dasselbe tun.
	eFelder.dtEditName.value = "Havena (alt)";
	eFelder.dtEditType.value = "dorf";
	eFelder.dtEditEinwohner.value = "";
	eFelder.dtEditLage.value = "";
	eFelder.dtEditOberhaupt.value = "";
	vm.runInContext("settlementDetailCache = { publicId: 'loc-1', detail: { public_id: 'loc-1',"
		+ " name: 'Havena (alt)', feature_subtype: 'dorf', on_map: true,"
		+ " properties: { wiki_settlement: " + JSON.stringify(SIEDLUNG) + " } } };"
		+ "mountSettlementWikiAssign();", e.kasten);
	await ruhe();
	await nurEinFeldUebernehmen(e, "dtWikiAssign", 2);
	assert.strictEqual(eFelder.dtEditEinwohner.value, "9.400",
		"der Orte-Editor uebernimmt eine ALLEIN angehakte Einwohnerzahl nicht");
	assert.strictEqual(eFelder.dtEditName.value, "Havena (alt)", "der abgehakte Name wurde trotzdem geschrieben");
	zaehl(); zaehl();

	// ---- Der Orte-Editor: derselbe Weg, dieselbe Regel ----------------------------------------
	vm.runInContext("settlementDetailCache = { publicId: 'loc-1', detail: { public_id: 'loc-1',"
		+ " name: 'Havena', feature_subtype: 'dorf', on_map: true,"
		+ " properties: { wiki_no_article: true } } };"
		+ "mountSettlementWikiAssign();", e.kasten);
	await ruhe();
	assert.ok(/data-wa-kein-artikel checked/.test(eHost.innerHTML),
		"der Orte-Editor zeigt den gespeicherten Merker nicht: " + eHost.innerHTML);
	eFelder.dtEditEinwohner.value = "9.400";
	eFelder.dtEditLage.value = "Albernia · Mittelreich";
	eFelder.dtEditOberhaupt.value = "Gräfin Yppolita";
	const eBaue = () => JSON.parse(vm.runInContext("JSON.stringify(buildSettlementSavePayload())", e.kasten));
	const eGebaut = eBaue();
	assert.strictEqual(eGebaut.einwohner, "9.400");
	assert.strictEqual(eGebaut.lage, "Albernia · Mittelreich");
	assert.strictEqual(eGebaut.oberhaupt, "Gräfin Yppolita");
	// 🔴 DIESELBE REGEL WIE IM KARTENDIALOG -- eine Regel, die einen von zwei Payload-Bauern bindet,
	// ist keine Regel (AGENTS.md §11). Unangetastet ⇒ der Schluessel fehlt.
	assert.ok(!("wiki_no_article" in eGebaut),
		"der Orte-Editor schickt ein unangetastetes Haekchen mit -- damit ueberschriebe er eine fremde Entscheidung");
	// (1) gesetzt -> ENTFERNT: `false` kommt an.
	eHost.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: false }));
	await ruhe();
	assert.strictEqual(eBaue().wiki_no_article, false,
		"der Orte-Editor verschluckt ein bewusst ENTFERNTES Haekchen");
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// Setzen leert auch hier die flache Adresse -- `#dtEditWikiUrl` steht sichtbar, aber readonly.
	// ⚠️ Und der Weg zurueck (ungesetzt -> gesetzt) faehrt gleich mit: danach steht wieder `true` im
	// Payload, obwohl das der GELADENE Wert ist -- der Bezugspunkt ist der Ladelauf, nicht der letzte
	// Klick. ⚠️ Genau das ist gewollt: der Editor hat den Merker in diesem Dialog zweimal angefasst,
	// und der Server bekommt den Stand, den der Editor jetzt sieht.
	eFelder.dtEditWikiUrl.value = "https://de.wiki-aventurica.de/wiki/Havena";
	eHost.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: true }));
	await ruhe();
	assert.strictEqual(eFelder.dtEditWikiUrl.value, "",
		"der Orte-Editor leert die flache Adresse nicht -- das Speichern liefe in den Widerspruchs-Riegel");
	assert.ok(!("wiki_no_article" in eBaue()),
		"ein auf den geladenen Wert zurueckgelegtes Haekchen steht trotzdem im Payload");
	// ---- UND DIE RICHTUNG UNGESETZT → GESETZT, im Orte-Editor -----------------------------------
	// 🪤 SIE WAR VON KEINEM TEST GEDECKT. Der Pruefer hat in
	// html/wiki-sync-settlement-editor.html einen Riegel eingebaut, der `true` nie schickt -- das
	// GANZE JS-Feld blieb gruen (157/157). Der Grund: die Fixture darueber startet MIT gesetztem
	// Merker, es wird nur ab- und wieder angewaehlt, und beide Enden liegen bei `false` bzw.
	// „Schluessel fehlt". Der Kartendialog hatte die Gegenprobe, der Orte-Editor nicht.
	// 💣 Deshalb eine eigene Fixture, die OHNE Merker startet -- eine Probe, die nur eine Richtung
	// faehrt, deckt auch nur eine Richtung.
	vm.runInContext("settlementDetailCache = { publicId: 'loc-1', detail: { public_id: 'loc-1',"
		+ " name: 'Havena', feature_subtype: 'dorf', on_map: true, properties: {} } };"
		+ "mountSettlementWikiAssign();", e.kasten);
	await ruhe();
	assert.ok(!/data-wa-kein-artikel checked/.test(eHost.innerHTML),
		"das Haekchen startet gesetzt, obwohl der Ort den Merker nicht traegt: " + eHost.innerHTML);
	assert.ok(!("wiki_no_article" in eBaue()), "unangetastet, also nichts zu schicken");
	eHost.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: true }));
	await ruhe();
	assert.strictEqual(eBaue().wiki_no_article, true,
		"der Orte-Editor schickt ein frisch GESETZTES Haekchen nicht mit -- der Merker kaeme nie beim Server an");
	zaehl(); zaehl(); zaehl();

	// Und der Blindgaenger-Fall: ohne bereites Bauteil steht kein Merker im Payload.
	vm.runInContext("settlementWikiAssign = null;", e.kasten);
	assert.ok(!("wiki_no_article" in JSON.parse(vm.runInContext("JSON.stringify(buildSettlementSavePayload())", e.kasten))),
		"der Orte-Editor schickt bei nicht bereitem Bauteil einen Merker-Wert");
	zaehl(); zaehl();

	// ══ TEIL 6: DER WEG VOM PAYLOAD ZUM MARKER-EINTRAG ═══════════════════════════════════════
	// 💣 Ohne dieses Stueck ist alles andere wirkungslos: der Kartendialog liest den Merker und die
	// drei Felder aus `markerEntry.location`. Das Objekt entsteht beim ersten Laden der Karte
	// (prepareLocationData) und nach einem Schreibvorgang (applyFeatureResponseToMarker /
	// addCreatedLocationMarker); `applyLiveLocationFeature` speist die zwei letzten mit dem
	// Kartenpayload eines FREMDEN Editors. Fehlt einer, startet das Haekchen nach genau dieser
	// Handlung wieder leer, und das naechste Speichern nimmt die Entscheidung zurueck. Dieselbe Falle
	// wie „vier Erzeuger, Sperre in zweien" (AGENTS.md §11) -- deshalb steht hier KEINE Zahl im
	// Fliesstext, sondern die Liste selbst.
	// 🪤 `applyLiveLocationFeature` stand beim ersten Anlauf NICHT in der Liste. Gefunden beim
	// Nachzaehlen der Aufrufer, nicht vom Test.
	//
	// ⚠️ TEXTPROBE, und sie ist als solche benannt: die Erzeuger haengen an Leaflet, am Kartenzustand
	// und an einem Dutzend Nachbarmodulen; sie im Sandkasten zu fahren waere ein Nachbau, kein Beleg.
	// Sie beantwortet genau eine Frage -- traegt der Erzeuger das Feld ueberhaupt? --, dieselbe Frage
	// und dasselbe Muster wie in powerline-inherit-test.php.
	//
	// 🪤 UND SIE HAT SICH BIS ZUR NACHBESSERUNG AUS IHREN EIGENEN KOMMENTAREN ERFUELLT. Sie fragte
	// `rumpf.indexOf(feld) !== -1` und unterschied damit weder Code von Kommentar noch ganze Woerter
	// von Wortteilen. Nachgezaehlt vom Pruefer: `wiki_no_article` stand im Rumpf von
	// `applyLiveLocationFeature` ZWEIMAL -- einmal als Code, einmal in meinem eigenen Kommentar
	// darueber; und `lage` fand sich in `applyFeatureResponseToMarker` DREIMAL, zweimal davon im Wort
	// „vi**llage**" englischer Nachbarkommentare. Beide Zeilen liessen sich einzeln loeschen, ohne
	// dass die Probe rot wurde. 💣 Exakt die Fehlerform, fuer die dieser Zweig schon einen
	// Reparaturcommit traegt (`2af3bfea`, „die Stylesheet-Probe fand ihren eigenen Kommentar") und die
	// im PHP-Test nebenan bereits geschlossen war -- hier nicht. Deshalb jetzt: Kommentarzeilen raus,
	// und gesucht wird die ZUWEISUNG `<feld>:` an einer Wortgrenze, nicht der blosse Name.
	//
	// ⚠️ Der Merker heisst je nach Stufe anders: im Marker-Eintrag `wikiNoArticle`, im flachen
	// Umschlag der Antwort `wiki_no_article`. Die Probe traegt deshalb je Erzeuger IHREN Namen --
	// ein gemeinsamer waere bei drei von vier zufaellig richtig und bei einem blind.
	const MARKER_ERZEUGER = [
		["js/routing/routing.js", "prepareLocationData", "wikiNoArticle"],
		["js/map-features/map-features-location-editing.js", "applyFeatureResponseToMarker", "wikiNoArticle"],
		["js/map-features/map-features-location-editing.js", "addCreatedLocationMarker", "wikiNoArticle"],
		["js/map-features/map-features-location-editing.js", "applyLiveLocationFeature", "wiki_no_article"],
	];
	/**
	 * Der Rumpf OHNE Kommentare -- die Probe soll Code messen, nicht Prosa.
	 *
	 * 🪤 ZEILEN- UND BLOCKKOMMENTARE. Die erste Fassung dieser Reparatur warf nur `//`-Zeilen weg;
	 * ein `/* … *\/` oder eine JSDoc-Zeile im Rumpf haette denselben Weg zurueck in die Probe
	 * gefunden -- dieselbe Klasse, nur eine Syntax weiter. Bei den vier heutigen Erzeugern ist das
	 * folgenlos, aber die naechste Objektart schreibt vielleicht JSDoc.
	 * ⚠️ Blockkommentare ZUERST (sie koennen mehrere Zeilen umfassen), danach die Zeilenkommentare.
	 */
	function rumpfOhneKommentare(quelle, funktion) {
		const start = quelle.indexOf(funktion);
		if (start === -1) {
			return null;
		}
		// Bis zur naechsten Zeile, die in Spalte 0 eine neue Einheit beginnt -- der Rumpf.
		const rest = quelle.slice(start);
		const ende = rest.search(/\n(?:function |const |let |\/\/ =)/);
		return (ende === -1 ? rest : rest.slice(0, ende))
			.replace(/\/\*[\s\S]*?\*\//g, " ")
			.split("\n")
			.filter((zeile) => zeile.trim().indexOf("//") !== 0)
			.join("\n");
	}
	MARKER_ERZEUGER.forEach(([datei, funktion, merkerName]) => {
		const quelle = fs.readFileSync(path.join(wurzel, datei), "utf8");
		const rumpf = rumpfOhneKommentare(quelle, funktion);
		assert.ok(rumpf !== null, "der Erzeuger „" + funktion + "“ steht nicht in " + datei);
		[merkerName, "einwohner", "lage", "oberhaupt"].forEach((feld) => {
			// Wortgrenze davor, Doppelpunkt dahinter: „village" faellt heraus, „einwohner:" nicht.
			const zuweisung = new RegExp("(^|[^A-Za-z0-9_$])" + feld + "\\s*:");
			assert.ok(zuweisung.test(rumpf),
				"„" + funktion + "“ (" + datei + ") traegt „" + feld + "“ nicht in den Marker-Eintrag");
			zaehl();
		});
	});

	console.log("wiki-assign-ort: " + checks + " Zusicherungen erfuellt");
})().catch((fehler) => {
	console.error(fehler);
	process.exit(1);
});

// ══ 💣 DER FALL GARETH -- 17.08.2026, LIVE GESEHEN ════════════════════════════════════════════
// avesmapsWikiSettlementParseInfobox setzt die Ortsklasse auf 'dorf', wenn die Wiki-KATEGORIE
// keine hergibt, und schreibt die Vermutung als Datum ins Nest. Bei „Gareth" war das so: der neue
// Ruecksetzer bot an, die METROPOLE zum Dorf zu machen, und der Owner hat es geklickt. Die
// Sync-Vorschau bot dieselbe Herabstufung schon seit dem 16.08.2026 an -- nur zwei Klicks tiefer.
//
// 🪤 Punkt 3 im Kopf dieser Datei sagte, die Klasse „darf NICHT geraten werden" und meinte den
// CLIENT. Geraten hat der SERVER, und die strenge Client-Regel griff nicht: 'dorf' IST ein
// gueltiger Schluessel. Die Strenge war an der falschen Seite.
const { avesmapsWikiAssignOrtGroesseIstGeraten: ortGeraten } = require("../wiki-assign-ort.js");

// 1. Der Server sagt ausdruecklich „geraten" -> die Zeile wird gar nicht erst angeboten.
assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse("dorf", { settlement_class_guessed: true }), "",
	"eine als geraten gemeldete Klasse wird trotzdem angeboten");
// 2. Der Server sagt ausdruecklich „nicht geraten" -> ein echtes Dorf bleibt uebernehmbar.
assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse("dorf", { settlement_class_guessed: false }), "dorf",
	"ein ECHTES Wiki-Dorf wird nicht mehr angeboten -- die Regel ist zu stumpf geworden");
// 3. 🔴 ALTES NEST OHNE DEN SCHLUESSEL -> die sichere Richtung, also NICHT anbieten. Genau dieser
//    Zweig traegt heute den gesamten Livebestand; ohne ihn haette Gareth nichts geschuetzt.
assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse("dorf", { title: "Gareth" }), "",
	"ein altes Nest ohne die Angabe wird als echte Wiki-Aussage gelesen -- das war der Fall Gareth");
// 4. ⚠️ Die Regel gilt NUR fuer 'dorf'. Jede andere Klasse kann der Parser gar nicht raten, und
//    sie stumm mitzusperren naehme dem Abgleich seine Arbeit.
assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse("metropole", {}), "metropole");
assert.strictEqual(avesmapsWikiAssignOrtOrtsgroesse("stadt", { settlement_class_guessed: true }), "stadt",
	"eine andere Klasse wird als geraten behandelt -- der Parser kann nur 'dorf' raten");
assert.strictEqual(ortGeraten("metropole", {}), false);

// 5. 💣 UND DER WEG DURCH DIE ECHTE WERTELISTE, nicht nur durch die Hilfsfunktion. Ohne diese
//    Zusicherung koennte jemand den Aufruf auf die alte Ein-Argument-Form zurueckdrehen: die
//    Hilfsfunktion bliebe gruen, und die Sperre waere lautlos wirkungslos.
assert.strictEqual(avesmapsWikiAssignOrtWerte({ settlement_class: "dorf", name: "Gareth" }).ortsgroesse, "",
	"die Werteliste reicht das Nest nicht an die Groessenpruefung durch");
assert.strictEqual(avesmapsWikiAssignOrtWerte({ settlement_class: "metropole" }).ortsgroesse, "metropole");
console.log("wiki-assign-ort: der Fall Gareth ist festgenagelt");

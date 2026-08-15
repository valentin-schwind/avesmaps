// Die Infobox-Zeile „Stätten" — die Bauwerke IN einem Ort (Owner 2026-08-15).
// Sie liest `in_settlement_places` aus dem Kartenpayload; es gibt keine eigene Abfrage.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

global.window = {
	location: { search: "" },
	localStorage: { getItem: () => null, setItem() {} },
	addEventListener() {}, setTimeout: () => 0, clearTimeout() {},
};
global.localStorage = global.window.localStorage;
global.document = { querySelectorAll: () => [], addEventListener() {}, documentElement: {} };
global.MutationObserver = function () { this.observe = () => {}; };
global.AbortController = function () { this.abort = () => {}; this.signal = null; };
global.tr = (key, fallback) => fallback;
global.escapeHtml = (v) => String(v == null ? "" : v)
	.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const load = (...parts) => {
	const file = path.join(__dirname, ...parts);
	vm.runInThisContext(fs.readFileSync(file, "utf8"), { filename: file });
};
load("..", "..", "ui", "infobox-lid.js");
load("..", "map-features-lore.js");
load("..", "map-features-settlement-places.js");

// Den Payload setzen und den Index-Cache damit erneuern. ⚠️ Der Cache haengt an der LAENGE der
// Liste -- deshalb variieren die Faelle unten ihre Laenge, sonst pruefte der zweite Fall den
// Index des ersten.
function payload(eintraege) {
	window.avesmapsInSettlementPlaces = eintraege;
}
const ort = (name, settlement, type, wiki_url) => ({ name, settlement, type, wiki_url: wiki_url || "" });

// ---- kein Eintrag: KEINE Zeile ----------------------------------------------------------------
// 🔴 Eine Zeile „0 besondere Stätten" waere eine Aussage ueber unseren Datenbestand, die niemanden
// interessiert -- und sie stuende bei der grossen Mehrheit der 4653 Orte da. Von 266 Orten mit
// Staetten hat der Median 2; alle uebrigen bekommen gar nichts.
payload([ort("Pentagrammaton", "Punin", "Magierakademie")]);
assert.strictEqual(avesmapsStaettenRowMarkup("Gareth"), "", "Ort ohne Staetten bekommt keine Zeile");
assert.strictEqual(avesmapsStaettenRowMarkup(""), "", "leerer Ortsname bekommt keine Zeile");

// ---- ein Eintrag: EINZAHL, und keine Gruppenueberschrift ---------------------------------------
// ⚠️ Einzahl UND Mehrzahl, sonst entsteht „1 besondere Staetten" -- dieselbe Regel wie bei den
// Lore-Zeilen.
// ⚠️ Die Zahl steht im eigenen <span class="infobox-lid__count"> -- der Satz ist im Markup also
// NICHT am Stueck zu finden. Beide Haelften einzeln pruefen.
const eins = avesmapsStaettenRowMarkup("Punin");
assert.ok(eins.indexOf("besondere Stätte verzeichnet") >= 0, "Einzahl: " + eins.slice(0, 160));
assert.ok(eins.indexOf('infobox-lid__count">1<') >= 0, "die Anzahl steht im Deckel");
assert.ok(eins.indexOf("besondere Stätten") < 0, "keine Mehrzahl bei einem Eintrag");
assert.ok(eins.indexOf("Pentagrammaton") >= 0, "der Name steht im Aufgeklappten");
assert.ok(eins.indexOf("avesmaps-lore__gruppe-name") < 0, "EINE Art bekommt keine Ueberschrift");
assert.ok(eins.indexOf("<dt>Stätten</dt>") >= 0, "Hausformat: dt traegt das Label");
assert.ok(eins.indexOf("region-info-box__row") >= 0, "Hausformat: die Zeile reiht sich ein");

// ---- Gross-/Kleinschreibung des Ortsnamens ist egal --------------------------------------------
assert.ok(avesmapsStaettenRowMarkup("punin").indexOf("Pentagrammaton") >= 0, "Ortsname gefaltet");
assert.ok(avesmapsStaettenRowMarkup("  Punin  ").indexOf("Pentagrammaton") >= 0, "Raender getrimmt");

// ---- mehrere Arten: MEHRZAHL + Gruppen nach Art -------------------------------------------------
// 🔴 Gegliedert, nicht flach. Gareth traegt live 154 Staetten in rund 20 Arten; eine flache Liste
// von 154 Namen waere die Zeile, die niemand aufklappt.
payload([
	ort("Neue Brücke", "Grangor", "Brücke"),
	ort("Zweililienbrücke", "Grangor", "Brücke"),
	ort("Immanstadion von Grangor", "Grangor", "Arena"),
	ort("Akademie der Erscheinungen", "Grangor", "Magierakademie", "https://de.wiki-aventurica.de/wiki/Akademie_der_Erscheinungen"),
]);
const vier = avesmapsStaettenRowMarkup("Grangor");
assert.ok(vier.indexOf("besondere Stätten verzeichnet") >= 0, "Mehrzahl");
assert.ok(vier.indexOf('infobox-lid__count">4<') >= 0, "Anzahl 4");
assert.ok(vier.indexOf("avesmaps-lore__gruppe-name") >= 0, "mehrere Arten bekommen Ueberschriften");
// Die Arten stehen deutsch sortiert: Arena vor Brücke vor Magierakademie.
const iArena = vier.indexOf(">Arena<");
const iBruecke = vier.indexOf(">Brücke<");
const iMagier = vier.indexOf(">Magierakademie<");
assert.ok(iArena >= 0 && iBruecke > iArena && iMagier > iBruecke, "Arten deutsch sortiert");
// Die Gruppe traegt ihre Anzahl (2 Bruecken).
assert.ok(vier.indexOf('avesmaps-lore__gruppe-zahl">2<') >= 0, "die Gruppe nennt ihre Anzahl");

// ---- der Link -----------------------------------------------------------------------------------
// ⭐ Verlinkt ueber avesmapsLoreNamesBlockMarkup, NICHT ueber abgeschriebenes Markup -- sonst
// waeren drei CSS-Klassen und die Umschaltschwelle auf Buchstabenmarken doppelt gepflegt.
assert.ok(vier.indexOf('href="https://de.wiki-aventurica.de/wiki/Akademie_der_Erscheinungen"') >= 0,
	"mit wiki_url wird verlinkt");
assert.ok(vier.indexOf('rel="noopener"') >= 0, "externer Link mit noopener");
assert.ok(vier.indexOf("Neue Brücke") >= 0, "ohne wiki_url steht der blanke Name da");

// ---- ohne Art: „Bauwerk" statt einer leeren Ueberschrift -----------------------------------------
payload([ort("Namenloses Ding", "Ferdok", ""), ort("Zweites Ding", "Ferdok", "Turm"), ort("Drittes", "Ferdok", "Turm")]);
const ohneArt = avesmapsStaettenRowMarkup("Ferdok");
assert.ok(ohneArt.indexOf(">Bauwerk<") >= 0, "leere Art faellt auf 'Bauwerk' -- wie beim Suchtreffer");

// ---- viele Eintraege: die Gruppen klappen selbst -------------------------------------------------
// Unter der Schwelle stehen die Gruppen fest da; darueber werden sie <details>, damit Strg+F einen
// Namen in einer zugeklappten Gruppe noch findet.
assert.ok(ohneArt.indexOf("avesmaps-lore__gruppe--fest") >= 0, "wenige: feste Gruppen");
assert.ok(ohneArt.indexOf("<details class=\"avesmaps-lore__gruppe\"") < 0, "wenige: kein details");

const viele = [];
for (let i = 0; i < 30; i += 1) {
	viele.push(ort("Objekt " + i, "Gareth", i % 2 === 0 ? "Tempel" : "Platz"));
}
payload(viele);
const gross = avesmapsStaettenRowMarkup("Gareth");
assert.ok(gross.indexOf('infobox-lid__count">30<') >= 0, "Anzahl stimmt bei 30");
assert.ok(gross.indexOf('<details class="avesmaps-lore__gruppe"') >= 0, "ab 25 klappen die Gruppen");
assert.ok(gross.indexOf('<details class="avesmaps-lore__gruppe" open>') >= 0, "die erste Gruppe steht offen");

// ---- der Index folgt dem Payload ------------------------------------------------------------------
// 💣 Der Cache haengt an der LAENGE der Liste. Ein neuer Payload mit anderer Laenge muss den Index
// erneuern -- sonst zeigte die Infobox nach einem Kartenwechsel die Staetten von vorher.
payload([ort("Einzelstueck", "Riva", "Hafen")]);
assert.ok(avesmapsStaettenRowMarkup("Riva").indexOf("Einzelstueck") >= 0, "neuer Payload wird gelesen");
assert.strictEqual(avesmapsStaettenRowMarkup("Gareth"), "", "der alte Bestand ist weg");

// ---- die reine Datenfunktion ------------------------------------------------------------------------
const liste = avesmapsStaettenFuerOrt("Riva");
assert.strictEqual(liste.length, 1);
assert.strictEqual(liste[0].name, "Einzelstueck");
assert.strictEqual(liste[0].art, "Hafen");
assert.deepStrictEqual(avesmapsStaettenFuerOrt("Gibtsnicht"), [], "unbekannter Ort: leere Liste");

// ---- KEINE Buchstabenmarken (Owner 2026-08-15) ---------------------------------------------------
// 🔴 Bei den Vorkommen sind sie richtig -- 126 Handelswaren in EINER Gruppe. Hier gliedert schon
// die ART: Grangors 23 Arten haben im Schnitt 1,8 Eintraege, und eine Marke „H" ueber einem
// einzigen „Herzog-Cusimo-Aquaedukt" ist eine zweite Gliederungsebene ohne Inhalt.
payload([
	ort("Herzog-Cusimo-Aquädukt", "Grangor", "Äquadukt"),
	ort("Immanstadion von Grangor", "Grangor", "Arena"),
	ort("Neue Brücke", "Grangor", "Brücke"),
	ort("Zweililienbrücke", "Grangor", "Brücke"),
	ort("Alte Brücke", "Grangor", "Brücke"),
]);
const ohneMarken = avesmapsStaettenRowMarkup("Grangor");
assert.ok(ohneMarken.indexOf("avesmaps-lore__buchstabe") < 0,
	"keine Buchstabenmarken in den Staetten-Gruppen");
assert.ok(ohneMarken.indexOf("avesmaps-lore__spalten") < 0, "und kein Spaltenkasten");
assert.ok(ohneMarken.indexOf("avesmaps-lore__names") >= 0, "sondern die Komma-Liste");
assert.ok(ohneMarken.indexOf("Herzog-Cusimo-Aquädukt") >= 0, "die Namen stehen trotzdem da");

// ⚠️ GEGENPROBE: die Lore-Zeilen behalten ihre Marken. Wer die geteilte Funktion umbaut, muss
// beide Aufrufer sehen -- der Default (ohne zweiten Parameter) bleibt AVESMAPS_LORE_LETTER_MIN.
const loreBlock = avesmapsLoreNamesBlockMarkup([
	{ name: "Alrik", wiki_url: "" }, { name: "Boron", wiki_url: "" },
]);
assert.ok(loreBlock.indexOf("avesmaps-lore__buchstabe") >= 0,
	"die Vorkommen behalten ihre Buchstabenmarken");

console.log("settlement-places-row: alle Zusicherungen erfuellt");

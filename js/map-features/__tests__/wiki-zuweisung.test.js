// Der Pruefer hinter dem Haken „Keine Wiki-Zuweisung".
//
// 💣 DIE TRAGENDE ZUSICHERUNG IST DAS FELD, NICHT DIE FARBE. Gemessen wird das ZUWEISUNGSNEST,
// nie das danebenstehende `wiki_url` -- der Lesepfad raet das bei Leere aus dem NAMEN nach (99
// Phantome bei den Orten, 12 bei den Wegen, am Livebestand gemessen). Ein Haken, der `wiki_url`
// liest, laesst 99 Orte gruen, die niemand zugewiesen hat, und niemandem faellt es auf.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/wiki-zuweisung.test.js

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const Z = require(path.join(wurzel, "js", "map-features", "wiki-zuweisung.js"));
const ARTEN = ["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"];

let pruefungen = 0;
const pruefe = (b, was) => { assert.ok(b, was); pruefungen++; };
const ist = (a, b, was) => { assert.strictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };

// ---- A. Der ORT ------------------------------------------------------------------------------
ist(Z.avesmapsWikiZuweisungOrt({ wikiSettlement: { wiki_key: "gareth" } }, "metropole"), "zugewiesen",
	"ein Ort mit Nest ist zugewiesen");
ist(Z.avesmapsWikiZuweisungOrt({ wikiSettlement: null }, "dorf"), "offen", "ohne Nest offen");
ist(Z.avesmapsWikiZuweisungOrt({ wikiSettlement: {} }, "dorf"), "offen", "ein leeres Nest ist keine Zuweisung");
ist(Z.avesmapsWikiZuweisungOrt({ wikiSettlement: { wiki_key: "  " } }, "dorf"), "offen",
	"und ein Schluessel aus Leerzeichen auch nicht");
ist(Z.avesmapsWikiZuweisungOrt({ wikiNoArticle: true }, "dorf"), "geprueft",
	"der Merker „nachgesehen, es gibt keinen“ ist ein eigener Zustand");
// 🔴 Der dritte Zustand darf die Zuweisung NICHT ueberstimmen -- beides gesetzt heisst zugewiesen.
ist(Z.avesmapsWikiZuweisungOrt({ wikiSettlement: { wiki_key: "x" }, wikiNoArticle: true }, "dorf"), "zugewiesen",
	"eine echte Zuweisung schlaegt den Merker");
// 💣 DIE PHANTOM-FALLE: `wiki_url` steht am Objekt und ist geraten. Es darf nichts entscheiden.
ist(Z.avesmapsWikiZuweisungOrt({ wikiUrl: "https://de.wiki-aventurica.de/wiki/Gareth", wiki_url: "x" }, "dorf"),
	"offen", "eine geratene Adresse ist KEINE Zuweisung");
ist(Z.avesmapsWikiZuweisungOrt({}, "crossing"), "", "eine Kreuzung ist ausserhalb");
ist(Z.avesmapsWikiZuweisungOrt(null, "dorf"), "offen", "ein fehlendes Objekt faellt offen aus");

// ---- B. Der WEG -----------------------------------------------------------------------------
// 💣 DIE NAMENSFRAGE STELLT DER PRUEFER NICHT MEHR SELBST -- der Aufrufer reicht sie herein.
// Bis zum 01.09.2026 stand hier eine Nachbildung der Regel „heisst der Weg <Art>-<n>?", gelesen aus
// `properties.name`. Sie war gruen und still kaputt: im BROWSER traegt `name` den MASCHINENnamen
// (normalizeRoutePathFeature schreibt ihn beim Laden um), der echte steht in `display_name`. Der
// Haken erklaerte damit alle 6041 Wege fuer „nicht gemeint" und faerbte keinen einzigen -- waehrend
// genau dieser Test gruen blieb, weil er die ROHE Nutzlast nachbaute.
// 🔴 DIE LEHRE STEHT IN DER SIGNATUR: wer die Antwort hereinreicht, kann kein Feld verwechseln.
// Im Browser beantwortet sie `getPathTitleName` (js/map-features/map-features-path-domain.js).
const NEST = { wiki_path: { wiki_key: "r2" } };
ist(Z.avesmapsWikiZuweisungWeg(NEST, true), "zugewiesen", "benannt + Nest = zugewiesen");
ist(Z.avesmapsWikiZuweisungWeg({}, true), "offen", "benannt ohne Nest ist der Befund");
ist(Z.avesmapsWikiZuweisungWeg({ wiki_no_article: true }, true), "geprueft", "auch der Weg kennt den dritten Zustand");
ist(Z.avesmapsWikiZuweisungWeg({}, false), "", "ohne Menschennamen ist er ausserhalb");
// ⚠️ „Kein Name" schlaegt sogar eine vorhandene Zuweisung -- er ist gar nicht gemeint.
ist(Z.avesmapsWikiZuweisungWeg(NEST, false), "", "ausserhalb bleibt ausserhalb");
// 💣 STRIKT `=== true`, und das ist die tragende Zeile. Der Aufrufer reicht das Ergebnis eines
// Vergleichs herein; vergaesse ihn jemand, kaeme `undefined` an. Waere die Pruefung wahrheitswertig
// gedreht („!hatEchtenNamen"), waere das Ergebnis dasselbe wie hier -- aber ein durchgereichtes
// `"Wolfskopfpass"` (der NAME statt der Antwort) waere dann still ein Ja. Es ist ein Nein.
for (const falsch of [undefined, null, "", "Wolfskopfpass", 1, {}]) {
	ist(Z.avesmapsWikiZuweisungWeg(NEST, falsch), "",
		`nur echtes true zaehlt, nicht ${JSON.stringify(falsch)}`);
}

// ---- D. Die BESCHRIFTUNG ----------------------------------------------------------------------
ist(Z.avesmapsWikiZuweisungBeschriftung({ wikiRegion: { wiki_key: "moor" } }), "zugewiesen", "Label mit Nest");
ist(Z.avesmapsWikiZuweisungBeschriftung({ wikiRegion: null }), "offen", "Label ohne Nest");
ist(Z.avesmapsWikiZuweisungBeschriftung({ keinArtikel: true }), "geprueft", "Label mit Merker");
ist(Z.avesmapsWikiZuweisungBeschriftung({ wikiRegion: { wiki_key: "m" }, keinArtikel: true }), "zugewiesen",
	"auch hier schlaegt die Zuweisung den Merker");

// ---- E. Die FLAECHE ---------------------------------------------------------------------------
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "vegetation", wiki_region_key: "wald" }), "zugewiesen", "Flaeche mit Schluessel");
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "vegetation", wiki_region_key: "" }), "offen", "Flaeche ohne");
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "topographie" }), "offen", "fehlendes Feld ist offen");
// ⚠️ Klimabaender sind ABGELEITET und haben nie einen Artikel.
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "klima" }), "", "ein Klimaband ist ausserhalb");
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "klima", wiki_region_key: "x" }), "", "auch mit Schluessel");
// ⚠️ Bei der Flaeche gibt es KEIN „geprueft" -- das Haekchen ist am 16.08.2026 gefallen und die
// Nutzlast fuehrt das Feld nicht. Nicht vergessen, sondern nicht vorhanden.
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "vegetation", wiki_no_article: true }), "offen",
	"die Flaeche kennt den dritten Zustand nicht");

// ---- F. Was wird markiert? --------------------------------------------------------------------
pruefe(Z.avesmapsWikiZuweisungMarkiert("offen"), "offen wird markiert");
pruefe(Z.avesmapsWikiZuweisungMarkiert("geprueft"), "geprueft auch -- nur ruhiger");
pruefe(!Z.avesmapsWikiZuweisungMarkiert("zugewiesen"), "zugewiesen nicht");
pruefe(!Z.avesmapsWikiZuweisungMarkiert(""),
	"und ausserhalb erst recht -- „nicht gemeint“ ist kein Befund");

// ---- G. Die Regel steht NICHT mehr hier -------------------------------------------------------
// 💣 EIN TEST GEGEN EINE ABSCHRIFT, DIE ES NICHT MEHR GEBEN DARF. Hier stand bis zum 01.09.2026 ein
// Textvergleich gegen die PHP-Fassung (avesmapsWikiPathNameIsGeneric, api/_internal/wiki/
// path-naming.php) -- er hielt zwei Abschriften derselben Regel im Gleichschritt. Die Abschrift ist
// weg: die Frage beantwortet im Browser `getPathTitleName`, das ueber shouldShowRoutePathDisplayName
// dieselbe Regel fuehrt. Dieser Riegel sorgt dafuer, dass sie nicht zurueckkommt.
const jsQuelle = fs.readFileSync(path.join(wurzel, "js", "map-features", "wiki-zuweisung.js"), "utf8");
// 💣 KOMMENTARE RAUS, BEVOR GEMESSEN WIRD. Die erste Fassung dieser Zeilen fiel ueber ihre eigene
// BEGRUENDUNG: der Kopf des Ortspruefers erklaert, warum `locationType` nicht `feature_subtype` ist
// -- und das Wort „subtype" darin sah wie eine nachgebaute Namensregel aus. Ein Test, der
// Fliesstext misst, meldet Befunde, die es nicht gibt (und uebersieht die, die es gibt).
const ZEILENENDE = String.fromCharCode(10);
const jsCode = jsQuelle
	.split(ZEILENENDE)
	.filter((zeile) => {
		const t = zeile.trim();
		return t !== "" && !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
	})
	.join(ZEILENENDE);
// 🪤 `"\\S+-"` mit ZWEI Rueckstrichen: `"\S+-"` waere in einer JS-Zeichenkette schlicht `"S+-"` und
// traefe nie -- eine Zusicherung, die immer gruen ist. Genau so stand sie hier zuerst.
for (const muster of ["\\S+-", "PATH_SUBTYPE_KEYS", "preg", "subtype", "RegExp"]) {
	pruefe(!jsCode.includes(muster),
		`der reine Pruefer baut die Namensregel NICHT nach (fand „${muster}“ im Code)`);
}
// ⚠️ Der VERWEIS dagegen gehoert in den Kommentar -- gemessen wird deshalb die ganze Datei.
pruefe(jsQuelle.includes("getPathTitleName"),
	"er nennt stattdessen die Funktion, die sie beantwortet -- sonst findet sie beim Aendern niemand");
// Und die PHP-Fassung gibt es weiterhin: sie ist der SERVER-seitige Zwilling von
// shouldShowRoutePathDisplayName, und dieser Test haengt nicht mehr an ihr, aber der Verweis schon.
pruefe(fs.existsSync(path.join(wurzel, "api", "_internal", "wiki", "path-naming.php")),
	"path-naming.php steht weiterhin (die serverseitige Fassung derselben Regel)");

console.log(`wiki-zuweisung.test.js: ${pruefungen} Pruefungen erfuellt`);

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
// 🔴 DER DRITTE ZUSTAND IST GEFALLEN (Owner 09.09.2026). Ein Altbestand-Merker am Objekt darf
// NICHTS mehr entscheiden -- er ist tote Ladung, bis Schritt 4 ihn aus den Daten nimmt. Bis dahin
// tragen ihn 10 Objekte, und die sollen sich genauso verhalten wie jedes andere unzugewiesene.
ist(Z.avesmapsWikiZuweisungOrt({ wikiNoArticle: true }, "dorf"), "offen",
	"der alte Merker entscheidet nichts mehr -- ohne Zuweisung ist der Ort offen");
ist(Z.avesmapsWikiZuweisungOrt({ wikiSettlement: { wiki_key: "x" }, wikiNoArticle: true }, "dorf"), "zugewiesen",
	"und eine echte Zuweisung bleibt eine Zuweisung");
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
ist(Z.avesmapsWikiZuweisungWeg({ wiki_no_article: true }, true), "offen",
	"auch beim Weg entscheidet der alte Merker nichts mehr");
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
ist(Z.avesmapsWikiZuweisungBeschriftung({ keinArtikel: true }), "offen",
	"und bei der Beschriftung ebenso -- der Merker ist ueberall gefallen");
ist(Z.avesmapsWikiZuweisungBeschriftung({ wikiRegion: { wiki_key: "m" }, keinArtikel: true }), "zugewiesen",
	"die Zuweisung entscheidet, und sonst nichts");

// ---- E. Die FLAECHE ---------------------------------------------------------------------------
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "vegetation", wiki_region_key: "wald" }), "zugewiesen", "Flaeche mit Schluessel");
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "vegetation", wiki_region_key: "" }), "offen", "Flaeche ohne");
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "topographie" }), "offen", "fehlendes Feld ist offen");
// ⚠️ Klimabaender sind ABGELEITET und haben nie einen Artikel.
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "klima" }), "", "ein Klimaband ist ausserhalb");
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "klima", wiki_region_key: "x" }), "", "auch mit Schluessel");
// ⭐ DIE FLAECHE WAR DIE VORLAGE. Sie kannte den dritten Zustand seit dem 16.08.2026 nicht mehr;
// seit dem 09.09.2026 sehen alle vier Pruefer so aus wie sie. Wer hier eine Sonderform baut, baut
// die Divergenz zurueck, die der Ausbau beseitigt hat.
ist(Z.avesmapsWikiZuweisungFlaeche({ kind: "vegetation", wiki_no_article: true }), "offen",
	"auch die Flaeche laesst sich vom alten Merker nichts sagen");

// ---- F. Was wird markiert? --------------------------------------------------------------------
pruefe(Z.avesmapsWikiZuweisungMarkiert("offen"), "offen wird markiert");
pruefe(!Z.avesmapsWikiZuweisungMarkiert("zugewiesen"), "zugewiesen nicht");
pruefe(!Z.avesmapsWikiZuweisungMarkiert(""),
	"und ausserhalb erst recht -- „nicht gemeint“ ist kein Befund");
// 💣 UND „geprueft" IST KEIN ZUSTAND MEHR. Er kam bis zum 09.09.2026 aus dem Merker und wurde
// markiert wie „offen", nur blasser. Waere der Zustand geblieben und nur sein Erzeuger gefallen,
// haette diese Zeile weiter `true` geliefert -- eine tote Verzweigung, die der naechste Leser fuer
// lebende Regel haelt.
pruefe(!Z.avesmapsWikiZuweisungMarkiert("geprueft"),
	"🔴 „geprueft“ gibt es nicht mehr -- ein unbekannter Zustand wird NICHT markiert");

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

// ---- H. RUECKBAU-WAECHTER: der dritte Zustand kommt nicht zurueck -----------------------------
// 🔴 OWNER-ENTSCHEID 09.09.2026: `properties.wiki_no_article` faellt global. Das Aequivalent des
// Merkers ist die WIKI-ZUWEISUNG -- wer sich frueher seiner bediente, fragt das Nest ab.
//
// 💣 WARUM ES IHN GAB, damit ihn niemand aus Versehen wieder einfuehrt: er war der Notausgang gegen
// das Namensraten der Kartennutzlast (Discord #38). Bis zum 08.09.2026 fuellte
// `avesmapsEnrichMapFeatureWikiUrl` die Adresse aus dem NAMEN des Objekts; eine geloeste Zuweisung
// kam beim naechsten Lesen zurueck, also brauchte es eine zweite, NEGATIVE Aussage. Commit
// `420f12cfc` hat den Rateweg zurueckgebaut -- 》Trennen《 haelt seither von allein, und damit hat
// der Merker keinen Gegenstand mehr.
//
// ⚠️ DER PREIS IST BENANNT UND GEWOLLT: die Unterscheidung „nachgesehen, es gibt nichts" gegen „hat
// noch niemand angesehen" faellt. Wer sie vermisst, hat NICHT einen Fehler gefunden -- er sieht die
// Entscheidung. Sie zurueckzunehmen heisst, den Merker mitsamt seinen Schreibwegen wieder zu bauen.
for (const zustand of ["AVESMAPS_WIKI_ZUWEISUNG_GEPRUEFT"]) {
	pruefe(Z[zustand] === undefined, `🔴 ${zustand} ist gefallen und darf nicht zurueckkehren`);
}
for (const merker of ["wikiNoArticle", "wiki_no_article", "keinArtikel", "geprueft"]) {
	pruefe(!jsCode.includes(merker),
		`🔴 der reine Pruefer nennt „${merker}“ nicht mehr -- der Merker ist am 09.09.2026 gefallen`);
}
// ⚠️ Der VERWEIS gehoert weiterhin in den Kommentar: ohne ihn sucht der naechste Leser die
// Begruendung im Git-Log statt in der Datei.
pruefe(jsQuelle.includes("Discord #38"),
	"die Datei sagt, WARUM es den Merker gab -- sonst fuehrt ihn irgendwann jemand wieder ein");

console.log(`wiki-zuweisung.test.js: ${pruefungen} Pruefungen erfuellt`);

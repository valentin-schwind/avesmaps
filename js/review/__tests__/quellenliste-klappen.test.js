const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// Lange Quellenlisten klappen ab der sechsten Quelle zusammen (Owner 24.08.2026: „wenn mehr wie 5
// quellen dranstehen, ist der rest zusammengeklappt und man kann ‚mehr anzeigen'").
//
// 🔴 NATIV `<details>/<summary>`, und nichts anderes. Nur damit findet Strg+F den Text einer
// ZUgeklappten Quelle und klappt sie selbst auf; ein selbstgebautes Auf- und Zuklappen mit `hidden`
// nimmt der Seitensuche den Text weg. Dieselbe Begründung wie beim Fenster „Hinweise" (AGENTS.md
// §11). Fokus, Enter/Leertaste und `aria-expanded` kommen ebenfalls vom Element.
//
// 🔴 BEIDE Listen, nicht eine. Der Wiki-Zweig ist der lange, aber eine Klappregel, die nur eine von
// zwei Listen bindet, ist keine Regel -- die Lehre der Verkehrsmittel-Sperre.
//
// ⚠️ Gemessen am gebauten Dialog (24.08.2026, 20 Quellen): 814 px zugeklappt auf 380 px.
//
// Aus der Wurzel des Repos:  node js/review/__tests__/quellenliste-klappen.test.js

const wurzel = path.join(__dirname, "..", "..", "..");
const quelle = fs.readFileSync(path.join(wurzel, "js/review/review-feature-sources.js"), "utf8");

// Das Modul lädt ohne Browser -- es ist reines Markup-Bauen plus fetch, und fetch rufen wir nicht.
const kontext = { fetch: () => Promise.resolve(null), document: undefined, window: undefined };
vm.createContext(kontext);
// ⚠️ ZUERST der reine Renderer: er traegt `featureSourceShortenPages`, das der Zeilenbauer aufruft.
// Dieselbe Reihenfolge wie in den fuenf HTML-Seiten -- wer sie hier umdreht, hat einen Test, der
// eine Verdrahtung prueft, die es im Browser so nicht gibt.
vm.runInContext(fs.readFileSync(path.join(wurzel, "js/ui/feature-source-markup.js"), "utf8"),
	kontext, { filename: "feature-source-markup.js" });
vm.runInContext(quelle, kontext, { filename: "review-feature-sources.js" });

const esc = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) =>
	({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const quellen = (n, origin) => Array.from({ length: n }, (_, i) => ({
	id: i + 1, url: "https://wiki/x" + i, label: "Publikation " + (i + 1),
	source_type: "regelwerk", is_official: true, origin: origin, pages: "S. 12",
}));
const bau = (n, origin) => kontext.renderFeatureSourceEditorHtml(
	{ sources: quellen(n, origin), wiki_url: "" }, { escape: esc });

// ---- A. Die Schwelle -----------------------------------------------------------------------------
// 🪤 Die Schwelle ist ein `const` auf Modulebene -- in einem vm-Kontext landet das NICHT auf dem
// Global (nur `var` und Funktionsdeklarationen tun das). Gemessen wird sie deshalb am VERHALTEN,
// und das ist ohnehin die schaerfere Zusicherung: eine benannte Konstante, die niemand liest,
// beweist nichts.
assert.ok(/const FEATURE_SOURCE_COLLAPSE_AFTER = 5;/.test(quelle),
	"die Schwelle steht als benannte Konstante da, nicht als Ziffer im Rumpf");

// Genau FUENF Zeilen bleiben ausserhalb des Kastens -- gezaehlt, nicht geglaubt.
// 🪤 `class="fs-row` OHNE Abschluss trifft AUCH `fs-row__link`, `fs-row__badge`, `fs-row__pages`
// -- bei zwanzig Quellen 102 Treffer statt 20, und die Zusicherung ist dann eine Zufallszahl. Das
// Zeichen danach muss das Anfuehrungszeichen oder ein Leerzeichen sein (`fs-row fs-row--add`).
const vorDemKasten = (html) => {
	const k = html.indexOf("<details class=\"fs-more\">");
	return ((k < 0 ? html : html.slice(0, k)).match(/class="fs-row["\s]/g) || []).length;
};
assert.strictEqual(vorDemKasten(bau(20, "wiki_publication")), 5,
	"fuenf stehen offen, der Rest im Kasten");

for (const anzahl of [0, 1, 4, 5]) {
	assert.ok(bau(anzahl, "wiki_publication").indexOf("fs-more") < 0,
		anzahl + " Quellen: noch kein Klappkasten");
}
assert.ok(bau(6, "wiki_publication").indexOf("fs-more") >= 0, "ab sechs klappt der Rest");

// ---- B. 🔴 NATIV, und die Zahl steht IM Knopf ------------------------------------------------------
const zwanzig = bau(20, "wiki_publication");
assert.ok(/<details class="fs-more">/.test(zwanzig), "es ist ein <details>, kein Eigenbau");
assert.ok(/<summary class="fs-more__toggle">/.test(zwanzig), "mit einem <summary> als Knopf");
// ⚠️ Ein „mehr anzeigen" OHNE Zahl zwingt zum Aufklappen, nur um zu sehen, ob es sich lohnt.
assert.ok(/15 weitere Quellen/.test(zwanzig), "der Knopf nennt die Zahl: " + (zwanzig.match(/>[^<]*weitere[^<]*</) || [])[0]);
assert.ok(/eine weitere Quelle/.test(bau(6, "wiki_publication")), "und im Einzahlfall die Einzahl");

// 💣 Kein `hidden` und kein `display:none` fuer die versteckten Zeilen -- das naehme der Seitensuche
// den Text. Genau dafuer ist das <details> da.
const restBlock = zwanzig.slice(zwanzig.indexOf("fs-more__rest"));
assert.ok(!/hidden/.test(restBlock.slice(0, 200)),
	"der versteckte Teil traegt kein `hidden`");

// ---- C. Die Zeilen sind ALLE da, nur eingeklappt --------------------------------------------------
// 🔴 Das IST die Strg+F-Zusage: der Text steht im DOM, der Browser klappt beim Finden selbst auf.
const zeilen = (zwanzig.match(/class="fs-row["\s]/g) || []).length;
assert.ok(zeilen >= 20, "alle zwanzig Zeilen stehen im Markup, gefunden: " + zeilen);
assert.ok(zwanzig.indexOf("Publikation 20") >= 0, "auch die letzte, obwohl eingeklappt");

// ---- D. 🔴 BEIDE Listen, nicht nur die lange ------------------------------------------------------
// Der Wiki-Zweig ist der lange -- aber eine Regel, die eine von zwei Listen bindet, ist keine.
const manuell = bau(12, "manual");
assert.ok(manuell.indexOf("fs-more") >= 0, "auch die von Hand gepflegte Liste klappt");
assert.ok(/7 weitere Quellen/.test(manuell), "und zaehlt richtig");

// ⚠️ Die zwei Listen klappen UNABHAENGIG: ein Objekt mit vier manuellen und zwanzig Wiki-Quellen
// bekommt genau EINEN Kasten, nicht zwei und nicht keinen.
const gemischt = kontext.renderFeatureSourceEditorHtml({
	sources: quellen(20, "wiki_publication").concat(
		quellen(4, "manual").map((s, i) => Object.assign({}, s, { id: 100 + i }))),
	wiki_url: "",
}, { escape: esc });
assert.strictEqual((gemischt.match(/<details class="fs-more">/g) || []).length, 1,
	"vier manuelle klappen nicht, zwanzig Wiki-Quellen schon");

// ---- E. Der Stil traegt die Untergrenze des Hauses -------------------------------------------------
const stil = fs.readFileSync(path.join(wurzel, "css/features/feature-sources.css"), "utf8");
// ⚠️ Seit 03.09.2026 teilt sich der Knopf seine Regel mit der Falte „Neue Quelle einfügen"
// (`.fs-more__toggle,\n.fs-add-fold__toggle {`) -- EINE Rezeptur, zwei Namen (Owner: „alle boxen
// unter einem klapptext verschwinden"). Der Rumpf beginnt deshalb hinter der Selektorliste.
const vonS = stil.search(/\.fs-more__toggle(,[^{]*)?\s*\{/);
assert.ok(vonS >= 0, "der Knopf hat eine Regel");
const regel = stil.slice(stil.indexOf("{", vonS), stil.indexOf("}", vonS));
const groesse = (regel.match(/font-size:\s*(\d+)px/) || [])[1];
// ⚠️ 11px ist die Untergrenze (AGENTS.md §12) -- 10px sind im Haus schon zweimal durchgerutscht.
assert.ok(Number(groesse) >= 11, "der Knopf steht auf mindestens 11px, gefunden: " + groesse);
// 💣 Und keine harte Farbe.
assert.ok(!/#[0-9a-fA-F]{3,6}/.test(regel), "er nimmt ein Token, keinen Hexwert");
// ⚠️ Bewegung nur, wo sie erwuenscht ist.
assert.ok(/prefers-reduced-motion/.test(stil), "die Drehung des Dreiecks respektiert die Systemwahl");

// ---- F. Das Spaltenraster (Owner 24.08.2026: „ein tabellarisches layout") ------------------------
// 💣 KEIN echtes <table>: der Klappkasten ist ein <details>, und das darf zwischen <tr> nicht stehen.
// Das Raster liegt deshalb JE ZEILE mit DERSELBEN Vorlage -- nur so stehen die Spalten auch ueber die
// Grenze des Kastens hinweg untereinander. Beide Vorlagen muessen also woertlich gleich sein.
// 🪤 Der Griff muss am ZEILENANFANG ansetzen: `.fs-row + .fs-row {` endet woertlich auf `.fs-row {`,
// ein `indexOf` findet also die Trennlinien-Regel und meldet „ist gar kein Raster". Dieselbe Falle wie
// beim Suchmuster mit Klammer bei den Zoombaendern -- ein Muster, das die andere Schreibweise nie sieht.
const regelVon = (selektor) => {
	const m = new RegExp("^\\" + selektor + " \{", "m").exec(stil);
	if (!m) { return ""; }
	return stil.slice(m.index, stil.indexOf("}", m.index));
};
const spaltenVorlage = (selektor) =>
	(regelVon(selektor).match(/grid-template-columns:\s*([^;]+);/) || [])[1];
const rowVorlage = spaltenVorlage(".fs-row");
const kopfVorlage = spaltenVorlage(".fs-col-heads");
// 💣 Die Vorlage ALLEIN beweist nichts: `grid-template-columns` an einem Flex-Container ist inert.
// Ein `display: flex` an `.fs-row` liesse jede Vorlage stehen und das Spaltenraster trotzdem
// verschwinden -- die einzige Mutation, die diesen Test zunaechst ueberlebt hat.
for (const [wer, was] of [[".fs-row", rowVorlage], [".fs-col-heads", kopfVorlage]]) {
	assert.ok(/display:\s*grid/.test(regelVon(wer)), wer + " IST ein Raster, nicht nur beschriftet wie eines");
	assert.ok(was, wer + " traegt eine Spaltenvorlage");
}
assert.strictEqual(kopfVorlage, rowVorlage,
	"die Spaltenueberschrift steht auf DERSELBEN Vorlage wie ihre Zeilen: " + kopfVorlage + " vs " + rowVorlage);

// 💣 Eine LEERE Zelle, wenn ein Feld fehlt -- nicht gar keine. Faellt eine Zelle weg, rutscht alles
// rechts davon eine Spalte nach links, und genau die Ausrichtung geht verloren, um die es hier geht.
const ohneAlles = kontext.renderFeatureSourceEditorHtml({
	sources: [{ id: 1, url: "https://w/1", label: "Nackt", source_type: "regelwerk", origin: "manual" }],
	wiki_url: "",
}, { escape: esc });
for (const zelle of ["fs-row__kind", "fs-row__pages"]) {
	assert.ok(ohneAlles.indexOf(zelle) >= 0,
		"auch ohne Wert steht die Zelle da: " + zelle);
}

// ⚠️ Die Eingabezeile ist von diesem Raster AUSGENOMMEN -- sie hat neun Zellen statt sechs und
// verschob die Seitenspalte sonst um 113 px (gemessen 24.08.2026: 771 gegen 658).
//
// 💣 UND HIER STAND EINE ZUSICHERUNG IM VAKUUM. Sie las `display: flex` aus der Regel und war
// zufrieden -- aber `.fs-row { display: grid }` steht WEITER UNTEN in derselben Datei und ist gleich
// spezifisch (0,1,0); bei Gleichstand gewinnt die spaetere. Die Deklaration stand also da und galt
// nicht: die Eingabezeile lief vom 24.08. bis zum 29.08.2026 als RASTER, ihre Bedienelemente flossen
// in sechs Spalten, die Lizenzauswahl landete in der 22px-Spalte des Entfernen-Knopfs (Meldung #104,
// live gemessen). Geprueft wird deshalb, WER den Gleichstand gewinnt, nicht dass die Zeile dasteht.
const addSelektor = (/^(\.fs-row)?\.fs-row--add \{/m.exec(stil) || [])[0];
assert.ok(addSelektor, "die Eingabezeile hat eine eigene Regel am Zeilenanfang");
const addRegel = stil.slice(stil.indexOf(addSelektor), stil.indexOf("}", stil.indexOf(addSelektor)));
assert.ok(/display:\s*flex/.test(addRegel),
	"die Eingabezeile bleibt eine Flex-Zeile, sonst zerreisst sie das Raster");
// Klassen zaehlen = Spezifitaet vergleichen (beide Selektoren sind reine Klassenketten).
const klassen = (sel) => (sel.match(/\.[\w-]+/g) || []).length;
const rowRegelStart = stil.search(/^\.fs-row \{/m);
const addRegelStart = stil.indexOf(addSelektor);
assert.ok(
	klassen(addSelektor) > klassen(".fs-row ") || addRegelStart > rowRegelStart,
	"die Regel der Eingabezeile SETZT SICH DURCH gegen `.fs-row { display: grid }` -- entweder"
	+ " spezifischer oder spaeter, sonst ist ihr `display: flex` wirkungslos");

// 💣 Und die Auswahlfelder der Eingabezeile werden ueber `select` gebunden, nicht einzeln
// aufgezaehlt. `.fs-add-license` kam am 27.08.2026 dazu, stand in der Aufzaehlung nicht und zeichnete
// daneben in Browser-Vorgabe (19 px hoch gegen 27, 13,3 px Schrift gegen 12; live gemessen 29.08.).
// Eine Regel, die zwei von drei Auswahlfeldern bindet, ist keine Regel.
const addZeile = kontext.renderFeatureSourceEditorHtml({ sources: [], wiki_url: "" }, { escape: esc });
const auswahlfelder = (addZeile.match(/<select class="/g) || []).length;
assert.ok(auswahlfelder >= 3, "die Eingabezeile traegt mehrere Auswahlfelder, gefunden: " + auswahlfelder);
// 🪤 03.09.2026: gebunden wird jetzt an `.fs-scope`, nicht an `.fs-row--add` -- dieselbe
// Regel gilt seither BEIDEN Formularen. Die Lehre darunter ist unverändert und war der Grund
// für die Zusammenlegung: eine Regel, die zwei von drei Auswahlfeldern bindet, ist keine.
assert.ok(/\.fs-scope select[,\s{]/.test(stil),
	"die Optik der Eingabefelder bindet ALLE Auswahlfelder ueber `select` -- sonst faellt das naechste"
	+ " neue Feld genauso durch wie `.fs-add-license`");

// ---- F2. Der schmale Kasten misst den KASTEN, nicht das Fenster (Meldung #104) --------------------
// 🔴 Das Widget haengt in Behaeltern, die mit der Fensterbreite nichts zu tun haben: der Dialog
// „Ort bearbeiten" gibt ihm 500 px, waehrend der Bildschirm 1600 traegt. Eine Media Query feuert dort
// nie, und die feste Spaltenliste liess dem Titel 6 px -- der Link war UNSICHTBAR, nicht gekuerzt.
assert.ok(/container-type:\s*inline-size/.test(regelVon(".fs-editor")),
	"`.fs-editor` ist der Messkasten -- ohne `container-type` greift keine `@container`-Regel");
const schmal = /@container[^{]*\(max-width:\s*(\d+)px\)\s*\{/.exec(stil);
assert.ok(schmal, "der schmale Fall haengt an einer @container-Regel");
// ⚠️ Die Schwelle muss ueber der Summe der festen Spalten liegen (494 px), sonst ist sie wirkungslos.
assert.ok(Number(schmal[1]) > 494,
	"die Schwelle liegt ueber den 494 px fester Spalten, gefunden: " + schmal[1]);
// 💣 KEINE zweite Wahrheit daneben: eine Media Query mit anderen Massen auf derselben Vorlage
// gewaenne bei schmalem Fenster und widerspraeche der Container-Regel.
assert.ok(!/@media[^{]*max-width[^{]*\{[\s\S]{0,400}?grid-template-columns/.test(stil),
	"die alte Media Query ist WEG -- zwei Riegel mit verschiedenen Massen sind zwei Wahrheiten");

// ---- G. Lange Seitenangaben (Owner: „mit ... abkuerzen (oder 1. seite und dann mit ff.)") ---------
// 🔴 `ff.` statt `…`: es sagt AUS, was es meint. Die volle Angabe geht nicht verloren, sie steht im
// Titel -- eine Kuerzung, die das Gekuerzte wegwirft, ist Datenverlust in der Anzeige.
const kurz = kontext.featureSourceShortenPages;
// 💣 Sie kommt aus `feature-source-markup.js`, nicht aus dem Zeilenbauer -- dieselbe Spalte steht in
// der Infobox, die jeder Besucher sieht. Gewacht von `quellen-kuerzung-eine-quelle.test.js`.
assert.ok(quelle.indexOf("function featureSourceShortenPages(") < 0,
	"der Zeilenbauer definiert sie NICHT selbst -- zwei Fassungen laufen auseinander");
assert.strictEqual(typeof kurz, "function", "die Kuerzung ist eine eigene, reine Funktion");

const lang = "16, 19, 27, 28, 39, 63, 96, 102, 104, 105, 114, 122";
// 🪤 FELDWEISE, nicht `deepStrictEqual`: das Ergebnis entsteht im vm-Kontext und traegt dessen
// `Object.prototype`. Der Vergleich scheitert dann bei Ziffer-fuer-Ziffer gleichen Werten, und die
// Fehlermeldung zeigt zweimal dasselbe Objekt -- man sucht den Fehler im Code statt im Test.
const gekuerzt = kurz(lang);
assert.strictEqual(gekuerzt.kurz, "16 ff.", "zwoelf Einzelseiten werden zu ihrer ersten plus ff.");
assert.strictEqual(gekuerzt.voll, lang, "die volle Angabe reist unveraendert mit");
assert.strictEqual(gekuerzt.gekuerzt, true, "und sagt, dass gekuerzt wurde");

// ⚠️ DREI bleiben stehen -- „8, 15, 80" liest man in einem Blick, und `ff.` behauptete dort eine
// Fortsetzung, die es nicht gibt.
for (const knapp of ["674", "91, 92", "8, 15, 80"]) {
	assert.strictEqual(kurz(knapp).gekuerzt, false, knapp + " bleibt ungekuerzt");
}
// 💣 Ein BEREICH wird nie gekuerzt: er ist schon kurz, und `ff.` machte aus einem bekannten Ende ein
// offenes. Er enthaelt kein Komma, faellt also gar nicht erst in die Zaehlung.
assert.strictEqual(kurz("16-122").kurz, "16-122", "ein Bereich bleibt, wie er ist");
assert.strictEqual(kurz("").kurz, "", "leer bleibt leer");
assert.strictEqual(kurz(null).kurz, "", "und null wirft nicht");

// 🔴 Die VOLLE Angabe steht im Titel, und NUR wenn wirklich gekuerzt wurde.
const mitLang = kontext.renderFeatureSourceEditorHtml({
	sources: [{ id: 1, url: "https://w/1", label: "Lang", source_type: "regelwerk",
		origin: "manual", pages: lang }],
	wiki_url: "",
}, { escape: esc });
assert.ok(/S\. 16 ff\./.test(mitLang), "die Zeile zeigt die Kurzform");
assert.ok(mitLang.indexOf("title=\"S. " + lang + "\"") >= 0,
	"und traegt die volle Angabe im Titel");
const mitKurz = kontext.renderFeatureSourceEditorHtml({
	sources: [{ id: 1, url: "https://w/1", label: "Kurz", source_type: "regelwerk",
		origin: "manual", pages: "91, 92" }],
	wiki_url: "",
}, { escape: esc });
// 🪤 Auf die SEITENZELLE zielen, nicht auf `title=` im ganzen Markup: die Abdeckungs-Erklaerung
// darueber traegt selbst einen Titel, und ein blosses `indexOf("title=")` misst deshalb sie.
const seitenZelle = (html) => (html.match(/<span class="fs-row__pages"[^>]*>/) || [])[0] || "";
assert.ok(/title=/.test(seitenZelle(mitLang)), "die gekuerzte Zelle traegt die volle Angabe");
assert.ok(!/title=/.test(seitenZelle(mitKurz)),
	"eine ungekuerzte Angabe bekommt KEINEN Titel -- der Hilfezeiger versprach sonst mehr, als da ist");

// ⚠️ Das Zeichen der Kuerzung haengt am Titel, nicht an einer zweiten Klasse -- ohne es liest sich
// „S. 16 ff." wie die vollstaendige Angabe.
assert.ok(/\.fs-row__pages\[title\]/.test(stil),
	"eine gekuerzte Angabe ist als solche erkennbar (gestrichelte Unterlinie + Hilfezeiger)");

console.log("quellenliste-klappen: alle Zusicherungen gruen");

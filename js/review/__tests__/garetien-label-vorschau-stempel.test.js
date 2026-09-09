"use strict";

/*
 * DER STEMPEL der Beschriftungs-Vorschau -- wirklich AUSGEFÜHRT, nicht gelesen.
 * =================================================================================================
 *
 * Owner 09.09.2026: „labels von flaechen siedlungen etc, die im importer auf der stage eingestellt
 * werden koennen, sollen so erscheinen, wie sie im endprodukt … sichtbar sein wird."
 *
 * 💣 WARUM ES DIESE DRITTE DATEI GIBT. Die reine Regel prueft
 * garetien-label-vorschau.test.js, den Zeichenweg garetien-label-vorschau-zeichnen.test.js -- aber
 * die NAHT zwischen ihnen, `garetienVorschauLabelStempeln` in `avesmapsGaretienAufDerKarte`, faehrt
 * keiner von beiden: der Zeichentest legt sich das Feld von Hand hin, und der Regeltest kennt den
 * Importer nicht. Auch der Nachbartest der Endkreuzungen laedt den Importer ALLEIN, ohne das
 * Regelmodul -- dort faellt der Stempel durch seinen `typeof`-Riegel und tut nichts.
 * ⭐ Damit haette ein falscher Feldname, eine verdrehte Stempel-Reihenfolge oder ein zu frueh
 * gefragter Eingabenzustand NUR die Quelltext-Zusicherungen gegen sich. Genau diese Luecke hat am
 * 03.09.2026 die Karte zwei Stunden ohne Beschriftungen dastehen lassen -- bei gruenem Regex-Test.
 * Hier laufen Regelmodul UND Importer zusammen, und der Stempel wird gefahren.
 */

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };
global.document = global.document || {
	documentElement: { classList: { add() {} } },
	getElementById() { return null; },
	createElement() { return { style: {}, classList: { add() {} }, setAttribute() {} }; },
};

const WURZEL = path.resolve(__dirname, "..", "..", "..");
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/map-features-line-catmull.js"), "utf8"),
	{ filename: "map-features-line-catmull.js" }
);
vm.runInThisContext(fs.readFileSync(path.join(WURZEL, "js/config.js"), "utf8"),
	{ filename: "config.js" });
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/map-features-path-domain.js"), "utf8"),
	{ filename: "map-features-path-domain.js" }
);
global.AVESMAPS_LABEL_ART_NAMEN =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).AVESMAPS_LABEL_ART_NAMEN;
global.avesmapsLabelArtName =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

// 🔴 DIE REIHENFOLGE IST DER PUNKT DIESER DATEI: das Regelmodul VOR dem Importer, so wie index.html
// es laedt. Ohne es faellt der Stempel durch seinen `typeof`-Riegel -- und genau dieser Fall ist die
// Luecke, die diese Datei schliesst.
const regel = require(path.resolve(__dirname, "..", "review-garetien-label-vorschau.js"));
global.garetienVorschauLabelAus = regel.garetienVorschauLabelAus;
global.AVESMAPS_GARETIEN_VORSCHAU_ARTEN = regel.AVESMAPS_GARETIEN_VORSCHAU_ARTEN;

const fenster = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const karte = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum); checks++; }
function nahe(ist, soll, warum) {
	assert.ok(Math.abs(Number(ist) - Number(soll)) < 1e-9,
		(warum || "") + " (ist " + ist + ", soll " + soll + ")");
	checks++;
}

const FELD = fenster.AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL;

// 🔴 DER GEKOPPELTE WERT, zur LAUFZEIT gegeneinander gehalten -- nicht als Zeichenkette gesucht.
// Liefe er auseinander, stempelte das eine Modul, was das andere nie liest, und zwar STILL.
gleich(FELD, karte.AVESMAPS_GARETIEN_FELD_VORSCHAU_LABEL,
	"🔴 Importer und Zeichner muessen dasselbe Feld nennen");

const flaeche = (key, name) => ({
	key: key, name: name, typ: "Wald", ziel: "region", subtyp: "wald", kind: "vegetation",
	wiki: "ggp", abschnitte: [],
	geometrie: [[10, 20], [30, 20], [30, 40], [10, 40]],
	items: [{ id: 1, change_type: "new", anlass: null }],
});
const ort = (key, name) => Object.assign({}, flaeche(key, name), {
	typ: "Dorf", ziel: "location", subtyp: "dorf", kind: "", geometrie: [[100, 200]],
});
const weg = (key, name) => Object.assign({}, flaeche(key, name), {
	typ: "Pfad", ziel: "path", subtyp: "Pfad", kind: "",
	geometrie: [[1, 1], [2, 2], [3, 3]],
});

function marke(menge, key) {
	return (menge.filter((o) => o.key === key)[0] || {})[FELD];
}

// ---- 1. Der Stempel entsteht wirklich, mit den Werten des Kastens -------------------------------
const wald = flaeche("k1", "Ingvalwald");
const dorf = ort("k2", "Kleindorf");
const pfad = weg("k3", "Saljethweg");
fenster.avesmapsGaretienStageHinzufuegen([wald, dorf, pfad]);
let menge = fenster.avesmapsGaretienAufDerKarte([wald, dorf, pfad]);

const mWald = marke(menge, "k1");
wahr(mWald !== undefined, "die Flaeche auf der Stage bekommt eine Beschreibung -- der Stempel LAEUFT");
gleich(mWald.art, "frei", "und zwar als freier Kartenname");
gleich(mWald.text, "Ingvalwald", "mit dem Namen des Objekts");
gleich(mWald.subtyp, "wald", "mit seiner Art");
nahe(mWald.punkt[0], 20, "und am Mittelpunkt seiner Geometrie (x)");
nahe(mWald.punkt[1], 30, "und am Mittelpunkt seiner Geometrie (y)");

const mDorf = marke(menge, "k2");
wahr(mDorf !== undefined && mDorf.art === "ort", "der Ort bekommt seinen ORTSnamen");
gleich(mDorf.subtyp, "dorf", "mit seiner Ortsklasse");

// 🔴 Der WEG bekommt nichts -- sein Name wird auf Canvas gemalt, eigenes Paket. Die Gegenprobe ist
// tragend: ohne sie belegte die Zeile darueber nur, dass irgendetwas gestempelt wird.
gleich(marke(menge, "k3"), undefined, "ein Weg bekommt hier keine Beschriftung");

// 💣 GESTEMPELT WIRD EINE KOPIE. Stage und `zustand.objekte` halten dieselbe Referenz; ein Stempel am
// Original schriebe sich bis in die Listenzeile durch -- der Fehler, an dem der Nur-ihre-Stempel
// dieses Fensters beinahe gescheitert ist.
wahr(wald[FELD] === undefined && dorf[FELD] === undefined,
	"💣 die Originale bleiben unberuehrt -- gestempelt wird eine Kopie");

// ---- 2. Die Werte des Kastens reisen wirklich mit ----------------------------------------------
//
// ⭐ Gemessen an GEAENDERTEN Werten, nicht an den Vorgaben: gegen die Vorbelegung geprueft waere
// nicht zu unterscheiden, ob der Stempel den Kasten liest oder nur seine eigene Tafel.
const eingaben = fenster.garetienEingabenZustandZu(wald);
eingaben.size = 41;
eingaben.priority = 5;
eingaben.minZoom = 2;
eingaben.maxZoom = 6;
menge = fenster.avesmapsGaretienAufDerKarte([wald, dorf, pfad]);
gleich(marke(menge, "k1").size, 41, "die Groesse aus dem Kasten reist mit");
gleich(marke(menge, "k1").priority, 5, "die Prioritaet ebenso");
gleich(marke(menge, "k1").minZoom, 2, "das Bandende unten");
gleich(marke(menge, "k1").maxZoom, 6, "und oben");

// ---- 3. „Auf Karte anzeigen" aus -> kein Stempel ----------------------------------------------
//
// 🔴 Der Fall, den der Owner ausdruecklich genannt hat: „das label verschwindet natuerlich, wenn ein
// objekt von der stage genommen oder die option 'Auf der Karte anzeigen' aus ist."
eingaben.showName = false;
menge = fenster.avesmapsGaretienAufDerKarte([wald, dorf, pfad]);
gleich(marke(menge, "k1"), undefined, "🔴 Haken aus -> keine Beschriftung");
// ⚠️ Und die Flaeche selbst liegt weiterhin auf der Karte -- der Haken gehoert dem LABEL, nicht ihr.
wahr(menge.some((o) => o.key === "k1"),
	"⚠️ das Objekt bleibt in der gezeichneten Menge -- „Auf Karte anzeigen\" nimmt den NAMEN weg, "
	+ "nicht die Flaeche");
// Der ORT ist davon unberuehrt: ihn gibt es den Haken nicht.
gleich(fenster.garetienEingabenZustandZu(dorf).showName, true,
	"der Grundwert des Hakens ist an (der Ort liest ihn ohnehin nicht)");
fenster.garetienEingabenZustandZu(dorf).showName = false;
menge = fenster.avesmapsGaretienAufDerKarte([wald, dorf, pfad]);
wahr(marke(menge, "k2") !== undefined,
	"🔴 ein ORT behaelt seinen Namen auch bei `showName: false` -- den Haken gibt es fuer ihn nicht");
eingaben.showName = true;
fenster.garetienEingabenZustandZu(dorf).showName = true;

// ---- 4. Von der Stage genommen -> kein Stempel, weil das Objekt gar nicht mehr gezeichnet wird --
fenster.avesmapsGaretienStageEntfernen(["k1"]);
menge = fenster.avesmapsGaretienAufDerKarte([wald, dorf, pfad]);
wahr(!menge.some((o) => o.key === "k1"),
	"🔴 von der Stage genommen heisst: nicht mehr in der gezeichneten Menge -- und damit auch keine "
	+ "Beschriftung. Der Zeichner ist idempotent, es braucht kein Aufraeumen");
fenster.avesmapsGaretienStageHinzufuegen([wald]);

// ---- 5. Die WAHL schlaegt den Vorschlag -- und zwar durch den Stempel hindurch ------------------
//
// Ein Huegelland, das der Editor auf „Berggipfel" umstellt: die Beschreibung muss die WAHL tragen.
const wahl = fenster.garetienZielWahlZu(wald);
wahl.ziel = "label";
wahl.subtyp = "berggipfel";
menge = fenster.avesmapsGaretienAufDerKarte([wald, dorf, pfad]);
gleich(marke(menge, "k1").subtyp, "berggipfel",
	"🔴 die WAHL entscheidet die Art, nicht `objekt.subtyp`");
gleich(wald.subtyp, "wald", "und der Vorschlag des Servers bleibt unberuehrt");
// Und eine Wahl, die gar keine Beschriftung erzeugt, nimmt sie weg.
wahl.ziel = "path";
wahl.subtyp = "Pfad";
menge = fenster.avesmapsGaretienAufDerKarte([wald, dorf, pfad]);
gleich(marke(menge, "k1"), undefined, "auf „Weg\" umgestellt -> keine Beschriftung mehr");
wahl.ziel = "region";
wahl.subtyp = "wald";

// ---- 6. DIE REIHENFOLGE DER STEMPEL -- die stille Falle ----------------------------------------
//
// 💣 Die weisse Fassung der Beschriftung haengt an `gewaehlt`. Liefe der Vorschau-Stempel VOR
// `garetienGewaehltStempeln`, laese er das Feld, bevor es gesetzt ist -- die geoeffnete Zeile bekaeme
// ihren Namen GOLDEN statt weiss, und zwar still: alles andere waere richtig. Nur ein Lauf mit
// geoeffneter Zeile findet das; ein Quelltext-Test ueber die Klammerung findet es auch, aber erst,
// wenn jemand die Klammer anfasst.
fenster.garetienDetailWaehlen("k1", [wald, dorf, pfad]);
menge = fenster.avesmapsGaretienAufDerKarte([wald, dorf, pfad]);
gleich(marke(menge, "k1").gewaehlt, true,
	"💣 die geoeffnete Zeile traegt `gewaehlt` IN der Beschreibung -- daran haengt das Weiss");
gleich(marke(menge, "k2").gewaehlt, false, "und die uebrigen nicht");
fenster.garetienDetailWaehlen(null, []);

// ---- 7. Die Formweiche steht VOR dem Eingabenzustand -------------------------------------------
//
// ⚠️ `garetienEingabenZustandZu` LEGT BEIM LESEN AN. Der Stempler fragt ihn deshalb erst nach der
// Formweiche -- sonst bekaeme jedes angezeigte Objekt einen Eingabenzustand, den niemand angefasst
// hat. Dieselbe Reihenfolge steht am Nachbarn `garetienEndkreuzungStempeln`, und dort ist sie
// ausgeschrieben.
// 🪤 GEMESSEN WIRD HIER AM QUELLTEXT, und das ist eine Einschraenkung, keine Bequemlichkeit: ein
// Spion auf `fenster.garetienEingabenZustandZu` saehe den Aufruf NICHT -- das Modul ruft seine eigene
// lokale Bindung, nicht den Export. Der Zustand selbst hat keine Sonde, und eine nur fuer diesen
// Test in den Produktionscode zu legen waere teurer als diese Zeile.
const stempler = (fs.readFileSync(path.join(WURZEL, "js/review/review-garetien-importer.js"), "utf8")
	.match(/function garetienVorschauLabelStempeln[\s\S]*?\n\t\}/) || [""])[0];
wahr(stempler !== "", "garetienVorschauLabelStempeln nicht gefunden -- die Probe misst nichts");
const stelleWeiche = stempler.indexOf("artenTafel[");
const stelleZustand = stempler.indexOf("garetienEingabenZustandZu");
wahr(stelleWeiche !== -1 && stelleZustand !== -1,
	"Formweiche und Zustandszugriff muessen beide im Stempler stehen");
wahr(stelleWeiche < stelleZustand,
	"⚠️ die Formweiche muss VOR dem Eingabenzustand stehen -- sonst legt das blosse Zeichnen fuer "
	+ "jedes Objekt Handeingaben an");

// ---- 8. Und der Stempler ist von aussen fahrbar -- die Naht, nicht nur ihr Ergebnis ------------
//
// ⭐ Er wird EINZELN gerufen, mit einem Objekt, das der Stage nie beigelegen hat: so steht die
// Zusicherung auf der Funktion selbst und nicht auf dem Weg dorthin.
const einzeln = fenster.garetienVorschauLabelStempeln([flaeche("k8", "Einzelprobe")]);
wahr(einzeln[0][FELD] !== undefined && einzeln[0][FELD].text === "Einzelprobe",
	"der Stempler laesst sich einzeln fahren und stempelt");
gleich(fenster.garetienVorschauLabelStempeln([]).length, 0, "eine leere Menge bleibt leer");
gleich(fenster.garetienVorschauLabelStempeln(null).length, 0, "und `null` wirft nicht");

// Die Liste der nachziehenden Felder ist EINE Liste und von aussen lesbar -- damit ein spaeterer
// Leser sie nicht ein zweites Mal aufschreibt.
["showName", "size", "priority", "minZoom", "maxZoom", "zielForm", "zielArt"].forEach((feld) => {
	wahr(fenster.AVESMAPS_GARETIEN_VORSCHAU_FELDER.indexOf(feld) !== -1,
		"„" + feld + "\" fehlt in AVESMAPS_GARETIEN_VORSCHAU_FELDER");
});
wahr(fenster.AVESMAPS_GARETIEN_VORSCHAU_FELDER.indexOf("curveLabel") === -1,
	"⚠️ `curveLabel` gehoert NICHT hinein: die Kurvenbeschriftung entsteht auf Canvas ueber "
	+ "`labelMarkers` -- den Weg, den die Vorschau ausdruecklich meidet");

console.log(`garetien-label-vorschau-stempel: ${checks} Pruefungen bestanden.`);

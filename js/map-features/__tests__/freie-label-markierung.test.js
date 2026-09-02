// Die Regel hinter „Freie Labels markieren".
//
// 💣 DIE TRAGENDEN ZUSICHERUNGEN SIND DIE ZWEI RUECKFAELLE, nicht der Normalfall. Eine
// Beschriftung OHNE Art ist eine Region (so liest `prepareLabelData` sie ein) -- gibt die Regel
// hier "" zurueck, faellt sie aus jeder Auswahl und liesse sich nie markieren. Und eine Art, die
// `avesmapsLabelArtName` nicht kennt, bekommt trotzdem ihre Zeile: eine fehlende Zeile in einer
// Auswahlliste meldet nichts, sie ist einfach nicht da.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/freie-label-markierung.test.js

const assert = require("assert");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
// Die Artnamen-Tabelle ist ein Nachbar im globalen Raum -- im Browser laedt index.html sie davor,
// unter Node muss der Test sie selbst hinstellen. 💣 VOR dem Modul: `avesmapsFreieLabelArtenListe`
// fragt beim AUFRUF nach (nicht beim Laden), aber ein Test, der die Reihenfolge nicht vorfuehrt,
// haette nie gemerkt, wenn sie es doch einmal beim Laden taete.
global.avesmapsLabelArtName = require(path.join(wurzel, "js", "ui", "label-arten.js")).avesmapsLabelArtName;
const M = require(path.join(wurzel, "js", "map-features", "freie-label-markierung.js"));

let pruefungen = 0;
const ist = (a, b, was) => { assert.strictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };
const gleich = (a, b, was) => { assert.deepStrictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };

// ---- A. Die ART einer Beschriftung -----------------------------------------------------------
ist(M.avesmapsFreieLabelArt({ labelType: "fluss" }), "fluss", "die eigene Art gewinnt");
ist(M.avesmapsFreieLabelArt({ labelType: "  wald  " }), "wald", "Leerraum faellt weg");
// 💣 Der Rueckfall ist "region", nicht "": prepareLabelData liest eine Beschriftung ohne
// feature_subtype genau so ein. Mit "" fiele sie aus jeder Auswahl.
ist(M.avesmapsFreieLabelArt({}), "region", "ohne Art ist eine Beschriftung eine Region");
ist(M.avesmapsFreieLabelArt({ labelType: "" }), "region", "und eine leere Art auch");
ist(M.avesmapsFreieLabelArt({ labelType: "   " }), "region", "auch wenn nur Leerzeichen dastehen");
ist(M.avesmapsFreieLabelArt(null), "region", "und ein fehlendes Label wirft nicht");

// ---- B. Markiert oder nicht ------------------------------------------------------------------
const fluss = { labelType: "fluss" };
const wald = { labelType: "wald" };
const ohne = { labelType: "" };

ist(M.avesmapsFreieLabelMarkiert(fluss, M.AVESMAPS_FREIE_LABEL_KEINE), false, "„Keine“ markiert nichts");
ist(M.avesmapsFreieLabelMarkiert(fluss, ""), false, "und der Leerwert ist „Keine“");
ist(M.avesmapsFreieLabelMarkiert(fluss, null), false, "ein fehlender Wert ebenso");
ist(M.avesmapsFreieLabelMarkiert(fluss, undefined), false, "und undefined auch");

ist(M.avesmapsFreieLabelMarkiert(fluss, M.AVESMAPS_FREIE_LABEL_ALLE), true, "„Alle“ markiert den Fluss");
ist(M.avesmapsFreieLabelMarkiert(ohne, M.AVESMAPS_FREIE_LABEL_ALLE), true, "„Alle“ markiert auch die artlose");
ist(M.avesmapsFreieLabelMarkiert(null, M.AVESMAPS_FREIE_LABEL_ALLE), false, "aber kein Label ist kein Label");

ist(M.avesmapsFreieLabelMarkiert(fluss, "fluss"), true, "die gewaehlte Art trifft");
ist(M.avesmapsFreieLabelMarkiert(wald, "fluss"), false, "eine andere Art nicht");
ist(M.avesmapsFreieLabelMarkiert(ohne, "region"), true, "die artlose faellt unter „Region“");
ist(M.avesmapsFreieLabelMarkiert(fluss, " fluss "), true, "Leerraum am Auswahlwert faellt weg");
// ⚠️ Kein Praefix-, kein Teiltreffer: „fluss“ darf nicht „flussdelta“ mitnehmen -- sonst markierte
// eine Wahl drei Arten und der Zaehler im Feld waere gelogen.
ist(M.avesmapsFreieLabelMarkiert({ labelType: "flussdelta" }, "fluss"), false,
	"„Fluss“ nimmt „Flussdelta“ NICHT mit");
ist(M.avesmapsFreieLabelMarkiert({ labelType: "flussland_flusstal" }, "fluss"), false,
	"und „Flussland/Flusstal“ auch nicht");

// ---- C. Die Zeilen des Auswahlfelds ----------------------------------------------------------
const bestand = [
	{ labelType: "wald" }, { labelType: "wald" }, { labelType: "wald" },
	{ labelType: "fluss" },
	{ labelType: "see" }, { labelType: "see" },
	{},
];
gleich(M.avesmapsFreieLabelArtenListe(bestand), [
	{ art: "fluss", name: "Fluss", anzahl: 1 },
	{ art: "region", name: "Region", anzahl: 1 },
	{ art: "see", name: "See", anzahl: 2 },
	{ art: "wald", name: "Wald", anzahl: 3 },
], "je Art eine Zeile mit ihrer Anzahl, alphabetisch nach Anzeigename");

gleich(M.avesmapsFreieLabelArtenListe([]), [], "ein leerer Bestand ergibt keine Zeile");
gleich(M.avesmapsFreieLabelArtenListe(null), [], "und ein fehlender wirft nicht");

// 💣 Die unbekannte Art bekommt ihre Zeile unter dem rohen Schluessel.
gleich(M.avesmapsFreieLabelArtenListe([{ labelType: "sternenkrater" }]), [
	{ art: "sternenkrater", name: "sternenkrater", anzahl: 1 },
], "eine Art, die die Namenstabelle nicht kennt, faellt NICHT aus der Liste");

// ⚠️ Deutsche Sortierung: Ü gehoert hinter U, nicht ans Ende des Alphabets.
gleich(M.avesmapsFreieLabelArtenListe([
	{ labelType: "wueste" }, { labelType: "wald" }, { labelType: "urwald" },
]).map((z) => z.name), ["Urwald", "Wald", "Wüste"], "nach deutscher Ordnung sortiert");

// Gegenprobe, damit der Test nicht still leerlaeuft: die zwei Sonderwerte muessen sich von jedem
// echten Artschluessel unterscheiden -- sonst waere „Alle“ zufaellig eine Art.
const ARTEN = Object.keys(require(path.join(wurzel, "js", "ui", "label-arten.js")).AVESMAPS_LABEL_ART_NAMEN);
ist(ARTEN.includes(M.AVESMAPS_FREIE_LABEL_ALLE), false, "„*“ ist kein Artschluessel");
ist(ARTEN.includes(M.AVESMAPS_FREIE_LABEL_KEINE), false, "und „“ auch nicht");
ist(ARTEN.length > 30, true, "und die Artentabelle ist wirklich geladen");

console.log(`freie-label-markierung.test: OK (${pruefungen} Zusicherungen)`);

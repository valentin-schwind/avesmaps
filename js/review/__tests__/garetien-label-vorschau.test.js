/*
 * Die REINE Regel der Beschriftungs-Vorschau des Garetien-Importers.
 * =================================================================================================
 *
 * Owner 09.09.2026: „labels von flaechen siedlungen etc, die im importer auf der stage eingestellt
 * werden koennen, sollen so erscheinen, wie sie im endprodukt (nach Stage importieren) sichtbar sein
 * wird. das label verschwindet natuerlich, wenn ein objekt von der stage genommen oder die option
 * 'Auf der Karte anzeigen' aus ist."
 *
 * Diese Datei prueft, WAS eine Beschriftung bekommt und WO sie liegt. Das Zeichnen (mit den Bauern
 * der echten Karte) prueft garetien-label-vorschau-zeichnen.test.js daneben.
 */

const assert = require("assert");
const path = require("path");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}
function nahe(ist, soll, warum) {
	assert.ok(Math.abs(Number(ist) - Number(soll)) < 1e-9,
		(warum || "") + " (ist " + ist + ", soll " + soll + ")");
	checks++;
}

const mod = require(path.resolve(__dirname, "..", "review-garetien-label-vorschau.js"));
const { garetienVorschauLabelAus, garetienVorschauMittelpunkt, AVESMAPS_GARETIEN_VORSCHAU_ARTEN } = mod;

wahr(typeof garetienVorschauLabelAus === "function", "garetienVorschauLabelAus fehlt im Export");
wahr(typeof garetienVorschauMittelpunkt === "function", "garetienVorschauMittelpunkt fehlt im Export");

// ---- 1. WELCHE Zielform ueberhaupt eine Beschriftung erzeugt ------------------------------------
//
// 🔴 DREI, und die vierte fehlt ABSICHTLICH. Ein Wegname wird auf Canvas gemalt, und jener Zeichner
// laeuft strikt ueber `pathData` -- den Speicher der ECHTEN Karte. Eine Vorschau braeuchte dort eine
// Attrappe, und ein Fehler darin trifft nicht die Vorschau, sondern die Karte jedes Besuchers.
// ⚠️ Gemessen wird die TAFEL, nicht ein `if`-Baum: bei der naechsten Zielform ist eine Kette still
// falsch, und niemand merkt es.
gleich(AVESMAPS_GARETIEN_VORSCHAU_ARTEN.region, "frei", "eine Flaeche bekommt einen freien Namen");
gleich(AVESMAPS_GARETIEN_VORSCHAU_ARTEN.label, "frei", "ein freies Label auch");
gleich(AVESMAPS_GARETIEN_VORSCHAU_ARTEN.location, "ort", "ein Ort bekommt seinen ORTSnamen");
wahr(AVESMAPS_GARETIEN_VORSCHAU_ARTEN.path === undefined,
	"der WEGname gehoert nicht hierher -- er wird auf Canvas gemalt, eigenes Paket");
wahr(AVESMAPS_GARETIEN_VORSCHAU_ARTEN.settlement_place === undefined
	&& AVESMAPS_GARETIEN_VORSCHAU_ARTEN.quelle === undefined,
	"eine Staette liegt innerorts und „Nur Quelle + Artikel\" faellt gar nicht auf die Karte");

// ---- 2. Der MITTELPUNKT -- die Regel des Servers, nicht die schoenere ---------------------------
//
// 💣 DIE FIXTURE IST SICHELFOERMIG, UND ZWAR MIT ABSICHT. An einem Kreis oder Rechteck liegen der
// erste Eckpunkt, der Durchschnitt und der „Pol der Unzugaenglichkeit" so dicht beieinander, dass
// die Zusicherung nichts belegt. Hier liegen sie MESSBAR auseinander: der Durchschnitt faellt in die
// Aushoehlung der Sichel -- also an eine Stelle, an die polylabel NIE setzen wuerde (jenes sucht den
// Punkt mit dem groessten Abstand zur Kante und bleibt in der Masse).
// 🔴 Genau das ist die Regel des Servers (avesmapsGaretienRingMittelpunkt, garetien-plan.php), und
// genau deshalb muss die Vorschau sie nehmen: sonst zeigt sie eine andere Stelle als das Endprodukt.
const sichel = [
	[0, 0], [10, 0], [10, 2], [2, 2], [2, 8], [10, 8], [10, 10], [0, 10],
];
const mitteSichel = garetienVorschauMittelpunkt(sichel);
nahe(mitteSichel[0], 5.5, "x ist der Durchschnitt der acht Ecken");
nahe(mitteSichel[1], 5.0, "y ebenso");
// Die Gegenprobe, die den Beleg tragfaehig macht: er ist NICHT der erste Eckpunkt (so stand es bis
// zum 01.09.2026 im Server, und praktisch alle importierten Berggipfel sassen am RAND ihrer Flaeche).
wahr(mitteSichel[0] !== sichel[0][0] || mitteSichel[1] !== sichel[0][1],
	"der Mittelpunkt darf nicht die erste Ecke sein -- genau das war der alte Fehler");
// Und er liegt in der AUSHOEHLUNG (x zwischen 2 und 10, y zwischen 2 und 8), also dort, wo kein
// Pol-der-Unzugaenglichkeit-Verfahren hinsetzen wuerde. Damit unterscheidet die Fixture die zwei
// Regeln wirklich, statt sie nur beide zu erfuellen.
wahr(mitteSichel[0] > 2 && mitteSichel[0] < 10 && mitteSichel[1] > 2 && mitteSichel[1] < 8,
	"die Fixture muss die zwei Regeln UNTERSCHEIDEN -- sonst belegt die Zeile darueber nichts");

// ⚠️ Bei EINEM Punkt ist er dieser Punkt -- ein Ort mit einer Koordinate wandert um keinen Pixel.
const einer = garetienVorschauMittelpunkt([[123.5, -7.25]]);
nahe(einer[0], 123.5, "ein einzelner Punkt bleibt, wo er ist (x)");
nahe(einer[1], -7.25, "ein einzelner Punkt bleibt, wo er ist (y)");

// 💣 `Number(null)` IST 0, NICHT NaN -- ohne die ausdrueckliche Pruefung zoege eine kaputte
// Koordinate den Mittelpunkt lautlos zur Kartenecke. Dieselbe Falle wie beim Fadenkreuz der
// Verlaufszeile, und dort war sie ein echter Befund.
gleich(garetienVorschauMittelpunkt([]), null, "eine leere Geometrie hat keinen Mittelpunkt");
gleich(garetienVorschauMittelpunkt(null), null, "und `null` auch nicht");
gleich(garetienVorschauMittelpunkt([[1, 1], [null, 2]]), null,
	"eine Koordinate `null` macht den ganzen Mittelpunkt ungueltig, nicht die Ecke 0/0");
gleich(garetienVorschauMittelpunkt([[1, 1], ["x", 2]]), null, "und eine unbrauchbare Zahl ebenso");

// ---- 3. Die Beschreibung: was gezeichnet wird, und was nicht ------------------------------------
const flaeche = { key: "o1", name: "Ingvalwald", geometrie: [[10, 20], [30, 20], [30, 40], [10, 40]] };
const wahlFlaeche = { ziel: "region", subtyp: "wald", kind: "vegetation" };
const eingabenVoll = { showName: true, size: 22, priority: 2, minZoom: 1, maxZoom: 6 };

const b = garetienVorschauLabelAus(flaeche, wahlFlaeche, eingabenVoll);
wahr(b !== null, "eine Flaeche mit Namen und gesetztem Haken bekommt eine Beschriftung");
gleich(b.art, "frei", "sie ist ein freier Kartenname");
gleich(b.text, "Ingvalwald", "der Text ist der Name des Objekts");
gleich(b.subtyp, "wald", "die Art kommt aus der WAHL");
gleich(b.size, 22, "die Groesse aus dem Kasten");
gleich(b.priority, 2, "die Prioritaet aus dem Kasten");
gleich(b.minZoom, 1, "das Bandende unten");
gleich(b.maxZoom, 6, "und oben");
nahe(b.punkt[0], 20, "die Lage ist der Mittelpunkt (x)");
nahe(b.punkt[1], 30, "die Lage ist der Mittelpunkt (y)");
gleich(b.gewaehlt, false, "ohne Marke ist die Zeile nicht offen");

// 🔴 DER HAKEN „Auf Karte anzeigen" -- der Fall, den der Owner ausdruecklich genannt hat.
gleich(garetienVorschauLabelAus(flaeche, wahlFlaeche, { showName: false }), null,
	"Haken aus -> keine Beschriftung (und die Flaeche bleibt, das prueft der Zeichner)");
// 🪤 STRIKT gegen `false`, nicht auf Wahrheitswert: `undefined` heisst „Grundwert", und der ist an.
wahr(garetienVorschauLabelAus(flaeche, wahlFlaeche, {}) !== null,
	"ein unangetasteter Eingabenzustand heisst „an\" -- das ist der Grundwert des Kastens");
wahr(garetienVorschauLabelAus(flaeche, wahlFlaeche, null) !== null,
	"und ohne Eingabenzustand (der Aufrufer darf ihn nicht anlegen) ebenso");

// 🔴 DER ORT HAT DIESEN HAKEN NICHT -- es gibt ihn im ganzen Haus nur fuer Wege und Kraftlinien.
// Sein Name folgt allein der Stage und seinem Zoomband. Ohne diese Zusicherung waere die Regel
// „Haken aus -> nichts" versehentlich auch fuer Orte gebaut, und ein importierter Ort haette nie
// einen Namen gezeigt (der Kasten setzt `showName` fuer ihn nie).
const ort = { key: "o2", name: "Warunk", geometrie: [[100, 200]] };
const bOrt = garetienVorschauLabelAus(ort, { ziel: "location", subtyp: "stadt" }, { showName: false });
wahr(bOrt !== null,
	"ein ORT bekommt seinen Namen auch bei `showName: false` -- den Haken gibt es fuer ihn nicht");
gleich(bOrt.art, "ort", "und zwar als Ortsname, nicht als freier Kartenname");
gleich(bOrt.subtyp, "stadt", "die Ortsklasse kommt aus der Wahl -- sie ist der `locationType`");

// Die drei uebrigen Absagegruende.
gleich(garetienVorschauLabelAus(flaeche, { ziel: "path", subtyp: "Strasse" }, eingabenVoll), null,
	"ein Weg bekommt hier nichts -- sein Name wird auf Canvas gemalt");
gleich(garetienVorschauLabelAus({ key: "o3", name: "  ", geometrie: [[1, 1]] }, wahlFlaeche, eingabenVoll),
	null, "ohne Namen gibt es nichts zu zeigen");
gleich(garetienVorschauLabelAus({ key: "o4", name: "Ohne Form", geometrie: [] }, wahlFlaeche, eingabenVoll),
	null, "ohne Geometrie gibt es keine Stelle");
gleich(garetienVorschauLabelAus(null, wahlFlaeche, eingabenVoll), null, "und ohne Objekt gar nichts");
gleich(garetienVorschauLabelAus(flaeche, null, eingabenVoll), null,
	"ohne Wahl auch nicht -- die Form entscheidet, und der Server-Vorschlag ist hier nicht die Wahl");

// 🔴 DIE WAHL SCHLAEGT DEN VORSCHLAG. Ein Huegelland, das der Editor auf „Berggipfel" umstellt,
// bekommt die Schrift eines Berggipfels -- nicht die seiner vorgeschlagenen Art. Gemessen an einem
// Objekt, dessen `subtyp` etwas ANDERES sagt als die Wahl; sonst belegte die Zeile nichts.
const huegel = {
	key: "o5", name: "Rakulahoehen", subtyp: "huegel", ziel: "region",
	geometrie: [[0, 0], [4, 0], [4, 4], [0, 4]],
};
const bGipfel = garetienVorschauLabelAus(huegel, { ziel: "label", subtyp: "berggipfel" }, eingabenVoll);
gleich(bGipfel.subtyp, "berggipfel", "die WAHL entscheidet die Art, nicht `objekt.subtyp`");
wahr(huegel.subtyp === "huegel", "und der Vorschlag des Servers bleibt unberuehrt");

// 🔴 DAS WEISS WIRD GESCHALTET WIE DAS WEISS EINER FORM (Owner 09.09.2026) -- und deshalb wird die
// Antwort HEREINGEREICHT, nicht aus dem Objekt gelesen.
// 💣 Der erste Bau las `objekt.gewaehlt` hier selbst, waehrend die Form ihr Weiss ueber die
// Konstante `AVESMAPS_GARETIEN_FELD_GEWAEHLT` nimmt: zwei Wege zu einem Wert, heute gleich, beim
// naechsten Umbenennen still auseinander. Diese Zeilen halten fest, dass die Regel den Feldnamen
// NICHT mehr kennt.
const bOffen = garetienVorschauLabelAus(flaeche, wahlFlaeche, eingabenVoll, true);
gleich(bOffen.gewaehlt, true, "die offene Zeile traegt die Marke bis in die Beschreibung");
gleich(garetienVorschauLabelAus(flaeche, wahlFlaeche, eingabenVoll, false).gewaehlt, false,
	"und eine geschlossene nicht");
// 💣 DIE GEGENPROBE, DIE DEN UMBAU FESTNAGELT: ein Objekt, das das Feld SELBST traegt, aendert
// nichts -- die Regel liest es nicht mehr. Ohne diese Zeile waere „hereingereicht" nur eine
// Behauptung, und ein Rueckbau auf `objekt.gewaehlt` bliebe unbemerkt.
gleich(garetienVorschauLabelAus(Object.assign({}, flaeche, { gewaehlt: true }), wahlFlaeche,
	eingabenVoll, false).gewaehlt, false,
	"💣 ein Feld AM OBJEKT darf die Regel nicht mehr beeinflussen -- der Aufrufer entscheidet");
gleich(garetienVorschauLabelAus(flaeche, wahlFlaeche, eingabenVoll).gewaehlt, false,
	"⚠️ und ohne Angabe gilt „nicht offen\" -- strikt gegen `true`, nicht wahrheitswertig");

// 💣 UND SIE VERAENDERT DAS OBJEKT NICHT. Die Beschreibung ist ein neues Objekt; schriebe die Regel
// in ihr Eingabeobjekt, liefe das ueber `zustand.objekte` bis in die Listenzeile durch -- der Fehler,
// an dem der Nur-ihre-Stempel dieses Fensters beinahe gescheitert ist.
wahr(flaeche.vorschauLabel === undefined && flaeche.art === undefined,
	"die reine Regel schreibt nichts an ihr Eingabeobjekt");

console.log(`garetien-label-vorschau: ${checks} Pruefungen bestanden.`);

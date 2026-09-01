"use strict";

/*
 * DIE ZIELWAHL DES IMPORTERS -- zwei Auswahlfelder statt einer festen Zuordnung
 * ============================================================================
 * Owner 01.09.2026: „die editoren wollen dass man bestimmen kann, welchen typ das ziel haben soll
 * … auch von fläche auf berg … er soll den vorschlag nehmen, den er gerade hat, aber mann will
 * auch ändern können", dazu „alle orte und weg-typen mit rein" und „bei Flächen, die sehr klein
 * sind … sollen automatisch schon als Berge vorausgewählt werden".
 *
 * Die Serverhälfte (Umformen der Geometrie, Riegel gegen unmögliche Ziele) steht in
 * api/_internal/import/__tests__/garetien-plan-test.php. Hier geht es um das Fenster.
 */

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");

global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

const vm = require("node:vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");

// ⚠️ VOR dem Laden von config.js: die Datei fasst beim Einlesen `document.documentElement` an
// (Infopanel-Modus). Ein Minimal-Attrappe genügt -- dieses Testfeld hat kein DOM, und die drei
// Vokabulare darunter brauchen keines.
global.document = global.document || {
	documentElement: { classList: { add() {} } },
	getElementById() { return null; },
	createElement() { return { style: {}, classList: { add() {} }, setAttribute() {} }; },
};

// ⚠️ Die vier Vokabulare sind BROWSER-GLOBALE und müssen vor dem Fenster geladen werden -- dieselbe
// Reihenfolge wie in garetien-eingefuegt-wird.test.js (config.js braucht line-catmull vor sich,
// path-domain braucht config.js vor sich).
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/map-features-line-catmull.js"), "utf8"),
	{ filename: "map-features-line-catmull.js" }
);
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/config.js"), "utf8"),
	{ filename: "config.js" }
);
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/map-features-path-domain.js"), "utf8"),
	{ filename: "map-features-path-domain.js" }
);
global.AVESMAPS_LABEL_ART_NAMEN =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).AVESMAPS_LABEL_ART_NAMEN;
global.avesmapsLabelArtName =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const {
	garetienZielVorbelegung, garetienZielWahlZu, garetienZielWahlVergessen,
	garetienMoeglicheFormen, garetienArtenFuerForm, garetienFlaecheMeilen2,
	garetienZielWahlMarkup, garetienEingefuegtWirdMarkup, garetienEingabenFuerServer,
} = mod;

let checks = 0;
function wahr(bedingung, warum) { assert.ok(bedingung, warum); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum); checks++; }

const quadrat = (kante) => [[0, 0], [kante, 0], [kante, kante], [0, kante]];

// =================================================================================================
// A. DIE FLAECHE IN QUADRATMEILEN -- 1 Karteneinheit = 3 Meilen, also 9 Meilen² je Einheit².
// =================================================================================================
gleich(garetienFlaecheMeilen2(quadrat(1)), 9, "ein Quadrat von einer Einheit sind 9 Meilen²");
gleich(garetienFlaecheMeilen2(quadrat(2)), 36, "und eines von zwei Einheiten das Vierfache");
// 💣 Weniger als drei Punkte sind KEINE Fläche -- und 0 heißt hier „unbekannt", nicht „winzig".
gleich(garetienFlaecheMeilen2([[0, 0], [1, 1]]), 0, "zwei Punkte spannen keine Fläche auf");
gleich(garetienFlaecheMeilen2([]), 0, "und eine leere Liste erst recht nicht");

// =================================================================================================
// B. DIE VORBELEGUNG -- der Vorschlag, außer bei einer sehr kleinen Bergfläche
// =================================================================================================
const bergflaeche = (kante) => ({
	key: "k-" + kante, typ: "Gebirge", ziel: "region", subtyp: "gebirge", kind: "topographie",
	geometrie: quadrat(kante),
});

// 🔴 Unter 5 Meilen² wird aus der Bergfläche ein Gipfel.
gleich(garetienZielVorbelegung(bergflaeche(0.5)).subtyp, "berggipfel",
	"eine Bergfläche von 2,25 Meilen² startet als Gipfel");
gleich(garetienZielVorbelegung(bergflaeche(0.5)).ziel, "label", "und zwar als freies Label");
// ⚠️ Und darüber bleibt sie, was sie ist. Ohne diese Zeile wäre nur belegt, dass die Regel
// überhaupt etwas tut, nicht dass sie eine SCHWELLE hat.
gleich(garetienZielVorbelegung(bergflaeche(0.8)).subtyp, "gebirge",
	"eine von 5,76 Meilen² bleibt Fläche");

// 🔴 DIE REGEL GILT NUR DER BERGFAMILIE, und das ist der Kern der Messung vom 01.09.2026: über
// alle 18 Ebenen trennt „klein" nicht Berg von Fläche, sondern SEEN von allem anderen -- 59 von 96
// Seen liegen unter 5 Meilen², der Median der `Berg`-Zeilen dagegen bei 136. Eine globale Schwelle
// machte also die Mehrheit der Seen zu Beschriftungen.
const kleinerSee = { key: "see", typ: "See", ziel: "region", subtyp: "see", kind: "topographie",
	geometrie: quadrat(0.5) };
gleich(garetienZielVorbelegung(kleinerSee).subtyp, "see",
	"🔴 ein winziger See bleibt eine Fläche -- die Regel gilt nur Gebirge und Hügel");
const kleinerWald = { key: "wald", typ: "Wald", ziel: "region", subtyp: "wald", kind: "vegetation",
	geometrie: quadrat(0.5) };
gleich(garetienZielVorbelegung(kleinerWald).subtyp, "wald", "und ein winziger Wald ebenso");

// 💣 EINE FEHLENDE GEOMETRIE IST NICHT „KLEIN". `garetienFlaecheMeilen2` liefert dort 0, und 0
// heißt UNBEKANNT. Ohne diesen Riegel schlug die Regel bei jedem Objekt ohne mitgereiste Geometrie
// zu und machte aus einem Hügelland stillschweigend einen Berggipfel -- gefangen hat das beim Bau
// der bestehende Test der Kopfzeile, nicht eine neue Zeile.
gleich(garetienZielVorbelegung({ key: "ohne", typ: "Gebirge", ziel: "region", subtyp: "gebirge" }).subtyp,
	"gebirge", "💣 ohne Geometrie bleibt der Vorschlag stehen");

// ⚠️ Und ein Objekt, das gar keine Fläche vorschlägt, wird nicht angefasst.
gleich(garetienZielVorbelegung({ key: "ort", typ: "Dorf", ziel: "location", subtyp: "dorf" }).ziel,
	"location", "ein Ort bleibt ein Ort");

// =================================================================================================
// C. WELCHE FORM DIE GEOMETRIE HERGIBT
// =================================================================================================
const formen = (punkte) => garetienMoeglicheFormen({ geometrie: punkte }).map((f) => f.key).join(",");
gleich(formen([[0, 0]]), "label,location",
	"🔴 ein einzelner Punkt trägt nur Punktziele -- alle Burgen, Dörfer und Tempel des Exports "
	+ "haben genau eine Koordinate");
gleich(formen([[0, 0], [1, 1]]), "label,location,path", "zwei Punkte tragen zusätzlich eine Linie");
gleich(formen(quadrat(1)), "region,label,location,path", "ab drei Punkten geht alles");

// =================================================================================================
// D. DIE ARTENLISTEN -- vier vorhandene Quellen, kein neues Vokabular
// =================================================================================================
const ortArten = garetienArtenFuerForm("location").map((a) => a.key);
gleich(ortArten.join(","), "metropole,grossstadt,stadt,kleinstadt,dorf,gebaeude",
	"die Ortsarten kommen aus LOCATION_TYPE_VISIBILITY_ORDER: " + ortArten.join(","));
wahr(garetienArtenFuerForm("location").every((a) => a.label && a.label !== a.key),
	"und jede trägt ihren aufgelösten Namen, nicht den rohen Schlüssel");

const wegArten = garetienArtenFuerForm("path").map((a) => a.key);
wahr(wegArten.indexOf("Reichsstrasse") !== -1 && wegArten.indexOf("Seeweg") !== -1,
	"die Wegarten kommen aus PATH_SUBTYPE_KEYS: " + wegArten.join(","));
gleich(wegArten.length, 8, "alle acht, nicht eine Auswahl davon");

// 🔴 DIE FREIEN LABEL SIND EINE DIFFERENZ, keine gepflegte Liste: was eine Label-Art ist, aber
// keine Flächenart, ist ein freies Label. Eine handgeschriebene Aufzählung liefe beim nächsten
// neuen Typ auseinander -- genau das ist der Kartensuche passiert, die bis heute 18 Arten nicht
// kennt. ⚠️ Ohne Flächen-Vokabular (kein Listenabruf) ist die Differenz die GANZE Label-Liste;
// das ist der offene Ausfall und keine Sperre.
const freie = garetienArtenFuerForm("label").map((a) => a.key);
wahr(freie.indexOf("berggipfel") !== -1 && freie.indexOf("vulkan") !== -1,
	"Berggipfel und Vulkan stehen darin: " + freie.join(","));
wahr(freie.indexOf("felsformation") !== -1 && freie.indexOf("bergkette") !== -1
	&& freie.indexOf("huegel") !== -1,
	"und die drei neuen vom 01.09.2026 ebenso");

// =================================================================================================
// E. DAS MARKUP -- zwei Felder, vorbelegt, und gesperrt an einem übernommenen Objekt
// =================================================================================================
const flaeche = {
	key: "ggp:Gewaesser:Sumpf:Garetien:Lilienmoor!Lilienmoor", name: "Lilienmoor", typ: "Sumpf",
	ziel: "region", subtyp: "suempfe_moore", kind: "vegetation", wiki: "ggp",
	geometrie: quadrat(4), abschnitte: [], items: [{ id: 1, change_type: "new", anlass: null }],
};
garetienZielWahlVergessen();
const mWahl = garetienZielWahlMarkup(flaeche, false);
wahr(mWahl.includes('data-gi-feld="zielForm"') && mWahl.includes('data-gi-feld="zielArt"'),
	"beide Felder tragen ihren Feldnamen -- daran hängt der Handler: " + mWahl);
wahr(mWahl.includes('value="region" selected'), "die Form ist auf den Vorschlag vorbelegt");
wahr(mWahl.includes('value="suempfe_moore" selected') || mWahl.includes(">Sümpfe"),
	"und die Art ebenso: " + mWahl);
wahr(!mWahl.includes("disabled"), "an einem offenen Objekt ist nichts gesperrt");

// 🔴 Punkt 6a (Owner 30.08.2026): ein bereits angelegtes Objekt hat nichts mehr zu entscheiden --
// auch nicht, was es hätte werden sollen.
wahr((garetienZielWahlMarkup(flaeche, true).match(/disabled/g) || []).length === 2,
	"an einem übernommenen Objekt sind BEIDE Felder gesperrt");

// 💣 EINE FORM, DIE DIE GEOMETRIE NICHT HERGIBT, STEHT NICHT IN DER LISTE -- der Server lehnt sie
// ohnehin ab (avesmapsGaretienMoeglicheZiele), das Feld soll sie gar nicht erst anbieten.
const einPunkt = Object.assign({}, flaeche, { key: "einpunkt", geometrie: [[1, 1]],
	ziel: "location", subtyp: "dorf", kind: "" });
garetienZielWahlVergessen();
const mEin = garetienZielWahlMarkup(einPunkt, false);
wahr(!mEin.includes('value="region"'),
	"💣 aus einem einzigen Punkt wird keine Fläche angeboten: " + mEin);
wahr(mEin.includes('value="label"') && mEin.includes('value="location"'),
	"die zwei Punktziele stehen sehr wohl da");

// =================================================================================================
// F. DER KASTEN UND DER ANFRAGERUMPF FOLGEN DER WAHL
// =================================================================================================
garetienZielWahlVergessen();
wahr(garetienEingefuegtWirdMarkup(flaeche).includes('data-gi-feld="zielForm"'),
	"die zwei Felder stehen wirklich im Kasten „Eingefügt wird\"");

// 🔴 UND DER KASTEN SELBST FOLGT DER WAHL, nicht nur der Anfragerumpf. Eine Fläche zeigt
// „für Klicks gesperrt" und die Kurvenbeschreibung, ein Gipfel nicht -- wer die Form wechselt und
// weiterhin die Flächenfelder sieht, stellt Werte ein, die nirgends ankommen.
// 💣 Eine Mutationsprobe am 01.09.2026 hat genau diese Zeile gebraucht: „Kasten liest wieder den
// Vorschlag" lief ohne sie unbemerkt durch.
garetienZielWahlVergessen();
const kastenFlaeche = garetienEingefuegtWirdMarkup(flaeche);
wahr(kastenFlaeche.includes("für Klicks gesperrt"),
	"die Vorbedingung: als Fläche zeigt der Kasten das Flächenfeld");
const wahlKasten = garetienZielWahlZu(flaeche);
wahlKasten.ziel = "label";
wahlKasten.subtyp = "berggipfel";
wahlKasten.kind = "";
const kastenBerg = garetienEingefuegtWirdMarkup(flaeche);
wahr(!kastenBerg.includes("für Klicks gesperrt"),
	"🔴 nach dem Wechsel auf Berg zeigt der Kasten die Flächenfelder NICHT mehr");
wahr(!kastenBerg.includes("Kurvenbeschreibung"),
	"und die Kurvenbeschreibung ebenso wenig -- sie gehört einer Fläche");
garetienZielWahlVergessen();

// 💣 DIE WAHL REIST IMMER MIT, auch wenn sie dem Vorschlag entspricht: der Server vergleicht sie
// (avesmapsGaretienZielUebersteuern) und formt nur um, wenn sie abweicht. Sie wegzulassen, solange
// nichts geändert wurde, hiesse zwei Wege durch dieselbe Tür.
const rumpfVorher = garetienEingabenFuerServer(flaeche);
gleich(rumpfVorher.ziel, "region", "der Rumpf trägt die Form");
gleich(rumpfVorher.subtyp, "suempfe_moore", "und die Art");
gleich(rumpfVorher.kind, "vegetation", "und die Landschaftsebene");
wahr(Object.prototype.hasOwnProperty.call(rumpfVorher, "is_locked"),
	"und weiterhin die Flächenfelder");

// 🔴 NACH EINEM WECHSEL AUF BERG schickt derselbe Kasten die LABEL-Felder, nicht die der Fläche --
// `is_locked` und `curve_label` gehören einer Fläche und wären an einem Gipfel sinnlos.
const wahl = garetienZielWahlZu(flaeche);
wahl.ziel = "label";
wahl.subtyp = "berggipfel";
wahl.kind = "";
const rumpfNachher = garetienEingabenFuerServer(flaeche);
gleich(rumpfNachher.ziel, "label", "die gewechselte Form reist mit");
gleich(rumpfNachher.subtyp, "berggipfel", "und die gewechselte Art");
wahr(!Object.prototype.hasOwnProperty.call(rumpfNachher, "is_locked"),
	"🔴 und die Flächenfelder fallen weg: " + JSON.stringify(rumpfNachher));

// 💣 OHNE SCHLUESSEL WIRD NICHT ZWISCHENGESPEICHERT. Sonst teilten sich alle schlüssellosen
// Objekte den Eintrag unter "" -- die Wahl des ersten gälte für jedes weitere. Das trifft nicht
// nur Testattrappen: `garetienTypText` wird auch mit blossen {typ, subtyp}-Objekten gerufen.
const ohneA = garetienZielWahlZu({ typ: "Fluss", ziel: "path", subtyp: "Flussweg" });
ohneA.subtyp = "VERSTELLT";
const ohneB = garetienZielWahlZu({ typ: "See", ziel: "region", subtyp: "see" });
gleich(ohneB.subtyp, "see",
	"💣 ein zweites schlüsselloses Objekt erbt die Wahl des ersten NICHT");

// =================================================================================================
// G. DIE SERVERHAELFTE KENNT DIESELBEN GRENZEN
// =================================================================================================
// ⚠️ Quelltext, nicht Ablauf: PHP läuft in diesem Testfeld nicht. Belegt wird, dass die Regel
// „Fläche ab 3, Linie ab 2" auf beiden Seiten steht -- eine Liste im Browser allein wäre keine
// Sperre, sondern eine Höflichkeit.
const planPhp = fs.readFileSync(path.join(WURZEL, "api/_internal/import/garetien-plan.php"), "utf8");
wahr(/function avesmapsGaretienMoeglicheZiele/.test(planPhp),
	"der Server führt dieselbe Frage");
wahr(/\$n >= 3[\s\S]{0,80}'region'/.test(planPhp),
	"und kennt die Drei-Punkte-Grenze der Fläche");

console.log("garetien-zielwahl: " + checks + " Pruefungen bestanden.");

// Die Anzeige-Menge des Garetien Importers -- sie gehoert dem FENSTER, nicht dem Vorschlag.
// Entwurf: docs/superpowers/specs/2026-08-29-garetien-importer-sichtwerkzeug-design.md §3
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-anzeige-menge.test.js
//
// 🔴 Gemessen wird am ERGEBNIS der echten Funktionen, nie am Quelltext. Die teuerste Fehlerklasse
// dieses Vorhabens ist die VAKUUM-Zusicherung (ein `includes(...)`, das auch die Definitionszeile
// trifft) -- deshalb wird hier ausgefuehrt.
"use strict";

const assert = require("assert");
const path = require("path");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum || ""); checks++; }
function wahr(bed, warum) { assert.ok(bed, warum || ""); checks++; }

const modul = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));

// ---- Die Fixture -------------------------------------------------------------------------------
//
// 🔴 `ohneVorschlag` ist der WICHTIGSTE Fall: 7930 der 8213 Objekte sehen so aus (`items: []`).
// Genau sie konnten bis zum 29.08.2026 nie auf die Karte -- die alte Menge las `items[].selected`.
const mitVorschlag  = { key: "ggp:Gewaesser:1", name: "Alke",       typ: "Bach", items: [{ selected: 1 }] };
const ohneVorschlag = { key: "ggp:Berge:7",     name: "Krähenkopf", typ: "Berg", items: [] };

// ---- 1. Ein Objekt OHNE Vorschlag kommt in die Menge -------------------------------------------
modul.avesmapsGaretienAnzeigeLeeren();
gleich(modul.avesmapsGaretienAnzeigeHinzufuegen([ohneVorschlag]), 1,
	"ein Objekt ohne jedes Item MUSS in die Anzeige koennen -- das sind 7930 von 8213");
gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Berge:7"), true, "und es liegt drin");

// ---- 2. Gemerkt wird das OBJEKT, nicht der Schluessel -------------------------------------------
//
// Der Server liefert je Abruf nur die gefilterte Seite. Ein Schluessel ohne Objekt waere nach dem
// naechsten Filterwechsel nicht mehr aufloesbar -- die Karte verloere genau das, was der Editor
// zusammengetragen hat. Die DIFFERENZ dazu: nach dem Hinzufuegen ist der NAME noch da.
gleich(modul.avesmapsGaretienAnzeigeListe()[0].name, "Krähenkopf",
	"die Menge haelt das ganze Objekt -- sonst ueberlebt sie keinen Filterwechsel");

// ---- 3. Entdoppelt, und die Reihenfolge ist die des Einfuegens ----------------------------------
modul.avesmapsGaretienAnzeigeHinzufuegen([ohneVorschlag, mitVorschlag]);
gleich(modul.avesmapsGaretienAnzeigeListe().length, 2,
	"zweimal dasselbe Objekt ergibt EINEN Eintrag -- zweimal gezeichnet waere ein doppelt "
	+ "kraeftiger Strich");
tief(modul.avesmapsGaretienAnzeigeListe().map((o) => o.key), ["ggp:Berge:7", "ggp:Gewaesser:1"],
	"Einfuegereihenfolge, damit die Liste sich unter dem Editor nicht umsortiert");

// ---- 4. Leeren leert wirklich ------------------------------------------------------------------
gleich(modul.avesmapsGaretienAnzeigeLeeren(), 0, "„Anzeige leeren\" leert");
gleich(modul.avesmapsGaretienAnzeigeListe().length, 0, "und danach ist sie leer");
gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Berge:7"), false, "auch fuer den Einzelnachschlag");

// ---- 5. Der Reiter „Anzeigen" steht an zweiter Stelle und traegt seine Zahl ---------------------
//
// ⚠️ Gemessen wird die REIHENFOLGE, nicht nur das Vorkommen: „Anzeigen" ersetzt „Vorgemerkt" an
// dessen Stelle, damit der Editor seinen Reiter nicht suchen muss.
modul.avesmapsGaretienAnzeigeHinzufuegen([ohneVorschlag]);
const tabs = modul.avesmapsGaretienTabsMarkup({ offen: 259, abgelehnt: 3, uebernommen: 0 }, "offen");
const reihenfolge = (tabs.match(/data-stand="([a-z]+)"/g) || []).map((s) => s.slice(12, -1));
tief(reihenfolge, ["offen", "anzeigen", "abgelehnt", "uebernommen"],
	"vier Reiter, und „anzeigen\" steht an der Stelle des alten „vorgemerkt\"");
wahr(tabs.includes("Anzeigen (1)"),
	"die Zahl kommt aus der MENGE, nicht aus der Serverantwort -- der Server kennt sie nicht");

// ---- 6. Die DIFFERENZ: der Server wird nach „anzeigen" nie gefragt ------------------------------
//
// 🪤 Die Vakuum-Falle waere, hier den Quelltext zu lesen. Gemessen wird stattdessen, dass
// `anzeigen` in der Server-Standleiter GAR NICHT vorkommt -- ein `stand: "anzeigen"` waere ein
// Filter auf einen Wert, den `avesmapsGaretienListeObjektStand` nie zurueckgibt, und die Liste
// bliebe fuer immer leer.
wahr(!modul.AVESMAPS_GARETIEN_SERVER_STAENDE.includes("anzeigen"),
	"„anzeigen\" ist KEIN Serverstand -- es wird im Browser gerendert");
tief(modul.AVESMAPS_GARETIEN_SERVER_STAENDE, ["offen", "abgelehnt", "uebernommen"],
	"und `vorgemerkt` ist aus der Leiter heraus -- sonst springt die Zeile beim Anhaken");

// ---- 7. Das Haekchen ist ein MARKER und schreibt NICHTS ----------------------------------------
//
// 🔴 KORRIGIERT (Fix-Runde 1, Punkt 2): hier stand ein Spion, der nie verdrahtet wurde --
// `avesmapsGaretienMarkierungUmschalten` hat gar keinen `senden`-Parameter, also blieb
// `gleich(gesendet, 0, …)` gruen, egal was die Funktion tut (Vakuum-Zusicherung). Die ECHTE Probe
// braucht den Klickverteiler `garetienHakenKlick` mit einem wirklich verdrahteten Spion -- die
// steht bereits in `js/review/__tests__/garetien-handlungen.test.js`, Abschnitt "Das Haekchen"
// (RULING R6), und deckt zusaetzlich den zweiten Aufrufer (Abschnittshaekchen) mit ab. Hier bleibt
// nur, was diese Datei WIRKLICH pruefen kann: `avesmapsGaretienMarkierungUmschalten` toggelt.
modul.avesmapsGaretienAnzeigeLeeren();
gleich(modul.avesmapsGaretienMarkierungUmschalten("ggp:Berge:7"), true, "erster Klick markiert");
gleich(modul.avesmapsGaretienMarkierungUmschalten("ggp:Berge:7"), false, "zweiter Klick nimmt zurueck");

// ---- 8. „Markierte anzeigen" legt sie dazu und laesst sie markiert ------------------------------
modul.avesmapsGaretienMarkierungUmschalten("ggp:Berge:7");
gleich(modul.avesmapsGaretienMarkierteAnzeigen([ohneVorschlag, mitVorschlag]), 1,
	"nur das MARKIERTE kommt in die Anzeige, nicht die ganze Liste");
gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Berge:7"), true, "und es liegt drin");
gleich(modul.avesmapsGaretienMarkierungHat("ggp:Berge:7"), true,
	"es bleibt markiert und bleibt in „Offen\" -- „sie sind ja immer noch offen\"");

// ---- 9. Die Karte zeigt die ANZEIGE, nicht mehr die Haekchen -----------------------------------
//
// 🔴 DIE TRAGENDE ZUSICHERUNG DES GANZEN VORHABENS. Vorher las `avesmapsGaretienAufDerKarte`
// `items[].selected`; ein Objekt ohne Item war damit auf KEINE Weise sichtbar zu machen.
const aufDerKarte = modul.avesmapsGaretienAufDerKarte([mitVorschlag, ohneVorschlag]);
tief(aufDerKarte.map((o) => o.key), ["ggp:Berge:7"],
	"auf der Karte liegt die ANZEIGE-MENGE -- das angehakte `mitVorschlag` liegt NICHT dort, "
	+ "obwohl sein Item `selected: 1` traegt");

// =================================================================================================
// 10. RULING R5 (Luecke im Plan): der Reiter „Anzeigen" baut seine Antwort selbst -- ohne Server
// =================================================================================================
//
// Kein Server-Feld heisst „anzeigen" (Abschnitt 6 oben) -- ein `stand: "anzeigen"` waere ein
// Filter auf einen Wert, den der Server nie liefert, und die Liste bliebe fuer immer leer.
// avesmapsGaretienListeHolen() nimmt bei diesem Reiter deshalb einen ZWEITEN Weg:
// garetienAnzeigenAntwortBauen() baut die "Antwort" aus der Anzeige-Menge nach, OHNE zu filtern --
// Suche und Filtertrichter wirken nur auf die drei Server-Reiter (Entwurf §3.1).
modul.avesmapsGaretienAnzeigeLeeren();
modul.avesmapsGaretienAnzeigeHinzufuegen([ohneVorschlag, mitVorschlag]);
const anzeigenAntwort = modul.garetienAnzeigenAntwortBauen({
	reiter: { offen: 259, abgelehnt: 3, uebernommen: 0 },
	bilanz: { neu: 5 },
});
tief(anzeigenAntwort.objekte.map((o) => o.key), ["ggp:Berge:7", "ggp:Gewaesser:1"],
	"die Antwort traegt GENAU die Anzeige-Menge, ungefiltert");
gleich(anzeigenAntwort.gesamt, 2, "gesamt ist die Groesse der Menge, nicht die eines Servers");
gleich(anzeigenAntwort.reiter.anzeigen, 2,
	"der Reiterwert ist derselbe wie gesamt -- die Bilanzzeile zeigt dann „N Objekte\", nie "
	+ "„N von M\"");
gleich(anzeigenAntwort.reiter.offen, 259,
	"die uebrigen Reiterzahlen bleiben aus der letzten echten Serverantwort erhalten");
gleich(anzeigenAntwort.bilanz.neu, 5, "und die Laufbilanz ebenso -- „Anzeigen\" hat keine eigene");

// avesmapsGaretienBalanceZeileText ruft den GETEILTEN Erzeuger (js/review/review-list-balance.js)
// als globalen Namen -- derselbe Vertrag wie bei den acht WikiSync-Listen. Die ECHTE Fassung wird
// geladen (kein Spion): hier zaehlt das tatsaechliche Ergebnis, nicht nur dass irgendetwas gerufen
// wurde.
global.avesmapsListBalanceText =
	require(path.resolve(__dirname, "..", "review-list-balance.js")).avesmapsListBalanceText;
gleich(
	modul.avesmapsGaretienBalanceZeileText(anzeigenAntwort.gesamt, anzeigenAntwort.reiter.anzeigen),
	"2 Objekte",
	"und die Bilanzzeile nennt schlicht die Zahl -- kein „von M\", weil „Anzeigen\" nie filtert"
);
delete global.avesmapsListBalanceText;

// ---- 10. Der Fussknopf sagt EHRLICH, wie viele einen Vorschlag haben ---------------------------
//
// 🔴 7930 der 8213 Objekte haben keinen. Ein Knopf, der „244 einfuegen" verspricht und 37 einfuegt,
// ist eine Falschaussage ueber die naechste Handlung.
const stand = modul.garetienUebernahmeKnopfZustand([mitVorschlag, ohneVorschlag, ohneVorschlag]);
gleich(stand.beschriftung, "Alle angezeigten einfügen (1 von 3)",
	"1 von 3 -- nur `mitVorschlag` traegt ein Item");
gleich(stand.gesperrt, false, "mit mindestens einem Vorschlag ist der Knopf bedienbar");

const leer = modul.garetienUebernahmeKnopfZustand([ohneVorschlag]);
gleich(leer.gesperrt, true, "ohne einen einzigen Vorschlag ist nichts einzufuegen");
gleich(leer.hinweis !== "", true,
	"und der Grund steht SICHTBAR daneben, nie in einem `title` -- ein gesperrter Knopf bekommt "
	+ "in Chrome keine Zeigerereignisse und zeigt seinen `title` deshalb nie");

gleich(modul.garetienUebernahmeKnopfZustand([]).beschriftung,
	"Alle angezeigten einfügen (0 von 0)", "die leere Anzeige nennt zwei Nullen, keine Ausnahme");

// ---- 10b. Fix-Runde 1: ein Objekt mit NUR einem Geometrie-Item zaehlt NICHT als "mit Vorschlag" -
//
// 🔴 Befund der Review, belegt am bestehenden Testfeld
// (`api/_internal/import/__tests__/garetien-plan-test.php:339-345` baut genau diesen Fall: Urteil
// `deckt_sich`, Name und Quelle stimmen schon, es bleibt nur das Geometrie-Item uebrig).
// `garetienHakenItems` schliesst das Geometrie-Item grundsaetzlich vom Haekchen-Pfad aus (eigener
// Knopf mit Rueckfrage) -- ein Objekt mit AUSSCHLIESSLICH einem solchen Item liefert deshalb ueber
// `garetienAnzeigeAnhakenIds` NIE eine id. Zaehlte `n` trotzdem roh ueber `items.length`, verspraeche
// der Knopf ein Einfuegen, das beim Klick nichts sendet -- dieselbe Falschaussage eine Stelle
// kleiner. Gemessen wird die DIFFERENZ: der Geometrie-Fall zaehlt nicht, ein gewoehnliches Item
// daneben zaehlt doch -- in EINER Anzeige-Menge, damit die Zahl wirklich zwischen beiden unterscheidet.
const nurGeometrie = {
	key: "ggp:Geo:1", name: "Alte Furt", typ: "Weg",
	items: [{ id: 601, anlass: "geometrie", selected: 0 }],
};
const standGeometrie = modul.garetienUebernahmeKnopfZustand([nurGeometrie]);
gleich(standGeometrie.anzahl, 0,
	"ein Objekt mit AUSSCHLIESSLICH einem Geometrie-Item zaehlt NICHT als „mit Vorschlag\" -- fuer "
	+ "es gibt es kein Haekchen, das je etwas anhaken koennte");
gleich(standGeometrie.gesperrt, true, "…und ist deshalb allein genommen gesperrt");

const standGemischt = modul.garetienUebernahmeKnopfZustand([nurGeometrie, mitVorschlag]);
gleich(standGemischt.beschriftung, "Alle angezeigten einfügen (1 von 2)",
	"die Gegenprobe in DERSELBEN Anzeige-Menge: `mitVorschlag` (ein gewoehnliches Item) zaehlt "
	+ "weiterhin, `nurGeometrie` weiterhin nicht -- 1 von 2, nicht 2 von 2");

// Und von der ANDEREN Seite bestaetigt: `garetienAnzeigeAnhakenIds` (die Funktion, die die
// tatsaechlich zu sendenden ids baut) liefert fuer `nurGeometrie` NIE eine id, waehrend ein
// gewoehnliches, noch offenes Item danebem sehr wohl beitraegt -- genau die Uebereinstimmung, die
// Fix-Runde 1 zwischen Anzeige-Zahl und Anhak-Menge verlangt.
const mitOffenemItem = { key: "ggp:Offen:1", items: [{ id: 701, selected: 0 }] };
tief(modul.garetienAnzeigeAnhakenIds([nurGeometrie, mitOffenemItem]), [701],
	"nur das gewoehnliche offene Item traegt eine id bei, das Geometrie-Item NIE -- dieselbe "
	+ "Filterung wie in `n`");

// =================================================================================================
// 11. Nachtrag RULING R11 -- der Endpunkt kappt eine laengere id-Liste STILLSCHWEIGEND bei 200
// =================================================================================================
//
// `api/edit/wiki/sync-plan.php:218` macht `array_slice($payload['ids'], 0,
// AVESMAPS_SYNC_PLAN_CATEGORY_LIMIT)` -- ohne Fehler, ohne Hinweis. Der Fussknopf ist der ERSTE
// Aufrufer dieses Fensters, der ueberhaupt viele ids auf einmal schickt (bisher: eine je Klick).
// 🔴 Gemessen wird deshalb die ANZAHL der Aufrufe und die GROESSE jedes Haeppchens -- eine
// Zusicherung, die bei vielen ids nur prueft, DASS gesendet wurde, ist Vakuum.

function idsObjekt(key, ids, schonAngehakt) {
	return {
		key: key,
		items: ids.map(function (id) { return { id: id, selected: schonAngehakt ? 1 : 0 }; }),
	};
}

function idsObjektGemischt(key, eintraege) {
	return {
		key: key,
		items: eintraege.map(function (e) { return { id: e.id, selected: e.selected ? 1 : 0 }; }),
	};
}

// ---- 11a. garetienIdsInHaeppchen -- die reine Aufteilung ----------------------------------------
gleich(modul.garetienIdsInHaeppchen([]).length, 0, "leere Liste -> keine Haeppchen");
tief(modul.garetienIdsInHaeppchen([1, 2, 3]), [[1, 2, 3]],
	"unter der Grenze -> EIN Haeppchen mit allen ids");
{
	const ids200 = Array.from({ length: 200 }, (_, i) => i + 1);
	tief(modul.garetienIdsInHaeppchen(ids200), [ids200], "GENAU 200 -> immer noch ein Haeppchen");
	const ids201 = ids200.concat([201]);
	const haeppchen201 = modul.garetienIdsInHaeppchen(ids201);
	gleich(haeppchen201.length, 2, "201 ids -> ZWEI Haeppchen");
	gleich(haeppchen201[0].length, 200, "das erste traegt genau die Grenze");
	tief(haeppchen201[1], [201], "und der Rest liegt im zweiten");
}

// ---- 11b. garetienAnzeigeAnhakenIds -- wer traegt ueberhaupt eine id bei? -----------------------
{
	const gemischt = idsObjektGemischt("ggp:gemischt:1", [{ id: 920, selected: true }, { id: 921, selected: false }]);
	tief(modul.garetienAnzeigeAnhakenIds([gemischt]), [920, 921],
		"ein Objekt mit MINDESTENS einem offenen Item liefert ALLE seine ids -- auch die schon "
		+ "angehakten, denn der Fussknopf haengt an, er nimmt nichts weg");

	const schonVoll = idsObjekt("ggp:voll:1", [930, 931], true);
	tief(modul.garetienAnzeigeAnhakenIds([schonVoll]), [],
		"ein Objekt, dessen Items schon VOLLSTAENDIG angehakt sind, liefert KEINE ids -- nichts "
		+ "zu tun -- `garetienHakenPlan` gaebe dort die Toggle-Richtung ALLES-AB zurueck, und "
		+ "genau die darf der Fussknopf nie senden)");

	tief(modul.garetienAnzeigeAnhakenIds([ohneVorschlag]), [], "ein Objekt ohne jedes Item traegt nichts bei");

	const teil = idsObjekt("ggp:teil:1", [940, 941], false);
	tief(modul.garetienAnzeigeAnhakenIds([schonVoll, teil, ohneVorschlag]), [940, 941],
		"gemischt: nur das Objekt mit offenen Items traegt bei, in EINFUEGE-Reihenfolge");
}

// =================================================================================================
// 12. Regression 29.08.2026 (Owner-Meldung): die Anzeige-Menge wird nach einer frischen Antwort
// AUFGEFRISCHT, nie entfernt
// =================================================================================================
//
// Diagnose: `zustand.anzeige.set(...)` wurde bis dahin AUSSCHLIESSLICH aus
// `avesmapsGaretienAnzeigeHinzufuegen` gerufen. Eine Handlung ("Neu einfuegen", "Namen ersetzen",
// ein Abschnittshaekchen) ging an den Server, `avesmapsGaretienHandlungSenden` holte die Liste neu
// -- aber die KOPIEN in `zustand.anzeige` blieben auf dem alten Stand. Weder das ✦ noch der ✓ am
// Handlungsknopf noch die Einzelansicht aenderten sich: der Knopf tat scheinbar nichts.
//
// 🔴 Gemessen wird die DIFFERENZ, in EINEM Aufruf von `avesmapsGaretienListeRendern` (dem
// gemeinsamen Punkt beider Renderwege) -- OHNE beide Faelle zusammen waere die Zusicherung wertlos:
{
	const veraltet = {
		key: "ggp:Fluss:9", name: "Alter Bach", typ: "Fluss", items: [{ id: 9001, selected: 0 }],
	};
	const bleibtDraussen = { key: "ggp:Berge:99", name: "Fern-Berg", typ: "Berg", items: [] };

	modul.avesmapsGaretienAnzeigeLeeren();
	modul.avesmapsGaretienAnzeigeHinzufuegen([veraltet, bleibtDraussen]);

	// Die "frische Serverantwort" traegt eine GEAENDERTE Fassung von `veraltet` (selected jetzt 1)
	// und NICHT `bleibtDraussen` -- genau die Lage nach einem gefilterten/seitenweisen Abruf
	// (`AVESMAPS_GARETIEN_LISTE_MAX`).
	const frischeFassung = {
		key: "ggp:Fluss:9", name: "Alter Bach", typ: "Fluss", items: [{ id: 9001, selected: 1 }],
	};
	modul.avesmapsGaretienListeRendern({
		objekte: [frischeFassung],
		reiter: { offen: 1, abgelehnt: 0, uebernommen: 0 },
		bilanz: {},
		gesamt: 1,
	});

	gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Fluss:9"), true,
		"das Objekt bleibt in der Anzeige -- Auffrischen ERSETZT, es entfernt nicht");
	gleich(
		modul.avesmapsGaretienAnzeigeListe().filter((o) => o.key === "ggp:Fluss:9")[0].items[0].selected,
		1,
		"…und traegt jetzt den NEUEN Wert aus der Serverantwort -- die alte Kopie mit selected:0 ist weg"
	);
	tief(
		modul.avesmapsGaretienAnzeigeListe().map((o) => o.key).sort(),
		["ggp:Berge:99", "ggp:Fluss:9"],
		"und das Objekt, das die Antwort NICHT nennt (`bleibtDraussen`), liegt UNVERAENDERT weiter "
		+ "drin -- eine gefilterte/seitenweise Antwort darf die Anzeige nie leeren"
	);
	gleich(
		modul.avesmapsGaretienAnzeigeListe().filter((o) => o.key === "ggp:Berge:99")[0],
		bleibtDraussen,
		"…und zwar als DIESELBE Referenz, unangetastet"
	);
}

// Die DIFFERENZ zum zweiten Renderweg: der Reiter „Anzeigen" baut seine „Antwort" aus der Menge
// SELBST nach (`garetienAnzeigenAntwortBauen`) -- ein Aufruf von `avesmapsGaretienListeRendern`
// darueber darf die Menge weder leeren noch sonst veraendern, er ist ein wirkungsloser Nachschlag
// auf sich selbst. 🔴 Eine Regel, die nur einen von zwei Renderwegen bindet, ist keine Regel --
// genau das ist in diesem Umbau heute schon zweimal passiert (RULING R2, R7).
{
	const objekt = {
		key: "ggp:See:1", name: "Kraehensee", typ: "See", items: [{ id: 1, selected: 0 }],
	};
	modul.avesmapsGaretienAnzeigeLeeren();
	modul.avesmapsGaretienAnzeigeHinzufuegen([objekt]);
	const anzeigenAntwort = modul.garetienAnzeigenAntwortBauen({ reiter: {}, bilanz: {} });
	modul.avesmapsGaretienListeRendern(anzeigenAntwort);
	gleich(modul.avesmapsGaretienAnzeigeHat("ggp:See:1"), true,
		"der 'Anzeigen'-Zweig (er baut seine Antwort aus der Menge selbst) laesst die Menge "
		+ "unangetastet");
	gleich(modul.avesmapsGaretienAnzeigeListe().length, 1, "und nichts verschwindet dabei");
}

modul.avesmapsGaretienAnzeigeLeeren();

// =================================================================================================
// 13. Aufgabe 8: garetienFussknopfKlick schreibt WIRKLICH -- anhaken, DANN uebernehmen
// =================================================================================================
//
// 🔴 Bis zum 29.08.2026 endete der Fussknopf nach dem Anhaken in einem `oeffnen()`-Aufruf (er
// oeffnete die Uebernahme-Vorschau). Owner: „kommt eine neue seite, anstatt alle angezeigten
// einzufuegen" -- der Knopf fuegte nicht ein. Seither ruft garetienFussknopfKlick (ueber die
// gemeinsame garetienEinfuegenAusfuehren) nach dem Anhaken SELBST `action:'apply'`, sequenziell,
// bis der Server `done` meldet -- kein drittes Argument `oeffnen` mehr, `senden` wird zu `rufe`
// (derselbe Vertrag wie avesmapsGaretienRufe: loest mit der Antwort auf, oder wirft).
async function pruefeFussknopfHaeppchen() {
	// Gegenprobe: UNTER der Anhak-Grenze -> GENAU EIN Select-Haeppchen, DANN ein erledigender
	// apply-Schritt. Die Zusicherung misst die DIFFERENZ zum Vorher: es geht wirklich `apply`
	// hinaus, nicht bloss ein zweites `select`.
	{
		const angezeigte = [];
		for (let i = 1; i <= 50; i++) { angezeigte.push(idsObjekt("g:" + i, [i], false)); }
		angezeigte.push(ohneVorschlag); // traegt kein Item -- muss folgenlos bleiben

		const gestellt = [];
		const rufe = function (pfad, rumpf) {
			gestellt.push({ pfad: pfad, rumpf: rumpf });
			if (rumpf.action === "apply") {
				return Promise.resolve({
					ok: true, done: true, applied: 50, deleted: 0, stale: 0, processed: 50,
					remaining: 0, skipped: 0, declined: 0,
				});
			}
			return Promise.resolve({ ok: true, changed: rumpf.ids.length });
		};
		const summe = await modul.garetienFussknopfKlick(angezeigte, 4711, rufe);

		gleich(gestellt.length, 2, "50 ids -> EIN select-Haeppchen, DANN EIN apply-Schritt");
		gleich(gestellt[0].pfad, "/api/edit/wiki/sync-plan.php", "beide gehen durch die EINE Tuer");
		gleich(gestellt[0].rumpf.action, "select", "erst wird angehakt");
		gleich(gestellt[0].rumpf.ids.length, 50, "und das eine Haeppchen traegt alle 50 ids");
		gleich(gestellt[0].rumpf.kind, "garetien", "mit der kind-Kennung dieses Imports");
		gleich(gestellt[0].rumpf.selected, true, "der Fussknopf HAENGT AN, er toggelt nie ab");
		gleich(gestellt[1].rumpf.action, "apply",
			"🔴 DIE DIFFERENZ: danach wird WIRKLICH uebernommen, nicht nur vorgemerkt");
		gleich(gestellt[1].rumpf.run_id, 4711, "mit der hereingereichten Lauf-Nummer");
		gleich(summe.applied, 50, "und die Summe zaehlt die Uebernahme, nicht das Anhaken");
	}

	// Die DIFFERENZ: UEBER der Anhak-Grenze -> ZWEI Select-Haeppchen (200 + 10), SEQUENZIELL.
	{
		const angezeigte = [];
		for (let i = 1; i <= 210; i++) { angezeigte.push(idsObjekt("h:" + i, [i], false)); }

		const sequenz = [];
		const rufe = function (pfad, rumpf) {
			if (rumpf.action === "select") {
				sequenz.push("start:" + rumpf.ids.length);
				return new Promise(function (resolve) {
					setTimeout(function () {
						sequenz.push("ende:" + rumpf.ids.length);
						resolve({ ok: true });
					}, 0);
				});
			}
			return Promise.resolve({
				ok: true, done: true, applied: 210, deleted: 0, stale: 0, processed: 210,
				remaining: 0, skipped: 0, declined: 0,
			});
		};
		const summe = await modul.garetienFussknopfKlick(angezeigte, 1, rufe);

		tief(sequenz, ["start:200", "ende:200", "start:10", "ende:10"],
			"💣 210 ids -> 200 + 10, und das ZWEITE Haeppchen startet erst, NACHDEM das erste "
			+ "fertig ist (nicht `start:200,start:10,…`) -- STRATO wird nie mit zwei parallelen "
			+ "Anfragen auf denselben Lauf getroffen");
		gleich(summe.applied, 210, "und danach steht die Uebernahme wirklich da");
	}

	// SEQUENZIELL gilt auch fuer `apply` SELBST: der Server meldet zweimal `done:false`, und kein
	// zweiter apply-Aufruf darf starten, bevor der vorige geantwortet hat -- gemessen mit einem
	// Spion, der Start UND Ende protokolliert (Brief).
	{
		const angezeigte = [idsObjekt("m:1", [1], false)];
		const sequenz = [];
		let gleichzeitig = 0;
		const rufe = function (pfad, rumpf) {
			if (rumpf.action === "select") { return Promise.resolve({ ok: true }); }
			gleichzeitig++;
			wahr(gleichzeitig === 1,
				"💣 zwei GLEICHZEITIGE apply-Aufrufe -- STRATOs Einzelflug-Sperre wuerde den "
				+ "zweiten ablehnen");
			sequenz.push("start");
			return new Promise(function (resolve) {
				setTimeout(function () {
					sequenz.push("ende");
					gleichzeitig--;
					const fertig = sequenz.filter(function (s) { return s === "ende"; }).length >= 3;
					resolve({
						ok: true, done: fertig, applied: fertig ? 1 : 0, deleted: 0, stale: 0,
						processed: fertig ? 1 : 0, remaining: fertig ? 0 : 1, skipped: 0, declined: 0,
					});
				}, 0);
			});
		};
		const fortschrittLog = [];
		const summe = await modul.garetienFussknopfKlick(angezeigte, 1, rufe,
			function (fertig, gesamt) { fortschrittLog.push([fertig, gesamt]); });

		tief(sequenz, ["start", "ende", "start", "ende", "start", "ende"],
			"🔴 drei apply-Schritte, jeder startet erst NACH dem Ende des vorigen");
		gleich(summe.applied, 1, "und die Summe zaehlt richtig zusammen, ueber alle Teilschritte");
		tief(fortschrittLog[0], [0, 1], "der Fortschritt beginnt bei 0 von 1");
		tief(fortschrittLog[fortschrittLog.length - 1], [1, 1], "…und endet bei 1 von 1");
	}

	// Abbruch: scheitert das Anhaken, wird das zweite Haeppchen NIE gesendet, `apply` erst recht
	// nicht -- und der Fehler geht als ABLEHNUNG nach oben durch, nicht als `false`/`null`.
	{
		const angezeigte = [];
		for (let i = 1; i <= 210; i++) { angezeigte.push(idsObjekt("k:" + i, [i], false)); }

		const gestellt = [];
		const rufe = function (pfad, rumpf) {
			gestellt.push(rumpf);
			if (rumpf.action === "select" && gestellt.length === 1) {
				// derselbe Vertrag wie avesmapsGaretienRufe: ein Fehlschlag WIRFT.
				return Promise.reject(new Error("dump_locked"));
			}
			return Promise.resolve({
				ok: true, done: true, applied: 0, deleted: 0, stale: 0, processed: 0,
				remaining: 0, skipped: 0, declined: 0,
			});
		};
		let fehler = null;
		await modul.garetienFussknopfKlick(angezeigte, 1, rufe).catch(function (e) { fehler = e; });

		wahr(fehler instanceof Error && fehler.message === "dump_locked",
			"🔴 ein Fehler mittendrin bricht ab und wird NICHT verschluckt -- er darf nie als "
			+ "Erfolg durchgehen");
		gleich(gestellt.length, 1, "das ZWEITE Haeppchen wird NIE gesendet, `apply` erst recht nicht");
	}

	// Nichts anzuhaken (alles schon angehakt, oder gar kein Vorschlag): kein Netzruf, kein `apply`.
	{
		const rufe = function () { throw new Error("darf hier nie gerufen werden"); };
		const summe = await modul.garetienFussknopfKlick([ohneVorschlag], 1, rufe);
		gleich(summe.applied, 0, "nichts zu tun ist kein Fehler -- und loest keinen Netzruf aus");
	}
}

// =================================================================================================
// 14. Aufgabe 8: avesmapsGaretienAnzeigeNachEinfuegenBereinigen -- nur Uebernommenes verlaesst die Anzeige
// =================================================================================================
//
// ⚠️ „Nur was uebernommen wurde, verlaesst die Anzeige" (Brief) -- gemessen gegen einen gezielten
// Nachlese-Ruf auf den Server-Reiter „uebernommen", NICHT gegen eine Vermutung im Browser: `apply`
// selbst nennt nie, WELCHE Objekte es waren.
async function pruefeAnzeigeBereinigen() {
	const uebernommen = { key: "ggp:See:1", name: "Krähensee", items: [{ id: 1, selected: 0 }] };
	const nochOffen = { key: "ggp:Fluss:2", name: "Alter Bach", items: [{ id: 2, selected: 0 }] };
	const ohneVorschlagBleibt = { key: "ggp:Berge:9", name: "Fernberg", items: [] };

	modul.avesmapsGaretienAnzeigeLeeren();
	modul.avesmapsGaretienAnzeigeHinzufuegen([uebernommen, nochOffen, ohneVorschlagBleibt]);

	const gestellt = [];
	const rufe = function (pfad, rumpf) {
		gestellt.push({ pfad: pfad, rumpf: rumpf });
		return Promise.resolve({
			ok: true,
			objekte: [Object.assign({}, uebernommen, { stand: "uebernommen" })],
		});
	};
	const entfernt = await modul.avesmapsGaretienAnzeigeNachEinfuegenBereinigen(rufe, 4711);

	gleich(gestellt.length, 1, "EIN gezielter Nachlese-Ruf -- keine Schleife ueber mehrere Seiten");
	gleich(gestellt[0].pfad, "/api/edit/map/garetien-import.php", "gegen die lesende Adresse");
	gleich(gestellt[0].rumpf.action, "liste", "als gewoehnlicher Listenabruf");
	gleich(gestellt[0].rumpf.stand, "uebernommen",
		"🔴 gezielt auf den Reiter uebernommen -- unabhaengig vom gerade aktiven UI-Reiter");
	gleich(gestellt[0].rumpf.run_id, 4711, "mit der hereingereichten Lauf-Nummer");
	gleich(entfernt, 1, "genau EIN Objekt wurde als uebernommen bestaetigt und entfernt");
	gleich(modul.avesmapsGaretienAnzeigeHat("ggp:See:1"), false,
		"das bestaetigt uebernommene Objekt hat die Anzeige verlassen");
	gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Fluss:2"), true,
		"ein noch offenes Objekt bleibt liegen -- der Server hat es nicht als uebernommen genannt");
	gleich(modul.avesmapsGaretienAnzeigeHat("ggp:Berge:9"), true,
		"und ein Objekt OHNE Vorschlag bleibt erst recht liegen -- es konnte nie uebernommen werden");
}

// =================================================================================================
// 15. Aufgabe 10: „Alle markieren" -- markiert alle Zeilen der AKTUELLEN Liste, ergaenzt statt ersetzt
// =================================================================================================
//
// Brief: .superpowers/sdd/2026-08-29-garetien-importer-sichtwerkzeug/task-9-brief.md (Aufgabe 10)
{
	const a = { key: "gi10:a", name: "A", items: [] };
	const b = { key: "gi10:b", name: "B", items: [] };
	const c = { key: "gi10:c", name: "C", items: [] };
	// Eine bereits markierte Zeile aus einer ANDEREN Ansicht -- sie darf nicht verloren gehen.
	modul.avesmapsGaretienMarkierungUmschalten("gi10:vorher");
	gleich(modul.avesmapsGaretienMarkierungHat("gi10:vorher"), true,
		"die Fixture steht wirklich markiert da");

	// ---- Miss die DIFFERENZ: eine Liste mit drei Zeilen markiert genau diese drei ----------------
	gleich(modul.avesmapsGaretienAlleMarkieren([a, b, c]), 3,
		"drei bislang unmarkierte Zeilen -- alle drei werden neu markiert");
	[a, b, c].forEach((o) => gleich(modul.avesmapsGaretienMarkierungHat(o.key), true,
		`${o.key} muss nach „Alle markieren\" markiert sein`));

	// ---- Er ERGAENZT, er ERSETZT NICHT: die vorher markierte Zeile bleibt markiert ---------------
	gleich(modul.avesmapsGaretienMarkierungHat("gi10:vorher"), true,
		"eine vorher markierte Zeile aus einer anderen Filteransicht bleibt markiert");

	// ---- Ein zweiter Aufruf ueber dieselbe Liste markiert nichts NEU -------------------------------
	gleich(modul.avesmapsGaretienAlleMarkieren([a, b, c]), 0,
		"schon markierte Zeilen werden beim zweiten Aufruf nicht noch einmal gezaehlt");

	// ---- Eine leere/fehlende Liste markiert nichts -------------------------------------------------
	gleich(modul.avesmapsGaretienAlleMarkieren([]), 0, "eine leere Liste markiert nichts");
	gleich(modul.avesmapsGaretienAlleMarkieren(), 0, "und auch ganz ohne Argument passiert nichts");

	// ---- Ein Objekt ohne Schluessel wird uebersprungen, nicht geworfen -----------------------------
	gleich(modul.avesmapsGaretienAlleMarkieren([{ name: "ohne key" }, null, undefined]), 0,
		"ein Objekt ohne Schluessel bricht nichts und markiert auch nichts");

	// ---- Der Knopf-Zustand: Beschriftung traegt die Zahl der GERENDERTEN Zeilen -------------------
	const standDrei = modul.garetienAlleMarkierenZustand([a, b, c], "offen");
	gleich(standDrei.beschriftung, "Alle markieren (3)", "die Zahl der gerenderten Zeilen steht im Knopf");
	gleich(standDrei.gesperrt, false, "auf dem Reiter „Offen\" ist er bedienbar");
	gleich(standDrei.hinweis, "", "und ohne Hinweis");

	// ---- Im Reiter „Anzeigen" ist er sinnlos und gesperrt, mit sichtbarem Grund --------------------
	const standAnzeigen = modul.garetienAlleMarkierenZustand([a, b, c], "anzeigen");
	gleich(standAnzeigen.gesperrt, true, "auf „Anzeigen\" ist er gesperrt -- dort liegt ohnehin alles");
	wahr(standAnzeigen.hinweis.length > 0, "und der Grund steht sichtbar da, wie bei Suche/Filter");

	// ---- Eine leere gerenderte Liste sperrt ihn ebenfalls, mit eigenem Grund -----------------------
	const standLeer = modul.garetienAlleMarkierenZustand([], "offen");
	gleich(standLeer.gesperrt, true, "nichts in der Liste -- nichts zu markieren");
	wahr(standLeer.hinweis.length > 0, "und auch das steht sichtbar da");
	gleich(standLeer.beschriftung, "Alle markieren (0)", "und die Zahl sagt es ebenfalls");
}

pruefeFussknopfHaeppchen().then(function () {
	return pruefeAnzeigeBereinigen();
}).then(function () {
	console.log(`garetien-anzeige-menge: ${checks} Pruefungen bestanden.`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});

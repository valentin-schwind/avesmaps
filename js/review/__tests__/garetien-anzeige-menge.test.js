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

// ---- 11c. garetienFussknopfKlick -- der ganze Ablauf, mit einem Spion statt echtem Netz ---------
async function pruefeFussknopfHaeppchen() {
	// Gegenprobe: UNTER der Grenze -> GENAU EIN Aufruf, alle ids in einem Haeppchen. Nur die
	// DIFFERENZ zum naechsten Block belegt die Haeppchen-Regel wirklich.
	{
		const angezeigte = [];
		for (let i = 1; i <= 50; i++) { angezeigte.push(idsObjekt("g:" + i, [i], false)); }
		angezeigte.push(ohneVorschlag); // traegt kein Item -- muss folgenlos bleiben

		const gestellt = [];
		const senden = function (rumpf) { gestellt.push(rumpf); return Promise.resolve({ ok: true }); };
		let geoeffnet = 0;
		const ok = await modul.garetienFussknopfKlick(angezeigte, 4711, senden, function () { geoeffnet++; });

		gleich(ok, true, "kein Abbruch");
		gleich(gestellt.length, 1, "50 ids liegen UNTER der Grenze von 200 -- GENAU ein Aufruf");
		gleich(gestellt[0].ids.length, 50, "und das eine Haeppchen traegt alle 50 ids");
		gleich(gestellt[0].action, "select", "mit der Aktion, die der Server erwartet");
		gleich(gestellt[0].kind, "garetien", "und der kind-Kennung dieses Imports");
		gleich(gestellt[0].run_id, 4711, "und der hereingereichten Lauf-Nummer");
		gleich(gestellt[0].selected, true, "der Fussknopf HAENGT AN, er toggelt nie ab");
		gleich(geoeffnet, 1, "und danach oeffnet sich das Blatt -- genau einmal");
	}

	// Die DIFFERENZ: UEBER der Grenze -> ZWEI Haeppchen (200 + 10), SEQUENZIELL, nie parallel.
	{
		const angezeigte = [];
		for (let i = 1; i <= 210; i++) { angezeigte.push(idsObjekt("h:" + i, [i], false)); }

		const sequenz = [];
		const senden = function (rumpf) {
			sequenz.push("start:" + rumpf.ids.length);
			return new Promise(function (resolve) {
				setTimeout(function () {
					sequenz.push("ende:" + rumpf.ids.length);
					resolve({ ok: true });
				}, 0);
			});
		};
		let geoeffnet = 0;
		const ok = await modul.garetienFussknopfKlick(angezeigte, 1, senden, function () { geoeffnet++; });

		gleich(ok, true, "beide Haeppchen kommen an");
		tief(sequenz, ["start:200", "ende:200", "start:10", "ende:10"],
			"💣 210 ids -> 200 + 10, und das ZWEITE Haeppchen startet erst, NACHDEM das erste "
			+ "fertig ist (nicht `start:200,start:10,…`) -- STRATO wird nie mit zwei parallelen "
			+ "Anfragen auf denselben Lauf getroffen");
		gleich(geoeffnet, 1, "und das Blatt geht danach genau einmal auf");
	}

	// Abbruch: scheitert ein Haeppchen, wird das naechste NIE gesendet und das Blatt NIE geoeffnet.
	{
		const angezeigte = [];
		for (let i = 1; i <= 210; i++) { angezeigte.push(idsObjekt("k:" + i, [i], false)); }

		const gestellt = [];
		const senden = function (rumpf) {
			gestellt.push(rumpf);
			// avesmapsGaretienHandlungSenden faengt jeden Fehlschlag ab und meldet ihn als `null`
			// (der Fehler steht dann schon in der Liste) -- genau dieser Vertrag wird hier
			// nachgestellt.
			return Promise.resolve(null);
		};
		let geoeffnet = 0;
		const ok = await modul.garetienFussknopfKlick(angezeigte, 1, senden, function () { geoeffnet++; });

		gleich(ok, false, "ein gescheitertes Haeppchen bricht die Kette ab");
		gleich(gestellt.length, 1, "das ZWEITE Haeppchen wird NIE gesendet");
		gleich(geoeffnet, 0,
			"und das Blatt geht NICHT auf -- eine Vorschau ueber einen halb geschriebenen Stand "
			+ "waere eine Falschaussage");
	}

	// Nichts anzuhaken (alles schon angehakt, oder gar kein Vorschlag): keine Anfrage -- das Blatt
	// geht trotzdem auf, mit dem vorhandenen Stand.
	{
		const senden = function () { throw new Error("darf hier nie gerufen werden"); };
		let geoeffnet = 0;
		const ok = await modul.garetienFussknopfKlick([ohneVorschlag], 1, senden, function () { geoeffnet++; });

		gleich(ok, true, "nichts zu tun ist kein Abbruch");
		gleich(geoeffnet, 1, "das Blatt oeffnet sich trotzdem -- mit dem vorhandenen Stand");
	}
}

pruefeFussknopfHaeppchen().then(function () {
	console.log(`garetien-anzeige-menge: ${checks} Pruefungen bestanden.`);
}).catch(function (fehler) {
	console.error(fehler);
	process.exitCode = 1;
});

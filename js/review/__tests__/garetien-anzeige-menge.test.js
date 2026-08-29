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

console.log(`garetien-anzeige-menge: ${checks} Pruefungen bestanden.`);

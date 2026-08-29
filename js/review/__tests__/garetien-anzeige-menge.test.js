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

console.log(`garetien-anzeige-menge: ${checks} Pruefungen bestanden.`);

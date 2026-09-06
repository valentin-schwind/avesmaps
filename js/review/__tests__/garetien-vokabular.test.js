// Aufgabe 8 des Garetien Importers -- Umbenennung: Anzeige wird Stage, Markierung wird Auswahl.
// Brief: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-8-brief.md
//
// Der Owner hat das Vokabular des Fensters „ein riesen kuddel muddel" genannt -- sieben Begriffe
// fuer zwei Dinge. Diese Aufgabe reduziert sie auf zwei: AUSWAHL (das Haekchen in der Zeile) und
// STAGE (was auf der Karte liegt und importiert wird). Dieser Test ist der Waechter dagegen, dass
// das alte Vokabular zurueckschleicht -- WORTLISTE waere Vakuum (sie prueft nur, woran der Autor
// gedacht hat); VOLLSTAENDIGKEIT prueft, was tatsaechlich noch da ist.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-vokabular.test.js

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

let checks = 0;
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum || ""); checks++; }
function wahr(bed, warum) { assert.ok(bed, warum || ""); checks++; }

const WURZEL = path.resolve(__dirname, "..", "..", "..");
function lies(relPfad) {
	return fs.readFileSync(path.join(WURZEL, relPfad), "utf8");
}

// 🔴 ZEILENENDENNEUTRAL: die Arbeitskopie traegt CRLF, die CI (actions/checkout) legt LF hin
// (AGENTS.md §9). Ein Test, der \r\n sucht, waere hier gruen und dort rot -- deshalb wird ZUERST
// vereinheitlicht, dann erst kommentarfrei gemacht.
const quelle = lies("js/review/review-garetien-importer.js")
	.replace(/\r\n/g, "\n")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const html = lies("index.html")
	.replace(/\r\n/g, "\n")
	.replace(/<!--[\s\S]*?-->/g, "");

// =================================================================================================
// 1. Vollstaendigkeit statt Wortliste -- kein BEZEICHNER traegt noch "Anzeige" oder "Markier".
// =================================================================================================
//
// 💣 DIE TRAGENDE ZUSICHERUNG. Eine Wortliste ("garetienAnzeigeListe" darf nicht mehr vorkommen")
// preuft nur die Namen, an die der Autor beim Umbenennen gedacht hat -- ein vergessener Bezeichner
// faellt durch. Hier wird deshalb JEDES bezeichnerartige Token im kommentarfreien Code gegen
// /Anzeige|Markier/ gehalten (gross-/kleinschreibungsempfindlich -- genau wie die camelCase-Namen
// selbst: `avesmapsGaretienAnzeigeHat` traegt ein grosses A, `zustand.anzeige` ein kleines und wird
// darum separat unter Regel 3 gefuehrt).
//
// ⚠️ Der Regex `[A-Za-z_$][A-Za-z0-9_$]*` kennt keine Stringgrenzen -- er findet auch Wortfolgen
// INNERHALB von Stringliteralen (JS-Bezeichner und deutsche Fliesstext-Woerter sehen fuer ihn
// gleich aus). Genau deshalb verlangt der Brief eine EXPLIZITE, benannte Ausnahmeliste statt eines
// stillen Filters -- ein Filter, der "sieht aus wie ein String" ausnaehme, wuerde auch eine
// zurueckgeschmuggelte Beschriftung durchwinken.
const bezeichnerRegex = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const gefundeneTreffer = new Map();
{
	let treffer;
	while ((treffer = bezeichnerRegex.exec(quelle)) !== null) {
		const wort = treffer[0];
		if (/Anzeige|Markier/.test(wort)) {
			gefundeneTreffer.set(wort, (gefundeneTreffer.get(wort) || 0) + 1);
		}
	}
}

// 🔴 DIE AUSNAHMELISTE -- jede Zeile mit Grund, wie der Brief es verlangt. Zwei Eintraege, unter
// der Fuenf-Eintraege-Schwelle aus dem Brief:
//
// · `ecosystemSetzeAnzeigeHaken` -- KEIN Bezeichner dieser Datei. Er ist in
//   js/map-features/map-features-ecosystem-layer-switch.js definiert (Landschaften-Anzeigeprofil,
//   eine voellig andere Funktion) und wird hier nur AUFGERUFEN (garetienImportHakenSetzen). Ihn
//   umzubenennen wuerde den Aufruf gegen die echte, fremde Funktion brechen -- unvermeidlich.
// · `Anzeige` (als Bestandteil des Satzes „aus der Anzeige in die Karte einfuegen?" in
//   garetienEinfuegenRueckfrageText) -- echter deutscher Fliesstext in einem Bestaetigungsdialog,
//   kein Bezeichner. Der Brief aendert an dieser Funktion nur den Satz ueber Name/Geometrie
//   (entfaellt ersatzlos); dieser Satz steht nicht in Abschnitt C und bleibt darum unveraendert.
//   Er ist ein Fund, kein Bestandteil dieser Aufgabe -- siehe den Bericht.
const AUSNAHMEN_BEZEICHNER = new Set(["ecosystemSetzeAnzeigeHaken", "Anzeige"]);

// Und die eine bewusst belassene Beschriftung, die NICHT in Abschnitt C steht: „Markierte
// zurücknehmen" (Meldung C, eigenes Feature, eigene DOM-Kennung `garetien-ruecknahme-markierte`).
// Sie ist keine der sechs Beschriftungen aus der Tabelle, und ihr Umbenennen gehoert nicht zu
// dieser Aufgabe (siehe den Bericht). Das Wort, das dabei als Bezeichner-Token auftaucht, ist
// "Markierte" (aus dem Stringliteral "Markierte zurücknehmen (...)").
AUSNAHMEN_BEZEICHNER.add("Markierte");

const unerwartet = [...gefundeneTreffer.keys()].filter((wort) => !AUSNAHMEN_BEZEICHNER.has(wort));
gleich(unerwartet.join(", "), "",
	"unerwartete Bezeichner mit 'Anzeige'/'Markier' im kommentarfreien Code -- "
	+ "die Ausnahmeliste im Test nennt sie nicht, die Umbenennung ist unvollstaendig");
wahr(AUSNAHMEN_BEZEICHNER.size <= 5,
	"die Ausnahmeliste ist auf " + AUSNAHMEN_BEZEICHNER.size + " Eintraege gewachsen -- "
	+ "der Brief verlangt, das im Bericht zu sagen, statt sie weiter wachsen zu lassen");

// =================================================================================================
// 2. Die alten Beschriftungen aus Abschnitt C kommen weder im JS noch im Markup vor.
// =================================================================================================
[
	"Markierte anzeigen",
	"Anzeige leeren",
	"Alle markieren",
	"Keines markieren",
	"Alle angezeigten einfügen",
	"Angehakte übernehmen",
	"nichts zu ersetzen",
	"Name weicht ab",
].forEach((alt) => {
	wahr(!quelle.includes(alt), "alte Beschriftung „" + alt + "\" darf nicht mehr im JS stehen");
	wahr(!html.includes(alt), "alte Beschriftung „" + alt + "\" darf nicht mehr im Markup stehen");
});

// =================================================================================================
// 3. zustand.stage und zustand.auswahl kommen vor; zustand.anzeige und zustand.markiert nicht.
// =================================================================================================
wahr(/\bzustand\.stage\b/.test(quelle), "zustand.stage muss vorkommen");
wahr(/\bzustand\.auswahl\b/.test(quelle), "zustand.auswahl muss vorkommen");
wahr(!/\bzustand\.anzeige\b/.test(quelle), "zustand.anzeige darf nicht mehr vorkommen");
wahr(!/\bzustand\.markiert\b/.test(quelle), "zustand.markiert darf nicht mehr vorkommen");

// =================================================================================================
// 4. Die Kennungen bleiben -- dieselbe Trennung wie bei „Neuigkeiten"/`changelog` (AGENTS.md §11):
// eine umgetaufte Kennung liesse eine gecachte Seite ins Leere greifen.
//
// 🔴 Der Plan sicherte zu, `garetien-mark-show` sei WEG -- das war ein Planfehler und ist mit dem
// Brief zurueckgenommen: die alten Fussknoepfe fallen in Aufgabe 9, nicht hier.
// =================================================================================================
["garetien-mark-all", "garetien-mark-none", "garetien-mark-show"].forEach((id) => {
	wahr(html.includes('id="' + id + '"'), "die Kennung " + id + " muss weiterhin im Markup stehen");
});

// =================================================================================================
// 5. AVESMAPS_GARETIEN_SERVER_STAENDE enthaelt "stage" nicht -- der Reiter ist rein clientseitig,
// der Server kennt den Wert nicht.
// =================================================================================================
const staendeZeile = /const AVESMAPS_GARETIEN_SERVER_STAENDE = (\[[^\]]*\]);/.exec(quelle);
wahr(!!staendeZeile, "AVESMAPS_GARETIEN_SERVER_STAENDE muss im Quelltext auffindbar sein");
const staende = JSON.parse(staendeZeile[1].replace(/'/g, '"'));
wahr(!staende.includes("stage"), "AVESMAPS_GARETIEN_SERVER_STAENDE darf 'stage' nicht enthalten");

console.log(`garetien-vokabular: ${checks} Pruefungen bestanden.`);

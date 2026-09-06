// Aufgabe 8 des Garetien Importers -- Umbenennung: Anzeige wird Stage, Markierung wird Auswahl.
// Brief: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-8-brief.md
// Fixrunde 1: .superpowers/sdd/2026-09-06-garetien-importer-stage/task-8-fix-1.md
//
// Der Owner hat das Vokabular des Fensters „ein riesen kuddel muddel" genannt -- sieben Begriffe
// fuer zwei Dinge. Diese Aufgabe reduziert sie auf zwei: AUSWAHL (das Haekchen in der Zeile) und
// STAGE (was auf der Karte liegt und importiert wird). Dieser Test ist der Waechter dagegen, dass
// das alte Vokabular zurueckschleicht -- WORTLISTE waere Vakuum (sie prueft nur, woran der Autor
// gedacht hat); VOLLSTAENDIGKEIT prueft, was tatsaechlich noch da ist.
//
// 🔴 FIXRUNDE 1 (06.09.2026) schliesst DREI Loecher der ersten Fassung, alle Fehler im Auftrag,
// nicht im Bau:
//   A. Regel 1 war GROSS-/KLEINSCHREIBUNGSEMPFINDLICH (`/Anzeige|Markier/`) und sah deshalb keinen
//      klein anfangenden Bezeichner (`markierte`, `angezeigte`, `anzeigeLeerenBtn`, …). Jetzt
//      /anzeige|angezeigt|markier/i -- DREI, nicht zwei Alternativen: "angezeigt" (Partizip von
//      "anzeigen") teilt mit "anzeige" KEIN gemeinsames Teilwort ("an-GE-zeigt" schiebt das "ge"
//      mitten hinein), eine reine Gross-/Kleinschreibungs-Korrektur haette "angezeigt"/"angezeigte"/
//      "angezeigten" also weiterhin nicht gefunden.
//   B. Die Ausnahmeliste enthielt BLANKE WOERTER ("Anzeige", "Markierte") -- das entschuldigt JEDES
//      Vorkommen dieses Worts, auch eine zurueckgeschmuggelte Beschriftung. Jetzt: jede Ausnahme
//      ist ein KONTEXT (eine vollstaendige Zeichenkette, die auf der TREFFERZEILE stehen muss,
//      keine feste Zeichenzahl davor/danach -- AGENTS.md §9 warnt zu Recht vor einem festen
//      Zeichenfenster, das die Kommentarlaenge misst statt des Fundorts).
//   C. Es gab nie eine Regel ueber SICHTBARE Zeichenketten, nur eine feste Sechserliste fuer die
//      Texte aus Abschnitt C -- dieselbe Falle wie A, eine Etage tiefer (eine Liste prueft nur,
//      woran der Autor dachte). Abschnitt 3 ist neu und deckt js/review/review-garetien-importer.js
//      UND den Garetien-Teil von index.html ab (Regel 1 sieht index.html nie).
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

// Der GARETIEN-TEIL von index.html -- der Rest der Seite (Hinweise, Meldeformular, ...) hat mit
// diesem Fenster nichts zu tun und soll auch nicht mitgeprueft werden (dort steht z.B. legitim
// "garetien.de" in Quellenangaben). Grenzen: das Fenster selbst (`#garetien-importer`) bis zum
// Wirt seines Uebernahme-Blatts (`#garetien-sheet`), derselbe Bereich, den Regel 5 (Kennungen)
// schon als "das Markup dieses Fensters" behandelt.
const garetienHtmlStart = html.indexOf('<div id="garetien-importer"');
const garetienHtmlEnde = html.indexOf('<div class="sync-plan-host" id="garetien-sheet"');
wahr(garetienHtmlStart !== -1 && garetienHtmlEnde !== -1,
	"die Markup-Grenzen des Garetien-Fensters muessen in index.html auffindbar sein");
const garetienHtmlTeil = html.slice(garetienHtmlStart, garetienHtmlEnde);

// =================================================================================================
// Gemeinsames Werkzeug fuer Regel 1 UND Regel 3: JEDE Ausnahme ist ein KONTEXT, kein blankes Wort
// (Loch B). Eine Ausnahme entschuldigt einen Treffer nur, wenn ihre vollstaendige Zeichenkette auf
// DERSELBEN ZEILE steht wie der Treffer -- nicht irgendwo in der Datei. Das ist bewusst kein festes
// Zeichenfenster (AGENTS.md §9, „Quelltexttest mit festem Zeichenfenster" -- ein `slice(i-40,i+40)`
// misst zufaellig, wie lang der Rest der Zeile ist, nicht den Fundort).
// =================================================================================================
function zeileBeiIndex(text, index) {
	const start = text.lastIndexOf("\n", index) + 1; // -1 + 1 = 0, wenn keine vorherige Zeile
	let ende = text.indexOf("\n", index);
	if (ende === -1) { ende = text.length; }
	return text.slice(start, ende);
}

// 🔴 DIE AUSNAHMELISTE -- jede Zeile ist eine VOLLSTAENDIGE Zeichenkette (eine Kennung, ein
// Funktionsname oder ein ganzer Beschriftungstext), nie ein blankes Wort wie "Anzeige"/"Markierte"
// (Loch B). "Anzeige" und "Markierte" aus der ersten Fassung sind ERSATZLOS gefallen: beide
// Stellen, die sie entschuldigten (die Rueckfrage „aus der Anzeige…" und die Beschriftung
// „Markierte zurücknehmen"), sind mit dieser Fixrunde selbst umbenannt -- siehe Abschnitt 3.
const AUSNAHMEN_KONTEXTE = [
	{
		kontext: "ecosystemSetzeAnzeigeHaken",
		grund: "KEIN Bezeichner dieser Datei -- definiert in "
			+ "js/map-features/map-features-ecosystem-layer-switch.js (Landschaften-Anzeigeprofil, "
			+ "eine voellig andere Funktion) und hier nur AUFGERUFEN (garetienImportHakenSetzen). "
			+ "Umbenennen wuerde den Aufruf gegen die echte, fremde Funktion brechen.",
	},
	{
		kontext: "garetien-anzeige-hinweis",
		grund: "DOM-Kennung (samt ihrer CSS-Klasse `gi-anzeigehinweis`, die auf derselben Zeile "
			+ "steht) -- Regel 5 laesst Kennungen unveraendert, eine Umbenennung liesse eine "
			+ "gecachte Seite ins Leere greifen (AGENTS.md §11, „Neuigkeiten“/`changelog`).",
	},
	{
		kontext: "garetien-anzeige-clear",
		grund: "DOM-Kennung des Knopfes „Stage leeren“ -- dieselbe Regel-5-Begruendung; sein "
			+ "sichtbares Label wurde laengst umbenannt, seine Kennung bewusst nicht.",
	},
	{
		kontext: "garetien-ruecknahme-markierte",
		grund: "DOM-Kennung des Knopfes „Auswahl zurücknehmen“ (und ihr Hinweis-Pendant mit "
			+ "`-hint`-Suffix, das dieselbe Zeichenkette traegt) -- dieselbe Regel-5-Begruendung.",
	},
	{
		kontext: "Auf Karte anzeigen",
		grund: "Häkchen `showName` -- ob der NAME auf der Karte steht, hat mit der Stage nichts "
			+ "zu tun.",
	},
	{
		kontext: "Weg anzeigen (Name auf der Karte)",
		grund: "dasselbe Häkchen für Wege, andere Beschriftung.",
	},
	{
		kontext: "Angezeigte Zeilen",
		grund: "die Zeilengrenze der LISTE (1000 von 8213) -- sie zeigt wirklich Zeilen an, hat "
			+ "mit der Stage nichts zu tun.",
	},
];
wahr(AUSNAHMEN_KONTEXTE.length <= 8,
	"die Ausnahmeliste ist auf " + AUSNAHMEN_KONTEXTE.length + " Eintraege gewachsen -- "
	+ "jeder Eintrag hier ist eine vollstaendige Kennung oder ein vollstaendiger Beschriftungstext "
	+ "(Loch B), keiner davon entschuldigt eine Wortklasse. Waechst die Liste weiter, gehoert das "
	+ "in den naechsten Bericht.");

function istEntschuldigt(zeile) {
	return AUSNAHMEN_KONTEXTE.some(function (a) { return zeile.indexOf(a.kontext) !== -1; });
}

// Sammelt jedes bezeichnerartige Token aus `text`, das MUSTER matcht und auf seiner Zeile durch
// KEINE der AUSNAHMEN_KONTEXTE gedeckt ist. Von Regel 1 (nur die JS-Datei) UND Regel 3 (JS-Datei
// UND Garetien-Teil von index.html) gemeinsam benutzt.
const MUSTER = /anzeige|angezeigt|markier/i;
const bezeichnerRegex = /[A-Za-z_$][A-Za-z0-9_$]*/g;
function sammleUnentschuldigteTreffer(text) {
	const treffer = new Map();
	bezeichnerRegex.lastIndex = 0;
	let m;
	while ((m = bezeichnerRegex.exec(text)) !== null) {
		const wort = m[0];
		if (!MUSTER.test(wort)) { continue; }
		if (istEntschuldigt(zeileBeiIndex(text, m.index))) { continue; }
		treffer.set(wort, (treffer.get(wort) || 0) + 1);
	}
	return treffer;
}

// =================================================================================================
// 1. Vollstaendigkeit statt Wortliste -- kein BEZEICHNER traegt noch "Anzeige"/"angezeigt"/
//    "Markier", gross-/kleinschreibungsUNempfindlich (Loch A).
// =================================================================================================
//
// 💣 DIE TRAGENDE ZUSICHERUNG. Eine Wortliste ("garetienAnzeigeListe" darf nicht mehr vorkommen")
// prueft nur die Namen, an die der Autor beim Umbenennen gedacht hat -- ein vergessener Bezeichner
// faellt durch. Hier wird deshalb JEDES bezeichnerartige Token im kommentarfreien Code gegen
// MUSTER gehalten.
//
// ⚠️ Der Regex `[A-Za-z_$][A-Za-z0-9_$]*` kennt keine Stringgrenzen -- er findet auch Wortfolgen
// INNERHALB von Stringliteralen (JS-Bezeichner und deutsche Fliesstext-Woerter sehen fuer ihn
// gleich aus). Genau deshalb verlangt der Brief eine EXPLIZITE, benannte Ausnahmeliste statt eines
// stillen Filters -- ein Filter, der "sieht aus wie ein String" ausnaehme, wuerde auch eine
// zurueckgeschmuggelte Beschriftung durchwinken.
const unerwartetBezeichner = [...sammleUnentschuldigteTreffer(quelle).keys()];
gleich(unerwartetBezeichner.join(", "), "",
	"unerwartete Bezeichner mit 'Anzeige'/'angezeigt'/'Markier' im kommentarfreien Code -- "
	+ "die Ausnahmeliste im Test nennt sie nicht, die Umbenennung ist unvollstaendig");

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
// 3 (NEU, Fixrunde 1, Loch C). Sichtbare Zeichenketten -- kein Literal in
//    js/review/review-garetien-importer.js ODER im Garetien-Teil von index.html darf
//    "Anzeige"/"angezeigt"/"markier" tragen, ausser den sieben namentlich begruendeten Ausnahmen
//    oben. Anders als die feste Sechserliste aus der ersten Fassung (die nur pruefte, woran der
//    Autor beim Schreiben des Auftrags dachte) ist das eine VOLLSTAENDIGKEITS-Regel wie Regel 1 --
//    nur ueber ZWEI Dateien statt einer, weil Regel 1 index.html nie sieht (index.html traegt die
//    STARTBESCHRIFTUNG mancher Knoepfe woertlich, JS baut sie erst beim ersten Neuzeichnen um --
//    genau das hat „Auswahl zurücknehmen (0 von 0)“ betroffen, bis es hier gefunden wurde).
// =================================================================================================
const unerwartetJs = [...sammleUnentschuldigteTreffer(quelle).keys()];
gleich(unerwartetJs.join(", "), "",
	"sichtbare Zeichenkette mit 'Anzeige'/'angezeigt'/'Markier' in review-garetien-importer.js -- "
	+ "ausserhalb der sieben begruendeten Ausnahmen");
const unerwartetHtml = [...sammleUnentschuldigteTreffer(garetienHtmlTeil).keys()];
gleich(unerwartetHtml.join(", "), "",
	"sichtbare Zeichenkette mit 'Anzeige'/'angezeigt'/'Markier' im Garetien-Teil von index.html -- "
	+ "ausserhalb der sieben begruendeten Ausnahmen");

// =================================================================================================
// 4. zustand.stage und zustand.auswahl kommen vor; zustand.anzeige und zustand.markiert nicht.
// =================================================================================================
//
// ⚠️ Regel 1 (jetzt gross-/kleinschreibungsUNempfindlich) faengt diese zwei Faelle laengst mit auf
// -- diese Zusicherung bleibt trotzdem stehen, weil sie den EINEN Modulzustand namentlich nennt,
// an dem eine Rueckkehr des alten Vokabulars am teuersten waere.
wahr(/\bzustand\.stage\b/.test(quelle), "zustand.stage muss vorkommen");
wahr(/\bzustand\.auswahl\b/.test(quelle), "zustand.auswahl muss vorkommen");
wahr(!/\bzustand\.anzeige\b/i.test(quelle), "zustand.anzeige darf nicht mehr vorkommen");
wahr(!/\bzustand\.markiert\b/i.test(quelle), "zustand.markiert darf nicht mehr vorkommen");

// =================================================================================================
// 5. Die Kennungen bleiben -- dieselbe Trennung wie bei „Neuigkeiten"/`changelog` (AGENTS.md §11):
// eine umgetaufte Kennung liesse eine gecachte Seite ins Leere greifen.
//
// 🔴 Der Plan sicherte zu, `garetien-mark-show` sei WEG -- das war ein Planfehler und ist mit dem
// Brief zurueckgenommen: die alten Fussknoepfe fallen in Aufgabe 9, nicht hier.
// =================================================================================================
["garetien-mark-all", "garetien-mark-none", "garetien-mark-show"].forEach((id) => {
	wahr(html.includes('id="' + id + '"'), "die Kennung " + id + " muss weiterhin im Markup stehen");
});

// =================================================================================================
// 6. AVESMAPS_GARETIEN_SERVER_STAENDE enthaelt "stage" nicht -- der Reiter ist rein clientseitig,
// der Server kennt den Wert nicht.
// =================================================================================================
const staendeZeile = /const AVESMAPS_GARETIEN_SERVER_STAENDE = (\[[^\]]*\]);/.exec(quelle);
wahr(!!staendeZeile, "AVESMAPS_GARETIEN_SERVER_STAENDE muss im Quelltext auffindbar sein");
const staende = JSON.parse(staendeZeile[1].replace(/'/g, '"'));
wahr(!staende.includes("stage"), "AVESMAPS_GARETIEN_SERVER_STAENDE darf 'stage' nicht enthalten");

console.log(`garetien-vokabular: ${checks} Pruefungen bestanden.`);

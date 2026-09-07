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
// 🔴 FIXRUNDE 2 (06.09.2026) schliesst das Loch, das Fixrunde 1 selbst gerissen hat, und weitet
// das Sichtfeld:
//   C2. Die Amnestie galt der ganzen ZEILE (istEntschuldigt(zeile) -- ein indexOf irgendwo auf der
//       Zeile). Bei einem Knopf stehen Kennung und Beschriftung IMMER auf derselben Zeile, also
//       entschuldigte die Kennung die Beschriftung gleich mit: aus der Wortklassen-Amnestie von
//       Loch B war eine ZEILEN-Amnestie geworden, und genau die Regression, gegen die Fixrunde 1
//       gebaut wurde (">Markierte zurücknehmen (0 von 0)<" neben
//       'id="garetien-ruecknahme-markierte"'), kam wieder durch. Jetzt ist die Amnestie an die
//       TREFFERSTELLE gebunden: entschuldigt ist nur, wer INNERHALB eines Vorkommens des
//       Ausnahmekontextes liegt. Daher der achte Eintrag "gi-anzeigehinweis" -- die CSS-Klasse
//       ritt bisher auf der Zeile ihrer DOM-Kennung mit.
//   I1. Regel 3 baute ihre JS-Haelfte aus DERSELBEN Funktion mit DEMSELBEN Argument wie Regel 1,
//       und Regel 1 laeuft zuerst und wirft -- die JS-Haelfte konnte nie eigenstaendig rot werden.
//       Sie ist gefallen; die HTML-Haelfte traegt echte Deckung und bleibt.
//   I2. Das Scanfenster war zu eng: der OEFFNER-Knopf des Fensters (#garetien-importer-open) liegt
//       in index.html rund 3.700 Zeilen VOR dem Fenster und war damit ungedeckt -- sein title trug
//       bis 449be6941 woertlich "Angehakte übernehmen". Und js/review/review-garetien-karte.js
//       gehoert zum selben Fenster und wurde gar nicht gescannt. Beide sind jetzt drin.
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
function liesKommentarfrei(relPfad) {
	return lies(relPfad)
		.replace(/\r\n/g, "\n")
		.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}
const quelle = liesKommentarfrei("js/review/review-garetien-importer.js");
// 🔴 ZWEITE JS-QUELLE (Fixrunde 2, I2): review-garetien-karte.js ist die Kartenhaelfte DESSELBEN
// Fensters (Import-Ueberlagerung, Zentrieren, Klickziele) und wurde nie gescannt. Sie traegt heute
// KEINEN einzigen Treffer im kommentarfreien Code -- der Nutzen ist also rein vorbeugend, und
// genau deshalb gehoert sie hierher: ein Waechter, der die zweite Haelfte seines Gegenstands nicht
// sieht, faengt die naechste Umbenennung nur zur Haelfte.
const karteQuelle = liesKommentarfrei("js/review/review-garetien-karte.js");
// ⚠️ css/components/garetien-importer.css bleibt BEWUSST draussen -- dort sind es KLASSENnamen, und
// die wandern nach derselben Regel wie die DOM-Kennungen ausdruecklich NICHT mit. Das ist keine
// Vergessenheit: die Klasse gi-anzeigehinweis steht sogar als Ausnahme unten drin.
const karteQuelleUmfang = karteQuelle.length;
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

// 🔴 ZWEI GETRENNTE BEREICHE, kein durchgehender Schnitt (Fixrunde 2, I2). Der Oeffner-Knopf des
// Fensters steht in der WikiSync-Leiste ganz oben, das Fenster selbst rund 3.700 Zeilen weiter
// unten. Ihn per html.slice(oeffner, sheet) einzuschliessen zoege 221.727 Zeichen FREMDES Markup
// mit herein -- Lore-Leiste, das Anzeige-Menue der Karte, die sechs Ortsklassen-Schalter, den
// Hinweise-Dialog --, und die reden alle voellig legitim von "anzeigen" und "markieren" (gemessen
// 06.09.2026: 10 verschiedene Tokens, Dutzende Vorkommen). Der Waechter waere dauerhaft rot oder
// braeuchte zwei Dutzend Ausnahmen fuer FREMDE Merkmale -- also genau die Amnestie-Inflation, die
// C2 gerade beseitigt hat. Stattdessen wird der Oeffner als EIGENES, winziges Stueck angehaengt.
const oeffnerStart = html.indexOf('<button id="garetien-importer-open"');
wahr(oeffnerStart !== -1, "der Oeffner-Knopf des Garetien-Fensters muss in index.html stehen");
const oeffnerEnde = html.indexOf("</button>", oeffnerStart) + "</button>".length;
const oeffnerTeil = html.slice(oeffnerStart, oeffnerEnde);
wahr(oeffnerTeil.indexOf("Garetien Importer") !== -1,
	"der ausgeschnittene Oeffner muss wirklich der Garetien-Knopf sein");

// Das Markup DIESES Fensters -- Oeffner plus Fenster, sonst nichts. Regel 2, 3 und 5 messen daran.
const garetienHtmlTeil = oeffnerTeil + "\n" + html.slice(garetienHtmlStart, garetienHtmlEnde);

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
	// Der ANFANG reist mit: ohne ihn kann der Aufrufer die Trefferstelle nicht in
	// Zeilenkoordinaten umrechnen -- und ohne die gaebe es nur wieder eine Zeilen-Amnestie (C2).
	return { zeile: text.slice(start, ende), start: start };
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
		kontext: "gi-anzeigehinweis",
		grund: "CSS-KLASSE des Hinweisabsatzes -- Klassennamen wandern nach derselben Regel wie die "
			+ "DOM-Kennungen ausdruecklich NICHT mit, und das Blatt ist deshalb gar nicht erst "
			+ "Quelle dieses Tests. 🔴 Bis Fixrunde 2 brauchte sie KEINEN Eintrag: sie steht auf "
			+ "derselben Zeile wie `garetien-anzeige-hinweis` und ritt auf dessen Zeilen-Amnestie "
			+ "mit -- genau das Loch, das C2 geschlossen hat.",
	},
	{
		kontext: "garetien-anzeige-clear",
		grund: "DOM-Kennung des Knopfes „Stage leeren“ -- dieselbe Regel-5-Begruendung; sein "
			+ "sichtbares Label wurde laengst umbenannt, seine Kennung bewusst nicht.",
	},
	// 🔴 FIXRUNDE 1 (D2, 07.09.2026): die Ausnahme fuer `garetien-ruecknahme-markierte` ist GEFALLEN.
	// Der Knopf steht seither in der Auswahlleiste, die ihre Knoepfe zur Laufzeit baut -- die Kennung
	// gibt es nirgends mehr, und eine tote Amnestie entschuldigte beim naechsten Mal ein echtes
	// „markierte", das jemand zurueckschmuggelt.
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

// 💣 DIE AMNESTIE GILT DER TREFFERSTELLE, NIE DER ZEILE (Fixrunde 2, C2). Fixrunde 1 fragte
// `zeile.indexOf(kontext) !== -1` -- steht der Kontext IRGENDWO auf der Zeile, ist die GANZE Zeile
// entschuldigt. Bei einem Knopf stehen Kennung und Beschriftung immer beisammen
// (`id="garetien-ruecknahme-markierte" ... >Markierte zurücknehmen<`), also deckte die Kennung die
// zurueckgeschmuggelte Beschriftung gleich mit ab -- die Wortklassen-Amnestie von Loch B war zur
// Zeilen-Amnestie geworden. Entschuldigt ist deshalb nur ein Treffer, der VOLLSTAENDIG INNERHALB
// eines Vorkommens des Kontextes liegt.
// 💣 Und es werden ALLE Vorkommen durchlaufen, nicht nur das erste: derselbe Kontext steht auf
// manchen Zeilen zweimal (die Kennung und ihr `-hint`-Pendant), und ein `indexOf` ohne Schleife
// entschuldigte dann nur den ersten der beiden Treffer.
function istEntschuldigt(zeile, relIndex, wortLaenge) {
	const trefferEnde = relIndex + wortLaenge;
	return AUSNAHMEN_KONTEXTE.some(function (a) {
		let von = zeile.indexOf(a.kontext);
		while (von !== -1) {
			if (relIndex >= von && trefferEnde <= von + a.kontext.length) { return true; }
			von = zeile.indexOf(a.kontext, von + 1);
		}
		return false;
	});
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
		const zeilenInfo = zeileBeiIndex(text, m.index);
		if (istEntschuldigt(zeilenInfo.zeile, m.index - zeilenInfo.start, wort.length)) { continue; }
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
	"unerwartete Bezeichner mit 'Anzeige'/'angezeigt'/'Markier' im kommentarfreien Code von "
	+ "review-garetien-importer.js -- die Ausnahmeliste im Test nennt sie nicht, die Umbenennung "
	+ "ist unvollstaendig");

// Dieselbe Regel fuer die Kartenhaelfte des Fensters (Fixrunde 2, I2). Sie ist heute leer, und das
// ist der Punkt: sie war es nur, weil niemand hingesehen hat.
wahr(karteQuelleUmfang > 10000,
	"review-garetien-karte.js muss wirklich gelesen worden sein (sonst deckt diese Regel nichts "
	+ "ab und niemand merkt es) -- gelesen: " + karteQuelleUmfang + " Zeichen");
const unerwartetKarte = [...sammleUnentschuldigteTreffer(karteQuelle).keys()];
gleich(unerwartetKarte.join(", "), "",
	"unerwartete Bezeichner mit 'Anzeige'/'angezeigt'/'Markier' im kommentarfreien Code von "
	+ "review-garetien-karte.js -- der Kartenhaelfte desselben Fensters");

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
	wahr(!karteQuelle.includes(alt),
		"alte Beschriftung „" + alt + "\" darf nicht mehr in review-garetien-karte.js stehen");
	// 🔴 GEGEN DEN GARETIEN-TEIL, nicht gegen ganz index.html (Fixrunde 2, Minor 5). „Alle
	// markieren" ist keine Garetien-Eigenheit -- ein FREMDES Merkmal mit derselben Beschriftung
	// faerbte diesen Test rot, und er saehe aus wie eine Garetien-Regression. Regel 3 misst laengst
	// so; hier war es der letzte Rest der ersten Fassung.
	// ⚠️ Der Oeffner-Knopf ist Teil dieses Bereichs -- genau dort stand bis 449be6941 die
	// Beschriftung „Angehakte übernehmen" im `title`, also verloere eine Begrenzung OHNE ihn die
	// eine Deckung, die diese Regel hier je wirklich erbracht hat.
	wahr(!garetienHtmlTeil.includes(alt),
		"alte Beschriftung „" + alt + "\" darf nicht mehr im Markup des Garetien-Fensters stehen");
});

// =================================================================================================
// 3 (NEU, Fixrunde 1, Loch C). Sichtbare Zeichenketten -- kein Literal in
//    js/review/review-garetien-importer.js ODER im Garetien-Teil von index.html darf
//    "Anzeige"/"angezeigt"/"markier" tragen, ausser den acht namentlich begruendeten Ausnahmen
//    oben. Anders als die feste Sechserliste aus der ersten Fassung (die nur pruefte, woran der
//    Autor beim Schreiben des Auftrags dachte) ist das eine VOLLSTAENDIGKEITS-Regel wie Regel 1 --
//    nur ueber ZWEI Dateien statt einer, weil Regel 1 index.html nie sieht (index.html traegt die
//    STARTBESCHRIFTUNG mancher Knoepfe woertlich, JS baut sie erst beim ersten Neuzeichnen um --
//    genau das hat „Auswahl zurücknehmen (0 von 0)“ betroffen, bis es hier gefunden wurde).
// =================================================================================================
// 🔴 NUR NOCH DIE HTML-HAELFTE (Fixrunde 2, I1). Hier stand daneben eine JS-Haelfte
// (`sammleUnentschuldigteTreffer(quelle)`) -- zeichengleich mit Regel 1, DIESELBE Funktion mit
// DEMSELBEN Argument. Regel 1 laeuft zuerst und wirft, also konnte diese Zeile nie eigenstaendig
// rot werden: eine Zusicherung, die nur mit einer anderen zusammen faellt, ist keine. Die
// HTML-Haelfte traegt dagegen echte Deckung -- Regel 1 sieht index.html nie.
const unerwartetHtml = [...sammleUnentschuldigteTreffer(garetienHtmlTeil).keys()];
gleich(unerwartetHtml.join(", "), "",
	"sichtbare Zeichenkette mit 'Anzeige'/'angezeigt'/'Markier' im Markup des Garetien-Fensters "
	+ "(Oeffner und Fenster) -- ausserhalb der acht begruendeten Ausnahmen");

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
// 🔴 FIXRUNDE 1 (D2, 07.09.2026): DREI DIESER KENNUNGEN SIND JETZT WIRKLICH WEG.
// `garetien-mark-none`, `garetien-mark-show` und `garetien-ruecknahme-markierte` haben den Fuss
// verlassen; ihre Handlungen stehen in der AUSWAHLLEISTE, die ihre Knoepfe zur Laufzeit baut und
// gar keine Kennungen vergibt (`data-auswahl` statt `id`). Der Plan hatte ihren Wegfall schon fuer
// Aufgabe 9 vorgesehen -- er kam eine Fixrunde spaeter.
// ⚠️ Geblieben ist `garetien-mark-all`: die Leiste erscheint erst, wenn schon etwas gewaehlt ist,
// und kann den Knopf, der die ERSTE Auswahl macht, deshalb nicht tragen.
// =================================================================================================
["garetien-mark-all"].forEach((id) => {
	wahr(garetienHtmlTeil.includes('id="' + id + '"'),
		"die Kennung " + id + " muss weiterhin im Markup des Garetien-Fensters stehen");
});
["garetien-mark-none", "garetien-mark-show", "garetien-ruecknahme-markierte"].forEach((id) => {
	wahr(!garetienHtmlTeil.includes('id="' + id + '"'),
		"die Kennung " + id + " ist mit dem Umzug in die Auswahlleiste gefallen");
});

// 🔴 UND DER FUSS TRAEGT GENAU VIER KNOEPFE, in dieser Reihenfolge (Fixrunde 1, D2): was der
// GANZEN STAGE gilt. Ihre Beschriftungen sind hier festgenagelt -- vor der Fixrunde liess sich
// jeder Fussknopftext umbenennen, ohne dass irgendein Test rot wurde.
// ⚠️ Gemessen wird der `.gi-foot`-Block, nicht die ganze Datei: „Stage leeren" steht auch in
// Kommentaren, und ein `includes` ueber das ganze Markup traefe die.
{
	const fussStart = garetienHtmlTeil.indexOf('<div class="gi-foot');
	wahr(fussStart !== -1, "der Fuss des Fensters muss auffindbar sein");
	const fuss = garetienHtmlTeil.slice(fussStart, garetienHtmlTeil.indexOf("</div>", garetienHtmlTeil.indexOf("gi-foot__main")));
	const knopfTexte = [];
	const muster = /<button[^>]*>([^<]*)<\/button>/g;
	let treffer = muster.exec(fuss);
	while (treffer) { knopfTexte.push(treffer[1].trim()); treffer = muster.exec(fuss); }
	assert.deepStrictEqual(knopfTexte,
		["Alle wählen", "Stage leeren", "Alle zentrieren", "Stage importieren (0)"],
		"der Fuss traegt genau die vier Knoepfe der GANZEN STAGE, in dieser Reihenfolge");
	checks++;
}

// =================================================================================================
// 6. AVESMAPS_GARETIEN_SERVER_STAENDE enthaelt "stage" nicht -- der Reiter ist rein clientseitig,
// der Server kennt den Wert nicht.
// =================================================================================================
const staendeZeile = /const AVESMAPS_GARETIEN_SERVER_STAENDE = (\[[^\]]*\]);/.exec(quelle);
wahr(!!staendeZeile, "AVESMAPS_GARETIEN_SERVER_STAENDE muss im Quelltext auffindbar sein");
const staende = JSON.parse(staendeZeile[1].replace(/'/g, '"'));
wahr(!staende.includes("stage"), "AVESMAPS_GARETIEN_SERVER_STAENDE darf 'stage' nicht enthalten");

console.log(`garetien-vokabular: ${checks} Pruefungen bestanden.`);

/**
 * Der Kartenausschnitt für den Social-Media-Hub — die Entscheidungen hinter Rahmen und Aufnahme.
 *
 * 🔴 Die tragende Zusicherung steht in Teil 5: DIE BESCHRIFTUNGEN SIND IM BILD. Das ist der
 * Owner-Entscheid vom 26.08.2026 („aufziehbarer rahmen, mit beschriftungen") und zugleich der
 * einzige Unterschied zu tools/layer-tiles/capture.js, das für seine Icons genau umgekehrt eine
 * Allowlist ohne Beschriftungen führt. Wer hier auf eine Allowlist umbaut, verliert die Namen —
 * und zwar lautlos, weil ein Bild ohne Ortsnamen wie ein Bild aussieht.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const abzug = require(path.join(__dirname, "..", "karten-abzug.js"));

let fehler = 0;
function pruefe(bedingung, name) {
	if (bedingung) return;
	fehler++;
	console.error("FEHLER: " + name);
}

// ⚠️ Zeilenendenneutral und OHNE Kommentare: die Arbeitskopie trägt CRLF, das Deploy-Tor LF
// (AGENTS.md §9), und ein Quelltexttest, der Kommentare mitliest, schlägt an der Warnung an, die
// vor dem Muster warnt — der nächste Leser löscht dann den Kommentar statt den Fehler.
function lies(datei) {
	return fs.readFileSync(path.join(wurzel, datei), "utf8").replace(/\r\n/g, "\n");
}
function ohneKommentare(text) {
	return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
		.replace(/<!--[\s\S]*?-->/g, "");
}

// ---- 1. Das Rechteck entsteht in jede Zugrichtung ---------------------------------------------
// 💣 Ohne Normalisierung liefert ein Zug nach links oben negative Breiten, und jede Prüfung danach
// rechnet mit Unsinn weiter — `istGrossGenug` sagt dann „zu klein" bei einem großen Rahmen.
{
	const runter = abzug.normalisiereRechteck(10, 20, 110, 220);
	pruefe(runter.x === 10 && runter.y === 20, "Zug nach rechts unten: Ursprung ist die Startecke");
	pruefe(runter.breite === 100 && runter.hoehe === 200, "Zug nach rechts unten: Maße");

	const hoch = abzug.normalisiereRechteck(110, 220, 10, 20);
	pruefe(hoch.x === 10 && hoch.y === 20, "Zug nach links oben: Ursprung wandert mit");
	pruefe(hoch.breite === 100 && hoch.hoehe === 200, "Zug nach links oben: gleiche Maße, positiv");

	const quer = abzug.normalisiereRechteck(110, 20, 10, 220);
	pruefe(quer.x === 10 && quer.y === 20 && quer.breite === 100 && quer.hoehe === 200,
		"Zug über Eck: ebenfalls positiv");
}

// ---- 2. Der Rahmen bleibt auf der Karte -------------------------------------------------------
// 💣 Er wird GEKAPPT, nicht verschoben: was außerhalb liegt, ist nicht gemalt und käme als
// Hintergrundfarbe ins Bild — ein grauer Streifen am Rand, den niemand bestellt hat.
{
	const raus = abzug.klemmeAufFlaeche({ x: 900, y: 500, breite: 300, hoehe: 300 }, 1000, 600);
	pruefe(raus.x === 900 && raus.y === 500, "Klemmen verschiebt den Ursprung nicht");
	pruefe(raus.breite === 100 && raus.hoehe === 100, "Klemmen kappt auf den Kartenrand");

	const negativ = abzug.klemmeAufFlaeche({ x: -50, y: -50, breite: 200, hoehe: 200 }, 1000, 600);
	pruefe(negativ.x === 0 && negativ.y === 0, "Negativer Ursprung landet auf 0");

	const drin = abzug.klemmeAufFlaeche({ x: 10, y: 10, breite: 100, hoehe: 100 }, 1000, 600);
	pruefe(drin.breite === 100 && drin.hoehe === 100, "Ein Rahmen mittendrin bleibt unangetastet");
}

// ---- 3. Ein Klick ist kein Rahmen -------------------------------------------------------------
{
	pruefe(abzug.istGrossGenug({ breite: 200, hoehe: 200 }) === true, "200 × 200 genügt");
	pruefe(abzug.istGrossGenug({ breite: 2, hoehe: 2 }) === false, "Ein Fehlgriff genügt nicht");
	pruefe(abzug.istGrossGenug({ breite: 400, hoehe: 10 }) === false,
		"Ein breiter Strich genügt nicht — BEIDE Kanten zählen");
	pruefe(abzug.istGrossGenug(null) === false, "Kein Rechteck genügt nicht");
	pruefe(abzug.istGrossGenug({ breite: abzug.MINDESTKANTE, hoehe: abzug.MINDESTKANTE }) === true,
		"Genau die Mindestkante genügt noch");
}

// ---- 4. Die Bildmaße --------------------------------------------------------------------------
// 💣 Der Deckel ist tragend: ein großer Ausschnitt auf einem 4K-Schirm mit doppelter Punktdichte
// wäre 7680 px breit und über dem Flächenlimit mancher Browser-Leinwände.
{
	const einfach = abzug.abzugMasse({ breite: 400, hoehe: 300 }, 1, 2048);
	pruefe(einfach.breite === 400 && einfach.hoehe === 300, "Einfache Punktdichte: 1:1");

	const doppelt = abzug.abzugMasse({ breite: 400, hoehe: 300 }, 2, 2048);
	pruefe(doppelt.breite === 800 && doppelt.hoehe === 600,
		"Doppelte Punktdichte hebt das Bild mit an");

	const dreifach = abzug.abzugMasse({ breite: 400, hoehe: 300 }, 3, 2048);
	pruefe(dreifach.breite === 800, "Ein 3x-Schirm wird auf den Hausdeckel 2 begrenzt");

	const riesig = abzug.abzugMasse({ breite: 3000, hoehe: 1500 }, 2, 2048);
	pruefe(riesig.breite === 2048, "Der Breitendeckel greift");
	pruefe(riesig.hoehe === 1024, "Und das Seitenverhältnis überlebt ihn");

	const winzig = abzug.abzugMasse({ breite: 0.2, hoehe: 0.2 }, 1, 2048);
	pruefe(winzig.breite >= 1 && winzig.hoehe >= 1, "Nie 0 px — eine Leinwand mit 0 wirft");
}

// ---- 5. 🔴 Die Beschriftungen sind im Bild ----------------------------------------------------
// Der Owner-Entscheid vom 26.08.2026. Diese Zusicherung ist der Grund, warum hier eine DENYLIST
// steht und nicht die Allowlist aus tools/layer-tiles/capture.js.
{
	const INS_BILD = ["leaflet-labels-pane", "leaflet-regionLabels-pane", "leaflet-tile-pane",
		"leaflet-locationCanvas-pane", "leaflet-locations-pane", "leaflet-regions-pane",
		"leaflet-roads-pane", "leaflet-powerlines-pane", "leaflet-route-pane",
		"leaflet-mapDecorations-pane", "leaflet-ecosystem-pane"];
	INS_BILD.forEach(function (pane) {
		pruefe(abzug.paneGehoertInsBild(pane) === true, "Gehört ins Bild: " + pane);
	});

	// Bedienung dieses einen Editors, nicht Inhalt der Karte.
	const DRAUSSEN = ["leaflet-popup-pane", "leaflet-tooltip-pane", "leaflet-sharePin-pane",
		"leaflet-regionHover-pane", "leaflet-measurement-pane", "leaflet-measurementHandles-pane"];
	DRAUSSEN.forEach(function (pane) {
		pruefe(abzug.paneGehoertInsBild(pane) === false, "Bleibt draußen: " + pane);
	});

	// 🪤 UND DIE FALLE, IN DIE DIESER TEST BEIM SCHREIBEN FAST GELAUFEN WÄRE: eine Liste erfundener
	// Pane-Namen ist grün und prüft NICHTS — „gehört ins Bild" über einen Namen, den es gar nicht
	// gibt, ist immer wahr, weil die Denylist ihn nicht kennt. Genau das ist die Lehre aus den
	// 19 CSS-Regeln, die nach einer Umbenennung auf nichts mehr passten. Deshalb werden die Namen
	// oben gegen die WIRKLICHKEIT gehalten: gegen die `createPane`-Aufrufe des Projekts.
	// Leaflets Regel: createPane("labelsPane") erzeugt die Klasse `leaflet-labels-pane`.
	// ⚠️ Leaflets EIGENE Panes (tile, popup, tooltip, marker, overlay, shadow, map) stehen nicht in
	// unserem Code, sondern in der Bibliothek — und drei davon trägt die Denylist. Sie hier von Hand
	// hinzuschreiben hiesse, genau die Phantom-Liste anzulegen, die dieser Block verhindern soll;
	// die Bibliothek benutzt dasselbe `createPane("…")` und wird deshalb einfach mitgelesen.
	const echteNamen = new Set();
	["js/app/bootstrap.js", "js/third-party/leaflet.js"].concat(
		fs.readdirSync(path.join(wurzel, "js", "map-features"))
			.filter(function (n) { return n.endsWith(".js"); })
			.map(function (n) { return "js/map-features/" + n; })
	).forEach(function (datei) {
		let text;
		try { text = lies(datei); } catch (fehler) { return; }
		(text.match(/createPane\(\s*["'][A-Za-z]+["']/g) || []).forEach(function (treffer) {
			const roh = treffer.replace(/.*["']([A-Za-z]+)["']/, "$1");
			echteNamen.add("leaflet-" + roh.replace(/Pane$/, "") + "-pane");
		});
	});
	pruefe(echteNamen.size > 10, "Die Pane-Namen des Projekts wurden gefunden (" + echteNamen.size + ")");
	INS_BILD.concat(DRAUSSEN).forEach(function (pane) {
		pruefe(echteNamen.has(pane), "Diese Pane gibt es wirklich: " + pane);
	});

	// 💣 Der Behälter aller Panes. Ohne ihn in der Denylist wird jede Ebene ein zweites Mal gemalt —
	// bei halbdurchsichtigen Flächen sieht man das sofort, bei deckenden nie.
	pruefe(abzug.paneGehoertInsBild("leaflet-pane leaflet-map-pane") === false,
		"Die Sammel-Pane bleibt draußen");

	// Leaflet schreibt mehrere Klassen an eine Pane — geprüft wird der ganze Klassenname.
	pruefe(abzug.paneGehoertInsBild("leaflet-pane leaflet-popup-pane") === false,
		"Auch mit vorangestellter Grundklasse erkannt");
	pruefe(abzug.paneGehoertInsBild("leaflet-pane leaflet-labels-pane") === true,
		"… und die Beschriftungen ebenso");
}

// ---- 6. Fremde Bildherkunft vergiftet die Leinwand --------------------------------------------
// 💣 Der Fehler kommt erst ganz am Ende, beim `toBlob` — wenn alles gemalt ist. Ein durchgelassenes
// fremdes Bild kostet also nicht das Bild, sondern die ganze Aufnahme.
{
	const heim = "https://avesmaps.de/index.html";
	pruefe(abzug.quelleIstEigen("data:image/png;base64,AAAA", heim) === true,
		"Ein data:-Bild ist immer unbedenklich");
	pruefe(abzug.quelleIstEigen("https://avesmaps.de/uploads/wappen/x.png", heim) === true,
		"Ein Wappen von uns ist eigen");
	pruefe(abzug.quelleIstEigen("/tiles/5/map_1_-1.webp", heim) === true,
		"Eine relative Kachel ist eigen");
	pruefe(abzug.quelleIstEigen("https://wiki-aventurica.de/bild.png", heim) === false,
		"Ein Wiki-Bild ist fremd");
	pruefe(abzug.quelleIstEigen("", heim) === false, "Ein leeres src gilt als fremd");
	pruefe(abzug.quelleIstEigen("nicht::eine::url", "auch keine url") === false,
		"Unlesbares fällt auf die sichere Seite");
}

// ---- 7. Was beim Ziehen unter dem Rahmen steht ------------------------------------------------
{
	pruefe(abzug.verhaeltnisPasst({ breite: 1000, hoehe: 1000 }) === true, "Quadrat passt");
	pruefe(abzug.verhaeltnisPasst({ breite: 800, hoehe: 1000 }) === true, "4:5 passt gerade noch");
	pruefe(abzug.verhaeltnisPasst({ breite: 700, hoehe: 1000 }) === false, "Hochkant fällt heraus");
	pruefe(abzug.verhaeltnisPasst({ breite: 2000, hoehe: 1000 }) === false, "Panorama fällt heraus");
	pruefe(abzug.verhaeltnisPasst({ breite: 100, hoehe: 0 }) === false, "Keine Division durch 0");

	// 💣 Die Zeile nennt die Maße des BILDES, nicht die des Rahmens: bei doppelter Punktdichte sind
	// das verschiedene Zahlen, und die interessante ist die, die hochgeladen wird.
	pruefe(abzug.masszeile({ breite: 400, hoehe: 300 }, 2).indexOf("800 × 600") === 0,
		"Die Maßzeile nennt die Bildmaße");
	pruefe(abzug.masszeile({ breite: 400, hoehe: 300 }, 2).indexOf("zugeschnitten") === -1,
		"4:3 passt und wird nicht als Zuschnitt angekündigt");
	pruefe(abzug.masszeile({ breite: 300, hoehe: 900 }, 1).indexOf("zugeschnitten") > 0,
		"Ein schmaler Hochkantrahmen kündigt den Zuschnitt an");
	pruefe(abzug.masszeile({ breite: 5, hoehe: 5 }, 1).indexOf("px") === -1,
		"Unter der Mindestkante steht keine Maßangabe, sondern die Aufforderung");
}

// ---- 8. Die Verdrahtung -----------------------------------------------------------------------
// ⚠️ „Die Datei ist eingebunden" ist erfüllt, auch wenn niemand sie ruft — deshalb wird BEIDES
// geprüft: die Ladereihenfolge UND der Aufruf.
{
	const index = ohneKommentare(lies("index.html"));
	const abzugTag = index.indexOf("js/ui/karten-abzug.js");
	const socialTag = index.indexOf("js/review/review-social.js");
	pruefe(abzugTag > 0, "index.html lädt js/ui/karten-abzug.js");
	pruefe(socialTag > 0 && abzugTag < socialTag,
		"… und zwar VOR review-social.js, das es benutzt");

	// 🔴 Der Knopf ist nicht mehr abgeschaltet. Bis 26.08.2026 stand er mit `disabled` und dem Titel
	// „Kommt spaeter" da — der Anlass dieser ganzen Arbeit.
	const knopf = index.match(/<button[^>]*id="social-map-shot"[^>]*>/);
	pruefe(!!knopf, "Der Knopf trägt die ID social-map-shot");
	pruefe(!!knopf && knopf[0].indexOf("disabled") === -1,
		"🔴 Der Knopf „Kartenausschnitt\" ist NICHT mehr abgeschaltet");

	// Das Video bleibt abgeschaltet — es ist laut Entwurf §11 Stufe 3, und dieser Umbau rührt es
	// nicht an. Ohne diese Zeile fiele es niemandem auf, wenn es versehentlich mit freigeschaltet
	// würde: ein Knopf, der nichts tut, sieht aus wie ein Knopf.
	const video = index.match(/<button[^>]*>[^<]*Video[^<]*<\/button>/);
	pruefe(!!video && video[0].indexOf("disabled") >= 0, "Das Video bleibt abgeschaltet");

	const social = ohneKommentare(lies("js/review/review-social.js"));
	pruefe(social.indexOf("avesmapsKartenAbzug") > 0,
		"review-social.js ruft das Bauteil wirklich auf");
	pruefe(social.indexOf("rahmenWaehlen") > 0 && social.indexOf("aufnehmen") > 0,
		"… und zwar beide Hälften: Rahmen wählen und aufnehmen");

	// 💣 Der Hub muss sich für das Ziehen WEGBLENDEN, nicht schließen: `closeHub`/`openHub` setzen
	// das Formular zurück, und ein halb geschriebener Beitrag wäre nach der Aufnahme weg.
	pruefe(social.indexOf("closeHub()") === -1 || social.indexOf("hidden = true") > 0,
		"Der Hub wird für die Aufnahme weggeblendet, nicht geschlossen");

	const css = lies("css/components/social-hub.css") + lies("css/components/karten-abzug.css");
	pruefe(css.indexOf(".kartenabzug-schicht") > 0, "Die Ziehschicht hat einen Stil");
	pruefe(css.indexOf(".kartenabzug-rahmen") > 0, "Der Rahmen hat einen Stil");

	// 🔴 AGENTS.md §12: keine hartkodierte Farbe, immer ein Token. Geprüft wird der Stil DIESES
	// Bauteils — ein `#rrggbb` darin wäre genau die Divergenz, die die Regel verhindert.
	const eigen = lies("css/components/karten-abzug.css");
	const hexe = (ohneKommentare(eigen).match(/#[0-9a-fA-F]{3,8}\b/g) || []);
	pruefe(hexe.length === 0, "Keine hartkodierte Farbe im Stil des Bauteils: " + hexe.join(" "));
}

if (fehler > 0) {
	console.error(fehler + " Fehler");
	process.exit(1);
}
console.log("karten-abzug: alle Prüfungen bestanden");

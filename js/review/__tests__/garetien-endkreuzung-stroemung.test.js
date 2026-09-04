"use strict";

/*
 * ENDKREUZUNGEN UND STRÖMUNGSRICHTUNG beim Garetien-Import
 * ========================================================
 * Owner 02.09.2026: „bau bei wegen / flüssen ein häkchen (standard: an) ein, dass an dessen anfang
 * und ende je eine neue kreuzung platziert. gleichzeitig solltest du die strömungsrichtung bei
 * flüssen festlegen … wobei der editor die richtung korrigieren können sollte. lass den editor das
 * entscheiden und die richtung anzeigen (dreieckchen in der farbe des import-flusses)."
 *
 * Die Serverhälfte (die Kreuzungen liegen exakt auf den Endpunkten, `properties.flow`) steht in
 * api/_internal/import/__tests__/garetien-uebernahme-test.php. Hier: die zwei Bedienelemente und
 * die Dreiecke.
 */

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };
global.document = global.document || {
	documentElement: { classList: { add() {} } },
	getElementById() { return null; },
	createElement() { return { style: {}, classList: { add() {} }, setAttribute() {} }; },
};

const WURZEL = path.resolve(__dirname, "..", "..", "..");
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/map-features-line-catmull.js"), "utf8"),
	{ filename: "map-features-line-catmull.js" }
);
vm.runInThisContext(fs.readFileSync(path.join(WURZEL, "js/config.js"), "utf8"),
	{ filename: "config.js" });
vm.runInThisContext(
	fs.readFileSync(path.join(WURZEL, "js/map-features/map-features-path-domain.js"), "utf8"),
	{ filename: "map-features-path-domain.js" }
);
global.AVESMAPS_LABEL_ART_NAMEN =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).AVESMAPS_LABEL_ART_NAMEN;
global.avesmapsLabelArtName =
	require(path.resolve(WURZEL, "js/ui/label-arten.js")).avesmapsLabelArtName;

const fenster = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const karte = require(path.resolve(__dirname, "..", "review-garetien-karte.js"));

let checks = 0;
function wahr(b, warum) { assert.ok(b, warum); checks++; }
function gleich(ist, soll, warum) { assert.strictEqual(ist, soll, warum); checks++; }
function tief(ist, soll, warum) { assert.deepStrictEqual(ist, soll, warum); checks++; }

const fluss = (key) => ({
	key: key, name: "Probefluss", typ: "Fluss", ziel: "path", subtyp: "Flussweg", kind: "",
	wiki: "ggp", abschnitte: [], geometrie: [[10, 10], [12, 12], [14, 14]],
	items: [{ id: 1, change_type: "new", anlass: null }],
});
const pfad = (key) => Object.assign({}, fluss(key), { typ: "Pfad", subtyp: "Pfad" });

// =================================================================================================
// A. DAS HÄKCHEN — Vorgabe AN
// =================================================================================================
// 🔴 Ohne Endknoten hängt ein importierter Weg im Routennetz an nichts: der Graphbau verwirft jeden
// Weg, dessen Endpunkt auf keinem bekannten Ort und keiner Kreuzung liegt — gezeichnet und
// trotzdem unbefahrbar. Deshalb ist die Vorgabe AN und nicht aus.
const mPfad = fenster.garetienEingefuegtWirdMarkup(pfad("p1"));
wahr(mPfad.includes("Kreuzung an Anfang und Ende"), "das Häkchen steht im Weg-Kasten: " + mPfad);
wahr(/data-gi-feld="endpointCrossings"[^>]*checked/.test(mPfad)
	|| /checked[^>]*data-gi-feld="endpointCrossings"/.test(mPfad),
	"🔴 und es ist VORGEHAKT: " + mPfad);

// Und es reist mit — auch als `true`.
const rumpfPfad = fenster.garetienEingabenFuerServer(pfad("p2"));
gleich(rumpfPfad.endpoint_crossings, true,
	"🔴 `endpoint_crossings` reist IMMER mit. Der Server fällt ohne das Feld auf JA zurück (für "
	+ "„Alle angezeigten einfügen“); ein abgeschaltetes Häkchen muss deshalb ausdrücklich `false` "
	+ "senden, sonst wäre es wirkungslos");

const abgehakt = pfad("p3");
fenster.garetienEingabenZustandZu(abgehakt).endpointCrossings = false;
gleich(fenster.garetienEingabenFuerServer(abgehakt).endpoint_crossings, false,
	"ein abgeschaltetes Häkchen sendet ausdrücklich false");

// =================================================================================================
// B. DIE STRÖMUNGSRICHTUNG — nur ein Flussweg
// =================================================================================================
const mFluss = fenster.garetienEingefuegtWirdMarkup(fluss("f1"));
wahr(mFluss.includes("Strömung"), "die Zeile steht im Kasten eines Flusses");
wahr(mFluss.includes('data-gi-feld="flowDir"'), "und trägt ihren Feldnamen: " + mFluss);
// ⚠️ Der Knopf zeigt den JETZIGEN Zustand und trägt den NÄCHSTEN — so können Beschriftung und
// Wirkung nicht auseinanderlaufen.
wahr(mFluss.includes("wie die Quelle"), "vorbelegt auf die Richtung der Quelle");
wahr(mFluss.includes('data-gi-wert="reverse"'), "und ein Klick würde sie umkehren");

// 🔴 EIN PFAD BEKOMMT KEINE. Eine gerichtete Straße wäre kein harmloser Zusatz: die Reisezeit liest
// den Strömungsfaktor (Vorgabe 2,0), und der Landweg wäre in einer Richtung doppelt so teuer.
wahr(!mPfad.includes("Strömung"), "🔴 ein Pfad hat keine Strömungszeile: " + mPfad);
wahr(!Object.prototype.hasOwnProperty.call(rumpfPfad, "flow_dir"),
	"und schickt auch keine Richtung mit");

// Der Fluss schickt sie, und eine gedrehte kommt an.
gleich(fenster.garetienEingabenFuerServer(fluss("f2")).flow_dir, "forward",
	"ein Flussweg schickt die Richtung der Quelle");
const gedreht = fluss("f3");
fenster.garetienEingabenZustandZu(gedreht).flowDir = "reverse";
gleich(fenster.garetienEingabenFuerServer(gedreht).flow_dir, "reverse", "und eine gedrehte ebenso");

// =================================================================================================
// C. DIE DREIECKE — Form, Zahl, Richtung, Farbe
// =================================================================================================
const l = {
	marker: (punkt, opt) => ({ punkt: punkt, opt: opt }),
	divIcon: (opt) => opt,
};
const linieOst = [[10, 10], [10, 12], [10, 14], [10, 16], [10, 18]];

const ost = karte.garetienStroemungsdreiecke(l, { punkte: linieOst, flowDir: "forward" }, "#f0b429");
gleich(ost.length, 3, "drei Dreiecke je Linie");
// 🔴 DIE FARBE IST DIE DES IMPORT-FLUSSES und steht am Element, nicht in der CSS-Regel — sie
// wechselt mit dem Thema, weil der Zeichner das Token bei jedem Zeichnen neu liest.
wahr(ost[0].opt.icon.html.includes("#f0b429"),
	"🔴 die übergebene Farbe steht am Dreieck: " + ost[0].opt.icon.html);
wahr(ost[0].opt.interactive === false,
	"⚠️ das Dreieck fängt keine Klicks — der Klick gehört dem Objekt darunter");

// 💣 `atan2(dx, dy)` MIT VERTAUSCHTEN ARGUMENTEN: 0° ist Norden, gezählt im Uhrzeigersinn wie bei
// CSS `rotate()`. Mit der Schulform zeigt jeder Pfeil an der Diagonale GESPIEGELT — und bei genau
// N/O/S/W fällt das nicht auf. Deshalb wird hier eine OST-Linie gemessen und eine NORD-Linie:
// nur zusammen schließen sie die Verwechslung aus.
wahr(ost[0].opt.icon.html.includes("rotate(90.0deg)"),
	"eine nach Osten laufende Linie zeigt nach Osten (90°): " + ost[0].opt.icon.html);
const nord = karte.garetienStroemungsdreiecke(l,
	{ punkte: [[10, 10], [12, 10], [14, 10], [16, 10], [18, 10]], flowDir: "forward" }, "#f0b429");
wahr(nord[0].opt.icon.html.includes("rotate(0.0deg)"),
	"und eine nach Norden laufende nach Norden (0°): " + nord[0].opt.icon.html);

// 🔴 UMGEKEHRT HEISST GEGENRICHTUNG, nicht „irgendein anderer Winkel".
const west = karte.garetienStroemungsdreiecke(l, { punkte: linieOst, flowDir: "reverse" }, "#f0b429");
wahr(west[0].opt.icon.html.includes("rotate(-90.0deg)"),
	"umgekehrt zeigt nach Westen (−90°): " + west[0].opt.icon.html);

// ⚠️ Ohne Richtung KEINE Dreiecke — eine Straße bekommt keine, und ein Objekt ohne Wahl auch nicht.
gleich(karte.garetienStroemungsdreiecke(l, { punkte: linieOst, flowDir: null }, "#f0b429").length, 0,
	"ohne Richtung keine Dreiecke");
gleich(karte.garetienStroemungsdreiecke(l, { punkte: [[10, 10]], flowDir: "forward" }, "#f0b429").length,
	0, "und aus einem einzelnen Punkt erst recht nicht");

// =================================================================================================
// D. DIE ÜBERGABE — ein gekoppelter Wert in zwei Dateien
// =================================================================================================
// 🔴 Die gewählte Richtung steht im Eingabenzustand des FENSTERS; der Zeichner kommt dort nicht
// heran und soll es auch nicht. Sie wird deshalb an das Objekt gestempelt — wie „gewählt“ daneben.
gleich(karte.AVESMAPS_GARETIEN_FELD_FLOW, "flowDir",
	"🔴 beide Dateien nennen dasselbe Feld — sonst stempelt das eine, was das andere nie liest");

// ⚠️ Und der Zeichner liest genau dieses Feld, nicht ein zweites daneben.
const zeichnerQuelle = fs.readFileSync(
	path.join(WURZEL, "js/review/review-garetien-karte.js"), "utf8")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/[^\n]*$/gm, "");
wahr(/flowDir:\s*objekt\s*\?\s*objekt\[AVESMAPS_GARETIEN_FELD_FLOW\]/.test(zeichnerQuelle),
	"der Zeichner nimmt die Richtung über die geteilte Konstante vom Objekt");

// =================================================================================================
// E. DIE RINGE IN DER VORANSICHT — „sehen, wenn die Option aktiviert ist"
// =================================================================================================
// Owner 04.09.2026: „es wäre praktisch wenn man in der voransicht (beim anklicken und in
// 'anzeigen') sehen könnte (mit gelben rahmen), wenn die option aktiviert ist."
//
// 🔴 DIE VORANSICHT MUSS DIESELBE ZAHL ZEIGEN, DIE DER SERVER ANLEGT. Wo der Server EINE Kreuzung
// setzt, darf die Voransicht nicht ZWEI Rahmen zeigen — das wäre keine Ungenauigkeit, sondern eine
// Behauptung über ein Objekt, das es nachher nicht gibt.

// ---- E1. Die STELLEN: zwei Enden, und bei einem Ring genau eines ------------------------------
tief(karte.garetienEndkreuzungsStellen([[10, 10], [12, 12], [14, 14]]), [[10, 10], [14, 14]],
	"eine offene Linie bekommt Anfang UND Ende");

// 💣 EIN GESCHLOSSENER WEG BEKOMMT NUR EINEN. avesmapsGaretienEndkreuzungenAnlegen
// (api/_internal/import/garetien-uebernahme.php) rundet beide Enden auf 5 Stellen und legt bei
// Gleichheit nur EINE Kreuzung an — „zwei Kreuzungen auf demselben Punkt wären eine Dublette, die
// niemand mehr auseinanderhält". Zwei Rahmen wären hier also ein Rahmen zu viel.
tief(karte.garetienEndkreuzungsStellen([[10, 10], [12, 12], [14, 10], [10, 10]]), [[10, 10]],
	"🔴 ein Ring bekommt EINEN Rahmen, nicht zwei — wie der Server");

// 💣 EINE RUNDUNG IST KEINE TOLERANZ (AGENTS.md §11). Der Server vergleicht `round($v, 5)`, nicht
// einen Abstand. Die zwei Fälle unterscheiden sich genau darin, und nur zusammen schließen sie eine
// abgeschriebene Toleranzschwelle aus:
//   · 10.000004 und 10.000006 liegen 2e-6 auseinander (unter jeder 5e-6-Schwelle), runden aber auf
//     10.00000 und 10.00001 — also VERSCHIEDEN, zwei Rahmen.
//   · 10.0000049 rundet auf 10.00000 wie 10.0 selbst — also GLEICH, ein Rahmen.
gleich(karte.garetienEndkreuzungsStellen(
	[[10.000004, 20], [12, 12], [10.000006, 20]]).length, 2,
	"💣 gerundet, nicht toleriert: 2e-6 Abstand über der Rundungsgrenze sind ZWEI Enden");
gleich(karte.garetienEndkreuzungsStellen(
	[[10, 20], [12, 12], [10.0000049, 20]]).length, 1,
	"💣 und innerhalb derselben Rundungszelle EINES — genau wie round(\$v, 5) es sieht");

// ⚠️ Auch die zweite Koordinate zählt: ein Ende, das nur in einer der beiden Achsen abweicht, ist
// ein anderes Ende. Ohne diese Probe genügte ein Vergleich der halben Koordinate.
gleich(karte.garetienEndkreuzungsStellen([[10, 20], [12, 12], [10, 21]]).length, 2,
	"⚠️ gleiche Breite, andere Länge — zwei Enden");

// ⚠️ Aus weniger als zwei Punkten wird nichts: ein Punktobjekt hat keine Enden.
tief(karte.garetienEndkreuzungsStellen([[10, 10]]), [], "ein einzelner Punkt hat keine Enden");
tief(karte.garetienEndkreuzungsStellen([]), [], "und eine leere Liste erst recht nicht");

// ---- E2. Die RINGE: nur mit Häkchen, in Gold, auf den Enden ----------------------------------
const linie = [[10, 10], [10, 12], [10, 14]];
const ringe = karte.garetienEndkreuzungsRinge(l,
	{ punkte: linie, endkreuzungen: true, kreuzungGroesse: 11 }, "#f0b429");
gleich(ringe.length, 2, "eine offene Linie bekommt zwei Rahmen");
tief(ringe.map((r) => r.punkt), [[10, 10], [10, 14]],
	"🔴 sie liegen AUF den Enden — dort legt der Server die Kreuzung an, auf 5 Stellen genau");
wahr(ringe[0].opt.icon.html.includes("#f0b429"),
	"🔴 die Farbe steht am Element, nicht in der CSS-Regel — sie wechselt mit dem Thema: "
	+ ringe[0].opt.icon.html);
wahr(ringe[0].opt.interactive === false,
	"⚠️ der Rahmen fängt keine Klicks — der Klick gehört dem Objekt darunter");

// 🔴 OHNE HÄKCHEN KEIN RAHMEN. Das ist die ganze Aussage dieser Anzeige; käme er auch ohne, sagte
// er nichts.
gleich(karte.garetienEndkreuzungsRinge(l,
	{ punkte: linie, endkreuzungen: false, kreuzungGroesse: 11 }, "#f0b429").length, 0,
	"🔴 abgehaktes Häkchen: kein Rahmen");
gleich(karte.garetienEndkreuzungsRinge(l,
	{ punkte: linie, kreuzungGroesse: 11 }, "#f0b429").length, 0,
	"⚠️ und ein Objekt ohne die Marke ebenso — der Zeichner rät nicht");

// 🔴 DIE GRÖSSE IST DIE EINER ECHTEN KREUZUNG (Owner-Wahl 04.09.2026: „Ring wie eine echte
// Kreuzung"). Sie kommt aus getLocationMarkerSize(CROSSING_LOCATION_TYPE, zoom) und reist am
// Eintrag mit — der Zeichner rechnet sie nicht selbst, sonst stünde die Zoomband-Regel hier ein
// zweites Mal.
const gross = karte.garetienEndkreuzungsRinge(l,
	{ punkte: linie, endkreuzungen: true, kreuzungGroesse: 20 }, "#f0b429");
wahr(gross[0].opt.icon.html.includes("20px"),
	"die mitgereichte Größe steht am Rahmen: " + gross[0].opt.icon.html);
tief(gross[0].opt.icon.iconSize, [20, 20], "und im iconSize");
tief(gross[0].opt.icon.iconAnchor, [10, 10],
	"💣 der Anker ist die MITTE — sonst hinge der Ring an seiner Ecke am Endpunkt");
wahr(!ringe[0].opt.icon.html.includes("20px"),
	"⭐ die Gegenprobe: bei Größe 11 steht dort keine 20 — die Zahl wird wirklich durchgereicht");

// 💣 DIE UNTERGRENZE. Eine echte Kreuzung misst bei Zoom 3 und darunter 5 px; abzüglich 2 px
// Rahmen auf beiden Seiten bliebe INNEN 1 px — kein Ring, sondern ein Punkt. Und Zoom 3 ist
// AVESMAPS_DEFAULT_MAP_ZOOM, also die Startansicht der Karte, nicht ein Randfall.
// ⚠️ Der Preis ist gewollt: unterhalb von 9 px ist der Rahmen GRÖSSER als die Kreuzung, die
// daraus wird. Diese Zusicherung hält den Handel fest, damit ihn niemand für einen Fehler hält
// und „auf die echte Größe zurücksetzt“.
const klein = karte.garetienEndkreuzungsRinge(l,
	{ punkte: linie, endkreuzungen: true, kreuzungGroesse: 5 }, "#f0b429");
wahr(klein[0].opt.icon.html.includes("9px"),
	"💣 5 px würden auf 1 px Loch zusammenfallen — gezeichnet werden 9: " + klein[0].opt.icon.html);
tief(klein[0].opt.icon.iconAnchor, [4.5, 4.5],
	"⚠️ und der Anker folgt der GEZEICHNETEN Größe, nicht der gemessenen — sonst säße der Ring versetzt");

// ⭐ Die Gegenprobe: oberhalb der Grenze wird NICHTS angehoben. Ohne sie wäre „Math.max“ von
// „immer 9“ nicht zu unterscheiden.
wahr(gross[0].opt.icon.html.includes("20px"),
	"⭐ 20 px bleiben 20 — die Untergrenze hebt nur an, sie setzt nicht fest");

// ---- E3. Der gekoppelte Wert und die Naht ------------------------------------------------------
gleich(karte.AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN, fenster.AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN,
	"🔴 beide Dateien nennen dasselbe Feld — sonst stempelt das eine, was das andere nie liest");

// 🔴 GESTEMPELT WIRD ÜBER DIE GANZE ANZEIGE-MENGE, nicht nur über die offene Zeile. Der Owner
// will den Rahmen „beim anklicken UND in 'anzeigen'" sehen; der Strömungs-Stempel daneben trifft
// bewusst nur die gewählte Zeile, und ein abgeschriebener Bau hätte in „Anzeigen" nichts gezeigt.
const wegA = pfad("k1");
const wegB = pfad("k2");
const ortC = Object.assign({}, fluss("k3"), { typ: "Ort", ziel: "location", subtyp: "dorf" });
fenster.avesmapsGaretienAnzeigeHinzufuegen([wegA, wegB, ortC]);
const gezeichnet = fenster.avesmapsGaretienAufDerKarte([wegA, wegB, ortC]);
const marke = (key) => (gezeichnet.filter((o) => o.key === key)[0]
	|| {})[fenster.AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN];
gleich(marke("k1"), true, "🔴 der erste angezeigte Weg trägt die Marke, ohne angeklickt zu sein");
gleich(marke("k2"), true, "und der zweite ebenso — der Stempel läuft über die ganze Menge");

// 🔴 NUR EIN WEG. Ein Ort oder eine Fläche bekommt nie Endkreuzungen (der Server legt sie
// ausschließlich im `ziel === 'path'`-Zweig an), und das Häkchen steht nur im Weg-Kasten.
gleich(marke("k3"), undefined, "🔴 ein Ort bekommt keine Marke");

// Und ein abgehaktes Häkchen nimmt sie zurück.
fenster.garetienEingabenZustandZu(wegB).endpointCrossings = false;
const nachAbhaken = fenster.avesmapsGaretienAufDerKarte([wegA, wegB, ortC]);
gleich((nachAbhaken.filter((o) => o.key === "k2")[0]
	|| {})[fenster.AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN], undefined,
	"🔴 abgehakt heißt keine Marke — sonst zeigte die Karte eine Kreuzung, die nie entsteht");
gleich((nachAbhaken.filter((o) => o.key === "k1")[0]
	|| {})[fenster.AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN], true,
	"⭐ und der Nachbar bleibt unberührt — das Häkchen gehört EINEM Objekt");

// 💣 GESTEMPELT WIRD EINE KOPIE. Die Anzeige-Menge hält die Objekte, wie der Server sie geliefert
// hat; sie zu verändern schriebe sich über `zustand.objekte` bis in die Listenzeile durch, denn
// beide halten dieselbe Referenz. Genau daran ist der Nur-ihre-Stempel schon beinahe gescheitert.
gleich(wegA[fenster.AVESMAPS_GARETIEN_FELD_ENDKREUZUNGEN], undefined,
	"💣 das Objekt der Liste bleibt unberührt — gestempelt wird eine Kopie");

console.log("garetien-endkreuzung-stroemung: " + checks + " Pruefungen bestanden.");

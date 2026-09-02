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

console.log("garetien-endkreuzung-stroemung: " + checks + " Pruefungen bestanden.");

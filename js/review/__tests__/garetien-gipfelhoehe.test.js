// Die Hoehe eines Berggipfels im Kasten "Eingefuegt wird" -- Owner 31.08.2026: "die berggipfel
// brauchen eine höhe als eigenschaft, gib ihnen das feld mit".
//
// 💣 DIE EIGENTLICHE ZUSICHERUNG IST DER LEERE ZUSTAND, nicht das Feld. Ein Berggipfel ist ein
// STUETZPUNKT DES HOEHENFELDS: terrain-store.php liest `is_active = 1` + `height_schritt`, und
// daraus entsteht das Gelaende, ueber das der Router seine Steigungen rechnet. Volkers Daten
// tragen keine Hoehe -- eine Vorgabezahl im Kasten schriebe an JEDEN importierten Gipfel denselben
// erfundenen Wert und veraenderte das Gelaendemodell lautlos falsch. Genau deshalb hat die
// Uebernahme das Feld bis heute ganz weggelassen.
//
// 🔴 Was sich geaendert hat, ist die QUELLE des Wertes -- nicht die Gefahr: geschrieben wird nur,
// was ein Mensch eingetippt hat. Solange niemand tippt, passiert genau das, was vorher passierte.
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-gipfelhoehe.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
const lies = (...t) => fs.readFileSync(path.join(WURZEL, ...t), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

global.document = {
	documentElement: { classList: { add() {}, remove() {} } },
	readyState: "complete",
	getElementById() { return null; },
	addEventListener() {},
	querySelectorAll() { return []; },
};
global.window = global.window || {};
global.window.location = global.window.location || { search: "", hostname: "", protocol: "http:" };

// 🔴 Die ECHTE Gipfel-Frage, aus der echten Datei -- dieselbe, die der Beschriftungsdialog stellt.
// Eine abgeschriebene Liste der Gipfel-Arten waere ihre zweite Fassung.
vm.runInThisContext(lies("js", "map-features", "map-features-ecosystem-height-field.js")
	.split("function isEcosystemPeakSubtype")[0]
	.concat("function isEcosystemPeakSubtype(subtype) {\n\treturn ECOSYSTEM_PEAK_SUBTYPES.includes(String(subtype || \"\"));\n}"));

const mod = require(path.resolve(__dirname, "..", "review-garetien-importer.js"));
const { garetienEingefuegtWirdMarkup, garetienEingabenZustandZu, garetienEingabenFuerServer } = mod;

const gipfel = {
	key: "ggp:Berge:Berg:Garetien:Hutter Berge", name: "Hutter Berge", typ: "Berg",
	subtyp: "berggipfel", ziel: "label", abschnitte: [], items: [{ id: 1, change_type: "new" }],
};

// =================================================================================================
// 1. Der Gipfel bekommt die Zeile -- und sie ist LEER
// =================================================================================================
const m = garetienEingefuegtWirdMarkup(gipfel);
wahr(/data-gi-feld="hoehe"/.test(m), "der Berggipfel bekommt eine Hoehenzeile: " + m.slice(0, 300));
wahr(/Höhe \(Schritt\)/.test(m), "und sie heisst wie im echten Dialog");
wahr(/placeholder="nicht erfasst"/.test(m), "leer wird als „nicht erfasst“ benannt, nicht als 0");
wahr(/type="number"[^>]*data-gi-feld="hoehe"[^>]*value=""/.test(m),
	"und das Zahlenfeld startet WIRKLICH leer -- eine Vorgabezahl waere eine erfundene Hoehe an "
	+ "jedem importierten Gipfel: " + m);

// =================================================================================================
// 2. 🔴 LEER SCHICKT DEN SCHLUESSEL GAR NICHT MIT
// =================================================================================================
const rausLeer = garetienEingabenFuerServer(gipfel);
wahr(rausLeer !== null, "ein Berggipfel schickt ueberhaupt eine Handeingabe");
wahr(!("height_schritt" in rausLeer),
	"ohne Eingabe steht `height_schritt` NICHT im Rumpf -- eine mitgeschickte \"\" behauptete, "
	+ "jemand habe ueber die Hoehe entschieden: " + JSON.stringify(rausLeer));

// --- Erst eine Eingabe reist mit.
garetienEingabenZustandZu(gipfel).hoehe = "5000";
gleich(garetienEingabenFuerServer(gipfel).height_schritt, "5000", "eine getippte Hoehe reist mit");
wahr(garetienEingefuegtWirdMarkup(gipfel).includes('value="5000"'),
	"und steht beim naechsten Rendern wieder im Feld");

// --- Und sie laesst sich wieder LOESCHEN. 💣 Ohne das bliebe ein einmal getippter Wert fuer immer
// am Gipfel stehen, auch wenn der Editor ihn ausdruecklich weggenommen hat.
garetienEingabenZustandZu(gipfel).hoehe = "";
wahr(!("height_schritt" in garetienEingabenFuerServer(gipfel)),
	"eine geloeschte Hoehe verschwindet wieder aus dem Rumpf");

// =================================================================================================
// 3. 🔴 NUR EIN GIPFEL BEKOMMT SIE
// =================================================================================================
// ⚠️ Gefragt wird mit derselben Funktion wie im echten Dialog (isEcosystemPeakSubtype); dieser
// Abschnitt belegt, dass die Weiche wirklich greift.
const seeLabel = Object.assign({}, gipfel, {
	key: "ggp:Gewaesser:See:Garetien:Muehlsee", subtyp: "see", ziel: "region",
});
wahr(!/data-gi-feld="hoehe"/.test(garetienEingefuegtWirdMarkup(seeLabel)),
	"die Beschriftung einer Flaeche bekommt KEINE Hoehe -- sie ist kein Stuetzpunkt des Hoehenfelds");

// =================================================================================================
// 4. Der Server nimmt sie nur an, wenn wirklich etwas dasteht
// =================================================================================================
// Gemessen am Quelltext, weil die Uebersteuerung eine PHP-Funktion ist.
// ⚠️ Kommentare vorher weg, sonst schlaegt der Test an der Erklaerung an.
const php = lies("api", "_internal", "import", "garetien-uebernahme.php")
	.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
wahr(/height_schritt'\]\s*!==\s*null\s*&&\s*\$einstellungen\['height_schritt'\]\s*!==\s*''/.test(php),
	"die Uebersteuerung nimmt weder null noch eine leere Zeichenkette an");
wahr(!/'height_schritt'\s*=>\s*0/.test(php),
	"und es gibt NIRGENDS eine 0 als Rueckfall -- das waere eine erfundene Hoehe an jedem Gipfel, "
	+ "den niemand angefasst hat");

console.log(`garetien-gipfelhoehe: ${checks} Pruefungen bestanden.`);

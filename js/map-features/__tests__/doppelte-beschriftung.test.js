// Die Regel hinter dem Pruefhaken „Doppelte Beschriftungen".
//
// 💣 DIE TRAGENDE ZUSICHERUNG IST DIE ZWEITE SORTE. Der gemeldete Fall („Inoscha") ist KEINE
// Label-Dublette: der Name steht einmal als freie Beschriftung und einmal als Name seines
// Flusswegs. Eine Regel, die nur `labelData` gegen sich selbst haelt, ist gruen und findet genau
// den Fall nicht, fuer den der Haken gebaut wurde.
//
// 💣 Und die zweite: ein Name, den es NUR an Wegen mehrfach gibt, ist keine Dublette. „Reichsstrasse
// 2" liegt in 57 Abschnitten -- das ist ein Weg, keine doppelte Beschriftung.
//
// Aus der Wurzel des Repos:  node js/map-features/__tests__/doppelte-beschriftung.test.js

const assert = require("assert");
const path = require("path");

const wurzel = path.join(__dirname, "..", "..", "..");
const D = require(path.join(wurzel, "js", "map-features", "doppelte-beschriftung.js"));

let pruefungen = 0;
const ist = (a, b, was) => { assert.strictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };
const gleich = (a, b, was) => { assert.deepStrictEqual(a, b, `${was} (bekam: ${JSON.stringify(a)})`); pruefungen++; };

// ---- A. Der Vergleichsschluessel --------------------------------------------------------------
ist(D.avesmapsBeschriftungsSchluessel("Inoscha"), "inoscha", "kleingeschrieben");
ist(D.avesmapsBeschriftungsSchluessel("  Hexenwald  "), "hexenwald", "getrimmt");
ist(D.avesmapsBeschriftungsSchluessel("Ärmelkanal"), "ärmelkanal", "Umlaute bleiben Umlaute");
ist(D.avesmapsBeschriftungsSchluessel(""), "", "leer bleibt leer");
ist(D.avesmapsBeschriftungsSchluessel("   "), "", "und Leerzeichen auch");
ist(D.avesmapsBeschriftungsSchluessel(null), "", "null wirft nicht");
ist(D.avesmapsBeschriftungsSchluessel(undefined), "", "undefined auch nicht");
// 🪤 KEIN Abschneiden von Klammerzusaetzen -- der Haken behauptet nichts, was er nicht misst.
ist(D.avesmapsBeschriftungsSchluessel("Nostria (Siedlung)"), "nostria (siedlung)",
	"ein Klammerzusatz gehoert zum Namen");

// ---- B. Sorte (a): mehrfach als Beschriftung --------------------------------------------------
const nurLabels = D.avesmapsDoppelteBeschriftungIndex(
	["Hexenwald", "Hexenwald", "Hexenwald", "Ingvaltal", "Ingvaltal", "Gareth"], []);
gleich([...nurLabels].sort(), ["hexenwald", "ingvaltal"], "die mehrfach vergebenen Namen");
ist(nurLabels.has("gareth"), false, "ein einmaliger Name ist keine Dublette");

// Gross-/Kleinschreibung faellt zusammen.
ist(D.avesmapsDoppelteBeschriftungIndex(["Hexenwald", "hexenwald"], []).has("hexenwald"), true,
	"„Hexenwald“ und „hexenwald“ sind derselbe Name");

// ---- C. Sorte (b): Beschriftung UND gleichnamiger Weg -- der Fall „Inoscha" -------------------
const mitWegen = D.avesmapsDoppelteBeschriftungIndex(
	["Inoscha", "Andrafälle", "Gareth"], ["Inoscha", "Reichsstraße 2"]);
ist(mitWegen.has("inoscha"), true,
	"EINE Beschriftung plus EIN gleichnamiger Weg ist eine Dublette -- der gemeldete Fall");
ist(mitWegen.has("andrafälle"), false,
	"eine Beschriftung ohne gleichnamigen Weg nicht (13 der 19 Fluss-Labels sind berechtigt)");

// 💣 Ein Name, den es nur an WEGEN mehrfach gibt, ist keine Dublette.
const nurWege = D.avesmapsDoppelteBeschriftungIndex(
	["Gareth"], ["Reichsstraße 2", "Reichsstraße 2", "Reichsstraße 2"]);
ist(nurWege.has("reichsstraße 2"), false,
	"ein Weg in 57 Abschnitten ist keine doppelte BESCHRIFTUNG");
ist(nurWege.size, 0, "und er erzeugt ueberhaupt keinen Eintrag");

// ---- D. Die Fragen an ein einzelnes Label ------------------------------------------------------
const index = D.avesmapsDoppelteBeschriftungIndex(["Inoscha", "Hexenwald", "Hexenwald"], ["Inoscha"]);
ist(D.avesmapsIstDoppelteBeschriftung({ text: "Inoscha" }, index), true, "Inoscha traegt den Befund");
ist(D.avesmapsIstDoppelteBeschriftung({ text: "Hexenwald" }, index), true, "Hexenwald auch");
ist(D.avesmapsIstDoppelteBeschriftung({ text: "Gareth" }, index), false, "Gareth nicht");
ist(D.avesmapsIstDoppelteBeschriftung({ text: " inoscha " }, index), true,
	"und der Vergleich normalisiert auch hier");
ist(D.avesmapsIstDoppelteBeschriftung({ text: "" }, index), false, "ein leerer Name traegt nie einen Befund");
ist(D.avesmapsIstDoppelteBeschriftung(null, index), false, "kein Label wirft nicht");
ist(D.avesmapsIstDoppelteBeschriftung({ text: "Inoscha" }, null), false, "kein Index wirft nicht");
ist(D.avesmapsIstDoppelteBeschriftung({ text: "Inoscha" }, {}), false, "und ein kaputter Index auch nicht");

// ---- E. Randfaelle ----------------------------------------------------------------------------
gleich([...D.avesmapsDoppelteBeschriftungIndex([], [])], [], "leerer Bestand, kein Befund");
gleich([...D.avesmapsDoppelteBeschriftungIndex(null, null)], [], "fehlender Bestand wirft nicht");
// ⚠️ Leere Namen zaehlen NICHT als Dublette, obwohl es sie mehrfach gibt: eine Beschriftung ohne
// Text ist ein anderes Problem, und der Haken wuerde sie alle rot einfaerben.
ist(D.avesmapsDoppelteBeschriftungIndex(["", "", "  "], []).size, 0,
	"drei leere Namen sind keine Dublette");

console.log(`doppelte-beschriftung.test: OK (${pruefungen} Zusicherungen)`);

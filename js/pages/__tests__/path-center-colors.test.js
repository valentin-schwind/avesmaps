// js/pages/__tests__/path-center-colors.test.js
// Die Wegefarben stehen an EINER Stelle. Vorher lagen sie in getPathStyleColors
// (map-features.js), einer Funktion mit map.getZoom() -- unerreichbar für alles,
// was ohne Karte rechnet. Dieser Test hält sie draußen.
//
// Fix-Runde 1 (14.08.2026): die erste Fassung prüfte nur per Regex, dass die acht
// Schlüsselnamen im Quelltext VORKOMMEN -- weder die SchlüsselMENGE noch die
// Hex-WERTE. Genau die trägt aber die Aufgabe: "es darf sich keine Farbe ändern".
// Jetzt wird das echte Objekt ausgewertet und Schlüsselmenge + Werte geprüft.
// js/config.js ist ein flaches Browser-Skript ohne module.exports -- darum wird
// hier NICHT die ganze Datei geladen (die an anderer Stelle DOM/window voraussetzt),
// sondern nur die zwei betroffenen Literale werden aus dem Quelltext geschnitten
// und isoliert per `new Function` ausgewertet. Beide sind reine Literale (Strings /
// String-Array), das ist ohne Risiko möglich.
//
// Lauf: node js/pages/__tests__/path-center-colors.test.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const configSrc = fs.readFileSync(path.join(__dirname, "../../config.js"), "utf8");
const featuresSrc = fs.readFileSync(path.join(__dirname, "../../map-features/map-features.js"), "utf8");

assert.ok(/const PATH_CENTER_COLORS\s*=/.test(configSrc),
	"PATH_CENTER_COLORS muss in js/config.js stehen");

// Schneidet "const NAME = <Literal>;" aus dem Quelltext und liefert nur das Literal
// (von seiner öffnenden bis zu seiner ERSTEN schließenden Klammer -- beide betroffenen
// Konstanten sind flach, also ohne verschachtelte {}/[] in ihren Werten).
function extractLiteral(src, constName, openChar, closeChar) {
	const declaration = new RegExp(`const\\s+${constName}\\s*=\\s*`, "m");
	const match = declaration.exec(src);
	assert.ok(match, `${constName}: Deklaration nicht gefunden`);
	const openIdx = src.indexOf(openChar, match.index + match[0].length - 1);
	const closeIdx = src.indexOf(closeChar, openIdx);
	assert.ok(openIdx !== -1 && closeIdx !== -1, `${constName}: Literal-Grenzen nicht gefunden`);
	return src.slice(openIdx, closeIdx + 1);
}

const centerColorsLiteral = extractLiteral(configSrc, "PATH_CENTER_COLORS", "{", "}");
const subtypeKeysLiteral = extractLiteral(configSrc, "PATH_SUBTYPE_KEYS", "[", "]");

const PATH_CENTER_COLORS = new Function(`"use strict"; return (${centerColorsLiteral});`)();
const PATH_SUBTYPE_KEYS = new Function(`"use strict"; return (${subtypeKeysLiteral});`)();

// Exakt acht Schlüssel, und exakt die MENGE aus PATH_SUBTYPE_KEYS -- nicht nur "kommt vor".
const actualKeys = Object.keys(PATH_CENTER_COLORS).slice().sort();
const expectedKeys = PATH_SUBTYPE_KEYS.slice().sort();
assert.strictEqual(actualKeys.length, 8,
	`PATH_CENTER_COLORS muss genau acht Schlüssel führen, hat ${actualKeys.length}`);
assert.deepStrictEqual(actualKeys, expectedKeys,
	"PATH_CENTER_COLORS-Schlüssel müssen exakt der Menge PATH_SUBTYPE_KEYS entsprechen");

// Die acht Hex-Werte wörtlich -- der Zustand, den Aufgabe 2 eingefroren hat. Das ist die
// Wache: ein vertippter Hex-Wert lässt diesen Vergleich rot werden.
const EXPECTED_COLORS = {
	Reichsstrasse: "#ffffff",
	Strasse: "#8b8b8b",
	Weg: "#cec4ae",
	Pfad: "#9b755a",
	Gebirgspass: "#a8695c",
	Wuestenpfad: "#bea470",
	Flussweg: "#6ec6ff",
	Seeweg: "#2f7dd3",
};
assert.deepStrictEqual(PATH_CENTER_COLORS, EXPECTED_COLORS,
	"PATH_CENTER_COLORS-Werte dürfen sich nicht ändern -- Aufgabe 2 verschiebt nur den Ort");

// 💣 Der Kern: die alte Tabelle darf NICHT als zweite Wahrheit stehenbleiben.
assert.ok(!/const centerColors\s*=\s*\{[^}]*Reichsstrasse/.test(featuresSrc),
	"getPathStyleColors darf keine eigene Farbtabelle mehr halten");
assert.ok(/PATH_CENTER_COLORS/.test(featuresSrc),
	"getPathStyleColors muss PATH_CENTER_COLORS lesen");

console.log("path-center-colors: ok");

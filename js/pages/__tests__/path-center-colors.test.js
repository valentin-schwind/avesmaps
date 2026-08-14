// js/pages/__tests__/path-center-colors.test.js
// Die Wegefarben stehen an EINER Stelle. Vorher lagen sie in getPathStyleColors
// (map-features.js), einer Funktion mit map.getZoom() -- unerreichbar für alles,
// was ohne Karte rechnet. Dieser Test hält sie draußen.
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

const subtypes = ["Reichsstrasse", "Strasse", "Weg", "Pfad",
	"Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"];
const block = configSrc.slice(configSrc.indexOf("const PATH_CENTER_COLORS"));
subtypes.forEach((key) => {
	assert.ok(new RegExp(`\\b${key}\\s*:`).test(block.slice(0, 600)),
		`PATH_CENTER_COLORS muss ${key} führen`);
});

// 💣 Der Kern: die alte Tabelle darf NICHT als zweite Wahrheit stehenbleiben.
assert.ok(!/const centerColors\s*=\s*\{[^}]*Reichsstrasse/.test(featuresSrc),
	"getPathStyleColors darf keine eigene Farbtabelle mehr halten");
assert.ok(/PATH_CENTER_COLORS/.test(featuresSrc),
	"getPathStyleColors muss PATH_CENTER_COLORS lesen");

console.log("path-center-colors: ok");

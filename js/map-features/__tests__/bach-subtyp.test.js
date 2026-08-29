// Aufgabe 1 des Tors „Bach und fünf neue Ortsarten" -- der Schlüssel `Bach` in PATH_SUBTYPE_KEYS.
// Auftrag: docs/superpowers/plans/2026-08-29-tor-bach-und-fuenf-ortsarten.md, Aufgabe 1
// Brief:   .superpowers/sdd/2026-08-29-tor-bach-und-fuenf-ortsarten/task-1-brief.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/map-features/__tests__/bach-subtyp.test.js
//
// 🔴 EIN BACH IST KEIN REISEWEG (Owner 27.08.2026: „wie flusswege, die aber nicht befahren werden
// können"). Diese Datei prüft nur den SCHLÜSSEL -- dass PATH_SUBTYPE_KEYS ihn kennt, und zwar an
// der richtigen Stelle (ANS ENDE, die sieben vorhandenen Plätze sind Bestand: svg-export-build.js
// zeichnet in dieser Reihenfolge). Die Transport-Domäne (PHP) prüft
// api/_internal/map/__tests__/bach-domaene-test.php.
//
// 💣 Die reine „ist drin"-Prüfung wäre eine Vakuum-Zusicherung, wenn Bach VOR Flussweg einsortiert
// würde: die Liste enthielte ihn trotzdem, aber jeder Aufrufer, der über den INDEX geht (nicht nur
// über includes()), sähe eine verschobene Reihenfolge. Deshalb steht hier zusätzlich die
// Gegenprobe, dass die sieben vorhandenen Einträge ihre Plätze behalten -- ohne sie belegt die
// Positionsprüfung von Bach nichts über die übrigen sieben.

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let checks = 0;
function wahr(bedingung, warum) {
	assert.ok(bedingung, warum || "");
	checks++;
}
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

// config.js ist ein Browser-Skript ohne Modulsystem (window/document-Zugriffe schon beim Laden,
// u.a. IS_INFOPANEL_MODE = true -> document.documentElement.classList.add(...) an Zeile ~500).
// Dieselben mageren Stubs wie js/review/__tests__/path-transport-options.test.js -- die reale
// Quelle wird ausgeführt, nicht eine Abschrift der Liste.
global.window = {
	location: { search: "" },
	addEventListener() {},
	matchMedia: () => ({ matches: false, addEventListener() {} }),
};
global.document = {
	getElementById: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
	documentElement: { style: { setProperty() {} }, classList: { add() {}, remove() {} } },
};
global.localStorage = { getItem: () => null, setItem() {} };

const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
// index.html lädt map-features-line-catmull.js VOR config.js -- dort werden samples/tension
// (AVESMAPS_CATMULL_DEFAULTS) hineingespreizt. Ohne diese Reihenfolge wirft config.js beim Laden.
loadBrowserScript("../map-features-line-catmull.js");
loadBrowserScript("../../config.js");

// =================================================================================================
// A. Bach ist ein gültiger Wegart-Schlüssel
// =================================================================================================

wahr(PATH_SUBTYPE_KEYS.includes("Bach"), "Bach fehlt in den Wegarten");

// =================================================================================================
// B. Bach steht ANS ENDE -- Bestand, nicht verhandelbar
// =================================================================================================

gleich(
	PATH_SUBTYPE_KEYS[PATH_SUBTYPE_KEYS.length - 1],
	"Bach",
	"💣 Bach gehört ans ENDE der Liste. svg-export-build.js zeichnet in dieser Reihenfolge -- "
		+ "ein Einschieben verschöbe jede Liste, die über PATH_SUBTYPE_KEYS iteriert."
);

// Die Gegenprobe: ohne sie belegt die Zeile darüber nur, DASS irgendwo "Bach" steht, nicht dass
// die sieben vorhandenen Einträge ihre Plätze behalten haben.
gleich(
	PATH_SUBTYPE_KEYS.indexOf("Flussweg"),
	6,
	"die acht vorhandenen Wegarten behalten ihre Plätze -- Flussweg bleibt an Index 6"
);
gleich(PATH_SUBTYPE_KEYS.length, 9, "acht Bestandsarten plus Bach");

console.log(`bach-subtyp ok -- ${checks} Zusicherungen`);

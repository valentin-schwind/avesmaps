// Das Häkchen Bach an einem Flussweg -- die Browser-Hälfte.
//
// Owner 30.08.2026, an einem Bildschirmfoto des Dialogs Weg bearbeiten: ein Häkchen NEBEN dem
// Wegtyp, kein eigener Wegtyp. Wörtlich: "Flusswege bekommen die zusätzlich Option 'Bach'. Bach
// deaktiviert automatisch Flusssegler und Flusskahn (oder jeder art von Befahrbarkeit), bleibt aber
// Flussweg (z.b. als Hindernis)."
//
// 🔴 DIESE DATEI LÖST bach-subtyp.test.js AB, die das Gegenteil festgenagelt hat: dort war `Bach`
// ein Eintrag in PATH_SUBTYPE_KEYS. Die Wegart war vom 29. bis zum 30.08.2026 im Repo, aber weder
// in der Auswahlliste des Dialogs noch auf einem einzigen Objekt -- live gemessen 0 von 6038 Wegen.
//
// 💣 DIE UNTERSCHEIDUNG, DIE DIESE DATEI TRÄGT: Bach ist ein ANZEIGE-Schlüssel und KEIN
// Speicher-Schlüssel. Er steht in PATH_TYPE_LABEL, UNNAMED_PATH_TITLE und INFO_HEADER_IMAGE_BY_PATH
// -- aber NICHT in PATH_SUBTYPE_KEYS, und der Server lehnt ihn als Wegtyp ausdrücklich ab
// (avesmapsReadPathSubtype). Wer die beiden verwechselt, baut entweder einen Wegtyp zurück, den
// niemand speichern kann, oder nimmt dem Bach seinen Namen.
//
// Ausführen, vom Repo-Wurzelverzeichnis: node js/map-features/__tests__/bach-haekchen.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const WURZEL = path.resolve(__dirname, "..", "..", "..");
// ⚠️ Zeilenendenneutral: die Arbeitskopie trägt CRLF, das Deploy-Tor LF (AGENTS.md §9).
const lies = (...teile) => fs.readFileSync(path.join(WURZEL, ...teile), "utf8").replace(/\r\n/g, "\n");

let checks = 0;
const gleich = (ist, soll, warum) => { assert.strictEqual(ist, soll, warum || ""); checks++; };
const wahr = (b, warum) => { assert.ok(b, warum || ""); checks++; };

// ---- Die echten Quellen laden -----------------------------------------------------------------
const ctx = { console, module: undefined };
vm.createContext(ctx);
const config = lies("js", "config.js");
const keysZeile = config.slice(config.indexOf("const PATH_SUBTYPE_KEYS"));
vm.runInContext(keysZeile.slice(0, keysZeile.indexOf("\n")), ctx);
vm.runInContext('const SYNTHETIC_ROUTE_TYPE = "Querfeldein";', ctx);

const domain = lies("js", "map-features", "map-features-path-domain.js");
vm.runInContext(domain.slice(0, domain.indexOf("function getNextPathDisplayName")), ctx);
const hole = (ausdruck) => vm.runInContext(ausdruck, ctx);

// =================================================================================================
// 1. Bach ist KEIN Wegtyp mehr
// =================================================================================================
const KEYS = hole("PATH_SUBTYPE_KEYS");
wahr(Array.isArray(KEYS) && KEYS.length === 8,
	`PATH_SUBTYPE_KEYS muss die acht Wegarten tragen, gefunden: ${JSON.stringify(KEYS)}`);
wahr(!KEYS.includes("Bach"), "Bach darf KEIN Wegtyp mehr sein -- er ist ein Häkchen am Flussweg");
wahr(KEYS.includes("Flussweg"), "der Flussweg selbst bleibt selbstverständlich");
// 🔴 Die acht Plätze sind Bestand -- svg-export-build.js zeichnet in dieser Reihenfolge. Diese
// Gegenprobe stand schon in der abgelösten Datei und bleibt gültig.
["Reichsstrasse", "Strasse", "Weg", "Pfad", "Gebirgspass", "Wuestenpfad", "Flussweg", "Seeweg"]
	.forEach((art, i) => {
		gleich(KEYS[i], art, `Platz ${i} muss ${art} bleiben -- die Zeichenreihenfolge hängt daran`);
	});

// =================================================================================================
// 2. pathIstBach -- NUR an einem Flussweg
// =================================================================================================
const pathIstBach = hole("pathIstBach");
const pathAnzeigeSubtyp = hole("pathAnzeigeSubtyp");

const bach = { properties: { feature_subtype: "Flussweg", is_bach: true } };
const fluss = { properties: { feature_subtype: "Flussweg" } };
gleich(pathIstBach(bach), true, "ein Flussweg mit Häkchen ist ein Bach");
gleich(pathIstBach(fluss), false, "einer ohne nicht");
gleich(pathIstBach({ properties: { feature_subtype: "Flussweg", is_bach: false } }), false,
	"ein ausdrückliches false ebenso wenig");
gleich(pathIstBach(null), false, "und ohne Objekt bricht nichts");

// 🔴 An jedem anderen Wegtyp ist das Häkchen bedeutungslos -- dieselbe Regel wie serverseitig in
// avesmapsPathIstBach. Damit löscht ein Wegtypwechsel es von selbst, ohne eigene Aufräumregel.
["Strasse", "Weg", "Pfad", "Seeweg", "Reichsstrasse"].forEach((art) => {
	gleich(pathIstBach({ properties: { feature_subtype: art, is_bach: true } }), false,
		`an einem ${art} hat das Bach-Häkchen keine Bedeutung`);
});

// =================================================================================================
// 3. Der ANZEIGE-Typ -- und die drei Tafeln, die daran hängen
// =================================================================================================
gleich(pathAnzeigeSubtyp(bach), "Bach", "ein Bach heißt für den Leser Bach");
gleich(pathAnzeigeSubtyp(fluss), "Flussweg", "ein gewöhnlicher Flussweg bleibt Flussweg");

const getPathTypeLabel = hole("getPathTypeLabel");
const getUnnamedPathTitle = hole("getUnnamedPathTitle");
gleich(getPathTypeLabel("Bach"), "Bach", "die Typzeile der Infobox sagt Bach");
gleich(getPathTypeLabel("Flussweg"), "Flussweg",
	"und beim gewöhnlichen Flussweg weiterhin Flussweg -- sonst wäre die Zeile darüber Vakuum");
gleich(getUnnamedPathTitle("Bach"), "Unbenannter Bach",
	"ein unbenannter Bach heißt Unbenannter Bach; der blanke Typ läse sich wie ein Name");

// 💣 Das Kopfbild kommt aus einer Tafel in einer ANDEREN Datei (js/ui/popups.js) -- sie muss den
// Anzeige-Schlüssel kennen, sonst fällt ein Bach auf das generische Bild zurück, und das sieht von
// "es gibt kein Bild dafür" nicht zu unterscheiden aus.
const popups = lies("js", "ui", "popups.js");
const tafel = popups.slice(popups.indexOf("const INFO_HEADER_IMAGE_BY_PATH"));
const tafelRumpf = tafel.slice(0, tafel.indexOf("};") + 2);
wahr(/\bBach:\s*"bach"/.test(tafelRumpf),
	`INFO_HEADER_IMAGE_BY_PATH muss Bach kennen: ${tafelRumpf}`);
wahr(fs.existsSync(path.join(WURZEL, "icons", "header", "bach.webp")),
	"und icons/header/bach.webp muss es wirklich geben");

// =================================================================================================
// 4. 🔴 DIE INFOBOX BENUTZT DEN ANZEIGE-TYP -- sonst sind die drei Tafeln oben totes Vokabular
// =================================================================================================
// Gemessen am Quelltext, weil createPathPopupMarkup ein DOM und die halbe Kartenschicht braucht.
// ⚠️ Kommentare werden vorher entfernt: dieser Test schlüge sonst an der Erklärung an, die den
// Mechanismus beschreibt -- und der nächste Leser löscht dann den Kommentar (AGENTS.md-Falle).
const rendering = lies("js", "map-features", "map-features-path-rendering.js")
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/^\s*\/\/.*$/gm, "");
wahr(/const pathType = \(typeof pathIstBach === "function" && pathIstBach\(path\)\) \? "Bach" :/.test(rendering),
	"createPathPopupMarkup muss den ANZEIGE-Typ bilden -- an ihm hängen Typzeile, unbenannter "
	+ "Titel UND Kopfbild in EINER Zeile");
wahr(/pathType === "Bach"/.test(rendering),
	"und das Wasser-Symbol des Kopfes muss Bach mitzählen, sonst bekommt er das Straßen-Symbol");

console.log(`bach-haekchen: ${checks} Pruefungen bestanden.`);

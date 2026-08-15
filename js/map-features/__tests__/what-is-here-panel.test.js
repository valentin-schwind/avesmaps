// Das Panel von „Was ist hier?" -- die Zeilenordnung und die Wegfall-Regel.
//
// Ausfuehren: node js/map-features/__tests__/what-is-here-panel.test.js
//
// 💣 Geprueft wird der QUELLTEXT, nicht ein gerenderter Browser -- und deshalb ohne Kommentare.
// Die Prosa in diesen Dateien beschreibt genau das, wonach gesucht wird; ein Treffer im Kommentar
// ist kein Beweis, sondern die haeufigste Art, einen gruenen Test zu bauen, der nichts haelt.

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..", "..");
const ohneKommentare = (q) => q.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const quelle = ohneKommentare(fs.readFileSync(
	path.join(ROOT, "js", "map-features", "map-features-what-is-here.js"), "utf8"));

// 🔴 Waren · Fauna · Flora -- das ist AVESMAPS_LORE_ROWS (map-features-lore.js), keine eigene
// Liste. Das Panel darf die Reihenfolge nicht selbst noch einmal aufschreiben.
assert.ok(!/["']Fauna["']/.test(quelle),
	"das Panel schreibt keine Lore-Zeile selbst -- buildLoreMarkup baut alle drei");
assert.ok(/buildLoreMarkup/.test(quelle), "es benutzt den vorhandenen Lore-Container");

// 🔴 „Klimazone" steht IMMER direkt unter Flora, also NACH dem Lore-Block (Owner 2026-08-03).
assert.ok(quelle.indexOf("buildLoreMarkup") < quelle.indexOf("avesmapsClimateRowMarkup"),
	"Klimazone kommt nach den Lore-Zeilen");

// 🔴 Die Treppe wird UNVERAENDERT geliehen und erwartet Blatt -> Wurzel.
assert.ok(/buildSettlementHierarchyMarkup/.test(quelle), "die vorhandene Treppe, kein Nachbau");
assert.ok(!/location-popup__breadcrumb-row/.test(quelle),
	"das Panel baut keine eigenen Treppenstufen");

// 🔴 Eine Zeile ohne Antwort faellt weg, sie steht nie als Strich da.
assert.ok(!/>—</.test(quelle) && !/"—"/.test(quelle), "kein Gedankenstrich als Platzhalter");

// 💣 Das Kopfbild kommt aus der VORHANDENEN Tabelle, nicht aus einer zweiten hier.
assert.ok(/regionHeaderImageBasename/.test(quelle), "INFO_HEADER_IMAGE_BY_ART wird benutzt");
assert.ok(!/wald\.webp|meer\.webp|insel\.webp/.test(quelle), "keine Bildnamen von Hand");

console.log("what-is-here-panel: alles gruen");

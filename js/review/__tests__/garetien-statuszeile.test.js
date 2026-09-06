// Aufgabe 1 des Garetien Importers (06.09.2026) -- die Statuszeile.
// Bauplan: docs/superpowers/plans/2026-09-06-garetien-importer-stage.md
//
// Ausfuehren, vom Repo-Wurzelverzeichnis: node js/review/__tests__/garetien-statuszeile.test.js

"use strict";
const assert = require("assert");
const { ladeImporter } = require("./helfer/garetien-testumgebung.js");

const { api, dom } = ladeImporter();   // baut ein Fake-DOM mit den drei Status-Elementen

// 1. Ruhe: die Bilanz des Laufs
api.garetienStatusSetzen("Lauf 05.09. 14:02 · 8 213 Objekte", "", null);
assert.strictEqual(dom.text("#garetien-status-text"), "Lauf 05.09. 14:02 · 8 213 Objekte");
assert.strictEqual(dom.klassen("#garetien-status-text").includes("ok"), false);
assert.strictEqual(dom.el("#garetien-status-aktion").hidden, true);

// 2. Erfolg mit Handlung
let gerufen = 0;
api.garetienStatusSetzen("✓ 5 Objekte importiert", "ok", { text: "Rückgängig", ruf: () => { gerufen++; } });
assert.ok(dom.klassen("#garetien-status-text").includes("ok"));
assert.strictEqual(dom.el("#garetien-status-aktion").hidden, false);
assert.strictEqual(dom.text("#garetien-status-aktion"), "Rückgängig");
dom.klick("#garetien-status-aktion");
assert.strictEqual(gerufen, 1, "der Link ruft seine Handlung");

// 3. Ein zweiter Aufruf OHNE Handlung nimmt den alten Link weg -- sonst zeigt „Rückgängig" auf
//    eine Übernahme, die zwei Handlungen her ist.
api.garetienStatusSetzen("Stage geleert", "", null);
assert.strictEqual(dom.el("#garetien-status-aktion").hidden, true);
assert.strictEqual(dom.el("#garetien-status-aktion").onclick, null, "der alte Handler geht mit");
assert.strictEqual(dom.klassen("#garetien-status-text").includes("ok"), false, "der Ton geht mit");

// 4. 💣 EIN FEHLER ERSETZT DIE LISTE NICHT MEHR.
dom.setze("#garetien-list", "<div class='avm-row'>Zeile</div>");
api.garetienListeFehlerZeigen(new Error("Dieser Lauf laesst sich nicht mehr aendern."));
assert.ok(dom.html("#garetien-list").includes("avm-row"), "die Liste bleibt stehen");
assert.ok(dom.klassen("#garetien-status-text").includes("bad"));
assert.ok(dom.text("#garetien-status-text").includes("Dieser Lauf laesst sich nicht mehr aendern."));
assert.ok(dom.text("#garetien-status-text").includes("die Liste ist unverändert"),
	"der Satz sagt, dass nichts verloren ist");
console.log("OK -- 13 Zusicherungen");

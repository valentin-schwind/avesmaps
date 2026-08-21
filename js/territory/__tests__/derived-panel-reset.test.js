// Die Vorschau der Gebietsdarstellung muss beim KNOTENWECHSEL leer werden -- sofort, nicht erst
// wenn eine Antwort eintrifft.
//
// 💣 Bug #87 (21.08.2026): Irakema hat 0 Flaechen, und der Kreis sagte das auch richtig. Der
// Vorschaukasten daneben zeigte trotzdem zwei Flaechen und schrieb "Vereinigung von 2
// Unterflaechen" -- das waren Mer'imens Kinder (Sechem Dewa + Cabas), der Knoten davor. Der Owner
// las daraus, seine Zeichnung sei modelliert worden und wieder verschwunden.
//
// Ursache: loadForCurrentTerritory setzt den ZUSTAND zurueck (createEmptyState), das BILD im DOM
// aber nicht. Zwischen Reset und Antwort haengt die Flaeche des Vorgaengers im Kasten, und im
// Fehlerfall haengt sie dort dauerhaft -- der catch in loadSourceGeometriesForPreview machte nur
// console.warn.
//
// 🔴 Geprueft wird die VERDRAHTUNG, nicht eine Hilfsfunktion: setThumbnail kann leeren (bei
// bounds === null schreibt es "Keine Geometrie zugewiesen"), es wurde auf diesen Wegen nur nie
// aufgerufen. Eine getestete Funktion, die niemand aufruft, ist genau der Fehler, den dieses
// Projekt schon mehrfach uebersehen hat.
//
// Run (aus dem Repo-Wurzelverzeichnis):  node js/territory/__tests__/derived-panel-reset.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const quelle = fs.readFileSync(
	path.join(__dirname, "..", "territory-derived-geometry-iframe-editor.js"),
	"utf8"
);
let checks = 0;
const pruefe = (bedingung, warum) => { assert.ok(bedingung, warum); checks++; };

/** Schneidet den Rumpf einer Funktion ueber Klammerzaehlung heraus. */
function rumpf(name) {
	const start = quelle.indexOf(`function ${name}(`);
	assert.notStrictEqual(start, -1, `Funktion ${name} existiert`);
	const auf = quelle.indexOf("{", start);
	let tiefe = 0;
	for (let i = auf; i < quelle.length; i += 1) {
		if (quelle[i] === "{") tiefe += 1;
		else if (quelle[i] === "}") {
			tiefe -= 1;
			if (tiefe === 0) return quelle.slice(auf, i + 1);
		}
	}
	throw new Error(`Rumpf von ${name} nicht geschlossen`);
}

// ⚠️ Kommentare raus, bevor gerechnet wird: die Begruendungen im Code nennen "await" und
// "setThumbnail" selbst, und eine Indexrechnung ueber den Rohtext misst dann Prosa statt Code.
// (Genau daran ist die erste Fassung dieses Tests falsch umgefallen.)
const ohneKommentare = (text) => text
	.replace(/\/\*[\s\S]*?\*\//g, "")
	.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// ── Die Wache muss Zaehne haben ─────────────────────────────────────────────────────────────────
// Ohne diese Gegenprobe koennte rumpf() Unsinn liefern und alles waere trotzdem gruen.
const probe = ohneKommentare(rumpf("loadSourceGeometriesForPreview"));
pruefe(probe.includes("fetchDerivedGeometrySources"), "rumpf() schneidet wirklich den richtigen Rumpf heraus.");
pruefe(!probe.includes("function loadForCurrentTerritory"), "Und er hoert am Ende der Funktion auf.");
// ── 1. Beim Knotenwechsel wird VOR dem ersten await geleert ─────────────────────────────────────
const laden = ohneKommentare(rumpf("loadForCurrentTerritory"));

const reset = laden.indexOf("setThumbnail(null, [])");
pruefe(reset !== -1, "loadForCurrentTerritory leert die Vorschau ausdruecklich.");

const erstesAwait = laden.indexOf("await");
pruefe(erstesAwait !== -1, "Die Funktion wartet ueberhaupt auf etwas (sonst gaebe es die Luecke nicht).");
pruefe(
	reset < erstesAwait,
	"Geleert wird VOR dem ersten await -- sonst haengt die Flaeche des Vorgaengers waehrend der Wartezeit im Kasten."
);

// Und der Reset steht NACH dem Zustandsreset, gehoert also zu diesem Knoten.
const zustandsReset = laden.indexOf("createEmptyState(");
pruefe(zustandsReset !== -1 && zustandsReset < reset, "Erst der Zustand, dann das Bild -- beide zusammen.");

// ── 2. Der Fehlerfall leert ebenfalls ───────────────────────────────────────────────────────────
// 💣 Ein catch, das nur console.warn macht, laesst das Bild des Vorgaengers DAUERHAFT stehen.
const catchAb = probe.indexOf("catch (error)");
pruefe(catchAb !== -1, "loadSourceGeometriesForPreview faengt Fehler ab.");
const catchBlock = probe.slice(catchAb);
pruefe(
	catchBlock.includes("setThumbnail(null, [])"),
	"Auch im Fehlerfall wird geleert -- sonst bleibt die fremde Flaeche fuer immer stehen."
);

// ── 3. Die Notiz darf nicht die alte Zahl weiterschreiben ───────────────────────────────────────
// "Vereinigung von 2 Unterflaechen" kam aus state.sourceGeometries des VORGAENGERS.
// ⚠️ Sie wird INDIREKT zurueckgesetzt: updateInnerBoundaryControl() ruft updateModeNote(), und zu
// diesem Zeitpunkt ist state.sourceGeometries schon leer -- die Zahl im Satz verschwindet also mit.
pruefe(
	rumpf("updateInnerBoundaryControl").includes("updateModeNote()"),
	"updateInnerBoundaryControl setzt die Notiz mit zurueck."
);
pruefe(
	laden.slice(0, erstesAwait).includes("updateInnerBoundaryControl()"),
	"Und es laeuft vor dem ersten await -- die Notiz erbt keine Zahl vom Vorgaenger."
);

// ── 4. Der Stale-Riegel bleibt, wo er ist ───────────────────────────────────────────────────────
// ⚠️ Er ist KEIN Fehler: laeuft schon ein neuerer Ladevorgang, gehoert der Kasten diesem -- die
// alte Antwort darf ihn dann weder malen NOCH leeren.
pruefe(
	/if \(state\.targetKey !== targetKey\) \{\s*return;/.test(probe),
	"Der Riegel gegen spaet eintreffende Antworten steht weiterhin und steigt ohne Leeren aus."
);

console.log(`derived-panel-reset: ${checks} Zusicherungen gruen.`);

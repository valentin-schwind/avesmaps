// Jede "Zuletzt gesynct"-ID, auf die review-wiki-sync.js zeigt, muss es in index.html geben.
//
// 🔴 DIESER TEST EXISTIERT WEGEN EINES FEHLERS, DEN NIEMAND SEHEN KONNTE. WIKI_SYNC_KIND_ELEMENTS
// verwies für settlement/path/region auf `wiki-sync-sync-<kind>-synced` -- Elemente, die in keiner
// Zeile von index.html stehen. Beide Schreiber (refreshWikiSyncKindSyncedStatus und der `done`-Zweig
// von renderWikiSyncKindProgress) prüfen brav auf null und taten deshalb still gar nichts.
//
// Folge: an „Regionen bearbeiten" fehlte das Datum seit dem siebten Editor, an „Wege bearbeiten"
// seit dem achten -- gemeldet vom Owner am 2026-08-02. Bei Siedlungen fiel es nicht auf, weil dort
// eine ZWEITE, explizite Liste dasselbe noch einmal erledigte.
//
// Ein toter getElementById wirft nicht und loggt nicht. Nur ein Abgleich gegen das Markup findet ihn.
//
// Run: node js/review/__tests__/sync-synced-ids.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const markup = fs.readFileSync(path.join(root, "index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "js", "review", "review-wiki-sync.js"), "utf8");

let checks = 0;

function idExistiert(id) {
	// Sowohl id="x" als auch id='x' -- das Markup ist handgeschrieben und nicht durchgehend gleich.
	return new RegExp('id=["\']' + id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '["\']').test(markup);
}

// ---- 1. Die Registry ---------------------------------------------------------------------------
const registryBlock = source.match(/const WIKI_SYNC_KIND_ELEMENTS = \{([\s\S]*?)\n\};/);
assert.ok(registryBlock, "WIKI_SYNC_KIND_ELEMENTS muss auffindbar sein");
checks++;

const registryIds = [...registryBlock[1].matchAll(/(\w+):\s*\{[^}]*synced:\s*"([^"]+)"/g)]
	.map(([, kind, id]) => ({ kind, id }));
assert.ok(registryIds.length >= 3, `mindestens drei Kinds erwartet, gefunden ${registryIds.length}`);
checks++;

for (const { kind, id } of registryIds) {
	assert.ok(idExistiert(id),
		`WIKI_SYNC_KIND_ELEMENTS.${kind}.synced zeigt auf "${id}" -- das Element gibt es in index.html nicht. `
		+ "Ein toter getElementById schreibt still nirgendwohin, das Datum fehlt dann am Knopf.");
	checks++;
}

// ---- 2. Die explizite Liste in refreshWikiSyncKindSyncedStatus --------------------------------
const paare = [...source.matchAll(/\[\["([a-z0-9-]+-synced)", "(\w+)"\](?:, \["([a-z0-9-]+-synced)", "(\w+)"\])*\]/g)];
assert.ok(paare.length > 0, "die explizite Editor-Button-Liste muss auffindbar sein");
checks++;

const expliziteIds = [...paare[0][0].matchAll(/\["([a-z0-9-]+-synced)", "(\w+)"\]/g)].map(([, id]) => id);
assert.ok(expliziteIds.length >= 3, `die Liste sollte mehrere Einträge haben, gefunden ${expliziteIds.length}`);
checks++;

for (const id of expliziteIds) {
	assert.ok(idExistiert(id),
		`Die explizite Liste zeigt auf "${id}" -- das Element gibt es in index.html nicht.`);
	checks++;
}

// ---- 3. Kein Feld wird von ZWEI Stellen bedient ------------------------------------------------
// 💣 Genau diese Doppelung liess den Fehler bei Siedlungen unbemerkt: die Registry war tot, aber die
// explizite Liste sprang ein. Wo zwei Stellen dasselbe Feld schreiben, verdeckt die eine den Ausfall
// der anderen.
const registrySet = new Set(registryIds.map((entry) => entry.id));
const doppelt = expliziteIds.filter((id) => registrySet.has(id));
assert.deepStrictEqual(doppelt, [],
	`Diese Spans werden von BEIDEN Stellen geschrieben: ${doppelt.join(", ")}. `
	+ "Eine davon muss weg -- sonst deckt sie den Ausfall der anderen zu.");
checks++;

// ---- 4. Die Editor-Knöpfe, um die es ging, tragen wirklich einen Span --------------------------
// Die Zeile in review-subjects.js sagt, welcher Knopf ein Subjekt öffnet; hier wird nur geprüft,
// dass die drei umgezogenen Subjekte ihr Datumsfeld haben.
for (const id of ["settlement-editor-synced", "path-editor-synced", "ecosystem-editor-synced"]) {
	assert.ok(idExistiert(id), `Der Editor-Knopf braucht seinen Datums-Span "${id}"`);
	assert.ok(registrySet.has(id), `"${id}" muss von WIKI_SYNC_KIND_ELEMENTS bedient werden`);
	checks += 2;
}

console.log(`sync-synced-ids: ${checks} Prüfungen bestanden.`);

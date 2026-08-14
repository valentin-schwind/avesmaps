// Die Bilanzzeile hat EINEN Erzeuger, und er formuliert fuer alle acht Subjekte gleich.
//
// 🔴 Sie traegt nur, was sich durch die Filterung aendert (Owner 14.08.2026). Die Zahlen des
// letzten Syncs bewegen sich beim Tippen nicht und bleiben als stille Zeile UEBER der Suche.
//
// 💣 Vor dem Umbau stand dieselbe Angabe an acht Stellen in drei Schreibweisen: "1957 / 1957"
// (Literatur, Karten), "200 von 1382" (Vorkommen) und ganze Saetze bei den uebrigen fuenf.
// Dieser Test haelt fest, dass es genau eine Schreibweise gibt.
//
// Run: node js/review/__tests__/wikisync-balance-line.test.js

"use strict";

const assert = require("assert");
const path = require("path");

const { avesmapsListBalanceText } = require(path.resolve(__dirname, "..", "review-list-balance.js"));

let checks = 0;
function gleich(ist, soll, warum) {
	assert.strictEqual(ist, soll, warum || "");
	checks++;
}

// ---- Ungefiltert: nur die Gesamtzahl -----------------------------------------------------------
// ⚠️ Nie leer. Ohne diesen Zweig spraenge die Liste beim ersten Tastendruck um eine Zeile.
gleich(avesmapsListBalanceText("Regionen", 1616, 1616), "1.616 Regionen");
gleich(avesmapsListBalanceText("Orte", 3434, 3434), "3.434 Orte");
gleich(avesmapsListBalanceText("Wege", 4225, 4225), "4.225 Wege");

// ---- Gefiltert: "X von N <Wort im Dativ>" -------------------------------------------------------
gleich(avesmapsListBalanceText("Regionen", 103, 1616), "103 von 1.616 Regionen");
gleich(avesmapsListBalanceText("Orte", 103, 3434), "103 von 3.434 Orten");
gleich(avesmapsListBalanceText("Wege", 212, 4225), "212 von 4.225 Wegen");
gleich(avesmapsListBalanceText("Werke", 96, 1957), "96 von 1.957 Werken");
gleich(avesmapsListBalanceText("Karten", 24, 523), "24 von 523 Karten");
gleich(avesmapsListBalanceText("Territorien", 41, 1038), "41 von 1.038 Territorien");
gleich(avesmapsListBalanceText("Kraftlinien", 4, 59), "4 von 59 Kraftlinien");

// 💣 "Fauna" und "Flora" sind lateinisch und im Dativ unveraendert. Die Faustregel (-n anhaengen)
// machte daraus "Faunan". Die Vorkommen-Ansichten geben den Dativ deshalb ausdruecklich mit.
gleich(avesmapsListBalanceText("Fauna", 200, 1382, "Fauna"), "200 von 1.382 Fauna");
gleich(avesmapsListBalanceText("Flora", 50, 1004, "Flora"), "50 von 1.004 Flora");
gleich(avesmapsListBalanceText("Waren", 300, 2531), "300 von 2.531 Waren");

// ---- Leere Liste --------------------------------------------------------------------------------
gleich(avesmapsListBalanceText("Orte", 0, 0), "Keine Orte");
gleich(avesmapsListBalanceText("Orte", 0, 3434), "0 von 3.434 Orten");

// ---- Tausenderpunkt ueberall ---------------------------------------------------------------------
assert.ok(!/\d{4,}/.test(avesmapsListBalanceText("Wege", 4225, 4225)),
	'Vierstellige Zahlen brauchen einen Tausenderpunkt -- "4225 Wege" ist falsch, "4.225 Wege" richtig.');
checks++;
assert.ok(!/\d{4,}/.test(avesmapsListBalanceText("Karten", 5104, 12345)),
	"Auch beide Zahlen der gefilterten Form brauchen ihn.");
checks++;

// ---- Sichtbar > gesamt faellt auf die ungefilterte Form zurueck ----------------------------------
// ⚠️ Kann vorkommen, wenn eine Liste ihre Gesamtzahl spaeter nachlaedt als ihre Zeilen. Die Zeile
// soll dann nicht "200 von 100" behaupten.
gleich(avesmapsListBalanceText("Orte", 200, 100), "100 Orte");

// ---- Jede der acht Bilanzzeilen existiert UND wird beschrieben ----------------------------------
// 🔴 avesmapsListBalanceRender greift per getElementById und steigt bei null still aus -- genau
// wie die "Zuletzt gesynct"-Spans, deren Fehlen bei Wegen und Regionen monatelang niemand sah
// (js/review/__tests__/sync-synced-ids.test.js erzaehlt die Geschichte). Ein Tippfehler in einer
// id waere hier also unsichtbar: die Zeile bliebe einfach leer.
const fs = require("fs");
const wurzel = path.resolve(__dirname, "..", "..", "..");
const markup = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const renderer = ["review-settlement-list.js", "review-region-sync.js", "review-path-sync.js",
	"review-powerline-list.js", "review-wiki-sync.js"]
	.map((f) => fs.readFileSync(path.join(wurzel, "js", "review", f), "utf8")).join("\n");

const ids = [
	["settlement-list-balance", "Orte"],
	["wiki-sync-territory-balance", "Territorien"],
	["region-sync-balance", "Regionen"],
	["path-sync-balance", "Wege"],
	["powerline-sync-balance", "Kraftlinien"],
	["wiki-sync-adv-balance", "Literatur"],
	["wiki-sync-cm-balance", "Karten"],
	["lore-list-balance", "Vorkommen"],
];
for (const [id, subjekt] of ids) {
	assert.ok(new RegExp('id="' + id + '"').test(markup),
		`Die Bilanzzeile von ${subjekt} ("${id}") fehlt in index.html. avesmapsListBalanceRender `
		+ "steigt bei einem fehlenden Element still aus -- die Zeile bliebe einfach leer.");
	checks++;
	assert.ok(new RegExp('avesmapsListBalanceRender\\(\\s*"' + id + '"').test(renderer),
		`Kein Renderer schreibt die Bilanzzeile von ${subjekt} ("${id}").`);
	checks++;
}

// Die drei alten Zaehler sind fort -- sonst stuende dieselbe Angabe zweimal im Panel.
for (const alt of ["wiki-sync-adv-count", "wiki-sync-cm-count", "lore-list-count"]) {
	assert.ok(!new RegExp('id="' + alt + '"').test(markup),
		`Der alte Zaehler "${alt}" steht noch in der Suchzeile. Damit stuende dieselbe Angabe `
		+ "zweimal im Panel -- einmal rechts oben, einmal als Bilanzzeile.");
	checks++;
}

console.log(`wikisync-balance-line: ${checks} Pruefungen bestanden.`);

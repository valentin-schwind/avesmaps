const assert = require("assert");

// ---- "neueste zuerst" muss auf Daten sortieren, die es GIBT ---------------------------------------
//
// Der Bug, den diese Datei festhaelt (Owner 2026-07-19: "die spoiler werden immer noch nach unten
// sortiert"): die Default-Sortierung verglich AUSSCHLIESSLICH bf_year. Dieses Feld traegt live
// 6 von 1352 Abenteuern -- naemlich nur die handgesetzten Platzhalter. api/_internal/wiki/game-literature-sync.php
// sagt es selbst: "the {{Infobox Produkt}} infobox carries no in-world BF year", der Wiki-Sync fuellt es
// also nie. Damit lieferte der Vergleich fuer praktisch JEDES Paar 0, Array.sort ist stabil, und die
// Eingangsreihenfolge blieb unangetastet -- gebaut wird sie als `beginnt`.concat(`spielt`), weshalb die
// Spoiler ("spielt hier") systembedingt hinten standen. Nicht als Regel, sondern als Rest.
//
// Die Recency-Achse, die tatsaechlich gefuellt ist, ist die EDITION (DSA1..DSA5, ~97 % der Eintraege) --
// dieselbe Angabe, die auch auf der Karte zuerst steht (buildGameLiteratureCardMarkup: "Edition first so it
// leads even when a year exists"). bf_year verfeinert nur noch innerhalb einer Edition.

const { escapeHtml } = require("../../app/utils.js");
const { avesmapsCompareGameLiteratureRecency } = require("../map-features-game-literature.js");

global.escapeHtml = escapeHtml;
global.tr = function (key, germanDefault) { return String(germanDefault == null ? "" : germanDefault); };
// Der Browser laedt map-features-game-literature.js NACH place-extras.js (index.html); place-extras ruft den
// Vergleicher deshalb ueber das Global auf. Genau so wird er hier verdrahtet -- nicht als Import.
global.avesmapsCompareGameLiteratureRecency = avesmapsCompareGameLiteratureRecency;

const { avesmapsSortGameLiteratureEntries } = require("../map-features-place-extras.js");

const titles = (entries) => entries.map((e) => e.a.title);

// ---- 1. Der Live-Fall: kein einziges bf_year, aber Editionen ---------------------------------------
// Meridiana, 25 Abenteuer, 0 davon mit bf_year (live gemessen). Vorher kam hier die Eingangsreihenfolge
// wieder heraus -- 8 spoilerfreie, dann 17 Spoiler. Jetzt entscheidet die Edition.
const live = avesmapsSortGameLiteratureEntries([
	{ a: { title: "Blutbeflecktes Gold", edition: "DSA4" }, role: "start" },
	{ a: { title: "Die sieben magischen Kelche", edition: "DSA1 Basis" }, role: "start" },
	{ a: { title: "Der Götze der Mohas", edition: "DSA2" }, role: "play" },
	{ a: { title: "Das Tal des Todes", edition: "DSA5" }, role: "play" },
	{ a: { title: "Rabenblut", edition: "DSA4.1" }, role: "play" },
]);
assert.deepStrictEqual(titles(live), [
	"Das Tal des Todes",        // DSA5  -- Spoiler, steht trotzdem GANZ OBEN
	"Rabenblut",                // DSA4.1
	"Blutbeflecktes Gold",      // DSA4
	"Der Götze der Mohas",      // DSA2
	"Die sieben magischen Kelche", // DSA1
]);
assert.strictEqual(live[0].role, "play", "der neueste Eintrag steht oben, auch wenn er ein Spoiler ist");

// ---- 2. Die Rolle darf die Reihenfolge NICHT beeinflussen ------------------------------------------
// Der Kern der Owner-Ansage: "egal ob Spoiler oder nicht". Dieselbe Menge mit vertauschten Rollen muss
// dieselbe Titelreihenfolge ergeben -- sonst sortiert irgendwo doch die Rolle mit.
const flipped = avesmapsSortGameLiteratureEntries([
	{ a: { title: "Blutbeflecktes Gold", edition: "DSA4" }, role: "play" },
	{ a: { title: "Die sieben magischen Kelche", edition: "DSA1 Basis" }, role: "play" },
	{ a: { title: "Der Götze der Mohas", edition: "DSA2" }, role: "start" },
	{ a: { title: "Das Tal des Todes", edition: "DSA5" }, role: "start" },
	{ a: { title: "Rabenblut", edition: "DSA4.1" }, role: "start" },
]);
assert.deepStrictEqual(titles(flipped), titles(live), "die Rolle veraendert die Reihenfolge nicht");

// ---- 3. bf_year verfeinert INNERHALB einer Edition --------------------------------------------------
// Die 6 Platzhalter tragen eines; es soll weiter wirken, aber die Edition nicht ueberstimmen.
assert.deepStrictEqual(
	titles(avesmapsSortGameLiteratureEntries([
		{ a: { title: "DSA5, ohne Jahr", edition: "DSA5" }, role: "start" },
		{ a: { title: "DSA5, 1044 BF", edition: "DSA5", year: 1044 }, role: "start" },
		{ a: { title: "DSA3, 1015 BF", edition: "DSA3", year: 1015 }, role: "start" },
	])),
	["DSA5, 1044 BF", "DSA5, ohne Jahr", "DSA3, 1015 BF"]
);

// ---- 4. Unbekannte Edition steht hinten, nicht vorn -------------------------------------------------
// 38 Abenteuer haben gar keine Edition, ein paar tragen ein Fremdregelwerk ("Aventuria 2.0", "regelfrei").
// Beides ist "Alter unbekannt" -- und Unbekanntes gehoert ans Ende, nicht an die Spitze einer Liste,
// die "neueste zuerst" verspricht.
assert.deepStrictEqual(
	titles(avesmapsSortGameLiteratureEntries([
		{ a: { title: "ohne Edition" }, role: "start" },
		{ a: { title: "Fremdregelwerk", edition: "Aventuria 2.0" }, role: "start" },
		{ a: { title: "DSA1", edition: "DSA1" }, role: "start" },
	])),
	["DSA1", "Fremdregelwerk", "ohne Edition"]
);

// ---- 5. Gleichstand bricht der Titel, nicht der Zufall ----------------------------------------------
// Ohne letzten Schluessel haengt die Reihenfolge an der Eingangsreihenfolge -- und die ist genau der
// Rollen-Block, der den urspruenglichen Fehler erzeugt hat.
assert.deepStrictEqual(
	titles(avesmapsSortGameLiteratureEntries([
		{ a: { title: "Zwischen Geistern und Piraten", edition: "DSA4" }, role: "play" },
		{ a: { title: "Blutbeflecktes Gold", edition: "DSA4" }, role: "start" },
	])),
	["Blutbeflecktes Gold", "Zwischen Geistern und Piraten"]
);

// ---- 6. Derselbe Vergleicher bedient die DOM-Sortierung ---------------------------------------------
// Streifen und Dialog sortieren die schon gerenderten Karten per element.dataset -- dort sind ALLE Werte
// Strings ("1044", nicht 1044). Faellt der Vergleicher darueber, springen die Karten beim ersten Klick
// auf "neueste zuerst", obwohl der Leser dieselbe Sortierung waehlt, die schon aktiv ist.
const asDataset = (edition, year, title) => ({ edition: edition, year: String(year), title: title });
assert.ok(
	avesmapsCompareGameLiteratureRecency(asDataset("DSA5", 0, "A"), asDataset("DSA3", 1015, "B")) < 0,
	"DSA5 ohne Jahr steht vor DSA3 mit Jahr -- auch als String-dataset"
);
assert.ok(
	avesmapsCompareGameLiteratureRecency(asDataset("DSA5", 1044, "A"), asDataset("DSA5", 1020, "B")) < 0,
	"innerhalb einer Edition entscheidet das BF-Jahr, absteigend"
);
assert.strictEqual(
	avesmapsCompareGameLiteratureRecency(asDataset("DSA5", 1044, "A"), asDataset("DSA5", 1044, "A")),
	0,
	"identische Eintraege sind gleich -- ein Vergleicher, der das verletzt, macht sort() instabil"
);

console.log("adventure recency order ok");

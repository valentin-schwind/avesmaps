const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// runInThisContext, NOT a vm sandbox: a sandbox with hand-written stubs quietly swallows the very
// rule under test (the file's globals resolve against the stub, not against the real script).
const loadBrowserScript = (relativePath) => {
	const absolutePath = path.join(__dirname, relativePath);
	vm.runInThisContext(fs.readFileSync(absolutePath, "utf8"), { filename: absolutePath });
};
// tr() gibt die deutsche Vorgabe zurueck -- die i18n-Tabelle ist nicht Gegenstand dieses Tests.
// Muss VOR dem Laden stehen: die Typzeile schlaegt ihre Zusaetze seit 2026-08-15 dort nach.
global.tr = (key, fallback) => fallback;
loadBrowserScript("../map-features-location-marker-entry.js");

// The infobox type line: which of the three sources wins, and when "(Ruine)" is appended.
// (docs/superpowers/specs/2026-08-02-ort-bearbeiten-ortsarten-design.md)

// --- Stufe 3: nothing but the size -------------------------------------------------------------
assert.strictEqual(
	locationTypeLabelForDisplay({ locationTypeLabel: "Dorf" }),
	"Dorf",
	"ohne Art bleibt die Ortsgroesse stehen",
);
assert.strictEqual(
	locationTypeLabelForDisplay({ locationTypeLabel: "Besondere Bauwerke/Stätten" }),
	"Besondere Bauwerke/Stätten",
);

// --- Stufe 2: the crawled wiki building type wins over the size --------------------------------
assert.strictEqual(
	locationTypeLabelForDisplay({
		locationTypeLabel: "Besondere Bauwerke/Stätten",
		wikiSettlement: { title: "Zwingfeste", building_type: "Festung" },
	}),
	"Festung",
);

// --- Stufe 1: the editor's own kind wins over the wiki -----------------------------------------
// Same precedence as coats of arms and adventure covers: own > wiki. Somebody looked at this place
// on purpose; the wiki only derived it.
assert.strictEqual(
	locationTypeLabelForDisplay({
		locationTypeLabel: "Besondere Bauwerke/Stätten",
		placeKind: "Brücke",
		wikiSettlement: { title: "Zwingfeste", building_type: "Festung" },
	}),
	"Brücke",
	"eigener Wert schlaegt Wiki",
);
assert.strictEqual(
	locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", placeKind: "Oase" }),
	"Oase",
	"eine Art gibt es auch bei einer Ortsgroesse, nicht nur bei Bauwerken",
);

// --- Leere / kaputte Eingaben -------------------------------------------------------------------
// Ein leeres Feld ist ein GUELTIGER Zustand, kein Fehlen -- es darf nie die Groesse verdraengen.
assert.strictEqual(locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", placeKind: "" }), "Dorf");
assert.strictEqual(locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", placeKind: "   " }), "Dorf");
assert.strictEqual(locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", placeKind: null }), "Dorf");
assert.strictEqual(locationTypeLabelForDisplay(null), "", "kein Ort, kein Label, kein Wurf");
assert.strictEqual(locationTypeLabelForDisplay({}), "");

// --- "(Ruine)" ----------------------------------------------------------------------------------
// 🔴 SEIT 15.08.2026 GEWINNT DAS EIGENE FELD (Owner: „die infobox soll auch das eigene feld lesen").
// Vorher las der Zusatz NUR wikiSettlement.is_ruined -- am Livebestand gemessen trugen 70 Orte das
// eigene Feld, 44 das aus dem Wiki, und **31 nur das eigene**: die sagten im Spotlight „Ruine" und in
// der Infobox nichts, darunter ausgerechnet „Ruine Khell Dairon".
// ⚠️ Die andere Haelfte der alten Regel BLEIBT: der Zusatz haengt nur an einer ART, nie an der
// blossen Ortsgroesse. „Dorf (Ruine)" stand nie da und soll nicht neu entstehen (Zusicherung unten).
assert.strictEqual(
	locationTypeLabelForDisplay({
		locationTypeLabel: "Besondere Bauwerke/Stätten",
		placeKind: "Turm",
		isRuined: true,
	}),
	"Turm (Ruine)",
	"das eigene Feld allein genuegt -- ohne jede Wiki-Siedlung",
);
assert.strictEqual(
	locationTypeLabelForDisplay({
		locationTypeLabel: "Besondere Bauwerke/Stätten",
		placeKind: "Turm",
		isRuined: true,
		wikiSettlement: { title: "X", building_type: "Festung", is_ruined: false },
	}),
	"Turm (Ruine)",
	"und es schlaegt ein Wiki, das die Ruine verneint -- eigener Wert vor Wiki, wie bei Wappen und Covern",
);
assert.strictEqual(
	locationTypeLabelForDisplay({
		locationTypeLabel: "Besondere Bauwerke/Stätten",
		wikiSettlement: { title: "X", building_type: "Festung", is_ruined: true },
	}),
	"Festung (Ruine)",
);
assert.strictEqual(
	locationTypeLabelForDisplay({
		locationTypeLabel: "Besondere Bauwerke/Stätten",
		placeKind: "Turm",
		wikiSettlement: { title: "X", building_type: "Festung", is_ruined: true },
	}),
	"Turm (Ruine)",
	"der Zusatz folgt dem Ort, nicht der Stufe, die gewonnen hat",
);
// Doppelung vermeiden: eine Art, die das Wort schon traegt, bekommt es nicht zweimal.
assert.strictEqual(
	locationTypeLabelForDisplay({
		locationTypeLabel: "Besondere Bauwerke/Stätten",
		wikiSettlement: { title: "X", building_type: "Festungsruine", is_ruined: true },
	}),
	"Festungsruine",
);
// Ohne Art kein Zusatz -- "Dorf (Ruine)" stand da noch nie und soll nicht neu entstehen.
assert.strictEqual(
	locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", wikiSettlement: { title: "X", is_ruined: true } }),
	"Dorf",
);
// 🔴 Und auch nicht ueber das eigene Feld: die Quelle hat 2026-08-15 gewechselt, diese Regel nicht.
// 24 der 70 Ruinen tragen keine Art -- sie sagen es weiter ueber die Statuszeile und das Spotlight,
// nicht ueber die Typangabe.
assert.strictEqual(
	locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", isRuined: true }),
	"Dorf",
);

// --- "(Verborgen)" ------------------------------------------------------------------------------
// Owner 15.08.2026: „es wär schön wenn da 'Verborgen' dransteht". Das Wort gilt seit demselben Tag
// auf ALLEN Oberflaechen -- Editorhaken, Auge-Menue, Spotlight, Wegpunktsuche, Infobox.
// ⚠️ Anders als „Ruine" haengt es an KEINER Art: es beschreibt nicht, was der Ort ist, sondern wie
// die Karte mit ihm umgeht -- das gilt fuer ein Dorf so gut wie fuer einen Turm.
assert.strictEqual(
	locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", isHidden: true }),
	"Dorf (Verborgen)",
);
assert.strictEqual(
	locationTypeLabelForDisplay({ locationTypeLabel: "Besondere Bauwerke/Stätten", placeKind: "Turm", isHidden: true }),
	"Turm (Verborgen)",
);
// 💣 Beides zugleich ist EINE Klammer mit demselben Trenner wie die dritte Spotlight-Zeile.
assert.strictEqual(
	locationTypeLabelForDisplay({
		locationTypeLabel: "Besondere Bauwerke/Stätten",
		placeKind: "Turm",
		isRuined: true,
		isHidden: true,
	}),
	"Turm (Ruine · Verborgen)",
);
// ⚠️ Ein verborgenes Dorf, das ausserdem Ruine ist: die Ruinen-Regel greift ohne Art nicht, das
// Verbergen schon. Die Spotlight-Zeile sagt dort „Ruine · Verborgen" -- das ist bekannt und gewollt.
assert.strictEqual(
	locationTypeLabelForDisplay({ locationTypeLabel: "Dorf", isRuined: true, isHidden: true }),
	"Dorf (Verborgen)",
);

console.log("location-type-label: alle Faelle ok");

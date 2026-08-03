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
// ⚠️ Bewusst unveraendert gegenueber dem Stand vor 2026-08-03: der Zusatz haengt nur an einer ART,
// nie an der blossen Ortsgroesse, und er liest NUR wikiSettlement.is_ruined.
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

console.log("location-type-label: alle Faelle ok");

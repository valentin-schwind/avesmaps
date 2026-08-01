const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// The citymap editor is a standalone page whose logic lives in ONE inline <script> -- there is no module
// to require. So the two search predicates are pulled OUT OF THE SHIPPED PAGE by name and evaluated on
// their own: the test exercises the real source text, not a copy that can drift from it. Evaluating the
// whole block is not an option (its top level touches the DOM), which is exactly why these two functions
// are written pure -- no document, no state, arguments in and a verdict out.
//
// Run (from repo root):  node js/review/__tests__/citymap-editor-search.test.js

const editorPath = path.join(__dirname, "..", "..", "..", "html", "citymap-editor.html");
const html = fs.readFileSync(editorPath, "utf8");

const extract = (name) => {
	// Functions in that page are indented by two spaces, so the closing brace at exactly that indent is
	// the end of the declaration. Anchoring on the indent keeps a nested `}` from ending the match early.
	const re = new RegExp("\\n  function " + name + "\\([\\s\\S]*?\\n  \\}");
	const match = html.match(re);
	assert.ok(match, `${name}() not found in html/citymap-editor.html -- did it get renamed?`);
	return vm.runInNewContext("(" + match[0].trim() + ")");
};

const citymapMatchesQuery = extract("citymapMatchesQuery");
const citymapPlaceHit = extract("citymapPlaceHit");

const LABELS = { stadtplan: "Stadtplan", uebersicht: "Übersicht", grundriss: "Grundriss" };

// A map whose title names no place at all -- the case the whole change exists for.
const bornland = { title: "Das Bornland und Umgebung", places: ["Festum", "Neersand"], types: ["uebersicht"] };
const angbar = { title: "Stadtplan von Angbar (Am Großen Fluss)", places: ["Angbar"], types: ["stadtplan"] };
const leer = { title: "Namenlose Skizze" };

// ---- empty query matches everything (the list must not collapse when the box is empty) ---------------
assert.strictEqual(citymapMatchesQuery(bornland, "", LABELS), true);
assert.strictEqual(citymapMatchesQuery(bornland, "   ", LABELS), true);
assert.strictEqual(citymapMatchesQuery(bornland, null, LABELS), true);

// ---- the title still matches, exactly as before -------------------------------------------------------
assert.strictEqual(citymapMatchesQuery(bornland, "bornland", LABELS), true);
assert.strictEqual(citymapMatchesQuery(bornland, "BORNLAND", LABELS), true);

// ---- THE POINT: an assigned place makes the map findable ---------------------------------------------
assert.strictEqual(citymapMatchesQuery(bornland, "Festum", LABELS), true);
assert.strictEqual(citymapMatchesQuery(bornland, "neersand", LABELS), true);
assert.strictEqual(citymapMatchesQuery(bornland, "Gareth", LABELS), false);

// ---- types match by KEY and by LABEL -----------------------------------------------------------------
// The payload carries keys ('uebersicht'); a human types the label ('Übersicht'). Matching only the key
// would quietly fail on every umlaut-bearing type.
assert.strictEqual(citymapMatchesQuery(bornland, "uebersicht", LABELS), true);
assert.strictEqual(citymapMatchesQuery(bornland, "Übersicht", LABELS), true);
assert.strictEqual(citymapMatchesQuery(angbar, "stadtplan", LABELS), true);
// Without a label table it must still work on the key rather than throw.
assert.strictEqual(citymapMatchesQuery(bornland, "uebersicht", undefined), true);
assert.strictEqual(citymapMatchesQuery(bornland, "Übersicht", undefined), false);

// ---- missing fields are a normal state, not a crash ---------------------------------------------------
assert.strictEqual(citymapMatchesQuery(leer, "skizze", LABELS), true);
assert.strictEqual(citymapMatchesQuery(leer, "Festum", LABELS), false);
assert.strictEqual(citymapMatchesQuery({}, "irgendwas", LABELS), false);

// ---- the hint names the place that caused the hit -----------------------------------------------------
assert.strictEqual(citymapPlaceHit(bornland, "Festum"), "Festum");
assert.strictEqual(citymapPlaceHit(bornland, "neersand"), "Neersand"); // original spelling, not the query
// Silent when the title already explains the hit -- otherwise every row would carry a redundant hint.
assert.strictEqual(citymapPlaceHit(angbar, "Angbar"), "");
assert.strictEqual(citymapPlaceHit(bornland, ""), "");
assert.strictEqual(citymapPlaceHit(bornland, "Gareth"), "");
assert.strictEqual(citymapPlaceHit(leer, "Festum"), "");

console.log("citymap-editor-search.test: OK");

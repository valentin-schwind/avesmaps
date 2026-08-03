const assert = require("assert");
const { filterPlaceKinds, renderPlaceKindAutocompleteHtml, placeKindHighlight } = require("../place-kind-autocomplete.js");

// Der Speicherfilter des Ortsart-Typeaheads. Er muss dasselbe antworten wie sein serverseitiges
// Gegenstueck avesmapsFilterPlaceKinds (api/_internal/wiki/place-kinds.php) -- sonst zeigt die
// Liste etwas anderes, als der Endpunkt behauptet.
// (docs/superpowers/specs/2026-08-02-ort-bearbeiten-ortsarten-design.md)

const KINDS = [
	{ kind: "Festung", count: 421 },
	{ kind: "Palast", count: 125 },
	{ kind: "Wohnhaus", count: 119 },
	{ kind: "Brücke", count: 40 },
	{ kind: "Gildenhaus", count: 50 },
	{ kind: "Karawanserei", count: 26 },
	{ kind: "Oase", count: 24 },
	{ kind: "Zunfthaus", count: 0 },
];

// --- Filtern -----------------------------------------------------------------------------------
assert.deepStrictEqual(
	filterPlaceKinds(KINDS, "brü", 12).map((k) => k.kind),
	["Brücke"],
	"Umlaut trifft",
);
assert.deepStrictEqual(filterPlaceKinds(KINDS, "BRÜ", 12).map((k) => k.kind), ["Brücke"], "Groß/Klein egal");
assert.deepStrictEqual(filterPlaceKinds(KINDS, "  brü  ", 12).map((k) => k.kind), ["Brücke"], "Leerraum egal");
// Teilstring, nicht Präfix: sonst fände "haus" keines der drei -haus-Wörter.
assert.deepStrictEqual(
	filterPlaceKinds(KINDS, "haus", 12).map((k) => k.kind),
	["Wohnhaus", "Gildenhaus", "Zunfthaus"],
	"Teilstring, und die Reihenfolge der Vorlage bleibt erhalten",
);
assert.deepStrictEqual(filterPlaceKinds(KINDS, "zzzz", 12), [], "kein Treffer ist eine leere Liste, kein Wurf");

// --- Leerer Begriff: die ganze Liste, gekappt ---------------------------------------------------
// Das ist der Normalfall beim Hineinklicken. Ein leeres Feld darf nicht "nichts gefunden" heißen.
assert.strictEqual(filterPlaceKinds(KINDS, "", 12).length, KINDS.length);
assert.strictEqual(filterPlaceKinds(KINDS, "   ", 12).length, KINDS.length);
assert.strictEqual(filterPlaceKinds(KINDS, "", 3).length, 3, "die Kappung greift auch ohne Begriff");
assert.deepStrictEqual(
	filterPlaceKinds(KINDS, "", 3).map((k) => k.kind),
	["Festung", "Palast", "Wohnhaus"],
	"gekappt wird HINTEN -- die Reihenfolge kommt vom Server und wird nicht angetastet",
);

// --- Kaputte Eingaben ---------------------------------------------------------------------------
assert.deepStrictEqual(filterPlaceKinds(null, "brü", 12), []);
assert.deepStrictEqual(filterPlaceKinds(undefined, "", 12), []);
assert.deepStrictEqual(filterPlaceKinds([{ }, null, { kind: "Oase" }], "oase", 12).map((k) => k.kind), ["Oase"]);

// --- Hervorhebung -------------------------------------------------------------------------------
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
assert.strictEqual(placeKindHighlight("Brücke", "brü", esc), "<mark>Brü</mark>cke");
assert.strictEqual(placeKindHighlight("Brücke", "", esc), "Brücke", "ohne Begriff keine Auszeichnung");
assert.strictEqual(placeKindHighlight("Zunfthaus", "haus", esc), "Zunft<mark>haus</mark>");
// Gesplittet wird auf dem ROHEN Text und jedes Stück einzeln escaped: auf dem bereits escapten
// Text könnte die Grenze mitten in einer Entity landen und "&amp;" zu "&am<mark>p;</mark>" zerreißen.
assert.strictEqual(placeKindHighlight("A & B", "&", esc), "A <mark>&amp;</mark> B");

// --- Markup -------------------------------------------------------------------------------------
const html = renderPlaceKindAutocompleteHtml({ items: KINDS.slice(0, 2), activeIndex: 0, query: "fe" }, { escape: esc });
assert.ok(html.includes('role="listbox"'), "Liste trägt die Rolle");
assert.ok(html.includes('aria-selected="true"'), "die aktive Zeile ist als gewählt ausgezeichnet");
assert.ok(html.includes("421"), "die Häufigkeit steht dabei -- sie erklärt die Reihenfolge");
// Eine noch nie benutzte Art zeigt "—", nicht "0": nie benutzt ist ein Anfang, kein Messwert.
const unused = renderPlaceKindAutocompleteHtml({ items: [{ kind: "Zunfthaus", count: 0 }], activeIndex: -1, query: "" }, { escape: esc });
assert.ok(unused.includes("—"), "unbenutzte Art zeigt einen Gedankenstrich");
assert.ok(!unused.includes(">0<"), "und nicht die nackte Null");

console.log("place-kind-autocomplete: alle Faelle ok");

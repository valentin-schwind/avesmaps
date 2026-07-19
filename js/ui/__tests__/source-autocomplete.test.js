const assert = require("assert");
const {
  renderSourceAutocompleteHtml,
  renderSourceAutocompleteLabel,
} = require("../source-autocomplete.js");

// The render feeds innerHTML, so escaping is the load-bearing property here: catalog labels are
// editor- and COMMUNITY-supplied (the public report form writes into `sources`), which makes them
// untrusted by definition. Every test below runs with the real default escape, not an identity
// stub, so a regression in escaping fails the suite instead of passing it.

const item = (over) =>
  Object.assign(
    { source_id: 7, url: "https://example.org/x", label: "Blutmond I", type: "abenteuer", official: false, uses: 0 },
    over
  );

// ---- escaping ---------------------------------------------------------------------------------
const evil = renderSourceAutocompleteHtml({
  items: [item({ label: '<img src=x onerror=alert(1)>' })],
  activeIndex: -1,
  query: "",
});
assert.ok(!evil.includes("<img"), "a markup label never reaches innerHTML as markup");
assert.ok(evil.includes("&lt;img"), "it is escaped instead of dropped");

// The query lands in the "create new" row; it is user input on the same path.
const evilQuery = renderSourceAutocompleteHtml({ items: [item()], activeIndex: -1, query: '<b>x</b>' });
assert.ok(!evilQuery.includes("<b>"), "the typed term is escaped in the create-new row");
assert.ok(evilQuery.includes("&lt;b&gt;"), "and is still shown to the user");

// Highlighting splits the RAW label and escapes each piece: splitting the escaped string could cut
// an entity like "&amp;" in half and emit broken markup.
assert.strictEqual(
  renderSourceAutocompleteLabel("a<b", "<", (s) => String(s).replace(/</g, "&lt;")),
  "a<mark>&lt;</mark>b",
  "a match ON an escapable character stays escaped inside <mark>"
);
assert.strictEqual(
  renderSourceAutocompleteLabel("Blutmond und Blutmond", "blutmond", (s) => s),
  "<mark>Blutmond</mark> und <mark>Blutmond</mark>",
  "every occurrence highlights, case-insensitively, preserving original casing"
);
assert.strictEqual(
  renderSourceAutocompleteLabel("Blutmond", "", (s) => s),
  "Blutmond",
  "an empty term highlights nothing (and does not loop forever)"
);
console.log("escaping ok");

// ---- rows -------------------------------------------------------------------------------------
const html = renderSourceAutocompleteHtml({
  items: [
    item({ source_id: 7, label: "Blutmond I", uses: 34, official: true }),
    item({ source_id: 9, label: "Blutmond II", uses: 0, official: false }),
  ],
  activeIndex: 1,
  query: "Blut",
});

assert.ok(html.includes('data-sac-index="0"') && html.includes('data-sac-index="1"'), "rows are pickable by index");
assert.ok(html.includes("an 34 Orten"), "a cited source shows how often it is used");
assert.ok(!html.includes("an 0 Orten"), "an uncited source shows nothing, not 'an 0 Orten'");
assert.ok(html.includes("offiziell"), "the official badge renders");
assert.ok(html.includes("<mark>Blut</mark>mond I"), "the typed prefix is highlighted");

// Keyboard selection must be expressed in the markup, not only in CSS: screen readers read
// aria-selected, and the mount points aria-activedescendant at the id built here.
assert.ok(html.includes('id="sac-opt-9"'), "each row carries a stable option id");
assert.ok(/data-sac-index="1"[^>]*/.test(html), "the active row is addressable");
const activeRow = html.slice(html.indexOf('id="sac-opt-9"'));
assert.ok(activeRow.includes('aria-selected="true"'), "the active row is aria-selected");
assert.ok(html.includes('aria-selected="false"'), "the others are not");
assert.ok(html.includes("is-active"), "and carry the active class for styling");
console.log("rows ok");

// ---- the freetext escape hatch ----------------------------------------------------------------
// It must be present even with hits, or the list reads as "one of these, or nothing".
assert.ok(html.includes("data-sac-dismiss"), "the create-new row is offered alongside hits");
assert.ok(html.includes("als neue Quelle anlegen"), "and says plainly what it does");
// „ / “ are the German quotation marks. Escapes, not literals: an ASCII " typed here
// instead of the closing “ silently ends the string and the assertion tests nothing.
assert.ok(
  html.includes("„Blut“ als neue Quelle anlegen"),
  "quoting the term the editor typed, in German quotation marks"
);

// ---- defensive: partial/absent data must not throw ---------------------------------------------
assert.doesNotThrow(() => renderSourceAutocompleteHtml(null), "no state at all");
assert.doesNotThrow(() => renderSourceAutocompleteHtml({}), "no items key");
assert.doesNotThrow(
  () => renderSourceAutocompleteHtml({ items: [{ source_id: 1 }], activeIndex: 0, query: "x" }),
  "a row with only an id"
);
console.log("defensive ok");

console.log("ALL OK");

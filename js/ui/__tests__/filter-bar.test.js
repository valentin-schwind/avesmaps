const assert = require("assert");

// The filter bar renders through the app globals (tr/escapeHtml). In the browser both are plain globals
// loaded earlier by index.html, so install the REAL escaper rather than a fake -- a stubbed one would
// hide exactly the escaping bugs this markup can have.
const { escapeHtml } = require("../../app/utils.js");
global.escapeHtml = escapeHtml;
global.tr = function (key, germanDefault, params) {
  let out = String(germanDefault == null ? "" : germanDefault);
  Object.keys(params || {}).forEach((name) => {
    out = out.split("{" + name + "}").join(String(params[name]));
  });
  return out;
};

const { avesmapsFilterBarMarkup } = require("../filter-bar.js");
// advFiltersMarkup calls the builder as a browser global; place-extras.js is loaded as a plain script by
// index.html and reaches it the same way.
global.avesmapsFilterBarMarkup = avesmapsFilterBarMarkup;
const { advFiltersMarkup } = require("../../map-features/map-features-place-extras.js");

// =====================================================================================================
// 1. THE REGRESSION GUARD. advFiltersMarkup was a self-contained ~40-line builder until task C
//    generalised the grammar out of it. The generalisation is only safe if the ADVENTURE markup did not
//    move a single byte -- two shipped dialogs (flat + nested) style and wire against it. So: the ORIGINAL
//    implementation, verbatim from before the change, and a diff against the adapter across the shapes
//    the real facets actually take.
// =====================================================================================================
function advFiltersMarkupBeforeTaskC(facets) {
  const placeExtrasEscape = (v) => escapeHtml(String(v == null ? "" : v));
  facets = facets || {};
  var parts = ['<span class="avesmaps-adv-tree__flabel">' + placeExtrasEscape(tr("adventures.filter.label", "Filter")) + "</span>"];
  if (facets.types && facets.types.length) {
    facets.types.forEach(function (t) {
      parts.push('<span class="avesmaps-adv-tree__chip" data-adv-filter="type" data-adv-value="' + placeExtrasEscape(t) + '">' + placeExtrasEscape(t) + "</span>");
    });
    parts.push('<span class="avesmaps-adv-tree__fdiv"></span>');
  }
  function selectMarkup(kind, placeholder, values) {
    if (!values || !values.length) {
      return "";
    }
    return '<span class="avesmaps-adv-tree__selwrap"><select class="avesmaps-adv-tree__fsel" data-adv-filter="' + kind + '">' +
      '<option value="">' + placeExtrasEscape(placeholder) + "</option>" +
      values.map(function (v) { return '<option value="' + placeExtrasEscape(v) + '">' + placeExtrasEscape(v) + "</option>"; }).join("") +
      "</select></span>";
  }
  parts.push(selectMarkup("edition", tr("adventures.filter.edition", "DSA-Version"), facets.editions));
  parts.push(selectMarkup("complexity", tr("adventures.filter.complexity", "Schwierigkeit"), facets.complexities));
  parts.push(selectMarkup("genre", tr("adventures.filter.genre", "Genre"), facets.genres));

  var yr = facets.yearRange || { min: 0, max: 0 };
  var fromPh = yr.min > 0 ? placeExtrasEscape(yr.min) : placeExtrasEscape(tr("adventures.filter.from", "von"));
  var toPh = yr.max > 0 ? placeExtrasEscape(yr.max) : placeExtrasEscape(tr("adventures.filter.to", "bis"));
  parts.push('<span class="avesmaps-adv-tree__yearwrap"><span class="avesmaps-adv-tree__ylabel">' + placeExtrasEscape(tr("adventures.filter.period", "Zeitraum (BF)")) + "</span>" +
    '<input type="number" inputmode="numeric" class="avesmaps-adv-tree__yearin" data-adv-filter="yearFrom" placeholder="' + fromPh + '">' +
    '<span class="avesmaps-adv-tree__ydash">–</span>' +
    '<input type="number" inputmode="numeric" class="avesmaps-adv-tree__yearin" data-adv-filter="yearTo" placeholder="' + toPh + '"></span>');
  parts.push('<span class="avesmaps-adv-tree__fdiv"></span>');
  parts.push('<span class="avesmaps-adv-tree__chip" data-adv-filter="official">' + placeExtrasEscape(tr("adventures.filter.officialOnly", "nur offiziell")) + "</span>");
  return '<div class="avesmaps-adv-tree__filters">' + parts.join("") + "</div>";
}

const cases = {
  "full facets": {
    types: ["Gruppenabenteuer", "Soloabenteuer"],
    editions: ["DSA4.1", "DSA5"],
    complexities: ["Einsteiger", "Fortgeschritten"],
    genres: ["Intrige", "Horror"],
    yearRange: { min: 1037, max: 1046 },
  },
  // No Art facet -> the chips AND their trailing rule must both vanish. This is the case the
  // dividerAfter flag exists for; a plain unconditional divider entry would leave a stray leading rule.
  "no types": { editions: ["DSA5"], genres: ["Intrige"], yearRange: { min: 1040, max: 1040 } },
  // A single adventure -> facets exist but the year range is one value.
  "single": { types: ["Szenario"], editions: ["DSA5"], complexities: [], genres: [], yearRange: { min: 1044, max: 1044 } },
  // Undated set -> min/max stay 0 and the placeholders fall back to "von"/"bis".
  "no years": { types: ["Kurzabenteuer"], editions: ["DSA5"], yearRange: { min: 0, max: 0 } },
  // Everything empty: the bar still renders (label + year range + official), never an empty div.
  "empty facets": {},
  "empty arrays": { types: [], editions: [], complexities: [], genres: [] },
  // Escaping: a genre/type carrying HTML must not break out of the attribute OR the text node.
  "hostile strings": {
    types: ['Schelm & "Narr"', "<script>alert(1)</script>"],
    genres: ["A'B"],
    editions: ["DSA<5"],
    yearRange: { min: 0, max: 0 },
  },
};

Object.keys(cases).forEach((name) => {
  assert.strictEqual(
    advFiltersMarkup(cases[name]),
    advFiltersMarkupBeforeTaskC(cases[name]),
    "adventure filter bar must be byte-identical to the pre-task-C builder: " + name
  );
});
// The no-argument / null paths too (both builders default facets to {}).
assert.strictEqual(advFiltersMarkup(), advFiltersMarkupBeforeTaskC(), "byte-identical: no argument");
assert.strictEqual(advFiltersMarkup(null), advFiltersMarkupBeforeTaskC(null), "byte-identical: null");

// Spot-check that the guard above is actually asserting on real markup rather than two empty strings.
const full = advFiltersMarkup(cases["full facets"]);
assert.ok(full.includes('data-adv-filter="type"') && full.includes('data-adv-filter="official"'), "full bar has chips + official");
assert.ok(full.includes('data-adv-value="Gruppenabenteuer"'), "full bar carries the chip value contract");
assert.ok(!advFiltersMarkup(cases["no types"]).includes('data-adv-filter="type"'), "no types -> no type chips");
// One rule survives (before "nur offiziell"), the chips' rule does not.
assert.strictEqual((advFiltersMarkup(cases["no types"]).match(/adv-tree__fdiv/g) || []).length, 1, "no types -> exactly one rule");
assert.strictEqual((full.match(/adv-tree__fdiv/g) || []).length, 2, "with types -> two rules");
// Escaping really happened (the raw < must not survive anywhere).
assert.ok(!advFiltersMarkup(cases["hostile strings"]).includes("<script>"), "hostile type is escaped");

// =====================================================================================================
// 2. THE GENERIC BUILDER on shapes the adventure bar never produces -- i.e. what the Kartensammlung
//    (§3.7) needs and the old builder could not express.
// =====================================================================================================

// Chip counts (§3.7 "Mehrfach-Chips mit Zähler"). Absent count -> no count span, which is precisely what
// keeps the adventure bar byte-identical above.
const counted = avesmapsFilterBarMarkup([
  { kind: "chips", filter: "type", values: [{ value: "stadtplan", label: "Stadtplan", count: 3 }] },
]);
assert.ok(counted.includes('data-adv-value="stadtplan"'), "chip value is the slug");
assert.ok(counted.includes(">Stadtplan"), "chip label is the human label");
assert.ok(counted.includes('class="avesmaps-adv-tree__chipcount">(3)'), "chip renders its count");
const uncounted = avesmapsFilterBarMarkup([{ kind: "chips", filter: "type", values: ["Stadtplan"] }]);
assert.ok(!uncounted.includes("chipcount"), "no count supplied -> no count span");

// value !== label (a slug with a German label) -- the adventure bar only ever had value === label.
const slugged = avesmapsFilterBarMarkup([
  { kind: "select", filter: "art", placeholder: "Art", values: [{ value: "politisch", label: "Politisch" }] },
]);
assert.ok(slugged.includes('<option value="politisch">Politisch</option>'), "select separates slug from label");

// An empty select is dropped entirely; an empty chips group takes its dividerAfter with it.
assert.strictEqual(avesmapsFilterBarMarkup([{ kind: "select", filter: "x", placeholder: "X", values: [] }]),
  '<div class="avesmaps-adv-tree__filters"></div>', "empty select -> nothing");
assert.strictEqual(avesmapsFilterBarMarkup([{ kind: "chips", filter: "x", values: [], dividerAfter: true }]),
  '<div class="avesmaps-adv-tree__filters"></div>', "empty chips -> no stray divider");

// A toggle is a chip WITHOUT data-adv-value -- the wiring reads the missing value as "boolean, not a set".
const toggle = avesmapsFilterBarMarkup([{ kind: "toggle", filter: "spoiler", label: "Spoiler" }]);
assert.ok(toggle.includes('data-adv-filter="spoiler"') && !toggle.includes("data-adv-value"), "toggle has no value");

// Unknown/garbage groups are skipped rather than throwing -- a descriptor typo must not take the dialog down.
assert.strictEqual(avesmapsFilterBarMarkup([{ kind: "nope" }, null, undefined, {}]),
  '<div class="avesmaps-adv-tree__filters"></div>', "unknown groups are skipped");
assert.strictEqual(avesmapsFilterBarMarkup(), '<div class="avesmaps-adv-tree__filters"></div>', "no groups -> empty bar");

console.log("filter-bar ok");

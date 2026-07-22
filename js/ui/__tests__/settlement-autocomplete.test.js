// Ortsname-Typeahead im Anlegen-Dialog: schlägt Wiki-Siedlungen vor und sagt bei jedem Treffer,
// ob er noch zu vergeben ist. Die Belegung kommt NICHT vom Server -- jeder geladene Ort trägt seine
// Zuordnung schon mit (`location.wikiSettlement`, js/routing/routing.js:77), also ist die Antwort
// im Browser bereits vorhanden und kostet keine Abfrage.
//
// Hier die reinen Teile: der Belegt-Index und das Zeilen-Markup.

const assert = require("assert");
const { escapeHtml } = require("../../app/utils.js");
global.escapeHtml = escapeHtml;
// Den echten Hervorheber als Global installieren, wie ihn der Browser hätte (Muster der übrigen
// Tests: echte Globals, keine Attrappen -- eine Attrappe würde genau die Escaping-Fehler verstecken).
const { renderSourceAutocompleteLabel } = require("../source-autocomplete.js");
global.renderSourceAutocompleteLabel = renderSourceAutocompleteLabel;

const {
  buildAssignedWikiSettlementIndex,
  renderSettlementAutocompleteHtml,
} = require("../settlement-autocomplete.js");

const escapeOpts = { escape: (s) => String(s == null ? "" : s) };

function marker(publicId, name, wikiTitle) {
  return {
    publicId,
    location: { name, wikiSettlement: wikiTitle ? { title: wikiTitle, name: wikiTitle } : null },
  };
}

// --- Belegt-Index ------------------------------------------------------------------------------

(function indexMapsTitleToOccupyingPlace() {
  const index = buildAssignedWikiSettlementIndex([
    marker("p1", "Groß-Gareth", "Gareth"),
    marker("p2", "Punin", "Punin (Stadt)"),
  ]);
  assert.strictEqual(index.get("Gareth"), "Groß-Gareth", "belegter Titel zeigt auf den Ort, der ihn hält");
  assert.strictEqual(index.get("Punin (Stadt)"), "Punin");
  assert.strictEqual(index.get("Havena"), undefined, "unbelegter Titel steht nicht drin");
})();

(function unassignedAndBrokenEntriesAreIgnored() {
  const index = buildAssignedWikiSettlementIndex([
    marker("p1", "Ohne Wiki", null),
    { publicId: "p2" },                       // gar keine location
    { publicId: "p3", location: {} },         // location ohne wikiSettlement
    { publicId: "p4", location: { wikiSettlement: { title: "" } } }, // leerer Titel
    null,
  ]);
  assert.strictEqual(index.size, 0, "nur echte Zuordnungen zählen, nichts wirft");
})();

(function ownAssignmentDoesNotBlockItself() {
  const markers = [marker("p1", "Groß-Gareth", "Gareth")];
  const index = buildAssignedWikiSettlementIndex(markers, "p1");
  assert.strictEqual(index.get("Gareth"), undefined,
    "beim Bearbeiten darf der eigene Eintrag nicht als fremd-vergeben erscheinen");
})();

// --- Zeilen-Markup -----------------------------------------------------------------------------

const state = {
  query: "Gar",
  activeIndex: -1,
  items: [
    { title: "Gareth", name: "Gareth", settlement_label: "Metropole", assignedTo: "Groß-Gareth" },
    { title: "Garetien", name: "Garetien", settlement_label: "Provinz", assignedTo: "" },
  ],
};
const html = renderSettlementAutocompleteHtml(state, escapeOpts);

assert.ok(html.includes("vergeben an Groß-Gareth"), "belegte Zeile nennt den Ort, der sie hält");
assert.ok(html.includes("frei"), "freie Zeile sagt das ausdrücklich, statt es durch Schweigen anzudeuten");
assert.ok(/is-taken/.test(html), "belegte Zeile ist für die Gestaltung als solche markiert");
assert.ok(html.includes("Metropole") && html.includes("Provinz"), "die Siedlungsart steht dabei");
assert.ok(html.includes("<mark>Gar</mark>"), "der getippte Teil wird hervorgehoben");

// Eine belegte Zeile bleibt wählbar: der Owner wollte anzeigen, nicht sperren -- ein Ortsname darf
// sich wiederholen, und die Entscheidung liegt beim Editor.
assert.ok(/data-sac-index="0"/.test(html), "auch die belegte Zeile ist auswählbar");

const emptyHtml = renderSettlementAutocompleteHtml({ query: "xyz", activeIndex: -1, items: [] }, escapeOpts);
assert.ok(!/data-sac-index/.test(emptyHtml), "ohne Treffer keine Zeilen");

console.log("settlement-autocomplete tests passed");

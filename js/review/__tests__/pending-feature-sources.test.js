// Bug #41: "Beim Anlegen von neuen Ortschaften kann nicht gleich eine Quelle angegeben werden."
// A place that does not exist yet has no entity_public_id, so the shared source editor had nothing
// to POST against and stayed empty until the place was saved and re-opened. The fix gives the
// create case a local buffer that plays the role of the server: same widget, same add row, same
// remove button -- the rows are just held until create_point returns a public_id, and then
// replayed through the existing add path (linkCommunityReportSource).
//
// This file covers the pure parts: the buffer store and the "pending" render group. Everything
// runs inside one sequential main() -- an async assertion that merely rejects would otherwise
// surface as an unhandled rejection racing the synchronous checks, and the first failure reported
// would not be the first failure that happened.

const assert = require("assert");
const {
  renderFeatureSourceEditorHtml,
  createPendingFeatureSourceStore,
} = require("../review-feature-sources.js");

const escapeOpts = { escape: (s) => String(s == null ? "" : s) };

// --- The buffer store stands in for the server -------------------------------------------------

async function testEmptyList() {
  const store = createPendingFeatureSourceStore();
  const data = await store.request("list", {});
  assert.strictEqual(data.ok, true, "list resolves with an ok envelope like the server");
  assert.deepStrictEqual(data.sources, [], "a fresh buffer holds no sources");
  assert.deepStrictEqual(store.toSuggestions(), [], "nothing to replay yet");
}

async function testAddBuffersLocally() {
  const store = createPendingFeatureSourceStore();
  const data = await store.request("add", {
    url: "https://f-shop.de/havena",
    label: "Havena - Versunkene Geheimnisse",
    source_type: "regionalspielhilfe",
    reference_kind: "ausfuehrlich",
    is_official: true,
    pages: "42",
  });
  assert.strictEqual(data.ok, true, "add resolves ok");
  assert.strictEqual(data.sources.length, 1, "the source is buffered");
  const row = data.sources[0];
  assert.strictEqual(row.origin, "pending", "buffered rows are marked pending so they render apart");
  assert.ok(row.source_id < 0, "a not-yet-saved source gets a negative local id (never collides with a catalog id)");
  assert.strictEqual(row.catalog_source_id, 0, "a hand-typed source has no catalog row yet");
  assert.strictEqual(row.label, "Havena - Versunkene Geheimnisse", "label kept for display");
  assert.strictEqual(row.type, "regionalspielhilfe", "source_type maps onto the row's type field");
  assert.strictEqual(row.official, true, "is_official maps onto official");
  assert.strictEqual(row.pages, "42", "pages kept");
  assert.strictEqual(row.reference_kind, "ausfuehrlich", "coverage kept");
}

async function testAddExistingKeepsCatalogId() {
  const store = createPendingFeatureSourceStore();
  const data = await store.request("add_existing", {
    source_id: 77,
    url: "https://f-shop.de/blutmond",
    label: "Blutmond I",
    source_type: "abenteuer",
    is_official: true,
    pages: "7",
    reference_kind: "erwaehnung",
  });
  const row = data.sources[0];
  assert.ok(row.source_id < 0, "the display id stays local so removing is unambiguous");
  assert.strictEqual(row.catalog_source_id, 77, "the picked catalog row is remembered for the replay");
  assert.strictEqual(row.label, "Blutmond I", "a picked source still shows its label while pending");
}

async function testRemoveDropsOnlyThatRow() {
  const store = createPendingFeatureSourceStore();
  await store.request("add", { url: "https://a", label: "A", source_type: "sonstiges" });
  const second = await store.request("add", { url: "https://b", label: "B", source_type: "sonstiges" });
  const victimId = second.sources[1].source_id;
  const data = await store.request("remove", { source_id: victimId });
  assert.strictEqual(data.sources.length, 1, "only the removed row is gone");
  assert.strictEqual(data.sources[0].label, "A", "the untouched row survives");
}

async function testTwoPicksOfTheSameCatalogRowStaySeparable() {
  const store = createPendingFeatureSourceStore();
  await store.request("add_existing", { source_id: 5, label: "Doppelt", url: "https://d", pages: "1" });
  const data = await store.request("add_existing", { source_id: 5, label: "Doppelt", url: "https://d", pages: "2" });
  const removed = await store.request("remove", { source_id: data.sources[0].source_id });
  assert.strictEqual(removed.sources.length, 1, "removing one of two picks of the same catalog row leaves the other");
  assert.strictEqual(removed.sources[0].pages, "2", "the surviving row is the other pick");
}

async function testSuggestionShapeMatchesTheReplayPath() {
  const store = createPendingFeatureSourceStore();
  await store.request("add", {
    url: "https://f-shop.de/havena",
    label: "Havena",
    source_type: "regionalspielhilfe",
    reference_kind: "ergaenzend",
    is_official: true,
    pages: "42",
  });
  await store.request("add_existing", { source_id: 77, label: "Blutmond I", url: "https://b", pages: "7" });
  // linkCommunityReportSource() reads exactly these keys -- source_id decides add_existing vs add.
  assert.deepStrictEqual(store.toSuggestions(), [
    {
      source_id: 0,
      url: "https://f-shop.de/havena",
      label: "Havena",
      source_type: "regionalspielhilfe",
      reference_kind: "ergaenzend",
      is_official: true,
      pages: "42",
    },
    {
      source_id: 77,
      url: "https://b",
      label: "Blutmond I",
      source_type: "sonstiges",
      reference_kind: "",
      is_official: false,
      pages: "7",
    },
  ], "buffered rows convert to the suggestion shape the existing replay path consumes");
}

// --- The pending rows render as their own group ------------------------------------------------

function testPendingRendersAsItsOwnGroup() {
  const pendingHtml = renderFeatureSourceEditorHtml(
    { wiki_url: "", sources: [
      { source_id: -1, url: "https://f-shop.de/havena", label: "Havena", type: "regionalspielhilfe", official: true, origin: "pending" },
      { source_id: 9, url: "https://bp/manual", label: "Gespeicherte Quelle", type: "sonstiges", official: false, origin: "manual" } ] },
    escapeOpts
  );
  assert.ok(pendingHtml.includes("Wird beim Anlegen übernommen"), "pending group has its own heading");
  assert.ok(pendingHtml.includes("Havena"), "the pending source is listed");
  assert.ok(
    pendingHtml.indexOf("Wird beim Anlegen übernommen") < pendingHtml.indexOf("Havena"),
    "heading precedes the pending row"
  );
  assert.ok(pendingHtml.includes('data-remove-source-id="-1"'), "a pending row can be taken back off the list again");
  assert.ok(
    pendingHtml.indexOf("Havena") < pendingHtml.indexOf("Gespeicherte Quelle"),
    "pending rows read before already-saved ones"
  );
}

function testNoPendingGroupWhenNothingIsPending() {
  const noPendingHtml = renderFeatureSourceEditorHtml(
    { wiki_url: "", sources: [
      { source_id: 9, url: "https://bp/manual", label: "Gespeicherte Quelle", type: "sonstiges", official: false, origin: "manual" } ] },
    escapeOpts
  );
  assert.ok(!noPendingHtml.includes("Wird beim Anlegen übernommen"), "no heading when nothing is pending");
}

async function main() {
  await testEmptyList();
  await testAddBuffersLocally();
  await testAddExistingKeepsCatalogId();
  await testRemoveDropsOnlyThatRow();
  await testTwoPicksOfTheSameCatalogRowStaySeparable();
  await testSuggestionShapeMatchesTheReplayPath();
  testPendingRendersAsItsOwnGroup();
  testNoPendingGroupWhenNothingIsPending();
  console.log("pending-feature-sources tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

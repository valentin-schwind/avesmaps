const assert = require("assert");

// The context-menu module is one IIFE, so its helpers are only reachable through module.exports. The
// three below are the ones that carry a decision; everything else in that file is DOM wiring that needs
// Leaflet, a document and a live map, and is verified in the browser instead (plan, global rule 7).
const {
	ecosystemMapMenuVisibility,
	ecosystemAreaDeleteRequest,
	formatEcosystemAreaDeleteConfirmation,
} = require("../map-features-ecosystem-context-action.js");

// ---- which entries the MAP menu shows ------------------------------------------------------------
// 💣 The two rules pull in OPPOSITE directions and that is the whole point of testing them together.
// "Neues Herrschaftsgebiet" is bound to ONE mode; the three "Neue ..." entries must NOT be, because they
// are the way into their mode. Writing both as "only in my mode" is the plausible mistake, and it makes
// the new entries unreachable from anywhere except the mode that no longer needs them.

assert.deepStrictEqual(
	ecosystemMapMenuVisibility({ mode: "political", isEditMode: true, isEcosystemEnabled: true }),
	{ createRegion: true, newArea: true },
	"political mode with the layer enabled: both offered"
);

assert.deepStrictEqual(
	ecosystemMapMenuVisibility({ mode: "ecosystem", isEditMode: true, isEcosystemEnabled: true }),
	{ createRegion: false, newArea: true },
	"in the landscape mode 'Neues Herrschaftsgebiet' is gone -- the owner's acceptance criterion"
);

assert.deepStrictEqual(
	ecosystemMapMenuVisibility({ mode: "none", isEditMode: true, isEcosystemEnabled: true }),
	{ createRegion: false, newArea: true },
	"reachable from a neutral mode: the entry switches the mode itself"
);

// ?landschaften=1 missing -> the mode would be refused by setSelectedMapLayerMode, so an entry offering
// it would silently drop the editor into the default mode.
assert.deepStrictEqual(
	ecosystemMapMenuVisibility({ mode: "political", isEditMode: true, isEcosystemEnabled: false }),
	{ createRegion: true, newArea: false },
	"layer flag off: no landscape entries, political one untouched"
);

// A visitor without the edit mode never sees either -- the group itself stays hidden (bootstrap.js:297),
// this is the second lock.
assert.deepStrictEqual(
	ecosystemMapMenuVisibility({ mode: "political", isEditMode: false, isEcosystemEnabled: true }),
	{ createRegion: true, newArea: false },
	"no edit mode: no landscape entries"
);

assert.deepStrictEqual(
	ecosystemMapMenuVisibility(),
	{ createRegion: false, newArea: false },
	"called with nothing: shows nothing, rather than throwing during a right-click"
);

// ---- the delete request -------------------------------------------------------------------------
// 💣 expected_revision is MANDATORY (api/_internal/app/ecosystem.php:468-476). A missing one is a 400 and
// a stale one a 409, so the client must refuse to build the request rather than send a placeholder. Every
// falsy-but-plausible value below would pass a naive `area.geometry_revision || 0`.

assert.deepStrictEqual(
	ecosystemAreaDeleteRequest({ public_id: "eca_123", geometry_revision: 4 }),
	{ public_id: "eca_123", expected_revision: 4 },
	"the revision the client last read travels as expected_revision"
);

assert.strictEqual(
	ecosystemAreaDeleteRequest({ public_id: "eca_123", geometry_revision: 0 }),
	null,
	"revision 0 is refused: the server demands >= 1"
);

assert.strictEqual(
	ecosystemAreaDeleteRequest({ public_id: "eca_123" }),
	null,
	"no revision at all is refused, not sent as undefined"
);

// A numeric string is COERCED, not refused. Checked rather than assumed: the read path casts (int) at
// api/_internal/app/ecosystem.php:543 and the write answer at :1203, so the wire always carries a number
// and this branch is unreachable in practice. Refusing it would turn a working delete into "not loaded".
assert.deepStrictEqual(
	ecosystemAreaDeleteRequest({ public_id: "eca_123", geometry_revision: "3" }),
	{ public_id: "eca_123", expected_revision: 3 },
	"a numeric string still yields an integer expected_revision"
);

assert.strictEqual(
	ecosystemAreaDeleteRequest({ public_id: "eca_123", geometry_revision: "" }),
	null,
	"an empty revision is refused -- Number('') is 0, which the server rejects with 400"
);

assert.strictEqual(
	ecosystemAreaDeleteRequest({ public_id: "eca_123", geometry_revision: 2.5 }),
	null,
	"a fractional revision is refused: it can only come from a broken row"
);

assert.strictEqual(
	ecosystemAreaDeleteRequest({ public_id: "   ", geometry_revision: 4 }),
	null,
	"a blank public_id is refused"
);

assert.strictEqual(ecosystemAreaDeleteRequest(null), null, "no area at all: no request");
assert.strictEqual(ecosystemAreaDeleteRequest(undefined), null, "undefined area: no request");

// ---- the confirmation text ----------------------------------------------------------------------
// It names the REGION, because that is what the tooltip under the cursor names -- and it says what
// happens to it, since one region carries many areas (owner decision 1) and "delete" could otherwise
// read either as "just this shape" or as "delete the Farindel".
//
// 🔴 Since 2026-07-28 that answer depends on the COUNT: removing the last area takes the region and its
// labels with it (avesmapsEcosystemCascadeAfterRemoval). This confirmation is the only brake in front of
// that, so what it promises has to be true in every branch. It used to say "Die Region und ihre anderen
// Flächen bleiben bestehen." unconditionally -- a reassurance that was simply false in the one case
// where it mattered.

const withOthers = formatEcosystemAreaDeleteConfirmation({
	public_id: "eca_123",
	region_name: "Farindel",
	kind: "vegetation",
	geometry_revision: 2,
	region_area_count: 3,
	region_label_count: 1,
}, true);
assert.ok(withOthers.includes("Farindel"), "names the region");
assert.ok(withOthers.includes("anderen 2 Flächen"), "counts what survives instead of hand-waving at it");
assert.ok(withOthers.includes("bleiben bestehen"), "says the region and its other areas survive");

// Exactly two areas: the survivor is singular, not "anderen 1 Flächen".
const withOneOther = formatEcosystemAreaDeleteConfirmation({
	public_id: "eca_123", region_name: "Farindel", kind: "vegetation", region_area_count: 2, region_label_count: 0,
}, true);
assert.ok(withOneOther.includes("andere Fläche"), "one survivor reads as singular");

// 💣 THE LAST AREA. On the live stock every region has exactly one area, so this is the NORMAL case --
// and the sentence has to name the region and its labels going with it.
const last = formatEcosystemAreaDeleteConfirmation({
	public_id: "eca_123", region_name: "Farindel", kind: "vegetation", region_area_count: 1, region_label_count: 2,
}, true);
assert.ok(last.includes("LETZTE"), "the last area says so");
assert.ok(last.includes("2 Labels"), "and names how many labels go with it");
assert.ok(!last.includes("bleiben bestehen"), "and never carries the reassurance that made this wrong");

// The last area of a region with no label at all: no "0 Labels", just the region.
const lastNoLabel = formatEcosystemAreaDeleteConfirmation({
	public_id: "eca_123", region_name: "Wald-001", kind: "vegetation", region_area_count: 1, region_label_count: 0,
}, true);
assert.ok(lastNoLabel.includes("die Region verschwindet mit"), "no label -> the region alone");
assert.ok(!lastNoLabel.includes("0 Label"), "and never a count of zero");

// 🪤 An area row from a cache that predates the count fields: 0 means UNKNOWN, not "none" -- the area
// being deleted counts itself, so the smallest true value is 1. It must not reassure.
const unknown = formatEcosystemAreaDeleteConfirmation({ public_id: "eca_9", region_name: "Farindel", kind: "vegetation" }, true);
assert.ok(!unknown.includes("bleiben bestehen"), "an unknown count never reassures");
assert.ok(unknown.includes("Ist es die letzte"), "it leaves the consequence open instead");

// 🔴 KASKADE AUS (der ausgelieferte Zustand, AVESMAPS_ECOSYSTEM_CASCADE_ENABLED = false). Dann bleibt
// die Region als leere Hülle stehen -- „verschwindet mit" anzukündigen wäre dieselbe Unwahrheit wie die
// alte Entwarnung, nur in die andere Richtung. Beide Zustände sind hier festgenagelt, weil der Schalter
// umgelegt werden WIRD und die Rückfrage dann mitwandern muss.
const letzteOhneKaskade = formatEcosystemAreaDeleteConfirmation({
	public_id: "eca_123", region_name: "Farindel", kind: "vegetation", region_area_count: 1, region_label_count: 2,
}, false);
assert.ok(letzteOhneKaskade.includes("LETZTE"), "es bleibt die letzte Fläche");
assert.ok(letzteOhneKaskade.includes("die Region bleibt bestehen"), "aber die Region geht NICHT mit");
assert.ok(!letzteOhneKaskade.includes("verschwinden mit"), "kein angekündigtes Mitlöschen");
assert.ok(!letzteOhneKaskade.includes("2 Labels"), "und keine Labels, die gar nicht angefasst werden");

// Mehrere Flächen: die Aussage hängt nicht am Schalter, sie ist in beiden Fällen dieselbe.
assert.strictEqual(
	formatEcosystemAreaDeleteConfirmation({ public_id: "x", region_name: "F", kind: "vegetation", region_area_count: 3, region_label_count: 1 }, false),
	formatEcosystemAreaDeleteConfirmation({ public_id: "x", region_name: "F", kind: "vegetation", region_area_count: 3, region_label_count: 1 }, true),
	"solange etwas übrig bleibt, sagt der Schalter nichts dazu"
);

// Unbekannte Zahl UND Kaskade aus: gar keine Aussage über die Region, statt zu raten.
const unbekanntOhneKaskade = formatEcosystemAreaDeleteConfirmation({ public_id: "eca_9", region_name: "Farindel", kind: "vegetation" }, false);
assert.ok(!unbekanntOhneKaskade.includes("Region"), "ohne belastbare Zahl keine Behauptung über die Region");
assert.ok(unbekanntOhneKaskade.includes("wirklich löschen?"), "die Frage selbst bleibt");

const namelessConfirmation = formatEcosystemAreaDeleteConfirmation({ public_id: "eca_9" }, true);
assert.ok(namelessConfirmation.includes("Ohne Namen"), "a region without a name still produces a sentence");
assert.ok(!namelessConfirmation.includes("()"), "and no empty bracket where the kind label would be");

console.log("ecosystem-context-menu.test.js: all assertions passed");

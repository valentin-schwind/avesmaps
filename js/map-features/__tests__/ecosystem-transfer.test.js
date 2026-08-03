const assert = require("assert");

// "Senden an ..." is one IIFE; the four helpers below are the ones that carry a decision. Everything
// else in that file is DOM wiring and two POSTs, which need a document, a live map and a database and
// are verified in the browser instead (plan, global rule 7).
// 🪤 VOR dem require von -transfer.js: die Datei fragt `isDerivedEcosystemKind` als blanke Globale ab
// (im Browser liefert sie -rendering.js). Ohne diese Zeile wäre der typeof-Wächter dort immer falsch
// und der Klima-Riegel liefe im Test ins Leere, während er im Browser greift -- ein Test, der genau
// das Gegenteil dessen beweist, was passiert.
global.isDerivedEcosystemKind = require("../map-features-ecosystem-rendering.js").isDerivedEcosystemKind;

const {
	ecosystemTransferTargetKinds,
	ecosystemTransferPlan,
	ecosystemTransferCarriesWiki,
	formatEcosystemTransferSuccess,
} = require("../map-features-ecosystem-transfer.js");

const KINDS = ["derographisch", "vegetation", "topographie"];

const SOURCE = {
	public_id: "eca_source",
	region_public_id: "ecr_source",
	region_name: "Farindel",
	kind: "vegetation",
	region_type: "wald",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Farindel",
	geometry: { type: "Polygon", coordinates: [[[10, 20], [30, 20], [30, 40], [10, 20]]] },
	geometry_revision: 3,
	is_trial: true,
};

// ---- which layers are offered, and in which order -------------------------------------------------
// 💣 The ORDER is the decision, not the filtering. Of the 500 areas the ~266 twins are vegetation and
// topographie; the 234 derographic ones are containers and have no counterpart. Sorting by the plain
// ECOSYSTEM_KINDS order would put "Derographische Region" first for a vegetation source -- wrong on
// nearly every real transfer, and wrong in a select whose first entry is preselected.

assert.deepStrictEqual(
	ecosystemTransferTargetKinds("vegetation", KINDS),
	["topographie", "derographisch"],
	"vegetation offers its twin topographie first"
);

assert.deepStrictEqual(
	ecosystemTransferTargetKinds("topographie", KINDS),
	["vegetation", "derographisch"],
	"and the other way round"
);

assert.deepStrictEqual(
	ecosystemTransferTargetKinds("derographisch", KINDS),
	["vegetation", "topographie"],
	"a container has no twin: display order, both offered"
);

assert.deepStrictEqual(
	ecosystemTransferTargetKinds("vegetation", KINDS).includes("vegetation"),
	false,
	"never itself -- 'senden an' the layer it already is in would be a duplicate, not a copy"
);

assert.deepStrictEqual(ecosystemTransferTargetKinds("unbekannt", KINDS), [], "an unknown kind offers nothing");
assert.deepStrictEqual(ecosystemTransferTargetKinds("vegetation", []), [], "no vocabulary, no targets");
assert.deepStrictEqual(ecosystemTransferTargetKinds(), [], "called with nothing: empty, not a throw");

// ---- the plan: new region ---------------------------------------------------------------------------

const newRegionPlan = ecosystemTransferPlan({
	area: SOURCE,
	targetKind: "topographie",
	targetRegionPublicId: "",
	newRegionName: "Farindel",
	newRegionType: "gebirge",
	kinds: KINDS,
});

assert.strictEqual(newRegionPlan.error, undefined, "a complete form produces a plan");
assert.strictEqual(newRegionPlan.regionPublicId, "", "no existing region: the area waits for the new one");
assert.strictEqual(newRegionPlan.createRegion.kind, "topographie", "the region is created in the TARGET layer");
assert.strictEqual(newRegionPlan.createRegion.name, "Farindel", "named like the source, as the plan asks");
assert.strictEqual(newRegionPlan.createRegion.region_type, "gebirge", "the Art comes from the form, i.e. the target's vocabulary");

// 🪤 THE SOURCE'S region_type MUST NOT TRAVEL. `wald` is a vegetation type; on a topographie region
// avesmapsEcosystemAssertRegionType answers 400 (api/_internal/app/ecosystem.php:601-610). Copying "all
// the fields of the source" is the plausible mistake and it fails on every single transfer.
assert.notStrictEqual(newRegionPlan.createRegion.region_type, SOURCE.region_type, "never the source's Art");

// 🔴 is_trial is decided by the SERVER from app_setting['ecosystem_trial'] (:960-962). A client that
// sends it can smuggle a permanent area into a trial run or the other way round -- and this task was
// struck from V3.5 for exactly that reason. Checked on both requests.
assert.ok(!("is_trial" in newRegionPlan.createRegion), "create_region carries no is_trial");
assert.ok(!("is_trial" in newRegionPlan), "and neither does the plan the area request is built from");

// 💣 A COPY, NOT A LINK -- and that starts at the client boundary. A shared object reference is how
// "the copy moved with the original" gets in later.
assert.notStrictEqual(newRegionPlan.geometry, SOURCE.geometry, "the geometry is a fresh object");
assert.notStrictEqual(newRegionPlan.geometry.coordinates[0], SOURCE.geometry.coordinates[0], "deep, not one level");
assert.deepStrictEqual(newRegionPlan.geometry, SOURCE.geometry, "with identical numbers");
newRegionPlan.geometry.coordinates[0][0][0] = 999;
assert.strictEqual(SOURCE.geometry.coordinates[0][0][0], 10, "writing into the copy leaves the source alone");

// ---- the plan: existing region ----------------------------------------------------------------------

const existingRegionPlan = ecosystemTransferPlan({
	area: SOURCE,
	targetKind: "topographie",
	targetRegionPublicId: "ecr_windhag",
	newRegionName: "wird ignoriert",
	newRegionType: "see",
	kinds: KINDS,
});

assert.strictEqual(existingRegionPlan.createRegion, null, "appending to an existing region creates none");
assert.strictEqual(existingRegionPlan.regionPublicId, "ecr_windhag", "the area goes straight into it");

// ---- what the plan refuses --------------------------------------------------------------------------

assert.strictEqual(
	ecosystemTransferPlan({ area: SOURCE, targetKind: "vegetation", kinds: KINDS }).error !== undefined,
	true,
	"the source's own layer is not a target"
);

assert.strictEqual(
	ecosystemTransferPlan({ area: SOURCE, targetKind: "topographie", newRegionName: "   ", kinds: KINDS }).error !== undefined,
	true,
	"a blank name for a new region is refused here, not by a 400 from the wire"
);

assert.strictEqual(
	ecosystemTransferPlan({
		area: { ...SOURCE, geometry: { type: "Point", coordinates: [1, 2] } },
		targetKind: "topographie",
		newRegionName: "Farindel",
		kinds: KINDS,
	}).error !== undefined,
	true,
	"a geometry create_area cannot take produces a sentence, not a request"
);

assert.strictEqual(
	ecosystemTransferPlan({ area: null, targetKind: "topographie", kinds: KINDS }).error !== undefined,
	true,
	"no area at all: refused rather than thrown"
);

assert.strictEqual(ecosystemTransferPlan().error !== undefined, true, "called with nothing: an error, not a crash");

// ---- the wiki link travels with the NAME ------------------------------------------------------------
// It is derived into wiki_region_key server-side and joined on. Carrying it under a changed name would
// point the copy at an article about something else -- worse than no link, because it looks like one.

assert.strictEqual(ecosystemTransferCarriesWiki(SOURCE, "Farindel"), true, "same name: the article comes along");
assert.strictEqual(ecosystemTransferCarriesWiki(SOURCE, "  Farindel  "), true, "trimmed, so a stray space is not a rename");
assert.strictEqual(ecosystemTransferCarriesWiki(SOURCE, "Windhagberge"), false, "renamed: the link stays behind");
assert.strictEqual(ecosystemTransferCarriesWiki({ ...SOURCE, wiki_url: "" }, "Farindel"), false, "no source link, nothing to carry");
assert.strictEqual(ecosystemTransferCarriesWiki({ ...SOURCE, region_name: "" }, ""), false, "a nameless source never carries one");

assert.strictEqual(
	ecosystemTransferPlan({ area: SOURCE, targetKind: "topographie", newRegionName: "Farindel", kinds: KINDS }).createRegion.wiki_url,
	SOURCE.wiki_url,
	"and the plan puts it on the request"
);

assert.strictEqual(
	ecosystemTransferPlan({ area: SOURCE, targetKind: "topographie", newRegionName: "Windhagberge", kinds: KINDS }).createRegion.wiki_url,
	"",
	"a renamed copy is sent without one -- an empty wiki_url clears the key server-side"
);

// ---- the confirmation -------------------------------------------------------------------------------
// It names BOTH, because "gespeichert" would not say where the copy landed, and where it landed is the
// question the dialog just asked.

const success = formatEcosystemTransferSuccess("Topographie", "Farindel");
assert.ok(success.includes("Topographie"), "names the target layer");
assert.ok(success.includes("Farindel"), "names the target region");
assert.ok(
	formatEcosystemTransferSuccess("Topographie", "  ").includes("Ohne Namen"),
	"a region without a name still produces a sentence"
);

// ---- Klimazonen sind weder Quelle noch Ziel (2026-08-03) --------------------------------------------
// Ein abgeleitetes Band laesst sich nicht in eine andere Ebene schicken, und in ein abgeleitetes Band
// laesst sich nichts hineinschicken -- beides waere eine Flaeche, von der die Trennlinien nichts wissen.

const KINDS_MIT_KLIMA = ["derographisch", "vegetation", "topographie", "klima"];

assert.ok(
	!ecosystemTransferTargetKinds("vegetation", KINDS_MIT_KLIMA).includes("klima"),
	"klima is never offered as a transfer target"
);
assert.deepStrictEqual(
	ecosystemTransferTargetKinds("vegetation", KINDS_MIT_KLIMA),
	["topographie", "derographisch"],
	"and the remaining order is the one the twin rule above decided"
);
assert.deepStrictEqual(
	ecosystemTransferTargetKinds("klima", KINDS_MIT_KLIMA),
	[],
	"a climate band cannot be sent anywhere"
);

console.log("ecosystem-transfer.test.js: all assertions passed");

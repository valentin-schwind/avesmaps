const assert = require("assert");

// "Kopieren ..." is one IIFE; the helpers below are the ones that carry a decision. Everything
// else in that file is DOM wiring and two POSTs, which need a document, a live map and a database and
// are verified in the browser instead (plan, global rule 7).
// 🪤 VOR dem require von -transfer.js: die Datei fragt `isDerivedEcosystemKind` als blanke Globale ab
// (im Browser liefert sie -rendering.js). Ohne diese Zeile wäre der typeof-Wächter dort immer falsch
// und der Klima-Riegel liefe im Test ins Leere, während er im Browser greift -- ein Test, der genau
// das Gegenteil dessen beweist, was passiert.
global.isDerivedEcosystemKind = require("../map-features-ecosystem-rendering.js").isDerivedEcosystemKind;
// 🪤 Ebenso vor dem require: der Haken „Originalfläche löschen" holt sich Anforderung UND Folgesatz aus
// dem Flächenmenü (window.AvesmapsEcosystemAreaMenu im Browser). Hier stehen die ECHTEN Funktionen, kein
// Stub -- ein nachgebauter Doppelgänger würde beweisen, dass der Test funktioniert, nicht der Code.
const nachbar = require("../map-features-ecosystem-context-action.js");
global.AvesmapsEcosystemAreaMenu = {
	deleteRequest: nachbar.ecosystemAreaDeleteRequest,
	deleteConsequence: nachbar.formatEcosystemAreaDeleteConsequence,
};

const {
	ecosystemTransferTargetKinds,
	ecosystemTransferPlan,
	ecosystemTransferCarriesWiki,
	formatEcosystemTransferSuccess,
	ecosystemTransferDeleteNote,
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
//
// 💣 AND THE SOURCE'S OWN LAYER COMES LAST (2026-08-06). Copying within one layer is allowed since
// today -- an island that is also an archipelago needs two derographic areas of the same outline. But
// it is never the preselected target: a copy in its own layer lies exactly on top of its source and
// cannot be told apart on the map, so it may only come about when somebody PICKS it.

assert.deepStrictEqual(
	ecosystemTransferTargetKinds("vegetation", KINDS),
	["topographie", "derographisch", "vegetation"],
	"vegetation offers its twin topographie first, itself last"
);

assert.deepStrictEqual(
	ecosystemTransferTargetKinds("topographie", KINDS),
	["vegetation", "derographisch", "topographie"],
	"and the other way round"
);

assert.deepStrictEqual(
	ecosystemTransferTargetKinds("derographisch", KINDS),
	["vegetation", "topographie", "derographisch"],
	"a container has no twin: display order, then itself"
);

KINDS.forEach((kind) => {
	const targets = ecosystemTransferTargetKinds(kind, KINDS);
	assert.strictEqual(targets.at(-1), kind, `${kind} can be copied into itself, and that entry is last`);
	assert.notStrictEqual(targets[0], kind, `${kind} is never the PRESELECTED target for itself`);
	assert.strictEqual(new Set(targets).size, targets.length, `${kind} offers every layer exactly once`);
});

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

// The source's own layer is a target like any other since 2026-08-06 -- everything else about the plan
// stays as it is: the Art still comes from the form, and the wiki article still travels with the name.
const sameLayerPlan = ecosystemTransferPlan({
	area: SOURCE,
	targetKind: "vegetation",
	newRegionName: "Farindel (Kopie)",
	newRegionType: "wald",
	kinds: KINDS,
});

assert.strictEqual(sameLayerPlan.error, undefined, "copying into the source's own layer produces a plan");
assert.strictEqual(sameLayerPlan.createRegion.kind, "vegetation", "and the new region is created in that same layer");
assert.strictEqual(sameLayerPlan.createRegion.wiki_url, "", "renamed, so the article stays with the source");
assert.notStrictEqual(sameLayerPlan.geometry, SOURCE.geometry, "still a deep copy, not a shared reference");

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
	["topographie", "derographisch", "vegetation"],
	"and the remaining order is the one the twin rule above decided"
);
assert.deepStrictEqual(
	ecosystemTransferTargetKinds("klima", KINDS_MIT_KLIMA),
	[],
	"a climate band cannot be copied anywhere -- not into another layer and not into its own"
);

// ---- „Originalfläche löschen" (2026-08-06) ----------------------------------------------------------
// Der Haken macht aus dem Kopieren ein Verschieben: erst schreiben, dann löschen. Die Reihenfolge ist
// nicht verhandelbar (siehe die Datei), und die Anforderung ans Löschen kommt aus dem Flächenmenü.

const SOURCE_MIT_ZAEHLERN = { ...SOURCE, region_area_count: 1, region_label_count: 2 };

const verschiebePlan = ecosystemTransferPlan({
	area: SOURCE,
	targetKind: "topographie",
	newRegionName: "Farindel",
	deleteSource: true,
	kinds: KINDS,
});

assert.strictEqual(verschiebePlan.error, undefined, "mit Haken entsteht ein Plan");
assert.deepStrictEqual(
	verschiebePlan.deleteSource,
	{ public_id: "eca_source", expected_revision: 3 },
	"und er trägt die Löschanforderung der QUELLE, mit deren geometry_revision"
);

assert.strictEqual(
	ecosystemTransferPlan({ area: SOURCE, targetKind: "topographie", newRegionName: "Farindel", kinds: KINDS }).deleteSource,
	null,
	"ohne Haken wird nichts gelöscht -- und zwar als null, nicht als fehlendes Feld"
);

// 💣 Eine Fläche ohne geometry_revision kann nicht gelöscht werden (delete_area antwortet 400). Der Plan
// muss das SAGEN, nicht still kopieren und den Haken verschlucken -- sonst glaubt der Editor, verschoben
// zu haben, und das Original liegt noch da.
assert.ok(
	ecosystemTransferPlan({
		area: { ...SOURCE, geometry_revision: undefined },
		targetKind: "topographie",
		newRegionName: "Farindel",
		deleteSource: true,
		kinds: KINDS,
	}).error !== undefined,
	"Haken gesetzt, aber nicht löschbar: ein Fehler statt eines halben Vorgangs"
);

// Dieselbe Fläche OHNE Haken bleibt kopierbar -- die fehlende Revision ist nur fürs Löschen ein Problem.
assert.strictEqual(
	ecosystemTransferPlan({
		area: { ...SOURCE, geometry_revision: undefined },
		targetKind: "topographie",
		newRegionName: "Farindel",
		kinds: KINDS,
	}).error,
	undefined,
	"ohne Haken stört eine fehlende Revision nicht"
);

// 💣 Fehlt das Flächenmenü ganz (Ladereihenfolge), wird NICHT geraten. Eine hier nachgebaute zweite
// expected_revision-Regel ist genau die Doppelung, die der gemeinsame Helfer verhindern soll.
const merken = global.AvesmapsEcosystemAreaMenu;
delete global.AvesmapsEcosystemAreaMenu;
assert.ok(
	ecosystemTransferPlan({ area: SOURCE, targetKind: "topographie", newRegionName: "F", deleteSource: true, kinds: KINDS }).error !== undefined,
	"ohne den Helfer des Flächenmenüs wird der Haken zum Fehler, nicht zur eigenen Regel"
);
global.AvesmapsEcosystemAreaMenu = merken;

// ---- was der Haken ankündigt ------------------------------------------------------------------------
// Derselbe Satz, den die Löschen-Rückfrage zeigt -- geholt, nicht nachgeschrieben.

assert.strictEqual(
	ecosystemTransferDeleteNote(SOURCE_MIT_ZAEHLERN, "", true),
	nachbar.formatEcosystemAreaDeleteConsequence(SOURCE_MIT_ZAEHLERN, true),
	"die Notiz IST der Folgesatz des Flächenmenüs"
);

assert.ok(
	ecosystemTransferDeleteNote(SOURCE_MIT_ZAEHLERN, "", true).includes("verschwinden mit"),
	"letzte Fläche, Kaskade an: Region und Labels gehen mit -- und das steht da"
);

// 🪤 Zielregion = Quellregion. Dann ist die Quelle beim Löschen NICHT mehr die letzte Fläche ihrer
// Region: die Kopie liegt schon darin. „Die Region verschwindet mit" wäre schlicht falsch.
assert.strictEqual(
	ecosystemTransferDeleteNote(SOURCE_MIT_ZAEHLERN, SOURCE_MIT_ZAEHLERN.region_public_id, true),
	"",
	"in die eigene Region kopiert und das Original gelöscht: an der Region ändert sich nichts"
);

assert.strictEqual(ecosystemTransferDeleteNote(null, "", true), "", "ohne Fläche keine Ankündigung");

// ---- die Meldung danach -----------------------------------------------------------------------------
// Mit Haken ist es kein Kopieren mehr, sondern ein Verschieben. Die Meldung sagt, was geschehen IST.

assert.ok(
	formatEcosystemTransferSuccess("Topographie", "Farindel", true).includes("verschoben"),
	"mit gelöschtem Original heisst es verschoben"
);
assert.ok(
	!formatEcosystemTransferSuccess("Topographie", "Farindel", false).includes("verschoben"),
	"ohne bleibt es eine Kopie"
);
assert.ok(
	formatEcosystemTransferSuccess("Topographie", "Farindel", true).includes("Farindel"),
	"und beide Fassungen nennen weiterhin die Zielregion"
);

console.log("ecosystem-transfer.test.js: all assertions passed");

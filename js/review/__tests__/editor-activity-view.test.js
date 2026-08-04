// 🪤 No "use strict" here, deliberately: in strict mode eval() gets its OWN variable scope, so the
// functions extracted below never reach this file and every check dies with "not defined".
//
// Extracts the two pure view functions from the real source file and checks their contract.
// Nothing is re-implemented here: a rebuilt copy would pass while the shipped file is broken.
// Run from the repo root:  node js/review/__tests__/editor-activity-view.test.js

const fs = require("fs");
const src = fs.readFileSync("js/review/review-panels.js", "utf8");
// avesmapsTerritoryWriteState lives with the territory surface, not the panel: the standalone
// editor page needs it and loads none of review-panels.js.
const claimSrc = fs.readFileSync("js/territory/territory-claim-view.js", "utf8");

function extract(name, source, where) {
	const from = source || src;
	const match = from.match(new RegExp("function " + name + "\\b[\\s\\S]*?\\n\\}"));
	if (!match) {
		console.error("FAIL: " + name + " not found in " + (where || "js/review/review-panels.js"));
		process.exit(1);
	}
	return match[0];
}

// The label table is a const the functions close over, so it has to come along.
const areaLabels = src.match(/const AVESMAPS_EDITOR_AREA_LABELS = \{[\s\S]*?\n\};/);
if (!areaLabels) {
	console.error("FAIL: AVESMAPS_EDITOR_AREA_LABELS not found in js/review/review-panels.js");
	process.exit(1);
}

// One eval, not three: `const` never escapes an eval scope (unlike a function declaration, which
// does in sloppy mode). Evaluating the table separately would leave the extracted function unable
// to see it. Together, the function closes over it and still reaches this file.
//
// controlled: the input is our own repo file, and this is a throwaway harness
eval([
	areaLabels[0],
	extract("avesmapsFormatEditorActivity"),
	extract("avesmapsTerritoryWriteState", claimSrc, "js/territory/territory-claim-view.js"),
].join("\n"));

let failed = 0;
const check = (label, ok) => {
	console.log((ok ? "  PASS  " : "  FAIL  ") + label);
	if (!ok) failed++;
};

// --- the meta-line suffix -----------------------------------------------------------------
check("no area -> nothing appended, the line stays exactly as before",
	avesmapsFormatEditorActivity({ is_online: true, activity_area: null }) === "");
check("offline users report nothing, however stale the area column is",
	avesmapsFormatEditorActivity({ is_online: false, activity_area: "territories", activity_label: "Kosch" }) === "");
check("area alone renders the German editor name",
	avesmapsFormatEditorActivity({ is_online: true, activity_area: "paths" }) === "Wege");
check("area plus label renders both",
	avesmapsFormatEditorActivity({ is_online: true, activity_area: "territories", activity_label: "Fürstentum Kosch" }) === "Territorien: Fürstentum Kosch");
check("an unknown area falls back to nothing rather than printing a raw key",
	avesmapsFormatEditorActivity({ is_online: true, activity_area: "kitchen" }) === "");
check("a missing user object does not throw",
	avesmapsFormatEditorActivity(undefined) === "");

// --- the territory write state ------------------------------------------------------------
check("nobody holds the tree -> I may write",
	avesmapsTerritoryWriteState(null).canWrite === true);
check("I hold it myself -> I may write",
	avesmapsTerritoryWriteState({ is_mine: true, username: "Valentin", seconds_since_activity: 60 }).canWrite === true);

const blocked = avesmapsTerritoryWriteState({ is_mine: false, username: "Valentin", seconds_since_activity: 900 });
check("someone else holds it -> read only", blocked.canWrite === false);
check("the holder's name travels, so the banner can name them", blocked.holderName === "Valentin");
check("the age travels, so the banner can say since when", blocked.sinceSeconds === 900);

// A malformed answer must not silently lock the editor for everyone: unknown -> allow, and let
// the server's 409 be the authority. The opposite default would turn one bad response into an
// outage that looks exactly like the feature working.
check("undefined claim -> may write", avesmapsTerritoryWriteState(undefined).canWrite === true);
check("garbage claim -> may write", avesmapsTerritoryWriteState({}).canWrite === true);
check("a string instead of an object -> may write", avesmapsTerritoryWriteState("locked").canWrite === true);

// A blocking claim with no username still has to render something -- an empty banner reading
// " bearbeitet gerade die Territorien" would look like a bug.
check("a nameless holder still gets a readable label",
	avesmapsTerritoryWriteState({ is_mine: false }).holderName === "Ein anderer Editor");

// --- work done on the map, not in a window --------------------------------------------------
// Together with its table, for the same reason as above: a const does not escape an eval scope, so
// the function would be evaluated without the lookup it closes over.
const mapModeTable = src.match(/const AVESMAPS_MAP_MODE_AREAS = \{[\s\S]*?\n\};/);
if (!mapModeTable) {
	console.error("FAIL: AVESMAPS_MAP_MODE_AREAS not found in js/review/review-panels.js");
	process.exit(1);
}
eval([mapModeTable[0], extract("avesmapsMapWorkActivityFor")].join("\n"));
const KINDS = { derographisch: "Derographie", vegetation: "Vegetation", topographie: "Topographie", klima: "Klimazonen" };

check("drawing climate zones reports the landscape layer and which one",
	JSON.stringify(avesmapsMapWorkActivityFor("ecosystem", "klima", KINDS)) === JSON.stringify({ area: "ecosystem", label: "Klimazonen" }));
check("...and the same for vegetation",
	avesmapsMapWorkActivityFor("ecosystem", "vegetation", KINDS).label === "Vegetation");
check("an unknown landscape kind still reports the layer, just without a name",
	JSON.stringify(avesmapsMapWorkActivityFor("ecosystem", "quatsch", KINDS)) === JSON.stringify({ area: "ecosystem", label: null }));
check("missing label table does not throw",
	avesmapsMapWorkActivityFor("ecosystem", "klima", null).area === "ecosystem");

// EVERY mode the picker offers is reported. The standard map especially: places, ways and markers
// are created there, so "nothing next to the name" would hide the most common work in the app.
[["political", "political_map"], ["powerlines", "powerlines"], ["deregraphic", "standard_map"],
	["original", "original_map"], ["none", "plain_map"]].forEach(([mode, area]) => {
	check(`map mode "${mode}" is reported as ${area}`, avesmapsMapWorkActivityFor(mode, "", KINDS).area === area);
});
check("a layer with no sub-layer carries no label",
	avesmapsMapWorkActivityFor("political", "klima", KINDS).label === null);

// Every mode the picker actually offers must be covered -- read from index.html, not from a list
// repeated here, so adding an option to the dropdown without a mapping fails loudly.
const modeOptions = [...fs.readFileSync("index.html", "utf8")
	.match(/<select id="mapLayerModeSelect"[\s\S]*?<\/select>/)[0]
	.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
check(`all ${modeOptions.length} picker options have a mapping (${modeOptions.join(", ")})`,
	modeOptions.every((m) => Boolean(avesmapsMapWorkActivityFor(m, "", KINDS).area)));

// 💣 THE rule that must never soften: reporting is not claiming. The write claim is keyed on the
// area code "territories". If a map mode could emit that code, anyone who merely switched the
// political layer on would take the claim and lock every other editor out of saving -- a read
// action causing a write outage. Only the territory EDITOR may ever report it.
check("no map mode can ever report territories -- that code belongs to the editor alone",
	["political", "powerlines", "ecosystem", "none", "original", "deregraphic", "", "quatsch"]
		.every((m) => avesmapsMapWorkActivityFor(m, "klima", KINDS).area !== "territories"));

// An unknown mode reports nothing rather than inventing an area code.
["", "quatsch", "hexgrid"].forEach((mode) => {
	check(`unknown map mode "${mode}" reports nothing`, avesmapsMapWorkActivityFor(mode, "klima", KINDS).area === null);
});

// --- the gate on political area actions -------------------------------------------------------
eval([claimSrc.match(/const AVESMAPS_TERRITORY_READONLY_ACTIONS = \[[\s\S]*?\];/)[0],
	extract("avesmapsTerritoryEditBlockedByFor", claimSrc, "js/territory/territory-claim-view.js")].join("\n"));

const otherHolds = { is_mine: false, username: "Valentin", seconds_since_activity: 60 };
["edit-geometry", "edit-properties", "move", "split", "extract", "delete", "union", "difference", "intersection"].forEach((a) => {
	check(`action "${a}" is blocked while someone else holds the claim`, avesmapsTerritoryEditBlockedByFor(a, otherHolds) === "Valentin");
});
check("show-info stays allowed -- looking is never blocked", avesmapsTerritoryEditBlockedByFor("show-info", otherHolds) === "");
check("nobody holds it -> nothing is blocked", avesmapsTerritoryEditBlockedByFor("delete", null) === "");
check("I hold it myself -> nothing is blocked", avesmapsTerritoryEditBlockedByFor("delete", { is_mine: true }) === "");

// --- the two lists that must not drift ------------------------------------------------------
// Read a `const X = {...}` table out of the source as a VALUE. Evaluating the declaration itself
// would not help: a const never escapes its eval scope, so it would be invisible down here.
function extractTable(name) {
	const match = src.match(new RegExp("const " + name + " = (\\{[\\s\\S]*?\\n\\});"));
	if (!match) {
		console.error("FAIL: " + name + " not found in js/review/review-panels.js");
		process.exit(1);
	}
	return eval("(" + match[1] + ")"); // controlled: our own repo file, throwaway harness
}

const overlayAreas = extractTable("AVESMAPS_EDITOR_OVERLAY_AREAS");
const mapModeAreas = extractTable("AVESMAPS_MAP_MODE_AREAS");
const areaLabelTable = extractTable("AVESMAPS_EDITOR_AREA_LABELS");

// Every overlay id in the table has to be an id something actually assigns. A typo here fails
// silently -- the editor simply never reports itself, and nobody notices until two people collide.
const overlaySources = ["js/review/review-ecosystem-list.js", "js/review/review-path-editor-list.js",
	"js/review/review-powerline-list.js", "js/review/review-settlement-list.js",
	"js/review/review-wiki-sync.js", "js/territory/territory-editor-link.js", "index.html"]
	.map((path) => fs.readFileSync(path, "utf8")).join("\n");
Object.keys(overlayAreas).forEach((id) => {
	check(`overlay id "${id}" is really assigned somewhere`, overlaySources.includes(id));
});

// The client's area codes have to match the server's whitelist verbatim. A mismatch is invisible:
// avesmapsNormalizeEditorActivityArea turns an unknown code into NULL, so the editor reports
// itself, the server accepts the request, and the activity just never appears.
const phpSrc = fs.readFileSync("api/_internal/map/editor-activity.php", "utf8");
const phpAreas = (phpSrc.match(/const AVESMAPS_EDITOR_ACTIVITY_AREAS = \[[\s\S]*?\];/) || [""])[0];
// Both sources of area codes: the editor windows AND the map layers worked on without one.
const clientAreas = [...new Set([...Object.values(overlayAreas), ...Object.values(mapModeAreas)])].sort();
clientAreas.forEach((area) => {
	check(`area "${area}" is on the server whitelist too`, phpAreas.includes(`'${area}'`));
});

// And the other way round: a server area nobody on the client ever sends is dead vocabulary.
// Deduplicated: this compares SETS, and a quoted code inside a comment in that block would
// otherwise show up as a phantom duplicate.
const serverAreas = [...new Set([...phpAreas.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))].sort();
check("both lists describe exactly the same set of areas",
	JSON.stringify(serverAreas) === JSON.stringify(clientAreas));

// The label table must cover every area, or an editor reports itself and renders as nothing.
const labelKeys = Object.keys(areaLabelTable).sort();
check("every area has a German label", JSON.stringify(labelKeys) === JSON.stringify(clientAreas));

// --- the load-order trap this feature already fell into once ---------------------------------
// The first version had territory-editor-link.js subscribe at load time. index.html loads it at
// position 35 and review-panels.js at 54, so the registry did not exist yet, the typeof guard
// declined silently, and the banner never appeared -- the feature was entirely mute while every
// unit test passed. The fix was to resolve the target by name at CALL time. Guard that it stays
// that way, and that the file it points at really defines it.
const applyBlock = extract("avesmapsApplyTerritoryClaim");
check("the heartbeat calls applyPoliticalTerritoryClaim by name, not through a load-time registry",
	applyBlock.includes("applyPoliticalTerritoryClaim"));
check("...and that function really exists in territory-claim-view.js",
	/function applyPoliticalTerritoryClaim\b/.test(claimSrc));

// index.html must still load the shared file, or both territory surfaces lose the banner.
check("index.html loads territory-claim-view.js",
	fs.readFileSync("index.html", "utf8").includes("js/territory/territory-claim-view.js"));
check("the standalone editor page loads it too",
	fs.readFileSync("html/political-territory-editor.html", "utf8").includes("/js/territory/territory-claim-view.js"));

console.log(failed === 0 ? "\nALL PASSED" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

// Unit test (Node, no build) for the WikiSync subject registry in js/review/review-subjects.js.
// The registry is the single source for which subjects exist, what they can do and how their
// list divides. Loaded as a browser script into a vm context, same pattern as the sibling tests.
//
// Run: node tools/paths/test-review-subjects.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const context = vm.createContext({});
vm.runInContext(readFileSync(path.join(repoRoot, "js", "review", "review-subjects.js"), "utf8"), context);

// Arrays that cross out of the vm carry the OTHER realm's Array.prototype, and deepStrictEqual
// compares prototypes -- so a correct result fails the comparison with an identical-looking
// literal. `local()` copies them back into this realm; without it every deepEqual below is a
// false alarm about nothing.
const local = (value) => Array.from(value);
const subjects = local(vm.runInContext("WIKI_SYNC_SUBJECTS", context));
const byKey = (k) => vm.runInContext(`wikiSyncSubjectByKey(${JSON.stringify(k)})`, context);
const known = (k) => vm.runInContext(`wikiSyncIsKnownSubject(${JSON.stringify(k)})`, context);
const verbs = (k) => local(vm.runInContext(`wikiSyncSubjectVerbs(${JSON.stringify(k)})`, context));
const views = (k) => local(vm.runInContext(`wikiSyncSubjectViewTabs(${JSON.stringify(k)})`, context));

// --- the eight subjects, in display order -----------------------------------------------
assert.deepEqual(
	subjects.map((s) => s.key),
	["locations", "territories", "regions", "paths", "powerlines", "adventures", "citymaps", "lore"],
	"subject order drives the two-column grid and must stay stable",
);

// --- keys the old hardcoded whitelist did not know --------------------------------------
// These three were sub-tabs or had no tab at all. If any of them is not "known", clicking it
// silently falls back to Siedlungen -- exactly the class of bug this registry removes.
["powerlines", "citymaps", "lore"].forEach((key) => {
	assert.equal(known(key), true, `${key} must be a known subject`);
});
assert.equal(known("adventures"), true);
assert.equal(known("materials"), false, "the junk-drawer key must not come back");
assert.equal(known(""), false);
assert.equal(known(null), false);

// --- verbs: four subjects have no list editor -------------------------------------------
// Owner-confirmed 2026-07-22 (spec §5). No dead second button -- Syncen carries the row alone.
["territories", "regions", "paths", "powerlines"].forEach((key) => {
	assert.deepEqual(verbs(key).map((v) => v.label), ["Syncen"], `${key} has no list editor`);
});
["locations", "adventures", "citymaps", "lore"].forEach((key) => {
	assert.deepEqual(verbs(key).map((v) => v.label), ["Syncen", "Bearbeiten"], `${key} has an editor`);
});
assert.equal(verbs("locations")[0].primary, true, "Syncen is the filled button");
assert.equal(verbs("locations")[1].id, "settlement-editor-open", "verb must name the real button id");
assert.equal(verbs("paths").length, 1);

// --- view tabs: from the real renderers, see spec §5 ------------------------------------
assert.deepEqual(views("paths").map((v) => v.label),
	["Alle", "Platziert", "Fehlt", "Konflikte", "Flussrichtung unbekannt"]);
assert.deepEqual(views("locations").map((v) => v.label), ["Alle", "Platziert", "Fehlt"]);
assert.deepEqual(views("lore").map((v) => v.label), ["Alle", "Fauna", "Flora", "Waren", "Spezies"]);
assert.deepEqual(views("lore").map((v) => v.key), ["all", "fauna", "flora", "ware", "spezies"]);
assert.deepEqual(views("adventures"), [], "no invented empty 'Alle' where there are no views");
assert.deepEqual(views("powerlines"), []);
assert.deepEqual(views("nonsense"), [], "unknown key must not throw");

// --- Spezies is off in public, but stays editable ---------------------------------------
const spezies = views("lore").find((v) => v.key === "spezies");
assert.equal(spezies.off, true, "greyed out, not removed");
assert.ok(spezies.reason && spezies.reason.length > 20, "a greyed tab must say why");

// --- the sync-kind mapping (NOT in the instruction; the rail needs it) -------------------
// The rail shows a "last synced" date per subject, but the server answers keyed by SYNC KIND
// (avesmapsWikiDumpSyncKindLastSynced -> settlement|path|region|territory|adventure|citymap),
// which is singular and spelled differently from the subject key. Looking the date up by
// subject key would miss every single one and render "—" in all eight rows -- a status board
// that silently shows nothing. The mapping therefore belongs in the registry, next to the data
// it maps. `null` means "the server has no kind for this subject" and must stay honest: there
// is no powerline or lore key in AVESMAPS_WIKI_DUMP_SYNC_KINDS.
const syncKind = (k) => vm.runInContext(`wikiSyncSubjectSyncKind(${JSON.stringify(k)})`, context);
assert.equal(syncKind("locations"), "settlement");
assert.equal(syncKind("territories"), "territory");
assert.equal(syncKind("regions"), "region");
assert.equal(syncKind("paths"), "path");
assert.equal(syncKind("adventures"), "adventure");
assert.equal(syncKind("citymaps"), "citymap");
assert.equal(syncKind("powerlines"), null, "the server knows no powerline kind -- do not invent one");
assert.equal(syncKind("lore"), null, "the server knows no lore kind -- do not invent one");
assert.equal(syncKind("nonsense"), null);

console.log("review-subjects: OK");

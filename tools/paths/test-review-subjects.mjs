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
const buttonId = (k) => vm.runInContext(`wikiSyncSubjectButtonId(${JSON.stringify(k)})`, context);
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

// --- ONE button per subject, and it is the one that already exists ----------------------
// Owner 2026-07-22, correcting an earlier build of this: a "Syncen | Bearbeiten" PAIR showed
// every subject's button twice (once new, once as the old tile below it) and, for the four
// subjects whose editor owns their sync, put a Syncen back in the panel that had deliberately
// been taken out of it. Rule: editor button where there is one, sync button otherwise.
assert.equal(buttonId("locations"), "settlement-editor-open");
assert.equal(buttonId("territories"), "wiki-sync-territories");
assert.equal(buttonId("adventures"), "adventure-editor-open");
assert.equal(buttonId("citymaps"), "citymaps-editor-open");
assert.equal(buttonId("lore"), "wiki-sync-lore-open");
// The three without a list editor fall through to their sync button.
assert.equal(buttonId("regions"), "wiki-sync-sync-region");
assert.equal(buttonId("paths"), "wiki-sync-sync-path");
assert.equal(buttonId("powerlines"), "wiki-sync-powerlines-sync");
assert.equal(buttonId("nonsense"), null, "unknown key must not throw");

// Karten is the one subject with no panel sync button at all -- its sync lives entirely inside
// the citymap editor. Naming a button here that does not exist is how a dead control gets built.
assert.equal(byKey("citymaps").syncButtonId, null, "Karten has no sync button in the panel");

// Every id the registry names must exist in index.html. This is the check that would have caught
// wiki-sync-sync-citymap, which the instruction named and the markup never had.
const markup = readFileSync(path.join(repoRoot, "index.html"), "utf8");
subjects.forEach((subject) => {
	[subject.syncButtonId, subject.editorButtonId].filter(Boolean).forEach((id) => {
		assert.ok(markup.includes(`id="${id}"`), `${subject.key} names button #${id}, which is not in index.html`);
	});
});

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

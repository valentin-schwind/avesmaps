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
// "lore" is answered by the lore catalogue itself (api/app/lore.php -> last_synced), not by the
// dump endpoint; loadLoreList feeds it into the same map. Powerlines have no source at all, and
// null has to stay null there -- a rail that invents a date claims a sync nobody ran.
assert.equal(syncKind("lore"), "lore");
assert.equal(syncKind("powerlines"), null, "nothing answers for powerlines -- do not invent one");
assert.equal(syncKind("nonsense"), null);

// --- Facetten: FELD und BESCHRIFTUNG, niemals Werte -------------------------------------
// Das ist die Regel, die diese Datei durchsetzen muss. Eine feste Werteliste in der Registry
// bietet Werte an, die es nicht gibt, und verschluckt echte -- der Abenteuereditor fuehrt genau
// das vor (seine EDITIONS-Liste endet bei DSA5 und kennt DSA4.1 nicht, obwohl der Bestand es hat).
const facets = (k) => local(vm.runInContext(`wikiSyncSubjectFacets(${JSON.stringify(k)})`, context));
const facetKeys = (k) => facets(k).map((f) => f.key);

assert.deepEqual(facetKeys("locations"), ["type", "continent", "source", "coat", "image"],
	"der Satz ist der des Siedlungseditors -- Fenster und Panel duerfen nicht zwei Fragen stellen");
assert.deepEqual(facetKeys("adventures"), ["type", "edition", "region", "cover", "fshop"]);
assert.deepEqual(facetKeys("citymaps"), ["paid", "scale", "preview", "thumbOrigin"]);

// Kraftlinien bewusst ohne Filter (61 Namen, Owner 2026-07-22); Vorkommen, weil seine Liste
// serverseitig seitenweise kommt und eine Facette hier nur das geladene Fenster saehe.
assert.deepEqual(facets("powerlines"), [], "Kraftlinien bekommen absichtlich keinen Filter");
assert.deepEqual(facets("lore"), [], "Vorkommen braucht serverseitige Facetten, nicht diese");
assert.deepEqual(facets("nonsense"), [], "unbekannter Schluessel darf nicht werfen");

// Die Kernregel, maschinell geprueft: kein Facetteneintrag darf Werte mitbringen.
["locations", "adventures", "citymaps"].forEach((key) => {
	facets(key).forEach((facet) => {
		["values", "options", "choices"].forEach((forbidden) => {
			assert.ok(!(forbidden in facet),
				`${key}.${facet.key} traegt "${forbidden}" -- Werte kommen aus den Daten, nie von hier`);
		});
		assert.ok(facet.label && facet.label.length > 0, `${key}.${facet.key} braucht eine Beschriftung`);
		assert.ok(["multi", "flag", "tri", "source"].includes(facet.kind),
			`${key}.${facet.key} hat die unbekannte Art "${facet.kind}"`);
		// "source" liest mehrere Felder (getItemSourceCategory) und traegt deshalb keins.
		assert.equal(facet.field === "", facet.kind === "source",
			`${key}.${facet.key}: nur die Quelle-Facette darf ohne Feld auskommen`);
	});
});

// Die dreiwertigen Karten-Spalten muessen dreiwertig BLEIBEN: NULL heisst dort "weiss niemand".
// Als "flag" gefaltet behauptete der Filter, jemand haette "nein" geprueft.
assert.equal(facets("citymaps").find((f) => f.key === "paid").kind, "tri");
assert.equal(facets("citymaps").find((f) => f.key === "scale").kind, "tri");

// --- die Menue-Huellen, die das Markup stellen muss --------------------------------------
// Gleiche Absicherung wie bei den Knopf-ids oben: eine Facette, deren Abschnitt es im Markup
// nicht gibt, rendert lautlos ins Nichts -- der Trichter zaehlt sie dann, zeigt aber nichts an.
// Siedlungen tragen ihre Abschnitte noch als festes Markup; Abenteuer und Karten bekommen nur
// die leere Huelle, die wikiSyncBuildFacetMenu aus der Registry fuellt.
facetKeys("locations").forEach((key) => {
	assert.ok(markup.includes(`id="settlement-${key}-filter-menu"`),
		`Siedlungs-Facette ${key} hat keinen Abschnitt in index.html`);
});
[["adv", "wiki-sync-adv"], ["cm", "wiki-sync-cm"]].forEach(([, prefix]) => {
	assert.ok(markup.includes(`id="${prefix}-filter-toggle"`), `${prefix}: Trichter fehlt in index.html`);
	assert.ok(markup.includes(`id="${prefix}-filter-menu"`), `${prefix}: Menue-Huelle fehlt in index.html`);
});

// --- Ladereihenfolge: die Registry vor ihren Lesern -------------------------------------
// review-settlement-list.js und review-wiki-sync.js rufen wikiSyncSubjectFacets() schon beim
// AUSWERTEN auf (die Beschriftungen der Filterabschnitte stehen in der Registry). Stand sie
// darunter -- so war es bis 2026-07-23 --, warf das Listenmodul beim Laden und fiel als Ganzes
// aus: keine Siedlungsliste, keine Abenteuerliste, keine Kartenliste. Ohne DB faellt so etwas
// beim Entwickeln nicht auf, weil die Listen ohnehin leer bleiben.
const scriptPos = (file) => markup.indexOf(`src="${file}"`);
assert.ok(scriptPos("js/review/review-subjects.js") > 0, "review-subjects.js fehlt in index.html");
["js/review/review-settlement-list.js", "js/review/review-wiki-sync.js"].forEach((reader) => {
	assert.ok(scriptPos(reader) > 0, `${reader} fehlt in index.html`);
	assert.ok(
		scriptPos("js/review/review-subjects.js") < scriptPos(reader),
		`review-subjects.js muss VOR ${reader} geladen werden -- sonst wirft dessen Auswertung`,
	);
});

console.log("review-subjects: OK");

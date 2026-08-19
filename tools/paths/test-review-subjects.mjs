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
assert.equal(buttonId("adventures"), "game-literature-editor-open");
assert.equal(buttonId("citymaps"), "citymaps-editor-open");
assert.equal(buttonId("lore"), "wiki-sync-lore-open");
// 🪤 These three read "the ones without a list editor" until 2026-08-19 -- they all have one
// now (Landschaften, Wege, Kraftlinien each grew theirs), and this file has been RED ever since:
// the CI gate globs `js tools -path '*__tests__*' -name '*.test.js'`, which matches neither the
// .mjs suffix nor this directory, so nothing ever ran it. The RULE above is unchanged; only its
// examples had moved. Territories is now the only subject that still falls through to its sync
// button.
assert.equal(buttonId("regions"), "ecosystem-editor-open");
assert.equal(buttonId("paths"), "path-editor-open");
assert.equal(buttonId("powerlines"), "powerline-editor-open");
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

// --- no lore tab is greyed any more (spezies freed 2026-08-19) --------------------------
// The `off`/`reason` pair stays a registry OPTION -- it just has no user right now. Whoever marks
// a tab off again must supply the reason with it: a greyed surface without one gets flipped back
// by the next person "tidying up".
views("lore").forEach((view) => {
	assert.ok(!view.off, `no lore view is off: ${view.key}`);
	assert.ok(!view.reason, `and none carries a leftover reason: ${view.key}`);
});

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
// 🪤 Also stale, same reason as the button ids above: powerlines DOES record a reconcile
// timestamp now (avesmapsWikiPowerlineLastSynced, wired into avesmapsWikiDumpSyncKindLastSynced),
// so it carries a syncKind. The registry comment above WIKI_SYNC_SUBJECTS says so verbatim.
assert.equal(syncKind("powerlines"), "powerline");
assert.equal(syncKind("nonsense"), null);

// --- Facetten: FELD und BESCHRIFTUNG, niemals Werte -------------------------------------
// Das ist die Regel, die diese Datei durchsetzen muss. Eine feste Werteliste in der Registry
// bietet Werte an, die es nicht gibt, und verschluckt echte -- der Abenteuereditor fuehrt genau
// das vor (seine EDITIONS-Liste endet bei DSA5 und kennt DSA4.1 nicht, obwohl der Bestand es hat).
const facets = (k) => local(vm.runInContext(`wikiSyncSubjectFacets(${JSON.stringify(k)})`, context));
const facetKeys = (k) => facets(k).map((f) => f.key);

// 🪤 Stale again: "Lage" (scope, innerorts/ausserorts) and "Art" (buildingType, the Besondere
// Staetten weiche) joined the settlement editor after this line was written. The RULE is what
// this file guards -- field and label, never values -- not the length of the list.
assert.deepEqual(facetKeys("locations"), ["type", "continent", "scope", "buildingType", "source", "coat", "image"],
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
// 🪤 Der Schluessel der Registry ist NICHT die id im Markup, und der rohe Schluessel ist
// KEINE der beiden Ableitungen, die das Haus benutzt:
//   Siedlungen (festes Markup)     camelCase -> kebab-case   buildingType -> building-type
//   Abenteuer/Karten (Generator)   key.toLowerCase()         thumbOrigin  -> thumborigin
// Bis 2026-08-19 setzte diese Zeile den rohen Schluessel ein und meldete deshalb, der
// Abschnitt "settlement-buildingType-filter-menu" fehle. Er fehlt nicht -- er heisst
// "settlement-building-type-filter-menu" und steht als "↳ Art (nur Bauwerke)" im Markup,
// gezeichnet in review-settlement-list.js und im Trichter gezaehlt. Dass "scope" einwortig
// ist und unter allen drei Schreibweisen gleich aussieht, hat den Fehler verdeckt.
const settlementMenuId = (key) => `settlement-${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}-filter-menu`;
const settlementListSource = readFileSync(path.join(repoRoot, "js", "review", "review-settlement-list.js"), "utf8");
facetKeys("locations").forEach((key) => {
	const menuId = settlementMenuId(key);
	assert.ok(markup.includes(`id="${menuId}"`),
		`Siedlungs-Facette ${key} hat keinen Abschnitt #${menuId} in index.html`);
	// Die Huelle allein genuegt nicht: gezeichnet wird ueber dieselbe id (renderTypeFilter)
	// und GEZAEHLT wird ueber sie im Trichter (attachFilterMenu). Steht sie dort nicht, ist
	// der Abschnitt zwar da, aber niemand fuellt oder zaehlt ihn -- genau das lautlose Nichts,
	// das dieser Block verhindern soll, nur eine Ebene tiefer als das blosse Markup.
	assert.ok(settlementListSource.includes(`"${menuId}"`),
		`review-settlement-list.js nennt #${menuId} nicht -- Registry und Renderer laufen auseinander`);
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

const assert = require("assert");

// The context-menu module is one IIFE, so its helpers are only reachable through module.exports. The
// three below are the ones that carry a decision; everything else in that file is DOM wiring that needs
// Leaflet, a document and a live map, and is verified in the browser instead (plan, global rule 7).
const {
	addHereMenuVisibility,
	ecosystemAreaDeleteRequest,
	formatEcosystemAreaDeleteConfirmation,
	formatEcosystemAreaDeleteConsequence,
} = require("../map-features-ecosystem-context-action.js");

// ---- "Hier hinzufuegen": was in welcher ANSICHT angeboten wird -----------------------------------
//
// 🔴 Owner 14.08.2026: man legt an, was man SIEHT. Vier Ansichten, vier Listen -- und die Listen sind
// die Abnahmebedingung, wortwoertlich so vom Owner genannt.
//
// 🔴 DAMIT FAELLT DIE ALTE ZUSICHERUNG, die genau hier stand: die drei "Neue ..."-Eintraege waren
// bewusst NICHT an ihre Ansicht gebunden, weil sie der Weg IN die Ebene waren. Der Test behauptete
// das Gegenteil dessen, was jetzt gilt -- er ist nicht angepasst worden, weil er stoerte, sondern
// weil die Regel gewechselt hat. Wer ihn wieder umdreht, dreht eine Owner-Entscheidung um.

const sichtbar = (ergebnis) => Object.entries(ergebnis).filter(([, v]) => v).map(([k]) => k).sort();
const voll = { isEditMode: true, isEcosystemEnabled: true };

assert.deepStrictEqual(
	sichtbar(addHereMenuVisibility({ mode: "political", ...voll })),
	["createRegion"],
	"politische Ansicht: NUR Neues Herrschaftsgebiet"
);

// 🔴 LANDSCHAFTEN TRAEGT SEIT 31.08.2026 AUCH DIE KARTEN-EINTRAEGE (Owner: „das bearbeiten von wegen
// durch das kontextmenue wieder zulassen"). Gemeldet als „im Landschaftsmodus lassen sich Wege nicht
// mehr per Rechtsklick bearbeiten" -- und im Nachsatz: „auch das Standard-Kontextmenue ‚Hier
// hinzufuegen' ist verschwunden".
//
// 💣 DAS IST FALL #90 EINE ANSICHT WEITER, und die Begruendung ist dieselbe: „man legt an, was man
// SIEHT" wurde am Frontend gemessen und auf den EDITOR uebertragen, wo sie nicht gilt. Im Editor zeigt
// der Landschaftsmodus die Wege sehr wohl -- applyFrontendLayerModeDefaults (mit `ecosystem: { wege:
// false }`) steigt bei IS_EDIT_MODE sofort aus, und ecosystemFrontendProfile() gibt dem Editor
// ausdruecklich `null` („NUR DER BESUCHER. Der Editor behaelt in JEDER Ebene seine Haken").
// Ein Editor sah dort Wege, an die er nicht mehr herankam -- „Neue Kreuzung und Weg teilen" ist der
// EINZIGE Weg, einen Weg zu teilen.
//
// ⚠️ „Neuer Ort"/„Neue Kreuzung" sind Owner-Entscheid vom 31.08.2026 („wie die Standardansicht") und
// die eine Stelle, an der die Regel bewusst nicht gilt: die Ebene nimmt die Ortsklassen zurueck
// (syncEcosystemSettlementVisibility, Owner 04.08.2026), ein frisch angelegter Ort ist also zunaechst
// unsichtbar. Der Ortsschalter holt ihn mit einem Klick zurueck; er wird NICHT zwangsweise gehalten.
assert.deepStrictEqual(
	sichtbar(addHereMenuVisibility({ mode: "ecosystem", ...voll, activeKind: "vegetation" })),
	["createCrossing", "createLabel", "createLocation", "createPath", "importTerritory", "newArea", "splitPathAtNode"].sort(),
	"Landschaften: die Ebenen-Eintraege UND die Karten-Eintraege der Standardansicht"
);

// 💣 UND SIE UEBERLEBEN „Alle". Dort faellt `landscapeAllowed` weg, also verschwanden bis zum
// 31.08.2026 alle drei Landschafts-Eintraege -- und mit ihnen die GANZE Gruppe samt Ueberschrift
// (syncMapContextMenuEntries blendet sie aus, wenn kein Eintrag uebrig ist). Genau das war der zweite
// Teil der Meldung. Die Karten-Eintraege haengen NICHT an `landscapeAllowed`, weil „Alle" die Wege
// zeigt wie jede andere Ansicht.
assert.deepStrictEqual(
	sichtbar(addHereMenuVisibility({ mode: "ecosystem", ...voll, activeKind: "topographie", showAll: true })),
	["createCrossing", "createLabel", "createLocation", "createPath", "splitPathAtNode"].sort(),
	'„Alle": keine Landschafts-Eintraege, aber die Gruppe bleibt -- die Karten-Eintraege tragen sie'
);

assert.deepStrictEqual(
	sichtbar(addHereMenuVisibility({ mode: "deregraphic", ...voll })),
	["createCrossing", "createLabel", "createLocation", "createPath", "splitPathAtNode"].sort(),
	"Standard: Ort, Kreuzung, Weg, freies Label (+ die kontextabhaengige Wegteilung)"
);

assert.deepStrictEqual(
	sichtbar(addHereMenuVisibility({ mode: "powerlines", ...voll })),
	["createCrossing", "createLabel", "createLocation"].sort(),
	"Kraftlinien: Ort, Kreuzung, freies Label -- KEIN Weg, den zeigt diese Ansicht nicht"
);

// 💣 Faengt den Rueckfall auf die alte Regel an der Stelle, an der er sich am ehesten einschleicht:
// jemand haelt einen der Eintraege wieder fuer den "Weg in seine Ebene".
["deregraphic", "powerlines", "political"].forEach((mode) => {
	const s = sichtbar(addHereMenuVisibility({ mode, ...voll }));
	assert.ok(!s.includes("newArea"), `${mode}: keine Landschafts-Eintraege -- man legt an, was man sieht`);
	assert.ok(!s.includes("importTerritory"), `${mode}: auch kein Territorien-Import`);
});
assert.ok(!sichtbar(addHereMenuVisibility({ mode: "ecosystem", ...voll })).includes("createRegion"),
	"Landschaften: kein Neues Herrschaftsgebiet");

// 🪤 HIER STAND, "Original" und "Nur Karte" zeigten weder Orte noch Wege -- die Begruendung nannte
// eine Tabelle MAP_LAYER_MODE_FEATURES, die es im Repo nicht gibt. Am Livebestand gemessen
// (23.08.2026) verhaelt sich "Original" bei Orten und Wegen wie die Standardansicht; nur
// "Kraftlinien" nimmt die Wege weg. Gemeldet als Fall #90: dort liess sich kein Weg teilen, weil
// die leere Liste die ganze Gruppe wegnahm.
assert.deepStrictEqual(
	sichtbar(addHereMenuVisibility({ mode: "original", ...voll })),
	["createCrossing", "createLocation", "createPath", "splitPathAtNode"].sort(),
	"Original: Ort, Kreuzung, Weg (+ die kontextabhaengige Wegteilung) -- die Ansicht zeigt beides"
);
// 🔴 KEIN freies Label in "Original": MAP_LABEL_MODES (js/config.js) kennt nur deregraphic und
// ecosystem, die Labels sind dort per Vorgabe aus. Man legt an, was man SIEHT.
assert.ok(!sichtbar(addHereMenuVisibility({ mode: "original", ...voll })).includes("createLabel"),
	"Original: kein freies Label -- die Ansicht blendet die Labels per Vorgabe aus");

// "Nur Karte" bleibt vorerst leer (Owner-Entscheid steht aus, siehe Kommentar an der Tabelle).
assert.deepStrictEqual(sichtbar(addHereMenuVisibility({ mode: "none", ...voll })), [],
	"Nur Karte: gar nichts anzulegen -- die Gruppe faellt weg");

// ---- DIE NAHT: jeder Tabellen-Eintrag muss im DOM auch EXISTIEREN ---------------------------------
//
// 💣 Die Tabelle nennt Aktionsnamen, `syncMapContextMenuEntries` sucht sie per
// `[data-context-action="…"]` im Untermenue -- und ein `querySelector`, der nichts findet, tut
// KOMMENTARLOS nichts. Ein Tippfehler oder ein umbenannter Knopf ist damit ununterscheidbar von „diese
// Ansicht bietet das nicht an": beide Haelften waeren gruen, die Naht dazwischen ungeprueft.
// ⚠️ Nur die Karten-Eintraege: `new-area`, `new-peak` und `import-territory` stehen NICHT in
// index.html, sie werden von ensureNewAreaMenuEntries zur Laufzeit eingehaengt.
const fs = require("fs");
const path = require("path");
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "..", "..", "index.html"), "utf8");
const alleModi = ["political", "ecosystem", "deregraphic", "powerlines", "original", "none"];
const dynamisch = new Set(["new-area", "new-peak", "import-territory"]);
const genannteAktionen = new Set();
alleModi.forEach((mode) => {
	// Der Schluesselname der Sichtbarkeit -> der Aktionsname im DOM. Beide Richtungen stehen in der
	// Datei; hier wird der DOM-Name gebraucht, also aus dem Schluessel zurueckgerechnet.
	Object.entries(addHereMenuVisibility({ mode, ...voll, activeKind: "topographie" }))
		.filter(([, v]) => v)
		.forEach(([schluessel]) => {
			genannteAktionen.add(schluessel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`));
		});
});
assert.ok(genannteAktionen.size >= 8, `die Tabelle nennt ${genannteAktionen.size} Aktionen -- zu wenige, die Umrechnung stimmt nicht`);
genannteAktionen.forEach((aktion) => {
	if (dynamisch.has(aktion)) {
		return;
	}
	assert.ok(indexHtml.includes(`data-context-action="${aktion}"`),
		`"${aktion}" steht in der Tabelle, aber es gibt keinen Knopf dafuer in index.html -- der Eintrag waere lautlos wirkungslos`);
});

// ---- "Hoehenpunkt setzen" (V8) --------------------------------------------------------------------
// 🔴 Er haengt ZUSAETZLICH zur Ansicht an EINER Ebene: nur in der Topographie ist ein Gipfel sichtbar,
// ziehbar und wirksam (oekosystem-editor-leitfaden.md §1.4).

assert.ok(addHereMenuVisibility({ mode: "ecosystem", ...voll, activeKind: "topographie" }).newPeak,
	"Topographie: der Gipfel-Eintrag wird angeboten");
assert.ok(!addHereMenuVisibility({ mode: "ecosystem", ...voll, activeKind: "vegetation" }).newPeak,
	"Vegetation: kein Gipfel -- er modulierte dort nichts");
// 🪤 Die gemerkte Ebene allein genuegt nicht: sie sagt auch in der politischen Ansicht "topographie".
assert.ok(!addHereMenuVisibility({ mode: "political", ...voll, activeKind: "topographie" }).newPeak,
	"gemerkte Ebene ohne die Ansicht: kein Gipfel");

// ---- die zwei Riegel, die ueber der Ansicht stehen ------------------------------------------------
// ?landschaften=1 fehlt -> setSelectedMapLayerMode wuerde den Modus verweigern; ein Eintrag, der ihn
// anboete, liesse den Editor still in der Standardansicht landen.
// 🔴 SEIT 31.08.2026 SPERREN DIESE ZWEI RIEGEL NUR NOCH DIE DREI LANDSCHAFTS-EINTRAEGE. Vorher stand
// hier zweimal `[]`, und das war nur wahr, solange die Ansicht ausschliesslich Landschafts-Eintraege
// trug. Die Karten-Eintraege haengen an der ANSICHT, genau wie in „Standard" und „Original" -- ihr
// Riegel ist die Gruppe, nicht die Tabelle (siehe die politische Zeile darunter, dieselbe Bauart).
const ohneEbenenFlag = sichtbar(addHereMenuVisibility({ mode: "ecosystem", isEditMode: true, isEcosystemEnabled: false }));
assert.deepStrictEqual(
	ohneEbenenFlag,
	["createCrossing", "createLabel", "createLocation", "createPath", "splitPathAtNode"].sort(),
	"Ebenen-Flag aus: keine Landschafts-Eintraege, aber die Karten-Eintraege der Ansicht"
);
["newArea", "newPeak", "importTerritory"].forEach((eintrag) => {
	assert.ok(!ohneEbenenFlag.includes(eintrag),
		`Ebenen-Flag aus: kein ${eintrag} -- setSelectedMapLayerMode wuerde den Modus verweigern`);
});
const ohneEditMode = sichtbar(addHereMenuVisibility({ mode: "ecosystem", isEditMode: false, isEcosystemEnabled: true }));
["newArea", "newPeak", "importTerritory"].forEach((eintrag) => {
	assert.ok(!ohneEditMode.includes(eintrag),
		`kein Bearbeiten-Modus: kein ${eintrag}`);
});
// Ein Besucher sieht die Gruppe ohnehin nie (bootstrap.js nimmt ihr das `hidden` nur im Edit-Modus) --
// dies ist der zweite Riegel. Die POLITISCHE Zeile haengt allein an der Ansicht, das ist Absicht:
// ihr Riegel ist die Gruppe, nicht die Tabelle.
assert.deepStrictEqual(
	sichtbar(addHereMenuVisibility({ mode: "political", isEditMode: false, isEcosystemEnabled: true })),
	["createRegion"],
	"ohne Bearbeiten-Modus bleibt die politische Zeile in der Tabelle -- die Gruppe darueber sperrt"
);

assert.deepStrictEqual(
	sichtbar(addHereMenuVisibility()),
	[],
	"ohne Argumente: zeigt nichts, statt beim Rechtsklick zu werfen"
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

// 💣 UNBEKANNTES FLAG (null) wird wie EIN behandelt, nicht wie AUS. Das Flag reist mit den Flächen,
// und die lädt nur die Landschaftsebene -- ausserhalb davon ist `null` der Normalfall. Die beiden
// Fehlrichtungen sind nicht gleich teuer: zu viel ankündigen kostet einen Schreck, zu wenig eine
// Region, die wortlos verschwindet.
const letzteFlagUnbekannt = formatEcosystemAreaDeleteConfirmation({
	public_id: "eca_123", region_name: "Farindel", kind: "vegetation", region_area_count: 1, region_label_count: 2,
}, null);
assert.ok(letzteFlagUnbekannt.includes("verschwinden mit"), "unbekanntes Flag warnt");
assert.ok(!letzteFlagUnbekannt.includes("bleibt bestehen"), "und beruhigt gerade nicht");
assert.strictEqual(
	letzteFlagUnbekannt,
	formatEcosystemAreaDeleteConfirmation({ public_id: "eca_123", region_name: "Farindel", kind: "vegetation", region_area_count: 1, region_label_count: 2 }, true),
	"unbekannt liest sich wie eingeschaltet"
);

const namelessConfirmation = formatEcosystemAreaDeleteConfirmation({ public_id: "eca_9" }, true);
assert.ok(namelessConfirmation.includes("Ohne Namen"), "a region without a name still produces a sentence");
assert.ok(!namelessConfirmation.includes("()"), "and no empty bracket where the kind label would be");

// ---- the consequence on its own (2026-08-06) ------------------------------------------------------
// "Kopieren ..." shows the same consequence next to its "Originalfläche löschen" checkbox. Two sentences
// about one event drift apart the moment somebody touches only one of them -- so the sentence IS the
// function, and the confirmation above is merely its first caller.

const AREA_LAST = { public_id: "eca_123", region_name: "Farindel", kind: "vegetation", region_area_count: 1, region_label_count: 2 };

// 💣 The assertion that keeps the two in step. Without it the split is cosmetic: the confirmation could
// grow a different wording and nothing here would notice.
[
	[AREA_LAST, true],
	[AREA_LAST, false],
	[{ ...AREA_LAST, region_area_count: 3 }, true],
	[{ public_id: "eca_9", region_name: "Farindel", kind: "vegetation" }, true],
].forEach(([area, kaskade]) => {
	const folge = formatEcosystemAreaDeleteConsequence(area, kaskade);
	assert.ok(
		formatEcosystemAreaDeleteConfirmation(area, kaskade).endsWith(folge),
		`the confirmation ends on exactly this consequence (kaskade=${kaskade}, count=${area.region_area_count})`
	);
});

assert.ok(
	!formatEcosystemAreaDeleteConsequence(AREA_LAST, true).includes("wirklich löschen?"),
	"the consequence carries no question of its own -- the head belongs to the caller"
);

assert.strictEqual(
	formatEcosystemAreaDeleteConsequence({ public_id: "eca_9", region_name: "Farindel", kind: "vegetation" }, false),
	"",
	"unknown count and no cascade: nothing to say, and an empty string rather than a guess"
);

assert.ok(
	formatEcosystemAreaDeleteConsequence(AREA_LAST, true).includes("2 Labels"),
	"the cascade case still names the labels"
);
assert.ok(
	formatEcosystemAreaDeleteConsequence(AREA_LAST, false).includes("die Region bleibt bestehen"),
	"and the switched-off case still says the region survives"
);

console.log("ecosystem-context-menu.test.js: all assertions passed");

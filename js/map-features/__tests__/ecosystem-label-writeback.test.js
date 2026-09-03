const assert = require("assert");

const {
	ecosystemRegionWriteBackPayload,
	formatEcosystemLabelDeleteConfirmation,
} = require("../map-features-ecosystem-label-writeback.js");

const region = {
	public_id: "r1",
	kind: "vegetation",
	name: "Farindel",
	region_type: "wald",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Farindel",
};
const vokabular = [{ type_key: "wald" }, { type_key: "steppe" }, { type_key: "tundra" }];

// --------------------------------------------------------------------------- NICHTS ZU TUN ---
// Ein blosses Öffnen und Speichern schreibt nichts. Ohne diese Regel liefe bei jedem Label-Save ein
// update_region mit -- und jedes davon bumpt die Ebenen-Revision und verwirft alle Zwischenspeicher.
assert.strictEqual(
	ecosystemRegionWriteBackPayload(
		{ text: "Farindel", labelType: "wald", wikiRegion: { wiki_url: region.wiki_url } },
		region,
		vokabular
	),
	null
);

// Ein Label ohne Fläche hat keine Gegenseite.
assert.strictEqual(ecosystemRegionWriteBackPayload({ text: "Perricum" }, null, vokabular), null);
assert.strictEqual(ecosystemRegionWriteBackPayload({ text: "Perricum" }, {}, vokabular), null);

// ---------------------------------------------------------------------------------- NAME ---
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindelwald", labelType: "wald" }, region, vokabular),
	{ public_id: "r1", name: "Farindelwald" }
);

// 🪤 Ein LEERER Labeltext macht die Region nicht namenlos. Das Formular verlangt ihn ohnehin; käme er
// hier trotzdem leer an, wäre "Region heisst jetzt nichts" die teuerste mögliche Auslegung.
assert.strictEqual(ecosystemRegionWriteBackPayload({ text: "   ", labelType: "wald" }, region, vokabular), null);

// ----------------------------------------------------------------------------------- ART ---
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "steppe" }, region, vokabular),
	{ public_id: "r1", region_type: "steppe" }
);

// 🔴 `region` ist beim LABEL der neutrale Subtyp („keine Art") und heisst an der Region der leere Wert.
// Ein Label ohne Subtyp hätte keinen Stil und bliebe ungezeichnet, deshalb gibt es dort kein Leer.
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "region" }, region, vokabular),
	{ public_id: "r1", region_type: "" }
);
// Und die Gegenprobe: eine Region, die schon keine Art hat, bekommt von einem neutralen Label nichts.
assert.strictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "region" }, { ...region, region_type: null }, vokabular),
	null
);

// 💣 EINE EBENENFREMDE ART WIRD NICHT GESCHICKT. avesmapsEcosystemAssertRegionType antwortet
// serverseitig mit 400, wenn `gebirge` an einer Vegetationsregion landet -- und der Label-Dialog kann
// so eine Art anbieten ("(fremde Art)", Altbestand oder Ebenenwechsel). Ungeprüft weitergereicht hiesse:
// ein Label speichern, das gespeichert IST, und danach eine Fehlermeldung sehen.
assert.strictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "gebirge" }, region, vokabular),
	null
);
// Der Name derselben Änderung geht trotzdem durch -- die fremde Art blockiert nur sich selbst.
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload({ text: "Anderswald", labelType: "gebirge" }, region, vokabular),
	{ public_id: "r1", name: "Anderswald" }
);
// Ohne bekanntes Vokabular (Liste noch nicht geladen) wird nicht blockiert: dann entscheidet der Server.
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "gebirge" }, region, null),
	{ public_id: "r1", region_type: "gebirge" }
);

// ------------------------------------------------------------------------ WIKI-LANDSCHAFT ---
// 🔴 SEIT 03.09.2026 NUR, WENN DIE ZUWEISUNG IN DIESEM SPEICHERN ANGEFASST WURDE (`wikiGeaendert`) --
// und dann in BEIDE Richtungen. Bis dahin wanderte die Adresse bei JEDEM Speichern hoch, sobald das
// Label eine trug, und nie herunter: im vereinigten Fenster schickt „Speichern" beide Formulare ab,
// die Fläche nahm die Zuweisung zurück, der Beschriftungs-Rumpf brachte sein geladenes Nest mit und
// dieser Weg trug es wieder an die Fläche. Das war „Lawaralîr"/„Cronwald".
const geaendert = { wikiGeaendert: true };
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload(
		{ text: "Farindel", labelType: "wald", wikiRegion: { wiki_url: "https://de.wiki-aventurica.de/wiki/Farindelwald" } },
		region,
		vokabular,
		geaendert
	),
	{ public_id: "r1", wiki_url: "https://de.wiki-aventurica.de/wiki/Farindelwald" }
);

// 💣 OHNE das Signal sagt eine Zuweisung am Label NICHTS über die Fläche -- weder eine vorhandene noch
// eine fehlende. Die Lücke „Label hat, Fläche nicht" heilt der Server abwärts bei jedem Speichern der
// Fläche; hier hochzuheilen war der Weg, auf dem eine gerade entfernte Zuweisung zurückkam.
assert.strictEqual(
	ecosystemRegionWriteBackPayload(
		{ text: "Farindel", labelType: "wald", wikiRegion: { wiki_url: "https://de.wiki-aventurica.de/wiki/Farindelwald" } },
		region,
		vokabular
	),
	null,
	"unangefasst wandert nichts hoch"
);
assert.strictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "wald", wikiRegion: null }, region, vokabular),
	null,
	"und unangefasst nimmt ein leeres Label der Fläche nichts weg"
);

// 🔴 DAS ENTFERNEN WANDERT MIT: angefasst und leer heisst „Fläche, gib deine auch her" -- die leere
// Adresse ist beim Server die Rücknahme (avesmapsEcosystemReadRegionFields), und er nimmt daraufhin
// auch den Geschwister-Beschriftungen ihre Kopie (avesmapsEcosystemClearWikiRegionFromLabels).
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "wald", wikiRegion: null }, region, vokabular, geaendert),
	{ public_id: "r1", wiki_url: "" }
);
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "wald", wikiRegion: { wiki_url: "  " } }, region, vokabular, geaendert),
	{ public_id: "r1", wiki_url: "" }
);
// Hat die Fläche ohnehin keine, gibt es nichts zurückzunehmen -- kein Rumpf, kein Revisionssprung.
assert.strictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "wald", wikiRegion: null }, { ...region, wiki_url: null }, vokabular, geaendert),
	null
);
// Und dieselbe Adresse noch einmal ist keine Änderung.
assert.strictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "wald", wikiRegion: { wiki_url: region.wiki_url } }, region, vokabular, geaendert),
	null
);

// 🔴 Es reist die URL, NICHT der Schlüssel -- wiki_region_key leitet der Server aus wiki_url ab
// (AGENTS.md §5). Ein Label, das nur einen Schlüssel trägt, hat keine Adresse -- und angefasst heisst
// das: es ist leer, die Fläche verliert ihre.
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "wald", wikiRegion: { wiki_key: "farindel" } }, region, vokabular, geaendert),
	{ public_id: "r1", wiki_url: "" }
);
// ⚠️ Nur `true` zählt -- ein durchgereichter Wahrheitswert-Ersatz ("1", {}) ist kein Signal.
assert.strictEqual(
	ecosystemRegionWriteBackPayload({ text: "Farindel", labelType: "wald", wikiRegion: null }, region, vokabular, { wikiGeaendert: "1" }),
	null
);

// -------------------------------------------------------------- DARSTELLUNG REIST NIE MIT ---
// Grösse, Drehung, Zoom-Band, Priorität und Nodix gehören dem einzelnen Label: ein zweites Label
// existiert gerade deshalb, weil es anders stehen soll.
assert.strictEqual(
	ecosystemRegionWriteBackPayload(
		{ text: "Farindel", labelType: "wald", size: 44, rotation: 90, minZoom: 3, maxZoom: 7, priority: 5, isNodix: true },
		region,
		vokabular
	),
	null
);

// ------------------------------------------------------------------------- ALLES AUF EINMAL ---
assert.deepStrictEqual(
	ecosystemRegionWriteBackPayload(
		{ text: "Steppe des Todes", labelType: "steppe", wikiRegion: { wiki_url: "https://x/y" } },
		region,
		vokabular,
		{ wikiGeaendert: true }
	),
	{ public_id: "r1", name: "Steppe des Todes", region_type: "steppe", wiki_url: "https://x/y" }
);

// ------------------------------------------------------------------- LÖSCH-RÜCKFRAGE ---
// 🔴 Sie ist die einzige Bremse vor einem serverseitigen Kaskadenlöschen: das letzte Label einer Fläche
// zu löschen nimmt die Fläche mit. Was sie verspricht, muss in jedem Zweig wahr sein.

// Ein gewöhnliches Label ohne Fläche behält die schlichte Rückfrage -- die grosse Mehrheit (580 von 590).
assert.strictEqual(formatEcosystemLabelDeleteConfirmation("Perricum", null, 0, true), "Perricum wirklich löschen?");
assert.strictEqual(formatEcosystemLabelDeleteConfirmation("Perricum", {}, 3, true), "Perricum wirklich löschen?");

// Mehrere Labels an derselben Fläche: die Fläche bleibt, und die Rückfrage sagt, was übrig bleibt.
const mehrere = formatEcosystemLabelDeleteConfirmation("Finsterkamm", { name: "Finsterkamm", area_count: 2 }, 3, true);
assert.ok(mehrere.includes("2 weitere Labels"), "nennt, was der Fläche bleibt");
assert.ok(!mehrere.includes("LETZTE"), "und behauptet nicht, es sei das letzte");

const nurNochEins = formatEcosystemLabelDeleteConfirmation("Finsterkamm", { name: "Finsterkamm", area_count: 2 }, 2, true);
assert.ok(nurNochEins.includes("1 weiteres Label"), "eines übrig liest sich im Singular");

// 💣 DAS LETZTE. Am Live-Bestand trägt fast jede Region genau ein Label -- das ist der Normalfall.
const letztes = formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 3 }, 1, true);
assert.ok(letztes.includes("LETZTE"), "das letzte Label sagt es");
assert.ok(letztes.includes("3 Flächen"), "und nennt, wie viele Flächen mitgehen");

const letztesEineFlaeche = formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 1 }, 1, true);
assert.ok(letztesEineFlaeche.includes("ihre Fläche"), "eine Fläche liest sich im Singular");

// Eine Region ohne Fläche (alle weggezeichnet): kein „0 Flächen", nur die Region.
const ohneFlaeche = formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 0 }, 1, true);
assert.ok(ohneFlaeche.includes("die Region verschwindet mit"), "ohne Fläche geht nur die Region");
assert.ok(!ohneFlaeche.includes("0 Fläche"), "und nie eine Null");

// 🪤 0 heisst UNBEKANNT, nicht „keines": das Label, um das es geht, zählt selbst mit. Keine Entwarnung.
const unbekannt = formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 2 }, 0, true);
assert.ok(unbekannt.includes("Ist es das letzte"), "unbekannte Zahl lässt die Folge offen");
assert.ok(!unbekannt.includes("behält"), "und gibt keine Entwarnung");

// Ein Label ohne Text ist ein gültiger Zustand und braucht trotzdem eine lesbare Frage.
assert.ok(formatEcosystemLabelDeleteConfirmation("", null, 0, true).startsWith("Dieses Label"));

// 🔴 KASKADE AUS (der ausgelieferte Zustand). Dann bleibt die Fläche stehen -- unbeschriftet, aber da.
const letztesOhneKaskade = formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 3 }, 1, false);
assert.ok(letztesOhneKaskade.includes("LETZTE"), "es bleibt das letzte Label");
assert.ok(letztesOhneKaskade.includes("die Fläche bleibt bestehen"), "aber die Fläche geht NICHT mit");
assert.ok(!letztesOhneKaskade.includes("verschwinden mit"), "kein angekündigtes Mitlöschen");

// Mehrere Labels: der Schalter ändert daran nichts.
assert.strictEqual(
	formatEcosystemLabelDeleteConfirmation("F", { name: "F", area_count: 2 }, 3, false),
	formatEcosystemLabelDeleteConfirmation("F", { name: "F", area_count: 2 }, 3, true),
	"solange etwas übrig bleibt, sagt der Schalter nichts dazu"
);

// Unbekannte Zahl UND Kaskade aus: keine Behauptung über die Fläche.
const unbekanntOhneKaskade = formatEcosystemLabelDeleteConfirmation("F", { name: "F", area_count: 2 }, 0, false);
assert.strictEqual(unbekanntOhneKaskade, "F wirklich löschen?", "ohne belastbare Zahl nur die Frage");

// 💣 Unbekanntes Flag (null) warnt, statt zu beruhigen -- und AUSSERHALB der Landschaftsebene ist das
// der Normalfall: ein Label löscht man überall, das Flag reist aber mit den Flächen.
const letztesFlagUnbekannt = formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 3 }, 1, null);
assert.ok(letztesFlagUnbekannt.includes("verschwinden mit"), "unbekanntes Flag warnt");
assert.ok(!letztesFlagUnbekannt.includes("bleibt bestehen"), "und beruhigt gerade nicht");
assert.strictEqual(
	letztesFlagUnbekannt,
	formatEcosystemLabelDeleteConfirmation("Farindel", { name: "Farindel", area_count: 3 }, 1, true),
	"unbekannt liest sich wie eingeschaltet"
);

console.log("ecosystem-label-writeback tests passed");

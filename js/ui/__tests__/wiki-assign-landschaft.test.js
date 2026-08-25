// Die LANDSCHAFT als Objektart mit ZWEI Oberflaechen und einer eigenen Falle (Aufgabe 6).
//
// 🔴 Was hier festgenagelt wird, und jedes davon ist gemessen, nicht vermutet:
//   1. DIE ART-REGEL. Es gab sie in DREI Fassungen mit ZWEI Zielvokabularen (Kopf von
//      js/ui/wiki-assign-landschaft.js). Die Server-Tabelle bildet `Schlucht => tal` ab -- die
//      Flaechenart `schlucht` entstand einen Tag NACH jener Zeile. Wer die Server-Regel blind
//      spiegelt, macht aus einer Wiki-Schlucht auf der Karte ein Tal. Die Ordnung „eigenes
//      Vokabular vor Server-Synonymen, und das Ergebnis MUSS eine Art dieser Ebene sein" ist
//      genau der Riegel dagegen, und sie ist hier in beiden Richtungen zugesichert.
//   2. DER SYNC UEBERSCHREIBT NICHT MEHR UNBEDINGT. `syncFromWikiRegion` setzte Name und Art ohne
//      Rueckfrage; jetzt kommt die Vorschau, und weil ein gefuellter Kartenwert nie vorangehakt
//      wird, oeffnet sie bei einer gepflegten Flaeche mit NULL Haken.
//   3. DER DRITTE ZUSTAND. Er liegt in `ecosystem_region.properties_json` -- die Spalte gab es
//      seit V2.3 und KEIN Leseweg gab sie heraus. Der Merker reist nur mit, wenn er seit dem Laden
//      veraendert wurde, in BEIDE Richtungen, und beide Oberflaechen schicken ihn.
//   4. `laden` LEHNT AB, statt etwas Leeres zu liefern -- und hier ist der Fehlerfall zum ersten
//      Mal echtes HTTP (der Staging-Schnappschuss).
//
// ⭐ Und die Lehre aus den Aufgaben 3-5 steht ueber allem: eine Textprobe misst die FORM des Codes,
// nicht sein Verhalten. Ab Teil 3 laufen die ECHTEN Oberflaechen in einem vm-Sandkasten mit
// untergeschobenem `fetch`; geklickt wird ueber die Zuhoerer, die `mount` selbst angehaengt hat.
//
// Run: node js/ui/__tests__/wiki-assign-landschaft.test.js
"use strict";

// 🔴 NACHGEZOGEN AM 25.08.2026: Name und Art der Flaeche sind in den GEMEINSAMEN KOPF des
// vereinigten Landschaftsfensters gezogen und heissen dort `label-edit-text` /
// `label-edit-type`. Das Flaechenmodul erreicht sie ueber AVESMAPS_ECO_ZWILLINGE; sein Code
// sagt weiter `propertiesElement("name")`. Geprueft wird hier unveraendert, WAS geschrieben
// wird -- nur die Kennung der Felder hat gewechselt.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const { AVESMAPS_WIKI_ASSIGN_REGISTRY } = require("../wiki-assign-registry.js");
const { avesmapsWikiAssignDiff } = require("../wiki-assign-diff.js");
const {
	AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER,
	AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER,
	avesmapsWikiAssignLandschaftslabelZustand,
	AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_ART_SYNONYME,
	avesmapsWikiAssignLandschaftArtErsteKomponente,
	avesmapsWikiAssignLandschaftArt,
	avesmapsWikiAssignLandschaftWerte,
	avesmapsWikiAssignLandschaftTreffer,
	avesmapsWikiAssignLandschaftArtikel,
	avesmapsWikiAssignLandschaftZustand,
	avesmapsWikiAssignLandschaftZuweisungsKoerper,
	avesmapsWikiAssignLandschaftAntwortPruefen,
	avesmapsWikiAssignLandschaftSyncWerte,
	avesmapsWikiAssignLandschaftSyncLeer,
} = require("../wiki-assign-landschaft.js");

// Im Browser legen die <script>-Zeilen diese Globalen an; `avesmapsWikiAssignMount` prueft BEIDE
// und liefert sonst nur einen Blindgaenger.
global.avesmapsWikiAssignSubject = require("../wiki-assign-registry.js").avesmapsWikiAssignSubject;
global.avesmapsWikiAssignDiff = avesmapsWikiAssignDiff;

const wurzel = path.resolve(__dirname, "..", "..", "..");
let checks = 0;
function zaehl() { checks++; }

// Das Art-Vokabular der drei Ebenen, WORTGLEICH aus AVESMAPS_ECOSYSTEM_REGION_TYPE_SEED
// (api/_internal/app/ecosystem.php:87-190). 🔴 Nicht ausgedacht: an genau diesen Schluesseln
// entscheidet sich, welche Wiki-Art ueberhaupt ankommt.
const TOPOGRAPHIE = [
	{ type_key: "gebirge", label: "Gebirge" }, { type_key: "see", label: "See" },
	{ type_key: "meer", label: "Meer" }, { type_key: "kueste", label: "Küste" },
	{ type_key: "huegelland", label: "Hügelland" }, { type_key: "wadi", label: "Wadi" },
	{ type_key: "schlucht", label: "Schlucht" }, { type_key: "hochebene", label: "Hochebene" },
	{ type_key: "tiefebene", label: "Tiefebene" }, { type_key: "tal", label: "Tal" },
	{ type_key: "flussdelta", label: "Flussdelta" }, { type_key: "insel", label: "Insel" },
];
const VEGETATION = [
	{ type_key: "wald", label: "Wald" }, { type_key: "suempfe_moore", label: "Sümpfe und Moore" },
	{ type_key: "steppe", label: "Steppe" }, { type_key: "tundra", label: "Tundra" },
	{ type_key: "auenlandschaft", label: "Auenlandschaft" }, { type_key: "wueste", label: "Wüste" },
	{ type_key: "graslandschaft", label: "Graslandschaft" },
	{ type_key: "flussland_flusstal", label: "Flussland/Flusstal" },
	{ type_key: "dschungel", label: "Dschungel" }, { type_key: "wuestenoase", label: "Wüstenoase" },
];
const DEROGRAPHISCH = [
	{ type_key: "region", label: "Region" }, { type_key: "inselgruppe", label: "Inselgruppe" },
	{ type_key: "kontinent", label: "Kontinent" }, { type_key: "sonstiges", label: "Sonstiges" },
];

// Eine Suchzeile, wie avesmapsWikiRegionSearch sie WIRKLICH liefert
// (api/_internal/wiki/regions.php:1090-1092) -- die 21 Spalten der Staging-Tabelle.
const SUCHZEILE = {
	wiki_key: "wiki:farindel",
	name: "Farindel",
	art: "Wald",
	continent: "Aventurien",
	region_parent: "Albernia",
	affiliation_staat: "Mittelreich",
	einwohner: "wenige",
	sprache: "Garethi",
	vegetation: "Mischwald",
	verkehrswege: "keine",
	description: "Der verwunschene Wald Alberniens.",
	image_url: "",
	wiki_url: "https://de.wiki-aventurica.de/wiki/Farindel",
	synced_at: "2026-08-16T00:00:00Z",
};

// ══ TEIL 1: die reinen Bausteine ══════════════════════════════════════════════════════════════

// ── 1) DIE ERSTE KOMPONENTE ───────────────────────────────────────────────────────────────────
// 💣 „Art=Tal|Grube" sind ZWEI Parameter fuer MediaWiki; der Server teilt an `|` UND `,`
// (avesmapsWikiRegionArtToSubtype). Ohne das trifft „Tal|Grube" nie den Typ „Tal".
assert.strictEqual(avesmapsWikiAssignLandschaftArtErsteKomponente("Tal|Grube"), "tal");
assert.strictEqual(avesmapsWikiAssignLandschaftArtErsteKomponente("Mischregion, Wald"), "mischregion");
assert.strictEqual(avesmapsWikiAssignLandschaftArtErsteKomponente("  Wald  "), "wald");
assert.strictEqual(avesmapsWikiAssignLandschaftArtErsteKomponente(""), "");
assert.strictEqual(avesmapsWikiAssignLandschaftArtErsteKomponente(null), "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 2) DIE ART-REGEL: EIGENES VOKABULAR VOR SERVER-SYNONYMEN ──────────────────────────────────
// 🔴 DIE ZUSICHERUNG, DIE DIE GANZE ENTSCHEIDUNG TRAEGT. Die Server-Tabelle sagt `Schlucht => tal`
// (api/_internal/wiki/regions.php:83, geschrieben am 27.07.2026). Die Flaechenart `schlucht`
// entstand am 28.07.2026 (ecosystem.php:115). Wer die Server-Regel blind spiegelt, schreibt auf
// jede Wiki-Schlucht ein Tal -- und die Ebene KENNT die Schlucht.
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Schlucht", TOPOGRAPHIE), "schlucht",
	"die Server-Synonymtabelle hat gewonnen -- aus einer Schlucht wird ein Tal");
// Die Gegenprobe zur selben Zeile: das Synonym GILT, wo die Ebene die Art selbst nicht kennt.
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Klamm", TOPOGRAPHIE), "tal");
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Talkessel", TOPOGRAPHIE), "tal");
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Flusstal", TOPOGRAPHIE), "tal");
zaehl(); zaehl(); zaehl(); zaehl();

// Schritt 1, exakt -- Beschriftung ODER Schluessel, ohne Gross-/Kleinschreibung.
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Wald", VEGETATION), "wald");
assert.strictEqual(avesmapsWikiAssignLandschaftArt("wald", VEGETATION), "wald");
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Hügelland", TOPOGRAPHIE), "huegelland");
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Tal|Grube", TOPOGRAPHIE), "tal");
zaehl(); zaehl(); zaehl(); zaehl();

// 🔴 DIE EBENE BINDET. `wald` ist Vegetation und darf nie auf einer topographischen Region landen;
// der Server antwortet auf ein fremdes Paar mit 400 (avesmapsEcosystemAssertRegionType).
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Wald", TOPOGRAPHIE), "",
	"eine Vegetationsart landet auf einer topographischen Region");
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Gebirge", VEGETATION), "");
zaehl(); zaehl();

// ⭐ SCHRITT 2: DIE ARTEN, DIE DER SYNC SEIT DEM 16.08.2026 NEU TRIFFT. Bis dahin liess er sie
// stehen (die Client-Regel verglich nur exakt gegen das Vokabular). Das IST die
// Verhaltensaenderung dieser Aufgabe, und sie steht hier namentlich statt als Zahl.
[
	["Mischregion", DEROGRAPHISCH, "region"], ["Großregion", DEROGRAPHISCH, "region"],
	["Halbinsel", DEROGRAPHISCH, "region"],
	["Hochland", TOPOGRAPHIE, "huegelland"], ["Klippe", TOPOGRAPHIE, "kueste"],
	["Meeresteil", TOPOGRAPHIE, "meer"], ["Meerenge", TOPOGRAPHIE, "meer"],
	["Bucht", TOPOGRAPHIE, "meer"], ["Golf", TOPOGRAPHIE, "meer"],
	["Seenlandschaft", TOPOGRAPHIE, "see"],
	["Sumpf", VEGETATION, "suempfe_moore"], ["Moor", VEGETATION, "suempfe_moore"],
	["Marschland", VEGETATION, "suempfe_moore"],
	["Halbwüste", VEGETATION, "wueste"],
].forEach(([art, vokabular, erwartet]) => {
	assert.strictEqual(avesmapsWikiAssignLandschaftArt(art, vokabular), erwartet,
		'„' + art + '" wird nicht mehr auf „' + erwartet + '" abgebildet');
	zaehl();
});

// 🔴 SCHRITT 3, DER RIEGEL: was die Server-Tabelle auf einen LABEL-Subtype abbildet, den es als
// Flaechenart nicht gibt, faellt heraus -- statt eine Art zu erfinden. `""` wird von der
// Diff-Rechnung zur Zeile „würde die Angabe leeren", und die ist NIE vorangehakt (Aufgabe 2).
["Ebene", "Tiefland", "Flachland", "Berggipfel", "Vulkan", "Fluss"].forEach((art) => {
	const alle = TOPOGRAPHIE.concat(VEGETATION).concat(DEROGRAPHISCH);
	assert.strictEqual(avesmapsWikiAssignLandschaftArt(art, alle), "",
		'„' + art + '" ergibt eine Flaechenart, die es nicht gibt');
	zaehl();
});
// Und eine Art, die niemand kennt, wird nicht geraten.
["Krater", "Handelsposten", "", null, undefined].forEach((art) => {
	assert.strictEqual(avesmapsWikiAssignLandschaftArt(art, TOPOGRAPHIE), "");
	zaehl();
});
// Ohne Vokabular gibt es keine Art -- nicht die erstbeste.
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Wald", []), "");
assert.strictEqual(avesmapsWikiAssignLandschaftArt("Wald", null), "");
zaehl(); zaehl();

// 💣 DIE SYNONYMTABELLE IST EINE ABSCHRIFT -- jede Umlaut-Art steht ZWEIMAL (mit und ohne Umlaut),
// weil der Server seine Schluessel faltet und der Browser das nicht tut. Faellt eine der zwei
// Schreibweisen weg, ist die andere lautlos tot.
[["hügelland", "hugelland"], ["küste", "kuste"], ["wüste", "wuste"], ["halbwüste", "halbwuste"],
	["großregion", "grossregion"]].forEach(([mitUmlaut, ohne]) => {
	assert.strictEqual(
		AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_ART_SYNONYME[mitUmlaut],
		AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_ART_SYNONYME[ohne],
		'„' + mitUmlaut + '" und „' + ohne + '" bilden nicht auf dasselbe ab'
	);
	assert.ok(AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_ART_SYNONYME[ohne], "die ASCII-Schreibweise fehlt: " + ohne);
	zaehl(); zaehl();
});

// ── 3) DIE WERTE ──────────────────────────────────────────────────────────────────────────────
const werteAusSuche = avesmapsWikiAssignLandschaftWerte(SUCHZEILE, VEGETATION);
assert.strictEqual(werteAusSuche.name, "Farindel");
assert.strictEqual(werteAusSuche.art, "Wald");
assert.strictEqual(werteAusSuche.landschaftsart, "wald", "die abgeleitete Flaechenart fehlt");
assert.strictEqual(werteAusSuche.region_parent, "Albernia");
assert.strictEqual(werteAusSuche.affiliation_staat, "Mittelreich");
assert.strictEqual(werteAusSuche.continent, "Aventurien");
// 🔴 Die Feldnamen sind die der SPALTEN. Wer hier „lage"/„staat"/„kontinent" hineinuebersetzt,
// bricht die Deckung mit dem Register und mit Pruefung 2 aus §3b.
assert.ok(!("lage" in werteAusSuche) && !("staat" in werteAusSuche) && !("kontinent" in werteAusSuche),
	"die Werte tragen uebersetzte Namen -- das Register erklaert die Spaltennamen");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 4) DER TREFFER ────────────────────────────────────────────────────────────────────────────
const treffer = avesmapsWikiAssignLandschaftTreffer(SUCHZEILE, VEGETATION);
assert.strictEqual(treffer.wiki_key, "wiki:farindel");
assert.strictEqual(treffer.wiki_url, SUCHZEILE.wiki_url);
assert.strictEqual(treffer.werte.landschaftsart, "wald");
// 🔴 Die rohe Zeile reist mit: der Flaechen-Dialog legt daraus sein `pendingWikiRegion` an, und der
// Label-Durchtrag braucht Beschreibung und Staat, die im Kasten selbst gar nicht stehen.
assert.strictEqual(treffer.roh, SUCHZEILE, "die rohe Suchzeile reist nicht mit");
zaehl(); zaehl(); zaehl(); zaehl();

// ── 5) DER ARTIKEL AUS ZUWEISUNG + SCHNAPPSCHUSS ──────────────────────────────────────────────
assert.strictEqual(avesmapsWikiAssignLandschaftArtikel(null, null, VEGETATION), null);
assert.strictEqual(avesmapsWikiAssignLandschaftArtikel({}, null, VEGETATION), null,
	"eine Region ohne Adresse und ohne Schluessel ist keine Zuweisung -- ein gueltiger Zustand");
const artikel = avesmapsWikiAssignLandschaftArtikel(
	{ wiki_key: "wiki:farindel", wiki_url: SUCHZEILE.wiki_url, name: "Farindel-Nord" },
	SUCHZEILE, VEGETATION
);
assert.strictEqual(artikel.name, "Farindel", "der Name kommt aus dem Wiki, nicht aus der Region");
assert.strictEqual(artikel.werte.landschaftsart, "wald");
assert.strictEqual(artikel.werte.sprache, "Garethi");
// ⚠️ Ein VERWAISTER Schluessel (die Wiki-Seite gibt es nicht mehr) ist kein Fehler: der Kasten
// steht mit Adresse und Schluessel da, die Anzeige-Zeilen fallen weg.
const verwaist = avesmapsWikiAssignLandschaftArtikel(
	{ wiki_key: "wiki:weg", wiki_url: "https://x/wiki/Weg", name: "Restname" }, null, VEGETATION
);
assert.ok(verwaist && verwaist.wiki_key === "wiki:weg", "ein verwaister Schluessel verschwindet");
assert.strictEqual(verwaist.name, "Restname", "ohne Schnappschuss traegt der Regionsname den Kasten");
assert.strictEqual(verwaist.werte.art, "");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 6) DER VERTRAG: `laden` LEHNT AB, STATT ETWAS LEERES ZU LIEFERN ───────────────────────────
[null, undefined, [], 5, "x"].forEach((kaputt) => {
	assert.throws(() => avesmapsWikiAssignLandschaftZustand(kaputt),
		"avesmapsWikiAssignLandschaftZustand(" + JSON.stringify(kaputt) + ") liefert einen Zustand, statt zu werfen");
	zaehl();
});
const ohne = avesmapsWikiAssignLandschaftZustand({ arten: VEGETATION, name: "Wald-001", region_type: "wald" });
assert.strictEqual(ohne.artikel, null);
assert.strictEqual(ohne.kartenwerte.name, "Wald-001");
assert.strictEqual(ohne.kartenwerte.region_type, "wald");
assert.strictEqual(ohne.keinArtikel, false);
assert.deepStrictEqual(ohne.gesperrt, {}, "eine gewoehnliche Ebene hat keine gesperrte Zeile");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// 🔴 DER DRITTE ZUSTAND IST NICHT AUS DER ZUWEISUNG ABLEITBAR, und nur ein ausdrueckliches `true`
// setzt ihn.
assert.strictEqual(avesmapsWikiAssignLandschaftZustand({ kein_artikel: true }).keinArtikel, true);
["", 0, "true", null, undefined].forEach((weich) => {
	assert.strictEqual(avesmapsWikiAssignLandschaftZustand({ kein_artikel: weich }).keinArtikel, false,
		"ein weicher Wert (" + JSON.stringify(weich) + ") setzt den Merker");
	zaehl();
});
zaehl();

// 🔴 DIE KLIMAZONE: ihre ART steht fest, ihr NAME nicht. Der Riegel gehoert an die ZEILE, nicht an
// den Knopf -- ein Knopfriegel naehme den Namen mit. Der Server lehnt das andere ohnehin ab
// (avesmapsUpdateEcosystemRegion, ecosystem.php).
const klima = avesmapsWikiAssignLandschaftZustand({ kind: "klima", arten: [], name: "Gemäßigt", region_type: "gemaessigt" });
assert.ok(klima.gesperrt.region_type, "die Art einer Klimazone ist nicht gesperrt");
assert.ok(!("name" in klima.gesperrt), "der NAME einer Klimazone ist gesperrt -- er darf es nicht sein");
zaehl(); zaehl();

// 💣 LESEFUNKTIONEN: der Kartenwert wird beim LESEN geholt, nicht beim Laden eingefroren.
let formularName = "Wald-001";
const lebend = avesmapsWikiAssignLandschaftZustand({ arten: VEGETATION, name: () => formularName, region_type: () => "wald" });
assert.strictEqual(lebend.kartenwerte.name, "Wald-001");
formularName = "Farindel";
assert.strictEqual(lebend.kartenwerte.name, "Farindel",
	"der Kartenwert ist eingefroren -- die Sync-Vorschau vergliche gegen einen Stand, den das Formular nicht mehr zeigt");
zaehl(); zaehl();

// ── 7) DIE HTTP-ANTWORT UND DER ZUWEISUNGSRUMPF ───────────────────────────────────────────────
assert.throws(() => avesmapsWikiAssignLandschaftAntwortPruefen({ ok: false, error: { message: "forbidden" } }), /forbidden/);
assert.throws(() => avesmapsWikiAssignLandschaftAntwortPruefen(null));
assert.throws(() => avesmapsWikiAssignLandschaftAntwortPruefen([]));
const gut = { ok: true, rows: [] };
assert.strictEqual(avesmapsWikiAssignLandschaftAntwortPruefen(gut), gut);
const koerper = avesmapsWikiAssignLandschaftZuweisungsKoerper("r1", SUCHZEILE.wiki_url);
assert.deepStrictEqual(koerper, { public_id: "r1", wiki_url: SUCHZEILE.wiki_url });
// 🔴 NIEMALS der Schluessel: der Server leitet ihn aus der Adresse ab, ein mitgeschickter wird gar
// nicht gelesen und waere eine zweite Ableitung (AGENTS.md §5).
assert.ok(!("wiki_region_key" in koerper) && !("wiki_key" in koerper),
	"der Rumpf traegt einen Schluessel -- der Server leitet ihn ab");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── 8) DIE UEBERNAHME LIEST NUR ANGEHAKTE ZEILEN ──────────────────────────────────────────────
const KEINE_UEBERNAHME = {};
AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER.forEach((feld) => { KEINE_UEBERNAHME[feld] = null; });
assert.deepStrictEqual(avesmapsWikiAssignLandschaftSyncWerte([]), KEINE_UEBERNAHME);
assert.deepStrictEqual(
	avesmapsWikiAssignLandschaftSyncWerte([{ karte: "name", neu: "Farindel" }, { karte: "art", neu: "Wald" }]),
	Object.assign({}, KEINE_UEBERNAHME, { name: "Farindel" }),
	"ein Feld ohne Kartenziel darf nicht in die Uebernahme rutschen"
);
assert.strictEqual(avesmapsWikiAssignLandschaftSyncLeer(KEINE_UEBERNAHME), true);
assert.strictEqual(
	avesmapsWikiAssignLandschaftSyncLeer(Object.assign({}, KEINE_UEBERNAHME, { region_type: "wald" })),
	false,
	"eine allein angehakte Art gilt als „nichts angehakt“"
);
zaehl(); zaehl(); zaehl(); zaehl();

// ══ TEIL 2: die Erklaerung `landschaft` im Register ═══════════════════════════════════════════
const landschaft = AVESMAPS_WIKI_ASSIGN_REGISTRY.landschaft;
assert.ok(landschaft, "die Erklaerung `landschaft` fehlt im Register");
assert.strictEqual(landschaft.suche.art, "server");
assert.strictEqual(landschaft.suche.url, "/api/edit/wiki/regions.php");
// 💣 DIE ZWEI LISTEN MUESSEN SICH DECKEN -- dieselbe Gegenprobe wie beim Ort. Laeuft eine der zwei
// weiter, zeigt das Bauteil eine Sync-Zeile, die die Uebernahme lautlos verwirft (oder umgekehrt).
assert.deepStrictEqual(
	landschaft.felder.filter((feld) => feld.karte !== "").map((feld) => feld.karte).slice().sort(),
	AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER.slice().sort(),
	"die Kartenziele der Erklaerung `landschaft` und AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER laufen auseinander"
);
// Die Anzeige-Zeilen bleiben Anzeige: `ecosystem_region` hat fuer sie keine Spalte.
["art", "region_parent", "affiliation_staat", "continent", "einwohner", "sprache", "vegetation", "verkehrswege"]
	.forEach((wikiFeld) => {
		const zeile = landschaft.felder.filter((feld) => feld.wiki === wikiFeld)[0];
		assert.ok(zeile, "Feldzeile fuer „" + wikiFeld + "“ fehlt");
		assert.strictEqual(zeile.karte, "", wikiFeld + " hat ploetzlich ein Kartenziel -- gibt es die Spalte wirklich?");
		zaehl();
	});
// 🔴 KEIN Bedienelement fuer den dritten Zustand -- gefallen am 16.08.2026 (Owner-Entscheid nach dem
// Durchklicken: „passt, aber ‚Kein Wiki-Artikel vorhanden‘ brauchen wir nicht explizit"). Hier stand
// bis dahin `true`.
// 💣 UND ES FAELLT IN ZWEI OBERFLAECHEN, weil `landschaft` zwei traegt: den Regionen-Editor
// (html/landschaften-editor.html) UND den Dialog „Fläche bearbeiten" auf der Karte. Der Owner hat den
// Regionen-Editor genannt; das Haekchen steht in EINER Erklaerung, also gibt es keine Halbierung.
// ⚠️ Der Label-Dialog ist NICHT betroffen -- das ist die eigene Erklaerung `landschaftslabel`, und
// dass sie ihn behaelt, ist weiter unten eigens festgenagelt.
assert.strictEqual(landschaft.extra.keinArtikelHaken, false,
	"das Haekchen ist zurueck -- der Owner hat es am 16.08.2026 abgewaehlt, die Begruendung steht im "
	+ "Feldregister. Wer es wieder einbaut, braucht einen neuen Entscheid.");
// 🪤 UND DER HINWEISTEXT IST MITGEFALLEN. Hier stand einmal, er duerfe „keine Konfliktliste
// versprechen" -- eine `ecosystem_region` steht in keiner (avesmapsConflictLoadMapRows liest nur
// `map_features`). Der Befund bleibt wahr; ohne Haekchen liest das Bauteil `keinArtikelHinweis` gar
// nicht mehr, und ein Text, den niemand sieht, waere die naechste Divergenz.
assert.strictEqual(landschaft.extra.keinArtikelHinweis, undefined,
	"ein Hinweistext ohne Haekchen -- das Bauteil zeigt ihn nie, er kann nur noch veralten");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ── Die Diff-Rechnung auf der ECHTEN Erklaerung ───────────────────────────────────────────────
// 🔴 SEIT DEM 16.08.2026 ENTSCHEIDET DER KARTENWERT UEBER DIE VORHAEKELUNG (Owner-Entscheid): ein
// gefuellter Wert startet UNGEHAKT, das Fuellen einer Luecke bleibt vorangehakt. Diese eine Fixture
// zeigt beide Haelften nebeneinander -- eine Probe, die nur „alle ungehakt" fordert, waere von „gar
// nichts ist mehr gehakt" nicht zu unterscheiden.
const diffZeilen = avesmapsWikiAssignDiff(
	landschaft.felder,
	{ name: "Wald-001", region_type: "" },
	avesmapsWikiAssignLandschaftWerte(SUCHZEILE, VEGETATION),
	[]
);
assert.deepStrictEqual(diffZeilen.map((zeile) => zeile.karte), ["name", "region_type"]);
assert.deepStrictEqual(diffZeilen.map((zeile) => zeile.neu), ["Farindel", "wald"]);
assert.deepStrictEqual(
	diffZeilen.map((zeile) => [zeile.karte, zeile.gehakt]),
	[["name", false], ["region_type", true]],
	"die Vorhaekelung folgt nicht dem Kartenwert"
);
assert.strictEqual(diffZeilen[0].grund, "auf der Karte steht bereits ein Wert", diffZeilen[0].grund);
// Und die Anzeigefelder bleiben draussen: „Sprache" hat einen Wert im Wiki und kein Kartenziel.
assert.ok(!diffZeilen.some((zeile) => zeile.karte === "sprache" || zeile.karte === "vegetation"),
	"eine Anzeige-Zeile steht in der Sync-Vorschau -- sie kann nichts uebernehmen");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// 🔴 Sagt das Wiki zur Art nichts, das die Ebene kennt, steht die Zeile drin, aber NIE vorangehakt
// -- sonst leerte ein unbedachter Klick eine gepflegte Angabe.
const diffLeer = avesmapsWikiAssignDiff(
	landschaft.felder,
	{ name: "Farindel", region_type: "wald" },
	avesmapsWikiAssignLandschaftWerte(Object.assign({}, SUCHZEILE, { art: "Krater" }), VEGETATION),
	[]
);
assert.strictEqual(diffLeer.length, 1);
assert.strictEqual(diffLeer[0].karte, "region_type");
assert.strictEqual(diffLeer[0].gehakt, false);
assert.ok(/würde die Angabe leeren/.test(diffLeer[0].grund), diffLeer[0].grund);
zaehl(); zaehl(); zaehl(); zaehl();

// ══ TEIL 2a: WELCHES STYLESHEET ERREICHT WELCHES DOKUMENT ═════════════════════════════════════
// 💣 Die `.label-wiki-*`-Regeln stehen in region-sync.css und die laedt NUR index.html; die
// `.dt-*`-Regeln stehen in editor-page.css und die laedt nur das iframe. Eine Huelle im falschen
// Dokument ist nicht „etwas anders", sondern voellig ungestylt -- und keine Ablaufprobe der Welt
// sieht das, weil im Sandkasten kein CSS gilt.
// 🪤 GEPRUEFT WIRD DIE `<link>`-ZEILE, NICHT DER DATEINAME: der Name steht in denselben Dokumenten
// auch in Kommentaren, und eine Probe darauf bleibt gruen, wenn die Zeile ENTFERNT wird.
const indexHtmlRoh = fs.readFileSync(path.join(wurzel, "index.html"), "utf8");
const editorHtmlRoh = fs.readFileSync(path.join(wurzel, "html/landschaften-editor.html"), "utf8");
function bindetStylesheet(inhalt, datei) {
	return new RegExp('<link[^>]+href="[^"]*' + datei.replace(/\./g, "\\.") + '[^"]*"').test(inhalt);
}
assert.ok(bindetStylesheet(indexHtmlRoh, "components/region-sync.css"),
	"index.html bindet region-sync.css nicht -- die Huelle „label-wiki“ des Flaechen-Dialogs waere ungestylt");
assert.ok(bindetStylesheet(editorHtmlRoh, "components/editor-page.css"),
	"der Regionen-Editor bindet editor-page.css nicht -- die Huelle „dt“ waere dort ungestylt");
assert.ok(!bindetStylesheet(editorHtmlRoh, "components/region-sync.css"),
	"der Regionen-Editor bindet region-sync.css mit -- dann faellt eine falsche Huelle nicht mehr auf");
zaehl(); zaehl(); zaehl();

// ══ TEIL 2b: DAS FREITEXTFELD FUER DIE ADRESSE IST WEG ════════════════════════════════════════
// 🔴 Entwurf §5: „Kein Freitextfeld fuer eine Adresse." Es war der letzte im Haus -- der
// Regionen-Editor liess die Wiki-URL von Hand tippen, und genau so blieb bei den Kraftlinien ein
// Tippfehler unsichtbar (15.08.2026).
// ⚠️ Textprobe, und das ist hier richtig: die Frage ist, was im DOKUMENT steht. Ein Ablauf kann sie
// nicht beantworten -- ein Feld, das niemand mehr bedient, faellt in keinem Klickpfad auf.
assert.ok(!/data-f="wiki"/.test(editorHtmlRoh),
	"der Regionen-Editor traegt weiter ein Freitextfeld fuer die Wiki-Adresse");
assert.ok(!/data-a="wiki-clear"/.test(editorHtmlRoh),
	"der Knopf „Wiki-Zuweisung entfernen“ steht noch da -- er gehoert jetzt ins Bauteil");
assert.ok(/data-f="wiki-host"/.test(editorHtmlRoh),
	"der Regionen-Editor hat keinen Behaelter fuer die Zuweisung");
// Und im Kartendialog: der alte Picker samt „Suchen"-Knopf ist fort, der Behaelter steht da.
assert.ok(/id="ecosystem-properties-wiki-host"/.test(indexHtmlRoh),
	"der Flaechen-Dialog hat keinen Behaelter fuer die Zuweisung");
assert.ok(!/id="ecosystem-properties-wiki-search-go"/.test(indexHtmlRoh),
	"der „Suchen“-Knopf steht noch im Flaechen-Dialog -- gesucht wird jetzt beim Tippen");
zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

// ══ TEIL 3+4: die zwei Oberflaechen, WIRKLICH gefahren ════════════════════════════════════════

/** Ein Behaelter, der Klicks wirklich ausloest (Vorbild: js/ui/__tests__/wiki-assign-ort.test.js). */
function scheinBehaelter(id) {
	const zuhoerer = {};
	const element = {
		id: id || "host", textContent: "", innerHTML: "", className: "", value: "",
		dataset: {}, style: {}, options: [], hidden: false, disabled: false, checked: false,
		classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener(typ, fn) { zuhoerer[typ] = fn; },
		removeEventListener(typ) { delete zuhoerer[typ]; },
		querySelector() { return null; },
		querySelectorAll() { return []; },
		contains() { return true; },
		appendChild() {}, removeChild() {}, remove() {}, insertBefore() {}, replaceChildren() {},
		setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, focus() {}, select() {}, dispatchEvent() { return true; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
		feuere(typ, ziel) { if (zuhoerer[typ]) { zuhoerer[typ]({ target: ziel, preventDefault() {} }); } },
		hatZuhoerer(typ) { return typeof zuhoerer[typ] === "function"; },
	};
	return element;
}

/** Ein Ereignisziel mit GENAU einem Merkmal -- `aufKlick` fragt nacheinander nach zwei Selektoren. */
function scheinZiel(merkmal, wert, zusatz) {
	const element = Object.assign({
		getAttribute: (name) => (name === merkmal ? wert : null),
		hasAttribute: (name) => name === merkmal,
	}, zusatz || {});
	element.closest = (selektor) => (selektor === "[" + merkmal + "]" ? element : null);
	return element;
}

/** Ein Formularfeld mit Wert (Namensfeld, Auswahlliste, Haken). */
function scheinFeld(wert, optionen) {
	return {
		value: wert === undefined ? "" : wert,
		options: (optionen || []).map((v) => ({ value: v })),
		checked: false, disabled: false, hidden: false, textContent: "", innerHTML: "", className: "",
		dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
		addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, replaceChildren() {},
		setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
		closest() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
		focus() {}, select() {}, dispatchEvent() { return true; }, contains() { return false; },
		getBoundingClientRect() { return { width: 100, height: 20, top: 0, left: 0 }; },
	};
}

const ruhe = () => new Promise((fertig) => setTimeout(fertig, 5));

/**
 * 🔴 DIE SKRIPTLISTE WIRD AUS DEM DOKUMENT GELESEN, NICHT HIER AUFGEZAEHLT.
 *
 * 💣 Sonst prueft der Sandkasten nur sich selbst: er laedt das Bauteil, weil er es aufzaehlt, und
 * eine im Dokument VERGESSENE `<script>`-Zeile bliebe unsichtbar -- live gaebe `mount` dann einen
 * Blindgaenger. Die Ladereihenfolge ist Vertrag (Register, Diff, Bauteil, Datenweg).
 */
function skripteAus(htmlDatei, muster) {
	const inhalt = fs.readFileSync(path.join(wurzel, htmlDatei), "utf8");
	const treffer = inhalt.match(/<script[^>]+src="([^"]+)"/g) || [];
	return treffer
		.map((tag) => (/src="([^"]+)"/.exec(tag) || [])[1] || "")
		.map((src) => src.replace(/^\//, "").split("?")[0])
		.filter((src) => (muster ? muster.test(src) : true))
		.filter((src) => fs.existsSync(path.join(wurzel, src)));
}

/** Ein Sandkasten mit Dokument-Attrappe und aufgezeichnetem `fetch`. */
function sandkastenBauen(dateien, felder, behaelterIds, fetchAntwort, zusatz) {
	const elemente = {};
	Object.keys(felder || {}).forEach((id) => { elemente[id] = felder[id]; });
	(behaelterIds || []).forEach((id) => { elemente[id] = scheinBehaelter(id); });
	const gesendet = [];
	const dokument = {
		readyState: "complete",
		getElementById(id) {
			if (!Object.prototype.hasOwnProperty.call(elemente, id)) { elemente[id] = scheinFeld(""); }
			return elemente[id];
		},
		querySelector() { return scheinFeld(""); },
		querySelectorAll() { return []; },
		createElement() { return scheinFeld(""); },
		addEventListener() {},
		body: scheinFeld(""), documentElement: scheinFeld(""),
	};
	const kasten = {
		console, setTimeout, clearTimeout, setInterval, clearInterval, JSON, Math, Date, Number,
		String, Array, Object, Boolean, RegExp, Error, Map, Set, URL, URLSearchParams, Promise,
		isFinite, isNaN, parseInt, parseFloat, encodeURIComponent, decodeURIComponent, Intl,
		Event: function () {}, Option: function (label, wert) { return { label: label, value: wert }; },
		document: dokument,
		location: { href: "http://pruefstand.local/", search: "" },
		localStorage: { getItem() { return null; }, setItem() {} },
		matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
		confirm: () => true,
		apiErrorMessage: (antwort, rueckfall) => rueckfall,
		showFeedbackToast: () => {},
		fetch(url, opt) {
			const rumpf = opt && opt.body ? JSON.parse(opt.body) : null;
			gesendet.push({ url: String(url), rumpf: rumpf, methode: (opt && opt.method) || "GET" });
			const antwort = fetchAntwort(String(url), rumpf);
			return Promise.resolve({ ok: antwort.httpOk !== false, status: antwort.status || 200, json: () => Promise.resolve(antwort) });
		},
		// ⚠️ Attrappe, kein Verhalten: das Menüband des Landschaften-Editors beobachtet seit dem
		// 24.08.2026 das `disabled` der vier Rechen-Knöpfe, um in der Unterzeile von „Rechnen ▾" zu
		// sagen, welcher Lauf läuft (`verdrahteRechnenStand`). Ohne diesen Platzhalter bricht der
		// Ladepfad hier mit „MutationObserver is not defined", lange bevor die erste Zusicherung
		// dieses Tests läuft. 🔴 Die Attrappe steht IM TEST, nicht als `typeof`-Wache im Produktions-
		// code: einen echten Browser-Standard abzufragen, damit ein Sandkasten läuft, hiesse die
		// Produktionsform gegen den Test zu drehen (AGENTS.md §9, die SQLite/MySQL-Lehre).
		// Was die Unterzeile WIRKLICH tut, prüft js/pages/__tests__/rechnen-menue-verdrahtung.test.js.
		MutationObserver: function () { return { observe() {}, disconnect() {} }; },
	};
	Object.assign(kasten, zusatz || {});
	kasten.window = kasten;
	kasten.globalThis = kasten;
	vm.createContext(kasten);
	dateien.forEach((datei) => {
		vm.runInContext(fs.readFileSync(path.join(wurzel, datei), "utf8"), kasten, { filename: datei });
	});
	return { kasten: kasten, elemente: elemente, gesendet: gesendet };
}

(async () => {
	// ══ TEIL 3: DER FLAECHEN-DIALOG („Fläche bearbeiten", index.html) ══════════════════════════
	const dialogSkripte = skripteAus("index.html", /wiki-assign|ecosystem-properties|ecosystem-naming/);
	assert.deepStrictEqual(dialogSkripte, [
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-weg.js", "js/ui/wiki-assign-ort.js", "js/ui/wiki-assign-landschaft.js",
		// Aufgabe 7 (Territorium) haengt hier an: der Datenweg der NACHBAR-Objektart, von nichts
		// abhaengig -- mitgeladen schadet er nicht, und die Reihenfolge bleibt pruefbar.
		"js/ui/wiki-assign-territorium.js",
		"js/map-features/map-features-ecosystem-naming.js",
		"js/map-features/map-features-ecosystem-properties.js",
	], "index.html bindet die Wiki-Zuweisung der Landschaft nicht (oder in der falschen Reihenfolge): "
		+ dialogSkripte.join(" "));
	zaehl();

	const FLAECHE = {
		public_id: "a1", region_public_id: "r1", region_name: "Wald-001", kind: "vegetation",
		region_type: "", wiki_region_key: null, wiki_url: null, label_public_id: null,
	};
	const felder = {
		"label-edit-text": scheinFeld("Wald-001"),
		"label-edit-type": scheinFeld(""),
		"ecosystem-properties-autoname": scheinFeld(""),
		"ecosystem-properties-showname": scheinFeld(""),
		"ecosystem-properties-nodix": scheinFeld(""),
	};
	const k = sandkastenBauen(dialogSkripte, felder,
		["ecosystem-properties-wiki-host", "ecosystem-properties-overlay", "ecosystem-properties-form"],
		(url, rumpf) => {
			if (url.indexOf("action=staging_sample") !== -1) { return { ok: true, rows: [SUCHZEILE] }; }
			if (url.indexOf("action=search") !== -1) { return { ok: true, count: 1, rows: [SUCHZEILE] }; }
			return { ok: true };
		},
		{
			// Die Nachbarn des Moduls -- alles, was der Oeffnen-Pfad wirklich anfasst.
			ecosystemLayers: new Map([["a1", { _ecosystemArea: FLAECHE }]]),
			postEcosystemEdit: (aktion, nutzlast) => {
				k.aufrufe.push({ aktion: aktion, nutzlast: nutzlast });
				if (aktion === "list_regions") {
					return Promise.resolve({
						ok: true,
						region_types: VEGETATION.map((typ) => Object.assign({ kind: "vegetation" }, typ)),
						regions: [{ public_id: "r1", name: "Wald-001", kind: "vegetation", region_type: null,
							wiki_region_key: null, wiki_url: null, area_count: 2, wiki_no_article: false }],
					});
				}
				return Promise.resolve({ ok: true });
			},
			ecosystemDialogTitle: () => "Vegetations-Fläche bearbeiten",
			formatEcosystemRegionCarryNote: () => "2 Flächen",
			linkedEcosystemLabelEntry: () => null,
			ecosystemLabelCountOfRegion: () => 0,
			ecosystemLabelStyleFor: () => ({}),
			ecosystemWikiRegionSnapshot: () => Promise.resolve(null),
			submitMapFeatureEdit: () => Promise.resolve({ ok: true }),
			applyLabelFeatureLocally: () => {},
			avesmapsComputeLabelPoint: () => ({ x: 1, y: 1 }),
			tr: (schluessel, rueckfall) => rueckfall,
			t: (schluessel, rueckfall) => rueckfall,
		});
	k.aufrufe = [];
	// Die Attrappen, die das Modul erst NACH dem Laden anfasst -- als Globale im Sandkasten.
	vm.runInContext("var ecosystemLabelsForRegion = function () { return []; };"
		+ "var isEcosystemCascadeEnabled = function () { return false; };"
		+ "var removeEcosystemCascadedLabels = function () {};"
		+ "var refreshEcosystemAreas = function () { return Promise.resolve(); };", k.kasten);

	const host = k.elemente["ecosystem-properties-wiki-host"];
	await vm.runInContext("window.AvesmapsEcosystemProperties.open('a1')", k.kasten);
	await ruhe();
	assert.ok(host.innerHTML.indexOf("Wiki-Landschaft") !== -1,
		"der Kasten traegt die Ueberschrift der Erklaerung nicht: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf("— keine —") !== -1, "ohne Zuweisung steht „— keine —“ da");
	// Die Huelle „label-wiki", nicht „dt" -- index.html laedt region-sync.css, nicht editor-page.css.
	assert.ok(host.innerHTML.indexOf("label-wiki-reference") !== -1 && host.innerHTML.indexOf("dt-grp") === -1,
		"der Flaechen-Dialog mountet die falsche Huelle: " + host.innerHTML);
	// 🔴 Der dritte Zustand wird NICHT MEHR angeboten (16.08.2026) -- auch nicht im offenen Zustand,
	// wo er bis dahin stand. Die Zusicherung ist umgedreht, nicht geloescht.
	assert.strictEqual(host.innerHTML.indexOf("Kein Wiki-Artikel vorhanden"), -1,
		"das Haekchen des dritten Zustands steht weiter da: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Suchen: BEIM TIPPEN, nicht auf Knopfdruck --------------------------------------------
	host.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	const suchAufruf = k.gesendet.filter((s) => s.url.indexOf("action=search") !== -1)[0];
	assert.ok(suchAufruf, "es wurde gar nicht gesucht: " + JSON.stringify(k.gesendet.map((s) => s.url)));
	assert.ok(/\/api\/edit\/wiki\/regions\.php\?action=search&q=&limit=40$/.test(suchAufruf.url),
		"die Suche fragt nicht die gemessene Adresse ab: " + suchAufruf.url);
	assert.ok(host.innerHTML.indexOf("Farindel") !== -1, host.innerHTML);
	// Die Meta-Zeile: Art · Lage · Kontinent -- wortgleich zu dem, was der alte Picker zeigte.
	assert.ok(host.innerHTML.indexOf("Wald · Albernia · Aventurien") !== -1,
		"die Meta-Zeile des Treffers stimmt nicht: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Waehlen: der Name wandert SOFORT ins Formular -----------------------------------------
	host.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	assert.strictEqual(felder["label-edit-text"].value, "Farindel",
		"„Zuweisen“ benennt nicht mehr um -- der Tippfehler bliebe neben dem Wiki-Namen stehen");
	assert.ok(host.innerHTML.indexOf("Albernia") !== -1,
		"der Zuweisungskasten zeigt die Wiki-Angaben nicht: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf('data-wa-aktion="sync"') !== -1, "ohne Sync-Knopf gaebe es nichts zu holen");
	// 💣 UND ES WURDE NICHTS GESCHRIEBEN: dieser Dialog hat „Abbrechen".
	assert.ok(!k.aufrufe.some((a) => a.aktion === "update_region"),
		"„Zuweisen“ hat sofort geschrieben -- „Abbrechen“ waere dann wirkungslos");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Sync mit Vorschau: die Art ist ANGEHAKT, der Name nicht -------------------------------
	// 🔴 Der Name steht auf der Karte schon (er wurde beim Zuweisen gesetzt) -- gleiche Werte stehen
	// GAR NICHT in der Liste. Die Art ist leer, also wird ihre Zeile vorangehakt.
	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(host.innerHTML.indexOf("1 von 2 Angaben würde sich ändern") !== -1,
		"die Sync-Vorschau zaehlt falsch (oder die Art steht doch drin, obwohl sie stimmt): " + host.innerHTML);
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(felder["label-edit-type"].value, "",
		"die Art wurde uebernommen, obwohl das Auswahlfeld sie gar nicht kennt");
	zaehl(); zaehl();

	// Mit gefuelltem Auswahlfeld greift dieselbe Uebernahme.
	felder["label-edit-type"].options = VEGETATION.map((typ) => ({ value: typ.type_key }));
	host.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	host.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(felder["label-edit-type"].value, "wald",
		"die angehakte Art wurde nicht ins Formular uebernommen");
	zaehl();

	// ---- Entfernen ----------------------------------------------------------------------------
	host.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	assert.ok(host.innerHTML.indexOf("— keine —") !== -1, "„Entfernen“ hat den Kasten nicht geleert: " + host.innerHTML);
	assert.strictEqual(felder["label-edit-text"].value, "Farindel",
		"„Entfernen“ hat umbenannt -- die Zuweisung zu loesen soll den Namen stehen lassen");
	zaehl(); zaehl();

	// ---- DIE SCHREIBZEILE UND IHR RUECKWEG, IN DER ECHTEN OBERFLAECHE (17.08.2026) --------------
	// 🔴 Der Owner-Befund vom 16.08.2026 galt genau diesem Kasten: er schwieg darueber, WANN eine
	// Zuweisung wirkt. Diese Flaeche wartet auf „Speichern“ (Erklaerung `landschaft`,
	// `schreibt: "speichern"`), und das muss dastehen, BEVOR jemand klickt.
	// 💣 UND HIER WIRD DAS ZURUECKNEHMEN WIRKLICH GEFAHREN, nicht nur seine Anwesenheit gepraeft:
	// der Entwurf liegt in `pendingWikiRegion` DIESES Moduls, nicht im Bauteil. Nimmt
	// `wikiAssignVerwerfen` ihn nicht zurueck, zeigt der Kasten nach dem Neuladen wieder den
	// Entwurf -- und diese Zusicherung faellt genau darauf. Die zweite Haelfte (der RUMPF des
	// Speicherns) steht weiter unten, direkt beim submit.
	// ⚠️ „Entfernen“ lief eben, es steht also gerade etwas AUS -- der ruhende Zustand wird deshalb
	// erst nach dem Verwerfen gemessen, nicht davor.
	assert.ok(host.innerHTML.indexOf("Noch nicht gespeichert") !== -1,
		"nach dem Entfernen sagt der Kasten nicht, dass etwas aussteht: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf('data-wa-aktion="verwerfen"') !== -1,
		"nach dem Entfernen fehlt der Verwerfen-Knopf: " + host.innerHTML);
	zaehl(); zaehl();

	// 🔴 UND JETZT DER FALL, DER DEN UNTERSCHIED UEBERHAUPT SICHTBAR MACHT: noch einmal ZUWEISEN,
	// dann verwerfen. 🪤 Ohne diesen Schritt lief die Probe ins Leere -- ein Verwerfen direkt nach
	// dem „Entfernen“ sieht mit und ohne Rueckgabe des Entwurfs gleich aus („— keine —"), und die
	// Mutationen „`verwerfen` tut nichts“ und „`verwerfen` fehlt ganz“ blieben beide gruen.
	// Gemessen am 17.08.2026, nachdem genau das passiert war.
	host.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	host.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	assert.ok(host.innerHTML.indexOf("Farindel") !== -1, "die zweite Zuweisung kam nicht an: " + host.innerHTML);
	zaehl();

	host.feuere("click", scheinZiel("data-wa-aktion", "verwerfen"));
	await ruhe();
	assert.ok(host.innerHTML.indexOf("Zuweisen und Lösen wirken erst mit") !== -1,
		"nach dem Verwerfen fehlt die ruhende Schreibzeile: " + host.innerHTML);
	assert.strictEqual(host.innerHTML.indexOf('data-wa-aktion="verwerfen"'), -1,
		"der Verwerfen-Knopf bleibt stehen, obwohl nichts mehr aussteht: " + host.innerHTML);
	// 🔴 DIE ZUSICHERUNG, AUF DIE ES ANKOMMT: die Flaeche hatte beim Laden KEINE Zuweisung, also muss
	// „— keine —" dastehen. Bleibt `pendingWikiRegion` auf Farindel stehen (weil `verwerfen` fehlt
	// oder nichts tut), zeigt der Kasten nach dem Neuladen genau ihn -- und das naechste „Speichern“
	// schriebe die verworfene Verbindung.
	assert.strictEqual(host.innerHTML.indexOf("Farindel"), -1,
		"das Verwerfen hat den Entwurf der Oberflaeche NICHT zurueckgenommen: " + host.innerHTML);
	assert.ok(host.innerHTML.indexOf("— keine —") !== -1,
		"das Verwerfen hat nicht auf den GELADENEN Stand zurueckgesetzt: " + host.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Der dritte Zustand reist GAR NICHT mehr mit ------------------------------------------
	// 🔴 SEIT DEM 16.08.2026 IST DAS DIE GANZE REGEL. Vorher stand hier „beide Richtungen, je eigene
	// Fixture" -- das Haekchen konnte den Merker setzen und wieder abwaehlen. Es ist gefallen; was
	// bleibt, ist die Zusicherung, dass diese Oberflaeche den gespeicherten Merker NICHT ANFASST.
	vm.runInContext("document.getElementById('ecosystem-properties-form')", k.kasten);
	const form = k.elemente["ecosystem-properties-form"];
	await (async () => { form.feuere("submit", form); })();
	await ruhe();
	const ersterSchreibvorgang = k.aufrufe.filter((a) => a.aktion === "update_region")[0];
	assert.ok(ersterSchreibvorgang, "das Speichern hat gar nichts geschrieben: " + JSON.stringify(k.aufrufe));
	assert.ok(!("wiki_no_article" in ersterSchreibvorgang.nutzlast),
		"der Merker reist mit, obwohl niemand die Zuweisung angefasst hat -- ein alter Dialog naehme "
		+ "damit die Entscheidung eines zweiten Editors zurueck");
	// 🔴 UND DIE HAERTERE HAELFTE DES VERWERFENS (17.08.2026, Block darueber): der ENTWURF des
	// Moduls muss mit weg sein, nicht nur das Bild im Kasten. Waere `pendingWikiRegion` nach dem
	// Verwerfen auf dem Farindel-Eintrag stehengeblieben, staende dessen Adresse jetzt im Rumpf --
	// und die Flaeche waere trotz Abbruch verbunden.
	// 🪤 `undefined`, NICHT `null`: `effectiveWikiRegion` liest `undefined` als „unberuehrt" und
	// `null` als „ausdruecklich entfernt".
	// ⚠️ UND DIESER UNTERSCHIED IST HIER NICHT GEMESSEN, sondern nur begruendet: er wird erst an
	// einer Flaeche sichtbar, die BEIM LADEN eine Zuweisung hat -- eine solche Fixture gibt es in
	// dieser Datei nicht. Mit einer Flaeche ohne Zuweisung liefern beide Werte dasselbe Bild und
	// denselben Rumpf. Wer eine dritte Fixture baut, schliesst diese Luecke.
	assert.ok(!String(ersterSchreibvorgang.nutzlast.wiki_url || "").length,
		"nach dem Verwerfen reist die verworfene Adresse doch mit: " + JSON.stringify(ersterSchreibvorgang.nutzlast));
	zaehl(); zaehl(); zaehl();

	// ---- DIE ZWEITE FIXTURE: EINE FLAECHE, DIE DEN MERKER WIRKLICH TRAEGT ---------------------
	// 💣 DAS IST DIE ZUSICHERUNG ZUM WEGFALL DES HAEKCHENS, und sie braucht diese zweite Fixture:
	// die erste startet mit `wiki_no_article: false`, dort ist „nicht geschrieben" von „es war ohnehin
	// false" nicht zu unterscheiden. Genau daran war die Probe in 5b schon einmal blind.
	// 🔴 Was hier bis zum 16.08.2026 stand -- erst abhaken, dann speichern, `false` MUSS im Rumpf --,
	// ist mit dem Haekchen gefallen. An seine Stelle tritt die schaerfere Frage: das Kaestchen ist
	// NICHT DA, auch nicht bei GESETZTEM Merker (`hakenZeigen` hat dafuer eine eigene Ausnahme), und
	// ein Speichern laesst den gespeicherten Merker in Ruhe.
	const felderGesetzt = {
		"label-edit-text": scheinFeld("Wald-002"),
		"label-edit-type": scheinFeld("wald", VEGETATION.map((typ) => typ.type_key)),
	};
	const kGesetzt = sandkastenBauen(dialogSkripte, felderGesetzt,
		["ecosystem-properties-wiki-host", "ecosystem-properties-overlay", "ecosystem-properties-form"],
		() => ({ ok: true, count: 0, rows: [] }),
		{
			ecosystemLayers: new Map([["a3", { _ecosystemArea: Object.assign({}, FLAECHE, {
				public_id: "a3", region_public_id: "r3", region_name: "Wald-002", region_type: "wald",
			}) }]]),
			postEcosystemEdit: (aktion, nutzlast) => {
				kGesetzt.aufrufe.push({ aktion: aktion, nutzlast: nutzlast });
				if (aktion === "list_regions") {
					return Promise.resolve({
						ok: true,
						region_types: VEGETATION.map((typ) => Object.assign({ kind: "vegetation" }, typ)),
						// 🔴 DER UNTERSCHIED ZUR FIXTURE OBEN, und der ganze Zweck dieser zweiten:
						// der Merker ist GELADEN gesetzt.
						regions: [{ public_id: "r3", name: "Wald-002", kind: "vegetation", region_type: "wald",
							wiki_region_key: null, wiki_url: null, area_count: 1, wiki_no_article: true }],
					});
				}
				return Promise.resolve({ ok: true });
			},
			ecosystemDialogTitle: () => "Vegetations-Fläche bearbeiten",
			formatEcosystemRegionCarryNote: () => "1 Fläche",
			linkedEcosystemLabelEntry: () => null,
			ecosystemLabelCountOfRegion: () => 0,
			ecosystemLabelStyleFor: () => ({}),
			ecosystemWikiRegionSnapshot: () => Promise.resolve(null),
			submitMapFeatureEdit: () => Promise.resolve({ ok: true }),
			applyLabelFeatureLocally: () => {},
			avesmapsComputeLabelPoint: () => ({ x: 1, y: 1 }),
			tr: (schluessel, rueckfall) => rueckfall,
			t: (schluessel, rueckfall) => rueckfall,
		});
	kGesetzt.aufrufe = [];
	vm.runInContext("var ecosystemLabelsForRegion = function () { return []; };"
		+ "var isEcosystemCascadeEnabled = function () { return false; };"
		+ "var removeEcosystemCascadedLabels = function () {};"
		+ "var refreshEcosystemAreas = function () { return Promise.resolve(); };", kGesetzt.kasten);
	const hostGesetzt = kGesetzt.elemente["ecosystem-properties-wiki-host"];
	const formGesetzt = kGesetzt.elemente["ecosystem-properties-form"];
	await vm.runInContext("window.AvesmapsEcosystemProperties.open('a3')", kGesetzt.kasten);
	await ruhe();
	// 🔴 DER GESETZTE MERKER ZEICHNET KEIN KAESTCHEN. Hier stand die umgekehrte Zusicherung
	// (`/data-wa-kein-artikel checked/`) -- sie ist am 16.08.2026 umgedreht worden, nicht geloescht.
	assert.strictEqual(hostGesetzt.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"ein GESETZTER Merker zeichnet das Haekchen doch: " + hostGesetzt.innerHTML);
	assert.strictEqual(hostGesetzt.innerHTML.indexOf("Kein Wiki-Artikel vorhanden"), -1,
		"der Wortlaut des Haekchens steht weiter im Kasten: " + hostGesetzt.innerHTML);
	// 🔴 UND DER ABLAUF, DER DATEN ZERSTOEREN KOENNTE: speichern -- der Schluessel darf NICHT im Rumpf
	// stehen. `avesmapsEcosystemApplyRegionNoArticle` liest einen fehlenden Schluessel als „nicht
	// geaendert"; jeder Wert dort (auch `true`) waere ein Schreibvorgang auf eine Entscheidung, die im
	// Konfliktzentrum getroffen wurde.
	formGesetzt.feuere("submit", formGesetzt);
	await ruhe();
	assert.ok(!("wiki_no_article" in kGesetzt.aufrufe.filter((a) => a.aktion === "update_region")[0].nutzlast),
		"der gespeicherte Merker wird ueberschrieben -- die Entscheidung des Konfliktzentrums geht verloren");
	zaehl(); zaehl(); zaehl();

	// ---- `laden` LEHNT AB, und der Kasten sagt es ----------------------------------------------
	// 🔴 DER VERTRAG AUS DEM KOPF VON js/ui/wiki-assign.js, WIRKLICH GEFAHREN -- nicht als Textprobe.
	// Die Landschaft ist die erste Objektart, deren `laden` echtes HTTP macht (der Staging-
	// Schnappschuss). Der Hausstil daneben, `ecosystemWikiRegionSnapshot`, FAENGT seinen Fehler ab
	// und gibt einen Rueckfall zurueck; genau das darf hier nicht passieren.
	// 💣 Und beide Haelften werden geprueft: der Kasten SAGT es UND `bereit` bleibt false. Nur die
	// erste zu pruefen liesse den Fall offen, in dem eine Fehlermeldung dasteht und das naechste
	// „Speichern" trotzdem eine leere Zuweisung schreibt.
	const kFehler = sandkastenBauen(dialogSkripte,
		{
			"label-edit-text": scheinFeld("Farindel"),
			"label-edit-type": scheinFeld("wald"),
		},
		["ecosystem-properties-wiki-host", "ecosystem-properties-overlay", "ecosystem-properties-form"],
		(url) => {
			if (url.indexOf("action=staging_sample") !== -1) { return { httpOk: false, status: 403 }; }
			return { ok: true, count: 0, rows: [] };
		},
		{
			ecosystemLayers: new Map([["a2", { _ecosystemArea: Object.assign({}, FLAECHE, {
				public_id: "a2", region_public_id: "r2", region_name: "Farindel",
				wiki_region_key: "wiki:farindel", wiki_url: SUCHZEILE.wiki_url, region_type: "wald",
			}) }]]),
			postEcosystemEdit: () => Promise.resolve({
				ok: true,
				region_types: VEGETATION.map((typ) => Object.assign({ kind: "vegetation" }, typ)),
				regions: [{ public_id: "r2", name: "Farindel", kind: "vegetation", region_type: "wald",
					wiki_region_key: "wiki:farindel", wiki_url: SUCHZEILE.wiki_url, area_count: 1,
					wiki_no_article: false }],
			}),
			ecosystemDialogTitle: () => "Vegetations-Fläche bearbeiten",
			formatEcosystemRegionCarryNote: () => "1 Fläche",
			linkedEcosystemLabelEntry: () => null,
			ecosystemLabelCountOfRegion: () => 0,
			ecosystemLabelStyleFor: () => ({}),
			ecosystemWikiRegionSnapshot: () => Promise.resolve(null),
			submitMapFeatureEdit: () => Promise.resolve({ ok: true }),
			applyLabelFeatureLocally: () => {},
			avesmapsComputeLabelPoint: () => ({ x: 1, y: 1 }),
			tr: (schluessel, rueckfall) => rueckfall,
			t: (schluessel, rueckfall) => rueckfall,
		});
	vm.runInContext("var ecosystemLabelsForRegion = function () { return []; };"
		+ "var isEcosystemCascadeEnabled = function () { return false; };"
		+ "var removeEcosystemCascadedLabels = function () {};"
		+ "var refreshEcosystemAreas = function () { return Promise.resolve(); };", kFehler.kasten);
	const hostFehler = kFehler.elemente["ecosystem-properties-wiki-host"];
	await vm.runInContext("window.AvesmapsEcosystemProperties.open('a2')", kFehler.kasten);
	await ruhe();
	assert.ok(hostFehler.textContent.indexOf("konnte nicht gelesen werden") !== -1,
		"ein 403 beim Schnappschuss sieht aus wie „diese Landschaft hat keine Angaben“: "
		+ JSON.stringify({ text: hostFehler.textContent, html: hostFehler.innerHTML }));
	assert.strictEqual(hostFehler.innerHTML, "",
		"neben der Fehlermeldung steht noch ein Kasten -- welcher der zwei gilt?");
	zaehl(); zaehl();

	// ══ TEIL 4: DER REGIONEN-EDITOR (html/landschaften-editor.html) ═══════════════════════════
	// Das Fenster ist eine HTML-Seite mit EINEM grossen Inline-Skript; es wird hier unveraendert aus
	// der Datei geschnitten und im Sandkasten gefahren -- dieselbe Bauart wie beim Orte-Editor.
	// ⚠️ `\r?\n`: die Datei liegt im Arbeitsbaum mit CRLF. Ein Schnitt auf `<script>\n` findet auf
	// einem Windows-Checkout GAR NICHTS -- und ohne die Zusicherung darunter waere das ein leeres,
	// gruen laufendes Skript.
	const editorTeile = editorHtmlRoh.split(/<script>\r?\n/);
	const editorSkript = editorTeile[editorTeile.length - 1].split("</script>")[0];
	assert.ok(editorSkript.indexOf("function wireEditBlocks") !== -1,
		"das Inline-Skript des Regionen-Editors wurde nicht gefunden -- die Probe darunter liefe leer");
	// 🔴 Und der Kasten wird WIRKLICH aus renderDetail heraus eingehaengt, nicht per Direktaufruf.
	assert.ok(/host\.innerHTML = parts\.join\(""\);\s*\r?\n\s*wireEditBlocks\(host\);/.test(editorSkript),
		"renderDetail verdrahtet die Bearbeitungsbloecke nicht mehr -- der Kasten waere nie eingehaengt");
	zaehl(); zaehl();

	const editorSkripte = skripteAus("html/landschaften-editor.html", /wiki-assign/);
	assert.deepStrictEqual(editorSkripte, [
		"js/ui/wiki-assign-registry.js", "js/ui/wiki-assign-diff.js", "js/ui/wiki-assign.js",
		"js/ui/wiki-assign-landschaft.js",
	], "der Regionen-Editor bindet die Wiki-Zuweisung nicht (oder in der falschen Reihenfolge): "
		+ editorSkripte.join(" "));
	zaehl();

	// Ein Bearbeitungsblock, wie ihn `wireEditBlocks` im echten DOM vorfindet.
	const blockFelder = {
		name: scheinFeld("Wald-001"),
		type: scheinFeld("", VEGETATION.map((typ) => typ.type_key)),
		auto: scheinFeld(""),
		"wiki-host": scheinBehaelter("wiki-host"),
	};
	const blockAktionen = { save: scheinBehaelter("save") };
	const blockMeldung = scheinFeld("");
	const block = scheinBehaelter("eco-edit");
	block.getAttribute = (name) => (name === "data-region" ? "r1" : null);
	block.querySelector = (selektor) => {
		const feld = /^\[data-f="([^"]+)"\]$/.exec(selektor);
		if (feld) { return blockFelder[feld[1]] || (blockFelder[feld[1]] = scheinFeld("")); }
		const aktion = /^\[data-a="([^"]+)"\]$/.exec(selektor);
		if (aktion) { return blockAktionen[aktion[1]] || (blockAktionen[aktion[1]] = scheinBehaelter(aktion[1])); }
		// ⚠️ `.avm-savebar__msg` seit dem 16.08.2026: die Meldung sitzt jetzt IN der geteilten
		// Speicherleiste (Owner-Reihenfolge, .avm-savebar in css/components/editor-page.css), vorher
		// hiess sie `.dt-msg`. 🪤 Diese Attrappe hat den alten Namen HARTKODIERT, und der Ausfall sah
		// aus wie ein Produktfehler: `querySelector` gab `null` zurueck, `wikiAssignZuweisen` fiel an
		// seiner letzten Zeile um, das Bauteil las den Wurf vertragsgemaess als „Zuweisung
		// fehlgeschlagen" -- und gemeldet wurde am Ende, der Name sei nicht ins Formular uebernommen
		// worden. Wer eine Klasse umbenennt, sucht sie auch in den Attrappen.
		if (selektor === ".avm-savebar__msg") { return blockMeldung; }
		return null;
	};
	const detail = scheinBehaelter("ecoDetail");
	detail.querySelectorAll = (selektor) => (selektor === ".eco-edit" ? [block] : []);
	// Die Listenzeile, ueber die WIRKLICH ausgewaehlt wird -- `renderList` haengt ihren Zuhoerer an
	// `.avm-row`, und `selectRow` ist der einzige Weg nach `renderDetail`.
	const listenZeile = scheinBehaelter("avm-row");
	listenZeile.getAttribute = (name) => (name === "data-key" ? "eco:r1" : null);
	const liste = scheinBehaelter("ecoList");
	liste.querySelectorAll = (selektor) => (selektor === ".avm-row" ? [listenZeile] : []);

	// 🔴 EINE ZEILE, DIE DER SCHREIBVORGANG WIRKLICH VERAENDERT. Eine eingefrorene Attrappe waere zu
	// freundlich: nach dem Speichern liest der Editor die Liste neu (`loadData({keepSelection:true})`),
	// und was dann zurueckkommt, IST der neue geladene Stand. Ohne das koennte keine der zwei
	// Richtungen des dritten Zustands geprueft werden -- der zweite Klick verglich immer gegen „leer".
	const ECO_REGION = {
		public_id: "r1", name: "Wald-001", kind: "vegetation", region_type: null,
		wiki_region_key: null, wiki_url: null, area_count: 2, label_public_id: null,
		wiki_no_article: false, updated_at: "2026-08-16 00:00:00",
	};
	const editorAufrufe = [];
	// ⚠️ Drei ECHTE Nachbarn kommen mit: das Filtermenü (das Inline-Skript ruft es beim Start), die
	// Auto-Namen-Regel (der Block leitet den Haken daraus ab) und seit 18.08.2026 der geteilte
	// Statuskreis-Bauer (`renderList` ruft ihn je Zeile -- ohne ihn wirft die Liste, und der Klick
	// unten findet gar keine Zeile mehr). Attrappen dafuer waeren drei weitere Wahrheiten ueber
	// Dinge, die es fertig gibt.
	const editorLadeliste = ["js/ui/ribbon-menu.js", "js/ui/filter-menu.js", "js/map-features/map-features-ecosystem-naming.js",
		"js/ui/listen-statuskreis.js"]
		.concat(editorSkripte);
	const e = sandkastenBauen(editorLadeliste, { ecoDetail: detail, ecoList: liste }, [],
		(url) => {
			if (url.indexOf("action=staging_sample") !== -1) { return { ok: true, rows: [SUCHZEILE] }; }
			if (url.indexOf("action=search") !== -1) { return { ok: true, count: 1, rows: [SUCHZEILE] }; }
			return { ok: true, matched: [], ambiguous: [], missing: [], unmatched_map_labels: [] };
		},
		{
			// 💣 `ecoPost` verlangt ein FREMDES `window.parent` -- im Sandkasten ist `window.parent`
			// sonst der Sandkasten selbst, und jeder Schreibvorgang faellt in die Absage
			// „laeuft ohne Hauptfenster".
			parent: {
				postEcosystemEdit: (aktion, nutzlast) => {
					editorAufrufe.push({ aktion: aktion, nutzlast: nutzlast });
					if (aktion === "update_region") {
						// Genau die Teilschreiber-Regel des Servers: nur was IM Rumpf steht.
						if (Object.prototype.hasOwnProperty.call(nutzlast, "wiki_url")) {
							ECO_REGION.wiki_url = nutzlast.wiki_url || null;
							ECO_REGION.wiki_region_key = nutzlast.wiki_url ? "wiki:farindel" : null;
						}
						if (Object.prototype.hasOwnProperty.call(nutzlast, "wiki_no_article")) {
							ECO_REGION.wiki_no_article = nutzlast.wiki_no_article === true;
						}
					}
					if (aktion === "list_regions") {
						return Promise.resolve({
							ok: true, regions: [ECO_REGION],
							region_types: VEGETATION.map((typ) => Object.assign({ kind: "vegetation" }, typ)),
						});
					}
					return Promise.resolve({ ok: true });
				},
			},
			t: (schluessel, rueckfall) => rueckfall,
		});
	vm.runInContext(editorSkript, e.kasten, { filename: "html/landschaften-editor.html" });
	await ruhe();

	// 🔴 Ueber den ECHTEN Weg: eine Region auswaehlen laesst renderDetail den Block bauen UND das
	// Bauteil einhaengen. Eine Probe, die nur `wireEditBlocks` selbst ruft, bliebe gruen, wenn die
	// Verdrahtung fehlt.
	// 💣 Das Inline-Skript laeuft in einer IIFE -- an `rows`, `selectedKey` oder `renderDetail` kommt
	// von aussen NICHTS heran, und das ist gut so: die einzige Tuer ist die, die ein Editor auch
	// benutzt. Der Klick auf die Listenzeile geht durch `selectRow` -> `renderDetail` ->
	// `wireEditBlocks` -> `mount`. Waere irgendeines dieser vier Glieder nicht verdrahtet, bliebe
	// der Kasten leer.
	listenZeile.feuere("click", listenZeile);
	await ruhe();
	assert.ok(detail.innerHTML.indexOf('data-f="wiki-host"') !== -1,
		"der Bearbeitungsblock traegt den Behaelter der Zuweisung nicht: " + detail.innerHTML.slice(0, 400));
	const eHost = blockFelder["wiki-host"];
	assert.ok(eHost.innerHTML.indexOf("avm-wiki-assign") !== -1,
		"renderDetail haengt das Bauteil nicht ein: " + eHost.innerHTML);
	// ── 🔴 „WIKI-LANDSCHAFT" STEHT GENAU EINMAL DA (Owner-Befund 16.08.2026) ───────────────────
	// 💣 `renderDetail` baute bis dahin einen EIGENEN read-only-Steckbrief mit genau dieser
	// Ueberschrift -- Zuweisung/Schluessel/Artikel --, und DARUNTER stand seit dem Umbau der
	// Zuweisungskasten, dessen Erklaerung `landschaft` als `label` ebenfalls „Wiki-Landschaft" traegt,
	// mit denselben Angaben plus Name, Art, Lage, Staat, Kontinent und den Knoepfen. Zweimal dieselbe
	// Auskunft untereinander. Der Umbau hatte ERGAENZT statt ersetzt, und der Rueckbau danach suchte
	// nach toten BEZEICHNERN statt nach doppelter ANZEIGE -- deshalb ueberlebte er.
	// ⚠️ Gemessen wird an `detail.innerHTML`: das ist, was `renderDetail` SELBST schreibt; das Bauteil
	// haengt sein Markup erst danach in `wiki-host`. Eine Zeile MIT Region darf dort keine eigene
	// Ueberschrift mehr tragen, das Bauteil sehr wohl.
	assert.strictEqual(detail.innerHTML.indexOf("Wiki-Landschaft"), -1,
		"renderDetail baut neben dem Zuweisungskasten wieder einen eigenen „Wiki-Landschaft\"-Steckbrief: "
		+ detail.innerHTML.slice(0, 600));
	assert.ok(eHost.innerHTML.indexOf("Wiki-Landschaft") !== -1,
		"der Kasten traegt die Ueberschrift nicht -- dann steht sie jetzt NIRGENDS: " + eHost.innerHTML);
	zaehl(); zaehl();
	// 🔴 UND DER RUECKFALL BLEIBT: eine Listenzeile OHNE gezeichnete Region bekommt gar keinen Kasten
	// (der haengt an `regionEditBlock`), und ohne ihn stuenden Schluessel und Artikel dort nirgends.
	// ⚠️ Am Quelltext geprueft, nicht nachgestellt: diese Fixture hat immer eine Region, und eine
	// zweite nur fuer den Rueckfall waere eine Attrappe, die nur sich selbst prueft.
	assert.ok(/if \(row\.regions\.length === 0\) \{\s*\r?\n\s*parts\.push\('<div class="dt-grp">Wiki-Landschaft<\/div>/
		.test(fs.readFileSync(path.join(wurzel, "html/landschaften-editor.html"), "utf8")),
		"der read-only-Steckbrief ist entweder ganz weg (dann verlieren Zeilen ohne Region ihren "
		+ "Schluessel) oder wieder bedingungslos (dann steht er doppelt)");
	zaehl();
	// Die Huelle „dt", nicht „label-wiki" -- dieses Fenster laedt editor-page.css.
	assert.ok(eHost.innerHTML.indexOf("dt-grp") !== -1 && eHost.innerHTML.indexOf("label-wiki") === -1,
		"der Regionen-Editor mountet die falsche Huelle: " + eHost.innerHTML);
	assert.ok(eHost.innerHTML.indexOf("— keine —") !== -1, eHost.innerHTML);
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Zuweisen: fuellt den Kasten, schreibt aber NICHT ---------------------------------------
	eHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	assert.ok(e.gesendet.some((s) => /action=search/.test(s.url)),
		"der Regionen-Editor sucht nicht: " + JSON.stringify(e.gesendet.map((s) => s.url)));
	eHost.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	assert.ok(eHost.innerHTML.indexOf("Farindel") !== -1, "der Treffer wurde nicht uebernommen: " + eHost.innerHTML);
	assert.ok(!editorAufrufe.some((a) => a.aktion === "update_region"),
		"„Zuweisen“ hat sofort geschrieben -- die ungespeicherten Feldaenderungen im selben Block "
		+ "waeren mit dem Neuladen weg");
	// 🔴 Der Auto-Name-Haken folgt der Zuweisung: eine Wiki-Landschaft BESITZT den Namen.
	assert.strictEqual(blockFelder.auto.disabled, true,
		"der Auto-Name-Haken bleibt nach dem Zuweisen bedienbar -- die Wiki-Landschaft besitzt den Namen");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Sync: fuellt NUR das Formular ---------------------------------------------------------
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(eHost.innerHTML.indexOf("Angabe") !== -1, "keine Sync-Vorschau: " + eHost.innerHTML);
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync-alle"));
	await ruhe();
	eHost.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(blockFelder.name.value, "Farindel", "der angehakte Name wurde nicht ins Formular uebernommen");
	assert.strictEqual(blockFelder.type.value, "wald", "die angehakte Art wurde nicht ins Formular uebernommen");
	assert.ok(!editorAufrufe.some((a) => a.aktion === "update_region"),
		"„Übernehmen“ hat gespeichert -- es fuellt nur das Formular");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- Speichern: die Adresse reist mit, der Merker NICHT -----------------------------------
	blockAktionen.save.feuere("click", blockAktionen.save);
	await ruhe();
	const geschrieben = editorAufrufe.filter((a) => a.aktion === "update_region")[0];
	assert.ok(geschrieben, "das Speichern hat nichts geschrieben: " + JSON.stringify(editorAufrufe));
	assert.strictEqual(geschrieben.nutzlast.wiki_url, SUCHZEILE.wiki_url,
		"die geaenderte Zuweisung reist nicht mit");
	assert.ok(!("wiki_region_key" in geschrieben.nutzlast),
		"der Rumpf traegt den Schluessel -- der Server leitet ihn ab");
	// 🔴 ERSTE RICHTUNG des dritten Zustands: NICHT angefasst -> der Schluessel fehlt.
	assert.ok(!("wiki_no_article" in geschrieben.nutzlast),
		"der Merker reist mit, obwohl niemand das Haekchen angefasst hat");
	zaehl(); zaehl(); zaehl(); zaehl();

	// Nach dem Speichern hat der Editor neu geladen -- die Zuweisung ist jetzt der GELADENE Stand.
	assert.strictEqual(ECO_REGION.wiki_url, SUCHZEILE.wiki_url, "der Schreibvorgang kam nicht an");
	assert.ok(eHost.innerHTML.indexOf("Farindel") !== -1,
		"nach dem Speichern zeigt der Kasten die Zuweisung nicht mehr: " + eHost.innerHTML);
	zaehl(); zaehl();

	// ---- Entfernen: die LEERE Adresse ist der Weg zurueck ---------------------------------------
	editorAufrufe.length = 0;
	eHost.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	assert.strictEqual(blockFelder.auto.disabled, false,
		"der Auto-Name-Haken bleibt nach dem Entfernen tot");
	blockAktionen.save.feuere("click", blockAktionen.save);
	await ruhe();
	const geloest = editorAufrufe.filter((a) => a.aktion === "update_region")[0];
	assert.ok(geloest, "das Speichern nach dem Entfernen hat nichts geschrieben");
	assert.strictEqual(geloest.nutzlast.wiki_url, "",
		"die leere Adresse reist nicht mit -- die Zuweisung bliebe stehen");
	assert.strictEqual(ECO_REGION.wiki_url, null, "die Zuweisung steht noch");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ---- 🔴 DER ABLAUF, DER DATEN ZERSTOEREN KOENNTE: DER FREMDE MERKER UEBERLEBT ---------------
	// 💣 DAS IST DIE ZUSICHERUNG ZUM WEGFALL DES HAEKCHENS (16.08.2026). Hier standen bis dahin die
	// zwei Richtungen des Haekchens (setzen / abwaehlen); es gibt es nicht mehr, und an seine Stelle
	// tritt die Frage, die jetzt zaehlt: eine Flaeche, der das KONFLIKTZENTRUM den Merker gesetzt hat,
	// muss ihn behalten, wenn dieser Editor irgendetwas anderes speichert.
	// ⚠️ Gefahren wird das am ECHTEN Ablauf, nicht am Payload-Bauer: gesetzt wird an der Attrappe
	// (genau so sieht dieser Editor den Merker -- ueber `list_regions`), dann wird ueber die
	// Listenzeile neu ausgewaehlt und ueber „Speichern" geschrieben.
	ECO_REGION.wiki_no_article = true;
	// Ein Speichern laedt die Liste neu -- danach ist der fremde Merker der GELADENE Stand.
	blockAktionen.save.feuere("click", blockAktionen.save);
	await ruhe();
	listenZeile.feuere("click", listenZeile);
	await ruhe();
	// Der geladene Merker zeichnet KEIN Kaestchen -- das ist der schaerfere Zweig (`hakenZeigen` im
	// Bauteil hat fuer den gesetzten Merker eine eigene Ausnahme, und die haengt allein an
	// `extra.keinArtikelHaken`).
	assert.strictEqual(eHost.innerHTML.indexOf("data-wa-kein-artikel"), -1,
		"ein GESETZTER Merker zeichnet das Haekchen doch: " + eHost.innerHTML);
	editorAufrufe.length = 0;
	blockAktionen.save.feuere("click", blockAktionen.save);
	await ruhe();
	const ungestoert = editorAufrufe.filter((a) => a.aktion === "update_region")[0];
	assert.ok(ungestoert, "das Speichern hat nichts geschrieben");
	assert.ok(!("wiki_no_article" in ungestoert.nutzlast),
		"der Rumpf traegt den Merker -- jeder Wert dort schriebe auf eine Entscheidung, die im "
		+ "Konfliktzentrum getroffen wurde: " + JSON.stringify(ungestoert.nutzlast));
	assert.strictEqual(ECO_REGION.wiki_no_article, true,
		"der gespeicherte Merker ist weg -- die Entscheidung des Konfliktzentrums wurde still zurueckgenommen");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ══ TEIL 5: DER LABEL-DIALOG („Region bearbeiten", index.html) ════════════════════════════
	// 🔴 DIE DRITTE OBERFLAECHE DERSELBEN WIKI-LANDSCHAFT -- und eine EIGENE Objektart. Sie heftet
	// den Artikel an ein `map_features`-LABEL (`properties.wiki_region`, ein ganzes Nest) statt an
	// die gezeichnete Flaeche. Geteilt wird der DATENWEG, nicht die Erklaerung.
	const labelSkripte = skripteAus("index.html", /wiki-assign|review-label-wiki/);
	// 🪤 Hier stand `labelSkripte.slice(-2)`, also eine NACHBARSCHAFTS-Probe -- und die ist am
	// 16.08.2026 umgefallen, als Aufgabe 7 `wiki-assign-territorium.js` dazwischenschob. Am Bau war
	// nichts falsch: der Label-Dialog stand weiterhin NACH dem Datenweg der Landschaft, nur nicht mehr
	// direkt dahinter. Gefragt ist die REIHENFOLGE, nicht die Nachbarschaft -- also wird sie auch so
	// geprueft, sonst bricht jede weitere Objektart diese Zeile erneut.
	const iLandschaft = labelSkripte.indexOf("js/ui/wiki-assign-landschaft.js");
	const iLabel = labelSkripte.indexOf("js/review/review-label-wiki.js");
	assert.ok(iLandschaft !== -1 && iLabel !== -1 && iLandschaft < iLabel,
		"der Label-Dialog steht nicht NACH dem Datenweg der Landschaft: " + labelSkripte.join(" "));
	zaehl();

	// 💣 DAS FREITEXTFREIE VERSPRECHEN, und die zwei „↻"-Knoepfe. Textprobe, und hier richtig: die
	// Frage ist, was im DOKUMENT steht -- ein Knopf, den niemand mehr bedient, faellt in keinem
	// Klickpfad auf.
	assert.ok(/id="label-wiki-assign-host"/.test(indexHtmlRoh),
		"der Label-Dialog hat keinen Behaelter fuer die Zuweisung");
	assert.ok(!/id="label-wiki-picker"/.test(indexHtmlRoh),
		"der eigene Picker des Label-Dialogs steht noch da");
	assert.ok(!/id="label-edit-wiki-sync-text"/.test(indexHtmlRoh) && !/id="label-edit-wiki-sync-cat"/.test(indexHtmlRoh),
		"die zwei „↻“-Knoepfe stehen noch da -- die Sync-Vorschau tut dasselbe und ZEIGT es");
	// 🔴 UND DIE ZWEITE ART-TABELLE IST WEG. Sie war der Anlass: ihr Kommentar sagte „konsistent mit
	// der PHP-Tabelle", gemessen fuehrte sie fuenf Schluessel, die die PHP-Tabelle nicht kennt.
	const labelWikiRoh = fs.readFileSync(path.join(wurzel, "js/review/review-label-wiki.js"), "utf8");
	assert.ok(!/const LABEL_WIKI_ART_TO_SUBTYPE\s*=/.test(labelWikiRoh),
		"die zweite JS-Abschrift der Art-Tabelle steht noch im Label-Dialog");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ── Die Erklaerung `landschaftslabel` ─────────────────────────────────────────────────────
	const labelErklaerung = AVESMAPS_WIKI_ASSIGN_REGISTRY.landschaftslabel;
	assert.ok(labelErklaerung, "die Erklaerung `landschaftslabel` fehlt im Register");
	assert.deepStrictEqual(
		labelErklaerung.felder.filter((feld) => feld.karte !== "").map((feld) => feld.karte).slice().sort(),
		AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER.slice().sort(),
		"die Kartenziele der Erklaerung `landschaftslabel` und ihre Feldliste laufen auseinander"
	);
	// 🔴 UND SIE ZEIGEN WOANDERS HIN ALS DIE DER FLAECHE -- genau das ist der Grund fuer zwei
	// Erklaerungen. Eine Probe, die nur „beide haben zwei Ziele" fordert, saehe den Unterschied nicht.
	assert.notDeepStrictEqual(
		AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER, AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER,
		"Label und Flaeche haben dieselben Kartenfelder -- dann waere es EINE Objektart");
	// 🔴 Der Hinweis des Labels VERSPRICHT die Konfliktliste, und zu Recht: ein Label ist eine
	// Konfliktpartei, eine ecosystem_region nicht. Genau umgekehrt zur Flaeche daneben.
	assert.ok(/Konfliktliste/.test(String(labelErklaerung.extra.keinArtikelHinweis)),
		"der Hinweis des Labels verschweigt die Konfliktliste, in der es wirklich steht");
	zaehl(); zaehl(); zaehl(); zaehl();

	// ── Die Art-Ordnung auf dem LABEL-Vokabular ───────────────────────────────────────────────
	// 💣 Dieselbe Funktion, ein anderes Vokabular -- und das Label kennt vier Werte, die es als
	// Flaechenart nicht gibt. Wer daraus zwei Funktionen macht, hat die Divergenz wieder.
	const LABEL_ARTEN = ["auenlandschaft", "berggipfel", "dschungel", "ebene", "fluss", "flussdelta",
		"flussland_flusstal", "gebirge", "graslandschaft", "hochebene", "huegelland", "insel",
		"inselgruppe", "kontinent", "kueste", "meer", "region", "schlucht", "see", "sonstiges",
		"steppe", "suempfe_moore", "tal", "tiefebene", "tundra", "vulkan", "wadi", "wald", "wueste",
		"wuestenoase"].map((schluessel) => ({ type_key: schluessel, label: schluessel }));
	[["Ebene", "ebene"], ["Tiefland", "ebene"], ["Berggipfel", "berggipfel"], ["Vulkan", "vulkan"],
		["Fluss", "fluss"], ["Schlucht", "schlucht"], ["Sumpf", "suempfe_moore"], ["Bucht", "meer"]]
		.forEach(([art, erwartet]) => {
			assert.strictEqual(avesmapsWikiAssignLandschaftArt(art, LABEL_ARTEN), erwartet,
				'„' + art + '" trifft am LABEL nicht „' + erwartet + '"');
			zaehl();
		});
	// ⚠️ DER PREIS DES UMBAUS, namentlich: diese drei standen NUR in der abgedrifteten JS-Tabelle
	// und in keiner Server-Quelle. Sie loesen die Kategorie nicht mehr auf. Die Zusicherung steht
	// hier, damit der Verlust benannt ist und nicht als Fehler zurueckkommt.
	["Gebirgskette", "Forst", "Gipfel"].forEach((art) => {
		assert.strictEqual(avesmapsWikiAssignLandschaftArt(art, LABEL_ARTEN), "",
			'„' + art + '" trifft wieder -- dann steht die Abschrift woanders');
		zaehl();
	});

	// ── Der Zustand des Labels ────────────────────────────────────────────────────────────────
	[null, undefined, [], 5].forEach((kaputt) => {
		assert.throws(() => avesmapsWikiAssignLandschaftslabelZustand(kaputt),
			"der Label-Zustand liefert etwas, statt zu werfen");
		zaehl();
	});
	const NEST = { wiki_key: "wiki:farindel", name: "Farindel-alt", art: "Region", wiki_url: SUCHZEILE.wiki_url };
	// 💣 DER SCHNAPPSCHUSS GEHT VOR DEM NEST -- „Sync" heisst „was steht HEUTE im Wiki". Das Nest
	// sagt „Region", das Wiki sagt inzwischen „Wald"; ohne diesen Vorrang haette „Sync" seine
	// Bedeutung verloren.
	const labelZustand = avesmapsWikiAssignLandschaftslabelZustand({
		wiki_region: NEST, schnappschuss: SUCHZEILE, arten: LABEL_ARTEN,
		text: "Farindel-alt", feature_subtype: "region",
	});
	assert.strictEqual(labelZustand.artikel.werte.art, "Wald",
		"das eingefrorene Nest hat den frischen Schnappschuss geschlagen");
	assert.strictEqual(labelZustand.artikel.werte.landschaftsart, "wald");
	assert.strictEqual(labelZustand.kartenwerte.text, "Farindel-alt");
	assert.strictEqual(labelZustand.kartenwerte.feature_subtype, "region");
	// ⚠️ Ohne Schnappschuss (verwaister Schluessel) traegt das NEST den Kasten -- sonst staende dort
	// nichts, obwohl das Label seinen halben Artikel gespeichert hat.
	const nurNest = avesmapsWikiAssignLandschaftslabelZustand({ wiki_region: NEST, arten: LABEL_ARTEN });
	assert.strictEqual(nurNest.artikel.werte.art, "Region", "ohne Schnappschuss bleibt der Kasten leer");
	assert.strictEqual(avesmapsWikiAssignLandschaftslabelZustand({ arten: LABEL_ARTEN }).artikel, null);
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl(); zaehl();

	// ── Der Label-Dialog, WIRKLICH gefahren ───────────────────────────────────────────────────
	const labelFelder = {
		"label-edit-text": scheinFeld("Farindel-alt"),
		"label-edit-type": scheinFeld("region", LABEL_ARTEN.map((typ) => typ.type_key)),
	};
	// Die Auswahlliste muss ihre Beschriftungen tragen -- die Art-Ordnung liest sie in Schritt 1.
	labelFelder["label-edit-type"].options = LABEL_ARTEN.map((typ) => ({ value: typ.type_key, textContent: typ.label }));
	const kLabel = sandkastenBauen(labelSkripte, labelFelder, ["label-wiki-assign-host"],
		(url) => {
			if (url.indexOf("action=staging_sample") !== -1) { return { ok: true, rows: [SUCHZEILE] }; }
			return { ok: true, count: 1, rows: [SUCHZEILE] };
		},
		{ toggleOtherSourceSection: () => {} });
	const labelHost = kLabel.elemente["label-wiki-assign-host"];

	// 🔴 Ueber den ECHTEN Trichter: `setLabelWikiRegion` ist, was der Dialog beim Oeffnen ruft
	// (js/review/review-labels.js:165). Ein Direktaufruf von `mountLabelWikiAssign` bliebe gruen,
	// wenn diese Verdrahtung fehlte.
	vm.runInContext("setLabelWikiRegion(null, false);", kLabel.kasten);
	await ruhe();
	assert.ok(labelHost.innerHTML.indexOf("label-wiki-reference") !== -1 && labelHost.innerHTML.indexOf("dt-grp") === -1,
		"der Label-Dialog mountet die falsche Huelle: " + labelHost.innerHTML);
	assert.ok(labelHost.innerHTML.indexOf("— keine —") !== -1, labelHost.innerHTML);
	assert.ok(labelHost.innerHTML.indexOf("Kein Wiki-Artikel vorhanden") !== -1,
		"das Haekchen des dritten Zustands fehlt am Label: " + labelHost.innerHTML);
	zaehl(); zaehl(); zaehl();

	// Zuweisen: das Nest entsteht, die KATEGORIE folgt sofort (wie vor dem Umbau), der TEXT nicht.
	labelHost.feuere("click", scheinZiel("data-wa-aktion", "zuweisen"));
	await ruhe();
	labelHost.feuere("click", scheinZiel("data-wa-treffer", "0"));
	await ruhe();
	assert.strictEqual(labelFelder["label-edit-type"].value, "wald",
		"die Kategorie folgt der Zuweisung nicht mehr");
	assert.strictEqual(labelFelder["label-edit-text"].value, "Farindel-alt",
		"„Zuweisen“ hat den Text ueberschrieben -- das war nie das Verhalten dieses Dialogs");
	const nest = vm.runInContext("getLabelWikiRegionPayload()", kLabel.kasten);
	assert.ok(nest && nest.wiki_key === "wiki:farindel", "das Nest wurde nicht gesetzt: " + JSON.stringify(nest));
	assert.strictEqual(nest.sprache, "Garethi", "das Nest traegt nur die halben Wiki-Angaben");
	zaehl(); zaehl(); zaehl(); zaehl();

	// Sync: fuellt NUR das Formular, und der Text ist die einzige offene Angabe.
	labelHost.feuere("click", scheinZiel("data-wa-aktion", "sync"));
	await ruhe();
	assert.ok(labelHost.innerHTML.indexOf("1 von 2 Angaben würde sich ändern") !== -1,
		"die Sync-Vorschau des Labels zaehlt falsch: " + labelHost.innerHTML);
	labelHost.feuere("click", scheinZiel("data-wa-aktion", "sync-alle"));
	await ruhe();
	labelHost.feuere("click", scheinZiel("data-wa-aktion", "sync-uebernehmen"));
	await ruhe();
	assert.strictEqual(labelFelder["label-edit-text"].value, "Farindel",
		"der angehakte Name wurde nicht ins Formular uebernommen");
	zaehl(); zaehl();

	// 🔴 BEIDE RICHTUNGEN des dritten Zustands, je eigene Zusicherung.
	assert.strictEqual(vm.runInContext("getLabelWikiNoArticlePayload()", kLabel.kasten), null,
		"der Merker reist mit, obwohl niemand das Haekchen angefasst hat");
	labelHost.feuere("click", scheinZiel("data-wa-aktion", "entfernen"));
	await ruhe();
	labelHost.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: true }));
	assert.strictEqual(vm.runInContext("getLabelWikiNoArticlePayload()", kLabel.kasten), true,
		"das gesetzte Haekchen erreicht den Speicherpfad nicht");
	labelHost.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: false }));
	assert.strictEqual(vm.runInContext("getLabelWikiNoArticlePayload()", kLabel.kasten), null,
		"ein auf den GELADENEN Stand zurueckgestelltes Haekchen gilt als Aenderung");
	// Und mit gesetztem GELADENEN Stand ist es genau umgekehrt -- das ist die zweite Richtung.
	vm.runInContext("setLabelWikiRegion(null, true);", kLabel.kasten);
	await ruhe();
	labelHost.feuere("change", scheinZiel("data-wa-kein-artikel", "", { checked: false }));
	assert.strictEqual(vm.runInContext("getLabelWikiNoArticlePayload()", kLabel.kasten), false,
		"ein bewusst ENTFERNTES Haekchen kommt nicht durch -- der Merker liesse sich nie wieder loswerden");
	zaehl(); zaehl(); zaehl(); zaehl();

	console.log("wiki-assign-landschaft: " + checks + " Zusicherungen erfuellt");
})().catch((fehler) => {
	console.error(fehler && fehler.stack ? fehler.stack : fehler);
	process.exit(1);
});

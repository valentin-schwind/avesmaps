// Die Pruefung, die schreit. Sie ist der Grund, warum es KEINE automatische Felder-Erkennung gibt:
// die Zuordnung Wiki-Feld -> Kartenfeld ist nicht ableitbar (Entwurf §3a), also wird sie erklaert --
// und diese Datei sorgt dafuer, dass eine vergessene Erklaerung LAUT ist statt still.
const assert = require("assert");
const { AVESMAPS_WIKI_ASSIGN_REGISTRY, avesmapsWikiAssignRegistryProbleme } = require("../wiki-assign-registry.js");

// 1) Das echte Register ist in sich stimmig.
assert.deepStrictEqual(
	avesmapsWikiAssignRegistryProbleme(AVESMAPS_WIKI_ASSIGN_REGISTRY, null),
	[],
	"das ausgelieferte Register meldet Probleme"
);

// 2) Ein erklaertes KARTENFELD, das es bei dieser Objektart nicht gibt.
const erfundenesZiel = {
	ort: { label: "Ort", suche: "/x", treffer: ["art"], sync: true,
		felder: [{ wiki: "name", karte: "gibtesnicht" }] },
};
const p2 = avesmapsWikiAssignRegistryProbleme(erfundenesZiel, { ort: { karte: ["name"], wiki: ["name"] } });
assert.strictEqual(p2.length, 1);
assert.ok(p2[0].includes("gibtesnicht"), p2[0]);

// 3) DAS IST DIE ZEILE, DIE 'VERGESSEN' SICHTBAR MACHT: der Parser liefert ein Wiki-Feld,
//    das KEINE Erklaerung fuer sich beansprucht.
const vergessen = {
	ort: { label: "Ort", suche: "/x", treffer: [], sync: true,
		felder: [{ wiki: "name", karte: "name" }] },
};
const p3 = avesmapsWikiAssignRegistryProbleme(vergessen, { ort: { karte: ["name", "einwohner"], wiki: ["name", "einwohner"] } });
assert.strictEqual(p3.length, 1);
assert.ok(p3[0].includes("einwohner"), p3[0]);

// 4) Eine Objektart ohne Erklaerung.
const p4 = avesmapsWikiAssignRegistryProbleme({}, { ort: { karte: ["name"], wiki: ["name"] } });
assert.strictEqual(p4.length, 1);
assert.ok(p4[0].includes("ort"), p4[0]);

// 5) Jede Erklaerung des echten Registers traegt, was das Bauteil braucht.
Object.entries(AVESMAPS_WIKI_ASSIGN_REGISTRY).forEach(([subject, e]) => {
	assert.ok(typeof e.label === "string" && e.label !== "", subject + ": label fehlt");
	assert.ok(Array.isArray(e.felder), subject + ": felder ist keine Liste");
	assert.ok(typeof e.sync === "boolean", subject + ": sync ist kein Wahrheitswert");
	// 💣 Der Sync-Knopf haengt an den FELDERN, nicht am Abgleich: wer keine bearbeitbaren Felder
	// hat, darf keinen Knopf anbieten -- sonst stuende dort einer, der nichts holen kann.
	const hatZiele = e.felder.some((f) => String(f.karte || "") !== "");
	assert.strictEqual(e.sync, hatZiele, subject + ": sync und Feldziele widersprechen sich");
});

// Die GEMESSENE Wirklichkeit des AUSGELIEFERTEN Registers -- eine Zeile je Objektart, die im
// Register schon steht (heute nur "kraftlinie"). Faelle 1-5 oben pruefen das echte Register nur
// gegen `wirklichkeit = null`, und `null` ueberspringt ALLE drei Pruefungen aus Entwurf §3b -- eine
// aus dem echten Register entfernte Feldzeile bliebe damit unbemerkt grün. Diese Konstante schliesst
// die Luecke: jede Zeile darin traegt einen Kommentar mit Datei UND Zeilennummer, an der sie
// gemessen wurde -- nichts geraten. In den Aufgaben 4-9 kommt bei jeder neu gebauten Objektart HIER
// eine Zeile dazu, sonst bleibt Fall 6 unten fuer die neue Objektart wirkungslos (dieselbe Falle wie
// bei Fall 1).
//
// 🔴 DIE GRENZE, DIE DIE LISTE ZIEHT -- sie stand bis zum 16.08.2026 nur in der Kraftlinien-Zeile
// und nicht als Regel da, und die naechste Objektart haette sie neu erraten muessen:
// aufgezaehlt werden die INFOBOX-WERTFELDER, die der Parser ueber sein `$field([...])` liest,
// MINUS dem Identitaetsfeld `name`. Nicht dabei sind deshalb (jeweils mit Grund):
//   · `wiki_key` / `name` / `wiki_url` -- Identitaet; das Bauteil zeichnet sie selbst als
//     „Artikel"/„Schlüssel"/„Wiki ↗", eine Feldzeile dafuer waere die zweite Anzeige derselben Sache.
//   · abgeleitete Angaben, die KEIN Infoboxfeld sind: `kind` (aus dem NAMEN der Infobox,
//     api/_internal/wiki/paths.php:469), `continent`, `match_key`, `synonyms_json`.
//   · `verlauf` (eine gerechnete Stationskette mit eigenem Abgleich, path-verlauf.php) und
//     `description` (Fliesstext aus dem Artikelrumpf, paths.php:532) -- beides keine Infoboxwerte.
//   · Bild- und Betriebsangaben: `image_*`, `synced_at`, `source`.
const WIRKLICHKEIT = {
	kraftlinie: {
		// Der Parser liefert genau vier Anzeige-Felder (api/_internal/wiki/powerlines.php:508-511):
		// $staerke = $field(['starke','starken']); $affinitaet = $field(['affinitat','affinitaet']);
		// $laenge = $field(['lange','langen','lenge']); $regionen = $field(['regionen','region','lage']);
		wiki: ["staerke", "affinitaet", "laenge", "regionen"],
		// Kein bearbeitbares Kartenfeld: der Wiki-Block im Editor traegt ausdruecklich das Abzeichen
		// "nicht editierbar" (html/wiki-sync-powerline-editor.html:439) -- reine Anzeige, kein Ziel.
		karte: [],
	},
	weg: {
		// Der Wege-Parser liest genau drei Infobox-Wertfelder ausser dem Namen
		// (api/_internal/wiki/paths.php:479, :480, :486):
		// $art = $field(['art','typ']); $lage = $field(['regionen','region','lage']);
		// $laenge = $field(['lange','langen','lenge']);   ($name = $field(['name']) auf :475)
		// Dieselben drei reisen im Nest properties.wiki_path mit
		// (avesmapsWikiPathBuildAssignObject, :874-876) und stehen in den Suchspalten (:711-712).
		wiki: ["art", "lage", "laenge"],
		// Das EINZIGE bearbeitbare Kartenfeld, das eine Wiki-Angabe fuellen kann. Gemessen an
		// beiden Speicherwegen: js/pages/wege-editor.js:717 schickt `feature_subtype` an
		// update_path_details, und der Kartendialog liest denselben Wert aus #path-edit-type
		// (js/review/review-paths.js:193). `name` steht bewusst NICHT hier -- der Server setzt ihn
		// bei der Zuweisung selbst (R1); ein Kartenziel „Laenge" gibt es nicht.
		karte: ["feature_subtype"],
	},
};

// 6) DIE ZEILE, DIE BEISST: das AUSGELIEFERTE Register gegen die gemessene Wirklichkeit -- anders
//    als Fall 1 (der mit `null` alle drei Pruefungen ueberspringt) ruft diese Probe die Pruefung
//    tatsaechlich scharf auf. Eine aus dem echten Register entfernte Feldzeile MUSS hier rot werden.
assert.deepStrictEqual(
	avesmapsWikiAssignRegistryProbleme(AVESMAPS_WIKI_ASSIGN_REGISTRY, WIRKLICHKEIT),
	[],
	"das ausgelieferte Register weicht von der gemessenen Wirklichkeit ab"
);

console.log("wiki-assign-registry: alle Zusicherungen erfuellt");

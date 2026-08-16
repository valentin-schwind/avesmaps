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
	ort: {
		// Der Siedlungs-Parser liest genau NEUN Infobox-Wertfelder ausser dem Namen
		// (avesmapsWikiSettlementParseInfobox, api/_internal/wiki/settlements.php):
		//   :602 $art = $field(['siedlungsart','art','typ'])
		//   :607 $region = $field(['region'])          :608 $staat = $field(['staat'])
		//   :622 einwohner  :623 bevoelkerung  :624 oberhaupt
		//   :628 handelszone  :629 verkehrswege  :636 tempel
		// Alle neun reisen im Nest properties.wiki_settlement mit -- `assign_to` schreibt genau
		// dieses Objekt (settlements.php:841), und der Kartenpayload reicht es unveraendert durch
		// (api/app/map-features.php:470-475 haengt nur Bauwerkstyp/Ruine/Gottheit daran).
		//
		// NICHT dabei, jeweils nach der Grenze oben:
		//   · `title`/`name`/`wiki_key`/`match_key`/`wiki_url` -- Identitaet.
		//   · `lage` (:610) -- KEIN eigenes $field, sondern die Zusammensetzung „Region · Staat"
		//     aus den zwei Zeilen darueber. 🔴 Es steht seit dem 16.08.2026 trotzdem im Register, weil
		//     es ein KARTENZIEL bekommen hat -- als ABGELEITETES Wiki-Feld, genau wie `ortsgroesse`
		//     beim Ort und `wegtyp` beim Weg. Die Grenze dieser Liste ist davon unberuehrt: sie zaehlt
		//     auf, was der Parser LIEFERT, und Pruefung 2 fragt nur in diese eine Richtung.
		//   · `settlement_class`/`settlement_label` -- kommen aus der Registry-KATEGORIE, nicht aus
		//     der Infobox (:599, wie `kind` beim Weg aus dem Infobox-NAMEN kommt).
		//   · `verkehrswege_links` (:633) -- abgeleitete Linkkarte aus dem Rohwert daneben.
		//   · `description` (:637) -- Fliesstext aus dem Artikelrumpf.
		//   · `wappen_url` (:638) und `synced_at` (:640) -- Bild- und Betriebsangabe.
		wiki: ["art", "einwohner", "bevoelkerung", "oberhaupt", "region", "staat", "handelszone", "verkehrswege", "tempel"],
		// Die FUENF bearbeitbaren Kartenfelder, die eine Wiki-Angabe fuellen kann -- gemessen an
		// BEIDEN Speicherwegen, die beide `update_point` fahren (buildLocationEditPayload in
		// js/review/review-locations.js und buildSettlementSavePayload in
		// html/wiki-sync-settlement-editor.html) und am Schreibweg selbst
		// (avesmapsApplyPointWikiFields + AVESMAPS_POINT_WIKI_TEXT_FIELDS, api/_internal/map/features.php).
		// 🔴 Bis zum 16.08.2026 waren es ZWEI, und der Satz „ein Kartenfeld fuer Einwohnerzahl, Lage
		// oder Herrscher gibt es in keiner der beiden Oberflaechen" stand hier zu Recht. Die drei sind
		// auf Owner-Entscheid angelegt worden; sie heissen wie im Wiki-Nest, damit die Erklaerung eine
		// Zeile je Feld bleibt.
		// `description` steht in beiden Payloads zwar auch, ist aber kein Ziel: `assign_to` LOESCHT die
		// Beschreibung serverseitig, weil die Infobox sie ersetzt (settlements.php:842) -- eine
		// Sync-Zeile koennte nur anbieten, was der Server schon getan hat.
		karte: ["name", "feature_subtype", "einwohner", "lage", "oberhaupt"],
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

// 7) DIE GEGENRICHTUNG ZU PRUEFUNG 1 -- und sie fehlte bis zum 16.08.2026.
// 🪤 Gefunden von einer Mutation, nicht beim Lesen: nimmt man einer Feldzeile ihr Kartenziel
// (`karte: ""`), bleiben ALLE drei Pruefungen still. Pruefung 1 fragt „gibt es das erklaerte
// Kartenfeld?", Pruefung 2 „ist jedes gelieferte Wiki-Feld erklaert?" -- ein Kartenfeld, das es GIBT
// und das keine Zeile mehr beansprucht, faellt zwischen beide. Das Ergebnis waere lautlos: die
// Sync-Vorschau boete die Angabe nicht mehr an, obwohl das Feld im Formular steht und der Server sie
// schreiben koennte, und niemand merkte es.
// ⚠️ Absichtlich HIER und nicht in avesmapsWikiAssignRegistryProbleme: die Funktion hat drei
// dokumentierte Pruefungen (Entwurf §3b), und ihre Rueckgabe wird an mehreren Stellen erwartet.
Object.entries(WIRKLICHKEIT).forEach(([subject, fakten]) => {
	const erklaerung = AVESMAPS_WIKI_ASSIGN_REGISTRY[subject] || {};
	const beansprucht = (erklaerung.felder || []).map((feld) => String(feld.karte || "")).filter((k) => k !== "");
	(fakten.karte || []).forEach((karteFeld) => {
		assert.ok(
			beansprucht.indexOf(karteFeld) !== -1,
			'Objektart "' + subject + '": das Kartenfeld "' + karteFeld
			+ '" existiert, aber keine Feldzeile beansprucht es -- die Sync-Vorschau kann es nie fuellen.'
		);
	});
});

console.log("wiki-assign-registry: alle Zusicherungen erfuellt");

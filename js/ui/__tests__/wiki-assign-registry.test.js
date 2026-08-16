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
	landschaft: {
		// Der Regionen-Parser liest genau SIEBEN Infobox-Wertfelder ausser dem Namen
		// (avesmapsWikiRegionParse…, api/_internal/wiki/regions.php:589-596):
		//   :534 $art        = $field(['art','typ'])           (danach „Berg" -> „Berggipfel", :536)
		//   :543 region_parent = $field(['region','regionen'])  :544 affiliation_staat = $field(['staat'])
		//   :593 einwohner   = $field(['einwohnerzahl','einwohner'])
		//   :594 sprache     = $field(['sprache'])
		//   :595 vegetation  = $field(['vegetationszonen','vegetation'])
		//   :596 verkehrswege= $field(['verkehrswege','verkehr'])
		// Alle sieben stehen in den Suchspalten (avesmapsWikiRegionSearch, :1090-1092) und kommen
		// damit unveraendert im Kasten an.
		//
		// NICHT dabei, jeweils nach der Grenze oben:
		//   · `wiki_key`/`title`/`name`/`match_key`/`wiki_url` -- Identitaet.
		//   · `continent` (:549) -- ABGELEITET aus Titel, Region, Staat, Nav-Vorlagen und Kategorien,
		//     kein Infoboxfeld (dieselbe Klasse wie `kind` beim Weg). 🔴 Es steht trotzdem als
		//     Anzeige-Zeile im Register, weil die Suche es liefert -- Pruefung 2 fragt nur in die
		//     andere Richtung, und die Grenze dieser Liste bleibt davon unberuehrt.
		//   · `neighbors_json` (:553-563) und `synonyms_json` (:566-583) -- die zwei `*_json`-Spalten.
		//     Sie sind KEINE Werte, sondern Gruppen: acht Himmelsrichtungsfelder, jedes eine LISTE von
		//     Links, bzw. die Aliasliste. Es gibt keine skalare Form, die ein Zuweisungskasten zeigen
		//     koennte, und kein Kartenfeld, das sie je aufnaehme. Dieselbe Grenze wie beim Weg.
		//   · `description` (:597) -- Fliesstext aus dem Artikelrumpf.
		//   · `image_*`, `synced_at`, `source_categories_json` -- Bild- und Betriebsangaben.
		wiki: ["art", "region_parent", "affiliation_staat", "einwohner", "sprache", "vegetation", "verkehrswege"],
		// Die ZWEI bearbeitbaren Kartenfelder. `ecosystem_region` hat schlicht keine weiteren:
		// die DDL (api/_internal/app/ecosystem.php:243-265) fuehrt ausser diesen beiden nur `kind`
		// (die Ebene -- kein Wiki-Feld beschreibt sie), `origin`, die aus `wiki_url` ABGELEITETEN
		// Wiki-Spalten, `label_public_id` und `properties_json`.
		// 🔴 `wiki_url` selbst ist KEIN Sync-Ziel, sondern die Zuweisung -- dieselbe Trennung wie
		// `properties.wiki_settlement` beim Ort. Und `wiki_region_key` wird nie geschrieben, nur
		// abgeleitet (avesmapsEcosystemWikiRegionKey).
		karte: ["name", "region_type"],
	},
	landschaftslabel: {
		// DIESELBE Wiki-Seite wie die Flaeche daneben -- es ist derselbe Parser und derselbe
		// Suchendpunkt. Die Erklaerungen sind trotzdem zwei, weil die KARTEN-Seite eine andere ist
		// (andere Tabelle, andere Feldnamen, anderes Art-Vokabular; die Messung steht im Kopf von
		// js/ui/wiki-assign-landschaft.js).
		wiki: ["art", "region_parent", "affiliation_staat", "einwohner", "sprache", "vegetation", "verkehrswege"],
		// Die ZWEI bearbeitbaren Kartenfelder eines Labels, gemessen an buildLabelEditPayload
		// (js/review/review-labels.js) und am Schreibweg avesmapsUpdateLabelFeature: `text` ist der
		// Name, `feature_subtype` die Kategorie.
		// 🔴 Groesse, Rotation, Zoom-Baender, Prioritaet und Nodix stehen bewusst NICHT hier: sie sind
		// bearbeitbar, aber das Wiki sagt zu keinem davon etwas -- eine Feldzeile dafuer koennte nie
		// etwas uebernehmen. Pruefung 1 fragt nur, ob ein ERKLAERTES Kartenfeld existiert; die
		// Gegenrichtung unten fragt, ob jedes hier genannte beansprucht wird. Deshalb steht hier, was
		// eine Wiki-Angabe fuellen KANN, nicht was das Formular alles hat.
		karte: ["text", "feature_subtype"],
	},
	territorium: {
		// 🔴 HIER IST DIE „WIRKLICHKEIT" NICHT DER PARSER, SONDERN DIE KANDIDATENANTWORT -- und das ist
		// kein Schlendrian, sondern die Lage: fuer Territorien gibt es KEINE `?action=search`
		// (api/edit/wiki/territories.php hat 36 Zeilen und nur einen Seed-Arm; der GET-Verteiler in
		// api/_internal/political/territories-endpoint.php:149-169 kennt list/wiki/wiki_list/hierarchy).
		// Was im Kasten ankommen KANN, ist genau das, was
		// avesmapsPoliticalWikiReferenceRowToPublic herausgibt (api/_internal/political/
		// territories-read.php:373-413) -- die Tabelle `political_territory_wiki` hat 40 Spalten, die Antwort
		// gibt 16 davon her, und alles andere erreicht den Browser nie.
		//
		// NICHT dabei, nach derselben Grenze wie oben:
		//   · `id` / `wiki_key` / `name` / `wiki_url` -- Identitaet. `id` ist hier zusaetzlich der
		//     SCHLUESSEL DER ZUWEISUNG (`update_territory` will `wiki_id`,
		//     api/_internal/political/territories-write.php:239), also erst recht kein Anzeigefeld.
		//   · `eltern` und `zeitraum` -- ABGELEITET, nicht geliefert (der Modellbaum bzw. die zwei
		//     Textfelder daneben). Sie stehen im Register ausdruecklich; Pruefung 2 fragt nur in die
		//     andere Richtung.
		wiki: ["type", "continent", "affiliation_raw", "affiliation_root", "affiliation_path",
			"status", "capital_name", "seat_name", "ruler", "founded_text", "dissolved_text",
			"coat_of_arms_url"],
		// Die VIER bearbeitbaren Kartenfelder, gemessen am einzigen Speicherweg dieser Oberflaeche:
		// regionEditPayloadToPayload (js/review/review-region-tabs-payload.js:129-151) reicht
		// `name`, `type`, `coat_of_arms_url` und `parent_public_id` an `update_territory`, und der
		// Schreibweg nimmt sie entgegen (api/_internal/political/territories-write.php:255-284).
		// 🔴 `eltern` steht hier statt `parent_public_id`, weil die VORSCHAU Namen vergleicht und die
		// public_id getrennt reist -- die Begruendung steht im Kopf von js/ui/wiki-assign-territorium.js.
		// Der Name ist Anzeige, nie Schluessel.
		// 🔴 `wiki_url` ist KEIN Sync-Ziel, sondern die Zuweisung selbst -- dieselbe Trennung wie bei
		// Ort und Landschaft. `short_name`, `color`, `opacity`, `min_zoom`, `max_zoom`, `valid_label`
		// und `editor_notes` sind bearbeitbar, aber das Wiki sagt zu keinem etwas.
		// 🔴 `valid_from_bf`/`valid_to_bf` fehlen mit Grund: die Kandidatenantwort gibt nur
		// `founded_text`/`dissolved_text` heraus, NICHT die BF-Zahlen -- ein Ziel dafuer koennte nur
		// Text in ein Zahlenfeld anbieten. Genau die Falle, gegen die es `wegtyp` und `ortsgroesse` gibt.
		karte: ["name", "type", "eltern", "coat_of_arms_url"],
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

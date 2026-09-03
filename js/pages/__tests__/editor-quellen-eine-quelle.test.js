// Quellen leben an EINER Stelle -- `sources` + `feature_sources`, ein Bauteil, zwei weisse Listen.
//
// 🔴 AGENTS.md §5, wörtlich: „Sources live in ONE place. Never build a second source system." Eine
// neue Objektart bekommt Quellen, indem ihr Name in die `entity_type`-Weisse-Liste kommt -- zwei
// Zeilen, in api/edit/map/feature-sources.php und api/app/feature-sources.php. Sonst nichts.
//
// 💣 DIESER TEST EXISTIERT, WEIL DIE REGEL EINMAL IGNORIERT WURDE. Das Lore-Feature („Natur &
// Waren", 21.07.2026) lieferte seine eigene Tabelle `lore_source` aus. Der Preis war nicht
// theoretisch: ein Publikationstitel steht im geteilten Katalog EINMAL, wurde aber in jede der
// ~35.000 Lore-Zeilen kopiert; der Editor hatte kein Hinzufügen, kein Entfernen, keine
// Vorschlagsliste und keine Herkunft; und dieselben Wiki-Publikationsdaten flossen durch zwei
// unverwandte Abgleicher. Rückgebaut am 22.07.2026 -- es kostete eine Schemaerweiterung, eine
// Datenmigration und einen erneuten Test des ganzen Lore-Syncs. Gegen zwei Zeilen im Voraus.
//
// 🔴 UND DER TEIL, DEN EIN GRÜNER FRONTEND-TEST SONST NICHT SIEHT: eine Objektart, die der
// Browser benutzt, aber der Server nicht kennt, antwortet mit HTTP 400 -- und zwar erst live.
// Deshalb liest dieser Test die ZWEI PHP-Listen und prüft jede im Browser benutzte Objektart gegen
// BEIDE. Steht sie nur in der Schreibliste, legt ein Editor Quellen an, die niemand mehr sieht;
// steht sie nur in der Leseliste, schlägt jedes Hinzufügen fehl.
//
// Run: node js/pages/__tests__/editor-quellen-eine-quelle.test.js

"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..", "..", "..");
const lies = (...teile) => fs.readFileSync(path.join(root, ...teile), "utf8");

let n = 0;
const zaehl = () => { n += 1; };

// ---- Die zwei weissen Listen ------------------------------------------------------------------
// ⚠️ Gelesen, nicht abgeschrieben: eine Kopie hier wäre die dritte Wahrheit und ginge beim ersten
// Zuwachs auseinander -- genau die Fehlerklasse, gegen die der Test steht.
function whitelist(datei) {
	const quelle = lies(...datei.split("/"));
	const treffer = /\$allowedTypes\s*=\s*\[([^\]]+)\]/.exec(quelle);
	assert.ok(treffer, `${datei}: keine \$allowedTypes-Liste gefunden -- der Riegel ist umgebaut worden.`);
	return treffer[1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
}
const schreibListe = whitelist("api/edit/map/feature-sources.php");
const leseListe = whitelist("api/app/feature-sources.php");
// Ein Boden, keine Punktlandung: die Liste waechst mit jeder Objektart, und eine exakte Zahl waere
// beim naechsten Zuwachs rot, ohne dass etwas kaputt ist. Die inhaltliche Pruefung machen die
// Zeilen weiter unten, je Editor.
assert.ok(schreibListe.length >= 6, "die Schreibliste ist unerwartet kurz: " + schreibListe.join("|"));
zaehl();

// 🔴 Die zwei Listen MÜSSEN dieselbe Menge führen (die Reihenfolge ist egal, sie ist nur Lesbarkeit).
// Der Kommentar im Lesepfad sagt es selbst: „a type that may be written but not read stores sources
// nobody can see again."
assert.deepStrictEqual([...schreibListe].sort(), [...leseListe].sort(),
	"Schreib- und Leseliste der entity_type-Weissen-Listen laufen auseinander:\n"
	+ "  schreiben: " + schreibListe.join(", ") + "\n  lesen:     " + leseListe.join(", "));
zaehl();

// ---- Wer im Browser welche Objektart benutzt --------------------------------------------------
// Jede Zeile: Datei · erwartete Objektart · der Ausdruck, der sie montiert.
//
// 🪤 DER AUSDRUCK REICHT BIS IN DEN SCHLUESSEL-GETTER, und das ist eine Korrektur vom 17.08.2026.
// Er endete vorher hinter der Objektart -- eine Mutationsprobe, die `region.public_id` in
// `region.publicId` verbog, lief deshalb GRUEN durch. Der Getter ist aber die Haelfte, an der es
// weh tut: eine falsche Kennung schreibt die Quellen an ein anderes Objekt (oder an gar keins),
// waehrend die Objektart weiter stimmt und jede Listenpruefung zufrieden ist.
// ⚠️ Er muss ein GETTER bleiben, keine kopierte Kennung: in allen vier Fenstern wechselt die
// Auswahl links, waehrend der Kasten offen steht (der Kommentar dazu steht an den Montagestellen).
const MONTAGEN = [
	["html/wiki-sync-settlement-editor.html", "settlement", 'mountFeatureSourceEditor($("dtFeatureSources"), "settlement", () => selectedPublicId'],
	["html/wiki-sync-powerline-editor.html", "powerline", 'mountFeatureSourceEditor($("plSources"), "powerline", () => line.anchor'],
	// 🔴 UMGESTELLT AM 26.08.2026: der Landschaften-Editor montiert die Liste der BESCHRIFTUNG
	// (`region` + `map_features.public_id`), nicht mehr die der Flaeche (`ecosystem` +
	// `ecosystem_region.public_id`). Die zweite war live LEER -- null von 30 Flaechen, und in der
	// Kartenpayload kein Vorkommen unter 6336 Objekten mit Quellen --, waehrend die erste 637
	// Objekte und 8142 Zeilen traegt. Und nur die erste liest die Karte.
	// ⚠️ Der Getter reicht bis in die Kennung, wie die Zeilen darueber es verlangen: `labelId`
	// stammt aus `region.label_public_id` und wird beim Regionswechsel neu gesetzt.
	// Seit dem 03.09.2026 (Schritt 5 des Quellen-Umbaus) traegt die FLAECHE die Quellen: ecosystem + region.public_id.
	["html/landschaften-editor.html", "ecosystem", 'mountFeatureSourceEditor(sourceHost, "ecosystem", () => String(region.public_id || "")'],
	["html/citymap-editor.html", "citymap", 'mountFeatureSourceEditor(ceSourceHost, "citymap", () => state.selectedId'],
];

for (const [datei, art, ausdruck] of MONTAGEN) {
	const quelle = lies(...datei.split("/"));
	assert.ok(quelle.includes(ausdruck),
		`${datei}: montiert den geteilten Quellen-Editor nicht mehr so wie erwartet (${ausdruck}).`);
	assert.ok(schreibListe.includes(art),
		`${datei}: benutzt entity_type „${art}", aber api/edit/map/feature-sources.php kennt ihn nicht. `
		+ "Das ist die dokumentierte Zwei-Zeilen-Aenderung aus AGENTS.md §5 -- KEINE eigene Tabelle.");
	// ⚠️ EHRLICH GESAGT: diese Zeile kann heute nicht allein umfallen -- die Mengengleichheit weiter
	// oben schlaegt vorher zu, sobald sich die zwei Listen unterscheiden. Sie bleibt trotzdem
	// stehen, weil sie die Aussage JE EDITOR macht („dieses Fenster legt Quellen an, die niemand
	// sieht") und sofort lebendig wuerde, falls jene Mengengleichheit je gelockert wird. Gemessen
	// am 17.08.2026: keine Mutation bringt sie einzeln zum Fallen.
	assert.ok(leseListe.includes(art),
		`${datei}: benutzt entity_type „${art}", aber api/app/feature-sources.php gibt ihn nicht heraus. `
		+ "Dann legt der Editor Quellen an, die im Frontend nie erscheinen.");
	// 💣 Beide Dateien des Bauteils, und source-autocomplete VOR review-feature-sources: jene
	// verdrahtet die Vorschlagsliste beim Mounten. Fehlt eine, steht der Kasten stumm da.
	const auto = quelle.indexOf("/js/ui/source-autocomplete.js");
	const bauteil = quelle.indexOf("/js/review/review-feature-sources.js");
	assert.ok(auto !== -1 && bauteil !== -1, `${datei}: laedt den Quellen-Editor oder seine Vorschlagsliste nicht.`);
	assert.ok(auto < bauteil, `${datei}: source-autocomplete.js muss VOR review-feature-sources.js stehen.`);
	assert.ok(quelle.includes("/css/features/feature-sources.css"), `${datei}: laedt feature-sources.css nicht.`);
	zaehl(); zaehl(); zaehl(); zaehl(); zaehl();
}

// ---- JEDE Montagestelle, nicht nur die vier oben ----------------------------------------------
// 💣 DIE LISTE OBEN LIEST SICH VOLLSTAENDIG UND IST ES NICHT. Sie nennt die vier Editorfenster;
// `mountFeatureSourceEditor` wird aber an ACHT Stellen gerufen — dazu der Ortsdialog der Karte
// (js/review/review-locations.js, ZWEIMAL: Anlegefall mit Zwischenlager und Normalfall), der
// Kraftlinien-Dialog der Karte (js/review/review-paths.js) und die Vorkommen
// (js/review/review-wiki-sync.js, `lore`). Wer eine neunte baut und die Liste oben nicht pflegt,
// bekaeme von jener kein Wort — genau die Fehlerklasse „eine Aufzaehlung liest sich wie eine
// vollstaendige Liste" aus AGENTS.md §11.
// 🪤 Und sie ist beim Schreiben dieses Blocks prompt passiert: hier stand zuerst „SIEBEN", weil
// der Kraftlinien-Dialog beim Zaehlen von Hand untergegangen war. Erst der Lauf hat acht gemeldet.
// 🔴 Deshalb wird hier GEZAEHLT statt aufgezaehlt: jeder Aufruf im Baum, seine Objektart gegen
// BEIDE weissen Listen. Eine unbekannte Objektart (z. B. `adventure`) antwortet live mit HTTP 400,
// und zwar erst beim ersten Editor, der den Kasten benutzt.
const MONTAGE_MUSTER = /mountFeatureSourceEditor\(\s*[^,()]*(?:\([^()]*\))?[^,()]*,\s*"([a-z_]+)"/g;
const gefundeneMontagen = [];
function montagenSammeln(verzeichnis) {
	for (const eintrag of fs.readdirSync(path.join(root, verzeichnis), { withFileTypes: true })) {
		const rel = verzeichnis + "/" + eintrag.name;
		// ⚠️ `__tests__` bleibt draussen: ein Test darf jede Objektart nennen, auch eine erfundene.
		if (eintrag.isDirectory()) {
			if (eintrag.name !== "__tests__" && eintrag.name !== "third-party") { montagenSammeln(rel); }
			continue;
		}
		if (!/\.(js|html)$/.test(eintrag.name)) { continue; }
		const quelle = fs.readFileSync(path.join(root, rel), "utf8");
		MONTAGE_MUSTER.lastIndex = 0;
		let t;
		while ((t = MONTAGE_MUSTER.exec(quelle)) !== null) { gefundeneMontagen.push([rel, t[1]]); }
	}
}
montagenSammeln("html");
montagenSammeln("js");
// 🪤 EIN BODEN, DAMIT EIN KAPUTTES MUSTER NICHT ALS „ALLES GRUEN" DURCHGEHT. Ohne ihn waere der
// Block hier bei einem Regex-Fehler lautlos leer und beweise gar nichts -- die Probe mit
// vorbelegtem Treffer, nur andersherum.
// 🔴 NEUN ist der Stand vom 26.08.2026. Zehn war er am 24.08.; GEFALLEN ist der Mount des
// Flaechendialogs (`ecosystem`, die public_id der REGION). Seine Liste war live LEER -- null von
// 30 gleichmaessig verteilten Flaechen trugen eine Quelle, und in der Kartenpayload kommt der
// Typ unter 6336 Objekten mit Quellen kein einziges Mal vor. Die Quellen einer Landschaft liegen
// an ihrer BESCHRIFTUNG; nur deren Liste liest die Karte.
// ⚠️ Wer den Boden senkt, muss sagen WELCHE Stelle wegfiel -- sonst deckt er beim naechsten Mal
// ein kaputtes Suchmuster zu. Zehn war der Stand vom 24.08.2026: dazugekommen waren
// der Beschriftungsdialog der Karte (`region`, die public_id des Labels -- die Karte LAS seine
// Quellen laengst, nur setzen konnte man keine) und der Flaechendialog (`ecosystem`, die
// public_id der REGION: eine Region liegt in vielen Flaechen, ihre Quelle gilt fuer alle).
assert.ok(gefundeneMontagen.length >= 9,
	"Es wurden nur " + gefundeneMontagen.length + " Montagestellen gefunden -- das Suchmuster passt "
	+ "nicht mehr auf die Aufrufe, und dieser Block prueft dann nichts.");
zaehl();
for (const [datei, art] of gefundeneMontagen) {
	assert.ok(schreibListe.includes(art) && leseListe.includes(art),
		`${datei} montiert den Quellen-Editor mit entity_type „${art}", den die weissen Listen nicht `
		+ "fuehren (" + schreibListe.join(", ") + "). Der Endpunkt antwortet darauf mit HTTP 400. "
		+ "Der Weg ist EIN Name mehr in beiden Listen (AGENTS.md §5) -- keine eigene Tabelle.");
	zaehl();
}

// ---- Und kein zweites System ------------------------------------------------------------------
// 💣 Der Tell aus AGENTS.md §5: „if you are about to write CREATE TABLE <feature>_source, stop".
// Geprüft wird der ganze Serverbaum, nicht nur die Editoren -- die Tabelle entstünde in PHP.
const verdaechtig = [];
function durchlaufe(verzeichnis) {
	for (const eintrag of fs.readdirSync(path.join(root, verzeichnis), { withFileTypes: true })) {
		const rel = verzeichnis + "/" + eintrag.name;
		if (eintrag.isDirectory()) { durchlaufe(rel); continue; }
		if (!eintrag.name.endsWith(".php")) { continue; }
		const quelle = fs.readFileSync(path.join(root, rel), "utf8");
		// 🪤 NUR DER TABELLENNAME, und zwar der unmittelbar hinter `CREATE TABLE [IF NOT EXISTS]`.
		// Der erste Anlauf las den ganzen Rumpf und meldete zwei SPALTEN als Tabellen
		// (`social_media.media_source`, `adventure.cover_source`) -- ein Test, der bei Spaltennamen
		// anschlägt, wird beim ersten Fehlalarm abgeschaltet und schützt danach gar nichts.
		const muster = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`'"]?([a-z_]+)[`'"]?/gi;
		let t;
		while ((t = muster.exec(quelle)) !== null) {
			const name = t[1].toLowerCase();
			// `feature_sources` ist die EINE erlaubte Verknüpfungstabelle; `sources` der Katalog dahinter.
			if (!/_sources?$/.test(name)) { continue; }
			if (name !== "feature_sources" && name !== "sources") { verdaechtig.push(rel + " -> " + name); }
		}
	}
}
durchlaufe("api");
assert.deepStrictEqual(verdaechtig, [],
	"Es ist eine ZWEITE Quellentabelle entstanden (AGENTS.md §5): " + verdaechtig.join(", ") + "\n"
	+ "Der Weg ist ein weiterer Name in der entity_type-Weissen-Liste, nicht eine eigene Tabelle. "
	+ "Das wurde einmal ignoriert (lore_source, 21.07.2026) und kostete eine Datenmigration.");
zaehl();

// ---- Der Unterschied, den die Kartensammlung sichtbar macht ------------------------------------
// 🔴 Dort stehen ZWEI Kaesten untereinander, und sie beantworten verschiedene Fragen: „Wo gibt es
// die Karte?" (Fundorte -- wo bekomme ich sie) gegen „Quellen" (Belege -- womit ist der Eintrag
// belegt). Genau die Verwechslung, vor der AGENTS.md §2 warnt (ein WERK gegen den VERWEIS darauf).
// Ohne den unterscheidenden Satz sind es zwei Kaesten mit derselben Ueberschrift.
const citymap = lies("html", "citymap-editor.html");
// 🪤 IM MARKUP GESUCHT, NICHT IN DER DATEI. Der erste Anlauf fragte nur, ob die Zeichenkette „Wo
// gibt es die Karte?" irgendwo vorkommt -- und sie kommt im KOMMENTAR darueber vor, der die zwei
// Kaesten gegeneinander erklaert. Die Mutationsprobe hat genau das gezeigt: die Ueberschrift
// umbenannt, Test blieb gruen, weil der eigene Kommentar die Nadel am Leben hielt. Eine
// Zusicherung, die der Kommentar erfuellt, prueft den Kommentar.
assert.ok(citymap.includes('ce-grp__title">Wo gibt es die Karte?</p>'),
	"der Fundorte-Kasten der Kartensammlung ist weg oder heisst anders -- dann steht neben „Quellen\" "
	+ "kein Kasten mehr, gegen den er sich abgrenzt.");
assert.ok(/Nicht zu verwechseln mit den Fundorten dar/.test(citymap),
	"der Quellen-Kasten der Kartensammlung sagt nicht mehr, wie er sich von den Fundorten darueber "
	+ "unterscheidet -- dann stehen dort zwei Kaesten, die beide „Quellen\" zu heissen scheinen.");
zaehl(); zaehl();

// 🔴 Ein Kasten, der auf eine Kennung schreibt, die es noch nicht gibt, meldet einen Serverfehler
// statt einer Erklaerung. Die Kartensammlung zeigt deshalb den Hausplatzhalter, solange die Karte
// ungespeichert ist -- derselbe Satzbau wie beim Orte-Kasten daneben.
assert.ok(/Erst speichern, dann Quellen zuordnen\./.test(citymap),
	"der Quellen-Kasten der Kartensammlung montiert auch ohne gespeicherte Karte -- dann schreibt er "
	+ "gegen eine leere entity_public_id.");
zaehl();

console.log(`OK: Quellen -- eine Quelle, ${MONTAGEN.length} Objektarten gegen zwei weisse Listen, ${n} Zusicherungen.`);

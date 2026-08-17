// Der Datenweg der LITERATUR -- die Objektart mit der GESPEICHERTEN FELDHERKUNFT.
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md (§8 ist
// diese Aufgabe). Bauteil: js/ui/wiki-assign.js -- das weiss nichts ueber Literatur. Vorbilder:
// js/ui/wiki-assign-territorium.js (Aufgabe 7) und js/ui/wiki-assign-landschaft.js (6).
//
// 🔴 SIE IST REIN: kein DOM, kein `fetch`, kein Zustand. Die Oberflaeche bringt ihren Netzweg mit
// und schickt die Antworten hier durch.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 💣 WAS DIESE OBJEKTART VON DEN UEBRIGEN UNTERSCHEIDET -- GEMESSEN AM 16.08.2026
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// 🪤 OHNE ZAHL, UND ZWAR ABSICHTLICH. Hier stand „von den SIEBEN anderen", und das war beim
// Hinschreiben schon falsch: das Register fuehrt mit der Literatur SIEBEN Objektarten, also sind es
// sechs andere -- und die zehn Oberflaechen aus dem Entwurf sind etwas anderes als die Objektarten,
// weil sich zwei Paare eine teilen (Weg und Landschaft haben je zwei). Eine Zahl in einem Kommentar
// liest sich wie eine vollstaendige Liste, und niemand zaehlt nach; genau daran ist am 14.08.2026
// die Verkehrsmittel-Sperre gescheitert („ERZEUGER 1 VON 2", AGENTS.md §11). Wer wissen will, wie
// viele es sind, zaehlt `AVESMAPS_WIKI_ASSIGN_REGISTRY` -- dort steht es richtig, weil es dort die
// Sache selbst ist.
//
// 1. EINE Oberflaeche, nicht zwei. Gezaehlt, nicht angenommen: `grep -rln wiki_url --include=*.html
//    html/` liefert fuenf Dateien, vier davon gehoeren anderen Objektarten. In
//    html/wiki-sync-monitor.html kommt „Literatur" nur in ZWEI Kommentaren vor (:12, :1255) -- dort
//    wird nichts zugewiesen. Es blieb html/game-literature-editor.html mit seinem freien Textfeld
//    „Wiki-URL" in der Gruppe „Wiki & F-Shop".
//    ⚠️ KEINE ZEILENNUMMER dafuer, und das ist Absicht: die Zeile GIBT ES NICHT MEHR -- dieser Umbau
//    hat sie entfernt. Ein Verweis darauf zeigte ab dem ersten Tag ins Leere. Wo der Kasten heute
//    steht, sagt die Kennung: `#aeWikiAssign`.
//
// 2. ES GAB KEINE SUCHE. `wiki_adventure_catalog` wurde an sieben Stellen gelesen, JEDE ueber einen
//    exakten `wiki_key` oder einen Cursor -- kein `LIKE`, kein `action=search`. Die Literatur war
//    damit die einzige Objektart, deren Wiki-Adresse man TIPPEN musste, also genau die Bauform, an
//    der bei den Kraftlinien am 15.08.2026 ein Tippfehler unsichtbar blieb (Entwurf §5). Der
//    Endpunkt api/edit/wiki/game-literature.php ist mit dieser Aufgabe entstanden.
//
// 3. 💣 KEIN WIKI-NEST. Ort, Weg und Landschaft legen die Wiki-Angaben unter `properties_json` ihres
//    Kartenobjekts ab; ein zugewiesener Artikel ist dort ohne Rueckfrage lesbar. `adventure` hat
//    ueberhaupt kein `properties_json` (die DDL steht in api/_internal/app/game-literature.php:25-52)
//    -- die Wiki-Werte SIND dort dieselben Geschaeftsspalten, die der Abgleich gefuellt hat. Der
//    Stand einer bereits zugewiesenen Literatur muss deshalb eigens geholt werden
//    (`?action=entry&wiki_key=…`), sonst haette der Kasten nichts zu zeigen und die Sync-Vorschau
//    nichts zu vergleichen.
//
// 4. ⭐ DIE FELDHERKUNFT IST GESPEICHERT -- und diese Objektart ist die erste, die `handgesetzt`
//    wirklich fuellen kann. `adventure.field_origins_json` ist eine Karte `{feld: 'manual'|'wiki'}`
//    (geschrieben von avesmapsUpsertGameLiterature, api/_internal/app/game-literature.php:946-956,
//    ausgegeben im `detail` :898). Sie ist NICHT unsere Erfindung: der Massenabgleich entscheidet an
//    genau ihr, ob er ein Feld ueberhaupt anfasst (avesmapsGameLiteratureFieldPlan,
//    api/_internal/wiki/game-literature-sync.php:65). Die Vorschau sagt damit die Wahrheit statt
//    einer Vermutung.
//    ⚠️ UND SIE IST GROSSZUEGIG: `upsert_adventure` stempelt JEDES mitgeschickte Feld auf 'manual',
//    und `gatherStamm` schickt alle. Ein Eintrag, den je ein Editor gespeichert hat, traegt also
//    ueberall 'manual' -- in der Vorschau steht dann bei jeder Zeile „von Hand gesetzt — würde
//    zurückgedreht". Das ist kein Fehler dieser Datei, sondern die Auskunft, die der Editor braucht:
//    genau diese Felder ruehrt auch der Massenabgleich nicht mehr an. Angehakt werden koennen sie
//    weiterhin.
//
// 5. 🪤 KEIN dritter Zustand -- gemessen, nicht vergessen. Die drei Gruende stehen im Register
//    (js/ui/wiki-assign-registry.js, Objektart `literatur`); der schwerwiegendste ist der dritte:
//    eine geloeste Zuweisung kaeme ueber die TITEL-Adoption des Abgleichs von selbst zurueck
//    (avesmapsGameLiteratureFindOrAdoptRow, game-literature-sync.php:581-584). Das ist die
//    Fehlerklasse aus Discord #38 an neuer Stelle -- und ein Riegel dagegen waere ein zweiter
//    Mechanismus, kein Spiegeln der vorhandenen Bauform. Er gehoert vor die Augen des Owners.

// Die bearbeitbaren KARTENFELDER der Literatur -- die einzige Liste davon im Browser.
//
// 🔴 SIE IST DIE GEGENPROBE ZUM FELDREGISTER, nicht seine Wiederholung (dieselbe Rolle wie
// AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER, ...LANDSCHAFT_... und ...TERRITORIUM_...). Beide muessen
// sich decken, und genau das nagelt js/ui/__tests__/wiki-assign-literatur.test.js fest.
//
// ⚠️ Jeder Name ist zugleich Spalte, Formularfeld und Nutzlast-Schluessel -- hier wird an KEINER
// Stelle uebersetzt. Das ist keine Bequemlichkeit, sondern dieselbe Regel wie bei Ort und
// Landschaft: ein Uebersetzungsschritt waere die zweite Wahrheit, die Pruefung 2 (§3b) gerade
// verhindern soll.
const AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER = [
	"title", "product_type", "edition", "genre", "complexity_gm", "complexity_pl",
	"authors", "series", "fshop_code", "isbn",
];

function avesmapsWikiAssignLiteraturText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

/**
 * REIN: die Werte, die die Erklaerung `literatur` erwartet -- aus einer Zeile des Suchendpunkts.
 *
 * ⚠️ DIE NAMEN SIND DIE DER ANTWORT, nicht huebschere. Die Beschriftung macht `label` im Register.
 * ⚠️ `art`, `isbn` und `publisher` kommen aus dem PUBLIKATIONS-Katalog und koennen fehlen (der
 * Endpunkt verbindet mit LEFT JOIN) -- dann bleiben sie leer, und das Bauteil laesst leere Zeilen
 * ohnehin weg.
 */
function avesmapsWikiAssignLiteraturWerte(quelle) {
	const q = quelle || {};
	return {
		title: avesmapsWikiAssignLiteraturText(q.title),
		art: avesmapsWikiAssignLiteraturText(q.art),
		product_type: avesmapsWikiAssignLiteraturText(q.product_type),
		edition: avesmapsWikiAssignLiteraturText(q.edition),
		series: avesmapsWikiAssignLiteraturText(q.series),
		authors: avesmapsWikiAssignLiteraturText(q.authors),
		genre: avesmapsWikiAssignLiteraturText(q.genre),
		complexity_gm: avesmapsWikiAssignLiteraturText(q.complexity_gm),
		complexity_pl: avesmapsWikiAssignLiteraturText(q.complexity_pl),
		fshop_code: avesmapsWikiAssignLiteraturText(q.fshop_code),
		isbn: avesmapsWikiAssignLiteraturText(q.isbn),
		publisher: avesmapsWikiAssignLiteraturText(q.publisher),
		cover_file: avesmapsWikiAssignLiteraturText(q.cover_file),
	};
}

/**
 * REIN: `field_origins` -> die Herkunftskarte der zehn KARTENFELDER.
 *
 * 🔴 GEFILTERT AUF DIE ZEHN ZIELE, nicht roh durchgereicht. `field_origins` traegt auch Felder ohne
 * Sync-Ziel (`bf_year`, `link_ulisses`, …); die Diff-Rechnung schlaegt einen Namen nur unter
 * `feld.karte` nach, also waere der Rest wirkungsloser Ballast -- und ein wirkungsloser Eintrag in
 * einer Karte, die ueber das Vorhaekeln entscheidet, liest sich beim naechsten Mal wie eine Regel.
 *
 * 🔴 SEIT 17.08.2026 REISEN BEIDE HERKUENFTE MIT, nicht nur `'manual'`. Hier stand eine LISTE der
 * handgesetzten Felder; `'wiki'` fiel dabei heraus, weil es damals folgenlos war. Es ist es nicht
 * mehr: `'wiki'` heisst „zuletzt vom Abgleich gefuellt" und ist seither der Fall, der WIEDER
 * vorangehakt wird (wiki-assign-diff.js, Fall 4). Ein fehlender Eintrag heisst weiterhin „nie
 * angefasst" und bleibt beim heutigen Verhalten.
 *
 * ⚠️ Alles ausser `'manual'`/`'wiki'` faellt heraus -- eine unbekannte dritte Herkunft darf weder
 * sperren noch vorhaken, sondern muss auf „nicht bekannt" zurueckfallen.
 */
function avesmapsWikiAssignLiteraturHerkunft(herkunft) {
	const h = (herkunft && typeof herkunft === "object" && !Array.isArray(herkunft)) ? herkunft : {};
	const karte = {};
	AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER.forEach((feld) => {
		const wert = avesmapsWikiAssignLiteraturText(h[feld]);
		if (wert === "manual" || wert === "wiki") {
			karte[feld] = wert;
		}
	});
	return karte;
}

/**
 * REIN: eine Zeile des Suchendpunkts in die Treffer-Form des Bauteils.
 *
 * 🔴 `haengtAn` WIRD HIER GESETZT, und diese Objektart ist die erste mit SERVER-Suche, die es kann.
 * Der Kopf von js/ui/wiki-assign.js sagt dazu: „wer eine Objektart mit SERVER-Suche anschliesst,
 * laesst das Feld weg, bis ein Endpunkt es liefert" -- unserer liefert es
 * (`belegt_public_id`/`belegt_titel` aus dem dritten LEFT JOIN).
 * 💣 UND ES IST KEINE HOEFLICHKEIT: `adventure.wiki_key` traegt einen UNIQUE-Key
 * (api/_internal/app/game-literature.php:50). Ein zweiter Eintrag auf denselben Artikel ist ein
 * Datenbankfehler -- ohne die Warnung sieht der Editor erst beim Speichern einen 500er, dessen
 * Ursache nirgends steht.
 * 🔴 VERGLICHEN WIRD UEBER DIE public_id, NIE UEBER DEN TITEL. Zwei Werke duerfen gleich heissen,
 * und ein Name ist keine Kennung (im Politik-Layer hat ein `á` gegen ein `â` bereits ein zweites
 * Gebiet erzeugt). Der TITEL wandert nur in die Anzeige.
 *
 * @param {Object} zeile          eine Zeile aus `?action=search` bzw. `?action=entry`
 * @param {string} eigenePublicId die Kennung des gerade bearbeiteten Eintrags (leer bei einem neuen)
 */
function avesmapsWikiAssignLiteraturTreffer(zeile, eigenePublicId) {
	const z = zeile || {};
	const belegt = avesmapsWikiAssignLiteraturText(z.belegt_public_id);
	const eigene = avesmapsWikiAssignLiteraturText(eigenePublicId);
	return {
		name: avesmapsWikiAssignLiteraturText(z.title),
		wiki_url: avesmapsWikiAssignLiteraturText(z.wiki_url),
		wiki_key: avesmapsWikiAssignLiteraturText(z.wiki_key),
		werte: avesmapsWikiAssignLiteraturWerte(z),
		// Der eigene Eintrag ist nie „schon woanders" -- sonst warnte der Kasten beim Oeffnen der
		// Suche vor der Zuweisung, die gerade dasteht.
		haengtAn: (belegt !== "" && belegt !== eigene)
			? avesmapsWikiAssignLiteraturText(z.belegt_titel)
			: "",
		roh: z,
	};
}

/**
 * REIN: die gespeicherte Zuweisung in die Artikel-Form. `null` heisst „nichts zugewiesen" -- ein
 * gueltiger Zustand, kein Fehler (ein von Hand angelegtes Werk hat oft keinen Wiki-Artikel).
 *
 * 💣 DIE ANZEIGEWERTE KOMMEN AUS DEM KATALOGSATZ, nie aus der Kartenzeile. Das ist der Unterschied,
 * der bei dieser Objektart am leichtesten zu uebersehen ist: die Kartenzeile TRAEGT dieselben
 * Spaltennamen (`title`, `edition`, `series` …), weil der Abgleich sie dorthin geschrieben hat --
 * naehme man sie von dort, verglichen Vorschau und Kasten die Karte mit sich selbst und meldeten
 * ewig „Alles stimmt bereits mit dem Wiki überein". Genau deshalb gibt es `?action=entry`.
 * ⚠️ Ein verwaister Schluessel (kein Katalogsatz mehr) ist kein Fehler -- der Artikel steht dann mit
 * Adresse und Schluessel da, die Anzeige-Zeilen fallen weg.
 */
function avesmapsWikiAssignLiteraturArtikel(gespeichert, kandidat) {
	const g = gespeichert || {};
	const schluessel = avesmapsWikiAssignLiteraturText(g.wiki_key);
	const adresse = avesmapsWikiAssignLiteraturText(g.wiki_url);
	if (schluessel === "" && adresse === "") {
		return null;
	}
	const k = (kandidat && typeof kandidat === "object") ? kandidat : null;
	const werte = avesmapsWikiAssignLiteraturWerte(k || {});
	return {
		name: werte.title || avesmapsWikiAssignLiteraturText(g.title),
		wiki_url: adresse || avesmapsWikiAssignLiteraturText(k && k.wiki_url),
		wiki_key: schluessel || avesmapsWikiAssignLiteraturText(k && k.wiki_key),
		werte: werte,
	};
}

/** REIN: Kartenwerte als Werte ODER als Lesefunktionen (siehe avesmapsWikiAssignLiteraturZustand). */
function avesmapsWikiAssignLiteraturKartenwerte(quelle, felder) {
	const kartenwerte = {};
	(Array.isArray(felder) ? felder : []).forEach((feld) => {
		if (typeof quelle[feld] === "function") {
			Object.defineProperty(kartenwerte, feld, {
				enumerable: true,
				get: () => avesmapsWikiAssignLiteraturText(quelle[feld]()),
			});
		} else {
			kartenwerte[feld] = avesmapsWikiAssignLiteraturText(quelle[feld]);
		}
	});
	return kartenwerte;
}

/**
 * 🔴 DER ZUSTAND -- UND ER WIRFT, STATT ETWAS LEERES ZU LIEFERN.
 *
 * Der Vertrag aus dem Kopf von js/ui/wiki-assign.js: ein `laden`, das im Fehlerfall AUFLOEST, ist von
 * „nichts zugewiesen" nicht zu unterscheiden. Das Bauteil malte dann den offenen Zustand, `lies()`
 * gaebe Leerstrings -- und weil diese Oberflaeche erst beim „Speichern" schreibt, loeschte der
 * naechste Klick die Zuweisung, ohne dass es jemand angeordnet haette. Bei der Literatur waere das
 * besonders teuer: `wiki_key` ist zugleich der Schluessel, ueber den der Massenabgleich das Werk
 * wiederfindet (avesmapsGameLiteratureFindOrAdoptRow) -- ohne ihn faellt es auf den Titelvergleich
 * zurueck.
 *
 * 💣 DIE KARTENWERTE WERDEN ERST BEIM LESEN GEHOLT, wenn der Aufrufer eine Funktion uebergibt --
 * derselbe Grund wie bei Weg, Ort, Landschaft und Territorium: `laden` laeuft EINMAL, die
 * Sync-Vorschau entsteht erst beim Druck auf „Sync", und dazwischen kann der Editor jedes
 * Formularfeld angefasst haben.
 *
 * @param {Object|null} quelle {
 *     public_id,                   -- die eigene Kennung (leer bei einem neuen Eintrag)
 *     wiki_key, wiki_url, title,   -- die gespeicherte Zuweisung
 *     kandidat,                    -- der Katalogsatz dazu (aus `?action=entry`) oder null
 *     field_origins,               -- die gespeicherte Feldherkunft
 *     title, product_type, …       -- die zehn Kartenfelder je Wert ODER Lesefunktion
 *   }
 */
function avesmapsWikiAssignLiteraturZustand(quelle) {
	if (!quelle || typeof quelle !== "object" || Array.isArray(quelle)) {
		throw new Error("Wiki-Literatur: kein Eintrag gewählt — der Stand ist unbekannt.");
	}
	return {
		artikel: avesmapsWikiAssignLiteraturArtikel(
			{ wiki_key: quelle.wiki_key, wiki_url: quelle.wiki_url, title: quelle.wiki_title },
			quelle.kandidat || null
		),
		// 🪤 KEIN dritter Zustand -- die Literatur kann den Merker nicht tragen. Die Messung samt den
		// drei Gruenden steht im Register (js/ui/wiki-assign-registry.js, Objektart `literatur`); hier
		// steht er ausdruecklich auf `false`, damit niemand ihn fuer vergessen haelt.
		keinArtikel: false,
		kartenwerte: avesmapsWikiAssignLiteraturKartenwerte(quelle, AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER),
		// ⭐ DIE EINZIGE OBJEKTART MIT ECHTER FELDHERKUNFT (siehe Kopf, Punkt 4).
		herkunft: avesmapsWikiAssignLiteraturHerkunft(quelle.field_origins),
	};
}

/**
 * REIN: welche Kartenfelder die ANGEHAKTEN Sync-Zeilen setzen wollen. `null` heisst „diese Angabe
 * ist nicht dabei".
 *
 * 🔴 DIE ZIELE KOMMEN AUS `AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER`, nicht aus einer zweiten
 * Liste hier -- dieselbe Lehre wie bei Ort (5b), Landschaft (6) und Territorium (7): ein weiteres
 * Feld im Register erzeugte sonst eine Sync-Zeile, die diese Funktion lautlos verwirft. Das Bauteil
 * zeigt sie, der Haken tut nichts.
 *
 * ⚠️ Ein LEERER neuer Wert wird zu `null` und damit „nicht setzen" -- nicht zu einem Leerstring. Der
 * Fall kann hier gar nicht auftreten (die Diff-Rechnung haekelt eine Zeile mit leerem Wikiwert nie
 * vor), aber ein `null` ist die vorsichtige Seite: der Schreibweg lieferte sonst ein `''`, und
 * `avesmapsUpsertGameLiterature` macht daraus NULL in einer NOT-NULL-Spalte (`title`).
 */
function avesmapsWikiAssignLiteraturSyncWerte(zeilen) {
	const liste = Array.isArray(zeilen) ? zeilen : [];
	const werte = {};
	AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER.forEach((feld) => { werte[feld] = null; });
	liste.forEach((zeile) => {
		if (!zeile || !Object.prototype.hasOwnProperty.call(werte, zeile.karte)) {
			return;
		}
		const wert = avesmapsWikiAssignLiteraturText(zeile.neu);
		werte[zeile.karte] = wert === "" ? null : wert;
	});
	return werte;
}

/** REIN: hat die Uebernahme ueberhaupt etwas zu tun? Zaehlt ALLE Ziele, nie zwei davon von Hand. */
function avesmapsWikiAssignLiteraturSyncLeer(werte) {
	const w = werte || {};
	return AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER.every((feld) => w[feld] === null || w[feld] === undefined);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER: AVESMAPS_WIKI_ASSIGN_LITERATUR_KARTENFELDER,
		avesmapsWikiAssignLiteraturWerte: avesmapsWikiAssignLiteraturWerte,
		avesmapsWikiAssignLiteraturHerkunft: avesmapsWikiAssignLiteraturHerkunft,
		avesmapsWikiAssignLiteraturTreffer: avesmapsWikiAssignLiteraturTreffer,
		avesmapsWikiAssignLiteraturArtikel: avesmapsWikiAssignLiteraturArtikel,
		avesmapsWikiAssignLiteraturZustand: avesmapsWikiAssignLiteraturZustand,
		avesmapsWikiAssignLiteraturSyncWerte: avesmapsWikiAssignLiteraturSyncWerte,
		avesmapsWikiAssignLiteraturSyncLeer: avesmapsWikiAssignLiteraturSyncLeer,
	};
}

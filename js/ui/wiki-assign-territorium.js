// Der Datenweg des HERRSCHAFTSGEBIETS -- die Objektart mit der ELTERN-SPERRE.
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md (§7 ist
// diese Aufgabe). Bauteil: js/ui/wiki-assign.js -- das weiss nichts ueber Territorien. Vorbilder:
// js/ui/wiki-assign-landschaft.js (Aufgabe 6) und js/ui/wiki-assign-weg.js (4).
//
// 🔴 SIE IST REIN: kein DOM, kein `fetch`, kein Zustand. Die Oberflaeche bringt ihren Netzweg mit
// und schickt die Antworten hier durch.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 💣 WO DIE ZUWEISUNG WIRKLICH SITZT -- GEMESSEN, NICHT AUS DEM ENTWURF UEBERNOMMEN
// ═══════════════════════════════════════════════════════════════════════════════════════════════
//
// Entwurf §9 fuehrt „Territorium | eigene Form, Overrides-Tabelle | .dt-*" -- das meint das
// Detailpanel von html/wiki-sync-monitor.html. Am 16.08.2026 nachgemessen: DORT WIRD NICHTS
// ZUGEWIESEN. Der `wiki_key` IST die Identitaet eines Monitor-Knotens; es gibt keinen Artikel-Picker,
// nur Overrides auf den Wiki-Stand und die Hierarchie samt „🔓 Eltern hier sperren"
// (html/wiki-sync-monitor.html:820). Der Entwurf hat an dieser Zeile die HAELFTEN VERTAUSCHT: die
// Sperre steht im Monitor, die Zuweisung woanders.
//
// Gezaehlt wurden vier Bedienelemente in drei Fenstern:
//   1. Der Kasten „Wiki-Referenz" im Kartendialog „Herrschaftsgebiet bearbeiten", getragen von
//      js/review/review-region-wiki-picker.js -- DAS EINZIGE, das die Frage „welcher
//      Wiki-Artikel gehoert zu diesem Gebiet" stellt. Heute ist das der Behaelter
//      `#territory-wiki-assign-host` (index.html:1897); vor dem Umbau standen dort eine
//      handgebaute `<dl>` und daneben ein zweites Fenster `#region-wiki-picker-overlay`.
//      Es schreibt `political_territory.wiki_id`
//      (daraus serverseitig `wiki_key`) und `wiki_url` ueber `update_territory`. ⭐ Entwurf §1 nennt
//      genau diese Datei in der Liste der sechs abzuloesenden Fassungen -- die Dateiliste des
//      Entwurfs schlaegt seine Oberflaechen-Tabelle.
//   2. Das Ablagefeld des Territoriumseditors (html/political-territory-editor.html:69-70). Es
//      weist eine GEOMETRIE einem Wiki-Knoten zu (`save_geometry_assignment` /
//      `unassign_geometry`), nicht einen Artikel einem Objekt, und sein Wiki-Panel ist
//      ausdruecklich nur-lesend (WIKI_DETAIL_FIELDS, js/territory/territory-editor-embedded.js:2056,
//      Kommentar :2090 „read-only - exakt wie der Sync-Monitor"). NICHT umgestellt.
//   3. Der Territorien-Reiter im WikiSync-Panel (index.html:684-709) -- reine Ziehquelle.
//   4. Der Monitor (oben).
//
// ⚠️ UND EINE OFFENE FRAGE, die kein Test beantwortet: `#region-edit-dialog` ist fuer Gebiete der
// RUECKFALL. `map-features.js:651` oeffnet zuerst den eingebetteten Territoriumseditor, und erst
// wenn der nicht kann, ruft js/territory/territory-editor-link.js:171 `openRegionEditDialog`. Der
// Kasten hier ist also echt und erreichbar, aber nicht der erste Weg -- das gehoert vor die Augen
// des Owners, nicht in eine Behauptung.

// Die bearbeitbaren KARTENFELDER des Herrschaftsgebiets -- die einzige Liste davon im Browser.
//
// 🔴 SIE IST DIE GEGENPROBE ZUM FELDREGISTER, nicht seine Wiederholung (dieselbe Rolle wie
// AVESMAPS_WIKI_ASSIGN_ORT_KARTENFELDER und ...LANDSCHAFT_KARTENFELDER). Beide muessen sich decken,
// und genau das nagelt js/ui/__tests__/wiki-assign-territorium.test.js fest.
//
// ⚠️ `eltern` ist KEIN Spaltenname und kein Feldname der Nutzlast -- es ist der Zielname DIESER
// Oberflaeche fuer die Elternbeziehung. Geschrieben wird sie als `parent_public_id`
// (js/review/review-region-tabs-payload.js:139); verglichen wird ueber NAMEN, weil eine public_id in
// einer Vorschauzeile niemand lesen kann. Die Begruendung steht ausgeschrieben bei
// avesmapsWikiAssignTerritoriumSyncWerte.
const AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER = ["name", "type", "eltern", "coat_of_arms_url"];

// Der Grund, der neben einer gesperrten „Eltern"-Zeile steht. 🔴 ZWEI Gruende, nicht einer:
// „gesperrt" und „nicht nachlesbar" sind verschiedene Auskuenfte, und beide sperren.
const AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_GESPERRT =
	"Eltern hier gesperrt — die Hierarchie ist von Hand entschieden";
const AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_UNBEKANNT =
	"Die Eltern-Sperre konnte nicht gelesen werden";

function avesmapsWikiAssignTerritoriumText(wert) {
	return String(wert === null || wert === undefined ? "" : wert).trim();
}

/**
 * REIN: der Zeitraum einer Wiki-Zeile, wortgleich zu `buildWikiReferencePeriod`
 * (js/review/review-region-parent-tree.js) -- „Gegruendet - Aufgeloest", leere Haelften fallen weg.
 *
 * ⚠️ ABGELEITET, nicht geliefert: er traegt die vierte Stelle der Trefferzeile, die der alte Picker
 * dort zeigte. Ein Kartenziel bekommt er NICHT -- `valid_from_bf`/`valid_to_bf` sind Zahlen, und
 * `?action=wiki_list` gibt die BF-Zahlen ueberhaupt nicht heraus, nur die Texte
 * (avesmapsPoliticalWikiReferenceRowToPublic, api/_internal/political/territories-read.php).
 */
function avesmapsWikiAssignTerritoriumZeitraum(quelle) {
	const q = quelle || {};
	return [
		avesmapsWikiAssignTerritoriumText(q.founded_text),
		avesmapsWikiAssignTerritoriumText(q.dissolved_text),
	].filter((teil) => teil !== "").join(" - ");
}

/**
 * REIN: den Modellbaum (`?action=model_tree`) in die Form bringen, in der dieser Datenweg ihn liest.
 *
 * 🔴 ER IST DIE EINZIGE QUELLE DER SPERRE. `parent_locked` steht in `wiki_territory_model` und wird
 * von genau einem Leseweg herausgegeben (api/_internal/wiki/sync-monitor-tree.php:243); die
 * Kandidatenliste `?action=wiki_list` liest `political_territory_wiki` und weiss davon nichts.
 * Derselbe Baum traegt auch `auto_parent_wiki_key` (was das Wiki als Eltern vorsieht) und die
 * `public_id` des zugehoerigen Gebiets -- damit kommt alles fuer die „Eltern"-Zeile aus EINER
 * Anfrage.
 *
 * 💣 `gelesen: false` ist KEIN leerer Baum. Ein leerer Baum hiesse „nirgends ist etwas gesperrt",
 * und die Vorschau boete an, eine gesperrte Hierarchie zu ueberschreiben. Nicht nachlesen koennen
 * heisst deshalb SPERREN (avesmapsWikiAssignTerritoriumEltern) -- die vorsichtige Seite.
 */
function avesmapsWikiAssignTerritoriumModell(knoten, gelesen) {
	const liste = Array.isArray(knoten) ? knoten : [];
	const nachSchluessel = {};
	liste.forEach((eintrag) => {
		const schluessel = avesmapsWikiAssignTerritoriumText(eintrag && eintrag.wiki_key);
		if (schluessel !== "") {
			nachSchluessel[schluessel] = eintrag;
		}
	});
	return { knoten: nachSchluessel, gelesen: gelesen === true };
}

/**
 * REIN: was das Wiki fuer DIESEN Schluessel als Eltern vorsieht -- Name, Gebiets-public_id, und ob
 * die Beziehung gesperrt ist.
 *
 * 🔴 DIE SPERRE GEHOERT AN DIE FELDZEILE, NICHT AN DEN KNOPF (Entwurf §7). `parent_locked = 1` ist
 * ein bewusster Editor-Override, den der Dump nicht reproduzieren soll -- der Massenabgleich
 * schliesst gesperrte Schluessel bereits aus (api/_internal/wiki/dump-compare.php:248), und
 * `rebuild_model` schreibt sie nicht um (sync-monitor-model.php:147). Der Knopf im Ganzen zu sperren
 * hiesse: eine Entscheidung ueber die HIERARCHIE verhindert auch, dass jemand den NAMEN nachzieht.
 * 💣 Und still uebersprungen wird sie nicht -- ein Knopf, der drueckbar aussieht und nichts tut, ist
 * schlimmer als einer, der erklaert, warum er nicht kann.
 *
 * ⚠️ Verglichen wird gegen `auto_parent_wiki_key` (was das Wiki VORSIEHT), nicht gegen
 * `parent_wiki_key` (was im Modell steht). Genau diese zwei trennt die Sperre: sie haelt
 * `parent_wiki_key` fest, waehrend `auto_parent_wiki_key` weiter mitwandert. Dasselbe tut der Knopf
 * „↩ Wiki-Eltern: X" im Monitor (html/wiki-sync-monitor.html:810).
 *
 * @param {string} wikiKey  der Schluessel des Gebiets
 * @param {Object} modell   aus avesmapsWikiAssignTerritoriumModell
 * @returns {{name: string, public_id: string, gesperrt: boolean, grund: string}}
 */
function avesmapsWikiAssignTerritoriumEltern(wikiKey, modell) {
	const m = (modell && typeof modell === "object") ? modell : { knoten: {}, gelesen: false };
	const leer = { name: "", public_id: "", gesperrt: true, grund: AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_UNBEKANNT };
	if (m.gelesen !== true) {
		return leer;
	}
	const schluessel = avesmapsWikiAssignTerritoriumText(wikiKey);
	const eigener = schluessel === "" ? null : (m.knoten || {})[schluessel];
	if (!eigener) {
		// ⚠️ Kein Modellknoten heisst NICHT „nicht nachlesbar": der Baum wurde gelesen, dieses Gebiet
		// steht nur nicht darin (ein Artikel, den die Hierarchie noch nicht kennt). Dann gibt es auch
		// keine Sperre -- und keinen Eltern-Vorschlag, den man uebernehmen koennte.
		return { name: "", public_id: "", gesperrt: false, grund: "" };
	}
	const gesperrt = eigener.parent_locked === true || eigener.parent_locked === 1;
	const elternSchluessel = avesmapsWikiAssignTerritoriumText(eigener.auto_parent_wiki_key);
	const elternKnoten = elternSchluessel === "" ? null : (m.knoten || {})[elternSchluessel];
	return {
		name: avesmapsWikiAssignTerritoriumText(elternKnoten && elternKnoten.name),
		public_id: avesmapsWikiAssignTerritoriumText(elternKnoten && elternKnoten.public_id),
		gesperrt: gesperrt,
		grund: gesperrt ? AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_GESPERRT : "",
	};
}

/**
 * REIN: die Werte, die die Erklaerung `territorium` erwartet -- aus einer Zeile von
 * `?action=wiki_list`.
 *
 * ⚠️ DIE NAMEN SIND DIE DER ANTWORT, nicht huebschere (`affiliation_raw`, `affiliation_root`,
 * `capital_name`, `seat_name`) -- dieselbe Regel wie bei Ort und Landschaft: es wird an KEINER
 * Stelle uebersetzt, die Beschriftung macht `label` im Register. Ein Uebersetzungsschritt hier waere
 * die zweite Wahrheit, die Pruefung 2 aus §3b gerade verhindern soll.
 *
 * ⚠️ `affiliation_path` kommt als LISTE aus dem JSON (avesmapsPoliticalDecodeJson) und wird zu einer
 * Zeile verbunden -- eine Liste in einem Textfeld staende sonst als „[object Object]" da.
 */
function avesmapsWikiAssignTerritoriumWerte(quelle, eltern) {
	const q = quelle || {};
	const pfad = Array.isArray(q.affiliation_path)
		? q.affiliation_path.map((teil) => avesmapsWikiAssignTerritoriumText(teil)).filter((teil) => teil !== "")
		: [];
	return {
		name: avesmapsWikiAssignTerritoriumText(q.name),
		type: avesmapsWikiAssignTerritoriumText(q.type),
		eltern: avesmapsWikiAssignTerritoriumText(eltern && eltern.name),
		coat_of_arms_url: avesmapsWikiAssignTerritoriumText(q.coat_of_arms_url),
		status: avesmapsWikiAssignTerritoriumText(q.status),
		affiliation_raw: avesmapsWikiAssignTerritoriumText(q.affiliation_raw),
		affiliation_root: avesmapsWikiAssignTerritoriumText(q.affiliation_root),
		affiliation_path: pfad.join(" › "),
		capital_name: avesmapsWikiAssignTerritoriumText(q.capital_name),
		seat_name: avesmapsWikiAssignTerritoriumText(q.seat_name),
		ruler: avesmapsWikiAssignTerritoriumText(q.ruler),
		continent: avesmapsWikiAssignTerritoriumText(q.continent),
		founded_text: avesmapsWikiAssignTerritoriumText(q.founded_text),
		dissolved_text: avesmapsWikiAssignTerritoriumText(q.dissolved_text),
		zeitraum: avesmapsWikiAssignTerritoriumZeitraum(q),
	};
}

/**
 * REIN: eine Zeile von `?action=wiki_list` in die Treffer-Form des Bauteils.
 *
 * 🔴 DER ELTERN-VORSCHLAG WIRD SCHON HIER AUFGELOEST, nicht erst nach dem Zuweisen. `trefferWaehlen`
 * uebernimmt `treffer.werte` unveraendert in den Artikel (js/ui/wiki-assign.js) -- fehlte `eltern`
 * dort, staende die Zeile nach jeder frischen Zuweisung als „das Wiki sagt nichts — wuerde die
 * Angabe leeren" in der Vorschau, obwohl das Wiki sehr wohl etwas sagt.
 *
 * 🔴 `roh` reist mit: die Oberflaeche braucht `id` (= political_territory_wiki.id), und NUR die
 * kommt in die Nutzlast von `update_territory`. Ohne sie ist der Treffer nicht zuweisbar.
 */
function avesmapsWikiAssignTerritoriumTreffer(zeile, modell) {
	const z = zeile || {};
	const schluessel = avesmapsWikiAssignTerritoriumText(z.wiki_key);
	return {
		name: avesmapsWikiAssignTerritoriumText(z.name),
		wiki_url: avesmapsWikiAssignTerritoriumText(z.wiki_url),
		wiki_key: schluessel,
		werte: avesmapsWikiAssignTerritoriumWerte(z, avesmapsWikiAssignTerritoriumEltern(schluessel, modell)),
		roh: z,
	};
}

/**
 * REIN: die gespeicherte Zuweisung in die Artikel-Form. `null` heisst „nichts zugewiesen" -- ein
 * gueltiger Zustand, kein Fehler (es gibt Gebiete, die es bei uns gibt und im Wiki nicht).
 *
 * 💣 DAS GEBIET SPEICHERT NUR KENNUNG, SCHLUESSEL UND ADRESSE (`political_territory.wiki_id`,
 * `wiki_key`, `wiki_url` -- sql/political-territories.sql:51-61). Alle Anzeigewerte kommen aus der
 * Kandidatenzeile derselben Wiki-Zeile; ohne sie staende der Kasten mit Adresse und Schluessel da.
 * ⚠️ Eine Kandidatenzeile, die es nicht mehr gibt (verwaister Schluessel), ist kein Fehler -- die
 * Anzeige-Zeilen fallen dann weg, das Bauteil laesst leere Felder ohnehin weg.
 */
function avesmapsWikiAssignTerritoriumArtikel(gespeichert, kandidat, modell) {
	const g = gespeichert || {};
	const schluessel = avesmapsWikiAssignTerritoriumText(g.wiki_key);
	const adresse = avesmapsWikiAssignTerritoriumText(g.wiki_url);
	const kennung = avesmapsWikiAssignTerritoriumText(g.wiki_id);
	if (schluessel === "" && adresse === "" && kennung === "") {
		return null;
	}
	const k = (kandidat && typeof kandidat === "object") ? kandidat : null;
	const eigenerSchluessel = schluessel || avesmapsWikiAssignTerritoriumText(k && k.wiki_key);
	const werte = avesmapsWikiAssignTerritoriumWerte(
		k || {},
		avesmapsWikiAssignTerritoriumEltern(eigenerSchluessel, modell)
	);
	return {
		name: werte.name || avesmapsWikiAssignTerritoriumText(g.name),
		wiki_url: adresse || avesmapsWikiAssignTerritoriumText(k && k.wiki_url),
		wiki_key: eigenerSchluessel,
		werte: werte,
	};
}

/** REIN: Kartenwerte als Werte ODER als Lesefunktionen (siehe avesmapsWikiAssignTerritoriumZustand). */
function avesmapsWikiAssignTerritoriumKartenwerte(quelle, felder) {
	const kartenwerte = {};
	(Array.isArray(felder) ? felder : []).forEach((feld) => {
		if (typeof quelle[feld] === "function") {
			Object.defineProperty(kartenwerte, feld, {
				enumerable: true,
				get: () => avesmapsWikiAssignTerritoriumText(quelle[feld]()),
			});
		} else {
			kartenwerte[feld] = avesmapsWikiAssignTerritoriumText(quelle[feld]);
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
 * naechste Klick die Zuweisung eines Gebiets, ohne dass es jemand angeordnet haette.
 *
 * 💣 DIE KARTENWERTE WERDEN ERST BEIM LESEN GEHOLT, wenn der Aufrufer eine Funktion uebergibt --
 * derselbe Grund wie bei Weg, Ort und Landschaft: `laden` laeuft EINMAL, die Sync-Vorschau entsteht
 * erst beim Druck auf „Sync", und dazwischen kann der Editor Namensfeld, Staatsform, Wappen-Adresse
 * und Eltern angefasst haben.
 *
 * @param {Object|null} quelle {
 *     wiki_id, wiki_key, wiki_url, wiki_name,   -- die gespeicherte Zuweisung des Gebiets
 *     kandidat,                                 -- die `wiki_list`-Zeile dazu (oder null)
 *     kandidaten,                               -- ALLE `wiki_list`-Zeilen (die Suchquelle)
 *     modell,                                   -- aus avesmapsWikiAssignTerritoriumModell
 *     name, type, eltern, coat_of_arms_url      -- die vier Kartenfelder je Wert ODER Lesefunktion
 *   }
 */
function avesmapsWikiAssignTerritoriumZustand(quelle) {
	if (!quelle || typeof quelle !== "object" || Array.isArray(quelle)) {
		throw new Error("Wiki-Herrschaftsgebiet: kein Gebiet gewählt — der Stand ist unbekannt.");
	}
	const modell = (quelle.modell && typeof quelle.modell === "object")
		? quelle.modell
		: { knoten: {}, gelesen: false };
	const schluessel = avesmapsWikiAssignTerritoriumText(quelle.wiki_key)
		|| avesmapsWikiAssignTerritoriumText(quelle.kandidat && quelle.kandidat.wiki_key);
	const eltern = avesmapsWikiAssignTerritoriumEltern(schluessel, modell);
	return {
		artikel: avesmapsWikiAssignTerritoriumArtikel(
			{
				wiki_id: quelle.wiki_id,
				wiki_key: quelle.wiki_key,
				wiki_url: quelle.wiki_url,
				name: quelle.wiki_name,
			},
			quelle.kandidat || null,
			modell
		),
		// 🪤 KEIN dritter Zustand -- das Gebiet kann den Merker nicht tragen. Die Messung samt den drei
		// Gruenden steht im Register (js/ui/wiki-assign-registry.js, Objektart `territorium`); hier
		// steht er ausdruecklich auf `false`, damit niemand ihn fuer vergessen haelt.
		keinArtikel: false,
		kartenwerte: avesmapsWikiAssignTerritoriumKartenwerte(quelle, AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER),
		// 🔴 DER RIEGEL AN DER FELDZEILE (Entwurf §7). Nur `eltern` -- Name, Staatsform und Wappen
		// bleiben bedienbar, auch bei gesperrter Hierarchie.
		gesperrt: eltern.gesperrt ? { eltern: eltern.grund } : {},
		// 🔴 DIE KANDIDATEN REISEN FERTIG AUFBEREITET MIT, nicht roh. Die Listen-Suche des Bauteils
		// filtert nur nach `eintrag.name` und reicht den Eintrag UNVERAENDERT als Treffer weiter
		// (avesmapsWikiAssignListeFiltern) -- eine rohe `wiki_list`-Zeile hat kein `werte`, und
		// `trefferWaehlen` uebernimmt genau das in den Artikel. Der Zuweisungskasten staende nach der
		// Wahl leer da, obwohl alle Werte im Browser liegen. Dieselbe Falle wie beim Ort, nur eine
		// Ebene frueher.
		listen: {
			territorien: (Array.isArray(quelle.kandidaten) ? quelle.kandidaten : [])
				.map((zeile) => avesmapsWikiAssignTerritoriumTreffer(zeile, modell)),
		},
	};
}

/**
 * REIN: welche Kartenfelder die ANGEHAKTEN Sync-Zeilen setzen wollen. `null` heisst „diese Angabe
 * ist nicht dabei".
 *
 * 🔴 DIE ZIELE KOMMEN AUS `AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER`, nicht aus einer zweiten
 * Liste hier -- dieselbe Lehre wie bei Ort (5b) und Landschaft (6): ein weiteres Feld im Register
 * erzeugte sonst eine Sync-Zeile, die diese Funktion lautlos verwirft. Das Bauteil zeigt sie, der
 * Haken tut nichts.
 *
 * 🔴 UND DIE ELTERN-ZEILE WIRD NICHT UEBER IHREN NAMEN AUFGELOEST. Sie traegt einen Namen, weil eine
 * public_id in einer Vorschauzeile unlesbar ist -- geschrieben wird aber die public_id, die der
 * Modellbaum geliefert hat. `eltern` muss deshalb hereingereicht werden, und der Name in der Zeile
 * wird nur BESTAETIGT, nicht nachgeschlagen: passt er nicht zu dem, was zuletzt geladen wurde, gibt
 * es keine Kennung und die Zeile faellt heraus. 💣 Ein Name ist keine Kennung -- im Politik-Layer hat
 * ein `á` gegen ein `â` bereits ein zweites Gebiet erzeugt (AGENTS.md-Gedaechtnis).
 *
 * @param {Array} zeilen  die angehakten Diff-Zeilen
 * @param {Object} eltern aus avesmapsWikiAssignTerritoriumEltern -- { name, public_id }
 */
function avesmapsWikiAssignTerritoriumSyncWerte(zeilen, eltern) {
	const liste = Array.isArray(zeilen) ? zeilen : [];
	const werte = {};
	AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER.forEach((feld) => { werte[feld] = null; });
	werte.eltern_public_id = null;
	const e = eltern || {};
	liste.forEach((zeile) => {
		if (!zeile || !Object.prototype.hasOwnProperty.call(werte, zeile.karte)) {
			return;
		}
		const wert = avesmapsWikiAssignTerritoriumText(zeile.neu);
		if (zeile.karte === "eltern") {
			// 🔴 Nur bestaetigen, nie nachschlagen: die Kennung stammt aus dem Modellbaum, der Name aus
			// derselben Zeile. Weichen sie ab, ist der Stand veraltet -- dann wird gar nichts gesetzt.
			const passt = wert !== "" && wert === avesmapsWikiAssignTerritoriumText(e.name)
				&& avesmapsWikiAssignTerritoriumText(e.public_id) !== "";
			werte.eltern = passt ? wert : null;
			werte.eltern_public_id = passt ? avesmapsWikiAssignTerritoriumText(e.public_id) : null;
			return;
		}
		werte[zeile.karte] = wert === "" ? null : wert;
	});
	return werte;
}

/** REIN: hat die Uebernahme ueberhaupt etwas zu tun? Zaehlt ALLE Ziele, nie zwei davon von Hand. */
function avesmapsWikiAssignTerritoriumSyncLeer(werte) {
	const w = werte || {};
	return AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER.every((feld) => w[feld] === null || w[feld] === undefined);
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER: AVESMAPS_WIKI_ASSIGN_TERRITORIUM_KARTENFELDER,
		AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_GESPERRT: AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_GESPERRT,
		AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_UNBEKANNT: AVESMAPS_WIKI_ASSIGN_TERRITORIUM_ELTERN_UNBEKANNT,
		avesmapsWikiAssignTerritoriumZeitraum: avesmapsWikiAssignTerritoriumZeitraum,
		avesmapsWikiAssignTerritoriumModell: avesmapsWikiAssignTerritoriumModell,
		avesmapsWikiAssignTerritoriumEltern: avesmapsWikiAssignTerritoriumEltern,
		avesmapsWikiAssignTerritoriumWerte: avesmapsWikiAssignTerritoriumWerte,
		avesmapsWikiAssignTerritoriumTreffer: avesmapsWikiAssignTerritoriumTreffer,
		avesmapsWikiAssignTerritoriumArtikel: avesmapsWikiAssignTerritoriumArtikel,
		avesmapsWikiAssignTerritoriumZustand: avesmapsWikiAssignTerritoriumZustand,
		avesmapsWikiAssignTerritoriumSyncWerte: avesmapsWikiAssignTerritoriumSyncWerte,
		avesmapsWikiAssignTerritoriumSyncLeer: avesmapsWikiAssignTerritoriumSyncLeer,
	};
}

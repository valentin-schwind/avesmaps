// Der Datenweg des HERRSCHAFTSGEBIETS im Kartendialog „Herrschaftsgebiet bearbeiten".
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md (§7).
// Bauteil: js/ui/wiki-assign.js, Huelle „label-wiki". Objektart-Eigenes:
// js/ui/wiki-assign-territorium.js -- dort steht auch die Messung, WARUM diese Oberflaeche und nicht
// der Sync-Monitor die Zuweisung traegt.
//
// 💣 HIER STANDEN 175 ZEILEN EIGENER PICKER samt einem ZWEITEN Fenster
// (`#region-wiki-picker-overlay`): erst „Wiki-Referenz aendern" druecken, dann im Dialog daneben
// tippen, dann eine Zeile anklicken. Entwurf §1 zaehlt diese Datei unter den sechs Fassungen auf und
// beschreibt sie mit „Eine (`region`) filtert im Browser" -- das Filtern bleibt, das zweite Fenster
// nicht: gesucht wird jetzt IM Kasten, wie ueberall.
//
// ⚠️ WAS DER UMBAU KOSTET, namentlich: der alte Picker durchsuchte acht Felder
// (Name, Staatsform, Zugehoerigkeit, Wurzel, Status, Hauptstadt, Herrschaftssitz, Oberhaupt) und
// zeigte bis zu 250 Zeilen. Das Bauteil filtert ueber den NAMEN und deckelt bei 40 -- dieselbe Regel
// wie bei den drei Server-Suchen und bei den Kraftlinien. 🔧 Wer nach „alle Baronien im Kosch" sucht,
// findet sie damit nicht mehr; das ist der Preis der einen Suchform und gehoert vor die Augen des
// Owners, nicht in eine stille Sonderregel fuer diese eine Objektart.

// Die Kandidatenliste. 🔴 Sie kommt aus `?action=wiki_list` und NICHT aus dem Modellbaum: nur diese
// Antwort traegt die `id` (= political_territory_wiki.id), und genau die will `update_territory` als
// `wiki_id` (api/_internal/political/territories-write.php:239).
async function loadPoliticalTerritoryWikiReferences() {
	if (politicalTerritoryWikiReferences.length > 0) {
		return politicalTerritoryWikiReferences;
	}

	const response = await fetchPoliticalTerritories({
		action: "wiki_list",
		continent: "Aventurien",
	});
	politicalTerritoryWikiReferences = Array.isArray(response.wiki)
		? response.wiki.map((entry) => ({
			...entry,
			type: normalizeParentheticalSpacing(entry.type || ""),
		}))
		: [];
	return politicalTerritoryWikiReferences;
}

// Der Hierarchie-Modellbaum -- die EINZIGE Quelle der Eltern-Sperre (`parent_locked` steht in
// `wiki_territory_model` und verlaesst den Server nur ueber diesen Leseweg,
// api/_internal/wiki/sync-monitor-tree.php:243).
//
// 💣 EINMAL JE SITZUNG, nicht je Dialog: der Baum umfasst den gesamten Bestand, und der Endpunkt
// laeuft auf STRATO (AGENTS.md §9 -- teure Endpunkte nie in Schleife).
// 🔴 Ein Fehlschlag ist KEIN leerer Baum. Ein leerer Baum hiesse „nirgends ist etwas gesperrt", und
// die Vorschau boete an, eine gesperrte Hierarchie zu ueberschreiben. Deshalb merkt sich `gelesen`
// den Unterschied, und avesmapsWikiAssignTerritoriumEltern sperrt im Zweifel.
const TERRITORY_WIKI_MODEL_TREE_API = "/api/edit/wiki/sync-monitor.php?action=model_tree";
let territoryWikiModell = null;
let territoryWikiAssign = null;
// Der zuletzt geladene Eltern-Vorschlag: Name UND Gebiets-public_id. 🔴 Er wird beim Uebernehmen
// gebraucht, weil die Vorschauzeile nur den NAMEN traegt -- aufgeloest wird ueber die Kennung, nie
// ueber den Namen (js/ui/wiki-assign-territorium.js).
let territoryWikiEltern = { name: "", public_id: "", gesperrt: true, grund: "" };
// 🔴 DER GELADENE STAND DER DREI FORMULARFELDER -- der Bezugspunkt für „Abbrechen"
// (territoryWikiAssignVerwerfen). Hier liegt der Entwurf NICHT in einer Variablen, sondern im
// FORMULAR: `territoryWikiAssignZuweisen` schreibt `region-edit-wiki-id`, `-wiki-url` und ggf.
// `-coat-url`, und `territoryWikiAssignZustand` liest sie wieder. Ohne diesen Abzug könnte der
// Rückweg nur „auf leer" heißen.
// ⚠️ Gefüllt wird er in `renderRegionWikiReference`, also genau dann, wenn der Dialog seine Werte
// schon eingesetzt hat (`populateRegionEditForm` ruft ihn zuletzt) und noch niemand geklickt hat.
let territoryWikiFelderGeladen = { wiki_id: "", wiki_url: "", coat_url: "" };

async function ladeTerritoriumModell() {
	if (territoryWikiModell) {
		return territoryWikiModell;
	}
	try {
		const antwort = await fetch(TERRITORY_WIKI_MODEL_TREE_API, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		// 💣 `fetch` loest auch bei 401/403/500 AUF -- ohne diese Zeile wuerde aus einer abgelaufenen
		// Sitzung ein Baum ohne Sperren.
		if (!antwort.ok) {
			throw new Error(`Der Server antwortete mit ${antwort.status}.`);
		}
		const daten = await antwort.json();
		const knoten = Array.isArray(daten && daten.nodes)
			? daten.nodes
			: (Array.isArray(daten && daten.items) ? daten.items : null);
		if (!knoten) {
			throw new Error("Unerwartete Antwort.");
		}
		territoryWikiModell = avesmapsWikiAssignTerritoriumModell(knoten, true);
	} catch (fehler) {
		// ⚠️ NICHT gemerkt: ein Fehlschlag darf nicht die ganze Sitzung lang gelten. Der naechste
		// Dialog fragt neu.
		console.warn("Hierarchie-Modell konnte nicht gelesen werden:", fehler);
		return avesmapsWikiAssignTerritoriumModell([], false);
	}
	return territoryWikiModell;
}

function territoryWikiElement(id) {
	return document.getElementById(id);
}

function territoryWikiWert(id) {
	return String(territoryWikiElement(id)?.value || "").trim();
}

/**
 * 💣 WIRFT, statt einen Rueckfall zu liefern -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js.
 * Ein `laden`, das im Fehlerfall AUFLOEST, ist von „nichts zugewiesen" nicht zu unterscheiden; das
 * Formular schickt `wiki_id` und `wiki_url` bei JEDEM Speichern mit, ein aufgeloestes Leeres loeschte
 * die Zuweisung des Gebiets also beim naechsten Klick.
 *
 * ⚠️ Der MODELLBAUM darf trotzdem ausfallen, ohne den Kasten mitzunehmen: er traegt nur die
 * Eltern-Zeile, und sein Ausfall sperrt sie (siehe ladeTerritoriumModell). Die Zuweisung selbst
 * bleibt lesbar -- ein geworfener Fehler waere hier die schlechtere Auskunft.
 */
async function territoryWikiAssignZustand() {
	const [kandidaten, modell] = await Promise.all([
		loadPoliticalTerritoryWikiReferences(),
		ladeTerritoriumModell(),
	]);
	const kennung = territoryWikiWert("region-edit-wiki-id");
	const kandidat = kennung === ""
		? null
		: (kandidaten.find((eintrag) => String(eintrag.id) === kennung) || null);
	territoryWikiEltern = avesmapsWikiAssignTerritoriumEltern(
		String(kandidat?.wiki_key || ""),
		modell
	);
	return avesmapsWikiAssignTerritoriumZustand({
		wiki_id: kennung,
		wiki_key: kandidat?.wiki_key || "",
		wiki_url: territoryWikiWert("region-edit-wiki-url"),
		wiki_name: kandidat?.name || "",
		kandidat: kandidat,
		kandidaten: kandidaten,
		modell: modell,
		// 💣 Lesefunktionen, nicht Werte: `laden` laeuft einmal, die Sync-Vorschau entsteht erst beim
		// Druck auf „Sync" -- dazwischen kann im Formular getippt worden sein.
		name: () => territoryWikiWert("region-edit-name"),
		type: () => territoryWikiWert("region-edit-type"),
		coat_of_arms_url: () => territoryWikiWert("region-edit-coat-url"),
		// Die Eltern-Zeile vergleicht NAMEN -- also steht hier der Anzeigename des heutigen
		// Kartenelternteils, nicht seine public_id (updateRegionParentDropTarget setzt ihn,
		// js/review/review-region-assignment-ui.js:17-24). „Kein Parent" heisst leer.
		eltern: () => {
			const text = String(territoryWikiElement("region-edit-parent-drop-label")?.textContent || "").trim();
			return text === "Kein Parent" ? "" : text.split(" - ")[0];
		},
	});
}

/**
 * Zuweisen -- und hier wird NICHT geschrieben: der Dialog hat „Abbrechen", und
 * `buildRegionEditPayload` liest beim Speichern das Formular.
 *
 * 🔴 Genau das tat `applyRegionWikiReferenceSelection` schon vor dem Umbau, Feld fuer Feld: Kennung
 * und Adresse ins versteckte Feld, die Wappenadresse nur, wenn das Wiki eine hat, und die Staatsform
 * in die Auswahl -- die dafuer notfalls eine Option dazubekommt, weil `<option>`-Werte aus den
 * gepflegten Gebieten stammen und ein frisch gecrawlter Wikiwert dort fehlen kann.
 * ⚠️ Der NAME bleibt stehen: ihn zu ueberschreiben war nie das Verhalten dieses Dialogs -- dafuer
 * gibt es jetzt die Sync-Vorschau, die ZEIGT, was sie aendert.
 */
function territoryWikiAssignZuweisen(treffer) {
	const roh = (treffer && treffer.roh) || {};
	const kennung = territoryWikiElement("region-edit-wiki-id");
	if (kennung) {
		kennung.value = String(roh.id || "");
	}
	const adresse = territoryWikiElement("region-edit-wiki-url");
	if (adresse) {
		adresse.value = String(roh.wiki_url || "");
	}
	if (roh.coat_of_arms_url) {
		const wappen = territoryWikiElement("region-edit-coat-url");
		if (wappen) {
			wappen.value = roh.coat_of_arms_url;
		}
	}
	territoryWikiStaatsform(roh.type);
	// 🔴 Der Eltern-Vorschlag folgt dem neuen Artikel: er haengt am Schluessel, nicht am Gebiet.
	// Ohne diese Zeile bezoege sich ein „Uebernehmen" gleich danach auf den VORHERIGEN Artikel.
	territoryWikiEltern = avesmapsWikiAssignTerritoriumEltern(
		String(roh.wiki_key || ""),
		territoryWikiModell || avesmapsWikiAssignTerritoriumModell([], false)
	);
	syncRegionCoatPreview();
	toggleTerritoryOtherSourceSection(true);
}

/** Die Staatsform aus dem Wiki setzen -- mit der Nachtrags-Option, die der alte Picker auch hatte. */
function territoryWikiStaatsform(wert) {
	const text = normalizeParentheticalSpacing(String(wert || "").trim());
	const auswahl = territoryWikiElement("region-edit-type");
	if (text === "" || !auswahl) {
		return;
	}
	if (!Array.from(auswahl.options || []).some((option) => option.value === text)) {
		auswahl.append(new Option(text, text));
	}
	auswahl.value = text;
}

function territoryWikiAssignLoesen() {
	const kennung = territoryWikiElement("region-edit-wiki-id");
	if (kennung) {
		kennung.value = "";
	}
	const adresse = territoryWikiElement("region-edit-wiki-url");
	if (adresse) {
		adresse.value = "";
	}
	territoryWikiEltern = { name: "", public_id: "", gesperrt: false, grund: "" };
	toggleTerritoryOtherSourceSection(false);
}

/**
 * „Abbrechen" im Zuweisungskasten: die ungespeicherte Zuweisungsänderung verwerfen.
 *
 * 🔴 Der Entwurf liegt in den FORMULARFELDERN, nicht im Bauteil -- `update_territory` schickt
 * `wiki_id`/`wiki_url` bei jedem Speichern mit. Ohne diese Rücknahme zeigte der Kasten nach dem
 * `neuLaden()` wieder den alten Artikel (er liest ja dieselben Felder), aber nur, weil sie schon
 * überschrieben WAREN -- verworfen wäre gar nichts.
 * ⚠️ Zurück auf den GELADENEN Stand, auch beim WAPPEN: `territoryWikiAssignZuweisen` überschreibt
 * `region-edit-coat-url`, sobald der Treffer eines mitbringt. Es hier stehenzulassen hieße, ein
 * Wappen zu behalten, dessen Herkunft der Editor gerade abgelehnt hat.
 * ⚠️ Die STAATSFORM bleibt dagegen, wie sie ist: `territoryWikiStaatsform` setzt ein sichtbares
 * Auswahlfeld, und es zurückzudrehen könnte eine seither von Hand getroffene Wahl zerstören --
 * dieselbe Regel wie beim Namen der Landschaft und der Kategorie des Labels.
 */
function territoryWikiAssignVerwerfen() {
	const kennung = territoryWikiElement("region-edit-wiki-id");
	if (kennung) {
		kennung.value = territoryWikiFelderGeladen.wiki_id;
	}
	const adresse = territoryWikiElement("region-edit-wiki-url");
	if (adresse) {
		adresse.value = territoryWikiFelderGeladen.wiki_url;
	}
	const wappen = territoryWikiElement("region-edit-coat-url");
	if (wappen) {
		wappen.value = territoryWikiFelderGeladen.coat_url;
	}
	// Der Eltern-Vorschlag hängt am Schlüssel; `territoryWikiAssignZustand` rechnet ihn beim
	// folgenden `neuLaden()` neu -- hier steht er nur auf einen unverfänglichen Anfangswert.
	territoryWikiEltern = { name: "", public_id: "", gesperrt: true, grund: "" };
	syncRegionCoatPreview();
	toggleTerritoryOtherSourceSection(territoryWikiFelderGeladen.wiki_id !== "");
}

// „Andere Quelle" ist nur sichtbar, solange KEINE Wiki-Zuweisung besteht -- dieselbe Regel wie in
// jedem anderen Editor des Hauses (js/review/review-other-source.js).
function toggleTerritoryOtherSourceSection(hatWiki) {
	if (typeof toggleOtherSourceSection === "function") {
		toggleOtherSourceSection("region-edit", hatWiki === true);
	}
}

/**
 * ⚠️ UEBERNEHMEN FUELLT NUR DAS FORMULAR -- gespeichert wird mit „Speichern".
 * 🔴 WIRFT, wenn nichts anzuwenden war: das Bauteil liest eine Ablehnung als „es ist nichts passiert"
 * und laesst die Vorschau stehen.
 * 🔴 Die ELTERN-Zeile schreibt die public_id, nie den Namen. Kommt keine Kennung mit (der Modellbaum
 * kennt den Vorschlag nicht mehr), passiert an der Hierarchie nichts -- die uebrigen Angaben werden
 * trotzdem uebernommen.
 */
function territoryWikiAssignSyncUebernehmen(zeilen) {
	const werte = avesmapsWikiAssignTerritoriumSyncWerte(zeilen, territoryWikiEltern);
	if (avesmapsWikiAssignTerritoriumSyncLeer(werte)) {
		throw new Error("Keine übernehmbare Angabe angehakt.");
	}
	if (werte.name !== null) {
		const feld = territoryWikiElement("region-edit-name");
		if (feld) {
			feld.value = werte.name;
		}
	}
	if (werte.type !== null) {
		territoryWikiStaatsform(werte.type);
	}
	if (werte.coat_of_arms_url !== null) {
		const feld = territoryWikiElement("region-edit-coat-url");
		if (feld) {
			feld.value = werte.coat_of_arms_url;
		}
		syncRegionCoatPreview();
	}
	if (werte.eltern_public_id !== null && typeof updateRegionParentDropTarget === "function") {
		updateRegionParentDropTarget(werte.eltern_public_id);
	}
}

/**
 * Der Einstiegspunkt aus `populateRegionEditForm` -- er heisst weiter `renderRegionWikiReference`,
 * weil `js/review/review-region-dialog-population.js:41` ihn so ruft.
 *
 * 🔴 Der Behaelter ist ein BLANKES `<div>`: die Huelle `.label-wiki-reference` erzeugt das Bauteil
 * selbst, und auch die Ueberschrift kommt von dort (Erklaerung `territorium`, label
 * „Wiki-Herrschaftsgebiet"). Ein `<h3>` daneben waere die zweite.
 */
function renderRegionWikiReference() {
	const host = territoryWikiElement("territory-wiki-assign-host");
	if (!host || typeof avesmapsWikiAssignMount !== "function") {
		return;
	}
	if (territoryWikiAssign) {
		territoryWikiAssign.zerstoeren();
		territoryWikiAssign = null;
	}
	// 🔴 DER ABZUG DES GELADENEN STANDES, und er MUSS vor dem Mount stehen: `laden` läuft sofort und
	// liest dieselben Felder. Danach kann nur noch ein Klick sie verändert haben -- und genau den
	// nimmt „Abbrechen" zurück.
	territoryWikiFelderGeladen = {
		wiki_id: territoryWikiWert("region-edit-wiki-id"),
		wiki_url: territoryWikiWert("region-edit-wiki-url"),
		coat_url: territoryWikiWert("region-edit-coat-url"),
	};
	territoryWikiAssign = avesmapsWikiAssignMount(host, {
		subject: "territorium",
		// Der Kartendialog: index.html laedt css/components/region-sync.css, nicht editor-page.css.
		skin: "label-wiki",
		laden: territoryWikiAssignZustand,
		// ⚠️ KEIN `trefferAufbereiten`: das ruft das Bauteil nur bei `suche.art === "server"`. Hier
		// wird im Browser gefiltert, und die Kandidaten kommen bereits fertig aus `daten.listen`
		// (avesmapsWikiAssignTerritoriumZustand). Ein Bauer hier waere tot und laese sich wie ein Beleg.
		zuweisen: territoryWikiAssignZuweisen,
		loesen: territoryWikiAssignLoesen,
		verwerfen: territoryWikiAssignVerwerfen,
		syncUebernehmen: territoryWikiAssignSyncUebernehmen,
	});
}

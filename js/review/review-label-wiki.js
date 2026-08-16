// Der Datenweg des LANDSCHAFTS-LABELS -- die dritte Oberfläche, die eine Wiki-Landschaft zuweist.
//
// 🔴 SIE HEFTET SIE AN EIN ANDERES OBJEKT ALS DIE ZWEI ANDEREN. Der Flächen-Dialog und der
// Regionen-Editor schreiben in `ecosystem_region` (Spalten `wiki_url` + `wiki_region_key`); dieser
// hier schreibt in `map_features.properties.wiki_region` -- ein ganzes NEST, das den halben
// Wiki-Artikel mitträgt, weil die Infobox des Labels davon lebt. Deshalb eine eigene Erklärung
// (`landschaftslabel`) und derselbe Datenweg (js/ui/wiki-assign-landschaft.js); die vollständige
// Messung, warum das nicht dieselbe Objektart ist, steht im Kopf jener Datei.
//
// 💣 HIER STANDEN 379 ZEILEN EIGENER PICKER, und darin eine ZWEITE Abschrift der Art-Tabelle
// (`LABEL_WIKI_ART_TO_SUBTYPE`). Ihr eigener Kommentar sagte „Konsistent mit der PHP-Mapping-Tabelle"
// -- gemessen am 16.08.2026 war sie es nicht mehr: sie führte `gebirgskette`, `berg`, `gipfel`,
// `forst` und `fluss`, die PHP-Tabelle keines davon. Damit rechnete dieselbe Wiki-Art je nach
// Oberfläche verschieden, und der Typkonflikt-Bericht des Servers widersprach dem Pfeilknopf des
// Editors. Genau die Divergenz, gegen die dieser Umbau gebaut wird.
//
// ⚠️ WAS DER UMBAU KOSTET, namentlich: `Gebirgskette`, `Forst` und `Gipfel` lösen die Kategorie
// nicht mehr auf -- sie stehen in KEINER der beiden Server-Quellen. `Berg` und `Fluss` bleiben
// getroffen (der Parser schreibt „Berg" ohnehin zu „Berggipfel" um, und „Fluss" trifft die
// gleichnamige Label-Kategorie schon über Schritt 1 der Art-Ordnung).
// 🔧 Der ehrliche Weg, sie zurückzuholen, wäre eine Zeile in AVESMAPS_WIKI_REGION_ART_TO_SUBTYPE
// (api/_internal/wiki/regions.php) -- das schaltet aber zugleich die Typkonflikt-Prüfung des
// Servers für jedes betroffene Label scharf und ist deshalb eine Owner-Entscheidung, kein Nachtrag.

const LABEL_WIKI_API_URL = "/api/edit/wiki/regions.php";
let currentLabelWikiRegion = null; // das aktuell zugeordnete wiki_region-Objekt (oder null)
let labelWikiAssign = null;        // die Steuerung des geteilten Bauteils
let labelWikiSchnappschuss = null; // die frische Staging-Zeile zur zugewiesenen Landschaft

function labelWikiElement(id) {
	return document.getElementById(id);
}

/**
 * Das NEST, wie es in `properties.wiki_region` liegt -- aus einer Staging-Zeile gebaut.
 *
 * 🔴 BLEIBT, und wird von aussen benutzt: `ecosystemWikiRegionSnapshot`
 * (js/map-features/map-features-ecosystem-draw.js) reicht seine Zeile hierdurch, damit ein aus der
 * Fläche erzeugtes Label dasselbe Nest bekommt wie ein von Hand zugewiesenes. Eine zweite Fassung
 * wäre die zweite Wahrheit darüber, was ein Label vom Wiki mitbekommt.
 */
function labelWikiRegionFromRow(row) {
	if (!row) {
		return null;
	}
	return {
		wiki_key: row.wiki_key || "",
		name: row.name || "",
		art: row.art || "",
		continent: row.continent || "",
		region_parent: row.region_parent || "",
		affiliation_staat: row.affiliation_staat || "",
		einwohner: row.einwohner || "",
		sprache: row.sprache || "",
		vegetation: row.vegetation || "",
		verkehrswege: row.verkehrswege || "",
		description: row.description || "",
		image_url: row.image_url || "",
		image_license: row.image_license || "",
		image_author: row.image_author || "",
		image_attribution: row.image_attribution || "",
		image_license_status: row.image_license_status || "",
		image_license_url: row.image_license_url || "",
		wiki_url: row.wiki_url || "",
		neighbors: row.neighbors || row.neighbors_json || {},
		synonyms: row.synonyms || row.synonyms_json || [],
		synced_at: row.synced_at || "",
	};
}

// Der GELADENE Stand des dritten Zustands -- der Bezugspunkt, gegen den das Bauteil „seit dem Laden
// verändert" rechnet. 🔴 Er kommt mit dem Label (`properties.wiki_no_article`) und wird hier NICHT
// gepflegt: das Häkchen wohnt im Bauteil, bis „Speichern" es abholt.
let labelWikiKeinArtikelGeladen = false;

/** Der Stand, den ein Label lädt. Ruft das Bauteil neu auf, damit der Kasten dem Label folgt. */
function setLabelWikiRegion(wiki, keinArtikel) {
	currentLabelWikiRegion = wiki && wiki.wiki_key ? wiki : null;
	labelWikiSchnappschuss = null;
	labelWikiKeinArtikelGeladen = keinArtikel === true;
	toggleLabelOtherSourceSection();
	mountLabelWikiAssign();
}

/**
 * Eine Wiki-Landschaft von aussen ans Formular heften -- js/review/review-region-sync.js:375 ruft
 * das, wenn ein Editor eine fehlende Region aus der WikiSync-Liste heraus als Label anlegt.
 * 🔴 Der Name bleibt, was er war: jener Aufrufer sucht die Funktion über `window` und fällt sonst
 * still auf `setLabelWikiRegion` zurück -- dann bliebe die Kategorie ungesetzt, und niemand sähe es.
 */
function assignLabelWikiRegionToForm(wiki) {
	setLabelWikiRegion(wiki, false);
	labelWikiKategorieAusArt(wiki && wiki.art);
}

function resetLabelWikiState() {
	currentLabelWikiRegion = null;
	labelWikiSchnappschuss = null;
	labelWikiKeinArtikelGeladen = false;
	toggleLabelOtherSourceSection();
	mountLabelWikiAssign();
}

// Wird von buildLabelEditPayload aufgerufen: liefert das Objekt (oder null = Zuordnung entfernen).
function getLabelWikiRegionPayload() {
	return currentLabelWikiRegion || null;
}

/**
 * 🔴 DER DRITTE ZUSTAND, und er reist NUR MIT, WENN DAS HÄKCHEN SEIT DEM LADEN UMGELEGT WURDE
 * (Owner-Entscheid 16.08.2026, anstelle eines `expected_revision`). `null` heisst „nicht schicken";
 * `update_label` liest einen FEHLENDEN Schlüssel als „nicht geändert"
 * (api/_internal/map/features.php).
 * 💣 GEPRÜFT WIRD VERÄNDERT, NICHT GESETZT: ein bewusst ENTFERNTES Häkchen schickt `false` und
 * löscht den Merker -- hinge der Riegel an „gesetzt", würde man ihn nie wieder los.
 */
function getLabelWikiNoArticlePayload() {
	if (!labelWikiAssign || !labelWikiAssign.bereit) {
		return null;
	}
	const stand = labelWikiAssign.lies();
	return stand && stand.kein_artikel_geaendert === true ? stand.kein_artikel === true : null;
}

// „Andere Quelle" ist nur sichtbar, solange KEINE Wiki-Landschaft zugewiesen ist -- dieselbe Regel
// wie in jedem anderen Editor des Hauses (review-other-source.js).
function toggleLabelOtherSourceSection() {
	if (typeof toggleOtherSourceSection === "function") {
		toggleOtherSourceSection("label-edit", Boolean(currentLabelWikiRegion));
	}
}

/**
 * 💣 WIRFT, statt einen Rückfall zu liefern -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js.
 * Ein `laden`, das im Fehlerfall auflöst, ist von „nichts zugewiesen" nicht zu unterscheiden, und
 * `buildLabelEditPayload` schickt `wiki_region` bei JEDEM Speichern mit: ein aufgelöstes Leeres
 * würde die Zuweisung des Labels also beim nächsten Klick löschen.
 */
async function ladeLabelWikiSchnappschuss(wikiKey) {
	const key = String(wikiKey || "").trim();
	if (key === "") {
		return null;
	}
	const antwort = await fetch(
		`${LABEL_WIKI_API_URL}?action=staging_sample&wiki_keys=${encodeURIComponent(key)}&limit=1`,
		{ credentials: "same-origin", headers: { Accept: "application/json" } }
	);
	if (!antwort.ok) {
		throw new Error(`Der Server antwortete mit ${antwort.status}.`);
	}
	const daten = avesmapsWikiAssignLandschaftAntwortPruefen(await antwort.json());
	// ⚠️ Eine leere Trefferliste ist KEIN Fehler: der Schlüssel kann verwaist sein. Der Kasten fällt
	// dann auf das gespeicherte Nest zurück (avesmapsWikiAssignLandschaftslabelZustand).
	return (daten.rows || [])[0] || null;
}

/** Das Art-Vokabular DIESES Labels -- die `<option>`-Liste, in der Form, die die Art-Ordnung liest. */
function labelWikiArten() {
	const select = labelWikiElement("label-edit-type");
	if (!select || !select.options) {
		return [];
	}
	return Array.from(select.options)
		.filter((option) => String(option.value || "") !== "")
		.map((option) => ({ type_key: option.value, label: option.textContent || option.label || "" }));
}

/**
 * Die Kategorie des Labels aus der Wiki-Art setzen -- NUR, wenn das Auswahlfeld den Schlüssel kennt.
 * 🔴 EINE Stelle für beide Aufrufer (Zuweisen im Kasten und der WikiSync-Weg von aussen); zwei
 * Abschriften waren genau die Bauform, in der die alte Art-Tabelle vom Server abgedriftet ist.
 */
function labelWikiKategorieAusArt(art) {
	const subtype = avesmapsWikiAssignLandschaftArt(art, labelWikiArten());
	const typeSelect = labelWikiElement("label-edit-type");
	if (subtype !== "" && typeSelect && Array.from(typeSelect.options || []).some((option) => option.value === subtype)) {
		typeSelect.value = subtype;
	}
}

async function labelWikiAssignZustand() {
	const schluessel = String(currentLabelWikiRegion?.wiki_key || "").trim();
	if (schluessel !== "" && String(labelWikiSchnappschuss?.wiki_key || "") !== schluessel) {
		labelWikiSchnappschuss = await ladeLabelWikiSchnappschuss(schluessel);
	}
	if (schluessel === "") {
		labelWikiSchnappschuss = null;
	}
	return avesmapsWikiAssignLandschaftslabelZustand({
		wiki_region: currentLabelWikiRegion,
		schnappschuss: labelWikiSchnappschuss,
		arten: labelWikiArten(),
		kein_artikel: labelWikiKeinArtikelGeladen,
		// 💣 Lesefunktionen, nicht Werte: `laden` läuft einmal, die Sync-Vorschau entsteht erst beim
		// Druck auf „Sync" -- dazwischen kann im Formular getippt worden sein.
		text: () => String(labelWikiElement("label-edit-text")?.value || ""),
		feature_subtype: () => String(labelWikiElement("label-edit-type")?.value || ""),
	});
}

/**
 * Zuweisen -- und hier wird NICHT geschrieben: der Label-Dialog hat „Abbrechen", und
 * `buildLabelEditPayload` nimmt die Zuweisung beim Speichern mit.
 *
 * 🔴 Die Kategorie folgt SOFORT, wie bisher (das tat `applyLabelWikiToForm` schon vor dem Umbau) --
 * nur wenn das Auswahlfeld den Schlüssel kennt. Der TEXT bleibt stehen: ihn zu überschreiben war nie
 * das Verhalten dieses Dialogs, dafür gab es den „↻"-Knopf und heute die Sync-Vorschau.
 */
function labelWikiAssignZuweisen(treffer) {
	const roh = (treffer && treffer.roh) || {};
	currentLabelWikiRegion = labelWikiRegionFromRow(roh);
	labelWikiSchnappschuss = roh;
	toggleLabelOtherSourceSection();
	labelWikiKategorieAusArt(roh.art);
}

function labelWikiAssignLoesen() {
	currentLabelWikiRegion = null;
	labelWikiSchnappschuss = null;
	toggleLabelOtherSourceSection();
}

/**
 * ⚠️ ÜBERNEHMEN FÜLLT NUR DAS FORMULAR -- gespeichert wird mit „Speichern".
 * 🔴 WIRFT, wenn nichts anzuwenden war: das Bauteil liest eine Ablehnung als „es ist nichts
 * passiert" und lässt die Vorschau stehen.
 */
function labelWikiAssignSyncUebernehmen(zeilen) {
	const werte = avesmapsWikiAssignLandschaftslabelSyncWerte(zeilen);
	if (avesmapsWikiAssignLandschaftslabelSyncLeer(werte)) {
		throw new Error("Keine übernehmbare Angabe angehakt.");
	}
	const textInput = labelWikiElement("label-edit-text");
	if (werte.text !== null && textInput) {
		textInput.value = werte.text;
	}
	const typeSelect = labelWikiElement("label-edit-type");
	if (werte.feature_subtype !== null && typeSelect
		&& Array.from(typeSelect.options || []).some((option) => option.value === werte.feature_subtype)) {
		typeSelect.value = werte.feature_subtype;
	}
	// 🔴 Und das NEST folgt dem Wiki nach: genau das tat der alte „Sync"-Knopf, und ohne diese Zeile
	// bliebe der halbe Artikel, den die Infobox des Labels zeigt, auf dem Stand der Zuweisung stehen.
	if (labelWikiSchnappschuss) {
		currentLabelWikiRegion = labelWikiRegionFromRow(labelWikiSchnappschuss);
	}
}

/**
 * Das Häkchen „Kein Wiki-Artikel vorhanden" wurde umgelegt -- gespeichert ist damit nichts.
 * 🔴 Der Merker wohnt im BAUTEIL, bis „Speichern" ihn über `lies()` abholt; ihn hier in ein
 * verstecktes Feld zu schreiben hiesse, ihn beim nächsten `laden` als GELADENEN Stand zu sehen, und
 * der Haken täte nichts.
 */
function mountLabelWikiAssign() {
	const host = labelWikiElement("label-wiki-assign-host");
	if (!host || typeof avesmapsWikiAssignMount !== "function") {
		return;
	}
	if (labelWikiAssign) {
		labelWikiAssign.zerstoeren();
		labelWikiAssign = null;
	}
	labelWikiAssign = avesmapsWikiAssignMount(host, {
		subject: "landschaftslabel",
		// Der Kartendialog: index.html lädt css/components/region-sync.css, nicht editor-page.css.
		skin: "label-wiki",
		laden: labelWikiAssignZustand,
		trefferAufbereiten: (zeile) => avesmapsWikiAssignLandschaftTreffer(zeile, labelWikiArten()),
		zuweisen: labelWikiAssignZuweisen,
		loesen: labelWikiAssignLoesen,
		syncUebernehmen: labelWikiAssignSyncUebernehmen,
	});
}

window.setLabelWikiRegion = setLabelWikiRegion;
window.resetLabelWikiState = resetLabelWikiState;
window.getLabelWikiRegionPayload = getLabelWikiRegionPayload;
window.getLabelWikiNoArticlePayload = getLabelWikiNoArticlePayload;
window.labelWikiRegionFromRow = labelWikiRegionFromRow;
window.assignLabelWikiRegionToForm = assignLabelWikiRegionToForm;

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
// 🔴 DER GELADENE STAND DER ZUWEISUNG -- der Bezugspunkt für „Abbrechen" (labelWikiAssignVerwerfen).
// Ohne ihn könnte der Rückweg nur „auf leer" heißen, und ein Abbrechen NACH einem „Lösen" bestätigte
// die Löschung, statt sie zurückzunehmen.
// ⚠️ Er wird an denselben zwei Stellen gesetzt wie `currentLabelWikiRegion` selbst, und NUR dort:
// jede weitere Setzstelle wäre die zweite Wahrheit darüber, was „geladen" heißt.
let labelWikiRegionGeladen = null;
// 🔴 DIE FELDHERKUNFT DES LABELS -- `{text|feature_subtype: "manual"|"wiki"}`, aus dem
// Kartenpayload (`properties.field_origins`, map-features-labels.js). Ein Feld OHNE Eintrag heisst
// „nicht bekannt", nie „vom Wiki".
let labelWikiFieldOrigins = null;
// 🔴 WELCHE FELDER SEIT DEM ÖFFNEN AUS DEM WIKI KAMEN. Der Server stempelt daraus die Feldherkunft
// (avesmapsFieldOriginsStempeln), und nur für Felder, deren Wert sich wirklich ändert. Ohne diese
// Liste stempelt er auch eine Sync-Übernahme als „von uns" -- die harmlose Richtung, aber die
// Auskunft wäre falsch, und der nächste Abgleich liesse genau die Felder in Ruhe, die er selbst
// gefüllt hat.
// ⚠️ Dieses Label hat nur EINE Oberfläche; die Zwei-Erzeuger-Falle gibt es hier nicht. Sie steht
// trotzdem in der Bauform der anderen, damit die nächste Oberfläche nichts erfinden muss.
let labelWikiUebernommen = new Set();
let letzterLabelWikiArtikel = null;

/** Der Stand, den ein Label lädt. Ruft das Bauteil neu auf, damit der Kasten dem Label folgt. */
function setLabelWikiRegion(wiki, keinArtikel, fieldOrigins) {
	currentLabelWikiRegion = wiki && wiki.wiki_key ? wiki : null;
	labelWikiRegionGeladen = currentLabelWikiRegion;
	labelWikiSchnappschuss = null;
	labelWikiKeinArtikelGeladen = keinArtikel === true;
	// ⚠️ DRITTER Parameter, und er ist optional: `assignLabelWikiRegionToForm` (der WikiSync-Weg von
	// aussen) ruft dieselbe Funktion mit zwei Argumenten. `undefined` heisst dort „nicht bekannt",
	// und das ist richtig -- ein frisch angelegtes Label hat noch keine Herkunft.
	labelWikiFieldOrigins = fieldOrigins && typeof fieldOrigins === "object" ? fieldOrigins : null;
	labelWikiUebernommen = new Set();
	letzterLabelWikiArtikel = null;
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
	labelWikiRegionGeladen = null;
	labelWikiSchnappschuss = null;
	labelWikiKeinArtikelGeladen = false;
	labelWikiFieldOrigins = null;
	labelWikiUebernommen = new Set();
	letzterLabelWikiArtikel = null;
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
	const zustand = avesmapsWikiAssignLandschaftslabelZustand({
		wiki_region: currentLabelWikiRegion,
		schnappschuss: labelWikiSchnappschuss,
		arten: labelWikiArten(),
		kein_artikel: labelWikiKeinArtikelGeladen,
		field_origins: labelWikiFieldOrigins,
		// 💣 Lesefunktionen, nicht Werte: `laden` läuft einmal, die Sync-Vorschau entsteht erst beim
		// Druck auf „Sync" -- dazwischen kann im Formular getippt worden sein.
		text: () => String(labelWikiElement("label-edit-text")?.value || ""),
		feature_subtype: () => String(labelWikiElement("label-edit-type")?.value || ""),
	});
	// ⚠️ NACH dem Bau, nicht davor: erst hier steht der Schnappschuss fest.
	letzterLabelWikiArtikel = zustand.artikel || null;
	labelWikiZeichneAbweichungen();
	return zustand;
}

// ---- Der Wiki-Override an den zwei Feldzeilen ---------------------------------------------------
// Entwurf: docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md
//
// 🔴 ZWEI SICHTBARE ZUSTÄNDE, NICHT VIER: braune Beschriftung + durchgestrichener Wiki-Stand + ↺
// heisst „wir haben das gesetzt"; ohne Farbe heisst „weicht ab, Herkunft unbekannt".
// `herkunft === "wiki"` wird mitgeschrieben, aber nicht angezeigt -- sie wirkt beim Vorhäkeln.
//
// 💣 DIE KATEGORIE TRÄGT EINEN SCHLÜSSEL. Ohne Übersetzung stünde „gebirge" durchgestrichen neben
// einem Feld, das „Gebirge" zeigt -- genau der Befund, der beim Ort am 17.08.2026 live sichtbar
// wurde und sich wie ein Tippfehler las. Die Beschriftungen kommen aus dem AUSWAHLFELD SELBST
// (`labelWikiArten`), nicht aus einer zweiten Liste.
function labelWikiZeichneAbweichungen() {
	if (typeof avesmapsWikiFeldStand !== "function" || typeof avesmapsWikiAssignSubject !== "function") {
		return;
	}
	const beschriftungen = {};
	labelWikiArten().forEach((art) => {
		beschriftungen[String(art.type_key)] = String(art.label || art.type_key);
	});
	const stand = avesmapsWikiFeldStand(
		(avesmapsWikiAssignSubject("landschaftslabel") || {}).felder || [],
		{
			text: String(labelWikiElement("label-edit-text")?.value || ""),
			feature_subtype: String(labelWikiElement("label-edit-type")?.value || ""),
		},
		(letzterLabelWikiArtikel && letzterLabelWikiArtikel.werte) || {},
		avesmapsWikiAssignLandschaftHerkunft(labelWikiFieldOrigins, AVESMAPS_WIKI_ASSIGN_LANDSCHAFTSLABEL_KARTENFELDER),
		{ feature_subtype: beschriftungen }
	);
	document.querySelectorAll("#label-edit-overlay [data-label-wiki-alt]").forEach((zelle) => {
		const feld = zelle.getAttribute("data-label-wiki-alt") || "";
		const s = stand[feld];
		zelle.replaceChildren();
		const vonUns = Boolean(s && s.abweicht && s.herkunft === "manual");
		// Die Hervorhebung sitzt an der BESCHRIFTUNG, nicht an der Zelle. Als Klasse gesetzt statt
		// per `:has()`: jene Elternauswahl fällt bei fehlender Browserfähigkeit LAUTLOS aus, und die
		// Zeile sähe dann aus wie eine mit unbekannter Herkunft -- also wie der andere Zustand.
		zelle.parentElement?.classList.toggle("has-wiki-ovr", vonUns);
		if (!s || !s.abweicht) {
			return;
		}
		const alt = document.createElement("span");
		alt.className = "dt-old";
		alt.textContent = s.wikiAnzeige;
		alt.title = (vonUns ? "Von uns gesetzt. " : "Weicht vom Wiki ab. ") + "Wiki-Stand: " + s.wikiAnzeige;
		const knopf = document.createElement("button");
		knopf.type = "button";
		knopf.className = "dt-reset";
		knopf.textContent = "↺";
		knopf.title = "Auf Wiki-Stand zurücksetzen";
		// ⚠️ Der Knopf sitzt IN einem `<label>`: ohne diesen Riegel reichte der Klick an das Feld
		// durch und fokussierte es, während sich sein Wert ändert.
		knopf.addEventListener("click", (ereignis) => {
			ereignis.preventDefault();
			ereignis.stopPropagation();
			labelWikiFeldZuruecksetzen(feld, s.wikiWert);
		});
		zelle.append(alt, knopf);
	});
}

/**
 * ↺ an einer Feldzeile: genau diesen einen Wert aus dem Wiki ins Formular holen.
 * ⭐ ES IST DIE SYNC-ÜBERNAHME EINER EINZIGEN ZEILE -- derselbe Weg, dieselbe Merkliste, kein
 * zweiter Schreibpfad. Geschrieben wird mit „Speichern".
 */
function labelWikiFeldZuruecksetzen(feld, wikiWert) {
	if (feld === "text") {
		const eingabe = labelWikiElement("label-edit-text");
		if (!eingabe) {
			return;
		}
		eingabe.value = wikiWert;
	} else if (feld === "feature_subtype") {
		const select = labelWikiElement("label-edit-type");
		// 💣 Nur, wenn das Auswahlfeld die Kategorie kennt -- dieselbe zweite Hälfte des Riegels wie
		// in `labelWikiKategorieAusArt`.
		if (!select || !Array.from(select.options || []).some((option) => option.value === wikiWert)) {
			return;
		}
		select.value = wikiWert;
	}
	labelWikiUebernommen.add(feld);
	labelWikiZeichneAbweichungen();
}

/** Die Felder, die dieses Speichern als Wiki-Übernahme nennt -- für `buildLabelEditPayload`. */
function getLabelWikiUebernommenPayload() {
	return Array.from(labelWikiUebernommen);
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
	// 🪤 Das Bauteil ruft nach „Zuweisen" KEIN `laden` -- es ändert seine Daten selbst. Ohne diese
	// zwei Zeilen zeigte der Kasten den neuen Artikel und die Feldzeile daneben den Stand des alten.
	labelWikiSchnappschuss = roh;
	letzterLabelWikiArtikel = avesmapsWikiAssignLandschaftslabelZustand({
		wiki_region: currentLabelWikiRegion,
		schnappschuss: roh,
		arten: labelWikiArten(),
		kein_artikel: labelWikiKeinArtikelGeladen,
		field_origins: labelWikiFieldOrigins,
		text: () => String(labelWikiElement("label-edit-text")?.value || ""),
		feature_subtype: () => String(labelWikiElement("label-edit-type")?.value || ""),
	}).artikel || null;
	labelWikiZeichneAbweichungen();
	labelWikiSchnappschuss = roh;
	labelWikiKategorieAusArt(roh.art);
}

function labelWikiAssignLoesen() {
	currentLabelWikiRegion = null;
	labelWikiSchnappschuss = null;
}

/**
 * „Abbrechen" im Zuweisungskasten: die ungespeicherte Zuweisungsänderung verwerfen.
 *
 * 🔴 Der Entwurf liegt HIER (`currentLabelWikiRegion`), nicht im Bauteil -- `buildLabelEditPayload`
 * liest ihn beim Speichern. Ohne diese Rücknahme zeigte der Kasten nach dem `neuLaden()` wieder den
 * alten Artikel, während das nächste „Speichern" den verworfenen schriebe.
 * ⚠️ Zurück auf den GELADENEN Stand, nicht auf `null`: ein Abbrechen nach einem „Lösen" muss die
 * vorhandene Zuweisung wiederherstellen.
 * ⚠️ Die KATEGORIE bleibt, wie sie ist. `labelWikiAssignZuweisen` setzt sie mit
 * (`labelWikiKategorieAusArt`), aber sie ist ein sichtbares Auswahlfeld -- sie zurückzudrehen könnte
 * eine seither von Hand getroffene Wahl zerstören. Dieselbe Regel wie beim Namen der Landschaft.
 */
function labelWikiAssignVerwerfen() {
	currentLabelWikiRegion = labelWikiRegionGeladen;
	// 💣 Auf `null`, nicht auf einen gemerkten Schnappschuss: `labelWikiAssignZustand` holt ihn selbst
	// nach, sobald der Schlüssel wieder steht.
	labelWikiSchnappschuss = null;
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
	// 🔴 ZWEITE HÄLFTE DER ÜBERNAHME: merken, WELCHE Felder aus dem Wiki kamen.
	const textInput = labelWikiElement("label-edit-text");
	if (werte.text !== null && textInput) {
		textInput.value = werte.text;
		labelWikiUebernommen.add("text");
	}
	const typeSelect = labelWikiElement("label-edit-type");
	if (werte.feature_subtype !== null && typeSelect
		&& Array.from(typeSelect.options || []).some((option) => option.value === werte.feature_subtype)) {
		typeSelect.value = werte.feature_subtype;
		labelWikiUebernommen.add("feature_subtype");
	}
	// 🔴 Und das NEST folgt dem Wiki nach: genau das tat der alte „Sync"-Knopf, und ohne diese Zeile
	// bliebe der halbe Artikel, den die Infobox des Labels zeigt, auf dem Stand der Zuweisung stehen.
	if (labelWikiSchnappschuss) {
		currentLabelWikiRegion = labelWikiRegionFromRow(labelWikiSchnappschuss);
	}
	labelWikiZeichneAbweichungen();
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
		verwerfen: labelWikiAssignVerwerfen,
		syncUebernehmen: labelWikiAssignSyncUebernehmen,
	});
}

// 🔴 TIPPEN IM FORMULAR AENDERT DIE ABWEICHUNG. Ohne diese zwei Zuhoerer bliebe ein
// durchgestrichener Wiki-Stand samt ↺ stehen, nachdem der Editor den Wert von Hand angeglichen
// hat -- ein Rueckholangebot fuer etwas, das gar nicht mehr abweicht.
// ⚠️ EINMAL, nicht bei jedem Oeffnen: die zwei Felder stehen fest in index.html, und
// `mountLabelWikiAssign` laeuft bei jedem Dialogaufruf -- dort verdrahtet, haetten sie sich
// gestapelt. Der Riegel steht deshalb hier, auf Modulebene.
// 💣 Gefunden hat diese Luecke der Wachtest js/ui/__tests__/wiki-feld-herkunft-geladen.test.js,
// unmittelbar nachdem er fuer den Zwilling im Kartendialog der Landschaft geschrieben war. Genau
// dafuer ist er da: eine Regel, die einen von mehreren Erzeugern bindet, ist keine Regel.
function verdrahteLabelWikiZeichner() {
	labelWikiElement("label-edit-text")?.addEventListener("input", labelWikiZeichneAbweichungen);
	labelWikiElement("label-edit-type")?.addEventListener("change", labelWikiZeichneAbweichungen);
}

if (typeof document !== "undefined") {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", verdrahteLabelWikiZeichner, { once: true });
	} else {
		verdrahteLabelWikiZeichner();
	}
}

window.setLabelWikiRegion = setLabelWikiRegion;
window.getLabelWikiUebernommenPayload = getLabelWikiUebernommenPayload;
window.resetLabelWikiState = resetLabelWikiState;
window.getLabelWikiRegionPayload = getLabelWikiRegionPayload;
window.getLabelWikiNoArticlePayload = getLabelWikiNoArticlePayload;
window.labelWikiRegionFromRow = labelWikiRegionFromRow;
window.assignLabelWikiRegionToForm = assignLabelWikiRegionToForm;

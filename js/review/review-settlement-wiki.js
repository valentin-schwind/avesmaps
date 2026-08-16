// Die Wiki-Zuweisung des ORTS im KARTENDIALOG („Ort bearbeiten"). Seit dem 16.08.2026 zeichnet und
// bedient sie das gemeinsame Bauteil (js/ui/wiki-assign.js, Huelle „label-wiki"); diese Datei
// steuert nur noch den DATENWEG bei -- Stand lesen, zuweisen, loesen, Sync ins Formular.
//
// Entwurf: docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md
// Zwilling: html/wiki-sync-settlement-editor.html (dieselbe Zuweisung im Orte-Editor, Huelle „dt").
// Was BEIDE brauchen, steht in js/ui/wiki-assign-ort.js -- die zwei laufen in verschiedenen
// Dokumenten und koennen keine Funktion voneinander sehen.
//
// 🔴 ZWEIERLEI HEISST HIER „WIKI", UND ES SIND VERSCHIEDENE FELDER (ausfuehrlich im Kopf von
// js/ui/wiki-assign-ort.js): `properties.wiki_settlement` IST die Zuweisung (ganzes Nest, von
// `assign_to` geschrieben, von `clear_assign` geloescht). `properties.wiki_url` -- das versteckte
// `#location-edit-wiki-url` -- ist ein FLACHES Feld daneben, das jedes Speichern mitschickt und das
// der Leseweg bei Leere per Namensraten wieder fuellt. Diese Datei zieht es bei jedem Zuweisen und
// Entfernen mit, weil es sonst beim naechsten Speichern die gerade getroffene Entscheidung
// ueberschreibt (Discord #38) -- aber es bleibt ein Nachbar, nicht die Zuweisung.
//
// 🔴 WAS MIT DEM UMBAU ENTFALLEN IST: die zwei „↻"-Knoepfe neben Ortsname und Ortsgroesse
// (syncLocationNameFromWiki / syncLocationSizeFromWiki). Sie schrieben den Wiki-Wert ohne Vorschau
// und ohne Haken ins Formular; ihre Aufgabe erledigt jetzt der Knopf „Sync" im Kasten -- mit einer
// Vorschau, die vorher sagt, was sich aendern wuerde. Dieselbe Abloesung wie beim Weg (Aufgabe 4).

const SETTLEMENT_WIKI_API_URL = "/api/edit/wiki/settlements.php";

// Die eine Steuerung des Bauteils. 🔴 Vor jedem Neuaufbau abgeraeumt: der Dialog dient nacheinander
// verschiedenen Orten, und ein liegengebliebener Zuhoerer schriebe auf den vorigen.
let settlementWikiAssign = null;

function settlementWikiElement(id) {
	return document.getElementById(id);
}
function settlementWikiGet(query) {
	return fetch(SETTLEMENT_WIKI_API_URL + query, { credentials: "same-origin" }).then((response) => response.json());
}
function settlementWikiPost(body) {
	return fetch(SETTLEMENT_WIKI_API_URL, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((response) => response.json());
}

function settlementWikiCurrentMarkerEntry() {
	return typeof locationEditMarkerEntry !== "undefined" ? locationEditMarkerEntry : null;
}
function settlementWikiCurrentPublicId() {
	const entry = settlementWikiCurrentMarkerEntry();
	return entry?.publicId || "";
}
function settlementWikiCurrentAssignment() {
	const entry = settlementWikiCurrentMarkerEntry();
	const wiki = entry?.location?.wikiSettlement;
	return wiki && wiki.title ? wiki : null;
}
// Die beim ANLEGEN gemerkte Wahl: noch nichts geschrieben (es gibt keine public_id), aber schon
// gewaehlt. Zwei Wege fuellen sie -- der Zuweisungskasten hier und der Ortsname-Typeahead
// (mountLocationEditNameAutocomplete, js/review/review-locations.js) -- und beide muessen dasselbe
// behaupten, also liest der Kasten sie ebenfalls.
function settlementWikiPendingAssignment() {
	return typeof locationEditPendingWikiSettlement !== "undefined" ? locationEditPendingWikiSettlement : null;
}

/**
 * 🔴 WIRFT, WENN DER DIALOG NICHT DASTEHT -- der Vertrag aus dem Kopf von js/ui/wiki-assign.js.
 * Ein `laden`, das im Fehlerfall etwas Leeres AUFLOEST, ist vom Zustand „nichts zugewiesen" nicht
 * zu unterscheiden: das Bauteil hielte sich fuer geladen, `lies()` gaebe Leerstrings, und die
 * Sync-Vorschau vergliche gegen Leerwerte, statt gegen das Formular.
 *
 * ⚠️ Hier laeuft kein HTTP: die Zuweisung steht im bereits geladenen Marker-Eintrag. „Kein
 * Marker" ist deshalb KEIN Fehler -- das ist der Anlege-Fall, und dort ist die gemerkte Wahl der
 * Stand. Der Fehlerfall ist „das Formular selbst fehlt".
 */
function settlementWikiZustand() {
	if (!settlementWikiElement("location-edit-name") || !settlementWikiElement("location-edit-type")) {
		throw new Error("Der Dialog „Ort bearbeiten“ steht nicht im Dokument.");
	}
	return avesmapsWikiAssignOrtZustand({
		wiki_settlement: settlementWikiCurrentAssignment() || settlementWikiPendingAssignment(),
		// 🔴 Der dritte Zustand kommt aus dem MARKER-EINTRAG, nicht aus einem Formularfeld: er steht
		// im `properties_json` und reist im Kartenpayload mit (prepareLocationData, js/routing/
		// routing.js). Im Anlege-Fall gibt es keinen Marker -- dort ist er von Natur aus falsch.
		kein_artikel: Boolean(settlementWikiCurrentMarkerEntry()?.location?.wikiNoArticle),
		// 💣 LESEFUNKTIONEN, keine Werte: Namensfeld und Groessenauswahl stehen im selben Formular
		// ueber dem Kasten. `laden` laeuft einmal, die Sync-Vorschau entsteht erst beim Druck auf
		// „Sync" -- eingefroren boete sie eine Aenderung an, die das Formular daneben laengst zeigt.
		name: () => settlementWikiElement("location-edit-name")?.value || "",
		feature_subtype: () => settlementWikiElement("location-edit-type")?.value || "",
		// Dieselbe Begruendung fuer die drei neuen Kartenfelder -- sie stehen im selben Formular und
		// duerfen zwischen `laden` und „Sync" von Hand geaendert worden sein.
		einwohner: () => settlementWikiElement("location-edit-einwohner")?.value || "",
		lage: () => settlementWikiElement("location-edit-lage")?.value || "",
		oberhaupt: () => settlementWikiElement("location-edit-oberhaupt")?.value || "",
	});
}

/**
 * Der Stand des Häkchens „Kein Wiki-Artikel vorhanden", wie ihn `buildLocationEditPayload` braucht.
 *
 * 🔴 `null` HEISST „NICHT SCHICKEN", und es gibt dafür ZWEI Gründe:
 *
 * 1. **Das Bauteil ist nicht bereit** (Blindgänger -- nach einem Deploy-Fehlschlag nicht
 *    hypothetisch, AGENTS.md §9). Ein `false` wäre hier eine Löschung, die niemand angeordnet hat.
 * 2. **Das Häkchen wurde seit dem Laden gar nicht angefasst** (Owner-Entscheid 16.08.2026, anstelle
 *    eines `expected_revision`): wer es nicht anfasst, kann es auch nicht löschen. Ohne diesen
 *    Riegel nimmt ein alter, längst offener Dialog beim nächsten beliebigen Speichern die
 *    Entscheidung eines zweiten Editors zurück, der den Merker inzwischen im Konfliktzentrum gesetzt
 *    hat -- und der Erste merkt davon nichts.
 *
 * 💣 GEPRÜFT WIRD `kein_artikel_geaendert`, NICHT `kein_artikel`. Der Unterschied ist *verändert seit
 * dem Laden*, nicht *gesetzt*: ein bewusst ENTFERNTES Häkchen muss genauso durchkommen wie ein
 * gesetztes, sonst liesse sich der Merker nie wieder loswerden.
 *
 * ⚠️ Der Riegel ist ENG gemeint -- er gilt NUR dem Merker. Kein `expected_revision`, keine neuen
 * Absagen für Editoren, keine Behandlung der übrigen Felder.
 */
function settlementWikiKeinArtikelFuerPayload() {
	if (!settlementWikiAssign || !settlementWikiAssign.bereit) {
		return null;
	}
	const stand = settlementWikiAssign.lies();
	if (!stand || stand.kein_artikel_geaendert !== true) {
		return null;
	}
	return stand.kein_artikel === true;
}

// Derive the wiki page title from a /wiki/<Title> URL (decodes %xx + underscores). "" if none.
function settlementWikiTitleFromUrl(wikiUrl) {
	const match = String(wikiUrl || "").match(/\/wiki\/([^?#]+)/);
	if (!match) {
		return "";
	}
	try {
		return decodeURIComponent(match[1]).replace(/_/g, " ").trim();
	} catch (error) {
		return match[1].replace(/_/g, " ").trim();
	}
}

// Anlege-Fall: assign_to braucht eine public_id und wirft ohne sie („title/public_id fehlt"). Die
// Siedlung wird deshalb nur GELESEN -- ?action=preview liefert dasselbe Objekt, das assign_to
// zurückgäbe (avesmapsWikiSettlementBuildFromTitle) -- und die Wahl lokal gemerkt. Träger für den
// Auto-Connect nach create_point ist das versteckte wiki_url-Feld, genau wie im Bearbeiten-Fall.
//
// 🔴 WIRFT BEI JEDEM NEIN. Frueher endete ein Fehlschlag in einer Statuszeile des alten Pickers;
// das Bauteil braucht eine ABLEHNUNG, sonst malt es eine Wahl, die es nicht gibt.
async function selectSettlementWikiResultWhileCreating(title, treffer) {
	let settlement = null;
	try {
		const data = await settlementWikiGet(`?action=preview&title=${encodeURIComponent(title)}`);
		settlement = data && data.ok === true ? data.settlement : null;
		if (!settlement) {
			throw new Error(apiErrorMessage(data, "Ort konnte nicht gelesen werden"));
		}
	} catch (error) {
		showFeedbackToast?.("Zuweisen fehlgeschlagen: " + (error.message || error), "error");
		throw error;
	}
	// 🔴 Die GANZE geparste Siedlung wird gemerkt, nicht mehr nur title/name/wiki_url: `laden` baut
	// den Zuweisungskasten daraus, und mit drei Feldern staende dort ein Artikel ohne eine einzige
	// Angabe. `title` und `wiki_url` sind darin enthalten -- der Auto-Connect nach create_point
	// findet also unveraendert, was er sucht.
	locationEditPendingWikiSettlement = settlement;
	const wikiUrlField = settlementWikiElement("location-edit-wiki-url");
	if (wikiUrlField) {
		wikiUrlField.value = String(settlement.wiki_url || "");
	}
	// Die Suchzeile trug nur die Ortsgroesse; erst hier stehen die Infoboxwerte bereit.
	avesmapsWikiAssignOrtTrefferAnreichern(treffer, settlement);
	showFeedbackToast?.(`„${settlement.name || title}" wird beim Anlegen verbunden.`, "info");
}

/**
 * Verbindet den Ort im Dialog mit einer Wiki-Siedlung (`assign_to`, per TITEL).
 *
 * 🔴 WIRFT BEI JEDEM NEIN DES SERVERS -- weiterwerfen, nicht schlucken: das Bauteil malte sonst
 * eine Zuweisung, die es auf dem Server nicht gibt, und beim naechsten Oeffnen des Dialogs waere
 * sie spurlos weg.
 *
 * ⚠️ `treffer` ist optional. Die zwei Alt-Tests (js/review/__tests__/settlement-wiki-*.test.js)
 * rufen diese Funktion mit dem blossen Titel -- so, wie es der alte Picker tat -- und pruefen
 * damit genau den Teil, der sich NICHT geaendert hat (das versteckte wiki_url-Feld).
 */
async function selectSettlementWikiResult(title, treffer) {
	const publicId = settlementWikiCurrentPublicId();
	if (!publicId) {
		await selectSettlementWikiResultWhileCreating(title, treffer);
		return;
	}
	let result;
	try {
		result = await settlementWikiPost(avesmapsWikiAssignOrtZuweisungsKoerper(title, publicId));
		avesmapsWikiAssignOrtAntwortPruefen(result);
	} catch (error) {
		showFeedbackToast?.("Zuweisen fehlgeschlagen: " + (error.message || error), "error");
		throw error;
	}
	// Das versteckte wiki_url-Formfeld mitziehen (Gegenstueck zu removeSettlementWiki): der Dialog
	// belegt es aus location.wikiUrl vor -- also aus dem ANGEREICHERTEN Payload-Wert, der bei leerer
	// Spalte per Namensraten entstehen kann -- und buildLocationEditPayload sendet es bei jedem
	// Speichern zurueck. Ohne Mitziehen ueberschreibt das naechste Speichern die gerade gewaehlte
	// Verbindung wieder mit dem alten/erratenen/leeren Wert (Discord #38).
	const chosenWikiUrl = String(result.settlement?.wiki_url || "").trim();
	const wikiUrlField = settlementWikiElement("location-edit-wiki-url");
	if (wikiUrlField && chosenWikiUrl !== "") {
		wikiUrlField.value = chosenWikiUrl;
	}
	const entry = settlementWikiCurrentMarkerEntry();
	if (entry && entry.location) {
		entry.location.wikiSettlement = result.settlement || null;
		if (result.settlement) {
			// 💣 `assign_to` LOESCHT die Beschreibung serverseitig, weil die Infobox sie ersetzt
			// (settlements.php:842). Ohne diese Zeile stuende sie noch im Formular und das naechste
			// Speichern schriebe sie zurueck.
			entry.location.description = "";
			const descriptionField = settlementWikiElement("location-edit-description");
			if (descriptionField) {
				descriptionField.value = "";
			}
		}
		// Revision nachziehen, sonst scheitert ein anschließendes Speichern am Konflikt.
		if (result.revision) {
			entry.location.revision = result.revision;
		}
		if (typeof refreshLocationMarkerPopup === "function") {
			refreshLocationMarkerPopup(entry);
		}
	}
	// 🔴 Die Suchzeile trug NUR die Ortsgroesse -- die Infoboxwerte entstehen erst in diesem
	// Schreibvorgang und stehen in seiner Antwort. Ohne diese Zeile bliebe der Zuweisungskasten
	// unmittelbar nach der Wahl fast leer (js/ui/wiki-assign-ort.js erklaert, warum).
	avesmapsWikiAssignOrtTrefferAnreichern(treffer, result.settlement);
	showFeedbackToast?.(`„${result.wiki_name}" verbunden.`, "success");
	if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
		void refreshActiveWikiSyncPanelAfterAssignment();
	}
	if (typeof loadChangeLog === "function") {
		loadChangeLog();
	}
}

// Core: connect ONE place feature to its wiki settlement by the settlement's exact TITLE (assign_to).
// Best-effort: returns false when publicId/title is missing or the server finds no {{Infobox Siedlung}}
// under that title -- never blocks a save. Updates the cached wikiSettlement + revision so the popup
// shows the connection immediately and the next save's expected_revision still matches.
async function autoConnectSettlementWikiByTitle(publicId, title, markerEntry) {
	if (!publicId || !title) {
		return false;
	}
	try {
		const result = await settlementWikiPost({ action: "assign_to", title, public_id: publicId, dry_run: false, confirm: "apply" });
		if (!result || result.ok !== true || !result.settlement) {
			return false;
		}
		if (markerEntry && markerEntry.location) {
			markerEntry.location.wikiSettlement = result.settlement;
			// Kein clientseitiges description = "": update_point hat die Beschreibung serverseitig
			// gespeichert; der volle Popup blendet sie per hasWikiSettlement aus, der Slim-Popup zeigt
			// sie -- ein clientseitiges Leeren liesse den Slim-Popup vor/nach Reload verschieden rendern.
			if (result.revision) {
				markerEntry.location.revision = result.revision;
			}
			if (typeof refreshLocationMarkerPopup === "function") {
				refreshLocationMarkerPopup(markerEntry);
			}
		}
		return true;
	} catch (error) {
		return false;
	}
}

// Convenience: connect a place to its wiki settlement straight from its wiki URL (title derived from
// /wiki/<Title>, e.g. one inherited from a community report), so a save with a wiki link attaches the
// {{Infobox Siedlung}} data without a manual "Zuweisen".
async function autoConnectSettlementWikiByUrl(publicId, wikiUrl, markerEntry) {
	return autoConnectSettlementWikiByTitle(publicId, settlementWikiTitleFromUrl(wikiUrl), markerEntry);
}

/**
 * Loest die Wiki-Verbindung (`clear_assign`).
 *
 * 🔴 WIRFT BEI JEDEM NEIN -- sonst zeigt der Kasten „— keine —", waehrend auf dem Server alles
 * unveraendert steht. ⚠️ Ohne public_id (Anlege-Fall) gibt es nur die oertlich gemerkte Wahl; die
 * zurueckzunehmen kann nicht scheitern, also ist das der einzige Zweig ohne Netzweg.
 */
async function removeSettlementWiki() {
	const publicId = settlementWikiCurrentPublicId();
	if (!publicId) {
		// Anlege-Fall: es gibt nur die lokal gemerkte Wahl. Die nehmen wir zurück, ohne zu schreiben --
		// sonst klebt sie bis zum Speichern fest und wird dann doch verbunden.
		locationEditPendingWikiSettlement = null;
		const pendingUrlField = settlementWikiElement("location-edit-wiki-url");
		if (pendingUrlField) {
			pendingUrlField.value = "";
		}
		return;
	}
	let result;
	try {
		result = await settlementWikiPost({ action: "clear_assign", public_id: publicId, dry_run: false, confirm: "apply" });
		avesmapsWikiAssignOrtAntwortPruefen(result);
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
		throw error;
	}
	const entry = settlementWikiCurrentMarkerEntry();
	if (entry && entry.location) {
		delete entry.location.wikiSettlement;
		if (result && result.revision) {
			entry.location.revision = result.revision;
		}
		if (typeof refreshLocationMarkerPopup === "function") {
			refreshLocationMarkerPopup(entry);
		}
	}
	// Das versteckte wiki_url-Formfeld mitleeren: sonst stellt der Auto-Connect beim naechsten
	// Speichern die gerade entfernte Verbindung still wieder her (Owner: Entfernen bleibt entfernt).
	// 🔴 UND ES HAELT SEIT DEM 16.08.2026 AUCH UEBER EIN NEULADEN DER KARTE HINWEG -- aber nur, wenn
	// der Editor danach das Häkchen „Kein Wiki-Artikel vorhanden" setzt und speichert. Ohne den Merker
	// rät avesmapsEnrichMapFeatureWikiUrl die Adresse aus dem Ortsnamen zurück; „gelöscht" und „nie
	// gesetzt" sind für sie dasselbe. Das Entfernen allein kann diese Frage nicht beantworten: es
	// heißt „diese Verbindung war falsch", nicht „es gibt keinen Artikel". Genau dafür ist das
	// Häkchen da (Discord #38).
	const wikiUrlField = settlementWikiElement("location-edit-wiki-url");
	if (wikiUrlField) {
		wikiUrlField.value = "";
	}
	showFeedbackToast?.("Wiki-Verbindung entfernt.", "info");
	if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
		void refreshActiveWikiSyncPanelAfterAssignment();
	}
	if (typeof loadChangeLog === "function") {
		loadChangeLog();
	}
}

/**
 * ⚠️ ÜBERNEHMEN FÜLLT NUR DAS FORMULAR (Entwurf §6) -- gespeichert wird mit „Speichern". Die
 * Vorgaenger dieses Wegs waren die zwei „↻"-Knoepfe neben Ortsname und Ortsgroesse; sie schrieben
 * ohne Vorschau und ohne Haken und sind mit dem Umbau entfallen.
 *
 * 🔴 DERSELBE VERTRAG WIE BEI `zuweisen` UND `loesen`: wer nichts tun konnte, WIRFT. Ein stilles
 * Aufloesen hiesse fuer das Bauteil „uebernommen", es schloesse die Vorschau, und der Editor haette
 * den Eindruck, sein Haken sei ins Formular gewandert.
 */
function settlementWikiSyncUebernehmen(zeilen) {
	const werte = avesmapsWikiAssignOrtSyncWerte(zeilen);
	// 🔴 Die Leerprüfung zählt ALLE Kartenfelder, nicht zwei ausgeschriebene: seit dem 16.08.2026
	// sind es fünf, und eine allein angehakte Einwohnerzahl hätte hier sonst „nichts angehakt"
	// ergeben -- ein Häkchen, das eine Ablehnung auslöst.
	if (avesmapsWikiAssignOrtSyncLeer(werte)) {
		throw new Error("Keine übernehmbare Angabe angehakt.");
	}
	// 🔴 ERST ALLES PRUEFEN, DANN ALLES SCHREIBEN. Die Pruefung der Ortsgroesse stand bis zum
	// 16.08.2026 NACH dem Setzen des Namens: schlug sie fehl, war der Name schon geschrieben,
	// waehrend das Bauteil die Ablehnung als „es ist nichts passiert" liest und die Vorschau samt
	// Haken stehen laesst. Eine halbe Uebernahme, die sich als gar keine ausgibt. Heute unerreichbar
	// (die Auswahl fuehrt genau die sechs Schluessel), aber ein siebter Schluessel in NUR einer der
	// zwei Listen macht sie erreichbar -- und dann ist der Fehler still.
	const nameInput = werte.name === null ? null : settlementWikiElement("location-edit-name");
	if (werte.name !== null && !nameInput) {
		throw new Error("Das Namensfeld steht nicht im Dialog.");
	}
	const select = werte.feature_subtype === null ? null : settlementWikiElement("location-edit-type");
	if (werte.feature_subtype !== null
		&& (!select || !Array.from(select.options || []).some((option) => option.value === werte.feature_subtype))) {
		throw new Error("Die Ortsgröße „" + werte.feature_subtype + "“ steht in der Auswahl nicht zur Verfügung.");
	}
	// Die drei Textfelder -- ERST alle prüfen, dann alle schreiben, wortgleich zur Regel darüber.
	const textFelder = [["einwohner", "Einwohner"], ["lage", "Lage"], ["oberhaupt", "Herrscher"]].map(([feld, label]) => {
		if (werte[feld] === null) {
			return null;
		}
		const eingabe = settlementWikiElement("location-edit-" + feld);
		if (!eingabe) {
			throw new Error("Das Feld „" + label + "“ steht nicht im Dialog.");
		}
		return [eingabe, werte[feld]];
	}).filter((eintrag) => eintrag !== null);
	if (nameInput) {
		nameInput.value = werte.name;
	}
	textFelder.forEach(([eingabe, wert]) => { eingabe.value = wert; });
	if (select) {
		// 🔴 setLocationEditSize, NICHT `select.value = …`: an der Ortsgroesse haengt die Sperre des
		// Feldes „Art" (place_kind), und ein programmatisches Setzen feuert KEIN change-Ereignis --
		// genau dafuer gibt es diesen einen Setzer (js/review/review-locations.js:638).
		if (typeof setLocationEditSize === "function") {
			setLocationEditSize(werte.feature_subtype);
		} else {
			select.value = werte.feature_subtype;
		}
	}
	showFeedbackToast?.("Aus dem Wiki übernommen — noch nicht gespeichert.", "info");
}

/**
 * Baut den Zuweisungskasten neu auf. Heisst weiter `renderSettlementWikiReference`, weil
 * js/review/review-locations.js genau diesen Namen ruft, wenn der Dialog einen Ort bekommt.
 *
 * ⚠️ NICHT aus `zuweisen`/`loesen` heraus rufen -- das Bauteil zeichnet sich nach beiden Handlungen
 * selbst neu. Ein Neuaufbau mitten im eigenen Ablauf laesst ZWEI Bauteile um denselben (stehenden)
 * Behaelter ringen: das frische malt, das alte malt gleich danach ueber es hinweg, und `laden`
 * laeuft doppelt.
 * 🪤 Hier stand zuerst, das koste die Zuhoerer und der Kasten reagiere danach auf keinen Klick mehr.
 * Das ist FALSCH, gemessen mit genau dieser Mutation (16.08.2026): `zerstoeren()` nimmt die alten
 * Zuhoerer ab, der neue Mount haengt seine eigenen an denselben Knoten, und beide Bauteile stehen
 * im selben Zustand -- das Ergebnis ist ununterscheidbar, nur doppelt gerechnet. Der Satz bleibt
 * als Warnung stehen, aber ohne die erfundene Folge: eine Begruendung, die einer Probe nicht
 * standhaelt, ist schlimmer als keine.
 */
function renderSettlementWikiReference() {
	const host = settlementWikiElement("settlement-wiki-assign-host");
	if (!host) {
		return;
	}
	if (settlementWikiAssign) {
		settlementWikiAssign.zerstoeren();
		settlementWikiAssign = null;
	}
	settlementWikiAssign = avesmapsWikiAssignMount(host, {
		subject: "ort",
		skin: "label-wiki",
		laden: settlementWikiZustand,
		// Die Suche antwortet mit FLACHEN Zeilen, und zwar OHNE Infoboxwerte -- erst hier entsteht
		// daraus ein Treffer (js/ui/wiki-assign-ort.js).
		trefferAufbereiten: avesmapsWikiAssignOrtTreffer,
		zuweisen: (treffer) => selectSettlementWikiResult(avesmapsWikiAssignOrtTitel(treffer), treffer),
		loesen: removeSettlementWiki,
		syncUebernehmen: settlementWikiSyncUebernehmen,
		keinArtikelGeaendert: settlementWikiKeinArtikelGeaendert,
	});
}

/**
 * Das Häkchen „Kein Wiki-Artikel vorhanden" wurde umgelegt.
 *
 * 🔴 GESPEICHERT WIRD ERST MIT „Speichern" -- dieser Dialog schreibt keine Einzelfelder. Der Wert
 * selbst hält das Bauteil; `buildLocationEditPayload` holt ihn über
 * `settlementWikiKeinArtikelFuerPayload()`.
 *
 * 💣 GESETZT HEISST: DAS FLACHE ADRESSFELD WIRD GELEERT. `update_point` LEHNT den Widerspruch
 * „Adresse UND kein Artikel" ab (avesmapsApplyPointWikiFields) -- und `#location-edit-wiki-url` ist
 * in diesem Dialog `type="hidden"`: der Editor bekäme eine Absage, deren Ursache er nirgends sieht
 * und deren Rat („die Zuweisung entfernen") auf ein leeres Feld zeigt. Also wird hier geleert, statt
 * dort abzulehnen. ⚠️ Beim ABwählen wird NICHTS zurückgeholt: eine gelöschte Adresse zu erraten wäre
 * genau der Fehler, den der Merker beseitigt.
 */
function settlementWikiKeinArtikelGeaendert(gesetzt) {
	if (gesetzt === true) {
		const wikiUrlField = settlementWikiElement("location-edit-wiki-url");
		if (wikiUrlField) {
			wikiUrlField.value = "";
		}
	}
	showFeedbackToast?.(gesetzt
		? "„Kein Wiki-Artikel vorhanden“ gesetzt — noch nicht gespeichert."
		: "„Kein Wiki-Artikel vorhanden“ entfernt — noch nicht gespeichert.", "info");
}

// Holt die aktuelle Zuordnung frisch vom Server (DB-Wahrheit), falls der Browser-Marker stale ist
// (z. B. nach Bulk-Verbinden). Aktualisiert Marker + Zuweisungskasten + Karten-Popup.
async function syncSettlementWikiFromServer() {
	const entry = settlementWikiCurrentMarkerEntry();
	const publicId = entry?.publicId;
	if (!entry || !entry.location || !publicId) {
		return;
	}
	try {
		const data = await settlementWikiGet(`?action=assignment&public_id=${encodeURIComponent(publicId)}`);
		if (!data || data.ok !== true) {
			return;
		}
		const next = data.wiki_settlement || null;
		const hadTitle = entry.location.wikiSettlement && entry.location.wikiSettlement.title;
		const nextTitle = next && next.title;
		if (Boolean(hadTitle) === Boolean(nextTitle) && String(hadTitle || "") === String(nextTitle || "")) {
			return; // schon aktuell
		}
		entry.location.wikiSettlement = next;
		if (next) {
			entry.location.description = "";
		}
		// 🔴 Nachladen, nicht neu aufbauen: der Kasten steht schon, nur sein Stand hat sich unter ihm
		// geaendert. `neuLaden` ruft `laden` erneut und zeichnet -- ohne die Zuhoerer abzunehmen.
		if (settlementWikiAssign) {
			void settlementWikiAssign.neuLaden();
		}
		if (typeof refreshLocationMarkerPopup === "function") {
			refreshLocationMarkerPopup(entry);
		}
	} catch (error) {
		/* still ok */
	}
}

window.renderSettlementWikiReference = renderSettlementWikiReference;
window.syncSettlementWikiFromServer = syncSettlementWikiFromServer;

if (typeof module !== "undefined" && module.exports) {
	module.exports = { selectSettlementWikiResult, removeSettlementWiki };
}

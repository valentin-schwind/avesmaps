// Landschaften — „Eigenschaften …" auf einer Fläche (V6b).
//
// 🔴 WARUM ES DAS GIBT. `update_region` und `delete_region` waren seit V2.3 gebaut und im Dispatcher
// verdrahtet, aber KEIN Client hat sie je gerufen: Name, Art und Wiki-Link wurden einmal beim Anlegen
// gesetzt und waren danach unveränderlich, und eine Region liess sich gar nicht löschen. Dieses Modul ist
// die fehlende Oberfläche dazu — kein neuer Endpunkt, keine neue Tabelle.
//
// 🪤 DIESER DIALOG BEARBEITET DIE FLÄCHE, NICHT DAS LABEL. Der optisch fast gleiche „Region bearbeiten"
// (index.html:1305, #label-edit-overlay) bearbeitet eine map_features-BESCHRIFTUNG — daher dessen Größe,
// Rotation, Zoom-Bänder und Priorität, die hier alle fehlen: eine Landschaftsfläche hat keine
// (oekosystem-editor-verhalten.md §12, „Keine Zoom-Bänder"). Die beiden sind zwei Zeilen in zwei
// Tabellen -- gekoppelt über `ecosystem_region.label_public_id`.
//
// ⚠️ Bis V6 stand hier "wer umbenennt, benennt das Label NICHT um". Das gilt nicht mehr: seit jede
// Region ihr Label bekommt, tragen Name, Art, Nodix und die Wiki-Landschaft von hier ans Label durch
// (renameLinkedEcosystemLabel). Was NICHT durchträgt, sind Größe, Rotation, Zoom-Band und Priorität --
// die gehören dem Label allein und werden im Label-Dialog eingestellt.
//
// 🔴 Keine politische Datei wird aufgerufen (Hauptplan, Regel 1).

(() => {
	// 🔴 SEIT DER VEREINIGUNG (25.08.2026) ist das Fenster das gemeinsame: Flaeche und Beschriftung
	// stehen in „Landschaft bearbeiten" mit drei Reitern. Dieses Modul besitzt weiter die FELDER des
	// Flaechen-Reiters -- ihre IDs sind unveraendert mitgewandert --, aber nicht mehr die Huelle.
	const OVERLAY_ELEMENT_ID = "landschaft-dialog-overlay";
	const MENU_ACTION = "ecosystem-properties";
	// Dieselbe Quelle wie der Label-Wiki-Block (review-label-wiki.js:6) -- absolut, weil der Dialog auch
	// aus Seiten unterhalb von /html/ erreichbar sein muss.
	const WIKI_API_URL = "/api/edit/wiki/regions.php";

	let propertiesSourcePublicId = "";
	// Die im Dialog eingestellte Wiki-Landschaft, solange nicht gespeichert ist. `undefined` = unberührt,
	// `null` = ausdrücklich entfernt, Objekt = neu gewählt. Die Unterscheidung ist nötig, weil „nicht
	// angefasst" und „entfernt" beim Speichern verschiedene Dinge bedeuten.
	let pendingWikiRegion;
	// Die Steuerung des geteilten Zuweisungs-Bauteils (js/ui/wiki-assign.js), solange der Dialog offen
	// ist. `null` heisst „noch nicht gemountet" -- der Kasten entsteht erst, wenn das Art-Vokabular da
	// ist (siehe mountWikiAssign).
	let wikiAssign = null;
	// Die Staging-Zeile zur gerade gezeigten Zuweisung. Die Region speichert nur Adresse und Schluessel;
	// Art, Lage und Staat muessen dazugeholt werden (avesmapsWikiAssignLandschaftArtikel sagt, warum).
	let wikiSchnappschuss = null;
	// Der dritte Zustand, wie `list_regions` ihn geliefert hat.
	let regionKeinArtikel = false;
	// 🔴 Die Feldherkunft der Region -- `{name|region_type: "manual"|"wiki"}`. Sie kommt aus
	// DERSELBEN `list_regions`-Antwort wie der dritte Zustand; ein zweiter Abruf nur dafuer waere
	// eine Anfrage zu viel. Ein Feld OHNE Eintrag heisst „nicht bekannt", nie „vom Wiki".
	let regionFieldOrigins = null;
	// 🔴 WELCHE FELDER SEIT DEM ÖFFNEN AUS DEM WIKI KAMEN -- die Merkliste DIESES Dialogs. Der Server
	// stempelt daraus die Feldherkunft, und nur für Felder, deren Wert sich wirklich ändert.
	// 💣 ZWEI OBERFLÄCHEN, ZWEI MERKLISTEN, EINE REGEL. Das Editorfenster führt seine eigene
	// (html/landschaften-editor.html) -- anderes Dokument, eigenes `window`, die zwei sehen einander
	// nicht. Trägt eine der beiden nicht ein, stempelt der Server ihre Übernahmen als „von uns", und
	// der nächste Abgleich liesse genau die Felder in Ruhe, die er selbst gefüllt hat.
	let wikiUebernommen = new Set();
	let regionTypesForKind = [];
	let regionAreaCount = 0;
	// 💣 Die Flächenzahl kommt ERST mit list_regions an. Bis dahin darf nicht gelöscht werden: die
	// Rückfrage nennt die Zahl, und „mit 0 Flächen löschen?" wäre keine Warnung, sondern eine
	// Entwarnung — genau dann, wenn drei Flächen mit verschwinden. Der Knopf sagt das selbst, statt
	// stillschweigend falsch zu rechnen.
	let regionAreaCountLoaded = false;
	// Der beim Oeffnen vorgefundene Stand der Kurveneinstellung -- `null` heisst „nicht bedienbar“.
	let kurveGeladen = null;
	let propertiesBusy = false;
	let propertiesBound = false;

	// 🔴 DIE VIER ZWILLINGE SIND EINGESCHMOLZEN (Vereinigung, 25.08.2026). Nodix und die zwei
	// Bedienelemente der Kurvenbeschriftung standen in BEIDEN Fenstern und bedienten denselben
	// Wert -- der Quelltext warnte woertlich davor („Wer hier einen dritten Zustand erfindet, hat
	// zwei Wahrheiten ueber dieselbe Region"). Seit Flaeche und Beschriftung in EINEM Fenster
	// stehen, gaebe es sie zweimal untereinander; es gibt sie deshalb genau einmal, im Reiter
	// „Beschriftung".
	//
	// ⭐ Gebunden wird an EINER Stelle statt an sechs Lesestellen: dieses Modul ruft die Felder
	// ausschliesslich ueber `propertiesElement`, also genuegt hier eine Tabelle. Sechs
	// gleichlautende Aenderungen waeren sechs Gelegenheiten, eine zu vergessen.
	//
	// ⚠️ `showname` wandert MIT seiner Kennung in den Beschriftungsreiter (dort heisst es „Auf der
	// Karte anzeigen") -- es ist kein Zwilling, sondern der einzige Schalter der Beschriftung, den
	// es nur hier gab. Kennung bleibt, Beschriftung wandert.
	const AVESMAPS_ECO_ZWILLINGE = {
		nodix: "label-edit-is-nodix",
		curve: "label-edit-curve",
		"curve-max": "label-edit-curve-max",
		curvehint: "label-edit-curve-hint",
		// 🔴 Name und Art stehen seit Aufgabe 4 im GEMEINSAMEN KOPF und gehoeren beiden Haelften.
		// Gemessen am 25.08.2026: von 679 Paaren tragen 679 denselben Namen und 613 dieselbe Art;
		// die 66 Abweichungen sind ausnahmslos „Flaeche ohne Art -> Beschriftung auf dem neutralen
		// `region`". Kein einziger echter Widerspruch -- ein Feld genuegt.
		// ⚠️ Das Feld traegt `name="text"` und gehoert per `form`-Attribut zum Beschriftungsformular.
		// Dieses Modul liest und schreibt `.value` direkt, nicht ueber FormData -- der Umweg stoert es
		// also nicht.
		name: "label-edit-text",
		type: "label-edit-type",
	};

	function propertiesElement(suffix) {
		const zwilling = AVESMAPS_ECO_ZWILLINGE[suffix];
		return document.getElementById(zwilling || `ecosystem-properties-${suffix}`);
	}

	function escapeText(value) {
		const holder = document.createElement("div");
		holder.textContent = String(value === null || value === undefined ? "" : value);
		return holder.innerHTML;
	}

	function escapeAttr(value) {
		return String(value === null || value === undefined ? "" : value).replace(/"/g, "&quot;");
	}

	// Die Flächenzeile, so wie der Lesepfad sie zuletzt geliefert hat. Sie trägt region_public_id,
	// region_name, kind, region_type und wiki_url schon mit -- kein zweiter Aufruf nötig.
	function currentPropertiesArea() {
		const layer = typeof ecosystemLayers !== "undefined" && ecosystemLayers instanceof Map
			? ecosystemLayers.get(propertiesSourcePublicId)
			: null;

		return layer?._ecosystemArea || null;
	}

	// Wird diese Fläche ABGELEITET statt gezeichnet? EINE Frage, EIN Zugriff für diese Datei.
	//
	// 🔴 Die Entscheidung selbst gehört `isDerivedEcosystemKind` (map-features-ecosystem-rendering.js)
	// -- dem einen Ort, der weiss, welche Ebenen aus etwas anderem entstehen. Hier steht nur der
	// Zugriff darauf.
	//
	// 🪤 Bis zum 22.08.2026 stand in DIESER Datei ein eigenes `=== "klima"` (im Zeichner der
	// Wiki-Abweichungen, für das unterdrückte ↺) -- und drei Funktionen weiter ein Auswahlfeld, das
	// die Frage gar nicht erst stellte und deshalb bei einer Klimazone bedienbar blieb. Genau diese
	// Mischung ist der Grund, aus dem es die Funktion gibt.
	function istAbgeleiteteFlaeche(area) {
		return typeof isDerivedEcosystemKind === "function" && isDerivedEcosystemKind(area?.kind);
	}

	function setPropertiesError(message) {
		const errorElement = propertiesElement("error");
		if (!errorElement) {
			return;
		}
		errorElement.textContent = String(message || "");
		errorElement.hidden = !message;
	}

	/**
	 * Der Flaeche eine Beschriftung geben -- am Punkt der Unzugaenglichkeit.
	 *
	 * 🔴 Die MELDUNG nennt den Punkt (Owner 25.08.2026: „du kannst die meldung bringen dass am Punkt
	 * der Unzugaenglichkeit ... ein label erstellt wurde"). Sie gehoert dem VORGANG: der naechste
	 * Reiterwechsel oder das Schliessen raeumt sie weg, nicht das Fenster traegt sie dauerhaft.
	 *
	 * ⚠️ Sie erscheint NACH dem Anlegen, nicht davor: ein „angelegt" vor der Antwort waere eine
	 * Behauptung ueber etwas, das noch nicht steht.
	 */
	async function legeBeschriftungAn() {
		const area = currentPropertiesArea();
		if (!area || typeof createEcosystemRegionLabel !== "function") {
			return;
		}
		const name = String(propertiesElement("name")?.value || area.region_name || "");
		try {
			await createEcosystemRegionLabel(
				String(area.region_public_id || ""),
				area.geometry,
				name,
				true,
				String(propertiesElement("type")?.value || area.region_type || "")
			);
		} catch (fehler) {
			setPropertiesStatus("Die Beschriftung liess sich nicht anlegen.");
			return;
		}
		const punkt = typeof avesmapsComputeLabelPoint === "function"
			? avesmapsComputeLabelPoint(area.geometry) : null;
		const wo = punkt && Number.isFinite(punkt.x) && Number.isFinite(punkt.y)
			? " (" + punkt.x.toFixed(1).replace(".", ",") + " / " + punkt.y.toFixed(1).replace(".", ",") + ")"
			: "";
		setPropertiesStatus("Beschriftung am Punkt der Unzugänglichkeit" + wo + " angelegt.");
	}

	function setPropertiesStatus(message) {
		const statusElement = propertiesElement("status");
		if (statusElement) {
			statusElement.textContent = String(message || "");
		}
	}

	// Der Zustand steht IM Knopf, nicht daneben: solange die Flächenzahl fehlt, sagt er das und ist tot.
	function setDeleteButtonReady(ready) {
		const button = propertiesElement("delete");
		if (!button) {
			return;
		}
		button.disabled = !ready;
		button.textContent = ready ? "Löschen" : "Löschen (zähle Flächen …)";
	}

	function isEcosystemPropertiesDialogOpen() {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		return Boolean(overlayElement) && !overlayElement.hidden;
	}

	function closeEcosystemPropertiesDialog() {
		if (typeof avesmapsLandschaftDialogHaelfte === "function") {
			avesmapsLandschaftDialogHaelfte("flaeche", false);
		}
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (overlayElement) {
			overlayElement.hidden = true;
		}
		// Fenster zu -> Schleier zurück. Er gehört zur Ansicht, nicht zur Bearbeitung.
		window.AvesmapsEcosystemHeightRender?.setSolid?.(false);
		propertiesSourcePublicId = "";
		pendingWikiRegion = undefined;
		wikiSchnappschuss = null;
		regionKeinArtikel = false;
		regionFieldOrigins = null;
		wikiUebernommen = new Set();
		// 🔴 Zuhoerer abnehmen und den Behaelter leeren, nicht bloss die Steuerung vergessen: das Bauteil
		// haengt vier Zuhoerer an den Behaelter, und ein zweites Oeffnen mountet ein zweites daneben.
		if (wikiAssign) {
			wikiAssign.zerstoeren();
			wikiAssign = null;
		}
	}

	// ---- Wiki-Landschaft ------------------------------------------------------------------------------
	// Die Optik kommt aus den vorhandenen .label-wiki-reference__*-Regeln, damit der Block in beiden
	// Dialogen identisch aussieht. Nur der Zustand ist eigener -- der des Label-Dialogs hängt an dessen
	// Formular (currentLabelWikiRegion) und liesse sich nicht teilen, ohne beide zu verkoppeln.

	// Was im Feld steht: die frisch gewählte, sonst die gespeicherte der Fläche.
	function effectiveWikiRegion() {
		if (pendingWikiRegion !== undefined) {
			return pendingWikiRegion;
		}
		const area = currentPropertiesArea();
		if (!area?.wiki_url && !area?.wiki_region_key) {
			return null;
		}

		return { wiki_key: area.wiki_region_key || "", name: area.region_name || "", wiki_url: area.wiki_url || "" };
	}

	// „Keine Art" heisst je Ebene etwas anderes (Owner 2026-07-28). „— ohne Art —" war eine Formel für
	// alle drei und sagte in keiner etwas: in der Vegetationsebene ist die Antwort „hier wächst nichts
	// Bestimmtes", und das schreibt man hin.
	function emptyTypeLabel(kind) {
		if (kind === "vegetation") {
			return "— keine Vegetation —";
		}
		if (kind === "topographie") {
			return "— keine Topographie —";
		}

		return "— keine Art —";
	}

	// Der VOLLE Schnappschuss derselben Zuweisung, wie ihn das Label braucht (Name, Art, Beschreibung,
	// Bild — davon lebt seine Infobox). Die Region speichert nur Schlüssel und URL, deshalb der Umweg
	// über dieselbe Staging-Quelle, aus der auch der „Sync"-Knopf im Label-Editor schöpft.
	async function currentRegionWikiSnapshot() {
		const wiki = effectiveWikiRegion();
		const key = String(wiki?.wiki_key || "").trim();
		if (key === "" || typeof ecosystemWikiRegionSnapshot !== "function") {
			return null;
		}

		return await ecosystemWikiRegionSnapshot(key, wiki?.wiki_url || "");
	}

	// ---- Die Wiki-Zuweisung: das GETEILTE Bauteil -------------------------------------------------------
	// Bis zum 16.08.2026 standen hier rund 145 Zeilen eigener Picker: Trefferliste, „Suchen"-Knopf,
	// Zuweisungskasten und ein `syncFromWikiRegion`, das Name und Art UNBEDINGT überschrieb. Sie sind
	// durch js/ui/wiki-assign.js ersetzt (Entwurf
	// docs/superpowers/specs/2026-08-15-wiki-zuweisung-vereinheitlichung-design.md). Was
	// objektart-eigen ist, steht in js/ui/wiki-assign-landschaft.js -- der Regionen-Editor im iframe
	// benutzt dieselbe Datei.
	//
	// 🔴 ZWEI Unterschiede bemerkt ein Editor sofort, und beide sind gewollt:
	//   1. Gesucht wird BEIM TIPPEN, nicht auf Knopfdruck. Dieser Dialog war die einzige Oberfläche im
	//      Haus mit einem „Suchen"-Knopf, und dort sah es aus, als passiere nichts (Entwurf §1).
	//   2. „Sync" überschreibt nicht mehr, sondern ZEIGT ERST, was er ändern würde, und nimmt Häkchen.
	//      ⚠️ Und weil ein bereits gefüllter Kartenwert nie vorangehakt wird (Owner-Entscheid
	//      16.08.2026, Aufgabe 5b), öffnet eine gepflegte Fläche die Vorschau mit NULL Haken. Das ist
	//      der größte sichtbare Unterschied: bis heute war „Sync" ein Klick, jetzt sind es zwei.

	// 💣 WIRFT, statt einen Rückfall zu liefern -- und das ist der ganze Punkt.
	// `ecosystemWikiRegionSnapshot` (map-features-ecosystem-draw.js:440) tut das Gegenteil: es fängt
	// seinen Fehler ab und gibt `{wiki_key, wiki_url}` zurück. Für das Label-Durchreichen ist das
	// richtig; als `laden` des Bauteils wäre es die Fehlerklasse aus dessen Kopfkommentar -- ein 403
	// sähe aus wie „diese Landschaft hat keine Angaben", und ein „Speichern" schriebe darauf.
	async function ladeWikiSchnappschuss(wikiKey) {
		const key = String(wikiKey || "").trim();
		if (key === "") {
			return null;
		}
		const antwort = await fetch(
			`${WIKI_API_URL}?action=staging_sample&wiki_keys=${encodeURIComponent(key)}&limit=1`,
			{ credentials: "same-origin", headers: { Accept: "application/json" } }
		);
		if (!antwort.ok) {
			throw new Error(`Der Server antwortete mit ${antwort.status}.`);
		}
		const daten = avesmapsWikiAssignLandschaftAntwortPruefen(await antwort.json());
		// ⚠️ Eine LEERE Trefferliste ist KEIN Fehler: der Schlüssel kann verwaist sein (die Wiki-Seite
		// ist verschwunden oder wurde nie gesynct). Der Kasten zeigt dann Adresse und Schlüssel und
		// sonst nichts -- leere Felder fallen im Bauteil ohnehin weg.
		return (daten.rows || [])[0] || null;
	}

	/**
	 * 🔴 DER ZUSTAND -- und er LEHNT AB, statt etwas Leeres zu liefern (Vertrag im Kopf von
	 * js/ui/wiki-assign.js). Beide Landschafts-Oberflächen schreiben erst beim „Speichern"; ein
	 * aufgelöstes Leeres wäre vom Zustand „nichts zugewiesen" nicht zu unterscheiden, und der nächste
	 * Klick auf „Speichern" schriebe eine leere Zuweisung über eine bestehende.
	 *
	 * 💣 Die zwei Kartenwerte werden als LESEFUNKTION übergeben, nicht als Wert: `laden` läuft einmal,
	 * die Sync-Vorschau entsteht erst beim Druck auf „Sync" -- dazwischen kann der Editor Namensfeld
	 * und Artauswahl angefasst haben.
	 */
	async function wikiAssignZustand() {
		const area = currentPropertiesArea();
		if (!area) {
			throw new Error("Wiki-Landschaft: keine Fläche gewählt — der Stand ist unbekannt.");
		}
		const wiki = effectiveWikiRegion();
		const schluessel = String(wiki?.wiki_key || "").trim();
		// Nach einer Wahl im Kasten liegt die Staging-Zeile schon vor (der Treffer IST sie) -- dann
		// wird nicht noch einmal geholt.
		if (schluessel !== "" && String(wikiSchnappschuss?.wiki_key || "") !== schluessel) {
			wikiSchnappschuss = await ladeWikiSchnappschuss(schluessel);
		}
		if (schluessel === "") {
			wikiSchnappschuss = null;
		}

		const zustand = avesmapsWikiAssignLandschaftZustand({
			wiki_key: schluessel,
			wiki_url: wiki?.wiki_url || "",
			wiki_name: wiki?.name || "",
			schnappschuss: wikiSchnappschuss,
			arten: regionTypesForKind,
			kind: area.kind,
			kein_artikel: regionKeinArtikel,
			field_origins: regionFieldOrigins,
			name: () => String(propertiesElement("name")?.value || ""),
			region_type: () => String(propertiesElement("type")?.value || ""),
		});
		// ⚠️ NACH dem Bau, nicht davor: erst hier steht der Schnappschuss fest.
		letzterWikiArtikel = zustand.artikel || null;
		ecosystemZeichneWikiAbweichungen();
		return zustand;
	}

	/**
	 * Zuweisen -- und hier wird NICHT geschrieben: dieser Dialog hat „Abbrechen", und eine Zuweisung,
	 * die schon auf dem Server steht, während der Editor auf „Abbrechen" drückt, wäre eine Änderung,
	 * die er ausdrücklich zurückgenommen hat. Der Stand wandert deshalb wie bisher nach
	 * `pendingWikiRegion` und geht beim „Speichern" mit (`update_region` ist ein Teilschreiber).
	 *
	 * 🔴 `pendingWikiRegion` bleibt die EINE Wahrheit dieser Oberfläche über die Zuweisung -- der
	 * Label-Durchtrag (currentRegionWikiSnapshot -> createEcosystemRegionLabel) liest sie, und er
	 * braucht Beschreibung und Staat, die im Kasten selbst gar nicht stehen. Deshalb die rohe
	 * Suchzeile, nicht der aufbereitete Treffer.
	 */
	function wikiAssignZuweisen(treffer) {
		const roh = (treffer && treffer.roh) || {};
		// 🔴 Es reist die URL, NICHT der Schlüssel: wiki_region_key leitet der Server aus wiki_url ab
		// (AGENTS.md §5). Ein hier gebauter Schlüssel wäre eine zweite Ableitung und bräche jeden Join.
		pendingWikiRegion = {
			wiki_key: roh.wiki_key || "",
			name: roh.name || "",
			art: roh.art || "",
			region_parent: roh.region_parent || "",
			affiliation_staat: roh.affiliation_staat || "",
			description: roh.description || "",
			wiki_url: roh.wiki_url || "",
		};
		wikiSchnappschuss = roh;
		// 🪤 Das Bauteil ruft nach „Zuweisen" KEIN `laden` -- es ändert seine Daten selbst. Ohne diese
		// zwei Zeilen zeigte der Kasten den neuen Artikel und die Feldzeilen daneben noch den
		// durchgestrichenen Stand des alten.
		letzterWikiArtikel = avesmapsWikiAssignLandschaftArtikel(
			{ wiki_key: roh.wiki_key || "", wiki_url: roh.wiki_url || "", name: roh.name || "" },
			roh, regionTypesForKind
		);
		ecosystemZeichneWikiAbweichungen();
		// 🔴 Zuweisen benennt SOFORT um: „ist ein Wiki-Eintrag zugewiesen, heisst das Ding wie im Wiki".
		// Nicht erst auf „Sync" warten -- ein Knopf, der das Selbstverständliche nachholt, wird
		// vergessen, und dann steht neben „Farindelwald" weiter ein Tippfehler im Namensfeld.
		const nameInput = propertiesElement("name");
		if (nameInput && String(roh.name || "").trim() !== "") {
			nameInput.value = String(roh.name).trim();
		}
		// Haken aus und deaktiviert -- die Wiki-Landschaft besitzt den Namen. Das Feld bleibt aber
		// SCHREIBBAR: umbenennen darf man danach trotzdem noch, von Hand.
		syncPropertiesAutoName();
		setPropertiesStatus("Wiki-Landschaft gewählt — Name übernommen, noch nicht gespeichert.");
	}

	function wikiAssignLoesen() {
		pendingWikiRegion = null;                 // ausdrücklich entfernt, nicht bloss unberührt
		wikiSchnappschuss = null;
		// Ohne Wiki-Landschaft ist der Haken wieder bedienbar. Der Name bleibt stehen, wie er ist --
		// die Zuweisung zu lösen soll nicht ungefragt umbenennen.
		syncPropertiesAutoName();
		setPropertiesStatus("Wiki-Landschaft entfernt — noch nicht gespeichert.");
	}

	/**
	 * „Abbrechen" im Zuweisungskasten: die ungespeicherte Zuweisungsänderung verwerfen.
	 *
	 * 🔴 `undefined`, NICHT `null` — die zwei bedeuten hier Gegenteiliges. `effectiveWikiRegion`
	 * liest `undefined` als „unberührt, nimm den Stand der Fläche" und `null` als „ausdrücklich
	 * entfernt". Mit `null` verworfen bliebe die Löschung stehen, und das nächste „Speichern"
	 * schriebe genau das, was gerade abgebrochen wurde.
	 * ⚠️ Der NAME im Formular bleibt, wie er ist. `wikiAssignZuweisen` hat ihn zwar gesetzt, aber er
	 * ist ein sichtbares, frei editierbares Feld -- ihn stillschweigend zurückzuschreiben könnte
	 * eine seither von Hand getippte Eingabe zerstören. Dieselbe Regel wie in `wikiAssignLoesen`
	 * darüber („die Zuweisung zu lösen soll nicht ungefragt umbenennen").
	 */
	function wikiAssignVerwerfen() {
		pendingWikiRegion = undefined;
		// 🪤 HIER STAND `wikiSchnappschuss = null;`, und die Zeile war NACHWEISLICH wirkungslos: keine
		// Mutation konnte sie zum Fallen bringen (17.08.2026). `wikiAssignZustand` holt den
		// Schnappschuss ohnehin neu, sobald sein Schlüssel nicht zum jetzigen passt, und leert ihn bei
		// leerem Schlüssel selbst -- und genau dieser Lauf folgt direkt danach (`neuLaden` im Bauteil).
		// Eine Zeile, die kein Test töten kann, sieht wie ein Riegel aus und ist keiner.
		syncPropertiesAutoName();
		setPropertiesStatus("Zuweisung verworfen.");
	}

	/**
	 * ⚠️ ÜBERNEHMEN FÜLLT NUR DAS FORMULAR (Entwurf §6) -- gespeichert wird mit „Speichern".
	 *
	 * 🔴 WIRFT, wenn nichts angehakt war: das Bauteil liest eine Ablehnung als „es ist nichts
	 * passiert" und lässt die Vorschau stehen. Löste es still auf, schlösse sich die Vorschau und der
	 * Editor hielte seinen Haken für übernommen.
	 * 💣 Und die Art wird NUR gesetzt, wenn das Auswahlfeld sie kennt. Das Vokabular ist je Ebene ein
	 * anderes (`wald` ist Vegetation und darf nie auf einer topographischen Region landen); der Server
	 * prüft dasselbe in avesmapsEcosystemAssertRegionType und antwortete sonst mit 400.
	 * ⚠️ avesmapsWikiAssignLandschaftArt liefert per Konstruktion schon nur Arten DIESER Ebene -- die
	 * Prüfung hier ist die zweite Hälfte desselben Riegels, an dem Element, das ihn tragen muss.
	 */
	function wikiAssignSyncUebernehmen(zeilen) {
		const werte = avesmapsWikiAssignLandschaftSyncWerte(zeilen);
		if (avesmapsWikiAssignLandschaftSyncLeer(werte)) {
			throw new Error("Keine übernehmbare Angabe angehakt.");
		}
		// 🔴 ZWEITE HÄLFTE DER ÜBERNAHME: merken, WELCHE Felder aus dem Wiki kamen. Ohne sie stempelt
		// der Server sie als „von uns", und der nächste Abgleich liesse genau die Felder in Ruhe, die
		// er gerade selbst gefüllt hat.
		const nameInput = propertiesElement("name");
		if (werte.name !== null && nameInput) {
			nameInput.value = werte.name;
			wikiUebernommen.add("name");
		}
		const typeSelect = propertiesElement("type");
		if (werte.region_type !== null && typeSelect
			&& Array.from(typeSelect.options || []).some((option) => option.value === werte.region_type)) {
			typeSelect.value = werte.region_type;
			wikiUebernommen.add("region_type");
			applyTerrainPresetForType();
		}
		// Der Griff folgt der Art, und die Art hat sich gerade geändert.
		// ⚠️ Und wenn er ihr folgt, ist der Name DANN von uns, nicht aus dem Wiki: das Wiki hat „Wald"
		// gesagt, „Wald-001" haben wir daraus gebaut. Deshalb fällt `name` hier wieder heraus.
		const nameVorGriff = String(propertiesElement("name")?.value || "");
		syncPropertiesAutoName();
		if (String(propertiesElement("name")?.value || "") !== nameVorGriff) {
			wikiUebernommen.delete("name");
		}
		ecosystemZeichneWikiAbweichungen();
		setPropertiesStatus("Aus dem Wiki übernommen — noch nicht gespeichert.");
	}

	// ---- Der Wiki-Override an den zwei Feldzeilen ------------------------------------------------
	// Entwurf: docs/superpowers/specs/2026-08-17-wiki-override-fuer-alle-design.md
	//
	// 🔴 DIE ZWEITE HÜLLE, und sie hat eine ANDERE Bauform als das Editorfenster: dort steht die
	// Beschriftung LINKS in einer Rasterspalte (`.dt-grid--wiki`), hier OBEN über dem Feld
	// (`.ecosystem-properties-dialog__field > span`). Übertragen wird die REGEL -- Wiki-Stand
	// durchgestrichen, ↺ daneben, „von uns" hebt die Beschriftung hervor --, nicht das CSS.
	// ⚠️ Zwei Hüllen sind die Obergrenze; beide Regelsätze stehen in EINER Datei
	// (css/components/wiki-override.css), die diese Welt über css/styles.css bekommt.

	/**
	 * Die Art-Beschriftungen -- aus dem AUSWAHLFELD SELBST, nicht aus einer zweiten Liste.
	 * 💣 Ohne sie stünde „wald" durchgestrichen neben einem Feld, das „Wald" zeigt: genau der
	 * Befund, der beim Ort am 17.08.2026 live sichtbar wurde und sich wie ein Tippfehler las.
	 */
	function wikiArtBeschriftungen() {
		const karte = {};
		(regionTypesForKind || []).forEach((typ) => {
			karte[String(typ.type_key)] = String(typ.label || typ.type_key);
		});
		return karte;
	}

	// 🪤 Der zuletzt geladene Artikel. Das Bauteil ruft `laden` nur beim Mounten und beim
	// „Abbrechen" -- nach „Zuweisen" und „Entfernen" ändert es seine Daten selbst. Der Zeichner
	// braucht die Wiki-Werte trotzdem.
	let letzterWikiArtikel = null;

	function ecosystemZeichneWikiAbweichungen() {
		if (typeof avesmapsWikiFeldStand !== "function" || typeof avesmapsWikiAssignSubject !== "function") {
			return;
		}
		const abgeleitet = istAbgeleiteteFlaeche(currentPropertiesArea());
		const stand = avesmapsWikiFeldStand(
			(avesmapsWikiAssignSubject("landschaft") || {}).felder || [],
			{
				name: String(propertiesElement("name")?.value || ""),
				region_type: String(propertiesElement("type")?.value || ""),
			},
			(letzterWikiArtikel && letzterWikiArtikel.werte) || {},
			avesmapsWikiAssignLandschaftHerkunft(regionFieldOrigins, AVESMAPS_WIKI_ASSIGN_LANDSCHAFT_KARTENFELDER),
			{ region_type: wikiArtBeschriftungen() }
		);
		document.querySelectorAll("#landschaft-dialog-overlay [data-eco-wiki-alt]").forEach((zelle) => {
			const feld = zelle.getAttribute("data-eco-wiki-alt") || "";
			const s = stand[feld];
			zelle.replaceChildren();
			const vonUns = Boolean(s && s.abweicht && s.herkunft === "manual");
			// Die Hervorhebung sitzt an der BESCHRIFTUNG, nicht an der Zelle. Als Klasse gesetzt statt
			// per `:has()`: jene Elternauswahl fällt bei fehlender Browserfähigkeit LAUTLOS aus, und
			// die Zeile sähe dann aus wie eine mit unbekannter Herkunft -- also wie der andere Zustand.
			zelle.parentElement?.classList.toggle("has-wiki-ovr", vonUns);
			if (!s || !s.abweicht) {
				return;
			}
			const alt = document.createElement("span");
			alt.className = "dt-old";
			alt.textContent = s.wikiAnzeige;
			alt.title = (vonUns ? "Von uns gesetzt. " : "Weicht vom Wiki ab. ") + "Wiki-Stand: " + s.wikiAnzeige;
			// 🔴 KEIN ↺ AUF EINER GESPERRTEN ZEILE: die Art einer Klimazone steht fest, der Server
			// lehnt sie ab (avesmapsClimateAssertNotDerived). Der durchgestrichene Stand bleibt --
			// er ist eine Auskunft, kein Angebot.
			if (abgeleitet && feld === "region_type") {
				zelle.append(alt);
				return;
			}
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
				ecosystemWikiFeldZuruecksetzen(feld, s.wikiWert);
			});
			zelle.append(alt, knopf);
		});
	}

	/**
	 * ↺ an einer Feldzeile: genau diesen einen Wert aus dem Wiki ins Formular holen.
	 * ⭐ ES IST DIE SYNC-ÜBERNAHME EINER EINZIGEN ZEILE -- derselbe Weg, dieselbe Merkliste, kein
	 * zweiter Schreibpfad. Geschrieben wird mit „Speichern".
	 */
	function ecosystemWikiFeldZuruecksetzen(feld, wikiWert) {
		if (feld === "name") {
			const eingabe = propertiesElement("name");
			if (!eingabe) {
				return;
			}
			eingabe.value = wikiWert;
		} else if (feld === "region_type") {
			const select = propertiesElement("type");
			// 💣 Nur, wenn das Auswahlfeld die Art kennt: das Vokabular ist je Ebene ein anderes, und
			// der Server antwortet auf ein fremdes Paar mit 400.
			if (!select || !Array.from(select.options || []).some((option) => option.value === wikiWert)) {
				return;
			}
			select.value = wikiWert;
			applyTerrainPresetForType();
		}
		wikiUebernommen.add(feld);
		syncPropertiesAutoName();
		ecosystemZeichneWikiAbweichungen();
		setPropertiesStatus("Aus dem Wiki übernommen — noch nicht gespeichert.");
	}

	// 🔴 HIER STAND wikiAssignKeinArtikelGeaendert -- gefallen am 16.08.2026 mit dem Häkchen „Kein
	// Wiki-Artikel vorhanden" (Owner-Entscheid). Er hat den REGIONEN-EDITOR genannt; gemessen trägt die
	// Objektart `landschaft` ZWEI Oberflächen -- diesen Dialog und html/landschaften-editor.html --,
	// und das Häkchen steht in EINER Erklärung. Es fällt deshalb in beiden.
	// ⚠️ Der MERKER bleibt: `ecosystem_region.properties_json` trägt ihn weiter, `list_regions` gibt ihn
	// weiter heraus, `update_region` schreibt ihn weiter. Gesetzt wird er im Konfliktzentrum.

	/**
	 * 🪤 ERST NACH `list_regions`, nicht beim Öffnen -- und das ist keine Bequemlichkeit.
	 *
	 * Die Abbildung „Wiki-Art -> Flächenart" braucht das Vokabular DIESER Ebene
	 * (avesmapsWikiAssignLandschaftArt), und `laden` läuft genau EINMAL. Vor der Antwort gemountet,
	 * wäre `regionTypesForKind` leer, jede Wiki-Art fiele auf `""` zurück, und die Sync-Vorschau böte
	 * „die Angabe leeren" an, wo in Wahrheit „Wald → wald" steht. Derselbe Grund, aus dem der
	 * Auto-Name-Haken zwanzig Zeilen weiter unten ebenfalls erst hier abgeleitet wird.
	 */
	function mountWikiAssign() {
		const host = propertiesElement("wiki-host");
		if (!host || typeof avesmapsWikiAssignMount !== "function") {
			return;
		}
		if (wikiAssign) {
			wikiAssign.zerstoeren();
			wikiAssign = null;
		}
		wikiAssign = avesmapsWikiAssignMount(host, {
			subject: "landschaft",
			// Der Kartendialog, nicht das Editorfenster: index.html lädt css/components/region-sync.css,
			// nicht editor-page.css -- mit der Hülle „dt" stünde der Kasten völlig ungestylt da.
			skin: "label-wiki",
			laden: wikiAssignZustand,
			// Die Suche antwortet mit FLACHEN Zeilen; erst hier entsteht daraus ein Treffer samt der
			// Abbildung Wiki-Art -> Flächenart, und die braucht das Vokabular dieser Ebene.
			trefferAufbereiten: (zeile) => avesmapsWikiAssignLandschaftTreffer(zeile, regionTypesForKind),
			zuweisen: wikiAssignZuweisen,
			loesen: wikiAssignLoesen,
			verwerfen: wikiAssignVerwerfen,
			syncUebernehmen: wikiAssignSyncUebernehmen,
		});
	}

	// ---- Auto-Name --------------------------------------------------------------------------------------
	// Der Haken wird nicht geladen, sondern ABGELEITET: der Name selbst trägt den Zustand
	// (map-features-ecosystem-naming.js). „Wald-001" öffnet mit gesetztem Haken und gesperrtem Feld,
	// „Farindel" mit leerem Haken und schreibbarem Feld.
	//
	// 🔴 Eine zugewiesene Wiki-Landschaft schlägt beides: sie besitzt den Namen. Dann ist der Haken
	// DEAKTIVIERT statt nur leer, damit die Sperre im Formular sichtbar ist -- genau wie beim Weg-Editor
	// (review-paths.js:229), wo ein zugewiesener Wiki-Weg denselben Vorrang hat.

	// Die Art-Bezeichnung zur gerade gewählten Art. Leer, solange list_regions noch unterwegs ist.
	function currentPropertiesArtLabel() {
		const typeKey = String(propertiesElement("type")?.value || "");
		return String(regionTypesForKind.find((type) => type.type_key === typeKey)?.label || "");
	}

	function syncPropertiesAutoName({ regenerate = false } = {}) {
		const nameInput = propertiesElement("name");
		const autoNameBox = propertiesElement("autoname");
		if (!nameInput || !autoNameBox) {
			return;
		}

		const wiki = effectiveWikiRegion();
		const wikiName = String(wiki?.name || "").trim();
		autoNameBox.disabled = wikiName !== "";
		if (wikiName !== "") {
			autoNameBox.checked = false;
			nameInput.readOnly = false;   // der Wiki-Name steht im Feld; „Sync" schreibt ihn hinein
			return;
		}

		nameInput.readOnly = autoNameBox.checked;
		if (autoNameBox.checked && regenerate) {
			nameInput.value = nextEcosystemRegionAutoName(currentPropertiesArtLabel(), knownRegionNamesForAutoName());
		}
	}

	// Die Namen, gegen die die laufende Nummer zählt. Der Regionen-Wähler hält sie ohnehin schon je Ebene;
	// diese Region selbst wird ausgelassen, sonst zählte ihr eigenes „Wald-001" gegen sie und jedes
	// Anhaken schöbe die Nummer eine weiter.
	function knownRegionNamesForAutoName() {
		const own = String(currentPropertiesArea()?.region_name || "");
		const all = typeof ecosystemRegionsByKind !== "undefined" && ecosystemRegionsByKind
			? Object.values(ecosystemRegionsByKind).filter(Array.isArray).flat().map((region) => String(region?.name || ""))
			: [];
		const index = all.indexOf(own);
		if (index !== -1) {
			all.splice(index, 1);
		}
		return all;
	}

	// ---- öffnen ---------------------------------------------------------------------------------------

	/**
	 * Den geteilten Quellen-Editor an die REGION dieser Fläche hängen.
	 *
	 * 🔴 An die REGION, nicht an die Fläche. Eine Region liegt auf der Karte in vielen Flächen (der
	 * Eine Region liegt auf der Karte in EINER oder mehreren Flächen; ihre Quellenangabe gilt für alle.
	 * 🚩 Hier stand „der Finsterkamm in 57" -- live gemessen am 25.08.2026 hat er EINE Fläche, und
	 * 1025 von 1026 Regionen haben genau eine. Die Zahl war einmal wahr und ist es nicht mehr; die
	 * REGEL bleibt richtig: eine Region KANN mehrere tragen, und dann wäre dieselbe Angabe mehrfach
	 * zu pflegen -- beim Auseinanderlaufen wüsste niemand, welche gilt.
	 * 57-mal einzutragen und 57-mal zu pflegen -- und beim Auseinanderlaufen wüsste niemand, welche
	 * gilt. Es ist DIESELBE Liste, die der Landschaften-Editor an der Region zeigt; wer sie hier
	 * ändert, ändert sie dort. Das ist der Sinn, kein Nebeneffekt.
	 *
	 * 🔴 ZUERST das Bauteil, DANN der Knoten. Wo es das Quellenmodul nicht gibt -- eine Prüfseite,
	 * eine Testfixture mit Ersatz-DOM -- wird hier NICHTS angefasst. Die erste Fassung fragte
	 * zuerst nach dem Knoten und rief `cloneNode` darauf; zwei Tests des Flächendialogs fielen um,
	 * weil ihre Attrappe Ersatzknoten ohne `cloneNode` liefert. Ein Nebenfeature darf den Dialog
	 * nicht mitreissen.
	 */
	function mountEcosystemAreaSources() {
		// 🔴 KEIN Quellen-Mount mehr (26.08.2026). Die Quellen einer Landschaft liegen an ihrer
		// BESCHRIFTUNG (`entity_type` = „region", `map_features.public_id`) -- dort sind alle 8142
		// Zeilen, und nur die liest die Karte (renderFeatureSourceLine, map-features-labels.js).
		// 💣 Der zweite Kasten fuer die Flaeche war live LEER: null von 30 gleichmaessig verteilten
		// Flaechen trugen eine Quelle, und in der Kartenpayload kommt `ecosystem` unter 6336 Objekten
		// mit Quellen kein einziges Mal vor. Ein zweiter Kasten, den nie jemand gefuellt hat -- und
		// dessen Inhalt kein Besucher gesehen haette.
		// ⚠️ Die Funktion BLEIBT als leere Huelle stehen, statt ihre Aufrufer zu jagen: sie wird an
		// zwei Stellen gerufen, und ein fehlender Bezeichner waere ein ReferenceError mitten im
		// Oeffnen. Der `entity_type` bleibt serverseitig freigegeben (der Deploy loescht nie).
	}

	async function openEcosystemPropertiesDialog(publicId) {
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		propertiesSourcePublicId = String(publicId || "");
		const area = currentPropertiesArea();
		if (!overlayElement || !area) {
			return;
		}

		bindEcosystemPropertiesDialog();
		// 🔴 Anmelden und Reiter oeffnen -- der Einstieg ist ein Parameter, kein gemerkter Zustand.
		if (typeof avesmapsLandschaftDialogHaelfte === "function") {
			avesmapsLandschaftDialogHaelfte("flaeche", true);
		}
		if (typeof avesmapsLandschaftDialogReiter === "function") {
			avesmapsLandschaftDialogReiter("flaeche");
		}
		pendingWikiRegion = undefined;
		wikiSchnappschuss = null;
		regionKeinArtikel = false;
		regionFieldOrigins = null;
		wikiUebernommen = new Set();
		if (wikiAssign) {
			wikiAssign.zerstoeren();
			wikiAssign = null;
		}
		regionTypesForKind = [];
		regionAreaCount = 0;
		regionAreaCountLoaded = false;
		// 💣 VERRIEGELT, BIS `list_regions` DA IST. Die zwei Kurven-Bedienelemente standen sonst
		// zwischen Oeffnen und Antwort offen und ohne Ausgangswert: wer in dieser Luecke klickte,
		// erzeugte keine Aenderung gegenueber `kurveGeladen` (das noch `null` war) -- der Rumpf trug
		// nichts, gespeichert wurde nichts, und beim naechsten Oeffnen stand die Kurvenbeschriftung
		// wieder auf „aus". Ohne Fehlermeldung. Ausserdem erbte der Dialog sonst den Stand der
		// ZULETZT geoeffneten Flaeche.
		syncPropertiesCurve(null);
		setPropertiesError("");
		setPropertiesStatus("");
		setDeleteButtonReady(false);

		// Der Titel nennt die EBENE UND das Ding (Owner 2026-07-28): „Vegetations-Fläche bearbeiten",
		// „Derographie-Fläche bearbeiten", „Topographie-Fläche bearbeiten". Bis heute stand hier nur die
		// Ebene („Vegetation bearbeiten"), und das verschwieg genau die Unterscheidung, an der man sich
		// verklickt: der optisch fast gleiche Dialog daneben bearbeitet das LABEL, nicht die Fläche.
		// Der Dialog ist seit dem Wegfall des Regionen-Wählers auch der Ort, an dem eine frisch
		// gezeichnete Fläche ihren Steckbrief bekommt -- da soll oben stehen, worüber man entscheidet.
		const titleElement = document.getElementById("ecosystem-properties-title");
		if (titleElement && typeof ecosystemDialogTitle === "function") {
			titleElement.textContent = ecosystemDialogTitle(area.kind, "flaeche");
		}

		const nameInput = propertiesElement("name");
		if (nameInput) {
			nameInput.value = String(area.region_name || "");
		}
		const typeSelect = propertiesElement("type");
		if (typeSelect) {
			typeSelect.innerHTML = "";
			typeSelect.appendChild(new Option(emptyTypeLabel(area?.kind), "", true, true));
		}
		// Gesperrt, solange das Vokabular fehlt -- und die Erklärzeile der Klimazone steht ab dem
		// ERSTEN Bild da, nicht erst nach `list_regions`: die Ebene steht in der Flächenzeile, die
		// längst geladen ist, und ein Satz, der eine halbe Sekunde später nachrückt, liest sich wie
		// eine Reaktion auf etwas, das man getan hat.
		syncPropertiesTypeLock(area, false);
		// Anders als der Auto-Name-Haken braucht dieser hier KEIN Art-Vokabular -- er hängt allein am
		// verbundenen Label. Deshalb sofort, nicht erst nach list_regions.
		syncPropertiesShowName(area);
		syncPropertiesNodix(area);
		syncPropertiesLocked(area);
		// Wie die beiden Haken: sofort, nicht erst nach list_regions. Die Gipfel hängen an den geladenen
		// Labels und an der Geometrie der Fläche -- beides liegt schon vor.
		renderTerrainControls(area);
		// Solange dieses Fenster offen ist, liegt das Höhenmodell ohne Schleier da -- man stellt hier
		// ein und muss durchgehend sehen, was man einstellt (Owner 2026-07-28).
		window.AvesmapsEcosystemHeightRender?.setSolid?.(true);
		renderEcosystemPeakRows(area);
		// 🪤 Der Zuweisungskasten kommt ERST nach `list_regions` -- siehe mountWikiAssign. Bis dahin
		// bleibt sein Platz leer, genauso wie die Artauswahl darüber bis dahin `disabled` ist.
		propertiesElement("wiki-host")?.replaceChildren?.();

		overlayElement.hidden = false;
		// Fall #79: erst jetzt, der Balken braucht seine Breite (siehe renderEcosystemHeightScale).
		abonniereHoehenskala();
		renderEcosystemHeightScale(area);
		document.getElementById("ecosystem-properties-dialog")?.focus();
		nameInput?.focus();
		nameInput?.select();

		// Das Art-Vokabular und die Flächenzahl kommen aus list_regions -- dieselbe Aktion, aus der der
		// Regionen-Wähler seine Liste zieht, und die einzige Stelle, an der die Arten definiert sind.
		try {
			const result = await postEcosystemEdit("list_regions", { kind: area.kind });
			if (!isEcosystemPropertiesDialogOpen() || propertiesSourcePublicId !== String(publicId || "")) {
				return;                              // zwischenzeitlich geschlossen oder andere Fläche
			}
			regionTypesForKind = Array.isArray(result.region_types) ? result.region_types : [];
			const mine = (result.regions || []).find((region) => region.public_id === area.region_public_id);
			regionAreaCount = Number(mine?.area_count || 0);
			regionAreaCountLoaded = Boolean(mine);
			// 🔴 Der Quellen-Editor hängt an der REGION dieser Fläche. Hier, nicht früher: der Riegel
			// wenige Zeilen darüber hat gerade bestätigt, dass der Dialog noch DIESE Fläche zeigt --
			// ein Mount davor könnte an einer längst geschlossenen hängen.
			mountEcosystemAreaSources(area.region_public_id);
			// Der dritte Zustand kommt aus DERSELBEN Antwort -- `list_regions` ist der einzige Leseweg,
			// der ihn herausgibt (avesmapsListEcosystemRegions). Die Flächenzeile aus dem Kartenpayload
			// trägt ihn nicht, und ein zweiter Abruf nur für ein Häkchen wäre eine Anfrage zu viel.
			regionKeinArtikel = mine?.wiki_no_article === true;
			// Aus derselben Antwort, aus demselben Grund. 🪤 Sie steht dort erst seit dem 22.08.2026:
			// der Server stempelte seit dem 18.08., aber `list_regions` gab die Ablage bewusst nicht
			// heraus -- es gab fuer die Stempel schlicht keinen Leser
			// (avesmapsEcosystemRegionFieldOrigins).
			regionFieldOrigins = mine?.field_origins || null;
			// Aus derselben Antwort und aus demselben Grund: der Kartenpayload traegt die Einstellung
			// nicht, und ein zweiter Abruf nur dafuer waere eine Anfrage zu viel.
			syncPropertiesCurve(regionAreaCount > 0 ? { an: mine?.curve_label === true, max: mine?.curve_label_max } : null);
			setDeleteButtonReady(regionAreaCountLoaded);
			if (typeSelect) {
				typeSelect.innerHTML = "";
				typeSelect.appendChild(new Option(emptyTypeLabel(area?.kind), "", false, false));
				regionTypesForKind.forEach((type) => {
					typeSelect.appendChild(new Option(type.label, type.type_key));
				});
				typeSelect.value = String(area.region_type || "");
			}
			// HIER STAND `typeSelect.disabled = false;` -- die Zeile, die die Klimazone bedienbar
			// machte. Der Aufruf ersetzt sie und steht aus demselben Grund an derselben Stelle:
			// wenn das Feld seine endgültige Gestalt hat.
			syncPropertiesTypeLock(area, true);
			const areasNote = propertiesElement("areas");
			if (areasNote) {
				areasNote.textContent = formatEcosystemRegionCarryNote(regionAreaCount, Boolean(linkedEcosystemLabelEntry(area)));
			}
			// 🪤 ERST HIER, nicht beim Öffnen: der Haken hängt an der Art-BEZEICHNUNG, und die kommt mit
			// list_regions. Vorher wüsste `Wald-001` nicht, dass es zu „Wald" gehört, und der Haken bliebe
			// fälschlich leer. Nur ableiten, solange das Feld unberührt ist -- wer in dieser Millisekunde
			// schon getippt hat, soll das nicht überschrieben bekommen.
			const autoNameBox = propertiesElement("autoname");
			if (autoNameBox && nameInput && nameInput.value === String(area.region_name || "")) {
				// 🔴 Bei einer FRISCHEN Fläche bleibt der Haken aus (Owner 2026-07-28). Sie trägt zwar schon
				// einen Auto-Namen -- irgendwie muss sie ja heissen --, aber sie hat noch keine Art, und
				// damit ist der Name nur ein Platzhalter, den der Editor gleich überschreibt. Ihn als
				// „gewollt automatisch" vorzuhaken hiesse, den ersten getippten Namen wieder wegzurechnen.
				autoNameBox.checked = String(area.region_type || "") !== ""
					&& isEcosystemRegionAutoName(area.region_name, currentPropertiesArtLabel());
				syncPropertiesAutoName();
			}
			// 🪤 UND HIER, aus demselben Grund: die Abbildung „Wiki-Art -> Flächenart" braucht das
			// Vokabular DIESER Ebene, und `laden` läuft genau einmal (siehe mountWikiAssign).
			mountWikiAssign();
		} catch (error) {
			setPropertiesError(error?.message || "Das Art-Vokabular konnte nicht geladen werden.");
		}
	}

	// Das verbundene Karten-Label umbenennen. `update_label` verlangt den vollen Satz Darstellungswerte
	// (Größe, Rotation, Zoom-Bänder, Priorität) -- die kommen aus dem geladenen Label, nicht aus
	// Vorgabewerten, sonst setzte ein blosses Umbenennen die Gestaltung des Editors zurück.
	//
	// 🪤 Scheitert es, ist das eine Meldung und kein Abbruch: die Region IST gespeichert, und ein
	// zurückgerollter Namen wäre die schlechtere Antwort als ein Label, das hinterherhinkt.
	// Das verbundene Label, so wie der Label-Layer es hält -- oder null, wenn die Region keins hat oder
	// es (noch) nicht geladen ist.
	function linkedEcosystemLabelEntry(area) {
		const labelPublicId = String(area?.label_public_id || "");
		if (!labelPublicId || typeof findLabelEntryByPublicId !== "function") {
			return null;
		}
		return findLabelEntryByPublicId(labelPublicId);
	}

	// 🔴 Die Zeile nennt BEIDES, was an der Region hängt: ihre Flächen und ihr Label. Bis heute stand hier
	// nur die Flächenzahl, und das verschwieg die Hälfte -- „Löschen" nimmt das Label genauso mit wie die
	// Flächen. Die Gegenzeile im Label-Dialog sagt dasselbe von der anderen Seite (renderLabelCarrierNote).
	//
	// Ein Label ist es höchstens EINES: label_public_id ist ein einzelner Zeiger, kein N:M.
	function formatEcosystemRegionCarryNote(areaCount, hasLabel) {
		const count = Number(areaCount) || 0;
		const areas = count === 1 ? "1 Fläche" : `${count} Flächen`;

		return hasLabel
			? `Diese Region trägt ${areas} und 1 Label.`
			: `Diese Region trägt ${areas}.`;
	}

	// Der Haken steht auf dem Zustand des Labels, nicht auf einer Vorgabe.
	//
	// 🪤 Er ist NICHT gesperrt, wenn die Region noch kein Label hat -- dann LEGT das Anhaken eines an.
	// Erst war er dort grau, und das war falsch gedacht: der V5-Import hat 124 der 133 Flächen ein Label
	// gegeben, die übrigen 9 sind von Hand gezeichnete. Für neun Zeilen ein Serien-Nachziehen zu bauen
	// wäre Unfug; der Haken erledigt sie beiläufig, dort wo jemand die Region ohnehin gerade anfasst.
	function syncPropertiesShowName(area) {
		const box = propertiesElement("showname");
		if (!box) {
			return;
		}
		const entry = linkedEcosystemLabelEntry(area);
		box.disabled = false;
		box.checked = Boolean(entry) && entry.label?.showName !== false;
	}

	// 🔴 Nodix = Kraftlinien-Knoten. Das Flag sitzt am LABEL, nicht an der Region: eine Kraftlinie
	// verbindet zwei PUNKTE, und der Punkt einer Region ist ihr Label (am Point of Inaccessibility).
	// Genau dieses Feld hat der Label-Editor auch — hier ist es nur dort erreichbar, wo Editoren die
	// Region ohnehin anfassen, statt den Umweg über den Label-Dialog zu verlangen.
	//
	// 🪤 Ohne Label kein Nodix: der Haken ist dann gesperrt. Er könnte zwar wie „Regionname anzeigen"
	// eines anlegen — aber ein Label, das nur entsteht, um unsichtbar ein Flag zu tragen, wäre ein
	// Geist auf der Karte. Erst „Regionname anzeigen", dann Nodix.
	function syncPropertiesNodix(area) {
		const box = propertiesElement("nodix");
		if (!box) {
			return;
		}
		const entry = linkedEcosystemLabelEntry(area);
		box.disabled = !entry;
		box.checked = Boolean(entry) && Boolean(entry.label?.isNodix);
		box.title = entry ? "" : `Erst „Regionname anzeigen" — ein Nodix braucht das Label als Punkt.`;
	}

	// Die Klick-Sperre der Region (19.08.2026).
	//
	// 🔴 Sie liegt an der REGION und reist mit jeder ihrer Flächen im Payload mit -- der Haken liest
	// sie deshalb direkt von der angeklickten Fläche, ohne Nachladen. Sperrt jemand die Region über
	// das Fenster oder das Flächenmenü, zieht `merkeSperre` den Bestand nach, und das nächste Öffnen
	// dieses Dialogs zeigt den neuen Stand.
	// Die Kurvenbeschriftung der Region (Entwurf §2).
	//
	// 🔴 Sie kommt aus `list_regions`, nicht aus der Flaechenzeile: der Kartenpayload traegt sie
	// nicht, und sie gehoert der REGION -- dieselbe Begruendung wie beim dritten Zustand daneben.
	// ⚠️ Ohne Flaeche keine Mittelachse; dann verriegelt UND mit Grund, wie im Beschriftungsdialog.
	function syncPropertiesCurve(stand) {
		const haken = propertiesElement("curve");
		const zahl = propertiesElement("curve-max");
		const hinweis = propertiesElement("curvehint");
		if (!haken || !zahl) {
			return;
		}
		const bedienbar = Boolean(stand);
		haken.disabled = !bedienbar;
		zahl.disabled = !bedienbar;
		if (hinweis) {
			hinweis.hidden = bedienbar;
			hinweis.textContent = bedienbar
				? ""
				: "Ohne Landschaftsfläche gibt es keine Mittelachse, auf der der Name laufen könnte.";
		}
		// 💣 Kein gemerkter Stand heisst: dieses Speichern NENNT die Felder nicht. Aus einem
		// verriegelten Haken ein „aus“ abzuleiten schaltete die Kurve der Region ab.
		kurveGeladen = bedienbar ? { an: stand.an === true, max: Number(stand.max || 1) || 1 } : null;
		haken.checked = bedienbar ? kurveGeladen.an : false;
		zahl.value = bedienbar ? String(kurveGeladen.max) : "1";
	}

	// Was dieses Speichern an der Kurveneinstellung NENNT -- oder null. Dieselbe Regel wie im
	// Beschriftungsdialog (getLabelCurvePayload): geprueft wird VERAENDERT, nicht gesetzt.
	function getPropertiesCurvePayload() {
		const haken = propertiesElement("curve");
		const zahl = propertiesElement("curve-max");
		if (!kurveGeladen || !haken || !zahl) {
			return null;
		}
		const an = Boolean(haken.checked);
		const max = Math.min(3, Math.max(1, Number.parseInt(String(zahl.value || "1"), 10) || 1));
		if (an === kurveGeladen.an && max === kurveGeladen.max) {
			return null;
		}
		return { curve_label: an, curve_label_max: max };
	}

	function syncPropertiesLocked(area) {
		const box = propertiesElement("locked");
		if (!box) {
			return;
		}
		box.checked = area?.is_locked === true;
	}

	// Die Art einer KLIMAZONE steht fest (22.08.2026).
	//
	// 🔴 Ihre Fläche entsteht aus den Trennlinien, und ihre ART sagt, WELCHE der Zonen das ist --
	// der Server lehnt eine Änderung deshalb ab (avesmapsUpdateEcosystemRegion, ecosystem.php).
	// Bis hierher erfuhr der Editor das erst beim Speichern, als Fehlermeldung ohne Grund: das
	// Auswahlfeld liess sich verstellen, und was daran falsch war, stand nirgends.
	// Der Zwilling im Editorfenster (html/landschaften-editor.html, regionEditBlock) kann es seit
	// dem 03.08.2026 -- gesperrtes Feld PLUS Erklärzeile, und beides wortgleich.
	//
	// 💣 EINE Funktion für BEIDE Zustände des Feldes. Bis heute stand `disabled` an zwei Stellen mit
	// zwei Bedeutungen: beim Öffnen `true` („das Vokabular fehlt noch"), nach `list_regions` `false`
	// („fertig geladen") -- und die zweite Stelle wusste nichts von der Ebene. Wer die Sperre nur an
	// einer der beiden anbringt, baut genau den Fehler wieder ein, den es hier zu beheben gab.
	//
	// 🔴 Über `istAbgeleiteteFlaeche`, nie über einen eigenen Vergleich gegen "klima".
	// Der Kommentar an `isDerivedEcosystemKind` (03.08.2026) war eine VORHERSAGE, keine Zählung --
	// bei ihrer Einführung gab es noch keine einzige Aufrufstelle: „fuenf Aufrufstellen stellen
	// dieselbe Frage -- und die fuenfte wird sonst vergessen". Sie sind heute fünf, diese ist die
	// fünfte, und sie war tatsächlich vergessen worden.
	//
	// ⚠️ Der Riegel, der zählt, bleibt der auf dem Server. Ein `disabled` verhindert das Verstellen,
	// nicht das Senden -- ein gesperrtes `<select>` gibt seinen `value` weiterhin heraus, und genau
	// das ist gewollt: der Rumpf trägt die UNVERÄNDERTE Art mit, und der Server vergleicht gegen den
	// Bestand, statt jedes Mitschicken abzulehnen.
	//
	// @param {boolean} vokabularDa Ist die Artenliste schon geladen? Vorher ist das Feld für JEDE
	//   Ebene gesperrt (es trägt nur den Platzhalter), danach nur noch für die Klimazone.
	function syncPropertiesTypeLock(area, vokabularDa) {
		const typeSelect = propertiesElement("type");
		const hinweis = propertiesElement("typehint");
		const abgeleitet = istAbgeleiteteFlaeche(area);
		if (typeSelect) {
			typeSelect.disabled = abgeleitet || !vokabularDa;
		}
		if (hinweis) {
			hinweis.hidden = !abgeleitet;
		}
	}

	// ---- Gelände: die vier Regler DIESER Fläche (V8) --------------------------------------------------
	//
	// 🔴 JE FLÄCHE, nicht je Region (Owner-Entscheid 2026-07-28). Eine Region kann mehrere Flächen
	// tragen, und zwei Gebirgsstücke derselben Region dürfen verschieden fein sein.
	//
	// 🔴 „Auto" ist kein Zierrat, sondern die Rücknahme. Ein Regler kann nicht leer sein -- ohne einen
	// ausdrücklichen Weg zurück wäre die abgeleitete Vorgabe nach dem ersten Anfassen für immer weg.
	//
	// 🔴 MAXIMUM UND DURCHSCHNITT SIND ZWEI ZAHLEN (Owner 2026-07-29). Erst beide beschreiben die FORM:
	// ein Hochplateau (Ø 3.000 / max 3.500) ist etwas anderes als zerklüftetes Vorland (Ø 800 / max 4.000).
	const TERRAIN_FIELDS = [
		{ key: "terrain_grain", element: "grain", decimals: 1 },
		{ key: "terrain_levels", element: "levels", decimals: 0 },
		{ key: "terrain_avg_height", element: "avgheight", decimals: 0 },
		{ key: "terrain_mean_height", element: "meanheight", decimals: 0 },
	];
	// Wird gesetzt, sobald der Editor einen Regler anfasst: ab dann gilt der Regler, nicht die Ableitung.
	let terrainTouched = {};

	function terrainDefaults(area) {
		// Dieselben Vorgaben, mit denen das Höhenfeld rechnet -- gelesen, nicht abgeschrieben.
		const peaks = peaksInsideArea(area);
		const heights = peaks
			.map((label) => (label.heightSchritt === null || label.heightSchritt === undefined
				? (typeof ECOSYSTEM_HEIGHT_DEFAULT === "number" ? ECOSYSTEM_HEIGHT_DEFAULT : 5000)
				: Number(label.heightSchritt)))
			.filter((value) => Number.isFinite(value) && value > 0);

		const maximum = heights.length ? Math.round(0.4 * Math.min(...heights)) : 0;

		return {
			terrain_grain: typeof ECOSYSTEM_HEIGHT_GRAIN === "number" ? ECOSYSTEM_HEIGHT_GRAIN : 3.2,
			terrain_levels: typeof ECOSYSTEM_HEIGHT_LEVELS === "number" ? ECOSYSTEM_HEIGHT_LEVELS : 3,
			terrain_avg_height: maximum,
			// 🪤 Das ist eine ANZEIGE, keine Rechnung. Ohne eingestellten Durchschnitt sucht das Feld gar
			// keine Potenz -- der Mittelwert fällt dort hin, wo er hinfällt. Wohin das ist, wurde einmal
			// gemessen (ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO); der Regler zeigt es, damit „(auto)" eine Zahl
			// hat, an der man ablesen kann, wovon man sich beim Anfassen entfernt.
			terrain_mean_height: Math.round(
				(typeof ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO === "number" ? ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO : 0.23)
				* maximum),
		};
	}

	// Der Durchschnitt kann das Maximum nicht überholen -- eine Fläche, die zum Rand hin auf null ausläuft,
	// hat im Mittel weniger als an ihrer höchsten Stelle. Der Regler bekommt seine Obergrenze deshalb vom
	// Regler darüber, statt sie fest im Markup zu tragen.
	//
	// 🪤 Es genügt NICHT, den Wert zu klemmen: `max` muss mitwandern, weil das Zahlenfeld daneben genau
	// gegen `regler.max` klemmt (siehe die Verdrahtung unten). Ohne das liesse sich dort eine 9.000
	// eintippen, während der Regler bei 3.000 steht -- zwei sichtbare Wahrheiten.
	//
	// 🔴 UND „AUTO" BLEIBT AUTO. Ein unberührter Durchschnitt FOLGT dem Maximum, statt geklemmt zu werden:
	// er ist ja gar kein eingestellter Wert, sondern die Anzeige dessen, wo der Mittelwert von selbst
	// landet. Bliebe er beim Ziehen am Maximum stehen, sähe „(auto)" nach einer Entscheidung aus, und wer
	// das Maximum halbiert, bekäme eine Auto-Anzeige, die zu nichts mehr passt.
	function syncTerrainMeanBounds() {
		const maximum = propertiesElement("avgheight");
		const mittel = propertiesElement("meanheight");
		const mittelZahl = propertiesElement("meanheight-num");
		const feld = TERRAIN_FIELDS.find((eintrag) => eintrag.key === "terrain_mean_height");
		if (!maximum || !mittel || !feld) {
			return;
		}
		const grenze = Number(maximum.value);
		if (!Number.isFinite(grenze)) {
			return;
		}
		// 💣 DEN WERT VOR DEM `max` LESEN. Ein `input[type=range]` klemmt seinen `value` SOFORT, sobald man
		// sein `max` senkt -- die Prüfung „steht der Durchschnitt über der neuen Grenze?" wäre danach immer
		// falsch, weil der Browser ihn längst heruntergezogen hat. Genau so ging es schief: der Regler
		// zeigte die geklemmte Zahl, die Vorschau rechnete weiter mit der alten, und zu sehen war das
		// nirgends -- die Oberfläche sah in jedem Zwischenschritt richtig aus. Vom Prüfaufbau gefangen.
		const vorher = Number(mittel.value);
		mittel.max = String(grenze);
		if (mittelZahl) {
			mittelZahl.max = String(grenze);
		}

		const anteil = typeof ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO === "number" ? ECOSYSTEM_HEIGHT_NOISE_MEAN_RATIO : 0.23;
		if (!terrainTouched.terrain_mean_height) {
			mittel.value = String(Math.round(anteil * grenze));
		} else if (vorher > grenze) {
			mittel.value = String(grenze);
			// Ein Klemmen ist eine Wertänderung wie jede andere -- die Vorschau muss davon wissen, sonst
			// zeigt sie ein Gelände, dessen Ø über seinem eigenen Maximum liegt.
			const area = currentPropertiesArea();
			if (area) {
				area.terrain_mean_height = Number(mittel.value);
			}
		}
		syncTerrainOutput(feld, currentPropertiesArea());
	}

	function renderTerrainControls(area) {
		const block = propertiesElement("terrain");
		if (!block) {
			return;
		}
		// Nur wo ein Höhenfeld entsteht. Eine Küstenfläche hat keine Körnung, und drei tote Regler
		// daran wären eine Behauptung über eine Wirkung, die es nicht gibt.
		const zeigt = String(area?.kind || "") === "topographie" && String(area?.region_type || "") === "gebirge";
		block.hidden = !zeigt;
		if (!zeigt) {
			return;
		}

		terrainTouched = {};
		const vorgabe = terrainDefaults(area);
		TERRAIN_FIELDS.forEach((feld) => {
			const regler = propertiesElement(feld.element);
			if (!regler) {
				return;
			}
			const gesetzt = area?.[feld.key];
			terrainTouched[feld.key] = gesetzt !== null && gesetzt !== undefined;
			regler.value = String(terrainTouched[feld.key] ? gesetzt : vorgabe[feld.key]);
			syncTerrainOutput(feld, area);
		});
		// Zum Schluss, wenn beide Höhenregler stehen: die Obergrenze des Durchschnitts hängt am Maximum.
		syncTerrainMeanBounds();
		setTerrainStatus("");
	}

	// Die Anzeige sagt AUSDRÜCKLICH, ob der Wert eingestellt oder abgeleitet ist. Ohne das sähe eine
	// Automatik aus wie eine Entscheidung, und niemand wüsste, was ein Speichern festschreibt.
	// 🪤 SCHREIBT NIE IN DAS FELD, IN DEM GERADE GETIPPT WIRD. Der Vergleich „nur wenn der Wert sich
	// unterscheidet" stand hier von Anfang an und sollte genau das verhindern -- er griff nur nicht: der
	// getippte Wert läuft über den Regler daneben, und ein `input[type=range]` RUNDET seinen `value`
	// sofort auf seine Schrittweite (bei den beiden Höhen 50). Der Rückweg unterscheidet sich damit fast
	// immer, und das Feld wurde nach JEDEM Anschlag überschrieben: getipptes „3500" endete als „000",
	// die Höhe liess sich nur noch mit den Pfeiltasten stellen (Fall #65, an der Live-Seite nachgestellt --
	// die Pfeiltasten treffen die Schrittweite immer, deshalb fiel es nur beim Tippen auf).
	// Die Schrittweite ist erst beim VERLASSEN des Feldes fällig, nicht zwischen zwei Ziffern; das
	// erledigt der blur-Handler in der Verdrahtung unten.
	function syncTerrainOutput(feld, area) {
		const regler = propertiesElement(feld.element);
		const feldnummer = propertiesElement(feld.element + "-num");
		const vermerk = propertiesElement(feld.element + "-out");
		if (!regler) {
			return;
		}
		const zahl = Number(regler.value).toFixed(feld.decimals);
		if (feldnummer && feldnummer !== document.activeElement && Number(feldnummer.value) !== Number(zahl)) {
			feldnummer.value = zahl;
		}
		// 🔴 KEIN „(auto)"-VERMERK MEHR (Owner 2026-07-29: „kannst du dieses autofeld einfach weglassen").
		// Er sass in einer eigenen Rasterspalte, die ohne Text auf 0 zusammenfiel -- und liess damit den
		// Regler beim ersten Anfassen um genau seine Breite aufspringen. Ihn zu reservieren statt zu
		// löschen hätte den Sprung geheilt, der Owner wollte die Spalte aber ganz weg.
		// Ob ein Wert abgeleitet ist, sagt weiterhin „Auf Automatik zurück"; die Unterscheidung lebt in
		// `terrainTouched` und entscheidet beim Speichern über NULL, das hängt nicht an der Anzeige.
	}

	function setTerrainStatus(message, isError) {
		const status = propertiesElement("terrain-status");
		if (!status) {
			return;
		}
		status.textContent = String(message || "");
		status.hidden = String(message || "") === "";
		status.classList.toggle("ecosystem-properties-dialog__error", Boolean(isError));
	}

	// 💣 Gedrosselt über requestAnimationFrame. Ein Regler feuert `input` bei jeder Mausbewegung --
	// dutzende Male je Sekunde --, und ein Neubau kostet rund 4 ms plus 25-35 ms Zeichnen. Ungedrosselt
	// staute sich das zu einem zähen Regler, der dem Zeiger hinterherläuft.
	let previewFrame = 0;
	function schedulePreviewRedraw() {
		if (previewFrame) {
			return;
		}
		previewFrame = window.requestAnimationFrame(() => {
			previewFrame = 0;
			window.AvesmapsEcosystemHeightRender?.invalidate?.();
			window.AvesmapsEcosystemHeightRender?.redraw?.();
		});
	}

	// 🔴 Die Art wählt die Geländevorgabe mit (Owner 2026-07-28). Wer im Auswahlfeld „Gebirge" wählt,
	// bekommt Werte, die für ein Gebirge passen, statt bei irgendetwas anzufangen.
	//
	// Die Zahlen stehen in `ecosystem_region_type` und reisen mit `list_regions` mit -- nicht in einer
	// Liste hier. Eine neue Art bekommt ihre Vorgabe damit ohne Entwickler, so wie die Art selbst.
	//
	// 🪤 Es SETZT die Regler, es speichert nicht. Der Editor sieht sofort, was die Art vorschlägt, kann
	// nachjustieren und entscheidet mit „Gelände speichern". Und es gilt als Berührung -- die Werte
	// stehen ab jetzt als Entscheidung da, nicht als Ableitung.
	function applyTerrainPresetForType() {
		const wahl = String(propertiesElement("type")?.value || "");
		const art = regionTypesForKind.find((type) => String(type.type_key) === wahl);
		if (!art) {
			return;
		}
		// Eine Art ohne Vorgabe (Wasser etwa) schlägt nichts vor, statt etwas zu erfinden.
		let angewandt = false;
		TERRAIN_FIELDS.forEach((feld) => {
			const wert = art[feld.key];
			const regler = propertiesElement(feld.element);
			if (wert === null || wert === undefined || !regler) {
				return;
			}
			regler.value = String(wert);
			terrainTouched[feld.key] = true;
			syncTerrainOutput(feld, currentPropertiesArea());
			const area = currentPropertiesArea();
			if (area) {
				area[feld.key] = Number(wert);
			}
			angewandt = true;
		});
		if (angewandt) {
			// Eine Art kann eine Maximalhöhe vorgeben, ohne einen Durchschnitt zu nennen -- dann muss der
			// Durchschnitt der neuen Obergrenze folgen, statt auf der Zahl der vorigen Art stehenzubleiben.
			syncTerrainMeanBounds();
			schedulePreviewRedraw();
			setTerrainStatus("Vorgabe der Art übernommen — noch nicht gespeichert.", false);
		}
	}

	async function saveTerrainSettings(reset) {
		const area = currentPropertiesArea();
		if (!area || typeof postEcosystemEdit !== "function") {
			return;
		}
		const payload = { public_id: String(area.public_id || "") };
		TERRAIN_FIELDS.forEach((feld) => {
			// 🔴 Leerer String = NULL = „ableiten". Der Server unterscheidet das von einer 0, und ein
			// unberührter Regler darf nie als Entscheidung durchgehen.
			payload[feld.key] = reset || !terrainTouched[feld.key]
				? ""
				: String(propertiesElement(feld.element)?.value || "");
		});

		setTerrainStatus("Wird gespeichert …", false);
		try {
			const ergebnis = await postEcosystemEdit("update_area_terrain", payload);
			TERRAIN_FIELDS.forEach((feld) => {
				area[feld.key] = ergebnis?.[feld.key] ?? null;
			});
			renderTerrainControls(area);
			setTerrainStatus(reset ? "Zurück auf Automatik." : "Gelände gespeichert.", false);
			// Das Feld dieser Fläche ist veraltet -- dieselbe Kante wie bei einer Gipfeländerung.
			if (window.AvesmapsEcosystemHeightRender?.invalidate) {
				window.AvesmapsEcosystemHeightRender.invalidate();
				window.AvesmapsEcosystemHeightRender.redraw();
			}
		} catch (error) {
			setTerrainStatus(error?.message || "Das Gelände konnte nicht gespeichert werden.", true);
		}
	}

	// ---- Gipfel in dieser Fläche (V8) -----------------------------------------------------------------
	//
	// 🔴 EIN OBJEKT, ZWEI ANSICHTEN. Der Gipfel ist eine map_features-Zeile. Diese Liste REFERENZIERT sie
	// und speichert nichts eigenes -- es gibt keine zweite Positionsliste und deshalb nichts zu
	// synchronisieren (oekosystem-editor-leitfaden.md §1.4). Der Label-Dialog schreibt dieselbe Zeile.
	//
	// 🪤 Die Höhe wohnt am LABEL, nicht an der Fläche. Wer sie an `ecosystem_area` hängen will, baut die
	// zweite Wahrheit: derselbe Gipfel liegt beim Überlappen in zwei Flächen und hätte dann zwei Höhen.
	function peaksInsideArea(area) {
		const geometry = area?.geometry_geojson || area?.geometry || null;
		if (!geometry || typeof labelData === "undefined" || !Array.isArray(labelData)
			|| typeof pointInGeometry !== "function") {
			return [];
		}
		// bbox-Vorfilter vor dem teuren Test -- die Fläche bringt ihre bbox schon mit. 💣 snake_case,
		// wie das `bounds`-Feld der API; als {minX, …} gelesen ergäbe das lautlos NaN und damit eine
		// Liste, die immer leer bleibt.
		const bounds = area?.bounds || null;
		const inBounds = (x, y) => !bounds
			|| (x >= Number(bounds.min_x) && x <= Number(bounds.max_x)
				&& y >= Number(bounds.min_y) && y <= Number(bounds.max_y));

		return labelData.filter((label) => {
			if (typeof isEcosystemPeakSubtype !== "function" || !isEcosystemPeakSubtype(label.labelType)) {
				return false;
			}
			// 💣 Labels tragen [lat, lng] = [y, x] (Leaflet L.CRS.Simple), GeoJSON will [x, y].
			// Bewusst tauschen (AGENTS.md §5) -- ungetauscht liegt jeder Gipfel irgendwo im Nichts.
			const y = Number(label.coordinates?.[0]);
			const x = Number(label.coordinates?.[1]);

			return Number.isFinite(x) && Number.isFinite(y) && inBounds(x, y) && pointInGeometry([x, y], geometry);
		});
	}

	function setPeakRowStatus(row, message, isError) {
		const status = row?.querySelector(".ecosystem-properties-dialog__status");
		if (!status) {
			return;
		}
		status.textContent = String(message || "");
		status.hidden = String(message || "") === "";
		status.classList.toggle("ecosystem-properties-dialog__error", Boolean(isError));
	}

	// Nur bei der Topographie. Ein Gipfel in einer Bedeckungsfläche bewirkt nichts -- ihn dort zum
	// Bearbeiten anzubieten behauptete eine Wirkung, die es nicht gibt (Leitfaden §1.4).
	function renderEcosystemPeakRows(area) {
		const block = propertiesElement("peaks");
		const list = propertiesElement("peaks-list");
		if (!block || !list) {
			return;
		}
		if (String(area?.kind || "") !== "topographie") {
			block.hidden = true;
			list.innerHTML = "";
			return;
		}

		const peaks = peaksInsideArea(area);
		block.hidden = false;
		if (peaks.length === 0) {
			// Ein leerer Zustand, der sagt was zu tun ist -- nicht bloss "keine Einträge".
			list.innerHTML = '<p class="ecosystem-properties-dialog__areas">Kein Gipfel in dieser Fläche.'
				+ ' Über „Höhenpunkt setzen" im Kartenmenü entsteht einer.</p>';
			return;
		}

		// 🔴 EIN Raster für die ganze Liste, die Zeilen tragen `display: contents` -- so stehen Name,
		// Feld und Knopf über alle Zeilen hinweg in denselben Spalten. Vorher hing jede Zeile in der
		// Suchfeld-Klasse (zwei Spalten, gebaut für „Feld + Knopf"), und meine VIER Elemente brachen
		// daraus aus: der Knopf rutschte auf eine eigene Zeile, das Feld wurde schmal und die
		// Statuszeile war praktisch unsichtbar. Vom Owner gemeldet 2026-07-28.
		//
		// 💣 `display: contents` an der Zeile ändert nichts am DOM: `data-peak-id`, `closest()` und
		// `querySelector` arbeiten unverändert -- nur die Rasterzellen kommen aus der Liste.
		const defaultHeight = typeof ECOSYSTEM_HEIGHT_DEFAULT === "number" ? ECOSYSTEM_HEIGHT_DEFAULT : 5000;
		list.innerHTML = peaks.map((label) => {
			const height = label.heightSchritt === null || label.heightSchritt === undefined ? "" : String(label.heightSchritt);
			// 💣 Der Name ist KEIN Schlüssel -- „Horndrachenfels" liegt im Bestand zweimal. Die Zeile
			// hängt an public_id, angezeigt wird nur der Name.
			return '<div class="ecosystem-properties-dialog__peakrow" data-peak-id="' + escapeAttr(label.publicId) + '">'
				+ '<span class="ecosystem-properties-dialog__peakname" title="' + escapeAttr(label.text || "") + '">'
				+ escapeText(label.text || "(ohne Namen)") + '</span>'
				// Der Platzhalter zeigt die Vorgabe, mit der die Karte ohnehin rechnet -- nicht „nicht
				// erfasst", was zwar richtig war, aber im schmalen Feld als „nicht erf" ankam.
				+ '<input type="number" min="0" max="20000" step="1" inputmode="numeric"'
				+ ' placeholder="' + defaultHeight + '" title="Höhe in Schritt. Leer = Vorgabe ' + defaultHeight + '."'
				+ ' aria-label="Höhe in Schritt" value="' + escapeAttr(height) + '" />'
				+ '<button type="button" class="ecosystem-properties-dialog__button" data-peak-save="1">Speichern</button>'
				+ '<p class="ecosystem-properties-dialog__status ecosystem-properties-dialog__peakstatus" role="status" hidden></p>'
				+ '</div>';
		}).join("");
	}

	// ---- Die Höhenskala (Fall #79) ------------------------------------------------------------------
	//
	// Entwurf: docs/superpowers/specs/2026-08-18-hoehenskala-legende-design.md
	//
	// 🔴 SIE LIEST DEN WEISSPUNKT AUS DEM ZEICHNER, sie rechnet ihn nie nach. Er entsteht in
	// map-features-ecosystem-height-render.js:298 aus dem Stapel ALLER geladenen Gebirgsflächen und
	// wandert deshalb mit dem Bildausschnitt (live gemessen 18.08.2026: derselbe Eisenwald hat mit dem
	// Raschtulswall im Bild den hellsten Pixel 55, allein im Bild 235). Eine zweite Rechnung hier wäre
	// eine zweite Wahrheit.
	let hoehenskalaAbo = null;
	// Deckel für das Nachfassen bei Breite 0 (siehe renderEcosystemHeightScale).
	let hoehenskalaNachfassen = 0;

	// Nur die Gebirge: `topographyAreas()` im Zeichner filtert genau so, und nur dort entsteht
	// überhaupt ein Höhenfeld. Für alles andere gäbe es keinen Grauton zu erklären.
	function hatHoehenfeld(area) {
		return String(area?.kind || "") === "topographie" && String(area?.region_type || "") === "gebirge";
	}

	function renderEcosystemHeightScale(area) {
		const block = propertiesElement("heightscale");
		const bar = propertiesElement("scale-bar");
		const ticks = propertiesElement("scale-ticks");
		const note = propertiesElement("scale-note");
		if (!block || !bar || !ticks || !note) {
			return;
		}

		const weisspunkt = Number(window.AvesmapsEcosystemHeightRender?.whitePoint?.() || 0);
		// 🪤 `0` heisst „gerade wird nichts gemalt" -- kein Dialog, leerer Stapel, Karte ohne Ausdehnung.
		// Eine Skala zu einem Bild, das nicht auf der Karte liegt, erklärt nichts und behauptet viel.
		if (!hatHoehenfeld(area) || !(weisspunkt > 0)) {
			block.hidden = true;
			bar.replaceChildren();
			return;
		}

		// 💣 ERST SICHTBAR MACHEN, DANN MESSEN -- in dieser Reihenfolge, und das ist keine Kosmetik:
		// solange der Block `hidden` ist, ist SEIN Balken 0 px breit. Wer vorher misst, verschiebt sich
		// per rAF auf ein Bild, in dem der Block immer noch verborgen ist, misst wieder 0 und dreht sich
		// im Kreis -- die Skala erschien nie. Im Browser gefunden (18.08.2026), von keiner Textprüfung.
		block.hidden = false;

		// Auch jetzt kann die Breite noch 0 sein: der erste Aufbau läuft vor `overlayElement.hidden =
		// false`, und ein verborgenes OVERLAY misst genauso wenig. Dann EIN Bild später nachfassen --
		// aber gezählt, sonst bliebe eine Fläche in einem nie sichtbaren Dialog ewig im rAF-Karussell.
		const breite = bar.getBoundingClientRect().width;
		if (!(breite > 0)) {
			if (hoehenskalaNachfassen < 30) {
				hoehenskalaNachfassen++;
				window.requestAnimationFrame(() => renderEcosystemHeightScale(currentPropertiesArea()));
			}
			return;
		}
		hoehenskalaNachfassen = 0;

		const gipfel = peaksInsideArea(area).map((label) => ({
			name: String(label.text || "").trim() || "(ohne Namen)",
			hoehe: label.heightSchritt,
		}));
		const skala = avesmapsHoehenskala(gipfel, weisspunkt, breite);

		bar.replaceChildren();
		// Erst die Marken, dann die Beschriftungen -- so liegt kein Text unter einem Dreieck.
		skala.marken.forEach((marke) => {
			const zeichen = document.createElement("span");
			zeichen.className = "ecosystem-properties-dialog__scalemark"
				+ (marke.gruppe ? " ecosystem-properties-dialog__scalemark--gruppe" : "");
			zeichen.style.right = (100 - marke.prozent) + "%";
			zeichen.title = marke.namen.join("\n");
			bar.appendChild(zeichen);
		});
		skala.beschriftungen.forEach((zeile) => {
			const halter = document.createElement("span");
			halter.className = "ecosystem-properties-dialog__scalename";
			halter.title = zeile.titel;
			const name = document.createElement("em");
			name.textContent = zeile.name;
			const zahl = document.createElement("b");
			zahl.textContent = zeile.zahl;
			halter.append(name, zahl);
			halter.style.right = (100 - zeile.prozent) + "%";
			halter.dataset.prozent = String(zeile.prozent);
			bar.appendChild(halter);
		});

		// 🔴 GEKÜRZT WIRD DER NAME, NIE DIE HÖHE -- und wie viel Platz bleibt, hängt an der GEMESSENEN
		// Breite der Zahl. Deshalb ein zweiter Durchgang: schätzen liesse „11.000" in einer Schrift, die
		// wir nicht kontrollieren, irgendwann doch überlaufen.
		bar.querySelectorAll(".ecosystem-properties-dialog__scalename").forEach((halter) => {
			const zahl = halter.querySelector("b");
			const prozent = Number(halter.dataset.prozent) || 0;
			const platz = avesmapsHoehenskalaNamensbreite(prozent, breite, zahl.getBoundingClientRect().width);
			halter.style.setProperty("--namebreite", platz.breitePx + "px");
			if (platz.gekippt) {
				halter.classList.add("ecosystem-properties-dialog__scalename--gekippt");
				halter.style.right = "";
				halter.style.left = prozent + "%";
			}
		});

		ticks.replaceChildren();
		skala.achse.forEach((wert) => {
			const marke = document.createElement("span");
			marke.textContent = wert.text;
			// Die äusseren beiden bündig, die inneren mittig -- sonst hängen sie über den Balkenenden.
			if (wert.prozent === 0) {
				marke.style.left = "0";
			} else if (wert.prozent === 100) {
				marke.style.right = "0";
			} else {
				marke.style.left = wert.prozent + "%";
				marke.style.transform = "translateX(-50%)";
			}
			ticks.appendChild(marke);
		});

		note.replaceChildren();
		note.append(document.createTextNode("Werte in Schritt. "));
		const stark = document.createElement("b");
		stark.textContent = "Weiß = " + avesmapsHoehenskalaZahl(weisspunkt);
		note.append(stark, document.createTextNode(
			" — der höchste Gipfel im Bildausschnitt. Was höher liegt, wird nicht heller."));
	}

	// Der Zeichner meldet jeden Anstrich; die Skala hängt sich EINMAL dran. Ohne das bliebe sie beim
	// Zoomen stehen und behauptete einen Weisspunkt, der nicht mehr gilt -- und genau das Wandern ist
	// der Grund, warum es sie gibt.
	function abonniereHoehenskala() {
		if (hoehenskalaAbo || typeof window.AvesmapsEcosystemHeightRender?.onPaint !== "function") {
			return;                          // der Zeichner richtet sich verzögert ein -- nächstes Öffnen erneut
		}
		hoehenskalaAbo = window.AvesmapsEcosystemHeightRender.onPaint(() => {
			const area = currentPropertiesArea();
			if (area) {
				renderEcosystemHeightScale(area);
			}
		});
	}

	// 💣 `update_label` setzt Größe, Drehung, Zoom-Band und Priorität BEDINGUNGSLOS aus dem Payload
	// (features.php:2244-2249). Nur die Höhe zu schicken warf das Label auf Standardwerte zurück --
	// deshalb reist hier derselbe volle Darstellungssatz mit wie beim Umbenennen (:549). Der Schutz
	// per array_key_exists gilt für die HÖHE, nicht für die Darstellung.
	async function saveEcosystemPeakHeight(row) {
		const labelPublicId = String(row?.dataset?.peakId || "");
		const input = row?.querySelector("input[type=number]");
		if (!labelPublicId || !input || typeof submitMapFeatureEdit !== "function") {
			return;
		}
		const entry = typeof findLabelEntryByPublicId === "function" ? findLabelEntryByPublicId(labelPublicId) : null;
		const label = entry?.label || null;
		if (!label) {
			setPeakRowStatus(row, "Dieser Gipfel ist nicht mehr geladen.", true);
			return;
		}

		const raw = String(input.value || "").trim();
		setPeakRowStatus(row, "Wird gespeichert …", false);
		try {
			const result = await submitMapFeatureEdit({
				action: "update_label",
				public_id: labelPublicId,
				text: label.text || "",
				feature_subtype: String(label.labelType || "berggipfel"),
				// 🔴 KEIN Darstellungssatz. Seit der Server ihn nur noch schreibt, wenn er mitkommt
				// (features.php), ändert dieser Aufruf genau eine Eigenschaft -- die Höhe. Vorher musste
				// er Größe, Drehung, Zoom-Band und Priorität mitschleppen, nur um sie nicht zu verlieren.
				//
				// 🔴 UND KEIN OPTIMISTISCHER RIEGEL. `expected_revision: null` schaltet ihn ab, und das
				// ist hier richtig statt bequem: der Riegel schützt davor, dass zwei Editoren einander
				// überschreiben -- dieser Aufruf schreibt aber nur ein Feld, das es vorher nirgends gab,
				// und lässt jedes andere unangetastet. Es gibt nichts zu überschreiben.
				//
				// 💣 Ohne das scheiterte JEDE Höhe mit 409: der Riegel verlangt die Revision aus der
				// ~21 MB grossen Kartennutzlast, und die ist nach der ersten fremden Labeländerung alt.
				// Am 2026-07-28 im eingeloggten Browser gemessen -- mitgeschickt 16069, Antwort 409.
				expected_revision: null,
				height_schritt: raw === "" ? null : raw,
			});
			if (typeof applyLabelFeatureLocally === "function" && result?.feature) {
				applyLabelFeatureLocally(result.feature);
			}
			setPeakRowStatus(row, raw === "" ? "Höhe entfernt." : "Höhe gespeichert.", false);
			// Die Fläche muss neu gerechnet werden -- dieselbe begrenzte Nachlaufkante wie bei einer
			// geänderten Geometrie, nur mit dem Label als Auslöser (Leitfaden §1.4).
			if (typeof invalidateEcosystemHeightForPeak === "function") {
				invalidateEcosystemHeightForPeak(label);
			}
			// 💣 DIE SKALA MUSS HIER AUSDRÜCKLICH NACHZIEHEN. Sie hängt sonst am Melder des Zeichners,
			// und der feuert nur, wenn sich der WEISSPUNKT ändert -- eine Gipfelhöhe von 5.000 auf 4.000
			// zu senken lässt ihn unberührt, solange ein höherer Gipfel im Bild steht. Die Marke stünde
			// dann weiter bei 5.000, neben einem Balken, der es besser weiss.
			renderEcosystemHeightScale(currentPropertiesArea());
		} catch (error) {
			// 💣 409 IST HIER DER NORMALFALL, nicht die Ausnahme. Am 2026-07-28 im eingeloggten Browser
			// gemessen: der Client schickt die Revision aus SEINER Kartennutzlast (16069), die Zeile in
			// der Datenbank steht längst weiter -- jede Höhenspeicherung scheiterte, nicht nur manche.
			//
			// Die Nutzlast ist ~21 MB und wird lange gehalten; jede fremde Labeländerung seither macht
			// die gemerkte Revision alt. `submitMapFeatureEdit` stösst bei 409 bereits
			// `pollLiveMapUpdates()` an (api-client.js:113) -- die frischen Daten kommen also, nur zu
			// spät für DIESEN Versuch. Also einmal nachfassen, wenn sie da sind.
			//
			// 🔴 GENAU EIN Nachfassen, und nur bei einem Konflikt. Eine Schleife machte aus dem
			// Sicherheitsnetz gegen zwei gleichzeitige Editoren ein Überschreiben mit Anlauf.
			const istKonflikt = /409|inzwischen ge/i.test(String(error?.message || ""));
			if (istKonflikt && !row.dataset.peakRetried) {
				row.dataset.peakRetried = "1";
				setPeakRowStatus(row, "Stand war veraltet — versuche erneut …", false);
				await new Promise((wait) => window.setTimeout(wait, 600));
				delete row.dataset.peakRetried;
				return saveEcosystemPeakHeight(row);
			}
			setPeakRowStatus(row, error?.message || "Die Höhe konnte nicht gespeichert werden.", true);
		}
	}

	// 🔴 Name UND Art der Fläche schlagen auf ALLE ihre Labels durch (Owner 2026-07-28). Seit eine Fläche
	// mehrere Beschriftungen tragen darf, reicht es nicht, das primäre nachzuziehen: wer den Finsterkamm
	// zum Wald macht, will nicht ein Wald-Label im Norden und ein Gebirgs-Label im Süden -- und wer sie
	// umbenennt, erst recht nicht zwei verschiedene Namen für dieselbe Fläche.
	//
	// 🪤 Nur Text und SUBTYP, nicht die Darstellung. Größe, Drehung und Zoom-Band gehören jedem Label selbst --
	// ein zweites Label ist ja gerade deshalb da, weil es anders stehen soll. Deshalb reisen hier die
	// eigenen Werte des jeweiligen Labels mit, nicht die des ersten.
	async function applyRegionToLabels(area, name, subtype, exceptPublicId) {
		const regionPublicId = String(area?.region_public_id || "");
		if (regionPublicId === "" || typeof labelData === "undefined" || !Array.isArray(labelData)
			|| typeof submitMapFeatureEdit !== "function" || typeof ecosystemRegionOfLabel !== "function") {
			return;
		}

		const betroffen = labelData.filter((label) => String(label.publicId || "") !== String(exceptPublicId || "")
			&& String(ecosystemRegionOfLabel(label)?.public_id || "") === regionPublicId
			&& (String(label.labelType || "") !== String(subtype) || String(label.text || "") !== String(name)));

		for (const label of betroffen) {
			try {
				const ergebnis = await submitMapFeatureEdit({
					action: "update_label",
					public_id: label.publicId,
					text: name,
					show_name: label.showName !== false,
					feature_subtype: subtype,
					size: Number(label.size) || 18,
					rotation: Number(label.rotation) || 0,
					min_zoom: Number(label.minZoom) || 0,
					max_zoom: Number(label.maxZoom) || 7,
					priority: Number(label.priority) || 3,
					is_nodix: Boolean(label.isNodix),
					lat: label.coordinates?.[0],
					lng: label.coordinates?.[1],
				});
				if (typeof applyLabelFeatureLocally === "function" && ergebnis?.feature) {
					applyLabelFeatureLocally(ergebnis.feature);
				}
			} catch (error) {
				console.warn("Ein weiteres Label der Region konnte die neue Art nicht übernehmen:", error);
			}
		}
	}

	async function renameLinkedEcosystemLabel(area, name) {
		const labelPublicId = String(area?.label_public_id || "");

		// Zeiger und Label sind ZWEI Fragen: die Region kann auf ein Label zeigen, das es nicht mehr gibt.
		const entry = labelPublicId && typeof findLabelEntryByPublicId === "function"
			? findLabelEntryByPublicId(labelPublicId)
			: null;
		const label = entry?.label || null;

		// 🔴 Kein Label da, aber „Regionname anzeigen" angehakt -> jetzt eines anlegen, am Point of
		// Inaccessibility und im Stil seiner Art. Das ist der Weg, auf dem die neun von Hand gezeichneten
		// Bestandsflächen ihr Label bekommen: beiläufig, wo jemand die Region ohnehin bearbeitet, statt
		// als Serienlauf über einen Bestand, der zu 124 von 133 längst versorgt ist.
		//
		// 💣 „Kein Label" heisst NICHT „kein Zeiger" (Owner 2026-07-27). Wer ein Label von Hand löscht,
		// lässt den label_public_id der Region verwaist zurück -- der Haken geht danach richtigerweise
		// aus, aber Wiederanhaken lief vorher in genau diese Stelle und stieg stumm aus: der Zeiger war
		// gesetzt, also wurde nicht angelegt, und zu ihm gab es nichts mehr zu ändern. Also entscheidet
		// hier das LABEL, nicht der Zeiger. Repariert wird der Zeiger dabei von selbst, weil
		// createEcosystemRegionLabel ihn per update_region auf das neue Label umschreibt.
		// 💣 Kein PRIMÄRES Label heisst nicht: gar keines. Seit eine Fläche mehrere tragen darf, kann ihr
		// einziges über den eigenen Rückzeiger hängen (ein Klon zum Beispiel) und der Zeiger an der Region
		// leer sein. Hier blind anzulegen setzte ihr ein zweites, gleichnamiges obendrauf -- den Namen
		// bekommt es ohnehin gleich von applyRegionToLabels.
		const hatIrgendeinLabel = typeof labelData !== "undefined" && Array.isArray(labelData)
			&& typeof ecosystemRegionOfLabel === "function"
			&& labelData.some((row) => String(ecosystemRegionOfLabel(row)?.public_id || "") === String(area?.region_public_id || "")
				&& String(area?.region_public_id || "") !== "");

		if (!label) {
			const box = propertiesElement("showname");
			if (box && box.checked && !hatIrgendeinLabel && typeof createEcosystemRegionLabel === "function") {
				const geometry = area?.geometry_geojson || area?.geometry || null;
				if (geometry) {
					await createEcosystemRegionLabel(
						String(area.region_public_id || ""),
						geometry,
						name,
						true,
						String(propertiesElement("type")?.value || ""),
						// Die Wiki-Landschaft der Region kommt mit: das Label beschreibt dieselbe.
						await currentRegionWikiSnapshot()
					);
				}
			}
			return;
		}

		if (typeof submitMapFeatureEdit !== "function") {
			return;
		}
		const box = propertiesElement("showname");
		const showName = box && !box.disabled ? Boolean(box.checked) : (label.showName !== false);
		const nodixBox = propertiesElement("nodix");
		const nextNodix = nodixBox && !nodixBox.disabled ? Boolean(nodixBox.checked) : Boolean(label.isNodix);
		const nextSubtype = String(propertiesElement("type")?.value || "") || label.labelType || "region";

		// 🔴 Die Wiki-Landschaft wandert NUR abwärts. Hat die Region eine, bekommt das Label sie -- es
		// beschreibt dieselbe Landschaft, und zwei Zuweisungen für dasselbe Ding driften auseinander.
		// 💣 Hat die Region KEINE, bleibt das Label unangetastet. Andersherum löschte jedes Speichern
		// einer wiki-losen Region genau die Zuweisung, die V6c „Label zuweisen" von Hand gesetzt hat.
		const regionWikiKey = String(effectiveWikiRegion()?.wiki_key || "").trim();
		const wikiNeedsPush = regionWikiKey !== "" && regionWikiKey !== String(label.wikiRegion?.wiki_key || "");

		if (String(label.text || "") === String(name)
			&& showName === (label.showName !== false)
			&& nextNodix === Boolean(label.isNodix)
			&& !wikiNeedsPush
			&& nextSubtype === String(label.labelType || "")) {
			return;                                  // Name, Anzeige, Nodix, Wiki und Art unverändert
		}
		const wikiSnapshot = wikiNeedsPush ? await currentRegionWikiSnapshot() : null;

		// 🔴 Der Subtyp des Labels folgt der ART der Region -- ein Wald soll auch wie ein Waldlabel
		// aussehen. Und NUR wenn er sich dabei wirklich ändert, kommt die Darstellung dieser Art mit
		// (Größe, Ab-Zoom, gemessen am Bestand). Sonst behält das Label, was der Editor eingestellt hat:
		// ein blosses Umbenennen darf keine Handarbeit zurücksetzen.
		const subtype = String(propertiesElement("type")?.value || "") || label.labelType || "region";
		const typeChanged = subtype !== String(label.labelType || "");
		const style = typeof ecosystemLabelStyleFor === "function" ? ecosystemLabelStyleFor(subtype) : null;

		try {
			const ergebnis = await submitMapFeatureEdit({
				action: "update_label",
				public_id: labelPublicId,
				text: name,
				show_name: showName,
				feature_subtype: subtype,
				size: typeChanged && style ? style.size : (Number(label.size) || 18),
				rotation: Number(label.rotation) || 0,
				min_zoom: typeChanged && style ? style.minZoom : (Number(label.minZoom) || 2),
				max_zoom: Number(label.maxZoom) || 7,
				priority: Number(label.priority) || 3,
				is_nodix: nextNodix,
				// Nur wenn die Region wirklich eine trägt (siehe wikiNeedsPush) -- ein leeres wiki_region
				// würde die Zuweisung des Labels löschen statt sie zu erben.
				...(wikiSnapshot ? { wiki_region: wikiSnapshot } : {}),
				lat: entry.marker?.getLatLng?.().lat,
				lng: entry.marker?.getLatLng?.().lng,
			});
			// Sofort auf der Karte, statt bis zum nächsten Live-Sync-Poll den alten Namen stehen zu lassen.
			if (typeof applyLabelFeatureLocally === "function" && ergebnis?.feature) {
				applyLabelFeatureLocally(ergebnis.feature);
			}
		} catch (error) {
			console.warn("Das Label der Region konnte nicht umbenannt werden:", error);
			setPropertiesStatus("Gespeichert — das Karten-Label trägt aber noch den alten Namen.");
		}
	}

	// ---- speichern und löschen ------------------------------------------------------------------------

	async function submitEcosystemPropertiesDialog(event) {
		event?.preventDefault();
		const area = currentPropertiesArea();
		if (propertiesBusy || !area) {
			return;
		}
		// 🔴 KEIN eigener Geländeknopf mehr (Owner 2026-07-28): „ich will kein extra button ‚Gelände
		// speichern' sondern, dass das gelände gespeichert wird, wenn ich unten auf ‚Speichern' klick."
		//
		// 🪤 VOR den Regionsfeldern, und nur wenn wirklich an einem Regler gedreht wurde. Die Reihenfolge
		// ist bewusst: das Gelände hängt an der FLÄCHE und eigener Aktion, die Felder darunter an der
		// REGION -- scheitert das Gelände, sagt seine eigene Statuszeile das, und der Rest läuft weiter,
		// statt eine halb gespeicherte Fläche zu hinterlassen.
		if (TERRAIN_FIELDS.some((feld) => terrainTouched[feld.key])) {
			await saveTerrainSettings(false);
		}

		const name = String(propertiesElement("name")?.value || "").trim();
		if (name === "") {
			setPropertiesError("Bitte einen Namen eingeben.");
			propertiesElement("name")?.focus();
			return;
		}

		const payload = {
			public_id: area.region_public_id,
			name,
			region_type: String(propertiesElement("type")?.value || ""),
		};
		// Die Klick-Sperre (19.08.2026). Sie geht über DIESE Speicherleiste und nicht über einen
		// eigenen Aufruf daneben: der Dialog schreibt Name, Anzeige, Nodix und Art ohnehin in einem
		// Zug, und ein zweiter Aufruf machte „Abbrechen" für einen der beiden Werte wirkungslos.
		// Die Kurvenbeschriftung -- ueber DIESE Speicherleiste, aus demselben Grund wie die
		// Klick-Sperre darunter. 💣 Nur wenn angefasst (Entwurf §2).
		const kurve = getPropertiesCurvePayload();
		if (kurve) {
			payload.curve_label = kurve.curve_label;
			payload.curve_label_max = kurve.curve_label_max;
		}
		const sperrHaken = propertiesElement("locked");
		if (sperrHaken) {
			payload.is_locked = Boolean(sperrHaken.checked);
		}
		// Nur mitschicken, wenn wirklich daran gedreht wurde: update_region schreibt ausschliesslich die
		// Felder, die IM Payload stehen (avesmapsEcosystemReadRegionFields), und ein mitgeschicktes
		// wiki_url='' würde eine bestehende Zuweisung stillschweigend löschen.
		if (pendingWikiRegion !== undefined) {
			payload.wiki_url = pendingWikiRegion?.wiki_url || "";
		}
		// 🔴 Die Merkliste reist IMMER mit, auch leer: eine leere Liste ist dasselbe wie ein fehlender
		// Schlüssel („nichts kam aus dem Wiki, also alles von uns“), und das ist die sichere Richtung
		// -- eine falsche „Wiki“-Angabe liesse einen späteren Abgleich eine Handarbeit überschreiben,
		// eine falsche „von uns“-Angabe schützt nur zu viel.
		payload.wiki_uebernommen = Array.from(wikiUebernommen);
		// 🔴 KEIN `wiki_no_article` MEHR -- gefallen am 16.08.2026 mit dem Häkchen (Owner-Entscheid).
		// 💣 TRAGBAR IST DAS, WEIL avesmapsEcosystemApplyRegionNoArticle BEIDE HÄLFTEN SCHON KANN: ein
		// FEHLENDER Schlüssel heißt „nicht geändert" (die Entscheidung des Konfliktzentrums überlebt
		// jedes Speichern), und eine ZUWEISUNG beantwortet den Merker serverseitig von selbst
		// (`if (!$gefordert && $noArticle && $effectiveWikiUrl !== '')`). Am Server war dafür keine
		// Zeile zu ändern -- gemessen, nicht angenommen.
		// ⚠️ Und der Zwilling schickt ihn ebenfalls nicht mehr (html/landschaften-editor.html): die zwei
		// gehören zusammen, aber in DIESE Richtung ist ein Alleingang harmlos -- gefährlich wäre nur,
		// einen von beiden wieder senden zu lassen (AGENTS.md §11).

		propertiesBusy = true;
		setPropertiesError("");
		setPropertiesStatus("Wird gespeichert …");
		const saveButton = propertiesElement("save");
		if (saveButton) {
			saveButton.disabled = true;
		}

		try {
			const antwort = await postEcosystemEdit("update_region", payload);
			// Dieselbe Sofort-Anwendung wie im Beschriftungsdialog (map-features-ecosystem-label-writeback.js):
			// der Kartenpayload wird nach einem Speichern nicht neu geholt, ohne das aendert sich am Bild
			// nichts.
			// 🔴 MIT DER FRISCH GERECHNETEN LINIE (Owner 24.08.2026). Hier stand: „Einschalten zeigt die
			// Kurve erst nach ‚Kurven rechnen‘" -- und das war seit dem 23.08. nur noch zur Haelfte wahr.
			// Gerechnet hat der Server beim Speichern laengst; er gab das Ergebnis blos nicht heraus.
			// Jetzt reist es mit (`curve_label_line`), und das Einschalten faellt sofort ins Bild --
			// derselbe Weg und dieselben Schluessel wie beim Menueknopf „Labelkurve aktualisieren".
			// ⚠️ `curve_label_line` fehlt, wenn der Server nicht gerechnet hat (Kurve aus, keine Flaeche).
			// Dann bleibt das vierte Argument `undefined` -- und der Anwender laesst eine vorhandene Kurve
			// stehen, statt sie wegen einer nicht gestellten Frage zu entfernen.
			if (payload.curve_label !== undefined && typeof avesmapsCurveSettingAufLabelsAnwenden === "function") {
				avesmapsCurveSettingAufLabelsAnwenden(
					String(payload.public_id || ""),
					payload.curve_label === true,
					antwort?.curve_label_max ?? payload.curve_label_max,
					antwort?.curve_label_line
				);
			}
			// ⚠️ Geleert, sobald der Stempel gesetzt ist -- sonst nennte das NÄCHSTE Speichern dieselben
			// Felder noch einmal als Wiki-Übernahme, und wer inzwischen von Hand getippt hat, bekäme
			// „aus dem Wiki“ auf seine eigene Eingabe.
			wikiUebernommen = new Set();
			// Den geladenen Bestand und den Zähler in der Leiste nachziehen. Über das Nachbarmodul,
			// damit dieser Datei kein zweiter Schreib- und Zählweg gehört.
			if (payload.is_locked !== undefined) {
				window.AvesmapsEcosystemStapel?.merkeSperre?.(area.region_public_id, payload.is_locked);
			}
			// 🔴 Das verbundene Karten-Label trägt den Namen MIT. Bis heute galt hier der Satz „wer die
			// Fläche umbenennt, benennt das Label NICHT mit um" -- richtig, solange die beiden nichts
			// voneinander wussten. Seit eine derographische Region ihr Label automatisch bekommt
			// (`label_public_id`), wären zwei Namen für dasselbe Ding schlicht ein Fehler.
			await renameLinkedEcosystemLabel(area, name);
			// Und die ÜBRIGEN Labels derselben Fläche: das primäre hat die Zeile darüber schon nachgezogen.
			await applyRegionToLabels(
				area,
				name,
				String(propertiesElement("type")?.value || "") || "region",
				String(area.label_public_id || "")
			);
			closeEcosystemPropertiesDialog();
			await refreshAfterEcosystemPropertiesWrite();
			if (typeof showFeedbackToast === "function") {
				showFeedbackToast(`Region „${name}" gespeichert.`, "success");
			}
		} catch (error) {
			setPropertiesError(error?.message || "Die Region konnte nicht gespeichert werden.");
			setPropertiesStatus("");
		} finally {
			propertiesBusy = false;
			if (saveButton) {
				saveButton.disabled = false;
			}
		}
	}

	// 🔴 Eine Region zu löschen nimmt IHRE FLÄCHEN MIT (avesmapsDeleteEcosystemRegion, eine Transaktion).
	// Deshalb nennt die Rückfrage die Zahl -- „Region löschen?" verschweigt genau das, was weh tut
	// (oekosystem-editor-verhalten.md §10).
	function formatRegionDeleteConfirmation(name, areaCount, labelCount = 0, kaskade = false) {
		const count = Number(areaCount) || 0;
		const areas = count === 1 ? "1 Fläche" : `${count} Flächen`;
		const labels = Number(labelCount) || 0;
		// 🔴 Die Labels stehen MIT drin, sobald sie wirklich mitgehen. Bis heute nannte die Rückfrage nur
		// die Flächen -- und die Labels blieben tatsächlich stehen, obwohl der Kommentar daneben das
		// Gegenteil behauptete. Ob sie mitgehen, entscheidet der Server (`cascade_enabled`), und die
		// Rückfrage sagt beides ehrlich: eine Beschriftung, die verschwindet, ohne dass jemand sie
		// genannt hat, ist dieselbe Überraschung wie eine, die angekündigt war und stehen bleibt.
		// 💣 `!== false`, nicht `kaskade`: nur ein ausdrückliches Nein vom Server darf beruhigen.
		// `null` heisst „das Flag ist nie angekommen" -- dann lieber zu viel ankündigen.
		if (kaskade !== false && labels > 0) {
			const was = `${areas} und ${labels === 1 ? "1 Label" : `${labels} Labels`}`;
			return `Region „${name}" mit ${was} löschen?\n\nAlles davon verschwindet mit — auch was gerade nicht im Bild ist.`;
		}

		const nachsatz = labels > 0
			? `\n\nDie Flächen verschwinden mit — auch die, die gerade nicht im Bild sind. ${labels === 1 ? "Das Label bleibt" : `Die ${labels} Labels bleiben`} auf der Karte stehen.`
			: "\n\nDie Flächen verschwinden mit — auch die, die gerade nicht im Bild sind.";

		return `Region „${name}" mit ${areas} löschen?${nachsatz}`;
	}

	async function requestEcosystemRegionDelete() {
		const area = currentPropertiesArea();
		if (propertiesBusy || !area) {
			return;
		}
		// Ohne belastbare Zahl wird nicht gefragt und nicht gelöscht -- siehe regionAreaCountLoaded.
		if (!regionAreaCountLoaded) {
			setPropertiesError("Die Flächenzahl steht noch nicht fest — einen Augenblick.");
			return;
		}
		const name = String(propertiesElement("name")?.value || area.region_name || "");
		const labelCount = typeof ecosystemLabelCountOfRegion === "function"
			? ecosystemLabelCountOfRegion(area.region_public_id)
			: 0;
		if (!window.confirm(formatRegionDeleteConfirmation(
			name,
			regionAreaCount,
			labelCount,
			typeof isEcosystemCascadeEnabled === "function" && isEcosystemCascadeEnabled()
		))) {
			return;
		}

		propertiesBusy = true;
		setPropertiesError("");
		setPropertiesStatus("Wird gelöscht …");
		try {
			const ergebnis = await postEcosystemEdit("delete_region", { public_id: area.region_public_id });
			// Die mitgelöschten Labels sofort von der Karte: sie kommen aus der Kartennutzlast, die
			// refreshAfterEcosystemPropertiesWrite nicht neu lädt.
			if (typeof removeEcosystemCascadedLabels === "function") {
				removeEcosystemCascadedLabels(ergebnis);
			}
			closeEcosystemPropertiesDialog();
			await refreshAfterEcosystemPropertiesWrite();
			if (typeof showFeedbackToast === "function") {
				const mitgegangen = Number(ergebnis?.labels_deleted) || 0;
				showFeedbackToast(
					mitgegangen > 0
						? `Region „${name}" gelöscht — mit ${mitgegangen === 1 ? "ihrem Label" : `ihren ${mitgegangen} Labels`}.`
						: `Region „${name}" gelöscht.`,
					"success"
				);
			}
		} catch (error) {
			setPropertiesError(error?.message || "Die Region konnte nicht gelöscht werden.");
			setPropertiesStatus("");
		} finally {
			propertiesBusy = false;
		}
	}

	// Nach jedem Schreibvorgang: Flächen neu holen (Name/Art reisen in der Flächenzeile mit), den
	// Regionen-Wähler-Cache verwerfen, und die Regionenliste im Prüfpanel nachziehen, falls sie offen ist.
	// Alles typeof-gewacht, damit dieses Modul ohne die jeweiligen Nachbarn lauffähig bleibt.
	async function refreshAfterEcosystemPropertiesWrite() {
		if (typeof invalidateEcosystemRegionCache === "function") {
			invalidateEcosystemRegionCache();
		}
		if (typeof loadEcosystemAreas === "function") {
			await loadEcosystemAreas({ force: true });
		}
		if (typeof loadEcosystemRegionsByWikiKey === "function" && typeof renderRegionSyncList === "function") {
			await loadEcosystemRegionsByWikiKey();
			renderRegionSyncList();
		}
	}

	// ---- Verdrahtung ----------------------------------------------------------------------------------

	function bindEcosystemPropertiesDialog() {
		if (propertiesBound) {
			return;
		}
		const overlayElement = document.getElementById(OVERLAY_ELEMENT_ID);
		if (!overlayElement) {
			return;
		}

		propertiesBound = true;
		// 🔴 „Beschriftung anlegen" im leeren Zustand des Beschriftungs-Reiters (Owner 25.08.2026).
		// ⭐ Es gibt den Weg schon: `createEcosystemRegionLabel` rechnet den Punkt der
		// Unzugaenglichkeit aus und schreibt ueber den vorhandenen Erzeuger. Ein zweiter Anlegeweg
		// waere die zweite Wahrheit -- und er muesste dieselbe Ruecknahme koennen (der Server laesst
		// eine Region hoechstens EIN primaeres Label tragen).
		// ⚠️ Der Knopf steht nur da, wenn die Flaeche KEINE Beschriftung hat -- genau der Fall, in dem
		// der Zeiger frei ist.
		document.getElementById("landschaft-dialog-label-anlegen")?.addEventListener("click", () => {
			void legeBeschriftungAn();
		});
		propertiesElement("form")?.addEventListener("submit", submitEcosystemPropertiesDialog);
		propertiesElement("close")?.addEventListener("click", closeEcosystemPropertiesDialog);
		propertiesElement("cancel")?.addEventListener("click", closeEcosystemPropertiesDialog);
		propertiesElement("delete")?.addEventListener("click", () => void requestEcosystemRegionDelete());
		// 🔴 Für die Wiki-Zuweisung wird hier NICHTS mehr verdrahtet: das Bauteil hängt seine vier
		// Zuhörer selbst an seinen Behälter und nimmt sie in `zerstoeren()` wieder ab. Die alten
		// Knöpfe („Zuweisen", „Sync", „Entfernen", „Suchen") gibt es im Markup nicht mehr.
		// Delegiert, weil die Zeilen erst beim Öffnen entstehen und bei jeder Fläche andere sind.
		// 🪤 Der Knopf sitzt in einem <form>: ohne type="button" im Markup wäre er ein Absende-Knopf
		// und würde den GANZEN Flächendialog speichern statt einer Höhe.
		propertiesElement("peaks-list")?.addEventListener("click", (event) => {
			const button = event.target?.closest?.("[data-peak-save]");
			const row = button?.closest?.("[data-peak-id]");
			if (row) {
				void saveEcosystemPeakHeight(row);
			}
		});
		TERRAIN_FIELDS.forEach((feld) => {
			// Das Zahlenfeld ist der andere Weg zum selben Wert: es setzt den Regler und löst denselben
			// Ablauf aus. Geklemmt wird an den Reglergrenzen -- ein getipptes 99999 wäre sonst im Feld
			// sichtbar, aber im Regler und damit im Bild etwas anderes.
			propertiesElement(feld.element + "-num")?.addEventListener("input", () => {
				const feldnummer = propertiesElement(feld.element + "-num");
				const regler = propertiesElement(feld.element);
				if (!feldnummer || !regler || String(feldnummer.value).trim() === "") {
					return;
				}
				const wert = Math.max(Number(regler.min), Math.min(Number(regler.max), Number(feldnummer.value)));
				if (!Number.isFinite(wert)) {
					return;
				}
				regler.value = String(wert);
				regler.dispatchEvent(new Event("input", { bubbles: true }));
			});
			// 🪤 UND BEIM VERLASSEN ZURECHTRÜCKEN. Während des Tippens bleibt das Feld unangetastet (siehe
			// syncTerrainOutput) -- danach soll es aber die Zahl zeigen, die WIRKLICH gilt: geklemmt an die
			// Reglergrenzen und auf dessen Schrittweite gerundet. Sonst bliebe ein getipptes „3501" stehen,
			// während Regler, Vorschau und Speicherung längst 3500 meinen -- zwei sichtbare Wahrheiten.
			propertiesElement(feld.element + "-num")?.addEventListener("blur", () => {
				const feldnummer = propertiesElement(feld.element + "-num");
				const regler = propertiesElement(feld.element);
				if (feldnummer && regler) {
					feldnummer.value = Number(regler.value).toFixed(feld.decimals);
				}
			});
			propertiesElement(feld.element)?.addEventListener("input", () => {
				// Anfassen heisst entscheiden -- ab hier gilt der Regler und nicht mehr die Ableitung.
				terrainTouched[feld.key] = true;
				const area = currentPropertiesArea();
				syncTerrainOutput(feld, area);
				// Danach, nicht davor: erst steht der neue Wert, dann folgt der Durchschnitt seiner
				// Obergrenze. Am Durchschnittsregler selbst ist es ein Nullgriff, am Maximum zieht es ihn
				// mit -- und bei „auto" führt es die angezeigte Zahl nach.
				syncTerrainMeanBounds();
				// 🔴 LIVE, nicht erst beim Speichern (Owner 2026-07-28). Ein Geländeregler ohne sofortiges
				// Bild ist ein Ratespiel: man stellt eine Zahl ein, speichert, schaut, korrigiert. Der Wert
				// wandert deshalb sofort in die Fläche IM SPEICHER und das Feld wird neu gebaut.
				//
				// 🪤 Das ist eine VORSCHAU, keine Speicherung. Die Zeile in der Datenbank ändert sich erst
				// mit „Gelände speichern"; wer den Dialog abbricht, hat nichts geschrieben -- aber sein
				// Kartenbild zeigt bis zum nächsten Laden die Vorschau. Das ist der bewusste Preis dafür,
				// dass man beim Ziehen sieht, was man tut.
				if (area) {
					area[feld.key] = Number(propertiesElement(feld.element)?.value);
					schedulePreviewRedraw();
				}
			});
		});
		propertiesElement("terrain-auto")?.addEventListener("click", () => void saveTerrainSettings(true));
		// Haken umgelegt -> Feld sperren/freigeben, und beim Anhaken einen frischen Griff erzeugen.
		// Artwechsel -> der Griff folgt der Art, aber nur solange der Haken steht.
		propertiesElement("autoname")?.addEventListener("change", () => syncPropertiesAutoName({ regenerate: true }));
		propertiesElement("type")?.addEventListener("change", () => {
			syncPropertiesAutoName({ regenerate: true });
			applyTerrainPresetForType();
			ecosystemZeichneWikiAbweichungen();
		});
		// 🔴 TIPPEN IM FORMULAR AENDERT DIE ABWEICHUNG. Ohne diese zwei Zuhoerer bliebe ein
		// durchgestrichener Wiki-Stand samt ↺ stehen, nachdem der Editor den Wert von Hand
		// angeglichen hat -- ein Rueckholangebot fuer etwas, das gar nicht mehr abweicht.
		// 💣 Der Zwilling im Editorfenster hat sie von Anfang an (html/landschaften-editor.html);
		// hier fehlten sie und wurden von der Designpruefung gefunden, nicht vom Testfeld. Eine Regel,
		// die einen von zwei Erzeugern bindet, ist keine Regel.
		propertiesElement("name")?.addEventListener("input", ecosystemZeichneWikiAbweichungen);
		// 🔴 ENTER IM SUCHFELD DARF DAS FORMULAR NICHT ABSCHICKEN -- es würde die Fläche SPEICHERN statt
		// den Treffer zu wählen. Das Bauteil ruft für Enter selbst `preventDefault()`
		// (js/ui/wiki-assign.js, aufTaste), aber es hängt seine Zuhörer an SEINEN Behälter; der
		// `submit`-Zuhörer sitzt am <form> darüber, und ein abgebrochenes Standardverhalten hält das
		// Ereignis nicht auf. Deshalb bleibt der Riegel hier -- am Formular, delegiert, und für JEDES
		// Suchfeld im Zuweisungskasten (dessen Markup gehört dem Bauteil).
		propertiesElement("form")?.addEventListener("keydown", (event) => {
			if (event.key === "Enter" && event.target?.closest?.("[data-wa-suche]")) {
				event.preventDefault();
			}
		});
		overlayElement.addEventListener("click", (event) => {
			if (event.target === overlayElement) {
				closeEcosystemPropertiesDialog();
			}
		});
		document.addEventListener("keydown", (event) => {
			if (event.key === "Escape" && isEcosystemPropertiesDialogOpen()) {
				event.stopPropagation();
				closeEcosystemPropertiesDialog();
			}
		});
	}

	// Der Eintrag geht durch den Erweiterungspunkt des Menüs (V3.4, addEntry), nicht durch Anfassen seines
	// DOM. Der setzt ihn automatisch ÜBER „Fläche löschen" -- zerstörerische Einträge stehen im ganzen
	// Haus zuletzt.
	function registerEcosystemPropertiesMenuEntry() {
		window.AvesmapsEcosystemAreaMenu?.addEntry?.({
			action: MENU_ACTION,
			label: typeof tr === "function" ? tr("ecosystem.ctxmenu.properties", "Eigenschaften …") : "Eigenschaften …",
			onClick: (publicId) => void openEcosystemPropertiesDialog(publicId),
		});
	}

	if (typeof document !== "undefined") {
		if (document.readyState === "loading") {
			document.addEventListener("DOMContentLoaded", registerEcosystemPropertiesMenuEntry, { once: true });
		} else {
			registerEcosystemPropertiesMenuEntry();
		}
	}

	if (typeof window !== "undefined") {
		window.AvesmapsEcosystemProperties = {
			open: openEcosystemPropertiesDialog,
			close: closeEcosystemPropertiesDialog,
			isOpen: isEcosystemPropertiesDialogOpen,
			// Die Geschwister-Verteilung, damit auch die RÜCKRICHTUNG sie benutzt
			// (map-features-ecosystem-label-writeback.js). Eine zweite Fassung derselben Schleife wäre
			// die zweite Wahrheit darüber, was von einer Fläche an ihre Labels durchträgt.
			applyToLabels: applyRegionToLabels,
			// 🔴 DIE RÜCKFRAGE VOR DEM LÖSCHEN, damit das Fenster „Reihenfolge und Sperren" sie MITBENUTZT
			// (20.08.2026). Sie ist mühsam erarbeitet -- sie sagt, wie viele Flächen mitgehen, ob Labels
			// mitgehen oder stehen bleiben, und dass auch verschwindet, was gerade nicht im Bild ist.
			// Ein zweiter Satz für dieselbe Geste wäre die zweite Vokabel, und die eine davon würde beim
			// nächsten Umbau vergessen. Derselbe Grund wie bei `applyToLabels` darüber.
			formatDeleteConfirmation: formatRegionDeleteConfirmation,
		};
	}

	if (typeof module !== "undefined" && module.exports) {
		module.exports = { formatRegionDeleteConfirmation };
	}
})();

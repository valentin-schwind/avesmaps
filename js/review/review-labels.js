// ---- Live-Vorschau der Darstellung (Owner 2026-07-29) ------------------------------------------------
//
// 🔴 Größe, Drehung und Priorität wirken auf der KARTE, während man am Regler zieht -- und werden
// zurückgenommen, wenn der Dialog ohne Speichern zugeht. Vorher musste man speichern, gucken, wieder
// öffnen, nachjustieren; bei einer Drehung um wenige Grad ist das keine Einstellung, sondern Raten.
//
// 🪤 „Zoom geht schon" meinte etwas ANDERES: syncLabelZoomRangeOutputs springt mit der KARTE auf die
// eingestellte Stufe, damit man sieht, ob das Label dort erscheint. Das ist keine Vorschau der
// Darstellung und bleibt unberührt.
//
// 💣 ZURÜCKSETZEN IST DIE VORGABE, nicht die Ausnahme. Die Rücknahme hängt an
// setLabelEditDialogOpen(false) -- also an JEDEM Schliessweg: Abbrechen, ×, ESC, Meldungs-Fluss. Nur
// das erfolgreiche Speichern entwaffnet sie vorher (dort ist die Antwort des Servers die neue
// Wahrheit). Andersherum -- an jeden Abbruchweg einzeln eine Rücknahme zu hängen -- bliebe genau der
// vergessene Weg übrig, der die Vorschau dauerhaft stehen lässt.
let labelDisplayPreview = null;

function beginLabelDisplayPreview(entry) {
	// Ein NEUES Label hat noch keinen Marker, an dem sich etwas zeigen liesse.
	labelDisplayPreview = entry?.label
		? { entry, size: entry.label.size, rotation: entry.label.rotation, priority: entry.label.priority }
		: null;
}

// Wird beim Speichern gerufen: ab hier gilt die Antwort des Servers, nicht der gemerkte Ausgangswert.
function commitLabelDisplayPreview() {
	labelDisplayPreview = null;
}

function revertLabelDisplayPreview() {
	const vorschau = labelDisplayPreview;
	labelDisplayPreview = null;
	// 🪤 Nicht auf ein gelöschtes Label zurückschreiben -- deleteLabelEntry nimmt den Eintrag aus
	// labelMarkers und schliesst danach den Dialog, läuft also auch hier durch.
	if (!vorschau || typeof labelMarkers === "undefined" || !labelMarkers.includes(vorschau.entry)) {
		return;
	}
	Object.assign(vorschau.entry.label, {
		size: vorschau.size,
		rotation: vorschau.rotation,
		priority: vorschau.priority,
	});
	redrawPreviewedLabel(vorschau.entry);
}

// Was der Dialog gerade zeigt, sofort auf die Karte. Nur die drei Darstellungswerte -- Text, Art und
// Wiki-Zuweisung bleiben aussen vor: die reisen beim Speichern ohnehin über die Server-Antwort, und
// eine halbe Vorschau davon wäre ein zweiter Zustand neben dem Formular.
function applyLabelDisplayPreview() {
	const vorschau = labelDisplayPreview;
	if (!vorschau) {
		return;
	}
	const zahl = (id, rueckfall) => {
		const wert = Number.parseInt(String(document.getElementById(id)?.value ?? ""), 10);
		return Number.isFinite(wert) ? wert : rueckfall;
	};
	Object.assign(vorschau.entry.label, {
		size: zahl("label-edit-size", vorschau.size),
		rotation: ((zahl("label-edit-rotation", vorschau.rotation) % 360) + 360) % 360,
		priority: zahl("label-edit-priority", vorschau.priority),
	});
	redrawPreviewedLabel(vorschau.entry);
}

function redrawPreviewedLabel(entry) {
	if (typeof createLabelIcon !== "function" || typeof entry?.marker?.setIcon !== "function") {
		return;
	}
	entry.marker.setIcon(createLabelIcon(entry.label));
	// Größe und Drehung ändern den Kasten, die Priorität die Reihenfolge -- beides geht die
	// Kollisionsauflösung an. Sie ist über requestAnimationFrame entprellt, ein Reglerzug kostet also
	// einen Durchlauf je Bild und nicht einen je Rastpunkt.
	if (typeof scheduleLabelCollisionResolution === "function") {
		scheduleLabelCollisionResolution();
	}
}

// Welcher Reiter beim naechsten Oeffnen aufgehen soll. 💣 KEIN gemerkter Zustand ueber das
// Oeffnen hinaus: `openLabelEditDialog` setzt ihn bei JEDEM Aufruf neu und `setLabelEditDialogOpen`
// liest ihn genau einmal. Ein Merker, der ueberlebt, liesse das zweite Oeffnen auf dem Reiter des
// ersten landen -- genau die Falle, an der Anzeige-Menue und Ansichts-Kacheln gescheitert sind.
let labelEditStartReiter = "";

function setLabelEditDialogOpen(isOpen, { resetForm = false } = {}) {
	if (typeof avesmapsLandschaftDialogSichtbar === "function") {
		// 🔴 Die Haelfte meldet sich SELBST an: nur dieses Modul weiss, ob hinter dem Formular ein
		// Objekt steht. „Speichern" schickt nur angemeldete Haelften ab -- blind beide zu schicken
		// legte an einer Flaeche ohne Beschriftung bei jedem Speichern eine neue an.
		if (typeof avesmapsLandschaftDialogHaelfte === "function") {
			avesmapsLandschaftDialogHaelfte("beschriftung", isOpen);
		}
		avesmapsLandschaftDialogSichtbar(isOpen);
		if (isOpen && labelEditStartReiter !== "" && typeof avesmapsLandschaftDialogReiter === "function") {
			// 🔴 Der Einstieg bestimmt den Reiter (Owner 25.08.2026). Wer eine Beschriftung anklickt,
			// landet auf ihrem Reiter -- nicht auf dem zuletzt offenen.
			// ⚠️ Ein LEERER Merker heisst „nicht anfassen": dann ist dieser Oeffner der Gegenpart, und
			// der Reiter gehoert dem Einstieg, der ihn gerufen hat.
			avesmapsLandschaftDialogReiter(labelEditStartReiter);
		}
	} else {
		$("#label-edit-overlay").prop("hidden", !isOpen);
	}
	syncModalDialogBodyState();

	if (isOpen) {
		getLabelEditDialogElement()?.focus();
		document.getElementById("label-edit-text")?.focus();
		return;
	}

	revertLabelDisplayPreview();
	if (resetForm) {
		resetLabelEditForm();
	}
}

// Der Fenstertitel des Label-Dialogs -- und die Stelle, an der die beiden Label-FORMEN beim Namen
// genannt werden (Owner 2026-08-07: „ich schreib 'freies label' und 'flächenlabel'").
//
// 🔴 DREI ZUSTÄNDE, nicht zwei. „Freies Label bearbeiten" ist eine Aussage über die Zugehörigkeit, und
// die steht erst fest, wenn sie AUFGELÖST ist (`resolved`) -- deshalb:
//   - aufgelöst, keine Fläche  -> „Freies Label bearbeiten"
//   - aufgelöst, Ebene bekannt -> „Topographie-Label bearbeiten" usw.
//   - noch nicht aufgelöst     -> „Label bearbeiten", allgemein und wahr
// Der dritte Zustand ist der Grund für die Fallunterscheidung: der Titel wird zweistufig gesetzt (siehe
// populateLabelEditForm), und ein Titel, der von „Freies Label" auf „Topographie-Label" springt, behauptet
// unterwegs etwas Falsches. Ein NEUES Label überspringt den Zwischenzustand -- es kann keine Fläche haben.
//
// 🪤 `ecosystemDialogTitle` bleibt unangetastet: „Topographie-Label bearbeiten" sind die Worte des Owners
// vom 2026-07-28 und von ecosystem-rendering.test.js gesichert. Die Ebene im Titel SAGT bereits, dass eine
// Fläche dahintersteht; nur die freie Form hatte bisher keinen eigenen Namen.
function setLabelEditDialogTitle(kind, { resolved = false } = {}) {
	const titleElement = document.getElementById("label-edit-title");
	if (!titleElement) {
		return;
	}
	// 💣 EIN SCHREIBER, SONST EIN RENNEN. Liegt eine FLAECHE vor, gehoert der Titel der Huelle: das
	// Fenster bearbeitet dann eine LANDSCHAFT und nicht bloss ein Label. Die zweite Titelstufe unten
	// kommt nachgereicht (erst dann ist die Ebene bekannt) und ueberschrieb die Huelle sonst -- der
	// Flaechen-Einstieg trug seit dem 26.08.2026 „Topographie-Label bearbeiten".
	// ⚠️ Die Huelle ENTSCHEIDET und SCHREIBT in einem; ein leerer Rueckgabewert heisst „nicht mein
	// Fall, mach du". So gibt es keine zweite Fassung derselben Regel.
	if (typeof avesmapsLandschaftDialogTitel === "function"
		&& typeof avesmapsLandschaftDialogStand === "function"
		&& avesmapsLandschaftDialogTitel(avesmapsLandschaftDialogStand(), kind) !== "") {
		return;
	}
	if (resolved && String(kind || "") === "") {
		titleElement.textContent = "Freies Label bearbeiten";
		return;
	}
	if (typeof ecosystemDialogTitle === "function") {
		titleElement.textContent = ecosystemDialogTitle(kind, "label");
	}
}

function populateLabelEditForm({ labelEntry = null, latlng = null } = {}) {
	labelEditEntry = labelEntry;
	labelEditLatLng = latlng ? L.latLng(latlng) : labelEntry?.marker.getLatLng() || null;
	const label = labelEntry?.label || {};
	// Fuer NEUE Labels (kein labelEntry) die zuletzt genutzte DARSTELLUNG als Default uebernehmen; bestehende
	// Labels behalten ihre eigenen Werte. Text & Kategorie werden bewusst NICHT gemerkt.
	const remembered = labelEntry ? {} : (readRememberedLabelDisplaySettings() || {});
	document.getElementById("label-edit-public-id").value = label.publicId || "";
	void acquireFeatureSoftLock(label.publicId || "");
	document.getElementById("label-edit-text").value = label.text || "";
	// 🔴 JEDER DIALOG BEGINNT ALS FREIES LABEL (Owner 2026-08-07). Das Auswahlfeld ist über alle Dialoge
	// dasselbe Element, und eingedampft wird es nur für ein Label, das WIRKLICH an einer Landschaftsfläche
	// hängt -- die Verfeinerung darauf kommt asynchron aus renderLabelCarrierNote, sobald die Fläche
	// aufgelöst ist. Hier steht deshalb immer erst die volle Liste, und `applyLabelTypeVocabulary(null, …)`
	// setzt zugleich den Wert; ein blosses `select.value = …` wäre nur die halbe Zuweisung.
	//
	// 💣 Ein NEUES Label ist immer ein freies: „Hier hinzufügen -> Neues Label", „Höhenpunkt setzen" und
	// das Ziehen einer Wiki-Region auf die Karte legen alle drei einen Punkt ohne Fläche an, und
	// renderLabelCarrierNote steigt mangels public_id sofort aus. Ohne diese Zeile erbte ein neues Label
	// die Arten des zuletzt geöffneten Flächenlabels -- `formElement.reset()` setzt Werte zurück, keine
	// Optionen. Gemeldet als „unter den Arten keinen Berggipfel zur Auswahl": die Topographie führt
	// keinen, denn ein Gipfel ist ein Punkt und keine Fläche.
	//
	// 💣 Und die stille Hälfte: startNewEcosystemPeak öffnet diesen Dialog und setzt danach
	// `value = "berggipfel"`. Steht dort ein Vokabular ohne diese Art, HAFTET DIE ZUWEISUNG NICHT -- der
	// Höhenpunkt entstand als `region`-Label ohne Höhenzeile, ohne Fehler, ohne Meldung.
	applyLabelTypeVocabulary(null, label);
	document.getElementById("label-edit-size").value = label.size || remembered.size || 18;
	document.getElementById("label-edit-rotation").value = ((Number(label.rotation ?? remembered.rotation ?? 0) % 360) + 360) % 360;
	document.getElementById("label-edit-min-zoom").value = label.minZoom ?? remembered.minZoom ?? 0;
	document.getElementById("label-edit-max-zoom").value = label.maxZoom ?? remembered.maxZoom ?? 7;
	document.getElementById("label-edit-priority").value = label.priority ?? remembered.priority ?? 3;
	document.getElementById("label-edit-is-nodix").checked = Boolean(labelEntry ? label.isNodix : (remembered.isNodix ?? false));
	// 🔴 Empty is NOT zero. A peak nobody has measured leaves the field blank; writing "0" here would
	// record sea level as a fact. The height is also NOT remembered for new labels the way the display
	// values are -- copying the last peak's height onto the next one would invent data.
	const heightInput = document.getElementById("label-edit-height");
	if (heightInput) {
		heightInput.value = label.heightSchritt === null || label.heightSchritt === undefined ? "" : String(label.heightSchritt);
	}
	syncLabelHeightRow();
	if (typeof setLabelWikiRegion === "function") {
		// 🔴 ZWEI Angaben, nicht eine: das Nest UND der dritte Zustand. Der Merker ist nicht aus dem
		// Nest ableitbar (siehe map-features-labels.js), und ohne ihn stünde das Häkchen bei jedem
		// Öffnen leer da -- ein Speichern nähme die Entscheidung dann zurück.
		// ⚠️ DREI Angaben, nicht zwei: dazu die Feldherkunft. Sie ist so wenig aus dem Nest ableitbar
		// wie der Merker daneben -- ohne sie stünde jede Zeile auf „Herkunft unbekannt", und das
		// Vorhäkeln der Sync-Vorschau verhielte sich, als hätte niemand je etwas von Hand gesetzt.
		setLabelWikiRegion(label.wikiRegion || null, label.keinArtikel === true, label.fieldOrigins || null);
	}
	// 🪤 ZWEISTUFIG. Der Titel nennt die Ebene des Labels („Vegetations-Label bearbeiten"), aber die
	// Ebene steht erst fest, wenn die Region aufgelöst ist -- und das ist ein asynchroner Schritt
	// (renderLabelCarrierNote lädt dafür die Regionslisten). Hier also erst der allgemeine Titel; die
	// Verfeinerung kommt dort, sobald die Antwort da ist. Ein flackernder Titel wäre schlimmer als ein
	// später richtiger, und ein Label OHNE Fläche bleibt dauerhaft beim allgemeinen.
	// Ausgangswerte merken, BEVOR ein Regler sie überschreibt -- daraus besteht die Rücknahme.
	beginLabelDisplayPreview(labelEntry);
	// Ein NEUES Label (kein labelEntry) ist sofort aufgelöst: es hängt an keiner Fläche und kann in
	// diesem Moment an keiner hängen. Ein bestehendes bleibt allgemein, bis renderLabelCarrierNote
	// antwortet -- dort steht die zweite Stufe.
	setLabelEditDialogTitle("", { resolved: !labelEntry });
	renderLabelCarrierNote(label);
	syncLabelZoomRangeOutputs();
	syncLabelSliderRowsFromNumbers();
	syncLabelPriorityOutput();
	document.getElementById("label-edit-delete").hidden = !labelEntry;
	if (labelEditLatLng) {
		document.getElementById("label-edit-lat").value = labelEditLatLng.lat.toFixed(3);
		document.getElementById("label-edit-lng").value = labelEditLatLng.lng.toFixed(3);
	}
}

// 🔴 „Dieses Label wird von N Flächen getragen." — die andere Hälfte der Kopplung. Der Dialog bearbeitet
// eine Beschriftung, aber seit jede Landschaftsregion ihr Label bekommt, hängt an vielen von ihnen eine
// Fläche, die mitverschwindet, wenn man hier auf „Löschen" geht. Wer das nicht sieht, löscht blind.
//
// Die Zahl kommt aus list_regions (area_count + label_public_id), NICHT aus den geladenen Flächen:
// ecosystemLayers hält nur, was gerade im Bild ist, und würde bei einer Region, die halb aus dem
// Ausschnitt ragt, zu wenig zählen.
async function renderLabelCarrierNote(label) {
	const note = document.getElementById("label-edit-carriers");
	if (!note) {
		return;
	}
	note.hidden = true;
	const publicId = String(label?.publicId || "");
	if (!publicId || typeof loadEcosystemRegions !== "function" || typeof ecosystemRegionsByKind === "undefined") {
		return;
	}

	const kinds = typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : ["derographisch", "vegetation", "topographie"];
	await Promise.all(kinds.map((kind) => loadEcosystemRegions(kind)));
	// Der Dialog kann inzwischen ein anderes Label zeigen -- dann gehört diese Antwort nicht mehr hierher.
	if (String(document.getElementById("label-edit-public-id")?.value || "") !== publicId) {
		return;
	}

	// Aus BEIDEN Richtungen: der Zeiger am Label (mehrere Labels je Flaeche) und der an der Region
	// (ihr primaeres). Nur die Regionsrichtung zu lesen hiesse, das zweite und dritte Label einer
	// Flaeche als heimatlos anzuzeigen -- und genau die sind der Sinn der Sache.
	const region = typeof ecosystemRegionOfLabel === "function" ? ecosystemRegionOfLabel(label) : null;
	applyLabelTypeVocabulary(region, label);
	// Die zweite Stufe des Titels (siehe populateLabelEditForm): jetzt ist die Ebene bekannt.
	setLabelEditDialogTitle(region?.kind || "", { resolved: true });
	fillLabelRegionSelect(label, region);
	// VOR dem fruehen Ausstieg darunter: ohne Region muessen die zwei Bedienelemente
	// ausdruecklich verriegelt werden, sonst behalten sie den Stand des zuletzt geoeffneten Labels.
	syncLabelCurveControls(region);
	if (!region) {
		return;
	}
	const count = Number(region.area_count || 0);
	note.textContent = count === 1
		? `Dieses Label wird von 1 Fläche getragen („${region.name}").`
		: `Dieses Label wird von ${count} Flächen getragen („${region.name}").`;
	note.hidden = false;
}

// 🔴 Ein Label GEHÖRT einer Ebene -- über seine Region (Owner 2026-07-28). Ein Vegetationslabel darf
// deshalb nur Vegetations-Arten anbieten: „Gebirge" auf einem Waldstück ist keine Wahl, die jemand
// treffen können soll. Das Vokabular kommt aus `ecosystem_region_type` DIESER Ebene -- dieselbe Liste,
// aus der der Flächendialog seine Art-Auswahl füllt, nie eine zweite im Client.
//
// 🪤 Nur einschränken, wenn das Label wirklich an einer Fläche hängt. Kontinente, Meere und die freien
// Karten-Titel gehören zu keiner Ebene und behalten die volle Liste aus dem Markup -- ihnen die
// Vegetations-Arten vorzusetzen wäre die Einschränkung genau falsch herum.
//
// 💣 Der Subtyp des Labels IST der Art-Schlüssel der Region (`wald` ist beides; der V5-Import hat die
// beiden Vokabulare gleichgesetzt). Wer hier eine Übersetzungstabelle einzieht, baut die zweite
// Wahrheit, die es bisher nicht gibt.
// 💣 Die volle Liste EINMAL wegheben. Das Auswahlfeld ist über alle Dialoge dasselbe Element: wer es
// für ein Vegetationslabel eindampft und danach ein Label OHNE Fläche öffnet, bekäme dessen sieben
// Vegetations-Arten vorgesetzt -- ein Kontinent hätte plötzlich zwischen Wald und Tundra zu wählen.
let labelTypeFullMarkup = "";

function applyLabelTypeVocabulary(region, label) {
	const select = document.getElementById("label-edit-type");
	if (select && labelTypeFullMarkup === "") {
		labelTypeFullMarkup = select.innerHTML;
	}
	const kind = String(region?.kind || "");
	if (!select) {
		return;
	}
	if (kind === "" || typeof ecosystemRegionTypesByKind === "undefined") {
		select.innerHTML = labelTypeFullMarkup;    // gehört zu keiner Ebene -> alles erlaubt
		select.value = String(label?.labelType || "region");
		syncLabelHeightRow();
		return;
	}
	const types = ecosystemRegionTypesByKind[kind];
	if (!Array.isArray(types) || types.length === 0) {
		select.innerHTML = labelTypeFullMarkup;    // Vokabular noch nicht da -- lieber alles als eine falsche Auswahl
		select.value = String(label?.labelType || "region");
		syncLabelHeightRow();
		return;
	}

	// „Keine Art" heisst beim LABEL der neutrale Subtyp `region`, nicht ein leerer Wert: ein Label ohne
	// Subtyp hätte keinen Stil und würde ungezeichnet bleiben.
	const wanted = String(label?.labelType || "region");
	select.innerHTML = "";
	// 💣 NUR WENN DAS VOKABULAR `region` NICHT SELBST FÜHRT. Der Platzhalter trägt den Wert `region`
	// (siehe oben) -- und die DEROGRAPHIE hat `region` als echte, benannte Art. Beide zusammen ergaben
	// zwei Einträge mit demselben Wert, und `select.value = "region"` wählt immer den ERSTEN: der Dialog
	// zeigte für jedes derographische Regionslabel „— keine Art —", „Region" auszuwählen änderte nichts
	// Sichtbares, und nach jedem Neuaufbau stand wieder der Platzhalter da. Vom Owner gemeldet als
	// „Art Region speichern geht nicht" — gespeichert wurde in Wahrheit richtig, die Liste log nur.
	//
	// 🪤 Vegetation und Topographie führen kein `region`, dort gab es die Kollision nie. Genau deshalb
	// fiel es nur an EINER Ebene auf und sah nach einem Datenfehler an einem einzelnen Label aus.
	const fuehrtRegionSelbst = types.some((type) => String(type.type_key) === "region");
	if (!fuehrtRegionSelbst) {
		select.appendChild(new Option(labelEmptyTypeLabel(kind), "region"));
	}
	types.forEach((type) => {
		select.appendChild(new Option(type.label, type.type_key));
	});
	// Trägt das Label eine Art, die dieses Vokabular nicht kennt (Altbestand, oder die Region hat die
	// Ebene gewechselt), bleibt sie als eigener Eintrag stehen -- sonst würde ein blosses Öffnen des
	// Dialogs sie stillschweigend auf etwas anderes umstellen.
	if (wanted !== "region" && !types.some((type) => String(type.type_key) === wanted)) {
		select.appendChild(new Option(wanted + " (fremde Art)", wanted));
	}
	select.value = wanted;
	syncLabelHeightRow();
}

// 🔴 „Gehört zu": die fehlende Hälfte der Kopplung (Owner 2026-07-28). Bis heute bekam ein Label seinen
// Zeiger auf eine Landschaftsfläche NUR beim Anlegen einer Regionsbeschriftung
// (map-features-ecosystem-draw.js) oder beim Klonen -- ein bestehendes liess sich an keine Fläche
// hängen. `update_label` konnte es die ganze Zeit (api/_internal/map/features.php:2278), es gab bloss
// keinen Weg dorthin.
//
// 💣 Was das kostete, stand live auf der Karte: FÜNF Finsterkamm-Labels, von denen genau eines seine
// Region kannte. Die übrigen vier fielen damit nicht unter „ein Flächen-Label wird nie ausgeblendet"
// und auch nicht unter „Labels derselben Fläche dürfen einander überlappen" -- sie blendeten sich
// gegenseitig aus, und der Editor sah seine Beschriftung verschwinden.
//
// Die Auswahl führt ALLE drei Ebenen, nicht nur eine: ein Label gehört zu genau einer Fläche, aber
// welcher Ebene die angehört, ist die Antwort und nicht die Frage.
// Der beim Oeffnen vorgefundene Stand der Kurveneinstellung -- `null` heisst „nicht bedienbar“.
let labelCurveGeladen = null;

// Der beim SPEICHERN festgehaltene Stand.
//
// 💣 WARUM ES IHN GIBT -- der Fehler, der ihn erzwungen hat: der Schreibweg zur Region laeuft ueber
// `ecosystemPushLabelChangesToRegion`, und der wartet ZUERST auf `loadEcosystemRegions` -- ein
// `await`. Genau in dieser Luecke schliesst der Submit-Handler den Dialog mit `resetForm: true`
// (review-editor-submit.js). Wer die Bedienelemente erst danach liest, liest das ZURUECKGESETZTE
// Formular: `getLabelCurvePayload` lieferte `null`, es wurde nichts geschrieben, und beim naechsten
// Oeffnen stand die Kurvenbeschriftung wieder auf „aus" -- ohne Fehlermeldung, ohne Konsole.
// Deshalb wird der Stand SYNCHRON beim Bauen des Rumpfes genommen, nicht spaeter aus dem DOM.
let labelCurveSchnappschuss = null;

// Die zwei Bedienelemente der Kurvenbeschriftung (Entwurf §2) fuellen und verriegeln.
//
// 🔴 SIE GEHOEREN DER REGION, nicht dem Label: eine Region traegt N Labels und M Flaechen, der Wert
// existiert genau einmal. Gelesen wird er deshalb aus der REGIONSZEILE (`list_regions` gibt ihn als
// zwei flache Werte heraus), nie aus dem Label -- und schon gar nicht aus `curveLine`: die sagt „der
// Server hat eine Kurve gerechnet“, nicht „der Haken steht“. Eine eingeschaltete Region ohne
// rechenbare Achse stuende sonst als „aus“ da.
//
// ⚠️ OHNE FLAECHE KEINE MITTELACHSE. Ein Meer, eine Insel, ein Gipfel traegt kein Polygon, aus dem
// sich eine Achse rechnen liesse; beide Bedienelemente stehen dann deaktiviert da UND sagen warum.
// Ein wirkungsloser Schalter ohne Begruendung ist schlimmer als keiner (index.html:2684).
/**
 * Darf „Max. Namen" bedient werden? REIN -- kein DOM.
 *
 * 🔴 ZWEI Bedingungen, und sie sind verschiedener Art (Owner 24.08.2026):
 *   - OHNE FLÄCHE gibt es gar keine Mittelachse -- weder Haken noch Zahl sind bedienbar.
 *   - MIT Fläche, aber Haken AUS: die Zahl sagt „höchstens so viele Namen auf der Kurve", und
 *     es gibt keine Kurve. Ein Regler, der eine Zahl für etwas Abgeschaltetes stellt, sieht aus
 *     wie eine Einstellung und ist keine.
 *
 * ⚠️ Der WERT bleibt dabei stehen. Ein deaktivierter Regler, der auf 1 zurückspringt, verlöre
 * die Einstellung beim blossen Ab- und Wiederanhaken -- dieselbe Haltung wie beim globalen
 * Häkchen der Deckkraft: stumm, aber gemerkt.
 */
function labelCurveMaxBedienbar(hatFlaeche, kurveAn) {
	return Boolean(hatFlaeche) && Boolean(kurveAn);
}

/**
 * Die zwei Bedienelemente für „Anzahl Kurvenlabel" an die Regel hängen.
 *
 * 🔴 SEIT 25.08.2026 wird die Zeile VERBORGEN, nicht nur gesperrt. Bis dahin stand sie immer da
 * und trug ihre Begründung im `title` -- der Haken lag zwei Zellen weiter im Raster. Jetzt sitzt
 * er unmittelbar darüber und IST die Begründung; ein deaktiviertes Bedienelement daneben wäre
 * die zweite. Der `title` bleibt trotzdem gesetzt: er trägt den Fall „angehakt, aber ohne
 * Fläche", in dem die Zeile sichtbar UND gesperrt ist.
 *
 * ⚠️ Verborgen wird die ZEILE (#label-edit-curve-max-row), nie das Feld: `formData` liest ein
 * `hidden` gesetztes Elternelement weiterhin mit, und genau das soll es -- der Wert bleibt
 * stehen, wenn jemand den Haken ab- und wieder anhakt.
 */
function syncLabelCurveMaxControls() {
	const haken = document.getElementById("label-edit-curve");
	const zahl = document.getElementById("label-edit-curve-max");
	const regler = document.getElementById("label-edit-curve-max-range");
	const marke = document.getElementById("label-edit-curve-max-marke");
	const zeile = document.getElementById("label-edit-curve-max-row");
	// 🔴 DIE BINDUNG AN DIE FLAECHE (Owner 25.08.2026). Ohne Haken liegen Flaeche und Beschriftung
	// unabhaengig auf der Karte; mit ihm laeuft der Name auf der Mittelachse, und die eigene
	// Position wirkt nicht mehr. Der Satz haengt am HAKEN, nicht am Reiter -- er beschreibt eine
	// Wirkung, keine Ansicht.
	document.querySelectorAll("[data-landschaft-bindung]").forEach((satz) => {
		const gebunden = satz.dataset.landschaftBindung === "gebunden";
		satz.hidden = gebunden !== Boolean(haken.checked);
	});
	if (!haken || !zahl) {
		return;
	}
	// ⚠️ `haken.disabled` trägt hier die Flächenfrage -- sie ist eine Zeile weiter oben schon
	// entschieden, und sie zweimal zu rechnen liesse die beiden auseinanderlaufen.
	const bedienbar = labelCurveMaxBedienbar(!haken.disabled, haken.checked);
	// Ohne Haken gibt es nichts zu verteilen -- dann steht die Zeile gar nicht erst da.
	if (zeile) {
		zeile.hidden = !haken.checked;
	}
	zahl.disabled = !bedienbar;
	if (regler) {
		regler.disabled = !bedienbar;
	}
	// Die Vorgabemarke gehört zu einem Regler, den man stellen kann. Steht er still, steht sie
	// nur im Weg.
	if (marke && !bedienbar) {
		marke.hidden = true;
	}
	const grund = haken.disabled
		? ""
		: (haken.checked ? "" : "Erst „Kurvenbeschriftung“ anhaken — ohne Kurve gibt es nichts zu verteilen.");
	zahl.title = grund;
	if (regler) {
		regler.title = grund;
	}
}

function syncLabelCurveControls(region) {
	const haken = document.getElementById("label-edit-curve");
	const zahl = document.getElementById("label-edit-curve-max");
	const regler = document.getElementById("label-edit-curve-max-range");
	const hinweis = document.getElementById("label-edit-curve-hint");
	if (!haken || !zahl) {
		return;
	}
	const hatFlaeche = Boolean(region) && Number(region.area_count || 0) > 0;
	haken.disabled = !hatFlaeche;
	zahl.disabled = !hatFlaeche;
	if (regler) {
		regler.disabled = !hatFlaeche;
	}
	if (hinweis) {
		hinweis.hidden = hatFlaeche;
		hinweis.textContent = hatFlaeche
			? ""
			: "Ohne Landschaftsfläche gibt es keine Mittelachse, auf der der Name laufen könnte.";
	}
	if (!hatFlaeche) {
		// 💣 KEIN gemerkter Stand heisst: dieses Speichern NENNT die Felder nicht. Ein „aus“, das aus
		// einem deaktivierten Haken abgeleitet wuerde, schaltete die Kurve einer Region ab, sobald
		// jemand irgendein flaechenloses Label speichert.
		labelCurveGeladen = null;
		labelCurveSchnappschuss = null;
		haken.checked = false;
		zahl.value = "1";
		if (regler) {
			regler.value = "1";
		}
		// ⚠️ Auch hier -- der Zweig kehrt gleich zurück, und ohne diese Zeile bliebe „Max. Namen"
		// beim vorigen Label bedienbar stehen.
		syncLabelCurveMaxControls();
		return;
	}
	const an = region.curve_label === true;
	const max = Number(region.curve_label_max || 1) || 1;
	haken.checked = an;
	zahl.value = String(max);
	if (regler) {
		regler.value = String(max);
	}
	labelCurveGeladen = { an, max };
	labelCurveSchnappschuss = null;   // ein neu geoeffneter Dialog erbt nichts
	// 🔴 ZULETZT: die Flächenfrage steht jetzt fest, und „Max. Namen" hängt zusätzlich am Haken.
	syncLabelCurveMaxControls();
}

// Was dieses Speichern an der Kurveneinstellung NENNT -- oder null, wenn sich nichts bewegt hat.
//
// 💣 GEPRUEFT WIRD VERAENDERT, NICHT GESETZT. Der Wert steht an ZWEI Oberflaechen, und beide
// speichern dieselbe Region: ein Dialog, der ihn bei jedem Speichern mitschickt, nimmt die Aenderung
// des anderen wortlos zurueck. Dieselbe Regel wie beim dritten Wiki-Zustand nebenan
// (getLabelWikiNoArticlePayload) und dieselbe, die der Server noch einmal haelt.
function leseLabelCurveAenderung() {
	if (!labelCurveGeladen) {
		return null;
	}
	const haken = document.getElementById("label-edit-curve");
	const zahl = document.getElementById("label-edit-curve-max");
	if (!haken || !zahl) {
		return null;
	}
	const an = Boolean(haken.checked);
	const max = Math.min(3, Math.max(1, Number.parseInt(String(zahl.value || "1"), 10) || 1));
	if (an === labelCurveGeladen.an && max === labelCurveGeladen.max) {
		return null;
	}
	return { curve_label: an, curve_label_max: max };
}

// Den beim Speichern genommenen Stand herausgeben -- und verbrauchen.
//
// 🔴 Er wird GELEERT, nicht bloss gelesen: ein Rumpf ohne anschliessenden Schreibweg zur Region
// (z. B. `create_label`) liesse ihn sonst liegen, und der naechste Speichervorgang eines ganz
// anderen Labels schriebe ihn dessen Region zu.
function getLabelCurvePayload() {
	const stand = labelCurveSchnappschuss;
	labelCurveSchnappschuss = null;
	return stand;
}

function fillLabelRegionSelect(label, region) {
	const section = document.getElementById("label-edit-region-section");
	const select = document.getElementById("label-edit-region");
	if (!section || !select) {
		return;
	}

	const kinds = typeof ECOSYSTEM_KINDS !== "undefined" ? ECOSYSTEM_KINDS : [];
	const alle = typeof ecosystemRegionsByKind !== "undefined" && ecosystemRegionsByKind ? ecosystemRegionsByKind : {};
	// Ohne geladenes Vokabular gar nicht erst anbieten: eine leere Auswahl, die beim Speichern eine
	// bestehende Zuweisung löschte, wäre schlimmer als kein Feld.
	const geladen = kinds.some((kind) => Array.isArray(alle[kind]));
	// 🔴 NUR, WENN ES ETWAS ZU TUN GIBT (Owner 26.08.2026: „‚Gehört zu' macht null sinn. die aktuelle
	// auswahl bezieht sich immer auf die fläche"). Er hat recht: liegt die Beschriftung schon auf einer
	// Fläche, beantwortet das Feld eine Frage, die beantwortet ist -- und es stand ausgerechnet im
	// Reiter FLÄCHE, obwohl es der BESCHRIFTUNG gehört. Dort las es sich wie eine Aussage über die
	// Fläche und nannte bei leerem Stand die erstbeste fremde Region.
	//
	// 💣 GANZ WEG GING NICHT: für die 252 Beschriftungen OHNE Fläche ist dieses Feld der EINZIGE Weg,
	// sie an eine zu hängen -- die zwei anderen Schreiber von `ecosystem_region_public_id` setzen den
	// Zeiger nur beim Anlegen (createEcosystemRegionLabel) und beim Duplizieren. Der leere Zustand des
	// Flächen-Reiters weist wörtlich darauf hin: „Die Zuordnung steht darunter."
	//
	// ⚠️ Und `buildLabelEditPayload` schickt den Zeiger nur bei SICHTBAREM Feld mit. Verborgen heisst
	// hier also zugleich: dieses Speichern kann die Zugehörigkeit nicht mehr versehentlich umhängen.
	const schonZugeordnet = String(region?.public_id || "") !== "";
	section.hidden = !geladen || schonZugeordnet;
	if (!geladen || schonZugeordnet) {
		return;
	}

	select.innerHTML = "";
	select.appendChild(new Option("— keiner Fläche —", ""));
	kinds.forEach((kind) => {
		const zeilen = Array.isArray(alle[kind]) ? alle[kind] : [];
		if (zeilen.length === 0) {
			return;
		}
		const gruppe = document.createElement("optgroup");
		gruppe.label = (typeof ECOSYSTEM_KIND_LABELS !== "undefined" && ECOSYSTEM_KIND_LABELS[kind]) || kind;
		zeilen.slice()
			.sort((links, rechts) => String(links.name || "").localeCompare(String(rechts.name || ""), "de"))
			.forEach((zeile) => {
				const anzahl = Number(zeile.area_count) || 0;
				gruppe.appendChild(new Option(
					`${zeile.name || "Ohne Namen"} (${anzahl === 1 ? "1 Fläche" : `${anzahl} Flächen`})`,
					String(zeile.public_id || "")
				));
			});
		select.appendChild(gruppe);
	});

	// 🪤 Die aufgelöste Region kann über den Zeiger der REGION gefunden worden sein, nicht über den des
	// Labels. Dann steht sie hier trotzdem drin -- und ein Speichern schreibt sie als eigenen Zeiger
	// fest. Das ist gewollt: der Zeiger am Label ist die künftige Wahrheit, und ihn beiläufig
	// nachzuziehen, wo jemand das Label ohnehin anfasst, ist derselbe Weg, auf dem die neun
	// handgezeichneten Flächen ihr Label bekommen haben.
	select.value = String(region?.public_id || "");
	// Zeigt die Region auf etwas, das die Liste nicht kennt (andere Ebene noch nicht geladen), bleibt
	// sie als eigener Eintrag stehen, statt beim Öffnen still auf „keine" zu fallen.
	if (select.value === "" && String(region?.public_id || "") !== "") {
		select.appendChild(new Option(`Fläche ${region.public_id}`, String(region.public_id)));
		select.value = String(region.public_id);
	}
}

// Only a berggipfel has a height. The row is hidden for every other subtype, and buildLabelEditPayload
// then omits the key entirely -- the server treats a PRESENT key as "the caller means it", so leaving
// it in for a wald label would write a height onto something that cannot carry one.
//
// 🪤 Called from three places on purpose: on open, on every change of the type select, and at the end
// of applyLabelTypeVocabulary. That last one is not redundant -- it runs ASYNC (it waits for the region
// vocabulary) and rewrites the select, so a row synced only on open would be stale by the time the
// dialog settles.
function syncLabelHeightRow() {
	const row = document.getElementById("label-edit-height-row");
	if (!row) {
		return;
	}
	const isPeak = typeof isEcosystemPeakSubtype === "function"
		&& isEcosystemPeakSubtype(document.getElementById("label-edit-type")?.value);
	row.hidden = !isPeak;
	if (!isPeak) {
		return;
	}

	// 🔴 STANDARDHÖHE 5.000 Schritt (Owner-Entscheid 2026-07-28: „gib den gipfeln ne standardhöhe von
	// 5000 schritt, aber die müssen wir natürlich editieren können"). Sobald ein Label ein Gipfel oder
	// Vulkan wird, steht der Regler auf 5.000 statt auf nichts -- der Editor korrigiert von einem
	// sinnvollen Wert aus, statt bei null anzufangen.
	//
	// 🪤 NUR wenn das Feld leer ist. Ein Gipfel mit erfasster Höhe behält seine; ihn beim blossen Öffnen
	// des Dialogs auf 5.000 zurückzusetzen wäre stiller Datenverlust.
	// Derselbe Wert steht als ECOSYSTEM_HEIGHT_DEFAULT im Höhenmodul -- das Feld zeigt damit genau die
	// Zahl, mit der die Karte ohnehin schon rechnet, statt einer zweiten Wahrheit daneben.
	const input = document.getElementById("label-edit-height");
	const range = document.getElementById("label-edit-height-range");
	if (input && String(input.value || "").trim() === "") {
		input.value = typeof ECOSYSTEM_HEIGHT_DEFAULT === "number" ? String(ECOSYSTEM_HEIGHT_DEFAULT) : "5000";
	}
	if (input && range) {
		range.value = input.value;
	}
}

// Delegated, like the slider mirroring below: the dialog markup is static, but binding directly would
// still need a load-order guarantee this file does not have. No focus is moved here -- a `change`
// handler that grabs focus is how the combobox once stole it from an open dialog.
document.addEventListener("change", (event) => {
	// 🔴 Der Haken „Kurvenbeschriftung" schaltet „Max. Namen" frei -- ohne diesen Zuhörer wirkt
	// die Regel nur beim Öffnen, und wer den Haken setzt, findet die Zahl weiter gesperrt.
	if (event.target && event.target.id === "label-edit-curve") {
		syncLabelCurveMaxControls();
	}
	if (event.target && event.target.id === "label-edit-type") {
		syncLabelHeightRow();
		// 💣 Die Vorgabe haengt an der ART. Ohne diese Zeile zeigte ein Dialog, in dem jemand
		// die Art umstellt, weiter die Marken der ALTEN -- und das sieht aus wie eine Vorgabe, die
		// nicht stimmt.
		avesmapsLabelZeichneVorgabeMarken();
	}
});

function labelEmptyTypeLabel(kind) {
	if (kind === "vegetation") {
		return "— keine Vegetation —";
	}
	if (kind === "topographie") {
		return "— keine Topographie —";
	}

	return "— keine Art —";
}


// ---- Die Vorgabemarken auf den Reglern ---------------------------------------------------------
//
// 🔴 DAS MODELL IST GEMISCHT, und das ist Absicht (Entwurf §6):
//   Flaechenfarbe, Deckkraft und Namensfarbe gibt die Tafel VOR -- dafuer gibt es hier kein Feld.
//   GROESSE, Zoomband, max. Namen und Prioritaet RAET sie nur -- der Editor behaelt seinen Regler
//   und sieht die Vorgabe als Marke darunter. Das sind VIER ratende gegen drei geltende.
//
// 🪤 HIER STAND EINEN TAG LANG „Farbe und Groesse gibt die Tafel VOR -- der Editor hat dafuer kein
// Feld mehr". Der Owner hat das am 24.08.2026 umgedreht, und der Kommentar wurde dabei zunaechst
// NICHT mitgezogen: er widersprach damit dem Register fuenfzehn Zeilen weiter unten, das die
// Groesse laengst als ratendes Feld fuehrte. Wer von oben nach unten liest, bekam zwei Aussagen
// ueber dieselbe Sache. Gefunden von der Konsistenzpruefung, nicht vom Testfeld.
//
// 💣 DER MEDIAN ERREICHT IHN NIE (Owner 24.08.2026: „wir ermitteln den median, der wert, den die
// editoren sehen ist der wert aus der zoombandeinstellung"). Eine zweite, graue Marke hiesse
// „richte dich nach dem Durchschnitt" -- das Gegenteil einer Vorgabe: sie zementierte den Bestand,
// statt ihn zu lenken. Im Prototyp stand eine solche Marke kurzzeitig und ist am selben Tag
// gefallen. Wer sie „ergaenzt", nimmt der Tafel ihren Sinn.

// Welcher Regler traegt welche Vorgabe. ⚠️ Die Spannen stehen im Markup (min/max am Element) und
// werden von dort gelesen -- eine zweite Angabe hier liefe beim ersten geaenderten Regler
// auseinander.
const AVESMAPS_LABEL_VORGABEMARKEN = [
	// 🔴 Die GROESSE ist wieder dabei (Owner 24.08.2026): der Regler bleibt, die Tafel schlaegt
	// nur vor. Sie traegt als einzige keinen Feldnamen aus `avesmapsEcosystemDisplayVorgabe`,
	// sondern ihre eigene Herleitung -- die Vorgabe ist eine KURVE ueber neun Zoomstufen, der
	// Regler aber eine Grundgroesse. Uebersetzt wird das in avesmapsEcosystemDisplayBasisGroesse.
	{ regler: "label-edit-size-range", marke: "label-edit-size-marke", basis: true },
	{ regler: "label-edit-curve-max-range", marke: "label-edit-curve-max-marke", feld: "curveMax" },
	{ regler: "label-edit-min-zoom", marke: "label-edit-min-zoom-marke", feld: "ab" },
	{ regler: "label-edit-max-zoom", marke: "label-edit-max-zoom-marke", feld: "bis" },
	{ regler: "label-edit-priority-range", marke: "label-edit-priority-marke", feld: "prio" },
];

/**
 * Wo die Marke steht. REIN -- kein DOM.
 *
 * 💣 NICHT einfach `anteil * 100%`. Der Reglerknopf hat eine Breite, sein Mittelpunkt wandert nur
 * ueber (100% - Knopfbreite); bei reinem Prozent steht die Marke an BEIDEN Enden sichtbar daneben
 * -- und an den Enden liegen die interessanten Werte (z0, z7).
 * ⚠️ Die 16 px sind die Knopfbreite aus dem Stylesheet. Sie stehen an zwei Stellen; die CSS-Regel
 * traegt den Vermerk.
 */
function avesmapsLabelVorgabeMarkePosition(wert, min, max) {
	const spanne = Number(max) - Number(min);
	const anteil = spanne === 0 ? 0 : Math.max(0, Math.min(1, (Number(wert) - Number(min)) / spanne));
	return "calc(" + (anteil * 100) + "% + " + (8 - anteil * 16) + "px)";
}

/**
 * Die fuenf Marken setzen -- Groesse, max. Namen, Zoomband (zwei) und Prioritaet.
 * ⚠️ Die ZAHL steht hier, damit ein vergessener Eintrag auffaellt; sie war einen Tag lang vier,
 * als die Groesse kurzzeitig kein Bedienelement hatte.
 * dem jemand die Art umstellt, zeigte sonst weiter die Marken der ALTEN -- das sieht aus wie eine
 * Vorgabe, die nicht stimmt.
 */
function avesmapsLabelZeichneVorgabeMarken() {
	const art = String(document.getElementById("label-edit-type")?.value || "");
	// 🔴 Die Vorgabe kommt aus dem geteilten Modul, gegen das auch die Karte zeichnet -- nicht aus
	// einer zweiten Tafel im Dialog. Fehlt es (eine Seite ohne das Modul), gibt es keine Marke:
	// eine geratene Marke waere schlimmer als keine.
	const vorgabe = (typeof avesmapsEcosystemDisplayVorgabe === "function")
		? avesmapsEcosystemDisplayVorgabe(art)
		: null;

	AVESMAPS_LABEL_VORGABEMARKEN.forEach((eintrag) => {
		const marke = document.getElementById(eintrag.marke);
		const regler = document.getElementById(eintrag.regler);
		if (!marke || !regler) {
			return;
		}
		// ⚠️ Die Groesse kommt aus der Kurve, nicht aus dem Vorgabesatz -- siehe das Register oben.
		const wert = eintrag.basis
			? (typeof avesmapsEcosystemDisplayBasisGroesse === "function"
				? Number(avesmapsEcosystemDisplayBasisGroesse(art)) : NaN)
			: (vorgabe ? Number(vorgabe[eintrag.feld]) : NaN);
		// ⚠️ „aus" (bis < ab) ist keine Stellung auf dem Balken -- dort gibt es nichts zu markieren.
		// ⚠️ „aus" (bis < ab) betrifft das BAND. Eine Art ohne Namen auf der Karte hat trotzdem
		// eine sinnvolle Grundgroesse -- ihre Marke bleibt stehen.
		const aus = !eintrag.basis && vorgabe && Number(vorgabe.bis) < Number(vorgabe.ab);
		if (!Number.isFinite(wert) || aus) {
			marke.hidden = true;
			return;
		}
		marke.hidden = false;
		marke.style.left = avesmapsLabelVorgabeMarkePosition(
			wert,
			Number(regler.min),
			Number(regler.max)
		);
		marke.title = "Vorgabe: " + wert;
	});
}

/**
 * Die Wahl unter mehreren Beschriftungen EINER Flaeche fuellen.
 *
 * 🔴 Sie erscheint NUR bei mehreren -- live 13 von 1026 Flaechen. Bei einer einzigen waere ein
 * Auswahlfeld mit einem Eintrag ein Bedienelement fuer nichts.
 *
 * 💣 EIN Wechsel VERWIRFT, was nicht gespeichert ist. Das Fenster fuehrt keine
 * Aenderungsverfolgung, also wird gefragt, statt zu raten -- lieber eine Rueckfrage zu viel als
 * eine verlorene Drehung. Der Fall ist selten genug, dass die Frage niemanden ermuedet.
 *
 * ⚠️ Gewechselt wird ueber `openLabelEditDialog` -- denselben Weg, den jeder Klick auf eine
 * Beschriftung geht. Ein zweiter Fuellweg waere die zweite Wahrheit ueber denselben Zustand.
 */
function syncLabelEditGeschwisterwahl(labelEntry) {
	const kasten = document.getElementById("landschaft-dialog-labelwahl");
	const wahl = document.getElementById("landschaft-dialog-labelwahl-select");
	if (!kasten || !wahl) {
		return 0;
	}
	const region = String(labelEntry?.label?.ecosystemRegionPublicId || "");
	const geschwister = (region !== "" && typeof findLabelEntriesByEcosystemRegion === "function")
		? findLabelEntriesByEcosystemRegion(region)
		: [];
	kasten.hidden = geschwister.length < 2;
	if (geschwister.length < 2) {
		wahl.innerHTML = "";
		return geschwister.length;
	}
	const offen = String(labelEntry?.label?.publicId || "");
	wahl.innerHTML = "";
	geschwister.forEach((eintrag, nummer) => {
		const option = document.createElement("option");
		option.value = String(eintrag.label.publicId || "");
		// ⚠️ Die Nummer ist eine ANZEIGE, keine Adresse -- gewaehlt wird ueber die public_id.
		option.textContent = (nummer + 1) + " von " + geschwister.length
			+ " — " + String(eintrag.label.text || "ohne Text");
		option.selected = option.value === offen;
		wahl.appendChild(option);
	});
	if (wahl.dataset.landschaftVerdrahtet !== "1") {
		wahl.dataset.landschaftVerdrahtet = "1";
		wahl.addEventListener("change", () => {
			const ziel = typeof findLabelEntryByPublicId === "function"
				? findLabelEntryByPublicId(String(wahl.value || "")) : null;
			if (!ziel) {
				return;
			}
			if (!window.confirm("Zu dieser Beschriftung wechseln? Ungespeicherte Änderungen an der jetzigen gehen verloren.")) {
				syncLabelEditGeschwisterwahl(labelEntry);
				return;
			}
			openLabelEditDialog({ labelEntry: ziel, reiter: "beschriftung" });
		});
	}
	return geschwister.length;
}

function openLabelEditDialog(options = {}) {
	// 💣 `paar: false` heisst „ich bin der GEGENPART, ruf mich nicht zurueck". Ohne den Riegel riefen
	// die zwei Oeffner einander im Kreis. Ausdruecklicher PARAMETER, kein Modulzustand -- ein Merker
	// daneben ueberlebte das Oeffnen und liesse beim zweiten Aufruf eine Haelfte weg.
	const istEinstieg = options.paar !== false;
	// 🔴 `options.reiter` kommt von den fuenf Aufrufern; ohne Angabe faellt es auf „beschriftung" --
	// wer diesen Oeffner ruft, meint eine Beschriftung.
	// ⚠️ Leer heisst „den Reiter NICHT anfassen" -- als Gegenpart gerufen gehoert der offene Reiter
	// dem anderen Oeffner, sonst spraenge „Eigenschaften …" einer Flaeche auf „Beschriftung".
	labelEditStartReiter = istEinstieg ? String(options.reiter || "beschriftung") : "";
	resetLabelEditForm();
	populateLabelEditForm(options);
	syncLabelEditGeschwisterwahl(options.labelEntry || null);
	// ⚠️ NACH dem Fuellen: vorher steht im Artwaehler noch die Art des zuletzt geoeffneten
	// Labels, und die Marken zeigten dessen Vorgabe.
	avesmapsLabelZeichneVorgabeMarken();
	// 🔴 DER QUELLEN-EDITOR: ein Mount-Aufruf, kein Neubau (AGENTS.md §5 -- Quellen leben an EINER
	// Stelle). Eine Beschriftung ist dort `entity_type = "region"` mit ihrer map_features-public_id;
	// genau dieses Paar liest die Karte schon, wenn sie die Quellenzeile der Infobox zeichnet.
	//
	// 💣 DER CONTAINER WIRD ERSETZT, BEVOR NEU GEMOUNTET WIRD. Das Bauteil haengt Zuhoerer an den
	// Knoten; ohne den Austausch stapeln sie sich bei jedem Oeffnen, und ein Klick loeste die
	// Aktion so oft aus, wie der Dialog schon offen war. Dasselbe Vorgehen wie im Ortseditor.
	// ⚠️ `__fsDetachAutocomplete` zuerst -- die Vorschlagsliste haengt am DOKUMENT, nicht am
	// Knoten, und ueberlebte den Austausch sonst als Waise.
	const quellenHost = document.getElementById("label-edit-feature-sources");
	if (quellenHost && typeof mountFeatureSourceEditor === "function") {
		if (typeof quellenHost.__fsDetachAutocomplete === "function") {
			quellenHost.__fsDetachAutocomplete();
		}
		const frisch = quellenHost.cloneNode(false);
		quellenHost.replaceWith(frisch);
		// 🔴 Schritt 5 des Quellen-Umbaus (03.09.2026): die Flaeche traegt die Quellen. Ist die Beschriftung an eine
		// Flaeche gebunden, gibt es HIER keinen Kasten -- der Kasten der Flaeche (Abschnitt „Fläche“ desselben
		// Fensters, mountEcosystemAreaSources) traegt sie, und ein zweiter Kasten mit derselben Liste laese sich
		// wie zwei Ablagen. Eine freie Beschriftung montiert wie bisher auf `region` + public_id.
		// ⚠️ Die public_id wird bei JEDER Anfrage frisch gelesen, nie beim Mounten eingefroren --
		// sonst schriebe ein Dialogwechsel die Quelle auf die zuletzt geoeffnete Beschriftung.
		const quellenZiel = typeof avesmapsLabelQuellenSchluessel === "function"
			? avesmapsLabelQuellenSchluessel(labelEditEntry?.label || {}) : { type: "region", id: "" };
		const quellenWohin = document.getElementById("label-edit-feature-sources-wohin");
		if (quellenZiel.type === "ecosystem") {
			frisch.hidden = true;
			if (quellenWohin) {
				quellenWohin.hidden = false;
				quellenWohin.textContent = "Die Quellen dieser Beschriftung hängen an der Fläche — sie stehen im Abschnitt „Fläche“ und gelten für alle ihre Beschriftungen.";
			}
		} else {
			frisch.hidden = false;
			if (quellenWohin) {
				quellenWohin.hidden = true;
			}
			void mountFeatureSourceEditor(
				frisch,
				"region",
				() => document.getElementById("label-edit-public-id")?.value || "",
				{ escape: escapeHtml }
			);
		}
	}
	setLabelEditDialogOpen(true);

	// 🔴 DIE FLAECHE ZULETZT (avesmapsLandschaftDialogLadeAuftraege). Bis zum 26.08.2026 wurde sie
	// GAR NICHT geladen -- der Reiter „Fläche" behauptete deshalb bei jeder der 703 Beschriftungen
	// mit Flaeche, sie liege auf keiner, und „Fläche löschen" tat auf den Klick lautlos nichts.
	//
	// ⚠️ Die Suche ist ASYNCHRON (`avesmapsEcosystemAreaPublicIdOfLabel` laedt notfalls die
	// Regionslisten nach), das Oeffnen der Beschriftung darf aber nicht darauf warten -- sonst
	// flackerte das Fenster. Deshalb nachgereicht; bis dahin steht der Reiter „Fläche" auf seinem
	// leeren Zustand, was fuer die 254 Beschriftungen ohne Flaeche der Endstand ist.
	//
	// 💣 KEIN Ansichtswechsel von hier aus (`wechsleAnsicht` bleibt aus): das Oeffnen eines Dialogs
	// darf die Karte nicht unter dem Benutzer wegziehen. Liegt die Flaeche in einer anderen Ebene,
	// bleibt ihre Haelfte leer -- richtig, denn dort ist sie ohnehin nicht bearbeitbar.
	if (istEinstieg) {
		void (async () => {
			const label = options.labelEntry?.label || null;
			let flaechePublicId = "";
			if (label && typeof avesmapsEcosystemAreaPublicIdOfLabel === "function") {
				try {
					flaechePublicId = String(await avesmapsEcosystemAreaPublicIdOfLabel(label) || "");
				} catch (fehler) {
					// 🔴 Im Zweifel KEINE Flaeche: eine geratene waere schlimmer als keine -- das
					// Speichern schriebe dann auf ein fremdes Objekt.
					flaechePublicId = "";
				}
			}
			if (flaechePublicId !== "" && typeof window.AvesmapsEcosystemProperties?.open === "function") {
				await window.AvesmapsEcosystemProperties.open(flaechePublicId, { paar: false });
			} else if (typeof avesmapsLandschaftDialogHaelfte === "function") {
				avesmapsLandschaftDialogHaelfte("flaeche", false);
			}
		})();
	}
}

function syncLabelZoomRangeOutputs(event = null) {
	const minInputElement = document.getElementById("label-edit-min-zoom");
	const maxInputElement = document.getElementById("label-edit-max-zoom");
	const minNumElement = document.getElementById("label-edit-min-zoom-num");
	const maxNumElement = document.getElementById("label-edit-max-zoom-num");
	if (!minInputElement || !maxInputElement) {
		return;
	}

	let minZoom = Number.parseInt(minInputElement.value, 10);
	let maxZoom = Number.parseInt(maxInputElement.value, 10);
	if (event?.currentTarget === minInputElement && minZoom > maxZoom) {
		maxZoom = minZoom;
		maxInputElement.value = String(maxZoom);
	} else if (event?.currentTarget === maxInputElement && maxZoom < minZoom) {
		minZoom = maxZoom;
		minInputElement.value = String(minZoom);
	}

	if (minNumElement) {
		minNumElement.value = String(minZoom);
	}
	if (maxNumElement) {
		maxNumElement.value = String(maxZoom);
	}
	if (event?.currentTarget && map.getZoom() !== Number(event.currentTarget.value)) {
		map.setZoom(Number(event.currentTarget.value));
	}
}

function syncLabelZoomNumberInputs(event = null) {
	const minInputElement = document.getElementById("label-edit-min-zoom");
	const maxInputElement = document.getElementById("label-edit-max-zoom");
	const minNumElement = document.getElementById("label-edit-min-zoom-num");
	const maxNumElement = document.getElementById("label-edit-max-zoom-num");
	if (!minInputElement || !maxInputElement) {
		return;
	}
	const clamp = (value) => Math.max(0, Math.min(7, Number.parseInt(value, 10) || 0));
	if (minNumElement) {
		minInputElement.value = String(clamp(minNumElement.value));
	}
	if (maxNumElement) {
		maxInputElement.value = String(clamp(maxNumElement.value));
	}
	syncLabelZoomRangeOutputs({ currentTarget: event?.currentTarget === maxNumElement ? maxInputElement : minInputElement });
}

function syncLabelPriorityOutput() {
	const inputElement = document.getElementById("label-edit-priority");
	const outputElement = document.getElementById("label-edit-priority-output");
	if (!inputElement || !outputElement) {
		return;
	}

	outputElement.value = inputElement.value;
	outputElement.textContent = inputElement.value;
}

// Zahl+Slider-Reihen (Groesse/Rotation/Prioritaet): Slider aus den Zahlenwerten initialisieren.
function syncLabelSliderRowsFromNumbers() {
	document.querySelectorAll("#landschaft-dialog .label-edit-sliderrow").forEach((row) => {
		const numberInput = row.querySelector('input[type="number"]');
		const rangeInput = row.querySelector('input[type="range"]');
		if (numberInput && rangeInput) {
			rangeInput.value = numberInput.value;
		}
	});
}

// Zahl <-> Slider in einer Sliderrow spiegeln (ohne Seiteneffekt; Zoom hat eigene Logik).
document.addEventListener("input", (event) => {
	const target = event.target;
	if (!target || typeof target.closest !== "function") {
		return;
	}
	const row = target.closest(".label-edit-sliderrow");
	if (!row) {
		return;
	}
	const numberInput = row.querySelector('input[type="number"]');
	const rangeInput = row.querySelector('input[type="range"]');
	if (!numberInput || !rangeInput) {
		return;
	}
	if (target === rangeInput) {
		numberInput.value = rangeInput.value;
	} else {
		rangeInput.value = numberInput.value;
	}
	// 🔴 Und sofort auf die Karte (Owner 2026-07-29). HIER und nicht in einem eigenen Zuhörer: Größe,
	// Drehung und Priorität sitzen alle drei in einer solchen Reihe, und an dieser Stelle ist das
	// Zahlenfeld nachweislich schon abgeglichen. Ein zweiter Zuhörer am Dialog liefe VOR diesem (er
	// sitzt tiefer im Baum) und läse beim Ziehen des Reglers noch den alten Zahlenwert.
	applyLabelDisplayPreview();
});

// Zuletzt genutzte Label-DARSTELLUNG (Groesse/Rotation/Zoom-Band/Prioritaet/Nodix) merken bzw. lesen.
// Damit werden NEUE Labels vorbefuellt; Text & Kategorie werden bewusst NICHT gemerkt.
function persistLabelDisplaySettings(payload) {
	try {
		window.localStorage.setItem("avesmapsLabelEditorLastDisplay", JSON.stringify({
			size: payload.size,
			rotation: payload.rotation,
			minZoom: payload.min_zoom,
			maxZoom: payload.max_zoom,
			priority: payload.priority,
			isNodix: payload.is_nodix,
		}));
	} catch (error) {
		/* localStorage nicht verfuegbar -> Feature inaktiv */
	}
}

function readRememberedLabelDisplaySettings() {
	try {
		const raw = window.localStorage.getItem("avesmapsLabelEditorLastDisplay");
		if (!raw) {
			return null;
		}
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" ? parsed : null;
	} catch (error) {
		return null;
	}
}

function buildLabelEditPayload(formElement) {
	const formData = new FormData(formElement);
	const publicId = String(formData.get("public_id") || "").trim();
	const action = publicId ? "update_label" : "create_label";
	const payload = {
		action,
		public_id: publicId,
		text: String(formData.get("text") || "").trim(),
		feature_subtype: String(formData.get("feature_subtype") || "region").trim(),
		size: Number.parseInt(String(formData.get("size") || "18"), 10),
		rotation: Number.parseInt(String(formData.get("rotation") || "0"), 10),
		min_zoom: Number.parseInt(String(formData.get("min_zoom") || "0"), 10),
		max_zoom: Number.parseInt(String(formData.get("max_zoom") || "5"), 10),
		priority: Number.parseInt(String(formData.get("priority") || "3"), 10),
		is_nodix: formData.get("is_nodix") === "on",
		// 🔴 Die Merkliste reist IMMER mit, auch leer: eine leere Liste ist dasselbe wie ein fehlender
		// Schlüssel („nichts kam aus dem Wiki, also alles von uns"), und das ist die sichere Richtung.
		// ⚠️ Kein Rückfall auf `[]`, wenn die Funktion fehlt -- dann sagt dieses Speichern gar nichts,
		// und der Server stempelt `manual`. Überschützen ist harmlos, überschreiben nicht.
		...(typeof getLabelWikiUebernommenPayload === "function"
			? { wiki_uebernommen: getLabelWikiUebernommenPayload() }
			: {}),
		// ⚠️ KEIN `other_source` mehr (03.09.2026, Schritt 4 des Quellen-Umbaus): die Quellen einer Beschriftung
		// haengen im Katalog (`region` + public_id, Kasten „Quellen“ unten), die Altquellen sind gewandert.
	};

	// 🔴 DIE WIKI-ZUWEISUNG REIST NUR MIT, WENN SIE SEIT DEM LADEN ANGEFASST WURDE -- oder beim Anlegen,
	// wo es keinen geladenen Stand gibt. `update_label` liest einen FEHLENDEN Schlüssel als „nicht
	// geändert" (dieselbe Regel wie bei `wiki_no_article` darunter).
	// 💣 Bis zum 03.09.2026 stand sie in JEDEM Rumpf. Im vereinigten Fenster ist der Kasten der
	// Beschriftung verborgen, sobald eine Fläche da ist („es gewinnt die Fläche") -- ihr Formular
	// schickte trotzdem das GELADENE Nest mit und schrieb damit zurück, was die Fläche im selben
	// Speichern gerade entfernt hatte. Das war „Lawaralîr"/„Cronwald" (Owner 03.09.2026).
	// ⚠️ Fehlt der Leser (review-label-wiki.js nicht geladen), reist beim Ändern NICHTS -- ein `null`
	// an seiner Stelle löschte die Zuweisung bei jedem Speichern.
	const wikiGeaendert = typeof getLabelWikiRegionGeaendert === "function" && getLabelWikiRegionGeaendert();
	if (action === "create_label" || wikiGeaendert) {
		payload.wiki_region = typeof getLabelWikiRegionPayload === "function" ? getLabelWikiRegionPayload() : null;
	}

	// 🔴 Die Zuweisung zur Landschaftsfläche reist NUR mit, wenn das Feld überhaupt gefüllt wurde.
	// `update_label` schreibt genau die Schlüssel, die im Payload stehen (array_key_exists), und ein
	// mitgeschicktes leeres Feld löschte damit eine bestehende Zuweisung -- bei jedem Speichern eines
	// Labels, dessen Auswahl mangels geladener Regionsliste nie befüllt war. Dieselbe Falle, an der
	// `other_source` schon einmal hing (features.php:2266).
	// 🔴 DER DRITTE ZUSTAND, und er reist NUR MIT, WENN DAS HÄKCHEN SEIT DEM LADEN UMGELEGT WURDE
	// (Owner-Entscheid 16.08.2026, anstelle eines `expected_revision`). `update_label` liest einen
	// FEHLENDEN Schlüssel als „nicht geändert" -- so nimmt ein alter, längst offener Dialog die
	// Entscheidung eines zweiten Editors nicht beim nächsten beliebigen Speichern zurück.
	// 💣 GEPRÜFT WIRD VERÄNDERT, NICHT GESETZT: ein bewusst ENTFERNTES Häkchen schickt `false`.
	const keinArtikel = typeof getLabelWikiNoArticlePayload === "function" ? getLabelWikiNoArticlePayload() : null;
	if (keinArtikel !== null) {
		payload.wiki_no_article = keinArtikel;
	}

	const regionSection = document.getElementById("label-edit-region-section");
	const regionSelect = document.getElementById("label-edit-region");
	if (regionSection && regionSelect && !regionSection.hidden) {
		payload.ecosystem_region_public_id = String(regionSelect.value || "");
	}

	// 💣 Only ever send the key for peaks. The server treats a PRESENT key as "the caller means it"
	// (array_key_exists), so sending it for a non-peak label would write a height onto something that
	// has no business carrying one -- and sending it as `null` from a hidden row would DELETE the
	// height of a label that was merely retyped and typed back.
	if (typeof isEcosystemPeakSubtype === "function" && isEcosystemPeakSubtype(payload.feature_subtype)) {
		const rawHeight = String(formData.get("height_schritt") ?? "").trim();
		payload.height_schritt = rawHeight === "" ? null : rawHeight;
	}

	if (action === "create_label") {
		payload.lat = Number.parseFloat(String(formData.get("lat") || ""));
		payload.lng = Number.parseFloat(String(formData.get("lng") || ""));
		delete payload.public_id;
	}

	// 💣 HIER, SYNCHRON. Der Schreibweg zur Region liest die Bedienelemente sonst erst nach einem
	// `await` -- und da ist das Formular schon zurueckgesetzt (siehe labelCurveSchnappschuss).
	labelCurveSchnappschuss = leseLabelCurveAenderung();

	// Zuletzt genutzte Darstellung merken -> neue Labels werden damit vorbefuellt (s. populateLabelEditForm).
	persistLabelDisplaySettings(payload);
	return payload;
}

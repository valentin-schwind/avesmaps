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

function setLabelEditDialogOpen(isOpen, { resetForm = false } = {}) {
	$("#label-edit-overlay").prop("hidden", !isOpen);
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

// Der Fenstertitel des Label-Dialogs. Leere Ebene -> „Label bearbeiten" (Kontinente, Meere, freie
// Kartentitel gehören zu keiner Landschaftsebene), sonst „Vegetations-Label bearbeiten" usw.
function setLabelEditDialogTitle(kind) {
	const titleElement = document.getElementById("label-edit-title");
	if (titleElement && typeof ecosystemDialogTitle === "function") {
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
	document.getElementById("label-edit-type").value = label.labelType || "region";
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
		setLabelWikiRegion(label.wikiRegion || null);
	}
	// „Andere Quelle" ist aus diesem Dialog raus (Owner 2026-07-28) -- weder gelesen noch geschrieben.
	// Ein bereits gespeicherter Wert bleibt am Feature liegen, weil der Save den Schluessel nicht mehr
	// mitschickt und der Server nur schreibt, was im Payload steht.
	if (typeof writeOtherSourceToForm === "function") {
		writeOtherSourceToForm("label-edit", label.otherSource);
	}
	// 🪤 ZWEISTUFIG. Der Titel nennt die Ebene des Labels („Vegetations-Label bearbeiten"), aber die
	// Ebene steht erst fest, wenn die Region aufgelöst ist -- und das ist ein asynchroner Schritt
	// (renderLabelCarrierNote lädt dafür die Regionslisten). Hier also erst der allgemeine Titel; die
	// Verfeinerung kommt dort, sobald die Antwort da ist. Ein flackernder Titel wäre schlimmer als ein
	// später richtiger, und ein Label OHNE Fläche bleibt dauerhaft beim allgemeinen.
	// Ausgangswerte merken, BEVOR ein Regler sie überschreibt -- daraus besteht die Rücknahme.
	beginLabelDisplayPreview(labelEntry);
	setLabelEditDialogTitle("");
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
	setLabelEditDialogTitle(region?.kind || "");
	fillLabelRegionSelect(label, region);
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
	select.appendChild(new Option(labelEmptyTypeLabel(kind), "region"));
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
	section.hidden = !geladen;
	if (!geladen) {
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
	if (event.target && event.target.id === "label-edit-type") {
		syncLabelHeightRow();
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

function openLabelEditDialog(options = {}) {
	resetLabelEditForm();
	populateLabelEditForm(options);
	setLabelEditDialogOpen(true);
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
	document.querySelectorAll("#label-edit-dialog .label-edit-sliderrow").forEach((row) => {
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
		wiki_region: typeof getLabelWikiRegionPayload === "function" ? getLabelWikiRegionPayload() : null,
		// Manuelle Quellen bleiben am Label (Owner 2026-07-28). Der Server fasst other_source nur an,
		// wenn der Schlüssel mitkommt -- deshalb ist Mitschicken hier sicher und Weglassen wäre es auch.
		other_source: typeof readOtherSourceFromForm === "function" ? readOtherSourceFromForm("label-edit") : { url: "", label: "" },
	};

	// 🔴 Die Zuweisung zur Landschaftsfläche reist NUR mit, wenn das Feld überhaupt gefüllt wurde.
	// `update_label` schreibt genau die Schlüssel, die im Payload stehen (array_key_exists), und ein
	// mitgeschicktes leeres Feld löschte damit eine bestehende Zuweisung -- bei jedem Speichern eines
	// Labels, dessen Auswahl mangels geladener Regionsliste nie befüllt war. Dieselbe Falle, an der
	// `other_source` schon einmal hing (features.php:2266).
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

	// Zuletzt genutzte Darstellung merken -> neue Labels werden damit vorbefuellt (s. populateLabelEditForm).
	persistLabelDisplaySettings(payload);
	return payload;
}

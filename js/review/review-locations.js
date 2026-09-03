// A DISABLED control is not submittable: FormData runs the HTML "constructing the entry list" algorithm,
// which skips it entirely -- .get() then answers null, not "". The change-suggestion dialog locks the
// category exactly that way (applyChangeSuggestionContext: typeSelect.disabled = true), so reading it out
// of the entry list loses it and the `|| "location"` below quietly turns a path/region/territory report
// into a settlement one -- which the server rejects with "Die Ortsgroesse ist ungueltig.", naming a field
// the dialog never showed. Read the CONTROL instead; formElement.elements holds disabled ones too.
// (`size` deliberately keeps reading the entry list: it is disabled only when the type is not "location",
// and then the server ignores it anyway -- sending a fake "dorf" would be worse than sending nothing.)
function locationReportControlValue(formElement, formData, name) {
	const submitted = formData.get(name);
	if (submitted !== null) {
		return String(submitted);
	}
	const control = formElement?.elements?.[name];
	return typeof control?.value === "string" ? control.value : "";
}

function buildLocationReportRequestPayload(formElement) {
	const formData = new FormData(formElement);

	return {
		report_type: locationReportControlValue(formElement, formData, "report_type").trim() || "location",
		name: String(formData.get("name") || "").trim(),
		size: String(formData.get("size") || "").trim(),
		sources: typeof collectLocationReportSources === "function" ? collectLocationReportSources() : [],
		reporter_name: String(formData.get("reporter_name") || "").trim(),
		wiki_url: String(formData.get("wiki_url") || "").trim(),
		comment: String(formData.get("comment") || "").trim(),
		lat: Number.parseFloat(String(formData.get("lat") || "")),
		lng: Number.parseFloat(String(formData.get("lng") || "")),
		page_url: String(formData.get("page_url") || "").trim(),
		client_version: String(formData.get("client_version") || "").trim(),
		elapsed_ms: Math.max(0, Date.now() - Number.parseInt(String(formData.get("opened_at") || "0"), 10)),
		website: String(formData.get("website") || "").trim(),
		report_mode: String(formData.get("report_mode") || "new").trim(),
		entity_type: String(formData.get("entity_type") || "").trim(),
		entity_public_id: String(formData.get("entity_public_id") || "").trim(),
	};
}

// ---- Die Quellen der Meldung: der Link ist die Quelle ----
// Entwurf docs/superpowers/specs/2026-09-03-quellen-meldeformular-design.md §3. Owner 03.09.2026: „die
// sollen einfach den link pasten. erst wir im backend sollen sehen, ob der korpus passt oder ein neuer
// erkannt wurde." Die Regel (Link oder Katalogtreffer; Titel, Seite, Abdeckung, Lizenz, Namensnennung als
// Angebote; nie Art, nie „offiziell") steht in js/review/meldung-quellen.js -- dieselbe, die der
// Kartenvorschlag ruft. Hier nur das Lesen der Felder und die Liste.
// 💣 Bis zum 03.09.2026 war der NAME Pflicht und der Link optional -- und der Knopf tat still nichts,
// wenn nur der Link ausgefuellt war (Owner: „beachte, dass der button derzeit nicht funktioniert").
let locationReportSources = [];

// 🔴 Die Regel wohnt in js/review/meldung-quellen.js. Im Browser steht sie global, unter Node (Tests, die diese
// Datei `require`n) wird sie geholt -- und fehlt sie, gibt es einen lauten Fehler statt einer Ersatzfassung:
// dasselbe Muster wie featureSourcePagesShorten im Quellen-Bauteil, aus denselben Gruenden.
function meldungQuellenRegel(name) {
	const geteilt = (typeof module !== "undefined" && module.exports)
		? require("./meldung-quellen.js")[name]
		: (typeof window !== "undefined" ? window[name] : null);
	if (typeof geteilt !== "function") {
		throw new Error("meldung-quellen.js fehlt -- sie traegt die Regel, was eine Quelle der Meldung ist");
	}
	return geteilt;
}
// Der Treffer aus der Vorschlagsliste des Katalogs (Instruction 5a): Kennung und der Titel, den das
// Feld dann zeigt. Wer danach weitertippt, meint die Zeile nicht mehr (input-Listener setzt zurueck).
let locationReportPickedSourceId = 0;
let locationReportPickedLabel = "";
let detachLocationReportAutocomplete = null;

function showLocationReportSourceNote(text) {
	const note = document.getElementById("report-source-note");
	if (!note) {
		return;
	}
	note.textContent = text || "";
	note.hidden = !text;
}

function renderLocationReportSourcesList() {
	const list = document.getElementById("location-report-sources-list");
	if (!list) {
		return;
	}
	if (!locationReportSources.length) {
		list.innerHTML = '<div class="report-sources__empty">' + escapeHtml(tr("report.sourcesEmpty", "Noch keine Quelle hinzugefügt.")) + "</div>";
		return;
	}
	list.innerHTML = locationReportSources
		.map((source, index) => {
			const anzeige = meldungQuellenRegel("avesmapsMeldungQuelleAnzeige")(source);
			const name = anzeige.url
				? `<a href="${escapeHtml(anzeige.url)}" target="_blank" rel="noopener" title="${escapeHtml(anzeige.url)}">${escapeHtml(anzeige.text)} ↗</a>`
				: `<span>${escapeHtml(anzeige.text)}</span>`;
			return (
				'<div class="report-sources__row">' +
				name +
				(anzeige.ausKatalog ? `<span class="report-sources__katalog">${escapeHtml(tr("report.sourceFromCatalog", "aus dem Katalog"))}</span>` : "") +
				(anzeige.pages ? `<span class="report-sources__pages">S. ${escapeHtml(anzeige.pages)}</span>` : "") +
				`<button type="button" class="report-sources__remove" data-remove-report-source="${index}" aria-label="${escapeHtml(tr("report.sourceRemove", "Quelle entfernen"))}">✕</button>` +
				"</div>"
			);
		})
		.join("");
}

function readLocationReportSourceInputs() {
	const wert = (id) => String(document.getElementById(id)?.value || "");
	return {
		ref: wert("report-source-ref"),
		source_id: locationReportPickedSourceId,
		pick_label: locationReportPickedLabel,
		title: wert("report-source-title"),
		pages: wert("report-source-pages"),
		reference_kind: wert("report-source-kind"),
		license: wert("report-source-license"),
		attribution: wert("report-source-attribution"),
	};
}

function clearLocationReportSourceInputs() {
	locationReportPickedSourceId = 0;
	locationReportPickedLabel = "";
	["report-source-ref", "report-source-pages", "report-source-title", "report-source-kind", "report-source-license", "report-source-attribution"].forEach((id) => {
		const element = document.getElementById(id);
		if (element) {
			element.value = "";
		}
	});
	// Die Falte „Mehr zur Quelle" ist nach jedem Eintrag wieder zu -- dieselbe Regel wie beim
	// Quellenkasten des Editors („immer mit klappe zu", Owner 03.09.2026).
	const mehr = document.getElementById("report-source-mehr");
	if (mehr) {
		mehr.open = false;
	}
}

// Der Satz zur Absage. 🔴 Hoerbar, nicht still: bis zum 03.09.2026 kehrte der Knopf ohne Namen wortlos
// zurueck, und das sah aus wie ein kaputter Knopf.
function locationReportSourceRejectionText(grund) {
	return grund === "leer"
		? tr("report.sourceNeedRef", "Bitte den Link zur Quelle einfügen — oder einen Titel aus der Liste wählen.")
		: tr("report.sourceNeedLink", "Das ist kein Link. Bitte die Adresse der Seite einfügen (https://…) — oder einen Titel aus der Vorschlagsliste wählen.");
}

function addLocationReportSourceFromInputs() {
	const ergebnis = meldungQuellenRegel("avesmapsMeldungQuelleAusEingabe")(readLocationReportSourceInputs());
	if (!ergebnis.ok) {
		showLocationReportSourceNote(locationReportSourceRejectionText(ergebnis.grund));
		document.getElementById("report-source-ref")?.focus();
		return false;
	}
	locationReportSources.push(ergebnis.quelle);
	renderLocationReportSourcesList();
	clearLocationReportSourceInputs();
	showLocationReportSourceNote("");
	document.getElementById("report-source-ref")?.focus();
	return true;
}

// Instruction 5a: die Vorschlagsliste des Katalogs am Hauptfeld -- ein Titel wird nur mit Treffer zur
// Quelle. Wired ONCE: #report-source-ref ist statisches Markup und wird nie neu gezeichnet; ein Anhaengen
// bei jedem Oeffnen wuerde Listener und verwaiste Vorschlagskaesten stapeln.
function initLocationReportSourceAutocomplete() {
	if (detachLocationReportAutocomplete || typeof attachSourceAutocomplete !== "function") {
		return;
	}
	const refInput = document.getElementById("report-source-ref");
	if (!refInput) {
		return;
	}
	refInput.addEventListener("input", () => {
		locationReportPickedSourceId = 0;
		locationReportPickedLabel = "";
		showLocationReportSourceNote("");
	});
	// `ohneMarken`: dem Melder keine Art und kein „offiziell" in der Vorschlagsliste (Regel 2 des Entwurfs).
	detachLocationReportAutocomplete = attachSourceAutocomplete(refInput, {
		ohneMarken: true,
		onPick(item) {
			locationReportPickedSourceId = Number(item.source_id) || 0;
			locationReportPickedLabel = String(item.label || "");
			refInput.value = locationReportPickedLabel;
			// Die Seitenzahl ist das Einzige, was zu DIESER Fundstelle gehoert und noch zu tippen ist.
			document.getElementById("report-source-pages")?.focus();
		},
	});
}

// Die Lizenzauswahl kommt aus der EINEN Tafel (FEATURE_SOURCE_LICENSES, feature-source-markup.js) --
// dieselbe wie im Quellenkasten des Editors. Kein Abschreiben: eine Liste, die einen von zwei
// Erzeugern bindet, ist keine Liste.
function initLocationReportSourceLicenseOptions() {
	const select = document.getElementById("report-source-license");
	if (!select || typeof FEATURE_SOURCE_LICENSES !== "object" || select.dataset.gefuellt === "1") {
		return;
	}
	Object.keys(FEATURE_SOURCE_LICENSES).forEach((key) => {
		const option = document.createElement("option");
		option.value = key;
		option.textContent = String(FEATURE_SOURCE_LICENSES[key].label || key);
		select.appendChild(option);
	});
	select.dataset.gefuellt = "1";
}

function removeLocationReportSource(index) {
	if (index >= 0 && index < locationReportSources.length) {
		locationReportSources.splice(index, 1);
		renderLocationReportSourcesList();
	}
}

// Die hinzugefuegten Zeilen PLUS eine ausgefuellte, noch nicht hinzugefuegte (der Melder hat den Knopf
// vergessen) -- aber nur, wenn sie eine gueltige Quelle ergibt; ein halber Titel reist nicht mit.
function collectLocationReportSources() {
	const pending = meldungQuellenRegel("avesmapsMeldungQuelleAusEingabe")(readLocationReportSourceInputs());
	return pending.ok ? [...locationReportSources, pending.quelle] : [...locationReportSources];
}

function resetLocationReportSources() {
	locationReportSources = [];
	clearLocationReportSourceInputs();
	showLocationReportSourceNote("");
	renderLocationReportSourcesList();
}

function syncLocationReportTypeFields() {
	const reportType = String(document.getElementById("location-report-type")?.value || "location");
	const sizeFieldElement = document.getElementById("location-report-size-field");
	const sizeSelectElement = document.getElementById("location-report-size");
	const sourceInputElement = document.getElementById("location-report-source");
	const isLocationReport = reportType === "location";
	const isCommentReport = reportType === "comment";
	if (sizeFieldElement) {
		sizeFieldElement.hidden = !isLocationReport;
	}
	if (sizeSelectElement) {
		sizeSelectElement.required = isLocationReport;
		// Kontext-Sperre, kein Absende-Zustand: sie muss einen Fehlschlag überleben (review-pending.js).
		setFieldContextLocked(sizeSelectElement, !isLocationReport);
		if (!isLocationReport) {
			sizeSelectElement.value = "dorf";
		}
	}
	if (sourceInputElement) {
		sourceInputElement.required = !isCommentReport;
		sourceInputElement.closest(".location-report-form__field").querySelector("span").textContent = isCommentReport
			? tr("report.sourceLabelOptional", "Quelle (optional)")
			: tr("report.sourceLabel", "Quelle (Abenteuer, Regionalband, etc.) *");
	}
}

function resetLocationReportForm() {
	const formElement = getLocationReportFormElement();
	if (!formElement) {
		return;
	}

	formElement.reset();
	resetLocationReportSources();
	clearChangeSuggestionMode();
	locationReportLatLng = null;
	document.getElementById("location-report-coordinates").textContent = "-";
	document.getElementById("location-report-lat").value = "";
	document.getElementById("location-report-lng").value = "";
	document.getElementById("location-report-page-url").value = "";
	document.getElementById("location-report-client-version").value = "";
	document.getElementById("location-report-opened-at").value = "";
	setLocationReportStatus();
}

function resetLocationEditForm() {
	const formElement = getLocationEditFormElement();
	if (!formElement) {
		return;
	}

	const publicId = document.getElementById("location-edit-public-id")?.value || "";
	formElement.reset();
	locationEditLatLng = null;
	locationEditMarkerEntry = null;
	activeReviewReportId = null;
	activeReviewReportSource = null;
	activeReviewReportSourceQueue = [];
	if (typeof clearChangeReportFieldMarks === "function") { clearChangeReportFieldMarks(); }
	// Der Wunsch-Kasten gehoert dem Dialog, nicht dem Zeichendurchlauf -- deshalb hier und nicht in
	// clearChangeReportFieldMarks(), das waehrend des Aufbaus laeuft (review-report-flow.js).
	if (typeof hideLocationEditChangeRequest === "function") { hideLocationEditChangeRequest(); }
	pendingChangeReportMove = null;
	pendingCrossingConversionPublicId = null;
	pendingCrossingConversionName = "";
	pendingCrossingConversionIsNodix = false;
	void releaseFeatureSoftLock(publicId);
	setLocationEditStatus();
}

function updateLocationReportDialogAvailability() {
	const serviceNoteElement = getLocationReportServiceNoteElement();
	const submitButtonElement = document.getElementById("location-report-submit");
	const isConfigured = isLocationReportServiceConfigured();

	if (serviceNoteElement) {
		serviceNoteElement.hidden = isConfigured;
	}

	if (submitButtonElement && !isLocationReportSubmissionPending) {
		submitButtonElement.disabled = !isConfigured;
	}
}

function formatLocationReportCoordinates(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	return `${normalizedLatLng.lat.toFixed(3)}, ${normalizedLatLng.lng.toFixed(3)}`;
}

function populateLocationReportForm(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	locationReportLatLng = normalizedLatLng;
	document.getElementById("location-report-type").value = "location";
	document.getElementById("location-report-coordinates").textContent = formatLocationReportCoordinates(normalizedLatLng);
	document.getElementById("location-report-lat").value = normalizedLatLng.lat.toFixed(3);
	document.getElementById("location-report-lng").value = normalizedLatLng.lng.toFixed(3);
	document.getElementById("location-report-page-url").value = window.location.href;
	document.getElementById("location-report-client-version").value = ICON_ASSET_VERSION;
	document.getElementById("location-report-opened-at").value = String(Date.now());
	document.getElementById("location-report-size").value = "dorf";
	syncLocationReportTypeFields();
}

function setLocationReportDialogOpen(isOpen, { resetForm = false } = {}) {
	if (!isOpen && isLocationReportSubmissionPending) {
		return;
	}

	$("#location-report-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		updateLocationReportDialogAvailability();
		getLocationReportDialogElement()?.focus();
		document.getElementById("location-report-name")?.focus();
		return;
	}

	if (resetForm) {
		resetLocationReportForm();
	}
}

function setLocationEditDialogOpen(isOpen, { resetForm = false } = {}) {
	if (!isOpen && isLocationEditSubmissionPending) {
		return;
	}

	$("#location-edit-overlay").prop("hidden", !isOpen);
	syncModalDialogBodyState();

	if (isOpen) {
		getLocationEditDialogElement()?.focus();
		document.getElementById("location-edit-name")?.focus();
		return;
	}

	if (resetForm) {
		resetLocationEditForm();
	}
}

function openLocationReportDialog(latlng) {
	resetLocationReportForm();
	updateLocationReportDialogAvailability();
	populateLocationReportForm(latlng);
	setLocationReportDialogOpen(true);
}

// Community "Änderung vorschlagen": open the report form in change mode for an existing element. The
// category + name are locked and prefilled; for settlements the size stays editable (a size change may be
// exactly what is proposed). Coordinates default to the element anchor, else the current map centre --
// they are only a rough locator; entity_public_id authoritatively identifies the element.
function openChangeSuggestionDialog(ctx) {
	ctx = ctx || {};
	resetLocationReportForm();
	updateLocationReportDialogAvailability();
	applyChangeSuggestionContext(ctx);
	setLocationReportDialogOpen(true);
	// Focus the description (the editable core), not the locked name.
	document.getElementById("location-report-comment")?.focus();
}

function applyChangeSuggestionContext(ctx) {
	let lat = Number.parseFloat(String(ctx.lat));
	let lng = Number.parseFloat(String(ctx.lng));
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		const centre = (typeof map !== "undefined" && map && typeof map.getCenter === "function") ? map.getCenter() : { lat: 512, lng: 512 };
		lat = centre.lat;
		lng = centre.lng;
	}
	lat = Math.min(1024, Math.max(0, lat));
	lng = Math.min(1024, Math.max(0, lng));
	locationReportLatLng = L.latLng(lat, lng); // Submit-Handler prueft die JS-Variable (review-report-flow.js), sonst "Position ungueltig"

	const typeSelect = document.getElementById("location-report-type");
	const nameInput = document.getElementById("location-report-name");
	const sizeSelect = document.getElementById("location-report-size");
	const commentField = document.getElementById("location-report-comment");
	const reportType = ctx.reportType || "sonstiges";

	document.getElementById("location-report-mode").value = "change";
	document.getElementById("location-report-entity-type").value = ctx.entityType || "";
	document.getElementById("location-report-entity-id").value = ctx.entityId || "";

	// Category locked + preselected. 💣 Locked because the report already names a concrete element via
	// entity_type/entity_public_id -- a category that disagrees with it produces a change report the
	// review dispatch routes to the wrong editor. The lock must therefore outlive a failed submit,
	// which is what setFieldContextLocked marks (review-pending.js).
	if (typeSelect) {
		typeSelect.value = reportType;
		setFieldContextLocked(typeSelect, true);
	}

	// Name prefilled but EDITABLE: users may propose a corrected spelling (owner: name changes are allowed,
	// since users pointed out wrong spellings). The editor reviews the proposed name before applying it.
	if (nameInput) {
		nameInput.value = ctx.name || "";
		nameInput.readOnly = false;
	}

	// Position zeigt die IST-Position des Elements (aus ctx). Nicht Pflicht (report-flow ueberspringt die
	// Pruefung im Aenderungsmodus), aber via "Neue Position vorschlagen" kann der Nutzer einen neuen Punkt waehlen.
	document.getElementById("location-report-coordinates").textContent = formatLocationReportCoordinates(L.latLng(lat, lng));
	const pickPositionBtn = document.getElementById("location-report-pick-position");
	if (pickPositionBtn) { pickPositionBtn.hidden = false; }
	document.getElementById("location-report-lat").value = lat.toFixed(3);
	document.getElementById("location-report-lng").value = lng.toFixed(3);
	document.getElementById("location-report-page-url").value = window.location.href;
	document.getElementById("location-report-client-version").value = ICON_ASSET_VERSION;
	document.getElementById("location-report-opened-at").value = String(Date.now());

	// Size: editable + prefilled for settlements (report_type=location); hidden for other types
	// (syncLocationReportTypeFields hides it for anything that is not "location").
	if (reportType === "location" && sizeSelect && typeof sizeSlugFromLocationType === "function") {
		sizeSelect.value = sizeSlugFromLocationType(ctx.size);
	}
	syncLocationReportTypeFields();

	// Description becomes the required core field; sources become optional.
	if (commentField) {
		commentField.required = true;
		const label = commentField.closest(".location-report-form__field")?.querySelector("span");
		if (label) {
			label.textContent = tr("report.changeCommentLabel", "Was soll geändert werden? *");
		}
	}
	const sourcesLabel = document.getElementById("location-report-sources-label");
	if (sourcesLabel) {
		sourcesLabel.textContent = tr("report.changeSourcesLabel", "Quellen (optional) — Link zur Seite, in der es steht");
	}

	// Title + intro reflect the change context.
	const titleEl = document.getElementById("location-report-title");
	if (titleEl) {
		titleEl.textContent = tr("report.changeTitle", "Änderung vorschlagen") + (ctx.name ? " – " + ctx.name : "");
	}
	const introEl = document.querySelector(".location-report-dialog__intro");
	if (introEl) {
		introEl.textContent = tr("report.changeIntro", "Schlage eine Änderung an diesem Element vor. Beschreibe möglichst genau, was geändert werden soll. Eine Quelle hilft uns sehr bei der Überprüfung der Änderung.");
	}
	// Der Absende-Knopf heisst im Aenderungsmodus wie in den Kartendialogen (Owner 2026-08-13). Im
	// Meldemodus bleibt er "Melden" -- dort heisst die Ueberschrift woertlich "Karteneintrag melden".
	// 💣 Nur das SPAN beschriften, nie den Button: dessen textContent zu setzen loeschte das Brief-Bild.
	const submitLabel = document.getElementById("location-report-submit-label");
	if (submitLabel) {
		submitLabel.textContent = tr("report.changeSubmit", "Vorschlag senden");
	}
}

// "Neue Position vorschlagen" (nur Aenderungsmodus): Dialog kurz ausblenden, Toast, EIN Kartenklick setzt die
// vorgeschlagene Position, danach kommt der Dialog zurueck. Formularzustand bleibt (nur ausblenden, kein Reset).
function startChangePositionPick() {
	$("#location-report-overlay").prop("hidden", true);
	syncModalDialogBodyState();
	if (typeof map !== "undefined" && map) {
		map.off("click", handleChangePositionPick);
		map.once("click", handleChangePositionPick);
	}
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast("Schlage eine neue Position vor: klicke auf die Karte.", "info");
	}
}

function handleChangePositionPick(event) {
	const latlng = L.latLng(event.latlng);
	if (typeof isWithinMapBounds === "function" && !isWithinMapBounds(latlng)) {
		if (typeof showFeedbackToast === "function") {
			showFeedbackToast("Diese Position liegt ausserhalb der Karte.", "warning");
		}
		map.once("click", handleChangePositionPick); // ausserhalb -> erneut scharf schalten
		return;
	}
	locationReportLatLng = latlng;
	document.getElementById("location-report-coordinates").textContent = formatLocationReportCoordinates(latlng);
	document.getElementById("location-report-lat").value = latlng.lat.toFixed(3);
	document.getElementById("location-report-lng").value = latlng.lng.toFixed(3);
	$("#location-report-overlay").prop("hidden", false);
	syncModalDialogBodyState();
}

// Undo everything applyChangeSuggestionContext() changed, so the plain right-click "Hier melden…" is
// unaffected. form.reset() restores input VALUES but not disabled/readOnly/textContent -- do those here.
function clearChangeSuggestionMode() {
	const typeSelect = document.getElementById("location-report-type");
	const nameInput = document.getElementById("location-report-name");
	const commentField = document.getElementById("location-report-comment");
	if (typeSelect) setFieldContextLocked(typeSelect, false);
	if (nameInput) nameInput.readOnly = false;
	const modeEl = document.getElementById("location-report-mode");
	if (modeEl) modeEl.value = "new";
	const entityTypeEl = document.getElementById("location-report-entity-type");
	if (entityTypeEl) entityTypeEl.value = "";
	const entityIdEl = document.getElementById("location-report-entity-id");
	if (entityIdEl) entityIdEl.value = "";
	const resetPickBtn = document.getElementById("location-report-pick-position");
	if (resetPickBtn) resetPickBtn.hidden = true;
	if (commentField) {
		commentField.required = false;
		const label = commentField.closest(".location-report-form__field")?.querySelector("span");
		if (label) {
			label.textContent = tr("report.commentLabel", "Kommentar (zur näheren Beschreibung)");
		}
	}
	const sourcesLabel = document.getElementById("location-report-sources-label");
	if (sourcesLabel) {
		sourcesLabel.textContent = tr("report.sourcesLabel", "Quellen * — Link zur Seite, in der es steht (Wiki-Artikel, F-Shop, Fanwiki)");
	}
	const titleEl = document.getElementById("location-report-title");
	if (titleEl) {
		titleEl.textContent = tr("report.title", "Karteneintrag melden");
	}
	const introEl = document.querySelector(".location-report-dialog__intro");
	if (introEl) {
		introEl.textContent = tr("report.intro", "Hilf mit, Avesmaps zu erweitern. Alle Meldungen werden gesammelt und geprüft. Bitte melde nur Einträge mit sicherer Quellenlage und beschreibe die Stelle, wenn die Position nicht eindeutig ist.");
	}
	// Gegenstueck zum Aenderungsmodus: zurueck auf "Melden". Ohne diese Zeile truege der naechste
	// NEUE Eintrag die Beschriftung des vorherigen Aenderungsvorschlags -- die Dialoghuelle wird
	// wiederverwendet, und genau so ist es bei Titel, Vorspann und Quellen-Label auch geregelt.
	const submitLabel = document.getElementById("location-report-submit-label");
	if (submitLabel) {
		submitLabel.textContent = tr("report.submit", "Melden");
	}
}

function populateLocationEditForm({ markerEntry = null, latlng = null, presetName = "", presetLocationType = "", presetWikiUrl = "", presetDescription = "", presetIsNodix = null } = {}) {
	const formElement = getLocationEditFormElement();
	if (!formElement) {
		return;
	}

	locationEditMarkerEntry = markerEntry;
	locationEditLatLng = latlng ? L.latLng(latlng) : markerEntry?.marker.getLatLng() || null;
	const location = markerEntry?.location || {};
	const wikiLocationLink = getWikiLocationLink(location.name || markerEntry?.name || "", location.wikiUrl || "");
	document.getElementById("location-edit-public-id").value = markerEntry?.publicId || "";
	// Eine beim Anlegen gemerkte Wiki-Wahl gehört zum vorigen Dialog, nicht zum nächsten.
	locationEditPendingWikiSettlement = null;
	void acquireFeatureSoftLock(markerEntry?.publicId || "");
	const isCrossingConversion = pendingCrossingConversionPublicId && pendingCrossingConversionPublicId === markerEntry?.publicId;
	document.getElementById("location-edit-name").value = presetName || (isCrossingConversion ? pendingCrossingConversionName : "") || location.name || markerEntry?.name || "";
	setLocationEditSize(normalizeLocationType(presetLocationType || location.locationType || markerEntry?.locationType || "dorf"));
	// 💣 `location.description` MUSS hier stehen. Bis 2026-08-05 stand da nur `presetDescription || ""`,
	// und `presetDescription` wird von keinem Aufrufer im ganzen Projekt gesetzt -- das Feld war also bei
	// jedem Oeffnen leer. Beim Speichern schickt buildLocationEditPayload es trotzdem mit, und der Server
	// macht aus einer leeren Beschreibung `unset($properties['description'])`
	// (api/_internal/map/features.php:1275): **jedes Speichern eines bestehenden Ortes hat seine
	// Beschreibung geloescht**, auch wenn nur der Name korrigiert wurde. Unsichtbar, weil das Feld bis
	// heute `type="hidden"` war. Die Nachbarzeile darunter macht es fuer den Wiki-Link seit jeher richtig.
	document.getElementById("location-edit-description").value = presetDescription || location.description || "";
	document.getElementById("location-edit-wiki-url").value = presetWikiUrl || location.wikiUrl || wikiLocationLink?.url || "";
	// Einwohner · Lage · Herrscher (seit 16.08.2026 eigene Kartenfelder). 💣 KEIN Rückfall auf das
	// Wiki-Nest: das Nest ist die Quelle, aus der der Knopf „Sync" auf ausdrückliches Anhaken
	// überträgt -- hier ersatzweise hineingeschrieben wäre es genau die Vorschau-lose Übernahme, die
	// mit den zwei „↻"-Knöpfen abgeschafft wurde (Aufgabe 5). Was der Ort selbst nicht trägt, bleibt
	// leer, und das Feld sagt damit die Wahrheit.
	document.getElementById("location-edit-einwohner").value = location.einwohner || "";
	document.getElementById("location-edit-lage").value = location.lage || "";
	document.getElementById("location-edit-oberhaupt").value = location.oberhaupt || "";
	// Shared multi-source editor (multi-source #2): replaces the old "Andere Quelle" single
	// url/label pair. The server-side takeover now owns other_source, so this dialog no longer
	// reads or writes it here or in buildLocationEditPayload (see mountLocationEditFeatureSources).
	mountLocationEditFeatureSources();
	mountLocationEditNameAutocomplete();
	document.getElementById("location-edit-is-nodix").checked = presetIsNodix === null
		? (isCrossingConversion ? pendingCrossingConversionIsNodix : Boolean(location.isNodix))
		: Boolean(presetIsNodix);
	document.getElementById("location-edit-is-ruined").checked = Boolean(location.isRuined);
	document.getElementById("location-edit-is-hidden").checked = Boolean(location.isHidden);
	// Ortsart -- leer ist ein gueltiger Zustand; das Feld bleibt dann einfach leer.
	document.getElementById("location-edit-place-kind").value = String(location.placeKind || "");
	mountLocationEditPlaceKindAutocomplete();
	// NACH dem Setzen der Ortsgroesse: die Sperre haengt an ihr.
	syncLocationEditPlaceKindAvailability();
	if (typeof renderSettlementWikiReference === "function") {
		renderSettlementWikiReference();
	}
	// 🔴 EIN FRISCH GEOEFFNETER DIALOG HAT NICHTS UEBERNOMMEN -- und er zeigt die Abweichungen zum
	// Wiki. Ohne das Leeren truege die Merkliste die Uebernahmen des ZULETZT geoeffneten Ortes
	// weiter, und dessen Felder bekaemen hier beim naechsten Speichern die Herkunft „aus dem Wiki"
	// fuer Werte, die nie aus einem Wiki kamen.
	if (typeof settlementWikiUebernommenLeeren === "function") {
		settlementWikiUebernommenLeeren();
	}
	if (typeof settlementWikiZeichneAbweichungen === "function") {
		settlementWikiZeichneAbweichungen();
	}
	void renderSettlementCoatSection(markerEntry?.publicId || "");
	// Zuordnung frisch vom Server holen (Browser-Marker kann nach Bulk-Verbinden stale sein).
	if (typeof syncSettlementWikiFromServer === "function") {
		void syncSettlementWikiFromServer();
	}

	if (locationEditLatLng) {
		document.getElementById("location-edit-coordinates").textContent = formatLocationReportCoordinates(locationEditLatLng);
		document.getElementById("location-edit-lat").value = locationEditLatLng.lat.toFixed(3);
		document.getElementById("location-edit-lng").value = locationEditLatLng.lng.toFixed(3);
	} else {
		document.getElementById("location-edit-coordinates").textContent = "-";
		document.getElementById("location-edit-lat").value = "";
		document.getElementById("location-edit-lng").value = "";
	}
}

function openLocationEditDialog(options = {}) {
	resetLocationEditForm();
	populateLocationEditForm(options);
	setLocationEditDialogOpen(true);
}

// Mounts the shared multi-source editor into the "Ort bearbeiten" dialog (multi-source #2). The
// dialog markup is static -- unlike the settlement editor, which rebuilds its panel and so gets a
// fresh mount node for free -- so we clone-replace the container first: mountFeatureSourceEditor
// binds one click listener per call, and re-opening the dialog would otherwise stack duplicate
// listeners (and leave the previous feature's rows on screen). A place with no saved public_id has
// no feature to attach sources to yet, so it gets the same widget over a local buffer instead
// (bug #41) -- see the pending branch below.
// Ortsname-Typeahead beim ANLEGEN: schlägt Wiki-Siedlungen vor und zeigt je Treffer, ob er schon
// vergeben ist (js/ui/settlement-autocomplete.js). Nur im Anlegen-Fall -- ein bestehender Ort hat
// seinen Namen bereits und für die Wiki-Verbindung den genaueren „Zuweisen"-Weg.
//
// Die Auswahl schreibt Name UND die versteckte wiki_url. Mehr ist nicht nötig: der Speichern-Ablauf
// ruft nach create_point ohnehin autoConnectSettlementWikiByUrl auf (review-editor-submit.js), die
// Verbindung entsteht also von selbst aus dem, was hier im Formular steht.
function mountLocationEditNameAutocomplete() {
	if (typeof locationEditNameAutocompleteDetach === "function") {
		locationEditNameAutocompleteDetach();
		locationEditNameAutocompleteDetach = null;
	}
	const nameInput = document.getElementById("location-edit-name");
	const publicId = document.getElementById("location-edit-public-id")?.value || "";
	if (!nameInput || publicId || typeof attachSettlementNameAutocomplete !== "function") {
		return;
	}
	locationEditNameAutocompleteDetach = attachSettlementNameAutocomplete(nameInput, {
		escape: escapeHtml,
		onPick(item) {
			nameInput.value = String(item.name || "");
			const wikiUrlField = document.getElementById("location-edit-wiki-url");
			if (wikiUrlField) {
				wikiUrlField.value = String(item.wiki_url || "");
			}
			// Dieselbe Wahl auch im Abschnitt „Wiki-Siedlung" zeigen. Beide Wege führen zur selben
			// Verbindung, also dürfen sie nicht Verschiedenes behaupten.
			locationEditPendingWikiSettlement = {
				title: String(item.title || item.name || ""),
				name: String(item.name || item.title || ""),
				wiki_url: String(item.wiki_url || ""),
			};
			if (typeof renderSettlementWikiReference === "function") {
				renderSettlementWikiReference();
			}
		},
	});
}

// Die Ortsart gehört zur Ortsgröße „Besondere Bauwerke/Stätten" (Owner 2026-08-03). Bei jeder
// anderen Größe ist das Feld gesperrt.
const LOCATION_EDIT_PLACE_KIND_SIZE = "gebaeude";

// EINE Stelle, die die Ortsgröße im Dialog setzt. Es gibt drei Schreiber (Dialog füllen,
// Meldung übernehmen, Größe aus dem Wiki holen), und `select.value = x` feuert KEIN
// change-Ereignis — ohne diesen Setter hinge die Sperre nur am Nutzerklick und wäre nach jedem
// programmatischen Setzen falsch.
function setLocationEditSize(value) {
	const select = document.getElementById("location-edit-type");
	if (!select) {
		return;
	}
	select.value = value;
	syncLocationEditPlaceKindAvailability();
}

// Sperrt/entsperrt das Feld „Art" nach der gewählten Ortsgröße.
function syncLocationEditPlaceKindAvailability() {
	const select = document.getElementById("location-edit-type");
	const input = document.getElementById("location-edit-place-kind");
	if (!select || !input) {
		return;
	}
	const allowed = String(select.value || "") === LOCATION_EDIT_PLACE_KIND_SIZE;
	input.disabled = !allowed;
	if (allowed) {
		input.placeholder = "z. B. Brücke – leer lassen, wenn unbekannt";
		return;
	}
	// Leeren, nicht nur sperren. Ein gesperrtes Feld schickt ohnehin NICHTS mit (FormData lässt
	// disabled aus, buildLocationEditPayload macht daraus "", der Server löscht place_kind).
	// Bliebe der alte Text sichtbar, behauptete die Oberfläche etwas, das nicht gespeichert wird.
	input.value = "";
	// Der Platzhalter sagt WARUM. Ein title-Attribut täte das nur für Mauszeiger.
	input.placeholder = "nur bei „Besondere Bauwerke/Stätten“";
}

// Ortsart-Typeahead ans Feld „Art" hängen (js/ui/place-kind-autocomplete.js). Anders als der
// Ortsname-Typeahead gilt er für ANLEGEN UND BEARBEITEN: eine Art nachzutragen ist der häufigere
// Fall, weil die Bestandsorte alle noch keine haben.
//
// Vor jedem Mount abhängen: attachTypeahead bindet je Aufruf eigene Listener und legt eine eigene
// Box an document.body -- ohne das stapeln sich beide bei jedem Öffnen des Dialogs.
function mountLocationEditPlaceKindAutocomplete() {
	if (typeof locationEditPlaceKindAutocompleteDetach === "function") {
		locationEditPlaceKindAutocompleteDetach();
		locationEditPlaceKindAutocompleteDetach = null;
	}
	const kindInput = document.getElementById("location-edit-place-kind");
	if (!kindInput || typeof attachPlaceKindAutocomplete !== "function") {
		return;
	}
	locationEditPlaceKindAutocompleteDetach = attachPlaceKindAutocomplete(kindInput, {
		escape: escapeHtml,
		tr: typeof tr === "function" ? tr : undefined,
	});
}

function mountLocationEditFeatureSources() {
	const container = document.getElementById("location-edit-feature-sources");
	if (!container) {
		return;
	}
	// Den alten Knoten NICHT einfach wegwerfen: sein Quellen-Autocomplete hängt sein Dropdown an
	// document.body, und ohne dieses Abräumen bleibt es dort für immer liegen -- ein Knoten pro
	// Öffnen des Dialogs (genau die Falle, vor der __fsDetachAutocomplete in
	// review-feature-sources.js warnt).
	if (typeof container.__fsDetachAutocomplete === "function") {
		container.__fsDetachAutocomplete();
		container.__fsDetachAutocomplete = null;
	}
	const fresh = container.cloneNode(false); // drops the previous mount's listener + rendered rows
	container.replaceWith(fresh);
	locationEditPendingSourceStore = null;
	const publicId = document.getElementById("location-edit-public-id")?.value || "";
	if (typeof mountFeatureSourceEditor !== "function") {
		return;
	}
	// Bug #41: a place being CREATED has no public_id yet, so there is no feature to attach a source
	// to. Mount the same widget over a local buffer instead -- the editor names its sources right
	// away, and handleLocationEditFormSubmit replays them the moment create_point returns an id.
	if (!publicId) {
		if (typeof createPendingFeatureSourceStore !== "function") {
			return;
		}
		locationEditPendingSourceStore = createPendingFeatureSourceStore();
		// Die gemeldeten Quellen (Warteschlange) puffern hier wie von Hand eingetragene, bis der Ort seine Kennung hat.
		void mountFeatureSourceEditor(fresh, "settlement", () => "", {
			escape: escapeHtml,
			store: locationEditPendingSourceStore,
			meldung: activeReviewReportSourceQueue.length ? { quellen: activeReviewReportSourceQueue } : null,
		});
		return;
	}
	const markerEntry = locationEditMarkerEntry;
	void Promise.resolve(
		mountFeatureSourceEditor(
			fresh,
			"settlement",
			() => document.getElementById("location-edit-public-id")?.value || "",
			// Die gemeldeten Quellen eines Aenderungswunsches stehen nacheinander in der Eingabezeile (Entwurf §5.4).
			{ escape: escapeHtml, meldung: activeReviewReportSourceQueue.length ? { quellen: activeReviewReportSourceQueue } : null }
		)
	).then((data) => {
		// The initial "list" runs the server-side other_source takeover, which bumps the feature's
		// revision. Refresh the marker's cached token so the next save's expected_revision matches
		// (same discipline as selectSettlementWikiResult/removeSettlementWiki) -- otherwise editing a
		// place that still carries a legacy other_source would 409 just from opening this dialog.
		if (data && typeof data.revision === "number" && markerEntry && markerEntry.location) {
			markerEntry.location.revision = data.revision;
		}
	});
}

function buildLocationEditPayload(formElement) {
	const formData = new FormData(formElement);
	const publicId = String(formData.get("public_id") || "").trim();
	const action = publicId ? "update_point" : "create_point";
	const payload = {
		action,
		public_id: publicId,
		name: String(formData.get("name") || "").trim(),
		feature_subtype: String(formData.get("feature_subtype") || "").trim(),
		description: String(formData.get("description") || "").trim(),
		// wiki_url stays in the payload (update_point requires it -- omitting would unset
		// properties.wiki_url). other_source is intentionally NOT sent anymore (multi-source #2):
		// the shared editor + its server-side takeover own that field now, so re-sending the old
		// {url,label} pair on every save would clobber whatever the takeover just consolidated.
		wiki_url: String(formData.get("wiki_url") || "").trim(),
		is_nodix: formData.get("is_nodix") === "on",
		is_ruined: formData.get("is_ruined") === "on",
		// 💣 IMMER MITSENDEN. avesmapsUpdatePointFeatureDetails liest `$payload['is_hidden'] ?? false`
		// -- ein Speichern ohne dieses Feld hebt das Verbergen still wieder auf. Dieselbe Pflicht wie bei
		// is_nodix und is_ruined daneben. Genau daran ist die Kartenform am 15.08.2026 aufgefallen: der
		// Haken war nur im Siedlungseditor gebaut, und diese Form hier hat drei Oberflaechen, nicht eine.
		is_hidden: formData.get("is_hidden") === "on",
		// Ortsart. IMMER mitsenden, auch leer -- update_point loescht properties.place_kind nur,
		// wenn ein leerer Wert ankommt. Weglassen hiesse "nicht geaendert", und dann liesse sich
		// eine einmal gesetzte Art nie wieder entfernen.
		place_kind: String(formData.get("place_kind") || "").trim(),
	};

	// ── Die Wiki-Angaben mit eigenem Kartenfeld ────────────────────────────────────────────────
	// 🔴 ABWESEND HEISST „NICHT GEÄNDERT", LEER HEISST „LÖSCHEN" -- und deshalb wird ein Feld, das im
	// Dokument gar nicht steht, WEGGELASSEN statt als "" geschickt. `update_point` fasst einen nicht
	// mitgeschickten Schlüssel nicht an (avesmapsApplyPointWikiFields). Das ist der Riegel gegen die
	// Ladelücke eines Deploys: eine gecachte index.html ohne diese drei Zeilen würde sonst bei JEDEM
	// Speichern die frisch gesyncte Einwohnerzahl leeren, ohne dass jemand etwas anklickt (AGENTS.md
	// §7 — genau diese Lücke stand am 15.08.2026 live).
	["einwohner", "lage", "oberhaupt"].forEach((feld) => {
		const wert = formData.get(feld);
		if (wert !== null) {
			payload[feld] = String(wert).trim();
		}
	});

	// 🔴 WELCHE FELDER AUS DEM WIKI KAMEN (Entwurf 2026-08-17-wiki-override-fuer-alle-design.md).
	// Der Server stempelt daraus die Feldherkunft -- aber nur für Felder, deren Wert sich wirklich
	// ändert. Eine leere Liste ist dasselbe wie ein fehlender Schlüssel: „nichts kam aus dem Wiki",
	// also alles von uns. ⚠️ Das ist die SICHERE Richtung: eine falsche „Wiki"-Angabe liesse einen
	// späteren Abgleich eine Handarbeit überschreiben, eine falsche „von uns"-Angabe schützt nur
	// zu viel. Deshalb steht hier auch kein Rückfall auf `[]`, wenn die Funktion fehlt.
	if (typeof settlementWikiUebernommenFuerPayload === "function") {
		payload.wiki_uebernommen = settlementWikiUebernommenFuerPayload();
	}

	// 🔴 DER DRITTE ZUSTAND. Er kommt aus dem Zuweisungskasten, nicht aus einem Formularfeld -- er ist
	// dessen Häkchen „Kein Wiki-Artikel vorhanden". `null` heißt „das Bauteil ist nicht bereit" (ein
	// Blindgänger nach einem Deploy-Fehlschlag, siehe js/ui/wiki-assign.js): dann wird der Schlüssel
	// weggelassen und der Server lässt den gespeicherten Merker in Ruhe. Ein `false` an dieser Stelle
	// wäre eine Löschung, die niemand angeordnet hat -- die Entscheidung stammt oft aus dem
	// Konfliktzentrum, nicht aus diesem Dialog.
	const keinArtikel = typeof settlementWikiKeinArtikelFuerPayload === "function"
		? settlementWikiKeinArtikelFuerPayload()
		: null;
	if (keinArtikel !== null) {
		payload.wiki_no_article = keinArtikel;
	}

	if (action === "create_point") {
		payload.lat = Number.parseFloat(String(formData.get("lat") || ""));
		payload.lng = Number.parseFloat(String(formData.get("lng") || ""));
		delete payload.public_id;
	}

	return payload;
}

// ===== Wappen-Sektion im „Siedlung bearbeiten"-Dialog =====
const SETTLEMENT_COAT_API_URL = "/api/edit/wiki/settlements.php";

function settlementCoatImageSrc(coat) {
	if (!coat || !coat.url) {
		return "";
	}
	// Lokale URLs (eigener Upload ODER per "Wappen lokalisieren" geholtes Wiki-Wappen unter
	// /uploads/wappen/wiki/) direkt; nur eine externe http(s)-URL geht über den Cache-Proxy.
	// coat.php lehnt eine relative /uploads-URL mit 400 ab — die Herkunft (source) sagt darüber nichts.
	return /^https?:\/\//i.test(coat.url) ? `/api/app/coat.php?u=${encodeURIComponent(coat.url)}` : coat.url;
}

// Der zuletzt gelesene coat_info-Stand dieses Dialogs.
//
// 💣 DER EDITOR-TEIL WIRD DARAUS BEFUELLT, NIE AUS DEM NICHTS. Der Upload-Zweig von
// api/edit/wiki/settlement-coat-upload.php schreibt den ganzen coat-Block NEU (Zweig `!$nurAngaben`):
// ein Formular, das `license`/`author`/`note` nicht mitschickt, setzt die Lizenz auf die
// Anlege-Vorgabe 'ai_generated' zurueck und LEERT Urheber und Kommentar. „Bild ersetzen" waere damit
// ein stiller Datenverlust an einer gepflegten Angabe -- deshalb reisen die drei Werte immer mit,
// und ihr Ausgangswert ist der gespeicherte.
// ⚠️ `null`, solange nichts gelesen wurde. Ein leeres Objekt waere von „gelesen, aber kein Wappen"
// nicht zu unterscheiden.
let settlementCoatInfo = null;

/** Der Wappen-Editor auf oder zu -- der Zustand IST das `hidden` des Kastens, kein zweiter daneben. */
function setSettlementCoatEditorOpen(open) {
	const editor = document.getElementById("settlement-coat-editor");
	const toggle = document.getElementById("settlement-coat-upload");
	if (editor) {
		editor.hidden = !open;
	}
	if (toggle) {
		toggle.setAttribute("aria-expanded", open ? "true" : "false");
	}
}

/** Liegt an diesem Ort schon ein Wappen? Gemessen wird die ADRESSE -- ein `coat` ohne `url` beschreibt nichts. */
function settlementCoatHasCurrent() {
	const current = settlementCoatInfo && settlementCoatInfo.current;
	return Boolean(current && String(current.url || "").trim() !== "");
}

/**
 * Den Editor-Teil aus dem gelesenen Stand aufbauen und aufklappen.
 *
 * ⚠️ Der Kasten SAGT, was er kann: mit vorhandenem Wappen heisst der Knopf „Speichern" und der
 * Hinweis erklaert, dass ohne neue Datei nur die Angaben gespeichert werden (Fall #112). Ohne das
 * ist nicht zu erraten, dass man ihn auch ohne neues Bild druecken darf -- und genau dieses
 * Nichterraten war die Meldung, die den Weg im Ortseditor ueberhaupt ausgeloest hat.
 */
function openSettlementCoatEditor() {
	const fieldsEl = document.getElementById("settlement-coat-fields");
	const fileEl = document.getElementById("settlement-coat-file");
	const urlEl = document.getElementById("settlement-coat-url");
	const hintEl = document.getElementById("settlement-coat-hint");
	const saveEl = document.getElementById("settlement-coat-save");
	const errorEl = document.getElementById("settlement-coat-error");
	if (fileEl) {
		fileEl.value = "";
	}
	// 💣 Auch das URL-Feld leeren: eine stehengebliebene Adresse wuerde beim NAECHSTEN Ort
	// mitgeschickt und ihm ein fremdes Wappen verpassen.
	if (urlEl) {
		urlEl.value = "";
	}
	if (errorEl) {
		errorEl.hidden = true;
		errorEl.textContent = "";
	}
	const hatWappen = settlementCoatHasCurrent();
	const coat = (settlementCoatInfo && settlementCoatInfo.current) || {};
	if (fieldsEl && typeof avesmapsMediaLicenseFieldsMarkup === "function") {
		fieldsEl.innerHTML = avesmapsMediaLicenseFieldsMarkup({
			license: coat.license_status,
			author: coat.author,
			note: coat.note,
			uploaded_by: coat.uploaded_by,
			uploaded_at: coat.uploaded_at,
		}, { prefix: "coat", vorgabe: "ai_generated", mitNotiz: true });
	}
	// 🔴 „Wappen speichern", nicht bloss „Speichern". Der Quellenkasten daneben beschriftet seinen
	// Knopf schlicht mit „Speichern" -- er sitzt aber weit oben im Dialog, waehrend die Wappen-Box
	// das LETZTE Element vor der Speicherleiste des Ortes ist: in der Abnahme standen zwei gefuellte
	// Knoepfe namens „Speichern" rund 50 px uebereinander, und welcher den Ort und welcher das
	// Wappen speichert, war ihnen nicht anzusehen.
	if (saveEl) {
		saveEl.textContent = hatWappen ? "Wappen speichern" : "Wappen hochladen";
	}
	if (hintEl) {
		hintEl.textContent = hatWappen
			? "Ohne neue Datei oder URL bleibt das Bild, wie es ist — dann werden nur Lizenz, Urheber und Kommentar gespeichert. Maximale Größe 5 MB."
			: "Datei ODER URL angeben. Maximale Größe 5 MB.";
	}
	setSettlementCoatEditorOpen(true);
}

async function renderSettlementCoatSection(publicId) {
	const section = document.getElementById("settlement-coat-section");
	if (!section) {
		return;
	}
	setSettlementCoatEditorOpen(false);
	if (!publicId) {
		section.hidden = true;
		section.dataset.publicId = "";
		settlementCoatInfo = null;
		return;
	}
	const preview = document.getElementById("settlement-coat-preview");
	const status = document.getElementById("settlement-coat-status");
	const adoptBtn = document.getElementById("settlement-coat-adopt");
	const removeBtn = document.getElementById("settlement-coat-remove");
	section.hidden = false;
	section.dataset.publicId = publicId;
	settlementCoatInfo = null;
	if (preview) {
		preview.className = "settlement-coat__preview";
		preview.innerHTML = "";
	}
	if (status) {
		status.textContent = "Wappen wird geladen …";
	}
	if (adoptBtn) {
		adoptBtn.hidden = true;
	}
	// 🔴 „Entfernen" bleibt sichtbar und wird nur DEAKTIVIERT, solange es nichts zu entscheiden
	// gibt. Ein Knopf, der je nach Zustand verschwindet, sieht aus wie eine fehlende Funktion.
	if (removeBtn) {
		removeBtn.disabled = true;
	}
	try {
		const response = await fetch(`${SETTLEMENT_COAT_API_URL}?action=coat_info&public_id=${encodeURIComponent(publicId)}`, { credentials: "same-origin" });
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Fehler"));
		}
		if (section.dataset.publicId !== publicId) {
			return; // Dialog inzwischen weitergeschaltet
		}
		settlementCoatInfo = data;
		const current = data.current && data.current.url ? data.current : null;
		const wiki = data.wiki && data.wiki.url ? data.wiki : null;
		// 🔴 DER DRITTE ZUSTAND (properties.coat_none): „hier soll kein Wappen sein" -- zu
		// unterscheiden von „hier war nie eines". Ohne diese Auskunft aendert sich nach einem Klick
		// auf „Entfernen" sichtbar NICHTS, und der Knopf ist von einem kaputten nicht zu trennen.
		const coatNone = data.coat_none === true;
		if (current) {
			preview.innerHTML = `<img src="${escapeHtml(settlementCoatImageSrc(current))}" alt="Wappen" />`;
			const herkunft = current.source === "own" ? "Eigenes Wappen aktiv." : "Gemeinfreies Wiki-Wappen aktiv.";
			// ⚠️ Und ob es auch ANKOMMT. Ein Wappen mit stiller Lizenz (unknown_other &co.) wird von
			// api/app/map-features.php aus der Kartennutzlast geworfen -- im Editor sichtbar, auf der
			// oeffentlichen Karte nicht. Genau dieser Unterschied war bis zum 01.09.2026 unsichtbar.
			const stumm = typeof avesmapsMediaLicenseIsPublic === "function"
				&& !avesmapsMediaLicenseIsPublic(current.license_status);
			status.textContent = herkunft + (stumm ? " Die Lizenz ist nicht öffentlich — auf der Karte erscheint es nicht." : "");
			removeBtn.disabled = false;
			if (wiki && wiki.allowed && (current.source === "own" || current.url !== wiki.url)) {
				adoptBtn.hidden = false;
			}
		} else if (wiki) {
			preview.className = wiki.allowed && !coatNone ? "settlement-coat__preview" : "settlement-coat__preview settlement-coat__preview--dim";
			preview.innerHTML = `<img src="${escapeHtml(settlementCoatImageSrc(wiki))}" alt="Wiki-Wappen" />`;
			if (coatNone) {
				status.textContent = "Kein Wappen — ausdrücklich so gesetzt. Das Wiki-Wappen bleibt außen vor.";
			} else if (wiki.allowed) {
				status.textContent = "Gemeinfreies Wiki-Wappen verfügbar.";
				adoptBtn.hidden = false;
				removeBtn.disabled = false;
			} else {
				status.textContent = "Wiki-Wappen vorhanden, aber nicht gemeinfrei — nicht übernehmbar.";
				removeBtn.disabled = false;
			}
		} else {
			status.textContent = coatNone
				? "Kein Wappen — ausdrücklich so gesetzt."
				: "Kein Wappen vorhanden.";
		}
	} catch (error) {
		if (status) {
			status.textContent = "Wappen konnte nicht geladen werden.";
		}
	}
}

async function settlementCoatAction(action) {
	const section = document.getElementById("settlement-coat-section");
	const publicId = section?.dataset.publicId || document.getElementById("location-edit-public-id")?.value || "";
	if (!publicId) {
		return;
	}
	// 🔴 „Entfernen" ist NICHT „Zuruecksetzen": es setzt den dritten Zustand (properties.coat_none,
	// „dieser Ort hat kein Wappen, und das bleibt so"). Ohne ihn traegt der naechste Abgleich das
	// Wiki-Wappen wieder ein. Weil das eine Entscheidung ist und keine Anzeigeeinstellung, wird sie
	// benannt, bevor sie faellt -- derselbe Wortlaut wie im Ortseditor.
	if (action === "clear_coat" && !window.confirm("Wappen entfernen?\n\nDieser Ort zeigt danach kein Wappen — auch nicht das aus dem Wiki. "
		+ "Ein neues Wappen hochzuladen hebt das wieder auf.")) {
		return;
	}
	try {
		const response = await fetch(SETTLEMENT_COAT_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ action, public_id: publicId, dry_run: false, confirm: "apply" }),
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Fehler"));
		}
		showFeedbackToast?.(action === "set_coat" ? "Wappen übernommen." : "Wappen entfernt.", "success");
		if (typeof loadChangeLog === "function") {
			loadChangeLog();
		}
		await renderSettlementCoatSection(publicId);
		// Lokalen Marker aktualisieren, damit Infobox/Icon sofort stimmen.
		if (typeof findLocationMarkerByPublicId === "function") {
			const entry = findLocationMarkerByPublicId(publicId);
			if (entry && entry.location) {
				entry.location.coat = action === "clear_coat" ? null : (data.coat || entry.location.coat);
				// Revision mitführen, sonst kollidiert ein anschließendes „Speichern" (409).
				if (data.revision !== undefined && data.revision !== null) {
					entry.location.revision = data.revision;
				}
				if (typeof refreshLocationMarkerPopup === "function") {
					// Offenes Popup live aktualisieren (bindPopup allein rendert es nicht neu).
					const wasPopupOpen = typeof entry.marker.isPopupOpen === "function" && entry.marker.isPopupOpen();
					refreshLocationMarkerPopup(entry);
					if (wasPopupOpen && typeof entry.marker.openPopup === "function") {
						entry.marker.openPopup();
					}
				}
			}
		}
	} catch (error) {
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
	}
}

/**
 * Speichert den Wappen-Editor: Datei ODER Bild-URL ODER nur die drei Angaben.
 *
 * 🔴 BIS ZUM 01.09.2026 KONNTE DIESER WEG NUR EINES VON DREIEN, und das mit fester Lizenz
 * "unknown_other". Der alte Kommentar hier argumentierte, dieser Wert „behauptet nichts, was dieser
 * Weg nicht weiss" -- richtig, solange es kein Feld gab. Nur ist `unknown_other` genau der Wert, den
 * api/app/map-features.php wieder aus der Kartennutzlast wirft (avesmapsSettlementCoatIsPublic):
 * der Upload gelang, die Meldung sagte „hochgeladen", und auf der oeffentlichen Karte erschien das
 * Wappen NIE. Nichts zu behaupten war hier nicht die vorsichtige Wahl, sondern eine stille Absage.
 * Jetzt sagt es der Editor -- mit derselben Reihe wie die uebrigen fuenf Dialoge.
 */
async function saveSettlementCoat() {
	const section = document.getElementById("settlement-coat-section");
	const publicId = section?.dataset.publicId || document.getElementById("location-edit-public-id")?.value || "";
	if (!publicId) {
		return;
	}
	const errorEl = document.getElementById("settlement-coat-error");
	const zeigeFehler = (text) => {
		if (errorEl) {
			errorEl.textContent = text;
			errorEl.hidden = false;
		}
	};
	if (errorEl) {
		errorEl.hidden = true;
		errorEl.textContent = "";
	}
	const fileEl = document.getElementById("settlement-coat-file");
	const urlEl = document.getElementById("settlement-coat-url");
	const file = fileEl && fileEl.files && fileEl.files[0];
	const sourceUrl = urlEl ? String(urlEl.value || "").trim() : "";
	// 🔴 ODER GAR NICHTS -- dann werden nur Lizenz/Urheber/Kommentar geaendert (Fall #112).
	// ⚠️ Nur wenn wirklich schon ein Bild liegt: ohne Bild gibt es nichts zu beschreiben. Denselben
	// Riegel zieht der Server noch einmal (avesmapsSettlementCoatMetadataOnly).
	const hatWappen = settlementCoatHasCurrent();
	if (!file && sourceUrl === "" && !hatWappen) {
		zeigeFehler("Bitte eine Bilddatei wählen oder eine Bild-URL angeben.");
		return;
	}
	const status = document.getElementById("settlement-coat-status");
	// Der Statustext von vorher -- im Fehlerfall wird er zurueckgestellt, statt neu zu rendern.
	const statusVorher = status ? status.textContent : "";
	if (status) {
		status.textContent = hatWappen && !file && sourceUrl === "" ? "Angaben werden gespeichert …" : "Wappen wird hochgeladen …";
	}
	try {
		const form = new FormData();
		form.append("public_id", publicId);
		// ⚠️ Nur EINEN der beiden Wege schicken. Der Server nimmt die Datei zuerst; beide zugleich
		// waeren nicht falsch, aber die URL wuerde still ignoriert -- und still ignorierte Eingaben
		// sind genau die Sorte Fehler, die niemand meldet.
		// 💣 Sonst GAR NICHTS -- weder `coat` noch `coat_url`. Genau daran erkennt der Server den Weg
		// „nur die Angaben" und laesst Bilddatei, Adresse und Upload-Stempel unberuehrt.
		if (file) {
			form.append("coat", file);
		} else if (sourceUrl !== "") {
			form.append("coat_url", sourceUrl);
		}
		// 💣 Die drei reisen IMMER mit, auch beim blossen Ersetzen des Bildes: der Upload-Zweig des
		// Endpunkts baut den coat-Block neu auf, und was hier fehlt, ist danach weg (Lizenz zurueck
		// auf 'ai_generated', Urheber und Kommentar leer). Ihr Ausgangswert kommt aus dem gelesenen
		// coat_info, nicht aus einem frischen Formular.
		const fieldsEl = document.getElementById("settlement-coat-fields");
		const licenseEl = fieldsEl ? fieldsEl.querySelector("[data-coat-license]") : null;
		const authorEl = fieldsEl ? fieldsEl.querySelector("[data-coat-author]") : null;
		const noteEl = fieldsEl ? fieldsEl.querySelector("[data-coat-note]") : null;
		form.append("license", licenseEl ? licenseEl.value : "ai_generated");
		form.append("author", authorEl ? authorEl.value : "");
		form.append("note", noteEl ? noteEl.value : "");
		const response = await fetch("/api/edit/wiki/settlement-coat-upload.php", {
			method: "POST",
			credentials: "same-origin",
			body: form,
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Upload fehlgeschlagen"));
		}
		showFeedbackToast?.(file || sourceUrl !== "" ? "Eigenes Wappen hochgeladen." : "Angaben gespeichert.", "success");
		setSettlementCoatEditorOpen(false);
		if (typeof loadChangeLog === "function") {
			loadChangeLog();
		}
		await renderSettlementCoatSection(publicId);
		if (typeof findLocationMarkerByPublicId === "function") {
			const entry = findLocationMarkerByPublicId(publicId);
			if (entry && entry.location) {
				entry.location.coat = data.coat || entry.location.coat;
				if (data.revision !== undefined && data.revision !== null) {
					entry.location.revision = data.revision;
				}
				if (typeof refreshLocationMarkerPopup === "function") {
					// Offenes Popup live aktualisieren (bindPopup allein rendert es nicht neu).
					const wasPopupOpen = typeof entry.marker.isPopupOpen === "function" && entry.marker.isPopupOpen();
					refreshLocationMarkerPopup(entry);
					if (wasPopupOpen && typeof entry.marker.openPopup === "function") {
						entry.marker.openPopup();
					}
				}
			}
		}
	} catch (error) {
		// 🔴 DER EDITOR BLEIBT OFFEN und die Absage steht DARIN. Ein Neu-Rendern schloesse ihn und
		// wuerfe die eingetippten Angaben weg -- bei einer zu grossen Datei, einem abgelehnten Format
		// oder einer nicht erreichbaren Adresse ist das genau der Moment, in dem man sie noch
		// braucht. Der alte Weg tat das (er kannte den Editor nicht) und war deshalb doppelt
		// bestraft: Fehler weg, Eingabe weg.
		zeigeFehler(error && error.message ? error.message : String(error));
		if (status) {
			status.textContent = statusVorher;
		}
	}
}

document.addEventListener("click", (event) => {
	if (!event.target.closest) {
		return;
	}
	if (event.target.closest("#settlement-coat-adopt")) {
		event.preventDefault();
		void settlementCoatAction("set_coat");
		return;
	}
	if (event.target.closest("#settlement-coat-remove")) {
		event.preventDefault();
		void settlementCoatAction("clear_coat");
		return;
	}
	if (event.target.closest("#settlement-coat-save")) {
		event.preventDefault();
		void saveSettlementCoat();
		return;
	}
	if (event.target.closest("#settlement-coat-cancel")) {
		event.preventDefault();
		setSettlementCoatEditorOpen(false);
		return;
	}
	// 🔴 Der Knopf und die Vorschau oeffnen den EDITOR, nicht mehr direkt die Datei-Auswahl. Bis zum
	// 01.09.2026 sprang hier sofort der Dateidialog auf und die gewaehlte Datei ging ohne jede
	// Rueckfrage raus -- ohne Lizenzangabe, ohne die Moeglichkeit, stattdessen eine Adresse
	// anzugeben, und ohne Weg, eine falsche Angabe zu korrigieren.
	// ⚠️ Der Knopf schaltet um (auf/zu), die Vorschau oeffnet nur -- ein Klick auf das Bild, das
	// gerade bearbeitet wird, soll den Kasten nicht wieder zuklappen.
	if (event.target.closest("#settlement-coat-upload")) {
		event.preventDefault();
		const editor = document.getElementById("settlement-coat-editor");
		if (editor && !editor.hidden) {
			setSettlementCoatEditorOpen(false);
		} else {
			openSettlementCoatEditor();
		}
		return;
	}
	if (event.target.closest("#settlement-coat-preview")) {
		event.preventDefault();
		openSettlementCoatEditor();
	}
});

// Die „nicht oeffentlich"-Kennzeichnung am Auswahlfeld nachziehen und den Kommentar bei
// „Genehmigung erteilt" vorschlagen -- derselbe Zuhoerer wie in den fuenf uebrigen Dialogen, die
// Regeln selbst stehen nur in js/ui/media-license-fields.js.
document.addEventListener("change", (event) => {
	const sel = event.target && event.target.closest ? event.target.closest("[data-coat-license]") : null;
	if (!sel || !document.getElementById("settlement-coat-editor")?.contains(sel)) {
		return;
	}
	avesmapsMediaLicenseSyncSelectHidden(sel);
	const noteEl = document.querySelector("#settlement-coat-fields [data-coat-note]");
	if (noteEl) {
		noteEl.value = avesmapsMediaLicenseNoteVorschlag(sel.value, noteEl.value);
	}
});

// 💣 DIE WAPPEN-BOX STEHT IN EINEM <form>. Enter in einem Textfeld schickt dort das GANZE
// Ortsformular ab -- der Editor haette beim Bestaetigen einer Bild-Adresse den Ort gespeichert und
// den Dialog geschlossen, mit der Adresse ungenutzt im Feld. Enter im Adressfeld heisst hier also:
// den Wappen-Kasten speichern, sonst nichts.
document.addEventListener("keydown", (event) => {
	if (event.key !== "Enter" || !event.target || event.target.id !== "settlement-coat-url") {
		return;
	}
	event.preventDefault();
	void saveSettlementCoat();
});

// Node-Export (im Browser wirkungslos -- dort sind es Globals dieser Datei).
// ⚠️ Die drei Wappen-Funktionen reisen mit, damit ihr Test sie WIRKLICH AUSFUEHRT statt ihren
// Quelltext zu lesen: die tragende Zusage („Lizenz, Urheber und Kommentar reisen bei JEDEM Weg mit,
// und der Weg ‚nur die Angaben‘ schickt weder coat noch coat_url") ist eine Aussage ueber die
// abgeschickte FormData, und die sieht man einem Quelltext nicht an.
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		buildLocationReportRequestPayload,
		saveSettlementCoat,
		renderSettlementCoatSection,
		openSettlementCoatEditor,
	};
}

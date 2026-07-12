function buildLocationReportRequestPayload(formElement) {
	const formData = new FormData(formElement);

	return {
		report_type: String(formData.get("report_type") || "location").trim(),
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

// ---- Multi-source #3: dynamische Quellen-Liste im Community-Melde-Formular ----
// Der Melder kann mehrere Quellen hinterlegen (Name/Link/Seite/Typ/offiziell je Quelle), clientseitig in
// locationReportSources gesammelt; beim Absenden gehen sie als `sources`-Array mit und werden beim
// "Anlegen" einzeln als feature_sources verknuepft (wie im Editor). Kein Server-Write vor dem Absenden.
let locationReportSources = [];

function reportSourceTypeLabel(type) {
	return typeof featureSourceTypeLabel === "function" ? featureSourceTypeLabel(type) : String(type || "Sonstiges");
}

function renderLocationReportSourcesList() {
	const list = document.getElementById("location-report-sources-list");
	if (!list) {
		return;
	}
	if (!locationReportSources.length) {
		list.innerHTML = '<div class="report-sources__empty">Noch keine Quelle hinzugefügt.</div>';
		return;
	}
	list.innerHTML = locationReportSources
		.map((source, index) => {
			const officialMark = source.official ? " *" : "";
			const nameText = escapeHtml(source.label) + officialMark;
			const linked = source.url
				? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${nameText} ↗</a>`
				: `<span>${nameText}</span>`;
			return (
				'<div class="report-sources__row">' +
				linked +
				(source.pages ? `<span class="report-sources__pages">S. ${escapeHtml(source.pages)}</span>` : "") +
				`<span class="report-sources__type">${escapeHtml(reportSourceTypeLabel(source.type))}</span>` +
				(source.reference_kind ? `<span class="report-sources__kind">${escapeHtml(typeof featureSourceReferenceKindLabel === "function" ? featureSourceReferenceKindLabel(source.reference_kind) : source.reference_kind)}</span>` : "") +
				`<button type="button" class="report-sources__remove" data-remove-report-source="${index}" aria-label="Quelle entfernen">✕</button>` +
				"</div>"
			);
		})
		.join("");
}

function readLocationReportSourceInputs() {
	return {
		label: String(document.getElementById("report-source-label")?.value || "").trim(),
		url: String(document.getElementById("report-source-url")?.value || "").trim(),
		pages: String(document.getElementById("report-source-pages")?.value || "").trim(),
		type: String(document.getElementById("report-source-type")?.value || "sonstiges"),
		reference_kind: String(document.getElementById("report-source-kind")?.value || ""),
		official: Boolean(document.getElementById("report-source-official")?.checked),
	};
}

function clearLocationReportSourceInputs() {
	["report-source-label", "report-source-url", "report-source-pages", "report-source-kind"].forEach((id) => {
		const element = document.getElementById(id);
		if (element) {
			element.value = "";
		}
	});
	const typeSelect = document.getElementById("report-source-type");
	if (typeSelect) {
		typeSelect.value = "sonstiges";
	}
	const officialInput = document.getElementById("report-source-official");
	if (officialInput) {
		officialInput.checked = false;
	}
}

function addLocationReportSourceFromInputs() {
	const source = readLocationReportSourceInputs();
	if (!source.label) {
		return false; // a source needs at least a name
	}
	locationReportSources.push(source);
	renderLocationReportSourcesList();
	clearLocationReportSourceInputs();
	document.getElementById("report-source-label")?.focus();
	return true;
}

function removeLocationReportSource(index) {
	if (index >= 0 && index < locationReportSources.length) {
		locationReportSources.splice(index, 1);
		renderLocationReportSourcesList();
	}
}

// The added rows PLUS a filled-but-not-yet-added row (reporter typed a source and forgot the button), so
// nothing entered is lost on submit.
function collectLocationReportSources() {
	const pending = readLocationReportSourceInputs();
	return pending.label ? [...locationReportSources, pending] : [...locationReportSources];
}

function resetLocationReportSources() {
	locationReportSources = [];
	clearLocationReportSourceInputs();
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
		sizeSelectElement.disabled = !isLocationReport;
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

function resetLocationEditForm({ preserveWikiSyncFlow = false } = {}) {
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
	activeReviewReportSourceSuggestions = [];
	pendingCrossingConversionPublicId = null;
	pendingCrossingConversionName = "";
	pendingCrossingConversionIsNodix = false;
	if (!preserveWikiSyncFlow) {
		resetWikiSyncCreateLocationFlowState();
	}
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

	const typeSelect = document.getElementById("location-report-type");
	const nameInput = document.getElementById("location-report-name");
	const sizeSelect = document.getElementById("location-report-size");
	const commentField = document.getElementById("location-report-comment");
	const reportType = ctx.reportType || "sonstiges";

	document.getElementById("location-report-mode").value = "change";
	document.getElementById("location-report-entity-type").value = ctx.entityType || "";
	document.getElementById("location-report-entity-id").value = ctx.entityId || "";

	// Category locked + preselected.
	if (typeSelect) {
		typeSelect.value = reportType;
		typeSelect.disabled = true;
	}

	// Name locked + prefilled.
	if (nameInput) {
		nameInput.value = ctx.name || "";
		nameInput.readOnly = true;
	}

	// Coordinates + meta.
	document.getElementById("location-report-coordinates").textContent = formatLocationReportCoordinates(L.latLng(lat, lng));
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
		sourcesLabel.textContent = tr("report.changeSourcesLabel", "Quellen (optional — Regionalband, Abenteuer, …)");
	}

	// Title + intro reflect the change context.
	const titleEl = document.getElementById("location-report-title");
	if (titleEl) {
		titleEl.textContent = tr("report.changeTitle", "Änderung vorschlagen") + (ctx.name ? " – " + ctx.name : "");
	}
	const introEl = document.querySelector(".location-report-dialog__intro");
	if (introEl) {
		introEl.textContent = tr("report.changeIntro", "Schlage eine Änderung an diesem Element vor. Beschreibe möglichst genau, was geändert werden soll. Eine Quelle hilft, ist aber nicht zwingend.");
	}
}

// Undo everything applyChangeSuggestionContext() changed, so the plain right-click "Hier melden…" is
// unaffected. form.reset() restores input VALUES but not disabled/readOnly/textContent -- do those here.
function clearChangeSuggestionMode() {
	const typeSelect = document.getElementById("location-report-type");
	const nameInput = document.getElementById("location-report-name");
	const commentField = document.getElementById("location-report-comment");
	if (typeSelect) typeSelect.disabled = false;
	if (nameInput) nameInput.readOnly = false;
	const modeEl = document.getElementById("location-report-mode");
	if (modeEl) modeEl.value = "new";
	const entityTypeEl = document.getElementById("location-report-entity-type");
	if (entityTypeEl) entityTypeEl.value = "";
	const entityIdEl = document.getElementById("location-report-entity-id");
	if (entityIdEl) entityIdEl.value = "";
	if (commentField) {
		commentField.required = false;
		const label = commentField.closest(".location-report-form__field")?.querySelector("span");
		if (label) {
			label.textContent = tr("report.commentLabel", "Kommentar (zur näheren Beschreibung)");
		}
	}
	const sourcesLabel = document.getElementById("location-report-sources-label");
	if (sourcesLabel) {
		sourcesLabel.textContent = tr("report.sourcesLabel", "Quellen * (mind. eine — Regionalband, Abenteuer, …)");
	}
	const titleEl = document.getElementById("location-report-title");
	if (titleEl) {
		titleEl.textContent = tr("report.title", "Karteneintrag melden");
	}
	const introEl = document.querySelector(".location-report-dialog__intro");
	if (introEl) {
		introEl.textContent = tr("report.intro", "Hilf mit, Avesmaps zu erweitern. Alle Meldungen werden gesammelt und geprüft. Bitte melde nur Einträge mit sicherer Quellenlage und beschreibe die Stelle, wenn die Position nicht eindeutig ist.");
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
	void acquireFeatureSoftLock(markerEntry?.publicId || "");
	const isCrossingConversion = pendingCrossingConversionPublicId && pendingCrossingConversionPublicId === markerEntry?.publicId;
	document.getElementById("location-edit-name").value = presetName || (isCrossingConversion ? pendingCrossingConversionName : "") || location.name || markerEntry?.name || "";
	document.getElementById("location-edit-type").value = normalizeLocationType(presetLocationType || location.locationType || markerEntry?.locationType || "dorf");
	document.getElementById("location-edit-description").value = presetDescription || "";
	document.getElementById("location-edit-wiki-url").value = presetWikiUrl || location.wikiUrl || wikiLocationLink?.url || "";
	// Shared multi-source editor (multi-source #2): replaces the old "Andere Quelle" single
	// url/label pair. The server-side takeover now owns other_source, so this dialog no longer
	// reads or writes it here or in buildLocationEditPayload (see mountLocationEditFeatureSources).
	mountLocationEditFeatureSources();
	document.getElementById("location-edit-is-nodix").checked = presetIsNodix === null
		? (isCrossingConversion ? pendingCrossingConversionIsNodix : Boolean(location.isNodix))
		: Boolean(presetIsNodix);
	document.getElementById("location-edit-is-ruined").checked = Boolean(location.isRuined);
	if (typeof renderSettlementWikiReference === "function") {
		renderSettlementWikiReference();
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
	resetLocationEditForm({ preserveWikiSyncFlow: true });
	populateLocationEditForm(options);
	setLocationEditDialogOpen(true);
}

// Mounts the shared multi-source editor into the "Ort bearbeiten" dialog (multi-source #2). The
// dialog markup is static -- unlike the settlement editor, which rebuilds its panel and so gets a
// fresh mount node for free -- so we clone-replace the container first: mountFeatureSourceEditor
// binds one click listener per call, and re-opening the dialog would otherwise stack duplicate
// listeners (and leave the previous feature's rows on screen). A place with no saved public_id has
// no feature to attach sources to, so the container just stays empty until it is first saved.
function mountLocationEditFeatureSources() {
	const container = document.getElementById("location-edit-feature-sources");
	if (!container) {
		return;
	}
	const fresh = container.cloneNode(false); // drops the previous mount's listener + rendered rows
	container.replaceWith(fresh);
	const publicId = document.getElementById("location-edit-public-id")?.value || "";
	if (!publicId || typeof mountFeatureSourceEditor !== "function") {
		return;
	}
	const markerEntry = locationEditMarkerEntry;
	void Promise.resolve(
		mountFeatureSourceEditor(
			fresh,
			"settlement",
			() => document.getElementById("location-edit-public-id")?.value || "",
			{ escape: escapeHtml }
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
	};

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
	// Eigene Uploads sind lokale URLs; Wiki-Wappen über den Cache-Proxy (Host-Whitelist).
	return coat.source === "own" ? coat.url : `/api/app/coat.php?u=${encodeURIComponent(coat.url)}`;
}

async function renderSettlementCoatSection(publicId) {
	const section = document.getElementById("settlement-coat-section");
	if (!section) {
		return;
	}
	if (!publicId) {
		section.hidden = true;
		section.dataset.publicId = "";
		return;
	}
	const preview = document.getElementById("settlement-coat-preview");
	const status = document.getElementById("settlement-coat-status");
	const adoptBtn = document.getElementById("settlement-coat-adopt");
	const removeBtn = document.getElementById("settlement-coat-remove");
	section.hidden = false;
	section.dataset.publicId = publicId;
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
	if (removeBtn) {
		removeBtn.hidden = true;
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
		const current = data.current && data.current.url ? data.current : null;
		const wiki = data.wiki && data.wiki.url ? data.wiki : null;
		if (current) {
			preview.innerHTML = `<img src="${escapeHtml(settlementCoatImageSrc(current))}" alt="Wappen" />`;
			status.textContent = current.source === "own" ? "Eigenes Wappen aktiv." : "Gemeinfreies Wiki-Wappen aktiv.";
			removeBtn.hidden = false;
			if (wiki && wiki.allowed && (current.source === "own" || current.url !== wiki.url)) {
				adoptBtn.hidden = false;
			}
		} else if (wiki) {
			preview.className = wiki.allowed ? "settlement-coat__preview" : "settlement-coat__preview settlement-coat__preview--dim";
			preview.innerHTML = `<img src="${escapeHtml(settlementCoatImageSrc(wiki))}" alt="Wiki-Wappen" />`;
			if (wiki.allowed) {
				status.textContent = "Gemeinfreies Wiki-Wappen verfügbar.";
				adoptBtn.hidden = false;
			} else {
				status.textContent = "Wiki-Wappen vorhanden, aber nicht gemeinfrei — nicht übernehmbar.";
			}
		} else {
			status.textContent = "Kein Wappen vorhanden.";
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

async function uploadOwnSettlementCoat(file) {
	const section = document.getElementById("settlement-coat-section");
	const publicId = section?.dataset.publicId || document.getElementById("location-edit-public-id")?.value || "";
	if (!publicId || !file) {
		return;
	}
	const status = document.getElementById("settlement-coat-status");
	if (status) {
		status.textContent = "Wappen wird hochgeladen …";
	}
	try {
		const form = new FormData();
		form.append("public_id", publicId);
		form.append("coat", file);
		const response = await fetch("/api/edit/wiki/settlement-coat-upload.php", {
			method: "POST",
			credentials: "same-origin",
			body: form,
		});
		const data = await response.json();
		if (!data || data.ok !== true) {
			throw new Error(apiErrorMessage(data, "Upload fehlgeschlagen"));
		}
		showFeedbackToast?.("Eigenes Wappen hochgeladen.", "success");
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
		showFeedbackToast?.("Fehler: " + (error.message || error), "error");
		await renderSettlementCoatSection(publicId);
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
	// Upload-Button oder Klick auf die Vorschau -> Datei-Auswahl öffnen.
	if (event.target.closest("#settlement-coat-upload") || event.target.closest("#settlement-coat-preview")) {
		event.preventDefault();
		document.getElementById("settlement-coat-file")?.click();
	}
});

document.addEventListener("change", (event) => {
	if (event.target && event.target.id === "settlement-coat-file") {
		const file = event.target.files && event.target.files[0];
		event.target.value = ""; // erneutes Auswählen derselben Datei erlauben
		if (file) {
			void uploadOwnSettlementCoat(file);
		}
	}
});

function normalizeLabelFeature(feature) {
	const properties = feature.properties || {};
	const [lng, lat] = feature.geometry?.coordinates || [feature.lng, feature.lat];
	return {
		publicId: properties.public_id || feature.id || feature.public_id || "",
		text: properties.text || properties.name || feature.name || "",
		labelType: properties.feature_subtype || feature.feature_subtype || "region",
		size: Number(properties.size || feature.size || 18),
		rotation: Number(properties.rotation || feature.rotation || 0),
		minZoom: Number(properties.min_zoom ?? feature.min_zoom ?? 0),
		maxZoom: Number(properties.max_zoom ?? feature.max_zoom ?? 5),
		priority: Number(properties.priority ?? feature.priority ?? 3),
		isNodix: Boolean(properties.is_nodix ?? feature.is_nodix),
		revision: Number(properties.revision ?? feature.revision) || null,
		wikiRegion: properties.wiki_region && typeof properties.wiki_region === "object" ? properties.wiki_region : null,
		coordinates: [Number(lat), Number(lng)],
	};
}

function createLabelIcon(label) {
	const safeSize = getScaledLabelSize(label);
	const safeRotation = (((Number(label.rotation) || 0) % 360) + 360) % 360;
	return L.divIcon({
		className: `map-label map-label--${label.labelType}${labelHasWikiRegion(label) ? " map-label--has-wiki" : ""}`,
		html: `<span style="font-size:${safeSize}px; transform: translate(calc(-50% + var(--label-offset-x, 0px)), calc(-50% + var(--label-offset-y, 0px))) rotate(${safeRotation}deg);">${escapeHtml(label.text)}</span>`,
		iconSize: [0, 0],
		iconAnchor: [0, 0],
	});
}

function getScaledLabelSize(label) {
	const baseSize = Math.max(10, Math.min(56, Number(label.size) || 18));
	const visualZoomLevel = getVisualZoomLevel(map.getZoom());
	const zoomRatio = Math.max(0, Math.min(1, visualZoomLevel / VISUAL_MAX_ZOOM_LEVEL));
	return Math.round(baseSize * (0.5 + zoomRatio * 0.5));
}

function labelHasWikiRegion(label) {
	return Boolean(label && label.wikiRegion && label.wikiRegion.wiki_key);
}

// Infobox einer Wiki-Landschaft (Ansichtsmodus, Klick auf das Label). Bild nur bei nachweislich
// freier Lizenz (gemeinfrei); sonst ausgeblendet (konservativ wie bei den Herrschaftsgebieten).
function labelWikiInfoboxMarkup(label, options = {}) {
	// Gleiche Struktur/Klassen wie die Herrschaftsgebiete-Infobox (.region-info-box) -> erbt deren
	// Styles/Abstaende. Bild nur bei nachweislich freier Lizenz (gemeinfrei), sonst ausgeblendet.
	// headless: ohne eigenen Kopf/Titel (im Edit-Popup zeigt der Popup-Kopf Name + Typ schon).
	const headless = Boolean(options.headless);
	const wiki = label.wikiRegion || {};
	const name = wiki.name || label.text || "";
	const licenseStatus = String(wiki.image_license_status || "").toLowerCase();
	const imageIsFree = licenseStatus === "public_domain" || licenseStatus === "public-domain" || licenseStatus === "gemeinfrei";
	const coatMarkup = wiki.image_url && imageIsFree
		? `<img class="region-info-box__coat" src="${escapeHtml(wiki.image_url)}" alt="" loading="lazy" decoding="async">`
		: "";
	const hasCoatClass = coatMarkup ? " has-coat" : "";

	const art = String(wiki.art || "").trim();
	const row = (dtLabel, value) => {
		if (!value || String(value).trim() === "") {
			return "";
		}
		return `<div class="region-info-box__row"><dt>${escapeHtml(dtLabel)}</dt><dd>${escapeHtml(value)}</dd></div>`;
	};

	let rows = "";
	rows += row("Lage", wiki.region_parent);
	rows += row("Staat", wiki.affiliation_staat);
	rows += row("Einwohner", wiki.einwohner);
	rows += row("Sprache", wiki.sprache);
	rows += row("Vegetation", wiki.vegetation);
	rows += row("Beschreibung", typeof settlementFirstSentence === "function" ? settlementFirstSentence(wiki.description) : String(wiki.description || "").trim());
	const wikiLink = wiki.wiki_url
		? `<a class="region-info-box__link" href="${escapeHtml(wiki.wiki_url)}" target="_blank" rel="noopener">${escapeHtml(name)} im Wiki-Aventurica ↗</a>`
		: "";

	const header = headless ? "" : (
		`<div class="region-info-box__header${hasCoatClass}">` +
		coatMarkup +
		'<div class="region-info-box__title-group">' +
		`<strong class="region-info-box__title">${escapeHtml(name)}</strong>` +
		(art ? `<span class="region-info-box__subtitle">${escapeHtml(art)}</span>` : "") +
		"</div></div>"
	);
	return (
		`<div class="region-info-box${headless ? " region-info-box--settlement" : ""}">` +
		header +
		`<dl class="region-info-box__data">${rows}</dl>` +
		wikiLink +
		"</div>"
	);
}

function createLabelMarkerEntry(label) {
	const marker = L.marker(label.coordinates, {
		icon: createLabelIcon(label),
		draggable: false,
		interactive: IS_EDIT_MODE || labelHasWikiRegion(label),
		keyboard: false,
		pane: "labelsPane",
	});
	const entry = { label, marker };
	if (IS_EDIT_MODE) {
		refreshLabelMarkerPopup(entry);
		marker.on("dragend", () => {
			void saveLabelPosition(entry);
			setLabelMoveActive(entry, false);
		});
	} else if (labelHasWikiRegion(label)) {
		// Ansichtsmodus: EXAKT dasselbe Popup wie der Edit-Mode (labelPopupMarkup ->
		// locationPopupMarkup, Klasse settlement-popup, kopflose region-info-box--settlement),
		// nur OHNE die Bearbeiten-Buttons. Gleicher Code-Pfad = identische Struktur/Breite/Styles.
		const art = (label.wikiRegion && label.wikiRegion.art) ? label.wikiRegion.art : "Region";
		marker.bindPopup(
			locationPopupMarkup({
				name: label.text || (label.wikiRegion && label.wikiRegion.name) || "Region",
				locationTypeLabel: art,
				showHeaderIcon: false,
				compact: true,
				showType: true,
				showDescription: false,
				showWikiLink: false,
				// Infobox + "Link teilen"-Leiste (im Ansichtsmodus kein Edit-Button).
				actionsMarkup: labelWikiInfoboxMarkup(label, { headless: true })
					+ locationPopupActionsMarkup([sharePlaceActionButtonMarkup(label.publicId)].filter(Boolean)),
			}),
			{ className: "settlement-popup", minWidth: 320, maxWidth: 400, autoPan: true }
		);
	}
	syncLabelMarkerVisibility(entry);
	return entry;
}

function refreshLabelMarkerPopup(entry) {
	if (!IS_EDIT_MODE) {
		return;
	}

	const options = labelHasWikiRegion(entry.label) ? { className: "settlement-popup", minWidth: 320, maxWidth: 400 } : undefined;
	entry.marker.bindPopup(labelPopupMarkup(entry), options);
}

function findLabelEntryByPublicId(publicId) {
	return labelMarkers.find((entry) => entry.label.publicId === publicId) || null;
}

function setLabelMoveActive(entry, isActive) {
	if (!entry?.marker?.dragging) {
		return;
	}

	if (isActive) {
		void acquireFeatureSoftLock(entry.label.publicId);
		entry.marker.dragging.enable();
		entry.marker.closePopup();
		showFeedbackToast(`${entry.label.text}: Label verschieben, Loslassen speichert.`, "info");
		return;
	}

	entry.marker.dragging.disable();
	void releaseFeatureSoftLock(entry.label.publicId);
}

function shouldShowLabelMarker(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds()) {
	const minZoom = Number(entry.label.minZoom) || 0;
	const maxZoom = Number.isFinite(Number(entry.label.maxZoom)) ? Number(entry.label.maxZoom) : 5;
	const visualZoomLevel = getVisualZoomLevel(zoomLevel);
	return getSelectedMapLayerMode() === "deregraphic"
		&& visualZoomLevel >= minZoom
		&& visualZoomLevel <= maxZoom
		&& isLatLngInRenderBounds(entry.marker.getLatLng(), renderBounds);
}

function syncLabelMarkerVisibility(entry, zoomLevel = map.getZoom(), renderBounds = getMapRenderBounds()) {
	const shouldShow = shouldShowLabelMarker(entry, zoomLevel, renderBounds);
	const isVisible = map.hasLayer(entry.marker);
	if (shouldShow && !isVisible) {
		entry.marker.addTo(map);
		return;
	}

	if (!shouldShow && isVisible) {
		map.removeLayer(entry.marker);
	}
}

function syncLabelVisibility() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	labelMarkers.forEach((entry) => syncLabelMarkerVisibility(entry, zoomLevel, renderBounds));
	scheduleLabelCollisionResolution();
}

function syncLabelIcons() {
	const zoomLevel = map.getZoom();
	const renderBounds = getMapRenderBounds();
	labelMarkers.forEach((entry) => {
		if (shouldShowLabelMarker(entry, zoomLevel, renderBounds) || map.hasLayer(entry.marker)) {
			entry.marker.setIcon(createLabelIcon(entry.label));
		}
		syncLabelMarkerVisibility(entry, zoomLevel, renderBounds);
	});
	scheduleLabelCollisionResolution();
}

function prepareLabelData(data) {
	labelMarkers.forEach((entry) => map.removeLayer(entry.marker));
	labelData = data.features.filter((feature) => feature.properties?.feature_type === "label").map(normalizeLabelFeature);
	labelMarkers = labelData.map(createLabelMarkerEntry);
	syncLabelVisibility();
}

function addCreatedLabelFeature(feature) {
	const label = normalizeLabelFeature(feature);
	const entry = createLabelMarkerEntry(label);
	labelData.push(label);
	labelMarkers.push(entry);
	refreshLabelMarkerPopup(entry);
	return entry;
}

function applyLabelFeatureResponse(entry, feature) {
	const label = normalizeLabelFeature(feature);
	Object.assign(entry.label, label);
	entry.marker.setLatLng(label.coordinates);
	entry.marker.setIcon(createLabelIcon(label));
	refreshLabelMarkerPopup(entry);
	syncLabelMarkerVisibility(entry);
}

function applyLiveLabelFeature(feature) {
	const label = normalizeLabelFeature(feature);
	const entry = labelMarkers.find((labelEntry) => labelEntry.label.publicId === label.publicId);
	if (entry) {
		applyLabelFeatureResponse(entry, feature);
		return;
	}

	const newEntry = createLabelMarkerEntry(label);
	labelData.push(label);
	labelMarkers.push(newEntry);
	syncLabelMarkerVisibility(newEntry);
}

async function saveLabelPosition(entry) {
	const latlng = entry.marker.getLatLng();
	try {
		const result = await submitMapFeatureEdit({
			action: "move_label",
			public_id: entry.label.publicId,
			lat: latlng.lat,
			lng: latlng.lng,
		});
		applyLabelFeatureResponse(entry, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		showFeedbackToast("Labelposition gespeichert.", "success");
	} catch (error) {
		console.error("Label konnte nicht verschoben werden:", error);
		showFeedbackToast(error.message || "Label konnte nicht verschoben werden.", "warning");
	}
}

async function deleteLabelEntry(entry, { closeDialog = false } = {}) {
	if (!entry || !window.confirm(`${entry.label.text} wirklich löschen?`)) {
		return;
	}

	try {
		const result = await submitMapFeatureEdit({
			action: "delete_feature",
			public_id: entry.label.publicId,
		});
		map.removeLayer(entry.marker);
		labelData = labelData.filter((label) => label !== entry.label);
		labelMarkers = labelMarkers.filter((labelEntry) => labelEntry !== entry);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		if (closeDialog) {
			setLabelEditDialogOpen(false, { resetForm: true });
		}
		showFeedbackToast("Label gelöscht.", "success");
	} catch (error) {
		console.error("Label konnte nicht gelöscht werden:", error);
		setLabelEditStatus(error.message || "Label konnte nicht gelöscht werden.", "error");
	}
}

async function deleteActiveLabel() {
	await deleteLabelEntry(labelEditEntry, { closeDialog: true });
}

async function duplicateLabelEntry(entry) {
	if (!entry) {
		showFeedbackToast("Label konnte nicht gefunden werden.", "warning");
		return;
	}

	const sourceLatLng = entry.marker.getLatLng();
	const duplicateLatLng = map.layerPointToLatLng(map.latLngToLayerPoint(sourceLatLng).add([24, 24]));
	try {
		const result = await submitMapFeatureEdit({
			action: "create_label",
			text: entry.label.text,
			feature_subtype: entry.label.labelType || "region",
			size: Number(entry.label.size) || 18,
			rotation: Number(entry.label.rotation) || 0,
			min_zoom: Number(entry.label.minZoom) || 0,
			max_zoom: Number(entry.label.maxZoom) || 5,
			priority: Number(entry.label.priority) || 3,
			lat: duplicateLatLng.lat,
			lng: duplicateLatLng.lng,
		});
		const duplicatedLabelEntry = addCreatedLabelFeature(result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		entry.marker.closePopup();
		pendingLabelMoveAfterEditEntry = duplicatedLabelEntry;
		openLabelEditDialog({ labelEntry: duplicatedLabelEntry });
		showFeedbackToast("Label dupliziert. Details bearbeiten, danach verschieben.", "success");
	} catch (error) {
		console.error("Label konnte nicht dupliziert werden:", error);
		showFeedbackToast(error.message || "Label konnte nicht dupliziert werden.", "warning");
	}
}

function createLabelAt(latlng) {
	setSelectedMapLayerMode("deregraphic");
	openLabelEditDialog({ latlng: L.latLng(latlng) });
}

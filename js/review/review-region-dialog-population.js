function populateRegionEditForm(entry, { preserveTabs = false } = {}) {
	regionEditEntry = entry;
	const region = entry?.region || entry || {};
	const source = region.source || "map_feature";
	const geometryPublicId = source === "political_territory"
		? getPrimaryRegionGeometryPublicId()
		: String(region.geometryPublicId || region.publicId || "").trim();
	regionParentSelectedTreeId = region.territoryPublicId || "";
	document.getElementById("region-edit-public-id").value = region.publicId || "";
	document.getElementById("region-edit-source").value = source;
	document.getElementById("region-edit-territory-public-id").value = region.territoryPublicId || "";
	document.getElementById("region-edit-geometry-public-id").value = geometryPublicId;
	document.getElementById("region-edit-wiki-id").value = region.wikiId || region.wiki_id || "";
	if (source !== "political_territory") {
		void acquireFeatureSoftLock(region.publicId || "");
	}
	document.getElementById("region-edit-name").value = normalizeParentheticalSpacing(region.displayName || region.name || "");
	document.getElementById("region-edit-short-name").value = region.shortName || "";
	document.getElementById("region-edit-color").value = region.color || "#888888";
	document.getElementById("region-edit-opacity").value = Math.round((region.opacity ?? 0.33) * 100);
	document.getElementById("region-edit-wiki-url").value = region.wikiUrl || "";
	document.getElementById("region-edit-coat-url").value = region.coatOfArmsUrl || "";
	document.getElementById("region-edit-min-zoom").value = region.minZoom ?? "";
	document.getElementById("region-edit-max-zoom").value = region.maxZoom ?? "";
	document.getElementById("region-edit-valid-from").value = region.validFromBf ?? "";
	document.getElementById("region-edit-valid-to").value = region.validToBf ?? "";
	document.getElementById("region-edit-valid-open").checked = region.validToBf === null || region.validToBf === undefined;
	document.getElementById("region-edit-valid-label").value = region.validLabel || "";
	document.getElementById("region-edit-is-active").checked = region.isActive !== false;
	document.getElementById("region-edit-notes").value = region.editorNotes || "";
	updateRegionParentDropTarget(region.parentPublicId || "");
	syncRegionTerritoryFieldVisibility(source);
	syncRegionCoatPreview();
	populateRegionTypeOptions(region);
	populateRegionParentSelect(region);
	renderRegionWikiReference(region);
	syncRegionAssignmentForRegion(region);
	if (typeof syncDerivedGeometryEditorForRegion === "function") {
		syncDerivedGeometryEditorForRegion(region);
	}
	document.getElementById("region-edit-delete").hidden = !entry;
	syncRegionOpacityOutput();
	syncRegionValidToControls();
}

function openRegionEditDialog(entry, { title = "Eigenschaften bearbeiten" } = {}) {
	const region = entry?.region || entry || {};
	const canOpenPoliticalTerritoryEditor = region.source === "political_territory"
		&& typeof window.AvesmapsPoliticalTerritoryEditorLink?.open === "function"
		&& document.getElementById("political-territory-editor-frame");
	if (canOpenPoliticalTerritoryEditor) {
		window.AvesmapsPoliticalTerritoryEditorLink.open(region);
		return;
	}

	resetRegionEditForm();
	document.getElementById("region-edit-title").textContent = title;
	initializeRegionEditTabs(entry);
	const initialEntry = regionEditTabs[0] || entry;
	populateRegionEditForm(initialEntry, { preserveTabs: true });
	setRegionEditDialogOpen(true);
	void loadPoliticalTerritoryOptions().then(() => {
		if (regionEditEntry === initialEntry || regionEditEntry === entry || regionEditTabs.length > 0) {
			const activeEntry = regionEditTabs[0] || initialEntry;
			populateRegionTypeOptions(activeEntry?.region || activeEntry || {});
			populateRegionParentSelect(activeEntry?.region || activeEntry || {});
			updateRegionParentDropTarget((activeEntry?.region || activeEntry || {}).parentPublicId || "");
		}
	});
}

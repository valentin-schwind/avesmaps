function buildRegionEditPayload(formElement) {
	const formData = new FormData(formElement);
	const source = String(formData.get("source") || "map_feature").trim();
	if (source === "political_territory") {
		return {
			action: "update_territory",
			source,
			public_id: String(formData.get("geometry_public_id") || "").trim(),
			geometry_public_id: String(formData.get("geometry_public_id") || "").trim(),
			territory_public_id: String(formData.get("territory_public_id") || "").trim(),
			wiki_id: String(formData.get("wiki_id") || "").trim(),
			name: String(formData.get("name") || "").trim(),
			short_name: String(formData.get("short_name") || "").trim(),
			type: String(formData.get("type") || "").trim(),
			parent_public_id: String(formData.get("parent_public_id") || "").trim(),
			color: String(formData.get("color") || "#888888").trim(),
			opacity: Number.parseInt(String(formData.get("opacity") || "33"), 10) / 100,
			wiki_url: String(formData.get("wiki_url") || "").trim(),
			coat_of_arms_url: String(formData.get("coat_of_arms_url") || "").trim(),
			min_zoom: String(formData.get("min_zoom") || "").trim(),
			max_zoom: String(formData.get("max_zoom") || "").trim(),
			valid_from_bf: String(formData.get("valid_from_bf") || "").trim(),
			valid_to_bf: String(formData.get("valid_to_bf") || "").trim(),
			valid_to_open: ["on", "1", "true"].includes(String(formData.get("valid_to_open") || "").trim().toLowerCase()),
			valid_label: String(formData.get("valid_label") || "").trim(),
			editor_notes: String(formData.get("editor_notes") || "").trim(),
		};
	}

	return {
		action: "update_region",
		public_id: String(formData.get("public_id") || "").trim(),
		name: String(formData.get("name") || "").trim(),
		color: String(formData.get("color") || "#888888").trim(),
		opacity: Number.parseInt(String(formData.get("opacity") || "33"), 10) / 100,
		wiki_url: String(formData.get("wiki_url") || "").trim(),
	};
}

async function handleRegionEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !regionEditEntry) {
		return;
	}
	syncRegionEditRequiredState();
	if (!formElement.reportValidity()) {
		return;
	}
	snapshotActiveRegionEditTab();
	const payload = buildRegionEditPayload(formElement);
	const payloads = payload.source === "political_territory" && regionEditTabs.length > 0
		? regionEditTabs.map((tab) => tab.payload || regionEditPayloadToPayload(tab.region)).filter(Boolean)
		: [payload];
	const saveablePayloads = payload.source === "political_territory"
		? payloads.filter((entry) => String(entry?.territory_public_id || "").trim() !== "")
		: payloads;
	if (payload.source === "political_territory" && payloads.length > 0 && saveablePayloads.length < 1) {
		setRegionEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Geometrie bleibt freigegeben.", "success");
		return;
	}
	if (payload.source === "political_territory" && saveablePayloads.length !== payloads.length) {
		regionEditTabs = regionEditTabs.filter((tab) => {
			const tabPayload = tab.payload || regionEditPayloadToPayload(tab.region);
			return String(tabPayload?.territory_public_id || "").trim() !== "";
		});
	}
	if (payload.source === "political_territory" && saveablePayloads.some((entry) => String(entry?.territory_public_id || "").trim() === "")) {
		setRegionEditStatus("Bitte zuerst einen untersten Knoten zuweisen.", "error");
		return;
	}
	if (payload.source !== "political_territory" && !isSqlMapFeatureId(payload.public_id)) {
		setRegionEditStatus("Diese Region hat keine gültige SQL-ID. Bitte die SQL-Karte neu laden.", "error");
		return;
	}
	try {
		let latestResult = null;
		if (payload.source === "political_territory") {
			for (const tab of regionEditTabs) {
				latestResult = await saveRegionEditTab(tab);
			}
			if (typeof saveDerivedGeometryEditorIfNeeded === "function") {
				await saveDerivedGeometryEditorIfNeeded();
			}
			void loadPoliticalTerritoryOptions({ force: true });
			schedulePoliticalTerritoryLayerReload({ immediate: true });
		} else {
			latestResult = await submitMapFeatureEdit(payloads[0]);
			updateRevisionFromEditResponse(latestResult);
			void loadChangeLog();
		}
		setRegionEditDialogOpen(false, { resetForm: true });
		showFeedbackToast(payloads.length > 1 ? `${payloads.length} Herrschaftsgebiete gespeichert.` : "Herrschaftsgebiet gespeichert.", "success");
	} catch (error) {
		console.error("Herrschaftsgebiet konnte nicht gespeichert werden:", error);
		setRegionEditStatus(error.message || "Herrschaftsgebiet konnte nicht gespeichert werden.", "error");
	}
}

async function handleLocationEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const payload = attachActiveReviewReportContext(buildLocationEditPayload(formElement));
	if (pendingCrossingConversionPublicId && pendingCrossingConversionPublicId === payload.public_id && !payload.name) {
		payload.name = pendingCrossingConversionName || payload.name;
	}
	const duplicateLocation = findDuplicateLocationByName(payload.name, {
		excludePublicId: payload.public_id || "",
		allowCurrentName: locationEditMarkerEntry?.location?.name || locationEditMarkerEntry?.name || "",
	});
	if (duplicateLocation) {
		setLocationEditStatus(`Ein Ort namens "${duplicateLocation.name}" existiert bereits.`, "error");
		return;
	}
	setLocationEditStatus("Ort wird gespeichert...", "pending");
	setLocationEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		const responseFeature = pendingCrossingConversionPublicId === payload.public_id
			? { ...result.feature, name: result.feature?.name || payload.name }
			: result.feature;
		let savedMarkerEntry = locationEditMarkerEntry;
		if (locationEditMarkerEntry) {
			applyFeatureResponseToMarker(locationEditMarkerEntry, responseFeature);
			if (pendingCrossingConversionPublicId === payload.public_id) {
				ensureLocationNameLabel(locationEditMarkerEntry);
				syncLocationNameLabelVisibility();
			}
		} else {
			savedMarkerEntry = addCreatedLocationMarker(responseFeature);
		}
		// Auto-connect the place to its wiki settlement so a save attaches the {{Infobox Siedlung}} data
		// without a manual "Zuweisen". Two paths, in order:
		//  1) By wiki_url (e.g. inherited from a community report): runs when the URL resolves to a
		//     settlement title DIFFERENT from the one currently connected -- a brand-new place OR a
		//     corrected URL on an already-connected one (owner: a changed source must be taken over).
		//     Stays off when the URL already matches; a manual "Verbindung entfernen" clears the wiki_url
		//     field (removeSettlementWiki) so an unrelated later save does not silently re-attach it.
		//  2) By NAME (owner): community reports usually carry only a book source, no wiki link -> path 1
		//     never fires. When a place is freshly created with NO wiki_url and NOTHING connected yet but
		//     its name matches a wiki settlement exactly, connect via the name. The server only matches a
		//     page titled exactly like the place (no fuzzy match), so "Wengenholm 2" stays unconnected.
		// A failed URL attempt is surfaced (not silent) so the editor knows to assign manually; a failed
		// name attempt stays quiet (most places have no same-named wiki page -- that is not an error).
		const connectedWikiTitle = savedMarkerEntry && savedMarkerEntry.location && savedMarkerEntry.location.wikiSettlement
			? String(savedMarkerEntry.location.wikiSettlement.title || "")
			: "";
		const desiredWikiTitle = typeof settlementWikiTitleFromUrl === "function"
			? settlementWikiTitleFromUrl(payload.wiki_url)
			: "";
		const connectPublicId = savedMarkerEntry?.publicId || savedMarkerEntry?.location?.publicId || responseFeature?.public_id || "";
		if (desiredWikiTitle && desiredWikiTitle !== connectedWikiTitle && connectPublicId
			&& typeof autoConnectSettlementWikiByUrl === "function") {
			const connected = await autoConnectSettlementWikiByUrl(connectPublicId, payload.wiki_url, savedMarkerEntry);
			if (!connected) {
				showFeedbackToast?.(`Wiki-Siedlung „${desiredWikiTitle}" konnte nicht automatisch verbunden werden – bitte manuell „Zuweisen".`, "warning");
			}
		} else if (!desiredWikiTitle && !connectedWikiTitle && payload.action === "create_point" && payload.name && connectPublicId
			&& typeof autoConnectSettlementWikiByTitle === "function") {
			await autoConnectSettlementWikiByTitle(connectPublicId, payload.name, savedMarkerEntry);
		}
		// Multi-source #3: each community-reported source WITH a link becomes a real feature_source on the
		// freshly created place (same catalog the manual "Quelle hinzufügen" writes to) so they show in the
		// QUELLEN section instead of being lost in the description. Best-effort per source; needs id + url.
		if (payload.action === "create_point" && connectPublicId && Array.isArray(activeReviewReportSourceSuggestions)
			&& typeof linkCommunityReportSource === "function") {
			for (const suggestion of activeReviewReportSourceSuggestions) {
				if (suggestion && suggestion.url) {
					await linkCommunityReportSource(connectPublicId, suggestion);
				}
			}
		}
		activeReviewReportSourceSuggestions = [];
		if (payload.action === "create_point" && activeReviewReportId) {
			await updateReviewReportStatus(activeReviewReportId, "approved", activeReviewReportSource || "location_reports");
			activeReviewReportId = null;
			activeReviewReportSource = null;
			clearReviewReportMarker();
			await loadReviewReports();
		}
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		pendingCrossingConversionPublicId = null;
		pendingCrossingConversionName = "";
		pendingCrossingConversionIsNodix = false;
		const wikiSyncCreatedCaseId = wikiSyncCreateLocationCaseId;
		if (wikiSyncCreatedCaseId) {
			const archived = await archiveWikiSyncCreatedLocationCase(wikiSyncCreatedCaseId, responseFeature || result.feature || null);
			resetWikiSyncCreateLocationFlowState();
			if (archived) {
				setWikiSyncStatus("Ort wurde gespeichert, Wiki-Meldung ist archiviert.", "success");
				showFeedbackToast("Ort wurde gespeichert, Wiki-Meldung ist archiviert.", "success");
			} else {
				showFeedbackToast("Ort wurde gespeichert, die Wiki-Meldung konnte noch nicht archiviert werden.", "warning");
			}
		} else {
			resetWikiSyncCreateLocationFlowState();
		}
		setLocationEditSubmitPending(false);
		setLocationEditDialogOpen(false, { resetForm: true });
		if (!wikiSyncCreatedCaseId) {
			showFeedbackToast("Ort gespeichert.", "success");
		}
		if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
			void refreshActiveWikiSyncPanelAfterAssignment();
		}
	} catch (error) {
		console.error("Ort konnte nicht gespeichert werden:", error);
		setLocationEditStatus(error.message || "Ort konnte nicht gespeichert werden.", "error");
	} finally {
		setLocationEditSubmitPending(false);
	}
}

async function handlePathEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity() || !pathEditFeature) {
		return;
	}

	const payload = buildPathEditPayload(formElement);
	const isAutoNameEnabled = formElement.querySelector("#path-edit-autoname")?.checked === true;
	setPathEditStatus("Weg wird gespeichert...", "pending");
	setPathEditSubmitPending(true);

	try {
		const result = await submitMapFeatureEdit(payload);
		applyPathFeatureResponse(pathEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		rememberPathEditSettingsFromPayload(payload, { autoname: isAutoNameEnabled });
		setPathEditSubmitPending(false);
		setPathEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Weg gespeichert.", "success");
	} catch (error) {
		console.error("Weg konnte nicht gespeichert werden:", error);
		setPathEditStatus(error.message || "Weg konnte nicht gespeichert werden.", "error");
	} finally {
		setPathEditSubmitPending(false);
	}
}

async function handlePowerlineEditFormSubmit(event) {
	event.preventDefault();
	const formElement = getPowerlineEditFormElement();
	if (!formElement || !powerlineEditFeature) {
		return;
	}

	const payload = buildPowerlineEditPayload(formElement);
	if (!payload.public_id || !payload.name) {
		setPowerlineEditStatus("Ein Name für die Kraftlinie fehlt.", "error");
		return;
	}

	setPowerlineEditSubmitPending(true);
	setPowerlineEditStatus("Kraftlinie wird gespeichert...", "pending");
	try {
		const result = await submitMapFeatureEdit(payload);
		applyPowerlineFeatureResponse(powerlineEditFeature, result.feature);
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		setPowerlineEditSubmitPending(false);
		setPowerlineEditDialogOpen(false, { resetForm: true });
		showFeedbackToast("Kraftlinie gespeichert.", "success");
	} catch (error) {
		console.error("Kraftlinie konnte nicht gespeichert werden:", error);
		setPowerlineEditStatus(error.message || "Kraftlinie konnte nicht gespeichert werden.", "error");
	} finally {
		setPowerlineEditSubmitPending(false);
	}
}

async function handleLabelEditFormSubmit(event) {
	event.preventDefault();
	const formElement = event.currentTarget instanceof HTMLFormElement ? event.currentTarget : null;
	if (!formElement || !formElement.reportValidity()) {
		return;
	}

	const payload = attachActiveReviewReportContext(buildLabelEditPayload(formElement));
	const editedLabelEntry = labelEditEntry;
	const shouldStartMoveAfterSave = pendingLabelMoveAfterEditEntry === editedLabelEntry;
	pendingLabelMoveAfterEditEntry = null;
	setLabelEditStatus("Label wird gespeichert...", "pending");
	try {
		const result = await submitMapFeatureEdit(payload);
		let savedLabelEntry = editedLabelEntry;
		if (labelEditEntry) {
			applyLabelFeatureResponse(labelEditEntry, result.feature);
		} else {
			savedLabelEntry = addCreatedLabelFeature(result.feature);
		}
		updateRevisionFromEditResponse(result);
		void loadChangeLog();
		if (payload.action === "create_label" && activeReviewReportId) {
			await updateReviewReportStatus(activeReviewReportId, "approved", activeReviewReportSource || "map_reports");
			activeReviewReportId = null;
			activeReviewReportSource = null;
			clearReviewReportMarker();
			await loadReviewReports();
		}
		setLabelEditDialogOpen(false, { resetForm: true });
		if (shouldStartMoveAfterSave && savedLabelEntry) {
			setLabelMoveActive(savedLabelEntry, true);
		}
		showFeedbackToast("Label gespeichert.", "success");
		if (typeof refreshActiveWikiSyncPanelAfterAssignment === "function") {
			void refreshActiveWikiSyncPanelAfterAssignment();
		}
	} catch (error) {
		console.error("Label konnte nicht gespeichert werden:", error);
		setLabelEditStatus(error.message || "Label konnte nicht gespeichert werden.", "error");
	}
}

// Change-log / audit feed: load + render the edit history, focus an audited
// feature on the map (path/label markers), and undo audit changes (incl. the
// undo keyboard shortcut). Split out of review-panels.js (M5 god-file split).
// Plain classic script: global functions called at runtime.

async function loadChangeLog() {
	if (!IS_EDIT_MODE) {
		return;
	}

	setChangePanelStatus("Änderungen werden geladen...", "pending");
	try {
		const response = await fetch(MAP_AUDIT_LOG_API_URL, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(apiErrorMessage(data, `Änderungs-API antwortet mit HTTP ${response.status}.`));
		}

		let politicalChanges = [];
		try {
			const politicalChangeLog = await fetchPoliticalChangeLog();
			politicalChanges = Array.isArray(politicalChangeLog?.changes) ? politicalChangeLog.changes : [];
		} catch (error) {
			console.warn("Politischer Änderungsverlauf konnte nicht geladen werden:", error);
		}

		const mapChanges = Array.isArray(data.changes)
			? data.changes.map((entry) => ({ ...entry, audit_source: "map_feature" }))
			: [];
		const politicalChangeEntries = politicalChanges.map((entry) => ({ ...entry, audit_source: "political_territory" }));
		changeLogEntries = [...mapChanges, ...politicalChangeEntries]
			.sort((left, right) => {
				const leftTime = Date.parse(String(left?.created_at || ""));
				const rightTime = Date.parse(String(right?.created_at || ""));
				if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
					return rightTime - leftTime;
				}
				return Number(right?.id || 0) - Number(left?.id || 0);
			})
			.slice(0, 100);
		renderChangeLog();
	} catch (error) {
		console.error("Änderungsverlauf konnte nicht geladen werden:", error);
		setChangePanelStatus(error.message || "Änderungsverlauf konnte nicht geladen werden.", "error");
	}
}

function formatChangeAction(action) {
	if (String(action || "").startsWith("undo_")) {
		return `Rückgängig: ${formatChangeAction(String(action).replace(/^undo_/, ""))}`;
	}

	const labels = {
		move_point: "Ort verschoben",
		update_point: "Ort geändert",
		create_point: "Ort erstellt",
		wiki_sync_update_point: "WikiSync: Ort geändert",
		wiki_sync_create_point: "WikiSync: Ort erstellt",
		create_crossing: "Kreuzung erstellt",
		create_powerline: "Kraftlinie erstellt",
		update_powerline_details: "Kraftlinie geändert",
		create_path: "Weg erstellt",
		update_path_details: "Weg geändert",
		update_path_geometry: "Wegverlauf geändert",
		create_label: "Label erstellt",
		update_label: "Label geändert",
		move_label: "Label verschoben",
		create_region: "Region erstellt",
		update_region: "Region geändert",
		update_region_geometry: "Regionsgrenze geändert",
		delete_feature: "Objekt gelöscht",
		update_geometry: "Herrschaftsgebiet-Geometrie geändert",
		split_geometry: "Herrschaftsgebiet zerschnitten",
		delete_geometry: "Herrschaftsgebiet-Geometrie gelöscht",
		delete_geometry_part: "Polygon aus Herrschaftsgebiet entfernt",
		geometry_operation_union: "Herrschaftsgebiete vereinigt",
		geometry_operation_difference: "Herrschaftsgebiet ausgeschnitten",
		geometry_operation_intersection: "Schnittmenge als Herrschaftsgebiet erstellt",
	};

	return labels[action] || action;
}

function renderChangeLog() {
	const listElement = document.getElementById("change-log-list");
	if (!listElement) {
		return;
	}

	listElement.innerHTML = "";
	if (changeLogEntries.length < 1) {
		setChangePanelStatus("Noch keine Änderungen.", "empty");
		return;
	}

	setChangePanelStatus(`${changeLogEntries.length} letzte Änderungen.`, "success");
	changeLogEntries.forEach((entry) => {
		const itemElement = document.createElement("article");
		itemElement.className = "change-log-entry";
		itemElement.tabIndex = 0;
		itemElement.setAttribute("role", "button");
		itemElement.dataset.changeId = String(entry.id || "");
		itemElement.dataset.publicId = entry.public_id || "";
		itemElement.dataset.featureType = entry.feature_type || "";
		itemElement.dataset.action = entry.action || "";
		itemElement.classList.toggle("is-undone", Boolean(entry.undone));
		itemElement.innerHTML = `
			<span class="change-log-entry__action"></span>
			<span class="change-log-entry__target"></span>
			<span class="change-log-entry__meta"></span>
			<span class="change-log-entry__state"></span>
			<span class="change-log-entry__actions"></span>
		`;
		itemElement.querySelector(".change-log-entry__action").textContent = formatChangeAction(entry.action);
		itemElement.querySelector(".change-log-entry__target").textContent = entry.name || entry.feature_subtype || entry.public_id || "Unbenannt";
		itemElement.querySelector(".change-log-entry__meta").textContent = `${entry.username || "unbekannt"} · ${entry.created_at || ""}`;
		const stateElement = itemElement.querySelector(".change-log-entry__state");
		if (entry.undone) {
			stateElement.textContent = `Rückgängig gemacht${entry.undone_username ? ` von ${entry.undone_username}` : ""}`;
		} else {
			stateElement.hidden = true;
		}
		const actionsElement = itemElement.querySelector(".change-log-entry__actions");
		if (entry.can_undo) {
			const undoButtonElement = document.createElement("button");
			undoButtonElement.type = "button";
			undoButtonElement.className = "change-log-entry__undo";
			undoButtonElement.textContent = "Rückgängig";
			actionsElement.appendChild(undoButtonElement);
		} else {
			actionsElement.hidden = true;
		}
		listElement.appendChild(itemElement);
	});
}

function findLabelMarkerByPublicId(publicId) {
	return labelMarkers.find((entry) => entry.label.publicId === publicId) || null;
}

function focusPathFeature(path) {
	if (!path?._pathLines?.length) {
		return false;
	}

	const latLngs = pathCoordinatesToLatLngs(path);
	if (latLngs.length < 1) {
		return false;
	}

	map.fitBounds(L.latLngBounds(latLngs), { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 4) });
	// Weg-Popups sind nicht mehr per bindPopup gebunden (Klick-Schiedsrichter, siehe path-rendering.js) ->
	// hier manuell in der Weg-Mitte oeffnen. refreshPathLayerPopup hat _popupMarkup bereits gesetzt.
	if (path._popupMarkup) {
		L.popup(path._popupOptions || {})
			.setLatLng(latLngs[Math.floor(latLngs.length / 2)])
			.setContent(path._popupMarkup)
			.openOn(map);
	}
	return true;
}

function focusLabelFeature(labelEntry) {
	if (!labelEntry) {
		return false;
	}

	const latlng = labelEntry.marker.getLatLng();
	if (!map.hasLayer(labelEntry.marker)) {
		map.setZoom(Math.max(map.getZoom(), labelEntry.label.minZoom || 0));
		syncLabelVisibility();
	}
	map.panTo(latlng);
	openLabelEditDialog({ labelEntry });
	return true;
}

function clearChangeLogFocusMarker() {
	if (changeLogFocusMarkerTimeout) {
		window.clearTimeout(changeLogFocusMarkerTimeout);
		changeLogFocusMarkerTimeout = null;
	}
	if (!changeLogFocusMarker) {
		return false;
	}

	map.removeLayer(changeLogFocusMarker);
	changeLogFocusMarker = null;
	return true;
}

function scheduleChangeLogFocusMarkerRemoval() {
	if (changeLogFocusMarkerTimeout) {
		window.clearTimeout(changeLogFocusMarkerTimeout);
	}

	changeLogFocusMarkerTimeout = window.setTimeout(() => {
		clearChangeLogFocusMarker();
	}, CHANGE_LOG_FOCUS_MARKER_TTL_MS);
}

function getChangeLogFocusTooltip(entry) {
	return `${formatChangeAction(entry.action)} · ${entry.name || entry.feature_subtype || entry.public_id || "Änderung"}`;
}

function focusAuditChangeTarget(entry) {
	const focus = entry?.focus || null;
	if (!focus) {
		return false;
	}

	const latlng = L.latLng(Number(focus.lat), Number(focus.lng));
	if (!isWithinMapBounds(latlng)) {
		return false;
	}

	clearChangeLogFocusMarker();
	if (focus.type === "bounds" && Array.isArray(focus.bounds) && focus.bounds.length === 2) {
		const bounds = L.latLngBounds(focus.bounds.map((coordinate) => L.latLng(Number(coordinate[0]), Number(coordinate[1]))));
		changeLogFocusMarker = L.rectangle(bounds, {
			pane: "measurementPane",
			color: "#31536f",
			weight: 3,
			fillColor: "#ffffff",
			fillOpacity: 0.08,
			interactive: false,
		}).addTo(map);
		changeLogFocusMarker.bindTooltip(getChangeLogFocusTooltip(entry), {
			permanent: true,
			direction: "center",
			className: "change-log-focus-tooltip",
		}).openTooltip();
		scheduleChangeLogFocusMarkerRemoval();
		map.fitBounds(bounds, { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 4) });
		return true;
	}

	changeLogFocusMarker = L.circleMarker(latlng, {
		pane: "measurementHandlesPane",
		radius: 9,
		color: "#31536f",
		weight: 3,
		fillColor: "#ffffff",
		fillOpacity: 0.95,
	}).addTo(map);
	changeLogFocusMarker.bindTooltip(getChangeLogFocusTooltip(entry), {
		permanent: true,
		direction: "top",
		className: "change-log-focus-tooltip",
		offset: [0, -10],
	}).openTooltip();
	changeLogFocusMarker.on("click", clearChangeLogFocusMarker);
	scheduleChangeLogFocusMarkerRemoval();
	map.flyTo(latlng, Math.max(map.getZoom(), 3), { duration: 0.8 });
	return true;
}

function focusChangeLogEntry(entry) {
	if (focusAuditChangeTarget(entry)) {
		return;
	}

	if (!entry?.public_id) {
		showFeedbackToast("Dieses Objekt kann nicht lokalisiert werden.", "warning");
		return;
	}

	const locationEntry = findLocationMarkerByPublicId(entry.public_id);
	if (locationEntry) {
		map.panTo(locationEntry.marker.getLatLng());
		locationEntry.marker.openPopup();
		return;
	}

	const path = findPathByPublicId(entry.public_id);
	if (path && focusPathFeature(path)) {
		return;
	}

	const labelEntry = findLabelMarkerByPublicId(entry.public_id);
	if (labelEntry && focusLabelFeature(labelEntry)) {
		return;
	}

	showFeedbackToast("Objekt ist nicht mehr aktiv oder wurde noch nicht neu geladen.", "warning");
}

function getLatestUndoableChangeLogEntry() {
	return changeLogEntries.find((entry) => entry?.can_undo) || null;
}

async function undoLastChangeLogEntry() {
	let entry = getLatestUndoableChangeLogEntry();
	if (!entry) {
		await loadChangeLog();
		entry = getLatestUndoableChangeLogEntry();
	}
	if (!entry) {
		showFeedbackToast("Keine Änderung zum Rückgängigmachen.", "info");
		return;
	}

	await undoChangeLogEntry(entry);
}

async function undoChangeLogEntry(entry) {
	if (isChangeUndoPending) {
		return;
	}
	if (!entry?.can_undo) {
		showFeedbackToast("Diese Änderung kann nicht rückgängig gemacht werden.", "warning");
		return;
	}

	isChangeUndoPending = true;
	setChangePanelStatus("Änderung wird rückgängig gemacht...", "pending");
	try {
		const auditSource = String(entry.audit_source || "map_feature");
		if (auditSource === "political_territory") {
			await undoPoliticalAuditChange(Number(entry.id));
			schedulePoliticalTerritoryLayerReload({ immediate: true });
		} else {
			const result = await undoMapAuditChange(Number(entry.id));
			applyMapFeatureEditResult(result);
			updateRevisionFromEditResponse(result);
		}
		await loadChangeLog();
		void loadReviewReports();
		void loadWikiSyncCases();
		showFeedbackToast(`${formatChangeAction(entry.action)} rückgängig gemacht.`, "success");
	} catch (error) {
		console.error("Änderung konnte nicht rückgängig gemacht werden:", error);
		showFeedbackToast(error.message || "Änderung konnte nicht rückgängig gemacht werden.", "warning");
		await loadChangeLog();
	} finally {
		isChangeUndoPending = false;
	}
}

function isTextEditingShortcutTarget(target) {
	const element = target instanceof Element ? target : null;
	if (!element) {
		return false;
	}

	return Boolean(element.isContentEditable || element.closest('input, textarea, select, [contenteditable="true"], [contenteditable=""]'));
}

function handleChangeLogUndoShortcut(event) {
	const key = String(event.key || "").toLowerCase();
	if (!IS_EDIT_MODE || key !== "z" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) {
		return false;
	}
	if (isTextEditingShortcutTarget(event.target)) {
		return false;
	}

	event.preventDefault();
	event.stopPropagation();
	void undoLastChangeLogEntry();
	return true;
}

function formatPresenceAge(secondsSinceSeen) {
	if (secondsSinceSeen === null || secondsSinceSeen === undefined || secondsSinceSeen === "") {
		return "noch nie online";
	}

	const seconds = Number(secondsSinceSeen);
	if (!Number.isFinite(seconds) || seconds < 0) {
		return "";
	}

	if (seconds < 30) {
		return "gerade eben";
	}

	if (seconds < 90) {
		return "vor 1 Min.";
	}

	if (seconds < 3600) {
		return `vor ${Math.max(2, Math.round(seconds / 60))} Min.`;
	}

	if (seconds < 86400) {
		return `vor ${Math.max(1, Math.round(seconds / 3600))} Std.`;
	}

	return `vor ${Math.max(1, Math.round(seconds / 86400))} Tagen`;
}

function formatPresenceRole(role) {
	const normalizedRole = String(role || "").trim().toLowerCase();
	return {
		admin: "Admin",
		editor: "Editor",
		reviewer: "Reviewer",
	}[normalizedRole] || normalizedRole || "Editor";
}

function setEditorPanelTab(tabName) {
	activeEditorPanelTab = ["review", "changes", "presence", "wiki-sync"].includes(tabName) ? tabName : "review";
	document.querySelectorAll(".review-panel__tab").forEach((tabElement) => {
		tabElement.classList.toggle("is-active", tabElement.dataset.editorPanelTab === activeEditorPanelTab);
	});
	document.querySelectorAll(".review-panel__section").forEach((sectionElement) => {
		sectionElement.classList.toggle("is-active", sectionElement.dataset.editorPanelSection === activeEditorPanelTab);
	});

	if (activeEditorPanelTab === "changes") {
		void loadChangeLog();
	} else if (activeEditorPanelTab === "presence") {
		void sendEditorPresenceHeartbeat();
	} else if (activeEditorPanelTab === "wiki-sync") {
		refreshActiveWikiSyncPanel();
	}
}

function refreshActiveEditorPanel() {
	if (activeEditorPanelTab === "changes") {
		return loadChangeLog();
	}

	if (activeEditorPanelTab === "presence") {
		return sendEditorPresenceHeartbeat();
	}

	if (activeEditorPanelTab === "wiki-sync") {
		return refreshActiveWikiSyncPanel();
	}

	return loadReviewReports();
}

function restoreReviewPanelState() {
	try {
		isReviewPanelHidden = window.localStorage?.getItem(EDIT_MODE_REVIEW_PANEL_STORAGE_KEY) === "1";
	} catch (error) {
		isReviewPanelHidden = false;
	}

	syncReviewPanelVisibility();
}

function syncReviewPanelVisibility() {
	$("#review-panel").toggleClass("is-hidden", isReviewPanelHidden);
	$("#review-panel-toggle").toggleClass("is-hidden", isReviewPanelHidden);
	$("#review-panel-toggle").text("Editor");
}

function toggleReviewPanel() {
	isReviewPanelHidden = !isReviewPanelHidden;
	try {
		window.localStorage?.setItem(EDIT_MODE_REVIEW_PANEL_STORAGE_KEY, isReviewPanelHidden ? "1" : "0");
	} catch (error) {
		console.warn("Review-Panel-Zustand konnte nicht gespeichert werden:", error);
	}

	syncReviewPanelVisibility();
}

async function loadReviewReports() {
	if (!IS_EDIT_MODE) {
		return;
	}

	setReviewPanelStatus("Meldungen werden geladen...", "pending");
	try {
		const response = await fetch(LOCATION_REPORT_REVIEW_API_URL, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(data?.error || `Review-API antwortet mit HTTP ${response.status}.`);
		}

		reviewReports = Array.isArray(data.reports) ? data.reports : [];
		renderReviewReports();
	} catch (error) {
		console.error("Meldungen konnten nicht geladen werden:", error);
		setReviewPanelStatus(error.message || "Meldungen konnten nicht geladen werden.", "error");
	}
}

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
			throw new Error(data?.error || `Änderungs-API antwortet mit HTTP ${response.status}.`);
		}

		let politicalChanges = [];
		try {
			const politicalChangeLog = await fetchPoliticalChangeLog();
			politicalChanges = Array.isArray(politicalChangeLog?.changes) ? politicalChangeLog.changes : [];
		} catch (error) {
			console.warn("Politischer Aenderungsverlauf konnte nicht geladen werden:", error);
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
	path._pathLines[1]?.openPopup(latLngs[Math.floor(latLngs.length / 2)]);
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

function attachActiveReviewReportContext(payload) {
	if (activeReviewReportId) {
		payload.review_report_id = activeReviewReportId;
		payload.review_report_source = activeReviewReportSource || "location_reports";
	}

	return payload;
}

function renderReviewReports() {
	const listElement = document.getElementById("review-report-list");
	if (!listElement) {
		return;
	}

	listElement.innerHTML = "";
	if (reviewReports.length < 1) {
		setReviewPanelStatus("Keine offenen Meldungen.", "empty");
		return;
	}

	setReviewPanelStatus(`${reviewReports.length} offene Meldungen.`, "success");
	reviewReports.forEach((report) => {
		const itemElement = document.createElement("article");
		itemElement.className = "review-report";
		itemElement.dataset.reportId = String(report.id);
		itemElement.dataset.reportSource = report.report_source || "location_reports";
		itemElement.innerHTML = `
			<button type="button" class="review-report__focus">
				<span class="review-report__name"></span>
				<span class="review-report__meta"></span>
				<span class="review-report__source"></span>
			</button>
			<div class="review-report__actions">
				<button type="button" class="review-report__create">Anlegen</button>
				<button type="button" class="review-report__reject">Verwerfen</button>
			</div>
		`;
		itemElement.querySelector(".review-report__name").textContent = report.name || "Unbenannter Eintrag";
		itemElement.querySelector(".review-report__meta").textContent = `${getReportTypeLabel(report)} · ${formatLocationReportCoordinates(L.latLng(Number(report.lat), Number(report.lng)))}`;
		itemElement.querySelector(".review-report__source").textContent = report.source || "Keine Quelle";
		if (isCommentReport(report)) {
			itemElement.querySelector(".review-report__create").textContent = "Erledigt";
		}
		listElement.appendChild(itemElement);
	});
}

async function sendEditorPresenceHeartbeat() {
	if (!IS_EDIT_MODE) {
		return;
	}

	try {
		const response = await fetch(EDITOR_PRESENCE_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ path: window.location.pathname }),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data?.ok !== true) {
			throw new Error(data?.error || "Online-Status konnte nicht geladen werden.");
		}

		editorPresenceUsers = Array.isArray(data.users) ? data.users : [];
		renderEditorPresenceUsers();
	} catch (error) {
		console.warn("Online-Status konnte nicht aktualisiert werden:", error);
		setPresencePanelStatus(error.message || "Nutzerstatus konnte nicht geladen werden.", "error");
	}
}

function startEditorPresenceHeartbeat() {
	if (!IS_EDIT_MODE || editorPresenceTimerId) {
		return;
	}

	editorPresenceTimerId = window.setInterval(() => {
		void sendEditorPresenceHeartbeat();
	}, 30000);
}

function renderEditorPresenceUsers() {
	const listElement = document.getElementById("presence-user-list");
	if (!listElement) {
		return;
	}

	listElement.innerHTML = "";
	if (editorPresenceUsers.length < 1) {
		setPresencePanelStatus("Keine review-berechtigten Nutzer gefunden.", "empty");
		return;
	}

	const onlineUsers = editorPresenceUsers.filter((user) => Boolean(user.is_online));
	const offlineUsers = editorPresenceUsers.filter((user) => !user.is_online);
	setPresencePanelStatus(
		offlineUsers.length > 0
			? `${onlineUsers.length} online, ${offlineUsers.length} offline.`
			: `${onlineUsers.length} Nutzer online.`,
		onlineUsers.length > 0 ? "success" : "empty"
	);

	renderPresenceUserGroup(listElement, "Online", onlineUsers, "online");
	renderPresenceUserGroup(listElement, "Offline", offlineUsers, "offline");
}

function renderPresenceUserGroup(listElement, title, users, state) {
	if (!listElement || !Array.isArray(users) || users.length < 1) {
		return;
	}

	const groupElement = document.createElement("section");
	groupElement.className = "presence-user-group";
	groupElement.innerHTML = `
		<h3 class="presence-user-group__title"></h3>
		<div class="presence-user-group__list"></div>
	`;
	groupElement.querySelector(".presence-user-group__title").textContent = `${title} (${users.length})`;

	const groupListElement = groupElement.querySelector(".presence-user-group__list");
	users.forEach((user) => {
		const itemElement = document.createElement("article");
		itemElement.className = `presence-user presence-user--${state}`;
		itemElement.innerHTML = `
			<span class="presence-user__dot" aria-hidden="true"></span>
			<span class="presence-user__body">
				<span class="presence-user__name"></span>
				<span class="presence-user__meta"></span>
			</span>
		`;
		itemElement.querySelector(".presence-user__name").textContent = user.username || "Editor";
		const presenceAge = formatPresenceAge(user.seconds_since_seen);
		const roleLabel = formatPresenceRole(user.role);
		const stateLabel = user.is_online ? "online" : "offline";
		itemElement.querySelector(".presence-user__meta").textContent = [roleLabel, stateLabel, presenceAge].filter(Boolean).join(" · ");
		groupListElement.appendChild(itemElement);
	});

	listElement.appendChild(groupElement);
}

function getReportTypeLabel(report) {
	const reportType = report.report_type || "location";
	const reportSubtype = report.report_subtype || report.size || "dorf";
	if (reportType === "location") {
		return LOCATION_TYPE_CONFIG[normalizeLocationType(reportSubtype)]?.singularLabel || "Ort";
	}

	return {
		label: "Label",
		fluss: "Fluss",
		meer: "Meer",
		see: "See",
		region: "Region",
		insel: "Insel",
		gebirge: "Gebirge",
		berggipfel: "Berggipfel",
		wald: "Wald",
		steppe: "Steppe",
		huegelland: "Hügelland",
		tundra: "Tundra",
		kueste: "Küste",
		ebene: "Ebene",
		graslandschaft: "Graslandschaft",
		auenlandschaft: "Auenlandschaft",
		wueste: "Wüste",
		suempfe_moore: "Sümpfe/Moore",
		comment: "Kommentar",
		sonstiges: "Sonstiges",
	}[reportSubtype] || reportSubtype || "Karteneintrag";
}

function isLocationReport(report) {
	return (report.report_type || "location") === "location";
}

function isCommentReport(report) {
	return (report.report_type || "") === "comment" || (report.report_subtype || "") === "comment";
}

function findReviewReportFromElement(element) {
	const reportElement = element?.closest?.(".review-report");
	const reportId = Number(reportElement?.dataset.reportId);
	const reportSource = reportElement?.dataset.reportSource || "location_reports";
	return reviewReports.find((entry) => Number(entry.id) === reportId && (entry.report_source || "location_reports") === reportSource) || null;
}

function clearReviewReportMarker() {
	if (!reviewReportMarker) {
		return;
	}

	map.removeLayer(reviewReportMarker);
	reviewReportMarker = null;
}

function focusReviewReport(report) {
	const latlng = L.latLng(Number(report.lat), Number(report.lng));
	if (!isWithinMapBounds(latlng)) {
		showFeedbackToast("Die gemeldete Position liegt ausserhalb der Karte.", "warning");
		return;
	}

	clearReviewReportMarker();
	reviewReportMarker = L.circleMarker(latlng, {
		pane: "measurementHandlesPane",
		radius: 9,
		color: "#1452F7",
		weight: 3,
		fillColor: "#ffffff",
		fillOpacity: 0.95,
	}).addTo(map);
	reviewReportMarker.bindTooltip(report.name || "Meldung", {
		permanent: true,
		direction: "top",
		className: "review-report-tooltip",
		offset: [0, -10],
	}).openTooltip();

	map.flyTo(latlng, Math.max(map.getZoom(), 3), { duration: 0.8 });
}

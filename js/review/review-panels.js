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
	let storedValue = null;
	try {
		storedValue = window.localStorage?.getItem(EDIT_MODE_REVIEW_PANEL_STORAGE_KEY) ?? null;
	} catch (error) {
		storedValue = null;
	}

	if (storedValue === "1" || storedValue === "0") {
		isReviewPanelHidden = storedValue === "1";
	} else {
		// Kein gespeicherter Zustand: auf dem Smartphone standardmaessig eingeklappt (mehr Karte).
		isReviewPanelHidden = typeof avesmapsIsPhoneViewport === "function" && avesmapsIsPhoneViewport();
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

	// Die Bewertungsliste im selben Reiter parallel laden.
	void loadReviewRatings();

	setReviewPanelStatus("Meldungen werden geladen...", "pending");
	try {
		const response = await fetch(LOCATION_REPORT_REVIEW_API_URL, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(apiErrorMessage(data, `Review-API antwortet mit HTTP ${response.status}.`));
		}

		reviewReports = Array.isArray(data.reports) ? data.reports : [];
		renderReviewReports();
		// Live updates: remember the newest report id and make sure the background poll runs, so a
		// freshly submitted community report toasts + appears without a manual F5.
		reviewReportsKnownMaxId = reviewReportsMaxId();
		ensureReviewReportsPolling();
	} catch (error) {
		console.error("Meldungen konnten nicht geladen werden:", error);
		setReviewPanelStatus(error.message || "Meldungen konnten nicht geladen werden.", "error");
	}
}

// ---- Live-Poll fuer neue Community-Meldungen (kein F5 mehr) ----
// STRATO-schonend: eine kleine Query alle 45s (map_reports/location_reports sind klein), nur im
// Edit-Modus, nie schneller geloopt. Der Poll toastet NUR echt neue Meldungen (id > zuletzt bekannter)
// und rendert die Liste neu; der allererste Seed (bekannt = 0) toastet nicht.
let reviewReportsPollTimer = null;
let reviewReportsKnownMaxId = 0;
const REVIEW_REPORTS_POLL_INTERVAL_MS = 45000;

function reviewReportsMaxId() {
	return (Array.isArray(reviewReports) ? reviewReports : []).reduce((max, report) => Math.max(max, Number(report.id) || 0), 0);
}

function ensureReviewReportsPolling() {
	if (reviewReportsPollTimer || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	reviewReportsPollTimer = window.setInterval(pollReviewReportsForNew, REVIEW_REPORTS_POLL_INTERVAL_MS);
}

async function pollReviewReportsForNew() {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	try {
		const response = await fetch(LOCATION_REPORT_REVIEW_API_URL, { credentials: "same-origin", headers: { Accept: "application/json" } });
		const data = await response.json().catch(() => null);
		if (!response.ok || !data || data.ok !== true || !Array.isArray(data.reports)) {
			return;
		}
		const previousMaxId = reviewReportsKnownMaxId;
		const freshCount = data.reports.filter((report) => (Number(report.id) || 0) > previousMaxId).length;
		reviewReports = data.reports;
		reviewReportsKnownMaxId = reviewReportsMaxId();
		if (freshCount > 0) {
			renderReviewReports();
			if (previousMaxId > 0 && typeof showFeedbackToast === "function") {
				showFeedbackToast(
					freshCount === 1 ? "Neue Community-Meldung eingegangen." : `${freshCount} neue Community-Meldungen eingegangen.`,
					"info"
				);
			}
		}
	} catch (error) {
		// Polling darf den Editor nie stoeren -- Fehler still schlucken.
	}
}

// (Change-log / audit feed moved to review-panels-change-log.js - M5 split.)

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
		const reportSources = Array.isArray(report.sources) ? report.sources : [];
		const sourceSummary = reportSources.length
			? reportSources.map((source) => source.label + (source.pages ? ` (S. ${source.pages})` : "")).filter(Boolean).join("; ")
			: (report.source || "Keine Quelle");
		const reportSourceParts = [sourceSummary];
		if (report.reporter_name) {
			reportSourceParts.push(`gemeldet von ${report.reporter_name}`);
		}
		if (report.wiki_url) {
			reportSourceParts.push("Wiki-Link");
		}
		itemElement.querySelector(".review-report__source").textContent = reportSourceParts.join(" · ");
		if (isCommentReport(report)) {
			itemElement.querySelector(".review-report__create").textContent = "Erledigt";
		}
		// Change-mode reports: show what element the change suggestion refers to.
		if (report.report_mode === "change" && report.entity_type) {
			const ref = report.entity_public_id
				? `${report.entity_type} · ${report.entity_public_id}`
				: report.entity_type;
			const changeRefElement = document.createElement("div");
			changeRefElement.className = "review-report__change-ref";
			// Build purely via DOM to avoid any innerHTML XSS risk.
			changeRefElement.appendChild(document.createTextNode(`${tr("review.changeRef", "Änderung an")}: `));
			const nameSpan = document.createElement("span");
			nameSpan.className = "review-report__change-ref-name";
			nameSpan.textContent = report.name || "";
			changeRefElement.appendChild(nameSpan);
			changeRefElement.appendChild(document.createTextNode(" "));
			const metaSpan = document.createElement("span");
			metaSpan.className = "review-report__change-ref-meta";
			metaSpan.textContent = `(${ref})`;
			changeRefElement.appendChild(metaSpan);
			itemElement.querySelector(".review-report__focus").after(changeRefElement);
		}
		listElement.appendChild(itemElement);
	});
}

// ---- Bewertungen (Moderationsliste im Meldungen-Reiter) ----

function setReviewRatingsStatus(message = "", state = "") {
	setPanelStateStatus(document.getElementById("review-ratings-status"), message, state);
}

async function loadReviewRatings() {
	if (!IS_EDIT_MODE) {
		return;
	}
	setReviewRatingsStatus("Bewertungen werden geladen...", "pending");
	try {
		const response = await fetch(LOCATION_REVIEWS_EDIT_ENDPOINT, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(apiErrorMessage(data, `Bewertungs-API antwortet mit HTTP ${response.status}.`));
		}
		reviewRatings = Array.isArray(data.reviews) ? data.reviews : [];
		renderReviewRatings();
	} catch (error) {
		console.error("Bewertungen konnten nicht geladen werden:", error);
		setReviewRatingsStatus(error.message || "Bewertungen konnten nicht geladen werden.", "error");
	}
}

function renderReviewRatings() {
	const listElement = document.getElementById("review-ratings-list");
	if (!listElement) {
		return;
	}
	listElement.innerHTML = "";
	if (reviewRatings.length < 1) {
		setReviewRatingsStatus("Noch keine Bewertungen.", "empty");
		return;
	}
	setReviewRatingsStatus(`${reviewRatings.length} Bewertungen.`, "success");

	const starsFor = (stars) => (typeof reviewStarsMarkup === "function" ? reviewStarsMarkup(stars) : `${Number(stars) || 0}★`);
	reviewRatings.forEach((rating) => {
		const itemElement = document.createElement("article");
		itemElement.className = "review-report review-rating" + (rating.is_hidden ? " review-rating--hidden" : "");
		itemElement.dataset.reviewId = String(rating.id);
		itemElement.dataset.locationPublicId = rating.location_public_id || "";
		const flags = (rating.is_spam ? ' <span class="review-rating__flag">Spam</span>' : "")
			+ (rating.is_hidden ? ' <span class="review-rating__flag">verborgen</span>' : "");
		itemElement.innerHTML = `
			<button type="button" class="review-rating__focus">
				<span class="review-report__name"></span>
				<span class="review-report__meta">${starsFor(rating.stars)}<span class="review-rating__author"></span>${flags}</span>
				<span class="review-report__source review-rating__body"></span>
			</button>
			<div class="review-report__actions">
				<button type="button" class="review-rating__hide" data-rating-action="${rating.is_hidden ? "unhide" : "hide"}">${rating.is_hidden ? "Einblenden" : "Verbergen"}</button>
				<button type="button" class="review-rating__delete">Löschen</button>
			</div>
		`;
		itemElement.querySelector(".review-report__name").textContent = rating.location_name || rating.location_public_id || "Unbekannter Ort";
		itemElement.querySelector(".review-rating__author").textContent = ` ${rating.author || "Anonym"}${rating.dsa_date ? ` (${rating.dsa_date})` : ""}`;
		itemElement.querySelector(".review-rating__body").textContent = rating.body ? `„${rating.body}"` : "";
		listElement.appendChild(itemElement);
	});
}

function focusReviewRatingLocation(publicId) {
	if (!publicId) {
		return;
	}
	const entry = typeof findLocationMarkerByPublicId === "function" ? findLocationMarkerByPublicId(publicId) : null;
	if (!entry) {
		showFeedbackToast("Der Ort ist auf der Karte nicht (mehr) vorhanden.", "warning");
		return;
	}
	// Heranzoomen (hartes setView statt flyTo): der direkt folgende panTo aus openLocationPopupByPublicId
	// bricht eine flyTo-Animation ab (map._stop -> cancelAnimFrame), sodass Zoomstufe 5 nie erreicht wird.
	// Die normale Infobox oeffnen (temporaerer Marker, falls die Groesse nicht eingeblendet ist). Nie
	// herauszoomen: mindestens Stufe 5.
	map.setView(entry.marker.getLatLng(), Math.max(map.getZoom(), 5));
	if (typeof openLocationPopupByPublicId === "function") {
		openLocationPopupByPublicId(publicId);
	}
}

function moderateReviewRating(id, action, publicId = "") {
	const reviewId = Number(id);
	if (!Number.isFinite(reviewId) || reviewId <= 0) {
		return;
	}
	fetch(LOCATION_REVIEWS_EDIT_ENDPOINT, {
		method: "POST",
		credentials: "same-origin",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ action, id: reviewId }),
	})
		.then((response) => response.json().catch(() => null))
		.then((data) => {
			if (!data || data.ok === false) {
				showFeedbackToast(apiErrorMessage(data, "Aktion fehlgeschlagen."), "warning");
				return;
			}
			void loadReviewRatings();
			// Eine ggf. offene Infobox dieses Ortes mit-aktualisieren.
			if (publicId && typeof refreshOpenReviewSlots === "function") {
				refreshOpenReviewSlots(publicId);
			}
		})
		.catch(() => showFeedbackToast("Aktion fehlgeschlagen.", "warning"));
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
			throw new Error(apiErrorMessage(data, "Online-Status konnte nicht geladen werden."));
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

// Community reports arrive from other users while the editor stays open; without this the review
// list only refreshed on F5, the manual refresh button, or after an action. Poll periodically, but
// skip while the user is mid-review (a report's edit dialog is open -> activeReviewReportId set) so
// the list never re-renders under them; the next tick refreshes once that dialog is closed.
function startReviewReportsPolling() {
	if (!IS_EDIT_MODE || reviewReportsPollTimerId) {
		return;
	}

	reviewReportsPollTimerId = window.setInterval(() => {
		if (activeReviewReportId) {
			return;
		}
		// Nicht neu laden, waehrend der Nutzer die Liste gerade benutzt (Mauszeiger ueber der Meldungs-
		// oder Bewertungsliste) -- der Re-Render macht innerHTML="" und reisst die Scrollposition auf 0
		// (die Liste ist selbst der Scroll-Container). Der naechste Tick aktualisiert, sobald der Zeiger
		// die Liste verlaesst.
		const overList = ["review-report-list", "review-ratings-list"].some((id) => {
			const el = document.getElementById(id);
			return el && typeof el.matches === "function" && el.matches(":hover");
		});
		if (overList) {
			return;
		}
		void loadReviewReports();
	}, 45000);
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
		weg: "Weg/Straße",
		territorium: "Herrschaftsgebiet",
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

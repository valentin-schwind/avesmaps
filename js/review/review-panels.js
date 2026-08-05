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
		// "Besucher" is the default sub-tab, and its dashboard loads lazily on click. Without
		// this the panel would open on an empty dashboard until you clicked away and back.
		if (typeof ensureStatusSubtabLoaded === "function") {
			ensureStatusSubtabLoaded();
		}
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

// Reine DOM-Anzeige fuer den aktuellen isReviewPanelHidden-Stand. Die Entscheidung, WER gerade der
// aktive Rand-Tab ist (Info oder Editor), faellt zentral im avesmapsEdgePanels-Koordinator (js/config.js) --
// hier wird nur noch das Ergebnis angezeigt.
function syncReviewPanelVisibility() {
	$("#review-panel").toggleClass("is-hidden", isReviewPanelHidden);
	$("#review-panel-toggle").toggleClass("is-hidden", isReviewPanelHidden);
	$("#review-panel-toggle").text("Editor");
}

if (window.avesmapsEdgePanels) {
	window.avesmapsEdgePanels.registerElement("editor", document.getElementById("review-panel"));
	// Feuert auch, wenn der ANDERE Tab (Info) uebernimmt -- dann hier einklappen, OHNE toggleReviewPanel
	// aufzurufen (das wuerde den gespeicherten Nutzer-Wunsch aendern; ein blosser Feature-Klick soll das
	// naechste Laden nicht beeinflussen).
	window.avesmapsEdgePanels.onChange(function (active) {
		isReviewPanelHidden = active !== "editor";
		syncReviewPanelVisibility();
	});
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

	if (!isReviewPanelHidden) {
		window.avesmapsEdgePanels?.activate("editor");
	}
	syncReviewPanelVisibility();
}

function toggleReviewPanel() {
	isReviewPanelHidden = !isReviewPanelHidden;
	try {
		window.localStorage?.setItem(EDIT_MODE_REVIEW_PANEL_STORAGE_KEY, isReviewPanelHidden ? "1" : "0");
	} catch (error) {
		console.warn("Review-Panel-Zustand konnte nicht gespeichert werden:", error);
	}

	if (isReviewPanelHidden) {
		window.avesmapsEdgePanels?.deactivate("editor");
	} else {
		window.avesmapsEdgePanels?.activate("editor");
	}
	syncReviewPanelVisibility();
}

// ---- A3: welche Meldungen die Liste zeigt ----
// Bis 2026-08-05 zeigte sie ausschliesslich `status='neu'`, und es gab nirgends eine zweite Liste:
// eine bearbeitete Meldung war weg. Wer sie angenommen oder verworfen hat, war nicht mehr
// feststellbar -- waehrend des Systemtests sind der Redaktion zwei eigene Meldungen unter der Hand
// verschwunden. ⚠️ „Offen" bleibt die Vorgabe; der Trichter zaehlt sie als aktiven Filter, damit im
// Knopf steht, dass ueberhaupt gefiltert wird.
const reviewReportStatusFilter = { value: "neu" };
const REVIEW_REPORT_STATUS_OPTIONS = [
	{ value: "neu", label: "Offen" },
	{ value: "erledigt", label: "Erledigt" },
];
let reviewReportsTruncated = false;
let reviewReportsDoneLimit = 0;

// Leerer Wert = die eingebaute Option „Alle" des Trichters.
function reviewReportListUrl() {
	return `${LOCATION_REPORT_REVIEW_API_URL}?status=${encodeURIComponent(reviewReportStatusFilter.value || "alle")}`;
}

function isReviewReportOpenFilter() {
	return reviewReportStatusFilter.value === "neu";
}

async function loadReviewReports() {
	if (!IS_EDIT_MODE) {
		return;
	}

	// Die Bewertungsliste im selben Reiter parallel laden.
	void loadReviewRatings();

	setReviewPanelStatus("Meldungen werden geladen...", "pending");
	try {
		const response = await fetch(reviewReportListUrl(), {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json().catch(() => null);
		if (!response.ok || !data?.ok) {
			throw new Error(apiErrorMessage(data, `Review-API antwortet mit HTTP ${response.status}.`));
		}

		reviewReports = Array.isArray(data.reports) ? data.reports : [];
		reviewReportsTruncated = data.truncated === true;
		reviewReportsDoneLimit = Number(data.limit) || 0;
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
let reviewReportsKnownMaxId = 0;
const REVIEW_REPORTS_POLL_INTERVAL_MS = 45000;

function reviewReportsMaxId() {
	return (Array.isArray(reviewReports) ? reviewReports : []).reduce((max, report) => Math.max(max, Number(report.id) || 0), 0);
}

// Don't re-render the list under the user: not while a report's edit dialog is open, and not while
// the pointer rests on the reports/ratings list — the re-render does innerHTML="" and would reset the
// scroll position (the list is its own scroll container). The next tick renders once they are done.
function isReviewReportsListBusy() {
	if (activeReviewReportId) {
		return true;
	}
	return ["review-report-list", "review-ratings-list"].some((id) => {
		const element = document.getElementById(id);
		return element && typeof element.matches === "function" && element.matches(":hover");
	});
}

// ONE poll timer. There used to be two independent 45s intervals on the same endpoint
// (ensureReviewReportsPolling + startReviewReportsPolling), so the editor fetched the report list
// twice per cycle — and they disagreed: the "new reports" poller re-rendered without the busy guard
// above, tearing the list away from an editor mid-review whenever a report arrived. Now a single tick
// fetches once, always refreshes the data, and renders only when the user is not in the middle of it.
// Uses reviewReportsPollTimerId (runtime-state.js) because bootstrap.js clears exactly that id on unload.
function ensureReviewReportsPolling() {
	if (reviewReportsPollTimerId || typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	reviewReportsPollTimerId = window.setInterval(pollReviewReportsForNew, REVIEW_REPORTS_POLL_INTERVAL_MS);
}

async function pollReviewReportsForNew() {
	if (typeof IS_EDIT_MODE === "undefined" || !IS_EDIT_MODE) {
		return;
	}
	try {
		const response = await fetch(reviewReportListUrl(), { credentials: "same-origin", headers: { Accept: "application/json" } });
		const data = await response.json().catch(() => null);
		if (!response.ok || !data || data.ok !== true || !Array.isArray(data.reports)) {
			return;
		}
		// ⚠️ „Neu" laesst sich nur auf der offenen Liste erkennen. Steht der Filter auf „Erledigt" oder
		// „Alle", waere die hoechste id die einer laengst bearbeiteten Meldung, und der Vergleich
		// meldete Zugaenge, die keine sind. Dann wird nur nachgeladen, nicht getoastet -- und die
		// gemerkte Hoechst-id bleibt unangetastet, damit sie beim Zurueckschalten noch stimmt.
		const watchesOpenReports = isReviewReportOpenFilter();
		const previousMaxId = reviewReportsKnownMaxId;
		const freshCount = watchesOpenReports
			? data.reports.filter((report) => (Number(report.id) || 0) > previousMaxId).length
			: 0;
		reviewReports = data.reports;
		reviewReportsTruncated = data.truncated === true;
		reviewReportsDoneLimit = Number(data.limit) || 0;
		if (watchesOpenReports) {
			reviewReportsKnownMaxId = reviewReportsMaxId();
		}
		// Refresh the list on every tick (a report handled by another editor disappears too, not just
		// new ones), but never while the user is working in it.
		if (!isReviewReportsListBusy()) {
			renderReviewReports();
		}
		// The toast is non-intrusive, so it fires regardless of the busy state.
		if (freshCount > 0 && previousMaxId > 0 && typeof showFeedbackToast === "function") {
			showFeedbackToast(
				freshCount === 1 ? "Neue Community-Meldung eingegangen." : `${freshCount} neue Community-Meldungen eingegangen.`,
				"info"
			);
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
	const scopeWord = { neu: "offene", erledigt: "erledigte" }[reviewReportStatusFilter.value] || "";
	if (reviewReports.length < 1) {
		setReviewPanelStatus(`Keine ${scopeWord ? `${scopeWord} ` : ""}Meldungen.`, "empty");
		return;
	}

	// ⚠️ Der Deckel wird ausgesprochen. Eine still gekuerzte Liste liest sich wie „mehr gibt es nicht"
	// -- genau die Luege, die die fehlende Liste vorher erzaehlt hat.
	const cutNote = reviewReportsTruncated ? ` Nur die neuesten ${reviewReportsDoneLimit} werden gezeigt.` : "";
	setReviewPanelStatus(`${reviewReports.length} ${scopeWord ? `${scopeWord} ` : ""}Meldungen.${cutNote}`, "success");
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
		// Bei einer Kartenmeldung ist die Koordinate nur ein grober Anker (§3.8: verbindlich ist der Ort in
		// payload_json) -- sie hier zu zeigen laedt dazu ein, sie fuer eine Aussage zu halten. Der Ort, an
		// den die Karte kommt, ist die Information, auf die es bei der Freigabe ankommt.
		const citymapProposal = isCitymapReport(report) ? (report.citymap || null) : null;
		// Fundort-Meldung: die Koordinate ist hier noch bedeutungsloser als bei der Kartenmeldung -- ein
		// Fundort ist ein Link, er liegt nirgends. Was zaehlt, ist WIE VIELE Fundorte fuer WELCHE Karte,
		// und der Kartentitel steht schon als Meldungsname darueber.
		const fundortProposal = isCitymapLinkReport(report) ? (report.citymap_link || null) : null;
		const fundortCount = (fundortProposal?.links || []).length;
		itemElement.querySelector(".review-report__meta").textContent = fundortProposal
			? `${getReportTypeLabel(report)} · ${fundortCount === 1 ? "1 Fundort" : `${fundortCount} Fundorte`}`
			: citymapProposal
				? `${getReportTypeLabel(report)} · ${citymapProposal.place?.raw_name || "ohne Ort"}`
				: `${getReportTypeLabel(report)} · ${formatLocationReportCoordinates(L.latLng(Number(report.lat), Number(report.lng)))}`;
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
		// Surface the reporter's free-text comment for EVERY report type -- it otherwise only reached the
		// location editor's description; label/comment/change reports lost it in the list entirely.
		const reportComment = String(report.comment || "").trim();
		if (reportComment) {
			const commentEl = document.createElement("div");
			commentEl.className = "review-report__comment";
			commentEl.textContent = reportComment;
			itemElement.querySelector(".review-report__focus").after(commentEl);
		}
		// Eine bearbeitete Meldung wird GEZEIGT, nicht angeboten: die Knoepfe wuerden ins Leere greifen
		// (der Server nimmt nur `status = 'neu'` an) und an ihrer Stelle steht das, was A3 und A4
		// beantworten sollen -- wer hat wann was entschieden, und mit welcher Begruendung.
		if (isProcessedReviewReport(report)) {
			itemElement.classList.add("review-report--done");
			const actionsElement = itemElement.querySelector(".review-report__actions");
			actionsElement.textContent = "";
			const decisionElement = document.createElement("span");
			decisionElement.className = "review-report__decision";
			decisionElement.textContent = reviewReportDecisionSummary(report);
			actionsElement.append(decisionElement);
			const reviewNote = String(report.review_note || "").trim();
			if (reviewNote) {
				const noteElement = document.createElement("div");
				noteElement.className = "review-report__note";
				noteElement.textContent = reviewNote;
				actionsElement.before(noteElement);
			}
		} else if (isCommentReport(report)) {
			itemElement.querySelector(".review-report__create").textContent = "Erledigt";
		}
		// "Anlegen" waere gelogen: hier entsteht nichts, die Fundorte kommen an eine Karte, die es gibt.
		if (isCitymapLinkReport(report)) {
			itemElement.querySelector(".review-report__create").textContent = "Ergänzen";
		}
		// Kartensammlungs-Vorschlag (§3.8): zeigen, WAS vorgeschlagen wird. Der Titel steht schon oben, aber
		// der Karten-Link ist das, was der Pruefer aufmachen muss, um ueberhaupt entscheiden zu koennen --
		// und er steht sonst nirgends in der Liste. Rein per DOM gebaut (kein innerHTML): der Inhalt ist
		// Fremdtext aus einer oeffentlichen Meldung, wie beim Change-Ref-Block darunter.
		if (citymapProposal && citymapProposal.citymap) {
			const proposed = citymapProposal.citymap;
			const detailElement = document.createElement("div");
			detailElement.className = "review-report__citymap";
			if (proposed.map_url) {
				const link = document.createElement("a");
				link.className = "review-report__citymap-link";
				link.href = proposed.map_url;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				link.textContent = proposed.map_url + " ↗";
				detailElement.appendChild(link);
			}
			// Was der Melder sonst noch wusste. Die LIZENZ fehlt hier bewusst und ist kein vergessenes Feld:
			// der Melder darf keine angeben (§3.8), die Karte entsteht auf 'unknown_other', und der Pruefer
			// klassifiziert sie im Karten-Editor.
			const facts = [
				(citymapProposal.types || []).join(", "),
				proposed.art || "",
				proposed.author ? `von ${proposed.author}` : "",
				proposed.thumb_url ? "Vorschau-Link vorgeschlagen (erst nach Lizenzprüfung sichtbar)" : "",
				proposed.note || "",
			].filter(Boolean);
			if (facts.length) {
				const factsElement = document.createElement("div");
				factsElement.className = "review-report__citymap-facts";
				factsElement.textContent = facts.join(" · ");
				detailElement.appendChild(factsElement);
			}
			itemElement.querySelector(".review-report__focus").after(detailElement);
		}
		// Fundort-Meldung: die gemeldeten Links SIND die Meldung -- ohne sie stuende hier nur "3 Fundorte"
		// und der Pruefer muesste blind freigeben. Jeder als echter Link: ob ein Fundort taugt, sieht man
		// nur, wenn man ihn aufmacht. Rein per DOM gebaut (kein innerHTML), wie der Kartenblock darueber:
		// das ist Fremdtext aus einer oeffentlichen Meldung.
		if (fundortProposal && fundortCount) {
			const detailElement = document.createElement("div");
			detailElement.className = "review-report__citymap";
			fundortProposal.links.forEach((entry) => {
				const row = document.createElement("div");
				const link = document.createElement("a");
				link.className = "review-report__citymap-link";
				link.href = entry.url;
				link.target = "_blank";
				link.rel = "noopener noreferrer";
				link.textContent = `${entry.label} ↗`;
				row.appendChild(link);
				// Nur ein bekanntes JA/NEIN. NULL heisst "der Melder wusste es nicht" und wird nicht zu einer
				// Aussage gemacht (§3.1) -- der Pruefer traegt es dann selbst nach oder laesst es offen.
				if (entry.is_paid === 1 || entry.is_paid === 0) {
					const paid = document.createElement("span");
					paid.className = "review-report__citymap-facts";
					paid.textContent = entry.is_paid === 1 ? " · kostenpflichtig" : " · kostenlos";
					row.appendChild(paid);
				}
				detailElement.appendChild(row);
			});
			if (fundortProposal.note) {
				const noteElement = document.createElement("div");
				noteElement.className = "review-report__citymap-facts";
				noteElement.textContent = fundortProposal.note;
				detailElement.appendChild(noteElement);
			}
			itemElement.querySelector(".review-report__focus").after(detailElement);
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
			// Change reports edit the EXISTING element -> the create button opens the editor: "Bearbeiten".
			if (isLocationReport(report)) {
				itemElement.querySelector(".review-report__create").textContent = "Bearbeiten";
			}
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

// The German editor names, keyed by the area codes the server whitelists. Kept here rather than
// server-side: these are UI strings and belong with the rest of the interface, not in the API
// (AGENTS.md §8 -- German stays the default, English is the opt-in overlay).
const AVESMAPS_EDITOR_AREA_LABELS = {
	territories: "Territorien",
	paths: "Wege",
	ecosystem: "Landschaften",
	settlements: "Siedlungen",
	powerlines: "Kraftlinien",
	citymaps: "Kartensammlung",
	adventures: "Abenteuer",
	wikisync: "Datenabgleich",
	// The map layers. "Politische Karte" is deliberately a different entry from "Territorien" above:
	// only the editor window carries the write claim, and the panel should show which of the two
	// someone is in. The names follow the mode picker's own wording (index.html) so the panel says
	// what the person sees in their own dropdown.
	political_map: "Politische Karte",
	standard_map: "Standardkarte",
	original_map: "Originalkarte",
	plain_map: "Nur Karte",
};

// Pure: what to append to a user's meta line in the Status tab. Empty string means "append
// nothing" -- an offline user's area column is stale by definition, and an unknown key would
// otherwise leak a raw code into the UI.
function avesmapsFormatEditorActivity(user) {
	if (!user || !user.is_online) {
		return "";
	}
	const areaLabel = AVESMAPS_EDITOR_AREA_LABELS[user.activity_area];
	if (!areaLabel) {
		return "";
	}
	return user.activity_label ? `${areaLabel}: ${user.activity_label}` : areaLabel;
}

// avesmapsTerritoryWriteState lives in js/territory/territory-claim-view.js: the standalone
// territory page needs it too and loads none of this file.

// "Bearbeiten erzwingen": one heartbeat carrying force_claim. The server checks the capability --
// hiding the button is courtesy, not the guard.
async function avesmapsForceTerritoryClaim() {
	const activity = avesmapsResolveEditorActivity();
	try {
		const response = await fetch(EDITOR_PRESENCE_API_URL, {
			method: "POST",
			credentials: "same-origin",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({ area: activity.area, label: activity.label, force_claim: true }),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data?.ok !== true) {
			throw new Error(apiErrorMessage(data, "Übernahme fehlgeschlagen."));
		}
		editorPresenceUsers = Array.isArray(data.users) ? data.users : [];
		avesmapsApplyTerritoryClaim(data.territory_claim || null);
		renderEditorPresenceUsers();
		showFeedbackToast("Du hast das Schreibrecht für Territorien übernommen.", "success");
	} catch (error) {
		showFeedbackToast(error.message || "Übernahme fehlgeschlagen.", "error");
	}
}

// Offered only to admins, and only while SOMEONE ELSE holds the claim -- taking over from nobody
// is not a thing, and a permanently visible "force" button is a standing temptation.
function avesmapsSyncForceClaimButton() {
	const button = document.getElementById("presence-force-claim");
	if (!button) {
		return;
	}
	const blockedByOther = Boolean(editorTerritoryClaim) && editorTerritoryClaim.is_mine === false;
	button.hidden = !(editorCanForceClaim && blockedByOther);
	if (!button.hidden) {
		button.textContent = `Bearbeiten erzwingen (statt ${editorTerritoryClaim.username || "dem anderen"})`;
	}
}

// Every editor calls this when it opens (area + optional label) and when it closes (null, null).
// The heartbeat goes out IMMEDIATELY rather than waiting for the next 30s tick: whoever opens the
// territory editor must learn within the same interaction whether they may write.
function avesmapsSetEditorActivity(area, label) {
	editorActivityArea = area || null;
	editorActivityLabel = editorActivityArea ? (label || null) : null;
	void sendEditorPresenceHeartbeat();
}

// The guarded form every editor actually calls. The presence machinery only exists in edit mode,
// and 💣 `typeof` is not enough to check for it: a half-loaded const file throws in the temporal
// dead zone, taking the caller with it. try/catch is the form that survives that.
function avesmapsReportEditorArea(area, label) {
	try {
		avesmapsSetEditorActivity(area, label);
	} catch (error) {
		/* not in edit mode, or the panel bundle is not loaded -- nothing to report */
	}
}

// 💣 No subscribe/register handshake here, and that is a fix, not a simplification. The first
// version had territory-editor-link.js call avesmapsOnTerritoryClaimChange() at load time -- but
// index.html loads that file at position 35 and this one at 54, so the registry did not exist yet,
// the typeof guard silently declined, and the banner never appeared. Load order in index.html is a
// contract (AGENTS.md §3) and a bad thing to depend on. Resolving the target at CALL time instead
// cannot lose that race: by the first heartbeat every file is loaded.

// Which editor is open is DERIVED from which overlay is visible, rather than announced by hand at
// every open/close site. There are eight editors with three such sites each; a table plus an
// observer is one place instead of twenty-four, and the ninth editor costs one line here instead
// of an announcement someone has to remember. (That "someone has to remember" is exactly how the
// handbook rule and the sources table went wrong before -- AGENTS.md §9, §5.)
const AVESMAPS_EDITOR_OVERLAY_AREAS = {
	"political-territory-editor-overlay": "territories",
	"avesmaps-path-editor-overlay": "paths",
	"avesmaps-ecosystem-editor-overlay": "ecosystem",
	"avesmaps-settlement-editor-overlay": "settlements",
	"avesmaps-powerline-editor-overlay": "powerlines",
	"avesmaps-citymap-editor-overlay": "citymaps",
	"avesmaps-adventure-editor-overlay": "adventures",
	"avesmaps-sync-editor-overlay": "wikisync",
};

function avesmapsVisibleEditorArea() {
	const openId = Object.keys(AVESMAPS_EDITOR_OVERLAY_AREAS).find((id) => {
		const element = document.getElementById(id);
		return Boolean(element) && !element.hidden;
	});
	return openId ? AVESMAPS_EDITOR_OVERLAY_AREAS[openId] : null;
}

// 💣 Not every editor is a window. The landscape layer -- Derographie, Vegetation, Topographie and
// Klimazonen -- is drawn DIRECTLY ON THE MAP: ecosystem-pane--editable hangs off IS_EDIT_MODE, not
// off an open overlay. Watching only overlays left two people drawing climate zones side by side
// showing as plain "online" with nothing next to their name.
//
// 💣 "political" maps to political_map, NOT to territories -- and that distinction is the whole
// point. Reporting is not claiming. The write claim hangs off the area code `territories`, so if a
// map mode could report it, anyone who merely switched the political layer on would lock every
// other editor out of saving: a read action causing a write outage. Its own code shows the work
// and grants nothing. The first version of this function refused to report `political` at all,
// which protected the claim but also hid an editor at work -- reporting nothing was the wrong way
// to grant nothing.
//
// EVERY map mode is listed. An earlier version left out none/original/deregraphic as "ways of
// looking rather than places work happens" -- wrong, and the owner said so: the standard map is
// where places get created, ways get drawn and markers get moved. It is the main work surface in
// this app, not a viewing mode. If someone is in the editor, they are working somewhere, and the
// panel should say where.
//
// powerlines and ecosystem share the code of their editor window on purpose -- same subject, and
// the panel should read the same whether you are in the window or on the layer.
const AVESMAPS_MAP_MODE_AREAS = {
	ecosystem: "ecosystem",
	powerlines: "powerlines",
	political: "political_map",
	deregraphic: "standard_map",
	original: "original_map",
	none: "plain_map",
};

// Pure, so the rule above can be tested: the caller passes the current map state in.
function avesmapsMapWorkActivityFor(mapMode, ecosystemKind, kindLabels) {
	const area = AVESMAPS_MAP_MODE_AREAS[mapMode] || null;
	if (area === null) {
		return { area: null, label: null };
	}
	// Only the landscape layer has a meaningful sub-layer to name.
	const label = area === "ecosystem" ? ((kindLabels && kindLabels[ecosystemKind]) || null) : null;
	return { area, label };
}

// What to report right now. An open editor window always wins over the map layer underneath it.
function avesmapsResolveEditorActivity() {
	const overlayArea = avesmapsVisibleEditorArea();
	if (overlayArea) {
		// The label only belongs to the area it was reported for (the territory editor names its
		// territory); after a switch it would describe the wrong editor.
		return { area: overlayArea, label: overlayArea === editorActivityArea ? editorActivityLabel : null };
	}
	return avesmapsMapWorkActivityFor(
		typeof getSelectedMapLayerMode === "function" ? getSelectedMapLayerMode() : "",
		typeof getActiveEcosystemLayerKind === "function" ? getActiveEcosystemLayerKind() : "",
		typeof ECOSYSTEM_KIND_LABELS !== "undefined" ? ECOSYSTEM_KIND_LABELS : null
	);
}

// Only reports on an actual AREA change. Editors that know their current object (the territory
// editor) call avesmapsReportEditorArea directly and synchronously when they open, which runs
// before this observer callback -- so the explicit call wins and this one stays quiet instead of
// overwriting the label with null and costing a second heartbeat.
function avesmapsSyncEditorActivityFromOverlays() {
	const area = avesmapsVisibleEditorArea();
	if (area === editorActivityArea) {
		return;
	}
	avesmapsReportEditorArea(area, null);
}

function avesmapsWatchEditorOverlay(element) {
	if (!element || element.dataset.avesmapsActivityWatched === "1") {
		return;
	}
	element.dataset.avesmapsActivityWatched = "1";
	new MutationObserver(avesmapsSyncEditorActivityFromOverlays).observe(element, {
		attributes: true,
		attributeFilter: ["hidden"],
	});
	avesmapsSyncEditorActivityFromOverlays();
}

function avesmapsStartEditorOverlayWatch() {
	if (!IS_EDIT_MODE || !document.body) {
		return;
	}
	// childList WITHOUT subtree, on purpose: the overlays are appended straight to <body> on first
	// open. A subtree observer here would fire on every Leaflet tile and marker insertion -- a
	// constant cost on the hottest DOM in the app, for an event that happens eight times a session.
	new MutationObserver((records) => {
		records.forEach((record) => {
			record.addedNodes.forEach((node) => {
				if (node.nodeType === 1 && AVESMAPS_EDITOR_OVERLAY_AREAS[node.id]) {
					avesmapsWatchEditorOverlay(node);
				}
			});
		});
	}).observe(document.body, { childList: true });

	// The territory overlay already exists in index.html; the other seven are built on first open.
	Object.keys(AVESMAPS_EDITOR_OVERLAY_AREAS).forEach((id) => avesmapsWatchEditorOverlay(document.getElementById(id)));
}

if (typeof document !== "undefined") {
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", avesmapsStartEditorOverlayWatch);
	} else {
		avesmapsStartEditorOverlayWatch();
	}
}

// The iframe editors know WHICH object is open; the host owns the heartbeat, so they post it up.
// The host never adopts an AREA from a message -- only a label, and only while it already holds an
// area of its own. A postMessage is untrusted input: it may refine what we report, never define it.
window.addEventListener("message", (event) => {
	if (event.origin !== window.location.origin || !event.data || event.data.type !== "avesmaps:editor-activity") {
		return;
	}
	if (!editorActivityArea) {
		return;
	}
	avesmapsSetEditorActivity(editorActivityArea, event.data.label);
});

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
			// Resolved fresh on every beat rather than read from a stored value: the map layer can
			// change without any event we listen for, and deriving it here means one place decides
			// what "working on" means -- the same choice the claim itself is built on.
			body: JSON.stringify(avesmapsResolveEditorActivity()),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok || data?.ok !== true) {
			throw new Error(apiErrorMessage(data, "Online-Status konnte nicht geladen werden."));
		}

		editorPresenceUsers = Array.isArray(data.users) ? data.users : [];
		editorActivitySchema = String(data.activity_schema || "ok");
		editorCanForceClaim = data.can_force_claim === true;
		avesmapsApplyTerritoryClaim(data.territory_claim || null);
		renderEditorPresenceUsers();
		// The Status panel's visitor line rides on this poll instead of opening its own.
		if (typeof renderVisitorLiveStrip === "function") {
			renderVisitorLiveStrip(data.visitors, editorPresenceUsers.filter((user) => user.is_online).length);
		}
	} catch (error) {
		console.warn("Online-Status konnte nicht aktualisiert werden:", error);
		setPresencePanelStatus(error.message || "Nutzerstatus konnte nicht geladen werden.", "error");
	}
}

// Notify the territory editor only when the answer actually CHANGED, so a 30s poll does not
// re-run the banner and save-button plumbing (and re-fire the "it is free now" toast) every tick.
function avesmapsApplyTerritoryClaim(nextClaim) {
	// Compare the HOLDER, not the whole object: seconds_since_* grow with every poll, so a deep
	// compare would report "changed" every 30s and this guard would do nothing. The banner's
	// "since 14:20" is derived from the age at the moment it was rendered and stays correct while
	// the holder stays the same -- so not re-rendering is not just cheaper, it is also steadier.
	//
	// 💣 The guard compares against the last SUCCESSFULLY APPLIED holder, not merely the last one
	// received. The embedded editor's markup loads asynchronously, so the first claim answer often
	// arrives before #territoryClaimBanner exists; comparing received-to-received then means the
	// holder never "changes" again and the banner never appears at all. Retrying until it lands is
	// what makes the read-only state show up for an editor who opened the window a moment ago.
	const nextHolder = nextClaim ? Number(nextClaim.user_id) : null;
	if (nextHolder === editorTerritoryClaimAppliedFor) {
		editorTerritoryClaim = nextClaim;
		return;
	}
	editorTerritoryClaim = nextClaim;
	// Resolved at CALL time (see the note above avesmapsSetEditorActivity's neighbours): by now
	// every script is loaded, so this cannot lose the load-order race the registry version did.
	if (typeof applyPoliticalTerritoryClaim === "function") {
		try {
			// Only remember it as applied when the editor markup was actually there.
			if (applyPoliticalTerritoryClaim(editorTerritoryClaim) === true) {
				editorTerritoryClaimAppliedFor = nextHolder;
			}
		} catch (error) {
			console.warn("Territorien-Anspruch konnte nicht angewendet werden:", error);
		}
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

// Community reports arrive from other users while the editor stays open; without polling the review
// list would only refresh on F5, the manual refresh button, or after an action. This used to open its
// OWN 45s interval on the same endpoint that ensureReviewReportsPolling() already polled — two timers,
// two requests per cycle. It now just makes sure the single poller runs (bootstrap.js calls this).
function startReviewReportsPolling() {
	ensureReviewReportsPolling();
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
	// A silent fallback reads exactly like "nobody is working on anything" -- say it instead. The
	// list itself still renders below; only the summary line changes.
	const countLine = offlineUsers.length > 0
		? `${onlineUsers.length} online, ${offlineUsers.length} offline.`
		: `${onlineUsers.length} Nutzer online.`;
	if (editorActivitySchema === "degraded") {
		setPresencePanelStatus(`${countLine} Tätigkeit nicht verfügbar (Datenbankspalten fehlen).`, "warning");
	} else {
		setPresencePanelStatus(countLine, onlineUsers.length > 0 ? "success" : "empty");
	}

	avesmapsSyncForceClaimButton();
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
		// A star marks who currently holds the write claim -- the one person whose saves go through.
		const holdsClaim = Boolean(editorTerritoryClaim) && Number(editorTerritoryClaim.user_id) === Number(user.id);
		itemElement.querySelector(".presence-user__name").textContent = (user.username || "Editor") + (holdsClaim ? " *" : "");
		if (holdsClaim) {
			itemElement.querySelector(".presence-user__name").title = "Bearbeitet gerade -- nur diese Person kann Territorien speichern.";
		}
		const presenceAge = formatPresenceAge(user.seconds_since_seen);
		const roleLabel = formatPresenceRole(user.role);
		const stateLabel = user.is_online ? "online" : "offline";
		itemElement.querySelector(".presence-user__meta").textContent = [roleLabel, stateLabel, presenceAge, avesmapsFormatEditorActivity(user)].filter(Boolean).join(" · ");
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
		inselgruppe: "Inselgruppe",
		gebirge: "Gebirge",
		berggipfel: "Berggipfel",
		vulkan: "Vulkan",
		wald: "Wald",
		steppe: "Steppe",
		huegelland: "Hügelland",
		tal: "Tal",
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
		karte: "Karte",
		fundort: "Fundort",
	}[reportSubtype] || reportSubtype || "Karteneintrag";
}

function isLocationReport(report) {
	return (report.report_type || "location") === "location";
}

function isCommentReport(report) {
	return (report.report_type || "") === "comment" || (report.report_subtype || "") === "comment";
}

// Kartensammlungs-Vorschlag (§3.8). Der einzige Meldungstyp, der KEINE map_features-Zeile vorschlaegt --
// "Anlegen" legt eine citymap an, nicht einen Punkt oder ein Label.
function isCitymapReport(report) {
	return (report.report_type || "") === "citymap";
}

// Fundort-Meldung (Spec 2026-07-17-community-fundorte): der einzige Typ, der ueberhaupt nichts anlegt --
// "Anlegen" haengt Fundorte an eine BESTEHENDE Karte.
function isCitymapLinkReport(report) {
	return (report.report_type || "") === "citymap_link";
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
	// Dieselbe Geste wie beim WikiSync-Vorschaupunkt: Klick raeumt weg. Der Marker verschwindet
	// zwar in allen Abschlusswegen (genehmigen, anlegen, ablehnen), aber wer eine Meldung nur
	// ansieht und dann nichts tut, behielt ihn -- ohne Moeglichkeit, ihn wieder loszuwerden.
	reviewReportMarker.on("click", clearReviewReportMarker);
	armReviewReportMarkerDismiss();

	map.flyTo(latlng, Math.max(map.getZoom(), 3), { duration: 0.8 });
}

// Erst beim ersten gezeigten Marker registriert: `map` entsteht im Bootstrap zuletzt.
let reviewReportDismissArmed = false;

function armReviewReportMarkerDismiss() {
	if (reviewReportDismissArmed || typeof map === "undefined" || !map) {
		return;
	}

	reviewReportDismissArmed = true;
	map.on("click", () => clearReviewReportMarker());
}

function isProcessedReviewReport(report) {
	return String(report?.status || "neu") !== "neu";
}

function reviewReportDecisionSummary(report) {
	const status = String(report?.status || "");
	const label = { approved: "Angenommen", rejected: "Verworfen", in_review: "Zurückgestellt" }[status] || status || "Bearbeitet";
	const who = report?.reviewed_by_username ? ` von ${report.reviewed_by_username}` : "";
	const when = report?.reviewed_at ? ` · ${String(report.reviewed_at).slice(0, 16).replace("T", " ")}` : "";
	return `${label}${who}${when}`;
}

// Derselbe Trichter wie die WikiSync-Listen (js/app/utils.js). Ein Wechsel laedt neu, statt lokal zu
// filtern: die erledigten Meldungen liegen gar nicht im Speicher, und der Server deckelt sie.
attachFilterMenu(
	"review-report-filter-toggle",
	"review-report-filter-menu",
	[{
		menuId: "review-report-status-filter-menu",
		kind: "single",
		state: reviewReportStatusFilter,
		options: REVIEW_REPORT_STATUS_OPTIONS,
		label: "Bearbeitung",
		isActive: () => Boolean(reviewReportStatusFilter.value),
	}],
	() => { void loadReviewReports(); },
	"Filter"
);

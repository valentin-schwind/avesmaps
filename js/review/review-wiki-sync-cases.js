// WikiSync case list: grouping, filtering, accordion state, rendering and the
// create-location flow. Split out of review-wiki-sync.js (M5 god-file split).
// Plain classic script (no module): all functions are global and called at
// runtime, so load order relative to review-wiki-sync.js does not matter.

function renderWikiSyncCases(latestRun = null) {
	const listElement = document.getElementById("wiki-sync-case-list");
	if (!listElement) {
		return;
	}
	syncWikiSyncPanelHeaderState();

	const previousOpenGroupKeys = getWikiSyncOpenGroupKeys();
	const filterQuery = getWikiSyncFilterQuery();
	const filterDisplayQuery = String(wikiSyncFilterQuery || "").trim();
	const hasActiveFilter = filterQuery !== "";
	const shouldCollapseGroups = wikiSyncFilterCollapseRequested && !hasActiveFilter;
	listElement.innerHTML = "";
	syncWikiSyncFilterControls();

	if (!latestRun && wikiSyncCases.length < 1) {
		setWikiSyncStatus(buildWikiSyncStatusMessage("Noch kein WikiSync-Lauf. Starte die Synchronisierung manuell."), "empty");
		return;
	}

	if (wikiSyncCases.length < 1) {
		setWikiSyncStatus(buildWikiSyncStatusMessage("Keine WikiSync-Fälle."), "empty");
		return;
	}

	const filteredCases = hasActiveFilter ? getWikiSyncFilteredCases(wikiSyncCases, filterQuery) : wikiSyncCases;
	const statusMessage = isWikiSyncCreateLocationSelectionActive
		? "Wählen Sie den Ort aus der Liste."
		: hasActiveFilter
		? `${filteredCases.length} Treffer für "${filterDisplayQuery}".`
		: "";
	setWikiSyncStatus(buildWikiSyncStatusMessage(statusMessage), isWikiSyncCreateLocationSelectionActive ? "pending" : "success");

	const renderedGroupElements = new Map();
	const openSectionElement = renderWikiSyncCaseSection(listElement, "Offen", "open", filteredCases.filter((caseEntry) => caseEntry.status === "open"), renderedGroupElements);
	const deferredSectionElement = renderWikiSyncCaseSection(listElement, "Zurückgestellt", "deferred", filteredCases.filter((caseEntry) => caseEntry.status === "deferred"), renderedGroupElements);
	const archivedSectionElement = renderWikiSyncCaseSection(listElement, "Archiviert", "archived", filteredCases.filter((caseEntry) => caseEntry.status === "archived"), renderedGroupElements);
	if (!openSectionElement && !deferredSectionElement && !archivedSectionElement) {
		setWikiSyncStatus(buildWikiSyncStatusMessage(hasActiveFilter ? `Keine Treffer für "${filterDisplayQuery}".` : "Keine WikiSync-Fälle."), "empty");
		wikiSyncFilterCollapseRequested = false;
		syncWikiSyncCreateLocationContextMenuAction();
		return;
	}

	if (hasActiveFilter) {
		isWikiSyncAccordionRestoring = true;
		try {
			listElement.querySelectorAll(".wiki-sync-case-group").forEach((detailsElement) => {
				if (detailsElement instanceof HTMLDetailsElement) {
					detailsElement.open = true;
				}
			});
			if (isWikiSyncCreateLocationSelectionActive) {
				const selectionGroupElement = listElement.querySelector('.wiki-sync-case-group[data-case-type="missing_wiki_without_coordinates"]');
				if (selectionGroupElement instanceof HTMLDetailsElement) {
					selectionGroupElement.open = true;
				}
			}
		} finally {
			window.requestAnimationFrame(() => {
				isWikiSyncAccordionRestoring = false;
			});
		}
	} else if (!shouldCollapseGroups) {
		restoreWikiSyncAccordionState(renderedGroupElements, previousOpenGroupKeys);
	}

	wikiSyncFilterCollapseRequested = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function getWikiSyncOpenGroupKeys() {
	return Array.from(document.querySelectorAll("#wiki-sync-case-list .wiki-sync-case-group[open]"))
		.map((groupElement) => (groupElement instanceof HTMLElement ? String(groupElement.dataset.groupKey || "") : ""))
		.filter((groupKey) => groupKey !== "");
}

function restoreWikiSyncAccordionState(renderedGroupElements, previousOpenGroupKeys) {
	if (!Array.isArray(previousOpenGroupKeys) || previousOpenGroupKeys.length < 1) {
		return;
	}

	isWikiSyncAccordionRestoring = true;
	try {
		previousOpenGroupKeys.forEach((groupKey) => {
			const groupElement = renderedGroupElements.get(groupKey) || getWikiSyncFallbackGroupElement(renderedGroupElements, groupKey);
			if (groupElement) {
				groupElement.open = true;
			}
		});
	} finally {
		window.requestAnimationFrame(() => {
			isWikiSyncAccordionRestoring = false;
		});
	}
}

function syncWikiSyncFilterControls() {
	const inputElement = document.getElementById("wiki-sync-filter");
	if (inputElement instanceof HTMLInputElement) {
		inputElement.value = wikiSyncFilterQuery;
	}
}

function setWikiSyncFilterQuery(value) {
	const nextQuery = String(value || "");
	const previousNormalized = getWikiSyncFilterQuery();
	const nextNormalized = normalizeWikiSyncFilterQuery(nextQuery);
	if (nextQuery === wikiSyncFilterQuery) {
		syncWikiSyncFilterControls();
		return;
	}

	const hadFilter = previousNormalized !== "";
	wikiSyncFilterQuery = nextQuery;
	wikiSyncFilterCollapseRequested = hadFilter && nextNormalized === "";
	syncWikiSyncFilterControls();
	if (previousNormalized !== nextNormalized || wikiSyncFilterCollapseRequested) {
		renderWikiSyncCases();
	}
}

function getWikiSyncFilterQuery() {
	return normalizeWikiSyncFilterQuery(wikiSyncFilterQuery);
}

function normalizeWikiSyncFilterQuery(value) {
	return normalizeWikiSyncSearchText(value).trim();
}

function normalizeWikiSyncSearchText(value) {
	return String(value || "")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/ß/g, "ss")
		.toLowerCase();
}

function getWikiSyncCaseSearchText(caseEntry) {
	const payload = caseEntry.payload || {};
	const mapPlace = payload.map || {};
	const resolutionFeature = getWikiSyncResolvedFeature(caseEntry) || {};
	const wikiPage = payload.wiki || {};
	const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
	const matches = Array.isArray(payload.matches) ? payload.matches : [];
	const proposedLocation = payload.proposed_location || {};
	const tokens = [
		caseEntry.case_label,
		caseEntry.case_type,
		formatWikiSyncCaseStatus(caseEntry.status),
		getWikiSyncCaseTitle(caseEntry),
		payload.name,
		mapPlace.name,
		mapPlace.settlement_label,
		mapPlace.settlement_class,
		resolutionFeature.name,
		resolutionFeature.location_type_label,
		resolutionFeature.feature_subtype,
		wikiPage.title,
		wikiPage.url,
		payload.match_kind,
		proposedLocation.source_label,
		proposedLocation.source,
		proposedLocation.warnings?.join(" "),
		...candidates.map((candidate) => candidate.title || ""),
		...matches.map((match) => match.name || ""),
	];

	if (proposedLocation.lat !== undefined && proposedLocation.lng !== undefined) {
		tokens.push(formatLocationReportCoordinates(proposedLocation));
	}

	return normalizeWikiSyncSearchText(tokens.filter(Boolean).join(" "));
}

function getWikiSyncFilteredCases(cases = wikiSyncCases, filterQuery = "") {
	const normalizedQuery = normalizeWikiSyncFilterQuery(filterQuery);
	if (!normalizedQuery) {
		return Array.isArray(cases) ? cases.slice() : [];
	}

	const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);
	if (queryTokens.length < 1) {
		return Array.isArray(cases) ? cases.slice() : [];
	}

	return (Array.isArray(cases) ? cases : []).filter((caseEntry) => {
		const searchableText = getWikiSyncCaseSearchText(caseEntry);
		return queryTokens.every((token) => searchableText.includes(token));
	});
}

function hasWikiSyncMissingWikiWithoutCoordinatesCases() {
	return wikiSyncCases.some((caseEntry) => caseEntry.case_type === "missing_wiki_without_coordinates" && caseEntry.status !== "archived");
}

function syncWikiSyncCreateLocationContextMenuAction() {
	const actionElement = document.querySelector('[data-context-action="create-location-from-wiki"]');
	if (!actionElement) {
		return;
	}

	actionElement.hidden = !hasWikiSyncMissingWikiWithoutCoordinatesCases();
}

function startWikiSyncCreateLocationSelection(latlng) {
	wikiSyncCreateLocationContextLatLng = L.latLng(latlng);
	isWikiSyncCreateLocationSelectionActive = true;
	if (isReviewPanelHidden) {
		toggleReviewPanel();
	}
	window.setEditorPanelTab?.("wiki-sync");
	setWikiSyncStatus("Wählen Sie den Ort aus der Liste.", "pending");
	showFeedbackToast("Wählen Sie den Ort aus der Liste.", "info");
}

function clearWikiSyncCreateLocationSelection() {
	wikiSyncCreateLocationContextLatLng = null;
	isWikiSyncCreateLocationSelectionActive = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function resetWikiSyncCreateLocationFlowState() {
	wikiSyncCreateLocationContextLatLng = null;
	wikiSyncCreateLocationCaseId = null;
	isWikiSyncCreateLocationSelectionActive = false;
	syncWikiSyncCreateLocationContextMenuAction();
}

function openWikiSyncCreateLocationDialogFromCase(caseEntry) {
	const latlng = wikiSyncCreateLocationContextLatLng ? L.latLng(wikiSyncCreateLocationContextLatLng) : null;
	if (!latlng) {
		showFeedbackToast("Bitte zuerst eine Position auf der Karte wählen.", "warning");
		return;
	}

	const wikiPage = caseEntry.payload?.wiki || {};
	const presetName = wikiPage.title || "";
	const presetLocationType = normalizeLocationType(wikiPage.settlement_class || "dorf");
	const presetWikiUrl = wikiPage.url || "";
	wikiSyncCreateLocationCaseId = Number(caseEntry.id) || null;
	clearWikiSyncCreateLocationSelection();
	openLocationEditDialog({
		latlng,
		presetName,
		presetLocationType,
		presetWikiUrl,
		presetDescription: "",
	});
	renderWikiSyncCases();
	showFeedbackToast("Wiki-Ort wird als neuer Ort angelegt.", "success");
}

function getWikiSyncFallbackGroupElement(renderedGroupElements, groupKey) {
	const parts = String(groupKey).split(":");
	if (parts.length < 2) {
		return null;
	}

	const sectionKey = parts.shift();
	const caseType = parts.join(":");
	if (sectionKey !== "open") {
		return null;
	}

	return renderedGroupElements.get(`archived:${caseType}`) || null;
}

function renderWikiSyncCaseSection(listElement, title, sectionKey, cases, renderedGroupElements) {
	if (!Array.isArray(cases) || cases.length < 1) {
		return null;
	}

	const sectionElement = document.createElement("section");
	sectionElement.className = `wiki-sync-case-section wiki-sync-case-section--${sectionKey}`;
	sectionElement.dataset.sectionKey = sectionKey;

	const titleElement = document.createElement("h3");
	titleElement.className = "wiki-sync-case-section__title";
	titleElement.textContent = title;
	sectionElement.appendChild(titleElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case-section__body";
	getWikiSyncGroupedCases(cases).forEach((group) => {
		const groupElement = createWikiSyncCaseGroupElement(group, sectionKey);
		renderedGroupElements.set(groupElement.dataset.groupKey || `${sectionKey}:${group.caseType}`, groupElement);
		bodyElement.appendChild(groupElement);
	});

	if (bodyElement.childElementCount < 1) {
		return null;
	}

	sectionElement.appendChild(bodyElement);
	listElement.appendChild(sectionElement);
	return sectionElement;
}

function handleWikiSyncCaseGroupToggle(event) {
	if (isWikiSyncAccordionRestoring) {
		return;
	}

	const groupElement = event.currentTarget;
	if (!(groupElement instanceof HTMLDetailsElement) || !groupElement.open) {
		return;
	}

	const sectionElement = groupElement.closest(".wiki-sync-case-section");
	if (!sectionElement) {
		return;
	}

	sectionElement.querySelectorAll(".wiki-sync-case-group").forEach((otherGroupElement) => {
		if (otherGroupElement !== groupElement && otherGroupElement instanceof HTMLDetailsElement) {
			otherGroupElement.open = false;
		}
	});

	window.requestAnimationFrame(() => {
		groupElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
	});
}

function getWikiSyncGroupedCases(cases = wikiSyncCases) {
	const groupsByType = new Map();
	cases.forEach((caseEntry) => {
		const caseType = caseEntry.case_type || "unknown";
		if (!groupsByType.has(caseType)) {
			groupsByType.set(caseType, {
				caseType,
				label: caseEntry.case_label || getWikiSyncCaseTypeLabel(caseType),
				cases: [],
			});
		}

		groupsByType.get(caseType).cases.push(caseEntry);
	});

	return Array.from(groupsByType.values()).sort((left, right) => getWikiSyncCaseTypeOrder(left.caseType) - getWikiSyncCaseTypeOrder(right.caseType));
}

function getWikiSyncCaseTypeOrder(caseType) {
	const order = {
		canonical_name_difference: 10,
		type_conflict: 20,
		probable_match: 30,
		// WikiDump comparison cases (exact match, but a field/position/coat differs).
		// Clustered right after probable_match so they read as a group; each has its own
		// German label below. coordinate_drift comes first because it has a map action.
		coordinate_drift: 32,
		field_divergence: 34,
		coat_available: 36,
		unresolved_without_candidate: 40,
		duplicate_avesmaps_name: 50,
		duplicate_wiki_title: 60,
		missing_wiki_with_coordinates: 70,
		missing_wiki_without_coordinates: 80,
		missing_capital: 90,
	};

	return order[caseType] || 999;
}

function getWikiSyncCaseTypeLabel(caseType) {
	const labels = {
		canonical_name_difference: "Abweichende Benennung",
		type_conflict: "Typkonflikte",
		probable_match: "Unaufgelöst, aber mit wahrscheinlichem Match",
		unresolved_without_candidate: "Unaufgelöst, ohne Match",
		duplicate_avesmaps_name: "Dubletten in Avesmaps",
		duplicate_wiki_title: "Mehrere Avesmaps-Namen zeigen auf denselben Wiki-Titel",
		missing_wiki_with_coordinates: "Fehlende Wiki-Orte mit Koordinaten",
		missing_wiki_without_coordinates: "Fehlende Wiki-Orte ohne nutzbare Koordinaten",
		missing_capital: "Fehlende Hauptstädte",
		// WikiDump comparison cases. Labels mirror the backend single source
		// (AVESMAPS_WIKI_CASE_LABELS in api/_internal/wiki/locations.php); the per-case
		// case_label from the server takes precedence at render time (getWikiSyncGroupedCases),
		// so these are the fallback when a case arrives without one.
		coordinate_drift: "Position weicht vom Wiki ab",
		field_divergence: "Weicht vom Wiki ab",
		coat_available: "Wappen im Wiki verfügbar",
	};

	return labels[caseType] || caseType;
}

function getWikiSyncResolvedFeature(caseEntry) {
	return caseEntry?.resolution?.feature || caseEntry?.payload?.resolution?.feature || null;
}

function createWikiSyncCaseElement(caseEntry) {
	const payload = caseEntry.payload || {};
	const detailsElement = document.createElement("details");
	detailsElement.className = "wiki-sync-case";
	detailsElement.dataset.caseId = String(caseEntry.id || "");
	detailsElement.dataset.caseType = caseEntry.case_type || "";

	const summaryElement = document.createElement("summary");
	summaryElement.className = "wiki-sync-case__summary";
	const titleElement = document.createElement("span");
	titleElement.className = "wiki-sync-case__title";
	titleElement.textContent = getWikiSyncCaseTitle(caseEntry);
	const statusElement = document.createElement("span");
	statusElement.className = `wiki-sync-case__status wiki-sync-case__status--${caseEntry.status || "open"}`;
	statusElement.textContent = formatWikiSyncCaseStatus(caseEntry.status);
	summaryElement.append(titleElement, statusElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case__body";
	if (caseEntry.case_type === "missing_capital") {
		appendMissingCapitalCaseBody(bodyElement, caseEntry);
	} else if (caseEntry.case_type === "coordinate_drift") {
		// Drift case: its own body (both positions + distance) and its own two
		// actions ("Auf Wiki-Position setzen" / "Karte behalten"), mirroring the
		// missing_capital precedent. NOT the generic rows/candidates/actions.
		appendCoordinateDriftCaseBody(bodyElement, caseEntry);
	} else {
		appendWikiSyncCaseRows(bodyElement, caseEntry);
		appendWikiSyncCaseCandidates(bodyElement, caseEntry);
	}
	if (caseEntry.case_type !== "coordinate_drift") {
		appendWikiSyncCaseActions(bodyElement, caseEntry);
	}

	detailsElement.append(summaryElement, bodyElement);
	detailsElement.addEventListener("toggle", () => {
		if (isWikiSyncAccordionRestoring) {
			return;
		}

		// A drift case that CLOSES must clear its two markers + line, exactly like the preview
		// marker below. An OPEN drift case draws them via its own hook.
		if (caseEntry.case_type === "coordinate_drift") {
			if (detailsElement.open) {
				focusWikiSyncCoordinateDriftCase(caseEntry);
			} else {
				clearWikiSyncCoordinateDriftLayers();
			}
			return;
		}

		if (detailsElement.open && (payload.map || payload.proposed_location || Array.isArray(payload.matches))) {
			focusWikiSyncCase(caseEntry);
		} else if (!detailsElement.open) {
			// Zuklappen raeumt die Vorschau weg -- genau die Symmetrie, die der Kommentar oben bei
			// den Abweichungs-Layern schon behauptet hat ("mirrors the preview-marker auto-remove").
			// Sie fehlte: der Punkt ueberlebte das Zuklappen und blieb auf der Karte stehen.
			clearWikiSyncPreviewMarker();
		}
	});

	return detailsElement;
}

function createWikiSyncCaseGroupElement(group, sectionKey) {
	const groupElement = document.createElement("details");
	groupElement.className = "wiki-sync-case-group";
	groupElement.dataset.caseType = group.caseType;
	groupElement.dataset.sectionKey = sectionKey;
	groupElement.dataset.groupKey = `${sectionKey}:${group.caseType}`;
	groupElement.addEventListener("toggle", handleWikiSyncCaseGroupToggle);

	const summaryElement = document.createElement("summary");
	summaryElement.className = "wiki-sync-case-group__summary";
	const titleElement = document.createElement("span");
	titleElement.className = "wiki-sync-case-group__title";
	titleElement.textContent = group.label;
	const countElement = document.createElement("span");
	countElement.className = "wiki-sync-case-group__count";
	countElement.textContent = String(group.cases.length);
	summaryElement.append(titleElement, countElement);
	groupElement.appendChild(summaryElement);

	const bodyElement = document.createElement("div");
	bodyElement.className = "wiki-sync-case-group__body";
	group.cases.forEach((caseEntry) => bodyElement.appendChild(createWikiSyncCaseElement(caseEntry)));
	groupElement.appendChild(bodyElement);

	return groupElement;
}

function appendWikiSyncCaseRows(bodyElement, caseEntry) {
	const payload = caseEntry.payload || {};
	const mapPlace = payload.map || getWikiSyncResolvedFeature(caseEntry);
	const wikiPage = payload.wiki || null;

	if (mapPlace) {
		appendWikiSyncInfoRow(bodyElement, "Avesmaps", `${mapPlace.name || "Unbenannt"} · ${mapPlace.settlement_label || mapPlace.location_type_label || mapPlace.settlement_class || mapPlace.feature_subtype || "Ort"}`);
	}

	if (wikiPage) {
		appendWikiSyncLinkRow(bodyElement, "Wiki", wikiPage.title || "Wiki Aventurica", wikiPage.url || "");
	}

	if (payload.match_kind) {
		appendWikiSyncInfoRow(bodyElement, "Match", formatWikiSyncMatchKind(payload.match_kind));
	}

	if (caseEntry.case_type === "duplicate_avesmaps_name") {
		appendWikiSyncInfoRow(bodyElement, "Name", payload.name || "Unbenannt");
		appendWikiSyncInfoRow(bodyElement, "Treffer", String(Array.isArray(payload.matches) ? payload.matches.length : 0));
	}

	if (payload.proposed_location) {
		const sourceLabel = payload.proposed_location.source_label || payload.proposed_location.source || "Koordinaten";
		appendWikiSyncInfoRow(bodyElement, "Position", `${formatLocationReportCoordinates(payload.proposed_location)} · ${sourceLabel}`);
		if (Array.isArray(payload.proposed_location.warnings) && payload.proposed_location.warnings.length > 0) {
			appendWikiSyncInfoRow(bodyElement, "Hinweis", payload.proposed_location.warnings.join(" "));
		}
	}
}

function appendWikiSyncCaseCandidates(bodyElement, caseEntry) {
	const payload = caseEntry.payload || {};
	const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
	const matches = Array.isArray(payload.matches) ? payload.matches : [];

	if (caseEntry.case_type === "duplicate_avesmaps_name" && matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices wiki-sync-case__choices--duplicate";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Dubletten";
		sectionElement.appendChild(labelElement);

		matches.forEach((match, index) => {
			const entryElement = document.createElement("div");
			entryElement.className = "wiki-sync-case__duplicate-entry";

			const entryTitleElement = document.createElement("span");
			entryTitleElement.className = "wiki-sync-case__duplicate-title";
			entryTitleElement.textContent = `${index + 1}. Ort: ${match.name || "Unbenannter Ort"} · ${match.settlement_label || match.settlement_class || "Ort"}`;
			entryElement.appendChild(entryTitleElement);

			const entryActionsElement = document.createElement("div");
			entryActionsElement.className = "wiki-sync-case__duplicate-actions";

			const showButtonElement = document.createElement("button");
			showButtonElement.type = "button";
			showButtonElement.className = "wiki-sync-case__choice";
			showButtonElement.dataset.wikiSyncAction = "focus";
			showButtonElement.dataset.publicId = match.public_id || "";
			showButtonElement.textContent = "Anzeigen";
			entryActionsElement.appendChild(showButtonElement);

			entryElement.appendChild(entryActionsElement);
			sectionElement.appendChild(entryElement);
		});

		bodyElement.appendChild(sectionElement);
	} else if (caseEntry.case_type === "duplicate_wiki_title" && matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices wiki-sync-case__choices--duplicate";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Orte";
		sectionElement.appendChild(labelElement);

		// Frueher matches.slice(0, 2): der Renderer nahm an, Dubletten kaemen paarweise. Am 2026-07-20
		// live gemessen: „Das Erbe von Blaustein" haengt an FUENF Orten, Erlenbruch an drei -- ab dem
		// dritten Ort war der Fall nicht mehr aufloesbar, weil die uebrigen gar nicht erst gerendert
		// wurden. Die Nummerierung (index + 1) trug das schon immer.
		matches.forEach((match, index) => {
			const entryElement = document.createElement("div");
			entryElement.className = "wiki-sync-case__duplicate-entry";

			const entryTitleElement = document.createElement("span");
			entryTitleElement.className = "wiki-sync-case__duplicate-title";
			entryTitleElement.textContent = `${index + 1}. Ort: ${match.name || "Unbenannter Ort"}`;
			entryElement.appendChild(entryTitleElement);

			const entryActionsElement = document.createElement("div");
			entryActionsElement.className = "wiki-sync-case__duplicate-actions";

			const showButtonElement = document.createElement("button");
			showButtonElement.type = "button";
			showButtonElement.className = "wiki-sync-case__choice";
			showButtonElement.dataset.wikiSyncAction = "focus";
			showButtonElement.dataset.publicId = match.public_id || "";
			showButtonElement.textContent = "Anzeigen";
			entryActionsElement.appendChild(showButtonElement);

			if (caseEntry.status === "open") {
				const acceptButtonElement = document.createElement("button");
				acceptButtonElement.type = "button";
				acceptButtonElement.className = "wiki-sync-case__choice wiki-sync-case__choice--accept";
				acceptButtonElement.dataset.wikiSyncAction = "resolve";
				acceptButtonElement.dataset.publicId = match.public_id || "";
				acceptButtonElement.textContent = "Akzeptieren";
				entryActionsElement.appendChild(acceptButtonElement);
			}

			entryElement.appendChild(entryActionsElement);
			sectionElement.appendChild(entryElement);
		});

		bodyElement.appendChild(sectionElement);
	} else if (matches.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Avesmaps-Orte";
		sectionElement.appendChild(labelElement);
		matches.forEach((match) => {
			const buttonElement = document.createElement("button");
			buttonElement.type = "button";
			buttonElement.className = "wiki-sync-case__choice";
			buttonElement.dataset.wikiSyncAction = "focus";
			buttonElement.dataset.publicId = match.public_id || "";
			buttonElement.textContent = match.name || "Unbenannter Ort";
			sectionElement.appendChild(buttonElement);
			if (caseEntry.status === "open") {
				const acceptButtonElement = document.createElement("button");
				acceptButtonElement.type = "button";
				acceptButtonElement.className = "wiki-sync-case__choice wiki-sync-case__choice--accept";
				acceptButtonElement.dataset.wikiSyncAction = "resolve";
				acceptButtonElement.dataset.publicId = match.public_id || "";
				acceptButtonElement.textContent = "Akzeptieren";
				sectionElement.appendChild(acceptButtonElement);
			}
		});
		bodyElement.appendChild(sectionElement);
	}

	if (candidates.length > 0) {
		const sectionElement = document.createElement("div");
		sectionElement.className = "wiki-sync-case__choices";
		const labelElement = document.createElement("span");
		labelElement.className = "wiki-sync-case__choices-label";
		labelElement.textContent = "Wiki-Kandidaten";
		sectionElement.appendChild(labelElement);
		candidates.forEach((candidate, index) => {
			const buttonElement = document.createElement("button");
			buttonElement.type = "button";
			buttonElement.className = "wiki-sync-case__choice";
			buttonElement.dataset.wikiSyncAction = "resolve";
			buttonElement.dataset.candidateIndex = String(index);
			buttonElement.textContent = `${candidate.title || "Wiki-Kandidat"}${candidate.score ? ` (${Math.round(Number(candidate.score) * 100)}%)` : ""}`;
			sectionElement.appendChild(buttonElement);
		});
		bodyElement.appendChild(sectionElement);
	}
}

function appendWikiSyncCaseActions(bodyElement, caseEntry) {
	const actionsElement = document.createElement("div");
	actionsElement.className = "wiki-sync-case__actions";

	if (caseEntry.status === "archived" || caseEntry.status === "deferred") {
		actionsElement.appendChild(createWikiSyncActionButton("reopen", "Wieder öffnen", "wiki-sync-case__action--primary"));
	}

	if (caseEntry.case_type === "missing_wiki_without_coordinates" && caseEntry.status === "open" && isWikiSyncCreateLocationSelectionActive && wikiSyncCreateLocationContextLatLng) {
		actionsElement.appendChild(createWikiSyncActionButton("select-wiki-location", "Diesen Ort wählen", "wiki-sync-case__action--primary"));
	} else if (!WIKI_SYNC_CASE_TYPES_WITHOUT_FOCUS.has(caseEntry.case_type)) {
		actionsElement.appendChild(createWikiSyncActionButton("focus", "Anzeigen", "wiki-sync-case__action--primary"));
	}

	if (canResolveWikiSyncCase(caseEntry)) {
		const label = caseEntry.case_type === "missing_wiki_without_coordinates" ? "Position wählen" : "Lösen";
		const action = caseEntry.case_type === "missing_wiki_without_coordinates" ? "pick-position" : "resolve";
		actionsElement.appendChild(createWikiSyncActionButton(action, label, "wiki-sync-case__action--primary"));
	}

	actionsElement.appendChild(createWikiSyncActionButton("defer", "Zurückstellen", "wiki-sync-case__action--danger"));
	actionsElement.appendChild(createWikiSyncActionButton("archive", "Archivieren", "wiki-sync-case__action--danger"));
	bodyElement.appendChild(actionsElement);
}

// Body for a missing_capital case: territory + wiki capital name, plus the inline assign controls (server name
// suggestions + free location search) while open. Resolving = picking a capital (assignCapitalForTerritory),
// which is delegated on #wiki-sync-case-list in review-capitals-list.js.
function appendMissingCapitalCaseBody(bodyElement, caseEntry) {
	const payload = caseEntry.payload || {};
	// Beide Namen verlinken, wo eine ECHTE URL vorliegt (Owner 2026-07-21) -- so kann man den Fall im
	// Wiki nachlesen, statt zwei Mal selbst zu suchen. Das Gebiet bringt seine gespeicherte URL mit,
	// die Hauptstadt nur, wenn es unter genau dem Namen einen Artikel gibt; sonst bleibt sie Text.
	// Bewusst NICHT aus dem Namen gebaut: capital_name ist Infobox-Freitext und enthaelt auch Prosa
	// ("wohl Alstfurt"), eine geratene URL waere Discord #38 an neuer Stelle.
	const territoryLabel = `${payload.name || "-"}${payload.type ? ` (${payload.type})` : ""}`;
	if (payload.wiki_url) {
		appendWikiSyncLinkRow(bodyElement, "Gebiet", territoryLabel, payload.wiki_url);
	} else {
		appendWikiSyncInfoRow(bodyElement, "Gebiet", territoryLabel);
	}
	if (payload.capital_wiki_url) {
		appendWikiSyncLinkRow(bodyElement, "Wiki-Hauptstadt", payload.capital_name || "-", payload.capital_wiki_url);
	} else {
		appendWikiSyncInfoRow(bodyElement, "Wiki-Hauptstadt", payload.capital_name || "-");
	}

	if (caseEntry.status === "open" && typeof renderCapitalAssignControls === "function") {
		const controls = document.createElement("div");
		controls.className = "capital-list__actions";
		controls.innerHTML = renderCapitalAssignControls(
			String(payload.territory_public_id || caseEntry.id || ""),
			payload.capital_name || "",
			Array.isArray(payload.suggestions) ? payload.suggestions : []
		);
		bodyElement.appendChild(controls);
	}
}

// Body for a coordinate_drift case: the Avesmaps marker name + BOTH positions
// (map vs wiki, both in 0..1024 map units) + the euclidean drift distance, then a
// dedicated actions block. Mirrors appendMissingCapitalCaseBody. The payload shape
// (Wave 1, dump-sync-kind.php): payload.map = {public_id, lat, lng, revision, name}
// and payload.wiki_position = {lat, lng}. The map line+markers are drawn by
// focusWikiSyncCoordinateDriftCase on the <details> toggle (review-wiki-sync-resolve.js).
function appendCoordinateDriftCaseBody(bodyElement, caseEntry) {
	const payload = caseEntry.payload || {};
	const mapPlace = payload.map || {};
	const wikiPosition = payload.wiki_position || {};

	appendWikiSyncInfoRow(bodyElement, "Avesmaps", mapPlace.name || "Unbenannter Ort");

	const mapLatLng = readWikiSyncDriftLatLng(mapPlace);
	const wikiLatLng = readWikiSyncDriftLatLng(wikiPosition);
	appendWikiSyncInfoRow(bodyElement, "Karte", mapLatLng ? formatLocationReportCoordinates(mapLatLng) : "-");
	appendWikiSyncInfoRow(bodyElement, "Wiki-Position", wikiLatLng ? formatLocationReportCoordinates(wikiLatLng) : "-");

	const drift = wikiSyncDriftDistance(mapLatLng, wikiLatLng);
	if (drift !== null) {
		appendWikiSyncInfoRow(bodyElement, "Abstand", `${drift.toFixed(1)} Karteneinheiten`);
	}

	if (payload.wiki && (payload.wiki.title || payload.wiki.url)) {
		appendWikiSyncLinkRow(bodyElement, "Wiki", payload.wiki.title || "Wiki Aventurica", payload.wiki.url || "");
	}

	appendCoordinateDriftCaseActions(bodyElement, caseEntry);
}

// Two-position → euclidean distance in map units (both positions are already in
// 0..1024 map units; no CRS conversion). Returns null if either is missing.
function wikiSyncDriftDistance(mapLatLng, wikiLatLng) {
	if (!mapLatLng || !wikiLatLng) {
		return null;
	}
	const dLat = Number(mapLatLng.lat) - Number(wikiLatLng.lat);
	const dLng = Number(mapLatLng.lng) - Number(wikiLatLng.lng);
	return Math.sqrt(dLat * dLat + dLng * dLng);
}

// Parse {lat,lng} (map units) into an L.latLng WITHOUT swapping: the drift payload
// names its fields lat/lng and the vertical (y) is already the `lat` — same
// convention as payload.proposed_location (review-wiki-sync-resolve.js). Returns
// null on non-finite input. Shared by the body (distance/labels) and the map draw.
function readWikiSyncDriftLatLng(position) {
	if (!position) {
		return null;
	}
	const lat = Number(position.lat);
	const lng = Number(position.lng);
	if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
		return null;
	}
	return L.latLng(lat, lng);
}

// Actions for a drift case: "Anzeigen" (redraw line+markers), the two resolution
// buttons (gated exactly like canResolveWikiSyncCase -> only when open) and the
// shared defer/archive/reopen lifecycle buttons. The two resolution buttons are
// dispatched by handleWikiSyncCaseActionClick via their data-wiki-sync-action.
function appendCoordinateDriftCaseActions(bodyElement, caseEntry) {
	const actionsElement = document.createElement("div");
	actionsElement.className = "wiki-sync-case__actions";

	if (caseEntry.status === "archived" || caseEntry.status === "deferred") {
		actionsElement.appendChild(createWikiSyncActionButton("reopen", "Wieder öffnen", "wiki-sync-case__action--primary"));
	}

	actionsElement.appendChild(createWikiSyncActionButton("drift-focus", "Anzeigen", "wiki-sync-case__action--primary"));

	// Gate the two resolution buttons like canResolveWikiSyncCase (open-only). Also
	// require a valid wiki position + the map feature's public_id, else "Auf
	// Wiki-Position setzen" has nothing to write.
	const payload = caseEntry.payload || {};
	const hasWikiPosition = Boolean(readWikiSyncDriftLatLng(payload.wiki_position || null));
	const hasMapFeature = Boolean(payload.map && payload.map.public_id);
	if (caseEntry.status === "open" && hasWikiPosition && hasMapFeature) {
		actionsElement.appendChild(createWikiSyncActionButton("set-geometry-to-wiki", "Auf Wiki-Position setzen", "wiki-sync-case__action--primary"));
		actionsElement.appendChild(createWikiSyncActionButton("keep-map-position", "Karte behalten", "wiki-sync-case__action--danger"));
	}

	actionsElement.appendChild(createWikiSyncActionButton("defer", "Zurückstellen", "wiki-sync-case__action--danger"));
	actionsElement.appendChild(createWikiSyncActionButton("archive", "Archivieren", "wiki-sync-case__action--danger"));
	bodyElement.appendChild(actionsElement);
}

function createWikiSyncActionButton(action, label, className) {
	const buttonElement = document.createElement("button");
	buttonElement.type = "button";
	buttonElement.className = `wiki-sync-case__action ${className}`;
	buttonElement.dataset.wikiSyncAction = action;
	buttonElement.textContent = label;
	return buttonElement;
}

// Fallarten, bei denen "Anzeigen" nichts zu zeigen HAT -- kein Knopf ist ehrlicher als einer, der
// nur eine Warnmeldung auswirft. Bei allen dreien beschreibt der Fall etwas, das auf der Karte gar
// nicht existiert: die beiden missing_wiki_* sind Wiki-Orte OHNE Kartenobjekt (ohne Koordinaten
// gibt es nicht einmal eine vorgeschlagene Stelle, locations.php:543), missing_capital ist ein
// Territorium ohne verknuepften Hauptstadt-Ort. Owner 2026-07-21: "anzeigen ... geht nicht".
const WIKI_SYNC_CASE_TYPES_WITHOUT_FOCUS = new Set([
	"missing_wiki_with_coordinates",
	"missing_wiki_without_coordinates",
	"missing_capital",
]);

function appendWikiSyncInfoRow(bodyElement, label, value) {
	const rowElement = document.createElement("p");
	rowElement.className = "wiki-sync-case__row";
	const labelElement = document.createElement("span");
	labelElement.className = "wiki-sync-case__row-label";
	labelElement.textContent = label;
	const valueElement = document.createElement("span");
	valueElement.className = "wiki-sync-case__row-value";
	valueElement.textContent = value || "-";
	rowElement.append(labelElement, valueElement);
	bodyElement.appendChild(rowElement);
}

function appendWikiSyncLinkRow(bodyElement, label, text, url) {
	const rowElement = document.createElement("p");
	rowElement.className = "wiki-sync-case__row";
	const labelElement = document.createElement("span");
	labelElement.className = "wiki-sync-case__row-label";
	labelElement.textContent = label;
	const linkElement = document.createElement("a");
	linkElement.className = "wiki-sync-case__row-value";
	linkElement.href = url || "#";
	linkElement.target = "_blank";
	linkElement.rel = "noopener";
	linkElement.textContent = text || url || "-";
	rowElement.append(labelElement, linkElement);
	bodyElement.appendChild(rowElement);
}

function canResolveWikiSyncCase(caseEntry) {
	// missing_capital is resolved via the inline assign controls (a capital must be CHOSEN), not the generic
	// "Lösen" button; the other two have no machine resolution either.
	if (caseEntry.case_type === "unresolved_without_candidate" || caseEntry.case_type === "duplicate_avesmaps_name" || caseEntry.case_type === "missing_capital") {
		return false;
	}

	return caseEntry.status === "open";
}

function getWikiSyncCaseTitle(caseEntry) {
	const payload = caseEntry.payload || {};
	const mapName = payload.map?.name || "";
	const wikiTitle = payload.wiki?.title || "";

	if (caseEntry.case_type === "missing_capital") {
		return payload.capital_name ? `${payload.name || "Gebiet"} → ${payload.capital_name}` : (payload.name || "Fehlende Hauptstadt");
	}

	if (caseEntry.case_type === "missing_wiki_with_coordinates" || caseEntry.case_type === "missing_wiki_without_coordinates") {
		return wikiTitle || "Fehlender Wiki-Ort";
	}

	if (caseEntry.case_type === "duplicate_wiki_title") {
		return wikiTitle || "Mehrfachzuordnung";
	}

	if (caseEntry.case_type === "duplicate_avesmaps_name") {
		const duplicateCount = Array.isArray(payload.matches) ? payload.matches.length : 0;
		return `${payload.name || "Unbenannter Ort"} (${duplicateCount} Dubletten)`;
	}

	return mapName && wikiTitle ? `${mapName} ↔ ${wikiTitle}` : mapName || wikiTitle || "WikiSync-Fall";
}

function formatWikiSyncCaseStatus(status) {
	const labels = {
		open: "offen",
		resolved: "gelöst",
		deferred: "zurückgestellt",
		archived: "archiviert",
	};

	return labels[status] || status || "offen";
}

function formatWikiSyncMatchKind(matchKind) {
	const labels = {
		exact: "exakter Titel",
		redirect: "Wiki-Weiterleitung",
		normalized: "normalisierter Titel",
		search: "Wiki-Suche",
	};

	return labels[matchKind] || matchKind || "-";
}

function findWikiSyncCaseFromElement(element) {
	const caseElement = element?.closest?.(".wiki-sync-case");
	// String compare: wiki case ids are integers, missing_capital ids are UUID strings (territory_public_id).
	const caseId = String(caseElement?.dataset.caseId || "");
	return wikiSyncCases.find((caseEntry) => String(caseEntry.id) === caseId) || null;
}

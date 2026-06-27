// Missing-capital conflict cases ("Fehlende Hauptstädte") for the WikiSync Konfliktlösung list. These are
// territories whose wiki names a capital but whose capital_place_id is unset; they are merged into the case
// list as case_type "missing_capital" (source "political") and resolved by linking a capital location.
// This module provides:
//  - loadMissingCapitalCases(): fetch the computed cases (merged into wikiSyncCases by loadWikiSyncCases),
//  - renderCapitalAssignControls(): the per-case assign UI (server name suggestions + free location search),
//  - assignCapitalForTerritory(): the "resolve" action (assign_capital -> the case drops out of the compute),
//  - a delegated click/input handler on #wiki-sync-case-list that drives the assign UI inside the case bodies.

const CAPITAL_LIST_API_URL = "/api/app/political-territories.php";

function capitalListEscape(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

// Fetch the live-computed missing-capital cases (with their persisted deferred/archived status). Returns [] on
// any failure so a political-endpoint hiccup never breaks the wiki case list it gets merged into.
async function loadMissingCapitalCases() {
	try {
		const response = await fetch(`${CAPITAL_LIST_API_URL}?action=capital_cases&_=${Date.now()}`, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json();
		if (!response.ok || data?.ok !== true || !Array.isArray(data.cases)) {
			return [];
		}
		return data.cases;
	} catch (error) {
		return [];
	}
}

// The per-case assign UI: server name suggestions (1-click) + a free location search. Uses the .capital-list__*
// classes so the delegated handler below (on #wiki-sync-case-list) drives both. Returns an HTML string.
function renderCapitalAssignControls(territoryPublicId, capitalName, suggestions) {
	const territory = capitalListEscape(territoryPublicId);
	const list = Array.isArray(suggestions) ? suggestions : [];
	const suggestionButtons = list.map((suggestion) =>
		`<button type="button" class="capital-list__suggest" data-territory="${territory}" data-place="${capitalListEscape(suggestion.public_id)}" title="Als Hauptstadt zuweisen">${capitalListEscape(suggestion.name)}</button>`
	).join("");
	const ambiguous = list.length > 1
		? '<span class="capital-list__ambiguous" title="Mehrere gleichnamige Orte – bitte den richtigen wählen">mehrdeutig</span>'
		: "";
	return (
		(suggestionButtons
			? `<div class="capital-list__suggests">${suggestionButtons}${ambiguous}</div>`
			: '<span class="capital-list__nohint">kein Namenstreffer – Ort suchen:</span>')
		+ `<div class="capital-list__search">`
			+ `<input type="search" class="capital-list__search-input" placeholder="Ort suchen ..." data-territory="${territory}" aria-label="Ort suchen" autocomplete="off" />`
			+ `<div class="capital-list__search-results" hidden></div>`
		+ `</div>`
	);
}

// Free location search over the in-memory locationMarkers (no real crossings). Prefix hits first.
function capitalSearchLocations(query) {
	const needle = String(query || "").trim().toLowerCase();
	if (needle.length < 2 || typeof locationMarkers === "undefined" || !Array.isArray(locationMarkers)) {
		return [];
	}
	const matches = [];
	for (const entry of locationMarkers) {
		if (typeof isCrossingLocation === "function" && isCrossingLocation(entry.location)) {
			continue;
		}
		const name = String(entry.name || "");
		if (!entry.publicId || !name) {
			continue;
		}
		const lower = name.toLowerCase();
		const index = lower.indexOf(needle);
		if (index >= 0) {
			matches.push({ public_id: entry.publicId, name, rank: index === 0 ? 0 : 1, length: name.length });
		}
	}
	matches.sort((a, b) => a.rank - b.rank || a.length - b.length || a.name.localeCompare(b.name));
	return matches.slice(0, 12);
}

// "Resolve" a missing-capital case: link the chosen location as the territory's capital (assign_capital). The
// territory then has a capital_place_id and drops out of the computed case list -> reload to reflect that.
async function assignCapitalForTerritory(territoryPublicId, placePublicId) {
	if (!territoryPublicId || !placePublicId) {
		return;
	}
	try {
		await submitPoliticalTerritoryEdit({
			action: "assign_capital",
			territory_public_id: territoryPublicId,
			place_public_id: placePublicId,
		});
	} catch (error) {
		window.alert("Zuweisung fehlgeschlagen: " + (error?.message || "unbekannter Fehler"));
		return;
	}
	if (typeof showFeedbackToast === "function") {
		showFeedbackToast("Hauptstadt zugewiesen.", "success");
	}
	if (typeof loadWikiSyncCases === "function") {
		await loadWikiSyncCases();
	}
}

// Delegated assign UI on the WikiSync case list. The missing_capital case bodies render the .capital-list__*
// controls; the list element itself persists across re-renders (innerHTML reset keeps it), so one delegation
// is enough. Click = assign (suggestion or search hit); input = run the free search.
(function wireCapitalCaseAssignControls() {
	const list = document.getElementById("wiki-sync-case-list");
	if (!list) {
		return;
	}
	list.addEventListener("click", (event) => {
		const suggest = event.target.closest(".capital-list__suggest");
		if (suggest) {
			void assignCapitalForTerritory(suggest.dataset.territory, suggest.dataset.place);
			return;
		}
		const result = event.target.closest(".capital-list__search-result");
		if (result) {
			void assignCapitalForTerritory(result.dataset.territory, result.dataset.place);
		}
	});
	list.addEventListener("input", (event) => {
		const input = event.target.closest(".capital-list__search-input");
		if (!input) {
			return;
		}
		const resultsHost = input.parentElement?.querySelector(".capital-list__search-results");
		if (!resultsHost) {
			return;
		}
		const matches = capitalSearchLocations(input.value);
		if (matches.length === 0) {
			resultsHost.hidden = true;
			resultsHost.innerHTML = "";
			return;
		}
		const territory = capitalListEscape(input.dataset.territory);
		resultsHost.hidden = false;
		resultsHost.innerHTML = matches.map((match) =>
			`<button type="button" class="capital-list__search-result" data-territory="${territory}" data-place="${capitalListEscape(match.public_id)}">${capitalListEscape(match.name)}</button>`
		).join("");
	});
})();

window.loadMissingCapitalCases = loadMissingCapitalCases;
window.renderCapitalAssignControls = renderCapitalAssignControls;

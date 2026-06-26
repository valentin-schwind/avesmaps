// WikiSync „Hauptstädte": Review-Liste der Herrschaftsgebiete mit Hauptstadt-NAME (aus Wiki) aber ohne
// verlinkte Hauptstadt-Location (capital_place_id IS NULL). Pro Zeile:
//  - Server-Vorschläge (action=capital_assignments) als 1-Klick-Zuweisen; mehrdeutige Namen (z. B. zwei
//    „Nordhag") liefern mehrere Buttons -> der Nutzer wählt, nichts wird blind gesetzt.
//  - eine freie Orts-Suche über die schon geladenen locationMarkers (Netz für Prosa/abweichende Namen).
// Zuweisen schreibt via assign_capital; danach verschwindet die Zeile (Gebiet hat nun einen Link).
// Kontinent-Filter clientseitig (Default Aventurien) wie die anderen WikiSync-Listen.

const CAPITAL_LIST_API_URL = "/api/app/political-territories.php";
let capitalListItems = [];
const capitalContinentFilter = new Set(["Aventurien"]);

function capitalListEscape(value) {
	const holder = document.createElement("div");
	holder.textContent = String(value === null || value === undefined ? "" : value);
	return holder.innerHTML;
}

// Kontinent eines Eintrags; leer -> Aventurien (wie die Siedlungs-/Regionen-Listen).
function capitalItemContinent(item) {
	return String(item.continent || "").trim() || "Aventurien";
}
function capitalContinentMatch(item) {
	return capitalContinentFilter.size === 0 || capitalContinentFilter.has(capitalItemContinent(item));
}
function capitalContinentOptions() {
	const byContinent = new Map();
	for (const item of capitalListItems) {
		const continent = capitalItemContinent(item);
		if (!byContinent.has(continent)) {
			byContinent.set(continent, { value: continent, label: continent, count: 0 });
		}
		byContinent.get(continent).count += 1;
	}
	return [...byContinent.values()].sort((a, b) =>
		/aventurien/i.test(a.value) ? -1 : /aventurien/i.test(b.value) ? 1 : a.label.localeCompare(b.label));
}

async function loadCapitalAssignmentsList() {
	const list = document.getElementById("capital-sync-list");
	const summary = document.getElementById("capital-sync-summary");
	if (!list) {
		return;
	}
	list.innerHTML = '<p class="region-sync__empty">Wird geladen ...</p>';
	try {
		// continent= (leer) -> alle Kontinente; gefiltert wird clientseitig (wie die anderen Listen).
		const response = await fetch(`${CAPITAL_LIST_API_URL}?action=capital_assignments&continent=&_=${Date.now()}`, {
			credentials: "same-origin",
			headers: { Accept: "application/json" },
		});
		const data = await response.json();
		if (!response.ok || data?.ok !== true) {
			throw new Error("Antwort fehlgeschlagen");
		}
		capitalListItems = Array.isArray(data.territories) ? data.territories : [];
	} catch (error) {
		list.innerHTML = '<p class="region-sync__empty">Konnte die Liste nicht laden.</p>';
		if (summary) {
			summary.textContent = "Fehler beim Laden";
		}
		return;
	}
	renderCapitalAssignmentsList();
}

function renderCapitalAssignmentsList() {
	const list = document.getElementById("capital-sync-list");
	const summary = document.getElementById("capital-sync-summary");
	if (!list) {
		return;
	}

	renderTypeFilter("capital-continent-filter-toggle", "capital-continent-filter-menu", capitalContinentOptions(), capitalContinentFilter, "Kontinent");

	const query = (document.getElementById("capital-sync-filter")?.value || "").trim().toLowerCase();
	let items = capitalListItems.filter(capitalContinentMatch);
	if (query) {
		items = items.filter((item) =>
			String(item.name || "").toLowerCase().includes(query)
			|| String(item.capital_name || "").toLowerCase().includes(query));
	}

	if (summary) {
		summary.textContent = `${items.length} ohne verlinkte Hauptstadt`;
	}

	if (items.length === 0) {
		list.innerHTML = '<p class="region-sync__empty">Keine Treffer.</p>';
		return;
	}

	list.innerHTML = items.map(renderCapitalRow).join("");
}

function renderCapitalRow(item) {
	const territory = capitalListEscape(item.territory_public_id);
	const suggestions = Array.isArray(item.suggestions) ? item.suggestions : [];
	const suggestionButtons = suggestions.map((suggestion) =>
		`<button type="button" class="capital-list__suggest" data-territory="${territory}" data-place="${capitalListEscape(suggestion.public_id)}" title="Als Hauptstadt zuweisen">${capitalListEscape(suggestion.name)}</button>`
	).join("");
	const ambiguous = suggestions.length > 1
		? '<span class="capital-list__ambiguous" title="Mehrere gleichnamige Orte – bitte den richtigen wählen">mehrdeutig</span>'
		: "";
	const metaParts = [];
	if (item.type) {
		metaParts.push(capitalListEscape(item.type));
	}
	metaParts.push(`Wiki-Hauptstadt: „${capitalListEscape(item.capital_name)}"`);

	return (
		`<div class="capital-list__item" data-territory="${territory}">`
			+ `<div class="capital-list__head">`
				+ `<span class="capital-list__name">${capitalListEscape(item.name)}</span>`
				+ `<span class="capital-list__meta">${metaParts.join(" · ")}</span>`
			+ `</div>`
			+ `<div class="capital-list__actions">`
				+ (suggestionButtons
					? `<div class="capital-list__suggests">${suggestionButtons}${ambiguous}</div>`
					: '<span class="capital-list__nohint">kein Namenstreffer – Ort suchen:</span>')
				+ `<div class="capital-list__search">`
					+ `<input type="search" class="capital-list__search-input" placeholder="Ort suchen ..." data-territory="${territory}" aria-label="Ort suchen" autocomplete="off" />`
					+ `<div class="capital-list__search-results" hidden></div>`
				+ `</div>`
			+ `</div>`
		+ `</div>`
	);
}

// Freie Orts-Suche über die in-memory locationMarkers (keine echten Kreuzungen). Prefix-Treffer zuerst.
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
	// Erfolg: Zeile sofort lokal entfernen (verschwindet), dann den Server-Stand frisch nachladen.
	capitalListItems = capitalListItems.filter((item) => item.territory_public_id !== territoryPublicId);
	renderCapitalAssignmentsList();
	void loadCapitalAssignmentsList();
}

// ===== Verdrahtung (einmalig; das Listen-Container-Element existiert ab Seitenaufbau, Delegation greift) =====
(function wireCapitalAssignmentsList() {
	const list = document.getElementById("capital-sync-list");
	if (list) {
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
	}

	const filterInput = document.getElementById("capital-sync-filter");
	if (filterInput) {
		filterInput.addEventListener("input", () => renderCapitalAssignmentsList());
	}
	if (typeof attachTypeFilter === "function") {
		attachTypeFilter("capital-continent-filter-toggle", "capital-continent-filter-menu", capitalContinentFilter, capitalContinentOptions, renderCapitalAssignmentsList, "Kontinent");
	}
})();

window.loadCapitalAssignmentsList = loadCapitalAssignmentsList;

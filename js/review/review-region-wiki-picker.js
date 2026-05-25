async function loadPoliticalTerritoryWikiReferences() {
	if (politicalTerritoryWikiReferences.length > 0) {
		return politicalTerritoryWikiReferences;
	}

	const response = await fetchPoliticalTerritories({
		action: "wiki_list",
		continent: "Aventurien",
	});
	politicalTerritoryWikiReferences = Array.isArray(response.wiki)
		 response.wiki.map((entry) => ({
			...entry,
			type: normalizeParentheticalSpacing(entry.type || ""),
		}))
		: [];
	return politicalTerritoryWikiReferences;
}

async function loadPoliticalTerritoryWikiReferenceFallback() {
	const response = await fetch("api/wiki-sync.php?action=territories_tree", {
		credentials: "same-origin",
		headers: {
			Accept: "application/json",
		},
	});
	if (!response.ok) {
		throw new Error(`Statische Wiki-Referenz antwortet mit HTTP ${response.status}.`);
	}

	const data = await response.json().catch(() => []);
	return Array.isArray(data)  data.map((entry, index) => normalizeStaticWikiReferenceRecord(entry, index)) : [];
}

function normalizeStaticWikiReferenceRecord(record, index) {
	return {
		id: index + 1,
		wiki_key: getStaticWikiReferenceValue(record, ["Wiki-Link", "Wiki Link", "wiki_url", "Name", "name"]),
		name: getStaticWikiReferenceValue(record, ["Name", "name"]),
		type: normalizeParentheticalSpacing(getStaticWikiReferenceValue(record, ["Typ", "type"])),
		continent: getStaticWikiReferenceValue(record, ["Kontinent", "continent"]),
		affiliation_raw: getStaticWikiReferenceValue(record, ["Zugehörigkeit", "Zugehoerigkeit", "affiliation_raw"]),
		affiliation_root: getStaticWikiReferenceValue(record, ["Zugehörigkeit-Root", "Zugehoerigkeit-Root", "affiliation_root"]),
		affiliation_path: getStaticWikiReferenceValue(record, ["Zugehörigkeit-Pfad", "Zugehoerigkeit-Pfad", "affiliation_path"]),
		status: getStaticWikiReferenceValue(record, ["Status", "status"]),
		capital_name: getStaticWikiReferenceValue(record, ["Hauptstadt", "capital_name"]),
		seat_name: getStaticWikiReferenceValue(record, ["Herrschaftssitz", "seat_name"]),
		ruler: getStaticWikiReferenceValue(record, ["Oberhaupt", "ruler"]),
		founded_text: getStaticWikiReferenceValue(record, ["Gründungsdatum-Text", "Gründungsdatum", "founded_text"]),
		dissolved_text: getStaticWikiReferenceValue(record, ["Aufgelöst-Text", "Aufgelöst", "dissolved_text"]),
		wiki_url: getStaticWikiReferenceValue(record, ["Wiki-Link", "wiki_url"]),
		coat_of_arms_url: getStaticWikiReferenceValue(record, ["Wappen", "Wappen-Link", "coat_of_arms_url"]),
	};
}

function getStaticWikiReferenceValue(record, keys) {
	for (const key of keys) {
		if (Object.prototype.hasOwnProperty.call(record, key)) {
			return String(record[key] || "").trim();
		}
	}

	return "";
}

async function openRegionWikiPickerDialog() {
	if (!regionEditEntry) {
		return;
	}

	document.getElementById("region-wiki-picker-status").textContent = "Wiki-Referenzen werden geladen...";
	document.getElementById("region-wiki-picker-filter").value = "";
	setRegionWikiPickerDialogOpen(true);
	try {
		await loadPoliticalTerritoryWikiReferences();
		renderRegionWikiPickerList("");
		document.getElementById("region-wiki-picker-status").textContent = "";
	} catch (error) {
		console.error("Wiki-Referenzen konnten nicht geladen werden:", error);
		document.getElementById("region-wiki-picker-status").textContent = error.message || "Wiki-Referenzen konnten nicht geladen werden.";
	}
}

function renderRegionWikiPickerList(filterValue) {
	const listElement = document.getElementById("region-wiki-picker-list");
	if (!listElement) {
		return;
	}

	const query = normalizeSearchText(filterValue);
	const matches = politicalTerritoryWikiReferences
		.filter((entry) => query === "" || getWikiReferenceSearchText(entry).includes(query))
		.slice(0, 250);
	listElement.innerHTML = "";
	matches.forEach((entry) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "political-territory-wiki-picker-list__item";
		button.dataset.wikiReferenceId = String(entry.id || "");
		button.innerHTML = `
			<span class="political-territory-wiki-picker-list__name"></span>
			<span class="political-territory-wiki-picker-list__meta"></span>
		`;
		button.querySelector(".political-territory-wiki-picker-list__name").textContent = normalizeParentheticalSpacing(entry.name || "");
		button.querySelector(".political-territory-wiki-picker-list__meta").textContent = normalizeParentheticalSpacing([
			entry.type,
			entry.affiliation_root,
			entry.continent,
			buildWikiReferencePeriod({
				wiki_founded_text: entry.founded_text,
				wiki_dissolved_text: entry.dissolved_text,
			}),
		].filter(Boolean).join(" · "));
		listElement.append(button);
	});

	if (matches.length === 0) {
		const emptyElement = document.createElement("p");
		emptyElement.className = "political-territory-wiki-picker-list__empty";
		emptyElement.textContent = "Keine Treffer";
		listElement.append(emptyElement);
	}
}

function getWikiReferenceSearchText(entry) {
	return normalizeSearchText([
		entry.name,
		entry.type,
		entry.affiliation_raw,
		entry.affiliation_root,
		entry.status,
		entry.capital_name,
		entry.seat_name,
		entry.ruler,
	].filter(Boolean).join(" "));
}

function applyRegionWikiReferenceSelection(wikiReferenceId) {
	const wikiReference = politicalTerritoryWikiReferences.find((entry) => String(entry.id) === String(wikiReferenceId));
	if (!wikiReference) {
		return;
	}

	document.getElementById("region-edit-wiki-id").value = String(wikiReference.id || "");
	document.getElementById("region-edit-wiki-url").value = wikiReference.wiki_url || "";
	if (wikiReference.coat_of_arms_url) {
		document.getElementById("region-edit-coat-url").value = wikiReference.coat_of_arms_url;
	}
	if (wikiReference.type) {
		const typeSelect = document.getElementById("region-edit-type");
		const normalizedType = normalizeParentheticalSpacing(wikiReference.type);
		if (typeSelect && !Array.from(typeSelect.options).some((option) => option.value === normalizedType)) {
			typeSelect.append(new Option(normalizedType, normalizedType));
		}
		if (typeSelect) {
			typeSelect.value = normalizedType;
		}
	}

	const region = regionEditEntry.region || regionEditEntry || {};
	region.wikiId = wikiReference.id || null;
	region.wikiName = wikiReference.name || "";
	region.wikiType = wikiReference.type || "";
	region.wikiAffiliationRaw = wikiReference.affiliation_raw || "";
	region.wikiAffiliationRoot = wikiReference.affiliation_root || "";
	region.wikiFoundedText = wikiReference.founded_text || "";
	region.wikiDissolvedText = wikiReference.dissolved_text || "";
	region.wikiCapitalName = wikiReference.capital_name || "";
	region.wikiSeatName = wikiReference.seat_name || "";
	region.wikiUrl = wikiReference.wiki_url || "";
	region.coatOfArmsUrl = wikiReference.coat_of_arms_url || region.coatOfArmsUrl || "";
	renderRegionWikiReference(region);
	syncRegionCoatPreview();
	setRegionWikiPickerDialogOpen(false);
}

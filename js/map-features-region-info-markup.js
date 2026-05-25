/*
 * Extracted region info and tooltip markup helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

function createRegionCompactTooltipMarkup(regionEntry) {
	if (hasRegionWikiInfo(regionEntry)) {
		return createRegionWikiInfoBoxMarkup(regionEntry);
	}

	return createRegionMiniTooltipMarkup(regionEntry);
}

function createRegionMiniTooltipMarkup(regionEntry) {
	const coatMarkup = regionEntry.coatOfArmsUrl
		? `<img class="region-compact-tooltip__coat" src="${escapeHtml(regionEntry.coatOfArmsUrl)}" alt="">`
		: "";
	const meta = [normalizeRegionParentheticalSpacing(regionEntry.type), regionEntry.validLabel].filter(Boolean).join(" | ");
	const affiliation = regionEntry.affiliationRoot || regionEntry.affiliation || "";
	const capitalMarkup = createRegionPlaceTooltipLine("Hauptstadt", regionEntry.capitalName, regionEntry.capitalPlacePublicId);
	const seatMarkup = createRegionPlaceTooltipLine("Herrschaftssitz", regionEntry.seatName, regionEntry.seatPlacePublicId);
	const hasCoatClass = regionEntry.coatOfArmsUrl ? " has-coat" : "";

	return `
		<span class="region-compact-tooltip__content${hasCoatClass}">
			${coatMarkup}
			<span class="region-compact-tooltip__body">
				<span class="region-compact-tooltip__name">${escapeHtml(normalizeRegionParentheticalSpacing(regionEntry.displayName || regionEntry.name))}</span>
				<span class="region-compact-tooltip__meta">${escapeHtml(meta || "Herrschaftsgebiet")}</span>
				<span class="region-compact-tooltip__meta">${escapeHtml(affiliation)}</span>
				${capitalMarkup}
				${seatMarkup}
			</span>
		</span>
	`;
}

function hasRegionWikiInfo(regionEntry) {
	return Boolean(
		regionEntry.wikiId
		|| regionEntry.wikiUrl
		|| regionEntry.wikiName
		|| regionEntry.wikiFoundedText
		|| regionEntry.wikiDissolvedText
		|| regionEntry.foundedText
		|| regionEntry.dissolvedText
	);
}

function createRegionWikiInfoBoxMarkup(regionEntry) {
	const name = normalizeRegionParentheticalSpacing(regionEntry.displayName || regionEntry.name || "Herrschaftsgebiet");
	const wikiName = normalizeRegionParentheticalSpacing(regionEntry.wikiName || name);
	const type = normalizeRegionParentheticalSpacing(regionEntry.wikiType || regionEntry.type || "Herrschaftsgebiet");
	const coatMarkup = regionEntry.coatOfArmsUrl
		? `<img class="region-info-box__coat" src="${escapeHtml(regionEntry.coatOfArmsUrl)}" alt="">`
		: "";
	const hasCoatClass = coatMarkup ? " has-coat" : "";
	const wikiLink = createRegionInfoLink(regionEntry.wikiUrl);
	const affiliationPath = createRegionInfoPathValue(regionEntry);
	const wikiRows = [
		createRegionInfoTextRow("Wiki-Eintrag", wikiName),
		createRegionInfoTextRow("Typ", type),
		createRegionInfoTextRow("Status", regionEntry.status),
		createRegionInfoTextRow("Gründung", regionEntry.wikiFoundedText || regionEntry.foundedText),
		createRegionInfoTextRow("Auflösung", regionEntry.wikiDissolvedText || regionEntry.dissolvedText),
		createRegionInfoTextRow("Obergebiet", regionEntry.parentName || regionEntry.affiliationRoot || regionEntry.wikiAffiliationRoot),
		createRegionInfoBoxRow("Hauptstadt", createRegionInfoPlaceValue(regionEntry.wikiCapitalName || regionEntry.capitalName, regionEntry.capitalPlacePublicId)),
		createRegionInfoBoxRow("Herrschaftssitz", createRegionInfoPlaceValue(regionEntry.wikiSeatName || regionEntry.seatName, regionEntry.seatPlacePublicId)),
		createRegionInfoBoxRow("Wiki", wikiLink)
	].join("");
	const detailRows = [
		createRegionInfoTextRow("Kartenname", name),
		createRegionInfoTextRow("Kartenzeitraum", regionEntry.validLabel),
		createRegionInfoTextRow("Zuordnung", affiliationPath)
	].join("");
	const detailsMarkup = detailRows
		? `<details class="region-info-box__details"><summary>Details</summary><dl>${detailRows}</dl></details>`
		: "";

	return `
		<div class="region-info-box">
			<div class="region-info-box__header${hasCoatClass}">
				${coatMarkup}
				<div class="region-info-box__title-group">
					<strong class="region-info-box__title">${escapeHtml(name)}</strong>
					<span class="region-info-box__subtitle">Wiki-Daten</span>
				</div>
			</div>
			<dl class="region-info-box__data">${wikiRows}</dl>
			${detailsMarkup}
		</div>
	`;
}

function createRegionInfoTextRow(label, value) {
	const normalizedValue = normalizeRegionParentheticalSpacing(value).trim();
	if (normalizedValue === "") {
		return "";
	}

	return createRegionInfoBoxRow(label, escapeHtml(normalizedValue));
}

function createRegionInfoBoxRow(label, valueMarkup) {
	if (!valueMarkup) {
		return "";
	}

	return `
		<div class="region-info-box__row">
			<dt>${escapeHtml(label)}</dt>
			<dd>${valueMarkup}</dd>
		</div>
	`;
}

function createRegionInfoPlaceValue(placeName, placePublicId) {
	const normalizedName = normalizeRegionParentheticalSpacing(placeName).trim();
	if (normalizedName === "") {
		return "";
	}

	if (placePublicId) {
		return `<button type="button" class="region-compact-tooltip__place-link" data-region-place-public-id="${escapeHtml(placePublicId)}">${escapeHtml(normalizedName)}</button>`;
	}

	return escapeHtml(normalizedName);
}

function createRegionInfoLink(url) {
	const normalizedUrl = normalizeRegionInfoUrl(url);
	if (normalizedUrl === "") {
		return "";
	}

	return `<a class="region-info-box__link" href="${escapeHtml(normalizedUrl)}" target="_blank" rel="noopener noreferrer">Wiki öffnen</a>`;
}

function createRegionInfoPathValue(regionEntry) {
	const pathItems = normalizeRegionStringList(regionEntry.affiliationPath);
	if (pathItems.length > 0) {
		return pathItems.join(" > ");
	}

	return normalizeRegionParentheticalSpacing(regionEntry.wikiAffiliationRaw || regionEntry.affiliation || "").trim();
}

function normalizeRegionInfoUrl(value) {
	const url = String(value || "").trim();
	return /^https?:\/\//iu.test(url) ? url : "";
}

function normalizeRegionStringList(value) {
	if (Array.isArray(value)) {
		return value.map((entry) => normalizeRegionParentheticalSpacing(entry).trim()).filter(Boolean);
	}

	const rawValue = String(value || "").trim();
	if (rawValue === "") {
		return [];
	}

	if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
		try {
			const parsedValue = JSON.parse(rawValue);
			return Array.isArray(parsedValue)
				? parsedValue.map((entry) => normalizeRegionParentheticalSpacing(entry).trim()).filter(Boolean)
				: [];
		} catch {
			return [];
		}
	}

	return [normalizeRegionParentheticalSpacing(rawValue).trim()].filter(Boolean);
}

function createRegionPlaceTooltipLine(label, placeName, placePublicId) {
	const normalizedName = String(placeName || "").trim();
	if (normalizedName === "") {
		return "";
	}

	const valueMarkup = placePublicId
		? `<button type="button" class="region-compact-tooltip__place-link" data-region-place-public-id="${escapeHtml(placePublicId)}">${escapeHtml(normalizedName)}</button>`
		: `<span>${escapeHtml(normalizedName)}</span>`;
	return `<span class="region-compact-tooltip__meta">${escapeHtml(label)}: ${valueMarkup}</span>`;
}

function normalizeRegionParentheticalSpacing(value) {
	return String(value || "").replace(/([^\s])\(/gu, "$1 (");
}

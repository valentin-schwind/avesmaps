/*
 * Extracted region info and tooltip markup helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

// Leitet externe wiki-aventurica-Wappen über den serverseitigen Cache/Proxy (/api/app/coat.php),
// damit die Karte nicht hunderte SVGs direkt hotlinkt (net::ERR_NO_BUFFER_SPACE). Lokale /uploads/-
// URLs und bereits proxied URLs bleiben unverändert.
function avesmapsCoatSrc(url) {
	const value = String(url || "").trim();
	if (value === "") {
		return "";
	}
	if (/^https?:\/\/([a-z0-9-]+\.)?wiki-aventurica\.de\//iu.test(value)) {
		return "/api/app/coat.php?u=" + encodeURIComponent(value);
	}
	return value;
}

function createRegionCompactTooltipMarkup(regionEntry) {
	if (hasRegionWikiInfo(regionEntry)) {
		return createRegionWikiInfoBoxMarkup(regionEntry);
	}

	return createRegionMiniTooltipMarkup(regionEntry);
}

function createRegionMiniTooltipMarkup(regionEntry) {
	const coatMarkup = regionEntry.coatOfArmsUrl
		? `<img class="region-compact-tooltip__coat" src="${escapeHtml(avesmapsCoatSrc(regionEntry.coatOfArmsUrl))}" alt="" loading="lazy" decoding="async">`
		: "";
	const meta = [normalizeRegionParentheticalSpacing(regionEntry.type), regionEntry.validLabel].filter(Boolean).join(" | ");
	const affiliation = regionEntry.affiliationRoot || regionEntry.affiliation || "";
	const capitalMarkup = createRegionPlaceTooltipLine(tr("infobox.capital", "Hauptstadt"), regionEntry.capitalName, regionEntry.capitalPlacePublicId);
	const seatMarkup = createRegionPlaceTooltipLine(tr("infobox.seat", "Herrschaftssitz"), regionEntry.seatName, regionEntry.seatPlacePublicId);
	const hasCoatClass = regionEntry.coatOfArmsUrl ? " has-coat" : "";
	const contestedClaimants = collectRegionContestedClaimants(regionEntry);
	const contestedMarkup = contestedClaimants.length
		? `<span class="region-compact-tooltip__meta">${escapeHtml(tr("infobox.contestedWith", "Umstritten mit"))}: ${createRegionContestedSwatchMarkup(contestedClaimants)}</span>`
		: "";

	return `
		<span class="region-compact-tooltip__content${hasCoatClass}">
			${coatMarkup}
			<span class="region-compact-tooltip__body">
				<span class="region-compact-tooltip__name">${escapeHtml(normalizeRegionParentheticalSpacing(regionEntry.displayName || regionEntry.name))}</span>
				<span class="region-compact-tooltip__meta">${escapeHtml(meta || tr("infobox.territoryFallback", "Herrschaftsgebiet"))}</span>
				<span class="region-compact-tooltip__meta">${escapeHtml(affiliation)}</span>
				${capitalMarkup}
				${seatMarkup}
				${contestedMarkup}
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
	// #5: reichhaltige, read-only Wiki-Zusatzfelder kommen aus dem Detail-Endpoint (regionEntry.detail),
	// async nachgeladen. Vor dem Laden zeigt die Box die Map-Features-Basisdaten; danach das Volle.
	const detail = regionEntry.detail && regionEntry.detail.ok ? regionEntry.detail : null;
	const f = (detail && detail.fields) || {};
	const name = normalizeRegionParentheticalSpacing(regionEntry.displayName || regionEntry.name || tr("infobox.territoryFallback", "Herrschaftsgebiet"));
	const wikiName = normalizeRegionParentheticalSpacing(regionEntry.wikiName || f.name || name);
	const type = normalizeRegionParentheticalSpacing(regionEntry.wikiType || f.type || regionEntry.type || tr("infobox.territoryFallback", "Herrschaftsgebiet"));
	// #2/#5 Wappen lizenz-gegatet: sobald die Detaildaten da sind, gilt detail.coat.url (leer ohne Lizenz).
	const coatUrl = detail ? String((detail.coat && detail.coat.url) || "") : (regionEntry.coatOfArmsUrl || "");
	const coatMarkup = coatUrl
		? `<img class="region-info-box__coat" src="${escapeHtml(avesmapsCoatSrc(coatUrl))}" alt="" loading="lazy" decoding="async">`
		: "";
	const hasCoatClass = coatMarkup ? " has-coat" : "";
	const wikiUrl = regionEntry.wikiUrl || f.wiki_url;
	// "Link teilen" nur bei vorhandenem Wiki-Artikel (kein ?place=-Fallback: focusRegionPlace loest nur
	// Orts-public_ids auf, nicht das public_id des Gebiets/der Region selbst -- siehe
	// js/map-features/map-features-region-tooltip-lifecycle.js focusRegionPlace). wikiParam-Diskriminator:
	// regionEntry.source === "political_territory" fuer politische Territorien, sonst "map_feature" fuer
	// Landschafts-Regionen (gesetzt in js/map-features/map-features-region-feature-normalization.js:22)
	// -> "staat" bzw. "region" (js/app/wiki-deeplink.js). Gleiches Markup/Klick-Handling wie Orts-Popups
	// (Task 13, sharePlaceActionButtonMarkup in js/ui/popups.js).
	const regionWikiParam = regionEntry.source === "political_territory" ? "staat" : "region";
	const shareButton = wikiUrl
		? sharePlaceActionButtonMarkup(regionEntry.publicId, { wikiUrl, wikiParam: regionWikiParam })
		: "";
	const shareMarkup = shareButton ? locationPopupActionsMarkup([shareButton]) : "";
	const wikiRows = [
		createRegionInfoTextRow(tr("infobox.wikiEntry", "Wiki-Eintrag"), wikiName),
		createRegionInfoTextRow(tr("infobox.type", "Typ"), type),
		createRegionInfoTextRow(tr("infobox.status", "Status"), regionEntry.status || f.status),
		createRegionContestedRow(regionEntry),
		createRegionInfoTextRow(tr("infobox.governmentForm", "Herrschaftsform"), f.form_of_government),
		createRegionInfoTextRow(tr("infobox.ruler", "Oberhaupt"), f.ruler),
		createRegionInfoTextRow(tr("infobox.founded", "Gründung"), (detail && f.founded_text) || regionEntry.wikiFoundedText || regionEntry.foundedText),
		createRegionInfoTextRow(tr("infobox.dissolved", "Auflösung"), (detail && f.dissolved_text) || regionEntry.wikiDissolvedText || regionEntry.dissolvedText),
		createRegionInfoTextRow(tr("infobox.founder", "Gründer"), f.founder),
		createRegionInfoTextRow(tr("infobox.parentTerritory", "Obergebiet"), regionEntry.parentName || regionEntry.affiliationRoot || regionEntry.wikiAffiliationRoot),
		createRegionInfoBoxRow(tr("infobox.capital", "Hauptstadt"), createRegionInfoPlaceValue(regionEntry.wikiCapitalName || regionEntry.capitalName || f.capital_name, regionEntry.capitalPlacePublicId)),
		createRegionInfoBoxRow(tr("infobox.seat", "Herrschaftssitz"), createRegionInfoPlaceValue(regionEntry.wikiSeatName || regionEntry.seatName || f.seat_name, regionEntry.seatPlacePublicId)),
		createRegionInfoTextRow(tr("infobox.language", "Sprache"), f.language),
		createRegionInfoTextRow(tr("infobox.currency", "Währung"), f.currency),
		createRegionInfoTextRow(tr("infobox.population", "Einwohnerzahl"), f.population),
		createRegionInfoTextRow(tr("infobox.tradeGoods", "Handelswaren"), f.trade_goods),
		createRegionInfoTextRow(tr("infobox.tradeZone", "Handelszone"), f.trade_zone),
		createRegionInfoTextRow(tr("infobox.geographic", "Geographisch"), f.geographic),
		createRegionInfoTextRow(tr("infobox.mapPeriod", "Kartenzeitraum"), regionEntry.validLabel)
	].join("");

	return `
		<div class="region-info-box">
			<div class="region-info-box__header${hasCoatClass}">
				${coatMarkup}
				<div class="region-info-box__title-group">
					<strong class="region-info-box__title">${escapeHtml(name)}</strong>
					<span class="region-info-box__subtitle">${escapeHtml(tr("infobox.wikiData", "Wiki-Daten"))}</span>
				</div>
			</div>
			<dl class="region-info-box__data">${wikiRows}</dl>
			${typeof renderFeatureSourceLine === "function" ? renderFeatureSourceLine("territory", regionEntry.territoryPublicId || "", wikiUrl || "", "region-info-box__link") : ""}
			${shareMarkup}
		</div>
	`;
}

// Sammelt die Anspruchsteller (ohne den Besitzer = parties[0]) eines Konfliktgebiets, dedupliziert nach
// Name. Quellen: regionEntry.contestedParties (direkt auf einer Konflikt-Baronie; Besitzer zuerst, dann
// Claims nach sort_order) UND regionEntry.contestedPieces (Territorium/Aggregat: aggregiert die
// Anspruchsteller ALLER umstrittenen Baronien darin). So zeigt auch die Infobox eines ganzen Gebiets, wer
// dessen Gebiete beansprucht -- nicht nur die einer einzelnen angeklickten Baronie.
function collectRegionContestedClaimants(regionEntry) {
	const out = [];
	const seen = new Set();
	const ownName = normalizeRegionParentheticalSpacing(String((regionEntry && (regionEntry.displayName || regionEntry.name)) || "")).trim().toLowerCase();
	if (ownName) {
		seen.add(ownName); // das Gebiet selbst (Besitzer) nie als Anspruchsteller listen
	}
	const addParties = (parties) => {
		if (!Array.isArray(parties) || parties.length < 2) {
			return;
		}
		parties.slice(1).forEach((p) => {
			const nm = normalizeRegionParentheticalSpacing(String((p && p.name) || "")).trim();
			if (!nm) {
				return;
			}
			const key = nm.toLowerCase();
			if (seen.has(key)) {
				return;
			}
			seen.add(key);
			const color = /^#[0-9a-fA-F]{6}$/.test(String((p && p.color) || "")) ? String(p.color) : "#888888";
			out.push({ name: nm, color });
		});
	};
	if (regionEntry && Array.isArray(regionEntry.contestedParties)) {
		addParties(regionEntry.contestedParties);
	}
	if (regionEntry && Array.isArray(regionEntry.contestedPieces)) {
		regionEntry.contestedPieces.forEach((piece) => addParties(piece && piece.contestedParties));
	}
	return out;
}

function createRegionContestedSwatchMarkup(claimants) {
	return claimants.map((c) =>
		`<span style="display:inline-flex;align-items:center;gap:4px"><span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${c.color}"></span>${escapeHtml(c.name)}</span>`
	).join(", ");
}

// "Umstritten mit ..." — Anspruchsteller mit kleinem Farb-Swatch (Wiki-Infobox-Zeile).
function createRegionContestedRow(regionEntry) {
	const claimants = collectRegionContestedClaimants(regionEntry);
	if (claimants.length === 0) {
		return "";
	}
	return createRegionInfoBoxRow(tr("infobox.contestedWith", "Umstritten mit"), createRegionContestedSwatchMarkup(claimants));
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

	return `<a class="region-info-box__link" href="${escapeHtml(normalizedUrl)}" target="_blank" rel="noopener noreferrer">${tr("infobox.openWiki", "Wiki öffnen")}</a>`;
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

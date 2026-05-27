/*
 * Extracted region feature normalization helpers from js/map-features.js.
 * This file contains only function declarations and no top-level execution.
 */

function normalizeRegionFeature(feature) {
	const properties = feature.properties || {};
	const fillColor = getRegionFeatureColor(properties);
	const opacity = getRegionFeatureOpacity(properties);
	return {
		publicId: properties.public_id || feature.id || properties.id || properties.svg_id || "",
		geometryId: Number.isFinite(Number(properties.geometry_id)) ? Number(properties.geometry_id) : null,
		geometryPublicId: properties.geometry_public_id || properties.public_id || feature.id || "",
		territoryPublicId: properties.territory_public_id || "",
		source: properties.source || (properties.feature_type === "political_territory" ? "political_territory" : "map_feature"),
		name: normalizeRegionParentheticalSpacing(getRegionFeatureName(properties)),
		displayName: normalizeRegionParentheticalSpacing(properties.display_name || properties.name || ""),
		shortName: properties.short_name || "",
		type: normalizeRegionParentheticalSpacing(properties.territory_type || properties.feature_subtype || ""),
		color: fillColor,
		opacity,
		wikiUrl: properties.wiki_url || "",
		wikiId: properties.wiki_id || null,
		wikiName: properties.wiki_name || "",
		wikiType: normalizeRegionParentheticalSpacing(properties.wiki_type || properties.territory_type || properties.feature_subtype || ""),
		status: properties.status || "",
		coatOfArmsUrl: properties.coat_of_arms_url || "",
		labelName: properties.label_name || "",
		labelDisplayName: properties.label_display_name || "",
		labelCoatOfArmsUrl: properties.label_coat_of_arms_url || "",
		capitalName: properties.capital_name || "",
		seatName: properties.seat_name || "",
		capitalPlacePublicId: properties.capital_place_public_id || "",
		seatPlacePublicId: properties.seat_place_public_id || "",
		validFromBf: Number.isFinite(Number(properties.valid_from_bf)) ? Number(properties.valid_from_bf) : null,
		validToBf: Number.isFinite(Number(properties.valid_to_bf)) ? Number(properties.valid_to_bf) : null,
		validLabel: properties.valid_label || "",
		affiliation: properties.affiliation || "",
		affiliationRoot: properties.affiliation_root || "",
		affiliationPath: normalizeRegionStringList(properties.affiliation_path || properties.affiliation_path_json || properties.wiki_affiliation_path || properties.wiki_affiliation_path_json),
		parentName: properties.parent_name || "",
		foundedText: properties.founded_text || "",
		dissolvedText: properties.dissolved_text || "",
		wikiAffiliationRaw: properties.wiki_affiliation_raw || properties.affiliation || "",
		wikiAffiliationRoot: properties.wiki_affiliation_root || properties.affiliation_root || "",
		wikiFoundedText: properties.wiki_founded_text || properties.founded_text || "",
		wikiDissolvedText: properties.wiki_dissolved_text || properties.dissolved_text || "",
		wikiCapitalName: properties.wiki_capital_name || properties.capital_name || "",
		wikiSeatName: properties.wiki_seat_name || properties.seat_name || "",
		parentPublicId: properties.parent_public_id || "",
		labelLng: Number.isFinite(Number(properties.label_lng)) ? Number(properties.label_lng) : null,
		labelLat: Number.isFinite(Number(properties.label_lat)) ? Number(properties.label_lat) : null,
		showRegionLabel: properties.show_region_label !== false,
		minZoom: readOptionalRegionZoom(properties.min_zoom),
		maxZoom: readOptionalRegionZoom(properties.max_zoom),
		isActive: properties.is_active !== false,
		editorNotes: properties.editor_notes || "",
		revision: Number(properties.revision) || null,
		feature,
		layer: null,
		layers: [],
		label: null,
		handles: [],
	};
}

function getRegionFeatureName(properties) {
	return String(
		properties.display_name
		|| properties.name
		|| properties["data-item-label"]
		|| properties.title
		|| properties.label
		|| properties.feature_subtype
		|| properties.layer
		|| "Region"
	).trim() || "Region";
}

function getRegionFeatureColor(properties) {
	const apiColor = normalizeRegionHexColor(
		properties.fill
		|| getStyleDeclarationValue(properties.style, "fill")
		|| properties.stroke
		|| getStyleDeclarationValue(properties.style, "stroke")
		|| "#888888"
	);
	if (apiColor !== "#888888") {
		return apiColor;
	}

	const territoryColor = getLoadedPoliticalTerritoryColor(properties);
	if (territoryColor !== "") {
		return territoryColor;
	}

	return getPoliticalTerritoryDeterministicColor(properties);
}

function getLoadedPoliticalTerritoryColor(properties) {
	if (typeof politicalTerritoryOptions === "undefined" || !Array.isArray(politicalTerritoryOptions)) {
		return "";
	}

	const territoryPublicId = String(
		properties.territory_public_id
		|| properties.label_territory_public_id
		|| properties.aggregate_source_territory_public_id
		|| ""
	).trim();
	if (!territoryPublicId) {
		return "";
	}

	const territory = findLoadedPoliticalTerritoryByPublicId(politicalTerritoryOptions, territoryPublicId);
	if (!territory) {
		return "";
	}

	const color = normalizeRegionHexColor(territory.color || territory.fill || "");
	return color === "#888888" && !/^#888888$/i.test(String(territory.color || territory.fill || "")) ? "" : color;
}

function findLoadedPoliticalTerritoryByPublicId(entries, territoryPublicId) {
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") {
			continue;
		}

		const entryPublicId = String(entry.public_id || entry.publicId || entry.territory_public_id || entry.territoryPublicId || "").trim();
		if (entryPublicId === territoryPublicId) {
			return entry;
		}

		for (const key of ["children", "items", "territories"]) {
			if (!Array.isArray(entry[key])) {
				continue;
			}
			const match = findLoadedPoliticalTerritoryByPublicId(entry[key], territoryPublicId);
			if (match) {
				return match;
			}
		}
	}

	return null;
}

function getPoliticalTerritoryDeterministicColor(properties) {
	if ((properties.source || properties.feature_type) !== "political_territory" && properties.feature_type !== "political_territory") {
		return "#888888";
	}

	const seed = String(
		properties.territory_public_id
		|| properties.label_territory_public_id
		|| properties.aggregate_source_territory_public_id
		|| properties.slug
		|| properties.wiki_name
		|| properties.name
		|| properties.display_name
		|| "Herrschaftsgebiet"
	);
	const hash = hashRegionColorSeed(seed);
	const hue = hash % 360;
	const saturation = 52 + (hash % 18);
	const value = 50 + ((hash >>> 8) % 20);
	return hsvRegionColorToHex(hue, saturation, value);
}

function hashRegionColorSeed(value) {
	const text = String(value || "");
	let hash = 2166136261;
	for (let index = 0; index < text.length; index += 1) {
		hash ^= text.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

function hsvRegionColorToHex(hue, saturationPercent, valuePercent) {
	const saturation = Math.max(0, Math.min(100, Number(saturationPercent))) / 100;
	const value = Math.max(0, Math.min(100, Number(valuePercent))) / 100;
	const chroma = value * saturation;
	const huePrime = (Math.max(0, Math.min(360, Number(hue))) % 360) / 60;
	const secondary = chroma * (1 - Math.abs((huePrime % 2) - 1));
	const match = value - chroma;
	const channels = huePrime < 1
		? [chroma, secondary, 0]
		: huePrime < 2
		? [secondary, chroma, 0]
		: huePrime < 3
		? [0, chroma, secondary]
		: huePrime < 4
		? [0, secondary, chroma]
		: huePrime < 5
		? [secondary, 0, chroma]
		: [chroma, 0, secondary];

	return `#${channels.map(channel => Math.round((channel + match) * 255).toString(16).padStart(2, "0")).join("")}`;
}

function getRegionFeatureOpacity(properties) {
	const rawOpacity = properties.fillOpacity
		?? properties.fill_opacity
		?? properties["fill-opacity"]
		?? getStyleDeclarationValue(properties.style, "fill-opacity")
		?? 0.33;
	const opacity = Number(rawOpacity);
	return Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 0.33;
}

function getStyleDeclarationValue(style, propertyName) {
	if (!style) return "";
	const declarations = String(style).split(";");
	const declaration = declarations.find((entry) => entry.trim().toLowerCase().startsWith(`${propertyName.toLowerCase()}:`));
	return declaration ? declaration.split(":").slice(1).join(":").trim() : "";
}

function normalizeRegionHexColor(value) {
	const color = String(value || "").trim();
	return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(color) ? color : "#888888";
}

function readOptionalRegionZoom(value) {
	if (value === "" || value === null || typeof value === "undefined") {
		return null;
	}

	const zoom = Number(value);
	return Number.isFinite(zoom) ? zoom : null;
}

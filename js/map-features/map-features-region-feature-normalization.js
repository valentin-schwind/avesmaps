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
	return normalizeRegionHexColor(
		properties.fill
		|| getStyleDeclarationValue(properties.style, "fill")
		|| properties.stroke
		|| getStyleDeclarationValue(properties.style, "stroke")
		|| "#888888"
	);
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

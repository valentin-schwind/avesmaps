"use strict";

function createPoliticalTerritoryEditorUrl(regionEntry = {}) {
	const params = new URLSearchParams();
	const geometryPublicId = String(regionEntry.geometryPublicId || regionEntry.geometry_public_id || regionEntry.publicId || "").trim();
	const territoryPublicId = String(regionEntry.territoryPublicId || regionEntry.territory_public_id || "").trim();
	const wikiKey = String(regionEntry.wikiKey || regionEntry.wiki_key || regionEntry.wikiId || regionEntry.wiki_id || "").trim();
	const name = String(regionEntry.displayName || regionEntry.name || "").trim();
	const color = String(regionEntry.color || "").trim();
	const opacity = Number(regionEntry.opacity);
	const minZoom = regionEntry.minZoom ?? regionEntry.min_zoom ?? "";
	const maxZoom = regionEntry.maxZoom ?? regionEntry.max_zoom ?? "";
	const validFromBf = regionEntry.validFromBf ?? regionEntry.valid_from_bf ?? "";
	const validToBf = regionEntry.validToBf ?? regionEntry.valid_to_bf ?? "";

	if (geometryPublicId) params.set("geometry_public_id", geometryPublicId);
	if (territoryPublicId) params.set("territory_public_id", territoryPublicId);
	if (wikiKey) params.set("wiki_key", wikiKey);
	if (name) params.set("name", name);
	if (color) params.set("color", color);
	if (Number.isFinite(opacity)) params.set("opacity", String(opacity));
	if (minZoom !== "" && minZoom !== null && typeof minZoom !== "undefined") params.set("min_zoom", String(minZoom));
	if (maxZoom !== "" && maxZoom !== null && typeof maxZoom !== "undefined") params.set("max_zoom", String(maxZoom));
	if (validFromBf !== "" && validFromBf !== null && typeof validFromBf !== "undefined") params.set("valid_from_bf", String(validFromBf));
	if (validToBf !== "" && validToBf !== null && typeof validToBf !== "undefined") params.set("valid_to_bf", String(validToBf));

	return `politics/political-tree.html${params.toString() ? `?${params.toString()}` : ""}`;
}

function openPoliticalTerritoryEditor(regionEntry = {}) {
	window.open(createPoliticalTerritoryEditorUrl(regionEntry), "avesmapsPoliticalTerritoryEditor", "noopener,noreferrer");
}

window.AvesmapsPoliticalTerritoryEditorLink = {
	createUrl: createPoliticalTerritoryEditorUrl,
	open: openPoliticalTerritoryEditor,
};

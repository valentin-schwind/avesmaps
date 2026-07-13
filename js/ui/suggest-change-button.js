// Pure, DOM-free builder for the infopanel "Änderung vorschlagen" (suggest change) action button.
// Returns the popupActionButtonMarkup() SPEC ({label, iconMarkup, attributes}); the caller wraps it with
// popupActionButtonMarkup() so the actual <button> markup + attribute escaping stays in ONE place (DRY).
// Node-testable: uses no browser globals. The translated label is injected by the caller via ctx.label.

// Settlement type slugs == report-form size slugs (metropole/grossstadt/stadt/kleinstadt/dorf/gebaeude).
// Map an unknown/absent settlement type to "dorf" so the (required) size field always has a valid value.
var SUGGEST_CHANGE_SIZE_SLUGS = ["metropole", "grossstadt", "stadt", "kleinstadt", "dorf", "gebaeude"];

function sizeSlugFromLocationType(locationType) {
	var slug = String(locationType == null ? "" : locationType).trim().toLowerCase();
	return SUGGEST_CHANGE_SIZE_SLUGS.indexOf(slug) !== -1 ? slug : "dorf";
}

// ctx: { entityType, entityId, name, reportType, size, lat, lng, label }
function buildSuggestChangeButtonSpec(ctx) {
	ctx = ctx || {};
	var name = String(ctx.name == null ? "" : ctx.name).trim();
	if (!ctx.entityType || name === "") {
		return null;
	}
	var lat = Number.parseFloat(String(ctx.lat));
	var lng = Number.parseFloat(String(ctx.lng));
	var attributes = {
		"data-popup-action": "suggest-change",
		"data-entity-type": ctx.entityType,
		"data-entity-id": ctx.entityId ? String(ctx.entityId) : undefined,
		"data-name": name,
		"data-report-type": ctx.reportType || "sonstiges",
		"data-size": ctx.entityType === "settlement" ? sizeSlugFromLocationType(ctx.size) : undefined,
		"data-lat": Number.isFinite(lat) ? String(lat) : undefined,
		"data-lng": Number.isFinite(lng) ? String(lng) : undefined,
	};
	return {
		label: ctx.label || "Änderung vorschlagen",
		iconMarkup: '<img class="location-popup__action-img" src="img/menu/brief.webp?v=1" alt="" width="20" height="20" />',
		attributes: attributes,
	};
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = { buildSuggestChangeButtonSpec: buildSuggestChangeButtonSpec, sizeSlugFromLocationType: sizeSlugFromLocationType };
}
if (typeof window !== "undefined") {
	window.buildSuggestChangeButtonSpec = buildSuggestChangeButtonSpec;
	window.sizeSlugFromLocationType = sizeSlugFromLocationType;
}

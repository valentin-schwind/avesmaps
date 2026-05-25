const ICON_ASSET_VERSION = "20260423-142011";

function escapeHtml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#039;");
}

function buildHtmlAttributes(attributes = {}) {
	return Object.entries(attributes)
		.filter(([, value]) => value !== undefined && value !== null && value !== "")
		.map(([name, value]) => ` ${escapeHtml(name)}="${escapeHtml(value)}"`)
		.join("");
}

function isWithinMapBounds(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	const [[minLat, minLng], [maxLat, maxLng]] = MAP_BOUNDS;
	return normalizedLatLng.lat >= minLat
		&& normalizedLatLng.lat <= maxLat
		&& normalizedLatLng.lng >= minLng
		&& normalizedLatLng.lng <= maxLng;
}

function escapeRegExp(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function calculateCoordinateDistance(firstCoordinates, secondCoordinates) {
	return Math.hypot(
		secondCoordinates[0] - firstCoordinates[0],
		secondCoordinates[1] - firstCoordinates[1]
	);
}

function calculateScaledDistance(firstCoordinates, secondCoordinates) {
	return calculateCoordinateDistance(firstCoordinates, secondCoordinates) * DISTANCE_SCALING_FACTOR;
}

function latLngToCoordinates(latlng) {
	const normalizedLatLng = L.latLng(latlng);
	return [normalizedLatLng.lat, normalizedLatLng.lng];
}

function formatDistanceMeasurement(distanceInMiles) {
	return `${distanceInMiles.toFixed(1)} Meilen`;
}

function withAssetVersion(sourcePath) {
	if (!sourcePath) {
		return sourcePath;
	}

	const separator = sourcePath.includes("?") ? "&" : "?";
	return `${sourcePath}${separator}v=${ICON_ASSET_VERSION}`;
}

function readFeatureWikiUrl(properties = {}) {
	if (!properties || typeof properties !== "object") {
		return "";
	}

	return String(properties.wiki_url || properties["data-report-wiki-url"] || "").trim();
}

function assetIconMarkup(sourcePath, className = "route-overview-icon") {
	const versionedSourcePath = escapeHtml(withAssetVersion(sourcePath));
	const safeClassName = escapeHtml(className);
	return `<img class="${safeClassName}" src="${versionedSourcePath}" alt="" />`;
}

function initializeVersionedAssetIcons() {
	document.querySelectorAll("[data-source-src]").forEach((iconElement) => {
		const sourcePath = iconElement.dataset.sourceSrc || iconElement.getAttribute("src");
		if (!sourcePath) {
			return;
		}

		iconElement.src = withAssetVersion(sourcePath);
	});
}

function setVersionedIconSource(iconElement, iconPath) {
	if (!iconElement || !iconPath) {
		return;
	}

	iconElement.dataset.sourceSrc = iconPath;
	iconElement.src = withAssetVersion(iconPath);
}

"use strict";

(function installDerivedGeometrySourceContext() {
	const originalFetch = window.fetch?.bind(window);
	if (!originalFetch || window.__avesmapsDerivedGeometrySourceContextInstalled === true) {
		return;
	}

	window.__avesmapsDerivedGeometrySourceContextInstalled = true;

	function readCurrentGeometryPublicId() {
		return new URLSearchParams(window.location.search).get("geometry_public_id") || "";
	}

	function appendGeometryPublicId(resource) {
		const geometryPublicId = readCurrentGeometryPublicId();
		if (!geometryPublicId || typeof resource !== "string") {
			return resource;
		}

		let url = null;
		try {
			url = new URL(resource, window.location.href);
		} catch (error) {
			return resource;
		}

		if (url.searchParams.get("action") !== "derived_geometry_sources") {
			return resource;
		}
		if (!url.searchParams.get("geometry_public_id")) {
			url.searchParams.set("geometry_public_id", geometryPublicId);
		}

		return url.pathname + url.search + url.hash;
	}

	window.fetch = function fetchWithDerivedGeometrySourceContext(resource, options) {
		if (typeof resource === "string") {
			return originalFetch(appendGeometryPublicId(resource), options);
		}

		if (resource instanceof Request) {
			const nextUrl = appendGeometryPublicId(resource.url);
			if (nextUrl !== resource.url) {
				return originalFetch(new Request(nextUrl, resource), options);
			}
		}

		return originalFetch(resource, options);
	};
})();

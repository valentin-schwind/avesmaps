"use strict";

(function installDerivedGeometrySourceContext() {
	const originalFetch = window.fetch?.bind(window);
	if (!originalFetch || window.__avesmapsDerivedGeometrySourceContextInstalled === true) {
		return;
	}

	window.__avesmapsDerivedGeometrySourceContextInstalled = true;
	window.__avesmapsResolvedDerivedGeometryTargetByRequestKey ||= new Map();

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

	function rewriteDerivedGeometryBody(options) {
		if (!options || typeof options !== "object" || typeof options.body !== "string") {
			return options;
		}

		let payload = null;
		try {
			payload = JSON.parse(options.body);
		} catch (error) {
			return options;
		}

		const action = String(payload?.action || "").trim();
		if (action !== "save_derived_geometry" && action !== "delete_derived_geometry") {
			return options;
		}

		const targetKey = String(payload.target_key || "").trim();
		const resolvedTarget = targetKey ? window.__avesmapsResolvedDerivedGeometryTargetByRequestKey.get(targetKey) : "";
		if (!resolvedTarget) {
			return options;
		}

		return {
			...options,
			body: JSON.stringify({
				...payload,
				target_key: resolvedTarget,
				territory_public_id: resolvedTarget,
			}),
		};
	}

	function maybeRememberResolvedTarget(resource, response) {
		if (typeof resource !== "string") {
			return response;
		}

		let url = null;
		try {
			url = new URL(resource, window.location.href);
		} catch (error) {
			return response;
		}

		if (url.searchParams.get("action") !== "derived_geometry_sources") {
			return response;
		}

		const requestTargetKey = String(url.searchParams.get("target_key") || "").trim();
		if (!requestTargetKey) {
			return response;
		}

		const clone = response.clone();
		clone.json().then((payload) => {
			const territoryPublicId = String(payload?.territory_public_id || "").trim();
			if (payload?.ok !== false && territoryPublicId) {
				window.__avesmapsResolvedDerivedGeometryTargetByRequestKey.set(requestTargetKey, territoryPublicId);
			}
		}).catch(() => {});

		return response;
	}

	window.fetch = function fetchWithDerivedGeometrySourceContext(resource, options) {
		const nextOptions = rewriteDerivedGeometryBody(options);

		if (typeof resource === "string") {
			const nextResource = appendGeometryPublicId(resource);
			return originalFetch(nextResource, nextOptions).then((response) => maybeRememberResolvedTarget(nextResource, response));
		}

		if (resource instanceof Request) {
			const nextUrl = appendGeometryPublicId(resource.url);
			if (nextUrl !== resource.url) {
				const nextRequest = new Request(nextUrl, resource);
				return originalFetch(nextRequest, nextOptions).then((response) => maybeRememberResolvedTarget(nextUrl, response));
			}
		}

		return originalFetch(resource, nextOptions);
	};
})();

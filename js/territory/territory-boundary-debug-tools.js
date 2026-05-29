"use strict";

(function installBoundaryDebugTools() {
	function text(value) {
		return String(value || "").replace(/\s+/g, " ").trim();
	}

	function geometryId() {
		return text(new URLSearchParams(window.location.search).get("geometry_public_id"));
	}

	function assignmentValue() {
		return window.AvesmapsPoliticalTerritoryAssignment?.getValue?.() || null;
	}

	function targetKey(value) {
		return text(window.AvesmapsPoliticalDerivedGeometryEditor?.getTargetKey?.(value));
	}

	function territoryId(value) {
		const root = window.AvesmapsPoliticalTerritoryEditorForm?.readRootSelection?.(value) || null;
		return text(root?.territoryPublicId || "");
	}

	function buildUrl() {
		const value = assignmentValue();
		const params = new URLSearchParams();
		params.set("debug_errors", "1");
		params.set("action", "debug_boundary_contract");
		const target = targetKey(value);
		const territory = territoryId(value);
		const geometry = geometryId();
		if (target) params.set("target_key", target);
		if (territory) params.set("territory_public_id", territory);
		if (geometry) params.set("geometry_public_id", geometry);
		return `/api/app/political-territories.php?${params.toString()}`;
	}

	window.AvesmapsBoundaryDebug = {
		buildUrl,
		open() {
			window.open(buildUrl(), "_blank", "noopener");
		},
		log() {
			console.log(buildUrl());
			return buildUrl();
		}
	};
})();

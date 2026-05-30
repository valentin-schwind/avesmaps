/*
 * Runtime glue for derived political boundary behavior.
 * Loaded after the political territory loader so it can refine derived-boundary visibility
 * without duplicating the full loader module.
 */

(function installDerivedBoundaryRuntimeFixes() {
	function readOptionalZoom(value) {
		if (typeof readOptionalRegionZoom === "function") {
			return readOptionalRegionZoom(value);
		}
		if (value === "" || value === null || typeof value === "undefined") {
			return null;
		}
		const zoom = Number(value);
		return Number.isFinite(zoom) ? zoom : null;
	}

	function isVisibleAtCurrentZoom(properties) {
		const currentZoom = Math.round(map.getZoom());
		const minZoom = readOptionalZoom(properties?.min_zoom);
		const maxZoom = readOptionalZoom(properties?.max_zoom);
		return (minZoom === null || minZoom <= currentZoom)
			&& (maxZoom === null || maxZoom >= currentZoom);
	}

	function readSourceIds(properties) {
		const ids = new Set();
		[
			properties?.derived_source_territory_public_ids,
			properties?.source_territory_public_ids,
			properties?.hidden_source_territory_public_ids,
		].forEach((value) => {
			if (!Array.isArray(value)) {
				return;
			}
			value.forEach((entry) => {
				const id = String(entry || "").trim();
				if (id) {
					ids.add(id);
				}
			});
		});
		return ids;
	}

	window.applyPoliticalTerritoryDerivedBoundaryVisibility = function applyPoliticalTerritoryDerivedBoundaryVisibility(features) {
		const hiddenSourceIds = new Map();
		(Array.isArray(features) ? features : []).forEach((feature) => {
			const properties = feature?.properties || {};
			if (properties.is_derived_geometry !== true || properties.show_inner_boundaries !== false || !isVisibleAtCurrentZoom(properties)) {
				return;
			}
			const derivedTerritoryPublicId = String(properties.territory_public_id || "").trim();
			readSourceIds(properties).forEach((sourceId) => {
				hiddenSourceIds.set(sourceId, derivedTerritoryPublicId);
			});
		});

		(Array.isArray(features) ? features : []).forEach((feature) => {
			const properties = feature?.properties;
			if (!properties || properties.is_derived_geometry === true) {
				return;
			}

			delete properties.visual_hidden_by_derived_boundary;
			delete properties.hidden_by_derived_territory_public_id;

			const territoryPublicId = String(properties.territory_public_id || "").trim();
			const aggregateSourceTerritoryPublicId = String(properties.aggregate_source_territory_public_id || "").trim();
			const geometryPublicId = String(properties.geometry_public_id || properties.public_id || "").trim();
			const hiddenBy = hiddenSourceIds.get(geometryPublicId)
				|| hiddenSourceIds.get(territoryPublicId)
				|| hiddenSourceIds.get(aggregateSourceTerritoryPublicId)
				|| "";
			if (!hiddenBy) {
				return;
			}

			properties.visual_hidden_by_derived_boundary = true;
			properties.hidden_by_derived_territory_public_id = hiddenBy;
			properties.show_region_label = false;
		});

		return features;
	};

	function getInnerBoundariesInput() {
		return document.getElementById("region-edit-derived-geometry-inner-boundaries");
	}

	function ensureMainEditorInnerBoundaryControl() {
		const enabledInput = document.getElementById("region-edit-derived-geometry-enabled");
		if (!enabledInput || getInnerBoundariesInput()) {
			return;
		}
		enabledInput.closest("label")?.insertAdjacentHTML("afterend", `
			<label class="location-report-form__checkbox">
				<input id="region-edit-derived-geometry-inner-boundaries" name="derived_geometry_inner_boundaries" type="checkbox" checked />
				<span>Innengrenzen darstellen</span>
			</label>
		`);
		getInnerBoundariesInput()?.addEventListener("change", () => {
			if (window.derivedGeometryEditorState) {
				window.derivedGeometryEditorState.dirty = true;
			}
		});
	}

	function syncMainEditorInnerBoundaryControlFromLoadedGeometry() {
		const input = getInnerBoundariesInput();
		const panel = document.getElementById("region-edit-derived-geometry-panel");
		if (!input || !panel || panel.hidden) {
			return;
		}
		const region = regionEditEntry;
		const feature = region?.feature;
		const properties = feature?.properties || {};
		if (properties.is_derived_geometry === true || typeof properties.show_inner_boundaries === "boolean") {
			input.checked = properties.show_inner_boundaries !== false;
		}
	}

	const originalSaveDerivedGeometry = politicalTerritoryRepository?.saveDerivedGeometry?.bind(politicalTerritoryRepository);
	if (originalSaveDerivedGeometry && !politicalTerritoryRepository.__avesmapsDerivedBoundarySavePatched) {
		politicalTerritoryRepository.saveDerivedGeometry = function saveDerivedGeometryWithInnerBoundaryState(payload) {
			ensureMainEditorInnerBoundaryControl();
			const input = getInnerBoundariesInput();
			return originalSaveDerivedGeometry({
				...payload,
				// Ein explizit übergebener Boolean gewinnt (iframe-Häkchen-Wert beim Erzeugen,
			// Kaskade-Default false). Nur wenn der Aufrufer nichts mitgibt, das (inline)
			// Häkchen als Fallback lesen. Verhindert, dass dieser Patch den gewünschten Wert
			// und die Kaskade-false überschreibt (= Innengrenzen blieben sonst an).
			show_inner_boundaries: typeof payload?.show_inner_boundaries === "boolean"
				? payload.show_inner_boundaries
				: (input ? input.checked === true : payload?.show_inner_boundaries),
			});
		};
		politicalTerritoryRepository.__avesmapsDerivedBoundarySavePatched = true;
	}

	[0, 150, 500, 1000].forEach((delay) => window.setTimeout(() => {
		ensureMainEditorInnerBoundaryControl();
		syncMainEditorInnerBoundaryControlFromLoadedGeometry();
	}, delay));
	document.addEventListener("click", () => window.setTimeout(() => {
		ensureMainEditorInnerBoundaryControl();
		syncMainEditorInnerBoundaryControlFromLoadedGeometry();
	}, 0));
})();

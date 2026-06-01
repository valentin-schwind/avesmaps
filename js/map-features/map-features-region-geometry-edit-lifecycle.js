// Vertex-Außenkontur-Blau (s. .path-edit-handle-marker__dot border) — damit die Kanten der
// gerade editierten Geometrie wieder sichtbar sind (sonst weight 0 durch Stroke-Hide).
const REGION_EDIT_EDGE_COLOR = "#1452f7";

function clearRegionGeometryEdit() {
	if (!activeRegionGeometryEdit) return;

	clearRegionEditEdgeHover();
	disableRegionEditEdgeControls();

	// Kanten-Stil des editierten Polygons zurücksetzen (vor dem Edit gemerkt).
	const editLayer = activeRegionGeometryEdit.editLayer;
	if (editLayer && activeRegionGeometryEdit.originalEdgeStyle && typeof editLayer.setStyle === "function") {
		editLayer.setStyle(activeRegionGeometryEdit.originalEdgeStyle);
	}

	if (activeRegionGeometryEdit.regionEntry.source !== "political_territory") {
		void releaseFeatureSoftLock(activeRegionGeometryEdit.regionEntry.publicId);
	}

	activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activeRegionGeometryEdit = null;
}

function startRegionGeometryEdit(regionEntry, editLayer = null) {
	cancelPoliticalTerritoryLayerReload();
	clearRegionGeometryEdit();

	if (regionEntry.source !== "political_territory") {
		void acquireFeatureSoftLock(regionEntry.publicId);
	}

	const resolvedEditLayer = editLayer || regionEntry.layer;
	activeRegionGeometryEdit = {
		regionEntry,
		editLayer: resolvedEditLayer,
		editRingIndex: 0,
		handles: [],
		edgeHover: null,
		edgeHighlightLayer: null,
		originalEdgeStyle: null,
	};

	// Kanten der editierten Geometrie sichtbar machen (Vertex-Blau): das Quellpolygon ist
	// sonst evtl. stroke-hidden (weight 0). Vorher Original-Stil merken zum Zurücksetzen.
	if (resolvedEditLayer && typeof resolvedEditLayer.setStyle === "function") {
		const options = resolvedEditLayer.options || {};
		activeRegionGeometryEdit.originalEdgeStyle = {
			color: options.color,
			weight: options.weight,
			opacity: options.opacity,
			dashArray: options.dashArray ?? null,
		};
		resolvedEditLayer.setStyle({ color: REGION_EDIT_EDGE_COLOR, weight: 2, opacity: 1, dashArray: null });
		resolvedEditLayer.bringToFront?.();
	}

	refreshRegionEditHandles();
	enableRegionEditEdgeControls();
}

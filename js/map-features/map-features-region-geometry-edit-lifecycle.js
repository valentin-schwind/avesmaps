function clearRegionGeometryEdit() {
	if (!activeRegionGeometryEdit) return;

	clearRegionEditEdgeHover();
	disableRegionEditEdgeControls();

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

	activeRegionGeometryEdit = {
		regionEntry,
		editLayer: editLayer || regionEntry.layer,
		handles: [],
		edgeHover: null,
		edgeHighlightLayer: null,
	};

	refreshRegionEditHandles();
	enableRegionEditEdgeControls();
}

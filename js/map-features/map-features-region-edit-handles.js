function createRegionHandleIcon() {
	return L.divIcon({
		className: "path-edit-handle-marker region-edit-handle-marker",
		html: '<span class="path-edit-handle-marker__dot"></span>',
		iconSize: [18, 18],
		iconAnchor: [9, 9],
	});
}

function refreshRegionEditHandles() {
	if (!activeRegionGeometryEdit) return;
	activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activeRegionGeometryEdit.handles = [];
	getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry).forEach((latLng, index) => {
		const originalLatLng = L.latLng(latLng);
		const handle = L.marker(latLng, {
			icon: createRegionHandleIcon(),
			pane: "measurementHandlesPane",
			draggable: true,
			keyboard: false,
			bubblingMouseEvents: false,
		}).addTo(map);
		
		handle.on("dragstart", () => {
			clearRegionEditEdgeHover();
		});

		handle.on("drag", (event) => {
			const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
			latLngs[index] = event.target.getLatLng();
			setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
			updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
			clearRegionEditEdgeHover();
		});

		handle.on("dragend", (event) => {
			const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
			const targetLatLng = findNearestRegionSnapPoint(event.target.getLatLng(), activeRegionGeometryEdit.regionEntry) || event.target.getLatLng();
			latLngs[index] = targetLatLng;
			setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
			const affectedRegions = applySharedBoundaryVertexMove(activeRegionGeometryEdit.regionEntry, originalLatLng, targetLatLng);
			updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
			refreshRegionEditHandles();
			void saveRegionGeometry(activeRegionGeometryEdit.regionEntry);
			affectedRegions.forEach((region) => {
				void saveRegionGeometry(region);
			});
		});

		handle.on("dblclick", (event) => {
			L.DomEvent.stop(event);
			L.DomEvent.preventDefault(event);
			deleteRegionNode(index);
		});

		const element = handle.getElement.();
		if (element) {
			L.DomEvent.disableClickPropagation(element);
			L.DomEvent.disableScrollPropagation(element);
			element.addEventListener("dblclick", (event) => {
				event.preventDefault();
				event.stopPropagation();
				deleteRegionNode(index);
			});
		}

		activeRegionGeometryEdit.handles.push(handle);
	});
}

function deleteRegionNode(index) {
	const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
	if (latLngs.length <= 3) {
		showFeedbackToast("Region braucht mindestens drei Punkte.", "warning");
		return;
	}
	latLngs.splice(index, 1);
	setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
	updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
	refreshRegionEditHandles();
	void saveRegionGeometry(activeRegionGeometryEdit.regionEntry);
}

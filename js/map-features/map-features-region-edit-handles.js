// NOTE: createRegionHandleIcon + refreshRegionEditHandles are OVERRIDDEN at runtime by
// map-features-region-vertex-detach-edit.js, injected dynamically from js/routing/route-priority-queue.js,
// which re-assigns window.* with Ctrl+drag vertex-detach variants. Edits here affect only the pre-injection
// fallback; the detach-edit copy wins. See docs/cleanup-audit-2026-06-27.md (section A4).
function createRegionHandleIcon() {
	return L.divIcon({
		className: "path-edit-handle-marker region-edit-handle-marker",
		html: '<span class="path-edit-handle-marker__dot"></span>',
		iconSize: [18, 18],
		iconAnchor: [9, 9]
	});
}

function refreshRegionEditHandles() {
	if (!activeRegionGeometryEdit) return;
	activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
	activeRegionGeometryEdit.handles = [];

	const rings = getPolygonLatLngRings(activeRegionGeometryEdit.editLayer);
	rings.forEach((ringLatLngs, ringIndex) => {
		ringLatLngs.forEach((latLng, index) => {
			const originalLatLng = L.latLng(latLng);
			const handle = L.marker(latLng, {
				icon: createRegionHandleIcon(),
				pane: "measurementHandlesPane",
				draggable: true,
				keyboard: false,
				bubblingMouseEvents: false,
			}).addTo(map);
			handle._regionRingIndex = ringIndex;
			handle._regionVertexIndex = index;
			
			handle.on("dragstart", () => {
				activeRegionGeometryEdit.editRingIndex = ringIndex;
				// Ctrl+Z: opens the step before the drag. Also present in the detach-edit copy that wins
				// at runtime -- both need it, because either may be the one actually installed.
				if (typeof pushRegionGeometryUndoStep === "function") { pushRegionGeometryUndoStep(activeRegionGeometryEdit.regionEntry); }
				clearRegionEditEdgeHover();
			});

			handle.on("drag", (event) => {
				activeRegionGeometryEdit.editRingIndex = ringIndex;
				const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, ringIndex);
				latLngs[index] = event.target.getLatLng();
				setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs, ringIndex);
				updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
				clearRegionEditEdgeHover();
				// Der Kringel vor dem Einrasten. Diese Fassung kennt kein Strg-Lösen (das bringt erst die
				// Laufzeit-Kopie mit), also gibt es hier nichts freizuhalten.
				if (typeof renderRegionEditSnapPreview === "function") {
					renderRegionEditSnapPreview(event.target.getLatLng(), false);
				}
			});

			handle.on("dragend", (event) => {
				activeRegionGeometryEdit.editRingIndex = ringIndex;
				if (typeof clearRegionEditSnapPreview === "function") {
					clearRegionEditSnapPreview();
				}
				const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, ringIndex);
				const targetLatLng = findNearestRegionSnapPoint(event.target.getLatLng(), activeRegionGeometryEdit.regionEntry) || event.target.getLatLng();
				latLngs[index] = targetLatLng;
				setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs, ringIndex);
				const affectedRegions = applySharedBoundaryVertexMove(activeRegionGeometryEdit.regionEntry, originalLatLng, targetLatLng);
				updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
				refreshRegionEditHandles();
				// Gebuendelt, wie in der Laufzeit-Kopie -- beide muessen dasselbe tun.
				scheduleRegionGeometrySave(activeRegionGeometryEdit.regionEntry);
				affectedRegions.forEach((region) => {
					scheduleRegionGeometrySave(region);
				});
			});

			handle.on("dblclick", (event) => {
				L.DomEvent.stop(event);
				L.DomEvent.preventDefault(event);
				deleteRegionNode(index, ringIndex);
			});

			const element = handle.getElement?.();
			if (element) {
				L.DomEvent.disableClickPropagation(element);
				L.DomEvent.disableScrollPropagation(element);
				element.addEventListener("dblclick", (event) => {
					event.preventDefault();
					event.stopPropagation();
					deleteRegionNode(index, ringIndex);
				});
			}

			activeRegionGeometryEdit.handles.push(handle);
		});
	});
}

function deleteRegionNode(index, ringIndex = null) {
	const resolvedRingIndex = ringIndex === null ? getRegionEditRingIndex(activeRegionGeometryEdit.regionEntry, 0) : ringIndex;
	const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, resolvedRingIndex);
	if (latLngs.length <= 3) {
		showFeedbackToast("Region braucht mindestens drei Punkte.", "warning");
		return;
	}
	activeRegionGeometryEdit.editRingIndex = resolvedRingIndex;
	if (typeof pushRegionGeometryUndoStep === "function") { pushRegionGeometryUndoStep(activeRegionGeometryEdit.regionEntry); }
	latLngs.splice(index, 1);
	setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs, resolvedRingIndex);
	updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
	refreshRegionEditHandles();
	scheduleRegionGeometrySave(activeRegionGeometryEdit.regionEntry);
}

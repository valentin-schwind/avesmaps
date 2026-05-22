(function initializeRegionVertexDetachEditing() {
	const REGION_EDIT_VERTEX_DETACH_HIT_TOLERANCE_PX = 14;
	const REGION_VERTEX_DETACH_INSTALL_RETRY_LIMIT = 120;
	let installRetryCount = 0;
	let overridesInstalled = false;
	let isRegionVertexDetachCtrlPressed = false;

	function scheduleRegionVertexDetachInstall() {
		if (overridesInstalled || installRetryCount >= REGION_VERTEX_DETACH_INSTALL_RETRY_LIMIT) {
			return;
		}

		installRetryCount += 1;
		window.setTimeout(() => {
			if (!installRegionVertexDetachEditing()) {
				scheduleRegionVertexDetachInstall();
			}
		}, 50);
	}

	function readRegionVertexDetachModifier(event = null) {
		return Boolean(isRegionVertexDetachCtrlPressed || event?.originalEvent?.ctrlKey || event?.ctrlKey);
	}

	function installRegionVertexDetachEditing() {
		if (overridesInstalled) {
			return true;
		}

		if (typeof L === "undefined" || typeof window.refreshRegionEditHandles !== "function" || typeof window.handleRegionEditMouseMove !== "function") {
			return false;
		}

		overridesInstalled = true;

		document.addEventListener("keydown", (event) => {
			if (event.key === "Control") {
				isRegionVertexDetachCtrlPressed = true;
			}
		}, true);

		document.addEventListener("keyup", (event) => {
			if (event.key === "Control") {
				isRegionVertexDetachCtrlPressed = false;
				if (activeRegionGeometryEdit?.vertexDetachHandle) {
					clearRegionEditVertexDetachPreview();
				}
			}
		}, true);

		window.addEventListener("blur", () => {
			isRegionVertexDetachCtrlPressed = false;
			if (activeRegionGeometryEdit?.vertexDetachHandle) {
				clearRegionEditVertexDetachPreview();
			}
		});

		function getRegionVertexDetachHandleId(index) {
			return `outer:${index}`;
		}

		function createRegionDetachHandleIcon(detachPreview = false) {
			const dotAttributes = detachPreview
				? ' style="background:#f0c05a;border-color:#7a5200;box-shadow:0 0 0 3px rgba(240, 192, 90, 0.34);"'
				: "";

			return L.divIcon({
				className: `path-edit-handle-marker region-edit-handle-marker${detachPreview ? " region-edit-handle-marker--detach-preview" : ""}`,
				html: `<span class="path-edit-handle-marker__dot"${dotAttributes}></span>`,
				iconSize: [18, 18],
				iconAnchor: [9, 9],
			});
		}

		function setRegionDetachedVertexHandle(handle, isDetachPreview) {
			if (!handle || handle._regionDetachPreview === isDetachPreview) {
				return;
			}

			handle._regionDetachPreview = isDetachPreview;
			handle.setIcon(createRegionDetachHandleIcon(isDetachPreview));
		}

		function clearRegionEditVertexDetachPreview() {
			if (!activeRegionGeometryEdit?.vertexDetachHandle) {
				return;
			}

			setRegionDetachedVertexHandle(activeRegionGeometryEdit.vertexDetachHandle, false);
			activeRegionGeometryEdit.vertexDetachHandle = null;
			activeRegionGeometryEdit.vertexDetachHandleId = null;
		}

		function findNearestRegionEditHandle(latLng) {
			if (!activeRegionGeometryEdit || !latLng) {
				return null;
			}

			const targetPoint = map.latLngToContainerPoint(latLng);
			let nearest = null;
			activeRegionGeometryEdit.handles.forEach((handle) => {
				const distance = targetPoint.distanceTo(map.latLngToContainerPoint(handle.getLatLng()));
				if (distance <= REGION_EDIT_VERTEX_DETACH_HIT_TOLERANCE_PX && (!nearest || distance < nearest.distance)) {
					nearest = { handle, distance };
				}
			});

			return nearest?.handle || null;
		}

		function markRegionVertexDetachHandle(handle) {
			if (!activeRegionGeometryEdit || !handle) {
				clearRegionEditVertexDetachPreview();
				return false;
			}

			if (activeRegionGeometryEdit.vertexDetachHandle && activeRegionGeometryEdit.vertexDetachHandle !== handle) {
				setRegionDetachedVertexHandle(activeRegionGeometryEdit.vertexDetachHandle, false);
			}

			activeRegionGeometryEdit.vertexDetachHandle = handle;
			activeRegionGeometryEdit.vertexDetachHandleId = handle._regionVertexHandleId || null;
			setRegionDetachedVertexHandle(handle, true);
			clearRegionEditEdgeHover();
			return true;
		}

		function updateRegionEditVertexDetachPreviewFromLatLng(latLng) {
			const handle = findNearestRegionEditHandle(latLng);
			if (!handle) {
				clearRegionEditVertexDetachPreview();
				return false;
			}

			return markRegionVertexDetachHandle(handle);
		}

		function handleRegionVertexDetachMouseEvent(event, handle) {
			if (!readRegionVertexDetachModifier(event)) {
				return;
			}

			markRegionVertexDetachHandle(handle);
		}

		function shouldDetachRegionVertexDrag(handle, event = null) {
			return Boolean(
				readRegionVertexDetachModifier(event)
				|| activeRegionGeometryEdit
				&& handle
				&& activeRegionGeometryEdit.vertexDetachHandleId
				&& activeRegionGeometryEdit.vertexDetachHandleId === handle._regionVertexHandleId
			);
		}

		window.createRegionHandleIcon = function createRegionHandleIcon() {
			return createRegionDetachHandleIcon(false);
		};

		window.clearRegionGeometryEdit = function clearRegionGeometryEdit() {
			if (!activeRegionGeometryEdit) return;

			clearRegionEditVertexDetachPreview();
			clearRegionEditEdgeHover();
			disableRegionEditEdgeControls();

			if (activeRegionGeometryEdit.regionEntry.source !== "political_territory") {
				void releaseFeatureSoftLock(activeRegionGeometryEdit.regionEntry.publicId);
			}

			activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
			activeRegionGeometryEdit = null;
		};

		window.refreshRegionEditHandles = function refreshRegionEditHandles() {
			if (!activeRegionGeometryEdit) return;
			activeRegionGeometryEdit.handles.forEach((handle) => map.removeLayer(handle));
			activeRegionGeometryEdit.handles = [];
			activeRegionGeometryEdit.vertexDetachHandle = null;
			activeRegionGeometryEdit.vertexDetachHandleId = null;

			getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry).forEach((latLng, index) => {
				const originalLatLng = L.latLng(latLng);
				const handle = L.marker(latLng, {
					icon: createRegionDetachHandleIcon(false),
					pane: "measurementHandlesPane",
					draggable: true,
					keyboard: false,
					bubblingMouseEvents: false,
				}).addTo(map);
				handle._regionVertexHandleId = getRegionVertexDetachHandleId(index);
				handle._regionDetachPreview = false;
				handle._regionDetachDrag = false;
				handle._regionDetachMouseDownCtrl = false;

				handle.on("mouseover", (event) => handleRegionVertexDetachMouseEvent(event, handle));
				handle.on("mousemove", (event) => handleRegionVertexDetachMouseEvent(event, handle));
				handle.on("mousedown", (event) => {
					handle._regionDetachMouseDownCtrl = readRegionVertexDetachModifier(event);
					if (handle._regionDetachMouseDownCtrl) {
						markRegionVertexDetachHandle(handle);
					}
				});

				handle.on("dragstart", (event) => {
					handle._regionDetachDrag = Boolean(handle._regionDetachMouseDownCtrl || shouldDetachRegionVertexDrag(handle, event));
					clearRegionEditVertexDetachPreview();
					clearRegionEditEdgeHover();
				});

				handle.on("drag", (event) => {
					if (readRegionVertexDetachModifier(event)) {
						handle._regionDetachDrag = true;
					}

					const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
					latLngs[index] = event.target.getLatLng();
					setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
					updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
					clearRegionEditEdgeHover();
				});

				handle.on("dragend", (event) => {
					const shouldDetachVertex = Boolean(event.target._regionDetachDrag || readRegionVertexDetachModifier(event));
					event.target._regionDetachDrag = false;
					event.target._regionDetachMouseDownCtrl = false;

					const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry);
					const targetLatLng = shouldDetachVertex
						? event.target.getLatLng()
						: findNearestRegionSnapPoint(event.target.getLatLng(), activeRegionGeometryEdit.regionEntry) || event.target.getLatLng();
					latLngs[index] = targetLatLng;
					setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs);
					const affectedRegions = shouldDetachVertex
						? []
						: applySharedBoundaryVertexMove(activeRegionGeometryEdit.regionEntry, originalLatLng, targetLatLng);
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

				const element = handle.getElement?.();
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
		};

		window.handleRegionEditMouseMove = function handleRegionEditMouseMove(event) {
			if (!activeRegionGeometryEdit || !readRegionVertexDetachModifier(event)) {
				clearRegionEditVertexDetachPreview();
				clearRegionEditEdgeHover();
				return;
			}

			if (updateRegionEditVertexDetachPreviewFromLatLng(event.latlng)) {
				return;
			}

			clearRegionEditVertexDetachPreview();
			updateRegionEditEdgeHoverFromLatLng(event.latlng);
		};

		window.handleRegionEditMouseOut = function handleRegionEditMouseOut() {
			clearRegionEditVertexDetachPreview();
			clearRegionEditEdgeHover();
		};

		window.handleRegionEditKeyUp = function handleRegionEditKeyUp(event) {
			if (event.key === "Control") {
				isRegionVertexDetachCtrlPressed = false;
				clearRegionEditVertexDetachPreview();
				clearRegionEditEdgeHover();
			}
		};

		window.handleRegionEditClick = function handleRegionEditClick(event) {
			if (!activeRegionGeometryEdit || !readRegionVertexDetachModifier(event)) {
				return;
			}

			if (event.latlng && updateRegionEditVertexDetachPreviewFromLatLng(event.latlng)) {
				L.DomEvent.stop(event.originalEvent);
				L.DomEvent.preventDefault(event.originalEvent);
				return;
			}

			if (!activeRegionGeometryEdit.edgeHover && event.latlng) {
				updateRegionEditEdgeHoverFromLatLng(event.latlng);
			}

			if (!activeRegionGeometryEdit.edgeHover) {
				return;
			}

			L.DomEvent.stop(event.originalEvent);
			L.DomEvent.preventDefault(event.originalEvent);

			subdivideRegionEditHoveredEdge(4);
		};

		return true;
	}

	if (!installRegionVertexDetachEditing()) {
		scheduleRegionVertexDetachInstall();
	}
})();

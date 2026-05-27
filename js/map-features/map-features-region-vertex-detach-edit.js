(function initializeRegionVertexDetachEditing() {
	const REGION_EDIT_VERTEX_DETACH_HIT_TOLERANCE_PX = 14;
	const REGION_VERTEX_DETACH_INSTALL_RETRY_LIMIT = 120;
	let installRetryCount = 0;
	let overridesInstalled = false;
	let isRegionVertexDetachCtrlPressed = false;
	let activeRegionVertexDetachDrag = null;

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

	function stopRegionVertexDetachDomEvent(event) {
		if (!event) {
			return;
		}

		event.preventDefault?.();
		event.stopPropagation?.();
		event.stopImmediatePropagation?.();
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
				if (activeRegionGeometryEdit?.vertexDetachHandle && !activeRegionVertexDetachDrag) {
					clearRegionEditVertexDetachPreview();
				}
			}
		}, true);

		window.addEventListener("blur", () => {
			isRegionVertexDetachCtrlPressed = false;
			finishManualRegionVertexDetachDrag();
			if (activeRegionGeometryEdit?.vertexDetachHandle) {
				clearRegionEditVertexDetachPreview();
			}
		});

		function getRegionVertexDetachHandleId(ringIndex, index) {
			return `${ringIndex}:${index}`;
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
			activeRegionGeometryEdit.editRingIndex = Number.isInteger(handle._regionRingIndex) ? handle._regionRingIndex : getRegionEditRingIndex(activeRegionGeometryEdit.regionEntry, 0);
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

		function getLatLngFromDomMouseEvent(event) {
			if (!event) {
				return null;
			}

			const container = map.getContainer();
			const bounds = container.getBoundingClientRect();
			return map.containerPointToLatLng(L.point(
				event.clientX - bounds.left,
				event.clientY - bounds.top
			));
		}

		function updateManualRegionVertexDetachDrag(event) {
			if (!activeRegionVertexDetachDrag || !activeRegionGeometryEdit) {
				return;
			}

			const latLng = getLatLngFromDomMouseEvent(event);
			if (!latLng) {
				return;
			}

			const { handle, index, ringIndex, regionEntry } = activeRegionVertexDetachDrag;
			const latLngs = getRegionOuterLatLngs(regionEntry, ringIndex);
			if (!latLngs[index]) {
				return;
			}

			handle.setLatLng(latLng);
			latLngs[index] = latLng;
			setRegionOuterLatLngs(regionEntry, latLngs, ringIndex);
			updateRegionLabelPosition(regionEntry);
			clearRegionEditEdgeHover();
			activeRegionVertexDetachDrag.didMove = true;
		}

		function finishManualRegionVertexDetachDrag(event = null) {
			if (!activeRegionVertexDetachDrag) {
				return;
			}

			const dragState = activeRegionVertexDetachDrag;
			activeRegionVertexDetachDrag = null;
			document.removeEventListener("mousemove", updateManualRegionVertexDetachDrag, true);
			document.removeEventListener("mouseup", finishManualRegionVertexDetachDrag, true);
			document.body.classList.remove("region-vertex-detach-dragging");
			if (dragState.mapDraggingWasEnabled) {
				map.dragging.enable();
			}
			if (dragState.handleDraggingWasEnabled) {
				dragState.handle.dragging?.enable?.();
			}

			if (event) {
				stopRegionVertexDetachDomEvent(event);
				updateManualRegionVertexDetachDrag(event);
			}

			if (!activeRegionGeometryEdit || !dragState.didMove) {
				clearRegionEditVertexDetachPreview();
				return;
			}

			const latLngs = getRegionOuterLatLngs(dragState.regionEntry, dragState.ringIndex);
			const targetLatLng = dragState.handle.getLatLng();
			latLngs[dragState.index] = targetLatLng;
			setRegionOuterLatLngs(dragState.regionEntry, latLngs, dragState.ringIndex);
			updateRegionLabelPosition(dragState.regionEntry);
			refreshRegionEditHandles();
			void saveRegionGeometry(dragState.regionEntry);
		}

		function startManualRegionVertexDetachDrag(event, handle, index, ringIndex = 0) {
			const domEvent = event?.originalEvent || event;
			if (!activeRegionGeometryEdit || !readRegionVertexDetachModifier(event) || activeRegionVertexDetachDrag) {
				return false;
			}

			activeRegionGeometryEdit.editRingIndex = ringIndex;
			stopRegionVertexDetachDomEvent(domEvent);
			markRegionVertexDetachHandle(handle);
			clearRegionEditEdgeHover();

			const mapDraggingWasEnabled = Boolean(map.dragging?.enabled?.());
			if (mapDraggingWasEnabled) {
				map.dragging.disable();
			}
			const handleDraggingWasEnabled = Boolean(handle.dragging?.enabled?.());
			if (handleDraggingWasEnabled) {
				handle.dragging.disable();
			}

			activeRegionVertexDetachDrag = {
				handle,
				index,
				ringIndex,
				regionEntry: activeRegionGeometryEdit.regionEntry,
				mapDraggingWasEnabled,
				handleDraggingWasEnabled,
				didMove: false,
			};
			document.body.classList.add("region-vertex-detach-dragging");
			document.addEventListener("mousemove", updateManualRegionVertexDetachDrag, true);
			document.addEventListener("mouseup", finishManualRegionVertexDetachDrag, true);
			updateManualRegionVertexDetachDrag(domEvent);
			return true;
		}

		window.createRegionHandleIcon = function createRegionHandleIcon() {
			return createRegionDetachHandleIcon(false);
		};

		window.clearRegionGeometryEdit = function clearRegionGeometryEdit() {
			if (!activeRegionGeometryEdit) return;

			finishManualRegionVertexDetachDrag();
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

			const rings = getPolygonLatLngRings(activeRegionGeometryEdit.editLayer);
			rings.forEach((ringLatLngs, ringIndex) => {
				ringLatLngs.forEach((latLng, index) => {
					const originalLatLng = L.latLng(latLng);
					const handle = L.marker(latLng, {
						icon: createRegionDetachHandleIcon(false),
						pane: "measurementHandlesPane",
						draggable: true,
						keyboard: false,
						bubblingMouseEvents: false,
					}).addTo(map);
					handle._regionRingIndex = ringIndex;
					handle._regionVertexIndex = index;
					handle._regionVertexHandleId = getRegionVertexDetachHandleId(ringIndex, index);
					handle._regionDetachPreview = false;
					handle._regionDetachDrag = false;
					handle._regionDetachMouseDownCtrl = false;

					handle.on("mouseover", (event) => handleRegionVertexDetachMouseEvent(event, handle));
					handle.on("mousemove", (event) => handleRegionVertexDetachMouseEvent(event, handle));
					handle.on("mousedown", (event) => {
						if (startManualRegionVertexDetachDrag(event, handle, index, ringIndex)) {
							return;
						}

						handle._regionDetachMouseDownCtrl = readRegionVertexDetachModifier(event);
						if (handle._regionDetachMouseDownCtrl) {
							activeRegionGeometryEdit.editRingIndex = ringIndex;
							markRegionVertexDetachHandle(handle);
						}
					});

					handle.on("dragstart", (event) => {
						activeRegionGeometryEdit.editRingIndex = ringIndex;
						handle._regionDetachDrag = Boolean(handle._regionDetachMouseDownCtrl || shouldDetachRegionVertexDrag(handle, event));
						clearRegionEditVertexDetachPreview();
						clearRegionEditEdgeHover();
					});

					handle.on("drag", (event) => {
						activeRegionGeometryEdit.editRingIndex = ringIndex;
						if (readRegionVertexDetachModifier(event)) {
							handle._regionDetachDrag = true;
						}

						const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, ringIndex);
						latLngs[index] = event.target.getLatLng();
						setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs, ringIndex);
						updateRegionLabelPosition(activeRegionGeometryEdit.regionEntry);
						clearRegionEditEdgeHover();
					});

					handle.on("dragend", (event) => {
						activeRegionGeometryEdit.editRingIndex = ringIndex;
						const shouldDetachVertex = Boolean(event.target._regionDetachDrag || readRegionVertexDetachModifier(event));
						event.target._regionDetachDrag = false;
						event.target._regionDetachMouseDownCtrl = false;

						const latLngs = getRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, ringIndex);
						const targetLatLng = shouldDetachVertex
							? event.target.getLatLng()
							: findNearestRegionSnapPoint(event.target.getLatLng(), activeRegionGeometryEdit.regionEntry) || event.target.getLatLng();
						latLngs[index] = targetLatLng;
						setRegionOuterLatLngs(activeRegionGeometryEdit.regionEntry, latLngs, ringIndex);
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
						deleteRegionNode(index, ringIndex);
					});

					const element = handle.getElement?.();
					if (element) {
						L.DomEvent.disableClickPropagation(element);
						L.DomEvent.disableScrollPropagation(element);
						element.addEventListener("mousedown", (event) => {
							startManualRegionVertexDetachDrag(event, handle, index, ringIndex);
						}, true);
						element.addEventListener("dblclick", (event) => {
							event.preventDefault();
							event.stopPropagation();
							deleteRegionNode(index, ringIndex);
						});
					}

					activeRegionGeometryEdit.handles.push(handle);
				});
			});
		};

		window.handleRegionEditMouseMove = function handleRegionEditMouseMove(event) {
			if (!activeRegionGeometryEdit || activeRegionVertexDetachDrag || !readRegionVertexDetachModifier(event)) {
				if (!activeRegionVertexDetachDrag) {
					clearRegionEditVertexDetachPreview();
				}
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
			if (!activeRegionVertexDetachDrag) {
				clearRegionEditVertexDetachPreview();
			}
			clearRegionEditEdgeHover();
		};

		window.handleRegionEditKeyUp = function handleRegionEditKeyUp(event) {
			if (event.key === "Control") {
				isRegionVertexDetachCtrlPressed = false;
				if (!activeRegionVertexDetachDrag) {
					clearRegionEditVertexDetachPreview();
				}
				clearRegionEditEdgeHover();
			}
		};

		window.handleRegionEditClick = function handleRegionEditClick(event) {
			if (!activeRegionGeometryEdit || activeRegionVertexDetachDrag || !readRegionVertexDetachModifier(event)) {
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
